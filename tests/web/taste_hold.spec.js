// Nothing on TASTE or LEARNING moves under the hand (#315, ADR-025's hold
// rule, hand.js):
//
// - With the pointer over the map, a views post (an import's here) moves the
//   halos (the card's number) and no place; the places settle when the
//   pointer leaves, and what the map says of a new map is said then.
// - With a sound's card up from the keyboard, a refit does the same; its
//   places settle a second after the last arrow step, and the refit is said
//   then. Under reduced motion the card goes with its sound when they
//   settle, and closes when the new map drops it.
// - The track's room along the map's foot is kept from the start, so its
//   first appearance moves no sound.
// - A ▶ pressed on a sound's card, or on a style's chip, while a pick's
//   ratings or a styles reply lands still plays: the card and the chips are
//   updated in place, not rebuilt.
// - With the pointer over LEARNING's weights only their lengths move; they
//   take their new order, sliding, when it leaves.
//
// Where a sound is, is read by pointing at a place with the card down and
// seeing which sound's card comes up (`__soundAt`), never by the card a
// pointer already had up: a miss leaves the last card up a moment. What
// must happen within the hand's one-second rest is read in the page's own
// task (ADR-022).
//
// Booted on a slow engine (`slowEngine: 4`, the farm at two workers, as the
// issue's slow profile has it). The engine's own views and styles are held
// (`app.hold`) once the test has what it needs, so only the posts the test
// injects land; places are computed with the app's own layout (taste-geom
// `mapFrame`, `mapLayout`), as taste_learning.spec.js computes them.
const { test, expect, goLevel } = require("./fixtures");

const SLOW = { slowEngine: 4, query: "?farm=2" };
const REFIT_SAID = "It fitted your taste again. Every rating settled.";

async function bootFitted(app) {
  await app.boot({ ...SLOW, warmed: false, random: 20261001 });
  await app.warmStart([1, 4, 7]);
  // Only what the test posts lands from here.
  await app.hold([{ views: true }, "styles"]);
}

async function openView(page, view) {
  await goLevel(page, view);
  await expect(page.locator(`#view-${view}`)).toBeVisible();
}

/** Where the map puts each pool sound, by the app's own layout, for the
 *  posted map's points or `points`; the mark's size (`s0`) and the distance
 *  a mouse finds a sound from (`reach`, the app's `MAP_MARK_REACH` marks). */
function mapPositions(page, points = null) {
  return page.evaluate(async (given) => {
    const geom = await import("/taste-geom.js");
    const well = document.getElementById("taste-well");
    const W = Math.max(200, well.clientWidth);
    const H = Math.max(160, well.clientHeight);
    const pts = (given || window.__tap.facts.views.map.points).filter((p) => p.id != null);
    const out = {};
    for (const track of [true, false]) {
      const f = geom.mapFrame(W, H, pts.length, { track });
      out[track ? "pos" : "noTrack"] = Object.fromEntries([...geom.mapLayout(pts, f.box, f.minD)]);
      out.s0 = out.s0 || f.s0;
    }
    out.reach = out.s0 * geom.MAP_MARK_REACH;
    return out;
  }, points);
}

/** The posted views with each map point moved by `how` ("mirror": x
 *  negated; "swap": `id`'s point and the one placed furthest from it
 *  (by `pos`) trade places) and every rating at `mean`. */
function movedViews(page, how, mean, id = null, pos = null) {
  return page.evaluate(([how, mean, id, pos]) => {
    const v = JSON.parse(JSON.stringify(window.__tap.facts.views));
    if (how === "mirror") for (const p of v.map.points) p.x = -p.x;
    else {
      const a = v.map.points.find((p) => p.id === id);
      const d = (p) => Math.hypot(pos[p.id].x - pos[id].x, pos[p.id].y - pos[id].y);
      const b = v.map.points.filter((p) => p.id != null && pos[p.id]).sort((p, q) => d(q) - d(p))[0];
      [a.x, a.y, b.x, b.y] = [b.x, b.y, a.x, a.y];
    }
    for (const p of v.map.points) p.utility = mean;
    for (const row of v.ratings.ranked) row.mean = mean;
    return v;
  }, [how, mean, id, pos]);
}

/** Point at map position `q`. */
async function cardAt(page, q) {
  const box = await page.locator("#taste-crt").boundingBox();
  await page.mouse.move(box.x + q.x, box.y + q.y);
}

/** The page's probes. `window.__soundAt(q)`: the card put down, then a mouse's pointermove at
 *  map position `q`; the sound whose card comes up, or null. A pointermove
 *  over the map is a movement to the hand too, so a rest starts again. */
function installSoundAt(page) {
  return page.evaluate(() => {
    window.__soundAt = (q) => {
      const cv = document.getElementById("taste-crt");
      const plate = document.getElementById("taste-plate");
      if (plate.classList.contains("on")) cv.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      if (plate.classList.contains("on")) return "the card did not go down";
      const b = cv.getBoundingClientRect();
      cv.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse", clientX: b.left + q.x, clientY: b.top + q.y }));
      return plate.classList.contains("on") ? Number(plate.dataset.id) : null;
    };
    window.__dMove = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--d-move")) || 0;
    // The card's translate as drawn, in px.
    window.__plateAt = () => {
      const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(document.getElementById("taste-plate").style.transform);
      return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
    };
    // The map's first arrow step, and a refit posting `v` in the same task.
    // With `glide`, the card is read again a glide's length later, in the
    // page: timers fire in due order, so that read comes before the rest's
    // however late the runner is.
    window.__stepAndRefit = async (v, glide = false) => {
      const cv = document.getElementById("taste-crt");
      const at = performance.now();
      cv.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      window.__tap.inject({ type: "fitted", views: v, status: window.__tap.facts.status });
      const out = {
        at,
        id: Number(document.getElementById("taste-plate").dataset.id),
        plate: window.__plateAt(),
        like: document.querySelector("#taste-plate .ts-pl-like").textContent,
        said: document.getElementById("taste-live").textContent,
      };
      if (glide) {
        await new Promise((r) => setTimeout(r, window.__dMove() + 200));
        out.later = window.__plateAt();
      }
      return out;
    };
  });
}

/** The sound whose card comes up at `q`, the real pointer brought there from
 *  off the map once the card is down. */
async function soundAt(page, q) {
  await page.mouse.move(1, 1);
  await expect(page.locator("#taste-plate")).not.toHaveClass(/\bon\b/);
  await cardAt(page, q);
  const plate = page.locator("#taste-plate");
  return (await plate.evaluate((e) => e.classList.contains("on"))) ? Number(await plate.getAttribute("data-id")) : null;
}

const pct = (mean) => Math.round(100 / (1 + Math.exp(-mean)));
const far = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

test("with the pointer over the map an import's views move the halos and no place, and the places settle when it leaves", async ({ page, app }) => {
  await bootFitted(app);
  await openView(page, "taste");
  await installSoundAt(page);
  const { pos, s0 } = await mapPositions(page);
  const ids = Object.keys(pos).map(Number);
  const mirrored = await movedViews(page, "mirror", 1);
  const { pos: pos1 } = await mapPositions(page, mirrored.map.points);
  // The sound the mirror moves furthest.
  const id = ids.slice().sort((a, b) => far(pos1[b], pos[b]) - far(pos1[a], pos[a]))[0];
  expect(far(pos1[id], pos[id]), "the mirrored map moves the sound well clear of its place").toBeGreaterThan(s0 * 2);

  const live = page.locator("#taste-live");
  await cardAt(page, pos[id]);
  await expect(page.locator("#taste-plate")).toHaveAttribute("data-id", String(id));

  // The views a taste file's import asks for land with the pointer on the
  // sound: the card's number (its halo's rating) moves in the same task, and
  // the place does not, through a glide's length and after; nothing is said
  // while they wait. All in the page's task, the pointer moving all along.
  const held = await page.evaluate(async ([v, q]) => {
    const said = document.getElementById("taste-live");
    said.textContent = "";
    const out = { before: window.__soundAt(q) };
    window.__tap.inject({ type: "taste_views", views: v });
    out.like = document.querySelector("#taste-plate .ts-pl-like").textContent;
    out.atOnce = window.__soundAt(q);
    const end = performance.now() + window.__dMove() + 300;
    while (performance.now() < end) {
      await new Promise((r) => setTimeout(r, 150));
      window.__soundAt(q);
    }
    out.after = window.__soundAt(q);
    out.said = said.textContent;
    return out;
  }, [mirrored, pos[id]]);
  expect(held.before, "the sound is under the pointer").toBe(id);
  expect(held.like, "the halos moved to the new views at once").toMatch(new RegExp(`^would like: ${pct(1)}% · `));
  expect(held.atOnce, "the sound is still under the pointer as the views land").toBe(id);
  expect(held.after, "and a glide's length later").toBe(id);
  expect(held.said, "nothing said while the places wait").toBe("");

  // The pointer leaves: the places settle, and what the map says of a new
  // map once fitted is said now, not before.
  await page.mouse.move(1, 1);
  await expect(live).toHaveText(REFIT_SAID);
  await expect.poll(() => soundAt(page, pos1[id]), { message: "the sound settled at its new place" }).toBe(id);
});

/** A card up from the keyboard on the sound the map's first arrow step
 *  picks, the pointer off the map (where main's own hold would keep a whole
 *  refit back, hand.js); then put down again. Its id. */
async function keyboardSound(page) {
  await installSoundAt(page);
  const plate = page.locator("#taste-plate");
  await page.mouse.move(1, 1);
  await page.locator("#taste-crt").focus();
  await page.keyboard.press("ArrowRight");
  await expect(plate).toHaveClass(/\bon\b/);
  const id = Number(await plate.getAttribute("data-id"));
  await page.keyboard.press("Escape");
  await expect(plate).not.toHaveClass(/\bon\b/);
  await page.evaluate(() => {
    window.__said = 0;
    const live = document.getElementById("taste-live");
    live.textContent = "";
    new MutationObserver(() => { if (live.textContent && !window.__said) window.__said = performance.now(); })
      .observe(live, { childList: true, characterData: true, subtree: true });
  });
  return id;
}

test("with a sound's card up a refit moves the halos and no place, and the places settle after a second of rest, said then", async ({ page, app }) => {
  await bootFitted(app);
  await openView(page, "taste");
  const { pos, s0 } = await mapPositions(page);
  const id = await keyboardSound(page);
  // The refit trades the card's sound's place with the sound furthest from it.
  const swapped = await movedViews(page, "swap", -1, id, pos);
  const { pos: pos2 } = await mapPositions(page, swapped.map.points);
  expect(far(pos2[id], pos[id]), "the refit moves the card's sound well clear of its place").toBeGreaterThan(s0 * 2);

  // The card comes up, and the refit lands, in one task, so the rest is
  // counted from the refit's landing; the card is read again a glide's
  // length later in the same evaluate.
  const now = await page.evaluate((v) => window.__stepAndRefit(v, true), swapped);
  expect(now.id, "the card is up on the same sound").toBe(id);
  expect(now.like, "the halos moved to the refit at once").toMatch(new RegExp(`^would like: ${pct(-1)}% · `));
  expect(now.said, "nothing said while the places wait").toBe("");
  // The card goes with its sound while the places glide: a glide's length
  // later it has not moved, so neither has its sound.
  expect(now.later, "the card's sound kept its place through a glide's length").toEqual(now.plate);
  await expect(page.locator("#taste-live")).toHaveText(REFIT_SAID, { timeout: 5_000 });
  const said = await page.evaluate(() => window.__said);
  console.log(`rest: the refit said ${Math.round(said - now.at)} ms after the card came up and it landed`);
  expect(said - now.at, "the places waited out a second of rest").toBeGreaterThanOrEqual(999);
  // Settled: the card went with its sound, and the sound is at its new place.
  await expect.poll(() => page.evaluate(() => window.__plateAt()), { message: "the card went with its sound" }).not.toEqual(now.plate);
  await page.keyboard.press("Escape");
  await expect.poll(() => soundAt(page, pos2[id]), { message: "the sound settled at its new place" }).toBe(id);
});

test("arrow steps on the map are movement: a refit's places wait for a second after the last step", async ({ page, app }) => {
  await bootFitted(app);
  await openView(page, "taste");
  await keyboardSound(page);
  const mirrored = await movedViews(page, "mirror", 1);
  // A card up, then a step every 300 ms for 2.4 s; the refit lands 1.5 s in,
  // more than a second after the card came up.
  const run = await page.evaluate(async (v) => {
    const cv = document.getElementById("taste-crt");
    const press = (key) => cv.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    const t0 = performance.now();
    press("ArrowRight");
    let landed = 0, last = t0;
    for (let i = 1; i <= 8; i++) {
      await new Promise((r) => setTimeout(r, 300));
      if (!landed && performance.now() - t0 >= 1500) {
        window.__tap.inject({ type: "fitted", views: v, status: window.__tap.facts.status });
        landed = performance.now();
      }
      press(i % 2 ? "ArrowLeft" : "ArrowRight");
      last = performance.now();
    }
    return { t0, landed, last, saidWhileStepping: window.__said };
  }, mirrored);
  expect(run.landed - run.t0, "the refit landed over a second after the card came up").toBeGreaterThanOrEqual(1000);
  expect(run.saidWhileStepping, "nothing settled while the steps went on").toBe(0);
  await expect(page.locator("#taste-live")).toHaveText(REFIT_SAID, { timeout: 5_000 });
  const said = await page.evaluate(() => window.__said);
  console.log(`steps: the refit said ${Math.round(said - run.last)} ms after the last step`);
  expect(said - run.last, "the places waited a second after the last step").toBeGreaterThanOrEqual(999);
});

test("under reduced motion the card goes with its sound when the places settle, and closes when the map drops it", async ({ page, app }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await bootFitted(app);
  await openView(page, "taste");
  const { pos } = await mapPositions(page);
  const id = await keyboardSound(page);
  const swapped = await movedViews(page, "swap", -1, id, pos);
  const { pos: pos2 } = await mapPositions(page, swapped.map.points);
  const now = await page.evaluate((v) => window.__stepAndRefit(v), swapped);
  expect(now.id).toBe(id);
  await expect(page.locator("#taste-live")).toHaveText(REFIT_SAID, { timeout: 5_000 });
  // The card's middle, by the map, against the sound's old and new places.
  const mid = await page.evaluate(() => {
    const p = document.getElementById("taste-plate").getBoundingClientRect();
    const c = document.getElementById("taste-crt").getBoundingClientRect();
    return { x: p.left + p.width / 2 - c.left, y: p.top + p.height / 2 - c.top };
  });
  expect(far(mid, pos2[id]), "the card is beside the sound's new place, not its old one").toBeLessThan(far(mid, pos[id]));
  await expect(page.locator("#taste-plate")).toHaveClass(/\bon\b/);

  // A refit whose map has no place for the card's sound: it closes as they settle.
  await page.evaluate((id) => {
    document.getElementById("taste-live").textContent = "";
    const v = JSON.parse(JSON.stringify(window.__tap.facts.views));
    v.map.points = v.map.points.filter((p) => p.id !== id).map((p) => ({ ...p, x: -p.x }));
    window.__tap.inject({ type: "fitted", views: v, status: window.__tap.facts.status });
  }, id);
  await expect(page.locator("#taste-live")).toHaveText(REFIT_SAID, { timeout: 5_000 });
  await expect(page.locator("#taste-plate"), "the card of a sound the map dropped closes").not.toHaveClass(/\bon\b/);
});

test("the track's room along the map is kept from the start: its first appearance moves no sound", async ({ page, app }) => {
  // No views but the first: one moment kept, so the track waits for a second.
  await app.hold([{ views: true }]);
  await app.boot(SLOW);
  await expect.poll(async () => (await app.held()).length, { timeout: 30_000 }).toBeGreaterThan(0);
  // Only the first views held go through; any later stay held.
  await page.evaluate(() => {
    const T = window.__tap;
    const h = T.held.shift();
    const e = new MessageEvent("message", { data: h.d });
    e.__tapReleased = true;
    T.engine.dispatchEvent(e);
  });
  await openView(page, "taste");
  await installSoundAt(page);
  const time = page.locator("#taste-time");
  await expect(time).not.toHaveClass(/\bon\b/);
  const { pos, noTrack, reach } = await mapPositions(page);
  const ids = Object.keys(pos).map(Number);
  const gap = (id) => far(pos[id], noTrack[id]);
  // A point just inside the sound's reach on the side away from where it
  // would be without the track's room: its card comes up there only if the
  // sound is where the room leaves it. The sound, of those nearest such a
  // point, that the room would move most.
  const probe = (id) => {
    const g = gap(id) || 1;
    return { x: pos[id].x + ((pos[id].x - noTrack[id].x) / g) * reach * 0.8, y: pos[id].y + ((pos[id].y - noTrack[id].y) / g) * reach * 0.8 };
  };
  const nearest = (id) => ids.every((o) => o === id || far(pos[o], probe(id)) > reach);
  const id = ids.filter(nearest).sort((a, b) => gap(b) - gap(a))[0];
  expect(gap(id), "without the room the sound would be out of reach of the point").toBeGreaterThan(reach * 0.2);
  await expect.poll(() => soundAt(page, probe(id)), { message: "the sound is where the track's room leaves it, before the track shows" }).toBe(id);

  // A second moment (a star's reply): the track shows, and no sound moves.
  await page.evaluate((id) => {
    const r = JSON.parse(JSON.stringify(window.__tap.facts.ratings || window.__tap.facts.views.ratings));
    window.__tap.inject({ type: "status", status: window.__tap.facts.status, recorded: true, vote: { kind: "stars", id, rating: 4, prev: 0 }, ratings: r });
  }, id);
  await expect(time).toHaveClass(/\bon\b/);
  await expect.poll(() => soundAt(page, probe(id)), { message: "the same place holds the same sound" }).toBe(id);
  console.log(`the track's room moved no sound; without it sound ${id} would have moved ${Math.round(gap(id))} px`);
});

test("a ▶ pressed on a sound's card, or on a style's chip, while a pick's ratings or a styles reply lands still plays", async ({ page, app }) => {
  await bootFitted(app);
  await openView(page, "taste");
  const { pos } = await mapPositions(page);
  const id = Number(Object.keys(pos)[0]);
  const plate = page.locator("#taste-plate");
  await cardAt(page, pos[id]);
  await expect(plate).toHaveAttribute("data-id", String(id));
  const play = plate.locator(".util-btn").first();
  const b = await play.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  // A pick's ratings land between the press and the release (a refit's views
  // would wait in main's own hand, the pointer being on the map). The ▶ is
  // not left focused, as Safari and Firefox on macOS leave it, so no focus
  // can spare the card from a rebuild.
  await page.evaluate(() => {
    document.activeElement.blur();
    const T = window.__tap;
    const v = JSON.parse(JSON.stringify(T.facts.views));
    const r = JSON.parse(JSON.stringify(T.facts.ratings || v.ratings));
    for (const row of r.ranked) row.mean += 0.5;
    T.inject({ type: "status", status: T.facts.status, recorded: true, vote: { kind: "stars", id: v.map.points[0].id, rating: 4, prev: 0 }, ratings: r });
  });
  await page.mouse.up();
  await app.engine((timeout) => expect(play, "the card's ▶, pressed through a sync, plays").toHaveClass(/\bplaying\b/, { timeout }), { ms: 30_000 });

  await openView(page, "learning");
  const chip = page.locator(".md-chip").first();
  await expect(chip.locator(".md-chip-play")).toBeEnabled();
  const cb = await chip.locator(".md-chip-play").boundingBox();
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await page.mouse.down();
  await page.evaluate(() => {
    const T = window.__tap;
    const styles = JSON.parse(JSON.stringify(T.facts.views.styles));
    T.inject({ type: "styles", styles, observations: (T.facts.status && T.facts.status.observations) || 0 });
  });
  await page.mouse.up();
  await app.engine((timeout) => expect(chip.locator(".md-chip-play"), "the chip's ▶, pressed through a styles reply, plays").toHaveClass(/\bplaying\b/, { timeout }), { ms: 30_000 });
});

test("with the pointer over the weights only their lengths move, and they re-sort, sliding, when it leaves or rests", async ({ page, app }) => {
  await bootFitted(app);
  await openView(page, "learning");
  const rows = page.locator("#md-bars .md-row");
  await expect(rows.nth(1)).toBeVisible();
  const order = () => page.evaluate(() => [...document.querySelectorAll("#md-bars .md-row .md-tech")].map((e) => e.textContent));
  const before = await order();
  const top = rows.first();
  const tb = await top.boundingBox();
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
  const legend = page.locator("#md-maplegend");
  const word = await top.locator(".md-word").textContent();
  await expect(legend).toHaveText(`dots: ${word}`);

  // A styles reply that turns the chosen style's weights round: the
  // largest the smallest, each 0.02 apart.
  const after = await page.evaluate(([x, y]) => {
    const T = window.__tap;
    const styles = JSON.parse(JSON.stringify(T.facts.views.styles));
    const k = Number(document.querySelector('.md-chip-pick[aria-checked="true"]').closest(".md-chip").dataset.k);
    const th = styles[k].theta;
    const rank = th.slice().sort((a, b) => Math.abs(b.mean) - Math.abs(a.mean));
    rank.forEach((t, i) => { t.mean = Math.sign(t.mean || 1) * (0.05 + 0.02 * i); });
    T.inject({ type: "styles", styles, observations: (T.facts.status && T.facts.status.observations) || 0 });
    window.__styles = { styles, k };
    window.__flips = 0;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...a) {
      if (this.classList && this.classList.contains("md-row")) window.__flips += 1;
      return animate.apply(this, a);
    };
    const under = document.elementFromPoint(x, y)?.closest(".md-row");
    return {
      order: [...document.querySelectorAll("#md-bars .md-row .md-tech")].map((e) => e.textContent),
      under: under ? under.querySelector(".md-tech").textContent : null,
      want: th.slice().sort((a, b) => Math.abs(b.mean) - Math.abs(a.mean)).map((t) => String(t.name).split(":")[0]),
      val: Number(document.querySelector("#md-bars .md-row .md-val").textContent.replace("−", "-")),
      top: th.find((t) => String(t.name).split(":")[0] === document.querySelector("#md-bars .md-row .md-tech").textContent).mean,
    };
  }, [tb.x + tb.width / 2, tb.y + tb.height / 2]);
  expect(after.want, "the reply sorts the weights otherwise").not.toEqual(before);
  expect(after.order, "the rows keep their order under the pointer").toEqual(before);
  expect(after.under, "the row under the pointer is the one it pointed at").toBe(before[0]);
  expect(Math.abs(after.val - after.top), "its length moved to the reply's weight").toBeLessThan(0.006);
  await expect(legend, "the small map stays shaded by the row under the pointer").toHaveText(`dots: ${word}`);

  // The pointer leaves: the rows take the new order, sliding there.
  await page.mouse.move(1, 1);
  await expect.poll(order).toEqual(after.want);
  expect(await page.evaluate(() => window.__flips), "the rows slid to their new places").toBeGreaterThan(0);

  // Resting on a row: another reply that turns them round again takes its
  // order a second after the pointer last moved, the pointer still there.
  await expect.poll(() => page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running" && a.effect?.target?.classList?.contains("md-row")).length), { message: "the rows have slid" }).toBe(0);
  await rows.nth(1).hover();
  await expect(legend).toHaveText(`dots: ${await rows.nth(1).locator(".md-word").textContent()}`);
  const rest = await page.evaluate(() => {
    const T = window.__tap;
    const { styles, k } = window.__styles;
    const th = styles[k].theta;
    const rank = th.slice().sort((a, b) => Math.abs(b.mean) - Math.abs(a.mean));
    rank.forEach((t, i) => { t.mean = Math.sign(t.mean || 1) * (0.05 + 0.02 * i); });
    const box = document.getElementById("md-bars");
    window.__resorted = 0;
    new MutationObserver(() => { if (!window.__resorted) window.__resorted = performance.now(); }).observe(box, { childList: true });
    const at = performance.now();
    const row = document.querySelectorAll("#md-bars .md-row")[1];
    const r = row.getBoundingClientRect();
    row.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse", clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
    T.inject({ type: "styles", styles, observations: (T.facts.status && T.facts.status.observations) || 0 });
    return {
      at,
      held: [...document.querySelectorAll("#md-bars .md-row .md-tech")].map((e) => e.textContent),
      want: th.slice().sort((a, b) => Math.abs(b.mean) - Math.abs(a.mean)).map((t) => String(t.name).split(":")[0]),
    };
  });
  expect(rest.want, "the second reply sorts the weights otherwise").not.toEqual(after.want);
  expect(rest.held, "held while the pointer is there").toEqual(after.want);
  await expect.poll(order, { message: "re-sorted after a rest, the pointer still over the rows" }).toEqual(rest.want);
  const resorted = await page.evaluate(() => window.__resorted);
  console.log(`rest: the weights re-sorted ${Math.round(resorted - rest.at)} ms after the pointer last moved`);
  expect(resorted - rest.at, "the order waited out a second of rest").toBeGreaterThanOrEqual(999);
});
