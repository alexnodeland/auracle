// RICERCAR engine worker: owns the wasm engine so rendering and MCMC never
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

const post = (msg, transfer) => self.postMessage(msg, transfer || []);

const status = () => JSON.parse(engine.status());

// ---------- long-op signalling ----------
//
// `engine.fit()` and the refine loop are *synchronous* wasm calls that run for
// seconds to minutes (a generation is 3 seeds x up to 48 MH steps x ~0.5 s of
// rendering). For their whole duration this worker services no messages at
// all: a `render` asked for the instant the user pressed ▶ sits in the queue
// behind them.
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

function farmSetup(ports) {
  for (let k = 0; k < ports.length; k++) {
    const f = { port: ports[k], ready: false, alive: !farmPreDead.has(k), job: null, index: k };
    if (!f.alive) {
      farm.push(f);
      continue;
    }
    f.port.onmessage = (ev) => onFarmMessage(f, ev.data);
    // Posted before the worker has finished initializing; the port buffers it
    // until the far side sets `onmessage`, which is exactly when it can use it.
    f.port.postMessage({ type: "phrase", json: engine.phrase_json(), build: V });
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
  console.warn(`[ricercar] farm worker ${f.index} out: ${reason || "unknown"}`);
  if (farmSink) farmSink.lost(f);
}

function onFarmMessage(f, m) {
  switch (m.type) {
    case "ready":
      f.ready = true;
      if (farmSink) farmSink.wake();
      return;
    case "failed":
    case "refused":
      // Never became usable (init failed, or it refused a build it could not
      // vouch for). We simply never issue to it again.
      farmDrop(f, m.reason || m.type);
      return;
    case "cannot":
      // It had the job and could not do it. Not the draw's fault.
      farmDrop(f, m.reason || "declined a job");
      return;
    case "done":
      if (farmSink) farmSink.done(f, m);
      return;
  }
}

function farmLost(index, reason) {
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
// and the happy path has already called it by then.
let farmClosed = false;
function farmShutdown() {
  if (farmClosed) return;
  farmClosed = true;
  farmSay({ type: "bye" });
  for (const f of farm) f.alive = false;
  farmSink = null;
  post({ type: "farm_done" });
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

    const finish = () => {
      if (finished) return;
      finished = true;
      for (const s of inflight.values()) clearTimeout(s.timer);
      inflight.clear();
      farmSink = null;
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
        // — a silently different bank is far worse than a slow one.
        console.warn(`[ricercar] draw ${i} retired after ${state.tries} attempts`);
        results.set(i, { ok: false });
      } else {
        queue.unshift({ i, tree: state.tree, tries: retirable ? state.tries : state.tries - 1 });
      }
    };

    const onTimeout = (i) => {
      const state = inflight.get(i);
      if (!state || finished) return;
      console.warn(`[ricercar] draw ${i} timed out; re-issuing`);
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
        if (!prev || (!prev.ok && m.ok)) results.set(m.i, m);
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
async function restoreSession(saved, farmed, stages) {
  if (!farmed) return engine.import_session(saved);

  let jobs = null;
  try {
    jobs = JSON.parse(engine.import_session_deferred(saved));
  } catch (err) {
    // A binary without the deferred surface (stale cache): today's path.
    console.warn("[ricercar] deferred restore unavailable:", err);
    return engine.import_session(saved);
  }
  if (!Array.isArray(jobs) || jobs.length === 0) {
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
        // `false` here is a genuine vet failure: the entry no longer
        // featurizes, and `import_state` drops it too.
        if (engine.bank_absorb(i, r.cached, r.samples || EMPTY_F32)) landed++;
        return;
      }
      // `!ok` on this path is a *watchdog retirement*, not a verdict on the
      // patch — and a retired index here would silently delete a patch the
      // user made and kept, then let the next autosave persist the shortened
      // bank. Render it in this worker instead. It costs one blocking render
      // in a rare case and keeps the bank exactly what `import_state` builds,
      // in exactly its order, which is what `deferred_restore_equals_import_state`
      // pins.
      console.warn(`[ricercar] bank entry ${i} not farmed; rendering in-worker`);
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
        label: `recalling ${landed} of ${jobs.length} patches…`,
      }),
  });
  // Whatever the farm did not finish (every worker died, a draw retired) is
  // rendered here, in bank order, so the pool comes back in the order it was
  // saved in whichever path ran.
  for (let i = next; i < jobs.length; i++) {
    if (engine.bank_render(i)) landed++;
  }
  return engine.restore_finish();
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
  };
}

function postBench(extra) {
  const buf = engine.edit_render();
  const arr = new Float32Array(buf);
  post(
    {
      type: "bench",
      rack: JSON.parse(engine.edit_describe()),
      vetOk: engine.edit_vet_ok(),
      sampleRate: engine.sample_rate(),
      buffer: arr,
      treeJson: engine.edit_tree_json(),
      makeup: engine.edit_makeup(),
      ...extra,
    },
    [arr.buffer]
  );
}

self.onmessage = async (e) => {
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
        const mod = await import(`./pkg/ricercar_wasm.js?v=${V}`);
        await mod.default({
          // Main compiled the binary once and shares the `WebAssembly.Module`
          // with every worker; instantiating from it skips a second compile of
          // ~2 MB. Absent (or unsupported), fetch it as before.
          module_or_path:
            m.module || new URL(`./pkg/ricercar_wasm_bg.wasm?v=${V}`, self.location.href),
        });
        WasmEngine = mod.WasmEngine;
        engine = new WasmEngine(BigInt(m.seed >>> 0), m.poolSize);
        post({ type: "ready" });

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
            console.warn("[ricercar] farm unavailable:", err);
            farmed = false;
          }
        }
        if (!farmed && farm.length) {
          console.warn("[ricercar] no farm worker reported ready; filling serially");
          farmShutdown();
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
            label: `recalled ${restored} patches`,
          });
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
        // Boot is over: the farm exists only for it. N × ~15 MB of linear memory
        // is not something to keep resident behind a running instrument.
        farmShutdown();
        post({ type: "filled", status: st, restored });
        // Taste continuity: re-fit from the restored log so the map and
        // styles come back with the bank.
        //
        // `engine.fit()` blocks this worker for seconds, and on the restore path
        // the fill loop never ran, so nothing has yielded since `playable` went
        // out. Main has already answered it with a `{type:"duel"}` and will
        // follow with the pair's two `{type:"render"}`s — all of which would sit
        // behind the fit, dropping the veil onto a frozen, empty duel table.
        // Drain them first: one macrotask for the duel, two more for its
        // renders.
        if (restored > 0 && st.observations > 0) {
          for (let i = 0; i < 3; i++) await yieldToQueue();
          beginLongOp();
          try {
            engine.fit();
            post({ type: "fitted", views: tasteViews(), status: status() });
          } finally {
            endLongOp();
          }
        }
      } catch (err) {
        console.error("[ricercar] boot failed:", err);
        post({ type: "boot_failed", error: String((err && err.message) || err) });
      } finally {
        farmShutdown();
      }
      break;
    }
    // A farm worker died (main saw its `onerror`, or its port closed). Drop it
    // and re-issue whatever it was holding, by index — the tree is recoverable
    // from `(fill_seed, i)`, so nothing was lost but the render.
    case "farm_lost": {
      farmLost(m.index, m.reason);
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
        const ex = JSON.parse(engine.next_duel_ex());
        if (ex && ex.a != null) {
          pair = [ex.a, ex.b];
          meta = ex;
        }
      } catch (_) {
        pair = JSON.parse(engine.next_duel());
      }
      post({ type: "duel", pair, meta });
      // Renders are lazy now (`RenderPolicy::Lazy`): the pool holds φ for
      // everything and audio for only the last dozen auditions, so the pair
      // just dealt is very likely cold. Materialize both sides *here*, after
      // the pair has been posted — main gets its cards immediately, and the
      // `render` requests that follow are served from a resident buffer
      // instead of queueing behind two fresh renders.
      //
      // `prefetch_render` is newer than the binary a stale browser cache can
      // hand us (see this file's header); a miss just means `render_of` does
      // the work a moment later, which is exactly the un-prefetched path.
      if (pair) {
        for (const id of pair) {
          try { engine.prefetch_render(id); } catch (_) { break; }
        }
      }
      break;
    }
    case "explain": {
      // Exact per-feature contributions under the candidate's best style lens.
      // Utility is linear within a lens, so this is a decomposition, not a
      // surrogate approximation.
      try {
        post({ type: "explained", id: m.id, ex: JSON.parse(engine.explain(m.id) || "null") });
      } catch (_) {
        post({ type: "explained", id: m.id, ex: null });
      }
      break;
    }
    case "calibration": {
      try {
        post({ type: "calibration", calib: JSON.parse(engine.calibration()) });
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
      break;
    }
    case "record_duel": {
      // Prediction is computed BEFORE the vote enters the log — this is the
      // model's honest forecast, scored against the user's actual choice.
      const pred = engine.duel_pred(m.a, m.b);
      engine.record_duel(m.a, m.b, m.choseA);
      post({ type: "status", status: status(), pred, choseA: m.choseA });
      break;
    }
    // The forecast alone, for immediate display: the vote itself is buffered
    // behind an undo window on the main thread, but its payoff line must not
    // arrive seven seconds late.
    case "duel_pred": {
      post({ type: "duel_pred", pred: engine.duel_pred(m.a, m.b), choseA: m.choseA });
      break;
    }
    case "record_keep": {
      engine.record_keep(m.id, m.kept);
      post({ type: "status", status: status() });
      break;
    }
    case "record_stars": {
      engine.record_stars(m.id, m.rating);
      post({ type: "status", status: status() });
      break;
    }
    case "fit": {
      beginLongOp();
      try {
        engine.fit();
        post({ type: "fitted", views: tasteViews(), status: status() });
      } finally {
        endLongOp();
      }
      break;
    }
    case "refine": {
      // Driven one seed at a time so the UI can show progress and say what
      // actually happened. A generation is tens of seconds of render-bound
      // work; as one opaque call it reads as a hang.
      beginLongOp();
      try {
        let seeds = [];
        try {
          seeds = JSON.parse(engine.refine_begin());
        } catch (_) {
          engine.refine(); // older engine: single-shot
          post({ type: "refined", views: tasteViews(), status: status(), born: null });
          break;
        }
        if (seeds.length === 0) {
          // No posterior yet — nothing to refine *toward*. Report it rather
          // than burning a minute to produce nothing.
          post({ type: "refined", views: tasteViews(), status: status(), born: [], untaught: true });
          break;
        }
        const born = [];
        for (let i = 0; i < seeds.length; i++) {
          post({ type: "refine_progress", done: i, total: seeds.length });
          const childId = Number(engine.refine_seed(seeds[i]));
          if (childId > 0) born.push(childId);
        }
        post({ type: "refined", views: tasteViews(), status: status(), born });
      } finally {
        endLongOp();
      }
      break;
    }
    // ---- workbench (the interactive rack) ----
    case "edit_begin": {
      const ok = engine.edit_begin(m.id);
      if (ok) postBench({ subject: m.id });
      else post({ type: "bench_missing", id: m.id });
      break;
    }
    case "edit_param": {
      const ok = engine.edit_param(m.addr, m.value, m.isIndex);
      if (ok) postBench({ edited: m.addr, token: m.token });
      else post({ type: "edit_rejected", addr: m.addr });
      break;
    }
    case "edit_commit": {
      const id = Number(engine.edit_commit(m.asImprovement));
      post({
        type: "committed",
        id,
        views: tasteViews(),
        status: status(),
      });
      break;
    }
    case "refine_from": {
      beginLongOp();
      try {
        const childId = Number(engine.refine_from(m.id, JSON.stringify(m.locks)));
        post({
          type: "evolved_from",
          seedId: m.id,
          childId,
          views: tasteViews(),
          status: status(),
        });
      } finally {
        endLongOp();
      }
      break;
    }
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
      const err = engine.edit_set_tree(m.json);
      if (err === "") postBench({ edited: "restore" });
      else post({ type: "edit_rejected", error: err });
      break;
    }
    case "import_patch": {
      const id = Number(engine.import_patch(m.json, m.name || ""));
      post({ type: "patch_imported", id, views: tasteViews(), status: status() });
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
    case "set_style_name": {
      engine.set_style_name(m.k, m.name);
      post({ type: "taste_views", views: tasteViews() });
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
      });
      break;
    }
    case "load_preset": {
      const id = Number(engine.load_preset(m.index));
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
      post({ type: "preset_loaded", id, index: m.index, warm: m.warm, preview: m.preview, views: tasteViews(), status: status() });
      break;
    }
    case "edit_structure": {
      const err = engine.edit_structure(JSON.stringify(m.op));
      if (err === "") postBench({ edited: "structure" });
      else post({ type: "edit_rejected", error: err });
      break;
    }
    // ---- taste instruments ----
    case "taste_views": {
      post({ type: "taste_views", views: tasteViews() });
      break;
    }
    // ---- persistence ----
    case "export": {
      post({ type: "exported", json: engine.export_profile() });
      break;
    }
    case "import": {
      const ok = engine.import_profile(m.json);
      post({ type: "imported", ok, status: status() });
      break;
    }
  }
};
