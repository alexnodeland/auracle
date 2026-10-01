// Wander answers at once, says what it is doing on itself, and its own drag
// is not a hand on the sound.
//
// Before: turning Wander into drift left 21 s of nothing (the first move
// waited a whole period, 36 s at the left of the zone, counted from the last
// move), turning it counted as a touch so the status line said "paused — your
// hands are on it" as it was being turned up, the dial had no marks for its
// zones, the middle zone was called "offer" like the pad and Blend's end, and
// its state was one more clause on PERFORM's status line.
//
// Now: let go in a new zone and the first move is asked for about 1.5 s later;
// Wander's drag never pauses it; three ticks mark ideas, drift and roam; the
// line under Wander carries its state ("drift · next in 9 s", "paused 3 s",
// "frozen") with a thin arc counting down; the status line keeps to the patch.
//
// The spec records PERFORM's requests to the engine by wrapping `Worker`
// before `main.js` runs.
const { test, expect } = require("@playwright/test");

const INIT = `(() => {
  const Orig = window.Worker;
  const posts = (window.__pfPosts = []);
  function Wrapped(url, opts) {
    const w = new Orig(url, opts);
    if (/worker\\.js/.test(String(url))) {
      const post = w.postMessage.bind(w);
      w.postMessage = (m, t) => {
        if (m && typeof m.type === "string" && /^perform_/.test(m.type)) posts.push({ type: m.type, bg: !!m.bg, t: performance.now() });
        return post(m, t);
      };
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

test("Wander answers a second and a half after it is let go, and says what it is doing on itself", { tag: "@slow" }, async ({ page }) => {
  test.setTimeout(300_000);
  const errs = await boot(page);
  await openOnPerform(page, "Glass Pad");
  const wander = page.locator('.pf-knob[data-i="7"]');
  const sub = wander.locator(".pf-k-sub");
  await page.evaluate(() => {
    const s = document.querySelector(".pf-status");
    window.__statuses = [s.textContent];
    new MutationObserver(() => window.__statuses.push(s.textContent)).observe(s, { childList: true, characterData: true, subtree: true });
    const w = document.querySelector('.pf-knob[data-i="7"] .pf-k-sub');
    window.__wander = [[performance.now(), w.textContent]];
    new MutationObserver(() => window.__wander.push([performance.now(), w.textContent])).observe(w, { childList: true, characterData: true, subtree: true });
  });

  // Three ticks where ideas, drift and roam begin.
  const ticks = await wander.locator(".pf-k-zone").getAttribute("d");
  expect((ticks.match(/M/g) || []).length).toBe(3);

  // The middle zone is "ideas".
  await wander.focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowUp"); // 0.20
  await expect(sub).toHaveText(/^ideas/);
  await page.keyboard.press("Home");
  await expect(sub).toHaveText("still", { timeout: 5_000 });

  // Drag it into drift. While it is held it is not "paused".
  const b = await wander.boundingBox();
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  const grabbed = await page.evaluate(() => performance.now());
  await page.mouse.down();
  await page.mouse.move(x, y - 99, { steps: 12 }); // +0.55: drift
  expect(await sub.textContent()).toMatch(/^drift/);
  const released = await page.evaluate(() => performance.now());
  await page.mouse.up();
  await page.mouse.move(10, 10);
  // The first move is asked for about 1.5 s after the hand left.
  await page.waitForFunction((t) => window.__pfPosts.some((p) => p.type === "perform_drift" && p.t > t), released, { timeout: 20_000 });
  const firstMove = await page.evaluate((t) => window.__pfPosts.find((p) => p.type === "perform_drift" && p.t > t).t - t, released);
  console.log(`Wander let go in drift → first move asked for after ${(firstMove / 1000).toFixed(2)} s`);
  expect(firstMove).toBeGreaterThan(1_000);
  expect(firstMove).toBeLessThan(3_000);

  // After the move, it counts down to the next one, with its arc.
  await expect(sub).toHaveText(/^(drift · next in \d+ s|staying: nothing better nearby)$/, { timeout: 120_000 });
  await expect(sub).toHaveText(/^drift · next in \d+ s$/, { timeout: 30_000 });
  // The arc starts empty (the wait has barely begun) and fills as the
  // countdown repaints, so it is waited for rather than read the instant the
  // caption appears.
  await expect(wander.locator(".pf-k-count")).toHaveAttribute("d", /^M /, { timeout: 5_000 });

  // Hands on another control: Wander says it is paused, and for how long.
  const bright = page.locator('.pf-knob[data-i="0"]');
  await bright.click();
  await expect(sub).toHaveText(/^paused [1-4] s$/, { timeout: 2_000 });
  await expect(sub).not.toHaveText(/^paused/, { timeout: 8_000 });

  // Frozen.
  await page.locator(".pf-pad", { hasText: "Freeze" }).click();
  await expect(sub).toHaveText("frozen");
  await page.locator(".pf-pad", { hasText: "Freeze" }).click();

  const statuses = await page.evaluate(() => window.__statuses);
  expect(statuses.filter((t) => /wander|paused|drifting|gliding|walking/.test(t)), "the status line keeps to the patch").toEqual([]);
  const said = await page.evaluate(() => window.__wander);
  const whileTurned = said.filter(([t]) => t >= grabbed && t <= released).map(([, w]) => w);
  expect(whileTurned.filter((w) => /paused/.test(w)), "turning Wander is not a touch").toEqual([]);
  expect(said.some(([, w]) => /^drift · (walking…|gliding)/.test(w)), "it said it was moving").toBe(true);
  expect(errs).toEqual([]);
});

// A tap on Wander freezes it (#80 named the pad FREEZE and the state
// *frozen*); its tooltip and HOW THIS WORKS said a tap would "hold" it.
test("Wander's tooltip and HOW THIS WORKS say a tap freezes it", async ({ page }) => {
  const errs = await boot(page);
  await page.locator('.viewtab[data-view="perform"]').click();
  const wander = page.locator('.pf-knob[data-i="7"]');
  await expect(wander).toHaveAttribute("title", /Tap to freeze it\./);
  await expect(wander).not.toHaveAttribute("title", /hold it/);
  await page.locator(".pf-why-btn").click();
  const body = page.locator(".pf-why-body");
  await expect(body).toContainText("Tap Wander to freeze it;");
  await expect(body).not.toContainText("to hold it");
  expect(errs).toEqual([]);
});
