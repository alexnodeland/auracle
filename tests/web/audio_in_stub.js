// The browser's inputs as audio_in.spec.js and audio_in_takes.spec.js stub
// them, and the page's spies on what AUDIO IN does: not a spec (Playwright
// runs `*.spec.js`), the one copy both specs share.
//
// STUB answers getUserMedia, enumerateDevices and the Permissions API from
// tones (never a real microphone), as Chrome and Edge answer: an
// unconstrained ask opens the pseudo-device "default", and the list carries
// it. SPY keeps what the fixture's tap does not see: each clip sent to the
// engine as it was before its samples were handed over, the clip's tap's
// messages, and the output. Both are init scripts a spec adds before
// `app.boot()`, so they run after the tap and before main.js.

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

const SPY = `(() => {
  // Each clip main sends the engine (\`set_audition_clip\`), read as the
  // request goes out, before its samples are transferred: the tap keeps the
  // request, its samples by then empty. A spy on postMessage itself, which
  // the tap's wrapper of the engine worker calls last.
  const clips = (window.__pwClips = []);
  const workerPost = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function (m, ...rest) {
    if (m && m.type === "set_audition_clip") {
      clips.push({ channels: m.channels, sampleRate: m.sampleRate, frames: m.samples ? m.samples.length / Math.max(1, m.channels) : 0 });
    }
    return workerPost.call(this, m, ...rest);
  };

  // What the capture's tap is told: on, off (hand the take back), drop.
  const tapSaid = (window.__pwTapSaid = []);
  const portPost = MessagePort.prototype.postMessage;
  MessagePort.prototype.postMessage = function (m, ...rest) {
    if (m && (m.type === "on" || m.type === "off" || m.type === "drop")) tapSaid.push(m.type);
    return portPost.call(this, m, ...rest);
  };

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
})();`;

/** The loudest reading at the output over `ms`, read every 100 ms in the
 *  page, on its clock: at `hz` (dB), or with `rms` the whole output's RMS
 *  (dBFS). */
const loudest = (page, hz, ms, { rms = false } = {}) =>
  page.evaluate(async ([hz, ms, rms]) => {
    let db = -Infinity;
    const end = performance.now() + ms;
    while (performance.now() < end) {
      const r = window.__pwAt(hz);
      if (r) db = Math.max(db, rms ? r.rms : r.db);
      await new Promise((done) => setTimeout(done, 100));
    }
    return db;
  }, [hz, ms, rms]);

module.exports = { STUB, SPY, loudest };
