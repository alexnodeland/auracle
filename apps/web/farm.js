// AURACLE render farm worker — a wasm instance and nothing else.
//
// It owns no Engine, no pool, no RNG and no session state. Its whole job is
// `farm_render(tree, phrase) -> {features, samples}`, which is a pure function
// of its arguments, so any farm worker is interchangeable with any other and
// with the engine worker itself. That is what lets the engine hand out work by
// *index*, re-issue a lost job to whoever is free, and throw away speculative
// renders past the stop point without any of it touching the pool.
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
    // Build skew is impossible by construction (main compiles one module and
    // shares it), but a stale worker script paired with a fresh engine is not:
    // refuse rather than render under a stimulus we cannot vouch for. The
    // engine sees a worker that never accepts work and falls back.
    if (m.build != null && String(m.build) !== String(V)) {
      port.postMessage({ type: "refused", reason: `build skew ${m.build} vs ${V}` });
      return;
    }
    phrase = m.json;
    // The namespace is a pure function of the stimulus and the featurizer
    // generation, so it is known as soon as the phrase is, and every row this
    // worker reads or writes is scoped by it.
    try {
      cacheNs = wasm ? wasm.cache_namespace(phrase) : null;
    } catch (_) {
      cacheNs = null;
    }
    if (cacheNs) await cacheOpen(cacheNs);
    return;
  }
  if (m.type === "bye") {
    self.close();
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
