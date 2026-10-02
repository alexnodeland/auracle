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
// The engine worker is reached the way failure_flows.spec.js reaches it: by
// wrapping `Worker` before main.js runs. Where a test needs a state the
// engine reaches only by chance (a refused child, a given pair of seeds), it
// is posted to main.js as the worker would post it. Sessions are seeded (the
// films' own Math.random), so the pool is the same run to run.
const { test, expect } = require("@playwright/test");

const SEED = `(() => { let s = 20260928 >>> 0; Math.random = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();`;

const init = `(() => {
  const Orig = window.Worker;
  const workers = (window.__pwWorkers = []);
  const last = (window.__pwLast = {});
  const counts = (window.__pwCounts = {});
  const log = (window.__pwLog = []);
  // The engine's facts as main.js last heard them: the ranked rows, the
  // lineage, the ratings and the status, whichever message carried them.
  // \`names\`: every sound's name as last seen in any ranked list, kept after
  // it leaves (a seed replaced, a member the fill added after a test began).
  const state = (window.__pwState = { ranked: null, lineage: null, ratings: null, status: null, views: null, genSeeds: null, names: {} });
  // The bank's marks as each walk of a generation leaves them, read the moment
  // main.js has handled the walk's \`refine_child\`, however fast the walks
  // land: by a listener added after main.js's \`onmessage\` (at the first
  // message, by which time main.js has set it), so it runs after it.
  const marks = (window.__pwMarks = []);
  const ids = (sel) => [...document.querySelectorAll("#bank-list .bank-item" + sel)].map((e) => Number(e.dataset.id)).sort((a, b) => a - b);
  const after = (e) => {
    const d = e.data;
    if (!d || d.type !== "refine_child" || d.pwFake) return;
    marks.push({
      index: d.index,
      child: d.child,
      generation: d.generation,
      // GENERATIONS as it reads now, and the generation the last status
      // main.js was posted counted (a status predating the open generation
      // counts it out).
      gens: (document.getElementById("gen-count") || {}).textContent,
      statusGen: state.status ? state.status.generation : null,
      retiring: d.retiring || [],
      breeding: !!document.querySelector("#evolve-btn.breeding"),
      rows: ids("[data-id]"),
      seed: ids(".seed"),
      may: ids(".may-go"),
      // The words those rows carry.
      words: [...new Set([...document.querySelectorAll("#bank-list .bank-item.may-go .bi-flag")].map((e) => e.textContent))],
    });
  };
  function Wrapped(url, opts) {
    const w = new Orig(url, opts);
    w.__pwUrl = String(url);
    workers.push(w);
    w.addEventListener("message", (e) => {
      if (!w.__pwAfter) {
        w.__pwAfter = true;
        w.addEventListener("message", after);
      }
      const d = e.data;
      if (!d || typeof d.type !== "string" || d.pwFake) return;
      // A generation's seeds, as its progress posts them (\`refine_jobs\`'
      // parents, job i walking from seeds[i]).
      if (d.type === "refine_progress" && !state.genSeeds && Array.isArray(d.seeds)) state.genSeeds = d.seeds.slice();
      last[d.type] = d;
      counts[d.type] = (counts[d.type] || 0) + 1;
      if (d.views) {
        state.views = d.views;
        state.ranked = d.views.ranked;
        state.lineage = d.views.lineage;
        if (d.views.ratings) state.ratings = d.views.ratings;
      }
      if (d.ranked) state.ranked = d.ranked;
      for (const r of (d.views && d.views.ranked) || d.ranked || []) if (r && r.name != null) state.names[r.id] = r.name;
      if (d.lineage) state.lineage = d.lineage;
      if (d.ratings) state.ratings = d.ratings;
      if (d.status && typeof d.status === "object") state.status = d.status;
      log.push({ type: d.type, at: performance.now(), index: d.index, child: d.child, reason: d.reason, seed: d.seed, retiring: d.retiring, generation: d.generation });
    });
    const post = w.postMessage.bind(w);
    w.postMessage = (m, t) => {
      if (m && m.type) {
        counts["sent:" + m.type] = (counts["sent:" + m.type] || 0) + 1;
        log.push({ type: "sent:" + m.type, at: performance.now(), id: m.id });
      }
      return post(m, t);
    };
    return w;
  }
  Wrapped.prototype = Orig.prototype;
  window.Worker = Wrapped;
  window.__pwEngine = () => workers.find((w) => /worker\\.js/.test(w.__pwUrl)) || null;
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
  try {
    for (const k of ["auracle-played", "auracle-bench-tour", "auracle-bank-toured", "auracle-warmed"]) localStorage.setItem(k, "1");
  } catch (_) {}
})();`;

async function boot(page) {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await page.addInitScript(SEED);
  await page.addInitScript(init);
  await page.goto("/");
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 150_000 });
  return pageErrors;
}

/** Boot, make six picks in EVOLVE and wait for their refit: a model with
 *  seeds to name and sounds it may replace. */
async function taught(page) {
  const pageErrors = await boot(page);
  await page.waitForFunction(() => window.__pwLast.duel && window.__pwLast.duel.pair, null, { timeout: 60_000 });
  await page.locator('.viewtab[data-view="evolve"]').click();
  for (let i = 1; i <= 6; i++) {
    await expect(page.locator(i % 2 ? "#choose-a" : "#choose-b")).toBeEnabled({ timeout: 30_000 });
    await page.locator(i % 2 ? "#choose-a" : "#choose-b").click();
  }
  await expect.poll(() => page.evaluate(() => window.__pwCounts.fitted || 0), { timeout: 120_000 }).toBeGreaterThan(0);
  await expect(page.locator("#job-slot")).toBeHidden({ timeout: 30_000 });
  // The picks' undo windows close, and their ratings land.
  await expect.poll(() => page.evaluate(() => (window.__pwState.ratings ? window.__pwState.ratings.seeds.length : 0)), { timeout: 30_000 }).toBe(10);
  await fullPool(page);
  return pageErrors;
}

/** The fill done: the pool at its size. The app is playable at 8 sounds and
 *  fills the rest behind the player, which on a slow machine (CI) can still
 *  be going after six picks and a refit. A generation or a ⚡ child replaces
 *  nothing while the pool is under size, and the ranked rows a test reads at
 *  its start would miss the members still to come. */
async function fullPool(page) {
  const at = await page.evaluate(() => window.__pwState.status && `${window.__pwState.status.pool}/${window.__pwState.status.pool_target}`);
  console.log(`pool after the picks: ${at}`);
  await expect.poll(() => page.evaluate(() => {
    const s = window.__pwState.status;
    return !!s && s.pool_target > 0 && s.pool >= s.pool_target;
  }), { timeout: 300_000, message: "the pool never filled" }).toBe(true);
}

/** Post a message to main.js as the engine worker would. */
const inject = (page, data) =>
  page.evaluate((d) => window.__pwEngine().dispatchEvent(new MessageEvent("message", { data: { ...d, pwFake: true } })), data);
const state = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__pwState)));
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
async function landChild(page, child, { seed, generation, index = 0, reason = null } = {}) {
  const s = await state(page);
  await inject(page, {
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
async function pooled(page) {
  const pageErrors = await boot(page);
  await page.waitForFunction(() => window.__pwState.ranked && window.__pwState.ranked.length >= 40 && window.__pwState.status, null, { timeout: 60_000 });
  await page.locator('.viewtab[data-view="evolve"]').click();
  await expect(page.locator("#evolve-wrap")).toBeVisible();
  return pageErrors;
}
/** The ratings a pick's reply carries (`WasmEngine::belief`), naming the
 *  seeds and what may be replaced. */
async function rate(page, { seeds = [], may = [] }) {
  const s = await state(page);
  await inject(page, { type: "status", status: s.status, ratings: { ranked: [], seeds, may_replace: may } });
}

test("pointing at EVOLVE POOL marks the seeds the engine names, and only those", async ({ page }) => {
  const pageErrors = await pooled(page);
  const shown = await rowIds(page);
  // Three the engine names as the next generation's seeds (`ratings.seeds`):
  // from the foot of the list, where no rule of the bank's own would look.
  const chosen = shown.slice(-3);
  await rate(page, { seeds: chosen });
  await page.locator("#evolve-wrap").hover();
  await expect.poll(() => marked(page, "seed")).toEqual(sorted(chosen));
  for (const id of chosen) {
    await row(page, id).scrollIntoViewIfNeeded();
    await expect(row(page, id).locator(".bi-flag")).toHaveText("seed");
    await expect(row(page, id).locator(".bi-flag")).toBeVisible();
  }
  // A pick's ratings name others, and the marks follow them at once.
  const next = shown.slice(4, 6);
  await rate(page, { seeds: next });
  await expect.poll(() => marked(page, "seed")).toEqual(sorted(next));
  // Away from the button, nothing is marked.
  await page.mouse.move(5, 5);
  await expect.poll(() => marked(page, "seed")).toEqual([]);
  await expect(page.locator("#bank-list .bi-flag:visible")).toHaveCount(0);
  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});

test("pointing at EVOLVE POOL marks what the engine says may be replaced", async ({ page }) => {
  const pageErrors = await pooled(page);
  const shown = await rowIds(page);
  // Two the engine says a generation may replace (`ratings.may_replace`):
  // from the top of the list, which the ten lowest by mean never are.
  const chosen = shown.slice(1, 3);
  await rate(page, { may: chosen });
  await page.locator("#evolve-wrap").hover();
  await expect.poll(() => marked(page, "may-go")).toEqual(sorted(chosen));
  await expect(row(page, chosen[0]).locator(".bi-flag")).toHaveText("may be replaced");
  await expect(row(page, chosen[0]).locator(".bi-flag")).toBeVisible();
  // The dashed rail carries it too, not only the word.
  expect(await row(page, chosen[0]).evaluate((e) => getComputedStyle(e).borderLeftStyle)).toBe("dashed");
  const next = shown.slice(-2);
  await rate(page, { may: next });
  await expect.poll(() => marked(page, "may-go")).toEqual(sorted(next));
  await page.mouse.move(5, 5);
  await expect.poll(() => marked(page, "may-go")).toEqual([]);
  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});

// At the widest bank (1440 px) and the narrowest it has (1080 px, 200 px).
for (const [width, height] of [[1440, 900], [1080, 800]]) {
test(`a mark never moves or narrows a row's name: the unheard dot, NEW, seed and may be replaced (${width} px)`, async ({ page }) => {
  await page.setViewportSize({ width, height });
  const pageErrors = await pooled(page);
  const shown = await rowIds(page);
  const [seed, may, kid] = [shown[1], shown[2], shown[3]];
  const before = { seed: await nameBox(page, seed), may: await nameBox(page, may), kid: await nameBox(page, kid) };

  // Seed and may be replaced, while EVOLVE POOL is pointed at.
  await rate(page, { seeds: [seed], may: [may] });
  await page.locator("#evolve-wrap").hover();
  await expect(row(page, seed)).toHaveClass(/\bseed\b/);
  await expect(row(page, may)).toHaveClass(/\bmay-go\b/);
  const hovered = { seed: await nameBox(page, seed), may: await nameBox(page, may) };
  await page.mouse.move(5, 5);

  // NEW and the unheard dot: the sound lands as a child of a generation.
  await landChild(page, kid, { seed });
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

  // Heard: the dot goes, and the name stays where it was.
  await row(page, kid).locator(".bi-hear").click();
  await expect(row(page, kid).locator(".bi-dot")).toHaveCount(0, { timeout: 30_000 });
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

  // Each word a row can carry while EVOLVE POOL is pointed at fits in the
  // stars' place, clear of save and cut. ("will be replaced" shows
  // only while a generation runs, so each word is measured in the flag of a
  // marked row.) EVOLVE POOL focused marks the rows, and the pointer on the
  // row shows its cut.
  await rate(page, { may: [may] });
  await page.locator("#evolve-btn").focus();
  await expect(row(page, may)).toHaveClass(/\bmay-go\b/);
  await row(page, may).hover();
  for (const word of ["seed", "may be replaced", "will be replaced"]) {
    const fit = await row(page, may).evaluate((r, w) => {
      const f = r.querySelector(".bi-flag");
      f.textContent = w;
      const box = (el) => (el && el.getBoundingClientRect().width > 0 ? el.getBoundingClientRect() : null);
      const fl = f.getBoundingClientRect();
      const save = box(r.querySelector(".bi-save"));
      const kill = box(r.querySelector(".bi-kill"));
      return { flagRight: fl.right, saveLeft: save ? save.left : null, killLeft: kill ? kill.left : null };
    }, word);
    console.log(`${width} px, "${word}": ${JSON.stringify(fit)}`);
    if (fit.saveLeft != null) expect(fit.flagRight, `"${word}" runs into save`).toBeLessThanOrEqual(fit.saveLeft);
    if (fit.killLeft != null) expect(fit.flagRight, `"${word}" runs into cut`).toBeLessThanOrEqual(fit.killLeft);
  }
  await page.mouse.move(5, 5);
  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});
}

test("a child keeps its unheard dot across a reload, and loses it when its phrase is heard", async ({ page }) => {
  test.setTimeout(300_000);
  const pageErrors = await pooled(page);
  const shown = await rowIds(page);
  const [seed, kid] = [shown[0], shown[5]];
  const saves = await page.evaluate(() => window.__pwCounts.saved || 0);
  await landChild(page, kid, { seed });
  await expect(row(page, kid).locator(".bi-dot")).toBeVisible();
  await expect(row(page, kid)).toHaveAttribute("aria-label", /not heard yet/);
  // The autosave (2.5 s after a change) writes it; the page then reloads.
  await expect.poll(() => page.evaluate(() => window.__pwCounts.saved || 0), { timeout: 30_000 }).toBeGreaterThan(saves);
  await page.waitForTimeout(1_000);
  await page.reload();
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 150_000 });
  await expect(row(page, kid).locator(".bi-dot")).toBeVisible({ timeout: 30_000 });
  // Its phrase plays: heard.
  const starts = await page.evaluate(() => window.__pwStarts.length);
  await row(page, kid).locator(".bi-hear").click();
  await expect.poll(() => page.evaluate(() => window.__pwStarts.length), { timeout: 30_000 }).toBeGreaterThan(starts);
  await expect(row(page, kid).locator(".bi-dot")).toHaveCount(0);
  await expect(row(page, kid)).not.toHaveAttribute("aria-label", /not heard yet/);
  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});

test("Compare shows a child beside its seed, what changed and both ratings, and plays both while both exist", async ({ page }) => {
  test.setTimeout(300_000);
  const pageErrors = await boot(page);
  await page.waitForFunction(() => window.__pwState.ranked && window.__pwState.ranked.length >= 40 && window.__pwState.views, null, { timeout: 60_000 });
  const s = await state(page);
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
  await inject(page, { type: "taste_views", views: { ...s.views, lineage: [...(s.lineage || []), ev] } });
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
  await expect(hearSeed).toHaveClass(/\bplaying\b/, { timeout: 30_000 });
  await hearKid.click();
  await expect(hearKid).toHaveClass(/\bplaying\b/, { timeout: 30_000 });
  await expect(hearSeed).not.toHaveClass(/\bplaying\b/);
  expect(await page.evaluate(() => window.__pwStarts.length)).toBeGreaterThanOrEqual(n0 + 2);
  // The figure is drawn from both phrases.
  await expect(page.locator("#compare-fig")).toHaveAttribute("aria-label", `${kid.name} grown from ${seed.name}`);

  // The seed replaced: its tree is gone, so it is a name with nothing to play.
  const now = await state(page);
  await inject(page, { type: "taste_views", views: { ...now.views, ranked: now.ranked.filter((r) => r.id !== seed.id), lineage: [...(now.lineage || []), ev] } });
  await expect(box.locator(".cmp-gone")).toHaveText(`${seed.name} · replaced`);
  await expect(hearSeed).toHaveCount(0);
  await expect(hearKid).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(box).toBeHidden();
  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});

test("Compare opens from the keyboard: c on a bred sound in the bank, and Esc hands the keys back", async ({ page }) => {
  const pageErrors = await boot(page);
  await page.waitForFunction(() => window.__pwState.ranked && window.__pwState.ranked.length >= 40 && window.__pwState.views, null, { timeout: 60_000 });
  const s = await state(page);
  const [seed, kid, plain] = [s.ranked[1], s.ranked[3], s.ranked[2]];
  const ev = {
    generation: 1, kind: "refine", parent_id: seed.id, child_id: kid.id,
    diff: [{ addr: "node/1#op", before: null, after: "delay" }],
    parent_utility: 0.4, child_utility: 0.5,
  };
  await inject(page, { type: "taste_views", views: { ...s.views, lineage: [...(s.lineage || []), ev] } });
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
  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});

test("a ⚡ child that replaced nothing leaves the last generation's Replaced as it was", async ({ page }) => {
  const pageErrors = await pooled(page);
  const s = await state(page);
  const gone = s.ranked[s.ranked.length - 1];
  const left = s.ranked.filter((r) => r.id !== gone.id);
  const views = { ...s.views, ranked: left };
  // A generation's end replaced one sound (here a restored pool's trim, as
  // the worker posts it).
  await inject(page, { type: "pool_trimmed", retired: [gone.id], views, status: { ...s.status, generation: 1 } });
  const fold = page.locator("#bank-list .bank-group.replaced .bg-fold");
  await fold.scrollIntoViewIfNeeded();
  await expect(fold.locator(".bg-label")).toHaveText("replaced · generation 1");
  await expect(fold.locator(".bg-n")).toHaveText(/^1 /);
  // Then a ⚡ child lands with the pool not full: nothing displaced.
  await inject(page, {
    type: "evolved_from", seedId: left[0].id, childId: left[1].id, reason: null,
    views, status: { ...s.status, generation: 2 },
  });
  await fold.scrollIntoViewIfNeeded();
  await expect(fold.locator(".bg-label")).toHaveText("replaced · generation 1");
  await fold.click();
  await expect(page.locator("#bank-list .replaced-names span")).toHaveText([gone.name]);
  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});

test("pointing at EVOLVE POOL while ⚡ walks marks its seed and the one sound its child would replace", { tag: "@slow" }, async ({ page }) => {
  // With no generation open ⚡'s child replaces at once the lowest unsaved
  // sound other than its seed (\`absorb_from\`, \`evict_to_size\`), which is
  // the first of \`ratings.may_replace\` with the pool full. It marked the seed
  // and nothing else.
  test.setTimeout(600_000);
  const pageErrors = await taught(page);
  await page.locator('.viewtab[data-view="play"]').click();
  await expect(page.locator("#rack-evolve")).toBeEnabled({ timeout: 60_000 });
  await page.locator("#rack-evolve").click();
  const seedId = await page.evaluate(() => window.__pwLog.filter((e) => e.type === "sent:refine_from").pop().id);
  await page.locator('.viewtab[data-view="evolve"]').click();
  await page.locator("#evolve-wrap").hover();
  // Read the marks against the ratings main.js holds as it draws them.
  const read = () => page.evaluate(() => ({
    walking: !window.__pwLast.evolved_from,
    seed: [...document.querySelectorAll("#bank-list .bank-item.seed")].map((e) => Number(e.dataset.id)),
    may: [...document.querySelectorAll("#bank-list .bank-item.may-go")].map((e) => Number(e.dataset.id)),
    words: [...document.querySelectorAll("#bank-list .bank-item.may-go .bi-flag")].map((e) => e.textContent),
    mayReplace: window.__pwState.ratings.may_replace,
    status: window.__pwState.status,
  }));
  await expect.poll(async () => (await read()).seed.length, { timeout: 30_000 }).toBe(1);
  const m = await read();
  test.skip(!m.walking, "⚡ landed before the marks were read");
  expect(m.seed).toEqual([seedId]);
  expect(m.status.pool, "the pool is not full, so ⚡ would replace nothing").toBeGreaterThanOrEqual(m.status.pool_target);
  const want = m.mayReplace.filter((id) => id !== seedId).slice(0, m.status.pool + 1 - m.status.pool_target);
  expect(m.may).toEqual(want);
  expect(m.words).toEqual(want.map(() => "may be replaced"));
  // When the child lands, what it replaced is what was marked (the model has
  // not moved: no pick since).
  await page.mouse.move(5, 5);
  await expect.poll(() => page.evaluate(() => !!window.__pwLast.evolved_from), { timeout: 300_000 }).toBe(true);
  const done = await page.evaluate(() => window.__pwLast.evolved_from);
  console.log(`⚡ from ${seedId}: child ${done.childId}, reason ${done.reason}; marked ${JSON.stringify(m.may)}`);
  if (done.childId > 0) {
    const pool = new Set(done.views.ranked.map((r) => r.id));
    expect(want.filter((id) => !pool.has(id)), "what ⚡'s child replaced").toEqual(want);
  }
  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});

test("Compare lists every change a long walk made, and the list scrolls", async ({ page }) => {
  // A 40-step walk can change two dozen sites (26 in one review run). Compare
  // showed the first eight and "+18 more"; the release notes say every change.
  const pageErrors = await boot(page);
  await page.waitForFunction(() => window.__pwState.ranked && window.__pwState.ranked.length >= 40 && window.__pwState.views, null, { timeout: 60_000 });
  const s = await state(page);
  const [seed, kid] = [s.ranked[1], s.ranked[3]];
  const mods = Array.from({ length: 14 }, (_, i) => `mod${i + 1}`);
  const ev = {
    generation: 1, kind: "refine", parent_id: seed.id, child_id: kid.id,
    diff: mods.map((m, i) => ({ addr: `node/${i}#op`, before: null, after: m })),
    parent_utility: 0.4, child_utility: 0.5,
  };
  await inject(page, { type: "taste_views", views: { ...s.views, lineage: [...(s.lineage || []), ev] } });
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
  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});

test("a sound saved while a generation runs loses its mark, and the one that will go instead gains it", { tag: "@slow" }, async ({ page }) => {
  // A save takes a sound out of what the running generation's end will
  // replace (\`eviction_order\` passes over saved sounds), and the next lowest
  // unsaved one takes its place. Only \`refine_child\` carried \`retiring\`, so
  // the saved row kept "will be replaced" and the other went unmarked until
  // the next walk landed, or for good after the last.
  test.setTimeout(600_000);
  const pageErrors = await taught(page);
  await page.locator("#evolve-wrap").hover();
  await page.locator("#evolve-btn").click(); // the pointer stays on EVOLVE POOL
  await expect.poll(() => page.evaluate(() => window.__pwMarks.some((s) => s.breeding && s.may.length > 0)), { timeout: 400_000 }).toBe(true);
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
  const saves = await page.evaluate(() => window.__pwCounts.pinned || 0);
  await page.keyboard.press("m");
  await expect.poll(() => page.evaluate(() => window.__pwCounts.pinned || 0), { timeout: 10_000 }).toBeGreaterThan(saves);
  const pinned = await page.evaluate(() => window.__pwLast.pinned);
  expect(pinned.ok, "the save was refused").toBe(true);
  expect(pinned.retiring, "a save while a generation runs carries what its end will replace").toBeTruthy();
  expect(pinned.retiring).not.toContain(target);
  // The marks follow the latest word on it: this save's, or a walk landed since.
  await expect.poll(async () => {
    const now = await page.evaluate(() => {
      const last = window.__pwLog.filter((e) => e.type === "pinned" || e.type === "refine_child").pop();
      const ids = (sel) => [...document.querySelectorAll("#bank-list .bank-item" + sel)].map((e) => Number(e.dataset.id)).sort((a, b) => a - b);
      return { retiring: last.retiring || [], rows: ids("[data-id]"), may: ids(".may-go"), seed: ids(".seed") };
    });
    const want = now.retiring.filter((id) => now.rows.includes(id) && !now.seed.includes(id)).sort((a, b) => a - b);
    return JSON.stringify({ may: now.may, has: now.may.includes(target) }) === JSON.stringify({ may: want, has: false });
  }, { timeout: 10_000 }).toBe(true);
  await expect(row(page, target)).not.toHaveClass(/\bmay-go\b/);
  // One sound not marked before is marked now: the one that will go instead.
  const after = await page.evaluate(() => [...document.querySelectorAll("#bank-list .bank-item.may-go")].map((e) => Number(e.dataset.id)));
  console.log(`saved ${target}; marked before ${JSON.stringify(snap.may)}, after ${JSON.stringify(after)}`);
  expect(after.some((id) => !snap.may.includes(id)), "no sound took the saved one's place").toBe(true);
  await page.mouse.move(5, 5);
  const stop = page.locator("#evolve-stop");
  if (await stop.isVisible()) await stop.click({ timeout: 5_000 }).catch(() => {});
  await expect(page.locator("#evolve-btn")).not.toHaveClass(/\bbreeding\b/, { timeout: 120_000 });
  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});

test("GENERATIONS counts a generation from its first child, with no pick since it opened", { tag: "@slow" }, async ({ page }) => {
  // The guide says GENERATIONS counts a generation once its first child
  // lands. With no status posted since the generation opened (no pick), it
  // went on reading the count from before it, 0 with three children in New.
  test.setTimeout(600_000);
  const pageErrors = await taught(page);
  await expect(page.locator("#gen-count")).toHaveText("0");
  await page.locator("#evolve-btn").click();
  await page.mouse.move(5, 5);
  await expect.poll(() => page.evaluate(() => window.__pwMarks.some((s) => s.child > 0)), { timeout: 400_000 }).toBe(true);
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
  await expect(page.locator("#evolve-btn")).not.toHaveClass(/\bbreeding\b/, { timeout: 120_000 });
  await expect(page.locator("#gen-count")).toHaveText(String(walks[first].generation));
  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});

test("a child the pool would not take buds beside its seed and is gone, and EVOLVE POOL says why", { tag: "@slow" }, async ({ page }) => {
  test.setTimeout(300_000);
  const pageErrors = await taught(page);
  const seeds = (await state(page)).ratings.seeds;
  await page.locator("#evolve-btn").click();
  await expect.poll(() => page.evaluate(() => window.__pwCounts.refine_progress || 0), { timeout: 30_000 }).toBeGreaterThan(0);
  const gen = await page.evaluate(() => window.__pwLast.refine_progress.generation);
  const seedRow = row(page, seeds[0]);
  await seedRow.scrollIntoViewIfNeeded();
  const at = await seedRow.boundingBox();

  // The first walk's child, rated below the pool (`not_admitted`). The fake
  // \`refine_child\` is handled as a real one, so it also moves main.js's
  // count of walks back (\`breeding.done\`) and of children bred and not
  // kept (\`bredBelow.n\`) beside the real walks': this test reads neither.
  await landChild(page, 0, { seed: seeds[0], generation: gen, reason: "not_admitted" });
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
  await expect(page.locator(".bud.refused")).toHaveCount(0, { timeout: 10_000 });

  // With motion reduced, nothing buds, and the button still says it.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await landChild(page, 0, { seed: seeds[1], generation: gen, index: 1, reason: "not_admitted" });
  await expect.poll(() => page.evaluate(() => window.__pwSaid.includes("walk 2 of 10rated below the pool"))).toBe(true);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__pwBuds.filter((b) => b.refused).length)).toBe(1);

  // Stopped, unless its real walks have already ended it.
  const stop = page.locator("#evolve-stop");
  if (await stop.isVisible()) await stop.click({ timeout: 5_000 }).catch(() => {});
  await expect(page.locator("#evolve-btn")).not.toHaveClass(/\bbreeding\b/, { timeout: 60_000 });
  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});

test("a generation's children land in New with their seed and what changed, and Replaced names what it replaced", { tag: "@slow" }, async ({ page }) => {
  test.setTimeout(600_000);
  const pageErrors = await taught(page);
  // Every name seen, read when it is needed (`__pwState.names`).
  const nameOf = async (id) => {
    const n = await page.evaluate((i) => window.__pwState.names[i], id);
    expect(n, `no name was ever posted for sound ${id}`).toBeTruthy();
    return n;
  };
  // At rest, pointing at EVOLVE POOL marks the engine's own lists for the
  // generation it would open: `ratings.seeds` and `ratings.may_replace`.
  // (Each read is of the ratings main.js holds now: a pick's may still land.)
  await page.locator("#evolve-wrap").hover();
  await expect.poll(async () => {
    const r = (await state(page)).ratings;
    const shown = await rowIds(page);
    const want = { seed: sorted(r.seeds.filter((id) => shown.includes(id))), may: sorted(r.may_replace.filter((id) => shown.includes(id) && !r.seeds.includes(id))) };
    return JSON.stringify({ seed: await marked(page, "seed"), may: await marked(page, "may-go") }) === JSON.stringify(want);
  }, { timeout: 30_000 }).toBe(true);
  // Pressed, with the pointer left on it: the marks stay up through the
  // generation, and each walk's are read as it lands (`__pwMarks`).
  await page.locator("#evolve-btn").click();

  // Three walks back, then stop: the generation ends with what it bred. On a
  // fast machine the walks land in a burst and the generation may already
  // have ended, with STOP gone: either way it ends with what it bred.
  await expect.poll(() => page.evaluate(() => window.__pwLog.filter((e) => e.type === "refine_child").length), { timeout: 400_000 }).toBeGreaterThanOrEqual(3);
  const stop = page.locator("#evolve-stop");
  if (await stop.isVisible()) await stop.click({ timeout: 5_000 }).catch(() => {});
  await expect(page.locator("#evolve-btn")).not.toHaveClass(/\bbreeding\b/, { timeout: 120_000 });
  // The generation's own seeds: each walk's `seed` is one of them, in job
  // order (`next_seeds` and `refine_jobs` share one rule).
  const seeds = (await state(page)).genSeeds;
  expect(seeds && seeds.length, "the generation's progress posted no seeds").toBe(10);
  const kids = await page.evaluate(() => window.__pwLog.filter((e) => e.type === "refine_child"));
  for (const k of kids) expect(k.seed, `walk ${k.index} came from a seed the generation did not take`).toBe(seeds[k.index]);
  // While it ran, EVOLVE POOL marked this generation's seeds, not the next
  // one's (`ratings.seeds` moves as its children land), and what its end
  // will replace (that walk's `retiring`), in words of their own.
  const during = await page.evaluate(() => window.__pwMarks.filter((s) => s.breeding));
  expect(during.length, "no walk landed while the generation ran").toBeGreaterThan(0);
  for (const s of during) {
    expect(s.seed, `seeds marked after walk ${s.index}`).toEqual(sorted(seeds.filter((id) => s.rows.includes(id))));
    expect(s.may, `will be replaced after walk ${s.index}`).toEqual(sorted(s.retiring.filter((id) => s.rows.includes(id) && !seeds.includes(id))));
    expect(s.words, `the words after walk ${s.index}`).toEqual(s.may.length ? ["will be replaced"] : []);
  }
  if (during.some((s) => s.child > 0)) expect(during.some((s) => s.may.length > 0), "a child was taken in and nothing was marked as may be replaced").toBe(true);
  await page.mouse.move(5, 5);
  const refined = await page.evaluate(() => window.__pwLast.refined);
  const after = await state(page);
  const kept = refined.born.filter((id) => !refined.retired.includes(id));
  console.log(`walks ${JSON.stringify(kids.map((k) => [k.index, k.seed, k.child, k.reason]))}; kept ${JSON.stringify(kept)}; retired ${JSON.stringify(refined.retired)}`);

  // New holds the children kept, in birth order, each with its seed and what
  // changed (its `LineageEvent`), and a dot until heard.
  if (kept.length) {
    await expect(page.locator("#bank-list .bank-group.new .bg-label")).toHaveText(`new · generation ${refined.status.generation}`);
    await expect(page.locator("#bank-list .bank-group.new .bg-n")).toHaveText(String(kept.length));
  }
  for (const id of kept) {
    const ev = after.lineage.find((e) => e.child_id === id);
    expect(ev, `no lineage event for child ${id}`).toBeTruthy();
    const walk = kids.find((k) => k.child === id);
    expect(ev.parent_id, "the lineage names another seed than the walk's").toBe(walk.seed);
    const seedName = await nameOf(ev.parent_id);
    await expect(row(page, id).locator(".bi-from")).toHaveText(new RegExp(`^from ${reEsc(seedName)}( · .+)?$`));
    await expect(row(page, id).locator(".bi-new")).toHaveText("new");
    await expect(row(page, id).locator(".bi-dot")).toBeVisible();
  }
  // Each child budded from its seed's row, where that row was in view.
  const buds = await page.evaluate(() => window.__pwBuds.filter((b) => !b.refused).map((b) => b.text));
  console.log(`buds: ${JSON.stringify(buds)}`);
  if (kept.length) expect(buds.length, "no child budded from its seed").toBeGreaterThan(0);
  // EVOLVE POOL narrated each walk.
  const said = await page.evaluate(() => window.__pwSaid.slice());
  expect(said.some((t) => /^walk \d+ of 10(joined the pool|rated below the pool|already in the pool|came back unchanged|couldn’t start)?$/.test(t)), JSON.stringify(said)).toBe(true);

  // Replaced: what the end replaced, by name, and nothing to play.
  const gone = refined.retired.filter((id) => !refined.born.includes(id));
  if (gone.length) {
    const fold = page.locator("#bank-list .bank-group.replaced .bg-fold");
    await fold.scrollIntoViewIfNeeded();
    await expect(fold.locator(".bg-label")).toHaveText(`replaced · generation ${refined.status.generation}`);
    await fold.click();
    const goneNames = [];
    for (const id of gone) goneNames.push(await nameOf(id));
    await expect(page.locator("#bank-list .replaced-names span")).toHaveText(goneNames);
    await expect(page.locator("#bank-list .replaced-names button")).toHaveCount(0);
    for (const id of gone) await expect(row(page, id)).toHaveCount(0);
  }
  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});
