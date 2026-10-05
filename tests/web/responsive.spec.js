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
// a fix. The engine worker is reached through the fixture's tap: what was
// asked and answered, and when, in the page's clock.
const { test, expect, PERFORM_SEED, bankTab } = require("./fixtures");

// The controls as the player first sees them after a Take: a beat after the
// swap, inside the taken offer's own measurement (seconds of renders).
const AFTER_SWAP_MS = 300;

// `shipped: false` blocks the presets' shipped wirings, so a preset is
// measured as a patch never seen before is. `warmed: false` shows the warm
// start.
async function boot(page, app, { warmed = true, shipped = true, slowEngine = 0 } = {}) {
  if (!shipped) await page.route("**/perform-wirings.json*", (r) => r.abort());
  await app.boot({ seed: PERFORM_SEED, random: PERFORM_SEED, warmed, slowEngine });
}

async function openPreset(page, app, name) {
  await bankTab(page, "presets");
  await page.locator(".bank-item.preset-item", { hasText: name }).first().click();
  await app.engine((timeout) => expect(page.locator("#rack-subject")).toContainText(name, { timeout }), { ms: 90_000 });
}

/** The measurement the page asked for first after `after` (a Take's). */
async function wireAfter(app, after) {
  const [w] = await app.sent({ type: "perform_wire" }, { after });
  return w ? w.req : null;
}

test("a player's ▶ is answered while PERFORM is still listening to a patch", async ({ page, app }) => {
  await boot(page, app, { shipped: false });
  await openPreset(page, app, "Glass Pad");
  await app.level("perform");
  await app.engine((timeout) => expect(page.locator(".pf-name")).toHaveText("Glass Pad", { timeout }), { ms: 30_000 });
  // A fresh profile has no wiring cached (and the shipped one is blocked):
  // the measurement is thirty-odd renders. Ask for a render of another patch
  // while it runs.
  await app.engine((timeout) => expect(page.locator(".pf-status")).toContainText("listening to this sound", { timeout }), { ms: 30_000 });
  await bankTab(page, "pool");
  const target = await page.evaluate(() =>
    [...document.querySelectorAll("#bank-list .bank-item[data-id]")].map((e) => Number(e.dataset.id)).find((x) => x > 0));
  expect(target, "a pool patch to render").toBeGreaterThan(0);
  // Straight to the worker, as a bank row's ▶ asks: `{type:"render", id}`,
  // in the same breath as the status is read.
  const { askedAt, measuringAtAsk } = await page.evaluate((i) => {
    const askedAt = performance.now();
    window.__tap.engine.postMessage({ type: "render", id: i });
    return { askedAt, measuringAtAsk: /listening to this sound/.test(document.querySelector(".pf-status").textContent) };
  }, target);
  expect(measuringAtAsk, "the measurement was over before the render was asked for").toBe(true);
  // The render is answered, and before the measurement it was queued behind.
  const render = await app.reply("render", { where: { id: target }, after: askedAt, timeout: 60_000 });
  const [wired] = await app.replies("perform_wired", { after: askedAt });
  expect(!wired || render._at < wired._at, "the render waited for the measurement").toBe(true);
  // …and the measurement still lands, whole.
  await app.reached();
});

test("a warm-start ▶ that was superseded, or whose card closed, never plays", async ({ page, app }) => {
  await boot(page, app, { warmed: false });
  await app.engine((timeout) => expect(page.locator("#warmstart")).not.toHaveClass(/\bhidden\b/, { timeout }), { ms: 30_000 });
  const plays = page.locator(".warm-cell .wi-play");
  // ▶ on one card, then at once on another: the first is taken back and says
  // so; only the second may play.
  await plays.nth(0).click();
  await expect(plays.nth(0)).toHaveClass(/\bloading\b/);
  await plays.nth(1).click();
  await expect(plays.nth(0)).not.toHaveClass(/\bloading\b/);
  await expect(plays.nth(1)).toHaveClass(/\bloading\b|\bplaying\b/);
  await app.engine((timeout) => expect(plays.nth(1)).toHaveClass(/\bplaying\b/, { timeout }), { ms: 90_000 });
  const firstPlayed = await plays.nth(0).evaluate((b) => b.classList.contains("playing"));
  expect(firstPlayed, "the superseded ▶ played").toBe(false);
  // Stop it — unless the phrase has already ended, when a press would start it
  // again.
  if (await plays.nth(1).evaluate((b) => b.classList.contains("playing"))) await plays.nth(1).click();
  await expect(page.locator(".wi-play.playing")).toHaveCount(0, { timeout: 15_000 });
  // ▶ on a third card, then close the card before it can sound.
  const asked = await app.now();
  await plays.nth(2).click();
  await page.locator("#warm-skip").click();
  await app.reply("preset_loaded", { after: asked, timeout: 90_000 });
  // Watched long enough for its render to have arrived and played, had it
  // been going to.
  await app.quiet(4_000);
  await expect(page.locator(".wi-play.playing")).toHaveCount(0);
  const sounding = await page.evaluate(() => [...document.querySelectorAll(".wi-play")].some((b) => b.classList.contains("playing") || b.classList.contains("loading")));
  expect(sounding, "a closed card's ▶ played late").toBe(false);
});

test("teach it opens PERFORM on the first pick, named at once", async ({ page, app }) => {
  // The app opens at PERFORM (Plan-008); a player who was last in PATCH comes
  // back there, so the move to PERFORM is the warm start's own.
  await page.addInitScript(() => { try { localStorage.setItem("auracle-view", "patch"); } catch (_) {} });
  await boot(page, app, { warmed: false });
  await app.engine((timeout) => expect(page.locator("#warmstart")).not.toHaveClass(/\bhidden\b/, { timeout }), { ms: 30_000 });
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
  await app.engine((timeout) => expect(page.locator(".pf-name")).toHaveText(pick, { timeout }), { ms: 60_000 });
  await app.reached();
});

test("Take keeps the controls live, names the taken offer, and brings Blend home", { tag: "@slow" }, async ({ page, app }) => {
  await boot(page, app);
  await app.openOnPerform("Glass Pad");
  // Two waits on the engine's work, renders whose number and cost depend on
  // the offer dealt, so each is bounded by the budget, not a fixed time: the
  // offer growing, and the taken offer's own measurement. That measurement
  // was 8 to 50 renders over 15 runs, and the more a patch has to render the
  // longer each render takes: with the engine slowed eightfold (`SLOW_ENGINE`
  // in perform_budget.js) it took 14 to 206 s, against offers of 12 to 53 s. A fixed two minutes failed on CI when a
  // heavy offer was dealt (its offer took 30 s there). The measurement's
  // reply is waited for with `app.reply`, which adds its own time.
  const OFFER_MS = await app.offerBudget({ waits: 1 });
  const reachBefore = await page.evaluate(() => [0, 1, 2, 3, 4, 5].filter((i) => !document.querySelector(`.pf-knob[data-i="${i}"]`).classList.contains("unwired")).length);
  await page.locator(".pf-pad", { hasText: "Offer" }).click();
  await page.waitForSelector(".pf-offer.ready", { timeout: OFFER_MS });
  // Blend toward the offer, as a player auditions it: the slider under the
  // two faces, dragged most of the way to B.
  const blend = page.locator(".pf-blend[data-i='6'] input");
  const b = await blend.boundingBox();
  await page.mouse.move(b.x + 2, b.y + b.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(b.x + 2 + (i * (b.width - 4)) / 12, b.y + b.height / 2);
  await page.mouse.up();
  expect(Number(await blend.getAttribute("aria-valuenow"))).toBeGreaterThan(0.3);
  const takenAt = await app.now();
  await page.locator(".pf-pad", { hasText: "Take" }).click();
  // Blend is home at once: B is empty.
  await expect(blend).toHaveAttribute("aria-valuenow", "0.00");
  // The taken patch is named for what it is.
  await app.engine((timeout) => expect(page.locator(".pf-name")).toHaveText("Glass Pad (taken offer)", { timeout }), { ms: 30_000 });
  // The controls did not all go dark while the offer is re-measured: some
  // control that reached before still reaches, straight after the swap.
  await page.waitForTimeout(AFTER_SWAP_MS);
  const reachAfter = await page.evaluate(() => [0, 1, 2, 3, 4, 5].filter((i) => !document.querySelector(`.pf-knob[data-i="${i}"]`).classList.contains("unwired")).length);
  expect(reachBefore).toBeGreaterThan(0);
  expect(reachAfter, "every control went dark after Take").toBeGreaterThan(0);
  const allListening = await page.evaluate(() => [...document.querySelectorAll(".pf-knob .pf-k-sub")].slice(0, 6).every((s) => /listening/.test(s.textContent)));
  expect(allListening, "every control read listening… after Take").toBe(false);
  // …and the taken offer's own measurement lands: first the engine's reply
  // to the measurement the Take asked for (its time is the engine's, so the
  // budget's), then the status saying so straight after. Re-checking left
  // on after that reply is PERFORM's bookkeeping, not the engine's pace.
  const req = await wireAfter(app, takenAt);
  expect(req, "the Take asked for the taken offer's measurement").not.toBeNull();
  await app.reply("perform_wired", { where: { req }, timeout: OFFER_MS });
  const status = page.locator(".pf-status");
  await expect(status, "the measurement landed: the controls say what they reach").toContainText("controls reach", { timeout: 10_000 });
  await expect(status, "the measurement landed: nothing is left re-checking").not.toContainText("re-checking", { timeout: 10_000 });
});

// A Take's measurement is quiet (the controls play on the wiring carried over
// from the sound before, as they do through a re-check), but the player is
// waiting on it: the controls the taken patch lost read listening… until it
// lands. A look at PATCH drops PERFORM's measurements into the engine's
// background lane (`hide`), and coming back must give this one back to the
// player (`show`). It used to stay there, so it gave way to anything that
// arrived in `later` and started only when nothing else there was waiting:
// here a drift of the same patch, posted the way Wander posts one, landed
// before it.
test("a Take's measurement is the player's again when PERFORM comes back into sight", { tag: "@slow" }, async ({ page, app }) => {
  // About 62 to 202 s on CI: the engine slowed fourfold, and the step
  // `app.offerBudget` measures on it is not an engine wait the fixture credits.
  test.setTimeout(400_000);
  // The engine slowed fourfold, so the measurement is still running when
  // PERFORM is back (AURACLE_CPU_THROTTLE takes over when it is larger).
  await boot(page, app, { slowEngine: 4 });
  await app.openOnPerform("Glass Pad");
  // The offer growing waits on the budget; the measurement's reply is an
  // `app.reply`, which adds its own time.
  const OFFER_MS = await app.offerBudget({ waits: 1 });
  await page.locator(".pf-pad", { hasText: "Offer" }).click();
  await page.waitForSelector(".pf-offer.ready", { timeout: OFFER_MS });
  const takenAt = await app.now();
  await page.locator(".pf-pad", { hasText: "Take" }).click();
  await app.engine((timeout) => expect(page.locator(".pf-name")).toHaveText("Glass Pad (taken offer)", { timeout }), { ms: 30_000 });
  const req = await wireAfter(app, takenAt);
  expect(req, "the Take asked for the taken offer's measurement").not.toBeNull();
  // To PATCH and back while it runs.
  await app.level("patch");
  await app.level("perform");
  // Background work asked for after PERFORM is back: a drift of the taken
  // patch (the tree the Take's measurement was asked about), in `later`,
  // posted only if the measurement is still out (read in the same breath).
  const DRIFT = 9_100_001;
  const posted = await page.evaluate(
    ([r, id]) => {
      if (window.__tap.replies.some((x) => x.type === "perform_wired" && !x.injected && x.d.req === r)) return false;
      window.__tap.engine.postMessage({ type: "perform_drift", req: id, tree: window.__pbTree, overrides: [], locks: [], steps: 12, sigma: 0.05 });
      return true;
    },
    [req, DRIFT],
  );
  expect(posted, "the Take's measurement was over before PERFORM came back").toBe(true);
  const wired = await app.reply("perform_wired", { where: { req }, timeout: OFFER_MS });
  const [drifted] = await app.replies("perform_drifted", { where: { req: DRIFT } });
  expect(!drifted || wired._at < drifted._at, "the drift, asked for after it in the background, landed first").toBe(true);
  await expect(page.locator(".pf-status")).not.toContainText("re-checking", { timeout: 10_000 });
});
