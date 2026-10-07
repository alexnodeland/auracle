// The zoom (Plan-008 C3): a move between the levels carries the face of the
// sound you're playing from where one level draws it to where the other
// does, and a sound opened from the bank flies from its row into your hands.
//
// What this claims:
//
// - However soon a second move follows the first (0, 40, 120 or 300 ms),
//   once it has landed exactly one level is on, the one asked for last, and
//   no section keeps a transform, a fade or `inert`; each move says it
//   landed, the last one whole, and the first, asked for in the same task as
//   the second, says it was cut short.
// - The face lands where the level draws it: the end of its flight is
//   PERFORM's well face and PATCH's face at OUT as they are drawn once the
//   move has landed, within 2 px.
// - Under reduced motion a move is instant: one level on in the same task as
//   the click, and no face, no puck, ever made.
// - With no face for the sound you're playing (the engine has said none),
//   the levels still move and nothing flies.
// - Over PATCH's rack, ctrl and the wheel (a trackpad's pinch) zoom its
//   camera and leave the level; ⌥ and the wheel move a level, over the rack
//   too, one level a turn; ctrl and the wheel elsewhere on the stage move a
//   level as well.
// - ⌥ and the wheel over something that can still scroll that way scroll
//   it, and the model view ⌥ holds up stays; at its end, the turn after is
//   the levels'.
// - Two fingers spread on a touch screen zoom in, closed zoom out; over the
//   rack they move no level.
// - At the end of the axis a level key moves nothing and the rail nods.
// - A toast on screen while a move plays is placed for the level reached:
//   once the move lands, the lane stands where that level at rest puts it,
//   not clear of the strips of the level left as well.
// - A pool row opened from PERFORM goes to PATCH without flying the sound
//   being put down, and once the sound is in hand its face flies from the
//   row to the face at OUT, landing within 2 px of it.
// - However late the engine says the face of the sound in hand (a slow
//   engine, seconds after the sound itself), the face still flies when it
//   does: the take-up waits for the engine, not for a clock.
const { test, expect, goLevel, landed } = require("./fixtures");

// A player's pace between two moves (gesture pacing, in the page: the
// second click comes this long after the first, on the app's own clock).
const GAPS = [0, 40, 120, 300];
// The large face slots' pictures (main.js `FACE_SIZE`): PERFORM's well and
// PATCH's face at OUT.
const WELL = [240, 480];
const OUT = [150, 250];
// An engine busy elsewhere: every face is asked for this much later
// (`app.delay`), so the face of the sound in hand is said seconds after the
// sound reaches your hands, as it is on a slow machine.
const FACES_LATE_MS = 4_000;

/** Where a large face slot draws its vessel, from the page: the picture
 *  fitted whole into the slot (`object-fit: contain`), and the vessel in it
 *  as main.js's `wellBox` places it (74% of the picture's height, 0.6 as
 *  wide as tall, standing on a floor at 79%). */
function drawnVessel(page, sel, [W, H]) {
  return page.evaluate(([sel, W, H]) => {
    const el = document.querySelector(sel);
    const r = el && el.getBoundingClientRect();
    if (!r || !r.width) return null;
    const k = Math.min(r.width / W, r.height / H);
    const ox = r.left + (r.width - W * k) / 2;
    const oy = r.top + (r.height - H * k) / 2;
    const bh = H * 0.74;
    const bw = Math.min(W * 0.9, bh * 0.6);
    return { x: ox + ((W - bw) / 2) * k, y: oy + (H * 0.79 - bh) * k, w: bw * k, h: bh * k };
  }, [sel, W, H]);
}

/** Two boxes the same within `px` on every side. */
function near(a, b, px = 2) {
  expect(a, "a box").toBeTruthy();
  expect(b, "a box").toBeTruthy();
  for (const k of ["x", "y", "w", "h"]) expect(Math.abs(a[k] - b[k]), `${k}: ${a[k]} vs ${b[k]}`).toBeLessThanOrEqual(px);
}

/** Boot at PATCH, the level saved last time, and wait for the face of the
 *  sound you're playing at OUT and in the menu bar. At PERFORM the faces
 *  wait behind its first measurement of the sound (the faces lane is below
 *  it, worker.js); at PATCH there is none, and the face lands at once. */
async function bootWithFaces(app, opts) {
  const { page } = app;
  await page.addInitScript(() => {
    try {
      localStorage.setItem("auracle-view", "patch");
    } catch (_) {}
  });
  await app.boot(opts);
  await app.engine((timeout) => expect(page.locator("#out-face img.face")).toBeVisible({ timeout }));
  await expect(page.locator("#inhand-face img.face")).toBeVisible();
}

/** No section keeps anything the move put on it. */
async function nothingLeft(page) {
  const left = await page.evaluate(() =>
    [...document.querySelectorAll("section.view")]
      .filter((e) => e.classList.contains("leaving") || e.inert || e.style.transform || e.style.opacity || e.style.transformOrigin)
      .map((e) => e.id));
  expect(left).toEqual([]);
}

test("after a move exactly one level is on, however soon the next move follows", async ({ page, app }) => {
  await bootWithFaces(app);
  const moves = [["perform", "taste"], ["evolve", "learning"], ["perform", "patch"], ["taste", "perform"]];
  const firstCut = [];
  for (const [i, gap] of GAPS.entries()) {
    const [first, last] = moves[i];
    const t0 = await app.now();
    await page.evaluate(async ([a, b, gap]) => {
      const stop = (l) => document.querySelector(`.rail-stop[data-level="${l}"]`);
      stop(a).click();
      if (gap) await new Promise((r) => setTimeout(r, gap));
      stop(b).click();
    }, [first, last, gap]);
    await landed(page);
    await expect(page.locator("section.view.on")).toHaveCount(1);
    await expect(page.locator(`#view-${last}`)).toHaveClass(/\bon\b/);
    await expect(page.locator("body")).toHaveAttribute("data-level", last);
    await expect(page.locator(`.rail-stop[data-level="${last}"]`)).toHaveAttribute("aria-current", "location");
    await nothingLeft(page);
    // Both landed, in order, the second whole.
    const marks = (await app.marks("level-landed", { after: t0 })).map((m) => m.detail);
    expect(marks.map((d) => d.to), `at a gap of ${gap} ms`).toEqual([first, last]);
    expect(marks[1].cut, `at a gap of ${gap} ms`).toBe(false);
    firstCut.push(marks[0].cut);
  }
  // With no gap the second is asked for in the first's own task, so the
  // first is cut short. With one, a page stalled long enough can let the
  // first finish before the second comes, and either is right.
  expect(firstCut[GAPS.indexOf(0)], "with no gap, the first move is cut short").toBe(true);
});

test("the face lands where the level draws it, within 2 px", async ({ page, app }) => {
  await bootWithFaces(app);
  for (const [level, sel, size] of [["perform", "#view-perform .pf-face", WELL], ["patch", "#out-face", OUT], ["perform", "#view-perform .pf-face", WELL]]) {
    const t0 = await app.now();
    await goLevel(page, level);
    const [m] = await app.marks("level-landed", { after: t0 });
    expect(m.detail.to).toBe(level);
    expect(m.detail.flew, `a face flew to ${level}`).toBeTruthy();
    expect(m.detail.flew.fade).toBeNull();
    near(m.detail.flew, await drawnVessel(page, sel, size));
  }
});

test.describe("under reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("a move is instant, and no face or puck is ever made", async ({ page, app }) => {
    await bootWithFaces(app);
    const t0 = await app.now();
    for (const level of ["perform", "taste", "evolve", "patch"]) {
      // Read in the click's own task: the move has already landed.
      const on = await page.evaluate((l) => {
        document.querySelector(`.rail-stop[data-level="${l}"]`).click();
        return [...document.querySelectorAll("section.view.on")].map((e) => e.id);
      }, level);
      expect(on).toEqual([`view-${level}`]);
    }
    await nothingLeft(page);
    await expect(page.locator(".zoom-face")).toHaveCount(0);
    await expect(page.locator(".rail-puck")).toHaveCount(0);
    expect(await app.marks("level-landed", { after: t0 })).toEqual([]);
  });
});

test("with no face for the sound you're playing, the levels move and nothing flies", async ({ page, app }) => {
  // The engine's faces never reach the page: no face is known for any sound.
  await app.hold("faces");
  await app.boot();
  await expect(page.locator(".rail-stop[data-level=perform]")).toHaveAttribute("aria-current", "location");
  // The sound's face would be at OUT by now (bootWithFaces), and is not.
  await goLevel(page, "patch");
  await expect(page.locator("#out-slot")).toBeVisible();
  await expect(page.locator("#out-face img.face")).toHaveCount(0);
  for (const level of ["perform", "taste", "patch"]) {
    const t0 = await app.now();
    await goLevel(page, level);
    const [m] = await app.marks("level-landed", { after: t0 });
    // It moved (a move that plays says it landed), and carried nothing.
    expect(m.detail).toMatchObject({ to: level, cut: false, flew: null });
  }
  await expect(page.locator(".zoom-face")).toHaveCount(0);
});

test("ctrl and the wheel over the rack zoom its camera; ⌥ and the wheel move a level, one a turn", async ({ page, app }) => {
  await bootWithFaces(app);
  const viewBox = () => page.evaluate(() => document.getElementById("rack-svg").getAttribute("viewBox").split(/\s+/).map(Number)[2]);
  await expect.poll(viewBox).toBeGreaterThan(0);
  const before = await viewBox();
  const rack = await page.locator("#rack-scroll").boundingBox();
  await page.mouse.move(rack.x + rack.width / 2, rack.y + rack.height / 2);
  let t0 = await app.now();
  // A trackpad's pinch over the rack: the camera's.
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -240);
  await page.keyboard.up("Control");
  await expect.poll(viewBox).toBeLessThan(before);
  await expect(page.locator("body")).toHaveAttribute("data-level", "patch");
  // ⌥ and the wheel over the rack: a level, out to PERFORM.
  await page.keyboard.down("Alt");
  await page.mouse.wheel(0, 120);
  await page.keyboard.up("Alt");
  await expect(page.locator("body")).toHaveAttribute("data-level", "perform");
  await landed(page);
  expect((await app.marks("level-landed", { after: t0 })).map((m) => m.detail.to)).toEqual(["perform"]);
  // One turn, however far, is one level: two notches at once reach TASTE,
  // not LEARNING.
  t0 = await app.now();
  await page.mouse.move(500, 400);
  await page.keyboard.down("Alt");
  await page.mouse.wheel(0, 120);
  await page.mouse.wheel(0, 120);
  await page.keyboard.up("Alt");
  await expect(page.locator("body")).toHaveAttribute("data-level", "taste");
  await landed(page);
  expect((await app.marks("level-landed", { after: t0 })).map((m) => m.detail.to)).toEqual(["taste"]);
  // ctrl and the wheel away from the rack (a trackpad's pinch on the stage):
  // a level, in to PERFORM.
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -120);
  await page.keyboard.up("Control");
  await expect(page.locator("body")).toHaveAttribute("data-level", "perform");
  await landed(page);
});

test.describe("in a window where PERFORM scrolls", () => {
  test.use({ viewport: { width: 1000, height: 600 } });

  test("⌥ and the wheel scroll what can scroll that way, under the model view, and move a level where nothing can", async ({ page, app }) => {
    await app.boot();
    await goLevel(page, "perform");
    const section = page.locator("#view-perform");
    const fits = () => section.evaluate((el) => ({ top: el.scrollTop, room: el.scrollHeight - el.clientHeight }));
    expect((await fits()).room, "PERFORM is taller than the window here").toBeGreaterThan(0);
    // Over the well, which scrolls nothing of its own: what can scroll there
    // is PERFORM itself.
    const box = await page.locator("#view-perform .pf-well").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    // At its top, up is nowhere to scroll: the turn is the levels', in to
    // PATCH.
    await page.keyboard.down("Alt");
    await page.mouse.wheel(0, -120);
    await page.keyboard.up("Alt");
    await expect(page.locator("body")).toHaveAttribute("data-level", "patch");
    await landed(page);
    await goLevel(page, "perform");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    // Down, with ⌥ held long enough for the model view: PERFORM scrolls, and
    // the view and the level stay.
    await page.keyboard.down("Alt");
    await expect(page.locator("body")).toHaveClass(/\bmodel-view\b/);
    await page.mouse.wheel(0, 120);
    await expect.poll(async () => (await fits()).top).toBeGreaterThan(0);
    await expect(page.locator("body")).toHaveClass(/\bmodel-view\b/);
    await expect(page.locator("body")).toHaveAttribute("data-level", "perform");
    await page.keyboard.up("Alt");
  });
});

test("two fingers spread zoom in and closed zoom out; over the rack they move no level", async ({ page, app }) => {
  await bootWithFaces(app);
  await goLevel(page, "perform");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  /** Two fingers at `cx, cy`, `from` px apart, moved to `to` px apart. */
  const pinch = async (cx, cy, from, to) => {
    const at = (d) => [{ x: cx - d / 2, y: cy, id: 0 }, { x: cx + d / 2, y: cy, id: 1 }];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(from) });
    for (const k of [0.25, 0.5, 0.75, 1]) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(from + (to - from) * k) });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  // Spread over PERFORM's well: in, to PATCH.
  const well = await page.locator(".pf-well").boundingBox();
  await pinch(well.x + well.width / 2, well.y + well.height / 2, 80, 200);
  await expect(page.locator("body")).toHaveAttribute("data-level", "patch");
  await landed(page);
  // Closed over the rack: the rack's, no level.
  const rack = await page.locator("#rack-scroll").boundingBox();
  const t0 = await app.now();
  await pinch(rack.x + rack.width / 2, rack.y + rack.height / 2, 200, 60);
  await app.quiet();
  await expect(page.locator("body")).toHaveAttribute("data-level", "patch");
  expect(await app.marks("level-landed", { after: t0 })).toEqual([]);
  // Closed over PATCH's head: out, to PERFORM.
  const head = await page.locator("#view-patch .pt-title").boundingBox();
  await pinch(head.x + head.width / 2, head.y + head.height / 2, 200, 60);
  await expect(page.locator("body")).toHaveAttribute("data-level", "perform");
  await landed(page);
});

test("at the end of the axis a level key moves nothing, and the rail nods", async ({ page, app }) => {
  await app.boot();
  await goLevel(page, "patch");
  // Every frame's offset of the rail, from just before the key.
  await page.evaluate(() => {
    const rail = document.getElementById("rail");
    window.__pwNod = [];
    const look = () => {
      window.__pwNod.push(getComputedStyle(rail).translate);
      if (window.__pwNod.length < 60) requestAnimationFrame(look);
    };
    look();
  });
  const t0 = await app.now();
  await page.keyboard.press("Alt+ArrowDown");
  await expect.poll(() => page.evaluate(() => window.__pwNod.some((t) => t && t !== "none" && !/^0px( 0px)?$/.test(t)))).toBe(true);
  await expect(page.locator("body")).toHaveAttribute("data-level", "patch");
  expect(await app.marks("level-landed", { after: t0 })).toEqual([]);
});

test("a toast up during a move stands where the level reached puts it, not clear of the level left", async ({ page, app }) => {
  // The page's clock, so the toast is still up when the move has landed
  // however slow the runner (ADR-022): stopped once the toast is said, and
  // run on past the move's end.
  await page.clock.install();
  await app.boot();
  await expect(page.locator("#view-perform .pf-pads")).toBeVisible();
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 100);
  // PERFORM's ↵ with nothing focused, at home: a refusal, said at once.
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("Enter");
  await expect(page.locator("#toasts")).toContainText("Nothing to keep");
  await page.keyboard.press("Alt+ArrowUp");
  await expect(page.locator("body")).toHaveAttribute("data-level", "taste");
  // Past the move's own end (`--d-zoom`, twice, and its grace: shell.js's
  // guard), on the page's clock.
  await page.clock.runFor(2_000);
  await expect(page.locator("section.view.on")).toHaveCount(1);
  await expect(page.locator("section.view.leaving")).toHaveCount(0);
  // Where the lane stands now, and where TASTE at rest puts it: the same.
  const lane = await page.evaluate(() => {
    const holder = document.getElementById("toasts");
    const up = !!holder.firstChild;
    const after = holder.style.bottom;
    window.dispatchEvent(new Event("resize"));
    return { up, after, rest: holder.style.bottom };
  });
  expect(lane.up, "the toast is still up").toBe(true);
  expect(lane.after).toBe(lane.rest);
  await page.clock.resume();
});

test("a pool row opened from PERFORM goes to PATCH, and its face flies from the row to the face at OUT", async ({ page, app }) => {
  await bootWithFaces(app);
  await app.fullPool();
  await goLevel(page, "perform");
  const row = page.locator("#bank-list .bank-item[data-id]:not(.live)", { has: page.locator(":scope > .face-slot img.face") }).first();
  await expect(row).toBeVisible();
  const t0 = await app.now();
  await row.locator(".bi-name").click();
  const [taken] = await app.engine(async (timeout) => {
    await expect.poll(() => app.marks("taken-up", { after: t0 }), { timeout }).toHaveLength(1);
    return app.marks("taken-up", { after: t0 });
  });
  await landed(page);
  // The move to PATCH carried nothing: the sound being put down is not the
  // one arriving.
  const moves = (await app.marks("level-landed", { after: t0 })).map((m) => m.detail);
  expect(moves).toEqual([expect.objectContaining({ to: "patch", flew: null })]);
  // The row's face landed on the face at OUT.
  expect(taken.detail.level).toBe("patch");
  near(taken.detail.flew, await drawnVessel(page, "#out-face", OUT));
});

test("a sound opened from the bank flies into your hands however late the engine says its face", async ({ page, app }) => {
  await bootWithFaces(app);
  await app.fullPool();
  await goLevel(page, "perform");
  const row = page.locator("#bank-list .bank-item[data-id]:not(.live)", { has: page.locator(":scope > .face-slot img.face") }).first();
  await expect(row).toBeVisible();
  await app.delay("faces", FACES_LATE_MS);
  const t0 = await app.now();
  await row.locator(".bi-name").click();
  const [taken] = await app.engine(async (timeout) => {
    await expect.poll(() => app.marks("taken-up", { after: t0 }), { timeout }).toHaveLength(1);
    return app.marks("taken-up", { after: t0 });
  });
  expect(taken.detail.level).toBe("patch");
  near(taken.detail.flew, await drawnVessel(page, "#out-face", OUT));
});
