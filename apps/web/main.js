// EVOSYNTH — a full instrument. Main thread: app frame (PLAY/EVOLVE/TASTE),
// patch bank, the interactive rack, taste instruments, and the live keyboard
// (AudioWorklet synthesis via live-audio.js). All engine compute (rendering,
// MCMC, evolution) lives in worker.js; candidates are addressed by stable id.

const $ = (id) => document.getElementById(id);
const SVG_NS = "http://www.w3.org/2000/svg";

// Version-stamp the worker and all wasm fetches so a stale browser cache can
// never pair an old engine with a newer UI.
const BUILD = Date.now();
const worker = new Worker(`./worker.js?v=${BUILD}`, { type: "module" });
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

// ---------- state ----------
const renders = new Map(); // id -> {buffer: AudioBuffer, sexpr}
let currentDuel = null;    // [idA, idB]
let duelsSinceFit = 0;
const FIT_EVERY = 6;
let fitting = false;
let playingSrc = null;

let views = null;          // {map, styles, lineage, ranked} from the worker
let tasteTab = "map";
let currentView = "play";

const starsById = new Map();
const cutIds = new Set();

// Live instrument state.
let live = null;             // from initLiveAudio
let livePatchId = null;      // id whose tree the worklet is playing (null = edited)
let liveLabelText = "no patch";
let octShift = 0;
let hold = false;
const heldNotes = new Set(); // midi numbers currently sounding

// Workbench state.
const wb = {
  subjectId: null,
  rack: null,
  buffer: null,      // phrase render of the bench state
  vetOk: true,
  dirty: false,
  locks: new Set(),
};
let editInFlight = false;
let editQueue = null;
let auditionOnSettle = false;
let pendingEvolve = false;
let knobDragging = false;

// Addresses with no live audio handle (enums, structural sites): edits to
// these need a voice re-patch when the engine confirms them.
const nonLiveAddrs = new Set();

// ---------- persistence (IndexedDB autosave) ----------
// One record: {session: <engine SessionState JSON>, ui: {stars, cut, vol, oct, perf}}.
function idbOpen() {
  return new Promise((resolve) => {
    const req = indexedDB.open("evosynth", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null); // private mode etc: run without saves
  });
}
async function idbGet(key) {
  const db = await idbOpen();
  if (!db) return null;
  return new Promise((resolve) => {
    const tx = db.transaction("kv", "readonly").objectStore("kv").get(key);
    tx.onsuccess = () => resolve(tx.result || null);
    tx.onerror = () => resolve(null);
  });
}
async function idbPut(key, value) {
  const db = await idbOpen();
  if (!db) return;
  db.transaction("kv", "readwrite").objectStore("kv").put(value, key);
}

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => send({ type: "save" }), 2500);
}
function uiState() {
  return {
    stars: [...starsById],
    cut: [...cutIds],
    vol: Number($("vol").value),
    oct: octShift,
    perf,
  };
}

// ---------- undo/redo (workbench edits) ----------
const undoStack = [];
const redoStack = [];
let restoreInFlight = false;
function pushUndo() {
  if (!wb.tree) return;
  undoStack.push(JSON.stringify(wb.tree));
  if (undoStack.length > 60) undoStack.shift();
  redoStack.length = 0;
}
function doUndo() {
  if (undoStack.length === 0 || !wb.tree) return note("nothing to undo");
  redoStack.push(JSON.stringify(wb.tree));
  restoreInFlight = true;
  send({ type: "edit_set_tree", json: undoStack.pop() });
}
function doRedo() {
  if (redoStack.length === 0 || !wb.tree) return note("nothing to redo");
  undoStack.push(JSON.stringify(wb.tree));
  restoreInFlight = true;
  send({ type: "edit_set_tree", json: redoStack.pop() });
}

// ---------- worker protocol ----------
const send = (msg, transfer) => worker.postMessage(msg, transfer || []);

worker.onmessage = (e) => {
  const m = e.data;
  switch (m.type) {
    case "fill_progress": {
      $("boot-fill").style.width = `${(100 * m.pool) / m.target}%`;
      $("boot-status").textContent =
        m.label || `rendering & vetting candidate ${m.pool} / ${m.target}`;
      break;
    }
    case "filled": {
      $("boot").classList.add("hidden");
      send({ type: "duel" });
      send({ type: "taste_views" });
      if (m.restored > 0) note(`welcome back — ${m.restored} patches and your taste history restored`);
      break;
    }
    case "saved": {
      idbPut("state", { session: m.json, ui: uiState() });
      break;
    }
    case "patch_imported": {
      views = m.views;
      applyStatus(m.status);
      refreshInstruments();
      if (m.id > 0) {
        openOnBench(m.id);
        note(`patch imported as ${nameOf(m.id)}`);
        scheduleSave();
      } else {
        note("could not import that patch (duplicate, or it failed the safety vet)");
      }
      break;
    }
    case "duel": {
      currentDuel = m.pair;
      if (m.pair) {
        setFlip("a", false);
        setFlip("b", false);
        loadSide("a", m.pair[0]);
        loadSide("b", m.pair[1]);
        setDuelSelection(null);
      }
      break;
    }
    case "render": {
      if (m.buffer.length > 0) {
        const buf = audioCtx.createBuffer(1, m.buffer.length, m.sampleRate);
        buf.copyToChannel(m.buffer, 0);
        renders.set(m.id, { buffer: buf, sexpr: m.sexpr });
        onRenderArrived(m.id);
      }
      break;
    }
    case "tree_json": {
      if (m.json && m.json !== "null" && live) {
        live.setPatch(m.json, m.makeup);
        livePatchId = m.id;
        setLiveLabel(nameOf(m.id));
      }
      break;
    }
    case "status": {
      applyStatus(m.status);
      scheduleSave();
      break;
    }
    case "fitted": {
      fitting = false;
      $("led-learn").classList.remove("on");
      views = m.views;
      applyStatus(m.status);
      refreshInstruments();
      scheduleSave();
      break;
    }
    case "refined": {
      $("led-evolve").classList.remove("on");
      $("evolve-btn").disabled = false;
      views = m.views;
      applyStatus(m.status);
      refreshInstruments();
      scheduleSave();
      note(`generation ${m.status.generation}: pool evolved`);
      break;
    }
    case "bench": {
      wb.rack = m.rack;
      wb.vetOk = m.vetOk;
      if (m.subject !== undefined) {
        wb.subjectId = m.subject;
        wb.dirty = false;
        wb.locks = new Set();
        undoStack.length = 0;
        redoStack.length = 0;
        note(`${nameOf(m.subject)} on the bench`);
      }
      if (m.edited !== undefined) {
        wb.dirty = true;
        if (m.edited === "restore" && wb.locks.size > 0) {
          wb.locks.clear(); // restored tree may have different addresses
        }
        if (m.edited === "structure" && wb.locks.size > 0) {
          // Structural edits shift trace addresses; stale locks would pin
          // the wrong sites.
          wb.locks.clear();
          note("structure changed — locks cleared");
        }
      }
      if (m.buffer && m.buffer.length > 0) {
        const buf = audioCtx.createBuffer(1, m.buffer.length, m.sampleRate);
        buf.copyToChannel(m.buffer, 0);
        wb.buffer = buf;
      } else {
        wb.buffer = null;
      }
      if (m.treeJson && m.treeJson !== "null") {
        wb.tree = JSON.parse(m.treeJson);
      }
      // The keyboard follows the bench — but continuous knob turns were
      // already applied live inside the worklet (zero-recompile), so only
      // subject loads, structural changes, and non-live params re-patch.
      const structural = m.edited === "structure" || m.edited === "restore";
      const paramNonLive =
        m.edited !== undefined && !structural && nonLiveAddrs.has(m.edited);
      const subjectLoad = m.subject !== undefined;
      if (m.edited === "restore") restoreInFlight = false;
      if (
        m.treeJson && m.treeJson !== "null" && live &&
        (subjectLoad || (wb.vetOk && (structural || paramNonLive)))
      ) {
        live.setPatch(m.treeJson, m.makeup);
        livePatchId = wb.dirty ? null : wb.subjectId;
        setLiveLabel(wb.dirty ? `${nameOf(wb.subjectId)} (edited)` : nameOf(wb.subjectId));
      }
      if (!wb.vetOk) note("⚠ this setting fails the safety vet — audio muted until you turn back");
      if (!knobDragging) renderRack();
      renderBank();
      editInFlight = false;
      if (editQueue) {
        const q = editQueue;
        editQueue = null;
        sendEdit(q.addr, q.value, q.isIndex);
      } else if (auditionOnSettle) {
        auditionOnSettle = false;
      }
      break;
    }
    case "edit_rejected": {
      if (m.error) note(`edit rejected: ${m.error}`);
      editInFlight = false;
      if (editQueue) {
        const q = editQueue;
        editQueue = null;
        sendEdit(q.addr, q.value, q.isIndex);
      }
      break;
    }
    case "committed": {
      views = m.views;
      applyStatus(m.status);
      if (m.id > 0) {
        wb.subjectId = m.id;
        wb.dirty = false;
        livePatchId = m.id;
        setLiveLabel(nameOf(m.id));
        note(`committed as patch #${m.id}${$("improve-check").checked ? " · taught: your edit beat the original" : ""}`);
        if (pendingEvolve) {
          pendingEvolve = false;
          startEvolveFrom(m.id);
        }
      } else {
        pendingEvolve = false;
        note("commit failed (duplicate or unvetted state)");
      }
      refreshInstruments();
      renderRack();
      scheduleSave();
      break;
    }
    case "evolved_from": {
      $("rack-evolve").disabled = false;
      $("led-evolve").classList.remove("on");
      views = m.views;
      applyStatus(m.status);
      refreshInstruments();
      if (m.childId > 0) {
        note(`⚡ gen ${m.status.generation}: evolution proposed patch #${m.childId} — now on the bench, play it`);
        send({ type: "edit_begin", id: m.childId });
        scheduleSave();
      } else {
        note("⚡ evolution found no accepted move — try again, or loosen some locks");
      }
      break;
    }
    case "taste_views": {
      views = m.views;
      refreshInstruments();
      // First arrival: put a patch under the player's fingers immediately.
      if (wb.subjectId == null && views.ranked && views.ranked.length > 0) {
        openOnBench(views.ranked[0].id);
      }
      break;
    }
    case "described": {
      onDescribed(m.id, m.rack);
      break;
    }
    case "ranked": {
      if (views) views.ranked = m.ranked;
      renderBank();
      renderRack(); // subject label may show a new name
      scheduleSave();
      break;
    }
    case "presets": {
      presetRows = m.rows;
      renderPresetsPop();
      break;
    }
    case "preset_loaded": {
      views = m.views;
      applyStatus(m.status);
      refreshInstruments();
      if (m.id > 0) {
        openOnBench(m.id);
        note(`preset loaded as ${nameOf(m.id)}`);
        scheduleSave();
      }
      break;
    }
    case "exported": {
      const blob = new Blob([m.json], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "evosynth-profile.json";
      a.click();
      URL.revokeObjectURL(a.href);
      break;
    }
    case "imported": {
      if (m.ok) {
        applyStatus(m.status);
        note("profile loaded — its standardizer and history are now active");
        send({ type: "taste_views" });
        scheduleSave();
      } else {
        note("could not read that profile file");
      }
      break;
    }
  }
};

function applyStatus(st) {
  $("duel-count").textContent = st.observations;
  $("gen-count").textContent = st.generation;
}

function note(text) {
  $("rack-note").textContent = text;
}

function nameOf(id) {
  const r = views && views.ranked && views.ranked.find((x) => x.id === id);
  return r ? r.name : `#${id}`;
}

function setLiveLabel(text) {
  liveLabelText = text;
  $("live-label").textContent = text;
  renderBank();
}

function refreshInstruments() {
  renderBank();
  drawTaste();
  drawLineage();
}

// ---------- views (tabs) ----------
function showView(name) {
  currentView = name;
  for (const v of ["play", "evolve", "taste"]) {
    $(`view-${v}`).classList.toggle("hidden", v !== name);
  }
  document.querySelectorAll(".viewtab").forEach((t) =>
    t.classList.toggle("active", t.dataset.view === name)
  );
  if (name === "taste") drawTaste();
  if (name === "evolve") {
    drawLineage();
    if (currentDuel) {
      onRenderArrived(currentDuel[0]);
      onRenderArrived(currentDuel[1]);
    }
  }
}

document.querySelectorAll(".viewtab").forEach((t) => {
  t.onclick = () => showView(t.dataset.view);
});

// ---------- audio helpers ----------
function ensureAudio() {
  if (audioCtx.state === "suspended") audioCtx.resume();
}

function playBuffer(buffer, btn) {
  if (!buffer) return;
  ensureAudio();
  if (playingSrc) { try { playingSrc.stop(); } catch (_) {} }
  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  src.connect(audioCtx.destination);
  src.start();
  playingSrc = src;
  if (btn) {
    btn.classList.add("playing");
    src.onended = () => btn.classList.remove("playing");
  }
}

function play(id, btn) {
  const r = renders.get(id);
  if (r) playBuffer(r.buffer, btn);
}

// ---------- live instrument ----------
async function bootLiveAudio() {
  const { initLiveAudio } = await import(`./live-audio.js?v=${BUILD}`);
  live = await initLiveAudio(audioCtx, BUILD);
  live.onMessage((m) => {
    (window.__evoLog = window.__evoLog || []).push(m);
    if (m.type === "patch_error") note(`live patch failed to compile: ${m.error}`);
    if (m.type === "param_miss") nonLiveAddrs.add(m.addr);
    if (m.type === "rec_done" && m.samples && m.samples.length > 0) {
      downloadWav(m.samples, m.sampleRate);
    }
  });
  live.setVolume(Number($("vol").value));
  applyPerfUi();
  live.node.onprocessorerror = (e) => {
    (window.__evoLog = window.__evoLog || []).push({ type: "processor_error", e: String(e) });
    note("live audio engine crashed — reload to recover");
  };
  // If a patch arrived before audio was ready, load it now.
  if (wb.subjectId != null) send({ type: "tree_json", id: wb.subjectId });
}

function liveNoteOn(note_, vel = 1.0) {
  if (!live) return;
  ensureAudio();
  live.noteOn(note_, vel);
  heldNotes.add(note_);
  paintKey(note_, true);
}

function liveNoteOff(note_) {
  if (!live) return;
  if (hold) return; // latched — released on hold-off or panic
  live.noteOff(note_);
  heldNotes.delete(note_);
  paintKey(note_, false);
}

function panic() {
  if (live) live.allOff();
  for (const n of [...heldNotes]) paintKey(n, false);
  heldNotes.clear();
}

// ---------- virtual keyboard ----------
const PIANO_LO = 48; // C3
const PIANO_HI = 84; // C6
const BLACK = new Set([1, 3, 6, 8, 10]);
const KEYMAP = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11,
  k: 12, o: 13, l: 14, p: 15, ";": 16, "'": 17,
};
const keyEls = new Map(); // midi -> element

function buildPiano() {
  const piano = $("piano");
  piano.innerHTML = "";
  keyEls.clear();
  for (let n = PIANO_LO; n <= PIANO_HI; n++) {
    if (BLACK.has(n % 12)) continue;
    const wk = document.createElement("div");
    wk.className = "pkey";
    wk.dataset.note = n;
    wk.innerHTML = `<span class="hint"></span>`;
    keyEls.set(n, wk);
    // A black key rides on the white key to its left.
    if (n + 1 <= PIANO_HI && BLACK.has((n + 1) % 12)) {
      const bk = document.createElement("div");
      bk.className = "bkey";
      bk.dataset.note = n + 1;
      bk.innerHTML = `<span class="hint"></span>`;
      keyEls.set(n + 1, bk);
      wk.appendChild(bk);
    }
    piano.appendChild(wk);
  }
  attachPianoPointers(piano);
  paintHints();
}

function paintHints() {
  const base = 60 + 12 * octShift;
  const hintFor = new Map();
  for (const [key, off] of Object.entries(KEYMAP)) hintFor.set(base + off, key);
  for (const [midi, el] of keyEls) {
    const hint = el.querySelector(".hint");
    hint.textContent = hintFor.get(midi) || "";
  }
  $("oct-label").textContent = `oct ${octShift >= 0 ? "+" : ""}${octShift}`;
}

function paintKey(midi, down) {
  const el = keyEls.get(midi);
  if (el) el.classList.toggle("down", down);
}

function attachPianoPointers(piano) {
  const pointerNote = new Map(); // pointerId -> midi
  const noteOf = (target) => {
    const el = target.closest?.(".bkey") || target.closest?.(".pkey");
    return el ? Number(el.dataset.note) : null;
  };
  piano.addEventListener("pointerdown", (ev) => {
    const n = noteOf(ev.target);
    if (n == null) return;
    ev.preventDefault();
    pointerNote.set(ev.pointerId, n);
    liveNoteOn(n);
  });
  piano.addEventListener("pointermove", (ev) => {
    if (!pointerNote.has(ev.pointerId)) return;
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    const n = noteOf(el);
    const prev = pointerNote.get(ev.pointerId);
    if (n != null && n !== prev) {
      liveNoteOff(prev);
      if (hold) { live.noteOff(prev); heldNotes.delete(prev); paintKey(prev, false); }
      pointerNote.set(ev.pointerId, n);
      liveNoteOn(n);
    }
  });
  const release = (ev) => {
    const n = pointerNote.get(ev.pointerId);
    if (n == null) return;
    pointerNote.delete(ev.pointerId);
    liveNoteOff(n);
  };
  piano.addEventListener("pointerup", release);
  piano.addEventListener("pointercancel", release);
  piano.addEventListener("pointerleave", (ev) => {
    if (ev.target === piano) release(ev);
  });
}

// Computer keys play notes everywhere (no text inputs in the app).
const downComputerKeys = new Map(); // event.key -> midi
document.addEventListener("keydown", (e) => {
  // Undo/redo for workbench edits (knobs, wiring, structure).
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    if (!restoreInFlight) e.shiftKey ? doRedo() : doUndo();
    return;
  }
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k in KEYMAP) {
    const midi = 60 + 12 * octShift + KEYMAP[k];
    if (midi >= 0 && midi <= 127 && !downComputerKeys.has(k)) {
      downComputerKeys.set(k, midi);
      liveNoteOn(midi);
    }
    return;
  }
  if (k === "z") return octave(-1);
  if (k === "x") return octave(1);
  if (currentView === "evolve") {
    if (e.key === "1") $("play-a").click();
    else if (e.key === "2") $("play-b").click();
    else if (e.key === "ArrowLeft") $("choose-a").click();
    else if (e.key === "ArrowRight") $("choose-b").click();
  }
});
document.addEventListener("keyup", (e) => {
  const k = e.key.toLowerCase();
  const midi = downComputerKeys.get(k);
  if (midi !== undefined) {
    downComputerKeys.delete(k);
    liveNoteOff(midi);
  }
});
window.addEventListener("blur", () => {
  downComputerKeys.clear();
  panic();
});

function octave(d) {
  octShift = Math.max(-2, Math.min(2, octShift + d));
  paintHints();
}

$("oct-down").onclick = () => octave(-1);
$("oct-up").onclick = () => octave(1);
$("hold-btn").onclick = () => {
  hold = !hold;
  $("hold-btn").classList.toggle("lit", hold);
  if (!hold) panic();
};
$("panic-btn").onclick = () => panic();
$("vol").oninput = (e) => live && live.setVolume(Number(e.target.value));

// ---------- performance controls (arp / unison / glide) ----------
const perf = { arp: false, arpMode: 0, arpDiv: 2, bpm: 120, uni: false, glide: 0 };

function sendArp() {
  if (live) live.arp(perf.arp, perf.arpMode, perf.arpDiv, perf.bpm);
  $("arp-btn").classList.toggle("lit", perf.arp);
}
function sendUni() {
  if (live) live.unison(perf.uni, 0.4, 0.8);
  $("uni-btn").classList.toggle("lit", perf.uni);
}
function applyPerfUi() {
  $("arp-mode").value = String(perf.arpMode);
  $("arp-div").value = String(perf.arpDiv);
  $("bpm").value = String(perf.bpm);
  $("glide").value = String(perf.glide);
  sendArp();
  sendUni();
  if (live) live.glide(perf.glide);
}
$("arp-btn").onclick = () => { perf.arp = !perf.arp; sendArp(); scheduleSave(); };
$("arp-mode").onchange = (e) => { perf.arpMode = Number(e.target.value); sendArp(); scheduleSave(); };
$("arp-div").onchange = (e) => { perf.arpDiv = Number(e.target.value); sendArp(); scheduleSave(); };
$("bpm").onchange = (e) => {
  perf.bpm = Math.max(30, Math.min(300, Number(e.target.value) || 120));
  e.target.value = perf.bpm;
  sendArp();
  scheduleSave();
};
$("uni-btn").onclick = () => { perf.uni = !perf.uni; sendUni(); scheduleSave(); };
$("glide").oninput = (e) => {
  perf.glide = Number(e.target.value);
  if (live) live.glide(perf.glide);
  scheduleSave();
};
// Typing a BPM must not play notes.
$("bpm").addEventListener("keydown", (e) => e.stopPropagation());
$("bpm").addEventListener("keyup", (e) => e.stopPropagation());

// ---------- recording (WAV bounce of live playing) ----------
let recording = false;
$("rec-btn").onclick = () => {
  if (!live) return;
  recording = !recording;
  $("rec-btn").classList.toggle("lit", recording);
  $("rec-btn").textContent = recording ? "◼ stop" : "● rec";
  live.rec(recording);
  if (recording) note("recording — play something; stop to download the take");
};

function downloadWav(samples, sampleRate) {
  // Interleaved stereo float → 16-bit PCM WAV.
  const nFrames = samples.length / 2;
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const dv = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF");
  dv.setUint32(4, 36 + samples.length * 2, true);
  w(8, "WAVEfmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);      // PCM
  dv.setUint16(22, 2, true);      // stereo
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 4, true);
  dv.setUint16(32, 4, true);
  dv.setUint16(34, 16, true);
  w(36, "data");
  dv.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    dv.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
  const who = (liveLabelText || "take").replace(/[^\w-]+/g, "_").slice(0, 32);
  a.download = `evosynth-${who}.wav`;
  a.click();
  URL.revokeObjectURL(a.href);
  note(`saved ${(nFrames / sampleRate).toFixed(1)}s take`);
}

// ---------- Web MIDI ----------
function bootMidi() {
  if (!navigator.requestMIDIAccess) return;
  navigator.requestMIDIAccess({ sysex: false }).then((access) => {
    const wire = () => {
      let n = 0;
      for (const input of access.inputs.values()) {
        n += 1;
        input.onmidimessage = (ev) => {
          const [stat, d1, d2] = ev.data;
          const kind = stat & 0xf0;
          if (kind === 0x90 && d2 > 0) liveNoteOn(d1, d2 / 127);
          else if (kind === 0x80 || (kind === 0x90 && d2 === 0)) liveNoteOff(d1);
          else if (kind === 0xe0 && live) {
            live.bend((((d2 << 7) | d1) - 8192) / 8192 * 2); // ±2 semitones
          } else if (kind === 0xb0 && d1 === 64) {
            // Sustain pedal = hold latch.
            hold = d2 >= 64;
            $("hold-btn").classList.toggle("lit", hold);
            if (!hold) panic();
          } else if (kind === 0xb0 && d1 === 123) {
            panic();
          }
        };
      }
      $("midi-ind").textContent = n > 0 ? `midi ●${n > 1 ? n : ""}` : "midi —";
      $("midi-ind").classList.toggle("on", n > 0);
    };
    wire();
    access.onstatechange = wire;
  }).catch(() => {});
}

// ---------- duel flow ----------
function loadSide(side, id) {
  $(`readout-${side}`).textContent = "…";
  clearScope($(`scope-${side}`));
  if (renders.has(id)) onRenderArrived(id);
  else send({ type: "render", id });
}

function onRenderArrived(id) {
  if (!currentDuel) return;
  const side = id === currentDuel[0] ? "a" : id === currentDuel[1] ? "b" : null;
  if (!side) return;
  const r = renders.get(id);
  $(`readout-${side}`).textContent = r.sexpr;
  drawWave($(`scope-${side}`), r.buffer.getChannelData(0));
}

function setDuelSelection(side) {
  $("duel-a").classList.toggle("live-sel", side === "a");
  $("duel-b").classList.toggle("live-sel", side === "b");
}

function selectDuelSide(side) {
  if (!currentDuel) return;
  const id = side === "a" ? currentDuel[0] : currentDuel[1];
  setDuelSelection(side);
  send({ type: "tree_json", id });
}

function choose(side) {
  if (!currentDuel) return;
  const [a, b] = currentDuel;
  const choseA = side === "a";
  send({ type: "record_duel", a, b, choseA });
  duelsSinceFit += 1;
  if (duelsSinceFit >= FIT_EVERY && !fitting) {
    duelsSinceFit = 0;
    fitting = true;
    $("led-learn").classList.add("on");
    send({ type: "fit" });
  }
  currentDuel = null;
  send({ type: "duel" });
}

$("duel-a").addEventListener("click", (e) => {
  if (e.target.closest("button")) return;
  selectDuelSide("a");
});
$("duel-b").addEventListener("click", (e) => {
  if (e.target.closest("button")) return;
  selectDuelSide("b");
});
$("play-a").onclick = () => currentDuel && play(currentDuel[0], $("play-a"));
$("play-b").onclick = () => currentDuel && play(currentDuel[1], $("play-b"));
$("choose-a").onclick = () => choose("a");
$("choose-b").onclick = () => choose("b");
$("skip-duel").onclick = () => {
  currentDuel = null;
  send({ type: "duel" });
};
$("evolve-btn").onclick = () => {
  $("evolve-btn").disabled = true;
  $("led-evolve").classList.add("on");
  send({ type: "refine" });
};

// ---------- patch bank ----------
let bankScrollTo = null;

function renderBank() {
  const list = $("bank-list");
  const ranked = (views && views.ranked) || [];
  const rows = ranked.filter((r) => !cutIds.has(r.id));
  $("bank-count").textContent = rows.length ? `${rows.length} patches` : "";
  list.innerHTML = "";
  if (rows.length === 0) {
    list.innerHTML = '<div class="bench-empty">Nothing here yet.</div>';
    return;
  }
  const maxU = Math.max(0.01, ...rows.map((r) => r.mean));
  const minU = Math.min(0, ...rows.map((r) => r.mean));
  const ORIGIN_GLYPH = { prior: "◇", refined: "⚡", edited: "✎", preset: "▤" };
  for (const r of rows) {
    const el = document.createElement("div");
    el.className = "bank-item" + (r.id === wb.subjectId ? " live" : "");
    const frac = (r.mean - minU) / Math.max(1e-9, maxU - minU);
    const stars = starsById.get(r.id) || 0;
    el.innerHTML = `
      <div class="bi-top">
        <span class="bi-origin ${r.origin}" title="${r.origin}">${ORIGIN_GLYPH[r.origin] || ""}</span>
        <span class="bi-name ${r.named ? "custom" : ""}" title="Double-click to rename">${r.name}</span>
        <span class="bi-id">#${r.id}</span>
        <span class="bi-u" title="how much the model thinks you like it"><i style="width:${Math.round(frac * 100)}%"></i></span>
      </div>
      <div class="bi-row">
        <button class="bi-hear" title="Audition phrase">▶</button>
        ${[1, 2, 3, 4, 5]
          .map((s) => `<button class="star ${stars >= s ? "lit" : ""}" data-s="${s}" title="${s} star${s > 1 ? "s" : ""}">★</button>`)
          .join("")}
        <button class="bi-kill" title="Cut: teach the model you don't want this">cut</button>
      </div>`;
    el.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      openOnBench(r.id);
      showView("play");
    });
    el.querySelector(".bi-hear").onclick = () => {
      if (renders.has(r.id)) play(r.id);
      else {
        send({ type: "render", id: r.id });
        const wait = setInterval(() => {
          if (renders.has(r.id)) { clearInterval(wait); play(r.id); }
        }, 120);
      }
    };
    el.querySelectorAll(".star").forEach((btn) => {
      btn.onclick = () => {
        starsById.set(r.id, Number(btn.dataset.s));
        send({ type: "record_stars", id: r.id, rating: Number(btn.dataset.s) });
        renderBank();
      };
    });
    el.querySelector(".bi-kill").onclick = () => {
      send({ type: "record_keep", id: r.id, kept: false });
      cutIds.add(r.id);
      renderBank();
    };
    const nameEl = el.querySelector(".bi-name");
    nameEl.ondblclick = (ev) => {
      ev.stopPropagation();
      const input = document.createElement("input");
      input.className = "bi-rename";
      input.value = r.named ? r.name : "";
      input.placeholder = r.name;
      input.maxLength = 40;
      nameEl.replaceWith(input);
      input.focus();
      input.select();
      const commit = () => send({ type: "set_name", id: r.id, name: input.value });
      input.onkeydown = (ke) => {
        ke.stopPropagation(); // typing must not play notes
        if (ke.key === "Enter") input.blur();
        if (ke.key === "Escape") { input.oninput = null; input.onblur = null; renderBank(); }
      };
      input.onkeyup = (ke) => ke.stopPropagation();
      input.onblur = commit;
    };
    list.appendChild(el);
  }
  if (bankScrollTo != null) {
    const target = list.querySelector(".bank-item.live");
    if (target) target.scrollIntoView({ block: "nearest", behavior: "smooth" });
    bankScrollTo = null;
  }
}

// ---------- presets ----------
let presetRows = null;

$("presets-btn").onclick = () => {
  const pop = $("presets-pop");
  if (!pop.classList.contains("hidden")) {
    pop.classList.add("hidden");
    return;
  }
  if (presetRows) renderPresetsPop();
  else send({ type: "presets" });
};

function renderPresetsPop() {
  const pop = $("presets-pop");
  pop.innerHTML = presetRows
    .map(
      (r) =>
        `<button class="pp-item" data-i="${r.index}"><span class="pp-name">${r.name}</span><span class="pp-sig">${r.sig}</span></button>`
    )
    .join("");
  pop.querySelectorAll(".pp-item").forEach((btn) => {
    btn.onclick = () => {
      pop.classList.add("hidden");
      send({ type: "load_preset", index: Number(btn.dataset.i) });
    };
  });
  pop.classList.remove("hidden");
}

document.addEventListener("click", (e) => {
  if (!e.target.closest(".presets-pop") && !e.target.closest("#presets-btn")) {
    $("presets-pop").classList.add("hidden");
  }
  if (!e.target.closest(".ctx-menu") && !e.target.closest(".mod-menu-btn")) {
    $("ctx-menu").classList.add("hidden");
  }
});

// ---------- workbench ----------
function openOnBench(id) {
  send({ type: "edit_begin", id });
}

function sendEdit(addr, value, isIndex) {
  // Sound first: continuous knobs write straight into the running voices.
  if (isIndex) nonLiveAddrs.add(addr);
  else if (live) live.param(addr, value);
  // Genome second: the worker validates, re-renders the phrase, updates φ.
  if (editInFlight) {
    editQueue = { addr, value, isIndex };
    return;
  }
  editInFlight = true;
  send({ type: "edit_param", addr, value, isIndex });
}

function playBench() {
  if (wb.buffer) playBuffer(wb.buffer, $("rack-play"));
  else if (!wb.vetOk) note("⚠ unvetted state — audio withheld");
}

// Layout constants.
const MOD_W = 152;
const COL_W = 186;
const KNOB_R = 14;
const KNOBS_PER_ROW = 2;

function moduleHeight(mod) {
  const rows = Math.max(1, Math.ceil(mod.knobs.length / KNOBS_PER_ROW));
  return 30 + rows * 58;
}

function knobPos(mod, i) {
  const row = Math.floor(i / KNOBS_PER_ROW);
  const inRow = mod.knobs.length - row * KNOBS_PER_ROW >= KNOBS_PER_ROW
    ? KNOBS_PER_ROW
    : mod.knobs.length - row * KNOBS_PER_ROW;
  const col = i % KNOBS_PER_ROW;
  const x = (MOD_W / (inRow + 1)) * (col + 1);
  const y = 46 + row * 58;
  return { x, y };
}

function moduleLockAddrs(mod) {
  return [...mod.structural_addrs, ...mod.knobs.map((k) => k.addr)];
}

function isModuleLocked(mod) {
  const addrs = moduleLockAddrs(mod);
  return addrs.length > 0 && addrs.every((a) => wb.locks.has(a));
}

function svgEl(tag, attrs, cls) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
  if (cls) el.setAttribute("class", cls);
  return el;
}

function renderRack() {
  const svg = $("rack-svg");
  const hasRack = wb.rack && wb.rack.modules && wb.rack.modules.length > 0;
  $("rack-empty").style.display = hasRack ? "none" : "flex";
  const enable = (id, on) => { $(id).disabled = !on; };
  enable("rack-play", hasRack && wb.vetOk);
  enable("rack-commit", hasRack && wb.dirty && wb.vetOk);
  enable("rack-evolve", hasRack);
  enable("lock-knobs", hasRack);
  enable("lock-structure", hasRack);
  enable("lock-clear", hasRack && wb.locks.size > 0);
  if (!hasRack) { svg.innerHTML = ""; return; }

  buildRack(svg, wb.rack, {
    interactive: true,
    locks: wb.locks,
    minW: $("rack-scroll").clientWidth - 4,
    minH: $("rack-scroll").clientHeight - 4,
  });

  const subjName = wb.subjectId != null ? nameOf(wb.subjectId) : "";
  const subj = wb.subjectId != null ? `${subjName} (#${wb.subjectId})${wb.dirty ? " · edited" : ""}` : "";
  const lockInfo = wb.locks.size ? ` · ${wb.locks.size} locked` : "";
  $("rack-subject").textContent = `— ${subj}${lockInfo}${wb.vetOk ? "" : " · ⚠ UNVETTED"}`;
}

// Shared rack renderer: the interactive workbench and the read-only duel
// minis draw through the same code, so the circuit always looks the same.
function buildRack(svg, rack, opts) {
  const { interactive = false, locks = new Set(), minW = 0, minH = 0, fit = false } = opts || {};
  svg.innerHTML = "";
  const defs = svgEl("defs", {});
  defs.innerHTML = `
    <linearGradient id="plateGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1f242b"/><stop offset="1" stop-color="#15181d"/>
    </linearGradient>
    <radialGradient id="knobGrad" cx="0.35" cy="0.3" r="0.9">
      <stop offset="0" stop-color="#3b414c"/><stop offset="0.7" stop-color="#20242b"/>
      <stop offset="1" stop-color="#101216"/>
    </radialGradient>`;
  svg.appendChild(defs);

  // Columns: amp (col 0) sits rightmost; deeper modules leftward.
  const maxCol = Math.max(...rack.modules.map((m) => m.column));
  const byCol = new Map();
  for (const m of rack.modules) {
    const cx = maxCol - m.column;
    if (!byCol.has(cx)) byCol.set(cx, []);
    byCol.get(cx).push(m);
  }
  const nCols = maxCol + 1;
  const pos = new Map();
  let maxHeight = 0;
  for (const [, mods] of byCol) {
    let stack = 0;
    for (const m of mods) stack += moduleHeight(m) + 16;
    maxHeight = Math.max(maxHeight, stack);
  }
  const natW = nCols * COL_W + 30;
  const natH = maxHeight + 24;
  const svgW = Math.max(minW, natW);
  const svgH = Math.max(minH, natH);
  if (fit) {
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.setAttribute("viewBox", `0 0 ${natW} ${natH}`);
  } else {
    svg.setAttribute("width", svgW);
    svg.setAttribute("height", svgH);
    svg.setAttribute("viewBox", `0 0 ${svgW} ${svgH}`);
  }
  const layoutH = fit ? natH : svgH;
  for (const [cx, mods] of byCol) {
    const total = mods.reduce((s, m) => s + moduleHeight(m) + 16, -16);
    let y = (layoutH - total) / 2;
    for (const m of mods) {
      const h = moduleHeight(m);
      pos.set(m.key, { x: 15 + cx * COL_W, y, w: MOD_W, h });
      y += h + 16;
    }
  }

  // Wires under modules.
  const wireLayer = svgEl("g", {});
  svg.appendChild(wireLayer);
  const modByKey = new Map(rack.modules.map((m) => [m.key, m]));
  for (const w of rack.wires) {
    const from = pos.get(w.from);
    const to = pos.get(w.to);
    if (!from || !to) continue;
    const x1 = from.x + from.w;
    const y1 = from.y + from.h / 2;
    let x2, y2, d;
    if (w.kind === "mod") {
      // Mod cables land on the target's bottom mod jack.
      x2 = to.x + to.w / 2;
      y2 = to.y + to.h;
      const dx = Math.max(24, (x2 - x1) / 2);
      d = `M ${x1} ${y1} C ${x1 + dx} ${y1 + 16}, ${x2} ${y2 + 26}, ${x2} ${y2}`;
    } else {
      // Audio cables land on the target's in jack (mix: a or b).
      const toMod = modByKey.get(w.to);
      x2 = to.x;
      y2 = to.y + to.h / 2;
      if (toMod && toMod.kind === "mix") {
        y2 = to.y + to.h * (w.from === `${w.to}/0` ? 0.38 : 0.68);
      }
      const dx = Math.max(24, (x2 - x1) / 2);
      const sag = 14 + Math.abs(y2 - y1) * 0.08;
      d = `M ${x1} ${y1} C ${x1 + dx} ${y1 + sag}, ${x2 - dx} ${y2 + sag}, ${x2} ${y2}`;
    }
    wireLayer.appendChild(svgEl("path", { d }, `wire ${w.kind}-glow`));
    wireLayer.appendChild(svgEl("path", { d }, `wire ${w.kind}`));
  }

  const isModuleLockedIn = (mod) => {
    const addrs = moduleLockAddrs(mod);
    return addrs.length > 0 && addrs.every((a) => locks.has(a));
  };

  for (const m of rack.modules) {
    const p = pos.get(m.key);
    const g = svgEl("g", { transform: `translate(${p.x},${p.y})` });
    const plateCls = `mod-plate${m.is_mod ? " modside" : ""}${isModuleLockedIn(m) ? " locked" : ""}`;
    g.appendChild(svgEl("rect", { width: p.w, height: p.h, rx: 5 }, plateCls));
    const title = svgEl("text", { x: 9, y: 17 }, `mod-title${m.is_mod ? " modside" : ""}`);
    title.textContent = m.title;
    g.appendChild(title);

    if (interactive) {
      // Structure menu (⋯) — every module; the amp offers insert-at-output.
      const menuBtn = svgEl("text", { x: p.w - 32, y: 17 }, "mod-menu-btn");
      menuBtn.textContent = "⋯";
      const mt = svgEl("title", {});
      mt.textContent = m.kind === "amp"
        ? "Add a module at the output"
        : "Restructure: replace, insert, delete, rewire";
      menuBtn.appendChild(mt);
      menuBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        openStructMenu(m, ev.clientX, ev.clientY);
      });
      g.appendChild(menuBtn);

      if (m.kind !== "amp") {
        const lockOn = isModuleLockedIn(m);
        const mlock = svgEl("text", { x: p.w - 16, y: 17 }, `mod-lock${lockOn ? " on" : ""}`);
        mlock.textContent = lockOn ? "▣" : "▢";
        const mtitle = svgEl("title", {});
        mtitle.textContent = lockOn
          ? "Unlock this module (evolution may change it again)"
          : "Lock this whole module (evolution keeps it exactly as-is)";
        mlock.appendChild(mtitle);
        mlock.addEventListener("click", () => {
          const addrs = moduleLockAddrs(m);
          const on = isModuleLockedIn(m);
          for (const a of addrs) on ? wb.locks.delete(a) : wb.locks.add(a);
          renderRack();
        });
        g.appendChild(mlock);
      }
    }

    // ---- labeled jacks (green = audio, amber = modulation) ----
    const addJack = (gx, gy, cls, label, labelSide, data) => {
      const jg = svgEl("g", { transform: `translate(${gx},${gy})` }, `jack${cls ? " " + cls : ""}`);
      if (interactive && data) {
        for (const [dk, dv] of Object.entries(data)) jg.setAttribute(dk, dv);
      }
      jg.appendChild(svgEl("circle", { r: 5.5 }));
      const attrs =
        labelSide === "right" ? { x: 9, y: 3 } :
        labelSide === "left" ? { x: -9, y: 3, "text-anchor": "end" } :
        { x: 0, y: 15, "text-anchor": "middle" };
      const t = svgEl("text", attrs);
      t.textContent = label;
      jg.appendChild(t);
      g.appendChild(jg);
      return jg;
    };
    const isSource = ["vco", "supersaw", "noise"].includes(m.kind);
    if (m.is_mod) {
      addJack(p.w, p.h / 2, "modjack", "out", "left");
    } else if (m.kind === "amp") {
      const j = addJack(0, p.h / 2, "", "in", "right", { "data-childkey": "node" });
      if (interactive) {
        j.addEventListener("pointerdown", (ev) => {
          ev.preventDefault();
          startWireDrag({ mode: "unplug-audio", childKey: "node", kind: "audio" }, ev);
        });
      }
    } else {
      if (!isSource) {
        const ins = m.kind === "mix"
          ? [[p.h * 0.38, "a", `${m.key}/0`], [p.h * 0.68, "b", `${m.key}/1`]]
          : [[p.h / 2, "in", `${m.key}/0`]];
        for (const [jy, lbl, ck] of ins) {
          const j = addJack(0, jy, "", lbl, "right", { "data-childkey": ck });
          if (interactive) {
            j.addEventListener("pointerdown", (ev) => {
              ev.preventDefault();
              startWireDrag({ mode: "unplug-audio", childKey: ck, kind: "audio" }, ev);
            });
          }
        }
      }
      addJack(p.w, p.h / 2, "", "out", "left");
      if (m.kind === "filter" || m.kind === "fold") {
        const j = addJack(p.w / 2, p.h, "modjack", "mod", "below", { "data-modkey": m.key });
        if (interactive) {
          j.addEventListener("pointerdown", (ev) => {
            if (!modAtKey(m.key)) return; // empty slot: target only
            ev.preventDefault();
            startWireDrag({ mode: "unplug-mod", key: m.key, kind: "mod" }, ev);
          });
        }
      }
    }

    m.knobs.forEach((k, i) => {
      const { x, y } = knobPos(m, i);
      const kg = svgEl("g", { transform: `translate(${x},${y})` });
      const locked = locks.has(k.addr);

      if (k.kind.t === "continuous") {
        kg.appendChild(svgEl("circle", { r: KNOB_R + 3 }, "knob-ring"));
        const body = svgEl("circle", { r: KNOB_R }, "knob-body");
        if (interactive) {
          const tt = svgEl("title", {});
          tt.textContent = `${k.label}: ${k.value.toFixed(2)} — drag up/down`;
          body.appendChild(tt);
        }
        kg.appendChild(body);
        const ang = (-135 + 270 * k.value) * (Math.PI / 180);
        const ix = Math.sin(ang) * (KNOB_R - 3);
        const iy = -Math.cos(ang) * (KNOB_R - 3);
        kg.appendChild(
          svgEl("line", { x1: 0, y1: 0, x2: ix, y2: iy }, `knob-ind${m.is_mod ? " modside" : ""}`)
        );
        if (locked) kg.appendChild(svgEl("circle", { r: KNOB_R + 6 }, "knob-locked-halo"));
        if (interactive) attachKnobDrag(body, m, k);
      } else {
        const bw = 52;
        const body = svgEl("rect", { x: -bw / 2, y: -11, width: bw, height: 22, rx: 3 }, "enum-body");
        const txt = svgEl("text", { y: 4 }, "enum-text");
        txt.textContent = enumDisplay(k);
        if (interactive) {
          const tt = svgEl("title", {});
          tt.textContent = `${k.label} — click to cycle`;
          body.appendChild(tt);
          body.addEventListener("click", (ev) => {
            pushUndo();
            const n = k.kind.t === "octave" ? 5 : k.kind.options.length;
            const next = (Math.round(k.value) + (ev.shiftKey ? n - 1 : 1)) % n;
            k.value = next;
            txt.textContent = enumDisplay(k);
            sendEdit(k.addr, next, true);
          });
        }
        kg.appendChild(body);
        kg.appendChild(txt);
        if (locked) {
          kg.appendChild(svgEl("rect", { x: -bw / 2 - 3, y: -14, width: bw + 6, height: 28, rx: 5 }, "knob-locked-halo"));
        }
      }

      if (interactive) {
        const dot = svgEl("g", { transform: `translate(${KNOB_R + 6},${-KNOB_R - 2})` }, `lock-dot${locked ? " on" : ""}`);
        dot.appendChild(svgEl("circle", { r: 3.4 }, ""));
        const dt = svgEl("title", {});
        dt.textContent = locked ? `Unlock ${k.label}` : `Lock ${k.label} (evolution won't touch it)`;
        dot.appendChild(dt);
        dot.addEventListener("click", () => {
          locked ? wb.locks.delete(k.addr) : wb.locks.add(k.addr);
          renderRack();
        });
        kg.appendChild(dot);
      }

      const lbl = svgEl("text", { y: KNOB_R + 13 }, "knob-label");
      lbl.textContent = k.label;
      kg.appendChild(lbl);
      if (k.kind.t === "continuous") {
        const val = svgEl("text", { y: KNOB_R + 22 }, "knob-value");
        val.textContent = k.value.toFixed(2);
        kg.appendChild(val);
      }
      g.appendChild(kg);
    });
    svg.appendChild(g);
  }
}

// ---------- structural edits ----------
const KIND_LABELS = {
  vco: "vco", supersaw: "supersaw", noise: "noise", mix: "mix",
  filter: "filter", fold: "wavefolder", delay: "delay", chorus: "chorus",
  reverb: "reverb",
};
const SOURCE_KINDS = ["vco", "supersaw", "noise"];
const PROC_KINDS = ["filter", "fold", "delay", "chorus", "reverb", "mix"];

function sendStruct(op) {
  pushUndo();
  send({ type: "edit_structure", op });
}

function openStructMenu(mod, x, y) {
  const menu = $("ctx-menu");
  const items = [];
  const item = (label, op, danger) =>
    items.push(`<button class="cm-item${danger ? " danger" : ""}" data-op='${JSON.stringify(op)}'>${label}</button>`);
  const head = (t) => items.push(`<div class="cm-head">${t}</div>`);

  if (mod.kind === "amp") {
    head("add at output");
    for (const k of PROC_KINDS) item(`+ ${KIND_LABELS[k]}`, { op: "insert", key: "node", kind: k });
  } else if (mod.is_mod) {
    // LFO / mod-env: swap or remove via the parent's mod slot.
    const parentKey = mod.key.replace(/\/m$/, "");
    head("modulation");
    for (const [label, kind] of [["none (remove)", "none"], ["lfo", "lfo"], ["mod env", "env"], ["s&h rand", "rand"]]) {
      item(label, { op: "set_mod", key: parentKey, kind });
    }
  } else {
    head("replace with");
    for (const k of [...SOURCE_KINDS, ...PROC_KINDS]) {
      if (k !== mod.kind) item(KIND_LABELS[k], { op: "replace", key: mod.key, kind: k });
    }
    head("insert after (toward output)");
    for (const k of PROC_KINDS) item(`+ ${KIND_LABELS[k]}`, { op: "insert", key: mod.key, kind: k });
    if (mod.kind === "filter" || mod.kind === "fold") {
      head("modulation");
      for (const [label, kind] of [["none", "none"], ["lfo", "lfo"], ["mod env", "env"], ["s&h rand", "rand"]]) {
        item(label, { op: "set_mod", key: mod.key, kind });
      }
    }
    if (mod.kind === "mix") {
      head("mixer");
      item("swap inputs", { op: "swap_mix", key: mod.key });
    }
    head("");
    item("delete", { op: "delete", key: mod.key }, true);
  }

  menu.innerHTML = items.join("");
  menu.querySelectorAll(".cm-item").forEach((btn) => {
    btn.onclick = () => {
      menu.classList.add("hidden");
      sendStruct(JSON.parse(btn.dataset.op));
    };
  });
  menu.classList.remove("hidden");
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = `${Math.min(x, window.innerWidth - mw - 8)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - mh - 8)}px`;
}

// ---------- duel card flip ----------
const flipped = { a: false, b: false };

function setFlip(side, on) {
  flipped[side] = on;
  $(`scope-${side}`).classList.toggle("hidden", on);
  $(`readout-${side}`).classList.toggle("hidden", on);
  $(`mini-${side}`).classList.toggle("hidden", !on);
  $(`flip-${side}`).textContent = on ? "⇄ wave" : "⇄ circuit";
  if (on && currentDuel) {
    const id = side === "a" ? currentDuel[0] : currentDuel[1];
    send({ type: "describe", id });
  }
}

function onDescribed(id, rack) {
  if (!currentDuel || !rack) return;
  const side = id === currentDuel[0] ? "a" : id === currentDuel[1] ? "b" : null;
  if (!side || !flipped[side]) return;
  buildRack($(`mini-svg-${side}`), rack, { fit: true });
}

$("flip-a").onclick = () => setFlip("a", !flipped.a);
$("flip-b").onclick = () => setFlip("b", !flipped.b);
$("promote-a").onclick = () => {
  if (!currentDuel) return;
  openOnBench(currentDuel[0]);
  showView("play");
};
$("promote-b").onclick = () => {
  if (!currentDuel) return;
  openOnBench(currentDuel[1]);
  showView("play");
};

function enumDisplay(k) {
  if (k.kind.t === "octave") {
    const v = Math.round(k.value) - 2;
    return (v >= 0 ? "+" : "") + v + " oct";
  }
  return k.kind.options[Math.round(k.value)] ?? "?";
}

function attachKnobDrag(el, mod, knob) {
  el.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    el.setPointerCapture(ev.pointerId);
    pushUndo(); // one undo step per knob gesture
    knobDragging = true;
    const startY = ev.clientY;
    const startV = knob.value;
    const line = el.parentNode.querySelector(".knob-ind");
    const valText = el.parentNode.querySelector(".knob-value");
    const onMove = (mv) => {
      const dv = (startY - mv.clientY) / 140;
      const v = Math.min(1, Math.max(0, startV + dv));
      knob.value = v;
      const ang = (-135 + 270 * v) * (Math.PI / 180);
      line.setAttribute("x2", Math.sin(ang) * (KNOB_R - 3));
      line.setAttribute("y2", -Math.cos(ang) * (KNOB_R - 3));
      if (valText) valText.textContent = v.toFixed(2);
      sendEdit(knob.addr, v, false);
    };
    const onUp = () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      knobDragging = false;
      renderRack();
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
  });
}

function startEvolveFrom(id) {
  $("rack-evolve").disabled = true;
  $("led-evolve").classList.add("on");
  note("⚡ evolving around the locked controls…");
  send({ type: "refine_from", id, locks: [...wb.locks] });
}

$("rack-play").onclick = () => playBench();
$("rack-commit").onclick = () => {
  send({ type: "edit_commit", asImprovement: $("improve-check").checked });
};
$("rack-evolve").onclick = () => {
  if (wb.subjectId == null) return;
  if (wb.dirty) {
    pendingEvolve = true;
    note("committing your edits, then evolving…");
    send({ type: "edit_commit", asImprovement: $("improve-check").checked });
  } else {
    startEvolveFrom(wb.subjectId);
  }
};
$("lock-knobs").onclick = () => {
  if (!wb.rack) return;
  for (const m of wb.rack.modules) for (const k of m.knobs) wb.locks.add(k.addr);
  renderRack();
};
$("lock-structure").onclick = () => {
  if (!wb.rack) return;
  for (const m of wb.rack.modules) for (const a of m.structural_addrs) wb.locks.add(a);
  renderRack();
};
$("lock-clear").onclick = () => {
  wb.locks.clear();
  renderRack();
};


// ---------- patch-tree JSON utils (serde externally-tagged AudioNode) ----------
const AUDIO_TAGS = ["Vco", "Supersaw", "Noise", "Mix", "Filter", "Fold", "Delay", "Chorus", "Reverb"];
const SOURCE_TAGS = ["Vco", "Supersaw", "Noise"];

function nodeTag(n) {
  return typeof n === "string" ? n : Object.keys(n)[0];
}

function nodeChildrenJSON(n) {
  const tag = nodeTag(n);
  const v = n[tag];
  if (tag === "Mix") return [v.a, v.b];
  if (["Filter", "Fold", "Delay", "Chorus", "Reverb"].includes(tag)) return [v.input];
  return [];
}

function nodeAtKey(key) {
  if (!wb.tree) return null;
  let cur = wb.tree.root;
  if (key !== "node") {
    for (const i of key.slice(5).split("/").map(Number)) {
      const ch = nodeChildrenJSON(cur);
      if (!ch[i]) return null;
      cur = ch[i];
    }
  }
  return cur;
}

function modAtKey(key) {
  const n = nodeAtKey(key);
  if (!n) return null;
  const tag = nodeTag(n);
  if (tag !== "Filter" && tag !== "Fold") return null;
  const m = n[tag].modulation;
  return m === "None" ? null : m;
}

function subtreeSize(n) {
  return 1 + nodeChildrenJSON(n).reduce((s, c) => s + subtreeSize(c), 0);
}

// ---------- staged fragments: defaults (must mirror grammar mutate.rs) ----------
const FRAG_DEFAULTS = {
  vco: () => ({ Vco: { wave: "Saw", octave: 0, detune: 0.5 } }),
  supersaw: () => ({ Supersaw: { octave: 0, detune: 0.35, mix: 0.5 } }),
  noise: () => ({ Noise: { color: "White" } }),
  mix: () => ({
    Mix: {
      balance: 0.5,
      a: { Vco: { wave: "Saw", octave: 0, detune: 0.5 } },
      b: { Vco: { wave: "Triangle", octave: 0, detune: 0.5 } },
    },
  }),
  filter: () => ({
    Filter: {
      kind: "SvfLp", cutoff: 0.6, resonance: 0.3, mod_depth: 0.3,
      input: { Vco: { wave: "Saw", octave: 0, detune: 0.5 } },
      modulation: "None",
    },
  }),
  fold: () => ({
    Fold: {
      threshold: 0.5, mod_depth: 0.3,
      input: { Vco: { wave: "Saw", octave: 0, detune: 0.5 } },
      modulation: "None",
    },
  }),
  delay: () => ({
    Delay: { time: 0.35, feedback: 0.35, mix: 0.35, input: { Vco: { wave: "Saw", octave: 0, detune: 0.5 } } },
  }),
  chorus: () => ({
    Chorus: { rate: 0.3, depth: 0.4, mix: 0.35, input: { Vco: { wave: "Saw", octave: 0, detune: 0.5 } } },
  }),
  reverb: () => ({
    Reverb: { size: 0.5, damp: 0.5, mix: 0.3, input: { Vco: { wave: "Saw", octave: 0, detune: 0.5 } } },
  }),
  lfo: () => ({ Lfo: { wave: "Triangle", rate: 0.4 } }),
  env: () => ({ Env: { attack: 0.2, decay: 0.5 } }),
  rand: () => ({ Rand: { rate: 0.4 } }),
};

// ---------- tray (staged, unwired modules) ----------
const tray = [];
let trayUid = 1;

function fragLabel(frag, isMod) {
  const tag = nodeTag(frag);
  if (isMod) return tag === "Env" ? "mod env" : tag === "Rand" ? "s&h rand" : tag.toLowerCase();
  const size = subtreeSize(frag);
  return tag.toLowerCase() + (size > 1 ? `·${size}` : "");
}

function stageKind(kind) {
  const isMod = kind === "lfo" || kind === "env" || kind === "rand";
  tray.push({ uid: trayUid++, isMod, frag: FRAG_DEFAULTS[kind](), label: kind === "env" ? "mod env" : kind === "rand" ? "s&h rand" : kind });
  renderTray();
}

function stageFragment(frag, isMod) {
  if (!frag) return;
  tray.push({ uid: trayUid++, isMod, frag, label: fragLabel(frag, isMod) });
  renderTray();
}

function unstage(uid) {
  const i = tray.findIndex((t) => t.uid === uid);
  if (i >= 0) tray.splice(i, 1);
  renderTray();
}

function renderTray() {
  const holder = $("tray-items");
  holder.innerHTML = "";
  if (tray.length === 0) {
    holder.innerHTML = '<span class="tray-hint mono">unwired modules land here — drag a jack to patch them in</span>';
    return;
  }
  for (const t of tray) {
    const el = document.createElement("div");
    el.className = "tray-item" + (t.isMod ? " mod" : "");
    el.innerHTML = `<span class="t-jack" title="Drag onto a ${t.isMod ? "mod" : "in"} jack"></span><span>${t.label}</span><button class="t-x" title="Discard">✕</button>`;
    el.querySelector(".t-x").onclick = () => unstage(t.uid);
    el.querySelector(".t-jack").addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      startWireDrag({ mode: t.isMod ? "tray-mod" : "tray-audio", item: t, kind: t.isMod ? "mod" : "audio" }, ev);
    });
    holder.appendChild(el);
  }
}

// ---------- node bank ----------
const NB_AUDIO = ["vco", "supersaw", "noise", "mix", "filter", "fold", "delay", "chorus", "reverb"];
const NB_MOD = ["lfo", "env", "rand"];

function buildNodeBank() {
  const mk = (holder, kinds, mod) => {
    for (const k of kinds) {
      const b = document.createElement("button");
      b.className = "nb-item" + (mod ? " mod" : "");
      b.textContent = k === "env" ? "mod env" : k === "fold" ? "wavefolder" : k === "rand" ? "s&h rand" : k;
      b.title = "Stage in the tray";
      b.onclick = () => stageKind(k);
      holder.appendChild(b);
    }
  };
  mk($("nb-audio"), NB_AUDIO, false);
  mk($("nb-mod"), NB_MOD, true);
  $("nb-collapse").onclick = () => {
    const nb = $("nodebank");
    nb.classList.toggle("collapsed");
    $("nb-collapse").textContent = nb.classList.contains("collapsed") ? "◂" : "▸";
  };
}

// ---------- wire drawing ----------
let wire = null; // {mode, item?, childKey?, key?, kind}

function startWireDrag(spec, ev) {
  if (wire) return; // one cable at a time — no re-entrant drags
  wire = spec;
  const rackSvg = $("rack-svg");
  rackSvg.classList.add("wiring");
  // Light up legal targets.
  if (spec.mode === "tray-audio") {
    rackSvg.querySelectorAll('.jack[data-childkey]').forEach((j) => j.classList.add("legal"));
  } else if (spec.mode === "tray-mod") {
    rackSvg.querySelectorAll('.jack[data-modkey]').forEach((j) => j.classList.add("legal"));
  }
  drawWireBand(ev.clientX, ev.clientY, ev.clientX, ev.clientY, spec.kind);
  wire.sx = ev.clientX;
  wire.sy = ev.clientY;
  document.addEventListener("pointermove", onWireMove);
  document.addEventListener("pointerup", onWireUp, { once: true });
}

function drawWireBand(x1, y1, x2, y2, kind) {
  const dx = Math.max(30, Math.abs(x2 - x1) / 2);
  $("wire-overlay").innerHTML =
    `<path class="${kind}" d="M ${x1} ${y1} C ${x1 + dx} ${y1 + 20}, ${x2 - dx} ${y2 + 20}, ${x2} ${y2}"/>`;
}

function onWireMove(ev) {
  if (!wire) return;
  drawWireBand(wire.sx, wire.sy, ev.clientX, ev.clientY, wire.kind);
}

function endWireDrag() {
  document.removeEventListener("pointermove", onWireMove);
  $("wire-overlay").innerHTML = "";
  const rackSvg = $("rack-svg");
  rackSvg.classList.remove("wiring");
  rackSvg.querySelectorAll(".jack.legal").forEach((j) => j.classList.remove("legal"));
  wire = null;
}

function onWireUp(ev) {
  if (!wire) return endWireDrag();
  const el = document.elementFromPoint(ev.clientX, ev.clientY);
  const jack = el && el.closest ? el.closest(".jack") : null;
  const w = wire;
  endWireDrag();

  if (w.mode === "tray-audio") {
    const childKey = jack && jack.getAttribute("data-childkey");
    if (!childKey) return; // dropped on nothing: stays staged
    const frag = w.item.frag;
    if (SOURCE_TAGS.includes(nodeTag(frag))) {
      // A source takes the socket; the old chain parks in the tray.
      const old = nodeAtKey(childKey);
      sendStruct({ op: "replace_tree", key: childKey, node: frag });
      if (old) stageFragment(old, false);
      note("plugged in — the old chain is parked in the tray");
    } else {
      sendStruct({ op: "insert_tree", key: childKey, node: frag });
      note("patched into the wire");
    }
    unstage(w.item.uid);
  } else if (w.mode === "tray-mod") {
    const modKey = jack && jack.getAttribute("data-modkey");
    if (!modKey) return;
    const old = modAtKey(modKey);
    sendStruct({ op: "set_mod_tree", key: modKey, m: w.item.frag });
    if (old) stageFragment(old, true);
    unstage(w.item.uid);
    note("modulation connected");
  } else if (w.mode === "unplug-audio") {
    if (jack) return; // dropped back on a jack: treat as cancel
    const old = nodeAtKey(w.childKey);
    if (!old) return;
    stageFragment(old, false);
    sendStruct({ op: "replace_tree", key: w.childKey, node: FRAG_DEFAULTS.vco() });
    note("unplugged — chain parked in the tray; a fresh vco holds the socket");
  } else if (w.mode === "unplug-mod") {
    if (jack) return;
    const old = modAtKey(w.key);
    if (!old) return;
    stageFragment(old, true);
    sendStruct({ op: "set_mod", key: w.key, kind: "none" });
    note("modulation unplugged into the tray");
  }
}

// ---------- scopes ----------
function scopeCtx(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth * dpr;
  const h = canvas.clientHeight * dpr;
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  return canvas.getContext("2d");
}

function clearScope(canvas) {
  const ctx = scopeCtx(canvas);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGraticule(ctx, canvas.width, canvas.height, "rgba(142,240,177,0.07)");
}

function drawGraticule(ctx, w, h, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < 8; i++) { ctx.moveTo((w * i) / 8, 0); ctx.lineTo((w * i) / 8, h); }
  for (let i = 1; i < 4; i++) { ctx.moveTo(0, (h * i) / 4); ctx.lineTo(w, (h * i) / 4); }
  ctx.stroke();
}

function drawWave(canvas, data) {
  const ctx = scopeCtx(canvas);
  const { width: w, height: h } = canvas;
  if (w === 0) return;
  ctx.clearRect(0, 0, w, h);
  drawGraticule(ctx, w, h, "rgba(142,240,177,0.07)");
  const mid = h / 2;
  const step = Math.max(1, Math.floor(data.length / w));
  ctx.strokeStyle = "#8ef0b1";
  ctx.lineWidth = 1.4;
  ctx.shadowColor = "rgba(142,240,177,0.8)";
  ctx.shadowBlur = 6;
  ctx.beginPath();
  for (let x = 0; x < w; x++) {
    let min = 1.0, max = -1.0;
    const base = x * step;
    for (let i = 0; i < step && base + i < data.length; i++) {
      const v = data[base + i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    ctx.moveTo(x, mid - max * mid * 0.92);
    ctx.lineTo(x, mid - min * mid * 0.92 + 0.5);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
}

// ---------- taste instruments ----------
const NICE_NAMES = {
  centroid_mean: "brightness", centroid_std: "shimmer", rolloff_mean: "treble reach",
  flatness_mean: "noisiness", flux_mean: "movement", zcr_mean: "edge",
  rms_mean: "body", rms_std: "dynamics", crest: "punch", attack_s: "slow attack",
  tail_ratio: "long tail", bass_fraction: "bass weight",
  n_vco: "VCOs", n_supersaw: "supersaws", n_noise: "noise srcs", n_mix: "mixers",
  n_filter: "filters", n_fold: "wavefolders", n_delay: "delays", n_chorus: "choruses",
  n_reverb: "reverbs", n_rand: "S&H mods",
  n_lfo: "LFO mods", n_env: "env mods", depth: "patch depth", size: "patch size",
  mod_density: "mod density", amp_attack: "amp attack", amp_sustain: "amp sustain",
  amp_release: "amp release",
};

const STYLE_COLORS = ["#ffb454", "#8ef0b1", "#7ec8ff", "#ff8fb2", "#d9d4c8"];
const CAPTIONS = {
  map: "Every patch you’ve heard, mapped by sound & structure. Glow is how much the model thinks you’d like it — islands are styles. Click a dot to open it.",
  styles: "Your taste as separate styles — new lenses appear as you give the model more to work with (up to 5). Dim lenses are idle.",
  dir: "What each style listens for — learned directions in sound, not settings. Longer bar = stronger pull.",
};

let mapHits = [];

function drawTaste() {
  if (currentView !== "taste") return;
  const canvas = $("taste-crt");
  const ctx = scopeCtx(canvas);
  const { width: w, height: h } = canvas;
  if (w === 0) return;
  const dpr = window.devicePixelRatio || 1;
  ctx.clearRect(0, 0, w, h);
  drawGraticule(ctx, w, h, "rgba(255,180,84,0.06)");
  $("taste-caption").textContent = CAPTIONS[tasteTab];
  mapHits = [];

  ctx.font = `${10 * dpr}px "IBM Plex Mono", monospace`;
  const noTaste = !views || !views.styles;
  if (tasteTab === "map") drawMapTab(ctx, w, h, dpr);
  else if (tasteTab === "styles") {
    if (noTaste) return drawNoTaste(ctx, w, h, dpr);
    drawStylesTab(ctx, w, h, dpr);
  } else {
    if (noTaste) return drawNoTaste(ctx, w, h, dpr);
    drawDirectionsTab(ctx, w, h, dpr);
  }
}

function drawNoTaste(ctx, w, h, dpr) {
  ctx.fillStyle = "#7a5526";
  ctx.textAlign = "center";
  ctx.fillText("NO TASTE ON RECORD", w / 2, h / 2 - 8 * dpr);
  ctx.fillText("— duel to teach it —", w / 2, h / 2 + 10 * dpr);
  ctx.textAlign = "left";
}

function drawMapTab(ctx, w, h, dpr) {
  const map = views && views.map;
  if (!map || !map.points || map.points.length === 0) return drawNoTaste(ctx, w, h, dpr);
  const pts = map.points;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const pad = 34 * dpr;
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const sx = (v) => pad + ((v - x0) / Math.max(1e-9, x1 - x0)) * (w - 2 * pad);
  const sy = (v) => pad + ((v - y0) / Math.max(1e-9, y1 - y0)) * (h - 2 * pad);
  const us = pts.map((p) => p.utility);
  const [u0, u1] = [Math.min(...us), Math.max(...us)];
  const un = (u) => (u - u0) / Math.max(1e-9, u1 - u0);

  const draw = (p) => {
    const cx = sx(p.x), cy = sy(p.y);
    const isPool = p.id != null;
    const glow = un(p.utility);
    const color = STYLE_COLORS[p.style % STYLE_COLORS.length];
    if (isPool) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 3 + glow * 16;
      ctx.globalAlpha = 0.35 + 0.65 * glow;
      ctx.fillStyle = color;
      const r = (p.origin === "edited" ? 5.5 : p.origin === "refined" ? 4.8 : 4) * dpr;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      if (p.id === wb.subjectId) {
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.2 * dpr;
        ctx.beginPath();
        ctx.arc(cx, cy, r + 3 * dpr, 0, Math.PI * 2);
        ctx.stroke();
      }
      mapHits.push({ x: cx, y: cy, id: p.id });
    } else {
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 0.16 + 0.2 * glow;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx, cy, 2 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  pts.filter((p) => p.id == null).forEach(draw);
  pts.filter((p) => p.id != null).forEach(draw);
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;

  ctx.fillStyle = "#7a5526";
  ctx.textAlign = "left";
  ctx.fillText(
    `axes = sound-space PCA · ${Math.round((map.explained[0] + map.explained[1]) * 100)}% of variance`,
    10 * dpr, h - 8 * dpr
  );
  if (!views.styles) {
    ctx.fillText("glow appears after the first fit", 10 * dpr, 14 * dpr);
  }
}

function activeStyles() {
  if (!views || !views.styles) return [];
  return views.styles
    .map((s, k) => ({ ...s, k }))
    .sort((a, b) => b.share - a.share);
}

function drawStylesTab(ctx, w, h, dpr) {
  const styles = activeStyles();
  const blockH = h / styles.length;
  styles.forEach((s, row) => {
    const y0 = row * blockH;
    const color = STYLE_COLORS[s.k % STYLE_COLORS.length];
    const active = s.share >= 0.08;
    ctx.globalAlpha = active ? 1 : 0.35;

    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = active ? 8 : 0;
    ctx.beginPath();
    ctx.arc(18 * dpr, y0 + 20 * dpr, 5 * dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#d9d4c8";
    ctx.textAlign = "left";
    ctx.fillText(`style ${s.k + 1} — claims ${Math.round(s.share * 100)}% of the bank`, 30 * dpr, y0 + 24 * dpr);

    const rows = [...s.theta].sort((a, b) => Math.abs(b.mean) - Math.abs(a.mean)).slice(0, 5);
    const maxAbs = Math.max(0.12, ...rows.map((r) => Math.abs(r.mean)));
    const cx = w * 0.6, usable = w * 0.3;
    rows.forEach((r, i) => {
      const y = y0 + (42 + i * 18) * dpr;
      if (y > y0 + blockH - 8 * dpr) return;
      ctx.fillStyle = "#a08050";
      ctx.textAlign = "right";
      ctx.fillText(NICE_NAMES[r.name] || r.name, cx - usable - 10 * dpr, y + 3 * dpr);
      ctx.textAlign = "left";
      const len = (r.mean / maxAbs) * usable;
      ctx.fillStyle = color;
      ctx.fillRect(Math.min(cx, cx + len), y - 2.5 * dpr, Math.abs(len), 5 * dpr);
    });
    ctx.globalAlpha = 1;
    if (row > 0) {
      ctx.strokeStyle = "rgba(255,180,84,0.12)";
      ctx.beginPath();
      ctx.moveTo(10 * dpr, y0);
      ctx.lineTo(w - 10 * dpr, y0);
      ctx.stroke();
    }
  });
}

function drawDirectionsTab(ctx, w, h, dpr) {
  const styles = activeStyles().filter((s) => s.share >= 0.08);
  if (styles.length === 0) return drawNoTaste(ctx, w, h, dpr);
  const chosen = new Map();
  for (const s of styles) {
    [...s.theta]
      .sort((a, b) => Math.abs(b.mean) - Math.abs(a.mean))
      .slice(0, 7)
      .forEach((r) => {
        const score = Math.abs(r.mean);
        if (!chosen.has(r.name) || chosen.get(r.name) < score) chosen.set(r.name, score);
      });
  }
  const names = [...chosen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([n]) => n);
  const maxAbs = Math.max(
    0.12,
    ...styles.flatMap((s) => s.theta.filter((r) => names.includes(r.name)).map((r) => Math.abs(r.mean)))
  );
  const cx = w * 0.60, usable = w * 0.30;
  const rowH = h / (names.length + 1);

  ctx.strokeStyle = "rgba(255,180,84,0.25)";
  ctx.beginPath(); ctx.moveTo(cx, rowH * 0.4); ctx.lineTo(cx, h - rowH * 0.4); ctx.stroke();

  names.forEach((name, i) => {
    const y = rowH * (i + 1);
    ctx.fillStyle = "#a08050";
    ctx.textAlign = "right";
    ctx.fillText(NICE_NAMES[name] || name, cx - usable - 10 * dpr, y + 3 * dpr);
    ctx.textAlign = "left";
    const lane = 7 * dpr;
    styles.forEach((s, si) => {
      const r = s.theta.find((t) => t.name === name);
      if (!r) return;
      const yy = y + (si - (styles.length - 1) / 2) * lane;
      const len = (r.mean / maxAbs) * usable;
      const wl = Math.min((r.std / maxAbs) * usable, usable * 0.4);
      const color = STYLE_COLORS[s.k % STYLE_COLORS.length];
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 6;
      ctx.fillRect(Math.min(cx, cx + len), yy - 2 * dpr, Math.abs(len), 4 * dpr);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(255,220,160,0.5)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx + len - wl, yy);
      ctx.lineTo(cx + len + wl, yy);
      ctx.stroke();
    });
  });
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.onclick = () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    tasteTab = tab.dataset.tab;
    drawTaste();
  };
});

$("taste-crt").addEventListener("click", (ev) => {
  if (tasteTab !== "map" || mapHits.length === 0) return;
  const rect = ev.target.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const x = (ev.clientX - rect.left) * dpr;
  const y = (ev.clientY - rect.top) * dpr;
  let best = null, bestD = 12 * dpr;
  for (const hit of mapHits) {
    const d = Math.hypot(hit.x - x, hit.y - y);
    if (d < bestD) { bestD = d; best = hit; }
  }
  if (best) {
    openOnBench(best.id);
    note(`${nameOf(best.id)} selected — it's on the workbench and under your fingers`);
    bankScrollTo = best.id;
  }
});

// ---------- lineage ----------
function drawLineage() {
  if (currentView !== "evolve") return;
  const lineage = (views && views.lineage) || [];
  const canvas = $("lineage-spark");
  const ctx = scopeCtx(canvas);
  const { width: w, height: h } = canvas;
  if (w === 0) return;
  const dpr = window.devicePixelRatio || 1;
  ctx.clearRect(0, 0, w, h);
  drawGraticule(ctx, w, h, "rgba(255,180,84,0.05)");

  if (lineage.length > 0) {
    const us = lineage.map((ev) => ev.child_utility);
    const [u0, u1] = [Math.min(...us, 0), Math.max(...us, 0.001)];
    const sx = (i) => 8 * dpr + (i / Math.max(1, us.length - 1)) * (w - 16 * dpr);
    const sy = (u) => h - 8 * dpr - ((u - u0) / (u1 - u0)) * (h - 16 * dpr);
    ctx.strokeStyle = "#ffb454";
    ctx.shadowColor = "rgba(255,180,84,0.7)";
    ctx.shadowBlur = 5;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    us.forEach((u, i) => (i === 0 ? ctx.moveTo(sx(i), sy(u)) : ctx.lineTo(sx(i), sy(u))));
    ctx.stroke();
    ctx.shadowBlur = 0;
    us.forEach((u, i) => {
      ctx.fillStyle = lineage[i].kind === "edit" ? "#8ef0b1" : "#ffb454";
      ctx.beginPath();
      ctx.arc(sx(i), sy(u), 2 * dpr, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  const log = $("lineage-log");
  if (lineage.length === 0) return;
  log.innerHTML = lineage
    .slice(-3)
    .reverse()
    .map((ev) => {
      const du = ev.child_utility - ev.parent_utility;
      const sign = du >= 0 ? "+" : "−";
      return `<div><span class="gen-tag">gen ${ev.generation}</span>` +
        `${ev.kind === "edit" ? "✎ your edit" : "⚡ evolution"} on #${ev.parent_id} → <b>#${ev.child_id}</b> · ` +
        `${humanizeDiff(ev.diff)} · Δtaste ${sign}${Math.abs(du).toFixed(2)}</div>`;
    })
    .join("");
}

const SITE_NAMES = {
  cut: "cutoff", res: "resonance", mdepth: "mod depth", thresh: "fold",
  time: "delay time", fb: "feedback", dmix: "delay mix", crate: "chorus rate",
  cdepth: "chorus depth", cmix: "chorus mix", bal: "balance", det: "detune",
  smix: "stack mix", rate: "lfo rate", att: "mod attack", dec: "mod decay",
  attack: "attack", decay: "decay", sustain: "sustain", release: "release",
  wave: "wave", oct: "octave", color: "color", fkind: "filter mode",
  rsize: "reverb size", rdamp: "reverb damp", rmix: "reverb mix",
};

function humanizeDiff(diff) {
  if (!diff || diff.length === 0) return "no visible change";
  const parts = [];
  const added = diff.filter((d) => d.before == null);
  const removed = diff.filter((d) => d.after == null);
  const changed = diff.filter((d) => d.before != null && d.after != null);
  for (const d of changed.slice(0, 3)) {
    const site = d.addr.split("#").pop();
    parts.push(`${SITE_NAMES[site] || site} ${d.before}→${d.after}`);
  }
  if (changed.length > 3) parts.push(`+${changed.length - 3} more`);
  const struct = (list, sign) => {
    const ops = list.filter((d) => d.addr.endsWith("#op") || d.addr.endsWith("#src") || d.addr.endsWith("#mod"));
    for (const d of ops.slice(0, 2)) parts.push(`${sign}${sign === "+" ? d.after : d.before}`);
  };
  struct(added, "+");
  struct(removed, "−");
  return parts.join(", ") || `${diff.length} sites rewritten`;
}

// ---------- profile ----------
$("export-btn").onclick = () => send({ type: "export" });
$("import-input").onchange = async (e) => {
  const file = e.target.files[0];
  if (file) send({ type: "import", json: await file.text() });
};

// ---------- patch share (single-patch files) ----------
$("patch-export-btn").onclick = () => {
  if (!wb.tree) return note("nothing on the bench to export");
  const name = wb.subjectId != null ? nameOf(wb.subjectId) : "patch";
  const payload = JSON.stringify({ evosynth_patch: 1, name, tree: wb.tree }, null, 1);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
  a.download = `${name.replace(/[^\w-]+/g, "_").slice(0, 32)}.evopatch.json`;
  a.click();
  URL.revokeObjectURL(a.href);
};
$("patch-import-input").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const tree = data.tree || data; // accept bare trees too
    send({ type: "import_patch", json: JSON.stringify(tree), name: data.name || "" });
  } catch (_) {
    note("that file isn't a patch");
  }
};

// ---------- resize ----------
let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    drawTaste();
    drawLineage();
    if (!knobDragging) renderRack();
    if (currentDuel) {
      onRenderArrived(currentDuel[0]);
      onRenderArrived(currentDuel[1]);
    }
  }, 120);
});

// ---------- boot ----------
buildPiano();
buildNodeBank();
renderTray();
bootLiveAudio();
bootMidi();
(async () => {
  const saved = await idbGet("state");
  if (saved && saved.ui) {
    // Restore UI prefs before the engine finishes booting.
    for (const [id, s] of saved.ui.stars || []) starsById.set(id, s);
    for (const id of saved.ui.cut || []) cutIds.add(id);
    if (saved.ui.vol != null) $("vol").value = saved.ui.vol;
    if (saved.ui.oct != null) { octShift = saved.ui.oct; paintHints(); }
    if (saved.ui.perf) Object.assign(perf, saved.ui.perf);
    applyPerfUi();
  }
  send({
    type: "init",
    seed: Math.floor(Math.random() * 2 ** 31),
    poolSize: 40,
    saved: saved && saved.session ? saved.session : null,
  });
})();

// Debug/testing hook (no UI surface).
window.__evo = { audioCtx, getLive: () => live, wb, tray, nonLiveAddrs };
