// EVOLVE and the bank: what a generation does, shown from the engine's own
// facts (Plan-005 task 4, RFC-006 §6, ADR-012).
//
// - Pointing at EVOLVE POOL marks, in the bank, the seeds a generation would
//   breed from and the sounds it may replace, read from the engine's ratings
//   (`ratings.seeds`, `ratings.may_replace`; `WasmEngine::belief`). Before,
//   only "may be replaced" was marked, by a rule worked out in main.js (the
//   ten lowest by mean), and the seeds not at all.
// - A mark never moves or narrows a row's name: the unheard dot, NEW, seed
//   and may be replaced sit in a column every row has, or on its second line.
//   Before, NEW sat inline and pushed the name 40 px right, and "may be
//   replaced" followed the name and could cut it short.
// - A bred sound's row says which seed it grew from and what changed (its
//   `LineageEvent`), and carries a dot until it is heard.
// - Compare shows a child beside its seed, what changed, what the model
//   rated each when it bred them, and plays both while both exist.
// - A generation's children land in New, each budding from its seed's row; a
//   child the pool would not take buds beside its seed and is gone; Replaced
//   names, and only names, what its end replaced.
//
// The engine's replies are read through the fixture's tap (fixtures.js).
// Where a test needs a state the engine reaches only by chance (a refused
// child, a given pair of seeds), it is posted to main.js as the worker would
// post it (`app.inject`). Sessions are seeded (the films' own Math.random),
// so the pool is the same run to run.
const { test, expect, goLevel } = require("./fixtures");

// What this spec watches besides the engine's replies, wrapped outside the
// tap: the bank's marks as each walk of a generation leaves them, every
// phrase that starts sounding, every bud, and what EVOLVE POOL said.
const WATCH = `(() => {
  // The marks, read the moment main.js has handled the walk's
  // \`refine_child\` (or a save's \`pinned\`, in \`__pwSaves\`), however fast
  // they land: by a listener added after main.js's \`onmessage\` (at the
  // first message, by which time main.js has set it), so it runs after it.
  const marks = (window.__pwMarks = []);
  const saves = (window.__pwSaves = []);
  const ids = (sel) => [...document.querySelectorAll("#bank-list .bank-item" + sel)].map((e) => Number(e.dataset.id)).sort((a, b) => a - b);
  const after = (e) => {
    const d = e.data;
    if (!d || e.__tapInjected) return;
    if (d.type === "pinned") {
      saves.push({
        id: d.id,
        retiring: d.retiring || [],
        breeding: !!document.querySelector("#evolve-btn.breeding"),
        rows: ids("[data-id]"),
        seed: ids(".seed"),
        may: ids(".may-go"),
      });
      return;
    }
    if (d.type !== "refine_child") return;
    const status = window.__tap.facts.status;
    marks.push({
      index: d.index,
      child: d.child,
      generation: d.generation,
      // GENERATIONS as it reads now, and the generation the last status
      // main.js was posted counted (a status predating the open generation
      // counts it out).
      gens: (document.getElementById("gen-count") || {}).textContent,
      statusGen: status ? status.generation : null,
      retiring: d.retiring || [],
      breeding: !!document.querySelector("#evolve-btn.breeding"),
      rows: ids("[data-id]"),
      seed: ids(".seed"),
      may: ids(".may-go"),
      // The words those rows carry.
      words: [...new Set([...document.querySelectorAll("#bank-list .bank-item.may-go .bi-flag")].map((e) => e.textContent))],
    });
  };
  const Orig = window.Worker;
  function Wrapped(url, opts) {
    const w = new Orig(url, opts);
    if (/worker\\.js/.test(String(url))) {
      const first = () => {
        w.removeEventListener("message", first);
        w.addEventListener("message", after);
      };
      w.addEventListener("message", first);
    }
    return w;
  }
  Wrapped.prototype = Orig.prototype;
  window.Worker = Wrapped;
  // Every phrase that starts sounding: what a player hears from a ▶.
  const starts = (window.__pwStarts = []);
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...a) {
    starts.push({ at: performance.now(), dur: this.buffer ? this.buffer.duration : 0 });
    return start.apply(this, a);
  };
  // Every bud as it appears: its words, and where it starts.
  const buds = (window.__pwBuds = []);
  // What EVOLVE POOL said, each time it changed.
  const said = (window.__pwSaid = []);
  document.addEventListener("DOMContentLoaded", () => {
    new MutationObserver((muts) => {
      for (const m of muts)
        for (const n of m.addedNodes) {
          if (!n.classList || !n.classList.contains("bud")) continue;
          const r = n.getBoundingClientRect();
          buds.push({ text: n.textContent, refused: n.classList.contains("refused"), top: r.top, bottom: r.bottom, left: r.left, at: performance.now() });
        }
    }).observe(document.body, { childList: true });
    const btn = document.getElementById("evolve-btn");
    if (btn) new MutationObserver(() => said.push(btn.textContent.trim())).observe(btn, { childList: true, subtree: true, characterData: true });
  });
})();`;

/** Boot, seeded, with the watchers on. `reuseRenders` for a test that does
 *  nothing before the pool is whole: the boot starts with the renders an
 *  earlier one of the seed kept (fixtures.js); one that picks first is cold. */
async function boot(page, app, { reuseRenders = false } = {}) {
  await page.addInitScript(WATCH);
  await app.boot({ random: 20260928, reuseRenders });
}

/** Boot, make six picks in EVOLVE and wait for their refit: a model with
 *  seeds to name and sounds it may replace. */
async function taught(page, app) {
  await boot(page, app);
  await app.teach(6);
  // The picks' undo windows close, and their ratings land.

  await app.engine((timeout) => expect.poll(async () => ((await app.facts()).ratings || { seeds: [] }).seeds.length, { timeout }).toBe(10), { ms: 30_000 });
  await fullPool(app);
}

/** The fill done: the pool at its size. The app is playable at 8 sounds and
 *  fills the rest behind the player, which on a slow machine (CI) can still
 *  be going after six picks and a refit. A generation or a ⚡ child replaces
 *  nothing while the pool is under size, and the ranked rows a test reads at
 *  its start would miss the members still to come. */
async function fullPool(app) {
  const s = (await app.facts()).status;
  console.log(`pool after the picks: ${s && `${s.pool}/${s.pool_target}`}`);
  await app.fullPool({ timeout: 300_000 });
}

/** The engine's facts with the ranked list whole (40 sounds), once they are. */
async function whole(app, what = "status") {
  await app.engine((timeout) => expect.poll(async () => {
    const f = await app.facts();
    return !!(f.ranked && f.ranked.length >= 40 && f[what]);
  }, { timeout }).toBe(true), { ms: 60_000 });
  return app.facts();
}

const rowIds = (page) =>
  page.evaluate(() => [...document.querySelectorAll("#bank-list .bank-item[data-id]")].map((e) => Number(e.dataset.id)));
const marked = (page, cls) =>
  page.evaluate((c) => [...document.querySelectorAll(`#bank-list .bank-item.${c}`)].map((e) => Number(e.dataset.id)).sort((a, b) => a - b), cls);
const sorted = (ids) => [...ids].sort((a, b) => a - b);
const reEsc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const row = (page, id) => page.locator(`#bank-list .bank-item[data-id="${id}"]`);
/** Where a row's name sits in its row, how wide it is, and whether a mark
 *  cut it short. */
const nameBox = (page, id) =>
  page.evaluate((i) => {
    const r = document.querySelector(`#bank-list .bank-item[data-id="${i}"]`);
    const b = r.getBoundingClientRect();
    const n = r.querySelector(".bi-name");
    const q = n.getBoundingClientRect();
    return { x: Math.round((q.left - b.left) * 10) / 10, w: Math.round(q.width * 10) / 10, cut: n.scrollWidth > n.clientWidth + 0.5 };
  }, id);
/** A child landing as the worker posts it (`genLanded`), at the top of New. */
async function landChild(app, child, { seed, generation, index = 0, reason = null } = {}) {
  const s = await app.facts();
  await app.inject({
    type: "refine_child",
    generation: generation ?? (s.status.generation || 0) + 1,
    index,
    child,
    reason,
    seed,
    done: index + 1,
    total: 10,
    ranked: s.ranked,
    lineage: s.lineage,
    retiring: [],
    ratings: s.ratings,
    eta: null,
  });
}

/** Boot to a full pool, without a fit (a state main.js reads ratings into),
 *  and go to EVOLVE, where EVOLVE POOL is. */
async function pooled(page, app) {
  await boot(page, app, { reuseRenders: true });
  await whole(app, "status");
  await goLevel(page, "evolve");
  await expect(page.locator("#evolve-wrap")).toBeVisible();
}
/** The ratings a pick's reply carries (`WasmEngine::belief`), naming the
 *  seeds and what may be replaced. */
async function rate(app, { seeds = [], may = [] }) {
  const s = await app.facts();
  await app.inject({ type: "status", status: s.status, ratings: { ranked: [], seeds, may_replace: may } });
}

test("pointing at EVOLVE POOL marks the seeds the engine names, and only those", async ({ page, app }) => {
  await pooled(page, app);
  const shown = await rowIds(page);
  // Three the engine names as the next generation's seeds (`ratings.seeds`):
  // from the foot of the list, where no rule of the bank's own would look.
  const chosen = shown.slice(-3);
  await rate(app, { seeds: chosen });
  await page.locator("#evolve-wrap").hover();
  await expect.poll(() => marked(page, "seed")).toEqual(sorted(chosen));
  for (const id of chosen) {
    await row(page, id).scrollIntoViewIfNeeded();
    await expect(row(page, id).locator(".bi-flag")).toHaveText("seed");
    await expect(row(page, id).locator(".bi-flag")).toBeVisible();
  }
  // A pick's ratings name others, and the marks follow them at once.
  const next = shown.slice(4, 6);
  await rate(app, { seeds: next });
  await expect.poll(() => marked(page, "seed")).toEqual(sorted(next));
  // Away from the button, nothing is marked.
  await page.mouse.move(5, 5);
  await expect.poll(() => marked(page, "seed")).toEqual([]);
  await expect(page.locator("#bank-list .bi-flag:visible")).toHaveCount(0);
});

test("pointing at EVOLVE POOL marks what the engine says may be replaced", async ({ page, app }) => {
  await pooled(page, app);
  const shown = await rowIds(page);
  // Two the engine says a generation may replace (`ratings.may_replace`):
  // from the top of the list, which the ten lowest by mean never are.
  const chosen = shown.slice(1, 3);
  await rate(app, { may: chosen });
  await page.locator("#evolve-wrap").hover();
  await expect.poll(() => marked(page, "may-go")).toEqual(sorted(chosen));
  await expect(row(page, chosen[0]).locator(".bi-flag")).toHaveText("may be replaced");
  await expect(row(page, chosen[0]).locator(".bi-flag")).toBeVisible();
  // The dashed rail carries it too, not only the word.
  expect(await row(page, chosen[0]).evaluate((e) => getComputedStyle(e).borderLeftStyle)).toBe("dashed");
  const next = shown.slice(-2);
  await rate(app, { may: next });
  await expect.poll(() => marked(page, "may-go")).toEqual(sorted(next));
  await page.mouse.move(5, 5);
  await expect.poll(() => marked(page, "may-go")).toEqual([]);
});

// At the widest bank (1440 px) and the narrowest it has (1080 px, 200 px).
for (const [width, height] of [[1440, 900], [1080, 800]]) {
test(`a mark never moves or narrows a row's name: the unheard dot, NEW, seed and may be replaced (${width} px)`, async ({ page, app }) => {
  await page.setViewportSize({ width, height });
  await pooled(page, app);
  const shown = await rowIds(page);
  const [seed, may, kid] = [shown[1], shown[2], shown[3]];
  const before = { seed: await nameBox(page, seed), may: await nameBox(page, may), kid: await nameBox(page, kid) };

  // Seed and may be replaced, while EVOLVE POOL is pointed at.
  await rate(app, { seeds: [seed], may: [may] });
  await page.locator("#evolve-wrap").hover();
  await expect(row(page, seed)).toHaveClass(/\bseed\b/);
  await expect(row(page, may)).toHaveClass(/\bmay-go\b/);
  const hovered = { seed: await nameBox(page, seed), may: await nameBox(page, may) };
  await page.mouse.move(5, 5);

  // NEW and the unheard dot: the sound lands as a child of a generation.
  await landChild(app, kid, { seed });
  await expect(row(page, kid).locator(".bi-new")).toHaveText("new");
  await expect(row(page, kid).locator(".bi-dot")).toBeVisible();
  const landed = await nameBox(page, kid);
  // The dot sits left of the name, in the gap before it, clear of both.
  const gap = await row(page, kid).evaluate((r) => {
    const d = r.querySelector(".bi-dot").getBoundingClientRect();
    const n = r.querySelector(".bi-name").getBoundingClientRect();
    const t = r.querySelector(".bi-new").getBoundingClientRect();
    return { dotLeft: d.left, dotRight: d.right, nameLeft: n.left, tagRight: t.right };
  });

  // Heard: the dot goes, and the name stays where it was. (Its ▶ is among
  // the actions the row shows when pointed at.)
  await row(page, kid).hover();
  await row(page, kid).locator(".bi-hear").click();
  await page.mouse.move(5, 5);
  await app.engine((timeout) => expect(row(page, kid).locator(".bi-dot")).toHaveCount(0, { timeout }), { ms: 30_000 });
  const heard = await nameBox(page, kid);
  console.log(`name boxes: ${JSON.stringify({ before, hovered, landed, heard, gap })}`);

  for (const [k, box] of [["seed", hovered.seed], ["may", hovered.may]]) {
    expect(box.x, `${k}: the name moved`).toBe(before[k].x);
    expect(box.w, `${k}: the name narrowed`).toBe(before[k].w);
    expect(box.cut, `${k}: a mark cut the name short`).toBe(before[k].cut);
  }
  for (const box of [landed, heard]) {
    expect(box.x, "the name moved with NEW or the dot").toBe(before.kid.x);
    expect(box.w, "the name narrowed with NEW or the dot").toBe(before.kid.w);
    expect(box.cut).toBe(before.kid.cut);
  }
  expect(gap.dotRight).toBeLessThanOrEqual(gap.nameLeft);
  expect(gap.dotLeft).toBeGreaterThanOrEqual(gap.tagRight);

  // Each word a row can carry while EVOLVE POOL is pointed at sits over the
  // row's end, inside the row ("will be replaced" shows only while a
  // generation runs, so each word is measured in the flag of a marked row),
  // and gives that end to the row's actions when they show: never under or
  // over save and cut. EVOLVE POOL focused marks the rows, and the pointer on
  // the row shows its actions.
  await rate(app, { may: [may] });
  await page.locator("#evolve-btn").focus();
  await expect(row(page, may)).toHaveClass(/\bmay-go\b/);
  await expect(row(page, may).locator(".bi-flag")).toBeVisible();
  for (const word of ["seed", "may be replaced", "will be replaced"]) {
    const fit = await row(page, may).evaluate((r, w) => {
      const f = r.querySelector(".bi-flag");
      f.textContent = w;
      const fl = f.getBoundingClientRect();
      const rb = r.getBoundingClientRect();
      return { flagLeft: fl.left, flagRight: fl.right, rowLeft: rb.left, rowRight: rb.right };
    }, word);
    console.log(`${width} px, "${word}": ${JSON.stringify(fit)}`);
    expect(fit.flagRight, `"${word}" runs past the row`).toBeLessThanOrEqual(fit.rowRight);
    expect(fit.flagLeft, `"${word}" runs past the row`).toBeGreaterThanOrEqual(fit.rowLeft);
  }
  await row(page, may).hover();
  await expect(row(page, may).locator(".bi-acts")).toHaveCSS("opacity", "1");
  await expect(row(page, may).locator(".bi-flag")).toBeHidden();
  await page.mouse.move(5, 5);
});
}

test("a child keeps its unheard dot across a reload, and loses it when its phrase is heard", async ({ page, app }) => {
  await pooled(page, app);
  const shown = await rowIds(page);
  const [seed, kid] = [shown[0], shown[5]];
  await landChild(app, kid, { seed });
  await expect(row(page, kid).locator(".bi-dot")).toBeVisible();
  await expect(row(page, kid)).toHaveAttribute("aria-label", /not heard yet/);
  // The autosave (2.5 s after a change) writes it to this browser's storage;
  // the page then reloads.
  await app.engine((timeout) => expect.poll(async () => ((await app.savedUi()) || {}).unheard || [], { timeout }).toContain(kid), { ms: 30_000 });
  await page.reload();

  await app.booted();
  await app.engine((timeout) => expect(row(page, kid).locator(".bi-dot")).toBeVisible({ timeout }), { ms: 30_000 });
  // Its phrase plays: heard.
  const starts = await page.evaluate(() => window.__pwStarts.length);
  await row(page, kid).hover();
  await row(page, kid).locator(".bi-hear").click();
  await app.engine((timeout) => expect.poll(() => page.evaluate(() => window.__pwStarts.length), { timeout }).toBeGreaterThan(starts), { ms: 30_000 });
  await expect(row(page, kid).locator(".bi-dot")).toHaveCount(0);
  await expect(row(page, kid)).not.toHaveAttribute("aria-label", /not heard yet/);
});

test("Compare shows a child beside its seed, what changed and both ratings, and plays both while both exist", async ({ page, app }) => {
  await boot(page, app, { reuseRenders: true });
  const s = await whole(app, "views");
  const [seed, kid] = [s.ranked[1], s.ranked[3]];
  // The lineage event the engine records for a bred child (`LineageEvent`):
  // its seed, what changed, and what the model rated each when it bred them.
  const ev = {
    generation: 1, kind: "refine", parent_id: seed.id, child_id: kid.id,
    diff: [
      { addr: "node/0#cut", before: "0.41", after: "0.62" },
      { addr: "node/1#op", before: null, after: "delay" },
      { addr: "node/1#time", before: null, after: "0.30" },
    ],
    parent_utility: 0.4, child_utility: 0.1,
  };
  await app.inject({ type: "taste_views", views: { ...s.views, lineage: [...(s.lineage || []), ev] } });
  const from = row(page, kid.id).locator(".bi-from");
  await expect(from).toHaveText(new RegExp(`^from ${reEsc(seed.name)} · \\+delay, cutoff `));
  await from.click();

  const box = page.locator("#compare");
  await expect(box).toBeVisible();
  await expect(page.locator("#compare-title")).toHaveText(`${kid.name} · what changed`);
  await expect(page.locator("#compare-say")).toHaveText(`Grown from ${seed.name} in generation 1.`);
  await expect(page.locator("#compare-diff li")).toHaveText([/^\+delay$/, /^cutoff .+ → .+$/]);
  // Both ratings, each with its word: never a bare percentage.
  await expect(page.locator("#compare-rated")).toContainText(
    new RegExp(`^when it bred them, it rated ${reEsc(seed.name)} 60% · leaning and ${reEsc(kid.name)} 52% · a hunch`),
  );
  await expect(page.locator("#compare-rated .lin-explore")).toHaveText("exploring");

  // Both play, each a transport, lit while its phrase sounds.
  const hearSeed = box.locator(`.cmp-hear[data-id="${seed.id}"]`);
  const hearKid = box.locator(`.cmp-hear[data-id="${kid.id}"]`);
  const n0 = await page.evaluate(() => window.__pwStarts.length);
  await hearSeed.click();
  await app.engine((timeout) => expect(hearSeed).toHaveClass(/\bplaying\b/, { timeout }), { ms: 30_000 });
  await hearKid.click();
  await app.engine((timeout) => expect(hearKid).toHaveClass(/\bplaying\b/, { timeout }), { ms: 30_000 });
  await expect(hearSeed).not.toHaveClass(/\bplaying\b/);
  expect(await page.evaluate(() => window.__pwStarts.length)).toBeGreaterThanOrEqual(n0 + 2);
  // The figure is drawn from both phrases.
  await expect(page.locator("#compare-fig")).toHaveAttribute("aria-label", `${kid.name} grown from ${seed.name}`);

  // The seed replaced: its tree is gone, so it is a name with nothing to play.
  const now = await app.facts();
  await app.inject({ type: "taste_views", views: { ...now.views, ranked: now.ranked.filter((r) => r.id !== seed.id), lineage: [...(now.lineage || []), ev] } });
  await expect(box.locator(".cmp-gone")).toHaveText(`${seed.name} · replaced`);
  await expect(hearSeed).toHaveCount(0);
  await expect(hearKid).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(box).toBeHidden();
});

test("Compare opens from the keyboard: c on a bred sound in the bank, and Esc hands the keys back", async ({ page, app }) => {
  await boot(page, app, { reuseRenders: true });
  const s = await whole(app, "views");
  const [seed, kid, plain] = [s.ranked[1], s.ranked[3], s.ranked[2]];
  const ev = {
    generation: 1, kind: "refine", parent_id: seed.id, child_id: kid.id,
    diff: [{ addr: "node/1#op", before: null, after: "delay" }],
    parent_utility: 0.4, child_utility: 0.5,
  };
  await app.inject({ type: "taste_views", views: { ...s.views, lineage: [...(s.lineage || []), ev] } });
  await expect(row(page, kid.id).locator(".bi-from")).toBeVisible();
  // The bank is one tab stop; the cursor walks to a row.
  const cursorTo = async (id) => {
    await page.locator("#bank-list").focus();
    for (let i = 0; i < 45; i++) {
      const at = await page.evaluate(() => document.querySelector("#bank-list .bank-item.kbd")?.dataset.id ?? null);
      if (at === String(id)) return;
      await page.keyboard.press("ArrowDown");
    }
    throw new Error(`the cursor never reached ${id}`);
  };
  // A sound with no seed has nothing to compare.
  await cursorTo(plain.id);
  await page.keyboard.press("c");
  await expect(page.locator("#compare")).toBeHidden();
  // A bred one opens Compare, which takes the focus.
  await cursorTo(kid.id);
  await page.keyboard.press("c");
  await expect(page.locator("#compare")).toBeVisible();
  await expect(page.locator("#compare-title")).toHaveText(`${kid.name} · what changed`);
  await expect(page.locator("#compare")).toBeFocused();
  // Esc closes it, and the bank has the keys again.
  await page.keyboard.press("Escape");
  await expect(page.locator("#compare")).toBeHidden();
  await expect(page.locator("#bank-list")).toBeFocused();
  await page.keyboard.press("c");
  await expect(page.locator("#compare")).toBeVisible();
});

test("a ⚡ child that replaced nothing leaves the last generation's Replaced as it was", async ({ page, app }) => {
  await pooled(page, app);
  const s = await app.facts();
  const gone = s.ranked[s.ranked.length - 1];
  const left = s.ranked.filter((r) => r.id !== gone.id);
  const views = { ...s.views, ranked: left };
  // A generation's end replaced one sound (here a restored pool's trim, as
  // the worker posts it).
  await app.inject({ type: "pool_trimmed", retired: [gone.id], views, status: { ...s.status, generation: 1 } });
  const fold = page.locator("#bank-list .bank-group.replaced .bg-fold");
  // The bank redraws as the engine answers (the child opened below, its
  // bench), so a node can be swapped mid-scroll: the scroll is retried on
  // the heading as it is then.
  const toFold = () => expect(async () => { await fold.scrollIntoViewIfNeeded({ timeout: 2_000 }); }).toPass({ timeout: 15_000 });
  await toFold();
  await expect(fold.locator(".bg-label")).toHaveText("replaced · generation 1");
  await expect(fold.locator(".bg-n")).toHaveText(/^1 /);
  // Then a ⚡ child lands with the pool not full: nothing displaced.
  await app.inject({
    type: "evolved_from", seedId: left[0].id, childId: left[1].id, reason: null,
    views, status: { ...s.status, generation: 2 },
  });
  await toFold();
  await expect(fold.locator(".bg-label")).toHaveText("replaced · generation 1");
  await fold.click();
  await expect(page.locator("#bank-list .replaced-names span")).toHaveText([gone.name]);
});

test("pointing at EVOLVE POOL while ⚡ walks marks its seed and the one sound its child would replace", { tag: "@slow" }, async ({ page, app }) => {
  // With no generation open ⚡'s child replaces at once the lowest unsaved
  // sound other than its seed (\`absorb_from\`, \`evict_to_size\`), which is
  // the first of \`ratings.may_replace\` with the pool full. It marked the seed
  // and nothing else.
  test.setTimeout(240_000);
  await taught(page, app);
  await goLevel(page, "patch");
  await app.engine((timeout) => expect(page.locator("#rack-evolve")).toBeEnabled({ timeout }), { ms: 60_000 });
  await page.locator("#rack-evolve").click();
  const seedId = (await app.sent("refine_from")).pop().id;
  await goLevel(page, "evolve");
  await page.locator("#evolve-wrap").hover();
  // Read the marks against the ratings main.js holds as it draws them.
  const read = () => page.evaluate(() => ({
    walking: !window.__tap.last.evolved_from,
    seed: [...document.querySelectorAll("#bank-list .bank-item.seed")].map((e) => Number(e.dataset.id)),
    may: [...document.querySelectorAll("#bank-list .bank-item.may-go")].map((e) => Number(e.dataset.id)),
    words: [...document.querySelectorAll("#bank-list .bank-item.may-go .bi-flag")].map((e) => e.textContent),
    mayReplace: window.__tap.facts.ratings.may_replace,
    status: window.__tap.facts.status,
  }));
  await expect.poll(async () => (await read()).seed.length, { timeout: 30_000 }).toBe(1);
  const m = await read();
  test.skip(!m.walking, "⚡ landed before the marks were read");
  expect(m.seed).toEqual([seedId]);
  expect(m.status.pool, "the pool is not full, so ⚡ would replace nothing").toBeGreaterThanOrEqual(m.status.pool_target);
  // Which of the ratings' \`may_replace\` its child would replace (the seed
  // passed over, as many as it puts the pool over size) is
  // apps/web/tests/marks.test.mjs's; here, that the page marks them from
  // what the engine sent, while ⚡ walks.
  expect(m.may.length, "nothing marked as what ⚡'s child would replace").toBeGreaterThan(0);
  expect(m.may, "the seed marked as what its child would replace").not.toContain(seedId);
  expect(m.may.filter((id) => !m.mayReplace.includes(id)), "marked, though not the engine's may_replace").toEqual([]);
  expect(m.words).toEqual(m.may.map(() => "may be replaced"));
  // When the child lands, what it replaced is what was marked (the model has
  // not moved: no pick since).
  await page.mouse.move(5, 5);
  const done = await app.reply("evolved_from", { timeout: 300_000 });
  console.log(`⚡ from ${seedId}: child ${done.childId}, reason ${done.reason}; marked ${JSON.stringify(m.may)}`);
  if (done.childId > 0) {
    const pool = new Set(done.views.ranked.map((r) => r.id));
    expect(m.may.filter((id) => !pool.has(id)), "what ⚡'s child replaced").toEqual(m.may);
  }
});

test("Compare lists every change a long walk made, and the list scrolls", async ({ page, app }) => {
  // A 40-step walk can change two dozen sites (26 in one review run). Compare
  // showed the first eight and "+18 more"; the release notes say every change.
  await boot(page, app, { reuseRenders: true });
  const s = await whole(app, "views");
  const [seed, kid] = [s.ranked[1], s.ranked[3]];
  const mods = Array.from({ length: 14 }, (_, i) => `mod${i + 1}`);
  const ev = {
    generation: 1, kind: "refine", parent_id: seed.id, child_id: kid.id,
    diff: mods.map((m, i) => ({ addr: `node/${i}#op`, before: null, after: m })),
    parent_utility: 0.4, child_utility: 0.5,
  };
  await app.inject({ type: "taste_views", views: { ...s.views, lineage: [...(s.lineage || []), ev] } });
  // The row's line keeps to three and a count.
  await expect(row(page, kid.id).locator(".bi-from")).toHaveText(`from ${seed.name} · +mod1, +mod2, +mod3, +11 more`);
  await row(page, kid.id).locator(".bi-from").click();
  await expect(page.locator("#compare")).toBeVisible();
  await expect(page.locator("#compare-diff li")).toHaveText(mods.map((m) => `+${m}`));
  // Long, it scrolls inside Compare, and Compare stays in the window.
  const fit = await page.evaluate(() => {
    const l = document.getElementById("compare-diff");
    const b = document.getElementById("compare").getBoundingClientRect();
    return { scrolls: l.scrollHeight > l.clientHeight + 1, top: b.top, bottom: b.bottom, h: window.innerHeight };
  });
  expect(fit.scrolls, "fourteen changes did not scroll").toBe(true);
  expect(fit.top).toBeGreaterThanOrEqual(0);
  expect(fit.bottom).toBeLessThanOrEqual(fit.h);
  await page.locator("#compare-diff li").last().scrollIntoViewIfNeeded();
  await expect(page.locator("#compare-diff li").last()).toBeInViewport();
});

test("a sound saved while a generation runs loses its mark, and the one that will go instead gains it", { tag: "@slow" }, async ({ page, app }) => {
  // A save takes a sound out of what the running generation's end will
  // replace (\`eviction_order\` passes over saved sounds), and the next lowest
  // unsaved one takes its place. Only \`refine_child\` carried \`retiring\`, so
  // the saved row kept "will be replaced" and the other went unmarked until
  // the next walk landed, or for good after the last.
  test.setTimeout(240_000);
  await taught(page, app);
  await page.locator("#evolve-wrap").hover();
  await page.locator("#evolve-btn").click(); // the pointer stays on EVOLVE POOL
  await app.engine((timeout) => expect.poll(() => page.evaluate(() => window.__pwMarks.some((s) => s.breeding && s.may.length > 0)), { timeout }).toBe(true), { ms: 400_000 });
  const snap = await page.evaluate(() => window.__pwMarks.filter((s) => s.breeding && s.may.length > 0).pop());
  const target = snap.may[0];
  // Saved from the keyboard, so the pointer stays on EVOLVE POOL.
  await page.locator("#bank-list").focus();
  for (let i = 0; i < 60; i++) {
    const at = await page.evaluate(() => document.querySelector("#bank-list .bank-item.kbd")?.dataset.id ?? null);
    if (at === String(target)) break;
    await page.keyboard.press("ArrowDown");
  }
  const breeding = await page.evaluate(() => document.getElementById("evolve-btn").classList.contains("breeding"));
  test.skip(!breeding, "the generation ended before the save");
  const t0 = await app.now();
  await page.keyboard.press("m");
  const pinned = await app.reply("pinned", { after: t0, timeout: 10_000 });
  expect(pinned.ok, "the save was refused").toBe(true);
  expect(pinned.retiring, "a save while a generation runs carries what its end will replace").toBeTruthy();
  expect(pinned.retiring).not.toContain(target);
  // The marks as main.js left them on this save's reply (WATCH's snapshot,
  // taken as it handled \`pinned\`, so a generation that ends a moment later
  // cannot clear them first): what this save says its end will replace.
  await expect.poll(() => page.evaluate((id) => window.__pwSaves.some((s) => s.id === id), target)).toBe(true);
  const saved = await page.evaluate((id) => window.__pwSaves.filter((s) => s.id === id).pop(), target);
  expect(saved.breeding, "the generation ended before the save's reply").toBe(true);
  // That the marks are the reply's list whole (a seed marked a seed, never
  // also as one that will go) is apps/web/tests/marks.test.mjs's; here, that
  // the page took the save's reply for them.
  expect(saved.may.filter((id) => !saved.retiring.includes(id)), "marked, though the save says it will not be replaced").toEqual([]);
  expect(saved.may, "the saved sound kept its mark").not.toContain(target);
  // One sound not marked before is marked now: the one that will go instead.
  console.log(`saved ${target}; marked before ${JSON.stringify(snap.may)}, after ${JSON.stringify(saved.may)}`);
  expect(saved.may.some((id) => !snap.may.includes(id)), "no sound took the saved one's place").toBe(true);
  await page.mouse.move(5, 5);
  const stop = page.locator("#evolve-stop");
  if (await stop.isVisible()) await stop.click({ timeout: 5_000 }).catch(() => {});
  await app.engine((timeout) => expect(page.locator("#evolve-btn")).not.toHaveClass(/\bbreeding\b/, { timeout }), { ms: 120_000 });
});

test("GENERATIONS counts a generation from its first child, with no pick since it opened", { tag: "@slow" }, async ({ page, app }) => {
  // The guide says GENERATIONS counts a generation once its first child
  // lands. With no status posted since the generation opened (no pick), it
  // went on reading the count from before it, 0 with three children in New.
  test.setTimeout(240_000);
  await taught(page, app);
  await expect(page.locator("#gen-count")).toHaveText("0");
  await page.locator("#evolve-btn").click();
  await page.mouse.move(5, 5);
  await app.engine((timeout) => expect.poll(() => page.evaluate(() => window.__pwMarks.some((s) => s.child > 0)), { timeout }).toBe(true), { ms: 400_000 });
  const walks = await page.evaluate(() => window.__pwMarks.slice());
  const first = walks.findIndex((s) => s.child > 0);
  console.log(`walks: ${JSON.stringify(walks.map((s) => [s.index, s.child, s.breeding, s.gens, s.statusGen]))}`);
  // What this tests needs the first child to land while the generation runs
  // and before any status counting it (none is asked for here, but one can
  // come unasked): otherwise there is nothing to test, not a failure.
  test.skip(!walks[first].breeding, "the first child landed after the generation ended");
  test.skip(!(walks[first].statusGen < walks[first].generation), "a status counting the generation came first");
  // Read the moment each walk landed: nothing counted before its first
  // child, and the generation counted from it on.
  for (const s of walks.slice(0, first)) expect(s.gens, `after walk ${s.index}, no child yet`).toBe(String(s.generation - 1));
  for (const s of walks.slice(first).filter((w) => w.breeding)) expect(s.gens, `after walk ${s.index}`).toBe(String(s.generation));
  const stop = page.locator("#evolve-stop");
  if (await stop.isVisible()) await stop.click({ timeout: 5_000 }).catch(() => {});
  await app.engine((timeout) => expect(page.locator("#evolve-btn")).not.toHaveClass(/\bbreeding\b/, { timeout }), { ms: 120_000 });
  await expect(page.locator("#gen-count")).toHaveText(String(walks[first].generation));
});

test("a child the pool would not take buds beside its seed and is gone, and EVOLVE POOL says why", { tag: "@slow" }, async ({ page, app }) => {
  await taught(page, app);
  const seeds = (await app.facts()).ratings.seeds;
  await page.locator("#evolve-btn").click();
  const gen = (await app.reply("refine_progress", { timeout: 30_000 })).generation;
  const seedRow = row(page, seeds[0]);
  await seedRow.scrollIntoViewIfNeeded();
  const at = await seedRow.boundingBox();

  // The first walk's child, rated below the pool (`not_admitted`). The fake
  // \`refine_child\` is handled as a real one, so it also moves main.js's
  // count of walks back (\`breeding.done\`) and of children bred and not
  // kept (\`bredBelow.n\`) beside the real walks': this test reads neither.
  await landChild(app, 0, { seed: seeds[0], generation: gen, reason: "not_admitted" });
  // (Read from what the button said, not what it says: a real walk may land
  // a moment later and say its own.)
  await expect.poll(() => page.evaluate(() => window.__pwSaid.includes("walk 1 of 10rated below the pool"))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__pwBuds.filter((b) => b.refused).length)).toBe(1);
  const bud = (await page.evaluate(() => window.__pwBuds.filter((b) => b.refused)))[0];
  console.log(`refused bud ${JSON.stringify(bud)}; its seed's row ${JSON.stringify(at)}`);
  expect(bud.text).toBe("rated below the pool");
  // Beside its seed: level with the seed's row, and starting at its name.
  expect(bud.top).toBeGreaterThanOrEqual(at.y - 1);
  expect(bud.bottom).toBeLessThanOrEqual(at.y + at.height + 1);
  // And gone: the engine dropped it.
  await expect(page.locator(".bud.refused")).toHaveCount(0);

  // With motion reduced, nothing buds, and the button still says it.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await landChild(app, 0, { seed: seeds[1], generation: gen, index: 1, reason: "not_admitted" });
  await expect.poll(() => page.evaluate(() => window.__pwSaid.includes("walk 2 of 10rated below the pool"))).toBe(true);
  await app.quiet();
  expect(await page.evaluate(() => window.__pwBuds.filter((b) => b.refused).length)).toBe(1);

  // Stopped, unless its real walks have already ended it.
  const stop = page.locator("#evolve-stop");
  if (await stop.isVisible()) await stop.click({ timeout: 5_000 }).catch(() => {});
  await app.engine((timeout) => expect(page.locator("#evolve-btn")).not.toHaveClass(/\bbreeding\b/, { timeout }), { ms: 60_000 });
});

// The generation is the spec's (#169): its `refine` never reaches the engine
// (`app.stall`), and its replies are posted to main as the worker posts them,
// each carrying the request's number and all but `refined` marked `more`
// (web-runtime.md § The worker's replies). Its seeds and children are rows at
// the top of the list, in view; what its end replaces is the two rows at the
// foot. So every branch runs on every run: a child budding from its seed, one
// landing under reduced motion and marked to be replaced, one bred and then
// replaced at the end, and the sounds the end replaced. A real generation's
// children landed only when the seeded walks bred and kept something, and its
// buds only when they landed in view. Which seeds a generation takes and what
// it may replace are the engine's (native
// `next_seeds_and_may_replace_are_what_a_generation_does`), and so is the
// lineage a child leaves, its seed, what changed and both ratings
// (`a_refined_childs_lineage_names_its_seed_what_changed_and_both_ratings`);
// evolve_breeds_beside_you runs a real generation end to end.
test("a generation's children land in New with their seed and what changed, and Replaced names what it replaced", async ({ page, app }) => {
  await pooled(page, app);
  const s = await whole(app, "views");
  const shown = await rowIds(page);
  const nameOf = (id) => s.ranked.find((r) => r.id === id).name;
  // From the top of the list, in view: the generation's three seeds, and the
  // two sounds that stand in for its children. From the foot: the two its end
  // replaces.
  const seeds = shown.slice(0, 3);
  const [kidA, kidB] = shown.slice(3, 5);
  const gone = shown.slice(-2);
  const gen = (s.status.generation || 0) + 1;
  const ev = (seed, kid, diff) => ({ generation: gen, kind: "refine", parent_id: seed, child_id: kid, diff, parent_utility: 0.4, child_utility: 0.5 });
  const lineage = [...(s.lineage || []), ev(seeds[0], kidA, [{ addr: "node/1#op", before: null, after: "delay" }])];
  // The engine's own news about the pool (a fill's rows, a pick's ratings)
  // waits until the test ends: the bank is the generation's.
  await app.hold([{ views: true }, { ranked: true }, { ratings: true }, { lineage: true }]);

  // Pressed, with the pointer left on it.
  await page.locator("#evolve-wrap").hover();
  await app.stall("refine");
  await page.locator("#evolve-btn").click();
  const { rid } = await app.stalled();
  expect(rid, "main numbers every request").toBeGreaterThan(0);
  const walk = (index, child, seed, { reason = null, retiring = [], lin = lineage } = {}) =>
    app.inject({
      type: "refine_child", re: rid, more: true, generation: gen, index, child, reason, seed,
      done: index + 1, total: seeds.length, ranked: s.ranked, lineage: lin, retiring, ratings: s.ratings, eta: null,
    });
  await app.inject({
    type: "refine_progress", re: rid, more: true, generation: gen, done: 0, total: seeds.length, walked: 0,
    eta: null, farm: true, workers: 2, seeds,
  });
  // While it runs, EVOLVE POOL marks this generation's seeds (its progress
  // posted them).
  await expect.poll(() => marked(page, "seed")).toEqual(sorted(seeds));

  // The first walk's child: at the top of the bank under New, with its seed
  // and what changed, and a dot until heard. It buds from its seed's row.
  await walk(0, kidA, seeds[0], { retiring: gone });
  await expect(page.locator("#bank-list .bank-group.new .bg-label")).toHaveText(`new · generation ${gen}`);
  await expect(page.locator("#bank-list .bank-group.new .bg-n")).toHaveText("1");
  await expect(row(page, kidA).locator(".bi-from")).toHaveText(`from ${nameOf(seeds[0])} · +delay`);
  await expect(row(page, kidA).locator(".bi-new")).toHaveText("new");
  await expect(row(page, kidA).locator(".bi-dot")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__pwBuds.filter((b) => !b.refused).map((b) => b.text))).toEqual([nameOf(kidA)]);
  // Out of its seed's row: level with it, where it starts.
  const bud = (await page.evaluate(() => window.__pwBuds.filter((b) => !b.refused)))[0];
  const at = await row(page, seeds[0]).boundingBox();
  expect(bud.top).toBeGreaterThanOrEqual(at.y - 1);
  expect(bud.bottom).toBeLessThanOrEqual(at.y + at.height + 1);
  await expect.poll(() => page.evaluate(() => window.__pwSaid.includes("walk 1 of 3joined the pool"))).toBe(true);
  // And what the end will replace so far (that walk's `retiring`), in words
  // of its own.
  await expect.poll(() => marked(page, "may-go")).toEqual(sorted(gone));
  for (const id of gone) await expect(row(page, id).locator(".bi-flag")).toHaveText("will be replaced");
  await expect.poll(() => marked(page, "seed")).toEqual(sorted(seeds));

  // With motion reduced, nothing buds: the button, the row and New's count
  // still say it.
  await page.emulateMedia({ reducedMotion: "reduce" });
  const lin2 = [...lineage, ev(seeds[1], kidB, [{ addr: "node/2#op", before: null, after: "chorus" }])];
  await walk(1, kidB, seeds[1], { retiring: [...gone, kidB], lin: lin2 });
  await expect(row(page, kidB).locator(".bi-from")).toHaveText(`from ${nameOf(seeds[1])} · +chorus`);
  await expect(row(page, kidB).locator(".bi-new")).toHaveText("new");
  await expect(page.locator("#bank-list .bank-group.new .bg-n")).toHaveText("2");
  await expect.poll(() => page.evaluate(() => window.__pwSaid.includes("walk 2 of 3joined the pool"))).toBe(true);
  // A child the end will replace says so in New, as the rows at the foot do:
  // nothing leaves the bank unwarned.
  await expect.poll(() => marked(page, "may-go")).toEqual(sorted([...gone, kidB]));
  await expect(row(page, kidB).locator(".bi-flag")).toHaveText("will be replaced");
  // (A bud is appended in the task that draws the row, so by now it would
  // have been seen.)
  expect(await page.evaluate(() => window.__pwBuds.filter((b) => !b.refused).length), "a child budded with motion reduced").toBe(1);

  // The last walk breeds nothing, and the generation ends: the first child
  // kept, the second bred and then replaced, and the two lowest replaced.
  await walk(2, 0, seeds[2], { reason: "no_move", retiring: [...gone, kidB], lin: lin2 });
  const mark = await app.toastMark();
  await app.inject({
    type: "refined", re: rid,
    views: { ...s.views, ranked: s.ranked.filter((r) => ![...gone, kidB].includes(r.id)), lineage: lin2 },
    status: { ...s.status, generation: gen },
    born: [kidA, kidB], reasons: ["no_move"], retired: [...gone, kidB], stopped: false, bench: null,
  });
  // Its toast says what joined and what it replaced.
  const said = await app.toast(`Generation ${gen}: 1 new sound in the pool (1 more was bred, then replaced).`, { since: mark });
  for (const id of gone) expect(said).toContain(nameOf(id));
  // New holds the child kept; the one replaced is counted under it.
  await expect(page.locator("#bank-list .bank-group.new .bg-n")).toHaveText("1");
  await expect(row(page, kidA).locator(".bi-from")).toHaveText(`from ${nameOf(seeds[0])} · +delay`);
  await expect(row(page, kidB)).toHaveCount(0);
  await expect(page.locator("#bank-list .bank-below").first()).toHaveText("1 more was bred and rated below the pool.");

  // Replaced: what the end replaced, by name, and nothing to play.
  await page.mouse.move(5, 5);
  const fold = page.locator("#bank-list .bank-group.replaced .bg-fold");
  await fold.scrollIntoViewIfNeeded();
  await expect(fold.locator(".bg-label")).toHaveText(`replaced · generation ${gen}`);
  await fold.click();
  await expect(page.locator("#bank-list .replaced-names span")).toHaveText(gone.map(nameOf));
  await expect(page.locator("#bank-list .replaced-names button")).toHaveCount(0);
  for (const id of gone) await expect(row(page, id)).toHaveCount(0);
});
