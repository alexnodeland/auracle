// Nothing on TASTE or LEARNING moves under the hand (#315, ADR-025's hold
// rule, hand.js):
//
// - With the pointer over the map, a views post (an import's here) moves the
//   halos (the card's number) and no place; the places settle when the
//   pointer leaves, and what the map says of a new map is said then. With a sound's card up, a refit's do the same, and the
//   places settle after a second of rest, the refit said then, not before.
//   (A refit over the map waits in main as a whole, hand.js: that is
//   evolve_refit.spec.js's.)
// - The track's room along the map's foot is kept from the start, so its
//   first appearance moves no sound.
// - A ▶ pressed on a sound's card, or on a style's chip, while a sync or a
//   styles reply lands still plays: the card and the chips are updated in
//   place, not rebuilt.
// - With the pointer over LEARNING's weights only their lengths move; they
//   take their new order, sliding, when it leaves.
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
 *  posted map's points or `points`. */
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
    return out;
  }, points);
}

/** The posted views with each map point moved by `how` ("mirror": x
 *  negated; "swap": x and y exchanged) and every rating at `mean`. */
function movedViews(page, how, mean) {
  return page.evaluate(([how, mean]) => {
    const v = JSON.parse(JSON.stringify(window.__tap.facts.views));
    for (const p of v.map.points) {
      if (how === "mirror") p.x = -p.x;
      else [p.x, p.y] = [p.y, p.x];
      p.utility = mean;
    }
    for (const row of v.ratings.ranked) row.mean = mean;
    return v;
  }, [how, mean]);
}

/** Point at map position `q`. */
async function cardAt(page, q) {
  const box = await page.locator("#taste-crt").boundingBox();
  await page.mouse.move(box.x + q.x, box.y + q.y);
}

const pct = (mean) => Math.round(100 / (1 + Math.exp(-mean)));
const far = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

test("with the pointer over the map an import's views move the halos and no place, and the places settle when it leaves", async ({ page, app }) => {
  await bootFitted(app);
  await openView(page, "taste");
  const { pos, s0 } = await mapPositions(page);
  const ids = Object.keys(pos).map(Number);
  const mirrored = await movedViews(page, "mirror", 1);
  const { pos: pos1 } = await mapPositions(page, mirrored.map.points);
  // The sound the mirror moves furthest.
  const id = ids.slice().sort((a, b) => far(pos1[b], pos[b]) - far(pos1[a], pos[a]))[0];
  expect(far(pos1[id], pos[id]), "the mirrored map moves the sound well clear of its place").toBeGreaterThan(s0 * 2);

  const plate = page.locator("#taste-plate");
  const live = page.locator("#taste-live");
  await cardAt(page, pos[id]);
  await expect(plate).toHaveAttribute("data-id", String(id));
  await page.evaluate(() => { document.getElementById("taste-live").textContent = ""; });

  // The views a taste file's import asks for land with the pointer on the
  // sound: the card's number (its halo's rating) moves in the same task, and
  // the place does not.
  const now = await page.evaluate((v) => {
    window.__tap.inject({ type: "taste_views", views: v });
    return { like: document.querySelector("#taste-plate .ts-pl-like").textContent, said: document.getElementById("taste-live").textContent };
  }, mirrored);
  expect(now.like, "the halos moved to the new views at once").toMatch(new RegExp(`^would like: ${pct(1)}% · `));
  expect(now.said).toBe("");
  // Still pointing there, a little off and back: the sound is still under it.
  for (const dx of [2, -2, 0]) {
    await cardAt(page, { x: pos[id].x + dx, y: pos[id].y });
    await expect(plate).toHaveAttribute("data-id", String(id));
    await expect(plate).toHaveClass(/\bon\b/);
  }

  await expect(live, "nothing said while the places wait").toHaveText("");

  // The pointer leaves: the places settle, and what the map says of a new
  // map once fitted is said now, not before.
  await page.mouse.move(1, 1);
  await expect(live).toHaveText(REFIT_SAID);
  await expect(plate).not.toHaveClass(/\bon\b/);
  await expect.poll(async () => {
    await cardAt(page, pos1[id]);
    return plate.getAttribute("data-id");
  }, { message: "the sound settled at its new place" }).toBe(String(id));
});

test("with a sound's card up a refit moves the halos and no place, and the places settle after a second of rest, said then", async ({ page, app }) => {
  await bootFitted(app);
  await openView(page, "taste");
  const { pos } = await mapPositions(page);
  const swapped = await movedViews(page, "swap", -1);
  const { pos: pos2, s0 } = await mapPositions(page, swapped.map.points);
  const plate = page.locator("#taste-plate");
  const live = page.locator("#taste-live");
  // A card up from the keyboard, the pointer off the map (where main's own
  // hold would keep the whole refit back, hand.js).
  await page.mouse.move(1, 1);
  await page.locator("#taste-crt").focus();
  await page.keyboard.press("ArrowRight");
  await expect(plate).toHaveClass(/\bon\b/);
  await page.keyboard.press("Escape");
  await expect(plate).not.toHaveClass(/\bon\b/);
  await page.evaluate(() => {
    window.__said = 0;
    const live = document.getElementById("taste-live");
    live.textContent = "";
    new MutationObserver(() => { if (live.textContent && !window.__said) window.__said = performance.now(); })
      .observe(live, { childList: true, characterData: true, subtree: true });
  });
  // The card comes up, and the refit lands, in one task, so the rest is
  // counted from the refit's landing.
  const now = await page.evaluate((v) => {
    const cv = document.getElementById("taste-crt");
    const at = performance.now();
    cv.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    window.__tap.inject({ type: "fitted", views: v, status: window.__tap.facts.status });
    return {
      at,
      id: Number(document.getElementById("taste-plate").dataset.id),
      like: document.querySelector("#taste-plate .ts-pl-like").textContent,
      said: document.getElementById("taste-live").textContent,
    };
  }, swapped);
  expect(now.like, "the halos moved to the refit at once").toMatch(new RegExp(`^would like: ${pct(-1)}% · `));
  expect(now.said, "nothing said while the places wait").toBe("");
  expect(far(pos2[now.id], pos[now.id]), "the refit moves the card's sound clear of its place").toBeGreaterThan(s0);
  await expect(live).toHaveText(REFIT_SAID, { timeout: 5_000 });
  const said = await page.evaluate(() => window.__said);
  console.log(`rest: the refit said ${Math.round(said - now.at)} ms after the card came up and it landed`);
  expect(said - now.at, "the places waited out a second of rest").toBeGreaterThanOrEqual(999);
  // Settled: the sound is at its new place.
  await page.keyboard.press("Escape");
  await expect.poll(async () => {
    await cardAt(page, pos2[now.id]);
    return plate.getAttribute("data-id");
  }, { message: "the sound settled at its new place" }).toBe(String(now.id));
});

test("the track's room along the map is kept from the start: its first appearance moves no sound", async ({ page, app }) => {
  // No views but the first: one moment kept, so the track waits for a second.
  await app.hold([{ views: true }]);
  await app.boot(SLOW);
  await expect.poll(async () => (await app.held()).length, { timeout: 30_000 }).toBeGreaterThan(0);
  await page.evaluate(() => {
    const T = window.__tap;
    const holds = T.holds;
    T.release();
    T.holds = holds;
  });
  await openView(page, "taste");
  const time = page.locator("#taste-time");
  await expect(time).not.toHaveClass(/\bon\b/);
  const { pos, noTrack } = await mapPositions(page);
  const ids = Object.keys(pos).map(Number);
  const gap = (id) => Math.hypot(pos[id].x - noTrack[id].x, pos[id].y - noTrack[id].y);
  // The sound the track's room would move most.
  const id = ids.slice().sort((a, b) => gap(b) - gap(a))[0];
  const plate = page.locator("#taste-plate");
  await cardAt(page, pos[id]);
  await expect(plate, "the sound is where the track's room leaves it, before the track shows").toHaveAttribute("data-id", String(id));
  await page.mouse.move(1, 1);
  await expect(plate).not.toHaveClass(/\bon\b/);

  // A second moment (a star's reply): the track shows, and no sound moves.
  await page.evaluate((id) => {
    const r = JSON.parse(JSON.stringify(window.__tap.facts.ratings || window.__tap.facts.views.ratings));
    window.__tap.inject({ type: "status", status: window.__tap.facts.status, recorded: true, vote: { kind: "stars", id, rating: 4, prev: 0 }, ratings: r });
  }, id);
  await expect(time).toHaveClass(/\bon\b/);
  await cardAt(page, pos[id]);
  await expect(plate, "the same place holds the same sound").toHaveAttribute("data-id", String(id));
  console.log(`the track's room moved no sound; without it sound ${id} would have moved ${Math.round(gap(id))} px`);
});

test("a ▶ pressed on a sound's card, or on a style's chip, while a sync lands still plays", async ({ page, app }) => {
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
  // A refit's views and a pick's ratings land between the press and the release.
  await page.evaluate(() => {
    const T = window.__tap;
    const v = JSON.parse(JSON.stringify(T.facts.views));
    T.inject({ type: "fitted", views: v, status: T.facts.status });
    T.inject({ type: "status", status: T.facts.status, recorded: true, vote: { kind: "stars", id: v.map.points[0].id, rating: 4, prev: 0 }, ratings: v.ratings });
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
