// How PATCH's rack moves when what is on it changes (ADR-012: the motion
// shows what the engine did), read mid-motion, frame by frame (#165).
//
// What this claims:
//
// - A sound opened over an unrelated one (the seeded boot's, then First
//   Bass, then Reese: no module of one carried into the next) fades up where
//   it lands. Nothing of the sound before is left on the rack to fade out,
//   and the amp, which every patch has, fades up in its own place with the
//   rest instead of sliding across from where the last sound had it; so the
//   cable into it stays a curve, never routed around the plates the amp
//   would have passed behind.
// - Within one sound the rack still moves: a module inserted before the amp
//   slides the amp from where it was to its new place, and NEW PATCH, which
//   keeps the amp and empties its socket, fades the modules it took out and
//   slides the amp to the empty socket's side. The two ways back to the
//   sound move alike: ⌘Z past NEW PATCH, and BACK TO ‹name›, which opens the
//   sound on the bench again (the one the new patch was started from, whose
//   amp it kept), each slide the amp back as the empty socket fades out.
//
// The frames are the page's own: an observer on the rack (installed before
// boot) samples it as each build lands, in the task that drew it and set its
// motion going, then on every animation frame while anything on the rack is
// still moving, and once more on the first frame on which nothing is. So a
// motion's record starts as its build lands and ends with the rack at rest
// (or with the next build), however late that frame comes; only how many
// frames lie between depends on frame timing, and what is claimed of those is
// claimed of every one.
const { test, expect, goLevel } = require("./fixtures");
const { openPreset, rackAtRest } = require("./patch_page");

/** Installed before boot: `window.__rackFrames`, one entry for each build
 *  that replaced the rack's plates (`built`), one for every animation frame
 *  after it while the rack is moving, and one for the first frame on which
 *  it is not (`rest`): the departing copies on the rack (`.rack-exit`), the
 *  amp's centre in rack units and its opacity, and whether the cable into
 *  the amp is a curve (` C `) or a routed path. Moving is any of: a build
 *  just landed, a departing copy, a plate under a moving transform, an
 *  animation that ends (an arrival's fade). */
function recordRack() {
  const frames = (window.__rackFrames = []);
  let lastAmp = null;
  let looping = false;
  // Whether the last frame recorded was the rack moving: the frame on which
  // it stops is recorded too, even when one late frame ends the slide and
  // the fades together, so a record never stops short of the rest.
  let moving = false;
  const centre = (g) => {
    const plate = g.querySelector(".mod-plate");
    const t = getComputedStyle(g).transform;
    const m = new DOMMatrix(t === "none" ? undefined : t);
    const p = m.transformPoint(new DOMPoint(Number(plate.getAttribute("width")) / 2, Number(plate.getAttribute("height")) / 2));
    return { x: p.x, y: p.y };
  };
  const sample = () => {
    const svg = document.getElementById("rack-svg");
    const amp = svg.querySelector('.rack-plates g[data-kind="amp"]');
    if (!amp) return false;
    const built = amp !== lastAmp;
    lastAmp = amp;
    const exit = svg.querySelectorAll(".rack-exit > *").length;
    const sliding = [...svg.querySelectorAll(".rack-plates g[data-key]")].some((g) => g.style.transform !== "");
    const fading = svg.getAnimations({ subtree: true }).some((a) => a.playState === "running" && a.effect && a.effect.getComputedTiming().endTime !== Infinity);
    const rest = !built && !exit && !sliding && !fading;
    if (rest && !moving) return false;
    moving = !rest;
    const cable = svg.querySelector('path.wire.audio[data-to="amp"]');
    frames.push({
      built,
      rest,
      subject: document.getElementById("rack-subject").textContent,
      plates: svg.querySelectorAll(".rack-plates g[data-key]").length,
      exit,
      amp: centre(amp),
      ampOpacity: Number(getComputedStyle(amp).opacity),
      curve: cable ? / C /.test(cable.getAttribute("d")) : null,
    });
    return !rest;
  };
  const follow = () => {
    if (looping) return;
    looping = true;
    const tick = () => {
      if (sample()) requestAnimationFrame(tick);
      else looping = false;
    };
    requestAnimationFrame(tick);
  };
  document.addEventListener("DOMContentLoaded", () => {
    new MutationObserver(() => {
      if (sample()) follow();
    }).observe(document.getElementById("rack-svg"), { childList: true, subtree: true });
  });
  // The amp's centre now, for a read at rest.
  window.__rackAmp = () => centre(document.querySelector('#rack-svg .rack-plates g[data-kind="amp"]'));
}

/** The frames recorded so far, taken (the next read starts empty). */
const takeFrames = (page) => page.evaluate(() => window.__rackFrames.splice(0));
/** The amp's centre at rest, in rack units. */
const ampAt = (page) => page.evaluate(() => window.__rackAmp());
/** A build of the rack named `name` with `plates` plates (the amp and any
 *  empty socket counted): the subject can name a sound on its way while the
 *  rack before it is still drawn. */
const rackOf = (name, plates) => (f) => f.subject === name && f.plates === plates;

/** The motion of the first build among `frames` that `which` picks: that
 *  build's frame and every frame after it up to the next build. */
function motionOf(frames, which) {
  const i = frames.findIndex((f) => f.built && which(f));
  expect(i, `a build in ${JSON.stringify(frames.map((f) => [f.built, f.subject, f.plates]))}`).toBeGreaterThanOrEqual(0);
  const next = frames.findIndex((f, k) => k > i && f.built);
  return frames.slice(i, next < 0 ? frames.length : next);
}

/** How far the amp's centre is from `p`, in rack units. */
const away = (f, p) => Math.hypot(f.amp.x - p.x, f.amp.y - p.y);
/** The most an arriving plate's centre moves as it scales up from 0.96, in
 *  rack units: the amp's measures about 1. */
const SCALE_IN = 3;

/** An unrelated sound's arrival, as asserted on every frame of its motion. */
function expectFadedUpInPlace(motion, name) {
  const [first] = motion;
  const last = motion[motion.length - 1];
  // Nothing of the sound before stays on the rack to fade out.
  expect(motion.map((f) => f.exit), `${name}: copies of the sound before on the rack`).toEqual(motion.map(() => 0));
  // The amp fades up (transparent as the build lands) where it stays, the
  // last frame being the rack at rest: its scale from 0.96 moves its centre
  // by a unit or so, a slide by the width of the modules it passes.
  expect(first.ampOpacity, `${name}: the amp's opacity as it lands`).toBeLessThan(1);
  expect(Math.max(...motion.map((f) => away(f, last.amp))), `${name}: the amp's farthest from where it rests`).toBeLessThan(SCALE_IN);
  // So the cable into it is the curve it is at rest, on every frame.
  expect(motion.map((f) => f.curve), `${name}: the cable into the amp is a curve`).toEqual(motion.map(() => true));
}

/** A slide of the amp, as asserted on the first and last frames of its
 *  motion: it starts where it was (`from`) and ends at rest where it now is
 *  (`to`, read at rest), far enough away to have passed a module. A fade-up
 *  in place would start at `to`. */
function expectSlid(motion, from, to, name) {
  expect(away({ amp: to }, from), `${name}: the amp's move`).toBeGreaterThan(50);
  expect(Math.round(away(motion[0], from)), `${name}: the amp as it lands`).toBe(0);
  expect(Math.round(away(motion[motion.length - 1], to)), `${name}: the amp as its motion ends`).toBe(0);
}

test("a sound opened over an unrelated one fades up in place: nothing of the last one fades out, and its amp does not slide across", async ({ page, app }) => {
  await page.addInitScript(recordRack);
  await app.boot();
  await goLevel(page, "patch");
  await expect(page.locator("#rack-svg g.mod-group").first()).toBeVisible();
  await rackAtRest(page);
  const boots = await page.locator("#rack-subject").textContent();
  await takeFrames(page);

  // From the sound the boot opened (Soft Key, fifteen modules) to First
  // Bass, then from First Bass to Reese, whose filter stands where First
  // Bass's amp was: a slide from there passes behind it.
  await openPreset(app, "First Bass");
  expectFadedUpInPlace(motionOf(await takeFrames(page), rackOf("First Bass", 4)), `${boots} → First Bass`);
  await openPreset(app, "Reese");
  expectFadedUpInPlace(motionOf(await takeFrames(page), rackOf("Reese", 6)), "First Bass → Reese");
});

test("within one sound the rack still moves: an insert slides the amp to its new place, NEW PATCH slides it along as what it took fades out, and ⌘Z or BACK TO slides it back", async ({ page, app }) => {
  await page.addInitScript(recordRack);
  await app.boot();
  await openPreset(app, "Reese");
  const plates = page.locator("#rack-svg .rack-plates g[data-key]");

  // A distortion inserted after the filter, before the amp (patch_keys'
  // recipe): the amp moves one column along. Where it was is read once the
  // catalog the insert opens has refitted the rack.
  const filter = page.locator('#rack-svg .rack-controls g.mod-group[data-kind="filter"]');
  await filter.focus();
  await page.keyboard.press("F2");
  await page.locator("#ctx-menu .cm-item").filter({ hasText: /^insert after/ }).click();
  await expect(page.locator("#nodebank")).toBeVisible();
  await rackAtRest(page);
  const before = await ampAt(page);
  await takeFrames(page);
  await page.locator('#nb-groups .nb-item[data-kind="distortion"]').click();
  await app.engine((timeout) => expect(page.locator('#rack-svg g.mod-group[data-kind="distortion"]')).toHaveCount(1, { timeout }), { ms: 30_000 });
  await rackAtRest(page);
  const placed = await ampAt(page);
  expectSlid(motionOf(await takeFrames(page), rackOf("Reese (edited)", 7)), before, placed, "the insert");

  // NEW PATCH keeps the amp and empties its socket: Reese's modules fade out
  // as the amp slides to the empty socket's side.
  const newPatch = async () => {
    await page.locator("#patch-new-btn").click();
    await app.engine((timeout) => expect(page.locator('#rack-svg g.mod-group[data-kind="silence"]')).toHaveCount(1, { timeout }), { ms: 30_000 });
    await rackAtRest(page);
    return motionOf(await takeFrames(page), rackOf("New patch", 2));
  };
  const emptied = await newPatch();
  const empty = await ampAt(page);
  expect(emptied[0].exit, "Reese's modules fading out as NEW PATCH lands").toBeGreaterThan(0);
  expectSlid(emptied, placed, empty, "NEW PATCH");

  // ⌘Z past NEW PATCH puts the edited Reese back: the amp slides back to
  // where the insert put it as the empty socket fades out.
  await page.locator("#rack-svg").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("ControlOrMeta+z");
  await app.engine((timeout) => expect(plates).toHaveCount(7, { timeout }), { ms: 30_000 });
  await rackAtRest(page);
  const undone = motionOf(await takeFrames(page), rackOf("Reese (edited)", 7));
  expect(undone[0].exit, "the empty socket fading out as ⌘Z lands").toBeGreaterThan(0);
  expectSlid(undone, empty, await ampAt(page), "⌘Z past NEW PATCH");

  // BACK TO Reese opens the sound on the bench again (the pool's Reese, the
  // insert never kept: six plates). It is the sound the new patch was
  // started from, and the amp on screen is the one the new patch kept from
  // it, so the amp slides back as it did for ⌘Z.
  await newPatch();
  const emptyAgain = await ampAt(page);
  await page.locator("#patch-back").click();
  await app.engine((timeout) => expect(plates).toHaveCount(6, { timeout }), { ms: 60_000 });
  await rackAtRest(page);
  const back = motionOf(await takeFrames(page), rackOf("Reese", 6));
  expect(back[0].exit, "the empty socket fading out as BACK TO lands").toBeGreaterThan(0);
  expectSlid(back, emptyAgain, await ampAt(page), "BACK TO Reese");
});
