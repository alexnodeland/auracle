// A sound you keep as new is safe until it has been in a pick (the engine's
// `Candidate::unjudged`).
//
// Before, keep as new followed by opening a preset on a full pool replaced
// the sound just kept whenever the model rated it lowest: the toast said so,
// but the sound you had just made was gone (patch_guess.spec.js met it on a
// CI runner: the kept sound rated 24%, and opening Reese replaced it). Here
// the kept sound is made to rate lowest of everything a preset could replace,
// a preset is opened, and its row stays; the toast names the sound that was
// replaced in its place, and pointing at EVOLVE POOL never marks the kept
// sound "may be replaced".
//
// The engine worker is reached the way every spec reaches it: by wrapping
// `Worker` before main.js runs. Sessions are seeded (the films' own
// Math.random), so the pool is the same run to run.
const { test, expect } = require("@playwright/test");
const { goLevel, bankTab } = require("./shell");

const SEED = `(() => { let s = 20261002 >>> 0; Math.random = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();`;

const init = `(() => {
  const Orig = window.Worker;
  const workers = (window.__pwWorkers = []);
  const last = (window.__pwLast = {});
  const counts = (window.__pwCounts = {});
  // The engine's facts as main.js last heard them, whichever message carried
  // them: the ranked rows (with \`pinned\`), the ratings and the status.
  const state = (window.__pwState = { ranked: null, ratings: null, status: null });
  function Wrapped(url, opts) {
    const w = new Orig(url, opts);
    w.__pwUrl = String(url);
    workers.push(w);
    w.addEventListener("message", (e) => {
      const d = e.data;
      if (!d || typeof d.type !== "string") return;
      last[d.type] = { ...d, at: performance.now() };
      counts[d.type] = (counts[d.type] || 0) + 1;
      if (d.views) {
        state.ranked = d.views.ranked;
        if (d.views.ratings) state.ratings = d.views.ratings;
      }
      if (d.ranked) state.ranked = d.ranked;
      if (d.ratings) state.ratings = d.ratings;
      if (d.status && typeof d.status === "object") state.status = d.status;
    });
    return w;
  }
  Wrapped.prototype = Orig.prototype;
  window.Worker = Wrapped;
  // Every toast said, in order.
  const toasts = (window.__pwToasts = []);
  document.addEventListener("DOMContentLoaded", () => {
    const lane = document.getElementById("toasts");
    if (!lane) return;
    new MutationObserver((muts) => {
      for (const m of muts)
        for (const n of m.addedNodes) {
          const msg = n.querySelector && n.querySelector(".toast-msg");
          if (msg) toasts.push(msg.textContent);
        }
    }).observe(lane, { childList: true, subtree: true });
  });
  try {
    for (const k of ["auracle-played", "auracle-bench-tour", "auracle-bank-toured"]) localStorage.setItem(k, "1");
  } catch (_) {}
})();`;

const now = (page) => page.evaluate(() => performance.now());
const state = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__pwState)));
const row = (page, id) => page.locator(`#bank-list .bank-item[data-id="${id}"]`);

/** The reply of `type` that landed after `after`, once it has. */
async function replied(page, type, after, timeout = 90_000) {
  const find = ([ty, t]) => {
    const r = window.__pwLast[ty];
    return r && r.at > t ? JSON.parse(JSON.stringify(r)) : null;
  };
  await expect.poll(() => page.evaluate(find, [type, after]), { timeout }).not.toBeNull();
  return page.evaluate(find, [type, after]);
}

/** The pool's members a preset may replace, lowest rated first: the
 *  engine's ratings in its own order, without the saved ones. */
function replaceable(s) {
  const saved = new Set((s.ranked || []).filter((r) => r.pinned).map((r) => r.id));
  return s.ratings.ranked.filter((r) => !saved.has(r.id)).map((r) => r.id).reverse();
}

test("a sound kept as new stays when a preset opens on a full pool, though it rates lowest", { tag: "@slow" }, async ({ page }) => {
  test.setTimeout(480_000);
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.addInitScript(SEED);
  await page.addInitScript(init);
  await page.goto("/");
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 150_000 });

  // The warm start's three picks, and the fit they ask for.
  await expect(page.locator("#warmstart")).not.toHaveClass(/\bhidden\b/, { timeout: 30_000 });
  const cards = page.locator(".warm-cell .warm-item");
  for (const i of [1, 4, 7]) await cards.nth(i).click();
  await page.locator("#warm-go").click();
  await expect.poll(() => page.evaluate(() => window.__pwCounts.fitted || 0), { timeout: 120_000 }).toBeGreaterThan(0);
  // A full pool: until then an insert replaces nothing.
  await expect.poll(() => page.evaluate(() => {
    const s = window.__pwState.status;
    return !!s && s.pool_target > 0 && s.pool >= s.pool_target && !!window.__pwState.ratings;
  }), { timeout: 300_000, message: "the pool never filled" }).toBe(true);

  // Open the sound the model rates lowest of those it may replace, and save
  // it: the edit kept from it then has nothing beneath it but sounds that
  // rate higher.
  await goLevel(page, "patch");
  await bankTab(page, "pool");
  const lowest = replaceable(await state(page))[0];
  const tOpen = await now(page);
  await row(page, lowest).locator(".bi-name").click();
  await expect.poll(() => page.evaluate((t) => {
    const b = window.__pwLast.bench;
    return !!b && b.at > t && b.subject;
  }, tOpen), { timeout: 60_000 }).toBe(lowest);
  await row(page, lowest).locator(".bi-save").click();
  await expect.poll(async () => ((await state(page)).ranked || []).find((r) => r.id === lowest)?.pinned, { timeout: 30_000 }).toBe(true);

  // A small edit, kept as new without the comparison: nothing is taught.
  const knob = page.locator("#rack-svg g[data-addr] .knob-hit").first();
  const box = await knob.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 6, { steps: 3 });
  await page.mouse.up();
  await expect(page.locator("#rack-commit")).toBeEnabled({ timeout: 30_000 });
  const tKeep = await now(page);
  await page.locator("#rack-commit").click();
  // The comparison, when there is one, is skipped.
  const skip = page.locator("#cd-skip");
  await Promise.race([
    skip.waitFor({ state: "visible", timeout: 60_000 }).then(() => skip.click()).catch(() => {}),
    replied(page, "committed", tKeep).catch(() => {}),
  ]);
  const committed = await replied(page, "committed", tKeep);
  const kept = committed.id;
  expect(kept, "the edit was not kept").toBeGreaterThan(0);
  const keptName = (committed.views.ranked.find((r) => r.id === kept) || {}).name;

  // The precondition, from the engine's own ratings: of everything a preset
  // could replace, the kept sound rates lowest. Without the protection it is
  // the one a preset replaces.
  const before = await state(page);
  expect(replaceable(before)[0], "the precondition: the kept sound rates lowest").toBe(kept);
  const pool = new Set(before.ranked.map((r) => r.id));
  const names = new Set(before.ranked.map((r) => r.name));

  // Open a preset that is not in the pool yet.
  await bankTab(page, "presets");
  const preset = await page.evaluate((have) => {
    const rows = [...document.querySelectorAll("#bank-list .bank-item")];
    const r = rows.find((e) => {
      const n = e.querySelector(".bi-name");
      return n && !have.includes(n.textContent.trim());
    });
    return r ? r.querySelector(".bi-name").textContent.trim() : null;
  }, [...names]);
  expect(preset, "every preset is already in the pool").not.toBeNull();
  const tPreset = await now(page);
  await page.locator("#bank-list .bank-item", { hasText: preset }).first().click();
  const loaded = await replied(page, "preset_loaded", tPreset);
  const after = new Set(loaded.views.ranked.map((r) => r.id));
  const gone = [...pool].filter((id) => !after.has(id));
  expect(gone.length, "opening a preset on a full pool replaced nothing").toBe(1);
  expect(gone, "the sound kept as new was replaced").not.toContain(kept);

  // The kept row is still in the pool, and the toast names what was replaced.
  await bankTab(page, "pool");
  await expect(row(page, kept), "the kept row left the bank").toHaveCount(1);
  const goneName = before.ranked.find((r) => r.id === gone[0]).name;
  await expect.poll(() => page.evaluate(() => window.__pwToasts.join("\n")), { timeout: 30_000 }).toContain(`sound it could: ${goneName}`);
  const said = await page.evaluate(() => window.__pwToasts.filter((t) => /It replaced/.test(t)));
  expect(said.some((t) => keptName && t.includes(`it could: ${keptName}`)), "a toast said the kept sound was replaced").toBe(false);

  // Pointing at EVOLVE POOL marks what may be replaced, never the kept sound.
  await goLevel(page, "evolve");
  await page.locator("#evolve-wrap").hover();
  const may = () => page.evaluate(() => [...document.querySelectorAll("#bank-list .bank-item.may-go")].map((e) => Number(e.dataset.id)));
  await expect.poll(async () => (await may()).length, { timeout: 30_000 }).toBeGreaterThan(0);
  expect(await may(), "the kept sound is marked \"may be replaced\"").not.toContain(kept);
  await page.mouse.move(5, 5);
  expect(errors, errors.join("\n")).toEqual([]);
});
