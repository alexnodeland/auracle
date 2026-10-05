// PERFORM's offer, as motion that shows what the engine does (ADR-012,
// Plan-005 task 5):
//
// - An offer is a short walk from the sound under your hands
//   (`Engine::offer`, through `perform_offer` with that sound's tree), so B
//   grows out of the sound's face (its vessel, as the mock grows it) into its
//   place.
// - Taken, B fills with green and goes into the face: the bench takes its
//   tree, and it is the sound you play.
// - Passed (NEXT, or PASS), B folds back into the face it grew from, where
//   the face stands once the well has reflowed: it is dropped, and the sound
//   you had is the sound you play.
// - The heard rule, unchanged: an offer can be taken heard or not, and only a
//   heard one (a second of PEEK, or of BLEND past half, while a note sounds)
//   is recorded as a pick.
//
// The motion is read where it is made: every `Element.animate` call is
// recorded (by wrapping it before main.js runs), and each moment's keyframes
// are checked against where the sound's face and B are on the page. Reduced
// motion is not tested here; each moment is also B's `data-moment`, which is
// what the assertions on state read.
//
// Each wait for B to be ready is a wait on the engine growing an offer: about
// twenty renders, and after a Take it waits first for the taken patch's own
// measurement, which is `soon` work asked before it. On a CI runner the second
// test's offer after a Take did not grow within the 150 s it had, so each such
// wait is `app.offerBudget` (perform_budget.js): CI's floor, or more when a
// step measured on the runner says so.
//
// What the page asks the engine to record (a pick from an offer,
// `perform_record`) and each sound kept as new (`committed`) are read through
// the fixture's tap.
const { test, expect, PERFORM_SEED } = require("./fixtures");

const INIT = `(() => {
  const animate = Element.prototype.animate;
  const seen = (window.__anims = []);
  Element.prototype.animate = function (frames, opts) {
    const cls = String(this.className || "");
    if (/pf-(offer|ghost)/.test(cls)) {
      const r = this.getBoundingClientRect();
      seen.push({ cls, moment: this.dataset ? this.dataset.moment || "" : "", frames: JSON.parse(JSON.stringify(frames)), at: { left: r.left, top: r.top, width: r.width, height: r.height } });
    }
    return animate.call(this, frames, opts);
  };
})();`;

async function boot(page, app) {
  await page.addInitScript(INIT);
  await app.boot({ seed: PERFORM_SEED, random: PERFORM_SEED });
}

/** `name` on PERFORM, its controls reached; then how long an offer may take
 *  to grow here, the test's timeout grown for `waits` such waits. */
async function openOnPerform(app, name, waits) {
  await app.openOnPerform(name);
  return app.offerBudget({ waits });
}

// The picks the page has asked the engine to record.
const records = async (app) => (await app.sent({ type: "perform_record" })).map((m) => ({ took: !!m.took, asOf: m.asOf, at: m._at }));

// PEEK held long enough for B to be heard: a second of it while a note sounds.
const HEARD_MS = 1_800;

async function grow(page, ms) {
  await page.locator(".pf-pad", { hasText: /^(Offer|Next)$/ }).click();
  await expect(page.locator(".pf-offer")).toHaveClass(/\bready\b/, { timeout: ms });
}

async function peek(page, ms = HEARD_MS) {
  const b = await page.locator(".pf-pad", { hasText: "Peek" }).boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
  await page.mouse.move(10, 10);
}

// The box a "translate(x, y) scale(sx, sy)" puts `at` in (origin top left).
function boxOf(transform, at) {
  const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+), ([-\d.]+)\)/.exec(transform);
  if (!m) return null;
  const [dx, dy, sx, sy] = m.slice(1).map(Number);
  return { left: at.left + dx, top: at.top + dy, width: at.width * sx, height: at.height * sy };
}
const near = (a, b, px = 2) => ["left", "top", "width", "height"].every((k) => Math.abs(a[k] - b[k]) <= px);
const faceBox = (page) => page.locator(".pf-faces > .pf-face").evaluate((e) => {
  const r = e.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
});
const anims = (page) => page.evaluate(() => window.__anims.slice());

test("an offer grows from the sound in hand, fills when taken, and folds back when passed", { tag: "@slow" }, async ({ page, app }) => {
  await boot(page, app);
  const OFFER_MS = await openOnPerform(app, "Glass Pad", 3);
  await page.keyboard.down("a");

  // Grown: B's first frame is the sound's face, its last is B's own place.
  // The face is read where it stands once B is in the well beside it (the
  // well makes room for B as it grows, a jump, before B grows from it).
  let n0 = (await anims(page)).length;
  await grow(page, OFFER_MS);
  const name0 = await faceBox(page);
  await expect(page.locator(".pf-offer")).toHaveAttribute("data-moment", "grown");
  let grown = (await anims(page)).slice(n0).find((a) => !/ghost/.test(a.cls));
  expect(grown, "B grows").toBeTruthy();
  expect(near(boxOf(grown.frames[0].transform, grown.at), name0), "from the sound's face").toBe(true);
  expect(grown.frames[grown.frames.length - 1].transform).toBe("none");

  // Passed (heard): a copy of B folds back into the face; B empties.
  await peek(page);
  n0 = (await anims(page)).length;
  await page.locator(".pf-pad", { hasText: "Next" }).click();
  await expect(page.locator("#toasts")).toContainText("Passed on B.", { timeout: 10_000 });
  // The copy folds a frame after the press, into the face as it stands once
  // the well has reflowed (NEXT keeps B's room while the next grows).
  const foldOf = (from) => expect.poll(async () => (await anims(page)).slice(from).find((a) => /ghost/.test(a.cls) && a.moment === "folded") || null, { timeout: 5_000 }).not.toBeNull();
  await foldOf(n0);
  const folded = (await anims(page)).slice(n0).find((a) => /ghost/.test(a.cls) && a.moment === "folded");
  expect(folded.frames[0].transform).toBe("none");
  expect(near(boxOf(folded.frames[folded.frames.length - 1].transform, folded.at), await faceBox(page)), "into the sound's face").toBe(true);

  // Passed with PASS (heard): no next offer, so B's room goes and the face
  // stands alone; the copy folds into the face where it stands then.
  await expect(page.locator(".pf-offer")).toHaveClass(/\bready\b/, { timeout: OFFER_MS });
  await peek(page);
  n0 = (await anims(page)).length;
  await page.locator(".pf-pad.pf-pass").click();
  await expect(page.locator("#toasts")).toContainText("Passed on B.", { timeout: 10_000 });
  await foldOf(n0);
  const passed = (await anims(page)).slice(n0).find((a) => /ghost/.test(a.cls) && a.moment === "folded");
  await expect(page.locator(".pf-well")).not.toHaveClass(/\boffered\b/);
  expect(near(boxOf(passed.frames[passed.frames.length - 1].transform, passed.at), await faceBox(page)), "PASS folds into the sound's face where it stands").toBe(true);

  // Taken (heard): a copy of B fills green from its base, then goes into the
  // face, and the name is the offer's.
  await grow(page, OFFER_MS);
  await peek(page);
  n0 = (await anims(page)).length;
  const before = await page.locator(".pf-name").textContent();
  await page.locator(".pf-pad", { hasText: "Take" }).click();
  await expect(page.locator(".pf-offer")).toHaveAttribute("data-moment", "taken");
  // Taken, B leaves the well and the face stands alone again: B goes into
  // the face where it stands then.
  const nameAtTake = await faceBox(page);
  const after = (await anims(page)).slice(n0);
  const fill = after.find((a) => /pf-ghost-fill/.test(a.cls));
  expect(fill, "B fills").toBeTruthy();
  expect(fill.frames.map((f) => f.transform)).toEqual(["scaleY(0)", "scaleY(1)"]);
  const taken = after.find((a) => /ghost/.test(a.cls) && a.moment === "taken");
  expect(near(boxOf(taken.frames[taken.frames.length - 1].transform, taken.at), nameAtTake), "into the sound's face").toBe(true);
  await app.engine((timeout) => expect(page.locator(".pf-name")).not.toHaveText(before, { timeout }), { ms: 60_000 });
  await expect(page.locator(".pf-offer")).not.toHaveClass(/\bready\b/);
  await page.keyboard.up("a");
});

test("an offer taken unheard becomes the sound but records no pick; heard, it records one", { tag: "@slow" }, async ({ page, app }) => {
  await boot(page, app);
  const OFFER_MS = await openOnPerform(app, "Glass Pad", 2);
  const recorded = async () => (await records(app)).length;
  const picks = async () => Number(await page.locator("#duel-count").textContent());
  const p0 = await picks();
  // Unheard (no note sounding, no PEEK): TAKE is there, and takes it.
  await grow(page, OFFER_MS);
  const take = page.locator(".pf-pad", { hasText: "Take" });
  await expect(take).toBeEnabled();
  const name = await page.locator(".pf-name").textContent();
  await take.click();
  await app.engine((timeout) => expect(page.locator(".pf-name")).not.toHaveText(name, { timeout }), { ms: 60_000 });
  await expect(page.locator(".pf-offer")).not.toHaveClass(/\bready\b/);
  // Past a take's eight-second window: nothing was sent to be recorded
  // (`perform_record`, the engine's `record_tree_duel`), and no pick counted.
  await app.quiet(10_000);
  expect(await recorded(), "an unheard take records no pick").toBe(0);
  expect(await picks()).toBe(p0);
  // Heard (a second of PEEK with a note sounding): the same TAKE records one.
  await page.keyboard.down("a");
  await grow(page, OFFER_MS);
  await peek(page);
  await take.click();
  await expect.poll(recorded, { timeout: 30_000 }).toBe(1);
  await app.engine((timeout) => expect.poll(picks, { timeout }).toBe(p0 + 1), { ms: 30_000 });
  await page.keyboard.up("a");
});

// A Take waits out its eight seconds before it is recorded (DON'T COUNT IT
// can drop it). Taken onto the bench and kept as new inside that window, the
// sound is on the answer's B side, but it was not in the pick when the pick
// was made, so the answer must not end its protection (a sound kept as new is
// safe until it has been in a pick). The page sends the newest id it had seen
// when the answer was given (`asOf`), and the engine judges only sounds at or
// below it (`Engine::record_tree_duel_as_of`, proven natively by
// `a_take_held_over_a_keep_does_not_judge_the_kept_sound`).
test("a sound kept as new while a Take waits out its window is not judged by that Take", { tag: "@slow" }, async ({ page, app }) => {
  await boot(page, app);
  const OFFER_MS = await openOnPerform(app, "Glass Pad", 1);
  const name = await page.locator(".pf-name").textContent();
  await page.keyboard.down("a");
  await grow(page, OFFER_MS);
  await peek(page);
  await page.locator(".pf-pad", { hasText: "Take" }).click();
  await page.keyboard.up("a");
  await app.engine((timeout) => expect(page.locator(".pf-name")).not.toHaveText(name, { timeout }), { ms: 60_000 });
  // Inside the window: PATCH, KEEP AS NEW, and the comparison skipped.
  await app.level("patch");
  await app.engine((timeout) => expect(page.locator("#rack-commit")).toBeEnabled({ timeout }), { ms: 30_000 });
  await page.locator("#rack-commit").click();
  const skip = page.locator("#cd-skip");
  await Promise.race([
    skip.waitFor({ state: "visible", timeout: 20_000 }).then(() => skip.click()).catch(() => {}),
    expect.poll(async () => (await app.replies("committed")).length, { timeout: 20_000 }).toBeGreaterThan(0).catch(() => {}),
  ]);
  const kept = await app.reply("committed", { timeout: 30_000 });
  expect(kept.id, "the taken sound was not kept as new").toBeGreaterThan(0);
  await expect.poll(async () => (await records(app)).length, { timeout: 30_000 }).toBe(1);
  const [rec] = await records(app);
  console.log(`kept ${kept.id} at ${Math.round(kept._at)}; Take recorded at ${Math.round(rec.at)} as of ${rec.asOf}`);
  expect(rec.took).toBe(true);
  expect(rec.at, "the Take was recorded before the keep: no race to test").toBeGreaterThan(kept._at);
  expect(typeof rec.asOf, "the answer carries no bound").toBe("number");
  expect(rec.asOf, "the answer's bound takes in the sound kept after it").toBeLessThan(kept.id);
});
