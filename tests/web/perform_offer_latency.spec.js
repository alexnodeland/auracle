// PERFORM's offers do not hold the engine: a pick and a Keep are answered
// while a spare offer grows, even on a slow machine.
//
// An offer is a walk of twenty-odd phrase renders, and it was one call the
// engine worker could not be interrupted in. A spare offer grown in the
// background (nobody had asked for it) therefore stood in front of everything
// the player did next: on a CI runner the first spare took 62 s, and a pick
// (`perform_record`) and a Keep waited behind it for the whole of it, which is
// what made the PERFORM specs time out there. The engine now begins an offer
// as a job the worker advances one render at a time, answering the player
// between renders (docs/architecture/web-runtime.md), so what a player does
// waits for at most the render in progress.
//
// This holds a very long spare (400 steps: minutes on any machine) in the
// background, and asks for a pick over the worker's own protocol and a Keep on
// the real panel. Both must land with the spare still growing, in time
// measured against a step of this machine's engine: a request waits for the
// step in progress, so the bound is a couple of seconds or twice a step,
// whichever is longer (a step is a render: 0.3 s on a laptop and seconds on a
// loaded CI runner). Chrome's CPU throttling (4x) is applied to the page, and
// it slows the main thread; it does not necessarily reach the dedicated engine
// worker, which is a target of its own, so the throttle is not what makes the
// engine slow, and the bound does not rest on it. Then the page leaves the
// patch (`retire`), and the walk that was running is dropped at its next step
// instead of finishing for nothing.
//
// The spec reaches the worker by wrapping `Worker` before `main.js` runs, as
// perform_next.spec.js does.
const { test, expect } = require("@playwright/test");

const INIT = `(() => {
  const Orig = window.Worker;
  const sent = (window.__sent = []);
  const got = (window.__got = []);
  function Wrapped(url, opts) {
    const w = new Orig(url, opts);
    if (/worker\\.js/.test(String(url))) {
      window.__worker = w;
      const post = w.postMessage.bind(w);
      w.postMessage = (m, ...rest) => {
        if (m && /^perform_/.test(m.type)) sent.push({ at: performance.now(), type: m.type, req: m.req, tree: m.tree });
        return post(m, ...rest);
      };
      w.addEventListener("message", (e) => {
        const m = e.data || {};
        if (/^perform_/.test(m.type) || m.type === "busy" || m.type === "idle")
          got.push({ at: performance.now(), type: m.type, req: m.req, error: m.error, recorded: m.recorded, offer: m.offer ? { tree: m.offer.tree } : m.offer });
      });
    }
    return w;
  }
  Wrapped.prototype = Orig.prototype;
  window.Worker = Wrapped;
})();`;

async function boot(page) {
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.addInitScript(INIT);
  await page.goto("/");
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 120_000 });
  await page.locator("#warm-skip").click();
  return errs;
}

async function openOnPerform(page, name) {
  await page.locator('.bf[data-f="preset"]').click();
  await page.locator(".bank-item", { hasText: name }).first().click();
  await page.waitForFunction((n) => (document.getElementById("rack-subject")?.textContent || "").includes(n), name, { timeout: 90_000 });
  await page.locator('.viewtab[data-view="perform"]').click();
  await expect(page.locator(".pf-name")).toHaveText(name, { timeout: 30_000 });
  await expect(page.locator(".pf-status")).toContainText("controls reach", { timeout: 120_000 });
}

async function drag(page, loc, dy) {
  const b = await loc.boundingBox();
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + dy, { steps: 10 });
  await page.mouse.up();
  await page.mouse.move(10, 10);
}

/** Send `m` to the engine worker; the page clock at the send. */
const post = (page, m) =>
  page.evaluate((msg) => {
    const at = performance.now();
    window.__worker.postMessage(msg);
    return at;
  }, m);

/** The worker's reply of `type` to request `req` (resolves when it lands). */
const reply = async (page, type, req, timeout) => {
  await page.waitForFunction(([t, r]) => window.__got.some((g) => g.type === t && g.req === r), [type, req], { timeout });
  return page.evaluate(([t, r]) => window.__got.find((g) => g.type === t && g.req === r), [type, req]);
};

test("a pick and a Keep are answered while a spare offer grows", { tag: "@slow" }, async ({ page }) => {
  test.setTimeout(300_000);
  const errs = await boot(page);
  await openOnPerform(page, "Glass Pad");
  const tree = await page.evaluate(() => window.__sent.find((s) => s.type === "perform_wire" && s.tree).tree);

  // An offer to answer, grown before the spare (a short walk).
  const OFFER = 9_000_001;
  const SPARE = 9_000_002;
  const PICK = 9_000_003;
  await post(page, { type: "perform_offer", req: OFFER, tree, overrides: [], locks: [], steps: 6 });
  const grown = await reply(page, "perform_offered", OFFER, 120_000);
  expect(grown.offer && grown.offer.tree, "an offer to answer grew").toBeTruthy();

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

  // What a step costs here, now: an offer of one step is the home patch (in
  // the memo) and one proposal, so one render. The worst of three.
  let step = 0;
  for (let i = 0; i < 3; i++) {
    const req = 9_000_010 + i;
    const at = await post(page, { type: "perform_offer", req, tree, overrides: [], locks: [], steps: 1 });
    step = Math.max(step, (await reply(page, "perform_offered", req, 120_000)).at - at);
  }
  // A request waits for the step in progress; a pick is one trip to the worker.
  const PICK_MS = Math.max(2_000, 2 * step);
  // A Keep is several trips (apply, commit, the new patch's check), each of
  // which can wait for a step.
  const KEEP_MS = Math.max(4_000, 6 * step);
  console.log(`one step ${step.toFixed(0)} ms here: pick within ${PICK_MS.toFixed(0)} ms, Keep within ${KEEP_MS.toFixed(0)} ms`);

  // The spare: far longer than the checks below, asked as the page asks for
  // one nobody has claimed (`bg`).
  const spareAt = await post(page, { type: "perform_offer", req: SPARE, tree, overrides: [], locks: [], steps: 400, bg: true });
  await page.waitForFunction((at) => window.__got.some((g) => g.type === "busy" && g.at > at), spareAt, { timeout: 30_000 });
  await page.waitForTimeout(1_500);
  expect(await page.evaluate((r) => window.__got.some((g) => g.type === "perform_offered" && g.req === r), SPARE), "the spare is still growing").toBe(false);

  // A pick, as PERFORM records a heard answer: it must not wait for the spare.
  const pickAt = await post(page, { type: "perform_record", req: PICK, tree, overrides: [], offer: JSON.stringify(grown.offer.tree), took: false });
  const recorded = await reply(page, "perform_recorded", PICK, 20_000);
  const pickMs = recorded.at - pickAt;
  console.log(`pick answered in ${pickMs.toFixed(0)} ms with the spare growing`);
  expect(recorded.recorded, "the pick was recorded").toBe(true);
  expect(pickMs, "the pick waited on the spare").toBeLessThan(PICK_MS);
  expect(await page.evaluate((r) => window.__got.some((g) => g.type === "perform_offered" && g.req === r), SPARE), "the pick came after the spare finished, so it proved nothing").toBe(false);

  // A Keep on the panel: turned away from home, kept, and said so.
  const bright = page.locator('.pf-knob[data-i="0"]');
  await drag(page, bright, -150);
  expect(Number(await bright.getAttribute("aria-valuenow"))).toBeGreaterThan(0.5);
  const keepAt = Date.now();
  await page.locator(".pf-pad", { hasText: "Keep" }).click();
  await expect(page.locator("#toasts")).toContainText("Kept: this is home now.", { timeout: KEEP_MS });
  console.log(`Keep said so in ${Date.now() - keepAt} ms with the spare growing`);

  // Leaving the patch stops the walk at its next step: answered retired, and
  // within a step or two.
  await post(page, { type: "retire", reqs: [SPARE] });
  const retired = await reply(page, "perform_offered", SPARE, Math.max(10_000, 4 * step));
  expect(retired.error).toBe("retired");
  expect(errs).toEqual([]);
});
