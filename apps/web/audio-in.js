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

const V = new URL(import.meta.url).search;
const W = await import(new URL(`./words.js${V}`, import.meta.url).href);
// The input's live face: measured as a face is, drawn as every face is.
const { createLiveMeter, FACE_FRAME, FACE_BANDS } = await import(new URL(`./faces.js${V}`, import.meta.url).href);
const { drawVessel, vesselBox } = await import(new URL(`./vessel.js${V}`, import.meta.url).href);

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
/** Canvas pixels per rack unit for the live face: sharp at the rack's
 *  closer zooms. */
const FACE_PX = 3;
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
  let groups = new Map();          // device id → groupId, the same listing
  let pseudo = new Map();          // "default"/"communications" → {groupId, label}
  let enumerated = false;
  const streams = new Map();       // device id → {stream, track, source, analyser, buf, channels, db}
  const opening = new Set();       // device ids with a getUserMedia out
  const unplugged = new Set();     // device ids that went away while in use
  let want = [];                   // the bench's AUDIO INs: [{key, addr, slot}]
  let lent = [];                   // inputs lent for a recording (takes.js): [slot]
  let waiters = [];                // lends waiting for their input: {slot, resolve}
  let recordId = null;             // the device the recorder reads (the worklet's second input)
  let recordSrc = null;            // its source, connected there
  const openFailed = new Set();    // devices whose last open failed (not unplugged)
  let voiceId = null;              // the device the voices read
  let voiceSrc = null;             // its source, connected to the worklet's input
  let monitor = false;             // the player's switch (never saved)
  let monitorSent = false;         // what the worklet was last told
  let clipSource = null;           // the session's clip: "captured" | "reference"
  let capture = null;              // {id, phase: "armed"|"rolling"|"sent", tap, mute, timer}
  let clipRefused = false;         // the engine refused this session's last capture
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

  /** Read the browser's list of inputs. With `adopt`, each named input the
   *  list has not seen takes the next number. */
  async function enumerate(adopt = true) {
    if (!md || !md.enumerateDevices) return;
    let all = [];
    try { all = await md.enumerateDevices(); } catch (_) { return; }
    const next = new Map();
    const nextGroups = new Map();
    const nextPseudo = new Map();
    for (const d of all) {
      if (d.kind !== "audioinput" || !d.deviceId) continue;
      // The browser's pseudo-devices are other names for real ones: a slot is
      // a device, so only the real ones are listed, and a pseudo-device is
      // kept only to be resolved to its real one (`realId`).
      if (isPseudo(d.deviceId)) {
        nextPseudo.set(d.deviceId, { groupId: d.groupId || "", label: d.label || "" });
        continue;
      }
      next.set(d.deviceId, d.label || "");
      nextGroups.set(d.deviceId, d.groupId || "");
    }
    present = next;
    groups = nextGroups;
    pseudo = nextPseudo;
    enumerated = true;
    // Only with permission does the browser name its devices; nameless ids
    // are not worth a slot.
    if (adopt && perm === "granted") for (const [id, label] of present) if (label) adoptDevice(id, label);
  }

  /** Chrome's and Edge's other names for a real input. */
  function isPseudo(id) {
    return id === "default" || id === "communications";
  }

  /** The real input a stream's settings name. An unconstrained ask in Chrome
   *  and Edge answers with the pseudo-device `default`, which is not in the
   *  list of inputs. It is resolved to the real one by its group (the same
   *  hardware: the track's, then the list's), else by the track's label
   *  ("Default - X" is X), else by the list's own label for the pseudo-device
   *  without its "Default - " (a track can carry a plain label of its own
   *  while the list still says which input it stands for). Null when none
   *  of these names a real input. Call after `enumerate`. */
  function realId(id, groupId, label) {
    if (id && !isPseudo(id)) return id;
    const p = pseudo.get(id) || {};
    for (const group of [groupId, p.groupId]) {
      if (group) for (const [rid, g] of groups) if (g === group) return rid;
    }
    for (const said of [label, p.label]) {
      const name = (said || "").replace(/^(Default|Communications) - /, "");
      if (name) for (const [rid, l] of present) if (l === name) return rid;
    }
    return null;
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
    const settings = (track && track.getSettings && track.getSettings()) || {};
    // Granted, the browser names its inputs: the list first, so a pseudo-
    // device in the stream's settings can be resolved to the real input,
    // which is numbered before the rest (the input the browser opened is 1).
    await enumerate(false);
    const id = realId(settings.deviceId || "", settings.groupId || "", (track && track.label) || "");
    if (!id) {
      // A stream that names no input it can be filed under is not kept: the
      // bench opens what it reads by id, below.
      stream.getTracks().forEach((t) => t.stop());
    } else {
      adoptDevice(id, present.get(id) || (track && track.label) || "");
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
    // Every other input the browser lists takes the next number.
    for (const [rid, l] of present) if (l) adoptDevice(rid, l);
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
    // MONITOR ends with the last AUDIO IN on the bench, so the next sound
    // that listens does not come up monitored without a press.
    if (!want.length && monitor) {
      monitor = false;
      sendMonitor();
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
      for (const w of [...want, ...lent.map((slot) => ({ slot }))]) {
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
    // The voices read the bench's first AUDIO IN; with none, an input lent
    // for a recording is connected instead (the voices do not read it, the
    // recording does).
    const first = want.length ? entry(want[0].slot) : lent.length ? entry(lent[0]) : null;
    voiceId = first && streams.has(first.id) ? first.id : null;
    connectVoices();
    // The recorder reads the worklet's second input: the input a recording
    // was lent (the one its CAPTURE's AUDIO IN reads, which need not be the
    // bench's), else the bench's.
    const rec = lent.length ? entry(lent[lent.length - 1]) : first;
    recordId = rec && streams.has(rec.id) ? rec.id : null;
    connectRecord();
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
      else openFailed.add(id);
    }
    opening.delete(id);
    if (!stream) return paint();
    // The bench moved on while the browser answered.
    const still = want.some((w) => entry(w.slot)?.id === id) || lent.some((slot) => entry(slot)?.id === id);
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
    analyser.fftSize = FACE_FRAME; // one face frame: the level and the face read the same buffer
    source.connect(analyser);
    const settings = (track && track.getSettings && track.getSettings()) || {};
    const s = {
      stream, track, source, analyser,
      buf: new Float32Array(analyser.fftSize),
      // Its live face: the latest frame in the face's bands (eased), drawn
      // on the module against the bank as a sound's face is.
      meter: createLiveMeter(),
      face: { ltas: new Float64Array(FACE_BANDS), slices: [], loud: [] },
      faceLive: false,
      channels: settings.channelCount === 1 ? 1 : 2,
      db: -Infinity,
    };
    streams.set(id, s);
    unplugged.delete(id);
    openFailed.delete(id);
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
    if (recordSrc === s.source) recordSrc = null; // disconnected below, with every output
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
  /** Connect the recorder's input (the worklet's second) to `recordId`. */
  function connectRecord() {
    const live = host.live();
    const src = recordId ? streams.get(recordId)?.source || null : null;
    if (src === recordSrc) return;
    if (recordSrc && live) { try { recordSrc.disconnect(live.node, 0, 1); } catch (_) {} }
    recordSrc = null;
    if (src && live) {
      src.connect(live.node, 0, 1);
      recordSrc = src;
    }
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

  // ---- the clip ----
  /** Arm a first-listen capture on the voices' input, if the session has no
   *  captured clip, none is under way, and the engine has not refused one
   *  this session (then only NEW CLIP captures again, as the reference
   *  page says). `force` is NEW CLIP. */
  function maybeArm(force = false) {
    if (capture || !voiceId) return;
    if (!force && (clipSource !== "reference" || clipRefused)) return;
    if (force) clipRefused = false;
    capture = { id: voiceId, phase: "armed" };
  }
  function startCapture() {
    const s = streams.get(capture.id);
    if (!s) return cancelCapture();
    // One-shot: its processor ends once the take is handed back or dropped.
    const tap = new AudioWorkletNode(ctx, "auracle-tap", {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { once: true },
    });
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
      c.done = true;
      teardownTap(c);
      let samples = e.data.samples;
      // The tap hands back two channels; a mono input is one (by its track's
      // settings, or by what the tap heard, where the settings say nothing),
      // so the clip, saved with the session, is not twice the size it needs.
      if (e.data.channels === 1) c.channels = 1;
      // A browser may hand a mono input on as two identical channels (and
      // say nothing of its channel count): two channels equal sample for
      // sample hold one channel's information, so they are sent as one.
      if (c.channels === 2) {
        let same = true;
        for (let i = 0; i + 1 < samples.length; i += 2) {
          if (samples[i] !== samples[i + 1]) { same = false; break; }
        }
        if (same) c.channels = 1;
      }
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
    // A capture cancelled while it rolls drops its take, so the processor
    // stops recording and ends rather than run on unheard.
    if (c.tap && !c.done) { try { c.tap.port.postMessage({ type: "drop" }); } catch (_) {} }
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
      // Refused (silent): no capture again by itself until NEW CLIP.
      clipRefused = !m.ok;
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
    // The face, only while there is something to draw, a square to draw it
    // in, and a bank to draw it against (the meter loop runs only while an
    // input is open).
    if (s.db > METER_FLOOR_DB && host.faceStats && host.faceStats() && document.querySelector("#rack-svg .ain-face-live")) {
      const { db } = s.meter.measure(s.buf, ctx.sampleRate);
      for (let b = 0; b < FACE_BANDS; b++) s.face.ltas[b] = s.faceLive ? s.face.ltas[b] * 0.6 + db[b] * 0.4 : db[b];
      s.faceLive = true;
    } else {
      s.faceLive = false;
    }
    return s.db;
  }
  function loop() {
    if (raf || streams.size === 0) return;
    const tick = () => {
      raf = 0;
      // The last input closed: its level and face go with it.
      if (streams.size === 0) return paintMeters();
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
      g.dataset.stop = cls; // on the rack's roving stop, after the knobs
      g.addEventListener("click", (ev) => {
        ev.stopPropagation();
        run(ev);
        // A pointer click leaves no focus behind, so Space still plays.
        if (ev.detail > 0) g.blur();
      });
      g.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter" && ev.key !== " ") return;
        ev.preventDefault();
        if (ev.repeat) return; // a held key presses once
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
      tt.textContent = W.INPUT_TIPS.line;
      dev.appendChild(tt);
      dev.setAttribute("role", "button");
      dev.setAttribute("tabindex", "-1");
      dev.setAttribute("aria-haspopup", "menu");
      dev.dataset.stop = "ain-dev"; // on the rack's roving stop, after the knobs
      const run = () => {
        const r = dev.getBoundingClientRect();
        menu(m.key, r.left, r.bottom + 2);
      };
      dev.addEventListener("click", (ev) => { ev.stopPropagation(); run(); if (ev.detail > 0) dev.blur(); });
      dev.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter" && ev.key !== " ") return;
        ev.preventDefault();
        if (ev.repeat) return; // a held key opens the menu once
        run();
      });
    }
    lane.appendChild(dev);
    // The input's live face (faces, Plan-005 task 3): its latest frame in the
    // face's bands, against the bank's faces, drawn as every face is
    // (vessel.js), on a canvas in the square; a level bar runs up its left
    // edge. With fewer faces in the bank than a face needs (`faceStats` is
    // null), the bar alone says the input is there.
    const face = el("g", { transform: `translate(${w - inset - FACE},0)` }, "ain-face");
    face.appendChild(el("rect", { width: FACE, height: FACE, rx: 3 }, "ain-face-body"));
    face.appendChild(el("rect", { x: 3, y: 4, width: 4, height: FACE - 8, rx: 1 }, "ain-meter-track"));
    face.appendChild(el("rect", { x: 3, y: FACE - 4, width: 4, height: 0, rx: 1 }, "ain-meter-fill"));
    if (interactive) {
      const fo = el("foreignObject", { x: 9, y: 2, width: FACE - 11, height: FACE - 4 }, "ain-face-live");
      const cv = document.createElement("canvas");
      cv.width = (FACE - 11) * FACE_PX;
      cv.height = (FACE - 4) * FACE_PX;
      cv.setAttribute("aria-hidden", "true");
      fo.appendChild(cv);
      face.appendChild(fo);
    }
    lane.appendChild(face);
    // Monitoring, the clip, and the ask (in place of both while there is no
    // input). Half the width each.
    const bw = (left - 6) / 2;
    button(lane, inset, 26, bw, W.INPUT_SILK.monitor, "ain-monitor", W.INPUT_TIPS.monitor, () => setMonitor(!monitor), interactive);
    button(lane, inset + bw + 6, 26, bw, W.INPUT_SILK.newClip, "ain-clip", W.INPUT_TIPS.newClip, () => newClip(), interactive);
    button(lane, inset, 26, left, W.INPUT_SILK.allow, "ain-ask", W.INPUT_TIPS.allow, () => ask(), interactive);
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
    const label = labelOf(e.id) || W.inputName(slot);
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
    if (dev && dev.hasAttribute("role")) dev.setAttribute("aria-label", W.inputLineName(text));
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

  /** The rack's AUDIO IN lanes, not the leaving rack's copies (a
   *  `.rack-exit` fading out after a move, whose plates have lost their keys). */
  function rackLanes() {
    return [...document.querySelectorAll("#rack-svg .ain-lane")].filter((l) => !l.closest(".rack-exit"));
  }

  function paint() {
    settle(); // every change of permission or stream ends in a paint
    for (const lane of rackLanes()) paintLane(lane);
    // A lane drawn new, or one whose input closed, shows the level and face
    // as they are now (the meter loop runs only while an input is open).
    paintMeters();
  }

  function paintMeters() {
    for (const lane of rackLanes()) {
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
      const cv = lane.querySelector(".ain-face-live canvas");
      if (cv) {
        const g = cv.getContext("2d");
        g.clearRect(0, 0, cv.width, cv.height);
        const stats = host.faceStats ? host.faceStats() : null;
        const drawn = !!(s && s.faceLive && stats) &&
          drawVessel(g, s.face, stats, { box: vesselBox(cv.width, cv.height), color: host.faceColor(), slices: false, line: FACE_PX });
        lane.dataset.face = drawn ? "live" : "none";
      }
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
        label: W.inputRow(slot, labelOf(e.id) || W.inputName(slot)),
        sub: slot === w.slot ? W.INPUT_MENU.inUse : here ? "" : W.INPUT_MENU.unplugged,
        run: () => { if (slot !== w.slot) host.setKnob(w.addr, slot); },
      });
    }
    if (!rows.length) return ask();
    host.showMenu(x, y, { title: W.INPUT_MENU.title, sub: W.INPUT_MENU.sub }, rows);
  }

  /** Open input `slot` for a recording and connect it to the recorder (the
   *  worklet's second input), whether or not the bench reads it: RECORD on a
   *  CAPTURE, and RECORD AGAIN on a sound kept safe, which the bench does not
   *  read. Called inside the player's gesture, so with no answer from the
   *  browser yet it asks, as adding AUDIO IN does.
   *
   *  Returns `{ready, release}`. `ready` resolves `{ok: true}` once the input
   *  is open and connected, or `{ok: false, why}` when it cannot be:
   *  `refused`, `missing`, `failed`, `unsupported` (the browser's answer, as
   *  AUDIO IN names it) or `unplugged`. A recording starts only on `ok`, so
   *  it never records the silence of an input still opening. */
  function lend(slot) {
    slot |= 0;
    lent.push(slot);
    let resolveReady;
    const ready = new Promise((r) => { resolveReady = r; });
    const w = { slot, resolve: (v) => { waiters = waiters.filter((x) => x !== w); resolveReady(v); } };
    waiters.push(w);
    // The player's gesture: with no answer from the browser yet, it may ask.
    if (perm === "unknown") {
      queryPermission().then(() => (perm === "prompt" ? ask() : refresh()));
    } else if (perm === "prompt") {
      ask();
    } else if (perm === "granted" && !enumerated) {
      refresh();
    }
    reconcile();
    let done = false;
    return {
      ready,
      release: () => {
        if (done) return;
        done = true;
        if (waiters.includes(w)) w.resolve({ ok: false, why: "released" });
        const at = lent.indexOf(slot);
        if (at >= 0) lent.splice(at, 1);
        reconcile();
      },
    };
  }

  /** Answer the lends whose input is ready, or cannot be. */
  function settle() {
    for (const w of [...waiters]) {
      if (perm === "refused" || perm === "missing" || perm === "failed" || perm === "unsupported") {
        w.resolve({ ok: false, why: perm });
        continue;
      }
      if (perm !== "granted") continue; // still asking: wait
      const e = entry(w.slot);
      if (!e) {
        if (enumerated) w.resolve({ ok: false, why: "missing" });
        continue;
      }
      if (unplugged.has(e.id) || (enumerated && !present.has(e.id))) {
        w.resolve({ ok: false, why: "unplugged" });
        continue;
      }
      if (openFailed.has(e.id) && !opening.has(e.id)) {
        w.resolve({ ok: false, why: "failed" });
        continue;
      }
      const s = streams.get(e.id);
      if (s && recordSrc === s.source) w.resolve({ ok: true });
    }
  }

  return {
    added,
    lend,
    follow,
    drawLane,
    clip,
    ask,
    setMonitor,
    get monitor() { return monitor; },
    /** For the debugging handle: where each input stands. */
    state: () => ({
      perm, monitor, voiceId, recordId, clipSource,
      capture: capture ? capture.phase : null,
      list: list.map((e) => (e ? { ...e } : null)),
      open: [...streams.keys()],
      unplugged: [...unplugged],
    }),
  };
}
