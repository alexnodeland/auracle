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
  const state = (window.__pwState = { ranked: null, lineage: null, ratings: null, status: null, views: null, genSeeds: null });
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
      retiring: d.retiring || [],
      breeding: !!document.querySelector("#evolve-btn.breeding"),
      rows: ids("[data-id]"),
      seed: ids(".seed"),
      may: ids(".may-go"),
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
      // A generation's seeds: the last \`ratings.seeds\` posted before it
      // opened, which is what its first \`refine_progress\` finds.
      if (d.type === "refine_progress" && !state.genSeeds && state.ratings) state.genSeeds = state.ratings.seeds.slice();
      last[d.type] = d;
      counts[d.type] = (counts[d.type] || 0) + 1;
      if (d.views) {
        state.views = d.views;
        state.ranked = d.views.ranked;
        state.lineage = d.views.lineage;
        if (d.views.ratings) state.ratings = d.views.ratings;
      }
      if (d.ranked) state.ranked = d.ranked;
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
  return pageErrors;
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

test("a mark never moves or narrows a row's name: the unheard dot, NEW, seed and may be replaced", async ({ page }) => {
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
  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});

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

  // The first walk's child, rated below the pool (`not_admitted`).
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

  await page.locator("#evolve-stop").click();
  await expect(page.locator("#evolve-btn")).not.toHaveClass(/\bbreeding\b/, { timeout: 60_000 });
  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});

test("a generation's children land in New with their seed and what changed, and Replaced names what it replaced", { tag: "@slow" }, async ({ page }) => {
  test.setTimeout(600_000);
  const pageErrors = await taught(page);
  const before = await state(page);
  const names = new Map(before.ranked.map((r) => [r.id, r.name]));
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

  // Three walks back, then stop: the generation ends with what it bred.
  await expect.poll(() => page.evaluate(() => window.__pwLog.filter((e) => e.type === "refine_child").length), { timeout: 400_000 }).toBeGreaterThanOrEqual(3);
  await page.locator("#evolve-stop").click();
  await expect(page.locator("#evolve-btn")).not.toHaveClass(/\bbreeding\b/, { timeout: 120_000 });
  // The generation's own seeds: each walk's `seed` is one of them, in job
  // order (`next_seeds` and `refine_jobs` share one rule).
  const seeds = (await state(page)).genSeeds;
  expect(seeds && seeds.length, "no seeds were posted before the generation opened").toBe(10);
  const kids = await page.evaluate(() => window.__pwLog.filter((e) => e.type === "refine_child"));
  for (const k of kids) expect(k.seed, `walk ${k.index} came from a seed the generation did not take`).toBe(seeds[k.index]);
  // While it ran, EVOLVE POOL marked this generation's seeds, not the next
  // one's (`ratings.seeds` moves as its children land), and what its end
  // would replace if it ended there (that walk's `retiring`).
  const during = await page.evaluate(() => window.__pwMarks.filter((s) => s.breeding));
  expect(during.length, "no walk landed while the generation ran").toBeGreaterThan(0);
  for (const s of during) {
    expect(s.seed, `seeds marked after walk ${s.index}`).toEqual(sorted(seeds.filter((id) => s.rows.includes(id))));
    expect(s.may, `may be replaced after walk ${s.index}`).toEqual(sorted(s.retiring.filter((id) => s.rows.includes(id) && !seeds.includes(id))));
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
    const seedName = names.get(ev.parent_id);
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
    await expect(page.locator("#bank-list .replaced-names span")).toHaveText(gone.map((id) => names.get(id)));
    await expect(page.locator("#bank-list .replaced-names button")).toHaveCount(0);
    for (const id of gone) await expect(row(page, id)).toHaveCount(0);
  }
  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});
