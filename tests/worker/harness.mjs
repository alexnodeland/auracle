// The worker-protocol level (#178): apps/web/worker.js, unchanged, in a Node
// worker thread over the built engine (apps/web/pkg), with no page.
//
// A browser spec boots the whole app to learn what the engine worker answers
// and in what order. This runs the worker's own file in a `worker_threads`
// thread that gives it what a module Web Worker has and Node does not: `self`
// with `postMessage`, `onmessage` and `location`, the `unhandledrejection`
// event, and a `fetch` that reads the app's own files from disk. Nothing else
// of the browser is here: no IndexedDB unless the test gives it a stand-in
// (`idb`: the render store and the face store in memory, apps/web/tests/
// fake-idb.mjs, read back with `w.idb()`; without it the stores are off, as
// where a browser refuses them), no page, no audio, and no farm.js: main's
// answer to `farm_want` is a crew of no workers, as with `?farm=0`, unless
// the test hands the worker ports of its own (`fakeCrew`, at boot or as a
// crew) or keeps the answer back (`holdFarm`).
//
// The same file is both ends: imported by a test it is the client
// (`startWorker`); run as the thread's entry it hosts the worker.
//
// It adds the engine's own timeline. Every call the worker makes into
// `WasmEngine` is noted in order with the messages it took and posted
// (`trace`), with the featurizations it rendered (`misses`: the memo's misses
// during the call; 0 for one served from the memo), and a request can be
// posted while a given call runs (`post`'s `during`), as one of main's
// arrives in the middle of a render. The calls are wrapped from outside, on
// the class the glue exports, as the browser fixture's `slowEngine` wraps
// them; worker.js is not touched.
import { Worker, isMainThread, parentPort, workerData, MessageChannel } from "node:worker_threads";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as nodeModule from "node:module";
import { fakeIndexedDB } from "../../apps/web/tests/fake-idb.mjs";

const WEB = new URL("../../apps/web/", import.meta.url);
const WORKER_URL = new URL("worker.js", WEB).href;
const WASM = new URL("pkg/auracle_wasm_bg.wasm", WEB);
const GLUE = new URL("pkg/auracle_wasm.js", WEB).href;
// The worker's `?v=`, which it imports its glue with: the harness imports the
// same URL, so both hold one module and one `WasmEngine`.
const V = "harness";

/** How long a wait on the engine may take before the test fails: renders on
 *  a loaded runner, never a claim about speed. The slowest whole test seen
 *  took 80 s, under load; under the tests' own 150 s, so a wait that hangs
 *  names the reply it missed. */
export const ENGINE_MS = 120_000;

if (!isMainThread && workerData && workerData.auracleWorker) await host();

// ---------- the thread: worker.js as a module worker ----------

async function host() {
  // main.js starts the worker as a module (`{ type: "module" }`). worker.js
  // has no import or export, so Node would read it as CommonJS, in sloppy
  // mode; it is served as the module it is. `registerHooks` is Node 22.15
  // and later; before it, the same hook runs on Node's loader thread.
  if (typeof nodeModule.registerHooks === "function") {
    nodeModule.registerHooks({
      load(url, context, next) {
        if (url.split("?")[0] !== WORKER_URL) return next(url, context);
        return { format: "module", source: readFileSync(fileURLToPath(url), "utf8"), shortCircuit: true };
      },
    });
  } else {
    const hook = `export async function load(url, context, next) {
      if (url.split("?")[0] !== ${JSON.stringify(WORKER_URL)}) return next(url, context);
      return { ...(await next(url, { ...context, format: "module" })), format: "module", shortCircuit: true };
    }`;
    nodeModule.register(`data:text/javascript,${encodeURIComponent(hook)}`);
  }

  // In the order it happened on this thread: `in` (a message handed to the
  // worker), `call` (a call into the engine begins), `posted` (a `during`
  // request sent), `out` (a reply, numbered as the client numbers them). Each
  // carries `t`, this thread's clock when it happened, for a claim that
  // holds only for so long (a hold's cap).
  const trace = [];
  let replies = 0;
  const armed = []; // {call, left, msg, tag}
  const say = (h) => parentPort.postMessage({ __harness: h });

  globalThis.self = globalThis;
  self.location = { href: `${WORKER_URL}?v=${V}` };
  // The stand-in IndexedDB, when the test asked for one (`idb`), starting
  // from what it handed over.
  const idb = workerData.idb ? fakeIndexedDB({ dbs: workerData.idb }) : null;
  if (idb) self.indexedDB = idb.as("engine");
  self.postMessage = (msg, transfer) => {
    trace.push({ ev: "out", n: replies++, type: msg && msg.type, t: performance.now() });
    parentPort.postMessage(msg, transfer || []);
  };
  self.addEventListener = (type, fn) => {
    if (type === "unhandledrejection") {
      process.on("unhandledRejection", (reason, promise) => fn({ reason, promise, preventDefault() {} }));
    }
  };
  // The app's own files (worker.js fetches perform-wirings.json); nothing
  // from the network.
  self.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.protocol !== "file:") throw new TypeError(`the worker harness fetches the app's own files only, not ${url.href}`);
    const path = fileURLToPath(url);
    if (!existsSync(path)) return new Response(null, { status: 404 });
    const type = path.endsWith(".wasm") ? "application/wasm" : path.endsWith(".json") ? "application/json" : "text/plain";
    return new Response(readFileSync(path), { headers: { "content-type": type } });
  };
  for (const level of ["error", "warn"]) {
    console[level] = (...args) => say({ op: "console", level, text: args.map(String).join(" ") });
  }

  // main.js compiles the binary once and hands the Module to the worker in
  // `init`; so does this.
  const module = new WebAssembly.Module(readFileSync(WASM));

  const glue = await import(`${GLUE}?v=${V}`);
  const proto = glue.WasmEngine.prototype;
  // The memo's misses so far, read past the wrapper (not a call of the
  // worker's); null where the engine cannot answer (freed, or trapped).
  const memoStats = proto.memo_stats;
  const misses = (engine) => {
    try {
      return JSON.parse(memoStats.call(engine)).misses;
    } catch (_) {
      return null;
    }
  };
  for (const name of Object.getOwnPropertyNames(proto)) {
    const d = Object.getOwnPropertyDescriptor(proto, name);
    if (name === "constructor" || typeof d.value !== "function") continue;
    const fn = d.value;
    proto[name] = function (...args) {
      const e = called(name);
      const before = misses(this);
      try {
        return fn.apply(this, args);
      } finally {
        const after = misses(this);
        e.misses = before == null || after == null ? null : after - before;
      }
    };
  }

  // What `during` posts arrives on this channel, between two turns of the
  // thread's event loop, as a message main posts mid-call does.
  const loop = new MessageChannel();
  function called(name) {
    const e = { ev: "call", name, t: performance.now() };
    trace.push(e);
    for (let i = 0; i < armed.length; i++) {
      const a = armed[i];
      if (a.call !== name || --a.left > 0) continue;
      armed.splice(i--, 1);
      trace.push({ ev: "posted", tag: a.tag, type: a.msg.type, t: performance.now() });
      loop.port1.postMessage(a.msg);
    }
    return e;
  }

  const deliver = (data) => {
    if (data && data.type === "init" && !data.module) data = { ...data, module };
    trace.push({ ev: "in", type: data && data.type, key: data && (data.req ?? data.token ?? data.id ?? null), t: performance.now() });
    self.onmessage({ data });
  };
  loop.port2.on("message", deliver);
  parentPort.on("message", (data) => {
    const h = data && data.__harness;
    if (!h) return deliver(data);
    if (h.op === "during") armed.push({ call: h.call, left: h.nth || 1, msg: h.msg, tag: h.tag });
    if (h.op === "trace") say({ op: "trace", id: h.id, trace });
    if (h.op === "idb") say({ op: "idb", id: h.id, dbs: idb ? idb.dump() : null });
  });

  // A module with no exports has none; CommonJS would have `default`.
  const loaded = await import(`${WORKER_URL}?v=${V}`);
  if ("default" in loaded) throw new Error("worker.js was loaded as CommonJS, not as the module main.js starts");
  say({ op: "ready" });
}

// ---------- the client ----------

// Every request goes out numbered (`rid`), as main.js `send` numbers it, and
// every reply the worker sends in answer names it (`re`: the number, or a
// list when one reply answers several), with `more: true` on all but the
// last (docs/architecture/web-runtime.md, "The worker's replies").
const answers = (rid) => (r) => r.re === rid || (Array.isArray(r.re) && r.re.includes(rid));

function matches(r, where) {
  if (!where) return true;
  if (typeof where === "function") return where(r);
  return Object.entries(where).every(([k, v]) => r[k] === v);
}

class EngineWorker {
  constructor(thread, { errors, crew }) {
    this.thread = thread;
    this.crew = crew;
    this.rid = 0;
    /** Every reply the worker posted, in order; each carries its place, `_n`. */
    this.replies = [];
    /** What the worker said on `console.error` and `console.warn`. */
    this.console = [];
    this.allowErrors = errors;
    this.farmHeld = null;
    this.waits = new Set();
    this.traces = new Map(); // id -> {resolve, reject}
    this.traceSeq = 0;
    this.failure = null;
    this.ready = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    thread.on("message", (m) => this.onMessage(m));
    thread.on("error", (err) => this.fail(err));
    thread.on("exit", (code) => {
      if (!this.closing) this.fail(new Error(`the engine worker's thread exited (${code})`));
    });
  }

  onMessage(m) {
    const h = m && m.__harness;
    if (h) {
      if (h.op === "ready") this.readyResolve();
      if (h.op === "console") this.console.push({ level: h.level, text: h.text });
      if (h.op === "trace" || h.op === "idb") {
        this.traces.get(h.id).resolve(h.op === "trace" ? h.trace : h.dbs);
        this.traces.delete(h.id);
      }
      return;
    }
    m._n = this.replies.length;
    this.replies.push(m);
    // Main's answer to a crew wanted: the test's (`crew`), else none
    // (`?farm=0`), unless held.
    if (m.type === "farm_want") {
      if (this.farmHeld) this.farmHeld.push(m);
      else this.answerCrew(m);
    }
    for (const w of [...this.waits]) w.check();
  }

  fail(err) {
    this.failure = this.failure || err;
    this.readyReject(err);
    for (const w of [...this.waits]) w.reject(err);
    for (const t of this.traces.values()) t.reject(err);
    this.traces.clear();
  }

  /** Send `msg` to the worker, numbered as main numbers it: `msg.rid` is set
   *  on the object, so `answers(msg)` finds its replies later. With
   *  `during: { call, nth }` it is posted when
   *  the `nth` call (1 by default) of the engine's `call` from now begins,
   *  and arrives once that call is over. It lands before `breathe`'s 1 ms
   *  timer only when the armed call runs in a timer turn (`pump`, or a job
   *  going on after `breathe`), as every call these tests arm does; a call
   *  made inside a `now` request served on arrival can lose to that timer.
   *  Returns the count of replies so far, a mark for `after`. */
  post(msg, { during, transfer } = {}) {
    const at = this.replies.length;
    msg.rid = ++this.rid;
    if (during) {
      const { call, nth = 1, tag = msg.type } = typeof during === "string" ? { call: during } : during;
      this.thread.postMessage({ __harness: { op: "during", call, nth, msg, tag } });
    } else {
      this.thread.postMessage(msg, transfer || []);
    }
    return at;
  }

  /** Send `msg` and wait for every reply that answers it: an array, in
   *  order, up to the one without `more` (an `engine_error` if it could not
   *  run). Only for a request the worker answers: a few never are, by design
   *  (`retire`, `promote`, `farm_ports` …), and those are `post`ed. */
  async send(msg, { during, transfer, timeout } = {}) {
    this.post(msg, { during, transfer });
    return this.answers(msg, { timeout });
  }

  /** The replies to a request already sent (`msg`, as `post` numbered it),
   *  up to its last, once they have all landed. */
  async answers(msg, { timeout } = {}) {
    if (msg.rid == null) throw new Error(`${msg.type} was not sent through this worker's post`);
    const to = answers(msg.rid);
    const got = [];
    for (;;) {
      const after = got.length ? got[got.length - 1]._n + 1 : 0;
      const r = await this.until(to, { after, timeout });
      got.push(r);
      if (!r.more) return got;
    }
  }

  /** The first reply from `after` on for which `pred` holds, once it lands. */
  until(pred, { after = 0, timeout = ENGINE_MS } = {}) {
    for (let i = after; i < this.replies.length; i++) if (pred(this.replies[i])) return Promise.resolve(this.replies[i]);
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const w = {
        check: () => {
          for (let i = after; i < this.replies.length; i++) {
            if (!pred(this.replies[i])) continue;
            done();
            resolve(this.replies[i]);
            return;
          }
        },
        reject: (err) => {
          done();
          reject(err);
        },
      };
      const timer = setTimeout(() => w.reject(new Error(`no reply in ${timeout} ms for ${pred}`)), timeout);
      const done = () => {
        clearTimeout(timer);
        this.waits.delete(w);
      };
      this.waits.add(w);
    });
  }

  /** The first reply of `type` (from `after` on, matching `where`). */
  reply(type, { where, after = 0, timeout } = {}) {
    return this.until((r) => r.type === type && matches(r, where), { after, timeout });
  }

  /** Every reply of `type` so far (from `after` on, matching `where`). */
  repliesOf(type, { where, after = 0 } = {}) {
    return this.replies.slice(after).filter((r) => r.type === type && matches(r, where));
  }

  /** The thread's timeline so far (see `host`). */
  trace() {
    if (this.failure) return Promise.reject(this.failure);
    const id = ++this.traceSeq;
    return new Promise((resolve, reject) => {
      this.traces.set(id, { resolve, reject });
      this.thread.postMessage({ __harness: { op: "trace", id } });
    });
  }

  /** What the stand-in IndexedDB holds now (`idb`, the form `startWorker`'s
   *  `idb` takes), or null without one. */
  idb() {
    if (this.failure) return Promise.reject(this.failure);
    const id = ++this.traceSeq;
    return new Promise((resolve, reject) => {
      this.traces.set(id, { resolve, reject });
      this.thread.postMessage({ __harness: { op: "idb", id } });
    });
  }

  /** Keep main's answers to `farm_want` back until `releaseFarm`. */
  holdFarm() {
    this.farmHeld = this.farmHeld || [];
  }

  /** Answer every crew wanted while held. */
  releaseFarm() {
    const held = this.farmHeld || [];
    this.farmHeld = null;
    for (const m of held) this.answerCrew(m);
    return held.length;
  }

  answerCrew(m) {
    const ports = this.crew ? this.crew(m) : [];
    this.post({ type: "farm_ports", crew: m.crew, ports }, { transfer: ports });
  }

  /** Boot the engine as main does (`init`), and wait until the pool is full.
   *  `farmPorts` are boot's crew (`fakeCrew`). */
  async boot({ seed = 1, poolSize = 12, playableAt = 8, saved = null, farmPorts = [] } = {}) {
    const after = this.post({ type: "init", seed, poolSize, playableAt, saved, farmPorts }, { transfer: farmPorts });
    const r = await this.until((x) => x.type === "filled" || x.type === "boot_failed", { after });
    if (r.type === "boot_failed") throw new Error(`boot failed: ${r.error}`);
    return r;
  }

  /** End the thread, judging nothing (a test's cleanup). */
  async stop() {
    this.closing = true;
    for (const w of [...this.waits]) w.reject(new Error("closed"));
    await this.thread.terminate();
  }

  /** End the thread. Throws what went wrong in it: an uncaught error, or
   *  anything said on `console.error` (unless started with `errors: true`). */
  async close() {
    await this.stop();
    if (this.failure) throw this.failure;
    const errors = this.console.filter((c) => c.level === "error");
    if (errors.length && !this.allowErrors) {
      throw new Error(`the engine worker said:\n${errors.map((e) => e.text).join("\n")}`);
    }
  }
}

/** A worker thread running apps/web/worker.js, booted as main boots it
 *  (`boot: false` leaves that to the test). `crew(want)` answers a
 *  `farm_want` with ports (`fakeCrew`). `idb` gives the thread a stand-in
 *  IndexedDB: `{}` for an empty one, or what another thread's held
 *  (`w.idb()`), as a later visit finds what an earlier one left. */
export async function startWorker({ boot = true, errors = false, crew, idb = null, ...init } = {}) {
  if (!existsSync(WASM)) throw new Error("apps/web/pkg has no built engine: run `make wasm` first");
  const thread = new Worker(new URL(import.meta.url), { workerData: { auracleWorker: true, idb } });
  const w = new EngineWorker(thread, { errors, crew });
  await w.ready;
  if (boot) await w.boot(init);
  return w;
}

/** `startWorker` for a node:test test `t`: stopped when the test ends,
 *  whatever happened. The test ends with `close()` to judge the thread. */
export async function workerFor(t, options) {
  const w = await startWorker(options);
  t.after(() => w.stop());
  return w;
}

/** `n` farm workers that render nothing: each says `ready` when the engine
 *  worker first speaks to it (its handshake `phrase`), as farm.js does once
 *  its engine is up, keeps every message the engine worker sends it
 *  (`heard[k]`), and answers a render (`job`) as a draw that did not vet,
 *  so the engine renders the work itself. How the renders are shared among
 *  them is the order their answers arrive in, so a test asks what the crew
 *  as a whole heard, never that each worker rendered. `ports` go to the
 *  engine worker.
 *
 *  `ready: false` keeps them quiet until `crew.ready()`, as workers still
 *  starting are on a slow machine; an array says it worker by worker
 *  (`[true, true, false]`), and `crew.ready(k)` readies worker `k` alone.
 *  `render(tree, phrase)` answers a render with what it returns (`{ok,
 *  cached}`, as farm.js's `farm_render` gives), `phrase` the last one the
 *  engine worker handed that worker.
 *
 *  `job(k, job)` decides worker `k`'s answer to a job, for a crew whose
 *  workers do not all behave: `undefined` for the render above, a reply to
 *  send instead (`{type: "cannot", …}`, as farm.js's says when its instance
 *  is broken), or `null` to sit on the job until the test answers it with
 *  `crew.answer(k, reply)`. `answered(k, reply)` hears each answer just
 *  after worker `k` sent it. */
export function fakeCrew(n, { ready = true, render = null, job = null, answered = null } = {}) {
  const heard = [];
  const ports = [];
  const ends = [];
  const readyAtStart = (k) => (Array.isArray(ready) ? !!ready[k] : !!ready);
  const send = (k, reply) => {
    ends[k].postMessage(reply);
    if (answered) answered(k, reply);
  };
  for (let k = 0; k < n; k++) {
    const { port1, port2 } = new MessageChannel();
    const got = [];
    heard.push(got);
    port1.on("message", (m) => {
      got.push(m);
      if (readyAtStart(k) && m.type === "phrase" && got.filter((x) => x.type === "phrase").length === 1) port1.postMessage({ type: "ready", build: V });
      if (m.type !== "job") return;
      const decided = job ? job(k, m) : undefined;
      if (decided === null) return;
      if (decided) return send(k, decided);
      const phrase = got.findLast((x) => x.type === "phrase");
      const r = render && phrase ? render(m.tree, phrase.json) : { ok: false };
      send(k, { type: "done", i: m.i, ok: !!r.ok, ...(r.ok ? { cached: r.cached } : {}) });
    });
    ends.push(port1);
    ports.push(port2);
  }
  return {
    ports,
    heard,
    ready: (k) => (k == null ? ends : [ends[k]]).forEach((p) => p.postMessage({ type: "ready", build: V })),
    answer: send,
    close: () => ends.forEach((p) => p.close()),
  };
}

/** The engine calls between two places in a trace (exclusive), by name. */
export function callsBetween(trace, from, to) {
  return trace.slice(from + 1, to).filter((e) => e.ev === "call").map((e) => e.name);
}

/** Where in a trace a reply was posted. */
export function outOf(trace, reply) {
  return trace.findIndex((e) => e.ev === "out" && e.n === reply._n);
}
