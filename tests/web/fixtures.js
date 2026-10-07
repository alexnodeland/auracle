// The specs' one way in: `test` and `expect` from @playwright/test, extended
// with what every spec here used to copy for itself. Not a spec:
// `playwright.config.js` matches `*.spec.js` only.
//
//   const { test, expect } = require("./fixtures");
//
//   test("a pick says what it picked", async ({ page, app }) => {
//     await app.boot();                     // seeded, warm start and tours seen
//     await app.level("evolve");
//     await app.reply("duel", { where: { pair: true } });
//     await page.locator("#choose-a").click();
//     await app.toast(/^Picked /);
//   });
//
// - **Page errors fail the test** (the auto fixture `pageErrors`): every
//   `pageerror` on any page of the test's context is collected, and the test
//   fails at teardown if there was one. `test.use({ consoleErrors: true })`
//   counts `console.error` too.
// - **A failed test names its machine** (the auto fixture `runner`): the
//   annotation `runner`, "<cores> × <CPU model>", which the run's report
//   shows and a flake's issue quotes (flakes.mjs). CI's hosted runners differ
//   in speed by about two times.
// - **`app`** (per test, only when a test asks for it) installs the engine
//   worker's tap before anything else runs, so main.js's own `onmessage` is
//   always the last to hear a reply, and a spec's own init scripts (added
//   after) wrap outside it. Nothing in the app changes for the tests: the tap
//   wraps `Worker` before main.js runs (tests/web/AGENTS.md).
// - **`newContext(options)`** (only when a test asks for it) makes another
//   context of the test's own (a phone beside a desktop, a second visit),
//   whose pages' errors fail the test as the test's own context's do.
// - **Renders reused** (`app.boot({ reuseRenders: true })`, opt-in): a spec
//   that waits for the whole pool before it does anything starts with the
//   render cache (`auracle-renders`) as an earlier boot of the same seed left
//   it, so the fill after the veil is served from the cache and not rendered
//   again (`RENDERS`, below). Every other boot is a first visit's, cold.
//
// What the tap keeps, in the page (`window.__tap`):
//   replies   what main was handed, in order: { type, at, injected, d }
//             (`d` is the message, any audio in it left out)
//   last      the last engine reply of each type (injected ones aside)
//   counts    engine replies by type, and requests as `sent:<type>`
//   sent      every request posted to the engine: { type, at, m }
//   finals    by request number (`rid`), where in `replies` its last reply is
//   toasts    every toast that entered the lane: { text, at }
//   facts     the engine's facts as main last heard them from the engine:
//             views, ranked, lineage, ratings, status, and every name a
//             sound has had (`names`)
// Times are the page's clock (`performance.now()`, `app.now()`).
//
// Requests and their replies. Main numbers every request it sends (`rid`,
// main.js `send`), and each reply the worker sends in answer carries that
// number as `re` (a list where one reply answers several), with `more: true`
// on every reply to it but the last (worker.js `post`, `answer`). What the
// worker says of its own accord carries no `re`. So `app.replyTo(sent)` is the
// last reply to that very request, and `app.answered({ types, lanes })` waits
// until every such request sent so far has had it: an engine wait on the
// request, not on a reply of some type or a quiet window. A reply the spec
// injects for a request (`app.answer`, `app.fail`) carries its `re` too.
//
// Matching. Where a method takes a pattern it is a type name, or a partial
// object matched against a message: each key must equal its value, `true`
// means present and truthy, `false` absent or falsy, an array one of its
// values, and an object matches the same way one level down.
//   "fitted"  { type: "duel", ahead: true }  { type: "duel", ahead: false }
//   { views: true }   anything carrying views, whatever its type
//
// Waits. A UI state is waited for with `expect` and the config's default
// timeout (10 s). A wait on the engine (boot, a fill, a fit, a deal, a reply)
// goes through `app.engine`, `app.reply` or `app.booted`: its bound is
// ENGINE_MS unless given, and its time is added to the test's timeout, so a
// slow runner's engine never eats the test's own budget, up to
// ENGINE_CAP_MS in all, so an engine that hangs cannot take the shard's
// remaining time with it. PERFORM's growth
// (an offer, a drift) is bounded by `app.offerBudget()` (perform_budget.js).
// The one fixed wait is `app.quiet()`: QUIET_MS for "nothing happens", where
// the check is that something does not occur.
//
// Time (ADR-022). How long something took is never a gate assertion: it is a
// budget, `budget(name, ms, limit)` (`app.budget` on the fixture), recorded as
// the test's annotation and judged only with AURACLE_PERF=1. What the app
// promises about its own timeline is asserted as order (the state read in the
// gesture's own task, the requests and replies in `app.log`) or by its own
// marks (`app.marks`).
const base = require("@playwright/test");
const { expect } = base;
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const shell = require("./shell");
const performBudget = require("./perform_budget");

/** A wait on the engine that `offerBudget` does not bound: boot, the pool
 *  filling, a fit, a deal, a generation's reply. The longest of these on a CI
 *  runner was a full pool, about two minutes behind a refit. */
const ENGINE_MS = 150_000;
/** The most one test's engine waits may add to its timeout, in all. Once a
 *  test has used it, its engine waits run inside its own timeout. Measured
 *  on 30 CI runs of Oct 5 (both tiers): the most any test's waits added was
 *  297 s (evolve_truth's "with no farm, a pick's deal during a
 *  generation…"), the next 214 s, and no test ran longer than 325 s in all.
 *  Half again over the most, for a slower runner: three full ENGINE_MS. */
const ENGINE_CAP_MS = 3 * ENGINE_MS;
/** What each test's engine waits have added to its timeout so far, the
 *  waits still running included (TestInfo → ms). */
const engineExtension = new WeakMap();
/** "Nothing happens": long enough for a loaded machine to have done the wrong
 *  thing (testing.md § Rules: timing needs 1.5 s of slack). */
const QUIET_MS = 1_500;
/** Speed budgets are judged (ADR-022): AURACLE_PERF=1, as the nightly *Speed
 *  budgets* job runs the specs that hold one. Without it a budget is
 *  recorded and never fails. */
const PERF = process.env.AURACLE_PERF === "1";

/** A measurement of the machine's speed against the limit the app was built
 *  to (ADR-022's third kind): how long something took, in ms. Recorded as the
 *  test's annotation `budget` ("<name> <measured> ms of <limit> ms", with
 *  "(over)" when it is), which the run's merged report shows. With
 *  AURACLE_PERF=1 it is judged too, as a soft assertion, so a test's every
 *  budget is measured. A measurement that is not a number (a loop that gave
 *  up, a moment never seen) is over. True when it is within its limit.
 *  Any spec may call it, on the fixture or not (`require("./fixtures")`). */
function budget(name, measured, limit) {
  const ok = Number.isFinite(measured) && measured <= limit;
  const shown = Number.isFinite(measured) ? Math.round(measured) : String(measured);
  base.test.info().annotations.push({ type: "budget", description: `${name} ${shown} ms of ${limit} ms${ok ? "" : " (over)"}` });
  if (PERF) expect.soft(Number.isFinite(measured) ? measured : Infinity, `budget: ${name}`).toBeLessThanOrEqual(limit);
  return ok;
}
/** The seed every spec boots with unless it says otherwise, twice: as the
 *  engine's random seed (`?seed=`, apps/web/main.js `seedOverride`) and as
 *  the page's own Math.random (`RANDOM`, seeded as the films seed it). With
 *  both, every run fills the same pool, shows the same nine warm start cards,
 *  and puts each pair's sounds and the keep-as-new comparison's on the same
 *  sides. What the engine deals later (pairs, fits, walks, offers) repeats
 *  when the same requests reach it in the same order, which timing can still
 *  change: a deal made while the pool is filling, the order PERFORM's walks
 *  begin in. `AURACLE_SEED=random` boots unseeded (no `?seed`, Math.random
 *  as the browser has it), as the nightly flake hunt does; `AURACLE_SEED=N`
 *  boots with N. Either changes the default only: a spec that names its own
 *  seed keeps it. */
const SEED = 20261005;
const DEFAULT_SEED = (() => {
  const v = process.env.AURACLE_SEED;
  if (v === "random") return null;
  if (v && !/^\d+$/.test(v)) console.warn(`AURACLE_SEED=${v} is neither "random" nor a whole number; using ${SEED}`);
  return v && /^\d+$/.test(v) ? Number(v) : SEED;
})();

/** The seed PERFORM's specs boot with (`app.boot({ seed: PERFORM_SEED,
 *  random: PERFORM_SEED })`), in place of SEED: under SEED the first offer
 *  they grow is unusually light. `AURACLE_SEED` overrides it as it does SEED
 *  (`random` boots them unseeded, N with N).
 *
 *  Chosen (#135) so the first offer grown on Glass Pad, in the specs' own
 *  order (Glass Pad on PERFORM, the budget's two probe walks, Offer, Take),
 *  is a typical one. Twelve seeds on a 16-core M3 Max, the offer's growth
 *  and the taken offer's measurement:
 *
 *    seed          growth   measurement   modules   controls reach
 *    20261005      4.7 s    2.8 s         1         4   (SEED)
 *    1085668085    5.0 s    8.3 s         5         3   (this)
 *    all twelve    1.5 to 10.0 s, median 4.4 s; 1.5 to 20.9 s, median 7.8 s
 *
 *  SEED's offer is mid-range in growth, but its measurement is the third
 *  lightest of twelve, under the lower quartile; this one is near the
 *  median in both, and three repeats of each dealt the same offer. */
const PERFORM_SEED = (() => {
  const v = process.env.AURACLE_SEED;
  if (v === "random") return null;
  return v && /^\d+$/.test(v) ? Number(v) : 1085668085;
})();

/** What main sends that the worker never answers, by design: a log line, a
 *  count of a pair shown, a style's name, the farm's plumbing, the warm
 *  start's cards to measure while the player chooses, and the requests that
 *  act on others (a stop, `retire`, `promote`, a cancel), whose effect is the
 *  other request's own last reply. `app.answered` does not wait for these.
 *  apps/web/tests/worker-protocol.test.mjs holds the worker to this list, and
 *  docs/architecture/web-runtime.md (The worker's replies) names them. */
const UNANSWERED = [
  "duel_shown", "log_edit", "log_event", "set_style_name",
  "farm_lost", "farm_ports", "warm_cards",
  "promote", "retire", "explain_cancel", "refine_stop", "refine_from_stop",
];
/** The lanes `app.answered` knows by name, as the request types in them.
 *  `bench`: main's bench lane, every edit to the patch on the bench, one at
 *  the worker at a time (main.js `pumpLane`): a knob write, an op, a whole
 *  tree (an undo or a redo too). */
const LANES = {
  bench: ["edit_param", "edit_structure", "edit_set_tree"],
};

// ---------- renders reused (`app.boot({ reuseRenders: true })`) ----------
//
// The veil lifts at 8 sounds, and those are rendered with their audio, which
// the render cache never holds (worker.js `FARM_AUDIO_AHEAD`, farm.js), so no
// cache moves the veil. What one can take away is the fill after it: the other
// 30-odd draws are a hit each, where a cold boot renders them behind the test
// (about 4 s after the veil on a 16-core M3 Max, up to 20 on a CI runner:
// docs/notes/spec-time-2026-10.md). A spec that waits for the whole pool
// before it does anything spends that time waiting, and finds the same pool
// either way: the same draws, and a hit is the φ a render gives, bit for bit
// (every row is stored under the namespace and the draw's content address,
// which the engine checks against its tree before folding the row in:
// farm.js). Such a spec asks for it in `app.boot`; every other boot is a
// first visit's.
//
// The first boot that asks, for its seed, is cold. Once its pool is whole
// (`app.filled`, `app.poolRows`, `app.fullPool`, or at the end of a test that
// passed) the fixture keeps the store's rows, in this worker and on disk
// (tests/web/.renders/, a file per engine binary, named by its hash), and
// every later boot of that seed that asks starts with them: written into the
// store, from a page of their own in the boot's context, before the app's
// first script. A seed is the address's `?seed`, or with none the seeded
// Math.random (`random`) that draws it; an unseeded boot keeps nothing. A
// store stamped with another namespace is cleared by the app as it boots, so
// rows from another φ cost a cold boot and nothing else.
const RENDERS_DIR = path.join(__dirname, ".renders");
const ENGINE_WASM = path.join(__dirname, "../../apps/web/pkg/auracle_wasm_bg.wasm");
/** What is kept, by seed ("seed:N", "random:N"): { ns, rows: [[key, row]] }. */
const kept = new Map();
let keptAt; // this binary's file under RENDERS_DIR, null without one; read once

function keptFile() {
  if (keptAt !== undefined) return keptAt;
  try {
    const id = crypto.createHash("sha256").update(fs.readFileSync(ENGINE_WASM)).digest("hex").slice(0, 16);
    keptAt = path.join(RENDERS_DIR, `${id}.json`);
  } catch (_) {
    keptAt = null; // no engine: the specs say so themselves
  }
  try {
    if (keptAt) for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(keptAt, "utf8")))) kept.set(k, v);
  } catch (_) {
    /* nothing kept for this binary yet */
  }
  return keptAt;
}

/** The file again, with `kept` over what another run wrote there meanwhile. */
function writeKept(drop = null) {
  const file = keptFile();
  if (!file) return;
  try {
    fs.mkdirSync(RENDERS_DIR, { recursive: true });
    let onDisk = {};
    try {
      onDisk = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (_) {
      /* none yet */
    }
    if (drop) delete onDisk[drop];
    const tmp = `${file}.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify({ ...onDisk, ...Object.fromEntries(kept) }));
    fs.renameSync(tmp, file);
  } catch (_) {
    /* a cold boot next time, nothing else */
  }
}

/** The seed a boot's pool is drawn from, as the kept rows are filed: the
 *  address's `?seed`, or the seeded Math.random that draws one; null when the
 *  boot is unseeded. */
function rendersKey(params, random) {
  if (params.has("seed")) return `seed:${params.get("seed")}`;
  return random != null ? `random:${random}` : null;
}

/** Forget the rows kept for a boot of `seed`, or `random` with no seed (as
 *  `app.boot` takes them), here and on disk: the next boot of it that asks to
 *  reuse renders is cold. For the fixture's own spec. */
function forgetRenders({ seed = null, random = null } = {}) {
  const key = rendersKey(new URLSearchParams(seed != null ? { seed: String(seed) } : {}), random);
  keptFile();
  kept.delete(key);
  writeKept(key);
}

/** Write `rows` into the render store of `context`'s origin, stamped `ns`,
 *  from a page of its own (served by a route, so it runs nothing of the
 *  app's) through the app's own store rules (render-store.js). */
async function fillRenderStore(context, { ns, rows }) {
  const page = await context.newPage();
  try {
    const at = new URL("/__render-store", base.test.info().project.use.baseURL).href;
    await page.route(at, (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>render store</title>" }));
    await page.goto(at);
    await page.evaluate(async ([ns, rows]) => {
      const store = await import("/render-store.js");
      const db = await store.renderStoreOpen(indexedDB, ns);
      if (!db) throw new Error("the render store would not open");
      await new Promise((resolve, reject) => {
        const tx = db.transaction(store.RENDER_ROWS, "readwrite");
        const put = tx.objectStore(store.RENDER_ROWS);
        for (const [k, v] of rows) put.put(v, k);
        tx.oncomplete = resolve;
        tx.onerror = tx.onabort = () => reject(tx.error);
      });
      db.close();
    }, [ns, rows]);
  } finally {
    await page.close();
  }
}

/** The render store of the page's origin, read in the page: { ns, rows }, or
 *  null with none. Opens it without creating it. */
async function readRenderStore() {
  const store = await import("/render-store.js");
  const done = (r) => new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const open = indexedDB.open(store.RENDER_DB);
  open.onupgradeneeded = () => open.transaction.abort();
  let db;
  try {
    db = await done(open);
  } catch (_) {
    return null;
  }
  try {
    if (!db.objectStoreNames.contains(store.RENDER_ROWS) || !db.objectStoreNames.contains(store.RENDER_META)) return null;
    const tx = db.transaction([store.RENDER_ROWS, store.RENDER_META], "readonly");
    const [ns, keys, values] = await Promise.all([
      done(tx.objectStore(store.RENDER_META).get("ns")),
      done(tx.objectStore(store.RENDER_ROWS).getAllKeys()),
      done(tx.objectStore(store.RENDER_ROWS).getAll()),
    ]);
    return { ns, rows: keys.map((k, i) => [k, values[i]]) };
  } finally {
    db.close();
  }
}

// The tap, installed before the page's scripts on every navigation. One
// wrapper of `Worker`: whatever a spec adds later wraps it.
const TAP = `(() => {
  if (window.__tap) return;
  const T = (window.__tap = {
    engine: null, workers: [],
    replies: [], last: {}, counts: {}, sent: [], toasts: [], finals: {},
    facts: { views: null, ranked: null, lineage: null, ratings: null, status: null, names: {} },
    holds: [], holdFrom: null, holdNext: [], held: [],
    amends: [],
    reqHolds: [], reqHeld: [], stalls: [], stalled: [], answers: [], delays: [],
  });
  const matches = (p, m) => {
    if (typeof p === "string") p = { type: p };
    if (!m || typeof m !== "object") return false;
    for (const k of Object.keys(p)) {
      const v = p[k];
      if (v === true) { if (!m[k]) return false; }
      else if (v === false) { if (m[k]) return false; }
      else if (Array.isArray(v)) { if (!v.includes(m[k])) return false; }
      else if (v && typeof v === "object") { if (!matches(v, m[k])) return false; }
      else if (m[k] !== v) return false;
    }
    return true;
  };
  T.matches = matches;
  // Audio stays out of the log: a render's buffer is half a megabyte.
  const heavy = (x) => x instanceof ArrayBuffer || ArrayBuffer.isView(x);
  const light = (d) => {
    let out = d;
    for (const k of Object.keys(d)) {
      if (!heavy(d[k])) continue;
      if (out === d) out = { ...d };
      out[k] = { bytes: d[k].byteLength };
    }
    return out;
  };
  const set = (obj, path, value) => {
    const ks = path.split(".");
    let o = obj;
    for (const k of ks.slice(0, -1)) {
      if (!o || typeof o !== "object") return;
      o = o[k];
    }
    if (o && typeof o === "object") o[ks[ks.length - 1]] = value;
  };
  const learn = (d) => {
    const f = T.facts;
    if (d.views) {
      f.views = d.views;
      if (d.views.ranked) f.ranked = d.views.ranked;
      if (d.views.lineage) f.lineage = d.views.lineage;
      if (d.views.ratings) f.ratings = d.views.ratings;
    }
    if (d.ranked) f.ranked = d.ranked;
    if (d.lineage) f.lineage = d.lineage;
    if (d.ratings) f.ratings = d.ratings;
    if (d.status && typeof d.status === "object") f.status = d.status;
    for (const r of (d.views && d.views.ranked) || d.ranked || []) if (r && r.name != null) f.names[r.id] = r.name;
  };
  T.inject = (data) => {
    const e = new MessageEvent("message", { data });
    e.__tapInjected = true;
    T.engine.dispatchEvent(e);
  };
  T.release = (drop) => {
    T.holds = [];
    T.holdFrom = null;
    T.holdNext = [];
    const held = T.held.splice(0);
    if (!drop) for (const h of held) {
      const e = new MessageEvent("message", { data: h.d });
      e.__tapReleased = true;
      T.engine.dispatchEvent(e);
    }
    return held.length;
  };
  // The spec's settings, by name: the same whether they are made on a live
  // page or before boot (replayed by an init script on every load).
  T.config = (op, a) => {
    if (op === "hold") {
      if (a.from) {
        T.holdNext = a.patterns;
        T.holdFrom = a.from;
      } else T.holds = a.patterns;
      if (a.inject) T.inject(a.inject);
    } else if (op === "amend") T.amends.push({ match: a.match, set: a.set });
    else if (op === "unamend") T.amends = [];
    else if (op === "holdRequests") T.reqHolds = a.patterns.length ? a.patterns : ["*"];
    else if (op === "stall") T.stalls = a.patterns;
    else if (op === "answer") T.answers.push({ match: a.match, reply: a.reply });
    else if (op === "delay") T.delays.push({ match: a.match, ms: a.ms });
    else if (op === "undelay") T.delays = [];
    else if (op === "fail") (T.fails = T.fails || []).push({ match: a.match, message: a.message, fatal: !!a.fatal, once: !!a.once });
  };
  T.releaseRequests = () => {
    T.reqHolds = [];
    const held = T.reqHeld.splice(0);
    for (const [m, t] of held) T.post(m, t);
    return held.length;
  };
  const Orig = window.Worker;
  function Wrapped(url, opts) {
    const w = new Orig(url, opts);
    w.__tapUrl = String(url);
    T.workers.push(w);
    if (!/worker\\.js/.test(w.__tapUrl)) return w;
    T.engine = w;
    // perform_budget.js measures a step on the engine and the patch on PERFORM.
    window.__pbEngine = w;
    w.addEventListener("message", (e) => {
      const d = e.data;
      if (!d || typeof d.type !== "string") return;
      const injected = !!e.__tapInjected;
      if (!injected && !e.__tapReleased && T.holds.some((p) => matches(p, d))) {
        e.stopImmediatePropagation();
        T.held.push({ type: d.type, at: performance.now(), d });
        return;
      }
      // Each reply gets its own copy of an object set into it.
      if (!injected) for (const a of T.amends) if (matches(a.match, d)) for (const [k, v] of Object.entries(a.set)) set(d, k, v && typeof v === "object" ? JSON.parse(JSON.stringify(v)) : v);
      T.replies.push({ type: d.type, at: performance.now(), injected, d: light(d) });
      // The last reply to a request: one with its number and no \`more\`.
      if (d.re != null && !d.more) for (const r of [].concat(d.re)) if (!(r in T.finals)) T.finals[r] = T.replies.length - 1;
      if (injected) return;
      T.last[d.type] = d;
      T.counts[d.type] = (T.counts[d.type] || 0) + 1;
      learn(d);
    });
    const post = (T.post = w.postMessage.bind(w));
    w.postMessage = (m, t) => {
      const typed = m && typeof m.type === "string";
      if (typed) {
        T.sent.push({ type: m.type, at: performance.now(), m });
        T.counts["sent:" + m.type] = (T.counts["sent:" + m.type] || 0) + 1;
        if (m.type === "perform_wire" && m.tree) window.__pbTree = m.tree;
        if (T.holdFrom && matches(T.holdFrom, m)) {
          T.holds = T.holdNext;
          T.holdNext = [];
          T.holdFrom = null;
        }
      }
      if (T.reqHolds.some((p) => p === "*" || matches(p, m))) {
        T.reqHeld.push([m, t]);
        return;
      }
      if (typed && T.stalls.some((p) => matches(p, m))) {
        T.stalls = [];
        T.stalled.push(m);
        return;
      }
      // Failed as the worker fails a request it could not run (worker.js engineError).
      const fail = typed && (T.fails || []).find((f) => matches(f.match, m));
      if (fail) {
        if (fail.once) T.fails.splice(T.fails.indexOf(fail), 1);
        const data = { type: "engine_error", request: m.type, id: m.id == null ? null : m.id, req: m.req == null ? null : m.req, message: fail.message, fatal: fail.fatal, ...(m.rid != null ? { re: m.rid } : {}) };
        setTimeout(() => T.inject(data), 0);
        return;
      }
      const answer = typed && T.answers.find((a) => matches(a.match, m));
      if (answer) {
        const reply = m.rid != null && answer.reply.re === undefined ? { ...answer.reply, re: m.rid } : answer.reply;
        setTimeout(() => T.inject(reply), 0);
        return;
      }
      const delay = typed && T.delays.find((x) => matches(x.match, m));
      if (delay) {
        setTimeout(() => post(m, t), delay.ms);
        return;
      }
      return t ? post(m, t) : post(m);
    };
    return w;
  }
  Wrapped.prototype = Orig.prototype;
  window.Worker = Wrapped;
  document.addEventListener("DOMContentLoaded", () => {
    const lane = document.getElementById("toasts");
    if (!lane) return;
    new MutationObserver((muts) => {
      for (const m of muts)
        for (const n of m.addedNodes) {
          const msg = n.querySelector && n.querySelector(".toast-msg");
          if (msg) T.toasts.push({ text: msg.textContent, at: performance.now() });
        }
    }).observe(lane, { childList: true, subtree: true });
  });
})();`;

// The first-visit tours, and the warm start when `warmed`, marked as seen.
const SEEN = ({ warmed, seen }) => `(() => {
  try {
    const keys = ${seen} ? ["auracle-played", "auracle-bench-tour", "auracle-bank-toured"] : [];
    if (${warmed}) keys.push("auracle-warmed");
    for (const k of keys) localStorage.setItem(k, "1");
  } catch (_) {}
})();`;

// The films' own seeded Math.random (www/video's stage seeds it the same
// way): every draw the page makes, the session seed among them.
const RANDOM = (seed) =>
  `(() => { let s = ${seed >>> 0} >>> 0; Math.random = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();`;

// Chosen requests busy-wait in the engine worker before it serves them
// (`app.busy`), so a race a slow machine can lose is lost every time.
const BUSY = `let __tapBusy = {};
self.addEventListener("message", (e) => {
  const d = e.data;
  if (d && d.type === "__tap_busy") { __tapBusy = d.busy || {}; e.stopImmediatePropagation(); return; }
  const ms = d && __tapBusy[d.type];
  if (ms) { const until = performance.now() + ms; while (performance.now() < until) {} }
});
`;

const asPattern = (p) => (typeof p === "string" ? { type: p } : p);

/** The request types `types` and `lanes` name together, or null for all. */
function requestTypes(types, lanes) {
  if (types == null && lanes == null) return null;
  const out = new Set([].concat(types || []));
  for (const name of [].concat(lanes || [])) {
    if (!LANES[name]) throw new Error(`no lane named ${name}: the tap knows ${Object.keys(LANES).join(", ")}`);
    for (const t of LANES[name]) out.add(t);
  }
  return [...out];
}

class App {
  constructor(page) {
    this.page = page;
    // Settings made with no tap to take them (before boot, mid-navigation),
    // each replayed on every load from then on by an init script (`config`).
    this.settings = 0;
    // The seed whose renders this page's boot reuses and keeps (`RENDERS`),
    // or null: a boot that did not ask.
    this.renders = null;
    this.ENGINE_MS = ENGINE_MS;
    this.ENGINE_CAP_MS = ENGINE_CAP_MS;
    this.QUIET_MS = QUIET_MS;
  }

  async install() {
    await this.page.addInitScript(TAP);
  }

  /** Boot the instrument and wait until it is playable (`#boot.done`).
   *  - `warmed` (true): the warm start is marked done, so it never shows;
   *  - `seen` (true): the first-visit tours are marked seen;
   *  - `seed` (SEED): the engine's random seed, as `?seed=`; null for none;
   *  - `random` (SEED): the page's Math.random, seeded as the films do; null
   *    for the browser's own. A spec that names `random` and no `seed` boots
   *    the films' way, its session seed drawn from that Math.random;
   *  - `query`: more of the address (`"?farm=0"`);
   *  - `busy`: let `app.busy` make chosen requests busy-wait in the worker;
   *  - `slowEngine`: run the engine's wasm calls that many times slower
   *    (perform_budget.js `SLOW_ENGINE`). AURACLE_CPU_THROTTLE does that and
   *    throttles the page (CDP);
   *  - `workerPrefix`: a spec's own code to run in the engine worker ahead of
   *    worker.js (a slowdown of its own, switched on by a message). The
   *    fixture serves the worker with it, after its own: a spec that routed
   *    worker.js itself lost its prefix whenever the fixture routed it too,
   *    as every throttled run does (#166);
   *  - `reuseRenders` (false): start with the render cache an earlier boot of
   *    the same seed left once its pool was whole, so the fill after the veil
   *    is served rather than rendered (`RENDERS` above). For a spec that waits
   *    for the whole pool before it does anything, and not one about boot,
   *    the fill or the renders;
   *  - `wait` (true): wait for the boot. */
  async boot({ warmed = true, seen = true, seed, random, query = "", busy = false, slowEngine = 0, workerPrefix = "", reuseRenders = false, wait = true } = {}) {
    const { page } = this;
    if (seed === undefined) seed = random === undefined ? DEFAULT_SEED : null;
    if (random === undefined) random = DEFAULT_SEED;
    if (random != null) await page.addInitScript(RANDOM(random));
    await page.addInitScript(SEEN({ warmed, seen }));
    const throttle = Number(process.env.AURACLE_CPU_THROTTLE || 0);
    const rate = Math.max(slowEngine || 0, throttle > 1 ? throttle : 0);
    if (busy || rate > 1 || workerPrefix) {
      const prefix = (busy ? BUSY : "") + (rate > 1 ? performBudget.SLOW_ENGINE(rate) : "") + workerPrefix;
      await page.route(/\/worker\.js(\?|$)/, async (route) => {
        const resp = await route.fetch();
        await route.fulfill({ response: resp, body: prefix + (await resp.text()), contentType: "text/javascript" });
      });
    }
    if (throttle > 1) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
    }
    const params = new URLSearchParams(query.replace(/^\?/, ""));
    if (seed != null && !params.has("seed")) params.set("seed", String(seed));
    this.renders = reuseRenders ? rendersKey(params, random) : null;
    if (this.renders) {
      keptFile();
      const reused = kept.get(this.renders);
      base.test.info().annotations.push({
        type: "renders",
        description: reused ? `${reused.rows.length} rows kept for ${this.renders}` : `none kept for ${this.renders}: a cold boot, whose rows are kept`,
      });
      if (reused) await fillRenderStore(page.context(), reused);
    }
    const q = params.toString();
    await page.goto(`/${q ? `?${q.replace(/=(?=&|$)/g, "")}` : ""}`);
    if (wait) await this.booted();
  }

  /** Wait until the boot veil is down (`#boot.done`), as an engine wait. */
  booted() {
    return this.engine((timeout) => expect(this.page.locator("#boot"), "the boot veil lifted").toHaveClass(/\bdone\b/, { timeout }));
  }

  /** On a boot that asked to reuse renders, with the pool whole and nothing
   *  kept yet for its seed: keep the render store's rows for the next boot of
   *  that seed that asks (`RENDERS`). Otherwise nothing. */
  async keepRenders() {
    const key = this.renders;
    if (!key) return;
    keptFile();
    if (kept.has(key)) return;
    const whole = await this.page.evaluate(() => {
      const s = window.__tap && window.__tap.facts.status;
      return !!s && s.pool_target > 0 && s.pool >= s.pool_target;
    });
    if (!whole) return;
    const store = await this.page.evaluate(readRenderStore);
    if (store && store.ns && store.rows.length) {
      kept.set(key, store);
      writeKept();
    }
  }

  /** Reload, and wait for the boot. */
  async reload() {
    await this.page.reload();
    await this.booted();
  }

  /** A full load of the instrument at `path`, its `?seed=` the call's own
   *  `seed` (SEED, as `boot`'s default, unless the call names one; none for
   *  null), and the boot waited for unless `wait` is false. It does not know
   *  what `boot` was given: after a boot the films' way (`random` and no
   *  `seed`), it loads with SEED unless the call says `seed: null`. `path` may
   *  carry a level's hash ("/#learning"), which `boot`'s `query` cannot. The
   *  load goes by about:blank, so a change of hash alone is a new visit,
   *  never a move within the page. On a page `boot` opened: its init scripts
   *  (the seeded Math.random, the tours seen, a throttle) hold on this load
   *  as on every other. */
  async visit(path = "/", { seed = DEFAULT_SEED, wait = true } = {}) {
    const { page } = this;
    const url = new URL(path, "http://localhost");
    if (seed != null && !url.searchParams.has("seed")) url.searchParams.set("seed", String(seed));
    await page.goto("about:blank");
    await page.goto(`${url.pathname}${url.search}${url.hash}`);
    if (wait) await this.booted();
  }

  /** A wait on the engine. `fn(timeout)` gets the bound (`ms`, ENGINE_MS by
   *  default) to pass to its own wait, and the test's timeout grows by the
   *  time the wait takes, until the test's waits have added ENGINE_CAP_MS:
   *  past that, a wait runs inside the test's own timeout. A wait reserves
   *  its whole grant while it runs, so waits run side by side stay under
   *  the cap too. */
  async engine(fn, { ms = ENGINE_MS } = {}) {
    const info = base.test.info();
    if (!info.timeout) return fn(ms);
    const used = engineExtension.get(info) || 0;
    const grant = Math.max(0, Math.min(ms, ENGINE_CAP_MS - used));
    if (grant < ms && !info.annotations.some((a) => a.type === "engine-cap")) {
      info.annotations.push({ type: "engine-cap", description: `the engine waits reached ENGINE_CAP_MS (${ENGINE_CAP_MS / 1000} s); later ones run inside the test's own timeout` });
    }
    engineExtension.set(info, used + grant);
    info.setTimeout(info.timeout + grant);
    const t0 = Date.now();
    try {
      return await fn(ms);
    } finally {
      const unused = grant - Math.min(grant, Date.now() - t0);
      info.setTimeout(info.timeout - unused);
      engineExtension.set(info, engineExtension.get(info) - unused);
    }
  }

  /** How long PERFORM's engine may take to grow an offer or a drift here
   *  (perform_budget.js); the test's timeout grows by one budget per wait. */
  offerBudget(opts) {
    return performBudget.offerBudget(this.page, opts);
  }

  /** A speed budget (ADR-022): `budget` above, for this test. */
  budget(name, measured, limit) {
    return budget(name, measured, limit);
  }

  /** The app's own timing marks named `name` (main.js `mark`, a
   *  `performance.mark("auracle:<name>")`) made after `after` (the page's
   *  clock), oldest first: { t, detail }. */
  marks(name, { after = -Infinity } = {}) {
    return this.page.evaluate(
      ([n, t]) => performance.getEntriesByName(`auracle:${n}`).filter((e) => e.startTime > t).map((e) => ({ t: e.startTime, detail: e.detail ?? null })),
      [name, after === -Infinity ? -1e15 : after],
    );
  }

  /** The page's clock, to mark a moment and ask for what came after it. */
  now() {
    return this.page.evaluate(() => performance.now());
  }

  /** The first engine reply of `type` main was handed after `after` (the
   *  page's clock) that matches `where` (a pattern, or a function of the
   *  reply run here), once it has; `_at` says when it landed. An engine wait,
   *  `timeout` ENGINE_MS by default. `injected` counts replies the spec
   *  posted itself. */
  async reply(type, { where = null, after = -Infinity, timeout = ENGINE_MS, injected = false } = {}) {
    let found = null;
    await this.engine(
      (ms) =>
        expect
          .poll(async () => {
            const rs = await this.replies(type, { where: typeof where === "function" ? null : where, after, injected });
            found = typeof where === "function" ? rs.find(where) || null : rs[0] || null;
            return found != null;
          }, { timeout: ms, message: `a ${type} reply${where ? " matching " + (typeof where === "function" ? where.toString() : JSON.stringify(where)) : ""}` })
          .toBe(true),
      { ms: timeout },
    );
    return found;
  }

  /** Every reply of `type` main was handed after `after`, matching `where`
   *  (a pattern), as they are now. */
  replies(type, { where = null, after = -Infinity, injected = false } = {}) {
    return this.page.evaluate(
      ([ty, p, t, inj]) =>
        window.__tap.replies
          .filter((r) => r.type === ty && r.at > t && (inj || !r.injected) && (!p || window.__tap.matches(p, r.d)))
          .map((r) => ({ ...r.d, _at: r.at })),
      [type, where, after === -Infinity ? -1e15 : after, injected],
    );
  }

  /** The last engine reply of `type` main was handed, or null. */
  last(type) {
    return this.page.evaluate((t) => window.__tap.last[t] || null, type);
  }

  /** How many engine replies of `type` main was handed. */
  count(type) {
    return this.page.evaluate((t) => window.__tap.counts[t] || 0, type);
  }

  /** How many requests of `type` the page posted to the engine. */
  sentCount(type) {
    return this.page.evaluate((t) => window.__tap.counts["sent:" + t] || 0, type);
  }

  /** The requests posted after `after` that match `pattern`, oldest first,
   *  each with `_at`. */
  sent(pattern = {}, { after = -Infinity } = {}) {
    return this.page.evaluate(
      ([p, t]) => window.__tap.sent.filter((s) => s.at > t && window.__tap.matches(p, s.m)).map((s) => ({ ...s.m, _at: s.at })),
      [asPattern(pattern), after === -Infinity ? -1e15 : after],
    );
  }

  /** Requests and engine replies after `after`, in the order they happened,
   *  each with its plain fields (no objects): a request's type is
   *  `sent:<type>`. For a latency or an order across both directions. */
  log({ after = -Infinity } = {}) {
    return this.page.evaluate((t) => {
      const T = window.__tap;
      const plain = (o) => {
        const out = {};
        for (const k of Object.keys(o)) if (o[k] == null || typeof o[k] !== "object") out[k] = o[k];
        return out;
      };
      const sent = T.sent.filter((s) => s.at > t).map((s) => ({ ...plain(s.m), type: "sent:" + s.type, at: s.at }));
      const got = T.replies.filter((r) => r.at > t && !r.injected).map((r) => ({ ...plain(r.d), type: r.type, at: r.at }));
      return sent.concat(got).sort((a, b) => a.at - b.at);
    }, after === -Infinity ? -1e15 : after);
  }

  /** The requests main has sent (after `after`, the page's clock) still
   *  waiting for their last reply: those of `types`, or in `lanes` (`LANES`,
   *  by name), or every one with neither. Not those the worker never answers
   *  (`UNANSWERED`), nor any main did not number (a spec's own `app.post`).
   *  Only the first `upTo` requests the tap recorded, when given. As they
   *  are now, oldest first: { type, rid, _at }. */
  unanswered({ types = null, lanes = null, after = -Infinity, upTo = null } = {}) {
    return this.page.evaluate(
      ([want, skip, t, n]) => {
        const T = window.__tap;
        const out = [];
        for (const s of n == null ? T.sent : T.sent.slice(0, n)) {
          const rid = s.m && s.m.rid;
          if (rid == null || s.at <= t || skip.includes(s.type) || (want && !want.includes(s.type))) continue;
          if (!(rid in T.finals)) out.push({ type: s.type, rid, _at: s.at });
        }
        return out;
      },
      [requestTypes(types, lanes), UNANSWERED, after === -Infinity ? -1e15 : after, upTo],
    );
  }

  /** Every request of `types`, or in `lanes` (`LANES`: `"bench"`), that main
   *  has sent so far (after `after`, the page's clock) has had its last reply,
   *  as main was handed it: an engine wait, ENGINE_MS unless `timeout` says.
   *  With neither, every request sent so far. A request asked for after this
   *  call is not waited for (settled waits for those: patch_page.js). Fails
   *  naming what was still waiting. */
  async answered({ types = null, lanes = null, after = -Infinity, timeout = ENGINE_MS } = {}) {
    const upTo = await this.page.evaluate(() => window.__tap.sent.length);
    let left = [];
    try {
      await this.engine(
        (ms) =>
          expect
            .poll(async () => (left = await this.unanswered({ types, lanes, after, upTo })).length, {
              timeout: ms,
              message: "every request asked was answered",
            })
            .toBe(0),
        { ms: timeout },
      );
    } catch (err) {
      throw new Error(`still waiting for ${left.map((r) => `${r.type} #${r.rid}`).join(", ")}\n${err.message}`);
    }
  }

  /** The last reply to one request (`sent`: as `app.sent` returns it, or its
   *  number), once main has been handed it: the one carrying its number
   *  (`re`) without `more`, whatever its type. An engine wait. `_at` says
   *  when it landed. */
  async replyTo(sent, { timeout = ENGINE_MS } = {}) {
    const rid = typeof sent === "number" ? sent : sent && sent.rid;
    if (rid == null) throw new Error(`replyTo: ${JSON.stringify(sent)} has no request number (rid); was it sent by main?`);
    const find = (r) => {
      const T = window.__tap;
      const i = T.finals[r];
      return i == null ? null : { ...T.replies[i].d, _at: T.replies[i].at };
    };
    let found = null;
    await this.engine(
      (ms) =>
        expect
          .poll(async () => (found = await this.page.evaluate(find, rid)) != null, {
            timeout: ms,
            message: `the last reply to ${sent.type || "request"} #${rid}`,
          })
          .toBe(true),
      { ms: timeout },
    );
    return found;
  }

  /** The engine's facts as main last heard them from the engine. */
  facts() {
    return this.page.evaluate(() => JSON.parse(JSON.stringify(window.__tap.facts)));
  }

  /** What this browser has saved of the page's own state (IndexedDB
   *  auracle › kv › state, its `ui`), or null: what a reload comes back to.
   *  Never creates the database. */
  savedUi() {
    return this.page.evaluate(() => new Promise((resolve) => {
      let req;
      try {
        req = indexedDB.open("auracle");
      } catch (_) {
        return resolve(null);
      }
      req.onupgradeneeded = () => {
        try { req.transaction.abort(); } catch (_) {}
        resolve(null);
      };
      req.onerror = () => resolve(null);
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("kv")) { db.close(); return resolve(null); }
        const get = db.transaction("kv", "readonly").objectStore("kv").get("state");
        get.onsuccess = () => { db.close(); resolve(get.result && get.result.ui ? JSON.parse(JSON.stringify(get.result.ui)) : null); };
        get.onerror = () => { db.close(); resolve(null); };
      };
    }));
  }

  /** Post a request to the engine, as main would (it is in `sent`). */

  post(data) {
    return this.page.evaluate((d) => window.__tap.engine.postMessage(d), data);
  }

  /** Hand main a reply as the engine would. It reaches main and is in
   *  `replies` marked injected, but not in `last`, `counts` or `facts`. */
  inject(data) {
    return this.page.evaluate((d) => window.__tap.inject(d), data);
  }

  /** Apply a setting to the tap: at once on a live page; with no tap to
   *  take it (before `boot`, or while a page loads) by an init script, so it
   *  holds from the first message of every load from then on, and on the
   *  load under way if its scripts ran before that one was added. */
  async config(op, args = {}) {
    const live = await this.page
      .evaluate(([op, a]) => (window.__tap ? (window.__tap.config(op, a), true) : false), [op, args])
      .catch(() => false);
    if (live) return;
    const id = ++this.settings;
    const apply = ([op, a, id]) => {
      const T = window.__tap;
      if (!T || (T.applied || []).includes(id)) return;
      T.config(op, a);
      (T.applied = T.applied || []).push(id);
    };
    await this.page.addInitScript(apply, [op, args, id]);
    await this.page.evaluate(apply, [op, args, id]).catch(() => {});
  }

  /** Keep the engine's own replies matching any pattern from main until
   *  `release`, in order: an injected reply then stands until the spec lets
   *  the engine speak again. `from`: start holding only when the page posts a
   *  request matching it. `inject`: hand main this reply in the same breath,
   *  so no engine reply can land between the two. */
  hold(patterns, { from = null, inject = null } = {}) {
    return this.config("hold", { patterns: [].concat(patterns).map(asPattern), from: from && asPattern(from), inject });
  }

  /** The replies held so far: [{ type, at }]. */
  held() {
    return this.page.evaluate(() => window.__tap.held.map((h) => ({ type: h.type, at: h.at })));
  }

  /** Whether a hold armed with `from` has begun. */
  holding() {
    return this.page.evaluate(() => window.__tap.holds.length > 0);
  }

  /** Stop holding, and hand main what was held, in order (or drop it with
   *  `{ drop: true }`). How many there were. */
  release({ drop = false } = {}) {
    return this.page.evaluate((d) => window.__tap.release(d), drop);
  }

  /** Rewrite the engine's replies matching `match` before main reads them:
   *  `set` maps a dotted path to a value, set where its parent exists. */
  amend(match, set) {
    return this.config("amend", { match: asPattern(match), set });
  }

  /** Stop rewriting replies. */
  unamend() {
    return this.config("unamend");
  }

  /** Keep the page's requests matching any pattern (all of them with none)
   *  from the engine until `releaseRequests`. */
  holdRequests(...patterns) {
    return this.config("holdRequests", { patterns: patterns.map(asPattern) });
  }

  /** Post the held requests, in order; how many there were. */
  releaseRequests() {
    return this.page.evaluate(() => window.__tap.releaseRequests());
  }

  /** The next request matching any pattern never reaches the engine: it is
   *  kept, and the spec answers it with `inject` when it chooses. */
  stall(...patterns) {
    return this.config("stall", { patterns: patterns.map(asPattern) });
  }

  /** The request stalled most recently, once there is one (a UI-side wait:
   *  the page asks at once). */
  async stalled() {
    await expect.poll(() => this.page.evaluate(() => window.__tap.stalled.length)).toBeGreaterThan(0);
    return this.page.evaluate(() => window.__tap.stalled[window.__tap.stalled.length - 1]);
  }

  /** Answer every request matching `match` with `reply` ourselves, as an
   *  engine would, and send it no further. */
  answer(match, reply) {
    return this.config("answer", { match: asPattern(match), reply });
  }

  /** Post requests matching `match` to the engine `ms` later: the stand-in
   *  for an engine busy elsewhere. */
  delay(match, ms) {
    return this.config("delay", { match: asPattern(match), ms });
  }

  /** Post every request at once again. */
  undelay() {
    return this.config("undelay");
  }

  /** Make requests of these types busy-wait in the worker for so many ms
   *  before it serves them (`{ edit_set: 1500 }`); needs `boot({ busy })`. */
  busy(map) {
    return this.page.evaluate((m) => window.__tap.post({ type: "__tap_busy", busy: m }), map);
  }

  /** How many toasts have entered the lane: a mark for `toasts` and `toast`. */
  toastMark() {
    return this.page.evaluate(() => window.__tap.toasts.length);
  }

  /** The words of every toast that entered the lane since `since`. */
  toasts(since = 0) {
    return this.page.evaluate((k) => window.__tap.toasts.slice(k).map((t) => t.text), since);
  }

  /** Wait until a toast matching `text` (a string it contains, or a RegExp)
   *  has entered the lane since `since`, and return its words. A toast may
   *  wait its turn behind one already on screen. */
  async toast(text, { since = 0, timeout } = {}) {
    const test = (t) => (text instanceof RegExp ? text.test(t) : t.includes(text));
    let said = null;
    await expect
      .poll(async () => {
        said = (await this.toasts(since)).find(test) || null;
        return said != null;
      }, { timeout, message: `a toast saying ${text}` })
      .toBe(true);
    return said;
  }

  /** Nothing happens for QUIET_MS: the one fixed wait, for a check that
   *  something does not occur (a stray toast, a second request). */
  quiet(ms = QUIET_MS) {
    // eslint-disable-next-line playwright/no-wait-for-timeout -- the one fixed wait (tests/web/AGENTS.md)
    return this.page.waitForTimeout(ms);
  }

  /** Go to a level by its stop on the rail (shell.js `goLevel`). */
  level(name) {
    return shell.goLevel(this.page, name);
  }

  /** The warm start's three picks (cards `cards` of nine), then the fit it
   *  asks for. */
  async warmStart(cards = [1, 4, 7]) {
    const { page } = this;
    await this.engine((timeout) => expect(page.locator("#warmstart")).not.toHaveClass(/\bhidden\b/, { timeout }));
    const items = page.locator(".warm-cell .warm-item");
    for (const i of cards) await items.nth(i).click();
    await page.locator("#warm-go").click();
    return this.reply("fitted");
  }

  /** Teach it in EVOLVE: `n` picks (A, B, A, …), each once its pair is up;
   *  at six, the refit they ask for (`fitted`) and the job slot clear. */
  async teach(n = 6) {
    const { page } = this;
    const t0 = await this.now();
    await this.reply("duel", { where: { pair: true } });
    await this.level("evolve");
    for (let i = 1; i <= n; i++) {
      const side = page.locator(i % 2 ? "#choose-a" : "#choose-b");
      await this.engine((timeout) => expect(side).toBeEnabled({ timeout }), { ms: 30_000 });
      await side.click();
    }
    if (n < 6) return;
    await this.reply("fitted", { after: t0 });
    await this.engine((timeout) => expect(page.locator("#job-slot")).toBeHidden({ timeout }), { ms: 30_000 });
  }

  /** The bank whole: the engine has said `filled`, and main has heard the
   *  whole list (`facts.ranked`, as long as `status.pool_target`), which
   *  comes with the views after `filled`. The app is playable at 8 sounds
   *  and fills the rest behind the player. */
  async filled() {
    const done = await this.reply("filled");
    await this.engine((ms) =>
      expect
        .poll(() => this.page.evaluate(() => {
          const f = window.__tap.facts;
          return !!(f.status && f.ranked && f.status.pool_target > 0 && f.ranked.length >= f.status.pool_target);
        }), { timeout: ms, message: "the pool's whole list never came after filled" })
        .toBe(true));
    await this.keepRenders();
    return done;
  }

  /** The bank's list showing `n` rows of the pool (all 40 by default), as
   *  the engine fills it: an engine wait. */
  async poolRows(n = 40, { timeout = ENGINE_MS } = {}) {
    await this.engine(
      (ms) => expect.poll(() => this.page.locator("#bank-list .bank-item[data-id]").count(), { timeout: ms, message: `the pool's ${n} rows in the bank` }).toBe(n),
      { ms: timeout },
    );
    await this.keepRenders();
  }

  /** The pool at its size, as the engine's status says (a refill after a
   *  cut or a generation included). */
  async fullPool({ timeout = ENGINE_MS } = {}) {
    await this.engine(
      (ms) =>
        expect
          .poll(() => this.page.evaluate(() => {
            const s = window.__tap.facts.status;
            return !!s && s.pool_target > 0 && s.pool >= s.pool_target;
          }), { timeout: ms, message: "the pool never filled" })
          .toBe(true),
      { ms: timeout },
    );
    await this.keepRenders();
  }

  /** Answer the requests matching `match` as the worker answers one it could
   *  not run (worker.js `engineError`): an `engine_error` naming the request
   *  (`request`, and its `id` and `req`), injected, and the request sent no
   *  further. It is still in `sent`. `fatal`: the engine is down, as a
   *  poisoned worker answers everything; `once`: the next such request only.
   *  The way to fail what the shipped engine never fails. */
  fail(match, { message = "Error: injected for the test", fatal = false, once = false } = {}) {
    return this.config("fail", { match: asPattern(match), message, fatal, once });
  }

  /** A preset opened as a player opens one onto PERFORM: PRESETS, its row,
   *  and once the rack holds it, the PERFORM stop, until PERFORM names it;
   *  then, unless `reach` is false, `reached({ wired })`. Engine waits. */
  async openOnPerform(name, { reach = true, wired = false } = {}) {
    const { page } = this;
    await shell.bankTab(page, "presets");
    await page.locator(".bank-item", { hasText: name }).first().click();
    await this.engine((timeout) => expect(page.locator("#rack-subject")).toContainText(name, { timeout }), { ms: 90_000 });
    await this.level("perform");
    await this.engine((timeout) => expect(page.locator(".pf-name")).toHaveText(name, { timeout }), { ms: 30_000 });
    if (reach) await this.reached({ wired });
  }

  /** PERFORM's controls reach the patch it shows (the status line's
   *  "controls reach"), and with `wired`, at the same moment, none of the
   *  panel's six is unwired: an engine wait (a measurement, or a kept one
   *  read back). */
  reached({ wired = false, ms = 120_000 } = {}) {
    const live = (all) =>
      /controls reach/.test(document.querySelector(".pf-status")?.textContent || "") &&
      (!all || ![0, 1, 2, 3, 4, 5].some((i) => document.querySelector(`.pf-knob[data-i="${i}"]`)?.classList.contains("unwired")));
    return this.engine((timeout) => this.page.waitForFunction(live, wired, { timeout }), { ms });
  }
}

/** The tap on another page (a second context's), before it navigates. */
async function openApp(page) {
  const app = new App(page);
  await app.install();
  return app;
}

/** This machine, as a failed test's `runner` annotation names it. */
const RUNNER = `${os.cpus().length} × ${(os.cpus()[0] || {}).model || "unknown CPU"}`;

const test = base.test.extend({
  consoleErrors: [false, { option: true }],
  // First, so it is torn down last and sees a failure the others' teardown
  // found (a page error) too.
  runner: [
    async ({}, use, testInfo) => {
      await use();
      if (testInfo.status !== testInfo.expectedStatus) testInfo.annotations.push({ type: "runner", description: RUNNER });
    },
    { auto: true },
  ],
  pageErrors: [
    async ({ context, consoleErrors }, use) => {
      const errors = [];
      const watch = (p) => {
        p.on("pageerror", (e) => errors.push(e.message));
        if (consoleErrors) p.on("console", (m) => { if (m.type() === "error") errors.push(`console.error: ${m.text()}`); });
      };
      context.pages().forEach(watch);
      context.on("page", watch);
      await use(errors);
      expect(errors, `uncaught exceptions:\n${errors.join("\n")}`).toEqual([]);
    },
    { auto: true },
  ],
  app: async ({ page }, use, testInfo) => {
    const app = await openApp(page);
    await use(app);
    // A boot that asked to reuse renders keeps its store's rows, if its test
    // passed with the pool whole and none were kept yet (`RENDERS`): a spec
    // whose own wait for the pool is not the fixture's.
    if (testInfo.status === "passed" && !page.isClosed()) {
      await Promise.race([app.keepRenders().catch(() => {}), new Promise((r) => setTimeout(r, 5_000))]);
    }
    // A failed test carries what the tap saw: every toast, and the counts of
    // what was sent and heard.
    if (testInfo.status !== testInfo.expectedStatus && !page.isClosed()) {
      const seen = await Promise.race([
        page.evaluate(() => window.__tap && {
          toasts: window.__tap.toasts.map((t) => `${Math.round(t.at)} ${t.text}`),
          counts: window.__tap.counts,
          held: window.__tap.held.map((h) => h.type),
        }).catch(() => null),
        new Promise((r) => setTimeout(() => r(null), 2_000)),
      ]);
      if (seen) await testInfo.attach("tap", { body: JSON.stringify(seen, null, 1), contentType: "application/json" });
      if (seen && process.env.AURACLE_TAP_LOG) console.log(`tap at failure (timeout ${testInfo.timeout} ms, ${Math.round(testInfo.duration)} ms in): ${JSON.stringify(seen)}`);
    }
  },
  // Another context of the test's own (another device, a second visit):
  // `newContext(options)` is `browser.newContext`, the project's `use` under
  // `options`. A page error on any of its pages fails the test as one on the
  // test's own context does (`pageErrors`, and `consoleErrors` with it), and
  // the context is closed when the test ends. The tap goes on one of its
  // pages with `openApp`.
  newContext: async ({ browser, pageErrors, consoleErrors }, use) => {
    const made = [];
    await use(async (options = {}) => {
      const context = await browser.newContext(options);
      made.push(context);
      context.on("page", (p) => {
        p.on("pageerror", (e) => pageErrors.push(e.message));
        if (consoleErrors) p.on("console", (m) => { if (m.type() === "error") pageErrors.push(`console.error: ${m.text()}`); });
      });
      return context;
    });
    for (const c of made) await c.close().catch(() => {});
  },
});

module.exports = { test, expect, openApp, budget, forgetRenders, ENGINE_MS, ENGINE_CAP_MS, QUIET_MS, SEED, PERFORM_SEED, UNANSWERED, LANES, ...shell };
