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
// - **`app`** (per test, only when a test asks for it) installs the engine
//   worker's tap before anything else runs, so main.js's own `onmessage` is
//   always the last to hear a reply, and a spec's own init scripts (added
//   after) wrap outside it. Nothing in the app changes for the tests: the tap
//   wraps `Worker` before main.js runs (tests/web/AGENTS.md).
//
// What the tap keeps, in the page (`window.__tap`):
//   replies   what main was handed, in order: { type, at, injected, d }
//             (`d` is the message, any audio in it left out)
//   last      the last engine reply of each type (injected ones aside)
//   counts    engine replies by type, and requests as `sent:<type>`
//   sent      every request posted to the engine: { type, at, m }
//   toasts    every toast that entered the lane: { text, at }
//   facts     the engine's facts as main last heard them from the engine:
//             views, ranked, lineage, ratings, status, and every name a
//             sound has had (`names`)
// Times are the page's clock (`performance.now()`, `app.now()`).
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
// slow runner's engine never eats the test's own budget. PERFORM's growth
// (an offer, a drift) is bounded by `app.offerBudget()` (perform_budget.js).
// The one fixed wait is `app.quiet()`: QUIET_MS for "nothing happens", where
// the check is that something does not occur.
const base = require("@playwright/test");
const { expect } = base;
const shell = require("./shell");
const budget = require("./perform_budget");

/** A wait on the engine that `offerBudget` does not bound: boot, the pool
 *  filling, a fit, a deal, a generation's reply. The longest of these on a CI
 *  runner was a full pool, about two minutes behind a refit. */
const ENGINE_MS = 150_000;
/** "Nothing happens": long enough for a loaded machine to have done the wrong
 *  thing (testing.md § Rules: timing needs 1.5 s of slack). */
const QUIET_MS = 1_500;
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

// The tap, installed before the page's scripts on every navigation. One
// wrapper of `Worker`: whatever a spec adds later wraps it.
const TAP = `(() => {
  if (window.__tap) return;
  const T = (window.__tap = {
    engine: null, workers: [],
    replies: [], last: {}, counts: {}, sent: [], toasts: [],
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
        const data = { type: "engine_error", request: m.type, id: m.id == null ? null : m.id, req: m.req == null ? null : m.req, message: fail.message, fatal: fail.fatal };
        setTimeout(() => T.inject(data), 0);
        return;
      }
      const answer = typed && T.answers.find((a) => matches(a.match, m));
      if (answer) {
        setTimeout(() => T.inject(answer.reply), 0);
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

class App {
  constructor(page) {
    this.page = page;
    // Settings made with no tap to take them (before boot, mid-navigation),
    // each replayed on every load from then on by an init script (`config`).
    this.settings = 0;
    this.ENGINE_MS = ENGINE_MS;
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
   *  - `wait` (true): wait for the boot. */
  async boot({ warmed = true, seen = true, seed, random, query = "", busy = false, slowEngine = 0, wait = true } = {}) {
    const { page } = this;
    if (seed === undefined) seed = random === undefined ? DEFAULT_SEED : null;
    if (random === undefined) random = DEFAULT_SEED;
    if (random != null) await page.addInitScript(RANDOM(random));
    await page.addInitScript(SEEN({ warmed, seen }));
    const throttle = Number(process.env.AURACLE_CPU_THROTTLE || 0);
    const rate = Math.max(slowEngine || 0, throttle > 1 ? throttle : 0);
    if (busy || rate > 1) {
      const prefix = (busy ? BUSY : "") + (rate > 1 ? budget.SLOW_ENGINE(rate) : "");
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
    const q = params.toString();
    await page.goto(`/${q ? `?${q.replace(/=(?=&|$)/g, "")}` : ""}`);
    if (wait) await this.booted();
  }

  /** Wait until the boot veil is down (`#boot.done`), as an engine wait. */
  booted() {
    return this.engine((timeout) => expect(this.page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout }));
  }

  /** Reload, and wait for the boot. */
  async reload() {
    await this.page.reload();
    await this.booted();
  }

  /** A wait on the engine. `fn(timeout)` gets the bound (`ms`, ENGINE_MS by
   *  default) to pass to its own wait, and the test's timeout grows by the
   *  time the wait takes. */
  async engine(fn, { ms = ENGINE_MS } = {}) {
    const info = base.test.info();
    if (!info.timeout) return fn(ms);
    info.setTimeout(info.timeout + ms);
    const t0 = Date.now();
    try {
      return await fn(ms);
    } finally {
      info.setTimeout(info.timeout - Math.max(0, ms - (Date.now() - t0)));
    }
  }

  /** How long PERFORM's engine may take to grow an offer or a drift here
   *  (perform_budget.js); the test's timeout grows by one budget per wait. */
  offerBudget(opts) {
    return budget.offerBudget(this.page, opts);
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
    return done;
  }

  /** The bank's list showing `n` rows of the pool (all 40 by default), as
   *  the engine fills it: an engine wait. */
  poolRows(n = 40, { timeout = ENGINE_MS } = {}) {
    return this.engine(
      (ms) => expect.poll(() => this.page.locator("#bank-list .bank-item[data-id]").count(), { timeout: ms }).toBe(n),
      { ms: timeout },
    );
  }

  /** The pool at its size, as the engine's status says (a refill after a
   *  cut or a generation included). */
  fullPool({ timeout = ENGINE_MS } = {}) {
    return this.engine(
      (ms) =>
        expect
          .poll(() => this.page.evaluate(() => {
            const s = window.__tap.facts.status;
            return !!s && s.pool_target > 0 && s.pool >= s.pool_target;
          }), { timeout: ms, message: "the pool never filled" })
          .toBe(true),
      { ms: timeout },
    );
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

const test = base.test.extend({
  consoleErrors: [false, { option: true }],
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
    await use(await openApp(page));
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

});

module.exports = { test, expect, openApp, ENGINE_MS, QUIET_MS, SEED, PERFORM_SEED, ...shell };
