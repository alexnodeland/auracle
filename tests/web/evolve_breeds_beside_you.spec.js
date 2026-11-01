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
const { test, expect, goLevel, bankTab } = require("./fixtures");
const { SLOW_ENGINE } = require("./perform_budget.js");

// Every change of the lamp or the job slot, with whether they agreed; and
// the bank the moment main.js has handled the first child a generation bred
// (\`refine_child\` with a child), by a listener added after main.js's
// \`onmessage\` (at the first message, by which time main.js has set it), so
// a generation that ends a moment later cannot change it first.
const WATCH = `(() => {
  const Orig = window.Worker;
  function Wrapped(url, opts) {
    const w = new Orig(url, opts);
    if (/worker\\.js/.test(String(url))) {
      const after = (e) => {
        const d = e.data;
        if (window.__pwFirstChild || !d || d.type !== "refine_child" || !(d.child > 0) || e.__tapInjected) return;
        const label = document.querySelector("#bank-list .bank-group.new .bg-label");
        window.__pwFirstChild = {
          child: d.child,
          rows: [...document.querySelectorAll("#bank-list .bank-item[data-id]")].map((el) => Number(el.dataset.id)),
          label: label ? label.textContent : null,
        };
      };
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
  const lamp = (window.__pwLamp = []);
  document.addEventListener("DOMContentLoaded", () => {
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
})();`;

// A gate on the farm's walks (farm.js, ahead of it: `app.boot`'s
// `farmPrefix`): each walk a farm worker is handed waits, said on a
// BroadcastChannel by its id, until the page lets that id through, or every
// walk (`all`). So a generation is still breeding while the test picks, and
// ⚡ still walking while the test deals and plays, because the test holds it
// open, not because the machine was slow enough: on an idle 16-core machine
// the farm bred all ten before three picks (#367), and ⚡'s one walk, 2 to 9 s
// here, landed 24 ms after a ▶'s reply (#585).
const WALK_GATE = `(() => {
  const ch = new BroadcastChannel("pw-walks");
  const held = [];
  const let_ = new Set();
  let all = false;
  const free = (i) => all || let_.has(i);
  ch.onmessage = (e) => {
    if (e.data && e.data.all) all = true;
    else if (e.data && e.data.let != null) let_.add(e.data.let);
    for (const h of held.splice(0)) {
      if (free(h.ev.data.i)) {
        ch.postMessage({ started: h.ev.data.i });
        h.fn.call(h.port, h.ev);
      } else held.push(h);
    }
  };
  const on = Object.getOwnPropertyDescriptor(MessagePort.prototype, "onmessage");
  Object.defineProperty(MessagePort.prototype, "onmessage", {
    configurable: true,
    get() { return on.get.call(this); },
    set(fn) {
      const port = this;
      on.set.call(this, fn && function (ev) {
        const d = ev.data;
        if (d && d.type === "walk" && !free(d.i)) {
          held.push({ fn, port, ev });
          ch.postMessage({ held: d.i });
          return;
        }
        return fn.call(this, ev);
      });
    },
  });
})();`;
// The page's side of the gate: the ids held so far, and the two keys.
const GATE_PAGE = `(() => {
  const ch = new BroadcastChannel("pw-walks");
  const held = (window.__pwHeld = []);
  const started = (window.__pwStarted = []);
  ch.onmessage = (e) => {
    if (e.data && e.data.held != null) held.push(e.data.held);
    if (e.data && e.data.started != null) started.push(e.data.started);
  };
  window.__pwLet = (i) => ch.postMessage({ let: i });
  window.__pwAll = () => ch.postMessage({ all: true });
})();`;

/** Let the gate's walks through one at a time, in the order they were
 *  handed out (the order they are absorbed in: ascending walk ids are job
 *  order, `walkSubmit`), until one has bred a child. A held walk is still
 *  under the engine's watchdog (worker.js `WALK_TIMEOUT_MS`, 300 s from when
 *  it was handed out): past that the engine walks it itself and the gate no
 *  longer holds the generation open, so this and the picks after it must
 *  fit in those five minutes. */
async function letWalksUntilAChild(page, app, k = 0) {
  expect(k, "no walk of ten bred a child").toBeLessThan(10);
  await app.engine((timeout) => page.waitForFunction((n) => window.__pwHeld.length > n, k, { timeout }), { ms: 60_000 });
  const id = await page.evaluate((n) => [...window.__pwHeld].sort((a, b) => a - b)[n], k);
  await page.evaluate((i) => window.__pwLet(i), id);
  const r = await app.reply("refine_child", { where: (d) => d.index === k, timeout: 300_000 });
  return r.child > 0 || letWalksUntilAChild(page, app, k + 1);
}

/** Boot, seeded, and teach it: six picks in EVOLVE and their refit, a model
 *  to breed toward, with the lamp out. `gated`: the farm's walks wait at the
 *  gate (WALK_GATE). `farmPrefix`: the boot's own, in its place. */
async function taught(page, app, query = "", { gated = false, farmPrefix } = {}) {
  await page.addInitScript(WATCH);
  if (gated) await page.addInitScript(GATE_PAGE);
  await app.boot({ random: 20260928, query, farmPrefix: farmPrefix ?? (gated ? WALK_GATE : "") });
  await app.teach(6);
  await expect(page.locator("#wm-lamp")).not.toHaveClass(/\bthinking\b/);
  await expect(page.locator("#job-slot")).toBeHidden();
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

/** The first request matching `pattern` main sent after `t` (the page's
 *  clock), once it has: what a gesture asked for, with its number (`rid`). */
async function askedAfter(app, pattern, t) {
  let asked = null;
  await expect.poll(async () => (asked = (await app.sent(pattern, { after: t }))[0] || null) != null, { message: `a ${JSON.stringify(pattern)} request` }).toBe(true);
  return asked;
}

/** The last reply to `asked` (`app.replyTo`, an engine wait), with its place
 *  in the tap's one count of requests and replies (`_n`), to order it
 *  against another reply. */
async function answerTo(app, asked, timeout) {
  const reply = await app.replyTo(asked, { timeout });
  const mine = (await app.replies(reply.type)).find((r) => [].concat(r.re).includes(asked.rid) && !r.more);
  return { ...reply, _n: mine._n };
}

test("EVOLVE POOL breeds beside you: children land in order at the top of the bank, and a pick deals its next pair while it breeds", { tag: "@slow" }, async ({ page, app }) => {
  test.setTimeout(240_000);
  await taught(page, app, "", { gated: true });
  await app.engine((timeout) => page.waitForFunction(() => window.__aur && window.__aur.wb && window.__aur.wb.rack, null, { timeout }), { ms: 60_000 });
  const before = await bankIds(page);
  const mark = await app.toastMark();
  const t0 = await app.now();

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
  await expect(page.locator("#evolve-stop")).toBeVisible();

  // The walks through the gate one at a time, in the order they were
  // handed out (the order they are absorbed in), until one has bred a child:
  // the rest wait there while the picks are made.
  await letWalksUntilAChild(page, app);
  await app.engine((timeout) => expect(page.locator("#evolve-btn .eb-text")).toHaveText(/^(breeding \d+\/10|walk \d+ of 10)$/, { timeout }), { ms: 30_000 });

  // The first child lands at the top, under "new · generation N", and the ranked
  // rows below it keep their order. (No pick is pending here: a vote
  // reweights the model, and would move rows for a reason of its own.) Read
  // as main.js left the bank on that child's reply (WATCH): on a fast farm
  // the last walks land a moment later and the generation's end replaces.
  const firstChild = (await app.reply("refine_child", { where: (d) => d.child > 0, timeout: 300_000 })).child;
  await expect.poll(() => page.evaluate(() => !!window.__pwFirstChild)).toBe(true);
  const landed = await page.evaluate(() => window.__pwFirstChild);
  expect(landed.child).toBe(firstChild);
  expect(landed.label).toMatch(/^new · generation \d+$/);
  const mid = landed.rows;
  expect(mid[0], "the first child is not the bank's first row").toBe(firstChild);
  const rest = mid.filter((id) => before.includes(id));
  expect(rest, "the ranked rows moved while a child landed").toEqual(before.filter((id) => rest.includes(id)));
  // Nothing has left the bank yet: replacement waits for the end.
  expect(before.filter((id) => !mid.includes(id)), "a patch left the bank before the generation ended").toEqual([]);

  // Picks while it breeds (its other walks wait at the gate): each next
  // pair is dealt while it still breeds, each deal's time a budget
  // (ADR-022).
  const pickFrom = await app.now();
  for (let i = 0; i < 3; i++) {
    await expect(page.locator("#choose-a")).toBeEnabled();
    const t = await app.now();
    await page.locator(i % 2 ? "#choose-b" : "#choose-a").click();
    await expect(page.locator("#choose-a")).toBeEnabled();
    // The deal this pick asked for, answered, before the next pick: each
    // pick's deal is measured.
    await expect.poll(async () => latencies(await app.log({ after: t }), "duel", "duel").length).toBeGreaterThan(0);
  }
  const midway = await page.locator("#evolve-btn").evaluate((b) => b.classList.contains("breeding"));
  const deals = latencies(await app.log(), "duel", "duel", pickFrom);
  console.log(`deal latency during the generation (ms): ${JSON.stringify(deals)}; still breeding after the picks: ${midway}`);
  expect(midway, "the generation ended while its walks were held").toBe(true);
  expect(deals.length).toBeGreaterThanOrEqual(3);
  deals.forEach((ms, i) => app.budget(`pick ${i + 1}'s next pair while it breeds`, ms, 1_000));
  await page.evaluate(() => window.__pwAll());

  await app.engine((timeout) => expect(page.locator("#evolve-btn")).not.toHaveClass(/\bbreeding\b/, { timeout }), { ms: 480_000 });
  const t1 = await app.now();
  const kids = (await app.log()).filter((e) => e.type === "refine_child");
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
  // The receipt may wait its turn in the lane behind a pick's toast (on a
  // fast farm the generation ends inside a pick's undo window).
  const receipt = await app.toast(/^Generation \d+:/, { since: mark, timeout: 15_000 });
  // eslint-disable-next-line playwright/no-useless-await -- app.last is the tap's (a promise), not Locator.last()
  const refined = await app.last("refined");
  const retired = refined.retired || [];
  console.log(`receipt: ${receipt} (retired ${JSON.stringify(retired)})`);
  expect(receipt).toBeTruthy();
  // It counts the children kept, names what they replaced, and only now did
  // those leave the bank.
  expect(receipt).toContain(`Generation ${refined.status.generation}: ${survivors.length} new sound`);
  if (retired.some((id) => !born.includes(id))) expect(receipt).toMatch(/it could: [^.]*\S\./);
  for (const id of retired) expect(after).not.toContain(id);
  await expect(page.locator("#job-slot")).toBeHidden();
  // ⚡'s turn: the generation is over.
  await expect(page.locator("#rack-evolve")).toBeEnabled();
  // The lamp and the slot never disagreed.
  const lamp = await page.evaluate(() => window.__pwLamp.slice());
  expect(lamp.filter((s) => s.lit !== s.shown), "the E and the job slot disagreed").toEqual([]);
  expect(lamp.some((s) => /⚡ breeding \d+\/10 · (about \d+ (s|min)|almost done)/.test(s.text)), "the slot never gave an estimate").toBe(true);
});

test("GENERATIONS and the next-step chip count a generation once a child of it has landed, not when a pick's status does", { tag: "@slow" }, async ({ page, app }) => {
  test.setTimeout(240_000);
  await taught(page, app);
  await expect(page.locator("#gen-count")).toHaveText("0");
  await page.locator("#evolve-btn").click();
  await app.engine((timeout) => expect(page.locator("#evolve-btn .eb-text")).toHaveText(/^(breeding \d+\/10|walk \d+ of 10)$/, { timeout }), { ms: 30_000 });
  await expect(page.locator("#nextstep")).toHaveText("Breeding: keep playing ▸");

  // A pick while the first generation breeds. Its status comes back when its
  // undo window closes, and the engine has counted the open generation since
  // it opened: before, that one status turned GENERATIONS to 1 and the chip to
  // "Gen 1 bred — see what it thinks of your taste" with nothing bred.
  const statuses = await app.count("status");
  await expect(page.locator("#choose-a")).toBeEnabled();
  await page.locator("#choose-a").click();
  await app.engine((timeout) => expect.poll(() => app.count("status"), { timeout }).toBeGreaterThan(statuses), { ms: 30_000 });
  const early = await page.evaluate(() => ({
    generation: window.__tap.last.status.status.generation,
    landed: window.__tap.replies.some((r) => r.type === "refine_child" && !r.injected && r.d.child > 0),
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
  await app.reply("refine_child", { where: (d) => d.child > 0, timeout: 300_000 });
  await expect(page.locator("#gen-count")).toHaveText("1");
  await expect(page.locator("#nextstep")).toHaveText(/^Generation 1 bred (a new sound: it’s|\d+ new sounds: they’re) at the top of the bank ▸$/);

  // Stopped, unless its walks have already ended it (on a fast farm the last
  // ones land in a burst, and STOP goes with the generation): either way it
  // ends as generation 1.
  const stop = page.locator("#evolve-stop");
  if (await stop.isVisible()) await stop.click({ timeout: 5_000 }).catch(() => {});
  await app.engine((timeout) => expect(page.locator("#evolve-btn")).not.toHaveClass(/\bbreeding\b/, { timeout }), { ms: 120_000 });
  await expect(page.locator("#gen-count")).toHaveText("1");
  await expect(page.locator("#nextstep")).toHaveText(/^Generation 1 bred/);
});

test("stop ends with what's bred, and replaced patches leave only then", { tag: "@slow" }, async ({ page, app }) => {
  test.setTimeout(240_000);
  await taught(page, app, "", { gated: true });
  const mark = await app.toastMark();
  await page.locator("#evolve-btn").click();
  // Two walks through the gate, in the order they are absorbed in, and the
  // rest held: on a fast farm all ten were bred before the test could press
  // stop, and the job slot was gone (#367).
  for (let k = 0; k < 2; k++) {
    await app.engine((timeout) => page.waitForFunction((n) => window.__pwHeld.length > n, k, { timeout }), { ms: 60_000 });
    const id = await page.evaluate((n) => [...window.__pwHeld].sort((a, b) => a - b)[n], k);
    await page.evaluate((i) => window.__pwLet(i), id);
  }
  // Two jobs absorbed, then stop from the job slot.
  await app.engine((timeout) => expect.poll(() => app.count("refine_child"), { timeout }).toBeGreaterThanOrEqual(2), { ms: 400_000 });
  const landed = await app.replies("refine_child");
  // Hovering EVOLVE POOL marks what the generation would replace if it ended
  // now: one more with each child it admits (the engine's `retiring`).
  if (landed.some((e) => e.child > 0)) {
    await page.locator("#evolve-wrap").hover();
    await expect.poll(() => page.locator("#bank-list .bank-item.may-go").count(), { timeout: 5_000 }).toBeGreaterThan(0);
    await page.mouse.move(5, 5);
  }
  await expect(page.locator("#job-stop")).toBeVisible();
  await page.locator("#job-stop").click();
  await app.engine((timeout) => expect(page.locator("#evolve-btn")).not.toHaveClass(/\bbreeding\b/, { timeout }), { ms: 30_000 });
  // eslint-disable-next-line playwright/no-useless-await -- app.last is the tap's (a promise), not Locator.last()
  const refined = await app.last("refined");
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
  const receipt = await app.toast(/^Generation \d+/, { since: mark, timeout: 15_000 });
  console.log(`receipt: ${receipt}`);
  expect(receipt, "the receipt does not say it was stopped").toMatch(/^Generation \d+ stopped/);
  // It counts what stayed: a child can rank below the rest and be retired.
  const kept = born.filter((id) => !refined.retired.includes(id));
  if (kept.length) expect(receipt).toContain(`stopped: ${kept.length} new sound`);
  await expect(page.locator("#job-slot")).toBeHidden();
  // Children that land after the stop are nobody's: nothing more arrives,
  // over the five seconds it was always watched (a walk on the farm lands
  // within a few).
  const kids = await app.count("refine_child");
  await app.quiet(5_000);
  // eslint-disable-next-line playwright/prefer-to-have-count -- app.count is the tap's count, not a locator's
  expect(await app.count("refine_child")).toBe(kids);
});

// STOP gives the farm's cores back at once. A crew walking for nobody is
// terminated on the stop's `farm_done` (`now`), not left to finish the walk
// in hand before it reads its `bye`: a walk writes no rows to wait for. The
// walk crew (the farm workers served after boot's two) is slowed ten times,
// and one walk is let through the gate just before STOP, so a worker is
// inside a walk of many seconds when the stop lands. Terminated only once it
// read its `bye`, it took 1 to 5 s after STOP even unslowed; slowed, no worker
// was terminated within the three seconds this waits.
const TERMINATED = `(() => {
  const at = (window.__pwTerminated = []);
  const terminate = Worker.prototype.terminate;
  Worker.prototype.terminate = function () {
    at.push(performance.now());
    return terminate.call(this);
  };
})();`;
/** The gate for every farm worker, and the walk crew's (all but the first
 *  \`boot\` workers served) slowed ten times. */
function gatedWalkCrewSlowed(boot) {
  let served = 0;
  return () => WALK_GATE + (++served > boot ? SLOW_ENGINE(10) : "");
}
/** Ms from \`t\` to each worker terminated after it. */
const terminatedSince = (page, t) => page.evaluate((s) => window.__pwTerminated.filter((x) => x >= s).map((x) => Math.round(x - s)), t);

test("STOP terminates the walk crew at once, not once its walk in hand ends", { tag: "@slow" }, async ({ page, app }) => {
  test.setTimeout(240_000);
  await page.addInitScript(TERMINATED);
  await taught(page, app, "?farm=2", { gated: true, farmPrefix: gatedWalkCrewSlowed(2) });
  await page.locator("#evolve-btn").click();
  await app.engine((timeout) => page.waitForFunction(() => window.__pwHeld.length > 0, null, { timeout }), { ms: 60_000 });
  const id = await page.evaluate(() => Math.min(...window.__pwHeld));
  await page.evaluate((i) => window.__pwLet(i), id);
  await page.waitForFunction((i) => window.__pwStarted.includes(i), id);
  const stopAt = await page.evaluate(() => performance.now());
  await page.locator("#evolve-stop").click();
  await app.engine((timeout) => expect(page.locator("#evolve-btn")).not.toHaveClass(/\bbreeding\b/, { timeout }), { ms: 30_000 });
  expect((await app.replies("farm_done")).at(-1).now, "the stop's farm_done did not ask for the crew at once").toBe(true);
  await expect.poll(async () => (await terminatedSince(page, stopAt)).length, { message: "a worker of the crew was left walking after STOP", timeout: 3_000 }).toBe(2);
  const after = await terminatedSince(page, stopAt);
  console.log(`walk crew terminated after STOP (ms): ${JSON.stringify(after)}`);
  after.forEach((ms, i) => app.budget(`walk crew worker ${i + 1} terminated after STOP`, ms, 1_000));
  await page.evaluate(() => window.__pwAll());
});

test("during a generation PERFORM is answered: a new patch is measured and a pressed Offer starts while it breeds", { tag: "@slow" }, async ({ page, app }) => {
  test.setTimeout(240_000);
  await taught(page, app);
  await page.locator("#evolve-btn").click();
  await app.engine((timeout) => expect(page.locator("#evolve-btn .eb-text")).toHaveText(/^(breeding \d+\/10|walk \d+ of 10)$/, { timeout }), { ms: 30_000 });
  // A preset PERFORM has not measured, opened mid-generation.
  await bankTab(page, "presets");
  const opened = await app.now();
  await page.locator(".bank-item", { hasText: "Glass Pad" }).first().click();
  // The open begun (the patch on its way to the bench) before PERFORM shows.
  await expect.poll(async () => (await app.sent("edit_begin", { after: opened })).length + (await app.sent("load_preset", { after: opened })).length).toBeGreaterThan(0);
  await goLevel(page, "perform");
  await app.engine((timeout) => expect(page.locator(".pf-name")).toHaveText("Glass Pad", { timeout }), { ms: 30_000 });
  await app.reply("perform_wired", { after: opened, timeout: 300_000 });
  await app.engine((timeout) => expect(page.locator(".pf-status")).toContainText("controls reach", { timeout }), { ms: 300_000 });
  const wiredAt = await app.now();
  const breedingStill = await page.locator("#evolve-btn").evaluate((b) => b.classList.contains("breeding"));
  console.log(`PERFORM wired ${Math.round((wiredAt - opened) / 100) / 10} s after the open; generation still running: ${breedingStill}`);
  expect(breedingStill, "the measurement waited for the whole generation").toBe(true);

  // Offer at once, before a spare can grow: the engine starts it while the
  // generation still runs (asserted once it ends), its time a budget.
  const pressed = await app.now();
  await page.locator(".pf-pad", { hasText: "Offer" }).click();
  await app.engine((timeout) => expect.poll(async () => latencies(await app.log({ after: pressed }), "perform_offer", "busy").length, { timeout }).toBeGreaterThan(0), { ms: 30_000 });
  const started = latencies(await app.log({ after: pressed }), "perform_offer", "busy");
  console.log(`Offer started ${JSON.stringify(started)} ms after it was sent`);
  app.budget("a pressed Offer while it breeds → started", started[0], 1_000);
  const busyAt = (await app.log({ after: pressed })).find((e) => e.type === "busy").at;
  await app.engine((timeout) => page.waitForSelector(".pf-offer.ready", { timeout }), { ms: 120_000 });
  const offeredAt = await app.now();
  console.log(`Offer landed ${Math.round((offeredAt - pressed) / 100) / 10} s after the press`);

  await goLevel(page, "evolve");
  await app.engine((timeout) => expect(page.locator("#evolve-btn")).not.toHaveClass(/\bbreeding\b/, { timeout }), { ms: 480_000 });
  // A child landed after the Offer started: it did not wait for the generation.
  expect((await app.log({ after: busyAt })).filter((e) => e.type === "refine_child").length, "the pressed Offer waited on the generation").toBeGreaterThan(0);
});

test("⚡ evolve from this leaves the engine free: a deal and a ▶ are answered while it walks, and its stop drops it", { tag: "@slow" }, async ({ page, app }) => {
  test.setTimeout(240_000);
  // ⚡'s walk waits at the gate (WALK_GATE) until the test lets it through,
  // so the deal and the ▶ are asked while it walks whatever the farm's speed
  // against the page's (#585).
  await taught(page, app, "", { gated: true });
  // A ▶ on a row the page has never asked to hear, from the n-th on, so it
  // goes to the engine rather than to a buffer the page already holds: that
  // row's own render request, and the last reply to it (not the first render
  // reply after the click, which can be a dealt card's).
  const bankPlay = async (n) => {
    const heard = new Set((await app.replies("render")).map((r) => r.id));
    const ids = await bankIds(page);
    const id = ids.slice(n).find((x) => !heard.has(x));
    const row = page.locator(`#bank-list .bank-item[data-id="${id}"]`);
    await row.scrollIntoViewIfNeeded();
    await row.hover();
    const t = await app.now();
    await row.locator(".bi-hear").click();
    const asked = await askedAfter(app, { type: "render", id }, t);
    return { asked, reply: await answerTo(app, asked, 30_000) };
  };
  /** The id of the next walk the gate holds after the first `k`. */
  const heldWalk = async (k) => {
    await app.engine((timeout) => page.waitForFunction((n) => window.__pwHeld.length > n, k, { timeout }), { ms: 60_000 });
    return page.evaluate((n) => window.__pwHeld[n], k);
  };
  await app.engine((timeout) => page.waitForFunction(() => window.__aur && window.__aur.wb && window.__aur.wb.rack, null, { timeout }), { ms: 60_000 });
  await goLevel(page, "patch");
  const name = (await page.locator("#rack-subject").textContent()).trim();
  await app.engine((timeout) => expect(page.locator("#rack-evolve")).toBeEnabled({ timeout }), { ms: 30_000 });
  const since = await app.now();
  const held = await page.evaluate(() => window.__pwHeld.length);
  await page.locator("#rack-evolve").click();
  const evolve = await askedAfter(app, { type: "refine_from" }, since);
  await expect(page.locator("#job-text")).toHaveText(`⚡ evolving ${name}`);
  await expect(page.locator("#rack-evolve")).toBeDisabled();
  // EVOLVE POOL waits for ⚡, and says so on hover.
  await expect(page.locator("#evolve-btn")).toBeDisabled();
  await expect(page.locator("#evolve-wrap")).toHaveAttribute("title", /EVOLVE POOL waits for it/);
  await app.engine((timeout) => expect(page.locator("#job-stop")).toBeVisible({ timeout }), { ms: 30_000 });
  // Its walk is on the farm, held: until the test lets it through, ⚡ walks.
  const walk = await heldWalk(held);

  // While it walks: a deal in EVOLVE, and a bank row's ▶, each its own
  // request's reply.
  await goLevel(page, "evolve");
  await expect(page.locator("#skip-duel")).toBeEnabled();
  const skipAt = await app.now();
  await page.locator("#skip-duel").click();
  await expect(page.locator("#choose-a")).toBeEnabled();
  const deal = await askedAfter(app, { type: "duel" }, skipAt);
  const dealt = await answerTo(app, deal, 30_000);
  const played = await bankPlay(12);
  const dealMs = Math.round(dealt._at - deal._at);
  const playMs = Math.round(played.reply._at - played.asked._at);
  console.log(`during ⚡ (its walk held): deal ${dealMs} ms; ▶ ${playMs} ms`);
  // How fast: a deal is a round trip with no render in it. A budget, so a
  // slow runner records it (1007 ms on one, #271) and never fails on it.
  app.budget("a deal while ⚡ walks", dealMs, 1_000);
  // Both answered, and ⚡ still walking: its slot up, nothing landed.
  await expect(page.locator("#job-slot")).toBeVisible();
  await expect(page.locator("#job-text")).toHaveText(`⚡ evolving ${name}`);
  expect(await app.replies("evolved_from", { after: since }), "⚡ landed while its walk was held").toEqual([]);

  // Let it land.
  const letAt = await app.now();
  await page.evaluate((i) => window.__pwLet(i), walk);
  const first = await answerTo(app, evolve, 300_000);
  expect(first.type).toBe("evolved_from");
  // The deal and the ▶ were answered before ⚡ landed, by the tap's count
  // (ADR-022: the order is the assertion). The ▶ cost its own render (its
  // pending ring said so meanwhile); it used to wait for the whole walk.
  expect(dealt._n, "the deal waited for ⚡ to land").toBeLessThan(first._n);
  expect(played.reply._n, "the ▶ waited for ⚡ to land").toBeLessThan(first._n);
  console.log(`⚡ landed ${Math.round((first._at - letAt) / 100) / 10} s after its walk was let through: child ${first.childId}, reason ${first.reason}`);
  await expect(page.locator("#job-slot")).toBeHidden();
  await expect(page.locator("#evolve-btn")).toBeEnabled();
  await expect(page.locator("#evolve-wrap")).toHaveAttribute("title", "");

  // Again, and stop it while its walk is held: the reply that lands is the
  // stop's. Then the walk is let through, so its result could land, and
  // nothing is added.
  await goLevel(page, "patch");
  await app.engine((timeout) => expect(page.locator("#rack-evolve")).toBeEnabled({ timeout }), { ms: 30_000 });
  const pool = (await bankIds(page)).length;
  const mark = await app.toastMark();
  const againAt = await app.now();
  const heldAgain = await page.evaluate(() => window.__pwHeld.length);
  await page.locator("#rack-evolve").click();
  const again = await askedAfter(app, { type: "refine_from" }, againAt);
  await app.engine((timeout) => expect(page.locator("#job-stop")).toBeVisible({ timeout }), { ms: 30_000 });
  const walkAgain = await heldWalk(heldAgain);
  await page.locator("#job-stop").click();
  const stop = await askedAfter(app, { type: "refine_from_stop" }, againAt);
  const stopped = await answerTo(app, again, 30_000);
  // The stopped walk let through at once, so a result could land: the stop
  // reaped its crew (worker.js `crewReap`), or the crew, still up, walks it
  // for nobody and the result is dropped as it lands. Which one is not
  // asserted: a crew with a guess's renders out closes only after their
  // writes, and may start the walk meanwhile.
  await page.evaluate((i) => window.__pwLet(i), walkAgain);
  console.log(`⚡ stop answered in ${Math.round(stopped._at - stop._at)} ms (${stopped.reason})`);
  expect(stopped.type).toBe("evolved_from");
  expect(stopped.reason).toBe("stopped");
  expect(stopped.childId).toBe(0);
  await expect(page.locator("#job-slot")).toBeHidden();
  await app.toast(/^⚡ stopped/, { since: mark, timeout: 15_000 });
  await expect(page.locator("#rack-evolve")).toBeEnabled();
  // Nothing is added after the stop, its walk let through, over the three
  // seconds it was always watched: the bank as long as it was, and no answer
  // to the stopped ⚡ but the stop's (a child bred into a full pool displaces
  // a sound, so the bank's length alone would not show it).
  await app.quiet(3_000);
  expect((await bankIds(page)).length).toBe(pool);
  expect(await app.replies("evolved_from", { after: againAt }), "the stopped walk's result was absorbed").toHaveLength(1);
  await page.evaluate(() => window.__pwAll());
});
