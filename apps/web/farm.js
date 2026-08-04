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

// A job whose render throws is reported as a *failure*, not a silence: the
// engine consumes the draw index either way, and a worker that goes quiet
// stalls the absorb cursor until the watchdog fires. Saying so immediately is
// the difference between one lost render and a 30 s pause.
function onJob(m) {
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
  port.onmessage = (ev) => onJob(ev.data);
  port.postMessage({ type: "ready", build: V });
};
