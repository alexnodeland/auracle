// PERFORM under the model view (hold ⌥, or MODEL): each control carries which
// way your taste leans along it at the sound in hand (#140, Plan-008 §6). The
// engine answers `perform_lean` (`Engine::lean`: the posterior slope of the
// utility along the control's direction, through the lens that claims the
// sound), and the page draws it on the dial: an amber arc from 12 o'clock
// toward the end it leans to, its interval behind it, and the model's words
// in place of the caption, *it leans bright*. A lean whose interval crosses
// zero is a guess: its arc dashed, its words ending in "?". Before the first
// fit the engine has no lean, and nothing is drawn. It is asked when the view
// comes up over PERFORM and again when the posterior moves (a pick's
// reweighting), never per frame, and nothing of it shows at rest.
//
// What each lean is (the claiming lens, the weights) is the engine's, pinned
// in auracle-taste and auracle-session; which end a lean names and how a
// guess is marked are words.js's and taste-geom.js's, unit-tested. This holds
// the wiring: the gesture asks, the reply is drawn on the control it names,
// and a guess looks like one.
const { test, expect, PERFORM_SEED } = require("./fixtures");
const { modelView, bankTab } = require("./shell");

const SIX = [0, 1, 2, 3, 4, 5];
const knob = (page, k) => page.locator(`.pf-knob[data-index="${k}"]`);
const crosses = (l) => l.mean - l.std < 0 && l.mean + l.std > 0;

/** The request for the lean sent after `t0`, once it has been, and its reply. */
async function leanAfter(app, t0) {
  await app.engine((timeout) => expect.poll(async () => (await app.sent({ type: "perform_lean" }, { after: t0 })).length, { timeout }).toBe(1), { ms: 30_000 });
  const [ask] = await app.sent({ type: "perform_lean" }, { after: t0 });
  return { ask, reply: await app.replyTo(ask, { timeout: 30_000 }) };
}

test("before the first fit, the model view over PERFORM asks for each control's lean and draws none", async ({ page, app }) => {
  await app.boot({ seed: PERFORM_SEED, random: PERFORM_SEED });
  await app.openOnPerform("Glass Pad", { reach: false });
  const t0 = await app.now();
  await modelView(page, true);
  const { ask, reply } = await leanAfter(app, t0);
  // Asked of the sound in hand as it stands, for the panel's controls.
  expect(ask.overrides).toEqual([]);
  expect(ask.controls).toEqual(SIX);
  expect(reply.type).toBe("perform_leaned");
  expect(reply.lean, "the engine has no lean before it has fitted").toBeNull();
  await expect(page.locator(".pf-knob.leaning")).toHaveCount(0);
  await expect(page.locator(".pf-k-lean").first()).toBeHidden();
  // The captions stay where they are.
  await expect(knob(page, 0).locator(".pf-k-leanw")).toBeHidden();
  await expect(knob(page, 0).locator(".pf-k-line")).toBeVisible();
});

test("under the model view each of PERFORM's controls carries its lean, a guess drawn as one, asked again when a pick moves the posterior, and gone at rest", async ({ page, app }) => {
  test.setTimeout(150_000);
  await app.boot({ seed: PERFORM_SEED, random: PERFORM_SEED, warmed: false });
  await app.warmStart();
  await app.openOnPerform("Glass Pad", { reach: false });
  // Three leans the spec decides, so a guess and a settled lean are both on
  // screen whatever the fit made of the rest: Bright up and sure of it, Snap
  // either way, Body down and sure of it. The others are the engine's own.
  await app.amend({ type: "perform_leaned" }, {
    "lean.0.mean": 0.6, "lean.0.std": 0.1,
    "lean.1.mean": -0.05, "lean.1.std": 0.4,
    "lean.3.mean": -0.5, "lean.3.std": 0.1,
  });
  const t0 = await app.now();
  await modelView(page, true);
  const { ask, reply } = await leanAfter(app, t0);
  expect(ask.controls).toEqual(SIX);
  expect(reply.lean.map((l) => l.index), "one lean per control, named by its palette index").toEqual(SIX);

  // Bright leans up, settled: a solid arc clockwise from 12 o'clock, and the
  // model's words in place of the caption.
  const bright = knob(page, 0);
  await expect(bright).toHaveClass(/\bleaning\b/);
  await expect(bright).not.toHaveClass(/\blean-guess\b/);
  await expect(bright.locator(".pf-k-lean")).toBeVisible();
  await expect(bright.locator(".pf-k-leanw")).toHaveText("it leans bright");
  await expect(bright.locator(".pf-k-leanw")).toBeVisible();
  await expect(bright.locator(".pf-k-sub")).toBeHidden();
  await expect(bright.locator(".pf-k-lean-bar")).toHaveCSS("stroke-dasharray", "none");
  await expect(bright).toHaveAttribute("aria-description", "it leans bright");
  const dot = (k) => knob(page, k).locator(".pf-k-lean-at").evaluate((c) => Number(c.getAttribute("cx")));
  expect(await dot(0), "toward bright, the dial's right").toBeGreaterThan(0);
  // Body leans down, settled: counter-clockwise, toward thin.
  await expect(knob(page, 3).locator(".pf-k-leanw")).toHaveText("it leans thin");
  expect(await dot(3), "toward thin, the dial's left").toBeLessThan(0);
  // Snap could go either way: a guess, dashed and said with a "?".
  const snap = knob(page, 1);
  await expect(snap).toHaveClass(/\blean-guess\b/);
  await expect(snap.locator(".pf-k-leanw")).toHaveText("it leans bloom?");
  await expect(snap.locator(".pf-k-lean-bar")).not.toHaveCSS("stroke-dasharray", "none");
  // The engine's own leans (Motion, Grit, Space), each drawn as what it is.
  const own = reply.lean.filter((x) => ![0, 1, 3].includes(x.index));
  expect(own.map((l) => l.index)).toEqual([2, 4, 5]);
  for (const l of own) {
    const k = knob(page, l.index);
    const [low, high] = (await k.locator(".pf-k-ends").textContent()).split(" · ");
    await expect(k).toHaveClass(/\bleaning\b/);
    await expect(k.locator(".pf-k-leanw")).toHaveText(`it leans ${l.mean >= 0 ? high : low}${crosses(l) ? "?" : ""}`);
    await expect.poll(() => k.evaluate((e) => e.classList.contains("lean-guess")), { message: `${l.name} ${l.mean} ± ${l.std}` }).toBe(crosses(l));
  }

  // Up and still: nothing more is asked of the engine.
  const asked = await app.sentCount("perform_lean");
  await app.quiet();
  expect(await app.sentCount("perform_lean"), "the lean was asked again with nothing changed").toBe(asked);

  // A pick moves the posterior (a rating reweights it): asked again.
  await bankTab(page, "pool");
  const t1 = await app.now();
  await page.locator("#bank-list").focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("4");
  await app.reply("status", { where: (r) => !!r.ratings, after: t1, timeout: 30_000 });
  const again = await leanAfter(app, t1);
  expect(again.reply.lean.map((l) => l.index)).toEqual(SIX);
  await expect(bright.locator(".pf-k-leanw")).toHaveText("it leans bright");

  // At rest, none of it: the arcs and words go, the captions come back.
  await modelView(page, false);
  await expect(bright.locator(".pf-k-lean")).toBeHidden();
  await expect(bright.locator(".pf-k-leanw")).toBeHidden();
  await expect(bright.locator(".pf-k-sub")).toBeVisible();
  await expect(bright).not.toHaveAttribute("aria-description");
});
