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
        if (!this.ready) this.pendingPatch = m.tree;
        else this.loadPatch(m.tree);
        break;
      }
      case "on": if (this.poly) this.poly.note_on(m.note); break;
      case "off": if (this.poly) this.poly.note_off(m.note); break;
      case "alloff": if (this.poly) this.poly.all_off(); break;
    }
  }
  loadPatch(tree) {
    try {
      if (this.poly) this.poly.set_patch(tree);
      else this.poly = new LivePoly(tree, sampleRate, 4);
      this.port.postMessage({ type: "patched" });
    } catch (err) {
      this.port.postMessage({ type: "patch_error", error: String(err) });
    }
  }
  process(inputs, outputs) {
    const out = outputs[0];
    const L = out[0];
    const R = out[1] || out[0];
    if (this.poly && L) {
      const buf = this.poly.process(L.length);
      for (let i = 0; i < L.length; i++) {
        L[i] = buf[2 * i];
        R[i] = buf[2 * i + 1];
      }
    }
    return true;
  }
}
registerProcessor("evosynth-voice", EvoVoiceProcessor);
`;

export async function initLiveAudio(audioCtx, build) {
  const glue = await (await fetch(`./pkg/evosynth_wasm.js?v=${build}`)).text();
  const inlined = glue
    .replace(/^export class /gm, "class ")
    .replace(/^export (function|const|let) /gm, "$1 ")
    .replace(/^export \{[^}]*\};?\s*$/gm, "");
  const src = `${POLYFILL}\n${inlined}\n${PROCESSOR}`;
  const blobUrl = URL.createObjectURL(new Blob([src], { type: "application/javascript" }));
  await audioCtx.audioWorklet.addModule(blobUrl);
  URL.revokeObjectURL(blobUrl);

  const bytes = await (await fetch(`./pkg/evosynth_wasm_bg.wasm?v=${build}`)).arrayBuffer();

  const node = new AudioWorkletNode(audioCtx, "evosynth-voice", {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });
  const gain = audioCtx.createGain();
  gain.gain.value = 0.8;
  node.connect(gain).connect(audioCtx.destination);
  node.port.postMessage({ type: "init", bytes }, [bytes]);

  return {
    node,
    onMessage(fn) {
      node.port.onmessage = (e) => fn(e.data);
    },
    setPatch(tree) {
      node.port.postMessage({ type: "patch", tree });
    },
    noteOn(note) {
      node.port.postMessage({ type: "on", note });
    },
    noteOff(note) {
      node.port.postMessage({ type: "off", note });
    },
    allOff() {
      node.port.postMessage({ type: "alloff" });
    },
    setVolume(v) {
      gain.gain.value = v;
    },
  };
}
