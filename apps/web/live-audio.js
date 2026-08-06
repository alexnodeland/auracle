// Live instrument audio: an AudioWorklet running LivePoly (4 compiled copies
// of the current patch) per-sample on the audio thread.
//
// Worklets cannot fetch(), and static imports inside a worklet module would
// hit the browser cache un-versioned, so the worklet is assembled here as a
// blob: the wasm-bindgen glue (fetched with the build stamp) is inlined
// between a TextDecoder/TextEncoder polyfill (AudioWorkletGlobalScope lacks
// both) and the processor class; the compiled WebAssembly.Module is
// transferred over the port.

const POLYFILL = `
if (typeof TextDecoder === "undefined") {
  globalThis.TextDecoder = class {
    constructor() {}
    decode(buf) {
      if (!buf) return "";
      const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
      let s = "";
      for (let i = 0; i < b.length; ) {
        const x = b[i++];
        let c;
        if (x < 0x80) c = x;
        else if (x < 0xe0) c = ((x & 31) << 6) | (b[i++] & 63);
        else if (x < 0xf0) c = ((x & 15) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63);
        else c = ((x & 7) << 18) | ((b[i++] & 63) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63);
        if (c < 0x10000) s += String.fromCharCode(c);
        else {
          c -= 0x10000;
          s += String.fromCharCode(0xd800 + (c >> 10), 0xdc00 + (c & 1023));
        }
      }
      return s;
    }
  };
}
if (typeof TextEncoder === "undefined") {
  globalThis.TextEncoder = class {
    encode(str) {
      const out = [];
      for (const ch of str) {
        let c = ch.codePointAt(0);
        if (c < 0x80) out.push(c);
        else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
        else if (c < 0x10000)
          out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        else
          out.push(
            0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63),
            0x80 | ((c >> 6) & 63), 0x80 | (c & 63)
          );
      }
      return new Uint8Array(out);
    }
  };
}
`;

const PROCESSOR = `
class EvoVoiceProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.poly = null;
    this.ready = false;
    this.pendingPatch = null;
    // Interior metering, off until a surface asks. meterTick divides the
    // quantum rate down to the rate the animation can use. (No backticks in
    // here — this whole class is a template literal.)
    this.meterOn = false;
    this.meterTick = 0;
    this.meterView = null;
    this.meterPtr = 0;
    this.port.onmessage = (e) => {
      try {
        this.handle(e.data);
      } catch (err) {
        this.port.postMessage({ type: "worklet_error", where: e.data && e.data.type, error: String(err && err.stack || err) });
      }
    };
    this.port.onmessageerror = () => {
      this.port.postMessage({ type: "worklet_error", where: "deserialize", error: "message failed to deserialize" });
    };
    this.port.postMessage({ type: "boot" });
  }
  handle(m) {
    switch (m.type) {
      case "init": {
        // Raw bytes, compiled synchronously here: sync compile is permitted
        // off the main thread, and ArrayBuffer transfer is universally
        // supported (a transferred WebAssembly.Module is not — it arrives as
        // a messageerror in some engines).
        initSync({ module: new Uint8Array(m.bytes) });
        this.ready = true;
        if (this.pendingPatch) {
          this.loadPatch(this.pendingPatch);
          this.pendingPatch = null;
        }
        this.port.postMessage({ type: "ready" });
        break;
      }
      case "patch": {
        if (!this.ready) this.pendingPatch = m;
        else this.loadPatch(m);
        break;
      }
      case "on": if (this.poly) this.poly.note_on(m.note, m.vel == null ? 1.0 : m.vel); break;
      case "off": if (this.poly) this.poly.note_off(m.note); break;
      case "alloff": if (this.poly) this.poly.all_off(); break;
      case "bend": if (this.poly) this.poly.set_bend(m.semis); break;
      case "glide": if (this.poly) this.poly.set_glide(m.amount); break;
      case "unison": if (this.poly) this.poly.set_unison(m.on, m.detune, m.spread); break;
      case "arp":
        if (this.poly) {
          this.poly.set_arp(
            m.on, m.mode, m.div, m.bpm,
            m.gate == null ? 0.5 : m.gate,
            m.octaves == null ? 1 : m.octaves,
            m.swing == null ? 0.0 : m.swing
          );
        }
        break;
      case "rec": {
        if (m.on) {
          this.rec = [];
        } else if (this.rec) {
          // Hand the take back as one transferable block.
          let total = 0;
          for (const b of this.rec) total += b.length;
          const all = new Float32Array(total);
          let o = 0;
          for (const b of this.rec) { all.set(b, o); o += b.length; }
          this.rec = null;
          this.port.postMessage({ type: "rec_done", samples: all, sampleRate }, [all.buffer]);
        }
        break;
      }
      // Loudness makeup on its own, without a patch swap. The bench now hands
      // the worklet a new tree before the featurizer has measured its gain, so
      // the makeup that rode with the patch was one edit stale; correcting it
      // is a single atomic write, and paying for it with a second set_patch
      // would undo the whole point of speaking early.
      case "makeup": if (this.poly && m.makeup != null) this.poly.set_makeup(m.makeup); break;
      case "param": {
        // Live knob write: straight into the running voices' atomics — no
        // recompile, state survives, audible next sample. A miss means the
        // address has no live handle (enum/structural) and the caller must
        // fall back to set_patch.
        const ok = this.poly ? this.poly.set_param(m.addr, m.value) : false;
        if (!ok) this.port.postMessage({ type: "param_miss", addr: m.addr });
        break;
      }
      // Interior metering. Off is the default and the cheap path: with no
      // subscriptions the render loop does no metering work at all, so this
      // costs nothing until a surface that draws levels is actually open.
      case "meter": {
        if (!this.poly) break;
        this.meterOn = !!m.on;
        this.poly.set_meter(this.meterOn);
        this.meterView = null;
        this.port.postMessage({
          type: "meter_keys",
          keys: this.meterOn ? JSON.parse(this.poly.meter_keys()) : [],
        });
        break;
      }
    }
  }
  loadPatch(m) {
    try {
      if (this.poly) {
        // Swap is asynchronous: fade → silent per-quantum rebuild → fade-in.
        // Completion/error arrives via poll_event in process(). Makeup is
        // set AFTER set_patch so it defers to the incoming patch.
        if (!this.poly.set_patch(m.tree)) {
          this.port.postMessage({ type: "patch_error", error: "unreadable patch" });
        } else if (m.makeup != null) {
          this.poly.set_makeup(m.makeup);
        }
      } else {
        this.poly = new LivePoly(m.tree, sampleRate, 4);
        if (m.makeup != null) this.poly.set_makeup(m.makeup);
        this.port.postMessage({ type: "patched" });
      }
    } catch (err) {
      this.port.postMessage({ type: "patch_error", error: String(err) });
    }
  }
  process(inputs, outputs) {
    const out = outputs[0];
    const L = out[0];
    const R = out[1] || out[0];
    if (this.poly && L) {
      const n = L.length;
      // Zero-allocation render: the synth fills a persistent wasm buffer;
      // we view its memory directly. The cached view is rebuilt only when
      // wasm memory grows (buffer identity changes) or the pointer moves.
      const ptr = this.poly.process_ptr(n);
      if (
        !this.view ||
        this.viewPtr !== ptr ||
        this.view.length !== n * 2 ||
        this.view.buffer !== wasm.memory.buffer
      ) {
        this.view = new Float32Array(wasm.memory.buffer, ptr, n * 2);
        this.viewPtr = ptr;
      }
      const buf = this.view;
      for (let i = 0; i < n; i++) {
        L[i] = buf[2 * i];
        R[i] = buf[2 * i + 1];
      }
      // Recording copies the interleaved block (allocation only while a
      // take is rolling — never in the steady state).
      if (this.rec) this.rec.push(buf.slice(0, n * 2));
      const ev = this.poly.poll_event();
      if (ev === 1) this.port.postMessage({ type: "patched" });
      else if (ev === 2)
        this.port.postMessage({ type: "patch_error", error: this.poly.last_error() });
      // Levels out, at ~23 Hz rather than every quantum. The animation is
      // redrawn on a frame timer anyway, so posting 344 times a second would
      // buy nothing and cost a structured clone each time. Same cached-view
      // discipline as the render buffer above: rebuilt only when wasm memory
      // grows or the pointer moves.
      if (this.meterOn && ++this.meterTick >= 8) {
        this.meterTick = 0;
        const len = this.poly.meter_len();
        if (len > 0) {
          const mptr = this.poly.meter_ptr();
          if (
            !this.meterView ||
            this.meterPtr !== mptr ||
            this.meterView.length !== len ||
            this.meterView.buffer !== wasm.memory.buffer
          ) {
            this.meterView = new Float32Array(wasm.memory.buffer, mptr, len);
            this.meterPtr = mptr;
          }
          this.port.postMessage({ type: "meter", db: Array.from(this.meterView) });
        }
      }
    }
    return true;
  }
}
registerProcessor("auracle-voice", EvoVoiceProcessor);
`;

export async function initLiveAudio(audioCtx, build, dest) {
  const glue = await (await fetch(`./pkg/auracle_wasm.js?v=${build}`)).text();
  const inlined = glue
    .replace(/^export class /gm, "class ")
    .replace(/^export (function|const|let) /gm, "$1 ")
    .replace(/^export \{[^}]*\};?\s*$/gm, "");
  const src = `${POLYFILL}\n${inlined}\n${PROCESSOR}`;
  const blobUrl = URL.createObjectURL(new Blob([src], { type: "application/javascript" }));
  await audioCtx.audioWorklet.addModule(blobUrl);
  URL.revokeObjectURL(blobUrl);

  const bytes = await (await fetch(`./pkg/auracle_wasm_bg.wasm?v=${build}`)).arrayBuffer();

  const node = new AudioWorkletNode(audioCtx, "auracle-voice", {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });
  const gain = audioCtx.createGain();
  gain.gain.value = 0.8;
  // Tapped pre-master so the on-screen trace shows what the *instrument* is
  // doing, not what the volume slider is doing.
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.6;
  node.connect(analyser);
  node.connect(gain).connect(dest || audioCtx.destination);
  // …and a second tap after the master gain. Which of the two the scope draws
  // is a real choice — "what the instrument is doing" and "what is coming out
  // of the speakers" differ by everything the volume control does — and it
  // used to be made silently, in this file, for everyone. An analyser is a
  // pass-through with nothing connected downstream, so this costs one FFT
  // only while something is actually reading it.
  const analyserPost = audioCtx.createAnalyser();
  analyserPost.fftSize = 2048;
  analyserPost.smoothingTimeConstant = 0.6;
  gain.connect(analyserPost);
  node.port.postMessage({ type: "init", bytes }, [bytes]);

  return {
    node,
    analyser,
    analyserPost,
    onMessage(fn) {
      node.port.onmessage = (e) => fn(e.data);
    },
    setPatch(tree, makeup) {
      node.port.postMessage({ type: "patch", tree, makeup });
    },
    setMakeup(makeup) {
      node.port.postMessage({ type: "makeup", makeup });
    },
    noteOn(note, vel) {
      node.port.postMessage({ type: "on", note, vel });
    },
    noteOff(note) {
      node.port.postMessage({ type: "off", note });
    },
    param(addr, value) {
      node.port.postMessage({ type: "param", addr, value });
    },
    allOff() {
      node.port.postMessage({ type: "alloff" });
    },
    bend(semis) {
      node.port.postMessage({ type: "bend", semis });
    },
    glide(amount) {
      node.port.postMessage({ type: "glide", amount });
    },
    unison(on, detune, spread) {
      node.port.postMessage({ type: "unison", on, detune, spread });
    },
    arp(on, mode, div, bpm, gate, octaves, swing) {
      node.port.postMessage({ type: "arp", on, mode, div, bpm, gate, octaves, swing });
    },
    rec(on) {
      node.port.postMessage({ type: "rec", on });
    },
    // Interior level metering for the rack's flow animation. Replies with
    // `meter_keys` (the module keys the values are indexed by) and then
    // `meter` messages carrying RMS dB per tap.
    meter(on) {
      node.port.postMessage({ type: "meter", on });
    },
    setVolume(v) {
      // A step assignment zippers audibly while notes sound; a 10ms time
      // constant is inaudible as a lag and silent as an artifact.
      gain.gain.setTargetAtTime(v, audioCtx.currentTime, 0.01);
    },
  };
}
