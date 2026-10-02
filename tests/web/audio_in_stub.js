// The browser's inputs as audio_in.spec.js and audio_in_takes.spec.js stub
// them, and the page's spies on what AUDIO IN does: not a spec (Playwright
// runs `*.spec.js`), the one copy both specs share.
//
// STUB answers getUserMedia, enumerateDevices and the Permissions API from
// tones (never a real microphone), as Chrome and Edge answer: an
// unconstrained ask opens the pseudo-device "default", and the list carries
// it. INIT wraps the engine worker, records toasts and the clip's tap
// messages, and taps the output. PHRASE_SPY is prepended to worker.js to
// report the farm's phrase handshakes.

const STUB = `(() => {
  const granted0 = (() => { try { return sessionStorage.getItem("__pwMicGranted") === "1"; } catch (_) { return false; } })();
  const mic = (window.__pwMic = {
    calls: [],
    refuse: false,
    hold: null,
    granted: granted0,
    devices: [
      { deviceId: "mic-a", label: "Fake Mic A", groupId: "ga", freq: 440, present: true },
      { deviceId: "mic-b", label: "Fake Interface B", groupId: "gb", freq: 660, present: true },
    ],
    tracks: [],
    queries: 0,
    // Set before boot: Fake Mic A is mono and its track's settings name no
    // channel count, as Safari's do.
    monoA: (() => { try { return sessionStorage.getItem("__pwMonoA") === "1"; } catch (_) { return false; } })(),
    // Set before boot: "default" stands for Fake Interface B (not the first
    // input listed), in a group of its own, and its track's label is plain
    // ("Default audio input", as Chromium's fake devices label theirs); only
    // the list's "Default - Fake Interface B" says which input it is.
    defaultOwn: (() => { try { return sessionStorage.getItem("__pwDefaultOwn") === "1"; } catch (_) { return false; } })(),
  });
  const defaultDev = () => {
    const real = mic.devices.filter((d) => d.present);
    return (mic.defaultOwn && real.find((d) => d.deviceId === "mic-b")) || real[0];
  };
  let ctx = null;
  const toneCtx = () => ctx || (ctx = new AudioContext());
  function tone(freq, mono) {
    const c = toneCtx();
    const o = c.createOscillator();
    o.frequency.value = freq;
    const g = c.createGain();
    g.gain.value = 0.25;
    const d = mono
      ? new MediaStreamAudioDestinationNode(c, { channelCount: 1, channelCountMode: "explicit" })
      : c.createMediaStreamDestination();
    if (mono) {
      o.connect(g).connect(d);
    } else {
      // A stereo input: the tone on the left, half as loud on the right.
      const m = c.createChannelMerger(2);
      const half = c.createGain();
      half.gain.value = 0.5;
      o.connect(g);
      g.connect(m, 0, 0);
      g.connect(half).connect(m, 0, 1);
      m.connect(d);
    }
    o.start();
    return { stream: d.stream, osc: o };
  }
  const md = navigator.mediaDevices;
  md.getUserMedia = async (c) => {
    mic.calls.push(JSON.parse(JSON.stringify(c || {})));
    if (mic.hold) await mic.hold;
    if (mic.refuse) throw new DOMException("Permission denied", "NotAllowedError");
    mic.granted = true;
    try { sessionStorage.setItem("__pwMicGranted", "1"); } catch (_) {}
    const want = c && c.audio && c.audio.deviceId && c.audio.deviceId.exact;
    const dev = want ? mic.devices.find((d) => d.deviceId === want && d.present) : defaultDev();
    if (!dev) throw new DOMException("Requested device not found", "NotFoundError");
    const mono = mic.monoA && dev.deviceId === "mic-a";
    const { stream, osc } = tone(dev.freq, mono);
    const track = stream.getAudioTracks()[0];
    // As Chrome and Edge answer: an unconstrained ask opens the pseudo-device
    // "default", whose settings and label name it, not the real input.
    const asDefault = !want;
    track.getSettings = () => ({
      deviceId: asDefault ? "default" : dev.deviceId,
      groupId: asDefault && mic.defaultOwn ? "gdefault" : dev.groupId,
      ...(mono ? {} : { channelCount: 2 }),
    });
    const defaultLabel = mic.defaultOwn ? "Default audio input" : "Default - " + dev.label;
    Object.defineProperty(track, "label", { value: asDefault ? defaultLabel : dev.label });
    mic.tracks.push({ id: dev.deviceId, track, osc });
    return stream;
  };
  // As Chrome and Edge list them: the pseudo-device "default" first, in the
  // group of the input it stands for, then the real inputs.
  md.enumerateDevices = async () => {
    const real = mic.devices.filter((d) => d.present);
    const first = defaultDev();
    const listed = first
      ? [{ deviceId: "default", groupId: mic.defaultOwn ? "gdefault" : first.groupId, label: "Default - " + first.label }, ...real]
      : real;
    return listed.map((d) => ({
      deviceId: mic.granted ? d.deviceId : "",
      groupId: d.groupId,
      kind: "audioinput",
      label: mic.granted ? d.label : "",
    }));
  };
  if (navigator.permissions) {
    const query = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = async (d) => {
      if (d && d.name === "microphone") {
        mic.queries += 1;
        return { state: mic.granted ? "granted" : mic.refuse ? "denied" : "prompt", onchange: null };
      }
      return query(d);
    };
  }
  window.__pwUnplug = (id) => {
    const d = mic.devices.find((x) => x.deviceId === id);
    if (d) d.present = false;
    for (const t of mic.tracks) {
      if (t.id !== id || t.track.readyState === "ended") continue;
      try { t.osc.stop(); } catch (_) {}
      t.track.stop();
      t.track.dispatchEvent(new Event("ended"));
    }
    md.dispatchEvent(new Event("devicechange"));
  };
  window.__pwReplug = (id) => {
    const d = mic.devices.find((x) => x.deviceId === id);
    if (d) d.present = true;
    md.dispatchEvent(new Event("devicechange"));
  };
  window.__pwLiveTracks = () => {
    const out = {};
    for (const t of mic.tracks) if (t.track.readyState === "live") out[t.id] = (out[t.id] || 0) + 1;
    return out;
  };
})();`;

const INIT = `(() => {
  const Orig = window.Worker;
  const last = (window.__pwLast = {});
  const counts = (window.__pwCounts = {});
  const sent = (window.__pwSent = []);
  const phrases = (window.__pwPhrases = []);
  function Wrapped(url, opts) {
    const w = new Orig(url, opts);
    if (/worker\\.js/.test(String(url))) {
      window.__pwEngine = w;
      const post = w.postMessage.bind(w);
      w.postMessage = (m, t) => {
        if (m && m.type === "set_audition_clip") {
          sent.push({ type: m.type, channels: m.channels, sampleRate: m.sampleRate, frames: m.samples ? m.samples.length / Math.max(1, m.channels) : 0 });
        }
        return post(m, t);
      };
      w.addEventListener("message", (e) => {
        const d = e.data;
        if (!d || typeof d.type !== "string") return;
        // The engine refusing a capture, on demand (this listener runs before
        // main's, on the same data): what it says of a silent one.
        if (window.__pwRefuseClip && d.type === "audition_clip" && d.ok === true) {
          window.__pwRefuseClip = false;
          d.ok = false;
          d.note = "That capture was silent, so nothing changed. Check the input, then capture again.";
          d.clip = { ...d.clip, source: "reference" };
          delete d.views;
        }
        last[d.type] = d;
        counts[d.type] = (counts[d.type] || 0) + 1;
        if (d.type === "__pw_phrase") phrases.push({ t: performance.now(), clip: d.clip });
      });
    }
    return w;
  }
  Wrapped.prototype = Orig.prototype;
  window.Worker = Wrapped;

  // What the capture's tap is told: on, off (hand the take back), drop.
  const tapSaid = (window.__pwTapSaid = []);
  const portPost = MessagePort.prototype.postMessage;
  MessagePort.prototype.postMessage = function (m, ...rest) {
    if (m && (m.type === "on" || m.type === "off" || m.type === "drop")) tapSaid.push(m.type);
    return portPost.call(this, m, ...rest);
  };

  const toasts = (window.__pwToasts = []);
  document.addEventListener("DOMContentLoaded", () => {
    const lane = document.getElementById("toasts");
    if (!lane) return;
    new MutationObserver((muts) => {
      for (const m of muts)
        for (const n of m.addedNodes) {
          const msg = n.querySelector && n.querySelector(".toast-msg");
          if (msg) toasts.push(msg.textContent);
        }
    }).observe(lane, { childList: true, subtree: true });
  });

  // The output tap: anything connected to a destination is also connected
  // to one analyser per context.
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...rest) {
    const r = connect.call(this, dest, ...rest);
    if (typeof AudioDestinationNode !== "undefined" && dest instanceof AudioDestinationNode) {
      let a = this.context.__pwTap;
      if (!a) {
        a = this.context.createAnalyser();
        a.fftSize = 16384;
        a.smoothingTimeConstant = 0;
        this.context.__pwTap = a;
        window.__pwTap = a;
      }
      connect.call(this, a);
    }
    return r;
  };
  // The output's level at \`hz\` (dB, the strongest bin within 3%), and its
  // peak and RMS over the window (dBFS).
  window.__pwAt = (hz) => {
    const a = window.__pwTap;
    if (!a) return null;
    const d = new Float32Array(a.frequencyBinCount);
    a.getFloatFrequencyData(d);
    const bin = a.context.sampleRate / a.fftSize;
    let db = -Infinity;
    for (let i = Math.floor((hz * 0.97) / bin); i <= Math.ceil((hz * 1.03) / bin); i++) db = Math.max(db, d[i]);
    const b = new Float32Array(a.fftSize);
    a.getFloatTimeDomainData(b);
    let peak = 0;
    let sum = 0;
    for (const x of b) { peak = Math.max(peak, Math.abs(x)); sum += x * x; }
    const rms = Math.sqrt(sum / b.length);
    return { db, peak: peak > 0 ? 20 * Math.log10(peak) : -Infinity, rms: rms > 0 ? 20 * Math.log10(rms) : -Infinity };
  };
  try {
    for (const k of ["auracle-warmed", "auracle-played", "auracle-bench-tour", "auracle-bank-toured"]) localStorage.setItem(k, "1");
  } catch (_) {}
})();`;

// Prepended to worker.js: every phrase handshake the engine worker posts to a
// farm worker's port is reported to the page, with whether it carries a clip.
const PHRASE_SPY = `{
  const post = MessagePort.prototype.postMessage;
  MessagePort.prototype.postMessage = function (m, ...rest) {
    if (m && m.type === "phrase") self.postMessage({ type: "__pw_phrase", clip: typeof m.json === "string" && m.json.includes('"clip"') });
    return post.call(this, m, ...rest);
  };
}
`;

module.exports = { STUB, INIT, PHRASE_SPY };
