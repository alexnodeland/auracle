// EVOLVE says what is true, and its gestures mean one thing (the interaction
// spec's Wave 0, "true today").
//
// - ⌘Z outside PATCH never reaches the PATCH edit undo: with no pick or cut
//   to take back it says so and changes nothing. It used to fall through and
//   revert a knob turned minutes earlier on a patch the player could not see.
// - The sixth pick is undoable like the other five: its refit waits for its
//   window. It used to be committed the moment the next pair landed.
// - "● it just learned" appears only once `fitted` has answered, and stays
//   until the next pick. It used to appear when the refit was *sent*.
// - "another pair" (↻) with no pair dealt ahead puts the pair away like a
//   pick does: inert buttons, and after 300 ms a reason on the cards. It used
//   to leave the old pair up with buttons that looked live and did nothing.
// - A cut patch is never dealt again, and its toast names it without an id.
// - After clicking the EVOLVE tab, → picks.
// - An open is not announced unless it kept the player waiting.
//
// The engine worker is reached the way the other specs reach it: by wrapping
// `Worker` before main.js runs. Sessions are seeded (the films' own
// Math.random), so the pool and the sides are the same run to run.
const { test, expect } = require("@playwright/test");

const SEED = `(() => { let s = 20260927 >>> 0; Math.random = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();`;

const init = ({ warmed = true, holdAhead = false } = {}) => `(() => {
  if (${holdAhead}) window.__pwHold = { "duel:ahead": 1e9 };
  const Orig = window.Worker;
  const workers = (window.__pwWorkers = []);
  const last = (window.__pwLast = {});
  const sent = (window.__pwSent = {});
  const counts = (window.__pwCounts = {});
  const log = (window.__pwLog = []);
  function Wrapped(url, opts) {
    const w = new Orig(url, opts);
    w.__pwUrl = String(url);
    workers.push(w);
    w.addEventListener("message", (e) => {
      const d = e.data;
      if (d && typeof d.type === "string") {
        last[d.type] = d;
        counts[d.type] = (counts[d.type] || 0) + 1;
        log.push({ type: d.type, at: performance.now() });
      }
    });
    const post = w.postMessage.bind(w);
    w.postMessage = (m, t) => {
      if (m && m.type) {
        counts["sent:" + m.type] = (counts["sent:" + m.type] || 0) + 1;
        sent[m.type] = m;
        log.push({ type: "sent:" + m.type, at: performance.now() });
        // A request held back on request (a deal, an open): the stand-in for
        // an engine busy with a generation, which is when they wait seconds.
        // A deal asked for ahead of the pick (main.js requestAhead) is held
        // as "duel:ahead", so a spec can have no pair waiting.
        const key = m.type === "duel" && m.ahead ? "duel:ahead" : m.type;
        const ms = (window.__pwHold || {})[key];
        if (ms > 0) {
          setTimeout(() => post(m, t), ms);
          return;
        }
      }
      return post(m, t);
    };
    return w;
  }
  Wrapped.prototype = Orig.prototype;
  window.Worker = Wrapped;
  window.__pwEngine = () => workers.find((w) => /worker\\.js/.test(w.__pwUrl)) || null;
  const toasts = (window.__pwToasts = []);
  const teach = (window.__pwTeach = []);
  document.addEventListener("DOMContentLoaded", () => {
    const lane = document.getElementById("toasts");
    if (lane) {
      new MutationObserver((muts) => {
        for (const m of muts)
          for (const n of m.addedNodes) {
            const msg = n.querySelector && n.querySelector(".toast-msg");
            if (msg) toasts.push({ text: msg.textContent, at: performance.now() });
          }
      }).observe(lane, { childList: true });
    }
    // Every sentence the teaching meter says, with when it said it.
    const copy = document.getElementById("teach-copy");
    if (copy) {
      new MutationObserver(() => teach.push({ text: copy.textContent, at: performance.now() }))
        .observe(copy, { childList: true, subtree: true, characterData: true });
    }
  });
  try {
    const seen = ["auracle-played", "auracle-bench-tour", "auracle-bank-toured"];
    if (${warmed}) seen.push("auracle-warmed");
    for (const k of seen) localStorage.setItem(k, "1");
  } catch (_) {}
})();`;

async function boot(page, opts = {}) {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await page.addInitScript(SEED);
  await page.addInitScript(init(opts));
  await page.goto(`/${opts.query || ""}`);
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 150_000 });
  return pageErrors;
}

const count = (page, type) => page.evaluate((t) => window.__pwCounts[t] || 0, type);
const picks = async (page) => Number(await page.locator("#duel-count").textContent());
const cardIds = (page) =>
  page.evaluate(() => ["a", "b"].map((s) => Number(document.querySelector(`#name-${s} .dn-id`).textContent.replace("#", ""))));
const toastsSince = (page, k) => page.evaluate((i) => window.__pwToasts.slice(i).map((t) => t.text), k);
const toastMark = (page) => page.evaluate(() => window.__pwToasts.length);

async function toEvolve(page) {
  await page.waitForFunction(() => window.__pwLast.duel && window.__pwLast.duel.pair, null, { timeout: 60_000 });
  await page.locator('.viewtab[data-view="evolve"]').click();
  await expect(page.locator("#choose-a")).toBeEnabled({ timeout: 30_000 });
  await expect(page.locator("#name-a .dn-id")).toBeAttached({ timeout: 30_000 });
}

async function pick(page, side = "a") {
  await expect(page.locator(`#choose-${side}`)).toBeEnabled({ timeout: 30_000 });
  await page.locator(`#choose-${side}`).click();
}

test("⌘Z in EVOLVE with nothing to take back says so and leaves the PATCH edit alone", async ({ page }) => {
  const pageErrors = await boot(page);
  // An edit in PATCH, so there is something edit undo *could* take back.
  await page.waitForFunction(() => window.__aur && window.__aur.wb && window.__aur.wb.rack, null, { timeout: 60_000 });
  await page.locator('.viewtab[data-view="play"]').click();
  const knob = page.locator("#rack-svg [data-addr]").first();
  await expect(knob).toBeAttached({ timeout: 30_000 });
  await knob.focus();
  const before = await knob.getAttribute("aria-valuetext");
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowUp");
  await expect(knob).not.toHaveAttribute("aria-valuetext", before, { timeout: 10_000 });
  const edited = await knob.getAttribute("aria-valuetext");
  await page.waitForTimeout(1500); // the edit's reply, so the stack holds it

  await toEvolve(page);
  const restores = await count(page, "sent:edit_set_tree");
  await page.keyboard.press("Control+z");
  await expect(page.locator("#toasts .toast-msg")).toHaveText("nothing to undo here — PATCH edits undo in PATCH", { timeout: 1_500 });
  // Pressed again, it is said once, not queued twice.
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(1500);
  expect(await count(page, "sent:edit_set_tree"), "⌘Z in EVOLVE sent an edit undo").toBe(restores);
  expect(await page.locator("#toasts .toast").count()).toBe(1);

  // Back in PATCH the edit is still there, and ⌘Z there does undo it.
  await page.locator('.viewtab[data-view="play"]').click();
  await expect(knob).toHaveAttribute("aria-valuetext", edited);
  await page.keyboard.press("Control+z");
  await expect.poll(() => count(page, "sent:edit_set_tree"), { timeout: 10_000 }).toBeGreaterThan(restores);
  await expect(knob).toHaveAttribute("aria-valuetext", before, { timeout: 10_000 });
  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});

test("the sixth pick can be taken back, and it just learned only once fitted has landed", async ({ page }) => {
  test.setTimeout(300_000);
  const pageErrors = await boot(page);
  await toEvolve(page);
  const copy = page.locator("#teach-copy");
  const n0 = await picks(page);
  const fits = await count(page, "sent:fit");

  for (let i = 1; i <= 6; i++) {
    await pick(page, i % 2 ? "a" : "b");
    if (i < 6) await page.waitForTimeout(300);
  }
  // Six pips, and the meter says the refit is coming — not that it came.
  await expect(page.locator("#teach-pips i.lit")).toHaveCount(6);
  await expect(copy).toHaveText("● learning from your last 6 picks…");
  await expect(page.locator("#duel-mid")).toHaveClass(/\blearning\b/);
  await page.waitForTimeout(1500);
  expect(await count(page, "sent:fit"), "the refit went out inside the sixth pick's window").toBe(fits);

  // ⌘Z takes the sixth pick back like any other.
  await page.keyboard.press("Control+z");
  expect(await picks(page)).toBe(n0 + 5);
  await expect(page.locator("#teach-pips i.lit")).toHaveCount(5);
  await expect(copy).toContainText("1 more pick");
  await expect(page.locator("#toasts .toast", { hasText: "Picked " })).toHaveCount(0);

  // The sixth again: the refit goes out when its window closes, 7 s on.
  await pick(page, "b");
  await expect.poll(() => count(page, "sent:fit"), { timeout: 20_000 }).toBeGreaterThan(fits);
  // From the pick itself (its forecast request goes out in the click's own
  // task) to the refit.
  const waited = await page.evaluate(() => {
    const fitAt = window.__pwLog.find((e) => e.type === "sent:fit").at;
    const pickAt = window.__pwLog.filter((e) => e.type === "sent:duel_pred" && e.at < fitAt).pop().at;
    return fitAt - pickAt;
  });
  console.log(`refit sent ${Math.round(waited)} ms after the sixth pick`);
  expect(waited, "the refit did not wait for the sixth pick's window").toBeGreaterThanOrEqual(6_990);
  // Its toast's window closed with it: the button goes, no dead "IN THE LOG".
  await expect(page.locator("#toasts .toast-undo", { hasText: /in the log/i })).toHaveCount(0);

  // "● it just learned" only after `fitted`, and it stays with no timer.
  await expect.poll(() => count(page, "fitted"), { timeout: 120_000 }).toBeGreaterThan(0);
  await expect(copy).toContainText("● it just learned — see what changed ▸", { timeout: 2_000 });
  const t = await page.evaluate(() => ({
    fitted: window.__pwLog.find((e) => e.type === "fitted").at,
    learned: (window.__pwTeach.find((e) => e.text.includes("it just learned")) || {}).at,
  }));
  expect(t.learned, "it said it had learned before fitted landed").toBeGreaterThanOrEqual(t.fitted);
  await expect(page.locator("#duel-mid")).toHaveClass(/\blearned\b/);
  await page.waitForTimeout(5_000);
  await expect(copy).toContainText("it just learned");

  // "see what changed" is the map, whichever TASTE tab was last open.
  await page.locator('.viewtab[data-view="taste"]').click();
  await page.locator('.tab[data-tab="trust"]').click();
  await page.locator('.viewtab[data-view="evolve"]').click();
  await page.locator("#teach-copy .teach-link").click();
  await expect(page.locator("#view-taste")).toBeVisible();
  await expect(page.locator('.tab[data-tab="map"]')).toHaveClass(/\bactive\b/);

  // The next pick ends it.
  await page.locator('.viewtab[data-view="evolve"]').click();
  await pick(page, "a");
  await expect(copy).toContainText("5 more picks");
  await expect(page.locator("#teach-pips i.lit")).toHaveCount(1);
  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});

test("another pair leaves no live-looking buttons while it deals, and says why when slow", async ({ page }) => {
  // No pair dealt ahead (it would go up at once; see evolve_ahead.spec.js):
  // this is the deal a pick or ↻ waits for when none is waiting.
  const pageErrors = await boot(page, { holdAhead: true });
  await toEvolve(page);
  const n0 = await picks(page);
  const [a0, b0] = await cardIds(page);
  await page.evaluate(() => { window.__pwHold = { duel: 2500 }; });
  await page.locator("#skip-duel").click();
  // Inert at once, like after a pick.
  for (const id of ["#choose-a", "#choose-b", "#skip-duel", "#pd-pick-a", "#pd-pick-b", "#pd-skip"]) {
    await expect(page.locator(id)).toBeDisabled();
  }
  await expect(page.locator("#duel-a")).toHaveClass(/\bdealing\b/);
  // After 300 ms the dimmed cards say why.
  await expect(page.locator("#duel-a .deal-why")).toBeVisible({ timeout: 1_500 });
  await expect(page.locator("#duel-a .deal-why")).toHaveText(/^dealing/);
  // A pick by key now does nothing at all — no vote on a pair being put away.
  await page.keyboard.press("ArrowRight");
  expect(await picks(page)).toBe(n0);
  await expect(page.locator("#toasts .toast", { hasText: "Picked " })).toHaveCount(0);
  // The new pair lands live, and the reason goes.
  await page.evaluate(() => { window.__pwHold = {}; });
  await expect(page.locator("#choose-a")).toBeEnabled({ timeout: 10_000 });
  await expect(page.locator("#duel-a .deal-why")).toBeHidden();
  await expect(page.locator("#duel-a")).not.toHaveClass(/\bdealing\b/);
  const [a1, b1] = await cardIds(page);
  expect([a1, b1]).not.toEqual([a0, b0]);
  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});

test("a cut patch is not dealt again, and its toast names it without an id", async ({ page }) => {
  const pageErrors = await boot(page);
  await toEvolve(page);
  const [cut] = await cardIds(page);
  const row = page.locator(`#bank-list .bank-item[data-id="${cut}"]`);
  await row.scrollIntoViewIfNeeded();
  await row.hover();
  // ⌘Z takes a cut back — the newest teaching act, inside its window — and
  // the row comes back. Then it is cut for good.
  await row.locator(".bi-kill").click();
  await expect(row).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(row).toBeVisible();
  await row.hover();
  const mark = await toastMark(page);
  await row.locator(".bi-kill").click();
  await expect(row).toHaveCount(0);
  // Its toast may wait its turn in the lane behind one already on screen.
  let said;
  await expect.poll(async () => (said = (await toastsSince(page, mark)).find((t) => t.startsWith("Cut "))),
    { timeout: 15_000 }).toBeTruthy();
  expect(said).toMatch(/^Cut .+ — it won't be dealt again$/);
  expect(said).not.toMatch(/#\d/);
  // The pair it was on is put away; no deal from here on includes it.
  await expect(page.locator("#choose-a")).toBeEnabled({ timeout: 10_000 });
  for (let i = 0; i < 8; i++) {
    expect(await page.evaluate(() => window.__pwSent.duel.exclude)).toContain(cut);
    expect(await cardIds(page)).not.toContain(cut);
    await page.locator("#skip-duel").click();
    await expect(page.locator("#choose-a")).toBeEnabled({ timeout: 10_000 });
  }
  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});

test("after clicking the EVOLVE tab, → picks", async ({ page }) => {
  const pageErrors = await boot(page);
  await toEvolve(page); // arrives by a pointer click on the tab
  const focus = await page.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.tagName));
  console.log(`focus after the tab click: ${focus}`);
  expect(focus).toBe("view-evolve");
  const n0 = await picks(page);
  await page.keyboard.press("ArrowRight");
  expect(await picks(page)).toBe(n0 + 1);
  await expect(page.locator("#view-evolve")).toBeVisible();
  await expect(page.locator("#toasts .toast-msg")).toContainText("Picked ");
  // A keyboard user on the tablist still walks the tabs with the arrows.
  await page.locator('.viewtab[data-view="evolve"]').focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#view-taste")).toBeVisible();
  expect(await picks(page)).toBe(n0 + 1);
  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});

test("opening a patch is not announced unless it kept you waiting", async ({ page }) => {
  const pageErrors = await boot(page);
  await toEvolve(page);
  await page.locator('.viewtab[data-view="play"]').click();
  const mark = await toastMark(page);
  const rows = page.locator("#bank-list .bank-item");
  for (const i of [1, 2]) {
    await rows.nth(i).locator(".bi-name").click();
    await page.waitForFunction((id) => window.__aur.wb.subjectId === id,
      Number(await rows.nth(i).getAttribute("data-id")), { timeout: 30_000 });
  }
  await page.waitForTimeout(1000);
  const said = await toastsSince(page, mark);
  console.log(`toasts while opening: ${JSON.stringify(said)}`);
  for (const t of said) {
    expect(t).not.toMatch(/on the bench|workbench|under your fingers|Opened/);
  }
  // An open that keeps the player waiting over a second is said when it
  // lands, by name: news, because the click showed nothing for a while.
  await page.evaluate(() => { window.__pwHold = { edit_begin: 1800 }; });
  const slow = rows.nth(3);
  const name = (await slow.locator(".bi-name").textContent()).trim();
  const mark2 = await toastMark(page);
  await slow.locator(".bi-name").click();
  await expect.poll(() => toastsSince(page, mark2), { timeout: 15_000 }).toContain(`Opened ${name}`);
  await page.evaluate(() => { window.__pwHold = {}; });
  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});

// With no render farm (`?farm=0`, or a machine too small for one) a
// generation's walks run in the engine worker, and a deal can wait for the
// walk in progress. On the farm it does not wait at all
// (evolve_breeds_beside_you.spec.js).
test("with no farm, a pick's deal during a generation says which seed it waits on, and what it bred and replaced is named", async ({ page }) => {
  test.setTimeout(600_000);
  const pageErrors = await boot(page, { query: "?farm=0" });
  await toEvolve(page);
  // A model to breed toward: six picks, and their refit landed.
  for (let i = 1; i <= 6; i++) await pick(page, i % 2 ? "a" : "b");
  await expect.poll(() => count(page, "fitted"), { timeout: 120_000 }).toBeGreaterThan(0);
  await expect(page.locator("#wm-lamp")).not.toHaveClass(/\bthinking\b/, { timeout: 5_000 });

  const mark = await toastMark(page);
  await page.locator("#evolve-btn").click();
  await expect(page.locator("#wm-lamp")).toHaveClass(/\bthinking\b/);
  const breedingNow = () => page.locator("#evolve-btn").isDisabled();
  // Picks while it breeds. A deal waits for the seed being bred, and the
  // dimmed cards say so, with the seed it waits on.
  const reasons = new Set();
  // Pick until six picks have counted toward the next refit. A pick can be
  // refused inside its undo window when a seed of this generation replaces
  // the patch it chose (the engine replaces as it breeds): the app un-counts
  // it and says so, so a sixth click is not always a sixth pick.
  let sawSixth = false;
  for (let i = 1; i <= 12 && !sawSixth && (await breedingNow()); i++) {
    await pick(page, i % 2 ? "a" : "b");
    const t0 = Date.now();
    while (Date.now() - t0 < 60_000 && (await page.locator("#choose-a").isDisabled())) {
      // Read in one go: the deal can land between two separate reads.
      const why = await page.evaluate(() => {
        const el = document.querySelector("#duel-a .deal-why");
        return el && el.offsetParent !== null ? el.textContent.trim() : null;
      });
      if (why) reasons.add(why);
      await page.waitForTimeout(250);
    }
    // The sixth of a new row: the refit waits for the generation, and the
    // meter says that rather than "learning" or "it just learned".
    const copy = (await page.locator("#teach-copy").textContent()).trim();
    if (copy.startsWith("●")) {
      if (await breedingNow()) expect(copy).toBe("● it will learn from these 6 when breeding finishes");
      sawSixth = true;
    }
  }
  console.log(`deal reasons seen during the generation: ${JSON.stringify([...reasons])}`);
  for (const r of reasons) {
    expect(r).toMatch(/^dealing — the engine is (breeding \(seed \d+\/\d+\)|breeding|placing a bred generation in the pool)$|^dealing…$/);
  }
  expect([...reasons].some((r) => /breeding \(seed \d+\/10\)/.test(r)), "no deal said which seed it waited on").toBe(true);

  await expect(page.locator("#evolve-btn")).toBeEnabled({ timeout: 400_000 });
  const said = await toastsSince(page, mark);
  const receipt = said.find((t) => /^Gen \d+:/.test(t));
  console.log(`generation receipt: ${receipt}`);
  expect(receipt).toBeTruthy();
  expect(receipt).not.toMatch(/#\d|retired/);
  if (/replaced/.test(receipt)) expect(receipt).toMatch(/replaced: [^.]*\S\./);
  // The strip names parent and child and says "liked", not "Δtaste" or ids.
  const lineage = (await page.locator("#lineage-log").textContent()).trim();
  console.log(`lineage strip: ${lineage.slice(0, 300)}`);
  expect(lineage).not.toMatch(/#\d|Δtaste|no proposal beat/);
  if (/gen \d/.test(lineage)) expect(lineage).toMatch(/→ .+ · .* liked [+−]\d/);
  else expect(lineage).toContain("no move was accepted");
  // The lamp stays lit while the refit the sixth pick armed still runs; the
  // generation's reply no longer puts it out under the refit.
  if (sawSixth) {
    const state = await page.evaluate(() => ({
      fitted: window.__pwCounts.fitted || 0,
      lit: document.getElementById("wm-lamp").classList.contains("thinking"),
    }));
    if (state.fitted === 1) expect(state.lit, "the generation's reply put out the refit's lamp").toBe(true);
    await expect.poll(() => count(page, "fitted"), { timeout: 120_000 }).toBeGreaterThan(1);
    await expect(page.locator("#teach-copy")).toContainText("it just learned", { timeout: 5_000 });
  }
  await expect(page.locator("#wm-lamp")).not.toHaveClass(/\bthinking\b/, { timeout: 5_000 });
  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});
