// The worker-protocol level (#178): apps/web/worker.js, unchanged, in a Node
// worker thread over the built engine (apps/web/pkg), with no page.
//
// A browser spec boots the whole app to learn what the engine worker answers
// and in what order. This runs the worker's own file in a `worker_threads`
// thread that gives it what a module Web Worker has and Node does not: `self`
// with `postMessage`, `onmessage` and `location`, the `unhandledrejection`
// event, and a `fetch` that reads the app's own files from disk. Nothing else
// of the browser is here: no IndexedDB (the face store is off, as where a
// browser refuses one), no page, no audio, and no farm.js: main's answer to
// `farm_want` is a crew of no workers, as with `?farm=0`, unless the test
// hands the worker ports of its own (`fakeCrew`, at boot or as a crew) or
// keeps the answer back (`holdFarm`).
//
// The same file is both ends: imported by a test it is the client
// (`startWorker`); run as the thread's entry it hosts the worker.
//
// It adds the engine's own timeline. Every call the worker makes into
// `WasmEngine` is noted in order with the messages it took and posted
// (`trace`), and a request can be posted while a given call runs (`post`'s
// `during`), as one of main's arrives in the middle of a render. The calls
// are wrapped from outside, on the class the glue exports, as the browser
// fixture's `slowEngine` wraps them; worker.js is not touched.
import { Worker, isMainThread, parentPort, workerData, MessageChannel } from "node:worker_threads";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as nodeModule from "node:module";

const WEB = new URL("../../apps/web/", import.meta.url);
const WORKER_URL = new URL("worker.js", WEB).href;
const WASM = new URL("pkg/auracle_wasm_bg.wasm", WEB);
const GLUE = new URL("pkg/auracle_wasm.js", WEB).href;
// The worker's `?v=`, which it imports its glue with: the harness imports the
// same URL, so both hold one module and one `WasmEngine`.
const V = "harness";

/** How long a wait on the engine may take before the test fails: renders on
 *  a loaded runner, never a claim about speed. */
export const ENGINE_MS = 180_000;

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
  // request sent), `out` (a reply, numbered as the client numbers them).
  const trace = [];
  let replies = 0;
  const armed = []; // {call, left, msg, tag}
  const say = (h) => parentPort.postMessage({ __harness: h });

  globalThis.self = globalThis;
  self.location = { href: `${WORKER_URL}?v=${V}` };
  self.postMessage = (msg, transfer) => {
    trace.push({ ev: "out", n: replies++, type: msg && msg.type });
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
  for (const name of Object.getOwnPropertyNames(proto)) {
    const d = Object.getOwnPropertyDescriptor(proto, name);
    if (name === "constructor" || typeof d.value !== "function") continue;
    const fn = d.value;
    proto[name] = function (...args) {
      called(name);
      return fn.apply(this, args);
    };
  }

  // What `during` posts arrives on this channel, between two turns of the
  // thread's event loop, as a message main posts mid-call does.
  const loop = new MessageChannel();
  function called(name) {
    trace.push({ ev: "call", name });
    for (let i = 0; i < armed.length; i++) {
      const a = armed[i];
      if (a.call !== name || --a.left > 0) continue;
      armed.splice(i--, 1);
      trace.push({ ev: "posted", tag: a.tag, type: a.msg.type });
      loop.port1.postMessage(a.msg);
    }
  }

  const deliver = (data) => {
    if (data && data.type === "init" && !data.module) data = { ...data, module };
    trace.push({ ev: "in", type: data && data.type, key: data && (data.req ?? data.token ?? data.id ?? null) });
    self.onmessage({ data });
  };
  loop.port2.on("message", deliver);
  parentPort.on("message", (data) => {
    const h = data && data.__harness;
    if (!h) return deliver(data);
    if (h.op === "during") armed.push({ call: h.call, left: h.nth || 1, msg: h.msg, tag: h.tag });
    if (h.op === "trace") say({ op: "trace", id: h.id, trace });
  });

  // A module with no exports has none; CommonJS would have `default`.
  const loaded = await import(`${WORKER_URL}?v=${V}`);
  if ("default" in loaded) throw new Error("worker.js was loaded as CommonJS, not as the module main.js starts");
  say({ op: "ready" });
}

// ---------- the client ----------

// The replies that answer a request, in order, by type; a reply answers a
// request when it echoes what the request carries (`req`, `token`, `id`,
// `index`) or echoes none of it. `a|b` is either. Until replies name their
// request (see `answers`).
const ANSWERS = {
  edit_begin: ["bench|bench_missing"],
  fit: ["fitted"],
  load_preset: ["preset_loaded"],
  perform_drift: ["perform_drifted"],
  perform_offer: ["perform_offered"],
  perform_record: ["perform_recorded", "status"],
  perform_wire: ["perform_wired"],
  record_duel: ["status"],
  record_keep: ["status"],
  record_stars: ["status"],
  set_audition_clip: ["audition_clip"],
  warm_start: ["warm_done"],
};
const ECHO = ["req", "token", "id", "index"];

const echoes = (msg, r) => ECHO.every((k) => !(k in msg) || !(k in r) || r[k] === msg[k]);
// Every request is answered, if only with the error that it could not run.
const failed = (msg, r) => (r.type === "engine_error" || r.type === "not_ready") && r.request === msg.type && echoes(msg, r);

function matches(r, where) {
  if (!where) return true;
  if (typeof where === "function") return where(r);
  return Object.entries(where).every(([k, v]) => r[k] === v);
}

class EngineWorker {
  constructor(thread, { errors, crew }) {
    this.thread = thread;
    this.crew = crew;
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
      if (h.op === "trace") {
        this.traces.get(h.id).resolve(h.trace);
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

  /** Send `msg` to the worker. With `during: { call, nth }` it is posted when
   *  the `nth` call (1 by default) of the engine's `call` from now begins,
   *  and arrives once that call is over. Returns the count of replies so far,
   *  a mark for `after`. */
  post(msg, { during, transfer } = {}) {
    const at = this.replies.length;
    if (during) {
      const { call, nth = 1, tag = msg.type } = typeof during === "string" ? { call: during } : during;
      this.thread.postMessage({ __harness: { op: "during", call, nth, msg, tag } });
    } else {
      this.thread.postMessage(msg, transfer || []);
    }
    return at;
  }

  /** Send `msg` and wait for the replies that answer it (`ANSWERS`, or
   *  `answers`): an array, in order, ending early with an `engine_error` or
   *  `not_ready` for it. */
  async send(msg, { answers, during, transfer, timeout } = {}) {
    const after = this.post(msg, { during, transfer });
    return this.answers(msg, { after, answers, timeout });
  }

  async answers(msg, { after = 0, answers, timeout } = {}) {
    // TODO(request-ids): once main's `send` stamps `rid` and every reply
    // names its request (`re`, and `more` while more follow), post `rid`
    // here, take the replies with `r.re === rid` up to the first without
    // `more`, and drop `ANSWERS` and `echoes`.
    const want = answers || ANSWERS[msg.type] || [msg.type];
    const got = [];
    let from = after;
    for (const type of want) {
      const types = type.split("|");
      const r = await this.until((x) => failed(msg, x) || (types.includes(x.type) && echoes(msg, x)), { after: from, timeout });
      got.push(r);
      if (failed(msg, r)) break;
      from = r._n + 1;
    }
    return got;
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
 *  `farm_want` with ports (`fakeCrew`). */
export async function startWorker({ boot = true, errors = false, crew, ...init } = {}) {
  if (!existsSync(WASM)) throw new Error("apps/web/pkg has no built engine: run `make wasm` first");
  const thread = new Worker(new URL(import.meta.url), { workerData: { auracleWorker: true } });
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

/** `n` farm workers that render nothing: each says `ready` as farm.js does
 *  once its engine is up, keeps every message the engine worker sends it
 *  (`heard[k]`), and answers a render (`job`) as a draw that did not vet,
 *  so the engine renders the work itself. `ports` go to the engine worker. */
export function fakeCrew(n) {
  const heard = [];
  const ports = [];
  const ends = [];
  for (let k = 0; k < n; k++) {
    const { port1, port2 } = new MessageChannel();
    const got = [];
    heard.push(got);
    port1.on("message", (m) => {
      got.push(m);
      if (m.type === "job") port1.postMessage({ type: "done", i: m.i, ok: false });
    });
    port1.postMessage({ type: "ready", build: V });
    ends.push(port1);
    ports.push(port2);
  }
  return { ports, heard, close: () => ends.forEach((p) => p.close()) };
}

/** The engine calls between two places in a trace (exclusive), by name. */
export function callsBetween(trace, from, to) {
  return trace.slice(from + 1, to).filter((e) => e.ev === "call").map((e) => e.name);
}

/** Where in a trace a reply was posted. */
export function outOf(trace, reply) {
  return trace.findIndex((e) => e.ev === "out" && e.n === reply._n);
}
