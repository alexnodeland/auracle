// PERFORM under the model view (hold ⌥, or MODEL): each control carries which
// way your taste leans along it at the sound in hand (#140, Plan-008 §6). The
// engine answers `perform_lean` (`Engine::lean`: the posterior slope of the
// utility along the control's direction, through the lens that claims the
// sound), and the page draws it on the dial: an amber arc from 12 o'clock
// toward the end it leans to, its interval behind it, and the model's words
// in place of the caption, *it leans brighter*. A lean whose interval crosses
// zero is a guess: its arc dashed, its words ending in "?". Before the first
// fit the engine has no lean, and nothing is drawn. It is asked when the view
// comes up over PERFORM and again when the posterior moves (a pick's
// reweighting, a taste file opened) or the sound in hand changes (a drift's
// glide landing, PATCH's knob write followed, another audition clip for a
// sound that listens), never per frame, and nothing of it shows at rest.
//
// What each lean is (the claiming lens, the weights) is the engine's, pinned
// in auracle-taste and auracle-session; which end a lean names and how a
// guess is marked are words.js's and taste-geom.js's, unit-tested. This holds
// the wiring: the gesture asks, the reply is drawn on the control it names,
// and a guess looks like one.
const fs = require("fs");
const path = require("path");
const { test, expect, PERFORM_SEED } = require("./fixtures");
const { modelView, bankTab } = require("./shell");
const { STUB } = require("./audio_in_stub.js");

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
  await expect(bright.locator(".pf-k-leanw")).toHaveText("it leans brighter");
  await expect(bright.locator(".pf-k-leanw")).toBeVisible();
  await expect(bright.locator(".pf-k-sub")).toBeHidden();
  await expect(bright.locator(".pf-k-lean-bar")).toHaveCSS("stroke-dasharray", "none");
  await expect(bright).toHaveAttribute("aria-description", "it leans brighter");
  const dot = (k) => knob(page, k).locator(".pf-k-lean-at").evaluate((c) => Number(c.getAttribute("cx")));
  expect(await dot(0), "toward bright, the dial's right").toBeGreaterThan(0);
  // Body leans down, settled: counter-clockwise, toward thin.
  await expect(knob(page, 3).locator(".pf-k-leanw")).toHaveText("it leans thinner");
  expect(await dot(3), "toward thin, the dial's left").toBeLessThan(0);
  // Snap could go either way: a guess, dashed and said with a "?".
  const snap = knob(page, 1);
  await expect(snap).toHaveClass(/\blean-guess\b/);
  await expect(snap.locator(".pf-k-leanw")).toHaveText("it leans softer?");
  await expect(snap.locator(".pf-k-lean-bar")).not.toHaveCSS("stroke-dasharray", "none");
  // The engine's own leans (Motion, Grit, Space), each drawn as what it is.
  const own = reply.lean.filter((x) => ![0, 1, 3].includes(x.index));
  expect(own.map((l) => l.index)).toEqual([2, 4, 5]);
  for (const l of own) {
    const k = knob(page, l.index);
    // The palette's comparative for each end (words.js `aim`), read as the page has it.
    const [lower, higher] = await page.evaluate(async (i) => (await import("/words.js")).PALETTE[i].aim, l.index);
    await expect(k).toHaveClass(/\bleaning\b/);
    await expect(k.locator(".pf-k-leanw")).toHaveText(`it leans ${l.mean >= 0 ? higher : lower}${crosses(l) ? "?" : ""}`);
    await expect.poll(() => k.evaluate((e) => e.classList.contains("lean-guess")), { message: `${l.name} ${l.mean} ± ${l.std}` }).toBe(crosses(l));
  }

  // Up and still: nothing more is asked of the engine.
  const asked = await app.sentCount("perform_lean");
  await app.quiet();
  expect(await app.sentCount("perform_lean"), "the lean was asked again with nothing changed").toBe(asked);

  // A pick moves the posterior (a rating reweights it): asked again, and the
  // new answer drawn. Bright is pinned the other way from here on, so its
  // words change only once the new reply is on the dial.
  await app.amend({ type: "perform_leaned" }, { "lean.0.mean": -0.6 });
  await bankTab(page, "pool");
  const t1 = await app.now();
  await page.locator("#bank-list").focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("4");
  await app.reply("status", { where: (r) => !!r.ratings, after: t1, timeout: 30_000 });
  const again = await leanAfter(app, t1);
  expect(again.reply.lean.map((l) => l.index)).toEqual(SIX);
  await expect(bright.locator(".pf-k-leanw")).toHaveText("it leans darker");
  expect(await dot(0), "toward dark, the dial's left").toBeLessThan(0);

  // At rest, none of it: the arcs and words go, the captions come back.
  await modelView(page, false);
  await expect(bright.locator(".pf-k-lean")).toBeHidden();
  await expect(bright.locator(".pf-k-leanw")).toBeHidden();
  await expect(bright.locator(".pf-k-sub")).toBeVisible();
  await expect(bright).not.toHaveAttribute("aria-description");
});

test("a taste file opened over PERFORM takes the leans away with the posterior it replaces", async ({ page, app }) => {
  await app.boot({ seed: PERFORM_SEED, random: PERFORM_SEED, warmed: false });
  await app.warmStart();
  await app.openOnPerform("Glass Pad", { reach: false });
  await modelView(page, true);
  await app.reply("perform_leaned", { where: (r) => Array.isArray(r.lean) });
  await expect(page.locator(".pf-knob.leaning")).toHaveCount(6);

  // A file with nothing taught in it: the engine's posterior goes with the
  // profile it replaces (`Engine::import_profile`), and no refit follows.
  const t0 = await app.now();
  await page.locator("#import-input").setInputFiles({
    name: "nothing-taught.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ log: { observations: [] }, standardizer: null })),
  });
  await page.locator("#alarm").getByRole("button", { name: "replace it" }).click();
  const imported = await app.reply("imported", { after: t0 });
  expect(imported.ok).toBe(true);
  expect(imported.status.observations).toBe(0);
  const { reply } = await leanAfter(app, t0);
  expect(reply.lean, "the engine has no lean once the file has replaced the posterior").toBeNull();
  await expect(page.locator(".pf-knob.leaning")).toHaveCount(0);
  const bright = knob(page, 0);
  await expect(bright.locator(".pf-k-leanw")).toBeHidden();
  await expect(bright).not.toHaveAttribute("aria-description");

  // Down and up again: nothing comes back, and nothing more is asked.
  const asked = await app.sentCount("perform_lean");
  await modelView(page, false);
  await modelView(page, true);
  await app.quiet();
  await expect(page.locator(".pf-knob.leaning")).toHaveCount(0);
  expect(await app.sentCount("perform_lean"), "the lean was asked again with nothing changed").toBe(asked);
});

test("a new audition clip asks again for the lean of a sound in hand that listens", async ({ page, app }, info) => {
  // The microphone, stubbed as granted (audio_in_stub.js): its tone is what
  // the first listen captures as the session's audition clip.
  await page.addInitScript(`try { sessionStorage.setItem("__pwMicGranted", "1"); } catch (_) {}`);
  await page.addInitScript(STUB);
  await app.boot({ seed: PERFORM_SEED, random: PERFORM_SEED, warmed: false });
  await app.warmStart();
  // The engine's word on the capture waits until the lean under the
  // reference clip is drawn.
  await app.hold({ type: "audition_clip" });
  // A sound that listens: a saw beside AUDIO IN.
  const amp = { attack: 0.01, decay: 0.3, sustain: 0.95, release: 0.05 };
  const saw = { Vco: { wave: "Saw", octave: 0, detune: 0.5, mod_depth: 0, modulation: "None" } };
  const ain = { AudioIn: { input: 0, gain: 24 / 36, channel: "Both" } };
  const data = { name: "One Ear", tree: { amp, root: { Mix: { balance: 0.5, a: saw, b: ain } } } };
  fs.mkdirSync(info.outputDir, { recursive: true });
  const file = path.join(info.outputDir, "One-Ear.json");
  fs.writeFileSync(file, JSON.stringify(data));
  await page.locator("#patch-import-input").setInputFiles(file);
  await app.engine((timeout) => expect(page.locator("#rack-subject")).toContainText("One Ear", { timeout }), { ms: 60_000 });
  await app.level("perform");
  await app.engine((timeout) => expect(page.locator(".pf-name")).toHaveText("One Ear", { timeout }), { ms: 30_000 });
  const t0 = await app.now();
  await modelView(page, true);
  const first = await leanAfter(app, t0);
  expect(first.reply.lean.map((l) => l.index)).toEqual(SIX);
  await expect(page.locator(".pf-knob.leaning")).toHaveCount(6);

  // The capture has gone to the engine, which measured this sound through
  // it: once main hears so, the same sound's lean is asked again.
  await app.engine((timeout) => expect.poll(async () => (await app.held()).filter((h) => h.type === "audition_clip").length, { timeout }).toBe(1), { ms: 60_000 });
  const t1 = await app.now();
  await app.release();
  const again = await leanAfter(app, t1);
  expect(again.ask.tree, "the sound in hand, asked again").toBe(first.ask.tree);
  expect(again.reply.lean.map((l) => l.index)).toEqual(SIX);
  await expect(page.locator(".pf-knob.leaning")).toHaveCount(6);
});

test("the sound in hand changing under the view asks its lean again: a drift's glide landing, and PATCH's knob write followed", async ({ page, app }) => {
  await app.boot({ seed: PERFORM_SEED, random: PERFORM_SEED, warmed: false });
  await app.warmStart();
  await app.openOnPerform("Glass Pad", { reach: false });
  await modelView(page, true);
  await app.reply("perform_leaned", { where: (r) => Array.isArray(r.lean) });

  // Wander into drift, its walk answered by the spec: the tree it lands on
  // is the sound in hand once the glide is over.
  await app.stall({ type: "perform_drift" });
  const wander = page.locator('.pf-knob[data-i="7"]');
  await wander.focus();
  for (let i = 0; i < 9; i++) await page.keyboard.press("ArrowUp"); // 0.45: drift
  await expect(wander.locator(".pf-k-sub")).toHaveText(/^drift/);
  const walk = await app.stalled();
  const tree = JSON.parse(walk.tree);
  tree.amp.release = (tree.amp.release + 0.37) % 1;
  const landed = JSON.stringify(tree);
  const t0 = await app.now();
  await app.inject({ type: "perform_drifted", req: walk.req, re: walk.rid, drift: { tree, knobs: [], taste: true } });
  // Asked once the glide is over (seconds long), of the tree it landed on.
  await app.engine((timeout) => expect.poll(async () => (await app.sent({ type: "perform_lean" }, { after: t0 })).length, { timeout }).toBe(1), { ms: 30_000 });
  const [afterGlide] = await app.sent({ type: "perform_lean" }, { after: t0 });
  expect(afterGlide.tree, "the tree the drift landed on").toBe(landed);
  // Still again, so no other walk starts.
  await wander.focus();
  await page.keyboard.press("Home");
  await expect(wander.locator(".pf-k-sub")).toHaveText("still");

  // A knob turned in PATCH whose write lands after PERFORM is back in sight:
  // PERFORM follows the tree as edited, and asks its lean.
  await app.level("patch");
  const rackKnob = page.locator("#rack-svg g[data-addr]:has(> .knob-hit)").first();
  await app.engine((timeout) => expect(rackKnob).toBeAttached({ timeout }), { ms: 30_000 });
  await app.hold({ type: "bench" });
  await rackKnob.focus();
  await page.keyboard.press("ArrowUp");
  await app.engine((timeout) => expect.poll(async () => (await app.held()).filter((h) => h.type === "bench").length, { timeout }).toBe(1), { ms: 30_000 });
  await app.level("perform");
  const t1 = await app.now();
  await app.release();
  const { ask } = await leanAfter(app, t1);
  const [bench] = await app.replies("bench", { after: t1 });
  expect(ask.tree, "the tree as edited in PATCH").toBe(bench.treeJson);
  expect(ask.tree).not.toBe(landed);
});
