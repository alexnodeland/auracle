// The player first: the engine's one thread answers the player's own requests
// ahead of work nobody asked for, and nothing the player asked for arrives late
// and unasked.
//
// Films of the app caught each of these failing: a warm-start ▶ silent for
// 18 s and then playing in PERFORM after the card had closed; PERFORM opening
// on the patch that had been on the bench beside "opening the patch you
// picked…"; every control reading "measuring…" for 14 s after a Take, with the
// taken patch named "(edited)" and Blend left turned toward an empty B. The
// worker now serves requests in lanes (the player's gestures first, long work
// they asked for next, background work last) and measures PERFORM's controls
// in pieces with the player's requests answered in between (worker.js, "the
// queue: the player first").
//
// Every timing claim here is an *ordering*: a reply that lands before another,
// not a number of seconds, so a slow runner cannot pass a regression or fail
// a fix. The engine worker is reached the way failure_flows.spec.js reaches it:
// by wrapping `Worker` before main.js runs.
const { test, expect } = require("@playwright/test");
const { goLevel, bankTab } = require("./shell");
const budget = require("./perform_budget");

const INIT = `(() => {
  const Orig = window.Worker;
  const workers = (window.__pwWorkers = []);
  const seen = (window.__pwSeen = []);
  // The measurements the page asks for, by req, so a reply can be matched to
  // the request it answers.
  const asked = (window.__pwAsked = []);
  function Wrapped(url, opts) {
    const w = new Orig(url, opts);
    w.__pwUrl = String(url);
    workers.push(w);
    if (/worker\\.js/.test(w.__pwUrl)) {
      const post = w.postMessage.bind(w);
      w.postMessage = (m, ...rest) => {
        if (m && m.type === "perform_wire") asked.push({ req: m.req, at: performance.now() });
        return post(m, ...rest);
      };
    }
    w.addEventListener("message", (e) => {
      const d = e.data;
      if (d && typeof d.type === "string" && d.type !== "log") seen.push({ type: d.type, req: d.req, id: d.id, at: performance.now() });
    });
    return w;
  }
  Wrapped.prototype = Orig.prototype;
  window.Worker = Wrapped;
  window.__pwEngine = () => workers.find((w) => /worker\\.js/.test(w.__pwUrl)) || null;
})();`;

// `shipped: false` blocks the presets' shipped wirings, so a preset is
// measured as a patch never seen before is.
async function boot(page, { skipWarm = true, shipped = true } = {}) {
  if (!shipped) await page.route("**/perform-wirings.json*", (r) => r.abort());
  await page.addInitScript(INIT);
  await page.goto("/");
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 120_000 });
  if (skipWarm) {
    await expect(page.locator("#warmstart")).not.toHaveClass(/\bhidden\b/, { timeout: 30_000 });
    await page.locator("#warm-skip").click();
  }
}

async function openPreset(page, name) {
  await bankTab(page, "presets");
  await page.locator(".bank-item.preset-item", { hasText: name }).first().click();
  await page.waitForFunction((n) => (document.getElementById("rack-subject")?.textContent || "").includes(n), name, { timeout: 90_000 });
}

test("a player's ▶ is answered while PERFORM is still listening to a patch", async ({ page }) => {
  test.setTimeout(240_000);
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await boot(page, { shipped: false });
  await openPreset(page, "Glass Pad");
  await goLevel(page, "perform");
  await expect(page.locator(".pf-name")).toHaveText("Glass Pad", { timeout: 30_000 });
  // A fresh profile has no wiring cached (and the shipped one is blocked):
  // the measurement is thirty-odd renders. Ask for a render of another patch
  // while it runs.
  await page.waitForSelector(".pf-status:has-text('listening to this sound')", { timeout: 30_000 });
  await bankTab(page, "pool");
  const target = await page.evaluate(() =>
    [...document.querySelectorAll("#bank-list .bank-item[data-id]")].map((e) => Number(e.dataset.id)).find((x) => x > 0));
  expect(target, "a pool patch to render").toBeGreaterThan(0);
  // Straight to the worker, as a bank row's ▶ asks: `{type:"render", id}`.
  const measuringAtAsk = await page.evaluate((i) => {
    window.__pwAskedAt = performance.now();
    window.__pwEngine().postMessage({ type: "render", id: i });
    return /listening to this sound/.test(document.querySelector(".pf-status").textContent);
  }, target);
  expect(measuringAtAsk, "the measurement was over before the render was asked for").toBe(true);
  // The render is answered, and before the measurement it was queued behind.
  await expect
    .poll(() => page.evaluate((i) => window.__pwSeen.some((s) => s.type === "render" && s.id === i), target), { timeout: 60_000 })
    .toBe(true);
  const order = await page.evaluate((i) => {
    const r = window.__pwSeen.find((s) => s.type === "render" && s.id === i);
    const w = window.__pwSeen.find((s) => s.type === "perform_wired" && s.at > window.__pwAskedAt);
    return { render: r && r.at, wired: w ? w.at : null };
  }, target);
  expect(order.wired === null || order.render < order.wired, "the render waited for the measurement").toBe(true);
  // …and the measurement still lands, whole.
  await page.waitForSelector(".pf-status:has-text('controls reach')", { timeout: 120_000 });
  expect(errs).toEqual([]);
});

test("a warm-start ▶ that was superseded, or whose card closed, never plays", async ({ page }) => {
  test.setTimeout(240_000);
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await boot(page, { skipWarm: false });
  await expect(page.locator("#warmstart")).not.toHaveClass(/\bhidden\b/, { timeout: 30_000 });
  const plays = page.locator(".warm-cell .wi-play");
  // ▶ on one card, then at once on another: the first is taken back and says
  // so; only the second may play.
  await plays.nth(0).click();
  await expect(plays.nth(0)).toHaveClass(/\bloading\b/);
  await plays.nth(1).click();
  await expect(plays.nth(0)).not.toHaveClass(/\bloading\b/);
  await expect(plays.nth(1)).toHaveClass(/\bloading\b|\bplaying\b/);
  await expect(plays.nth(1)).toHaveClass(/\bplaying\b/, { timeout: 90_000 });
  const firstPlayed = await plays.nth(0).evaluate((b) => b.classList.contains("playing"));
  expect(firstPlayed, "the superseded ▶ played").toBe(false);
  // Stop it — unless the phrase has already ended, when a press would start it
  // again.
  if (await plays.nth(1).evaluate((b) => b.classList.contains("playing"))) await plays.nth(1).click();
  await expect(page.locator(".wi-play.playing")).toHaveCount(0, { timeout: 15_000 });
  // ▶ on a third card, then close the card before it can sound.
  const loadsBefore = await page.evaluate(() => window.__pwSeen.filter((s) => s.type === "preset_loaded").length);
  await plays.nth(2).click();
  await page.locator("#warm-skip").click();
  await expect
    .poll(() => page.evaluate(() => window.__pwSeen.filter((s) => s.type === "preset_loaded").length), { timeout: 90_000 })
    .toBeGreaterThan(loadsBefore);
  // Long enough for its render to have arrived and played, had it been going to.
  await page.waitForTimeout(4_000);
  await expect(page.locator(".wi-play.playing")).toHaveCount(0);
  const sounding = await page.evaluate(() => [...document.querySelectorAll(".wi-play")].some((b) => b.classList.contains("playing") || b.classList.contains("loading")));
  expect(sounding, "a closed card's ▶ played late").toBe(false);
  expect(errs).toEqual([]);
});

test("teach it opens PERFORM on the first pick, named at once", async ({ page }) => {
  test.setTimeout(240_000);
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  // The app opens at PERFORM (Plan-008); a player who was last in PATCH comes
  // back there, so the move to PERFORM is the warm start's own.
  await page.addInitScript(() => { try { localStorage.setItem("auracle-view", "patch"); } catch (_) {} });
  await boot(page, { skipWarm: false });
  await expect(page.locator("#warmstart")).not.toHaveClass(/\bhidden\b/, { timeout: 30_000 });
  await expect(page.locator(".rail-stop[data-level='patch']")).toHaveAttribute("aria-current", "location");
  const cards = page.locator(".warm-cell .warm-item");
  for (const i of [2, 5, 8]) await cards.nth(i).click();
  const pick = (await cards.nth(2).locator(".wi-name").textContent()).trim();
  await page.locator("#warm-go").click();
  // The view is PERFORM at once, and it names the pick — as the patch on its
  // way, or as the patch under the keys — never another patch beside
  // "opening the patch you picked…".
  await expect(page.locator(".rail-stop[data-level='perform']")).toHaveAttribute("aria-current", "location", { timeout: 2_000 });
  await expect
    .poll(async () => {
      const name = (await page.locator(".pf-name").textContent()).trim();
      const status = (await page.locator(".pf-status").textContent()).trim();
      return name === pick || status.includes(`opening ${pick}`);
    }, { timeout: 3_000 })
    .toBe(true);
  await expect(page.locator(".pf-status")).not.toContainText("opening the sound you picked");
  await expect(page.locator(".pf-name")).toHaveText(pick, { timeout: 60_000 });
  await expect(page.locator(".pf-status")).toContainText("controls reach", { timeout: 120_000 });
  expect(errs).toEqual([]);
});

test("Take keeps the controls live, names the taken offer, and brings Blend home", async ({ page }) => {
  test.setTimeout(300_000);
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await budget.watch(page);
  await boot(page);
  await openPreset(page, "Glass Pad");
  await goLevel(page, "perform");
  await expect(page.locator(".pf-name")).toHaveText("Glass Pad", { timeout: 30_000 });
  await page.waitForSelector(".pf-status:has-text('controls reach')", { timeout: 120_000 });
  // Two waits on the engine's work, renders whose number and cost depend on
  // the offer dealt, so each is bounded by the budget, not a fixed time: the
  // offer growing, and the taken offer's own measurement. That measurement
  // was 8 to 50 renders over 15 runs, and the more a patch has to render the
  // longer each render takes: with the engine slowed eightfold (`SLOW_ENGINE`
  // in perform_budget.js) it took 14 to 206 s, against offers of 12 to 53 s. A fixed two minutes failed on CI when a
  // heavy offer was dealt (its offer took 30 s there).
  const ENGINE_MS = await budget.offerBudget(page, { waits: 2 });
  const reachBefore = await page.evaluate(() => [0, 1, 2, 3, 4, 5].filter((i) => !document.querySelector(`.pf-knob[data-i="${i}"]`).classList.contains("unwired")).length);
  await page.locator(".pf-pad", { hasText: "Offer" }).click();
  await page.waitForSelector(".pf-offer.ready", { timeout: ENGINE_MS });
  // Blend toward the offer, as a player auditions it: the slider under the
  // two faces, dragged most of the way to B.
  const blend = page.locator(".pf-blend[data-i='6'] input");
  const b = await blend.boundingBox();
  await page.mouse.move(b.x + 2, b.y + b.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(b.x + 2 + (i * (b.width - 4)) / 12, b.y + b.height / 2);
  await page.mouse.up();
  expect(Number(await blend.getAttribute("aria-valuenow"))).toBeGreaterThan(0.3);
  const takenAt = await page.evaluate(() => performance.now());
  await page.locator(".pf-pad", { hasText: "Take" }).click();
  // Blend is home at once: B is empty.
  await expect(blend).toHaveAttribute("aria-valuenow", "0.00");
  // The taken patch is named for what it is.
  await expect(page.locator(".pf-name")).toHaveText("Glass Pad (taken offer)", { timeout: 30_000 });
  // The controls did not all go dark while the offer is re-measured: some
  // control that reached before still reaches, straight after the swap.
  await page.waitForTimeout(300);
  const reachAfter = await page.evaluate(() => [0, 1, 2, 3, 4, 5].filter((i) => !document.querySelector(`.pf-knob[data-i="${i}"]`).classList.contains("unwired")).length);
  expect(reachBefore).toBeGreaterThan(0);
  expect(reachAfter, "every control went dark after Take").toBeGreaterThan(0);
  const allListening = await page.evaluate(() => [...document.querySelectorAll(".pf-knob .pf-k-sub")].slice(0, 6).every((s) => /listening/.test(s.textContent)));
  expect(allListening, "every control read listening… after Take").toBe(false);
  // …and the taken offer's own measurement lands: first the engine's reply
  // to the measurement the Take asked for (its time is the engine's, so the
  // budget's), then the status saying so straight after. Re-checking left
  // on after that reply is PERFORM's bookkeeping, not the engine's pace.
  const req = await page.evaluate((t) => (window.__pwAsked.find((a) => a.at > t) || {}).req ?? null, takenAt);
  expect(req, "the Take asked for the taken offer's measurement").not.toBeNull();
  await expect
    .poll(() => page.evaluate((r) => window.__pwSeen.some((s) => s.type === "perform_wired" && s.req === r), req), {
      timeout: ENGINE_MS,
      message: "the engine answered the taken offer's measurement",
    })
    .toBe(true);
  const status = page.locator(".pf-status");
  await expect(status, "the measurement landed: the controls say what they reach").toContainText("controls reach", { timeout: 10_000 });
  await expect(status, "the measurement landed: nothing is left re-checking").not.toContainText("re-checking", { timeout: 10_000 });
  expect(errs).toEqual([]);
});

