// TASTE draws what a pick teaches, and LEARNING says what the engine says
// (Plan-005 task 6).
//
// - A pick draws as an arrow from the sound passed to the sound picked, read
//   from the `status` that answers `record_duel` (its `vote` and `choseA`),
//   and every halo moves to the ratings that reply carries
//   (`WasmEngine::belief`). TASTE drew nothing per pick before: the ratings
//   were stored and the map changed only with a refit.
// - A refit (a views post) settles every halo at once.
// - LEARNING's weights, forecasts and math are the engine's numbers: the
//   math reads `model_facts` and the strip `forecasts`, both posted with the
//   calibration; the weights are the styles' θ.
// - Copy as JSON gives back exactly what the engine posted.
// - A mark (a guess's "?", the chosen style's dot) sits in a slot its row
//   keeps, so the label's x is the same with it and without.
// - The track replays the moments the page kept of what the engine posted,
//   after a reload too; SOUND and TASTE show what the prototype's do;
//   pointing at a weight shades the small map by the posted z; the bars
//   move to the styles posted after each pick; REPLAY steps through them.
//
// The engine worker is reached by wrapping `Worker` before main.js runs, as
// taste_marks.spec.js does. Positions on the map are computed with the app's
// own pure layout (taste-geom.js `mapFrame`, `mapLayout`) from the map the
// worker posted, so a check of the canvas looks where the app drew.
const { test, expect } = require("@playwright/test");
const { goLevel } = require("./shell");

const SEED = `(() => { let s = 20261001 >>> 0; Math.random = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();`;

const INIT = `(() => {
  const Orig = window.Worker;
  const workers = (window.__pwWorkers = []);
  const counts = (window.__pwCounts = {});
  const last = (window.__pwLast = {});
  const sent = (window.__pwSent = []);
  function Wrapped(url, opts) {
    const w = new Orig(url, opts);
    w.__pwUrl = String(url);
    workers.push(w);
    const post = w.postMessage.bind(w);
    w.postMessage = (m, t) => { if (m && m.type) sent.push(m); return t ? post(m, t) : post(m); };
    w.addEventListener("message", (e) => {
      const d = e.data;
      if (!d || typeof d.type !== "string") return;
      last[d.type] = d;
      counts[d.type] = (counts[d.type] || 0) + 1;
      if (d.views) window.__pwViews = d.views;
      if (d.status && typeof d.status === "object") window.__pwStatus = d.status;
      if (d.views && d.views.ratings) window.__pwRatings = d.views.ratings;
      if (d.ratings) window.__pwRatings = d.ratings;
      if (d.type === "status" && d.vote && d.vote.kind === "duel" && d.recorded) window.__pwPick = d;
      if (d.type === "status" && d.ratings) (window.__pwStatusLog = window.__pwStatusLog || []).push(d);
      if (d.type === "styles") (window.__pwStylesLog = window.__pwStylesLog || []).push(d);
      const th = (window.__pwThetaLog = window.__pwThetaLog || []);
      if (d.views && d.views.styles) th.push(d.views.styles);
      if (d.type === "styles" && d.styles) th.push(d.styles);
    });
    return w;
  }
  Wrapped.prototype = Orig.prototype;
  window.Worker = Wrapped;
  window.__pwEngine = () => workers.find((w) => /worker\\.js/.test(w.__pwUrl)) || null;
  window.__pwPost = (data) => window.__pwEngine().dispatchEvent(new MessageEvent("message", { data }));
  try {
    for (const k of ["auracle-played", "auracle-bench-tour", "auracle-bank-toured"]) localStorage.setItem(k, "1");
  } catch (_) {}
})();`;

async function boot(page) {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await page.addInitScript(SEED);
  await page.addInitScript(INIT);
  await page.goto("/");
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 150_000 });
  // The warm start's three picks are eighteen, and the fit it asks for.
  await expect(page.locator("#warmstart")).not.toHaveClass(/\bhidden\b/, { timeout: 30_000 });
  const cards = page.locator(".warm-cell .warm-item");
  for (const i of [1, 4, 7]) await cards.nth(i).click();
  await page.locator("#warm-go").click();
  await expect.poll(() => page.evaluate(() => window.__pwCounts.fitted || 0), { timeout: 120_000 }).toBeGreaterThan(0);
  return pageErrors;
}

async function openView(page, view) {
  await goLevel(page, view);
  await expect(page.locator(`#view-${view}`)).toBeVisible();
}

/** Where the map draws each pool sound, by the app's own layout. */
function mapPositions(page, points = null) {
  return page.evaluate(async (given) => {
    const geom = await import("/taste-geom.js");
    const well = document.getElementById("taste-well");
    const W = Math.max(200, well.clientWidth);
    const H = Math.max(160, well.clientHeight);
    const pts = (given || window.__pwViews.map.points).filter((p) => p.id != null);
    // The track along the map's foot, once it shows, moves the sounds up.
    const track = document.getElementById("taste-time").classList.contains("on");
    const f = geom.mapFrame(W, H, pts.length, { track });
    const pos = geom.mapLayout(pts, f.box, f.minD);
    return { s0: f.s0, pos: Object.fromEntries([...pos].map(([id, q]) => [id, q])) };
  }, points);
}

/** Opaque amber on the map's canvas at each CSS-px point (within 1 px): the
 *  arrow is drawn at 0.9 alpha; a halo never passes 0.45. */
function amberAt(page, points) {
  return page.evaluate((pts) => {
    const cv = document.getElementById("taste-crt");
    const ctx = cv.getContext("2d");
    const d = window.devicePixelRatio || 1;
    return pts.map(([x, y]) => {
      const px = ctx.getImageData(Math.round(x * d) - 1, Math.round(y * d) - 1, 3, 3).data;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] > 180 && px[i] > 200 && px[i + 1] > 120 && px[i + 1] < 215 && px[i + 2] < 150) return true;
      }
      return false;
    });
  }, points);
}

/** How many opaque amber pixels the map's canvas holds: an arrow's. */
function arrowPixels(page) {
  return page.evaluate(() => {
    const cv = document.getElementById("taste-crt");
    const px = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] > 180 && px[i] > 200 && px[i + 1] > 120 && px[i + 1] < 215 && px[i + 2] < 150) n += 1;
    }
    return n;
  });
}

/** The halo's alpha at a point: amber-only pixels' alpha, 0–255. */
function haloAlpha(page, x, y) {
  return page.evaluate(([x, y]) => {
    const cv = document.getElementById("taste-crt");
    const d = window.devicePixelRatio || 1;
    const px = cv.getContext("2d").getImageData(Math.round(x * d), Math.round(y * d), 1, 1).data;
    return px[0] >= px[1] && px[1] >= px[2] ? px[3] : 0;
  }, [x, y]);
}

/** Hover a sound on the map and read its card. */
async function plateOf(page, q) {
  const box = await page.locator("#taste-crt").boundingBox();
  await page.mouse.move(box.x + q.x, box.y + q.y);
  await expect(page.locator("#taste-plate")).toHaveClass(/\bon\b/);
  return {
    name: await page.locator("#taste-plate .ts-pl-name").textContent(),
    like: await page.locator("#taste-plate .ts-pl-like").textContent(),
  };
}

const pct = (mean) => Math.round(100 / (1 + Math.exp(-mean)));

test("a pick draws an arrow from the sound passed to the sound picked, from the engine's reply", async ({ page }) => {
  test.setTimeout(300_000);
  const pageErrors = await boot(page);

  // A real pick in EVOLVE: the engine takes it when its undo window closes,
  // and TASTE, opened after, draws it from that reply.
  await page.waitForFunction(() => window.__pwLast.duel && window.__pwLast.duel.pair, null, { timeout: 60_000 });
  await openView(page, "evolve");
  await expect(page.locator("#choose-a")).toBeEnabled({ timeout: 30_000 });
  await page.locator("#choose-a").click();
  await page.waitForFunction(() => window.__pwPick, null, { timeout: 30_000 });
  const real = await page.evaluate(() => {
    const m = window.__pwPick;
    const name = (id) => (window.__pwViews.ranked.find((r) => r.id === id) || {}).name;
    return { picked: name(m.choseA ? m.vote.a : m.vote.b), passed: name(m.choseA ? m.vote.b : m.vote.a) };
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openView(page, "taste");
  await expect(page.locator("#taste-live")).toHaveText(`You picked ${real.picked} over ${real.passed}. Every rating moved.`);
  // …and its arrow, drawn on arrival, goes once its hold is over. The pair is
  // the engine's deal, so the two may sit close: any arrow at all is the
  // check here, and the far pair below checks its geometry.
  await expect.poll(() => arrowPixels(page), { timeout: 5_000 }).toBeGreaterThan(0);
  await expect.poll(() => arrowPixels(page), { timeout: 8_000 }).toBe(0);

  // The arrow itself, on a pair far apart, delivered as the worker delivers
  // a pick's reply. Reduced motion draws it whole at once, for its hold.
  const { pos } = await mapPositions(page);
  const ids = Object.keys(pos).map(Number);
  let far = [ids[0], ids[1]];
  for (const a of ids) for (const b of ids) {
    const d = (p, q) => Math.hypot(pos[p].x - pos[q].x, pos[p].y - pos[q].y);
    if (d(a, b) > d(far[0], far[1])) far = [a, b];
  }
  const [passed, picked] = far;
  await page.evaluate(([a, b]) => {
    window.__pwPost({ type: "status", status: window.__pwStatus, recorded: true, choseA: false, vote: { kind: "duel", a, b }, ratings: window.__pwRatings });
  }, [passed, picked]);
  const f = pos[passed], t = pos[picked];
  const L = Math.hypot(t.x - f.x, t.y - f.y);
  const u = [(t.x - f.x) / L, (t.y - f.y) / L], n = [-u[1], u[0]];
  const at = (s, side = 0) => [f.x + u[0] * s + n[0] * side, f.y + u[1] * s + n[1] * side];
  // Along the shaft, and the head at the picked end: two points 4 px either
  // side of the axis just behind the tip are inside the head, while the same
  // two at the passed end are clear of the shaft.
  await expect.poll(() => amberAt(page, [at(L * 0.3), at(L * 0.5), at(L * 0.7)]), { timeout: 5_000 }).toEqual([true, true, true]);
  expect(await amberAt(page, [at(L - 19, 4), at(L - 19, -4)]), "the head is at the sound picked").toEqual([true, true]);
  expect(await amberAt(page, [at(19, 4), at(19, -4)]), "no head at the sound passed").toEqual([false, false]);
  await expect(page.locator("#taste-live")).toHaveText(/^You picked .+ over .+\. Every rating moved\.$/);
  // It goes when its hold is over: under reduced motion too, every state is shown and then left.
  await expect.poll(() => amberAt(page, [at(L * 0.5)]), { timeout: 6_000 }).toEqual([false]);
  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});

test("every halo moves to the ratings a pick posts, and a refit settles them all at once", async ({ page }) => {
  test.setTimeout(300_000);
  const pageErrors = await boot(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openView(page, "taste");
  const { s0, pos } = await mapPositions(page);
  const ids = Object.keys(pos).map(Number);
  // Three sounds, and the one with the most room around it for the halo check.
  const room = (id) => Math.min(...ids.filter((j) => j !== id).map((j) => Math.hypot(pos[id].x - pos[j].x, pos[id].y - pos[j].y)));
  const lone = ids.slice().sort((a, b) => room(b) - room(a))[0];
  const dist = (a, b) => Math.hypot(pos[a].x - pos[b].x, pos[a].y - pos[b].y);
  const others = ids.filter((id) => id !== lone).sort((a, b) => dist(b, lone) - dist(a, lone)).slice(0, 2);

  // As fitted: each card says the bank's number for it.
  const fit = await page.evaluate(() => Object.fromEntries((window.__pwRatings || window.__pwViews.ratings).ranked.map((r) => [r.id, r.mean])));
  for (const id of [lone, ...others]) {
    expect((await plateOf(page, pos[id])).like).toMatch(new RegExp(`^would like: ${pct(fit[id])}% · `));
  }

  // A pick's reply that rates the lone sound far up and every other far
  // down: every halo moves to it, from that one reply.
  const ring = [pos[lone].x + s0, pos[lone].y];
  const otherRing = [pos[others[0]].x + s0 * 0.6, pos[others[0]].y];
  await page.mouse.move(1, 1);
  const before = await haloAlpha(page, ...ring);
  const otherBefore = await haloAlpha(page, ...otherRing);
  await page.evaluate((lone) => {
    const r = JSON.parse(JSON.stringify(window.__pwRatings || window.__pwViews.ratings));
    for (const row of r.ranked) row.mean = row.id === lone ? 4 : -4;
    window.__pwPost({ type: "status", status: window.__pwStatus, recorded: true, vote: { kind: "stars", id: lone, rating: 5, prev: 0 }, ratings: r });
  }, lone);
  expect((await plateOf(page, pos[lone])).like).toMatch(/^would like: 98% · fairly sure$/);
  for (const id of others) expect((await plateOf(page, pos[id])).like).toMatch(/^would like: 2% · fairly sure$/);
  await page.mouse.move(1, 1);
  await expect.poll(() => haloAlpha(page, ...ring), { timeout: 5_000 }).toBeGreaterThan(before + 10);
  const otherAfter = await haloAlpha(page, ...otherRing);
  expect(otherAfter, `a sound rated far down glows faintly (it was ${otherBefore})`).toBeLessThan(Math.min(12, otherBefore));

  // A refit's views: every halo settles together, and the map says so.
  await page.evaluate(() => {
    const v = JSON.parse(JSON.stringify(window.__pwViews));
    for (const row of v.ratings.ranked) row.mean = 1;
    for (const p of v.map.points) p.utility = 1;
    window.__pwPost({ type: "fitted", views: v, status: window.__pwStatus });
  });
  await expect(page.locator("#taste-live")).toHaveText("It fitted your taste again. Every rating settled.");
  for (const id of [lone, ...others]) expect((await plateOf(page, pos[id])).like).toMatch(/^would like: 73% · fairly sure$/);
  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});

test("LEARNING's weights, forecasts and math are the engine's numbers, and copy as JSON gives them back", async ({ page, context }) => {
  test.setTimeout(300_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const pageErrors = await boot(page);
  // One pick, so there is a forecast to score.
  await page.waitForFunction(() => window.__pwLast.duel && window.__pwLast.duel.pair, null, { timeout: 60_000 });
  await openView(page, "evolve");
  await expect(page.locator("#choose-a")).toBeEnabled({ timeout: 30_000 });
  await page.locator("#choose-a").click();
  await page.waitForFunction(() => window.__pwPick, null, { timeout: 30_000 });
  await page.waitForFunction(() => {
    const c = window.__pwLast.calibration;
    return c && Array.isArray(c.forecasts) && c.forecasts.length > 0 && c.facts;
  }, null, { timeout: 30_000 });
  await openView(page, "learning");

  // The math: every number is the worker's `model_facts`.
  const facts = await page.evaluate(() => window.__pwLast.calibration.facts);
  const theta = await page.evaluate(() => window.__pwViews.styles[0].theta.map((t) => t.name));
  expect(facts.audio, "the audio half is the tagged names").toBe(theta.filter((n) => n.includes(":")).length);
  expect(facts.audio + facts.structural, "φ is every weight").toBe(theta.length);
  expect([facts.audio, facts.structural, facts.draws, facts.styles_max, facts.obs_per_style]).toEqual([18, 26, 500, 5, 20]);
  await page.locator("#md-math-btn").click();
  const math = await page.locator("#md-math-lines").textContent();
  expect(math).toContain(`${facts.audio} audio and ${facts.structural} structural features`);
  expect(math).toContain(`It holds ${facts.draws} draws of w.`);
  expect(math).toContain("every 6 picks it fits them again");
  expect(math).toContain(`one more style for every ${facts.obs_per_style} things it learns from, up to ${facts.styles_max}`);

  // The weights: the chosen style's θ, every one, largest first.
  const shown = await page.evaluate(() => {
    const styles = window.__pwViews.styles.map((s, k) => ({ ...s, k })).filter((s) => s.share >= 0.02);
    const k = Number(document.querySelector('.md-chip-pick[aria-checked="true"]').closest(".md-chip").dataset.k);
    const want = [...styles.find((s) => s.k === k).theta]
      .sort((a, b) => Math.abs(b.mean) - Math.abs(a.mean))
      .map((t) => `${t.mean >= 0 ? "+" : "−"}${Math.abs(t.mean).toFixed(2)}`);
    const got = [...document.querySelectorAll("#md-bars .md-row .md-val")].map((e) => e.textContent);
    return { want, got };
  });
  expect(shown.got.length).toBe(44);
  expect(shown.got).toEqual(shown.want);

  // The forecasts: hits out of the engine's forecasts, scored as it scored them.
  const score = await page.evaluate(() => {
    const fs = window.__pwLast.calibration.forecasts.map((f) => (f.chose_a ? f.p_a : 1 - f.p_a));
    const hits = fs.filter((p) => p > 0.5).length;
    const expected = fs.reduce((s, p) => s + Math.max(p, 1 - p), 0) / fs.length;
    return { hits, n: fs.length, expected: Math.round(expected * 100), was: Math.round((hits / fs.length) * 100) };
  });
  await expect(page.locator("#md-fc .md-big")).toHaveText(`${score.hits} / ${score.n}`);
  await expect(page.locator("#md-fc .md-fcnote")).toHaveText(`expected ${score.expected}% · was ${score.was}%`);

  // Copy as JSON: what the engine posted, back again.
  await page.locator("#md-copy").click();
  await expect(page.locator("#md-copy")).toHaveText(/copied|select and copy/i);
  const text = await page.locator("#md-json").inputValue();
  const back = JSON.parse(text);
  const posted = await page.evaluate(() => ({
    styles: window.__pwViews.styles.map((s) => s.theta.map(({ name, mean, std }) => ({ name, mean, std }))),
    forecasts: window.__pwLast.calibration.forecasts,
    facts: window.__pwLast.calibration.facts,
    ratings: window.__pwRatings.ranked.map(({ id, mean, std }) => ({ id, mean, std })),
  }));
  expect(back.styles.map((s) => s.weights.map(({ name, mean, std }) => ({ name, mean, std })))).toEqual(posted.styles);
  expect(back.forecasts).toEqual(posted.forecasts);
  expect(back.facts).toEqual(posted.facts);
  expect(back.ratings.map(({ id, mean, std }) => ({ id, mean, std }))).toEqual(posted.ratings);
  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});

test("a mark sits left of its label: the label's x is the same with the mark and without", async ({ page }) => {
  test.setTimeout(300_000);
  const pageErrors = await boot(page);
  // Two styles; the first leans on two qualities, one settled and one a guess.
  await page.evaluate(() => {
    const v = JSON.parse(JSON.stringify(window.__pwViews));
    const base = v.styles[0];
    v.styles = [
      { ...base, share: 0.6, theta: [{ name: "n_filter", mean: 0.5, std: 0.1 }, { name: "n_vco", mean: 0.4, std: 0.6 }] },
      { ...base, name: "", share: 0.4, theta: [{ name: "n_reverb", mean: 0.3, std: 0.1 }] },
    ];
    window.__pwPost({ type: "fitted", views: v, status: window.__pwStatus });
  });
  await openView(page, "learning");
  const rows = page.locator("#md-bars .md-row");
  await expect(rows).toHaveCount(2);
  const settled = page.locator("#md-bars .md-row:not(.guess)");
  const guess = page.locator("#md-bars .md-row.guess");
  await expect(guess.locator(".md-mark")).toHaveText("?");
  await expect(settled.locator(".md-mark")).toHaveText("");
  const x = async (row) => (await row.locator(".md-word").boundingBox()).x;
  expect(await x(guess), "a guess's word starts where a settled one does").toBe(await x(settled));
  // A guess is hollow, a settled weight filled (taste-geom `pullMark`).
  const fill = (row) => row.locator(".md-bar").evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(await fill(guess)).toBe("rgba(0, 0, 0, 0)");
  expect(await fill(settled)).not.toBe("rgba(0, 0, 0, 0)");

  // The chosen style's dot: each chip's name sits at the same offset, chosen or not.
  const chips = page.locator(".md-chip");
  await expect(chips).toHaveCount(2);
  const offset = async (chip) => {
    const c = await chip.boundingBox();
    const n = await chip.locator(".md-chip-name").boundingBox();
    return n.x - c.x;
  };
  await expect(chips.nth(0).locator(".md-chip-pick")).toHaveAttribute("aria-checked", "true");
  const chosen = await offset(chips.nth(0));
  const other = await offset(chips.nth(1));
  expect(other).toBe(chosen);
  // Choosing the other moves the dot, not the name.
  await chips.nth(1).locator(".md-chip-pick").click();
  await expect(chips.nth(1).locator(".md-chip-pick")).toHaveAttribute("aria-checked", "true");
  expect(await offset(chips.nth(1))).toBe(chosen);
  await expect(rows).toHaveCount(1);
  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});

test("a style is named on its chip, and the chip's ▶ pressed straight after still plays", async ({ page }) => {
  test.setTimeout(300_000);
  const pageErrors = await boot(page);
  await openView(page, "learning");
  const chip = page.locator(".md-chip").first();
  await expect(chip).toBeVisible();
  const k = Number(await chip.getAttribute("data-k"));
  await chip.locator(".md-chip-name").fill("Night Drive");
  // Pressing ▶ blurs the name, which renames the style; the press must
  // still land on the button it began on.
  const play = chip.locator(".md-chip-play");
  await play.click();
  await expect.poll(() => page.evaluate((k) => window.__pwSent.some((m) => m.type === "set_style_name" && m.k === k && m.name === "Night Drive"), k)).toBe(true);
  await expect(play, "the same ▶, still in the chip, plays").toHaveClass(/\bplaying\b/, { timeout: 30_000 });
  await expect(chip.locator(".md-chip-name")).toHaveValue("Night Drive");
  await expect(chip.locator(".md-chip-pick")).toHaveAttribute("aria-label", /^Night Drive, \d+% of the pool$/);
  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});

/** Picks in EVOLVE, each taken by the engine (its `status`) and followed by
 *  its styles. */
async function picks(page, n) {
  const before = await page.evaluate(() => (window.__pwStatusLog || []).length);
  await page.waitForFunction(() => window.__pwLast.duel && window.__pwLast.duel.pair, null, { timeout: 60_000 });
  await openView(page, "evolve");
  for (let i = 0; i < n; i++) {
    await expect(page.locator("#choose-a")).toBeEnabled({ timeout: 30_000 });
    const taught = Number(await page.locator("#duel-count").textContent());
    await page.locator(i % 2 ? "#choose-b" : "#choose-a").click();
    // A pick counts the moment it is made: TAUGHT moves at once.
    await expect(page.locator("#duel-count")).toHaveText(String(taught + 1));
  }
  // Every pick taken by the engine, and a styles reply that has seen the last.
  await page.waitForFunction((b) => {
    const log = window.__pwStatusLog || [];
    if (log.length < b + 3) return false;
    const obs = log[log.length - 1].status.observations;
    return (window.__pwStylesLog || []).some((x) => x.observations >= obs);
  }, before, { timeout: 60_000 });
}

/** The means a pick's reply posted, by sound. */
const meansOf = (reply) => Object.fromEntries(reply.ratings.ranked.map((r) => [r.id, r.mean]));

/** The track's label, after moving it left until it reads `label`. */
async function scrubTo(page, label) {
  await page.locator("#taste-track").focus();
  for (let i = 0; i < 12; i++) {
    if ((await page.locator("#taste-tlabel").textContent()) === label) return;
    await page.keyboard.press("ArrowLeft");
  }
  await expect(page.locator("#taste-tlabel")).toHaveText(label);
}

/** What the saved session holds of the track. */
function savedMoments(page) {
  return page.evaluate(() => new Promise((done) => {
    const req = indexedDB.open("auracle", 1);
    req.onsuccess = () => {
      const tx = req.result.transaction("kv", "readonly").objectStore("kv").get("state");
      tx.onsuccess = () => done(((tx.result && tx.result.ui && tx.result.ui.taste) || { entries: [] }).entries.length);
      tx.onerror = () => done(0);
    };
    req.onerror = () => done(0);
  }));
}

test("the track replays what the engine posted at each pick, and is still there after a reload", async ({ page }) => {
  test.setTimeout(300_000);
  const pageErrors = await boot(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await picks(page, 3);
  const second = await page.evaluate(() => window.__pwStatusLog[window.__pwStatusLog.length - 2]);
  const posted = meansOf(second);
  const n = second.status.picks;
  const points = await page.evaluate(() => window.__pwViews.map.points);
  await openView(page, "taste");
  await expect(page.locator("#taste-time")).toHaveClass(/\bon\b/);
  await expect(page.locator("#taste-tlabel")).toHaveText(`now · after ${n + 1} picks`);

  // One step back: the second pick's moment, the map as that reply had it,
  // and the third pick's arrow, reversed.
  await scrubTo(page, `after ${n} picks`);
  await expect(page.locator("#taste-sub")).toHaveText("Looking back.");
  await expect.poll(() => arrowPixels(page), { timeout: 5_000 }).toBeGreaterThan(0);
  const { pos } = await mapPositions(page, points);
  const ids = Object.keys(pos).map(Number).slice(0, 3);
  const before = [];
  for (const id of ids) {
    const like = (await plateOf(page, pos[id])).like;
    expect(like).toMatch(new RegExp(`^would like: ${pct(posted[id])}% · `));
    before.push(like);
  }
  await page.mouse.move(1, 1);

  // Saved with the session, and read back on load.
  const kept = await page.evaluate(() => document.getElementById("taste-track").getAttribute("aria-valuemax"));
  await expect.poll(() => savedMoments(page), { timeout: 30_000 }).toBeGreaterThanOrEqual(Number(kept) + 1);
  await page.reload();
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 150_000 });
  await openView(page, "taste");
  await expect(page.locator("#taste-time")).toHaveClass(/\bon\b/);
  // Its end is now, with the picks the engine has: a load adds no moment
  // that counts them wrong.
  await expect(page.locator("#taste-tlabel")).toHaveText(`now · after ${n + 1} picks`);
  await scrubTo(page, `after ${n} picks`);
  for (let i = 0; i < ids.length; i++) {
    expect((await plateOf(page, pos[ids[i]])).like, "the same moment after a reload").toBe(before[i]);
  }
  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});

test("each sound on the map is drawn as its face: taller than it is wide, in the sound's green", async ({ page }) => {
  test.setTimeout(300_000);
  const pageErrors = await boot(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openView(page, "taste");
  const { pos } = await mapPositions(page);
  // A face is a vessel, about 0.6 as wide as it is tall; a dot is as wide as
  // it is tall. Measured on the map's own pixels, in the sound's green.
  const extents = (x, y) => page.evaluate(([x, y]) => {
    const cv = document.getElementById("taste-crt");
    const d = window.devicePixelRatio || 1;
    const g = cv.getContext("2d");
    const green = (px, py) => {
      const [r, gg, b, a] = g.getImageData(Math.round(px * d), Math.round(py * d), 1, 1).data;
      return a > 90 && gg > r + 30 && gg > b;
    };
    let up = 0;
    while (up < 30 && green(x, y - up - 1)) up++;
    let down = 0;
    while (down < 30 && green(x, y + down + 1)) down++;
    let left = 0;
    while (left < 30 && green(x - left - 1, y)) left++;
    let right = 0;
    while (right < 30 && green(x + right + 1, y)) right++;
    return { tall: up + down, wide: left + right };
  }, [x, y]);
  await expect.poll(async () => {
    let faces = 0;
    for (const q of Object.values(pos).slice(0, 12)) {
      const e = await extents(q.x, q.y);
      if (e.tall >= e.wide + 4) faces++;
    }
    return faces;
  }, { timeout: 30_000 }).toBeGreaterThanOrEqual(8);
  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});

test("SOUND shows the sounds as they are, and TASTE dims each by how little it is liked", async ({ page }) => {
  test.setTimeout(300_000);
  const pageErrors = await boot(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openView(page, "taste");
  const tog = page.locator("#taste-tog");
  await expect(tog).toHaveAttribute("aria-pressed", "false");
  // Fitted, SOUND shows the glows (the prototype's `halosOn`).
  await expect(page.locator("#taste-legend")).toHaveClass(/\bon\b/);
  const { pos } = await mapPositions(page);
  // The sound it likes least.
  const least = await page.evaluate(() => {
    const r = window.__pwViews.ratings.ranked;
    return r[r.length - 1].id;
  });
  // How opaque its mark is at the centre: SOUND draws it whole, TASTE at
  // 0.22 + 0.78 × liking.
  const green = () => page.evaluate(([x, y]) => {
    const cv = document.getElementById("taste-crt");
    const d = window.devicePixelRatio || 1;
    return cv.getContext("2d").getImageData(Math.round(x * d), Math.round(y * d), 1, 1).data[3];
  }, [pos[least].x, pos[least].y]);
  const sound = await green();
  await tog.click();
  await expect(tog).toHaveAttribute("aria-pressed", "true");
  await expect.poll(green, { timeout: 5_000 }).toBeLessThan(sound - 40);
  await tog.click();
  await expect(tog).toHaveAttribute("aria-pressed", "false");
  await expect.poll(green, { timeout: 5_000 }).toBe(sound);
  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});

test("pointing at a weight shades the small map by each sound's z on that feature, as the engine posted it", async ({ page }) => {
  test.setTimeout(300_000);
  const pageErrors = await boot(page);
  await openView(page, "learning");
  const first = page.locator("#md-bars .md-row").first();
  await first.hover();
  await expect(page.locator("#md-maplegend")).toHaveText(/^dots: /);
  const shade = await page.evaluate(async () => {
    const geom = await import("/taste-geom.js");
    const v = window.__pwViews;
    const style = v.styles.map((s, k) => ({ ...s, k })).filter((s) => s.share >= 0.02).sort((a, b) => b.share - a.share)[0];
    const name = [...style.theta].sort((a, b) => Math.abs(b.mean) - Math.abs(a.mean))[0].name;
    const cv = document.getElementById("md-map-cv");
    const W = Math.max(160, cv.parentElement.clientWidth), H = Math.max(120, cv.parentElement.clientHeight);
    const pos = geom.miniLayout(v.map.points.filter((p) => p.id != null), W, H, 28);
    const zi = v.features.names.indexOf(name);
    const z = new Map(v.features.rows.map((r) => [r.id, r.z[zi]]));
    const subject = window.__aur && window.__aur.wb ? window.__aur.wb.subjectId : null;
    const ids = [...pos.keys()].filter((id) => id !== subject && z.has(id)).sort((a, b) => z.get(b) - z.get(a));
    const d = window.devicePixelRatio || 1;
    const ctx = cv.getContext("2d");
    const alpha = (id) => ctx.getImageData(Math.round(pos.get(id).x * d), Math.round(pos.get(id).y * d), 1, 1).data[3];
    const hi = ids.slice(0, 3).map(alpha), lo = ids.slice(-3).map(alpha);
    return { hi, lo, zi };
  });
  expect(shade.zi).toBeGreaterThanOrEqual(0);
  expect(Math.min(...shade.hi), `the highest z drawn brightest (${shade.hi} against ${shade.lo})`).toBeGreaterThan(Math.max(...shade.lo) + 60);
  await page.mouse.move(1, 1);
  await expect(page.locator("#md-maplegend")).toHaveText(/^(the arrow|no direction)/);
  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});

/** Each bar's weight as LEARNING shows it, by feature (two weights equal at
 *  four places may sort either way, so rows are matched by name). */
const barsShown = (page) => page.evaluate(() => Object.fromEntries([...document.querySelectorAll("#md-bars .md-row")].map((r) => [
  r.querySelector(".md-tech").textContent, Number(r.querySelector(".md-val").textContent.replace("−", "-")),
])));
/** The worker's θ for one style, by the same names. */
const byName = (theta) => Object.fromEntries(theta.map((t) => [String(t.name).split(":")[0], t.mean]));
function expectBars(shown, theta, tol, what) {
  const want = byName(theta);
  expect(Object.keys(shown).sort(), what).toEqual(Object.keys(want).sort());
  for (const [name, g] of Object.entries(shown)) expect(Math.abs(g - want[name]), `${what}: ${name}`).toBeLessThan(tol);
}
const shownK = (page) => page.evaluate(() => Number(document.querySelector('.md-chip-pick[aria-checked="true"]').closest(".md-chip").dataset.k));

test("the weights move to the styles posted after each pick, and REPLAY steps through them", async ({ page }) => {
  test.setTimeout(300_000);
  const pageErrors = await boot(page);
  await picks(page, 3);
  await openView(page, "learning");
  // Now: the styles the last pick's reply brought, not the fit's.
  const k = await shownK(page);
  const last = await page.evaluate((k) => window.__pwStylesLog.filter((x) => x.styles).pop().styles[k].theta, k);
  const now = await barsShown(page);
  expect(Object.keys(now).length).toBe(44);
  expectBars(now, last, 0.006, "now");

  // REPLAY (R): each step shows θ as the worker posted it at a kept moment,
  // in the order it was posted. The label and the bars are read together.
  const posted = await page.evaluate((k) => window.__pwThetaLog.map((st) => (st[k] ? st[k].theta : null)), k);
  await page.keyboard.press("r");
  await expect(page.locator("#md-replay")).toHaveClass(/\bon\b/);
  let lastAt = -1, steps = 0, label = null;
  while (true) {
    const step = await page.evaluate((prev) => new Promise((done) => {
      const read = () => ({
        on: document.getElementById("md-replay").classList.contains("on"),
        label: document.getElementById("md-replay-at").textContent,
        bars: Object.fromEntries([...document.querySelectorAll("#md-bars .md-row")].map((r) => [
          r.querySelector(".md-tech").textContent, Number(r.querySelector(".md-val").textContent.replace("−", "-")),
        ])),
      });
      const t0 = performance.now();
      const tick = () => {
        const r = read();
        if (!r.on || (r.label && r.label !== prev) || performance.now() - t0 > 5000) done(r);
        else requestAnimationFrame(tick);
      };
      tick();
    }), label);
    if (!step.on) break;
    label = step.label;
    // Which posted θ this step is: the first, after the last step's, within
    // the display's rounding.
    const at = posted.findIndex((th, j) => j > lastAt && th &&
      Object.entries(byName(th)).every(([name, v]) => Math.abs(step.bars[name] - v) < 0.011));
    expect(at, `${label}: the bars are a θ the worker posted, after the last step's`).toBeGreaterThan(lastAt);
    lastAt = at;
    steps += 1;
  }
  expect(steps, "REPLAY showed more than one moment").toBeGreaterThan(1);
  // It ends on now.
  await expect(page.locator("#md-replay")).not.toHaveClass(/\bon\b/, { timeout: 10_000 });
  await expect(page.locator("#md-replay-at")).toHaveText("");
  expectBars(await barsShown(page), last, 0.006, "back to now");
  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});

test("a REPLAY step across a refit is the refit's, with no pick's ghost or light", async ({ page }) => {
  test.setTimeout(300_000);
  const pageErrors = await boot(page);
  const fits = await page.evaluate(() => window.__pwCounts.fitted || 0);
  // Six picks: the sixth refits.
  await picks(page, 6);
  await expect.poll(() => page.evaluate(() => window.__pwCounts.fitted || 0), { timeout: 120_000 }).toBeGreaterThan(fits);
  await openView(page, "learning");
  // The refit may have grown a second style, which no earlier moment had:
  // replay the first, which every refit keeps at its index.
  await page.locator('.md-chip[data-k="0"] .md-chip-pick').click();
  await expect(page.locator("#md-replay")).toBeEnabled();
  await page.keyboard.press("r");
  await expect(page.locator("#md-replay")).toHaveClass(/\bon\b/);
  // Caught on the refit's step: its label names it, and nothing credits a pick.
  const step = await page.evaluate(() => new Promise((done) => {
    const t0 = performance.now();
    const tick = () => {
      const label = document.getElementById("md-replay-at").textContent;
      if (label.startsWith("refit · ")) {
        done({
          label,
          ghosts: document.querySelectorAll("#md-bars .md-ghost.on").length,
          lit: document.querySelectorAll("#md-bars .md-row.moved").length,
        });
      } else if (performance.now() - t0 > 15000) done(null);
      else requestAnimationFrame(tick);
    };
    tick();
  }));
  expect(step, "REPLAY reached the refit's moment").not.toBeNull();
  expect(step.label).toMatch(/^refit · after \d+ picks$/);
  expect(step.ghosts, "no pick's ghost on a refit's step").toBe(0);
  expect(step.lit, "no weight lit as a pick's on a refit's step").toBe(0);
  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});
