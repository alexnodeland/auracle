// Each audio cable carries light by the level the engine measured on it
// (Plan-005 task 7, the worker's `cable_levels`, `edit_cable_levels`). The
// levels are read as the worker posts them, and the rack is held to them: a
// cable for every level, keyed as the rack draws it; its light the level on
// the meter's scale; a mark lit by the same number; modulation cables unlit;
// a structure not measured yet drawn unlit, not estimated; and the probe
// asked once an edit settles, not per knob step.
//
// The worker is reached through the fixture's tap (fixtures.js); a probe is
// made slow at the engine with `app.busy`.
const { test, expect, goLevel, openCatalog } = require("./fixtures");
const { openPreset } = require("./patch_page.js");
const { FLOOR_MS } = require("./perform_budget.js");

const FLOOR = -54;
const gain = (db) => Math.max(0, Math.min(1, (db - FLOOR) / -FLOOR));

/** The rack's audio cables and marks, as drawn. */
const drawn = (page) =>
  page.evaluate(() => ({
    wires: [...document.querySelectorAll("#rack-svg path.wire.audio[data-from]")].map((w) => ({
      key: `${w.dataset.from}>${w.dataset.to}`,
      opacity: Number(w.style.strokeOpacity),
    })),
    marks: [...document.querySelectorAll("#rack-svg .cable-mark")].map((m) => ({
      key: `${m.dataset.from}>${m.dataset.to}`,
      unknown: m.classList.contains("unknown"),
      lit: m.querySelectorAll(".lm-bar.on").length,
    })),
    mods: [...document.querySelectorAll("#rack-svg path.wire.mod[data-from]")].map((w) => ({
      key: `${w.dataset.from}>${w.dataset.to}`,
      opacity: w.style.strokeOpacity,
    })),
  }));

test("cables carry light by the levels the engine measured, keyed as the rack draws them, and modulation cables carry none", async ({ page, app }) => {
  await app.boot({ busy: true });
  await openPreset(app, "Reese");
  // The levels measured on the tree the rack is drawing (an earlier reply can
  // be for the sound the boot opened).
  const measuredHere = () =>
    page.evaluate(() => !!window.__tap.last.cable_levels && window.__tap.last.cable_levels.tree === window.__tap.last.bench.treeJson);
  await app.engine((timeout) => expect.poll(measuredHere, { timeout }).toBe(true), { ms: 60_000 });
  const reply = await app.last("cable_levels");
  const levels = reply.levels.cables;
  expect(levels.length).toBeGreaterThan(0);

  await expect.poll(async () => (await drawn(page)).marks.filter((m) => !m.unknown).length, { timeout: 15_000 }).toBe(levels.length);
  const d = await drawn(page);
  // One cable and one mark per measured cable, by the rack's keys.
  expect(d.wires.map((w) => w.key).sort()).toEqual(levels.map((c) => `${c.from}>${c.to}`).sort());
  for (const c of levels) {
    const key = `${c.from}>${c.to}`;
    const w = d.wires.find((x) => x.key === key);
    const lv = gain(c.rms_db);
    expect(w.opacity, `${key} at ${c.rms_db} dB`).toBeCloseTo(0.2 + 0.62 * lv, 2);
    const m = d.marks.find((x) => x.key === key);
    expect(m.lit, `${key}'s mark`).toBe(lv > 0.66 ? 3 : lv > 0.33 ? 2 : lv > 0.02 ? 1 : 0);
  }
  // Reese's LFO: a modulation cable, not measured, with no mark and no light.
  expect(d.mods.length).toBeGreaterThan(0);
  for (const m of d.mods) {
    expect(d.marks.some((x) => x.key === m.key)).toBe(false);
    expect(m.opacity).toBe("");
  }

  // One probe for the open, not one per knob step: a drag of ten steps asks
  // once, after it settles. The probe is slow at the engine from here, so the
  // hollow marks stand until it answers: an engine that measures fast closes
  // that window between two polls (CI saw it never hollow).
  await app.busy({ cable_levels: 2500 });
  const asked = () => app.sentCount("cable_levels");
  const before = await asked();
  const knob = page.locator("#rack-svg g[data-addr] .knob-hit").first();
  const box = await knob.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - i * 4);
  await page.mouse.up();
  // While the change is unmeasured, the marks are hollow.
  await expect.poll(async () => (await drawn(page)).marks.every((m) => m.unknown), { timeout: 15_000 }).toBe(true);
  await app.engine((timeout) => expect.poll(asked, { timeout }).toBeGreaterThan(before), { ms: 30_000 });
  await app.engine((timeout) => expect.poll(async () => (await drawn(page)).marks.every((m) => !m.unknown), { timeout }).toBe(true), { ms: 30_000 });
  // Not one per step. At most one probe at the engine and one owed
  // (patch.js `askProbe`): on a slow runner the drag's last step can land
  // after the first probe went out, and is measured by one more (CI asked 2).
  expect(await asked(), "a ten-step drag asks once, or once more for its last step").toBeLessThanOrEqual(before + 2);

  // Probes are slow from here (4 s each at the engine). A source placed in a
  // new patch while the empty patch's probe is still out: the page holds the
  // next probe back until that one answers (checked at the end), and the
  // probe that answers then measured whatever tree the bench held by then,
  // which can be the one with the source in it: a measurement, so lit.
  await app.busy({ cable_levels: 4000 });
  await page.locator("#patch-new-btn").click();
  // The empty socket is on the rack before a source is put in it.
  await app.engine((timeout) => expect(page.locator('#rack-svg g.mod-group[data-kind="silence"]')).toHaveCount(1, { timeout }), { ms: 30_000 });
  await openCatalog(page); // open already: a new patch opens it
  await page.locator('#nb-groups .nb-item[data-kind="supersaw"]').click();
  await page.keyboard.press("Enter");
  await app.engine((timeout) => expect(page.locator('#rack-svg g.mod-group[data-kind="supersaw"]')).toHaveCount(1, { timeout }), { ms: 30_000 });
  await app.engine((timeout) => expect.poll(measuredHere, { timeout }).toBe(true), { ms: 30_000 });
  await expect.poll(async () => (await drawn(page)).marks.every((m) => !m.unknown), { timeout: 15_000 }).toBe(true);

  // A new structure is unlit until it is measured: no estimate is drawn.
  // Whether its probe lands before a test can look is the app's to win (an
  // owed probe can measure it at once), so the spec does not race it: every
  // paint of the rack is recorded with the tree on the bench at that moment,
  // and every paint of the new tree made before its levels arrived must be
  // unlit, with hollow marks. The rebuild for a reply is painted in that
  // reply's task, before any later message, so there is always one.
  await page.evaluate(() => {
    const paints = (window.__pwPaints = []);
    const svg = document.getElementById("rack-svg");
    new MutationObserver(() => {
      paints.push({
        t: performance.now(),
        tree: window.__tap.last.bench && window.__tap.last.bench.treeJson,
        wires: [...svg.querySelectorAll("path.wire.audio[data-from]")].map((w) => Number(w.style.strokeOpacity)),
        marks: [...svg.querySelectorAll(".cable-mark")].map((m) => m.classList.contains("unknown")),
      });
    }).observe(svg, { subtree: true, childList: true, attributes: true, attributeFilter: ["style", "class"] });
  });
  await openCatalog(page);
  await page.locator('#nb-groups .nb-item[data-kind="filter"]').click();
  await page.locator('#rack-svg .jack[data-childkey="node"]').click();
  await app.engine((timeout) => expect(page.locator('#rack-svg g.mod-group[data-kind="filter"]')).toHaveCount(1, { timeout }), { ms: 30_000 });
  await app.engine((timeout) => expect.poll(measuredHere, { timeout }).toBe(true), { ms: 30_000 });
  const early = await page.evaluate(() => {
    const tree = window.__tap.last.bench.treeJson;
    const landed = window.__tap.replies.find((r) => r.type === "cable_levels" && !r.injected && r.d.tree === tree);
    return window.__pwPaints.filter((p) => p.tree === tree && p.t < landed.at);
  });
  expect(early.length, "the new structure was never painted before its levels").toBeGreaterThan(0);
  for (const p of early) {
    for (const o of p.wires) expect(o, "a cable lit before its level").toBeCloseTo(0.2, 2);
    expect(p.marks.every((u) => u), "a level mark lit before its level").toBe(true);
  }
  await expect.poll(async () => (await drawn(page)).marks.every((m) => !m.unknown), { timeout: 15_000 }).toBe(true);
  await app.busy({});
  // Never more than one probe at the engine: a probe asked while one was
  // out waited for its answer (the slow probe above had edits settle under it).
  const most = await page.evaluate(() => {
    const ev = [
      ...window.__tap.sent.filter((s) => s.type === "cable_levels").map((s) => [s.at, 1]),
      ...window.__tap.replies.filter((r) => r.type === "cable_levels" && !r.injected).map((r) => [r.at, -1]),
    ].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let out = 0;
    let max = 0;
    for (const [, d] of ev) { out += d; max = Math.max(max, out); }
    return max;
  });
  expect(most, "probes piled up at the engine").toBe(1);
});

// How long the bench is quiet, after PATCH comes into view or a sound lands,
// before the probe and the guess are asked (patch.js `ARRIVE_MS`).
const ARRIVE_MS = 1_200;

/** Mark, in the page, when the next press on PATCH's stop on the rail lands,
 *  before the app's own handler sees it: the arrival, or a moment before. */
const markArrival = (page) => page.evaluate(() => {
  window.__pwArrived = null;
  const mark = (e) => {
    if (window.__pwArrived == null && e.target.closest && e.target.closest('.rail-stop[data-level="patch"]')) window.__pwArrived = performance.now();
  };
  document.addEventListener("pointerdown", mark, true);
  document.addEventListener("click", mark, true);
});

/** Every cable probe and guess the page sent since `arrived` kept the quiet
 *  window: none went out with an open on its way (asked and not landed), and
 *  each went out at least ARRIVE_MS (less 5 ms for the grain of the page's
 *  clock) after the later of arriving and the last open to land before it.
 *  The window's promise, which holds at any pace the opens are made at. */
async function keptQuiet(app, arrived) {
  const log = await app.log({ after: arrived });
  const opens = log.filter((e) => e.type === "sent:edit_begin");
  const landings = log.filter((e) => e.type === "bench" && e.subject != null);
  const asks = log.filter((e) => e.type === "sent:cable_levels" || e.type === "sent:guess");
  for (const p of asks) {
    const what = `the ${p.type.slice(5)} asked ${Math.round(p.at - arrived)} ms after arriving`;
    const onItsWay = opens.filter((o) => o.at < p.at && !landings.some((l) => l.subject === o.id && l.at > o.at && l.at < p.at));
    expect(onItsWay.map((o) => o.id), `${what}, with an open on its way`).toEqual([]);
    const from = Math.max(arrived, ...landings.filter((l) => l.at < p.at).map((l) => l.at));
    expect(p.at - from, `${what}, ${Math.round(p.at - from)} ms after it arrived or the last open landed`).toBeGreaterThanOrEqual(ARRIVE_MS - 5);
  }
  return asks;
}

// The probe is a render on the engine's one thread, so one started the moment
// PATCH comes into view is one the player's next click waits behind. It is
// asked only once the bench has been quiet for ARRIVE_MS after an arrival or
// an open landing, with nothing on its way, so sounds opened right after
// arriving find no probe at the engine, nor the model's guess, asked with
// it. Both are made as slow as a CI runner's render here, so either, gone
// out early, would hold an open up.
//
// What is checked is that promise, for every probe and guess the page sends
// (`keptQuiet`), whatever pace the test opens its two sounds at (each as soon
// as it can: the second when the first has landed), and at least one probe
// after the last open landed. Not "Opened …": the page says that of any open
// slower than a second, and on a loaded machine an open takes that long by
// itself (with AURACLE_CPU_THROTTLE=4 the first open took 1.1 to 1.2 s, with
// the probe going out 1.3 s after the second landed; #120).
test("sounds opened right after arriving in PATCH are not kept waiting behind a cable probe", async ({ page, app }) => {
  await app.boot({ busy: true });
  await app.level("evolve");
  await expect(page.locator("#view-evolve")).toBeVisible();
  await app.busy({ cable_levels: 900, guess: 900 });
  await markArrival(page);
  await app.level("patch");
  const arrived = await page.evaluate(() => window.__pwArrived);
  expect(arrived, "the press on PATCH's stop was seen").not.toBeNull();
  const rows = page.locator("#bank-list .bank-item");
  const ids = [];
  for (const i of [1, 2]) {
    const id = Number(await rows.nth(i).getAttribute("data-id"));
    ids.push(id);
    await rows.nth(i).locator(".bi-name").click();
    await app.engine((timeout) => page.waitForFunction((x) => window.__aur.wb.subjectId === x, id, { timeout }), { ms: 30_000 });
  }
  // The window after the last open closes, and a probe goes out.
  const landed = (await app.log({ after: arrived })).filter((e) => e.type === "bench" && e.subject === ids[1]).pop().at;
  const probe = { type: ["cable_levels", "guess"] };
  await app.engine((timeout) => expect.poll(async () => (await app.sent(probe, { after: landed })).length, { timeout }).toBeGreaterThan(0), { ms: 30_000 });
  const asks = await keptQuiet(app, arrived);
  // For the record: how soon after the window opened the harness asked.
  const log = await app.log({ after: arrived });
  const asked = ids.map((id) => log.find((e) => e.type === "sent:edit_begin" && e.id === id).at);
  const first = log.find((e) => e.type === "bench" && e.subject === ids[0]).at;
  console.log(`[patch_cables] opens asked ${Math.round(asked[0] - arrived)} ms after arriving and ${Math.round(asked[1] - first)} ms after the first landed; ${asks.length} probes and guesses, the first ${Math.round(asks[0].at - arrived)} ms after arriving`);
  await app.busy({});
});

// PERFORM's measurement of a sound it has left, or of one out of sight, is
// still worth finishing (it is cached for coming back), but nobody is waiting
// on it. The app opens at PERFORM (Plan-008), so one is running whenever the
// player goes straight to PATCH or opens another sound, and held on the
// engine's floor it kept PATCH's cables unlit for all of its thirty-odd
// renders: past a minute on a CI runner. Here such a measurement (`bg`, as
// `retire` leaves PERFORM's) is put in front of the rack's probe, sent just
// before it, for the tree the knob turn made, which nothing has measured: the
// probe is answered and the cables lit while it still runs, and it still
// finishes after.
test("a knob turned in PATCH lights its cables again while a measurement nobody is waiting on runs", { tag: "@slow" }, async ({ page, app }) => {
  await app.boot();
  await openPreset(app, "Reese");
  const settled = async () => {
    const d = await drawn(page);
    return d.marks.length > 0 && d.marks.every((m) => !m.unknown);
  };
  await app.engine((timeout) => expect.poll(settled, { timeout }).toBe(true), { ms: 60_000 });
  // PERFORM's own measurement of the sound the app opened with, demoted when
  // PATCH came into view, finishes first: the one sent below then waits for
  // nothing of PERFORM's, and the wait for it to finish is its renders alone.
  await app.engine((timeout) => expect
    .poll(async () => (await app.count("perform_wired")) >= (await app.sentCount("perform_wire")), { timeout })
    .toBe(true), { ms: FLOOR_MS });
  await page.evaluate(() => {
    const w = window.__tap.engine;
    const post = w.postMessage.bind(w);
    const t = (window.__bgT = { sent: null, probed: null, measured: null });
    w.addEventListener("message", (e) => {
      const d = e.data;
      if (!d || t.sent == null) return;
      if (d.type === "perform_wired" && d.req === 9_100_001) t.measured = performance.now();
      if (d.type === "cable_levels" && t.probed == null) t.probed = performance.now();
    });
    w.postMessage = (m, tr) => {
      if (m && m.type === "cable_levels" && t.sent == null) {
        t.sent = performance.now();
        post({ type: "perform_wire", req: 9_100_001, tree: window.__tap.last.bench.treeJson, overrides: [], bg: true });
      }
      return post(m, tr);
    };
  });
  // A knob turned: the marks go hollow, and the probe that lights them again
  // is the one the measurement goes out ahead of. The hollow moment is
  // watched for from before the turn, not looked for after it: the probe can
  // light the marks again between two looks, and a missed moment is not a
  // knob that changed nothing.
  await page.evaluate(() => {
    window.__pwHollow = false;
    const svg = document.getElementById("rack-svg");
    const look = () => {
      const marks = [...svg.querySelectorAll(".cable-mark")];
      if (marks.length > 0 && marks.every((m) => m.classList.contains("unknown"))) window.__pwHollow = true;
    };
    new MutationObserver(look).observe(svg, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
  });
  const knob = page.locator("#rack-svg g[data-addr] .knob-hit").first();
  const box = await knob.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - i * 4);
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__pwHollow), { timeout: 15_000, message: "the turned knob's cables went unmeasured" }).toBe(true);
  await app.engine((timeout) => expect.poll(settled, { timeout }).toBe(true), { ms: 60_000 });
  const t = await page.evaluate(() => window.__bgT);
  expect(t.sent, "the measurement went out ahead of the probe").not.toBeNull();
  expect(t.probed).not.toBeNull();
  expect(t.measured == null || t.probed < t.measured, "the probe waited for the whole measurement").toBe(true);
  // Every request gets a reply: the measurement finishes, from where it gave way.
  await app.engine((timeout) => expect.poll(() => page.evaluate(() => window.__bgT.measured), { timeout }).not.toBeNull(), { ms: FLOOR_MS });
});
