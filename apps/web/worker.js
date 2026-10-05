// AURACLE engine worker: owns the wasm engine so rendering and MCMC never
// block the UI thread. Audio buffers cross as transferable Float32Arrays.
// Candidates are addressed by stable id everywhere.
//
// The wasm glue + binary are imported with the version stamp from this
// worker's own URL (?v=...), so a rebuilt engine can never be paired with a
// browser-cached stale module — protocol mismatch between main.js and the
// engine shows up as blank duel scopes and an empty map.

const V = new URL(self.location.href).searchParams.get("v") || Date.now();

let engine = null;
let WasmEngine = null;
let glue = null; // the wasm-bindgen module: its free functions (`farm_walk`)

const post = (msg, transfer) => self.postMessage(msg, transfer || []);

const status = () => JSON.parse(engine.status());

// ---------- the degradation log ----------
//
// Three of this file's messages are not developer errors: a draw that timed
// out and is re-issued, a draw retired after its attempts, and a bank entry the
// farm did not finish that is rendered here instead. All three are the
// *designed* answer to a machine under load — they are what "a dying farm costs
// time and never content" looks like from the inside — and on a busy laptop
// they fire on an ordinary boot.
//
// `console.warn` is the wrong channel for that. It puts a working degradation
// path in the same tray as a genuine fault, which costs twice: the console gate
// this build is held to ("zero errors, zero warnings on a clean boot") goes red
// for something that is fine, and a real warning arrives next to three that are
// noise and is read as noise too.
//
// So they go to the app's own log instead, verbatim, where they are still there
// for anyone asking why a boot was slow — `window.__aurLog` on the main thread,
// the same array the live-audio worklet's messages land in. This worker has no
// `window`, so it posts and main appends.
const logNote = (text, detail) =>
  post({ type: "log", at: Date.now(), text, ...(detail || {}) });

// ---------- long-op signalling ----------
//
// `engine.fit()`, a walk run here (a generation's or ⚡'s, when there is no
// farm to walk it), and PERFORM's offers and drifts on a binary without jobs
// (see `walkRun`) are *synchronous* wasm calls that run for seconds. For their
// whole duration this worker services no messages at all: a `render` asked
// for the instant the user pressed ▶ sits in the queue behind them. (PERFORM's
// offers and drifts are otherwise cut into steps and still announce
// themselves, so "busy" there means "long work is in hand", not "deaf".)
//
// That is a latency problem, not a correctness one — but main can only tell a
// slow render from a lost one by the clock, and on that clock a live render
// looks exactly like a dead one. So say it out loud. A `postMessage` issued
// *before* entering the blocking call is delivered to main immediately (the
// send is not gated on this worker returning to its event loop), which is what
// makes this work at all: main learns "the queue is stopped" while the queue
// is stopped, and stops its own deadline for the duration.
//
// Depth-counted, because the boot path's restore-fit can nest inside a stage
// that already announced itself; main only ever sees the outermost pair.
let longOpDepth = 0;
function beginLongOp() {
  if (longOpDepth++ === 0) post({ type: "busy" });
}
function endLongOp() {
  if (--longOpDepth <= 0) {
    longOpDepth = 0;
    post({ type: "idle" });
  }
}

// One PERFORM reply: `field` carries the answer, or null with `error` set.
// A trap is not answered here: it is rethrown, and `runMessage` answers it
// with the fatal `engine_error` (carrying `req`) that also latches
// `poisoned`, so the page hears that the engine is down before it hears
// anything about this request. Answered here first, it said "try again"
// about a request no engine would ever run again.
function performReply(m, type, field, long, fn) {
  if (long) beginLongOp();
  try {
    post({ type, req: m.req, [field]: fn() });
  } catch (err) {
    const message = String((err && err.message) || err);
    if (isFatal(err, message)) throw err;
    post({ type, req: m.req, [field]: null, error: message });
  } finally {
    if (long) endLongOp();
  }
}

// How many vetted candidates make a bank worth duelling. Below this the
// acquisition function is choosing from too few distinct patches for the
// question to be worth asking; above it, waiting is pure cost — the pool is
// only ever *wider*, never a prerequisite. Overridable per-boot via
// `init.playableAt`.
const PLAYABLE_AT = 8;

// The fill used to be one synchronous `while` loop, so the worker could not
// service a single message for its whole ~24 s duration: a `duel` or `render`
// asked for at second 4 sat in the queue behind the remaining 32 renders.
// Yielding between batches is what makes "playable at 8" real rather than
// cosmetic — it is the mechanism, not a nicety.
//
// `requestIdleCallback` does not exist in Workers in any browser, so this is a
// plain `setTimeout(0)`: one macrotask boundary, which is exactly enough to
// let the queue drain between batches.
const yieldToQueue = () => new Promise((resolve) => setTimeout(resolve, 0));

// Call a nullary engine method that may not exist in the binary a stale
// browser cache handed us (see this file's header). Reports whether it ran, so
// boot can fall back to waiting for the full pool rather than dying.
function tryEngine(name) {
  try {
    engine[name]();
    return true;
  } catch (_) {
    return false;
  }
}

// ---------- the render farm ----------
//
// Boot's cost is ~40 renders, each a pure function of (term, phrase) and each
// hundreds of milliseconds of DSP. They are embarrassingly parallel, so main
// spawns N stateless farm workers and transfers one MessagePort per worker
// *into this worker*; from here on the engine deals directly with them and the
// main thread is out of the data path entirely.
//
// The determinism argument has exactly two moving parts, and neither of them
// is "the reorder buffer got it right":
//
//   1. Draws are **indexed**, not sequential. Draw i is `prior.sample()` under
//      `StdRng::seed_from_u64(splitmix64(fill_seed, i))`, so the term at index
//      i is a pure function of (fill_seed, i). A lost job is re-issued by
//      index with no retained state, and a speculative render past the stop
//      point is simply discarded.
//   2. Results are **absorbed in index order**. The pool at index i is a
//      function of indices < i, so how many renders were in flight — i.e. the
//      farm width, including zero — cannot reach the result.
//
// The native gates `farm_width_does_not_change_the_pool` and
// `farm_absorption_reproduces_the_serial_pool` assert exactly that, on
// (id, tree, raw φ).

// How long a single render may go unanswered before the job is re-issued to
// another worker. Generous: a render is ~0.5 s, but a backgrounded tab
// throttles workers hard and a spurious re-issue costs a whole render.
const JOB_TIMEOUT_MS = 30000;
// Attempts per draw index before the index is retired empty. Retiring is the
// one path that can change pool content versus a clean run, so it is loud.
const MAX_TRIES = 2;
// How long to wait for at least one farm worker to report ready before giving
// up and taking the serial path. Farm boot overlaps the IndexedDB read, so by
// the time we get here they are usually already in.
const FARM_HANDSHAKE_MS = 5000;
// Audition buffers to carry back with the fill. The engine's pool is
// `RenderPolicy::Lazy` — it keeps no audio at admission — but the memo does,
// and the first few patches are precisely the ones the user auditions while
// the rest of the bank lands. Beyond the memo's audio cap this would be
// ~565 KB transferred per patch to be evicted on arrival.
const FARM_AUDIO_AHEAD = 8;

const farm = [];   // {port, ready, alive, job}
// Workers reported lost before this worker had finished initializing and could
// record them. Without this the handshake sits out its whole window waiting on
// ports whose workers are already gone.
const farmPreDead = new Set();

// The farm's handshake: the phrase every render and walk is measured on, and
// the render namespace this worker's binary computes for it (what each farm
// worker checks its own binary against; farm.js, `phrase`).
function farmPhrase() {
  const phrase = engine.phrase_json();
  let ns = null;
  try {
    ns = glue && typeof glue.cache_namespace === "function" ? glue.cache_namespace(phrase) : null;
  } catch (_) {
    ns = null;
  }
  return { phrase, ns };
}

// The phrase carries the session's audition clip, so a capture or a restore
// that installs a saved clip changes it after the crew standing was handed the
// old one. Until a worker has the new one, its render of a sound that listens
// carries the old clip's key, the engine refuses it, and the sound is measured
// serially here instead (Plan-007 task 4). Port messages arrive in order, so a
// job sent after this is rendered with the new clip.
function farmResendPhrase() {
  if (!farm.some((f) => f.alive)) return 0;
  const { phrase, ns } = farmPhrase();
  farmSay({ type: "phrase", json: phrase, ns });
  return farm.filter((f) => f.alive).length;
}

function farmSetup(ports) {
  const { phrase, ns } = farmPhrase();
  for (let k = 0; k < ports.length; k++) {
    const f = { port: ports[k], ready: false, alive: !farmPreDead.has(k), job: null, index: k };
    if (!f.alive) {
      farm.push(f);
      continue;
    }
    f.port.onmessage = (ev) => onFarmMessage(f, ev.data);
    // Posted before the worker has finished initializing; the port buffers it
    // until the far side sets `onmessage`, which is exactly when it can use it.
    f.port.postMessage({ type: "phrase", json: phrase, ns });
    farm.push(f);
  }
}

// Set by whichever fill is running; farm messages are meaningless outside one.
let farmSink = null;

// Take a worker out of service and hand back whatever it was holding.
//
// The distinction this enforces is the one that matters: a *draw* that fails
// to vet is a real outcome and consumes its index; a *worker* that fails is
// not, and its index must go back on the queue untouched. Conflating them
// would let a broken renderer quietly delete candidates from the bank.
function farmDrop(f, reason) {
  if (!f || !f.alive) return;
  f.alive = false;
  console.warn(`[auracle] farm worker ${f.index} out: ${reason || "unknown"}`);
  if (farmSink) farmSink.lost(f);
  guessLost(f);
  walkLost(f);
}

function onFarmMessage(f, m) {
  switch (m.type) {
    case "ready":
      f.ready = true;
      if (farmSink) farmSink.wake();
      walkPump();
      return;
    case "failed":
    case "refused":
      // Never became usable (init failed, or it refused a build it could not
      // vouch for). We simply never issue to it again.
      farmDrop(f, m.reason || m.type);
      return;
    case "cannot":
      // It had the job and could not do it. Not the draw's fault — and not
      // the walk's: a walk it could not run is run by this worker instead.
      if (m.walk) walkCannot(f, m);
      farmDrop(f, m.reason || "declined a job");
      return;
    case "done":
      // A guess's render on a walk crew (`crewRenders`), or a fill's draw.
      if (guessDone(f, m)) return;
      if (farmSink) farmSink.done(f, m);
      return;
    case "walked":
      walkDone(f, m);
      return;
  }
}

function farmLost(index, reason, crew) {
  // A worker of a crew already reaped: nothing of it is in `farm` now.
  if (crew != null && crew !== farmCrew_) return;
  if (!farm[index]) {
    // Died before we were ready to hear about it.
    farmPreDead.add(index);
    return;
  }
  farmDrop(farm[index], reason);
}

function farmUsable() {
  return farm.some((f) => f.alive && f.ready);
}

// How many renderers are actually on the job, for the boot line.
function farmCrew() {
  return farm.filter((f) => f.alive && f.ready).length;
}

// Resolve once at least one farm worker is ready, or the handshake window
// closes. Zero ready ports means today's serial path, verbatim.
function farmHandshake(ms) {
  if (farm.length === 0) return Promise.resolve(false);
  if (farmUsable()) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      farmSink = null;
      resolve(v);
    };
    const timer = setTimeout(() => finish(farmUsable()), ms);
    const wake = () => {
      if (farmUsable()) {
        clearTimeout(timer);
        finish(true);
      } else if (farm.every((f) => !f.alive)) {
        // Every worker declared itself unusable. Don't sit out the window.
        clearTimeout(timer);
        finish(false);
      }
    };
    farmSink = { wake, done: () => {}, lost: wake };
  });
}

function farmSay(msg) {
  for (const f of farm) {
    if (!f.alive) continue;
    try { f.port.postMessage(msg); } catch (_) { /* already gone */ }
  }
}

// Idempotent: boot's `finally` calls it on every exit, abnormal ones included,
// and the happy path has already called it by then. Also how a walk crew is
// reaped (`crewReap`); `crew` tells main which workers to terminate.
let farmClosed = false;
function farmShutdown() {
  if (farmClosed) return;
  farmClosed = true;
  farmSay({ type: "bye" });
  for (const f of farm) f.alive = false;
  farmSink = null;
  post({ type: "farm_done", crew: farmCrew_ });
}

// ---------- the farm on demand ----------
//
// Boot's crew is reaped when boot ends. A generation and ⚡ evolve from this
// are walks, each a pure function of (context, job) (`farm_walk`), so they go
// to a crew of their own, raised when one is wanted: this worker asks main
// (`farm_want`), main spawns the workers from the `WebAssembly.Module` it
// keeps (compiled at boot where boot had a farm, otherwise by the first crew;
// an instantiation per worker after that, not a compile) and hands the ports
// back (`farm_ports`). The crew is reaped after a minute with nothing to do,
// and at once when a stop leaves it walking for nobody. Width is main's call
// (`walkWidth`).
const CREW_SPAWN_MS = 10000;
const CREW_IDLE_MS = 60000;
let farmCrew_ = 0;       // the crew `farm` holds; 0 is boot's
let crewSeq = 0;         // every crew ever asked for gets its own id
let crewWaiting = null;  // {id, resolve} while main spawns a crew
let crewRaising = null;  // the promise of a crew being raised
let crewIdleTimer = null;
let booted = false;      // boot's crew is gone; walk crews may be raised

const crewReady = () => !farmClosed && farmUsable();

/** A crew able to walk: the one standing, or a new one. False when none can
 *  be had (width 0, spawn refused, no worker reported ready in time) — the
 *  caller then walks in this worker. */
function crewUp() {
  crewKeep();
  if (crewReady()) return Promise.resolve(true);
  if (crewRaising) return crewRaising;
  crewRaising = (async () => {
    const id = ++crewSeq;
    const ports = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        crewWaiting = null;
        resolve(null);
      }, CREW_SPAWN_MS);
      crewWaiting = {
        id,
        resolve: (p) => {
          clearTimeout(timer);
          crewWaiting = null;
          resolve(p);
        },
      };
      post({ type: "farm_want", crew: id });
    });
    if (!ports || ports.length === 0) return false;
    // The last crew (boot's, or a reaped one) is gone: start clean.
    farmShutdown();
    farm.length = 0;
    farmPreDead.clear();
    farmCrew_ = id;
    farmClosed = false;
    farmSetup(ports);
    const ok = await farmHandshake(FARM_HANDSHAKE_MS);
    if (!ok) farmShutdown();
    return ok;
  })();
  const p = crewRaising;
  p.finally(() => {
    if (crewRaising === p) crewRaising = null;
  });
  return p;
}

/** Main's answer to `farm_want`. Ports for a crew nobody is waiting on any
 *  more (it answered after the window closed) are closed, and main reaps the
 *  workers behind them. */
function crewArrived(m) {
  if (crewWaiting && crewWaiting.id === m.crew) {
    crewWaiting.resolve(m.ports || []);
    return;
  }
  for (const p of m.ports || []) {
    try { p.postMessage({ type: "bye" }); p.close(); } catch (_) { /* gone */ }
  }
  post({ type: "farm_done", crew: m.crew });
}

function crewKeep() {
  if (crewIdleTimer) clearTimeout(crewIdleTimer);
  crewIdleTimer = null;
}

/** Nothing is walking: reap the crew after `CREW_IDLE_MS`, unless work comes
 *  back first. */
function crewIdle() {
  if (walkBusy() || farmClosed) return;
  crewKeep();
  crewIdleTimer = setTimeout(() => {
    crewIdleTimer = null;
    if (!walkBusy()) crewReap();
  }, CREW_IDLE_MS);
}

/** Reap the crew now. Its walks in flight are for nobody (a stop), and
 *  terminating the workers is what gives their cores back. */
function crewReap() {
  crewKeep();
  for (const s of walkInflight.values()) clearTimeout(s.timer);
  walkInflight.clear();
  farmShutdown();
}

// ---------- walks on the crew ----------
//
// A walk task is `{ctx, job, start(), done(result, ms), fail(reason)}`: the
// context and the job as the exact text the engine gave (the context is the
// same string for every job of a generation, and `farm_walk` keeps its parse
// by that text), and what to do with the result. Tasks are handed out in the
// order they were queued, one per idle worker; the owner (a generation, ⚡)
// decides what order to *absorb* in. A worker that dies gives its task back to
// the queue; a task no worker can run fails, and its owner runs it here.
const WALK_TIMEOUT_MS = 300000;
const walkQueue = [];
const walkInflight = new Map(); // task id -> {task, f, timer}
let walkSeq = 0;
// This session's walk times (ms), newest last: the job slot's estimate.
const walkTimes = [];

const walkBusy = () => walkQueue.length > 0 || [...walkInflight.values()].some((s) => !s.task.dead);

function walkSubmit(task, first) {
  task.id = ++walkSeq;
  if (first) walkQueue.unshift(task);
  else walkQueue.push(task);
  walkPump();
}

function walkPump() {
  if (walkQueue.length === 0) return;
  crewKeep();
  if (!crewReady()) {
    // The crew is gone (every worker died, or it was reaped) and nothing is
    // on its way back: whatever waits is walked here.
    if (!crewRaising && walkInflight.size === 0) {
      for (const task of walkQueue.splice(0)) if (!task.dead) runOwned(task.request, () => task.fail("no farm"));
    }
    return;
  }
  for (const f of farm) {
    if (!walkQueue.length) break;
    if (!f.alive || !f.ready || f.job !== null) continue;
    let task = walkQueue.shift();
    while (task && task.dead) task = walkQueue.shift();
    if (!task) break;
    if (f.ctx !== task.ctx) {
      f.port.postMessage({ type: "walk_context", text: task.ctx });
      f.ctx = task.ctx;
    }
    f.job = task.id;
    const timer = setTimeout(() => walkTimeout(task.id), WALK_TIMEOUT_MS);
    walkInflight.set(task.id, { task, f, timer });
    if (task.start) task.start();
    f.port.postMessage({ type: "walk", i: task.id, job: task.job });
  }
}

function walkSettle(f, i) {
  if (f && f.job === i) f.job = null;
  const s = walkInflight.get(i);
  if (!s) return null;
  clearTimeout(s.timer);
  walkInflight.delete(i);
  return s.task;
}

function walkDone(f, m) {
  const task = walkSettle(f, m.i);
  if (task && !task.dead) {
    if (Number.isFinite(m.ms)) {
      walkTimes.push(m.ms);
      if (walkTimes.length > 30) walkTimes.shift();
    }
    runOwned(task.request, () => task.done(m.result, m.ms));
  }
  walkPump();
  if (!walkBusy()) crewIdle();
}

function walkCannot(f, m) {
  const task = walkSettle(f, m.i);
  if (task && !task.dead) runOwned(task.request, () => task.fail(m.reason || "declined"));
}

// A worker died holding a walk: that says nothing about the walk, so it goes
// back to the front of the queue for whoever is left. Either way the queue is
// pumped: when this was the last worker standing (it died, or declined a walk
// and was dropped), nothing else will ever pump it, and `walkPump` then hands
// every walk still queued to its owner to walk here. Without that a generation
// with walks queued behind a declining worker never finished, and a refit and
// the next EVOLVE POOL waited for it until the player pressed stop.
function walkLost(f) {
  if (f.job !== null && walkInflight.has(f.job)) {
    const task = walkSettle(f, f.job);
    if (task && !task.dead) walkQueue.unshift(task);
  }
  f.job = null;
  walkPump();
}

// A watchdog, not a verdict: the walk may be slow (a throttled tab) or hung.
// Either way its owner runs it here; a late answer from the worker is dropped.
function walkTimeout(i) {
  const s = walkInflight.get(i);
  if (!s) return;
  walkInflight.delete(i);
  logNote(`[auracle] walk ${i} timed out on the farm; walking it here`, { kind: "walk_timeout", i });
  if (!s.task.dead) runOwned(s.task.request, () => s.task.fail("timed out"));
}

/** Drop every task `mine` names: queued ones leave the queue, running ones
 *  are answered to nobody. */
function walkAbandon(mine) {
  for (let k = walkQueue.length - 1; k >= 0; k--) if (mine(walkQueue[k])) walkQueue.splice(k, 1);
  for (const s of walkInflight.values()) if (mine(s.task)) s.task.dead = true;
}

// A task's owner runs inside a farm message, outside `dispatch`, so its
// failures are caught here and reported the way `dispatch` reports them.
function runOwned(request, fn) {
  try {
    fn();
  } catch (err) {
    engineError(request || "refine", null, err);
  }
}

// Drive a wave of off-engine renders to completion.
//
// `take(n)` yields up to n `{i, tree, dup}` jobs (an empty return means
// "nothing issuable *right now*", which is a stop signal only when nothing is
// outstanding). `absorb(i, result)` folds one result in — and is only ever
// called with `i` equal to the next index in order. `stop()` reports whether
// the caller's goal is already met, so speculative work past it is dropped.
function runFarm({ startAt, take, absorb, stop, wantAudio, after }) {
  return new Promise((resolve) => {
    const results = new Map();  // index -> {ok, cached, samples}
    const queue = [];           // issued by `take`, not yet handed to a worker
    const inflight = new Map(); // index -> {tree, tries, timer, worker}
    let cursor = startAt;
    let finished = false;
    // Renders the farm's persistent cache answered without rendering. Counted
    // here rather than in the farm workers because there are N of them and one
    // wave is the unit anybody would want the rate for.
    let served = 0;
    let rendered = 0;

    const finish = () => {
      if (finished) return;
      finished = true;
      for (const s of inflight.values()) clearTimeout(s.timer);
      inflight.clear();
      farmSink = null;
      // One line per wave, in the app's own log rather than the console: a
      // cache that has stopped hitting is the difference between a 2 s boot and
      // a 25 s one, and there is otherwise no way to notice it from outside.
      if (served + rendered > 0) {
        logNote(
          `[auracle] render cache: ${served} served, ${rendered} rendered ` +
            `(${Math.round((100 * served) / (served + rendered))}% hit)`,
          { kind: "render_cache", served, rendered }
        );
      }
      resolve();
    };

    const issue = (f, job) => {
      const state = {
        tree: job.tree,
        tries: (job.tries || 0) + 1,
        worker: f,
        timer: null,
      };
      state.timer = setTimeout(() => onTimeout(job.i), JOB_TIMEOUT_MS);
      inflight.set(job.i, state);
      f.job = job.i;
      f.port.postMessage({
        type: "job",
        i: job.i,
        tree: job.tree,
        wantAudio: !!(wantAudio && wantAudio(job.i)),
      });
    };

    // Put an index back on the queue.
    //
    // `retirable` separates the two reasons a job comes back undone, and the
    // separation is load-bearing. A **worker** failure says nothing about the
    // draw, so it is re-issued forever — if no worker survives to take it, the
    // index is simply left unconsumed and the serial fill picks it up from the
    // engine's own cursor, which is why a dying farm costs time and never
    // content. Only a **watchdog** timeout can eventually retire an index,
    // because only that case might be the draw's own fault (a term that hangs
    // the DSP would otherwise stall the absorb cursor forever).
    const requeue = (i, state, retirable) => {
      clearTimeout(state.timer);
      inflight.delete(i);
      if (state.worker) state.worker.job = null;
      if (retirable && state.tries >= MAX_TRIES) {
        // The one path that can change pool content versus a clean run. Say so
        // — a silently different bank is far worse than a slow one. In the log
        // rather than the console: it is contention, not a fault. The log is
        // the engine's own record (window.__aurLog), never shown to a player.
        logNote(`[auracle] draw ${i} retired after ${state.tries} attempts`, // voice: name
          { kind: "draw_retired", i, tries: state.tries });
        results.set(i, { ok: false });
      } else {
        queue.unshift({ i, tree: state.tree, tries: retirable ? state.tries : state.tries - 1 });
      }
    };

    const onTimeout = (i) => {
      const state = inflight.get(i);
      if (!state || finished) return;
      logNote(`[auracle] draw ${i} timed out; re-issuing`, { kind: "draw_timeout", i });
      requeue(i, state, true);
      pump();
    };

    const pump = () => {
      if (finished) return;
      for (;;) {
        // Absorb everything contiguous. This — and only this — is what makes
        // the pool independent of farm width.
        let absorbed = 0;
        while (results.has(cursor)) {
          const r = results.get(cursor);
          results.delete(cursor);
          absorb(cursor, r);
          cursor++;
          absorbed++;
        }
        if (absorbed && after) after();
        if (stop()) return finish();
        // Every worker died and nothing is outstanding. Hand back what is
        // left; the caller finishes serially. Never hang on a dead farm.
        if (!farmUsable() && inflight.size === 0) return finish();

        const idle = farm.filter((f) => f.alive && f.ready && f.job === null);
        let progressed = absorbed > 0;

        // Top the queue up to roughly two jobs per idle worker so a slow core
        // cannot stall the wave, then issue.
        const want = Math.max(1, idle.length * 2) - queue.length;
        if (want > 0) {
          const got = take(want);
          for (const j of got) {
            if (j.dup) {
              // Already in the pool: no render can change that. Resolve it
              // here rather than burning a worker on it. The engine re-checks
              // at absorb time regardless, so this is pure economy.
              results.set(j.i, { ok: false });
            } else {
              queue.push(j);
            }
            progressed = true;
          }
        }
        for (const f of idle) {
          if (!queue.length) break;
          issue(f, queue.shift());
          progressed = true;
        }

        // Nothing to do, nothing outstanding, nothing left to issue: drained.
        if (!queue.length && inflight.size === 0 && !results.size && !progressed) {
          return finish();
        }
        // Everything issuable is in flight — wait for a message or a timeout.
        if (!progressed) return;
      }
    };

    farmSink = {
      wake: () => pump(),
      done: (f, m) => {
        const state = inflight.get(m.i);
        if (state) {
          clearTimeout(state.timer);
          inflight.delete(m.i);
        }
        if (f.job === m.i) f.job = null;
        // Behind the cursor it is stale — that index has already been folded
        // in, and reintroducing it would mean absorbing out of order.
        if (m.i < cursor) return pump();
        // A re-issued job can land twice (the timed-out original *and* the
        // retry). Both are the same pure function of the same index, so either
        // will do — but a real result always beats a watchdog retirement,
        // which is the one outcome that would change the bank.
        const prev = results.get(m.i);
        if (!prev || (!prev.ok && m.ok)) {
          // Counted where duplicates are already resolved, so a re-issued job
          // is one render in the tally rather than two.
          if (m.hit) served++;
          else rendered++;
          results.set(m.i, m);
        }
        pump();
      },
      lost: (f) => {
        if (f.job !== null && inflight.has(f.job)) {
          const i = f.job;
          const state = inflight.get(i);
          state.worker = null;
          f.job = null;
          requeue(i, state, false);
        }
        pump();
      },
    };
    pump();
  });
}

const EMPTY_F32 = new Float32Array(0);

// Restore a saved session, farming the bank's re-featurization when a farm is
// available.
//
// Restore is the *returning* user's boot and today it is worse than a cold
// one: `import_session` re-featurizes every bank entry in one synchronous call
// behind a bar that cannot move, because nothing lands until all of it does.
// The deferred form does the same work in the same order — the native gate
// `deferred_restore_equals_import_state` pins that — but one entry at a time,
// off-engine, with the bar tracking it.
//
// Both paths ask the engine for a *verdict*, not a count. `import_session`
// answered 0 for a save with nothing in it and for a save this build cannot
// parse, and the app treated both as "nothing to restore" — then autosaved a
// fresh session over a record it had never understood (an older cached build
// opening a newer save, a new enum variant, one corrupt bank tree). The
// `_checked` / `_v2` forms say `unparseable` for the second case, and that
// verdict goes to main as `restore_failed`, which is what stops the write.
// The session's audition clip as the engine reports it, or null from a binary
// too old to say.
function auditionClip() {
  try {
    return JSON.parse(engine.audition_clip());
  } catch (_) {
    return null;
  }
}

// A restore installs the session's saved clip (or the reference, with why),
// so main hears which one after every restore.
function postClip() {
  post({ type: "audition_clip", clip: auditionClip() });
}

function restoreFailed(status) {
  post({ type: "restore_failed", status });
  return 0;
}
function restoreSerial(saved) {
  let verdict = null;
  try {
    verdict = JSON.parse(engine.import_session_checked(saved));
  } catch (err) {
    // A binary without the checked surface (stale cache): the old count, which
    // cannot tell the two cases apart. Better than refusing to boot.
    console.warn("[auracle] checked restore unavailable:", err);
    return engine.import_session(saved);
  }
  if (verdict.status === "unparseable") return restoreFailed(verdict.status);
  postClip();
  return verdict.restored | 0;
}
async function restoreSession(saved, farmed, stages) {
  if (!farmed) return restoreSerial(saved);

  let jobs = null;
  try {
    const verdict = JSON.parse(engine.import_session_deferred_v2(saved));
    if (verdict.status === "unparseable") return restoreFailed(verdict.status);
    jobs = verdict.jobs;
    // The import installed the session's saved clip; the crew was handed the
    // phrase before it. Re-sent before any bank job goes out, so the farm
    // renders the bank's listeners with the clip they were saved with.
    if (auditionClip()?.source === "captured") farmResendPhrase();
  } catch (err) {
    // A binary without the v2 surface (stale cache): the un-verdicted form, and
    // failing that the serial path.
    console.warn("[auracle] verdicted restore unavailable:", err);
    try {
      jobs = JSON.parse(engine.import_session_deferred(saved));
      // As on the v2 path: the import installed the saved clip after the
      // crew's handshake.
      if (auditionClip()?.source === "captured") farmResendPhrase();
    } catch (err2) {
      console.warn("[auracle] deferred restore unavailable:", err2);
      return restoreSerial(saved);
    }
  }
  if (!Array.isArray(jobs) || jobs.length === 0) {
    postClip();
    try { return engine.restore_finish(); } catch (_) { return 0; }
  }

  const trees = jobs.map((j) => JSON.stringify(j.tree));
  let issued = 0;
  let next = 0;    // first bank index the farm has not folded in
  let landed = 0;
  await runFarm({
    startAt: 0,
    take: (n) => {
      const out = [];
      while (out.length < n && issued < jobs.length) {
        out.push({ i: issued, tree: trees[issued] });
        issued++;
      }
      return out;
    },
    absorb: (i, r) => {
      next = i + 1;
      if (r.ok) {
        // `false` from absorb is either a genuine vet failure or a farmed
        // row this engine cannot read — one from an older featurizer
        // (RENDER_EPOCH) that no longer deserializes. The second is not a
        // verdict on the patch, and dropping a bank entry deletes a patch the
        // user kept (the next autosave makes that permanent), so it is
        // rendered here instead. A genuine vet failure fails that too, and
        // the entry is dropped as `import_state` would drop it.
        if (engine.bank_absorb(i, r.cached, r.samples || EMPTY_F32)) landed++;
        else if (engine.bank_render(i)) landed++;
        return;
      }
      // `!ok` on this path is a *watchdog retirement*, not a verdict on the
      // patch — and a retired index here would silently delete a patch the
      // user made and kept, then let the next autosave persist the shortened
      // bank. Render it in this worker instead. It costs one blocking render
      // in a rare case and keeps the bank exactly what `import_state` builds,
      // in exactly its order, which is what `deferred_restore_equals_import_state`
      // pins.
      logNote(`[auracle] bank entry ${i} not farmed; rendering in-worker`,
        { kind: "bank_in_worker", i });
      if (engine.bank_render(i)) landed++;
    },
    stop: () => false,
    wantAudio: (i) => i < FARM_AUDIO_AHEAD,
    after: () =>
      post({
        type: "fill_progress",
        pool: landed,
        target: jobs.length,
        stage: 0,
        stages,
        workers: farmCrew(),
        label: `recalling ${landed} of ${jobs.length} sounds…`,
      }),
  });
  // Whatever the farm did not finish (every worker died, a draw retired) is
  // rendered here, in bank order, so the pool comes back in the order it was
  // saved in whichever path ran.
  for (let i = next; i < jobs.length; i++) {
    if (engine.bank_render(i)) landed++;
  }
  postClip();
  return engine.restore_finish();
}

// ---------- "the bank already has this one" ----------
//
// The engine's own duplicate test is `PatchTree == PatchTree`, which is
// structural and — deliberately — blind to `Uid` (`impl PartialEq for Uid` is
// unconditionally true: identity travels with a node, it does not define it).
// Reproducing that here means comparing the *shape*, not the bytes: two
// serializations of the same tree differ in key order and in whether the uids
// that survived a round trip are printed at all.
//
// So both sides are canonicalized — keys sorted, `uid` dropped, numbers put
// through `JSON.parse` so a hand-formatted file and serde's output agree — and
// compared as strings. Anything this gets wrong falls back to the honest
// "it did not go in" message, which is where it was before.
function canonTree(v) {
  if (Array.isArray(v)) return v.map(canonTree);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) {
      if (k === "uid") continue;
      out[k] = canonTree(v[k]);
    }
    return out;
  }
  return v;
}
function canonJson(s) {
  try {
    return JSON.stringify(canonTree(JSON.parse(s)));
  } catch (_) {
    return null;
  }
}
/** The id of the bank entry that *is* this tree, or 0. */
function bankTwinOf(json) {
  const want = canonJson(json);
  if (want == null) return 0; // unparseable: not a duplicate, a bad file
  for (const row of JSON.parse(engine.ranked())) {
    if (canonJson(engine.tree_json_of(row.id)) === want) return row.id;
  }
  return 0;
}

// Why the last `refine_seed` / `refine_from` returned nothing: one of `idle`,
// `injected`, `no_taste`, `unknown_seed`, `outside_support`, `no_move`,
// `duplicate`, `not_admitted`. `outside_support` is the one worth a sentence
// in the UI — the seed has zero mass under the prior (a knob on its stop, a
// tree deeper than the prior scores), so the walk never started and no budget
// or lock-loosening will change that. Null on a binary too old to say.
function refineReason() {
  try {
    return engine.last_refine_reason();
  } catch (_) {
    return null;
  }
}

// Everything the taste instruments need, in one bundle.
function tasteViews() {
  return {
    map: JSON.parse(engine.taste_map()),
    styles: JSON.parse(engine.styles()),
    lineage: JSON.parse(engine.lineage()),
    ranked: JSON.parse(engine.ranked()),
    // Rides with every views post so the header's `▣ n/m` cannot drift out of
    // step with the engine after a restore, an eviction or a bred generation.
    pinBudget: Array.from(engine.pin_budget()),
    // The ratings as they stand (`engineRatings`): ride with every views post
    // so the seeds and the may-be-replaced marks are current after a refit, a
    // generation or an import, as well as after a pick.
    ratings: engineRatings(),
    // The numbers LEARNING's math states (`modelFacts`): a fit changes
    // how many styles it was allowed.
    facts: modelFacts(),
    // Every pool member's standardized φ (`poolFeatures`): LEARNING shades the
    // map by one coordinate while its weight is pointed at.
    features: poolFeatures(),
    // The standardizer's per-coordinate divisor, keyed by φ name. θ has always
    // shipped in `styles`; this is what θ is *worth* — adding one filter is a
    // raw unit step in `n_filter`, so `θ/scale` is the utility that placement
    // buys. It rides with views rather than with the bench because it is a
    // property of the pool, not of the patch under the pointer, and it changes
    // only when the standardizer is refitted. `{}` before then, and the socket
    // prices stay silent rather than guessing a divisor of 1.
    scale: JSON.parse(engine.phi_scale()),
  };
}

// The edited tree on its own, posted the instant it is real — before anything
// is featurized or rendered.
//
// Every structural edit used to reach the ear only through `postBench`, which
// is to say only after a full offline phrase render: something close to half a
// second of still hearing the patch you no longer have, to buy an audio swap
// that costs the worklet 23 ms. Splitting apply from featurize lets the voices
// be told first and the bench catch up. Vetting therefore becomes *optimistic*
// — main speaks to `LivePoly` now and mutes if the late vet says no — and the
// makeup gain riding along here is still the previous edit's, because measuring
// the new one is the expensive half; main corrects it from the bench reply with
// a bare `setMakeup` rather than a second swap.
//
// `knobs` is the tree's live knobs (a compile, no render): PERFORM keeps a
// taken offer playable on the wiring it had until the offer's own measurement
// lands, and centres that wiring on these values. `why` is echoed — see
// `edit_set_tree`.
function postLiveTree(edited, why, makeup) {
  const json = engine.edit_tree_json();
  let knobs;
  if (typeof engine.perform_knobs === "function") {
    try {
      knobs = JSON.parse(engine.perform_knobs(json));
    } catch (_) {
      knobs = undefined;
    }
  }
  post({
    type: "tree_json",
    edited,
    json,
    makeup: makeup != null ? makeup : engine.edit_makeup(),
    knobs,
    why: why || undefined,
  });
}

// The model's ratings of the pool as they stand (`WasmEngine::belief`):
// every member's posterior mean and std in ranked order, with the lens the map
// colors it by; the parents EVOLVE POOL would refine from if pressed now
// (`seeds`); and the members that generation could replace (`may_replace`,
// cut ones included: the engine does not know about cuts). A pick reweights
// the posterior's draws without a refit, so these numbers move with every
// pick, and every reply to one carries them. "Ratings" here, because `belief`
// in main.js is the bench's guess. In wasm at five lenses it costs under 2 ms
// at rest and about 4 ms while a generation is open with the pool over size
// (`crates/auracle-wasm/examples/pick_belief.mjs`). `null` from a binary
// without the call.
function engineRatings() {
  try {
    return JSON.parse(engine.belief());
  } catch (_) {
    return null;
  }
}

// Every forecast the calibration scores, oldest first
// (`WasmEngine::forecasts`): the model's P(A wins), taken before the answer.
// `null` from a binary without the call.
// The observation count the last `styles` answer was taken at, so requests
// queued behind a burst of picks coalesce. A fit or an import forgets it.
let lastStylesObs = -1;
// The observation count at the last fit: a `styles` request for a pick a fit
// has run after would credit the refit's θ to the pick, so it is answered
// with none (the refit's own θ comes with its views).
let obsAtFit = -1;

function engineForecasts() {
  try {
    return JSON.parse(engine.forecasts());
  } catch (_) {
    return null;
  }
}

// The numbers LEARNING's math states (`WasmEngine::model_facts`): φ's two
// halves, the draws the model holds, its styles and their cap. Posted with
// the calibration and with every views post (a fit changes the styles).
function modelFacts() {
  try {
    return JSON.parse(engine.model_facts());
  } catch (_) {
    return null;
  }
}

// Every pool member's z, in φ's order (`WasmEngine::pool_features`): the
// coordinates θ weighs. Rides every views post; `null` from a binary
// without the call.
function poolFeatures() {
  try {
    return JSON.parse(engine.pool_features());
  } catch (_) {
    return null;
  }
}

// What the model makes of the bench, without a render: a dot product against
// the bench's cached φ under whatever posterior the engine holds now. Rides
// with every refit, or the line above the rack goes on showing the guess from
// before the fit — or "not yet" — until the next knob turn.
function benchBelief() {
  try {
    return { utility: JSON.parse(engine.edit_utility()), explain: JSON.parse(engine.edit_explain()) };
  } catch {
    return null;
  }
}

function postBench(extra) {
  const buf = engine.edit_render();
  const arr = new Float32Array(buf);
  post(
    {
      type: "bench",
      rack: JSON.parse(engine.edit_describe()),
      vetOk: engine.edit_vet_ok(),
      // Failed for being *silent* — nothing reaches the output, as when the
      // only source socket is unplugged — rather than for running away. The
      // two need different words on screen.
      vetSilent: typeof engine.edit_vet_silent === "function" ? engine.edit_vet_silent() : false,
      sampleRate: engine.sample_rate(),
      buffer: arr,
      treeJson: engine.edit_tree_json(),
      makeup: engine.edit_makeup(),
      // What the model makes of the patch that is on the bench *now*. It rides
      // with the bench reply rather than being asked for separately because it
      // is derived from the same featurization that reply already paid for —
      // a dot product against a vector the engine is holding anyway — and
      // because a readout that arrives on its own schedule is a readout that
      // can be a message behind the rack it sits above.
      utility: JSON.parse(engine.edit_utility()),
      explain: JSON.parse(engine.edit_explain()),
      ...extra,
    },
    [arr.buffer]
  );
}

// ---------- the engine failing ----------
//
// Every reply this worker sends is load-bearing: main holds a flag per
// in-flight request (`fitting`, `editInFlight`, the evolve button, …) that only
// the reply clears. So a request that *throws* instead of replying used to
// leave that flag set for the rest of the session — and because `onmessage` is
// async, the throw was an unhandled rejection inside the worker, which does not
// reach `worker.onerror` on the main thread. The UI sat in "thinking" with
// edits deadlocked and no message anywhere saying why.
//
// `dispatch` runs every request under one catch that answers with
// `engine_error` carrying the request's type (and id, when it has one), so
// main can release exactly the state that request was holding.
//
// The message also says whether the engine is *gone*. The wasm build has
// `panic = "abort"`, so a Rust panic is a trap (`WebAssembly.RuntimeError`) that
// unwinds out of a `&mut self` call without clearing wasm-bindgen's borrow
// flag — and every later call fails with "recursive use of an object" instead
// of the real fault. Once that has happened nothing here can be trusted, so
// the worker latches `poisoned` and answers every further request with the
// same fatal `engine_error` rather than calling into the binary again.
let poisoned = null;

function isFatal(err, message) {
  return (
    (typeof WebAssembly !== "undefined" && err instanceof WebAssembly.RuntimeError) ||
    /recursive use of an object|unreachable|memory access out of bounds/i.test(message)
  );
}

// `req`: the request's own number, for the requests that carry one (PERFORM's
// questions, matched to their reply by it), so main can answer the right one
// when this is the only reply it will get (a poisoned engine never runs it).
function engineError(request, id, err, req) {
  const message = poisoned ? `the engine is down (${poisoned})` : String((err && err.message) || err);
  const fatal = !!poisoned || isFatal(err, message);
  if (fatal && !poisoned) poisoned = message;
  console.error(`[auracle] engine error handling ${request}:`, err);
  post({ type: "engine_error", request, id: id == null ? null : id, req: req == null ? null : req, message, fatal });
}

// A rejection nothing awaited. Not a request's own failure — `dispatch`
// catches those — but it is still an error the main thread would otherwise
// never hear about.
self.addEventListener("unhandledrejection", (ev) => {
  const err = ev.reason;
  console.error("[auracle] unhandled rejection in the engine worker:", err);
  post({
    type: "engine_error",
    request: null,
    id: null,
    message: String((err && err.message) || err),
    fatal: isFatal(err, String((err && err.message) || err)),
  });
});

// ---------- faces (Plan-005 task 3) ----------
//
// A face is the render's spectrum in 40 bands and 12 slices
// (`auracle_features::face`), taken inside every featurization, so a pool
// member's or an offer's face is in the engine's memo without a render of its
// own (`WasmEngine::face_of`, `face_of_tree`). That memo is an LRU a
// generation's walks churn, so a face is copied out the first time it is asked
// for and kept here under its render namespace and render key
// (`"<ns>/<key>"`, as `farm_key` names a farm row), and in IndexedDB beside
// the render cache, stamped with the namespace as that cache is: a build
// whose renders differ cannot read another's faces. Whitening against the
// bank is main's (`faces.js`): it knows which rows the bank shows.
//
// `faces` (now lane) answers at once from memory alone, and says what is
// pending. The rest is looked up in `later` (`face_lookup`: the memo, a
// resident audition, the store), and what none of them has (a row stored
// before faces existed, a preset not yet heard) is rendered one per turn in
// the faces lane, below `later` (`face_render`), each answered as it lands,
// or as failed. `face_cancel` drops what is still waiting for a slot that
// left the view, and says so. Every request is answered.
const FACE_DB = "auracle-faces";
const FACE_STORE = "faces";
const FACE_META = "meta";
const FACE_MAX_ROWS = 20000; // ~0.6 KB each; past it the store is dropped, as the render cache is
let faceNs = null;
let faceDb = null;
let faceDbOpening = null;
const faceMem = new Map(); // "<ns>/<key>" -> Uint8Array
const faceRendering = new Set(); // keys with a `face_render` queued

const idb = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

// Never rejects: without IndexedDB a face costs a lookup or a render again
// after a reload, nothing else.
function faceStoreOpen() {
  if (faceDbOpening) return faceDbOpening;
  faceDbOpening = (async () => {
    try {
      if (!self.indexedDB || !faceNs) return null;
      const open = indexedDB.open(FACE_DB, 1);
      open.onupgradeneeded = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains(FACE_STORE)) db.createObjectStore(FACE_STORE);
        if (!db.objectStoreNames.contains(FACE_META)) db.createObjectStore(FACE_META);
      };
      const db = await idb(open);
      const prev = await idb(db.transaction(FACE_META, "readonly").objectStore(FACE_META).get("ns"));
      const count = await idb(db.transaction(FACE_STORE, "readonly").objectStore(FACE_STORE).count());
      if (prev !== faceNs || count > FACE_MAX_ROWS) {
        await idb(db.transaction(FACE_STORE, "readwrite").objectStore(FACE_STORE).clear());
        await idb(db.transaction(FACE_META, "readwrite").objectStore(FACE_META).put(faceNs, "ns"));
      }
      faceDb = db;
      return db;
    } catch (_) {
      return null;
    }
  })();
  return faceDbOpening;
}

async function faceStoreGet(keys) {
  const db = await faceStoreOpen();
  if (!db || !keys.length) return new Map();
  try {
    const store = db.transaction(FACE_STORE, "readonly").objectStore(FACE_STORE);
    const got = await Promise.all(keys.map((k) => idb(store.get(k)).catch(() => null)));
    return new Map(keys.map((k, i) => [k, got[i]]).filter(([, v]) => v instanceof Uint8Array));
  } catch (_) {
    return new Map();
  }
}

function faceKeep(key, bytes) {
  faceMem.set(key, bytes);
  if (!faceDb) return;
  try {
    faceDb.transaction(FACE_STORE, "readwrite").objectStore(FACE_STORE).put(bytes, key);
  } catch (_) { /* a failed write costs a lookup next boot */ }
}

// The key a face is filed under: a pool member's, or a tree's.
function faceKeyOf(q) {
  try {
    if (q.id != null) return engine.face_key(q.id) || null;
    if (q.memo) return faceNs ? `${faceNs}/${q.memo}` : null;
    return glue.farm_key(q.tree, engine.phrase_json()) || null;
  } catch (_) {
    return null;
  }
}

// A face the engine can give without a render, or null. A call that throws
// is a face not had, unless it poisoned the engine.
function faceNow(q, render = false) {
  try {
    const b = q.id != null ? engine.face_of(q.id, render) : q.memo ? engine.face_of_key(q.memo) : engine.face_of_tree(q.tree, render);
    return b && b.length ? new Uint8Array(b) : null;
  } catch (err) {
    if (isFatal(err, String((err && err.message) || err))) throw err;
    return null;
  }
}

// `m.ids`: pool members; `m.trees`: [{ref, tree, seen?}] (a preset, an
// offer, the bench). `m.render`: render what has no face yet, in `later`.
// `seen`: a face the player is looking at and waiting on (PATCH's outline of
// the patch without the selected module): its render goes to the front of the
// faces lane and ahead of a measurement nobody is waiting on (`nextLong`).
async function faces(m) {
  const asks = [
    ...(m.ids || []).map((id) => ({ id })),
    ...(m.trees || []).map((t) => ({
      ref: t.ref,
      // A memo row by its render key (a guess's candidate, rendered for it).
      memo: t.memo || null,
      // A preset by its index: its tree, without inserting it.
      tree: t.memo ? null : t.preset != null ? engine.preset_tree_json(t.preset) : t.tree,
      ...(t.seen ? { seen: true } : {}),
    })),
  ];
  const items = [];
  const failed = [];
  const waiting = [];
  for (const q of asks) {
    q.key = faceKeyOf(q);
    if (!q.key) failed.push(faceTag(q));
    else if (faceMem.has(q.key)) items.push({ ...faceTag(q), key: q.key, face: faceMem.get(q.key) });
    else waiting.push(q);
  }
  // The rest from the memo, a resident audition or the store, in `later`:
  // a lookup there can wait on IndexedDB or take a face's analysis.
  if (waiting.length) {
    lanes[LATER].push({ type: "face_lookup", asks: waiting, render: !!m.render });
    schedulePump();
  }
  post({ type: "faces", items, pending: waiting.map(faceTag), failed });
}

const faceTag = (q) => (q.id != null ? { id: q.id } : { ref: q.ref });

// What `faces` could not answer from memory (`later`): the memo, a resident
// audition, the store; what none of them has is rendered in the faces lane,
// below everything else, or said to be missing.
async function faceLookup(m) {
  const items = [];
  const failed = [];
  const stored = [];
  for (const q of m.asks) {
    const known = faceMem.get(q.key) || faceNow(q);
    if (known) {
      if (!faceMem.has(q.key)) faceKeep(q.key, known);
      items.push({ ...faceTag(q), key: q.key, face: known });
    } else stored.push(q);
  }
  const fromStore = await faceStoreGet(stored.map((q) => q.key));
  for (const q of stored) {
    const b = fromStore.get(q.key);
    if (b) {
      faceMem.set(q.key, b);
      items.push({ ...faceTag(q), key: q.key, face: b });
    } else if (m.render) {
      if (!faceRendering.has(q.key)) {
        faceRendering.add(q.key);
        const job = { type: "face_render", ...q };
        if (q.seen) lanes[FACES].unshift(job);
        else lanes[FACES].push(job);
        schedulePump();
      } else if (q.seen) {
        // Already waiting for a slot, and now looked at: to the front.
        const i = lanes[FACES].findIndex((j) => j.type === "face_render" && j.key === q.key);
        if (i > 0) lanes[FACES].unshift({ ...lanes[FACES].splice(i, 1)[0], seen: true, ref: q.ref });
        else if (i === 0) lanes[FACES][0].seen = true;
      }
    } else if (!m.quiet) {
      failed.push({ ...faceTag(q), missing: true });
    }
  }
  if (items.length || failed.length) post({ type: "faces", items, pending: [], failed });
}

// A face asked for and no longer in view (a preset row scrolled past): its
// render, or its lookup, if still waiting, is dropped, and said to be.
function faceCancel(m) {
  const gone = new Set([...(m.ids || []).map((id) => `i${id}`), ...(m.refs || [])]);
  const named = (q) => gone.has(q.id != null ? `i${q.id}` : q.ref);
  const cancelled = [];
  for (let i = lanes[FACES].length - 1; i >= 0; i--) {
    const q = lanes[FACES][i];
    if (q.type !== "face_render" || !named(q)) continue;
    lanes[FACES].splice(i, 1);
    faceRendering.delete(q.key);
    cancelled.push(faceTag(q));
  }
  for (const job of lanes[LATER].filter((q) => q.type === "face_lookup")) {
    const keep = job.asks.filter((q) => !named(q));
    for (const q of job.asks) if (named(q)) cancelled.push(faceTag(q));
    job.asks = keep;
  }
  post({ type: "faces", items: [], pending: [], failed: [], cancelled });
}

// One render for a face nothing else had (the faces lane).
function faceRender(q) {
  faceRendering.delete(q.key);
  let b = faceMem.get(q.key) || null;
  if (!b) {
    try {
      b = faceNow(q, true);
    } catch (err) {
      post({ type: "faces", items: [], pending: [], failed: [q.id != null ? { id: q.id } : { ref: q.ref }] });
      throw err; // fatal: the engine is down, and says so once
    }
    if (b) faceKeep(q.key, b);
  }
  const tag = q.id != null ? { id: q.id } : { ref: q.ref };
  post(b ? { type: "faces", items: [{ ...tag, key: q.key, face: b }], pending: [], failed: [] } : { type: "faces", items: [], pending: [], failed: [tag] });
}

// After a render reaches main: its face, if main has not been sent it, looked
// up in `later` (the analysis of an audition takes milliseconds). The buffer
// is posted first, and no face work is done in the render's turn.
function faceAfterRender(id) {
  try {
    const key = engine.face_key(id);
    if (!key || faceMem.has(key) || faceRendering.has(key)) return;
    lanes[LATER].push({ type: "face_lookup", asks: [{ id, key }], render: false, quiet: true });
    schedulePump();
  } catch (_) { /* a face is a picture: its failure is not the render's */ }
}

// ---------- PERFORM's measurement, in pieces ----------
//
// Wiring the named controls is thirty-odd phrase renders (a Jacobian, then
// four points per reachable control), and it was one synchronous call: 14 s
// on a busy laptop during which this thread answered nothing — not the ▶ of
// the patch being measured, not a bench open, not a save. The engine now
// answers "which renders does this measurement still owe?" without rendering
// (`perform_wire_plan`, over `Engine::wire_plan`), so the renders are made
// here one per turn with the player's requests answered between them, and the
// measurement is finished from the memo — the same numbers, pinned natively by
// `a_planned_measurement_is_the_measurement`.
//
// A measurement nobody is waiting on (a re-check, a pre-warm, one demoted by
// `retire`) gives way to long work the player asks for and to anything else
// waiting in `later` (`idleOnly`), and loses nothing by it: every render it made
// is in the memo, so it resumes where it stopped. What it has learned about
// renders that do not vet rides on the message, because the memo keeps only
// successes and would otherwise ask for those again.
//
// `m.controls`, when given, is which palette controls to wire (indices into
// `perform::PALETTE`, whose first six are today's panel); without it the
// engine wires the six, as it always has. The page sends none yet.
async function measure(m) {
  const ov = JSON.stringify(m.overrides || []);
  const ctl = Array.isArray(m.controls) ? JSON.stringify(m.controls) : undefined;
  if (typeof engine.perform_wire_plan !== "function") {
    // A binary without the plan (see this file's header): the one call.
    performReply(m, "perform_wired", "data", true, () => JSON.parse(engine.perform_wire(m.tree, ov, ctl)));
    return;
  }
  const failed = m.failed || (m.failed = []);
  try {
    // A measurement is at most three rounds (see `Engine::wire_plan`); the cap
    // only guards against a memo evicting under it, in which case the finish
    // below renders whatever is missing itself.
    for (let round = 0; round < 6; round++) {
      const need = JSON.parse(engine.perform_wire_plan(m.tree, ov, JSON.stringify(failed), ctl));
      if (!need.length) break;
      for (const job of need) {
        if (!engine.memo_render(job.tree)) failed.push(job.key);
        // Nobody waiting on it (`idleOnly`): it also gives way to anything
        // else in `later` (a cable probe, a guess, a face lookup, a refit),
        // and to a face the player is looking at (`seenFaceWaiting`).
        // With Wander on, the drifts go first, one each time; PERFORM coming
        // back into sight (`promote`) makes a demoted one the player's again.
        if ((await breathe(laneOf(m))) || (idleOnly(m) && (laterWaiting() || seenFaceWaiting(lanes)))) {
          lanes[LATER].unshift(m);
          return;
        }
      }
    }
  } catch (err) {
    // Answered, as every PERFORM request is (see `performReply`): the page
    // holds the request open until its reply lands. A trap is answered by
    // `runMessage`'s fatal `engine_error` instead, as in `performReply`.
    const message = String((err && err.message) || err);
    if (isFatal(err, message)) throw err;
    post({ type: "perform_wired", req: m.req, data: null, error: message });
    return;
  }
  performReply(m, "perform_wired", "data", false, () =>
    JSON.parse(engine.perform_wire_known(m.tree, ov, JSON.stringify(failed), ctl)));
}

// ---------- PERFORM's walks, in pieces ----------
//
// An offer is a walk of twenty steps (forty in Roam, up to four times that
// with locks, and an aimed one may walk up to three times), each step a phrase
// render, and it was one synchronous call: about 18 renders for the Offer
// button's, 25 for a search control's. A pick (`perform_record`, in `now`)
// asked for while a *spare* was growing in the background waited for all of
// them. On a CI runner that was 62 s for the first spare, and a keep, a pick
// and a re-centre all stood behind it. Wander's drift (12 renders) did the
// same.
//
// The engine now begins an offer or a drift as a job (`perform_offer_begin`,
// `perform_drift_begin`) that this thread advances one step (one proposal: at
// most one render) at a time
// (`perform_job_step`), answering the player between steps (`breathe`) as
// `measure` does between renders. It holds the floor, so two do not take twice
// as long each. A spare nobody is waiting for (`later`) gives the floor up the
// moment long work the player asked for is waiting, and goes back to the front
// of its lane with its job intact. A walk whose patch was left behind
// (`retire`) is dropped at its next step instead of finishing for nothing.
//
// The result is the offer the one call gives. The job draws from its own
// stream, seeded when it begins, and reads the target as it stood then, so the
// player's answer in between, or another walk, cannot change what it finds
// (natively `a_stepped_walk_is_the_walk`; in the bindings
// `a_stepped_offer_gives_the_reply_the_one_call_gives`).
async function walkRun(m) {
  const drift = m.type === "perform_drift";
  const [type, field] = drift ? ["perform_drifted", "drift"] : ["perform_offered", "offer"];
  const ov = JSON.stringify(m.overrides || []);
  const locks = JSON.stringify(m.locks || []);
  const control = Number.isInteger(m.control) ? m.control : undefined;
  const sign = Number.isFinite(m.sign) ? m.sign : undefined;
  if (typeof engine.perform_job_step !== "function") {
    // A binary without the jobs (see this file's header): the one call.
    performReply(m, type, field, true, () =>
      JSON.parse(
        drift
          ? engine.perform_drift(m.tree, ov, locks, m.steps || 12, m.sigma || 0.05)
          : engine.perform_offer(m.tree, ov, locks, m.steps || 40, control, sign),
      ));
    return;
  }
  const retired = () => {
    if (m.job != null) engine.perform_job_drop(m.job);
    m.job = null;
    post({ type, req: m.req, [field]: null, error: "retired" });
  };
  beginLongOp();
  try {
    if (m.retired) return retired();
    if (m.job == null) {
      const begun = JSON.parse(
        drift
          ? engine.perform_drift_begin(m.tree, ov, locks, m.steps || 12, m.sigma || 0.05)
          : engine.perform_offer_begin(m.tree, ov, locks, m.steps || 40, control, sign),
      );
      // A walk that cannot start answers as the one call would: `{reason}`,
      // or null for a tree that does not parse.
      if (!begun || begun.job == null) {
        post({ type, req: m.req, [field]: begun });
        return;
      }
      m.job = begun.job;
    }
    while (engine.perform_job_step(m.job, 1)) {
      const yields = await breathe(laneOf(m));
      if (m.retired) return retired();
      if (yields) {
        // Paused where it stands: the job keeps its place in the engine, and
        // this request goes back to the front of its lane.
        lanes[LATER].unshift(m);
        return;
      }
    }
    const job = m.job;
    m.job = null;
    post({ type, req: m.req, [field]: JSON.parse(engine.perform_job_finish(job)) });
  } catch (err) {
    const message = String((err && err.message) || err);
    // A trap: the engine is not called again (its job goes with it), and
    // the request is answered by `runMessage`'s fatal `engine_error`, as in
    // `performReply`.
    if (isFatal(err, message)) {
      m.job = null;
      throw err;
    }
    try {
      if (m.job != null) engine.perform_job_drop(m.job);
    } catch (_) {
      /* reported by the next request that reaches the engine */
    }
    m.job = null;
    post({ type, req: m.req, [field]: null, error: message });
  } finally {
    endLongOp();
  }
}

// ---------- the model's guess (Plan-005 task 9d) ----------
//
// The module the model guesses the player would add next to the patch in
// hand, ranked by the lower bound of its gain. The engine plans the renders
// (`guess_plan`: the patch first if it is unmeasured, then the output's
// candidates in the order a crew that stops early should render them) and
// ranks what the memo holds (`guess_rank`); it renders nothing itself.
//
// On a crew (`guessOnCrew`), it asks for every candidate (`limit` 0) and
// hands them out, one `farm_render` per idle worker (the farm's `job`), and
// absorbs each result as it lands (`memo_absorb`, checked against this
// engine's stimulus), for at most `GUESS_BUDGET_MS` of wall-clock time once
// the crew is up; it renders nothing here, so the player is answered
// throughout. A refusal from the plan raises no crew. With no crew (width
// 0, boot's crew still filling the pool, a spawn that failed), or for what a
// crew left unrendered, it renders the first `GUESS_FLOOR` candidates here,
// one per turn with the player answered between them, as PERFORM's
// measurement does, and stops rendering once `GUESS_BUDGET_MS` of rendering
// is spent, ranking what it has (`rendered` of `planned` says how much). The
// budget counts render time only, checked after each render, so it can run
// over by one render. A `later` job: it gives way to work the player asks for
// and resumes where it stopped, since every render it made is in the memo. The
// crew phase does not hold the floor (it renders nothing on this thread, and
// waiting for a crew is not work); only the floor's renders do.
// The reply echoes `token` and carries the tree it ranked, so a page that has
// moved on drops it.
const GUESS_FLOOR = 8;
const GUESS_BUDGET_MS = 3000;

// The guess's renders out on the crew, by job id: {job, f, resolve}. Ids are
// their own sequence; the farm echoes `i` in `done`, which no fill is
// listening for while a walk crew stands.
const guessInflight = new Map();
// The crew phases of the guesses asked for, one at a time and in order.
let guessCrewTail = Promise.resolve();
let guessSeq = 0;
const guessBusy = () => guessInflight.size > 0;

/** A crew worker answered a guess render (`done`), or gave its job back. */
function guessDone(f, m) {
  const s = guessInflight.get(m.i);
  if (!s) return false;
  guessInflight.delete(m.i);
  if (f && f.job === `g${m.i}`) f.job = null;
  s.resolve(m.ok ? { ok: true, cached: m.cached } : { ok: false });
  return true;
}

/** A worker holding a guess render was lost: its job comes back unrendered
 *  (not failed: the render did not fail, the worker did). */
function guessLost(f) {
  for (const [i, s] of guessInflight) {
    if (s.f !== f) continue;
    guessInflight.delete(i);
    s.resolve(null);
  }
}

/** Render `jobs` on the crew, as many at once as there are idle workers, for
 *  at most `ms`. Resolves to the results that landed, by job (`{ok, cached}`;
 *  null for one a lost worker gave back). Jobs still out when the time is up
 *  are abandoned: their answers find nobody. */
function crewRenders(jobs, ms) {
  return new Promise((resolve) => {
    const out = new Map();
    const queue = [...jobs];
    const ids = new Set();
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      for (const i of ids) {
        const s = guessInflight.get(i);
        if (!s) continue;
        guessInflight.delete(i);
        if (s.f && s.f.job === `g${i}`) s.f.job = null;
      }
      walkPump();
      resolve(out);
    };
    const timer = setTimeout(finish, Math.max(0, ms));
    const hand = () => {
      if (finished) return;
      for (const f of farm) {
        if (!queue.length) break;
        if (!f.alive || !f.ready || f.job !== null) continue;
        const job = queue.shift();
        const i = ++guessSeq;
        ids.add(i);
        f.job = `g${i}`;
        guessInflight.set(i, {
          f,
          resolve: (r) => {
            ids.delete(i);
            out.set(job, r);
            hand();
            if (out.size === jobs.length || (!queue.length && ids.size === 0) || !crewReady()) finish();
          },
        });
        f.port.postMessage({ type: "job", i, tree: job.tree, wantAudio: false });
      }
      if (!crewReady() || (queue.length && ids.size === 0 && !farm.some((f) => f.alive && f.ready))) finish();
    };
    hand();
  });
}

/** The guess's renders on a crew (raised for it, as a generation raises
 *  one): every candidate, absorbed as it lands, within the budget. Returns
 *  the plan's refusal if it has one, else null once rendering is over (all
 *  absorbed, or the budget spent); what is left unrendered the serial floor
 *  below picks up. False when no crew can be had: the floor does it all. */
async function guessOnCrew(at, failed) {
  // The plan first: a refusal (no fit yet, the grammar's ceiling) or a guess
  // the memo already holds needs no crew, and raising one would spawn
  // workers on every settle before the warm start.
  const first = JSON.parse(engine.guess_plan(at, JSON.stringify(failed), 0));
  if (first.reason) return first;
  if (!first.jobs.length) return null;
  if (!booted || bootCrewLive() || walking()) return false;
  if (!(await crewUp())) return false;
  // The budget starts once the crew is up: a cold crew's spawn is not
  // rendering.
  const t0 = performance.now();
  try {
    for (let round = 0; round < 6; round++) {
      const plan = JSON.parse(engine.guess_plan(at, JSON.stringify(failed), 0));
      if (plan.reason) return plan;
      if (!plan.jobs.length) return null;
      const left = GUESS_BUDGET_MS - (performance.now() - t0);
      if (left <= 0 || !crewReady()) return null;
      const results = await crewRenders(plan.jobs, left);
      let absorbed = 0;
      for (const [job, r] of results) {
        if (!r) continue;
        if (!r.ok) failed.push(job.key);
        // A row this engine refuses (another stimulus) costs a render below,
        // never a wrong φ; it is not a vet failure.
        else if (engine.memo_absorb(job.tree, r.cached)) absorbed += 1;
      }
      if (results.size < plan.jobs.length || absorbed === 0) return null;
    }
    return null;
  } finally {
    crewIdle();
  }
}

/** A guess's crew phase: every candidate on a crew, once per request (a
 *  resumed run goes on from the memo). It holds the guess's floor (no other
 *  long job starts meanwhile) but renders nothing here, so the player is
 *  answered while the crew renders. True when it answered (a refusal from
 *  the plan, or an error). */
async function guessCrewPhase(m) {
  if (m.crewed) return false;
  m.crewed = true;
  const at = m.at || undefined;
  const failed = m.failed || (m.failed = []);
  try {
    const crew = await guessOnCrew(at, failed);
    if (crew && crew.reason) {
      post({ type: "guess", token: m.token ?? null, tree: engine.edit_tree_json(), data: crew });
      return true;
    }
    if (crew === null) m.crew = true;
    return false;
  } catch (err) {
    const message = String((err && err.message) || err);
    post({ type: "guess", token: m.token ?? null, data: null, error: message });
    if (isFatal(err, message)) throw err;
    return true;
  }
}

async function guessRun(m) {
  const at = m.at || undefined;
  const failed = m.failed || (m.failed = []);
  const reply = (data) => post({ type: "guess", token: m.token ?? null, tree: engine.edit_tree_json(), data });
  m.spent = m.spent || 0;
  try {
    // After a crew (`guessCrewPhase`) the ranking covers every candidate it
    // rendered; with none, the floor's.
    const limit = m.crew ? 0 : GUESS_FLOOR;
    // The floor: the first `GUESS_FLOOR` in order, here. After a crew these
    // are usually in the memo already (they went out first), so this renders
    // only what the crew could not (a row from another stimulus, a lost
    // worker), and it is the whole of the work with no crew.
    for (let round = 0; round < 6 && m.spent < GUESS_BUDGET_MS; round++) {
      const plan = JSON.parse(engine.guess_plan(at, JSON.stringify(failed), GUESS_FLOOR));
      if (plan.reason) {
        reply(plan);
        return;
      }
      if (!plan.jobs.length) break;
      for (const job of plan.jobs) {
        const t = performance.now();
        if (!engine.memo_render(job.tree)) failed.push(job.key);
        m.spent += performance.now() - t;
        if (await breathe(laneOf(m))) {
          lanes[LATER].unshift(m);
          return;
        }
        if (m.spent >= GUESS_BUDGET_MS) break;
      }
    }
    reply(JSON.parse(engine.guess_rank(at, JSON.stringify(failed), limit)));
  } catch (err) {
    // Answered, as `measure` answers: the page holds a guess open until its
    // reply lands. A trap still poisons the engine, through `dispatch`.
    const message = String((err && err.message) || err);
    post({ type: "guess", token: m.token ?? null, data: null, error: message });
    if (isFatal(err, message)) throw err;
  }
}

// ---------- a generation: the breed job ----------
//
// EVOLVE POOL is ten walks (`refine_seeds`), each a pure function of the
// generation's shared context and its own job, so they are walked on the
// farm, in parallel, and folded back here **in job order** with
// `refine_absorb` — the order the serial path absorbs in, which is what makes
// the pool the same whichever worker finished first (ADR-007; natively
// `farm_walks_breed_the_serial_generation`). A result that lands early is
// held until its turn.
//
// It does not hold the floor. It used to: a generation was ten walks run
// here, one per turn, and for its two to three minutes PERFORM's measurement
// of a newly opened patch, a pressed Offer, spares, drifts and refits all
// waited for the whole of it, and a pick's next pair waited for the walk in
// progress (up to about 20 s). Now this worker only absorbs, one child per
// turn, and every lane is served in between. Only two things still wait for
// the generation to finish: a refit (it is bred under the posterior it
// started under, whatever votes land meanwhile) and another generation.
//
// Each child is posted as it lands (`refine_child`, with the ranked rows, so
// the bank shows it at once), and the progress carries an estimate from this
// session's own walk times. **Stop** (`refine_stop`) keeps what has been
// absorbed: `refine_finish` retires the lowest members not kept (saved, or
// kept as new and not yet in a pick) to bring the pool back to size, and walks
// still running are for nobody.
//
// With no farm (width 0, a crew that never came up, every worker lost, a walk
// a worker could not run) the job is walked here with `refine_seed`, which
// runs the engine's own copy of the same job: the same child, one walk per
// turn as a `soon` piece, so the player is still answered between walks.
const SERIAL = Symbol("serial");
let gen = null;

function refineRetiring() {
  try {
    return JSON.parse(engine.refine_retiring());
  } catch (_) {
    return [];
  }
}

/** What the open generation's end will replace now, for a reply that can
 *  change it (a save, a preset or a kept edit joining the pool: each moves
 *  the pool's lowest members not kept); undefined with none open, so main
 *  keeps its own. */
function openRetiring() {
  return gen ? refineRetiring() : undefined;
}

/** Milliseconds this generation still owes, from this session's walk times,
 *  or null before any walk has finished. */
function genEta(g) {
  if (walkTimes.length === 0) return null;
  const mean = walkTimes.reduce((a, b) => a + b, 0) / walkTimes.length;
  const width = g.farmed ? Math.max(1, farm.filter((f) => f.alive && f.ready).length) : 1;
  const now = performance.now();
  let owed = 0;
  for (let i = g.next; i < g.total; i++) {
    const r = g.results.get(i);
    if (r !== undefined && r !== SERIAL) continue; // walked, waiting its turn
    const at = g.started.get(i);
    owed += at != null ? Math.max(0, mean - (now - at)) : mean;
  }
  return Math.round(owed / width);
}

function genProgress(g) {
  post({
    type: "refine_progress",
    generation: g.generation,
    done: g.next,
    total: g.total,
    walked: g.walked,
    eta: genEta(g),
    farm: g.farmed,
    workers: g.farmed ? farmCrew() : 0,
    // The generation's seeds, best first (`refine_jobs`' parents: job `i`
    // walks from `seeds[i]`), so main marks this generation's and not the
    // next one's, whatever ratings it last heard.
    seeds: g.parents,
  });
}

// Open a generation. Called from `dispatch`, and returns as soon as the jobs
// are out: the generation runs from farm messages and `soon` pieces.
// `toward`: bred toward the sound of your own (`refine_toward_jobs`): its
// context carries the target, so every walk, farmed or here, is tilted to
// it, and it is absorbed and finished as any generation is.
function breedOpen(toward = false) {
  let parents;
  let ctx = null;
  let jobs = null;
  // A session saved while a generation ran comes back over size, and opening
  // a generation trims it first. Done here, on its own, so the rows it
  // retires leave main's bank now and are named, rather than going silently
  // inside `refine_jobs` and staying live in main until the first child.
  poolTrim();
  let towardReason = null;
  if (toward) {
    const reply = typeof engine.refine_toward_jobs === "function"
      ? JSON.parse(engine.refine_toward_jobs())
      : { context: null, jobs: [] };
    towardReason = reply.reason || null;
    if (reply.context) {
      ctx = JSON.stringify(reply.context);
      jobs = reply.jobs.map((j) => JSON.stringify(j));
    }
    parents = reply.jobs.map((j) => j.parent_id);
  } else if (typeof engine.refine_jobs === "function") {
    const reply = JSON.parse(engine.refine_jobs());
    if (reply.context) {
      // Stringified once: every worker gets this very string.
      ctx = JSON.stringify(reply.context);
      jobs = reply.jobs.map((j) => JSON.stringify(j));
    }
    parents = reply.jobs.map((j) => j.parent_id);
  } else {
    parents = JSON.parse(engine.refine_begin()); // older engine: walked here only
  }
  if (parents.length === 0) {
    // No posterior yet — nothing to refine *toward*. Report it rather than
    // burning a minute to produce nothing. A breed toward a sound of your own
    // says which of its reasons it is (`Engine::own_breed_blocked`): no
    // taste yet (`untaught`), no sound (`no_sound`), or a sound saved under
    // coordinates φ no longer has (`stale_sound`: bring the file again).
    const reason = toward ? towardReason || "untaught" : "untaught";
    post({
      type: "refined", views: tasteViews(), status: status(), born: [],
      untaught: reason === "untaught",
      ...(toward ? { toward: true, reason, no_sound: reason === "no_sound", stale_sound: reason === "stale_sound" } : {}),
    });
    return;
  }
  const g = {
    generation: status().generation,
    parents,
    ctx,
    jobs,
    total: parents.length,
    next: 0,
    walked: 0,
    results: new Map(),
    started: new Map(),
    born: [],
    reasons: [],
    farmed: false,
    stopped: false,
    turn: false,
    serialQueued: false,
  };
  gen = g;
  genProgress(g);
  breedFarm(g).catch((err) => {
    engineError("refine", null, err);
    if (gen === g) genDrop(g);
  });
}

// Bring the pool back to size (`refine_finish` with no generation open) and
// tell main what left, with the views that no longer hold it.
function poolTrim() {
  let gone = [];
  try {
    gone = JSON.parse(engine.refine_finish());
  } catch (_) {
    gone = [];
  }
  if (gone.length) post({ type: "pool_trimmed", retired: gone, views: tasteViews(), status: status() });
}

// Every preset's measurement, for the presets nearest a sound of your own:
// the wirings the app ships (`perform-wirings.json`, `make perform-wirings`)
// carry each preset's audio φ, so the engine names the nearest presets
// without rendering sixty of them. Fetched once, from the first own-sound
// request, and **never awaited by one**: a request answered while the fetch
// is out names only pool members, and when the file lands the sound in hand
// (if any) is posted again, re-ranked. Awaiting it inside `dispatch` let
// requests behind it (a clear, a breed) overtake the set that started it.
// With no file (an old bundle, a blocked fetch) only pool members are named.
let ownPresets = false;
function ownPresetsFetch() {
  if (ownPresets || typeof engine.own_presets_set !== "function") return;
  ownPresets = true;
  fetch(new URL(`./perform-wirings.json?v=${V}`, self.location.href))
    .then((r) => (r.ok ? r.text() : null))
    .then((text) => {
      if (!text || poisoned) return;
      try {
        engine.own_presets_set(text);
        const sound = JSON.parse(engine.own_sound());
        if (sound) post({ type: "own_sound", sound, presets: true });
      } catch (err) {
        engineError("own_sound", null, err);
      }
    })
    .catch(() => {
      /* the nearest presets are a convenience, never load-bearing */
    });
}

async function breedFarm(g) {
  const farmed = jobsOk(g) && (await crewUp());
  if (gen !== g || g.stopped) {
    // Stopped while the crew came up: it has nothing to walk, so it starts
    // its idle minute now rather than standing for the rest of the session.
    if (farmed && !walkBusy()) crewIdle();
    return;
  }
  if (!farmed) {
    for (let i = 0; i < g.total; i++) g.results.set(i, SERIAL);
    genStep(g);
    return;
  }
  g.farmed = true;
  genProgress(g);
  for (let i = 0; i < g.total; i++) {
    walkSubmit({
      request: "refine",
      gen: g,
      ctx: g.ctx,
      job: g.jobs[i],
      start: () => g.started.set(i, performance.now()),
      done: (result) => {
        if (gen !== g) return;
        g.results.set(i, result);
        g.walked++;
        genProgress(g);
        genStep(g);
      },
      fail: (reason) => {
        if (gen !== g) return;
        logNote(`[auracle] walk ${i} of gen ${g.generation} not farmed (${reason}); walking it here`,
          { kind: "walk_in_worker", i });
        g.results.set(i, SERIAL);
        genStep(g);
      },
    });
  }
}

const jobsOk = (g) => g.ctx != null && Array.isArray(g.jobs) && g.jobs.length === g.total;

// One absorption per turn, so a run of results that were held for their turn
// is folded in with the player's requests answered between them.
function genStep(g) {
  if (g.turn) return;
  g.turn = true;
  setTimeout(() => {
    g.turn = false;
    try {
      genTurn(g);
    } catch (err) {
      genFailed(g, err);
    }
  }, 0);
}

// An absorb or a walk here threw: main is told (it releases EVOLVE POOL), and
// the generation is forgotten rather than left open with nothing driving it.
function genFailed(g, err) {
  engineError("refine", null, err);
  if (gen === g) genDrop(g);
}

function genTurn(g) {
  if (gen !== g) return;
  if (g.stopped) return genFinish(g);
  if (g.next >= g.total) return genFinish(g);
  const r = g.results.get(g.next);
  if (r === undefined) return; // its walk is still out
  if (r === SERIAL) {
    // Walked here, as a `soon` piece: whatever the player asked for first
    // goes first.
    if (!g.serialQueued) {
      g.serialQueued = true;
      lanes[SOON].push({ type: "breed_step" });
      schedulePump();
    }
    return;
  }
  g.results.delete(g.next);
  // A result that does not parse would leave the engine waiting for this job
  // while the count here moved on; it is walked here instead.
  try {
    JSON.parse(r);
  } catch (_) {
    g.results.set(g.next, SERIAL);
    return genStep(g);
  }
  const child = Number(engine.refine_absorb(r));
  if (!genLanded(g, child)) return;
  genStep(g);
}

// The serial piece (see `genTurn`): one walk of the open generation here.
function breedStep() {
  const g = gen;
  if (!g) return;
  g.serialQueued = false;
  if (g.stopped || g.next >= g.total) return genStep(g);
  if (g.results.get(g.next) !== SERIAL) return genStep(g);
  g.results.delete(g.next);
  const t0 = performance.now();
  beginLongOp();
  let child;
  try {
    child = Number(engine.refine_seed(g.parents[g.next]));
  } catch (err) {
    return genFailed(g, err);
  } finally {
    endLongOp();
  }
  walkTimes.push(performance.now() - t0);
  if (walkTimes.length > 30) walkTimes.shift();
  if (!genLanded(g, child)) return;
  genStep(g);
}

// Record one absorbed job and post its child. False when the engine no longer
// has this generation open (a profile import or a reset replaced it), which
// ends it here too.
function genLanded(g, child) {
  let reason = null;
  if (!(child > 0)) {
    reason = refineReason();
    if (reason === "stale" || reason === "unknown_seed") {
      logNote(`[auracle] gen ${g.generation} closed under it (${reason}); ending`, { kind: "gen_closed" });
      g.stopped = true;
      genFinish(g);
      return false;
    }
    g.reasons.push(reason);
  } else {
    g.born.push(child);
  }
  g.next++;
  post({
    type: "refine_child",
    generation: g.generation,
    index: g.next - 1,
    child: child > 0 ? child : 0,
    reason,
    // The job's parent (`WalkJob.parent_id`): the seed this walk started
    // from. An admitted child's lineage event names it too; a refused one's
    // is recorded nowhere else, and the bank fades it beside this seed.
    seed: g.parents[g.next - 1],
    done: g.next,
    total: g.total,
    ranked: JSON.parse(engine.ranked()),
    // The strip says what each child was bred from as it lands, not only at
    // the end.
    lineage: JSON.parse(engine.lineage()),
    retiring: refineRetiring(),
    ratings: engineRatings(),
    eta: genEta(g),
  });
  return true;
}

// The generation is over: every job absorbed, or stopped. The last absorb
// already finished it in the engine; a stop finishes it here. Either way the
// replaced patches leave now, and only now.
function genFinish(g) {
  if (gen !== g) return;
  let retired = [];
  try {
    retired = JSON.parse(g.stopped || g.next < g.total ? engine.refine_finish() : engine.refine_retired());
  } catch (_) {
    retired = []; // an older engine: each walk replaced as it went
  }
  genDrop(g);
  post({ type: "refine_progress", generation: g.generation, done: g.next, total: g.total, eta: 0, farm: g.farmed });
  post({
    type: "refined",
    views: tasteViews(),
    status: status(),
    born: g.born,
    reasons: g.reasons,
    retired,
    stopped: g.stopped && g.next < g.total,
    bench: benchBelief(),
  });
}

// Forget a generation: its walks still out are for nobody. If nothing else is
// walking, the crew goes at once on a stop (terminating is what gives the
// cores back), and after a minute's idle otherwise.
function genDrop(g) {
  if (gen === g) gen = null;
  walkAbandon((t) => t.gen === g);
  if (!walkBusy()) {
    if (g.stopped && walkInflight.size > 0) crewReap();
    else crewIdle();
  }
  schedulePump(); // a refit or a generation waiting for this one
}

// `refine_stop`: end the generation with what has been bred. A walk running
// *here* (the serial path) cannot be interrupted; the stop lands when it
// returns.
function breedStop() {
  const g = gen;
  if (!g || g.stopped) return;
  g.stopped = true;
  walkAbandon((t) => t.gen === g);
  genStep(g);
}

// ---------- ⚡ evolve from this, on the farm ----------
//
// One walk from the patch on the bench, with its locks: `refine_from_job`
// makes the job, a farm worker walks it, `refine_from_absorb` folds it in. For
// the walk's whole length (about 20 s, up to four times that with many locks)
// this worker answers everything; it used to be one call that answered
// nothing.
//
// The job is drawn **first**, before this worker waits for anything. It is
// one draw of the `refine` stream, and so is a generation's; drawn after the
// wait for a crew, a generation dispatched during a cold crew's handshake drew
// first, and which children a seed bred depended on how warm the crew was
// (ADR-001). From the draw until the walk lands or is stopped, the engine
// keeps the seed in the pool: an edit, a preset or a trim replaces something
// else.
//
// ⚡ and a generation take turns (`blocked`): a generation waits for ⚡ and ⚡
// for a generation, so a ⚡ child is never absorbed into a generation at
// whatever job count its walk happened to finish on (ADR-007). A refit waits
// for ⚡ too, as it does for a generation: the walk is judged under the model
// it was drawn under.
//
// Stop answers "stopped" at once, drops the job in the engine and drops the
// walk's result when it lands. With no farm, or a walk no worker could run,
// the same job is walked here (`refine_from_walk`), so the child is the same;
// that cannot be stopped, and main is told so before it starts.
let evolving = null;

async function evolveFrom(m) {
  const locks = JSON.stringify(m.locks || []);
  // Drawn before any await: see above.
  const reply = JSON.parse(engine.refine_from_job(m.id, locks));
  if (!reply.job) {
    // No taste yet, or the seed has gone. No crew is raised for nothing.
    post({ type: "evolved_from", seedId: m.id, childId: 0, reason: reply.reason || refineReason(), views: tasteViews(), status: status() });
    schedulePump();
    return;
  }
  // Held from the draw, so what waits for ⚡ (see `blocked`) waits from now.
  const ev = { id: m.id, dead: false };
  evolving = ev;
  const ctx = JSON.stringify(reply.context);
  const job = JSON.stringify(reply.job);
  const farmed = await crewUp();
  if (ev.dead) {
    // Stopped while the crew came up: already answered, and the crew it
    // raised is reaped after its idle minute like any other.
    if (!walkBusy()) crewIdle();
    return;
  }
  if (!farmed) return evolveHere(ev);
  post({ type: "evolve_started", seedId: m.id, stoppable: true });
  walkSubmit(
    {
      request: "refine_from",
      evolve: ev,
      ctx,
      job,
      done: (result) => {
        if (ev.dead) return;
        evolveEnd(ev);
        evolvedFrom(ev.id, Number(engine.refine_from_absorb(ev.id, result)));
      },
      // No worker could walk it (it declined, died with no one left, or the
      // watchdog fired): walked here, the same job.
      fail: () => evolveHere(ev),
    },
    true
  );
}

// ⚡'s job walked in this worker. It cannot be interrupted, so main hears
// that first (the slot drops its stop), and the walk waits one turn, so a
// stop already on its way is answered rather than ignored.
function evolveHere(ev) {
  if (ev.dead) return;
  post({ type: "evolve_started", seedId: ev.id, stoppable: false });
  setTimeout(() => {
    if (ev.dead || evolving !== ev) return;
    let child = 0;
    beginLongOp();
    try {
      child = Number(engine.refine_from_walk(ev.id));
    } catch (err) {
      evolveEnd(ev);
      engineError("refine_from", ev.id, err);
      return;
    } finally {
      endLongOp();
    }
    evolveEnd(ev);
    evolvedFrom(ev.id, child);
  }, 0);
}

// ⚡ is over (landed, walked here, or failed): what waited for it may start,
// and a crew with nothing left to walk starts its idle minute.
function evolveEnd(ev) {
  if (evolving === ev) evolving = null;
  if (!walkBusy()) crewIdle();
  schedulePump();
}

function evolvedFrom(seedId, childId) {
  post({
    type: "evolved_from",
    seedId,
    childId,
    reason: childId > 0 ? null : refineReason(),
    views: tasteViews(),
    status: status(),
  });
}

// `refine_from_stop`: answered at once; the walk's result, when it lands, is
// for nobody.
function evolveStop() {
  const ev = evolving;
  if (!ev) return;
  ev.dead = true;
  evolving = null;
  try {
    engine.refine_from_cancel(ev.id); // its seed may be replaced again
  } catch (_) {
    /* a poisoned engine: already reported */
  }
  walkAbandon((t) => t.evolve === ev);
  post({ type: "evolved_from", seedId: ev.id, childId: 0, reason: "stopped", views: tasteViews(), status: status() });
  if (!walkBusy()) {
    if (walkInflight.size > 0) crewReap();
    else crewIdle();
  }
  schedulePump();
}

// ---------- the queue: the player first ----------
//
// This is the engine's only thread, and it used to take requests strictly in
// the order they arrived. Most of what arrives is small — a knob, a vote, a
// bench open, a ▶ — but some of it is not, and much of the large work is work
// nobody asked for yet: a re-measurement of a patch already playing, a spare
// offer grown ahead, a booth pre-warm, a refit. First come, first served put a
// player's ▶ behind all of it. Films of the app caught a warm-start ▶ silent
// for 18 s, a bank row outlined for 3.5 s with the old rack still up, and every
// PERFORM control reading "measuring…" for 14 s after a Take, each time behind
// work the player had not asked for.
//
// So requests go into three lanes, served most urgent first and first come,
// first served within a lane:
//
// - **now**: the player's own gestures, and everything that has to stay in
//   order with them — edits, votes, opens, auditions, saves, logs. One lane,
//   so every ordering rule the app already relies on (edits to one bench land
//   in order; a save sees the votes cast before it; a log line carries the φ of
//   the edit it follows) holds exactly as it did. A render main asks for in
//   the background (`bg`: the sounds of a pair just dealt) waits in this lane
//   behind every gesture, since nothing is ordered against it, and lets
//   waiting `soon` work start first (`serveNow`).
// - **soon**: long work the player did ask for — a generation, an offer they
//   pressed, the first measurement of the patch in their hands.
// - **later**: work nobody is waiting on — refits, re-measurements, spare
//   offers, Wander's drift, booth pre-warms.
//
// Reordering between lanes only ever moves a `soon` or `later` request *later*,
// past gestures that arrived after it, and none of them depends on the state
// from before those gestures: PERFORM's carry the tree they are about, ⚡ names
// its seed by id, and a generation or a refit reads the pool and the log as it
// finds them — a refit that runs after one more vote has seen one more vote.
//
// Queueing alone cannot help a request that arrives while a long call is
// already *running* — wasm cannot be interrupted. That half is chunking: a
// long job that can be cut into renders (`measure`) runs one piece per turn
// and calls `breathe` in between, which answers every `now` request that
// arrived meanwhile before the next piece starts. One long job holds the floor
// at a time — two interleaved would each take twice as long — and a background
// job gives the floor up entirely when the player asks for long work of its
// own. A generation and ⚡ are not on this floor at all: their walks run on the
// farm (see `breedOpen`, `evolveFrom`), and what waits for them is `blocked`.
const NOW = 0;
const SOON = 1;
const LATER = 2;
// Below `later`: a face's render (half a second each, and a list of presets
// scrolled through can ask for thirty) never goes ahead of a refit, a guess
// or a cable probe.
const FACES = 3;
const lanes = [[], [], [], []];

function laneOf(m) {
  switch (m.type) {
    case "refine":
    case "refine_from":
      return SOON;
    // A sound of your own: all three in one lane, so they are answered in
    // the order they were asked (a clear never overtakes the set before it).
    // `soon`, because a file's analysis is one uninterruptible call: for 30
    // s of sound, 0.16 s at 44.1 kHz, 0.31 s at 48, 0.52 s at 96 and 0.94 s
    // at 192 (`own_cost.mjs`), so the player's gestures queued first go first.
    // The page sends at most 48 kHz, which bounds it near a third of a second.
    case "own_sound_set":
    case "own_sound":
    case "own_sound_clear":
      return SOON;
    case "perform_wire":
    case "perform_offer":
      return m.bg ? LATER : SOON;
    // A figure or the lesson, asked for by the player (Plan-005 task 10).
    case "explain":
    case "explain_lesson":
      return SOON;
    case "perform_drift":
    case "fit":
    // The styles' θ after a pick, for LEARNING's bars: work nobody waits on.
    case "styles":
    case "cable_levels":
    case "guess":
    case "face_lookup":
      return LATER;
    case "face_render":
      return FACES;
    case "load_preset":
      return m.prewarm ? LATER : NOW;
    default:
      return NOW;
  }
}

// The long job holding the floor, or null. While one is set, only `now`
// requests are started; `soon` and `later` wait for it to finish (or, for a
// `later` job, to give way).
let floor = null;
let pumpQueued = false;

function schedulePump() {
  if (pumpQueued) return;
  pumpQueued = true;
  setTimeout(pump, 0);
}

// What waits for a walk job rather than for the floor. A generation and ⚡ do
// not hold the floor (see `breedOpen`, `evolveFrom`), but a refit waits for
// both: each is bred under the posterior it started under, and admitted under
// it too. They wait for each other: the next generation for this one or for
// ⚡, and ⚡ for a generation or another ⚡. So the `refine` stream is drawn in
// the order they were asked for, and a ⚡ child is never absorbed into a
// generation at whatever job count its walk finished on. (Main keeps the two
// buttons from being pressed over each other; this is the rule, whatever
// arrives.) And while boot's own crew is still rendering the bank, a
// generation or ⚡ waits for it to be reaped: the farm has one crew at a time.
// (With no boot crew — `?farm=0`, a small machine — they run during the fill,
// between its batches, as they always did.)
const bootCrewLive = () => !booted && farmCrew_ === 0 && !farmClosed && farm.some((f) => f.alive);
const walking = () => gen != null || evolving != null;
function blocked(m) {
  switch (m.type) {
    case "fit":
      return walking();
    // A face's render waits for the bank to finish arriving: half a second
    // each, they would slow the fill (a preset's face on the warm start, a
    // row stored before faces).
    case "face_render":
      return !booted;
    case "refine":
    case "refine_from":
      return walking() || bootCrewLive();
    // The guess's crew phase waits for boot's crew the same way: started
    // while the bank is still arriving, it can raise no crew of its own and
    // ranks only the floor's eight candidates, where a few seconds later a
    // crew ranks every one. It used to start late enough by accident,
    // queued behind PERFORM's background measurements (see `idleOnly`).
    case "guess":
      return !m.crewed && bootCrewLive();
    default:
      return false;
  }
}

// Boot reaps its own crew, never a walk crew raised while it was filling.
function bootCrewDone() {
  if (farmCrew_ === 0) farmShutdown();
}

// A measurement nobody is waiting on (`bg`: one `retire` demoted because
// PERFORM moved to another patch or out of sight, a re-check, a pre-warm) is
// the last work in `later`: it starts only when nothing else there is ready,
// and gives way at its next breath to anything that arrives (see `measure`).
// It is thirty-odd renders, and as an ordinary `later` job it held the floor
// for all of them: the app opens at PERFORM (Plan-008), whose measurement of
// the sound it boots with is demoted the moment the player goes to PATCH or
// opens another sound, and PATCH's cable probe, the model's guess and every
// face lookup then waited for it (up to 46 s on a 16-core laptop, by the
// sound, and past a minute on a CI runner), with the rack's cables unlit and
// the stage's face blank. It loses
// nothing by waiting: every render it made is in the memo.
const idleOnly = (q) => q.type === "perform_wire" && !!q.bg;
const laterWaiting = () => lanes[LATER].some((q) => !idleOnly(q) && !blocked(q));

// A face the player is looking at and waiting on (`seen`, PATCH's outline of
// the patch without the selected module) is ready in the faces lane.
function seenFaceWaiting(lanes) {
  return lanes[FACES].some((q) => q.seen && !blocked(q));
}

// The first request in `soon`, then `later` (a measurement nobody is waiting
// on last, after a face the player is looking at), then the faces lane, that
// may start now. PERFORM's own measurement of the sound it plays is not
// `idleOnly`, so it still goes before any face.
function nextLong() {
  if (floor) return null;
  for (const lane of [SOON, LATER, FACES]) {
    let i = lanes[lane].findIndex((q) => !blocked(q) && !(lane === LATER && idleOnly(q)));
    if (i < 0 && lane === LATER) {
      if (seenFaceWaiting(lanes)) continue;
      i = lanes[LATER].findIndex((q) => !blocked(q));
    }
    if (i >= 0) return lanes[lane].splice(i, 1)[0];
  }
  return null;
}

// Is there anything the pump may start now? Work waiting behind a held floor,
// or blocked behind a walk job, is not: the floor's release and the job's end
// schedule the pump, and re-arming it meanwhile would spin a timer every few
// milliseconds for as long as they run.
const runnable = () =>
  lanes[NOW].length > 0 || (!floor && [SOON, LATER, FACES].some((l) => lanes[l].some((q) => !blocked(q))));

// Serve the `now` lane: gestures first come, first served, and a background
// render (`bg`) only when no gesture is waiting. Each such render is one
// uninterruptible call, so before one starts, anything that arrived during
// the last call is let in: a bank open clicked while the table's sounds were
// rendering waits for the render already running, never the ones behind it.
//
// Background renders also give way to long work the player asked for that is
// waiting to start (a pressed Offer, the first measurement of the patch in
// their hands): it starts first, and they go between its pieces, as gestures
// do. Not to a serial generation's walks (`breed_step`), which follow one
// another for minutes: the pair on the table would stay silent through it.
const bgWaits = () => !floor && lanes[SOON].some((q) => q.type !== "breed_step" && !blocked(q));
async function serveNow() {
  while (lanes[NOW].length) {
    let i = lanes[NOW].findIndex((q) => !q.bg);
    if (i < 0) {
      if (bgWaits()) break;
      await yieldToQueue();
      i = lanes[NOW].findIndex((q) => !q.bg);
      if (i < 0) {
        if (!lanes[NOW].length || bgWaits()) break;
        i = 0;
      }
    }
    await runMessage(lanes[NOW].splice(i, 1)[0]);
  }
}

async function pump() {
  pumpQueued = false;
  await serveNow();
  const m = nextLong();
  if (m) await runMessage(m);
  if (runnable()) schedulePump();
}

async function runMessage(m) {
  if (poisoned) {
    engineError(m.type, m.id, null, m.req);
    return;
  }
  try {
    await dispatch(m);
  } catch (err) {
    engineError(m.type, m.id, err, m.req);
  }
}

// Between two pieces of a long job: let every message that arrived during the
// last piece be delivered, answer the player's at once, and say whether a
// background job must give the floor up to long work the player asked for.
async function breathe(lane) {
  await yieldToQueue();
  await serveNow();
  return lane === LATER && lanes[SOON].some((q) => !blocked(q));
}

// Run `job` for message `m` holding the floor; the floor is released however
// it ends.
async function holdFloor(m, job) {
  const me = { m };
  floor = me;
  try {
    return await job();
  } finally {
    if (floor === me) floor = null;
    schedulePump();
  }
}

self.onmessage = (e) => {
  const m = e.data;
  // Everything but `init` needs the engine, and `init` is async: it imports the
  // wasm, instantiates it and fills a pool. Any request that arrives inside
  // that window used to throw on a null `engine`, and the throw was *silent* —
  // an unhandled rejection in a worker, with the reply that never came looking
  // exactly like a slow one. `save` was the only case that guarded, which is
  // how it stayed hidden: the observable symptom is a presets bank that is
  // empty until something happens to ask again.
  //
  // Guarding centrally rather than per-case, because the failure is a property
  // of the boot sequence, not of any one message, and thirty individual
  // `if (!engine) break` lines is thirty chances to forget the thirty-first.
  if (!engine && m.type !== "init") {
    post({ type: "not_ready", request: m.type });
    return;
  }
  // Boot is not queued: it is the fill everything else is served *between*
  // (it yields after every batch), and a lost farm worker must be heard while
  // it is running, not after.
  if (m.type === "init" || m.type === "farm_lost") {
    runMessage(m);
    return;
  }
  // Main's answer to `farm_want`: the ports of a walk crew.
  if (m.type === "farm_ports") {
    crewArrived(m);
    return;
  }
  // Stops are answered on arrival, not queued behind what they stop.
  if (m.type === "refine_stop") {
    breedStop();
    return;
  }
  if (m.type === "refine_from_stop") {
    evolveStop();
    return;
  }
  // An answer or the lesson put away: its requests still waiting in `soon`
  // are nobody's now, and must not stand ahead of what the player asks next
  // (a pressed Offer). Each is answered, as every request is, with
  // `error: "cancelled"`; one already rendering finishes.
  if (m.type === "explain_cancel") {
    for (const lane of lanes) {
      for (let i = lane.length - 1; i >= 0; i--) {
        const q = lane[i];
        if (q.type !== m.kind) continue;
        lane.splice(i, 1);
        post({ type: q.type, token: q.token ?? null, tree: q.tree, k: q.k, cutoff: q.cutoff, error: "cancelled" });
      }
    }
    return;
  }
  // Background work became the player's: Offer claimed a spare still waiting
  // in `later`, or PERFORM came back into sight with its measurement demoted
  // (see `retire`). It waits in `soon` now, and a running one stops giving way.
  if (m.type === "promote") {
    if (floor && floor.m && floor.m.req === m.req && floor.m.type === m.kind) floor.m.bg = false;
    const i = lanes[LATER].findIndex((q) => q.req === m.req && q.type === m.kind);
    if (i >= 0) {
      const [q] = lanes[LATER].splice(i, 1);
      q.bg = false;
      // A walk that had given way (it holds its job) was asked for before
      // anything now waiting in `soon`: it goes first, not behind it.
      if (q.job != null) lanes[SOON].unshift(q);
      else lanes[SOON].push(q);
    }
    if (runnable()) schedulePump();
    return;
  }
  // PERFORM moved on to another patch, or out of sight. Its measurement is
  // still worth finishing — it is cached, and coming back is the common case —
  // but nobody is waiting on it now, so it drops to the back of `later`, where
  // long work the player asks for and the rest of `later` overtake it (a
  // running one gives way at its next breath; see `idleOnly`). Offers and
  // drifts grown from a patch it left are worth nothing, so any of those
  // named here that are still queued are answered empty: PERFORM holds every
  // request open until its reply lands.
  if (m.type === "retire") {
    const reqs = new Set(m.reqs || []);
    if (floor && floor.m && floor.m.type === "perform_wire" && reqs.has(floor.m.req)) floor.m.bg = true;
    // A walk running now stops at its next step (see `walkRun`).
    if (floor && floor.m && /^perform_(offer|drift)$/.test(floor.m.type) && reqs.has(floor.m.req)) floor.m.retired = true;
    const mine = (q) => reqs.has(q.req) && q.type.startsWith("perform_");
    for (const q of lanes[SOON].filter((q) => mine(q) && q.type === "perform_wire")) {
      lanes[SOON].splice(lanes[SOON].indexOf(q), 1);
      q.bg = true;
      lanes[LATER].push(q);
    }
    for (const lane of [SOON, LATER]) {
      for (const q of lanes[lane].filter((q) => mine(q) && q.type !== "perform_wire")) {
        // A walk paused part-way (see `walkRun`) still holds its job. A
        // poisoned engine throws here, and the requests behind this one
        // must still be answered.
        if (q.job != null) {
          try {
            engine.perform_job_drop(q.job);
          } catch (_) {
            /* reported by the next request that reaches the engine */
          }
        }
        if (q.type === "perform_offer") {
          post({ type: "perform_offered", req: q.req, offer: null, error: "retired" });
        } else if (q.type === "perform_drift") {
          post({ type: "perform_drifted", req: q.req, drift: null, error: "retired" });
        } else {
          continue; // not a kind that is ever retired
        }
        lanes[lane].splice(lanes[lane].indexOf(q), 1);
      }
    }
    return;
  }
  const lane = laneOf(m);
  // One render of an id answers everyone who asked (main keeps every buffer
  // it is sent): a sound asked for in the background and then wanted at once
  // (▶ on a pair that is waiting for it) is rendered once, as the player's.
  if (m.type === "render") {
    const i = lanes[NOW].findIndex((q) => q.type === "render" && q.id === m.id);
    if (i >= 0) {
      if (m.bg) return;
      if (lanes[NOW][i].bg) lanes[NOW].splice(i, 1);
    }
  }
  lanes[lane].push(m);
  // The player's requests run on arrival, as every request used to: parked
  // behind a timer, the boot fill's next batch — a second or more of renders
  // — could slip in ahead of them. Long work waits for the pump, so a burst of
  // messages is all queued before any of it starts and the gestures in it go
  // first.
  if (lane === NOW) drainNow();
  if (runnable()) schedulePump();
};

let draining = false;
async function drainNow() {
  if (draining) return;
  draining = true;
  try {
    await serveNow();
  } finally {
    draining = false;
  }
}

async function dispatch(m) {
  switch (m.type) {
    case "init": {
      // Boot owns the farm: N x ~15 MB of linear memory and N live ports
      // exist only for this block. A wasm panic in an absorb, a restore or a
      // fit would otherwise become an unhandled rejection here, leaving every
      // farm worker resident for the whole session, main with nothing to reap
      // on, and the boot veil up forever because neither `playable` nor
      // `filled` was ever posted. `finally` reaps; `catch` drops the veil into
      // a degraded state rather than hanging on it.
      try {
        const mod = await import(`./pkg/auracle_wasm.js?v=${V}`);
        await mod.default({
          // Main compiled the binary once and shares the `WebAssembly.Module`
          // with every worker; instantiating from it skips a second compile of
          // ~2 MB. Absent (or unsupported), fetch it as before.
          module_or_path:
            m.module || new URL(`./pkg/auracle_wasm_bg.wasm?v=${V}`, self.location.href),
        });
        glue = mod;
        WasmEngine = mod.WasmEngine;
        engine = new WasmEngine(BigInt(m.seed >>> 0), m.poolSize);
        // The structural ceilings a hand-built patch must respect, from the
        // grammar itself. The app used to restate them as literals, and the
        // two depth ceilings moved when they were derived from the prior's
        // support; a number the engine owns is read from the engine. Null on
        // a binary too old to say, and main keeps its fallback.
        let ceilings = null;
        try {
          ceilings = JSON.parse(mod.budget_ceilings());
        } catch (_) { /* older engine */ }
        // The render namespace this binary measures in (the stimulus, the
        // featurizer's RENDER_EPOCH and the quiver version). PERFORM stamps
        // the wirings it keeps with it, so a wiring measured by another
        // build's DSP is re-measured rather than trusted.
        let ns = null;
        try {
          ns = mod.cache_namespace(engine.phrase_json()) || null;
        } catch (_) { /* older engine */ }
        faceNs = ns;
        faceStoreOpen(); // ready for the first faces copied out of the memo
        // The audition clip sounds with an AUDIO IN are measured with (the
        // built-in reference until an input is captured). PERFORM keys the
        // wiring of a sound that listens by it.
        // The longest take a CAPTURE holds (RECORD's limit), from the grammar.
        let takeSeconds = null;
        try {
          takeSeconds = mod.take_seconds();
        } catch (_) { /* older engine */ }
        post({ type: "ready", ceilings, ns, clip: auditionClip(), takeSeconds });

        // Farm ports arrive already connected to workers main spawned before it
        // even read the save, so their wasm init has been overlapping with ours.
        // A binary too old to have `phrase_json` has no farm surface at all —
        // fall straight back to the serial path rather than half-using one.
        let farmed = false;
        if (Array.isArray(m.farmPorts) && m.farmPorts.length) {
          try {
            farmSetup(m.farmPorts);
            farmed = await farmHandshake(FARM_HANDSHAKE_MS);
          } catch (err) {
            console.warn("[auracle] farm unavailable:", err);
            farmed = false;
          }
        }
        if (!farmed && farm.length) {
          console.warn("[auracle] no farm worker reported ready; filling serially");
          bootCrewDone();
        }

        // Boot is staged, and every `fill_progress` says which stage it is in.
        // Without that a restore posts {pool:0,target:1} then {pool:40,target:40}
        // and drives the (deliberately monotonic) boot bar to 100 % before the
        // top-up fill has drawn anything, where it then sits pinned.
        const stages = m.saved ? 2 : 1;
        const fillStage = stages - 1;

        // A saved session restores instead of filling from the prior; the
        // pool is then topped up if it came back short.
        let restored = 0;
        if (m.saved) {
          post({
            type: "fill_progress",
            pool: 0,
            target: 1,
            stage: 0,
            stages,
            label: "restoring your bank & taste…",
          });
          restored = await restoreSession(m.saved, farmed, stages);
          post({
            type: "fill_progress",
            pool: 1,
            target: 1,
            stage: 0,
            stages,
            label: `recalled ${restored} sounds`,
          });
          // Say so when the restore had to mend something. A profile fitted on
          // values that were not measurements is the one kind of silent repair
          // this app should never make — and the numbers are zero for every
          // session written since the domain gate shipped, so the message only
          // ever appears when it is true.
          try {
            const rep = JSON.parse(engine.repair_report());
            // Which sounds are kept for a recording that couldn't be read, so
            // main says so once per set rather than on every boot.
            if (rep.held) rep.heldIds = JSON.parse(engine.held_sounds()).map((h) => h.id);
            if (rep.terms || rep.cells || rep.dropped || rep.held) post({ type: "repaired", repair: rep });
          } catch (_) { /* an engine without the report is an engine with nothing to report */ }
        }

        // `playable` is the message the boot veil lifts on. It must fire exactly
        // once, and never after `filled`, so every path funnels through here —
        // including the degenerate ones (a tiny pool_target, or a fill that ran
        // out of vetted draws), where announcing anyway is what keeps the veil
        // from being left up forever.
        const playableAt = Math.max(2, m.playableAt || PLAYABLE_AT);
        let announced = false;
        const announcePlayable = () => {
          if (announced) return;
          announced = true;
          // A partial pool carries no φ_std, and `next_duel` refuses
          // un-standardized candidates — this is what makes it duel-able. If
          // the engine is too old to have it, the veil still lifts and `filled`
          // deals the first pair, i.e. exactly today's behaviour.
          tryEngine("standardize_now");
          post({ type: "playable", status: status(), restored });
        };

        let st = status();
        post({
          type: "fill_progress",
          pool: st.pool,
          target: st.pool_target,
          stage: fillStage,
          stages,
          workers: farmed ? farmCrew() : 0,
        });
        if (st.pool >= playableAt) announcePlayable();

        const fillProgress = () => {
          st = status();
          post({
            type: "fill_progress",
            pool: st.pool,
            target: st.pool_target,
            stage: fillStage,
            stages,
            workers: farmed ? farmCrew() : 0,
          });
          if (st.pool >= playableAt) announcePlayable();
        };

        // The farm renders; this worker draws, absorbs and standardizes. Every
        // absorb is one `await`-free step, and the promise below only resolves
        // between messages, so the queue drains throughout — `playable at 8`
        // and the progress meter keep working exactly as they do serially.
        if (farmed && st.pool < st.pool_target) {
          await runFarm({
            startAt: engine.fill_cursor(),
            // The farm takes a term as JSON text, not as a structured object:
            // it deserializes straight into a `PatchTree`, and a string is the
            // cheaper thing to clone across the port besides.
            take: (n) =>
              JSON.parse(engine.fill_draw(n)).map((d) => ({
                i: d.i,
                tree: JSON.stringify(d.tree),
                dup: d.dup,
              })),
            absorb: (i, r) => {
              engine.fill_absorb(
                i,
                r.ok ? r.cached : "",
                r.ok && r.samples ? r.samples : EMPTY_F32
              );
            },
            stop: () => status().pool >= st.pool_target,
            // Audio only where it will be heard: the first patches are the ones
            // the user auditions while the rest of the bank lands.
            wantAudio: (i) => i < FARM_AUDIO_AHEAD,
            after: fillProgress,
          });
          st = status();
        }

        // Fill incrementally so the boot meter can narrate progress — and
        // yield between batches so the app the user is already using stays
        // responsive while the bank fills behind it.
        //
        // With no farm this is the whole fill, unchanged. With one it is the
        // remainder, if the farm stopped short (every worker died, or a draw was
        // retired): the two paths fold the *same* indexed draw stream from the
        // same cursor, so finishing serially finishes the same bank.
        while (st.pool < st.pool_target) {
          const added = engine.fill_step(2);
          st = status();
          post({ type: "fill_progress", pool: st.pool, target: st.pool_target, stage: fillStage, stages });
          if (added === 0) break;
          if (st.pool >= playableAt) announcePlayable();
          await yieldToQueue();
        }
        announcePlayable();
        // The provisional standardizer was fit on the first handful of draws;
        // the finished pool is a better reference population. No-op once a
        // posterior exists — see `Engine::restandardize_if_untaught`.
        tryEngine("restandardize_if_untaught");
        st = status();
        // Boot is over, and so is its crew. N × ~15 MB of linear memory is not
        // something to keep resident behind a running instrument; walks raise
        // a crew of their own when they want one.
        bootCrewDone();
        post({ type: "filled", status: st, restored });
        // Taste continuity: re-fit from the restored log so the map and
        // styles come back with the bank.
        //
        // `engine.fit()` blocks this worker for seconds, and on the restore path
        // the fill loop never ran, so nothing has yielded since `playable` went
        // out. Main has already answered it with a `{type:"duel"}` and will
        // follow with the pair's two `{type:"render"}`s — all of which would sit
        // behind the fit, dropping the veil onto a frozen, empty duel table.
        // Drain them first: three breaths, each answering every request of the
        // player's that has arrived by then — the duel, then its renders.
        if (restored > 0 && st.observations > 0) {
          for (let i = 0; i < 3; i++) await breathe(LATER);
          beginLongOp();
          try {
            engine.fit();
            lastStylesObs = -1;
            obsAtFit = status().observations;
            post({ type: "fitted", views: tasteViews(), status: status(), bench: benchBelief() });
          } finally {
            endLongOp();
          }
        }
      } catch (err) {
        console.error("[auracle] boot failed:", err);
        post({ type: "boot_failed", error: String((err && err.message) || err) });
      } finally {
        bootCrewDone();
        // From here a generation or ⚡ may raise a crew of its own.
        booted = true;
        schedulePump();
      }
      break;
    }
    // A farm worker died (main saw its `onerror`, or its port closed). Drop it
    // and re-issue whatever it was holding, by index — the tree is recoverable
    // from `(fill_seed, i)`, so nothing was lost but the render.
    case "farm_lost": {
      farmLost(m.index, m.reason, m.crew);
      break;
    }
    case "duel": {
      // `next_duel_ex` carries *why* this pair was chosen. A duel the engine
      // picked at random is a calibration check, and labelling it is the only
      // way the reliability numbers mean anything — the acquisition function
      // deliberately serves near-ties, which biases any accuracy measured on
      // its own choices.
      //
      // The `ex` variants are newer than the engine binary a stale browser
      // cache can hand us (see this file's header); degrade to the plain call
      // rather than taking the whole app down.
      let pair = null;
      let meta = null;
      try {
        // The patches the player cut are never dealt again (`exclude`, ids
        // main holds from the cut on, undo window included).
        // `deal_duel_ex` deals without counting the pair as shown: main
        // deals ahead and throws some deals away, and says which pair it put
        // on the table (`duel_shown` below), so a check dealt and dropped
        // unseen does not use up the check's turn. Older binary: counted at
        // the deal, as before.
        const exclude = new Uint32Array(m.exclude || []);
        const ex = JSON.parse(
          typeof engine.deal_duel_ex === "function"
            ? engine.deal_duel_ex(exclude)
            : engine.next_duel_ex(exclude),
        );
        if (ex && ex.a != null) {
          pair = [ex.a, ex.b];
          meta = ex;
        }
      } catch (_) {
        pair = JSON.parse(engine.next_duel());
      }
      // `ahead`: main asked for the pair after this one, dealt while this one
      // is on the table (see `requestAhead` in main.js); it rides back so the
      // reply is not taken for the table's.
      post({ type: "duel", pair, meta, ahead: !!m.ahead });
      // The pair's sounds are not rendered here. They used to be, in this
      // turn (`prefetch_render`, two renders, and two more for a deal ahead),
      // and every gesture that arrived meanwhile waited them out: a preset
      // clicked in the bank just after a reload reached PERFORM up to 4.7 s
      // late on one core and 9.3 s on a CI runner, because the table's pair
      // had just gone up and the next pair was being dealt. Main asks
      // for them as background renders (`bg`), which the `now` lane serves
      // after every gesture waiting in it (`serveNow`).
      break;
    }
    // Main put a dealt pair on the table (`placePair`). The engine counts
    // pairs shown, not dealt: the check cadence and the repeat and exposure
    // penalties move here. A pair not dealt, or already counted, counts
    // nothing.
    case "faces":
      await faces(m);
      break;
    case "face_lookup":
      await faceLookup(m);
      break;
    case "face_render":
      faceRender(m);
      break;
    case "face_cancel":
      faceCancel(m);
      break;
    case "duel_shown": {
      try { engine.duel_shown(m.a, m.b); } catch (_) { /* older engine: counted at the deal */ }
      break;
    }
    // The styles (θ with its spread, shares, exemplars) under the posterior as
    // it stands, asked for after every pick: a pick reweights the draws, so
    // θ's mean moves with it, and LEARNING's bars and its replay follow.
    // `observations` says which pick it is after. 0.6 to 12 ms in wasm by the
    // lenses (Plan-005, Measured (task 6)), so it waits in `later`. Always
    // answered: `null` before the first fit.
    case "styles": {
      // Requests queued behind a burst of picks coalesce: one that finds the
      // engine where the last answer left it (no observation since) is
      // answered with no styles, at no cost. Every request is still answered.
      const observations = status().observations;
      if (observations === lastStylesObs || observations <= obsAtFit) {
        post({ type: "styles", styles: null, observations, same: observations === lastStylesObs });
        break;
      }
      let styles = null;
      try {
        styles = JSON.parse(engine.styles());
      } catch (_) { /* older engine */ }
      lastStylesObs = observations;
      post({ type: "styles", styles, observations });
      break;
    }
    case "calibration": {
      try {
        // With the summary, every forecast it scores (LEARNING's strip) and
        // the numbers LEARNING's math states (`modelFacts`).
        post({ type: "calibration", calib: JSON.parse(engine.calibration()), forecasts: engineForecasts(), facts: modelFacts() });
      } catch (_) { /* older engine: the UI falls back to its own tally */ }
      break;
    }
    case "render": {
      // An empty buffer is a *failure*, not a slow arrival: `render_of` returns
      // one for an unknown id or a term that no longer renders (a restored bank
      // can outlive the DSP that made it). Under the old eager pool that could
      // only mean "unknown id" and main could afford to ignore it; with lazy
      // rendering it is reachable on any candidate, and a main thread that
      // cannot tell "never" from "not yet" waits forever. Say so explicitly.
      let buf = [];
      let err = null;
      try {
        buf = engine.render_of(m.id);
      } catch (e) {
        err = String((e && e.message) || e);
      }
      if (!buf || buf.length === 0) {
        post({ type: "render", id: m.id, failed: true, reason: err });
        break;
      }
      const arr = new Float32Array(buf);
      post(
        {
          type: "render",
          id: m.id,
          sampleRate: engine.sample_rate(),
          buffer: arr,
          sexpr: engine.sexpr_of(m.id),
          bestStyle: engine.best_style_of(m.id),
        },
        [arr.buffer]
      );
      faceAfterRender(m.id);
      break;
    }
    // The three vote routes answer with `recorded`: `false` when the engine
    // took nothing because the id is no longer in the pool — a duel side
    // evicted by a generation, a preset load or an import inside the 7 s undo
    // window. The engine always dropped that vote; the app used to count it,
    // score it and toast "rated". `vote` rides back so main can undo what it
    // did optimistically. `!== false` so a stale binary (no boolean) still
    // reads as recorded.
    case "record_duel": {
      // Prediction is computed BEFORE the vote enters the log — this is the
      // model's honest forecast, scored against the user's actual choice.
      const pred = engine.duel_pred(m.a, m.b);
      const recorded = engine.record_duel(m.a, m.b, m.choseA) !== false;
      post({
        type: "status",
        status: status(),
        // A forecast for a vote that was not taken must not be scored.
        pred: recorded ? pred : null,
        choseA: m.choseA,
        recorded,
        vote: { kind: "duel", a: m.a, b: m.b },
        // The ratings this pick left (`engineRatings`); nothing moved if
        // the engine took nothing.
        ratings: recorded ? engineRatings() : null,
      });
      break;
    }
    // The forecast alone, for immediate display: the vote itself is buffered
    // behind an undo window on the main thread, but its payoff line must not
    // arrive seven seconds late. Asked before the pick too (`pre`), under the
    // model view: the pair rides back so the page shows it only for the pair
    // it was asked for.
    case "duel_pred": {
      post({ type: "duel_pred", pred: engine.duel_pred(m.a, m.b), choseA: m.choseA, a: m.a, b: m.b, pre: !!m.pre });
      break;
    }
    case "record_keep": {
      const recorded = engine.record_keep(m.id, m.kept) !== false;
      post({
        type: "status",
        status: status(),
        recorded,
        vote: { kind: "keep", id: m.id, kept: m.kept },
        ratings: recorded ? engineRatings() : null,
      });
      break;
    }
    case "record_stars": {
      const recorded = engine.record_stars(m.id, m.rating) !== false;
      post({
        type: "status",
        status: status(),
        recorded,
        // `prev` is what the bank showed before the optimistic update — echoed,
        // not remembered here, because this worker holds no UI state.
        vote: { kind: "stars", id: m.id, rating: m.rating, prev: m.prev || 0 },
        ratings: recorded ? engineRatings() : null,
      });
      break;
    }
    case "fit": {
      beginLongOp();
      try {
        engine.fit();
        lastStylesObs = -1;
        obsAtFit = status().observations;
        post({ type: "fitted", views: tasteViews(), status: status(), bench: benchBelief() });
      } finally {
        endLongOp();
      }
      break;
    }
    case "refine": {
      // The breed job (see `breedOpen`): open the generation, hand its walks
      // to the farm, and return. It is absorbed from farm messages, a child
      // per turn, and nothing else waits for it but a refit. `toward`: bred
      // toward the sound of your own (Breed toward it); same lane, same
      // waits, so it queues behind a generation or ⚡ like any other.
      breedOpen(m.toward === true);
      break;
    }
    // ---- a sound of your own (Plan-005 task 11) ----
    // The page decodes a dropped file and sends it mixed to mono: `pcm`, a
    // Float32Array (transfer it), at `sampleRate`, with the file's `name`.
    // Replies `own_sound` with the engine's measurement (`sound`: ok or an
    // error flag, its z with the masked coordinates null, its place on the
    // map, its nearest pool members and presets, the seeds a breed toward it
    // starts from). The session saves it as features, never the audio, and
    // `own_sound` asks for it again after a reload or when the pool moved.
    case "own_sound_set": {
      ownPresetsFetch();
      const sound = JSON.parse(engine.own_sound_set(m.pcm, m.sampleRate, m.name || undefined));
      post({ type: "own_sound", sound });
      break;
    }
    case "own_sound": {
      ownPresetsFetch();
      post({ type: "own_sound", sound: JSON.parse(engine.own_sound()) });
      break;
    }
    case "own_sound_clear": {
      engine.own_sound_clear();
      post({ type: "own_sound", sound: null });
      break;
    }
    case "breed_step": {
      breedStep();
      break;
    }
    // ---- workbench (the interactive rack) ----
    case "edit_begin": {
      // The bench speaking early, as an edit does (`postLiveTree`) and the
      // warm start's first pick does (`warm_first`): opening is a render
      // (`edit_begin` materializes the bench's buffer), but the tree and its
      // makeup are already in the pool, so the voices — and PERFORM, which
      // plays a patch it has measured before from its cache — have the patch
      // one render sooner. The `bench` reply that follows vets it.
      const early = engine.tree_json_of(m.id);
      if (early && early !== "null") {
        post({ type: "bench_opening", id: m.id, json: early, makeup: engine.makeup_of(m.id) });
      }
      const ok = engine.edit_begin(m.id);
      if (ok) postBench({ subject: m.id });
      else post({ type: "bench_missing", id: m.id });
      break;
    }
    case "edit_param": {
      // A selector (`wave`, `fkind`, …) reaches the voices only as a new
      // tree, and that tree waits for its render here, unlike a structural
      // edit's (`postLiveTree`): the makeup the voices play it at is what the
      // render measures. Posted early it could carry only the previous tree's
      // makeup, which put a held note up to 27 dB hot or 29 dB quiet, and no
      // estimate cheaper than the render came close enough
      // (crates/auracle-wasm/examples/selector_makeup.rs).
      const ok = engine.edit_param(m.addr, m.value, m.isIndex);
      if (ok) postBench({ edited: m.addr, token: m.token });
      else post({ type: "edit_rejected", addr: m.addr });
      break;
    }
    case "edit_commit": {
      // `outcome` is a string now, not a boolean: `"heard_original"` — the
      // player listened to both and preferred the patch they started from —
      // is the direction the old flag could not carry at all. See
      // `WasmEngine::edit_commit`.
      const id = Number(engine.edit_commit(m.outcome || "none"));
      post({
        type: "committed",
        id,
        outcome: m.outcome || "none",
        views: tasteViews(),
        status: status(),
        retiring: openRetiring(),
      });
      break;
    }
    // Everything a commit duel needs, in one round trip: is there anything to
    // compare, and the original's audio to compare against. Rendering here
    // rather than through the `render` path keeps the pair honest — both
    // buffers come from the same engine, the same phrase and the same makeup
    // policy, so a preference between them is a preference about the patches.
    case "edit_duel": {
      const differs = engine.edit_differs_from_original();
      const id = Number(engine.edit_original_id());
      const arr = new Float32Array(differs && id > 0 ? engine.render_of(id) : 0);
      post(
        {
          type: "edit_duel",
          differs,
          id,
          buffer: arr,
          sampleRate: engine.sample_rate(),
          ...(m.then ? { then: m.then } : {}),
        },
        [arr.buffer]
      );
      break;
    }
    // Pre-placement audition (WS-2 §6): the current patch with a module
    // spliced at the socket under the pointer, rendered without the bench ever
    // holding it — see `WasmEngine::preview_op`.
    //
    // The `token` is echoed rather than interpreted. This worker is serial, so
    // a preview already begun cannot be interrupted; "cancel" therefore means
    // "the answer is stale on arrival", which is a decision only main can make
    // and only main has the state for. Answering every request — including the
    // failures, with an empty buffer — is what lets main retire its in-flight
    // slot without a timeout.
    //
    // Not routed through the render farm, which looks like the natural home
    // for it and is not: the farm holds no engine, so it has neither the memo
    // that makes a re-hover free nor the bench tree the splice is applied to,
    // and main is deliberately not on the farm's data path at all.
    case "preview_render": {
      const pcm = engine.preview_op(JSON.stringify(m.op), m.seconds || 2.0);
      const arr = new Float32Array(pcm);
      post(
        {
          type: "preview",
          // Which stream asked. Two different features render through this one
          // case now — the pre-placement audition and the per-port probe — and
          // they keep separate token counters, so without a name for the
          // stream each one's reply would look like a stale reply to the
          // other and be dropped as the cancellation.
          tag: m.tag || null,
          token: m.token,
          key: m.key || null,
          kind: m.kind || null,
          buffer: arr,
          sampleRate: engine.sample_rate(),
        },
        [arr.buffer]
      );
      break;
    }
    // The implicit stream (WS-8 §3). Fire-and-forget by design: nothing in the
    // app waits on a log line, and a reply would only be another message on
    // the queue between a gesture and its sound.
    case "log_edit": {
      engine.log_edit_event(
        m.kind,
        m.id || 0,
        m.value || 0,
        m.detail ? JSON.stringify(m.detail) : "",
        !!m.withPhi
      );
      break;
    }
    case "refine_from": {
      // On the farm (see `evolveFrom`): this returns once the walk is out,
      // and the pump goes on serving everything else while it runs.
      evolveFrom(m).catch((err) => {
        if (evolving && evolving.id === m.id) {
          evolving.dead = true;
          evolving = null;
        }
        try {
          engine.refine_from_cancel(m.id);
        } catch (_) {
          /* a poisoned engine: reported below */
        }
        engineError("refine_from", m.id, err);
        schedulePump();
      });
      break;
    }
    // ---- performance surface (PERFORM) ----
    // Each of these replies exactly once, with the caller's `req` echoed, so
    // main can drop a reply for a patch it has since moved away from.
    // PERFORM's four questions. Every one answers, even on a throw: the page
    // tracks each request until its reply lands, and a missing reply would
    // leave (say) an offer "in flight" forever and refuse the next one.
    case "perform_wire": {
      await holdFloor(m, () => measure(m));
      break;
    }
    // The model's guess for the patch in hand (see `guessRun`), and a skip of
    // one. Taking a guess is `edit_structure` with `guess`.
    case "guess": {
      // The crew phase does not hold the floor. It renders nothing here: it
      // waits for a crew to spawn and for its workers' replies, up to several
      // seconds, and a floor held across that made a pressed Offer, EVOLVE's
      // `refine` and the measurement of the sound in hand wait for it though
      // nothing was running on this thread. So it runs detached, as a
      // generation's walks do (one guess at a time: `guessCrewTail`), and
      // when it is over the guess goes back to the front of `later` with
      // `crewed` set, and takes the floor then for the floor's own renders.
      if (!m.crewed) {
        guessCrewTail = guessCrewTail
          .then(async () => {
            if (await guessCrewPhase(m)) return;
            lanes[LATER].unshift(m);
          })
          .catch((err) => engineError("guess", null, err))
          .finally(schedulePump);
        break;
      }
      await holdFloor(m, () => guessRun(m));
      break;
    }
    // A patch of its own (PATCH's NEW PATCH): the guesses' key from here on
    // (`guess_patch_as`; 0 asks for a fresh one). Answered with the key.
    case "guess_patch_as": {
      post({ type: "guess_patch", token: m.token ?? null, key: engine.guess_patch_as(m.key | 0) });
      break;
    }
    case "guess_skip": {
      post({ type: "guess_skipped", token: m.token ?? null, ok: engine.guess_skip(JSON.stringify(m.guess)) });
      break;
    }
    case "perform_apply":
      performReply(m, "perform_applied", "json", false, () =>
        engine.perform_apply(m.tree, JSON.stringify(m.overrides || [])));
      break;
    case "perform_drift":
      await holdFloor(m, () => walkRun(m));
      break;
    case "perform_graft":
      performReply(m, "perform_grafted", "graft", false, () =>
        JSON.parse(engine.perform_graft(m.tree, JSON.stringify(m.overrides || []), m.k)));
      break;
    // An offer answered in PERFORM: a heard comparison, recorded as a duel
    // tagged `perform_offer`. The status follows so the picks counter and the
    // refit pacing see it like any other vote.
    case "perform_record": {
      let took = false;
      performReply(m, "perform_recorded", "recorded", true, () =>
        // `asOf`: the newest pool id main had seen when the answer was given.
        // A sound kept as new after it (a Take waits eight seconds) is not
        // judged by it (`Engine::record_tree_duel_as_of`).
        (took = engine.perform_record(m.tree, JSON.stringify(m.overrides || []), m.offer, !!m.took, m.asOf == null ? 0xffffffff : m.asOf >>> 0)));
      // `recorded` false when the engine took nothing (the two the same, no
      // standardizer yet, a vet that failed): nothing moved, so no ratings,
      // and TASTE keeps no moment for it.
      const recorded = took !== false;
      post({ type: "status", status: status(), recorded, ratings: recorded ? engineRatings() : null });
      break;
    }
    // A search control's offer carries the control and the way it was turned
    // (aimed, and its reply says how far it `moved`); the Offer button's and
    // Wander's carry neither, and are not aimed.
    case "perform_offer":
      await holdFloor(m, () => walkRun(m));
      break;
    case "tree_json": {
      post({
        type: "tree_json",
        id: m.id,
        json: engine.tree_json_of(m.id),
        makeup: engine.makeup_of(m.id),
      });
      break;
    }
    case "edit_set_tree": {
      // Also the ceiling gate: a whole-tree replace is the one route into the
      // bench that does not pass through `apply_struct_op`, so the wasm side
      // now validates before adopting and the rejection comes back here.
      const err = engine.edit_set_tree_apply(m.json);
      if (err !== "") {
        post({ type: "edit_rejected", error: err });
        break;
      }
      // `why` names what the new tree is when it is not a hand edit — "taken
      // offer", from PERFORM's Take — and rides back on both replies so every
      // label calls it that instead of "(edited)".
      //
      // The voices take the tree before its render at a makeup that is
      // known, not at `edit_makeup()`, which is still the tree being left's:
      // that put a redone selector up to 27 dB hot until the reply. Known is
      // the page's (an offer's, measured when it grew), or the engine's
      // measurement of this exact tree from before (an undo or a redo lands
      // on a tree measured when it was made: `edit_known_makeup`). An undo or
      // a redo with neither waits for its render, as a selector does. Any
      // other rewrite still goes early at the old makeup (a structural edit;
      // the reply corrects it).
      const knownMakeup = m.makeup != null
        ? m.makeup
        : typeof engine.edit_known_makeup === "function" ? engine.edit_known_makeup() : -1;
      const known = knownMakeup > 0 ? knownMakeup : null;
      if (known != null || !m.restore) postLiveTree("restore", m.why, known);
      engine.edit_revet();
      postBench({ edited: "restore", why: m.why || undefined });
      break;
    }
    case "import_patch": {
      const id = Number(engine.import_patch(m.json, m.name || ""));
      // `import_patch` answers 0 for two opposite things — "the bank already
      // has this patch" and "this patch does not survive the vet" — because
      // `commit_edit` returns `None` for both. One is a success the app should
      // be pleased about (the picture you were sent is a patch you already
      // own); the other is a refusal. Reported as one, they became the single
      // sentence that hedged between them: "duplicate, or it failed the safety
      // vet", which tells the player to go and find out for themselves.
      //
      // So the answer is looked up here rather than guessed at in the UI: on a
      // 0, find the twin. Only on the failure path, so an ordinary import pays
      // nothing for it, and over the bank's forty entries at most.
      post({
        type: "patch_imported",
        id,
        duplicate: id > 0 ? 0 : bankTwinOf(m.json),
        views: tasteViews(),
        status: status(),
      });
      break;
    }
    case "save": {
      post({ type: "saved", json: engine.export_session() });
      break;
    }
    case "describe": {
      post({ type: "described", id: m.id, rack: JSON.parse(engine.describe_of(m.id)) });
      break;
    }
    // The cables of the patch in hand, measured (Plan-005 task 9e): one
    // render of the phrase with every audio cable read after every tick
    // (`edit_cable_levels`), each keyed as the rack draws it. `later`: it is
    // asked once an edit has settled, and nobody is waiting on it. The reply
    // carries the tree it measured, so a page that has moved on drops it;
    // `levels` is null with nothing open.
    case "cable_levels": {
      const levels = JSON.parse(engine.edit_cable_levels());
      post({ type: "cable_levels", token: m.token ?? null, tree: engine.edit_tree_json(), levels });
      break;
    }
    // Explain anything (Plan-005 task 10): a control's figure is the
    // performed state rendered twice, the control at its centre (`made`) and
    // turned (`turned`, absent for a control nothing turns), each measured by
    // `explain_render`, one render per turn with the player's gestures served
    // between. The lesson on filters is one render of the sound in hand with
    // the grammar's lowpass on it (`lesson_filter`), and its audition. Both
    // are `soon`: the player asked. Every request is answered, one that fails
    // with its `error`, and each reply carries the tree it was asked about.
    case "explain": {
      const reply = { type: "explain", token: m.token ?? null, tree: m.tree, k: m.k };
      try {
        await holdFloor(m, async () => {
          const k = Number.isInteger(m.k) ? m.k : undefined;
          const one = (ov) => JSON.parse(engine.explain_render(m.tree, JSON.stringify(ov || []), k));
          reply.made = one(m.made);
          if (m.turned) {
            await breathe(SOON);
            reply.turned = one(m.turned);
          }
        });
        post(reply);
      } catch (err) {
        post({ ...reply, error: String((err && err.message) || err) });
        throw err;
      }
      break;
    }
    case "explain_lesson": {
      const reply = { type: "explain_lesson", token: m.token ?? null, tree: m.tree, cutoff: m.cutoff };
      try {
        // No cutoff: the sound in hand as it is, the lesson's first step.
        const r = engine.lesson_filter(m.tree, JSON.stringify(m.overrides || []), Number.isFinite(m.cutoff) ? m.cutoff : undefined);
        const data = JSON.parse(r.json);
        const buffer = new Float32Array(r.take_samples());
        r.free();
        post({ ...reply, data, buffer, sampleRate: engine.sample_rate() }, buffer.length ? [buffer.buffer] : []);
      } catch (err) {
        post({ ...reply, error: String((err && err.message) || err) });
        throw err;
      }
      break;
    }
    case "set_style_name": {
      // The name, and nothing else. Posting fresh views here was the first
      // post since the last fit, so a rename also showed every reweighting
      // the votes and stars had made since: the other styles changed their
      // generated names and shares at the moment the player named one. The
      // page updates its own copy; the next fit's views carry the name.
      engine.set_style_name(m.k, m.name);
      break;
    }
    case "log_event": {
      engine.log_event(m.kind, m.id, m.value);
      break;
    }
    case "set_name": {
      engine.set_name(m.id, m.name);
      post({ type: "ranked", ranked: JSON.parse(engine.ranked()) });
      break;
    }
    case "presets": {
      post({ type: "presets", rows: JSON.parse(engine.preset_list()) });
      break;
    }
    case "set_pinned": {
      // The engine is the single owner of a pin, because the engine is what
      // evicts. Holding pins in the UI beside `starsById` would repeat the
      // exact split that let the bank apologise for eviction without being
      // able to prevent it.
      const ok = engine.set_pinned(m.id, m.pinned);
      const budget = Array.from(engine.pin_budget());
      post({
        type: "pinned",
        id: m.id,
        pinned: m.pinned,
        ok,
        budget,
        ranked: JSON.parse(engine.ranked()),
        // A save changes what a generation may replace, and while one is
        // open, what its end will: a saved sound leaves `retiring` and the
        // next lowest one not kept takes its place (`openRetiring`).
        ratings: engineRatings(),
        retiring: openRetiring(),
      });
      break;
    }
    case "load_preset": {
      // A preview is about to be played, or an open (`open`: a preset
      // clicked in the bank) about to put it on the bench: `load_preset_heard`
      // keeps the audio of the one render the insert costs, so the `render`
      // or the bench's `render_of` that follows is a memo hit rather than
      // the same phrase rendered twice — about half a clicked preset's wait
      // before PERFORM has it. (Absent on a stale binary: the plain load, and
      // the second render, as before.)
      const heard = (m.preview || m.open) && typeof engine.load_preset_heard === "function";
      const id = Number(heard ? engine.load_preset_heard(m.index) : engine.load_preset(m.index));
      // Pin *here*, not in a follow-up message. The warm start posts nine
      // loads in one burst, so by the time a `set_pinned` reply could be sent
      // and re-queued, the whole burst has already run and the early picks
      // have been evicted by the late ones. This worker handles messages one
      // at a time, so pinning inside the same turn as the insert is the only
      // point at which the next load cannot have happened yet.
      if (m.pin && id > 0) engine.set_pinned(id, true);
      // `index` rides back so main can map library row -> bank id. Without it
      // the UI could never know a preset was already loaded.
      // `warm` rides along so the first-run elicitation can pair the loaded id
      // back to the preset the user picked; `preview` says the caller only
      // wants to hear it, so the UI must not haul it onto the bench.
      // `prewarm` (booth mode) wants the tree itself, to measure PERFORM's
      // wiring without opening the patch, so the tree rides back too.
      post({
        type: "preset_loaded", id, index: m.index, warm: m.warm, preview: m.preview,
        prewarm: m.prewarm, json: m.prewarm && id > 0 ? engine.tree_json_of(id) : undefined,
        views: tasteViews(), status: status(), retiring: openRetiring(),
      });
      // A preset clicked open: main answers `preset_loaded` with the bench
      // open (`edit_begin`), a round trip in which the engine is free to
      // start a background render. Its tree and makeup are known now, so
      // they are sent now, and main hands them to the voices (and PERFORM)
      // when it opens the patch — without waiting for that turn.
      if (m.open && id > 0) {
        post({ type: "bench_opening", id, index: m.index, json: engine.tree_json_of(id), makeup: engine.makeup_of(id) });
      }
      break;
    }
    // The first-run elicitation, in one turn. It used to be nine
    // `load_preset`s and then eighteen `record_duel`s from main, and the pool
    // is full by the time anyone has listened to nine sounds: each insert
    // evicts something, the six unpicked presets evicted each other on the
    // way in, and a user who took 25 s to choose lost 15 of 18 preferences
    // ("that patch is gone"). Here every unpicked preset's three duels are
    // recorded the moment it lands, before the next insert can evict it, and
    // the picks go in first and pinned so they are alive for every pairing.
    case "warm_start": {
      const ids = {};
      for (const i of m.picked) {
        // The first pick goes onto the bench next: its insert keeps its audio
        // (see `load_preset`), so the bench open is not a second render.
        const heard = i === m.picked[0] && typeof engine.load_preset_heard === "function";
        const id = Number(heard ? engine.load_preset_heard(i) : engine.load_preset(i));
        if (id > 0) {
          engine.set_pinned(id, true);
          ids[i] = id;
          // The first pick is what the player is waiting to play, and the
          // rest of this turn is eight more inserts. Posted now, it reaches
          // the voices (and PERFORM) seconds before `warm_done` does; the
          // bench follows when main's open is served.
          if (i === m.picked[0]) {
            post({ type: "warm_first", id, index: i, json: engine.tree_json_of(id), makeup: engine.makeup_of(id) });
          }
        }
      }
      let n = 0;
      for (const i of m.rest) {
        const id = Number(engine.load_preset(i));
        if (id <= 0) continue;
        ids[i] = id;
        for (const p of m.picked) {
          if (ids[p] != null && engine.record_duel(ids[p], id, true) !== false) n += 1;
        }
      }
      post({ type: "warm_done", ids, n, first: ids[m.picked[0]] ?? null, views: tasteViews(), status: status() });
      break;
    }
    case "edit_structure": {
      // A taken guess (`m.guess`, a guess as `guess` replied it) is the same
      // edit, remembered by the engine so that undoing it counts as a skip.
      const err = m.guess
        ? engine.guess_take(JSON.stringify(m.guess))
        : engine.edit_structure_apply(JSON.stringify(m.op));
      if (err !== "") {
        post({ type: "edit_rejected", error: err });
        break;
      }
      postLiveTree("structure");
      engine.edit_revet();
      postBench({ edited: "structure" });
      break;
    }
    // ---- taste instruments ----
    case "taste_views": {
      post({ type: "taste_views", views: tasteViews() });
      break;
    }
    // ---- persistence ----
    // The session's audition clip (Plan-007, ADR-015): what a sound with an
    // AUDIO IN is measured with. A capture arrives from audio-in.js on first
    // listen or NEW CLIP: `samples` is a Float32Array of `channels`
    // interleaved, at `sampleRate`; without it the clip goes back to the
    // built-in reference. A clip the engine takes changes the phrase, so the
    // crew standing (if any) is handed it again (`farmResendPhrase`), and the
    // listeners it measured again move their ratings, so the views go with
    // the reply.
    case "audition_clip": {
      postClip();
      break;
    }
    case "set_audition_clip": {
      const reply = JSON.parse(m.samples
        ? engine.set_audition_clip(m.samples, m.channels | 0, +m.sampleRate)
        : engine.clear_audition_clip());
      let resent = 0;
      if (reply.ok) resent = farmResendPhrase();
      const moved = reply.ok && (reply.remeasured?.length || reply.unmeasured?.length);
      post({
        type: "audition_clip",
        ...reply,
        farmResent: resent,
        ...(moved ? { views: tasteViews(), status: status() } : {}),
      });
      break;
    }
    // Sounds the last restore held back: a capture's recording couldn't be
    // read and it was the sound's only source, so they are kept out of the
    // pool and saved unchanged (Plan-007 task 6). The capture plate (task 4)
    // lists them and sends a new recording; until then nothing asks.
    case "render_take": {
      // RECORD's take: the input the worklet copied while RECORD was lit,
      // played through the CAPTURE's own branch and encoded here, off the
      // audio thread (render_take). Always answered: no take is a code, and
      // a throw is the dispatcher's `engine_error`, with this id.
      const take = glue.render_take(m.tree, m.key, m.samples, m.channels | 0, m.sampleRate);
      post({ type: "take_rendered", id: m.id, take: take || null, code: take ? null : "no_capture" });
      break;
    }
    case "held_sounds": {
      post({ type: "held_sounds", held: JSON.parse(engine.held_sounds()) });
      break;
    }
    case "readmit_held": {
      const reply = JSON.parse(engine.readmit_held(m.id >>> 0, m.take || ""));
      // Back in the pool, it is ranked and mapped: the views go with it.
      post({ type: "readmitted", ...reply, status: status(), ...(reply.ok ? { views: tasteViews() } : {}) });
      if (reply.ok) post({ type: "held_sounds", held: JSON.parse(engine.held_sounds()) });
      break;
    }
    case "export": {
      // `reason` is echoed so main can name a safety copy for what it is.
      post({ type: "exported", json: engine.export_profile(), reason: m.reason || null });
      break;
    }
    case "import": {
      const ok = engine.import_profile(m.json);
      lastStylesObs = -1;
      obsAtFit = -1;
      post({ type: "imported", ok, status: status() });
      break;
    }
  }
}
