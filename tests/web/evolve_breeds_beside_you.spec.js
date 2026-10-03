// A generation breeds beside the player (RFC-001, plan-001 tasks 4–6, and the
// interaction review's RT1, RT2, RT9, EV-05, EV-07, PA-07, SH3).
//
// EVOLVE POOL used to hold the engine worker for its whole two to three
// minutes: a pick's next pair waited for the walk in progress (up to ~20 s),
// and PERFORM's measurement of a newly opened patch, a pressed Offer and every
// refit waited for all of it. ⚡ evolve from this was one 23 s call that
// answered nothing. Now both are walks on the render farm, and the engine
// worker only folds the results in, in job order:
//
// - EVOLVE POOL completes, and each child lands at the top of the bank, in a
//   "new · generation N" group, in job order, as it is absorbed — the ranked
//   rows below it do not move. The button is its own progress bar, naming
//   each walk as it comes back ("walk 3 of 10"), and the job slot counts the
//   generation with an estimate; the wordmark's lamp is lit exactly while the
//   slot shows.
// - A pick mid-generation deals its next pair within a second.
// - PERFORM is answered during a generation: a newly opened patch is measured
//   (its controls wired) before the generation ends, and a pressed Offer
//   starts at once.
// - GENERATIONS and the next-step chip count a generation once it has bred,
//   not when a pick's status (which carries the open generation) lands.
// - Stop ends with what has been bred, and only then are patches retired.
// - ⚡ evolve from this leaves the engine free: a deal is answered within a
//   second while it walks, a ▶ costs only its own render, and its stop drops
//   it. It and EVOLVE POOL take turns: each is disabled while the other runs,
//   and says why on hover. (A cold ▶ is a render, 0.3–1 s on a quiet machine and more on a busy
//   one, so it is held to "answered while ⚡ still walks", not to a second.)
//
// Every test logs what it measured. Sessions are seeded (the films' own
// Math.random), so the pool and the generation are the same run to run.
// `?farm=N` sets the crew's width; the default is the app's own rule.
const { test, expect } = require("@playwright/test");
const { goLevel } = require("./shell");

const SEED = `(() => { let s = 20260928 >>> 0; Math.random = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();`;

const init = `(() => {
  const Orig = window.Worker;
  const workers = (window.__pwWorkers = []);
  const last = (window.__pwLast = {});
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
        log.push({ type: d.type, at: performance.now(), index: d.index, child: d.child, id: d.id, generation: d.generation });
      }
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
  const toasts = (window.__pwToasts = []);
  const lamp = (window.__pwLamp = []);
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
    // Every change of the lamp or the slot, with whether they agreed.
    const e = document.getElementById("wm-lamp");
    const slot = document.getElementById("job-slot");
    if (e && slot) {
      const check = () => lamp.push({
        lit: e.classList.contains("thinking"),
        shown: !slot.classList.contains("hidden"),
        text: slot.textContent.trim(),
        at: performance.now(),
      });
      const mo = new MutationObserver(check);
      mo.observe(e, { attributes: true, attributeFilter: ["class"] });
      mo.observe(slot, { attributes: true, attributeFilter: ["class"], childList: true, subtree: true, characterData: true });
    }
  });
  try {
    for (const k of ["auracle-played", "auracle-bench-tour", "auracle-bank-toured", "auracle-warmed"]) localStorage.setItem(k, "1");
  } catch (_) {}
})();`;

async function boot(page, query = "") {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await page.addInitScript(SEED);
  await page.addInitScript(init);
  await page.goto(`/${query}`);
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 150_000 });
  return pageErrors;
}

const count = (page, type) => page.evaluate((t) => window.__pwCounts[t] || 0, type);
const logOf = (page) => page.evaluate(() => window.__pwLog.slice());
const toastsSince = (page, k) => page.evaluate((i) => window.__pwToasts.slice(i).map((t) => t.text), k);
const toastMark = (page) => page.evaluate(() => window.__pwToasts.length);

/** Boot, go to EVOLVE, make six picks and wait for their refit: a model to
 *  breed toward. */
async function taught(page, query) {
  const pageErrors = await boot(page, query);
  await page.waitForFunction(() => window.__pwLast.duel && window.__pwLast.duel.pair, null, { timeout: 60_000 });
  await goLevel(page, "evolve");
  for (let i = 1; i <= 6; i++) {
    await expect(page.locator(i % 2 ? "#choose-a" : "#choose-b")).toBeEnabled({ timeout: 30_000 });
    await page.locator(i % 2 ? "#choose-a" : "#choose-b").click();
  }
  await expect.poll(() => count(page, "fitted"), { timeout: 120_000 }).toBeGreaterThan(0);
  await expect(page.locator("#wm-lamp")).not.toHaveClass(/\bthinking\b/, { timeout: 10_000 });
  await expect(page.locator("#job-slot")).toBeHidden();
  return pageErrors;
}

/** Ms from each `sent:<req>` after `since` to the first `<reply>` after it. */
function latencies(log, req, reply, since = 0) {
  const out = [];
  for (let k = 0; k < log.length; k++) {
    const e = log[k];
    if (e.type !== `sent:${req}` || e.at < since) continue;
    const r = log.slice(k + 1).find((x) => x.type === reply);
    if (r) out.push(Math.round(r.at - e.at));
  }
  return out;
}

const bankIds = (page) =>
  page.evaluate(() => [...document.querySelectorAll("#bank-list .bank-item[data-id]")].map((el) => Number(el.dataset.id)));

test("EVOLVE POOL breeds beside you: children land in order at the top of the bank, and a pick deals its next pair within 1 s", { tag: "@slow" }, async ({ page }) => {
  test.setTimeout(600_000);
  const pageErrors = await taught(page);
  await page.waitForFunction(() => window.__aur && window.__aur.wb && window.__aur.wb.rack, null, { timeout: 60_000 });
  const before = await bankIds(page);
  const mark = await toastMark(page);
  const t0 = await page.evaluate(() => performance.now());

  await page.locator("#evolve-btn").click();
  // ⚡ takes turns with a generation: disabled while it breeds, and it says
  // why where a hover finds it (a disabled button shows no title).
  await expect(page.locator("#rack-evolve")).toBeDisabled();
  await expect(page.locator(".evolve-slot")).toHaveAttribute("title", /EVOLVE POOL is breeding a generation, and ⚡ waits for it/);
  // The button is its own progress bar, the slot names the job, the E is lit.
  await expect(page.locator("#evolve-btn")).toHaveClass(/\bbreeding\b/);
  await expect(page.locator("#job-slot")).toBeVisible();
  await expect(page.locator("#job-text")).toHaveText(/^⚡ breeding( \d+\/10.*|…)$/);
  await expect(page.locator("#wm-lamp")).toHaveClass(/\bthinking\b/);
  await expect(page.locator("#evolve-btn .eb-text")).toHaveText(/^(breeding \d+\/10|walk \d+ of 10)$/, { timeout: 30_000 });
  await expect(page.locator("#evolve-stop")).toBeVisible();

  // The first child lands at the top, under "new · generation N", and the ranked
  // rows below it keep their order. (No pick is pending here: a vote
  // reweights the model, and would move rows for a reason of its own.)
  let firstChild = null;
  await expect.poll(async () => {
    const log = await logOf(page);
    firstChild = (log.find((e) => e.type === "refine_child" && e.child > 0) || {}).child || null;
    return firstChild;
  }, { timeout: 300_000 }).toBeTruthy();
  await expect(page.locator("#bank-list .bank-group.new .bg-label")).toHaveText(/^new · generation \d+$/);
  const mid = await bankIds(page);
  expect(mid[0], "the first child is not the bank's first row").toBe(firstChild);
  const rest = mid.filter((id) => before.includes(id));
  expect(rest, "the ranked rows moved while a child landed").toEqual(before.filter((id) => rest.includes(id)));
  // Nothing has left the bank yet: replacement waits for the end.
  expect(before.every((id) => mid.includes(id)), "a patch left the bank before the generation ended").toBe(true);

  // Picks while it breeds: each next pair is dealt within a second.
  const pickFrom = await page.evaluate(() => performance.now());
  for (let i = 0; i < 3; i++) {
    await expect(page.locator("#choose-a")).toBeEnabled({ timeout: 10_000 });
    await page.locator(i % 2 ? "#choose-b" : "#choose-a").click();
    await expect(page.locator("#choose-a")).toBeEnabled({ timeout: 10_000 });
    await page.waitForTimeout(2_500);
  }
  const midway = await page.locator("#evolve-btn").evaluate((b) => b.classList.contains("breeding"));
  const deals = latencies(await logOf(page), "duel", "duel", pickFrom);
  console.log(`deal latency during the generation (ms): ${JSON.stringify(deals)}; still breeding after the picks: ${midway}`);
  expect(midway, "the generation ended before the picks could test it").toBe(true);
  expect(deals.length).toBeGreaterThanOrEqual(3);
  for (const ms of deals) expect(ms, "a pick's next pair waited on the generation").toBeLessThan(1_000);

  await expect(page.locator("#evolve-btn")).not.toHaveClass(/\bbreeding\b/, { timeout: 480_000 });
  const t1 = await page.evaluate(() => performance.now());
  const log = await logOf(page);
  const kids = log.filter((e) => e.type === "refine_child");
  console.log(`generation: ${Math.round((t1 - t0) / 1000)} s, ${kids.length} jobs, children ${JSON.stringify(kids.map((e) => e.child))}`);
  console.log(`absorbed at (s): ${JSON.stringify(kids.map((e) => Math.round((e.at - t0) / 100) / 10))}`);
  expect(kids.map((e) => e.index), "jobs were not absorbed in order").toEqual([...Array(kids.length).keys()]);
  expect(kids.length).toBe(10);

  // The group holds the children, in the order they were bred.
  const born = kids.map((e) => e.child).filter((id) => id > 0);
  const after = await bankIds(page);
  const survivors = born.filter((id) => after.includes(id));
  expect(after.slice(0, survivors.length)).toEqual(survivors);
  expect(after.length, "the pool is back to size").toBeLessThanOrEqual(40);
  const receipt = (await toastsSince(page, mark)).find((t) => /^Generation \d+:/.test(t));
  const retired = (await page.evaluate(() => window.__pwLast.refined)).retired || [];
  console.log(`receipt: ${receipt} (retired ${JSON.stringify(retired)})`);
  expect(receipt).toBeTruthy();
  // It counts the children kept, names what they replaced, and only now did
  // those leave the bank.
  expect(receipt).toContain(`Generation ${(await page.evaluate(() => window.__pwLast.refined)).status.generation}: ${survivors.length} new sound`);
  if (retired.some((id) => !born.includes(id))) expect(receipt).toMatch(/it could: [^.]*\S\./);
  for (const id of retired) expect(after).not.toContain(id);
  await expect(page.locator("#job-slot")).toBeHidden({ timeout: 10_000 });
  // ⚡'s turn: the generation is over.
  await expect(page.locator("#rack-evolve")).toBeEnabled();
  // The lamp and the slot never disagreed.
  const lamp = await page.evaluate(() => window.__pwLamp.slice());
  expect(lamp.filter((s) => s.lit !== s.shown), "the E and the job slot disagreed").toEqual([]);
  expect(lamp.some((s) => /⚡ breeding \d+\/10 · (about \d+ (s|min)|almost done)/.test(s.text)), "the slot never gave an estimate").toBe(true);
  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});

test("GENERATIONS and the next-step chip count a generation once a child of it has landed, not when a pick's status does", { tag: "@slow" }, async ({ page }) => {
  test.setTimeout(600_000);
  const pageErrors = await taught(page);
  await expect(page.locator("#gen-count")).toHaveText("0");
  await page.locator("#evolve-btn").click();
  await expect(page.locator("#evolve-btn .eb-text")).toHaveText(/^(breeding \d+\/10|walk \d+ of 10)$/, { timeout: 30_000 });
  await expect(page.locator("#nextstep")).toHaveText("Breeding: keep playing ▸");

  // A pick while the first generation breeds. Its status comes back when its
  // undo window closes, and the engine has counted the open generation since
  // it opened: before, that one status turned GENERATIONS to 1 and the chip to
  // "Gen 1 bred — see what it thinks of your taste" with nothing bred.
  const statuses = await count(page, "status");
  await expect(page.locator("#choose-a")).toBeEnabled({ timeout: 10_000 });
  await page.locator("#choose-a").click();
  await expect.poll(() => count(page, "status"), { timeout: 30_000 }).toBeGreaterThan(statuses);
  const early = await page.evaluate(() => ({
    generation: window.__pwLast.status.status.generation,
    landed: window.__pwLog.some((e) => e.type === "refine_child" && e.child > 0),
    count: document.getElementById("gen-count").textContent,
    chip: document.getElementById("nextstep").textContent,
  }));
  console.log(`after a pick mid-generation: ${JSON.stringify(early)}`);
  expect(early.generation, "the pick's status predates the generation, so nothing was tested").toBe(1);
  if (!early.landed) {
    expect(early.count, "GENERATIONS counted a generation that has bred nothing").toBe("0");
    expect(early.chip).toBe("Breeding: keep playing ▸");
  }

  // Its first child lands: now it counts, and the chip points at it.
  await expect.poll(async () => (await logOf(page)).some((e) => e.type === "refine_child" && e.child > 0), { timeout: 300_000 }).toBe(true);
  await expect(page.locator("#gen-count")).toHaveText("1");
  await expect(page.locator("#nextstep")).toHaveText(/^Generation 1 bred (a new sound: it’s|\d+ new sounds: they’re) at the top of the bank ▸$/);

  // Stopped, unless its walks have already ended it (on a fast farm the last
  // ones land in a burst, and STOP goes with the generation): either way it
  // ends as generation 1.
  const stop = page.locator("#evolve-stop");
  if (await stop.isVisible()) await stop.click({ timeout: 5_000 }).catch(() => {});
  await expect(page.locator("#evolve-btn")).not.toHaveClass(/\bbreeding\b/, { timeout: 120_000 });
  await expect(page.locator("#gen-count")).toHaveText("1");
  await expect(page.locator("#nextstep")).toHaveText(/^Generation 1 bred/);
  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});

test("stop ends with what's bred, and replaced patches leave only then", { tag: "@slow" }, async ({ page }) => {
  test.setTimeout(600_000);
  const pageErrors = await taught(page);
  const mark = await toastMark(page);
  await page.locator("#evolve-btn").click();
  // Two jobs absorbed, then stop from the job slot.
  await expect.poll(() => count(page, "refine_child"), { timeout: 400_000 }).toBeGreaterThanOrEqual(2);
  const landed = (await logOf(page)).filter((e) => e.type === "refine_child");
  // Hovering EVOLVE POOL marks what the generation would replace if it ended
  // now: one more with each child it admits (the engine's `retiring`).
  if (landed.some((e) => e.child > 0)) {
    await page.locator("#evolve-wrap").hover();
    await expect.poll(() => page.locator("#bank-list .bank-item.may-go").count(), { timeout: 5_000 }).toBeGreaterThan(0);
    await page.mouse.move(5, 5);
  }
  await expect(page.locator("#job-stop")).toBeVisible();
  await page.locator("#job-stop").click();
  await expect(page.locator("#evolve-btn")).not.toHaveClass(/\bbreeding\b/, { timeout: 30_000 });
  const refined = await page.evaluate(() => window.__pwLast.refined);
  const born = refined.born;
  console.log(`stopped after ${landed.length}+ jobs: kept ${JSON.stringify(born)}, retired ${JSON.stringify(refined.retired)}`);
  expect(refined.stopped).toBe(true);
  expect(born.length).toBeLessThan(10);
  const ids = await bankIds(page);
  for (const id of born) {
    if (!refined.retired.includes(id)) expect(ids, "a child bred before the stop is gone").toContain(id);
  }
  expect(ids.length, "the pool is back to size").toBeLessThanOrEqual(40);
  for (const id of refined.retired) expect(ids).not.toContain(id);
  const said = await toastsSince(page, mark);
  const receipt = said.find((t) => /^Generation \d+/.test(t));
  console.log(`receipt: ${receipt}`);
  expect(receipt, "the receipt does not say it was stopped").toMatch(/^Generation \d+ stopped/);
  // It counts what stayed: a child can rank below the rest and be retired.
  const kept = born.filter((id) => !refined.retired.includes(id));
  if (kept.length) expect(receipt).toContain(`stopped: ${kept.length} new sound`);
  await expect(page.locator("#job-slot")).toBeHidden({ timeout: 10_000 });
  // Children that land after the stop are nobody's: nothing more arrives.
  const kids = await count(page, "refine_child");
  await page.waitForTimeout(5_000);
  expect(await count(page, "refine_child")).toBe(kids);
  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});

test("during a generation PERFORM is answered: a new patch is measured and a pressed Offer starts within 1 s", { tag: "@slow" }, async ({ page }) => {
  test.setTimeout(600_000);
  const pageErrors = await taught(page);
  await page.locator("#evolve-btn").click();
  await expect(page.locator("#evolve-btn .eb-text")).toHaveText(/^(breeding \d+\/10|walk \d+ of 10)$/, { timeout: 30_000 });
  // A preset PERFORM has not measured, opened mid-generation.
  await page.locator('.bf[data-f="preset"]').click();
  const wired0 = await count(page, "perform_wired");
  const opened = await page.evaluate(() => performance.now());
  await page.locator(".bank-item", { hasText: "Glass Pad" }).first().click();
  await page.waitForTimeout(800);
  await goLevel(page, "perform");
  await expect(page.locator(".pf-name")).toHaveText("Glass Pad", { timeout: 30_000 });
  await page.waitForFunction((n) => (window.__pwCounts.perform_wired || 0) > n &&
    /controls reach/.test(document.querySelector(".pf-status")?.textContent || ""), wired0, { timeout: 300_000 });
  const wiredAt = await page.evaluate(() => performance.now());
  const breedingStill = await page.locator("#evolve-btn").evaluate((b) => b.classList.contains("breeding"));
  console.log(`PERFORM wired ${Math.round((wiredAt - opened) / 100) / 10} s after the open; generation still running: ${breedingStill}`);
  expect(breedingStill, "the measurement waited for the whole generation").toBe(true);

  // Offer at once, before a spare can grow: the engine starts it within 1 s.
  const pressed = await page.evaluate(() => performance.now());
  await page.locator(".pf-pad", { hasText: "Offer" }).click();
  await expect.poll(async () => latencies(await logOf(page), "perform_offer", "busy", pressed).length, { timeout: 30_000 }).toBeGreaterThan(0);
  const started = latencies(await logOf(page), "perform_offer", "busy", pressed);
  console.log(`Offer started ${JSON.stringify(started)} ms after it was sent`);
  expect(started[0], "the pressed Offer waited on the generation").toBeLessThan(1_000);
  await page.waitForSelector(".pf-offer.ready", { timeout: 120_000 });
  const offeredAt = await page.evaluate(() => performance.now());
  console.log(`Offer landed ${Math.round((offeredAt - pressed) / 100) / 10} s after the press`);

  await goLevel(page, "evolve");
  await expect(page.locator("#evolve-btn")).not.toHaveClass(/\bbreeding\b/, { timeout: 480_000 });
  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});

test("⚡ evolve from this leaves the engine free: a deal answers within 1 s and a ▶ while it walks, and its stop drops it", { tag: "@slow" }, async ({ page }) => {
  test.setTimeout(600_000);
  const pageErrors = await taught(page);
  // A ▶ on a row the page has never asked to hear, from the n-th on, so it
  // goes to the engine rather than to a buffer the page already holds.
  const bankPlay = async (n) => {
    const heard = new Set((await logOf(page)).filter((e) => e.type === "render").map((e) => e.id));
    const ids = await bankIds(page);
    const id = ids.slice(n).find((x) => !heard.has(x));
    const row = page.locator(`#bank-list .bank-item[data-id="${id}"]`);
    await row.scrollIntoViewIfNeeded();
    await row.hover();
    const t = await page.evaluate(() => performance.now());
    await row.locator(".bi-hear").click();
    await expect.poll(async () => latencies(await logOf(page), "render", "render", t).length, { timeout: 30_000 }).toBeGreaterThan(0);
    return latencies(await logOf(page), "render", "render", t)[0];
  };
  await page.waitForFunction(() => window.__aur && window.__aur.wb && window.__aur.wb.rack, null, { timeout: 60_000 });
  await goLevel(page, "patch");
  const name = (await page.locator("#rack-subject").textContent()).trim();
  await expect(page.locator("#rack-evolve")).toBeEnabled({ timeout: 30_000 });
  await page.locator("#rack-evolve").click();
  await expect(page.locator("#job-text")).toHaveText(`⚡ evolving ${name}`);
  await expect(page.locator("#rack-evolve")).toBeDisabled();
  // EVOLVE POOL waits for ⚡, and says so on hover.
  await expect(page.locator("#evolve-btn")).toBeDisabled();
  await expect(page.locator("#evolve-wrap")).toHaveAttribute("title", /EVOLVE POOL waits for it/);
  await expect(page.locator("#job-stop")).toBeVisible({ timeout: 30_000 });
  const since = await page.evaluate(() => performance.now());

  // While it walks: a deal in EVOLVE, and a bank row's ▶.
  await goLevel(page, "evolve");
  await expect(page.locator("#skip-duel")).toBeEnabled({ timeout: 10_000 });
  await page.locator("#skip-duel").click();
  await expect(page.locator("#choose-a")).toBeEnabled({ timeout: 10_000 });
  await page.waitForTimeout(2_000);
  const played = await bankPlay(12);
  const playedAt = await page.evaluate(() => performance.now());
  const stillWalking = await page.locator("#job-text").textContent();
  const deals = latencies(await logOf(page), "duel", "duel", since);
  console.log(`during ⚡ (still "${stillWalking}"): deal ${JSON.stringify(deals)} ms; ▶ ${played} ms`);
  expect(stillWalking).toContain("⚡ evolving");
  // The engine answers at once: a deal is a round trip with no render in it.
  expect(deals[0], "the deal waited on ⚡").toBeLessThan(1_000);

  // Let it land.
  await expect.poll(() => count(page, "evolved_from"), { timeout: 300_000 }).toBeGreaterThan(0);
  const first = await page.evaluate(() => window.__pwLast.evolved_from);
  const landedAt = (await logOf(page)).find((e) => e.type === "evolved_from").at;
  const took = landedAt - since;
  // The ▶ cost its own render (its pending ring said so meanwhile) and was
  // answered while ⚡ still walked; it used to wait for the whole walk.
  expect(playedAt, "the ▶ waited for ⚡ to land").toBeLessThan(landedAt);
  console.log(`⚡ landed after ${Math.round(took / 100) / 10} s: child ${first.childId}, reason ${first.reason}`);
  await expect(page.locator("#job-slot")).toBeHidden({ timeout: 10_000 });
  await expect(page.locator("#evolve-btn")).toBeEnabled();
  await expect(page.locator("#evolve-wrap")).toHaveAttribute("title", "");

  // Again, and stop it: answered at once, and nothing is added.
  await goLevel(page, "patch");
  await expect(page.locator("#rack-evolve")).toBeEnabled({ timeout: 30_000 });
  const pool = (await bankIds(page)).length;
  const mark = await toastMark(page);
  await page.locator("#rack-evolve").click();
  await expect(page.locator("#job-stop")).toBeVisible({ timeout: 30_000 });
  const stopAt = await page.evaluate(() => performance.now());
  const answered = await count(page, "evolved_from");
  await page.locator("#job-stop").click();
  await expect.poll(() => count(page, "evolved_from"), { timeout: 3_000 }).toBeGreaterThan(answered);
  const stopped = await page.evaluate(() => window.__pwLast.evolved_from);
  const stopMs = (await logOf(page)).filter((e) => e.type === "evolved_from").pop().at - stopAt;
  console.log(`⚡ stop answered in ${Math.round(stopMs)} ms (${stopped.reason})`);
  expect(stopped.reason).toBe("stopped");
  expect(stopped.childId).toBe(0);
  await expect(page.locator("#job-slot")).toBeHidden();
  await expect.poll(async () => (await toastsSince(page, mark)).find((t) => t.startsWith("⚡ stopped")) || null,
    { timeout: 15_000 }).toBeTruthy();
  await expect(page.locator("#rack-evolve")).toBeEnabled();
  await page.waitForTimeout(3_000);
  expect((await bankIds(page)).length).toBe(pool);
  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});
