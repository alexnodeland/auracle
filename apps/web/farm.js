// AURACLE render farm worker — a wasm instance and nothing else.
//
// It owns no Engine, no pool, no RNG and no session state. It has two jobs,
// each a pure function of its arguments: `farm_render(tree, phrase) ->
// {features, samples}` for boot's fill and restore, and `farm_walk(context,
// job) -> result` for a generation's walks and ⚡ evolve from this. So any farm
// worker is interchangeable with any other and with the engine worker itself.
// That is what lets the engine hand out work by *index*, re-issue a lost job
// to whoever is free, and throw away speculative work past the stop point
// without any of it touching the pool.
//
// A crew is spawned for boot and reaped when boot ends, and spawned again on
// demand for walks and reaped after a minute with nothing to do: N × ~15 MB of
// linear memory is not kept resident behind a running instrument.
//
// It never talks to the main thread after boot. Main spawns it, hands it one
// end of a MessageChannel whose other end went into the engine worker, and
// steps out of the data path — so ~565 KB audition buffers never cross the
// thread that is drawing the UI. (Spawning here rather than from inside the
// engine worker is deliberate: nested dedicated workers only landed in Safari
// 16.4, and transferring a port is universal.)

const V = new URL(self.location.href).searchParams.get("v") || Date.now();

const EMPTY = new Float32Array(0);

let wasm = null;      // the glue module, once initialized
let phrase = null;    // the audition stimulus, from the engine's handshake
let port = null;

// ---------- the persistent render cache ----------
//
// φ is a pure function of `(term, spec)` — that is the featurizer's stated
// determinism contract — so a featurization this browser has already performed
// can be replayed instead of re-rendered. Without it every reload re-renders
// the whole bank from nothing: ~48 candidates at ~0.5 s each, for numbers the
// machine computed yesterday.
//
// It lives here, in the farm worker, rather than in the engine worker's
// `runFarm`. That loop has real ordering invariants — an absorb cursor that
// must advance strictly in index order, a re-issue watchdog, speculative work
// past the stop point — and threading an async lookup through it would put
// asynchrony inside the one place that must not acquire any. Here a hit is
// simply a job that returns fast, so every one of those invariants is
// untouched, and N farm workers get N parallel caches for free.
//
// **Correctness rests on the namespace, not on this file.** `cache_namespace`
// pins the stimulus *and* `RENDER_EPOCH`, the featurizer's own generation, and
// the engine re-verifies each row's key against the tree before folding it in
// (`WasmEngine::pre_featurized`). A build whose φ differs cannot read rows
// written by another: the namespace does not match, so there is no stale-row
// path to get wrong.
const CACHE_DB = "auracle-renders";
const CACHE_STORE = "rows";
const CACHE_META = "meta";

// Rows retained before the store is dropped wholesale. ~1 KB each, so this is
// ~20 MB. Eviction is "clear everything", which is crude and deliberately so:
// an LRU needs an access-time write on every *hit*, turning the cheap path into
// a write, and the thing being protected is a disk quota rather than a working
// set. A cleared cache costs one slow boot.
const CACHE_MAX_ROWS = 20000;

let cacheDb = null;         // IDBDatabase, or null if unavailable
let cacheNs = null;         // namespace string for the current phrase

function idbReq(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Never throws and never rejects: a browser with IndexedDB disabled, a private
// window, or a quota refusal must cost a slower boot and nothing else.
async function cacheOpen(ns) {
  try {
    if (!self.indexedDB) return;
    const open = indexedDB.open(CACHE_DB, 1);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(CACHE_STORE)) db.createObjectStore(CACHE_STORE);
      if (!db.objectStoreNames.contains(CACHE_META)) db.createObjectStore(CACHE_META);
    };
    const db = await idbReq(open);
    const prev = await idbReq(
      db.transaction(CACHE_META, "readonly").objectStore(CACHE_META).get("ns")
    );
    const count = await idbReq(
      db.transaction(CACHE_STORE, "readonly").objectStore(CACHE_STORE).count()
    );
    // The whole invalidation policy, in one condition. φ moving orphans every
    // row measured under the old φ, and nothing finer is correct.
    if (prev !== ns || count > CACHE_MAX_ROWS) {
      await idbReq(db.transaction(CACHE_STORE, "readwrite").objectStore(CACHE_STORE).clear());
      await idbReq(
        db.transaction(CACHE_META, "readwrite").objectStore(CACHE_META).put(ns, "ns")
      );
    }
    cacheDb = db;
  } catch (_) {
    cacheDb = null;
  }
}

async function cacheGet(key) {
  if (!cacheDb || !key) return null;
  try {
    return (
      (await idbReq(
        cacheDb.transaction(CACHE_STORE, "readonly").objectStore(CACHE_STORE).get(key)
      )) || null
    );
  } catch (_) {
    return null;
  }
}

// Fire-and-forget: a failed write is a slower boot next time, never a failed
// render now, so nothing waits on it and nothing reports it.
function cachePut(key, cached) {
  if (!cacheDb || !key) return;
  try {
    cacheDb.transaction(CACHE_STORE, "readwrite").objectStore(CACHE_STORE).put(cached, key);
  } catch (_) {}
}

// A job whose render throws is reported as a *failure*, not a silence: the
// engine consumes the draw index either way, and a worker that goes quiet
// stalls the absorb cursor until the watchdog fires. Saying so immediately is
// the difference between one lost render and a 30 s pause.
async function onJob(m) {
  if (m.type === "phrase") {
    // The namespace is a pure function of the stimulus and the featurizer
    // generation, so it is known as soon as the phrase is, and every row this
    // worker reads or writes is scoped by it.
    try {
      cacheNs = wasm ? wasm.cache_namespace(m.json) : null;
    } catch (_) {
      cacheNs = null;
    }
    // Skew between this instance and the engine's. Comparing build stamps
    // cannot find it: this script, the engine worker's and both URLs of the
    // binary carry main's one stamp, so the old check compared main's stamp
    // with itself. What can differ is the binary each instance actually
    // loaded, when the compiled module could not be shared and each fetched
    // its own. So the engine sends the namespace *its* binary computes for
    // this phrase (the stimulus and the featurizer's `RENDER_EPOCH`), and a
    // worker whose binary computes another refuses rather than render or walk
    // under a measurement the engine does not make. The engine sees a worker
    // that never accepts work and falls back.
    if (m.ns != null && cacheNs != null && m.ns !== cacheNs) {
      cacheNs = null;
      port.postMessage({ type: "refused", reason: `render namespace ${m.ns} is not this binary's` });
      return; // `phrase` stays unset, so a job already on its way is declined
    }
    phrase = m.json;
    if (cacheNs) await cacheOpen(cacheNs);
    return;
  }
  if (m.type === "bye") {
    self.close();
    return;
  }
  if (m.type === "walk_context") {
    // A generation's shared half: the tilted prior, the posterior's draws,
    // the standardizer (about 2 MB of JSON). Sent once per worker per
    // generation and kept as the exact text, because `farm_walk` keeps the
    // parsed context keyed by that text: the same string with every job is
    // one parse per worker per generation, not one per walk.
    walkContext = m.text;
    return;
  }
  if (m.type === "walk") {
    onWalk(m);
    return;
  }
  if (m.type !== "job") return;

  // `cannot`, emphatically not `done ok:false`. A vetting failure and a
  // *worker* failure look the same from the engine's side and are not remotely
  // the same thing: `ok:false` consumes the draw index and drops the candidate,
  // so a broken worker answering that way would silently rewrite the bank. This
  // says "not me" — the engine drops this worker and re-issues the index.
  if (!wasm || !phrase) {
    port.postMessage({ type: "cannot", i: m.i, reason: "not initialized" });
    return;
  }
  // Consulted only when audio is not wanted, and that is the whole subtlety.
  // A stored row is φ without samples, so serving one to a job that asked for
  // audio would trade this render for a lazy one at the moment the user presses
  // ▶ — moving the cost onto the first patches they actually audition, which is
  // exactly where `wantAudio` exists to avoid it. The few jobs that ask for
  // audio render; the rest, which is nearly all of them, can hit.
  let cacheKey = null;
  if (!m.wantAudio && cacheDb) {
    try {
      cacheKey = wasm.farm_key(m.tree, phrase);
    } catch (_) {
      cacheKey = null;
    }
    const row = await cacheGet(cacheKey);
    if (row) {
      // The engine re-derives the key from the tree it holds at this index and
      // drops the row if it disagrees, so a hit is checked rather than trusted.
      // `hit` is telemetry only — the engine counts them to report a hit rate,
      // and treats the message identically either way.
      port.postMessage({ type: "done", i: m.i, ok: true, cached: row, samples: EMPTY, hit: true });
      return;
    }
  }

  let job = null;
  try {
    job = wasm.farm_render(m.tree, phrase, !!m.wantAudio);
  } catch (e) {
    // `farm_render` reports a quarantined draw as `ok:false` rather than
    // throwing, so a throw here means the *instance* is broken, not the term.
    port.postMessage({ type: "cannot", i: m.i, reason: String((e && e.message) || e) });
    return;
  }
  try {
    if (!job.ok) {
      // A quarantined draw. Normal, and the engine treats it as one.
      port.postMessage({ type: "done", i: m.i, ok: false });
      return;
    }
    const cached = job.cached;
    cachePut(cacheKey, cached);
    // Already a JS-owned copy out of linear memory, so it transfers zero-copy
    // from here — the buffer crosses to the engine worker without ever being
    // seen by the main thread.
    const samples = m.wantAudio ? job.take_samples() : EMPTY;
    port.postMessage(
      { type: "done", i: m.i, ok: true, cached, samples },
      samples.byteLength ? [samples.buffer] : []
    );
  } finally {
    // wasm-bindgen structs are not GC'd: leaking one per job would leak the
    // whole boot's worth of feature JSON inside this instance's linear memory.
    job.free();
  }
}

// ---------- walks (RFC-001) ----------
//
// One refinement walk of a generation, or ⚡ evolve from this: `farm_walk` is
// the engine's `run_walk` with no engine anywhere, a pure function of the
// context and the job, so which worker runs it (or the engine worker itself)
// cannot change the child. The result goes back as the JSON the engine
// absorbs; the engine folds results in job order, so this worker never needs
// to know where in the generation its job sits.
let walkContext = null;

function onWalk(m) {
  // `phrase` unset: not initialized, or this binary refused the engine's.
  if (!wasm || typeof wasm.farm_walk !== "function" || walkContext == null || phrase == null) {
    port.postMessage({ type: "cannot", i: m.i, walk: true, reason: "not initialized" });
    return;
  }
  const t0 = performance.now();
  let result = "";
  try {
    result = wasm.farm_walk(walkContext, m.job);
  } catch (e) {
    port.postMessage({ type: "cannot", i: m.i, walk: true, reason: String((e && e.message) || e) });
    return;
  }
  // "" is a context or job that did not parse: a broken caller or instance,
  // not a walk that found nothing. The engine runs that job itself.
  if (!result) {
    port.postMessage({ type: "cannot", i: m.i, walk: true, reason: "walk did not parse" });
    return;
  }
  port.postMessage({ type: "walked", i: m.i, result, ms: performance.now() - t0 });
}

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type !== "boot") return;
  port = m.port;
  try {
    const glue = await import(m.glue || `./pkg/auracle_wasm.js?v=${V}`);
    // `module` is the already-compiled WebAssembly.Module main shares across
    // every instance — one compile, N instantiations. When structured-cloning
    // it is unsupported the farm fetches the binary itself: N compiles and a
    // slower start, still correct.
    await glue.default({
      module_or_path: m.module || new URL(m.url || `./pkg/auracle_wasm_bg.wasm?v=${V}`, self.location.href),
    });
    wasm = glue;
  } catch (err) {
    // Never post `ready`. The engine simply never issues to us, and if no farm
    // worker ever reports in it takes the serial path — a slower boot, not a
    // broken one.
    try {
      port.postMessage({ type: "failed", reason: String((err && err.message) || err) });
    } catch (_) {}
    return;
  }
  // Serialized, because `onJob` became async when the cache lookup landed and
  // it used to be strictly synchronous. The engine issues one job per worker
  // at a time, so today nothing would interleave anyway — but that is the
  // engine's invariant, not this file's, and a worker that quietly starts two
  // renders because the scheduler changed upstream is a bug nobody would look
  // for here. A rejection is swallowed for the same reason failures inside
  // `onJob` are reported rather than thrown: this worker must never die
  // silently, because the engine reads silence as a hung render.
  let chain = Promise.resolve();
  port.onmessage = (ev) => {
    chain = chain.then(() => onJob(ev.data)).catch((e) => {
      try {
        port.postMessage({
          type: "cannot",
          i: ev.data && ev.data.i,
          reason: String((e && e.message) || e),
        });
      } catch (_) {}
    });
  };
  port.postMessage({ type: "ready", build: V });
};
