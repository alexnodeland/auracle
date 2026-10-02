// AUDIO IN on the main thread (Plan-007 task 4, ADR-015): the permission, the
// inputs, the live worklet's input, monitoring, the clip, and the module's
// lane on the rack.
//
// What it owns, and the rules it keeps:
//
// - **Permission only when a node is added.** Nothing here asks at boot. The
//   first `added()` (a player's gesture placing an AUDIO IN, from
//   `queueStruct` in main.js) asks the browser; a sound that listens opened
//   later is given its input without a prompt only if the browser already
//   granted one (`navigator.permissions`), and otherwise shows ALLOW INPUT on
//   the module. A refusal keeps the node and plays it silent.
// - **One capture stream per input.** An input is a device; the engine's
//   `input` knob is a slot (1 to 8) in the player's list of inputs, kept here
//   (`auracle-inputs` in localStorage: slot → device id and label), so a saved
//   sound keeps its slot when the hardware changes. Each device the bench
//   reads is opened once (`getUserMedia`) and its one `MediaStreamAudioSourceNode`
//   fans out to every module that reads it: each module's meter, the voices,
//   and the clip's capture.
// - **The voices take one input.** `LivePoly` binds one input stream that
//   every AUDIO IN in every voice reads, so the worklet is fed the device of
//   the bench's first AUDIO IN (in walk order). A module reading another slot
//   shows its own meter and says "meter only".
// - **Monitoring starts off**, every load, and is never saved: a microphone
//   into speakers feeds back. On, the voices' input is written each quantum
//   and a patch that listens is held open (`LivePoly::set_open`); off, nothing
//   is written and the open voice is let go. The meter reads the input either
//   way, so the player sees it before they hear it.
// - **The clip on first listen.** The first time the voices' input carries a
//   signal and the session has no captured clip, `CLIP_SECONDS` of it are
//   captured (the worklet's tap processor) and sent to the engine as the
//   session's audition clip (`set_audition_clip`), which measures every sound
//   that listens with it. NEW CLIP captures again.
// - **Devices come and go.** A track that ends or a device that leaves the
//   list silences its modules and says so; the same device back is reopened.
//
// Nothing here runs on the audio thread: the worklet (live-audio.js) writes
// the input into LivePoly, and this module only connects nodes and paints.

const W = await import(new URL(`./words.js${new URL(import.meta.url).search}`, import.meta.url).href);

const SVG_NS = "http://www.w3.org/2000/svg";
/** `INPUT_SLOTS` in auracle-grammar: how many inputs a node can name. */
export const INPUT_SLOTS = 8;
const STORE = "auracle-inputs";
/** How long a clip is captured for. The engine cuts a clip to the phrase
 *  (about 5.05 s), and a clip shorter than the phrase falls silent at its end,
 *  so this leaves room over it. */
export const CLIP_SECONDS = 6;
/** The level (RMS, dBFS) the input must reach before a first-listen capture
 *  starts: a clip of a quiet room would be refused as silent, or measure every
 *  sound that listens on hiss. */
const CLIP_SIGNAL_DB = -50;
/** The meter's floor and ceiling, dBFS. */
const METER_FLOOR_DB = -60;
/** The face slot's side on the module (rack units). */
const FACE = 44;
/** The most characters the input line holds: 26 mono characters at the
 *  rack's label size fill the 168 units left of the face slot. */
const LINE_CHARS = 26;
/** The lane's height under the knobs (rack units): see `drawLane`. */
export const INPUT_LANE_H = 66;
/** How long the stream a first ask opened is kept for the edit that placed
 *  the module to land (ms). */
const ASK_HOLD_MS = 15000;

export function createAudioIn(host) {
  const md = typeof navigator !== "undefined" ? navigator.mediaDevices : null;
  const ctx = host.ctx;
  // unknown → prompt | granted (from the Permissions API, when it answers)
  // asking → granted | refused | missing | failed (from our own ask)
  // unsupported: no mediaDevices at all.
  let perm = md && md.getUserMedia ? "unknown" : "unsupported";
  let permQueried = false;
  let list = load();               // slot → {id, label}
  let present = new Map();         // device id → label, from enumerateDevices
  let enumerated = false;
  const streams = new Map();       // device id → {stream, track, source, analyser, buf, channels, db}
  const opening = new Set();       // device ids with a getUserMedia out
  const unplugged = new Set();     // device ids that went away while in use
  let want = [];                   // the bench's AUDIO INs: [{key, addr, slot}]
  let voiceId = null;              // the device the voices read
  let voiceSrc = null;             // its source, connected to the worklet's input
  let monitor = false;             // the player's switch (never saved)
  let monitorSent = false;         // what the worklet was last told
  let clipSource = null;           // the session's clip: "captured" | "reference"
  let capture = null;              // {id, phase: "armed"|"rolling"|"sent", tap, mute, timer}
  let raf = 0;

  // ---- the input list ----
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE) || "[]");
      return Array.isArray(v) ? v.slice(0, INPUT_SLOTS).map((e) => (e && typeof e.id === "string" ? { id: e.id, label: String(e.label || "") } : null)) : [];
    } catch (_) {
      return [];
    }
  }
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(list)); } catch (_) { /* private window */ }
  }
  const slotOf = (id) => list.findIndex((e) => e && e.id === id);
  const entry = (slot) => list[slot] || null;
  const labelOf = (id) => present.get(id) || list.find((e) => e && e.id === id)?.label || "";
  /** A device the browser lists that the list has not seen gets the next
   *  free slot; a known one keeps its slot and takes its current name. */
  function adoptDevice(id, label) {
    if (!id) return;
    const at = slotOf(id);
    if (at >= 0) {
      if (label && list[at].label !== label) { list[at].label = label; save(); }
      return;
    }
    let free = list.findIndex((e) => !e);
    if (free < 0) free = list.length;
    if (free >= INPUT_SLOTS) return;
    list[free] = { id, label: label || "" };
    save();
  }

  async function enumerate() {
    if (!md || !md.enumerateDevices) return;
    let all = [];
    try { all = await md.enumerateDevices(); } catch (_) { return; }
    const next = new Map();
    for (const d of all) {
      // The browser's pseudo-devices are other names for real ones: a slot is
      // a device, so only the real ones are listed.
      if (d.kind !== "audioinput" || !d.deviceId || d.deviceId === "default" || d.deviceId === "communications") continue;
      next.set(d.deviceId, d.label || "");
    }
    present = next;
    enumerated = true;
    // Only with permission does the browser name its devices; nameless ids
    // are not worth a slot.
    if (perm === "granted") for (const [id, label] of present) if (label) adoptDevice(id, label);
  }

  async function queryPermission() {
    if (permQueried || perm !== "unknown") return;
    permQueried = true;
    try {
      const st = await navigator.permissions.query({ name: "microphone" });
      if (perm === "unknown") perm = st.state === "granted" ? "granted" : st.state === "denied" ? "refused" : "prompt";
      st.onchange = () => {
        if (st.state === "granted" && perm !== "granted") { perm = "granted"; refresh(); }
        else if (st.state === "denied") { perm = "refused"; closeAll(); paint(); }
      };
    } catch (_) {
      // Safari and Firefox may not answer for the microphone: then nothing is
      // opened until the player asks (ALLOW INPUT), never at boot.
      if (perm === "unknown") perm = "prompt";
    }
  }

  // ---- asking ----
  const constraints = (id) => ({
    audio: {
      ...(id ? { deviceId: { exact: id } } : {}),
      // An instrument, not a call: no gain riding, no denoising, no echo
      // cancelling (which would hear the patch as an echo and subtract it).
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });

  /** A player's gesture added an AUDIO IN: ask, the first time. */
  function added() {
    host.ensureAudio();
    if (perm === "granted") return refresh();
    if (perm === "asking" || perm === "unsupported") {
      if (perm === "unsupported") host.note(W.INPUT_SAID.unsupported, { urgent: true, replace: "audio-in" });
      return;
    }
    ask();
  }

  async function ask() {
    if (!md || !md.getUserMedia) {
      perm = "unsupported";
      host.note(W.INPUT_SAID.unsupported, { urgent: true, replace: "audio-in" });
      return paint();
    }
    perm = "asking";
    host.ensureAudio();
    paint();
    // Said while the browser's question is on screen, which is the only time
    // it is true: it jumps the queue rather than wait behind a remark about
    // the sound (the placement's own receipt included).
    host.note(W.INPUT_SAID.asking, { urgent: true, replace: "audio-in" });
    // Whichever device the slot names, if it is known; otherwise the
    // browser's choice, which becomes slot 1.
    const first = want.length ? entry(want[0].slot) : null;
    let stream;
    try {
      stream = await md.getUserMedia(constraints(first && present.has(first.id) ? first.id : undefined));
    } catch (e) {
      const name = e && e.name;
      perm = name === "NotAllowedError" || name === "SecurityError" ? "refused"
        : name === "NotFoundError" || name === "OverconstrainedError" ? "missing" : "failed";
      host.note(W.INPUT_SAID[perm], { urgent: true, replace: "audio-in" });
      return paint();
    }
    perm = "granted";
    const track = stream.getAudioTracks()[0];
    const id = (track && track.getSettings && track.getSettings().deviceId) || "";
    const label = (track && track.label) || "";
    if (id) {
      adoptDevice(id, label);
      present.set(id, label);
      if (!streams.has(id)) {
        adopt(id, stream);
        // The ask answers before the edit that placed the module lands, so the
        // bench does not read this input yet: hold the stream open for it
        // rather than close it now and open it again in a moment.
        streams.get(id).heldUntil = performance.now() + ASK_HOLD_MS;
        setTimeout(reconcile, ASK_HOLD_MS + 50);
      } else {
        stream.getTracks().forEach((t) => t.stop());
      }
    }
    await enumerate();
    reconcile();
  }

  // ---- the bench ----
  /** The bench's rack changed: which inputs its AUDIO INs read. */
  function follow(rack) {
    const mods = (rack && rack.modules) || [];
    want = [];
    for (const m of mods) {
      if (m.kind !== "audio_in") continue;
      const k = (m.knobs || []).find((x) => x.addr.endsWith("#input"));
      want.push({ key: m.key, addr: k ? k.addr : null, slot: k ? Math.max(0, Math.round(k.value)) : 0 });
    }
    if (want.length && perm === "unknown") {
      queryPermission().then(refresh);
      return paint();
    }
    reconcile();
  }

  async function refresh() {
    if (perm === "granted") await enumerate();
    reconcile();
  }

  /** Open what the bench reads, close what it no longer does, feed the
   *  voices, and repaint. */
  function reconcile() {
    const need = new Set();
    if (perm === "granted") {
      for (const w of want) {
        const e = entry(w.slot);
        if (!e) continue;
        if (unplugged.has(e.id)) continue;
        if (enumerated && !present.has(e.id)) continue;
        need.add(e.id);
      }
    }
    const now = performance.now();
    for (const [id, s] of [...streams]) if (!need.has(id) && !(s.heldUntil > now)) close(id);
    for (const id of need) {
      if (!streams.has(id)) open(id);
      else streams.get(id).heldUntil = 0;
    }
    const first = want.length ? entry(want[0].slot) : null;
    voiceId = first && streams.has(first.id) ? first.id : null;
    connectVoices();
    maybeArm();
    paint();
    loop();
  }

  async function open(id) {
    if (opening.has(id) || streams.has(id)) return;
    opening.add(id);
    let stream = null;
    try {
      stream = await md.getUserMedia(constraints(id));
    } catch (e) {
      // Gone between the list and the ask, or held by another app.
      if (e && (e.name === "NotFoundError" || e.name === "OverconstrainedError")) unplugged.add(id);
    }
    opening.delete(id);
    if (!stream) return paint();
    // The bench moved on while the browser answered.
    const still = want.some((w) => entry(w.slot)?.id === id);
    if (!still || streams.has(id)) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    adopt(id, stream);
    reconcile();
  }

  function adopt(id, stream) {
    const track = stream.getAudioTracks()[0];
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    const settings = (track && track.getSettings && track.getSettings()) || {};
    const s = {
      stream, track, source, analyser,
      buf: new Float32Array(analyser.fftSize),
      channels: settings.channelCount === 1 ? 1 : 2,
      db: -Infinity,
    };
    streams.set(id, s);
    unplugged.delete(id);
    if (track) track.addEventListener("ended", () => gone(id));
  }

  function close(id) {
    const s = streams.get(id);
    if (!s) return;
    streams.delete(id);
    if (capture && capture.id === id) cancelCapture();
    if (voiceSrc === s.source) {
      try { voiceSrc.disconnect(); } catch (_) {}
      voiceSrc = null;
    }
    try { s.source.disconnect(); } catch (_) {}
    s.stream.getTracks().forEach((t) => t.stop());
  }
  function closeAll() {
    for (const id of [...streams.keys()]) close(id);
    connectVoices();
  }

  /** A device in use went away: its track ended, or it left the list. */
  function gone(id) {
    if (!streams.has(id) && unplugged.has(id)) return;
    const label = labelOf(id);
    close(id);
    unplugged.add(id);
    host.note(W.inputGone(label), { urgent: true, replace: "audio-in" });
    reconcile();
  }

  if (md && md.addEventListener) {
    md.addEventListener("devicechange", async () => {
      if (!enumerated && perm !== "granted") return;
      await enumerate();
      for (const id of [...streams.keys()]) if (!present.has(id)) gone(id);
      for (const id of [...unplugged]) {
        if (!present.has(id)) continue;
        unplugged.delete(id);
        if (want.some((w) => entry(w.slot)?.id === id)) host.note(W.inputBack(labelOf(id)), { replace: "audio-in" });
      }
      reconcile();
    });
  }

  // ---- the voices and monitoring ----
  function connectVoices() {
    const live = host.live();
    const src = voiceId ? streams.get(voiceId)?.source || null : null;
    if (src !== voiceSrc) {
      if (voiceSrc && live) { try { voiceSrc.disconnect(live.node); } catch (_) {} }
      voiceSrc = null;
      if (src && live) {
        src.connect(live.node);
        voiceSrc = src;
      }
    }
    sendMonitor();
  }
  function sendMonitor() {
    const live = host.live();
    const on = monitor && !!voiceSrc;
    if (live && on !== monitorSent) {
      live.monitor(on);
      monitorSent = on;
    }
  }
  function setMonitor(on) {
    if (on && !voiceSrc) {
      host.note(W.INPUT_SAID.monitorNone, { urgent: true, replace: "audio-in-monitor" });
      return;
    }
    monitor = !!on;
    if (monitor) host.ensureAudio();
    sendMonitor();
    // Urgent: it answers the press, and the headphones warning must neither
    // wait behind news about the sound nor be dropped from the queue as stale.
    host.note(monitor ? W.INPUT_SAID.monitorOn : W.INPUT_SAID.monitorOff, { urgent: true, replace: "audio-in-monitor" });
    paint();
  }
  /** Back to how a load starts: monitoring off (booth's new visitor). */
  function reset() {
    monitor = false;
    sendMonitor();
    paint();
  }

  // ---- the clip ----
  /** Arm a first-listen capture on the voices' input, if the session has no
   *  captured clip and none is under way. `force` is NEW CLIP. */
  function maybeArm(force = false) {
    if (capture || !voiceId) return;
    if (!force && clipSource !== "reference") return;
    capture = { id: voiceId, phase: "armed" };
  }
  function startCapture() {
    const s = streams.get(capture.id);
    if (!s) return cancelCapture();
    const tap = new AudioWorkletNode(ctx, "auracle-tap", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
    const mute = ctx.createGain();
    mute.gain.value = 0;
    s.source.connect(tap);
    tap.connect(mute).connect(ctx.destination);
    const c = capture;
    c.phase = "rolling";
    c.tap = tap;
    c.mute = mute;
    c.channels = s.channels;
    tap.port.onmessage = (e) => {
      if (e.data.type !== "tap_done" || capture !== c) return;
      teardownTap(c);
      let samples = e.data.samples;
      // The tap hands back two channels; a mono device is one, so the clip
      // (saved with the session) is not twice the size it needs to be.
      if (c.channels === 1) {
        const mono = new Float32Array(samples.length >> 1);
        for (let i = 0; i < mono.length; i++) mono[i] = samples[2 * i];
        samples = mono;
      }
      c.phase = "sent";
      host.send({ type: "set_audition_clip", samples, channels: c.channels, sampleRate: e.data.sampleRate }, [samples.buffer]);
      paint();
    };
    tap.port.postMessage({ type: "on" });
    c.timer = setTimeout(() => { if (capture === c) tap.port.postMessage({ type: "off" }); }, CLIP_SECONDS * 1000);
    // Urgent, like the engine's word that ends it (`clip`): the player is told
    // the moment their input is being recorded, never a queue's length later.
    host.note(W.clipCapturing(labelOf(c.id), CLIP_SECONDS), { urgent: true, replace: "audio-in-clip" });
    paint();
  }
  function teardownTap(c) {
    clearTimeout(c.timer);
    try { c.tap && c.tap.disconnect(); } catch (_) {}
    try { c.mute && c.mute.disconnect(); } catch (_) {}
    const s = streams.get(c.id);
    if (s && c.tap) { try { s.source.disconnect(c.tap); } catch (_) {} }
    c.tap = null;
  }
  function cancelCapture() {
    if (!capture) return;
    teardownTap(capture);
    capture = null;
    paint();
  }
  function newClip() {
    if (capture && capture.phase !== "armed") return;
    capture = null;
    maybeArm(true);
    if (!capture) return host.note(W.INPUT_SAID.clipNone, { urgent: true, replace: "audio-in-clip" });
    // It starts when the input carries a signal; say so, in case it is quiet.
    host.note(W.clipArmed(labelOf(capture.id), CLIP_SECONDS), { urgent: true, replace: "audio-in-clip" });
    paint();
  }
  /** The engine's word on the session's clip: after a restore, or in reply
   *  to a capture (`ok` is there only then). */
  function clip(m) {
    if (m && m.clip && typeof m.clip.source === "string") clipSource = m.clip.source;
    if (m && typeof m.ok === "boolean") {
      capture = null;
      host.note(m.note, { urgent: true, replace: "audio-in-clip" });
    } else if (m && m.clip && m.clip.unreadable && m.clip.note) {
      // A restore whose saved clip didn't load (the status carries its note).
      host.note(m.clip.note, { urgent: true, replace: "audio-in-clip" });
    }
    if (!capture) maybeArm();
    paint();
  }

  // ---- the meter ----
  function level(s) {
    s.analyser.getFloatTimeDomainData(s.buf);
    let sum = 0;
    for (let i = 0; i < s.buf.length; i++) sum += s.buf[i] * s.buf[i];
    const rms = Math.sqrt(sum / s.buf.length);
    s.db = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
    return s.db;
  }
  function loop() {
    if (raf || streams.size === 0) return;
    const tick = () => {
      raf = 0;
      if (streams.size === 0) return;
      for (const s of streams.values()) level(s);
      if (capture && capture.phase === "armed") {
        const s = streams.get(capture.id);
        if (s && s.db > CLIP_SIGNAL_DB) startCapture();
      }
      paintMeters();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  // ---- the lane on the rack ----
  const el = (tag, attrs, cls) => {
    const e = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
    if (cls) e.setAttribute("class", cls);
    return e;
  };
  function button(parent, x, y, w, label, cls, title, run, interactive) {
    const g = el("g", { transform: `translate(${x},${y})` }, `ain-btn ain-ctl ${cls}`);
    g.appendChild(el("rect", { width: w, height: 18, rx: 3 }, "ain-btn-body"));
    const t = el("text", { x: w / 2, y: 12.5 }, "ain-btn-text");
    t.textContent = label;
    g.appendChild(t);
    if (interactive) {
      const tt = el("title", {});
      tt.textContent = title;
      g.appendChild(tt);
      g.setAttribute("role", "button");
      g.setAttribute("tabindex", "-1");
      g.setAttribute("aria-label", title);
      g.addEventListener("click", (ev) => {
        ev.stopPropagation();
        run(ev);
        // A pointer click leaves no focus behind, so Space still plays.
        if (ev.detail > 0) g.blur();
      });
      g.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter" && ev.key !== " ") return;
        ev.preventDefault();
        run(ev);
      });
    }
    parent.appendChild(g);
    return g;
  }

  /** Draw an AUDIO IN module's lane into its control group `g`, `top` units
   *  down the plate, `w` wide. Every part is drawn in every state and shown
   *  or hidden by `paint`, so a value-only redraw of the rack finds the same
   *  elements (main.js `rackShapeOf`). */
  function drawLane(g, m, w, top, interactive) {
    const lane = el("g", { transform: `translate(0,${top})` }, "ain-lane");
    lane.dataset.key = m.key;
    const inset = 10;
    const left = w - 2 * inset - FACE - 8;
    // The input: which device this module's slot is, and the menu to pick one.
    const dev = el("g", { transform: `translate(${inset},0)` }, "ain-dev ain-ctl");
    dev.appendChild(el("rect", { width: left, height: 20, rx: 3 }, "ain-dev-body"));
    const dt = el("text", { x: 6, y: 13.5 }, "ain-dev-text");
    dev.appendChild(dt);
    if (interactive) {
      const tt = el("title", {});
      tt.textContent = "Input: pick a microphone or interface";
      dev.appendChild(tt);
      dev.setAttribute("role", "button");
      dev.setAttribute("tabindex", "-1");
      dev.setAttribute("aria-haspopup", "menu");
      const run = () => {
        const r = dev.getBoundingClientRect();
        menu(m.key, r.left, r.bottom + 2);
      };
      dev.addEventListener("click", (ev) => { ev.stopPropagation(); run(); if (ev.detail > 0) dev.blur(); });
      dev.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter" && ev.key !== " ") return;
        ev.preventDefault();
        run();
      });
    }
    lane.appendChild(dev);
    // FACE SLOT. The live face of the input (faces, Plan-005 task 3, on
    // `claude/faces`, not merged yet) goes in this square; until it lands the
    // square draws the input's level meter. Swap the meter for the face here.
    const face = el("g", { transform: `translate(${w - inset - FACE},0)` }, "ain-face");
    face.appendChild(el("rect", { width: FACE, height: FACE, rx: 3 }, "ain-face-body"));
    face.appendChild(el("rect", { x: FACE / 2 - 6, y: 4, width: 12, height: FACE - 8, rx: 1.5 }, "ain-meter-track"));
    face.appendChild(el("rect", { x: FACE / 2 - 6, y: FACE - 4, width: 12, height: 0, rx: 1.5 }, "ain-meter-fill"));
    lane.appendChild(face);
    // Monitoring, the clip, and the ask (in place of both while there is no
    // input). Half the width each.
    const bw = (left - 6) / 2;
    button(lane, inset, 26, bw, W.INPUT_SILK.monitor, "ain-monitor", "Monitor: hear your input through the sound", () => setMonitor(!monitor), interactive);
    button(lane, inset + bw + 6, 26, bw, W.INPUT_SILK.newClip, "ain-clip", "New clip: what the model hears it through", () => newClip(), interactive);
    button(lane, inset, 26, left, W.INPUT_SILK.allow, "ain-ask", "Allow input: ask the browser for one", () => ask(), interactive);
    const note = el("text", { x: inset + 8, y: 58 }, "ain-note");
    note.textContent = W.INPUT_SILK.headphones;
    lane.appendChild(note);
    g.appendChild(lane);
    paintLane(lane);
  }

  /** What a module's lane says, from where its input stands. */
  function laneState(key) {
    const w = want.find((x) => x.key === key);
    const slot = w ? w.slot : 0;
    if (perm !== "granted") return { slot, state: perm === "unknown" || perm === "prompt" ? "unasked" : perm, label: "" };
    const e = entry(slot);
    if (!e) return { slot, state: "empty", label: "" };
    const label = labelOf(e.id) || `input ${slot + 1}`;
    if (unplugged.has(e.id) || (enumerated && !present.has(e.id))) return { slot, state: "unplugged", label, id: e.id };
    if (!streams.has(e.id)) return { slot, state: "opening", label, id: e.id };
    return { slot, state: e.id === voiceId ? "live" : "meter", label, id: e.id };
  }

  function paintLane(lane) {
    const st = laneState(lane.dataset.key);
    lane.dataset.state = st.state;
    lane.dataset.slot = String(st.slot);
    const text = W.inputLine(st.state, st.slot, st.label);
    const dt = lane.querySelector(".ain-dev-text");
    // The plate is a fixed width: a long device name is cut, never the input
    // number or what it says about the input (*unplugged*). The whole line is
    // the control's name, and the whole device name is the menu's.
    let shown = text;
    if (text.length > LINE_CHARS && st.label) {
      const room = Math.max(4, LINE_CHARS - (text.length - st.label.length) - 1);
      shown = W.inputLine(st.state, st.slot, `${st.label.slice(0, room)}…`);
    }
    if (shown.length > LINE_CHARS) shown = `${shown.slice(0, LINE_CHARS - 1)}…`;
    if (dt && dt.textContent !== shown) dt.textContent = shown;
    const dev = lane.querySelector(".ain-dev");
    if (dev && dev.hasAttribute("role")) dev.setAttribute("aria-label", `Input ${text}`);
    const noInput = perm !== "granted";
    const live = st.state === "live";
    const toggle = (sel, on) => lane.querySelector(sel)?.classList.toggle("hidden", !on);
    toggle(".ain-monitor", !noInput);
    toggle(".ain-clip", !noInput);
    toggle(".ain-ask", noInput && perm !== "unsupported" && perm !== "asking");
    const ask = lane.querySelector(".ain-ask .ain-btn-text");
    if (ask) ask.textContent = perm === "refused" || perm === "missing" || perm === "failed" ? W.INPUT_SILK.askAgain : W.INPUT_SILK.allow;
    const mon = lane.querySelector(".ain-monitor");
    if (mon) {
      mon.classList.toggle("on", monitor && live);
      mon.classList.toggle("off", !live);
      mon.setAttribute("aria-pressed", String(monitor && live));
    }
    const clipBtn = lane.querySelector(".ain-clip");
    if (clipBtn) {
      const busy = !!capture && capture.phase !== "armed" && capture.id === st.id;
      clipBtn.classList.toggle("on", busy);
      clipBtn.classList.toggle("off", !live);
    }
  }

  function paint() {
    for (const lane of document.querySelectorAll("#rack-svg .ain-lane")) paintLane(lane);
  }

  function paintMeters() {
    for (const lane of document.querySelectorAll("#rack-svg .ain-lane")) {
      const e = entry(Number(lane.dataset.slot) || 0);
      const s = e ? streams.get(e.id) : null;
      const fill = lane.querySelector(".ain-meter-fill");
      if (!fill) continue;
      const db = s ? s.db : -Infinity;
      const f = Number.isFinite(db) ? Math.max(0, Math.min(1, (db - METER_FLOOR_DB) / -METER_FLOOR_DB)) : 0;
      const h = (FACE - 8) * f;
      fill.setAttribute("y", (FACE - 4 - h).toFixed(1));
      fill.setAttribute("height", h.toFixed(1));
      lane.dataset.db = Number.isFinite(db) ? db.toFixed(1) : "-inf";
    }
  }

  /** The input menu: every input in the list by slot, and choosing one sets
   *  this module's `input` knob (an edit like any other, through the bench). */
  function menu(key, x, y) {
    const w = want.find((v) => v.key === key);
    if (!w || !w.addr) return;
    if (perm !== "granted") return ask();
    const rows = [];
    for (let slot = 0; slot < INPUT_SLOTS; slot++) {
      const e = entry(slot);
      if (!e) continue;
      const here = !unplugged.has(e.id) && (!enumerated || present.has(e.id));
      rows.push({
        label: W.inputRow(slot, labelOf(e.id) || `input ${slot + 1}`),
        sub: slot === w.slot ? "in use" : here ? "" : "unplugged",
        run: () => { if (slot !== w.slot) host.setKnob(w.addr, slot); },
      });
    }
    if (!rows.length) return ask();
    host.showMenu(x, y, { title: "audio in", sub: "input" }, rows);
  }

  return {
    added,
    follow,
    drawLane,
    clip,
    reset,
    ask,
    setMonitor,
    get monitor() { return monitor; },
    /** For the debugging handle: where each input stands. */
    state: () => ({
      perm, monitor, voiceId, clipSource,
      capture: capture ? capture.phase : null,
      list: list.map((e) => (e ? { ...e } : null)),
      open: [...streams.keys()],
      unplugged: [...unplugged],
    }),
  };
}
