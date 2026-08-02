// RICERCAR — a full instrument. Main thread: app frame (PLAY/EVOLVE/TASTE),
// patch bank, the interactive rack, taste instruments, and the live keyboard
// (AudioWorklet synthesis via live-audio.js). All engine compute (rendering,
// MCMC, evolution) lives in worker.js; candidates are addressed by stable id.

const $ = (id) => document.getElementById(id);
const SVG_NS = "http://www.w3.org/2000/svg";

// Canvas has no access to CSS custom properties, so read the token layer once
// at boot. Everything drawn into a <canvas> uses these — otherwise the painted
// surfaces (scopes, taste map, lineage) drift away from the styled ones every
// time the palette moves.
const cssVar = (name, fallback) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
const INK = {
  silk: cssVar("--silk", "#d9d4c8"),
  silkDim: cssVar("--silk-dim", "#9a958a"),
  green: cssVar("--phos-a", "#8ef0b1"),
  greenDim: cssVar("--phos-a-dim", "#63a97c"),
  amber: cssVar("--phos-b", "#ffb454"),
  amberDim: cssVar("--phos-b-dim", "#b8823c"),
};

// Version-stamp the worker and all wasm fetches so a stale browser cache can
// never pair an old engine with a newer UI.
const BUILD = Date.now();
const worker = new Worker(`./worker.js?v=${BUILD}`, { type: "module" });
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
// ONE master gain. Every audible path — live keys AND every ▶ phrase
// audition — routes through it, so the volume fader governs freshly evolved
// patches whose levels vary by tens of dB, which is exactly the path that
// needed a level control. Auditions used to connect straight to destination.
const master = audioCtx.createGain();
master.gain.value = 0.8;
master.connect(audioCtx.destination);

// ---------- state ----------
// Is the primary input a finger? Read once, at the top, because half a dozen
// decisions downstream depend on it — the keybed's default width, the size of
// every rack hit target, whether hover-revealed affordances have to be shown
// outright. A device does not grow a mouse mid-session, and the rack re-renders
// far too often to keep asking the same question of a media query.
const COARSE = window.matchMedia("(pointer: coarse)").matches;

const renders = new Map(); // id -> {buffer: AudioBuffer, sexpr}
// Ids the engine has told us it cannot render. Rendering is lazy in the worker
// now, so "the buffer never arrived" is a real, reachable outcome rather than
// an impossible one — a restored bank can outlive the DSP that made it, and a
// term that no longer vets is never going to produce audio no matter how long
// anyone waits.
const renderFailures = new Map(); // id -> reason|null
// True while the worker is inside a synchronous engine call (fit, refine,
// refine_from) and therefore servicing no messages at all. It is not a
// spinner: the render deadline below stops while it is set, because during a
// stopped queue a live render and a lost one look identical from here.
let engineBusy = false;
// Stateless render workers, alive only for boot. Their MessagePorts went into
// the engine worker; main holds the handles solely to reap them on `farm_done`.
const farmWorkers = [];
let currentDuel = null;    // [idA, idB]
let duelMeta = null;       // why the engine chose this pair (acquisition, info gain)
let engineCalib = null;    // authoritative calibration, incl. unbiased check-duel skill
let duelsSinceFit = 0;
const FIT_EVERY = 6;   // pacing floor between refits, not the trigger — see settleFit()
let fitDue = false;    // armed by a vote, enqueued once the next pair is on screen
let fitting = false;
let playingSrc = null;

let views = null;          // {map, styles, lineage, ranked} from the worker
let tasteTab = "map";
let currentView = "play";

const starsById = new Map();
const cutIds = new Set();
// Cuts awaiting the end of their undo window, id -> timer.
const pendingCuts = new Map();
// Model calibration on duels: forecasts made before each vote, scored after.
// A local Brier tally, used only for the menubar readout in the moments
// before the engine's own (authoritative) calibration reply lands. Bins are
// deliberately NOT kept here — see drawTrustTab.
const calib = { n: 0, brier: 0 };
// Implicit play signal: notes played per live patch, flushed on patch switch.
const playCounts = new Map();

// Live instrument state.
let volume = 0.8;            // JS-owned master volume (DOM slider is a view)
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
  // Locked sites, keyed by **node identity** rather than by trace address —
  // `41#cut`, not `node/0#cut`. See the lock section below for why the whole
  // point of this phase hangs off that one substitution.
  locks: new Set(),
};
let editInFlight = false;
let editQueue = null;
let auditionOnSettle = false;
let pendingEvolve = false;
let knobDragging = false;

// Addresses with no live audio handle (enums, structural sites): edits to
// these need a voice re-patch when the engine confirms them.
//
// Cleared on every structural edit — see the `bench` handler. Trace addresses
// are positional, so an insert renumbers them, and an entry learned before the
// edit afterwards names a different knob: one that is perfectly live, forced
// into a full patch swap on every bench reply for the rest of the session.
const nonLiveAddrs = new Set();

// What the *voices* are running, as the exact string the engine sent — not a
// re-serialization of `wb.tree`, because only the original bytes can answer
// "is the tree the bench is describing the one already in the worklet?", and a
// round trip through JSON.parse is not obliged to give back the same bytes.
let liveTreeJson = null;
let liveMakeup = null;
// What the *bench* holds, which is routinely ahead of the voices: a continuous
// knob turn is written straight into the running voices and deliberately never
// re-patched, so the genome moves and the compiled tree does not. This is what
// `param_miss` heals from when that assumption turns out to be wrong.
let benchTreeJson = null;
let benchMakeup = null;
// Bumped on every tree that reaches the voices. The `param_miss` self-heal
// keys off it so a burst of misses against one tree costs one re-patch rather
// than one per knob write.
let liveRev = 0;
let healedRev = -1;
// The tree handed to the worklet ahead of its vet (see the worker's
// apply/featurize split), so the bench reply can tell "already playing this"
// from "this is new".
let liveOptimisticJson = null;
let liveMuted = false;

function setLivePatchJson(json, makeup) {
  liveTreeJson = json;
  liveMakeup = makeup;
  liveRev += 1;
}

// The one place the instrument is silenced without touching the player's
// fader. `alarm()` has claimed "Muted" on an unvetted state since the beginning
// and it was never true: continuous knobs write straight into the running
// voices, and structural edits now do too, so by the time the vet says the
// patch can run away it is already the thing making noise.
function setLiveMuted(on) {
  if (!live || on === liveMuted) return;
  liveMuted = on;
  live.setVolume(on ? 0 : 1);
}

// ---------- persistence (IndexedDB autosave) ----------
// One record: {session: <engine SessionState JSON>, ui: {stars, cut, vol, oct, perf}}.
function idbOpen() {
  return new Promise((resolve) => {
    const req = indexedDB.open("ricercar", 1);
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
async function idbDel(key) {
  const db = await idbOpen();
  if (!db) return;
  return new Promise((resolve) => {
    const tx = db.transaction("kv", "readwrite").objectStore("kv").delete(key);
    tx.onsuccess = () => resolve();
    tx.onerror = () => resolve();
  });
}

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    flushPlayCounts(); // implicit play signal rides along with every save
    send({ type: "save" });
  }, 2500);
}
function uiState() {
  return {
    stars: [...starsById],
    cut: [...cutIds],
    vol: volume,
    oct: octShift,
    perf,
    // Which bank you were looking at, and which ids the latest generation
    // produced. `born` was never persisted, so the `new` filter it fed was
    // empty on every reload — a control that could not act, silently.
    //
    // Pins deliberately do NOT live here: the engine evicts, so the engine
    // owns them, and `SessionState.bank` carries them. Holding them in both
    // places is what let the old bank apologise for eviction without being
    // able to prevent it.
    bank: bankFilter,
    born: [...lastBorn],
    // What you pulled out of a patch and have not put back. "Removed" is
    // supposed to mean "recoverable"; before this it meant "recoverable until
    // you refresh", which is not a promise worth making.
    held: trayState(),
    // Where you put the modules (WS-4 §8). Flattened to arrays because this
    // blob is stored as-is and a Map is not: `[[subject, [[mid, x, y], …]], …]`.
    // Rounded, because a hand position is a grid cell or a pixel, never 14
    // digits of it.
    positions: [...ffLayouts]
      .filter(([, m]) => m.size)
      .map(([id, m]) => [id, [...m].map(([mid, p]) => [mid, Math.round(p.x), Math.round(p.y)])]),
    // What you pinned, per patch. "What have I already decided before I press
    // ⚡" is the one question the lock dots exist to answer, and a reload used
    // to answer it with "nothing" — every pin in the session gone, silently,
    // with the rack looking exactly as it had. Safe to persist only because a
    // lock is keyed by node identity now: under the old trace-address keys a
    // restored lock would have named whatever had since moved into that slot.
    locks: [...lockStore].filter(([, s]) => s.size).map(([id, s]) => [id, [...s]]),
  };
}

/** The inverse, tolerant of a save written before positions existed — which is
 *  every save on disk right now. An absent key and an empty map mean the same
 *  thing (no module has been placed by hand), so there is nothing to migrate. */
function restorePositions(saved) {
  if (!Array.isArray(saved)) return;
  for (const [id, list] of saved) {
    if (!Array.isArray(list) || !list.length) continue;
    const m = new Map();
    for (const [mid, x, y] of list) {
      if (typeof mid === "string" && Number.isFinite(x) && Number.isFinite(y)) {
        m.set(mid, { x: Math.max(0, x), y: Math.max(0, y) });
      }
    }
    if (m.size) { ffLayouts.set(String(id), m); ffLast = String(id); }
  }
  ffTrim();
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

// ---- transactional structural undo ----
// A structural edit is a *proposal* until the engine says it landed. Pushing
// its snapshot at post time (which is what this used to do) meant every
// rejected op left a phantom step: the next ⌘Z restored the patch already on
// screen, which reads as a dead keystroke, and a second ⌘Z was needed to
// reach the edit the player actually wanted back.
//
// So the snapshot is *staged* when the message goes out — it has to be taken
// then, because by the time the reply arrives `wb.tree` is already the new
// tree — and only committed to the stack on the bench reply. A rejection
// discards it, along with anything the same gesture put in HELD: staging a
// fragment for an edit that never happened would leave the player holding a
// copy of a chain that is still in the patch.
let openEdit = null;
// The edit posted by the most recent `queueStruct`, or null if that call
// merely queued. `stageFragment` binds to this rather than to `openEdit`, so
// a fragment staged alongside a *queued* op is never charged to the edit
// currently in flight (and so never destroyed by that edit's rejection).
let stagingBound = null;

function stageUndo() {
  openEdit = wb.tree ? { snap: JSON.stringify(wb.tree), trays: [] } : null;
  stagingBound = openEdit;
  return openEdit;
}
function commitStagedUndo() {
  if (!openEdit) return;
  undoStack.push(openEdit.snap);
  if (undoStack.length > 60) undoStack.shift();
  redoStack.length = 0;
  openEdit = null;
}
function discardStagedUndo() {
  if (!openEdit) return;
  for (const uid of openEdit.trays) unstage(uid);
  openEdit = null;
}

// What an edit owes *if it lands*, held until the reply for exactly the reason
// its undo snapshot is.
//
// The sentence, first. Said at post time — which is what every placement used
// to do — it is a claim about an edit the engine has not accepted yet: hit the
// depth ceiling and the app announced "wavefolder patched into the wire",
// offered to take it back out, and only much later mentioned that nothing had
// happened. A confirmation is a statement of fact, so it waits for the fact.
//
// And the shelf entry, which is the same mistake with a body count. Dropping a
// held chain onto a socket took it off HELD at post time, so an edit the engine
// then refused left the patch untouched *and* the chain gone from the one place
// the app promises "removed, but recoverable" — the only route in this app to
// destroying work outright. It comes off the shelf when the engine has it, and
// not before; until then it is marked `pending` and cannot be dragged again,
// because a shelf entry you can still pick up is a shelf entry you can place
// twice.
let landedNote = null;
let landedDrops = [];
/** Pay what the edit that just landed owes. */
function settleLanded() {
  const l = landedNote;
  landedNote = null;
  for (const uid of landedDrops) unstage(uid);
  landedDrops = [];
  if (l) note(l.text, l.opts);
}
/** …and take it all back when the engine refuses: nothing was announced,
 *  and nothing left the shelf. */
function forgetLanded() {
  landedNote = null;
  for (const uid of landedDrops) setTrayPending(uid, false);
  landedDrops = [];
}
/** Bind an edit's promises at the moment it is queued or posted. */
function bindLanded(landed) {
  landedNote = landed && landed.text ? { text: landed.text, opts: landed.opts || {} } : null;
  landedDrops = landed && landed.drop != null ? [landed.drop] : [];
}
/** The same promise for a whole-tree rewrite, which cannot carry its sentence
 *  through `sendStruct`: the text usually describes what the rewrite *found*,
 *  so it is only knowable after the mutation has run. Called immediately after
 *  a successful `applyTreeRewrite`, while that rewrite is the edit in flight —
 *  the engine validates these too (the ceilings), so they can be refused, and
 *  a refused one must not have announced itself. */
function noteOnLanding(text, opts) {
  if (!structInFlight) return note(text, opts); // nothing is pending to wait on
  landedNote = { text, opts: opts || {} };
}

// Undo and redo post a whole tree, which cannot be re-aimed at a tree that
// moved under it — so they wait for the lane to clear rather than racing the
// edit still in flight, which would restore over the top of it. They hold the
// same lane an op does, because a whole-tree replace and an op are the same
// round trip to the same engine and the second one to arrive wins.
//
// The stacks are not touched until the reply, for the same reason the undo
// snapshot is not: a restore the engine refuses (the ceilings run on this
// route now) used to consume the step anyway, so ⌘Z would eat one level of
// history and give nothing back.
let restorePending = null; // {kind: "undo"|"redo", cur: <tree json before>}

// ⌘Z pressed ten times quickly is ten undos, not one. Both of these used to
// answer "an edit is already in flight" by dropping the press — measured: ten
// fast presses advanced the patch one step and swallowed nine, with a toast
// that read like a hint rather than a refusal. So the request is *counted*.
//
// Counted, and never queued as a tree: a queued tree is a statement about a
// tree that has since moved, and posting one would restore over the top of
// whatever landed in between. Each drain re-reads the live stack and sends the
// step the player would get if they pressed it right then. Undo and redo
// requests cancel each other, because that is what they mean.
let restoreBacklog = 0; // >0 undos owed, <0 redos owed
const RESTORE_BACKLOG_MAX = 60; // the depth of the stack itself

function doUndo() { requestRestore("undo"); }
function doRedo() { requestRestore("redo"); }

function requestRestore(kind) {
  const step = kind === "undo" ? 1 : -1;
  // A restore is a whole tree, so it also waits behind ops that are still
  // queued — those are aimed at the tree it would replace.
  if (structInFlight || structQueue.length) {
    restoreBacklog = clamp(restoreBacklog + step, -RESTORE_BACKLOG_MAX, RESTORE_BACKLOG_MAX);
    return;
  }
  performRestore(kind);
}

// ---------- the implicit stream (WS-8 §3) ----------
// Log what the player does with their edits now, so a model can be fit on it
// later. None of this enters the likelihood — a revert is confounded with
// plain curiosity, and the fit the app shows a number from is not the place to
// smuggle in an unvalidated signal. It is written because it cannot be written
// retroactively: an edit-level preference model is the natural v2 and it is
// unbuildable without a year of this log.
//
// It lands in the engine's `events` list, which rides in the same
// `SessionState` blob as the observation log and therefore persists with it —
// "alongside the observation log" in the plan means alongside on disk too.
function logImplicit(kind, detail, opts = {}) {
  send({
    type: "log_edit",
    kind,
    id: opts.id != null ? opts.id : (wb.subjectId != null ? wb.subjectId : 0),
    value: opts.value || 0,
    detail: detail || null,
    withPhi: !!opts.withPhi,
  });
}

// What the last landed edit was, and whether the player can possibly have
// heard it. The gate matters: an undo pressed reflexively two keystrokes after
// an edit is a correction of a typo, not a preference, and logging it as one
// would poison the very column a v2 model would key off.
let lastEdit = null;      // {at, op} — the edit an undo would reverse
let heardSinceEdit = false;
// Long enough to be a judgement rather than a reflex. The plan's number, and
// it matches the ~1.5 s the phrase render takes to become audible at all.
const REVERT_DWELL_MS = 2000;
/** Whatever gesture is going out next, in one place, so the revert that may
 *  reverse it can name it. */
let pendingEditTag = null;

function markEditLanded() {
  lastEdit = { at: Date.now(), op: pendingEditTag };
  heardSinceEdit = heldNotes.size > 0;
}
/** The player is hearing the patch — through the keyboard, or ▶. */
function markHeard() {
  heardSinceEdit = true;
}
/** An undo just landed. Was it a revert of something the player actually
 *  heard and sat with? */
function noteRevertIfAudible() {
  const e = lastEdit;
  lastEdit = null;
  if (!e || !heardSinceEdit) return;
  const dwell = Date.now() - e.at;
  if (dwell < REVERT_DWELL_MS) return;
  // `withPhi` attaches the bench's φ on both sides — the engine holds the
  // vector from before this restore and the one from after it, which is the
  // only place the *direction* of the move exists.
  logImplicit("revert", { op: e.op, dwell_ms: dwell }, { value: dwell, withPhi: true });
}

function performRestore(kind) {
  const stack = kind === "undo" ? undoStack : redoStack;
  if (stack.length === 0 || !wb.tree) {
    // Nothing left to land on, so the rest of the burst has nothing to do
    // either — said once rather than once per press.
    restoreBacklog = 0;
    return note(kind === "undo" ? "nothing to undo" : "nothing to redo");
  }
  restorePending = { kind, cur: JSON.stringify(wb.tree) };
  restoreInFlight = true;
  structInFlight = true;
  beliefStale();
  send({ type: "edit_set_tree", json: stack[stack.length - 1] });
}
// Which direction the restore that just landed went. `restorePending` is
// cleared by `settleRestore`, and the revert check needs the answer after
// that — an undo and a redo are the same message on the wire.
let lastSettledRestore = null;

/** The restore landed: only now does the step actually move. */
function settleRestore() {
  lastSettledRestore = restorePending ? restorePending.kind : null;
  if (!restorePending) return;
  if (restorePending.kind === "undo") {
    undoStack.pop();
    redoStack.push(restorePending.cur);
  } else {
    redoStack.pop();
    undoStack.push(restorePending.cur);
  }
  restorePending = null;
}

// ---------- worker protocol ----------
const send = (msg, transfer) => worker.postMessage(msg, transfer || []);

worker.onmessage = (e) => {
  const m = e.data;
  switch (m.type) {
    case "fill_progress": {
      // Monotonic: the restore stage posts {pool:0,target:1}, which used to
      // drive the bar back to zero mid-boot. A progress bar that reverses
      // reads as a crash.
      //
      // But monotonic alone was not enough: a stage that *completes* drives
      // the bar to 100 %, and the max() then pins it there for everything
      // after it — which is exactly what a restore did to the top-up fill. So
      // the worker tags each message with its stage, and each stage owns
      // `1/stages` of the range instead of all of it.
      const stages = Math.max(1, m.stages || 1);
      const stage = Math.min(stages - 1, Math.max(0, m.stage || 0));
      const within = m.target > 0 ? Math.min(1, m.pool / m.target) : 0;
      bootPct = Math.max(bootPct, Math.min(100, (100 * (stage + within)) / stages));
      $("boot-fill").style.width = `${bootPct}%`;
      // Say how many renderers are on it. Not decoration: a boot that is four
      // times faster than the last one should say why, and a boot that fell
      // back to one core should say that too.
      const crew = m.workers > 0 ? ` · ${m.workers} renderer${m.workers > 1 ? "s" : ""}` : "";
      $("boot-status").textContent =
        m.label ? `${m.label}${crew}` : `heard ${m.pool} of ${m.target}${crew}`;
      bootField(m.pool, m.target);
      fillPool = m.pool;
      fillTarget = m.target;
      // Once the veil is down the bank header is the only place still saying
      // that patches are arriving, so keep it current.
      if (booted) renderFillHint();
      break;
    }
    case "playable": {
      // The bank is duel-able — not full. Hand the app over now and let the
      // remaining patches land behind it; the fill loop yields to the worker's
      // message queue, so everything below is serviced while it runs.
      dropBootVeil();
      applyStatus(m.status);
      // The preset library is static and tiny, and its size shows on the chip
      // before you press it. Fetching only on first press would leave that
      // count reading 0 — a number that is wrong rather than merely absent.
      if (!presetRows) send({ type: "presets" });
      // The same argument for the honesty meter. Forecasts persist with the
      // session, but nothing asked for them until the *next* vote — so a
      // returning player's TRUST tab opened on "0 of 20 forecasts" while the
      // engine was holding twenty-five of them. Wrong, not merely absent.
      send({ type: "calibration" });
      // Claim the deal before it goes out. On a full restore the worker posts
      // `playable` and `filled` in the same synchronous turn (the fill loop —
      // and therefore its yield — never runs), so `filled` would otherwise see
      // `currentDuel === null` and deal a *second* pair. That second
      // `next_duel_ex` is consumed but never shown: it advances `duels_shown`
      // (shifting the calibration-probe cadence), pollutes the repeat and
      // diversity penalties the acquisition function reads, and shows up as a
      // deal-then-redeal flicker. The `duel` handler clears this flag
      // unconditionally; `choose()`'s early return on it is inert here because
      // there is no pair on the table yet.
      dealing = true;
      send({ type: "duel" });
      send({ type: "taste_views" });
      if (m.restored > 0) {
        note(`Welcome back — ${m.restored} patches and your taste restored.`);
      } else if (
        !localStorage.getItem("ricercar-warmed") &&
        !localStorage.getItem("ricercar-warm-deferred")
      ) {
        setTimeout(openWarmStart, 500);
      } else if (fillTarget > fillPool) {
        note(`Start picking — ${fillTarget - fillPool} more patches are still arriving.`);
      }
      showCoach();
      break;
    }
    // The engine has said goodbye to the farm. Reap the workers: they exist
    // only for boot, and N × ~15 MB of linear memory is not something to keep
    // resident behind a running instrument.
    case "farm_done": {
      for (const w of farmWorkers) {
        try { w.terminate(); } catch (_) {}
      }
      farmWorkers.length = 0;
      break;
    }
    // Boot threw inside the engine worker, so neither `playable` nor `filled`
    // is coming. There may be no pool and no engine — but a veil left up
    // forever tells the user nothing at all, so drop it and say what happened.
    case "boot_failed": {
      dropBootVeil();
      // A condition, not a remark: this stays until it is resolved. A 4.2s
      // toast for a dead engine left a blank instrument with no explanation.
      alarm(`The audio engine failed to start: ${m.error}`, {
        label: "reload",
        run: () => location.reload(),
      });
      break;
    }
    case "filled": {
      // `playable` already handed the app over; this closes the meter out.
      // The worker guarantees `playable` precedes `filled` on every path,
      // including the degenerate ones, so `dropBootVeil` here is the belt to
      // that braces — it can never be reached with the veil still up.
      bootPct = 100;
      $("boot-fill").style.width = "100%";
      dropBootVeil();
      applyStatus(m.status);
      fillPool = m.status.pool;
      fillTarget = m.status.pool_target;
      // The bank grew behind the app: re-read the instruments over the full
      // pool. Deliberately *not* a new `duel` unless the table is empty —
      // re-dealing here would throw away the pair the user is listening to.
      send({ type: "taste_views" });
      if (!currentDuel && !dealing) send({ type: "duel" });
      renderFillHint();
      break;
    }
    case "saved": {
      idbPut("state", { session: m.json, ui: uiState() });
      break;
    }
    // `edit_begin` said no: that id is not in the pool any more. It is
    // reachable by racing a landing generation — the bank holds 40 and each
    // bred patch evicts one, so a row (or a map dot, or a ⌖ bench) clicked
    // while a generation lands can name a patch that no longer exists.
    //
    // The worker has always sent this and nothing has ever listened, which is
    // the worst possible handling: every caller of `openOnBench` announces
    // success optimistically, so the failure left a toast reading "it's on the
    // workbench and under your fingers" while the workbench showed the patch
    // from before. Silence would merely have been a dead click; this was the
    // app stating something untrue about its own state. Say what happened,
    // and pull fresh views so the row that can't be opened stops being listed.
    case "bench_missing": {
      note(`#${m.id} isn't in the bank any more — a bred generation replaced it.`);
      send({ type: "taste_views" });
      break;
    }
    case "patch_imported": {
      const evicted = applyViews(m.views);
      applyStatus(m.status);
      refreshInstruments();
      const layout = pendingLayout;
      pendingLayout = null;
      if (m.id > 0) {
        // File the layout under the id it landed as, *before* benching it, so
        // the first render already draws the arrangement the sender chose. The
        // mids match because uids survive the round trip: the exported tree
        // carries them, `ensure_uids` on admission keeps every id it is given
        // and only mints for the ones that have none.
        let placed = 0;
        if (layout) {
          const map = new Map();
          for (const [mid, x, y] of layout) {
            if (typeof mid === "string" && Number.isFinite(x) && Number.isFinite(y)) {
              map.set(mid, { x: Math.max(0, x), y: Math.max(0, y) });
            }
          }
          if (map.size) {
            ffLayouts.set(String(m.id), map);
            ffLast = String(m.id);
            ffTrim();
            placed = map.size;
            // A layout nobody can see is not carried, it is stored. The file
            // said where these modules go; showing them anywhere else would
            // make the feature indistinguishable from not having shipped it.
            if (layoutMode !== "freeform") {
              layoutMode = "freeform";
              try { localStorage.setItem("ricercar-layout", layoutMode); } catch (_) {}
              syncLayoutBtn();
            }
          }
        }
        openOnBench(m.id);
        note(`patch imported as ${nameOf(m.id)}${placed ? `, with its ${placed}-module layout` : ""}.${madeRoom(evicted)}`);
        scheduleSave();
      } else {
        note("could not import that patch (duplicate, or it failed the safety vet)");
      }
      break;
    }
    case "duel": {
      // A retract restored the previous pair while this deal was in flight —
      // the restored question stands; this pair is dropped like a skip.
      if (ignoreNextDeal) {
        ignoreNextDeal = false;
        dealing = false;
        setDuelControlsEnabled(true);
        break;
      }
      currentDuel = m.pair;
      // Randomise the presented side: the engine's first pick was always A,
      // always left, always ←. `duel_pred` is computed at record time from
      // the order we submit, so a swapped pair stays consistent end-to-end.
      if (currentDuel && Math.random() < 0.5) currentDuel = [currentDuel[1], currentDuel[0]];
      duelMeta = m.meta || null;
      dealing = false;
      setDuelControlsEnabled(true);
      renderCheckBadge();
      if (currentDuel) {
        setFlip("a", false);
        setFlip("b", false);
        loadSide("a", currentDuel[0]);
        loadSide("b", currentDuel[1]);
        benchBeforeAudition = null; // a fresh pair closes any audition detour
        setDuelSelection(null);
        dealCards();
      }
      renderPlayDuel();
      // The pair is on the table; a refit armed by the last vote can now be
      // enqueued *behind* this pair's audio rather than in front of it.
      settleFit();
      break;
    }
    // The worker announces the start and end of every call that blocks its
    // message queue for longer than a render takes. See `awaitRender`.
    case "busy": {
      engineBusy = true;
      break;
    }
    case "idle": {
      engineBusy = false;
      break;
    }
    case "render": {
      // `failed` is the engine saying "never", as distinct from "not yet".
      // Anything waiting on this id has to be released, or it waits forever.
      if (m.failed || !m.buffer || m.buffer.length === 0) {
        renderFailures.set(m.id, m.reason || null);
        // The duel table asks for its buffers fire-and-forget (after the
        // settle delay), so nothing is polling on its behalf — without this a
        // side that cannot render is just a scope that stays blank.
        if (currentDuel && currentDuel.includes(m.id)) renderFailed(m.id, m.reason);
        break;
      }
      renderFailures.delete(m.id);
      renderAnnounced.delete(m.id);
      const buf = audioCtx.createBuffer(1, m.buffer.length, m.sampleRate);
      buf.copyToChannel(m.buffer, 0);
      renders.set(m.id, { buffer: buf, sexpr: m.sexpr, bestStyle: m.bestStyle });
      onRenderArrived(m.id);
      break;
    }
    case "tree_json": {
      if (!(m.json && m.json !== "null" && live)) break;
      live.setPatch(m.json, m.makeup);
      setLivePatchJson(m.json, m.makeup);
      if (m.edited !== undefined) {
        // The bench speaking early: the worker posts the edited tree the
        // instant it is adopted and featurizes afterwards, so this arrives
        // ~half a second before the `bench` reply that vets it. The patch is
        // in the voices now; the vet lands later and mutes if it fails.
        liveOptimisticJson = m.json;
        livePatchId = null;
        setLiveLabel(`${nameOf(wb.subjectId)} (edited)`);
      } else {
        livePatchId = m.id;
        setLiveLabel(nameOf(m.id));
      }
      break;
    }
    case "calibration": {
      engineCalib = m.calib;
      if (currentView === "taste") drawTaste();
      break;
    }
    case "status": {
      applyStatus(m.status);
      send({ type: "calibration" });
      if (m.pred != null && m.pred >= 0) {
        const pChosen = m.choseA ? m.pred : 1 - m.pred;
        calib.n += 1;
        // Brier is a *proper* scoring rule; the old running hit-rate was not,
        // and it was structurally pinned near 50% because the acquisition
        // function deliberately picks near-ties. Skill vs a coin flip.
        calib.brier += (pChosen - 1) ** 2;
        renderSkill();
      }
      scheduleSave();
      break;
    }
    // The forecast payoff, shown the instant the vote is cast — the vote
    // itself sits behind the undo window.
    case "duel_pred": {
      if (m.pred != null && m.pred >= 0) showForecast(m.choseA ? m.pred : 1 - m.pred);
      break;
    }
    case "fitted": {
      fitting = false;
      $("wm-r").classList.remove("thinking");
      applyViews(m.views);
      applyStatus(m.status);
      refreshInstruments();
      scheduleSave();
      break;
    }
    case "refine_progress": {
      const btn = $("evolve-btn");
      btn.textContent = `breeding ${m.done + 1}/${m.total}…`;
      break;
    }
    case "refined": {
      $("wm-r").classList.remove("thinking");
      $("evolve-btn").disabled = false;
      $("evolve-btn").textContent = "evolve pool";
      // The pool is fixed-size: every accepted child evicts the patch the
      // model predicts you like least. Say so — silent eviction is how a
      // user loses something they liked and stops trusting the bank.
      const evicted = applyViews(m.views);
      if (m.born && m.born.length > 0) {
        lastBorn.clear();
        for (const id of m.born) lastBorn.add(id);
      }
      applyStatus(m.status);
      refreshInstruments();
      redrawDuelScopes();
      scheduleSave();
      // Say what actually happened. "Pool evolved" after a minute of work
      // that accepted nothing is worse than silence — it claims a result the
      // engine did not produce.
      if (m.untaught) {
        note("Nothing to breed toward yet — make a few picks first, then evolve.");
      } else if (m.born && m.born.length === 0) {
        note(`Gen ${m.status.generation}: no move was accepted. Teach it more, or ⚡ evolve one patch you like.`);
      } else if (m.born) {
        offerBankTourAfterFirstGeneration();
        const made = evicted.length
          ? ` ${evicted.length} lowest-predicted made room.`
          : "";
        note(`Gen ${m.status.generation}: ${m.born.length} new patch${m.born.length > 1 ? "es" : ""} in the bank.${made}`);
      } else {
        note(`Generation ${m.status.generation} bred.`);
      }
      break;
    }
    case "bench": {
      wb.rack = m.rack;
      // Every address in the identity index belongs to the rack it was built
      // from, and this is the only place a rack is ever replaced.
      lockIndex = null;
      wb.vetOk = m.vetOk;
      if (m.subject !== undefined) {
        // Benching anything that is NOT the auditioned candidate ends the
        // audition detour — otherwise the header keeps naming a candidate
        // that is no longer under the fingers.
        const candId =
          hearingSide && currentDuel
            ? hearingSide === "a" ? currentDuel[0] : currentDuel[1]
            : null;
        if (candId != null && m.subject !== candId) {
          benchBeforeAudition = null;
          setDuelSelection(null);
        }
        wb.subjectId = m.subject;
        wb.dirty = false;
        // Pruned, not cleared. A different patch entirely shares no node
        // identities with the one that was here, so pruning empties the set
        // and reads exactly as clearing did. But the two subject changes that
        // matter are *not* different patches: `edit_commit` benches the very
        // tree that was on it, and ⚡ evolve benches a child whose surviving
        // nodes carry the seed's identities through `inherit_uids`. Both keep
        // their locks — which is the loop this whole editor exists to serve.
        pruneLocks();
        // …and if nothing was carried, this patch may have pins of its own —
        // from earlier in the session, or from before the last reload. The
        // store is only ever read here, where a patch arrives with an empty
        // set, so a carried lock always wins over a remembered one.
        locksRestoreFor(m.subject);
        locksRemember();
        // A different patch entirely: nothing learned about the old one's
        // addresses says anything about this one's, and a survivor here is
        // the same stale-entry dropout a structural edit used to leave.
        nonLiveAddrs.clear();
        placeholderKeys = new Set();
        placeholderPending = null;
        undoStack.length = 0;
        redoStack.length = 0;
        note(`${nameOf(m.subject)} on the bench`);
        // First patch on the bench: a one-time walkthrough of the gestures
        // nothing else explains — locks, ⚡ evolve from this, my-edit-is-better.
        if (!localStorage.getItem("ricercar-bench-tour")) {
          $("bench-tour").classList.remove("hidden");
          $("bt-close").onclick = () => {
            $("bench-tour").classList.add("hidden");
            localStorage.setItem("ricercar-bench-tour", "1");
            refitRack();
          };
        }
      }
      const structural = m.edited === "structure" || m.edited === "restore";
      if (m.edited !== undefined) {
        wb.dirty = true;
        if (structural) {
          // Everything keyed by trace address is invalidated by the same
          // fact — the addresses moved. Locks were already being cleared
          // here; `nonLiveAddrs` never was, and it is the more expensive
          // omission: one stale entry makes a genuinely live knob force a
          // full patch swap on every bench reply for the rest of the
          // session, which is a dropout and an envelope retrigger roughly
          // twice a second for as long as you keep turning it.
          nonLiveAddrs.clear();
          // Same fact, same consequence: a rewrite says where its empty
          // sockets ended up, and anything else moved the addresses without
          // telling us, so the holes are forgotten rather than drawn on
          // whatever now happens to live at that key.
          placeholderKeys = placeholderPending || new Set();
          placeholderPending = null;
          // And for the same reason, anything still *aiming* at a key is
          // aiming at a key that has moved. A handoff or a half-made cable
          // that survives an edit does not point where the player pointed it
          // — it points at whatever now lives at that address.
          cancelPending();
          endConnectPick();
        }
        // One rule for every edit, from an op to a whole-tree rewrite to a
        // ⌘Z: a lock names a *node*, so it survives unless that node is gone.
        // This replaced a page of per-op key remapping (`lockRemapFor`) and a
        // second copy of the same reasoning inside `applyTreeRewrite`, which
        // tracked node objects by reference — both of them standing in for an
        // identity the term did not have and now does.
        const droppedLocks = pruneLocks();
        if (droppedLocks > 0) {
          locksRemember(); // the set that survived is the set to remember
          note(`${droppedLocks} lock${droppedLocks > 1 ? "s" : ""} went with what you removed — the rest stayed with their modules.`);
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
        benchTreeJson = m.treeJson;
        benchMakeup = m.makeup;
      }
      // The keyboard follows the bench — but continuous knob turns were
      // already applied live inside the worklet (zero-recompile), so only
      // subject loads, structural changes, and non-live params re-patch.
      const paramNonLive =
        m.edited !== undefined && !structural && nonLiveAddrs.has(m.edited);
      const subjectLoad = m.subject !== undefined;
      // `edit_set_tree` answers "restore" whether it came from ⌘Z or from a
      // client-side rewrite, so the two are told apart by which of them is
      // holding a receipt: only undo/redo leave a `restorePending`.
      if (m.edited === "restore") {
        restoreInFlight = false;
        settleRestore();
      }
      if (structural) {
        structInFlight = false;
        // It landed, so the step it displaced is now history worth keeping —
        // and only now is the sentence about it a true one, and only now is
        // the shelf entry it came from really spent.
        commitStagedUndo();
        settleLanded();
      }
      // Structural edits already reached the voices from the worker's early
      // `tree_json` post. Swapping the identical tree in again would buy a
      // second fade-out, rebuild and re-attack for no change in sound; all
      // that is left to reconcile is the makeup gain, which the early post
      // could not know because measuring it *is* the expensive half.
      const spokeEarly = liveOptimisticJson !== null && liveOptimisticJson === m.treeJson;
      liveOptimisticJson = null;
      if (spokeEarly) {
        if (live && m.makeup != null) live.setMakeup(m.makeup);
        liveMakeup = m.makeup;
      } else if (
        m.treeJson && m.treeJson !== "null" && live &&
        (subjectLoad || (wb.vetOk && (structural || paramNonLive)))
      ) {
        live.setPatch(m.treeJson, m.makeup);
        setLivePatchJson(m.treeJson, m.makeup);
        livePatchId = wb.dirty ? null : wb.subjectId;
        setLiveLabel(wb.dirty ? `${nameOf(wb.subjectId)} (edited)` : nameOf(wb.subjectId));
      }
      // Optimism's other half: the sound arrived before the verdict. A patch
      // that fails vetting can self-oscillate, and it is already in the
      // voices, so the mute has to be real. Any vet that passes lifts it.
      if (wb.vetOk) setLiveMuted(false);
      else if (spokeEarly) setLiveMuted(true);
      alarm(
        wb.vetOk
          ? null
          : "Muted — this setting can run away (self-oscillation or runaway feedback). Turn the last knob back, or undo.",
        wb.vetOk ? null : { label: "undo", run: doUndo }
      );
      if (!knobDragging) renderRack();
      renderBank();
      // Both readouts are derived from this reply and nothing else, so they
      // cannot drift from the tree the rack below them is drawing.
      applyBelief(m);
      renderBudget();
      // The undo that just landed may have been a *revert* — the implicit
      // stream's most informative row, and one that can only be recognised
      // here, with both sides of the edit in hand.
      // Told apart the same way the restore itself is: `edit_set_tree` answers
      // "restore" for a ⌘Z *and* for every client-side rewrite, and only
      // undo/redo leave a receipt. A rewrite is an edit like any other — it is
      // the thing a later ⌘Z would revert — so it must land here as one.
      if (m.edited !== undefined) {
        if (m.edited === "restore" && lastSettledRestore === "undo") noteRevertIfAudible();
        else markEditLanded();
      }
      // The selection ring on the taste map is drawn at wb.subjectId, so a
      // bench change while the map is up must repaint it — clicking a dot
      // used to leave the ring on the old patch.
      if (currentView === "taste") drawTaste();
      editInFlight = false;
      if (editQueue) {
        const q = editQueue;
        editQueue = null;
        sendEdit(q.addr, q.value, q.isIndex);
      } else if (auditionOnSettle) {
        auditionOnSettle = false;
      }
      drainStruct();
      break;
    }
    // A request that arrived before the engine finished booting. The worker
    // now says so instead of throwing into the void; the only one that needs
    // re-asking is the preset list, because the bank shows an empty shelf
    // until it lands and nothing else would ever ask again.
    case "not_ready": {
      if (m.request === "presets") setTimeout(() => send({ type: "presets" }), 250);
      break;
    }
    case "edit_rejected": {
      const refusedRestore = restorePending !== null;
      if (m.error) {
        // Urgent, because this sentence is the only thing standing between the
        // player and a false belief about their own patch: they made a gesture,
        // and it did not happen. Queued behind ordinary confirmations it
        // arrived seconds late and, under a burst, not at all.
        note(`edit rejected: ${m.error}`, { urgent: true });
        // Nothing happened, so nothing is owed to history — and nothing that
        // rode along with the edit is owed to HELD either. Without this the
        // next ⌘Z restored the patch the user is already looking at (a dead
        // keystroke), and a "held below" toast pointed at a chain that had
        // never left the patch. `addr`-carrying rejections are parameter
        // edits and stage nothing.
        discardStagedUndo();
        // A refused restore consumes no step: the stacks were never touched.
        restorePending = null;
      }
      editInFlight = false;
      // A rejected op never reached the tree, so nothing was posted early and
      // nothing is in flight; the next one may go. `restoreInFlight` matters
      // now that a whole-tree replace can *be* rejected (the ceiling check):
      // left set, it would wedge undo and redo shut for the rest of the
      // session, since both are gated on it.
      structInFlight = false;
      restoreInFlight = false;
      placeholderPending = null; // the tree it described never happened
      // The edit never landed, so the sentence that would have announced it is
      // not owed — and must not be said on top of the next edit that does land.
      // The shelf keeps what the engine would not take: a refused drop leaves
      // the chain exactly where the player left it, draggable again.
      forgetLanded();
      // A refused restore means ⌘Z is aimed at a route the engine is turning
      // down; replaying the rest of the burst would say the same thing ten
      // times over. The stacks are untouched, so nothing is lost by stopping.
      if (refusedRestore) restoreBacklog = 0;
      if (editQueue) {
        const q = editQueue;
        editQueue = null;
        sendEdit(q.addr, q.value, q.isIndex);
      }
      drainStruct();
      break;
    }
    // The answer to "is there a duel to deal here, and what does the other
    // side sound like". `differs` is the engine's own tree comparison, not the
    // panel's `dirty` flag: turn a knob and turn it back and there is nothing
    // to ask about, and an answer to a question with no content is a row of
    // noise in the preference log.
    case "edit_duel": {
      if (!m.differs) {
        // The engine has compared the trees and they are the same one: a knob
        // turned and turned back, or a pair of structural edits that cancelled
        // (duplicate, then delete). Two things follow, and the app used to do
        // neither.
        //
        // First, the panel's `dirty` flag is now known to be wrong, so it goes
        // — the subject line said "· edited" and COMMIT stayed lit over a
        // patch byte-identical to the one in the bank, and the only commit
        // that button could produce was a duplicate the engine would refuse.
        clearBenchDirty();
        // Second, "there is nothing to commit" is not a failure of ⚡. The
        // generation is what was asked for; the commit was only ever the thing
        // standing in front of it. Routing this through `sendCommit("none")`
        // sent a doomed commit, got `id: 0` back, and dropped the generation on
        // the floor with a note about a duplicate — for the one gesture that
        // could not have been more clearly a request to evolve.
        if (m.then === "evolve") {
          pendingEvolve = false;
          if (wb.subjectId != null) startEvolveFrom(wb.subjectId);
        } else {
          note(`nothing to commit — ${nameOf(wb.subjectId)} is exactly what it was.`);
        }
      } else if (!m.buffer || m.buffer.length === 0) {
        sendCommit("none", { evolving: m.then === "evolve" });
      } else {
        openCommitDuel(m, m.then);
      }
      break;
    }
    // A pre-placement audition came back (WS-2 §6). Stale replies are the
    // normal case, not the error case — the worker is serial, so a preview
    // already begun cannot be recalled and the player has usually moved on by
    // the time it lands. Dropping it here is the cancellation.
    case "preview": {
      onPreviewArrived(m);
      break;
    }
    case "committed": {
      const evicted = applyViews(m.views);
      applyStatus(m.status);
      if (m.id > 0) {
        wb.subjectId = m.id;
        wb.dirty = false;
        livePatchId = m.id;
        setLiveLabel(nameOf(m.id));
        // Say what was taught, from what actually happened rather than from
        // the state of a checkbox: three of these four sentences were
        // unsayable before the outcome had a direction.
        const taught =
          m.outcome === "heard_edited" ? " · taught: your edit won the comparison"
          : m.outcome === "heard_original" ? " · taught: the original won — the model learns most from that"
          : m.outcome === "self_edited" ? " · taught: you say your edit is better"
          : "";
        note(`committed as patch #${m.id}${taught}.${madeRoom(evicted)}`);
        if (pendingEvolve) {
          pendingEvolve = false;
          startEvolveFrom(m.id);
        }
      } else {
        // A patch the bank already holds is not a new candidate — but if the
        // player answered a comparison on the way in, the engine scored it
        // against the twin rather than dropping it, and saying "failed" about
        // a vote that was recorded is the wrong sentence.
        note(m.outcome && m.outcome !== "none"
          ? "that patch is already in the bank — nothing new to add, but your pick was recorded."
          : "commit failed (duplicate or unvetted state)");
        // …and the generation still runs. ⚡ on an edited patch commits *and
        // then* evolves; a commit the bank had no room for is a reason to
        // evolve from the seed instead of a reason to swallow the gesture.
        // The other half of this lives in `edit_duel`, which now avoids
        // sending the doomed commit at all — this is the case that arrives
        // any other way (an unvetted tree, an express self-report).
        if (pendingEvolve) {
          pendingEvolve = false;
          if (wb.subjectId != null) startEvolveFrom(wb.subjectId);
        }
      }
      // A commit that carried an answer just added a forecast, and the trust
      // view is the place that answer is visible. Without this it only
      // refreshed on the next *dealt* duel — so the observation the player
      // was asked for appeared to go nowhere.
      if (m.outcome && m.outcome !== "none") send({ type: "calibration" });
      refreshInstruments();
      renderRack();
      scheduleSave();
      break;
    }
    case "evolved_from": {
      $("rack-evolve").disabled = false;
      $("wm-r").classList.remove("thinking");
      const evolveEvicted = applyViews(m.views);
      applyStatus(m.status);
      refreshInstruments();
      if (m.childId > 0) {
        note(`⚡ gen ${m.status.generation}: evolution proposed patch #${m.childId} — now on the bench, play it.${madeRoom(evolveEvicted)}`);
        send({ type: "edit_begin", id: m.childId });
        scheduleSave();
      } else {
        note("⚡ evolution found no accepted move — try again, or loosen some locks");
      }
      break;
    }
    case "taste_views": {
      applyViews(m.views);
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
      renderNodeBank(); // pool support and θ both move with the pool
      renderRack(); // subject label may show a new name
      scheduleSave();
      break;
    }
    case "presets": {
      presetRows = m.rows;
      if (warmPending) { warmPending = false; renderWarmStart(m.rows); }
      else if (bankFilter === "preset") renderBank();
      else renderBankCounts(); // the chip says how many even from another bank
      break;
    }
    case "pinned": {
      if (m.ranked && views) views.ranked = m.ranked;
      if (m.budget) pinBudget = m.budget;
      // A control that cannot act says so. `set_pinned` fails for exactly two
      // reasons and they need different sentences: the budget is full (the
      // user can fix that by unkeeping something) or the patch is already gone
      // (they cannot).
      if (!m.ok) {
        if (rowOf(m.id)) {
          note(`That would pass your limit of ${pinBudget[1]} saved patches. Release one first.`);
        } else {
          note(`#${m.id} isn't in the bank any more — a bred generation replaced it.`);
        }
      } else if (m.pinned && !warmLoaded) {
        note(`Saved ${nameOf(m.id)} — it won't be replaced. ${pinBudget[0]}/${pinBudget[1]} slots used.`);
      } else if (!warmLoaded) {
        // Releasing is destructive in slow motion: the patch goes back into
        // the pool and the next generation may breed it away. Silence made it
        // the one half of the toggle that reported nothing.
        note(`Released ${nameOf(m.id)} — it can be replaced again. ${pinBudget[0]}/${pinBudget[1]} slots used.`);
      }
      renderPinBudget();
      renderBank();
      scheduleSave();
      break;
    }
    case "preset_loaded": {
      const evicted = applyViews(m.views);
      applyStatus(m.status);
      refreshInstruments();
      // A preview is a listen, not a selection: no bench, no toast, no
      // interruption of the screen the user is standing on.
      if (m.preview) {
        // Hearing a preset costs a pool slot — the engine can only render what
        // it holds. That is defensible, but it has to be *said*: this branch
        // used to drop the eviction on the floor, so pressing ▶ destroyed a
        // patch and reported nothing at all.
        warmPreviewLoaded(m.id, evicted);
        scheduleSave();
        break;
      }
      if (m.warm !== undefined) {
        warmPresetLoaded(m.warm, m.id);
        scheduleSave();
        break;
      }
      if (m.id > 0) {
        // Remember which library row this id came from, so the preset bank can
        // say "in bank" and open it next time instead of loading it again.
        // Only the warm-start preview path used to record this, so a plain
        // click re-loaded the same preset forever and never marked it.
        if (m.index !== undefined) presetIds.set(m.index, m.id);
        openOnBench(m.id);
        note(`Preset loaded as ${nameOf(m.id)}.${madeRoom(evicted)}`);
        scheduleSave();
      } else {
        // `insert_preset` returns 0 before the standardizer exists, and this
        // branch did not exist: the click closed the menu and did nothing at
        // all, with no message. The bank is still filling at that moment, so
        // this is the most likely moment for a new user to press it.
        note("The bank is still warming up — try that preset again in a moment.");
      }
      break;
    }
    case "exported": {
      const blob = new Blob([m.json], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "ricercar-profile.json";
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

let status = { observations: 0, generation: 0 };
let hasPlayed = !!localStorage.getItem("ricercar-played");

function applyStatus(st) {
  status = st;
  $("duel-count").textContent = st.observations;
  $("gen-count").textContent = st.generation;
  renderTeach();
  renderNextStep();
  // A deferred warm start gets one re-offer once the user has proven they'll
  // vote at all — after that it lives in ⋯ only.
  if (
    st.observations >= 3 &&
    localStorage.getItem("ricercar-warm-deferred") &&
    !localStorage.getItem("ricercar-warmed") &&
    !localStorage.getItem("ricercar-warm-reoffered")
  ) {
    localStorage.setItem("ricercar-warm-reoffered", "1");
    note("Want the fast lane? Picking 3 favourites teaches it ~20 picks’ worth.", {
      undo: openWarmStart,
      undoLabel: "pick 3 favourites",
    });
  }
}

// ---------- the teaching meter ----------
// The first six votes used to change nothing on screen except a counter, and
// the only "it just learned" signal was an 8px LED that flashed for a fraction
// of a second in a corner 1200px from where anyone was looking. This is the
// surface that makes the loop legible: it is never blank, it counts down to
// the refit, and it takes over the column when the refit happens.
let teachTakeover = false;

function renderTeach() {
  const pips = $("teach-pips");
  const copy = $("teach-copy");
  if (!pips || !copy) return;
  // Wraps rather than saturates: `duelsSinceFit` can now run past FIT_EVERY,
  // because a refit the engine says it doesn't need is skipped and re-armed
  // on the next vote (see settleFit). The countdown restarting is the right
  // reading of that — the next pick is a candidate for the refit again.
  const into = duelsSinceFit % FIT_EVERY;
  const dots = Array.from(
    { length: FIT_EVERY },
    (_, i) => `<i class="${i < into ? "lit" : ""}"></i>`
  ).join("");
  pips.innerHTML = dots;
  // The play-view strip runs the same loop, so it shows the same state.
  const pdPips = $("pd-pips");
  if (pdPips) pdPips.innerHTML = dots;
  if (teachTakeover) return;
  // Single-line copy: the duel bar is a grid now, and the sentence that
  // teaches the whole product should land whole. Name the payoff, not the
  // refit schedule.
  if (status.observations === 0) {
    copy.innerHTML = "Play both. Keep the one you’d reach for.";
  } else {
    const left = FIT_EVERY - into;
    copy.innerHTML = left === FIT_EVERY
      ? `<b>${status.observations}</b> picks in. Every ${FIT_EVERY} it redraws your taste map.`
      : `${left} more pick${left > 1 ? "s" : ""} and it redraws your taste map.`;
  }
}

// The learning moment, given its own beat instead of a blinked LED — and a
// link to the evidence: the map it just redrew.
function teachLearned() {
  const copy = $("teach-copy");
  if (!copy) return;
  teachTakeover = true;
  $("duel-mid").classList.add("learning");
  $("wm-r").classList.add("thinking");
  copy.innerHTML = `● it just learned — <b class="teach-link">see what changed ▸</b>`;
  const link = copy.querySelector(".teach-link");
  if (link) link.onclick = () => showView("taste");
  setTimeout(() => {
    teachTakeover = false;
    $("duel-mid").classList.remove("learning");
    renderTeach();
  }, 3200);
}

// ---------- next step ----------
// Nothing in the app ever answered "what should I do now?". This chip always
// does, and it is a button — it performs the step it names.
function renderNextStep() {
  const el = $("nextstep");
  if (!el) return;
  const n = status.observations;
  let label, act;
  // Every state of this chip is now actionable. The previous "go play" branch
  // was inert *and* outranked the teaching guidance for votes 1–5, so the one
  // control whose entire job is answering "what now?" did nothing during the
  // first teaching cycle. The invitation to play already lives in the rack's
  // own empty state, which is where it belongs.
  if (n === 0 && !hasPlayed) {
    // A fresh profile is invited to make a sound before it is asked to vote.
    label = "Play it first — press A, or tap a key below ▸";
    act = () => {
      document.activeElement?.blur?.();
      pulseOnce($("piano"));
    };
  } else if (n === 0) {
    label = `Teach it your taste — ${FIT_EVERY} quick picks below ▸`;
    act = () => {
      const strip = $("play-duel");
      if (currentView === "play" && strip && !strip.classList.contains("hidden")) pulseOnce(strip);
      else showView("evolve");
    };
  } else if (n < FIT_EVERY) {
    label = `${FIT_EVERY - n} more pick${FIT_EVERY - n > 1 ? "s" : ""} and it refits ▸`;
    act = () => showView("evolve");
  } else if (status.generation === 0) {
    label = "It’s learned something. Breed a generation ▸";
    act = () => { showView("evolve"); $("evolve-btn").click(); };
  } else {
    label = `Gen ${status.generation} bred new patches — hear them ▸`;
    act = () => showView("taste");
  }
  el.textContent = label;
  el.classList.toggle("inert", !act);
  el.onclick = act || null;
}

function pulseOnce(el) {
  if (!el) return;
  el.classList.remove("pulse-once");
  void el.getBoundingClientRect();
  el.classList.add("pulse-once");
  setTimeout(() => el.classList.remove("pulse-once"), 1300);
}

// First-run coach: the app invites a sound before it asks for a vote.
let coachEl = null;
function showCoach() {
  if (hasPlayed || localStorage.getItem("ricercar-played") || coachEl) return;
  coachEl = document.createElement("div");
  coachEl.className = "coach";
  coachEl.textContent = "Press A–L or tap a key — you’re already holding a synth.";
  document.body.appendChild(coachEl);
}

function firstNotePlayed() {
  if (coachEl) {
    coachEl.remove();
    coachEl = null;
  }
  if (hasPlayed) return;
  hasPlayed = true;
  localStorage.setItem("ricercar-played", "1");
  renderNextStep();
}

// ---------- feedback ----------
// Two channels, deliberately. `note()` is a transient confirmation — it stacks,
// auto-dismisses, and can carry an undo. `alarm()` is a *condition* that stays
// until it is resolved. Previously both went to one line that silently
// overwrote itself, so "cable plugged in" and "live audio engine crashed" were
// typographically identical and both vanished on the next event.
const MAX_TOASTS = 3;
// One window, shared by the toast and by whatever it is holding back.
const UNDO_WINDOW_MS = 7000;

// ---------- the toast lane ----------
// Transient chrome used to stack upward from the bottom centre of the window,
// which is exactly where PICK A / PICK B live. The app's recovery affordance
// was covering the app's core preference-learning action — and every "TAKE IT
// OUT" toast landed on the one pair of buttons the whole instrument exists to
// collect. Three rules, and the first two are geometric so the collision
// cannot silently come back with the next feature:
//
//   1. ONE LANE, anchored to the rack frame's top-right — under the header,
//      over dead canvas, nowhere near the teaching strip.
//   2. A RESERVED RECT: whatever teaching strip is on screen is measured and
//      the lane is pushed clear of it, whatever the window size.
//   3. ONE VISIBLE TOAST, with a stacking counter. Three toasts saying
//      different things at once is not three times the information.
//
// The queue matters for more than tidiness: a toast's time-to-live starts when
// it becomes *visible*, so an undo that waits its turn still gets its full
// seven seconds rather than expiring behind someone else's confirmation.
//
// Rule 4 arrived later, from the acceptance walkthrough: a REFUSAL IS NOT A
// REMARK. Everything above treats the lane as first-in-first-out, which is
// right for confirmations and wrong for the one message class that answers a
// gesture the player has already made and still believes in. Measured on the
// depth ceiling: the refusal surfaced eight seconds after the edit it was
// about, and under a burst it never surfaced at all — it carries no action, so
// the staleness drop and the backlog trim both cut exactly it. So `urgent`
// jumps the queue, displaces what is on screen, and is exempt from both cuts.
const toastQueue = [];
let toastLive = null;
/** A queued remark about a patch state that has moved on is worse than
 *  silence. An undo is exempt: being still actionable is its whole point.
 *  So is a refusal — an unheard "that did not happen" is the one omission
 *  that leaves the player believing something false. */
const TOAST_STALE_MS = 9000;

function note(text, opts = {}) {
  const el = document.createElement("div");
  el.className = `toast${opts.kind ? " " + opts.kind : ""}`;
  const msg = document.createElement("span");
  msg.className = "toast-msg";
  msg.textContent = text;
  el.appendChild(msg);
  const entry = { el, opts, born: Date.now(), timer: null };
  if (opts.undo) {
    const b = document.createElement("button");
    b.className = "toast-undo";
    b.textContent = opts.undoLabel || "undo";
    b.onclick = () => {
      opts.undo();
      dismissToast(entry, true);
    };
    el.appendChild(b);
  }
  const stack = document.createElement("span");
  stack.className = "toast-stack mono hidden";
  el.appendChild(stack);
  if (opts.urgent) preemptToast(entry);
  else toastQueue.push(entry);
  trimToastQueue();
  toastPump();
  return el;
}

/** Put a refusal at the head of the lane and take the floor for it. Whatever
 *  was on screen is *interrupted*, not spent: it goes back into the queue
 *  right behind the refusal with its undo button still live, and its window
 *  restarts when it is visible again — the same rule every queued toast
 *  already gets. Cutting it instead would answer one silent failure by
 *  creating another. */
function preemptToast(entry) {
  toastQueue.unshift(entry);
  const held = toastLive;
  if (!held) return;
  clearTimeout(held.timer);
  held.timer = null;
  held.el.classList.remove("out");
  held.el.remove();
  toastLive = null;
  toastQueue.splice(1, 0, held);
}

/** Keep the backlog shallow, and spend the cut on remarks rather than on
 *  anything still carrying an action — or on a refusal, which is the one
 *  thing in the lane that cannot be said later instead. */
function trimToastQueue() {
  while (toastQueue.length > MAX_TOASTS) {
    let i = toastQueue.findIndex((t) => !t.opts.undo && !t.opts.urgent);
    if (i < 0) i = toastQueue.findIndex((t) => !t.opts.urgent);
    // Last resort takes from the back, never the front: the head is where the
    // refusal that just pre-empted is sitting.
    toastQueue.splice(i >= 0 ? i : toastQueue.length - 1, 1);
  }
  renderToastStack();
}

function toastPump() {
  if (toastLive) return;
  while (toastQueue.length && !toastQueue[0].opts.undo && !toastQueue[0].opts.urgent &&
         Date.now() - toastQueue[0].born > TOAST_STALE_MS) {
    toastQueue.shift();
  }
  const t = toastQueue.shift();
  if (!t) return;
  toastLive = t;
  $("toasts").appendChild(t.el);
  positionToastLane();
  renderToastStack();
  // Must not outlive the action it can still cancel (see the cut handler).
  t.timer = setTimeout(() => dismissToast(t), t.opts.undo ? UNDO_WINDOW_MS : 4200);
}

function renderToastStack() {
  const c = toastLive && toastLive.el.querySelector(".toast-stack");
  if (!c) return;
  const n = toastQueue.length;
  c.textContent = n ? `+${n}` : "";
  c.classList.toggle("hidden", n === 0);
  c.title = n ? `${n} more waiting` : "";
}

function dismissToast(t, immediate) {
  if (toastLive !== t) {
    // Never made it to the lane: drop it out of the queue rather than leaving
    // a dead entry to be shown after its moment has passed.
    const i = toastQueue.indexOf(t);
    if (i >= 0) toastQueue.splice(i, 1);
    return;
  }
  clearTimeout(t.timer);
  // Retire the *action* on the window boundary, not when the animation
  // finishes — the 300 ms fade kept a clickable undo on screen past the moment
  // its commit had already fired.
  const b = t.el.querySelector(".toast-undo");
  if (b) { b.disabled = true; b.style.pointerEvents = "none"; }
  t.el.classList.add("out");
  const gone = () => {
    t.el.remove();
    toastLive = null;
    toastPump();
  };
  if (immediate) gone();
  else setTimeout(gone, 300);
}

/** Anchor the lane, then push it clear of whatever teaching strip is up.
 *  Rule 2 above: the reserved rect is measured, not assumed. */
function positionToastLane() {
  const holder = $("toasts");
  if (!holder || !holder.firstChild) return;
  const frame = $("rack-frame");
  const fr = currentView === "play" && frame ? frame.getBoundingClientRect() : null;
  let top = fr && fr.height > 0 ? fr.top + 10 : 64;
  let right = fr && fr.width > 0 ? Math.max(12, window.innerWidth - fr.right + 10) : 16;
  holder.style.top = `${Math.round(top)}px`;
  holder.style.right = `${Math.round(right)}px`;

  // The reserved rects. A teaching strip is the one thing in the app that a
  // transient may never cover, so its box is measured and stepped around —
  // above it if there is room under the menubar, below it if there is not.
  // Two passes, because clearing one strip can walk into another.
  const reserved = [$("play-duel"), $("duel-mid"), document.querySelector(".duel-controls")]
    .filter((el) => el && !el.classList.contains("hidden") && el.offsetParent !== null);
  for (let pass = 0; pass < 2; pass++) {
    const lane = holder.getBoundingClientRect();
    let moved = false;
    for (const el of reserved) {
      const r = el.getBoundingClientRect();
      if (r.height === 0) continue;
      const hits = lane.bottom > r.top && lane.top < r.bottom &&
                   lane.right > r.left && lane.left < r.right;
      if (!hits) continue;
      const above = r.top - lane.height - 8;
      top = above >= 56 ? above : r.bottom + 8;
      holder.style.top = `${Math.round(top)}px`;
      moved = true;
      break;
    }
    if (!moved) break;
  }
}
window.addEventListener("resize", positionToastLane);

// A toast whose undo can no longer fire must say so — see commitPendingVote,
// which retires a vote's undo early when a refit claims it.
function retireToastUndo(el) {
  const b = el?.querySelector?.(".toast-undo");
  if (!b) return;
  b.disabled = true;
  b.style.pointerEvents = "none";
  b.textContent = "in the log";
}

// One number, one source. The menubar readout and the TRUST tab must not
// disagree, so both prefer the engine's accounting and fall back to the
// local tally only until the first `calibration()` reply lands.
// Honesty gates: no percentage below 20 forecasts (3 forecasts can print
// "100% sharper than chance"), never a negative percentage (skill can go
// negative; "−73% sharper" is meaningless), and prefer the unbiased
// check-duel number once it has enough mass — the app's own TRUST copy calls
// it "the number to trust", so the headline must not disagree.
const SKILL_MIN_N = 20;

// The ONE formatter for a skill percentage, shared by the menubar and the
// TRUST tab so they can never disagree — and so a negative skill is always
// clamped to honest words instead of "−7% sharper than chance".
function skillLine(skill, n, tag) {
  const pct = Math.round(skill * 100);
  return pct <= 0
    ? `not beating a coin flip yet (n=${n})`
    : `${pct}% sharper than chance${tag ? ` · ${tag}` : ""}`;
}

function renderSkill() {
  const el = $("skill");
  if (!el) return;
  const E = engineCalib;
  const line = skillLine;
  if (E && E.check_n >= SKILL_MIN_N) {
    el.textContent = line(E.check_skill, E.check_n, `${E.check_n} check picks`);
    el.title = `Brier skill on unbiased check duels — the number to trust. All forecasts: ${Math.round(E.skill * 100)}% over ${E.n}. See TASTE → trust.`;
    return;
  }
  if (E && E.n >= SKILL_MIN_N) {
    el.textContent = line(E.skill, E.n);
    el.title = `Brier skill over ${E.n} forecasts (selection-biased until enough check duels land). See TASTE → trust.`;
    return;
  }
  const n = E ? E.n : calib.n;
  if (n >= 1) {
    el.textContent = `calibrating — ${Math.min(n, SKILL_MIN_N)} of ${SKILL_MIN_N} forecasts`;
    el.title = `The model forecasts each duel before your vote; after ${SKILL_MIN_N} it reports how much sharper than a coin flip it has been.`;
  } else {
    el.textContent = "";
  }
}

function alarm(text, action) {
  const el = $("alarm");
  if (!text) {
    el.classList.add("hidden");
    el.innerHTML = "";
    return;
  }
  el.classList.remove("hidden");
  el.innerHTML = `<span class="al-icon">⚠</span><span class="al-msg"></span>`;
  el.querySelector(".al-msg").textContent = text;
  if (action) {
    const b = document.createElement("button");
    b.className = "toast-undo";
    b.textContent = action.label;
    b.onclick = action.run;
    el.appendChild(b);
  }
}

// Names are the one thing on this surface the user (or a *file*) writes, and
// every list on the surface is built by interpolating them into `innerHTML`.
// Raw, that executed: renaming a patch to `<img src=x onerror=…>` ran the
// handler, and because the name persists in `BankEntry.name` it came back on
// every reload. The sink is also fed by imported patch JSON — the app's share
// format — so opening a patch someone sent you was script execution in your
// session, with your whole taste log in reach.
//
// Prefer `textContent` wherever the node allows it. `esc` is for the templates
// that cannot be rewritten that way, and covers `"` and `'` because two of
// them interpolate into *attributes* (the style chip's value/placeholder).
const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

// Adopt a new `views` and report anything the pool quietly destroyed doing it.
//
// The prev/now diff used to live inside the `refined` handler alone, so three
// of the four paths that can evict said nothing: committing an edit, importing
// a patch, and loading a preset each silently dropped the lowest-predicted
// member — which meant "Preset loaded as Cathedral" could be the whole report
// of an exchange that also destroyed a patch the user had starred. Every path
// that adopts views goes through here now.
//
// Returns the ids that vanished, so a caller can fold the count into whatever
// it was going to say anyway rather than firing a second toast.
function applyViews(next) {
  const prevIds = new Set(((views && views.ranked) || []).map((r) => r.id));
  const prevNames = new Map(((views && views.ranked) || []).map((r) => [r.id, r.name]));
  views = next;
  const nowIds = new Set(((views && views.ranked) || []).map((r) => r.id));
  const evicted = [...prevIds].filter((id) => !nowIds.has(id) && !cutIds.has(id));
  // The engine owns the budget and ships it with every views post, which is
  // the only reason the readout survives a reload: nothing in the UI knows how
  // many pins a restored session came back with.
  if (next && next.pinBudget) pinBudget = next.pinBudget;
  renderPinBudget();
  // A pin means this can no longer happen to anything the user kept, so if it
  // somehow does, that is a bug worth shouting about rather than a policy to
  // apologise for.
  const lost = evicted.filter((id) => (starsById.get(id) || 0) >= 4);
  if (lost.length > 0) {
    const names = lost.map((id) => prevNames.get(id) || `#${id}`).join(", ");
    alarm(
      `Made room by dropping ${names}, which you rated highly. Stars tell the model what you like; ` +
        `saving is what stops a patch being replaced.`,
      { label: "ok", run: () => alarm(null) }
    );
  }
  return evicted;
}

// The clause every insertion path appends to its own message, so the exchange
// is reported as an exchange rather than as a gift.
function madeRoom(evicted) {
  if (!evicted || evicted.length === 0) return "";
  return ` ${evicted.length} lowest-predicted made room.`;
}

function rowOf(id) {
  return (views && views.ranked && views.ranked.find((x) => x.id === id)) || null;
}

function nameOf(id) {
  const r = rowOf(id);
  return r ? r.name : `#${id}`;
}

// The topology signature (`ssaw·lp·ladr`) is secondary metadata, not a name —
// it collides constantly and describes the graph rather than the sound.
function sigOf(id) {
  const r = rowOf(id);
  return (r && (r.sig || r.signature)) || "";
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
  renderPlayDuel(); // names backfill once ranked rows exist
}

// ---------- views (tabs) ----------
function showView(name) {
  // Nothing may stay in your hand across a view change: PLAY is only hidden,
  // not torn down, so its sockets still match and the armed key handler would
  // go on swallowing EVOLVE's arrow-key votes.
  if (name !== "play") { disarm(); cancelPending(); }
  currentView = name;
  for (const v of ["play", "evolve", "taste"]) {
    $(`view-${v}`).classList.toggle("hidden", v !== name);
  }
  document.querySelectorAll(".viewtab").forEach((t) => {
    const on = t.dataset.view === name;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", String(on));
  });
  if (name === "play") refitRack();
  // The lane is anchored to the rack frame, which only exists in PLAY, and it
  // has to clear whichever teaching strip this view puts up.
  positionToastLane();
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

// role=tablist / role=menu promise arrow keys; deliver them. One wiring for
// every group: roving focus with wrap, optional activate-on-move for tabs.
function wireArrowNav(container, itemSel, { activate = false, vertical = false } = {}) {
  if (!container) return;
  // Roving tabindex: the group is ONE tab stop; arrows move within it.
  const rove = (target) => {
    container.querySelectorAll(itemSel).forEach((el) => {
      el.tabIndex = el === target ? 0 : -1;
    });
  };
  const first = container.querySelector(itemSel);
  if (first) rove(container.querySelector(`${itemSel}.active`) || first);
  container.addEventListener("focusin", (e) => {
    const item = e.target.closest?.(itemSel);
    if (item) rove(item);
  });
  container.addEventListener("keydown", (e) => {
    const fwd = vertical ? "ArrowDown" : "ArrowRight";
    const back = vertical ? "ArrowUp" : "ArrowLeft";
    if (e.key !== fwd && e.key !== back && e.key !== "Home" && e.key !== "End") return;
    const items = [...container.querySelectorAll(itemSel)].filter((el) => !el.disabled);
    if (items.length === 0) return;
    const cur = document.activeElement?.closest?.(itemSel);
    const i = items.indexOf(cur);
    const j =
      e.key === "Home" ? 0
      : e.key === "End" ? items.length - 1
      : e.key === fwd ? (i + 1 + items.length) % items.length
      : (i - 1 + items.length) % items.length;
    e.preventDefault();
    e.stopPropagation();
    rove(items[j]);
    items[j].focus();
    if (activate) items[j].click();
  });
}
wireArrowNav(document.querySelector(".viewtabs"), ".viewtab", { activate: true });
wireArrowNav(document.querySelector(".tabs"), ".tab", { activate: true });
wireArrowNav($("ovf-menu"), ".ovf-item", { vertical: true });

// ---------- audio helpers ----------
function ensureAudio() {
  if (audioCtx.state === "suspended") audioCtx.resume();
}

let playingGain = null;

function playBuffer(buffer, btn) {
  if (!buffer) return;
  ensureAudio();
  if (playingSrc) {
    // Ramp the old source down over ~5ms before stopping it — a hard stop
    // mid-waveform clicks on every re-audition.
    const oldSrc = playingSrc;
    const oldGain = playingGain;
    if (oldGain) oldGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.003);
    setTimeout(() => { try { oldSrc.stop(); } catch (_) {} }, 20);
  }
  const src = audioCtx.createBufferSource();
  const g = audioCtx.createGain();
  src.buffer = buffer;
  src.connect(g);
  g.connect(master);
  src.start();
  playingSrc = src;
  playingGain = g;
  src.onended = () => {
    if (playingSrc === src) { playingSrc = null; playingGain = null; }
    if (btn) btn.classList.remove("playing");
  };
  if (btn) btn.classList.add("playing");
}

// Space is a transport: it stops what's sounding, or auditions the current
// patch's phrase from any view.
function stopAudition() {
  if (!playingSrc) return false;
  const s = playingSrc;
  const g = playingGain;
  if (g) g.gain.setTargetAtTime(0, audioCtx.currentTime, 0.003);
  setTimeout(() => { try { s.stop(); } catch (_) {} }, 20);
  playingSrc = null;
  playingGain = null;
  return true;
}

function toggleAudition() {
  if (stopAudition()) return;
  if (currentView === "play" && wb.buffer && !$("rack-play").disabled) return playBench();
  const id = wb.subjectId != null ? wb.subjectId : livePatchId;
  if (id == null) return;
  awaitRender(id, () => play(id));
}

// Step the bank without the mouse: loads the next patch onto the bench and
// follows it in the rail. Steps bankRows — the exact filtered, sorted list
// the rail is showing — so mouse, arrows and [ ] agree on one order.
function stepBank(d) {
  const rows = bankRows;
  if (rows.length === 0) return;
  const cur = rows.findIndex((r) => r.id === wb.subjectId);
  const idx = Math.max(0, Math.min(rows.length - 1, (cur < 0 ? (d > 0 ? -1 : rows.length) : cur) + d));
  const next = rows[idx];
  if (!next || next.id === wb.subjectId) return;
  bankScrollTo = next.id;
  // Stepping is what "the highlighted row" means to someone who just pressed
  // [ or ] — so the step moves the keyboard cursor too, and 1–5 rates what
  // they just stepped to rather than nothing.
  kbdRowId = next.id;
  openOnBench(next.id);
}

function play(id, btn) {
  const r = renders.get(id);
  if (r) playBuffer(r.buffer, btn);
}

// Every "hear this thing that isn't loaded yet" path in the app used to be its
// own bare `setInterval` that polled `renders` and cleared itself on arrival —
// three of them, none with an exit for the buffer that never comes. Under the
// old eager pool that was merely latent (the worker held every buffer, so the
// only way to hang was an unknown id). With lazy rendering it is reachable
// from any candidate, and a spin-wait with no failure edge is a hang with a
// timer attached.
//
// One helper, three exits: it arrived, the engine said it can't, or we waited
// long enough that something is wrong. `abandoned()` is the fourth, optional
// case — the caller no longer cares (the user voted past the duel), which is a
// silent stop, not a failure.
//
// The deadline measures *serviceable* time, not wall time. `fit` and `refine`
// are synchronous wasm calls that hold the worker's message queue for far
// longer than 12 s — a generation is tens of seconds — and every ▶ in the app
// stays live while they run (the duel pair, the bank rows, the style
// exemplars). Against a wall clock those clicks would all report "timed out"
// for renders that are queued, healthy, and on their way, and the arriving
// buffer would then land in `renders` with nobody left waiting to play it: a
// false failure *and* a silent drop, where the old spin-waits merely waited.
// So the timer only accrues across ticks where the worker said it was idle.
// The `renderFailures` exit stays unconditional — "the engine says never" is
// an answer, and it is the exit that actually matters.
const RENDER_WAIT_MS = 12_000;
const RENDER_POLL_MS = 100;

function awaitRender(id, onReady, opts = {}) {
  if (renders.has(id)) return onReady();
  // A previous failure must not silently answer a fresh request: the term may
  // render fine now (the bench re-vetted it, the pool re-admitted it).
  renderFailures.delete(id);
  send({ type: "render", id });
  let waited = 0;
  let last = performance.now();
  const stop = (fn) => { clearInterval(wait); if (fn) fn(); };
  const wait = setInterval(() => {
    const now = performance.now();
    const dt = now - last;
    last = now;
    if (!engineBusy) waited += dt;
    if (opts.abandoned && opts.abandoned()) return stop(null);
    if (renders.has(id)) return stop(onReady);
    if (renderFailures.has(id)) {
      return stop(() => renderFailed(id, renderFailures.get(id)));
    }
    if (waited > RENDER_WAIT_MS) {
      return stop(() => renderFailed(id, "timed out"));
    }
  }, RENDER_POLL_MS);
  return wait;
}

// One place to say it, so a render that never comes is a visible condition
// rather than a button that quietly does nothing forever. Announced once per
// id: the duel table asks for the same buffer on every deal and every settle,
// and three toasts saying the same thing is noise, not information.
const renderAnnounced = new Set();
function renderFailed(id, reason) {
  if (renderAnnounced.has(id)) return;
  renderAnnounced.add(id);
  note(`Couldn't render ${nameOf(id)} — ${reason || "the engine returned no audio"}.`);
}

// The worklet reporting that an address it was asked to write does not exist
// in the patch it is running. That is the gesture→sound contract broken: the
// knob moved, the genome moved, and the sound did not.
//
// Remembering the address for next time was never a fix. `nonLiveAddrs` is
// consulted *synchronously* when the bench reply lands, and this message
// arrives asynchronously from the audio thread — the only reason annotating
// ever appeared to work is that the worklet answers in ~3 ms and the worker in
// ~500, so the note usually beat the reply it was meant for. It is a race, and
// the first knob of a session is where it loses. So heal it here rather than
// filing it: hand the voices the tree the bench actually holds, and the
// address exists again.
//
// Once per tree, though, and only when the voices are genuinely behind. A knob
// drag is a stream of writes, every one of them misses until the re-patch
// lands, and a re-patch per write is a dropout per write — the exact storm
// this is meant to end. When the worklet already has the newest tree the miss
// means the address has no live handle at all (an enum, a structural site);
// re-patching would buy a dropout and change nothing, and the bench reply's
// own non-live path already covers it.
function healParamMiss(addr) {
  nonLiveAddrs.add(addr);
  if (!live || !benchTreeJson || benchTreeJson === "null") return;
  if (benchTreeJson === liveTreeJson || healedRev === liveRev) return;
  live.setPatch(benchTreeJson, benchMakeup);
  setLivePatchJson(benchTreeJson, benchMakeup);
  healedRev = liveRev;
}

// ---------- live instrument ----------
async function bootLiveAudio() {
  const { initLiveAudio } = await import(`./live-audio.js?v=${BUILD}`);
  live = await initLiveAudio(audioCtx, BUILD, master);
  // The analysers exist for the first time here, so this is the first moment
  // the persisted fft size, window and tap can actually be applied to one.
  scopeApply();
  live.onMessage((m) => {
    (window.__ricLog = window.__ricLog || []).push(m);
    if (m.type === "patch_error") note(`live patch failed to compile: ${m.error}`);
    if (m.type === "param_miss") healParamMiss(m.addr);
    if (m.type === "rec_done" && m.samples && m.samples.length > 0) {
      downloadWav(m.samples, m.sampleRate);
    }
  });
  // Master owns the volume now (so ▶ auditions obey the fader too); the
  // worklet's internal gain stays at unity.
  live.setVolume(1);
  master.gain.value = volume;
  renderVolVal();
  applyPerfUi();
  live.node.onprocessorerror = (e) => {
    (window.__ricLog = window.__ricLog || []).push({ type: "processor_error", e: String(e) });
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
  // The audibility gate on the revert log: this note is the player hearing
  // whatever edit is currently on the bench.
  markHeard();
  paintKey(note_, true);
  startScope();
  setSignalFlow(true);
  flashAmp();
  firstNotePlayed();
  if (livePatchId != null) {
    playCounts.set(livePatchId, (playCounts.get(livePatchId) || 0) + 1);
  }
}

// The amp plate lights on note-on, so the picture is tied to the sound at the
// exact module where the sound leaves the patch. The plate is cached at render
// time: this runs on every note, and a fast trill must not pay for a full
// `querySelectorAll` over the rack each press.
let ampPlateEl = null;
let ampFlashTimer = null;

function flashAmp() {
  if (!ampPlateEl || !ampPlateEl.isConnected) return;
  const el = ampPlateEl;
  el.classList.remove("struck");
  void el.getBoundingClientRect(); // restart the transition
  el.classList.add("struck");
  // It is a flash, not a state: without this the plate latches lit on the
  // first note and never returns.
  clearTimeout(ampFlashTimer);
  ampFlashTimer = setTimeout(() => el.classList.remove("struck"), 120);
}

// Flush accumulated per-patch play counts into the engine's implicit log.
function flushPlayCounts() {
  for (const [id, n] of playCounts) {
    if (n > 0) send({ type: "log_event", kind: "play", id, value: n });
  }
  playCounts.clear();
}
setInterval(flushPlayCounts, 45_000);

function liveNoteOff(note_) {
  if (!live) return;
  if (hold) return; // latched — released on hold-off or panic
  live.noteOff(note_);
  heldNotes.delete(note_);
  paintKey(note_, false);
  if (heldNotes.size === 0) setTimeout(() => { if (heldNotes.size === 0) setSignalFlow(false); }, 400);
}

function panic() {
  if (live) live.allOff();
  for (const n of [...heldNotes]) paintKey(n, false);
  heldNotes.clear();
  setSignalFlow(false);
}

// ---------- virtual keyboard ----------
const PIANO_LO = 48; // C3
const PIANO_HI = 84; // C6
// The keybed's width is a performance decision, not a constant. Three octaves
// across a tablet is 22 white keys at ~27px — narrower than a fingertip, so
// every chord is a gamble; two octaves is 15 keys you can actually aim at, and
// one is a fat lead keybed. Range costs little: z/x move the whole keybed, so
// nothing becomes unreachable, it just takes a shift to get there.
const KEY_SPANS = [12, 24, 36, 48];
const SPAN_DEFAULT_FINE = 36; // three octaves, as it has always been
const SPAN_DEFAULT_COARSE = 24; // a finger needs the width more than the range
const BLACK = new Set([1, 3, 6, 8, 10]);
const KEYMAP = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11,
  k: 12, o: 13, l: 14, p: 15, ";": 16, "'": 17,
};
const keyEls = new Map(); // midi -> element
// Roughly mezzo-forte: leaves headroom above for an accent and below for the
// velocity curve to still mean something.
const COMPUTER_KEY_VEL = 0.78;

function buildPiano() {
  const piano = $("piano");
  piano.innerHTML = "";
  keyEls.clear();
  // The keybed follows the octave shift. It used to be pinned at C3–C6 while
  // Z/X moved only the computer keymap, so at oct +2 the keys you played
  // neither lit nor carried letters.
  // Where the keybed starts matters once it can be narrow. A wide keybed sits
  // an octave below the computer keymap so a pointer can reach bass the letters
  // can't — but a one-octave keybed anchored there shows C3–C4 while `a`–`k`
  // play C4–F5, i.e. an octave you cannot type and none of the one you can. So
  // the narrow sizes anchor on the keymap itself.
  const anchor = perf.keySpan >= 36 ? PIANO_LO : PIANO_LO + 12;
  const lo = anchor + 12 * octShift;
  const hi = lo + perf.keySpan;
  for (let n = lo; n <= hi; n++) {
    if (BLACK.has(n % 12)) continue;
    const wk = document.createElement("div");
    wk.className = "pkey";
    wk.dataset.note = n;
    wk.innerHTML = `<span class="hint"></span>`;
    keyEls.set(n, wk);
    // A black key rides on the white key to its left. The pitch-class tag
    // places each accidental where it sits on a real keybed (CSS .pc1…).
    if (n + 1 <= hi && BLACK.has((n + 1) % 12)) {
      const bk = document.createElement("div");
      bk.className = `bkey pc${(n + 1) % 12}`;
      bk.dataset.note = n + 1;
      bk.innerHTML = `<span class="hint"></span>`;
      keyEls.set(n + 1, bk);
      wk.appendChild(bk);
    }
    piano.appendChild(wk);
  }
  attachPianoPointers(piano);
  paintHints();
  // A latched chord survives the rebuild visually as well as audibly.
  for (const n of heldNotes) paintKey(n, true);
}

function paintHints() {
  const base = 60 + 12 * octShift;
  const hintFor = new Map();
  for (const [key, off] of Object.entries(KEYMAP)) hintFor.set(base + off, key);
  for (const [midi, el] of keyEls) {
    const hint = el.querySelector(".hint");
    const letter = hintFor.get(midi) || "";
    // Every C carries its octave label — a keybed with no C markers is
    // unreadable at a glance.
    if (midi % 12 === 0) {
      const oct = Math.floor(midi / 12) - 1;
      hint.innerHTML = letter ? `${letter} <b>C${oct}</b>` : `<b>C${oct}</b>`;
    } else {
      hint.textContent = letter;
    }
    el.classList.toggle("mapped", !!letter);
  }
  // Say what the shift means, not its sign: the note the `a` key plays.
  $("oct-label").textContent = `a = C${4 + octShift}`;
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
  // Velocity from where on the key you strike it — near the pivot is soft,
  // near the tip is hard, as on a real keybed. Without this every on-screen
  // and computer-key note was velocity 1.0, so the whole velocity path
  // (`vel_gain`, and anything routed from it) was dead for everyone without a
  // hardware MIDI keyboard.
  const velFromPoint = (target, clientY) => {
    // `elementFromPoint` can land on a key's hint label, so resolve to the key
    // itself before measuring against its height.
    const el = target?.closest?.(".bkey") || target?.closest?.(".pkey");
    if (!el) return COMPUTER_KEY_VEL;
    const r = el.getBoundingClientRect();
    if (r.height <= 0) return COMPUTER_KEY_VEL;
    const frac = Math.min(1, Math.max(0, (clientY - r.top) / r.height));
    return 0.35 + 0.65 * frac;
  };
  piano.addEventListener("pointerdown", (ev) => {
    const n = noteOf(ev.target);
    if (n == null) return;
    ev.preventDefault();
    pointerNote.set(ev.pointerId, n);
    // A pen or touch that reports real pressure should use it.
    const vel = ev.pointerType === "pen" && ev.pressure > 0
      ? 0.25 + 0.75 * ev.pressure
      : velFromPoint(ev.target, ev.clientY);
    liveNoteOn(n, vel);
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
      // Same strike-position law as pointerdown. Without it a glissando began
      // velocity-sensitive and then pinned every subsequent note to 1.0 — a
      // +9 dB jump mid-gesture with no change in finger position, which is
      // more disturbing to play than a uniform constant would be.
      liveNoteOn(n, velFromPoint(el, ev.clientY));
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
    // In EVOLVE, ⌘Z takes back the vote still inside its undo window;
    // everywhere else it is the workbench edit undo.
    if (!e.shiftKey && currentView === "evolve" && retractVote()) return;
    // Unconditional: a restore already in flight is a reason to *queue* the
    // press, not to discard it — which is what this gate did, silently, to
    // nine presses out of ten in a burst. `requestRestore` owns the waiting.
    e.shiftKey ? doRedo() : doUndo();
    return;
  }
  // Camera zoom, on the bindings every expert already has in their fingers.
  // Checked here because the meta/ctrl bail-out below is what keeps browser
  // chords out of the note handler, and these are browser chords we want.
  if ((e.metaKey || e.ctrlKey) && !e.altKey && currentView === "play" &&
      !e.target?.closest?.("input, select, textarea, [contenteditable]")) {
    if (e.key === "0") { e.preventDefault(); zoomActual(); return; }
    if (e.key === "-" || e.key === "_") { e.preventDefault(); zoomStep(1 / 1.25); return; }
    if (e.key === "=" || e.key === "+") { e.preventDefault(); zoomStep(1.25); return; }
  }
  // A module in hand takes the arrow keys and Enter, so it is asked first.
  if (nbArmedKeys(e)) { e.preventDefault(); return; }
  if (e.key === "Escape") {
    // One dismissal law for the keyboard too: Escape closes whatever floats,
    // and hands focus back to the control that opened it.
    cancelPending();
    endConnectPick();
    if (!$("ovf-menu").classList.contains("hidden")) {
      $("ovf-menu").classList.add("hidden");
      $("ovf-btn").setAttribute("aria-expanded", "false");
      $("ovf-btn").focus();
    }
    if (!$("bank-tour").classList.contains("hidden")) {
      endBankTour();
      $("bank-tour-btn").focus();
    }
    closeMenu();
    return;
  }
  // `/` is the index. It is deliberately checked before the text-entry guard's
  // sibling below, so it works from the rack, the bank or the keybed — but
  // after it, so typing a slash into a field still types a slash.
  if (e.key === "/" && currentView === "play" &&
      !e.target?.closest?.("input, select, textarea, [contenteditable]")) {
    e.preventDefault();
    if (nbState.collapsed) nbSetCollapsed(false);
    $("nb-q").focus();
    $("nb-q").select();
    return;
  }
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  // Typing into the UI must never play notes — but a focused control must not
  // silence the instrument either. Text-entry contexts swallow everything;
  // buttons, tabs, knobs, and sliders swallow only the keys they actually use
  // (Space, Enter, arrows), so note letters still play. Without the second
  // rule, clicking HOLD or ARP left focus on the button and the entire
  // keyboard went dead until the player clicked elsewhere.
  // Optional-chained: a keydown whose target is the document (rather than an
  // element) has no `closest`, and an exception here kills the note handler.
  if (e.target?.closest?.("input:not([type=range]), select, textarea, [contenteditable]")) return;
  // Fit-all and fit-selection. `Home` is checked against `defaultPrevented`
  // because four list widgets bind it to "go to the first row" on themselves,
  // and those handlers have already run by the time it bubbles here — the
  // list you are inside of wins, and everywhere else it means the canvas.
  // `.` is the second half of the conventional pair; its partner `F` is not
  // available, being the note F on the computer keybed (see KEYMAP).
  if (currentView === "play" && !e.defaultPrevented) {
    if (e.key === "Home") { e.preventDefault(); fitAll(true); return; }
    if (e.key === ".") { e.preventDefault(); fitSelection(true); return; }
  }
  const noteKey = k in KEYMAP || k === "z" || k === "x";
  if (!noteKey && e.target?.closest?.("button, [role=tab], [data-addr], input[type=range]")) return;
  if (k in KEYMAP) {
    const midi = 60 + 12 * octShift + KEYMAP[k];
    if (midi >= 0 && midi <= 127 && !downComputerKeys.has(k)) {
      downComputerKeys.set(k, midi);
      // A computer key has no strike position, so it gets a musical default
      // rather than the implicit 1.0 — full velocity on every note is not a
      // neutral choice, it is the loudest one, and it made `vel_gain` a
      // constant for anyone without a MIDI keyboard. Shift plays harder.
      liveNoteOn(midi, e.shiftKey ? 1.0 : COMPUTER_KEY_VEL);
    }
    return;
  }
  if (k === "z") return octave(-1);
  if (k === "x") return octave(1);
  // Over the rack, space arms the pan drag and the audition waits for the
  // key to come back up; anywhere else it is the audition it always was.
  if (k === " ") { e.preventDefault(); if (rackSpaceDown()) return; return toggleAudition(); }
  if (k === "[") return stepBank(-1);
  if (k === "]") return stepBank(1);
  // Global, like `[`/`]` and `1`-`5`, because the help lists it beside them.
  // Bound only to the bank list it was a shortcut the docs promised and the
  // app did not honour anywhere else — the same defect the digits already had
  // and had already been fixed for.
  if (k === "m") { saveCursorRow(); return; }
  if (currentView === "evolve") {
    if (e.key === "1") $("play-a").click();
    else if (e.key === "2") $("play-b").click();
    else if (e.key === "ArrowLeft") $("choose-a").click();
    else if (e.key === "ArrowRight") $("choose-b").click();
    return;
  }
  // The help has always printed "[ / ] step through the bank · 1–5 rate the
  // highlighted bank row" on one line, and the obvious reading of it — step to
  // a patch, then rate it — did nothing at all: the digits were bound to the
  // bank list's own keydown, so they only fired if you had first tabbed into
  // it, which the help does not mention and nothing on screen suggests. Bound
  // here, that sentence is true. EVOLVE keeps 1/2 for auditioning its pair,
  // which is why this sits after that branch's return.
  if (/^[1-5]$/.test(e.key)) {
    e.preventDefault();
    rateRow(Number(e.key));
  }
});
document.addEventListener("keyup", (e) => {
  const k = e.key.toLowerCase();
  if (k === " " && rackSpaceUp()) return;
  const midi = downComputerKeys.get(k);
  if (midi !== undefined) {
    downComputerKeys.delete(k);
    liveNoteOff(midi);
  }
});
window.addEventListener("blur", () => {
  downComputerKeys.clear();
  // A space held when the window went away never sends its keyup, and a
  // sticky pan modifier eats the next click on a knob.
  spacePan = false;
  $("rack-scroll")?.classList.remove("grabbing");
  panic();
});
// A buffered vote must not die with the tab.
window.addEventListener("pagehide", () => commitPendingVote());

// A real mouse click must not leave focus parked on a button — parked focus
// changes what the next keystroke means, and on an instrument that surprise
// is fatal. Keyboard activation (detail === 0) keeps focus so Tab users keep
// their place; blur() on an element that no longer holds focus (a handler
// moved it into an input) is a no-op, so this never steals a deliberate move.
document.addEventListener("click", (e) => {
  if (e.detail === 0) return;
  const b = e.target?.closest?.("button");
  if (b) b.blur();
});

function octave(d) {
  const next = Math.max(-2, Math.min(2, octShift + d));
  if (next === octShift) return;
  octShift = next;
  buildPiano(); // the keybed moves with the shift, not just the letter hints
  scheduleSave();
}

$("oct-down").onclick = () => octave(-1);
$("oct-up").onclick = () => octave(1);
$("hold-btn").onclick = () => {
  hold = !hold;
  $("hold-btn").classList.toggle("lit", hold);
  $("hold-btn").setAttribute("aria-pressed", String(hold));
  if (!hold) panic();
};
$("panic-btn").onclick = () => panic();
function renderVolVal() {
  const el = $("vol-val");
  if (!el) return;
  el.textContent = volume <= 0.001 ? "mute" : `${(20 * Math.log10(volume)).toFixed(0)} dB`;
}
$("vol").oninput = (e) => {
  volume = Number(e.target.value);
  master.gain.setTargetAtTime(volume, audioCtx.currentTime, 0.01);
  renderVolVal();
  scheduleSave();
};

// ---------- performance controls (arp / unison / glide) ----------
// `keySpan` defaults by input device rather than by taste: three octaves is
// right for a mouse, which can hit a 27px key, and wrong for a finger, which
// cannot. Saved sessions override it, so this only decides the first visit.
const perf = {
  arp: false, arpMode: 0, arpDiv: 2, bpm: 120, uni: false, glide: 0,
  arpGate: 0.5, arpOct: 1, arpSwing: 0,
  // The tall dock stays an explicit choice — it costs the rack real height,
  // and taking that without being asked is not a default's business. The
  // width, which costs nothing but range, is chosen for you.
  bigKeys: false, keySpan: COARSE ? SPAN_DEFAULT_COARSE : SPAN_DEFAULT_FINE,
};

function sendArp() {
  if (live) live.arp(perf.arp, perf.arpMode, perf.arpDiv, perf.bpm, perf.arpGate, perf.arpOct, perf.arpSwing);
  $("arp-btn").classList.toggle("lit", perf.arp);
  $("arp-btn").setAttribute("aria-pressed", String(perf.arp));
  // The arp row is the ARP button's drawer: recessed and inert until it
  // runs — for the keyboard as well as the mouse.
  const drawer = $("arp-ctl");
  if (drawer) {
    drawer.classList.toggle("idle", !perf.arp);
    drawer.setAttribute("aria-disabled", String(!perf.arp));
    drawer.querySelectorAll("select, input").forEach((c) => {
      c.tabIndex = perf.arp ? 0 : -1;
    });
  }
}
function sendUni() {
  if (live) live.unison(perf.uni, 0.4, 0.8);
  const btn = $("uni-btn");
  btn.classList.toggle("lit", perf.uni);
  // `.lit` is a colour. A colour is not a state a screen reader can read, and
  // hold / uni / arp are the three controls that silently change what every
  // subsequent keypress does.
  btn.setAttribute("aria-pressed", String(perf.uni));
  // UNI silently turns a 4-voice poly synth mono — say so on the control.
  btn.textContent = perf.uni ? "uni ×4 mono" : "uni";
}
function renderArpVals() {
  const g = $("arp-gate-val");
  if (g) g.textContent = `${Math.round(perf.arpGate * 100)}%`;
  const s = $("arp-swing-val");
  if (s) s.textContent = `${Math.round(perf.arpSwing * 100)}%`;
}
function applyPerfUi() {
  $("arp-mode").value = String(perf.arpMode);
  $("arp-div").value = String(perf.arpDiv);
  $("bpm").value = String(perf.bpm);
  $("glide").value = String(perf.glide);
  $("arp-gate").value = String(perf.arpGate);
  $("arp-oct").value = String(perf.arpOct);
  $("arp-swing").value = String(perf.arpSwing);
  renderArpVals();
  sendArp();
  sendUni();
  applyKeybed();
  renderGlideVal();
  if (live) live.glide(perf.glide);
}

// A fader with no readout looks broken even when it isn't — and this one is
// the least self-evident control on the dock, because its effect only shows
// up on the *next* note. Say the time it will take.
function renderGlideVal() {
  const el = $("glide-val");
  if (!el) return;
  // Matches the audio thread: tau = glide * 0.5 s (see LivePoly::advance_pitch).
  el.textContent = perf.glide <= 0 ? "off" : `${Math.round(perf.glide * 500)} ms`;
}

// Height and width of the keybed, applied together. This lives here rather
// than in the click handlers so a restored session comes back exactly as it
// was left — tall or short, one octave or four.
function applyKeybed() {
  if (!KEY_SPANS.includes(perf.keySpan)) perf.keySpan = SPAN_DEFAULT_FINE;
  document.querySelector(".app").classList.toggle("bigkeys", perf.bigKeys);
  $("bigkeys-btn").classList.toggle("lit", perf.bigKeys);
  $("bigkeys-btn").setAttribute("aria-pressed", String(perf.bigKeys));
  $("key-span").value = String(perf.keySpan);
  buildPiano();
  // The dock changing height is a layout change like any other — the rack
  // above it has to re-zoom into what's left, and the canvases have to be
  // re-measured. The app already knows how to answer that question.
  window.dispatchEvent(new Event("resize"));
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
$("bigkeys-btn").onclick = () => {
  perf.bigKeys = !perf.bigKeys;
  applyKeybed();
  note(perf.bigKeys
    ? "Tall keybed — narrow the keys with the octave selector beside it."
    : "Keybed back to a control strip.");
  scheduleSave();
};
$("key-span").onchange = (e) => {
  perf.keySpan = Number(e.target.value);
  applyKeybed();
  note(`Keybed showing ${perf.keySpan / 12} octave${perf.keySpan === 12 ? "" : "s"} — z / x move it.`);
  scheduleSave();
};
$("arp-gate").oninput = (e) => { perf.arpGate = Number(e.target.value); renderArpVals(); sendArp(); scheduleSave(); };
$("arp-swing").oninput = (e) => { perf.arpSwing = Number(e.target.value); renderArpVals(); sendArp(); scheduleSave(); };
$("arp-oct").onchange = (e) => { perf.arpOct = Number(e.target.value); sendArp(); scheduleSave(); };
$("glide").oninput = (e) => {
  perf.glide = Number(e.target.value);
  renderGlideVal();
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
  a.download = `ricercar-${who}.wav`;
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
            $("hold-btn").setAttribute("aria-pressed", String(hold));
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
// A fresh pair slides in — the vote is a small ritual, not a settings page.
function dealCards() {
  for (const side of ["a", "b"]) {
    const card = $(`duel-${side}`);
    card.classList.remove("deal");
    void card.offsetWidth; // restart the animation
    card.classList.add("deal");
  }
}

// The quick-duel strip on PLAY: vote without leaving the instrument. Labels
// carry the letter AND the name so PICK A / PICK B have an antecedent, and
// names backfill when the bank lands (refreshInstruments re-calls this).
function renderPlayDuel() {
  const strip = $("play-duel");
  if (!currentDuel) {
    strip.classList.add("hidden");
    return;
  }
  strip.classList.remove("hidden");
  // "…" while the bank row hasn't landed — a bare #20 collides with the
  // bank's own numbering and names nothing.
  const nm = (id) => (rowOf(id) ? nameOf(id) : "…");
  $("pd-a").textContent = `▶ A · ${nm(currentDuel[0])}`;
  $("pd-b").textContent = `▶ B · ${nm(currentDuel[1])}`;
}
$("pd-a").onclick = () => selectDuelSide("a");
$("pd-b").onclick = () => selectDuelSide("b");
$("pd-pick-a").onclick = () => choose("a");
$("pd-pick-b").onclick = () => choose("b");
$("pd-skip").onclick = () => {
  currentDuel = null;
  send({ type: "duel" });
};
// Renders are ~0.6 s of engine work each and the worker is one thread, so a
// render requested for a pair the user has already voted past sits at the head
// of the queue and delays the *next* deal behind it. That is what made rapid
// voting feel lossy: the vote itself is instant, the deal is not.
//
// So the artwork is requested only once the pair has survived a moment on
// screen. Vote faster than that and no render is ever enqueued, which is
// exactly right — nobody is looking at it.
let renderWanted = null;
const RENDER_SETTLE_MS = 180;

function requestPairRendersNow() {
  clearTimeout(renderWanted);
  if (!currentDuel) return;
  for (const id of currentDuel) if (!renders.has(id)) send({ type: "render", id });
}

function requestPairRenders() {
  clearTimeout(renderWanted);
  renderWanted = setTimeout(requestPairRendersNow, RENDER_SETTLE_MS);
}

function loadSide(side, id) {
  $(`readout-${side}`).textContent = "…";
  $(`style-${side}`).innerHTML = "";
  clearScope($(`scope-${side}`));
  if (renders.has(id)) onRenderArrived(id);
  else requestPairRenders();
}

function redrawDuelScopes() {
  if (!currentDuel) return;
  onRenderArrived(currentDuel[0]);
  onRenderArrived(currentDuel[1]);
}

function onRenderArrived(id) {
  if (!currentDuel) return;
  const side = id === currentDuel[0] ? "a" : id === currentDuel[1] ? "b" : null;
  if (!side) return;
  const r = renders.get(id);
  // The render may not have arrived yet — switching views calls this
  // speculatively. Missing is normal; throwing here used to abort the rest of
  // `showView`, leaving the scopes unsized at 0×0 until the next duel.
  if (!r) return;
  // The card leads with a name a musician can hold onto and carry back to the
  // bank. The s-expression is engine truth, not a label — it lives under the
  // ⇄ circuit flip, where an expert can still find it.
  $(`name-${side}`).innerHTML =
    `${esc(nameOf(id))}<span class="dn-id">#${id}</span><span class="dn-sig mono">${esc(sigOf(id))}</span>`;
  $(`readout-${side}`).textContent = r.sexpr;
  styleBadge($(`style-${side}`), r.bestStyle);
  drawWave($(`scope-${side}`), r.buffer.getChannelData(0));
}

// Roughly one duel in ten is drawn uniformly at random rather than by the
// acquisition function. Those are the only ones whose accuracy means anything —
// the acquisition rule deliberately serves near-ties, so scoring it on its own
// choices measures the chooser, not the model. Say so on screen.
// How many of the recent duels were uniformly-random probes. Under
// `Acquisition::Random` that is all of them, and a badge that fires every
// time distinguishes nothing — it is only worth saying when the model is
// *usually* choosing and this one time it isn't.
const checkWindow = [];
function checksAreUniversal() {
  return checkWindow.length >= 6 && checkWindow.every(Boolean);
}

// The forecast is the payoff for the vote just cast, and the next pair arrives
// ~15 ms later. Hold it long enough to be read.
let predHoldUntil = 0;
const PRED_HOLD_MS = 3200;

// Lead with the information, not the probability. A surprise is the valuable
// event — it is where the model was wrong and just learned.
function showForecast(pChosen) {
  const el = $("duel-pred");
  if (!el) return;
  el.classList.toggle("hit", pChosen >= 0.65);
  el.classList.toggle("miss", pChosen <= 0.45);
  el.textContent =
    pChosen >= 0.65 ? `Expected — it's getting you. ${Math.round(pChosen * 100)}%`
    : pChosen <= 0.45 ? `⚡ Surprise — it had this backwards. ${Math.round(pChosen * 100)}%`
    : `Toss-up — that one taught it the most. ${Math.round(pChosen * 100)}%`;
  el.title = "The model's forecast, made before your vote. Surprises are where it's still learning.";
  el.classList.remove("check");
  predHoldUntil = performance.now() + PRED_HOLD_MS;
  const pd = $("pd-pred");
  if (pd) {
    pd.textContent = el.textContent;
    pd.className = `pd-pred ${el.classList.contains("hit") ? "hit" : el.classList.contains("miss") ? "miss" : ""}`;
  }
}

function renderCheckBadge() {
  const el = $("duel-pred");
  if (!el) return;
  const check = !!(duelMeta && duelMeta.random_check);
  checkWindow.push(check);
  if (checkWindow.length > 10) checkWindow.shift();
  // Never step on a forecast the user has not had time to read.
  if (performance.now() < predHoldUntil) return;
  el.textContent = "";
  el.classList.remove("hit", "miss");
  // Below ~10 picks the badge is suppressed outright: a brand-new user's
  // first duel captioned "picked at random" reads as "this question is
  // arbitrary". When it does appear, it states its benefit.
  const show = check && !checksAreUniversal() && status.observations >= 10;
  el.classList.toggle("check", show);
  if (show) {
    el.textContent = "unbiased probe — picks like this one score the honesty meter";
    el.title = "About one duel in ten is dealt at random rather than by the acquisition rule. Only those score the model's honesty — see TASTE → trust.";
  }
}

// ---------- the live utility readout ----------
// What the model believes about the patch under your hands, above the rack,
// updated on every edit.
//
// This replaces a WHY line that was fetched once — for the candidate you
// loaded — and then described it through any number of edits, silently. The
// bench re-featurizes on every edit whether or not anyone looks at the result,
// so `θ · φ_std` and its exact per-feature decomposition are a dot product
// away; the stale version was never the cheaper one, only the wrong one.
//
// Two rules make it honest rather than decorative:
//
//  - **The delta is against the last number this readout showed**, not against
//    the loaded candidate. "0.71 (was 0.66) ▲" is a statement about the edit
//    you just made, which is the only thing a player can act on.
//  - **Stale is drawn, not guessed.** An edit in flight means the number on
//    screen describes the tree *before* it. Dimming and saying so is strictly
//    better than showing a wrong number confidently for half a second — this
//    is the objective the player is steering against, and a readout that lies
//    under motion teaches them to ignore it.
// `styleK` is the *aligned lens index* the bench's φ was decomposed under, and
// it is here because the socket prices below have to be quoted under the same
// lens as the number they promise to move. The bank's chips read θ from the
// lens that claims the most of the pool, which is usually but not always this
// one; two numbers from two lenses sitting next to each other is a
// disagreement the player would have no way to see.
const belief = { u: null, sd: 0, prev: null, lens: "", styleK: null, top: [], stale: false, has: false };

/** An edit has gone out; whatever is on screen is about to be untrue. */
function beliefStale() {
  // The audition goes with it, and unconditionally: a preview is a render of
  // "the bench plus this module", so the moment the bench is in motion the
  // buffer on the card is of neither the old patch nor the new one.
  previewInvalidate();
  if (!belief.has || belief.stale) return;
  belief.stale = true;
  renderBelief();
}

function applyBelief(m) {
  const u = m.utility;
  const ex = m.explain;
  if (!u || !u.ok) {
    // No posterior yet (or a bench that failed vetting): say what is missing
    // rather than draw a zero, which reads as "the model hates this".
    belief.has = false;
    belief.stale = false;
    belief.u = null;
    belief.prev = null;
    belief.styleK = null;
  } else {
    // A subject load is a new patch, not a move: it has no "was".
    if (m.subject !== undefined) belief.prev = null;
    else if (belief.has) belief.prev = belief.u;
    belief.u = u.u;
    belief.sd = u.sd;
    belief.lens = u.lens || "";
    belief.styleK = ex && typeof ex.style === "number" ? ex.style : null;
    belief.top = ex && ex.contributions ? ex.contributions.slice(0, 3) : [];
    belief.has = true;
    belief.stale = false;
  }
  renderBelief();
  // The bench moved, so a rendered audition is of a patch that no longer
  // exists and every socket price is quoted against a new baseline.
  previewInvalidate();
}

function renderBelief() {
  const el = $("belief");
  if (!el) return;
  if (!belief.has) {
    el.classList.remove("stale");
    el.innerHTML = wb.subjectId == null
      ? ""
      : `<span class="ex-why">model's guess</span> <span class="bl-none">not yet — it needs a few picks first</span>`;
    return;
  }
  el.classList.toggle("stale", belief.stale);
  // Drawn on the bank's scale, not the model's. The posterior mean is an
  // unbounded log-odds and the bank's bars have always shown `sq()` of it, so
  // a raw 1.43 above the rack would be a *different number for the same claim*
  // sitting a few hundred pixels from the bar it contradicts. The contributions
  // below stay in utility units — they are an exact decomposition of that
  // quantity and squashing them would make them stop summing.
  const u = sq(belief.u);
  const prev = belief.prev == null ? null : sq(belief.prev);
  const d = prev == null ? null : u - prev;
  // 0.005 is half a printed digit: below it the arrow would point at a change
  // the number it sits next to does not show.
  const arrow = d == null || Math.abs(d) < 0.005 ? "" :
    `<span class="bl-arrow ${d > 0 ? "up" : "down"}">${d > 0 ? "▲" : "▼"}</span>`;
  const was = prev == null ? "" :
    `<span class="bl-was">(was ${prev.toFixed(2)})</span>`;
  const parts = belief.top.map((c) => {
    const sign = c.contribution >= 0 ? "+" : "−";
    return `<b class="${c.contribution >= 0 ? "up" : "down"}">${esc(niceName(c.name))}</b> ${sign}${Math.abs(c.contribution).toFixed(2)}`;
  });
  el.innerHTML =
    `<span class="ex-why">model's guess</span> <b class="bl-u">${u.toFixed(2)}</b> ${was}${arrow}` +
    (parts.length ? ` <span class="bl-sep">·</span> ${parts.join(" · ")}` : "") +
    (belief.lens ? ` <span class="ex-lens">under your <b>${esc(belief.lens)}</b> lens</span>` : "") +
    (belief.stale ? ` <span class="bl-stale">· re-measuring…</span>` : "");
  el.title = belief.stale
    ? "An edit is in flight — this describes the patch before it."
    : `The same score the bank's bars draw. Posterior-mean utility ${belief.u.toFixed(2)} ± ${belief.sd.toFixed(2)}; the named features are its exact decomposition, in utility units.`;
}

// ---------- the structural budget ----------
// The ceilings evolution can actually search, drawn from the tree, live.
//
// R2 in the plan, and the highest-severity silent-data-loss risk in it: a
// hand-built patch past MAX_SIZE / MAX_DEPTH / MAX_MOD_DEPTH is refused now
// (`validate_tree`), but a patch *at* them is worse than refused — it is
// accepted, has almost no mass under the prior, and the next ⚡ mutates it back
// inside the ceilings, so the structure disappears on the one action the whole
// instrument is built around. The number has to be visible while there is
// still room to spend.
const BUDGET = { size: 24, depth: 9, mod: 4 };

/** ModNode depth, mirroring `ModNode::depth` exactly — an `Op` wraps its
 *  input, a `Pair` takes the deeper of two, everything else is a leaf. */
function modDepthOf(m) {
  if (!m || m === "None") return 0;
  const tag = nodeTag(m);
  const v = m[tag];
  if (tag === "Op") return 1 + modDepthOf(v && v.input);
  if (tag === "Pair") return 1 + Math.max(modDepthOf(v && v.a), modDepthOf(v && v.b));
  return 1;
}

/** `{size, depth, mod}` of the bench tree, in the engine's own terms: audio
 *  nodes only for size and depth (a modulator is not a module in the ceiling's
 *  sense), deepest modulation term for mod. */
function treeBudget(tree) {
  let size = 0;
  let depth = 0;
  let mod = 0;
  walkTreeKeys(tree, (n, key) => {
    size += 1;
    depth = Math.max(depth, keyIndices(key).length + 1);
    const v = n[nodeTag(n)];
    if (v) mod = Math.max(mod, modDepthOf(v.modulation));
  });
  return { size, depth, mod };
}

function renderBudget() {
  const el = $("budget");
  if (!el) return;
  if (!wb.tree) { el.innerHTML = ""; return; }
  const b = treeBudget(wb.tree);
  const cell = (n, max, label) => {
    // "Tight" one short of the ceiling, not at it: told at the ceiling the
    // player has already spent the room the warning was about.
    const cls = n >= max ? "full" : n >= max - 1 ? "tight" : "";
    return `<span class="bg-cell ${cls}"><b>${n}</b>/${max} ${label}</span>`;
  };
  el.innerHTML =
    cell(b.size, BUDGET.size, "modules") +
    `<span class="bg-sep">·</span>` +
    cell(b.depth, BUDGET.depth, "depth") +
    `<span class="bg-sep">·</span>` +
    cell(b.mod, BUDGET.mod, "mod depth");
}

// Which candidate is sounding, everywhere it can be asked: the EVOLVE cards,
// the PLAY strip buttons (with aria-pressed), the stage header, and the rack
// itself, which visibly stands aside while a candidate is live.
let hearingSide = null;

function setDuelSelection(side) {
  hearingSide = side || null;
  $("duel-a").classList.toggle("live-sel", side === "a");
  $("duel-b").classList.toggle("live-sel", side === "b");
  for (const s of ["a", "b"]) {
    const b = $(`pd-${s}`);
    if (b) {
      b.classList.toggle("live-sel", side === s);
      b.setAttribute("aria-pressed", String(side === s));
    }
  }
  $("play-duel").classList.toggle("auditioning", side != null);
  renderSubject();
}

// Auditioning a candidate is a full context switch, not a side-channel: the
// candidate lands on the bench, so the rack graph, the bank highlight and
// the live keyboard all point at the sound you are hearing.
let benchBeforeAudition = null;

function selectDuelSide(side) {
  if (!currentDuel) return;
  const id = side === "a" ? currentDuel[0] : currentDuel[1];
  if (benchBeforeAudition == null) benchBeforeAudition = wb.subjectId;
  setDuelSelection(side);
  bankScrollTo = id;
  openOnBench(id);
}

$("pd-back").onclick = () => {
  const back = benchBeforeAudition;
  benchBeforeAudition = null;
  setDuelSelection(null);
  if (back != null) {
    bankScrollTo = back;
    openOnBench(back);
  }
};

// Between a vote and the worker's reply the pair on screen is stale. Any click
// landing in that window used to be *silently discarded* — no observation, no
// new duel requested, and the old pair still sitting there looking live. At a
// brisk cadence that lost a quarter of all votes, and the window is widest
// right after the sixth vote (a `fit` is queued ahead of the deal), which is
// exactly when the app has just told the user something interesting and they
// are most likely to click again.
//
// In a system whose entire value is the fidelity of these observations, a lost
// vote is the worst possible bug. So: the controls go inert for the duration,
// and one queued intent is honoured against the *next* pair rather than thrown
// away. Normal deal latency is ~30 ms, so nobody feels the lockout.
let dealing = false;

function setDuelControlsEnabled(on) {
  for (const id of ["choose-a", "choose-b", "skip-duel", "pd-pick-a", "pd-pick-b", "pd-skip"]) {
    const el = $(id);
    if (el) el.disabled = !on;
  }
  $("duel-a").classList.toggle("dealing", !on);
  $("duel-b").classList.toggle("dealing", !on);
}

// One vote at a time may sit behind the undo window — the only irreversible
// action in an app that gives a *cut* seven seconds of grace was the vote.
// The observation is held, not logged-and-compensated: a taste log containing
// "picked it, then unpicked it" records the user's mouse, not their taste.
let pendingVote = null; // { timer, commit, pair }

let ignoreNextDeal = false;

function commitPendingVote() {
  if (!pendingVote) return;
  clearTimeout(pendingVote.timer);
  const v = pendingVote;
  pendingVote = null;
  retireToastUndo(v.toast);
  v.commit();
}

function retractVote() {
  if (!pendingVote) return false;
  clearTimeout(pendingVote.timer);
  const pair = pendingVote.pair;
  pendingVote = null;
  // The next deal was requested at vote time; if it hasn't landed yet it
  // must not overwrite the pair we are restoring.
  if (dealing) ignoreNextDeal = true;
  duelsSinceFit = Math.max(0, duelsSinceFit - 1);
  fitDue = duelsSinceFit >= FIT_EVERY;
  renderTeach();
  // Re-deal the retracted pair so the question is asked again.
  currentDuel = pair;
  dealing = false;
  setDuelControlsEnabled(true);
  setFlip("a", false);
  setFlip("b", false);
  loadSide("a", pair[0]);
  loadSide("b", pair[1]);
  setDuelSelection(null);
  dealCards();
  renderPlayDuel();
  return true;
}

function choose(side) {
  if (dealing) {
    // Deliberately dropped, not queued. A queued click would vote on a pair
    // the user has never seen or heard, which is a worse failure than the one
    // it prevents — and it was unreachable for pointer users in any case,
    // since `dealing` and the `disabled` flag are set in the same synchronous
    // block. The control is visibly inert; that is the whole signal.
    return;
  }
  if (!currentDuel) return;
  // A second vote inside the first one's window commits it — one pending
  // vote at a time keeps the log ordered.
  commitPendingVote();
  benchBeforeAudition = null; // the vote closes the audition detour
  const [a, b] = currentDuel;
  const choseA = side === "a";
  // Acknowledge the vote where it was cast, and show the forecast payoff now
  // — the observation itself waits out the undo window.
  const nameEl = $(`name-${side}`);
  if (nameEl) {
    nameEl.classList.add("chosen");
    setTimeout(() => nameEl.classList.remove("chosen"), 400);
  }
  send({ type: "duel_pred", a, b, choseA });
  const timer = setTimeout(commitPendingVote, UNDO_WINDOW_MS);
  pendingVote = {
    timer,
    pair: [a, b],
    commit: () => send({ type: "record_duel", a, b, choseA }),
  };
  const win = choseA ? a : b;
  const lose = choseA ? b : a;
  pendingVote.toast = note(`Picked ${nameOf(win)} over ${nameOf(lose)}.`, {
    undo: () => retractVote(),
    undoLabel: "not what I meant",
  });
  duelsSinceFit += 1;
  renderTeach();

  // Ask for the next pair BEFORE the refit. The worker is one thread and
  // processes in order, so queueing a ~2.7 s posterior fit ahead of the deal
  // stalls the next duel by that much — measured 17 ms on ordinary votes and
  // 2722 ms on the sixth. That is the vote right after the app has told the
  // user something interesting, i.e. the one they are most likely to follow
  // immediately, so it was precisely the wrong thing to put behind a fit.
  // The pair is chosen against the pre-fit posterior, which is fine: the model
  // already tolerates a posterior that lags its log by up to FIT_EVERY votes.
  currentDuel = null;
  dealing = true;
  setDuelControlsEnabled(false);
  send({ type: "duel" });

  // The refit is *armed* here and enqueued in `settleFit`, once the new pair
  // has actually landed. See that function for why it is not sent from here.
  if (duelsSinceFit >= FIT_EVERY) fitDue = true;
}

// A refit is armed. Two things have to be true before it goes out.
//
// 1. **The engine has to want it.** `status.needs_refit` is the engine's own
//    answer — the importance weights have collapsed since the last fit, or the
//    log holds evidence no posterior has seen. It has been shipped in
//    `status()` all along with nobody reading it, while the app spent 3–13 s on
//    a fixed every-sixth-vote fit whether or not the posterior had gone stale.
//    `FIT_EVERY` stays, but as a *floor*: pacing, so a fast voter is never
//    interrupted more often than every sixth pick. `needs_refit` decides above
//    it. `duelsSinceFit` is therefore reset only when a fit actually goes out,
//    so a skipped one re-arms on the very next vote instead of waiting out
//    another six.
//    An engine too old to report the flag leaves it `undefined`, and only an
//    explicit `false` suppresses the fit — a stale binary must not be able to
//    turn refitting off altogether.
//
// 2. **The pair has to be audible first.** The worker is one thread and
//    processes in order, so a fit queued ahead of the pair's buffers hands the
//    user two cards they cannot hear for the whole fit. The renders jump the
//    settle delay and go in front of it; that delay exists to protect the
//    *next deal* from a render nobody is looking at, which is the opposite
//    situation to this one.
function settleFit() {
  if (!fitDue || fitting) return;
  if (status.needs_refit === false) return;
  fitDue = false;
  duelsSinceFit = 0;
  // A vote still inside its undo window belongs in the log the fit reads.
  // Committing here trades the tail of one undo window for a fit that has
  // actually seen all six picks.
  commitPendingVote();
  requestPairRendersNow();
  fitting = true;
  teachLearned();
  send({ type: "fit" });
}

$("duel-a").addEventListener("click", (e) => {
  if (e.target.closest("button")) return;
  selectDuelSide("a");
});
$("duel-b").addEventListener("click", (e) => {
  if (e.target.closest("button")) return;
  selectDuelSide("b");
});
// Pressing ▶ is an explicit request for the artwork, so it jumps the settle
// delay rather than waiting on it.
function auditionDuelSide(i, btn) {
  if (!currentDuel) return;
  const want = currentDuel[i];
  awaitRender(want, () => play(want, btn), {
    // Voted past it: stop silently, this is not a failure.
    abandoned: () => !currentDuel || currentDuel[i] !== want,
  });
}
$("play-a").onclick = () => auditionDuelSide(0, $("play-a"));
$("play-b").onclick = () => auditionDuelSide(1, $("play-b"));
$("choose-a").onclick = () => choose("a");
$("choose-b").onclick = () => choose("b");
$("skip-duel").onclick = () => {
  currentDuel = null;
  send({ type: "duel" });
};
$("evolve-btn").onclick = () => {
  $("evolve-btn").disabled = true;
  $("wm-r").classList.add("thinking");
  note("breeding a generation toward your taste…");
  send({ type: "refine" });
};

// ---------- patch bank ----------
let bankScrollTo = null;

// The three banks the chips switch between.
//
//   pool    — the live candidate pool: what evolution breeds from, what the
//             model reasons over, and the only one of the three that evicts.
//   mine    — patches the user saved. Engine-side `pinned`, so saving is what
//             actually exempts a patch from eviction rather than a label that
//             says it does.
//   preset  — the built-in library. Not pool members at all until you load
//             one, which is why this list is built from `presetRows`.
//
// One list, three sources. The old surface had five provenance filters plus a
// four-option sort menu overlapping them, and could not answer "where are my
// sounds?" at all, because the answer was "nowhere, they get evicted".
const BANKS = ["pool", "mine", "preset"];

// The save control, drawn rather than typed.
//
// It shipped for one round as `▣`, borrowed from the rack's module lock:
// internally consistent, and the first person to look at it asked what the
// little square was. A floppy disk is the one save affordance everybody
// already knows — but the *monochrome* floppy codepoints (U+1F5AA/AB/AC)
// measure exactly as wide as an unassigned codepoint here, i.e. they are tofu
// in every font on the machine, and the one that does render (U+1F4BE) is a
// colour emoji, which would make it the only non-phosphor colour on the
// surface. So it is an inline SVG in `currentColor`: the familiar shape, no
// font dependency, and it obeys the palette like everything else.
const FLOPPY =
  `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">` +
  `<path d="M2.6 2.2h8L13.4 5v8.2a1.2 1.2 0 0 1-1.2 1.2H3.8a1.2 1.2 0 0 1-1.2-1.2V3.4a1.2 1.2 0 0 1 1.2-1.2z"` +
  ` fill="none" stroke="currentColor" stroke-width="1.3"/>` +
  `<rect class="fl-shutter" x="5.4" y="2.2" width="4.6" height="3.9" fill="currentColor"/>` +
  `<rect class="fl-label" x="4.6" y="8.6" width="6.8" height="5.8" fill="none" stroke="currentColor" stroke-width="1.2"/>` +
  `</svg>`;

const ORIGIN_GLYPH = { prior: "◇", refined: "⚡", edited: "✎", preset: "▤" };
const ORIGIN_TITLE = {
  prior: "◇ dealt fresh from the grammar — nobody's taste in it yet",
  refined: "⚡ bred by evolution toward your taste",
  edited: "✎ committed from your bench edits",
  preset: "▤ hand-made preset",
};

// Absolute scale, not min–max across the visible bank: the old normalisation
// made the worst patch always read 0% and the best always 100%, so the widget
// could never say "it likes none of these". The logistic of the posterior mean
// is a fixed, monotone map.
const sq = (u) => 1 / (1 + Math.exp(-u));

function bankSource() {
  const ranked = (views && views.ranked) || [];
  const live = ranked.filter((r) => !cutIds.has(r.id));
  if (bankFilter === "mine") return live.filter((r) => r.pinned);
  if (bankFilter === "preset") return presetRows || [];
  return live;
}

// Counts on the chips themselves: the cheapest way to say what is in a place
// you are not currently looking at.
function renderBankCounts() {
  const ranked = (views && views.ranked) || [];
  const live = ranked.filter((r) => !cutIds.has(r.id));
  const n = {
    pool: live.length,
    mine: live.filter((r) => r.pinned).length,
    preset: (presetRows || []).length,
  };
  for (const el of document.querySelectorAll(".bf-n")) {
    el.textContent = n[el.dataset.n] != null ? String(n[el.dataset.n]) : "";
  }
}

function renderPinBudget() {
  const el = $("pin-budget");
  if (!el) return;
  const [used, cap] = pinBudget;
  // Shown from the moment the cap is known, including at zero: releasing your
  // last save used to delete the readout, so the one number that says how much
  // room you have left disappeared exactly when it changed.
  el.hidden = !cap;
  el.textContent = cap ? `${used}/${cap} saved` : "";
  el.title = `${used} of ${cap} save slots used. A saved patch is never replaced to make room.`;
}

function renderBank() {
  // Never rebuild the list out from under a rename.
  //
  // `renderBank` fires on every knob edit, rating, worker view and bred
  // generation. Each rebuild detaches the open `<input>`, and Chromium fires
  // `blur` on removal — so an edit the user was still typing got committed by
  // something they did somewhere else entirely. Guarding the *commit* is not
  // enough (a click on another row is a real blur and must still commit); the
  // fix is that a rename in flight owns the list until it ends.
  if (renamingId != null) {
    bankRenderPending = true;
    return;
  }
  bankRenderPending = false;
  const list = $("bank-list");
  renderFillHint(); // owns the header count; it also carries "N arriving"
  renderBankCounts();
  renderPinBudget();
  renderBankNote();

  if (bankFilter === "preset") {
    // Presets are not pool members, so they carry no id and nothing may rate
    // or save them — but they are still 29 rows in a focusable `listbox`, and
    // leaving `bankRows` empty made the entire keyboard fall through to the
    // synth: arrowing did nothing *and* the keystroke played a note.
    // `presetCursor` gives them their own navigation.
    bankRows = [];
    renderPresetBank(list);
    syncBankCursor();
    return;
  }

  const rows = bankSource();
  bankRows = rows; // assigned before ANY return: [ ] and 1–5 step THIS list
  list.innerHTML = "";
  if (rows.length === 0) {
    // An empty state names the one thing to do next. It is never where a
    // known limitation gets confessed — the old `saved` copy spent its whole
    // budget apologising that stars did not protect anything.
    const msg = {
      mine:
        "Nothing saved yet. Press <b>save</b> on any patch to keep it here — a saved patch is never replaced to make room.",
      pool: "The pool is empty. Load a preset, or press EVOLVE POOL to fill it again.",
    }[bankFilter] || "Nothing here yet.";
    list.innerHTML = `<div class="bench-empty">${msg}</div>`;
    return;
  }

  const fitted = !!(views && views.styles);
  const frag = document.createDocumentFragment();
  for (const r of rows) frag.appendChild(bankRow(r, fitted));
  list.innerHTML = "";
  list.appendChild(frag);
  syncBankCursor();
  if (bankScrollTo != null) {
    const target = list.querySelector(".bank-item.live");
    if (target) target.scrollIntoView({ block: "nearest", behavior: "smooth" });
    bankScrollTo = null;
  }
}

function bankRow(r, fitted) {
  const el = document.createElement("div");
  el.className = "bank-item"
    + (r.id === wb.subjectId ? " live" : "")
    // The keyboard cursor is state, so it is carried by *id* and re-applied
    // on every render. It used to live only on the DOM node, and rating a
    // row re-renders the bank — so the highlight vanished the instant you
    // used it, and the next digit fell through to the index-0 fallback and
    // rated a patch nobody had selected. See `kbdRowId`.
    + (r.id === kbdRowId ? " kbd" : "")
    + (r.pinned ? " saved" : "")
    + (lastBorn.has(r.id) ? " fresh" : "");
  const frac = fitted ? sq(r.mean) : 0;
  const lo = fitted ? sq(r.mean - (r.std || 0)) : 0;
  const hi = fitted ? sq(r.mean + (r.std || 0)) : 0;
  const stars = starsById.get(r.id) || 0;
  const sig = r.sig || r.signature || "";
  el.id = `bank-row-${r.id}`; // aria-activedescendant needs something to point at
  el.setAttribute("role", "option");
  el.setAttribute("aria-selected", "false");
  // The list is one tab stop. Without pulling the rows *and their buttons*
  // out of the tab order, the ARIA says listbox while the tab order says
  // 280 individually-focusable buttons — and the rack sits behind all of
  // them. The trade is that a screen reader gets no path to the buttons, so
  // the row's own label has to carry the state they encode.
  el.tabIndex = -1;
  const said = [
    r.name,
    `patch ${r.id}`,
    sig,
    r.pinned ? "saved" : "",
    stars ? `${stars} of 5 stars` : "unrated",
    fitted ? `predicted ${Math.round(frac * 100)} percent` : "",
  ].filter(Boolean);
  // setAttribute takes a string, not markup — no escaping here, and escaping
  // would put a literal `&amp;` into what a screen reader says.
  el.setAttribute("aria-label", said.join(", "));
  el.innerHTML = `
    <div class="bi-top">
      <span class="bi-origin ${r.origin}" title="${ORIGIN_TITLE[r.origin] || r.origin}">${ORIGIN_GLYPH[r.origin] || ""}</span>
      <span class="bi-name ${r.named ? "custom" : ""}" title="${sig ? `${esc(sig)} — ` : ""}double-click to rename">${esc(r.name)}</span>
      <span class="bi-pct mono" title="${fitted ? "How much the model thinks you'd like this" : "No prediction yet — teach it with a few picks"}">${fitted ? `${Math.round(frac * 100)}%` : "—"}</span>
      <span class="bi-id">#${r.id}</span>
    </div>
    <div class="bi-row">
      <button class="bi-hear" title="Hear this patch" aria-label="Audition ${esc(r.name)}">▶</button>
      <span class="stars" role="group" aria-label="Rate ${esc(r.name)}">
      ${[1, 2, 3, 4, 5]
        .map((s) => `<button class="star ${stars >= s ? "lit" : ""}" data-s="${s}" aria-pressed="${stars >= s}" aria-label="${s} star${s > 1 ? "s" : ""}" title="${s}★ — teaches the model, ${s > 3 ? "does not" : "does not"} keep the patch">★</button>`)
        .join("")}
      </span>
      <button class="bi-save${r.pinned ? " on" : ""}" aria-pressed="${!!r.pinned}"
        title="${r.pinned ? "Saved — this patch is never replaced to make room. Click to release it." : "Save this patch. Saved patches are never replaced to make room."}"
        aria-label="${r.pinned ? "Release" : "Save"} ${esc(r.name)}">${FLOPPY}</button>
      <button class="bi-kill" title="Cut: teach the model you don't want this" aria-label="Cut ${esc(r.name)}">cut</button>
    </div>
    <span class="bi-u${fitted ? "" : " nofit"}" title="${fitted ? "The model's guess, and the block is how sure it is" : "No prediction yet"}">${
      fitted
        ? `<b style="left:${(lo * 100).toFixed(1)}%;width:${Math.max(1.5, (hi - lo) * 100).toFixed(1)}%"></b><i style="left:${(frac * 100).toFixed(1)}%"></i>`
        : ""
    }</span>`;
  el.addEventListener("click", (e) => {
    if (e.target.closest("button")) return;
    kbdRowId = r.id;
    openOnBench(r.id);
    showView("play");
  });
  el.querySelector(".bi-hear").onclick = () => awaitRender(r.id, () => play(r.id));
  el.querySelectorAll(".star").forEach((btn) => {
    btn.onclick = () => {
      // The row you just rated is the one a follow-up 1–5 should correct,
      // whichever hand you rated it with.
      kbdRowId = r.id;
      rateRow(Number(btn.dataset.s), r.id);
    };
  });
  el.querySelector(".bi-save").onclick = () => {
    kbdRowId = r.id;
    // Optimism here would be a lie half the time: the engine refuses at the
    // budget, and it owns the count. Ask, then render what it says.
    send({ type: "set_pinned", id: r.id, pinned: !r.pinned });
  };
  el.querySelector(".bi-kill").onclick = () => cutRow(r);
  wireRename(el.querySelector(".bi-name"), r);
  el.querySelectorAll("button").forEach((b) => { b.tabIndex = -1; });
  return el;
}

// Undo, not confirm. A confirm dialog trains people to click through it; an
// undo window costs nothing and actually protects the work.
//
// The observation is *held* for the length of the undo window rather than
// logged and compensated — a taste log that contains "killed it, then kept
// it" for the same patch is a log of the user's mouse, not of their taste.
function cutRow(r) {
  // Cutting something you saved is a contradiction, and the old behaviour
  // resolved it in the worst way: the row vanished from every bank while the
  // engine went on holding its save slot, so the budget was permanently short
  // and the only control that could release it was unreachable. The cut is
  // what the user just said, so the save yields to it.
  if (r.pinned) send({ type: "set_pinned", id: r.id, pinned: false });
  cutIds.add(r.id);
  renderBank();
  scheduleSave(); // `cut` used to skip this, so a reload could resurrect it
  const commit = setTimeout(() => {
    pendingCuts.delete(r.id);
    send({ type: "record_keep", id: r.id, kept: false });
  }, UNDO_WINDOW_MS);
  pendingCuts.set(r.id, commit);
  note(`Cut ${r.name} #${r.id}.`, {
    undo: () => {
      clearTimeout(pendingCuts.get(r.id));
      pendingCuts.delete(r.id);
      cutIds.delete(r.id);
      renderBank();
      scheduleSave();
    },
  });
}

function wireRename(nameEl, r) {
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
    renamingId = r.id;
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      renamingId = null;
      // Commit only if the field is still in the document. Chromium fires
      // `blur` when a node is *removed*, so any unrelated `renderBank()` — and
      // one fires on every knob edit, every rating, every worker view — landed
      // here and saved whatever half-typed text was in the box. Other engines
      // discard instead, which made it browser-dependent rather than merely
      // wrong. A field the user is still looking at is connected; one the
      // renderer just tore out from under them is not.
      if (commit) send({ type: "set_name", id: r.id, name: input.value });
      if (bankRenderPending) renderBank(); // whatever we held off, run it now
    };
    input.onkeydown = (ke) => {
      ke.stopPropagation(); // typing must not play notes
      if (ke.key === "Enter") { finish(true); input.blur(); }
      if (ke.key === "Escape") { finish(false); renderBank(); }
    };
    input.onkeyup = (ke) => ke.stopPropagation();
    input.onblur = () => finish(true);
  };
}

// The preset library, grouped by family.
//
// It used to live behind its own button in a popover: a flat list of nine
// names with no ▶, where clicking committed the patch to the bank, evicted
// something silently and yanked you to the bench. Two places for one concept,
// and the only one that could audition was the first-run screen. Now it is
// simply one of the three banks, and the row behaves like every other row.
function renderPresetBank(list) {
  list.innerHTML = "";
  if (!presetRows) {
    list.innerHTML = `<div class="bench-empty">Loading the library…</div>`;
    send({ type: "presets" });
    return;
  }
  const frag = document.createDocumentFragment();
  let lastCat = null;
  for (const p of presetRows) {
    if (p.category !== lastCat) {
      lastCat = p.category;
      const h = document.createElement("div");
      h.className = "pb-cat";
      h.textContent = p.category;
      frag.appendChild(h);
    }
    const loadedId = presetIds.get(p.index);
    const inBank = loadedId != null && !!rowOf(loadedId);
    const el = document.createElement("div");
    el.className = "bank-item preset-item" + (inBank ? " in-bank" : "");
    el.setAttribute("role", "option");
    el.setAttribute("aria-selected", "false");
    el.tabIndex = -1;
    el.setAttribute("aria-label", `${p.name}, ${p.category}. ${p.blurb}.${inBank ? " In your bank." : ""}`);
    el.innerHTML = `
      <div class="bi-top">
        <span class="bi-origin preset" title="▤ hand-made preset">▤</span>
        <span class="bi-name">${esc(p.name)}</span>
        ${inBank ? `<span class="pb-in" title="Already in your bank">in bank</span>` : ""}
      </div>
      <div class="pb-blurb">${esc(p.blurb)}</div>
      <div class="bi-row">
        <button class="bi-hear" aria-label="Hear ${esc(p.name)}"
          title="Hear it. Hearing a preset loads it into the pool — the engine can only render what it holds.">▶</button>
        <span class="pb-sig mono">${esc(p.sig)}</span>
      </div>`;
    const hear = el.querySelector(".bi-hear");
    hear.onclick = () => previewPreset(p, hear);
    el.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      if (inBank) { openOnBench(loadedId); showView("play"); }
      else send({ type: "load_preset", index: p.index });
    });
    el.querySelectorAll("button").forEach((b) => { b.tabIndex = -1; });
    frag.appendChild(el);
  }
  list.appendChild(frag);
}

// The bank is one tab stop, not 280. Before this, reaching the rack from the
// menubar took ~287 Tab presses through unlabelled star buttons.
let bankFilter = "pool";
let bankRows = []; // the rows the rail currently shows
let pinBudget = [0, 0]; // [used, cap], owned by the engine and echoed here
let renamingId = null; // a rename in flight; see `syncBankCursor`
let presetCursor = -1;  // the preset bank's own row cursor (presets have no id)
let bankRenderPending = false; // a render deferred while a rename is open
const lastBorn = new Set(); // ids born in the latest bred generation

function selectBank(which) {
  if (!BANKS.includes(which)) return;
  bankFilter = which;
  document.querySelectorAll(".bank-filters .bf").forEach((x) => {
    const on = x.dataset.f === which;
    x.classList.toggle("active", on);
    x.setAttribute("aria-pressed", String(on));
  });
  // Presets are fetched once, lazily — the library is static, so the only
  // reason to ask twice is a reload.
  if (which === "preset" && !presetRows) send({ type: "presets" });
  renderBank();
  // Not while restoring: the restore path calls this *before* `init`, and a
  // save that reaches the worker before the engine exists throws inside it.
  if (!restoreInFlight) scheduleSave();
}
document.querySelectorAll(".bank-filters .bf").forEach((b) => {
  b.setAttribute("aria-pressed", String(b.classList.contains("active")));
  b.onclick = () => selectBank(b.dataset.f);
});

// Which row the keyboard is pointing at, by id rather than by DOM position.
// A rating re-renders the bank, and an index into a list that was just
// rebuilt is a different patch.
let kbdRowId = null;

// Tell assistive tech where the cursor is.
//
// The list has always claimed `role="listbox"` while announcing nothing as you
// arrowed through it: there was no `aria-activedescendant`, rows had no `id`,
// and `aria-selected` tracked the *bench* rather than the cursor. So the
// highlight moved and a screen reader stayed silent.
function syncBankCursor() {
  const list = $("bank-list");
  if (renamingId != null) return; // a rename owns the focus; leave it alone
  // A cursor pointing at a row this bank does not contain is worse than no
  // cursor: `aria-activedescendant` naming a deleted element is a dangling
  // reference, and switching to the preset bank used to leave one behind.
  const row = kbdRowId != null ? document.getElementById(`bank-row-${kbdRowId}`) : null;
  for (const el of list.querySelectorAll(".bank-item[aria-selected='true']")) {
    el.setAttribute("aria-selected", "false");
  }
  if (row) {
    row.setAttribute("aria-selected", "true");
    list.setAttribute("aria-activedescendant", row.id);
  } else {
    list.removeAttribute("aria-activedescendant");
  }
}

function moveKbdRow(d) {
  if (bankRows.length === 0) return;
  const cur = bankRows.findIndex((r) => r.id === kbdRowId);
  const next = Math.max(0, Math.min(bankRows.length - 1, (cur < 0 ? 0 : cur) + d));
  kbdRowId = bankRows[next].id;
  renderBank();
  $("bank-list").querySelector(".bank-item.kbd")?.scrollIntoView({ block: "nearest" });
}

// The preset bank's keyboard. Presets carry a library `index`, not a bank id,
// so they cannot share the pool's cursor — but they are rows in a listbox and
// have to answer arrows, Enter and Escape like any other list. Anything this
// does not handle is swallowed rather than passed on: a listbox that plays a
// note when you press a letter is not a listbox.
function presetKeydown(e) {
  const rows = [...$("bank-list").querySelectorAll(".preset-item")];
  if (rows.length === 0) return;
  const move = (d) => {
    presetCursor = Math.max(0, Math.min(rows.length - 1, presetCursor < 0 ? 0 : presetCursor + d));
    rows.forEach((el, i) => el.classList.toggle("kbd", i === presetCursor));
    const el = rows[presetCursor];
    el.scrollIntoView({ block: "nearest" });
    $("bank-list").setAttribute("aria-activedescendant", el.id);
    rows.forEach((x) => x.setAttribute("aria-selected", String(x === el)));
  };
  if (e.key === "ArrowDown") { e.preventDefault(); move(presetCursor < 0 ? 0 : 1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
  else if (e.key === "Home") { e.preventDefault(); presetCursor = 0; move(0); }
  else if (e.key === "End") { e.preventDefault(); presetCursor = rows.length - 1; move(0); }
  else if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    rows[Math.max(0, presetCursor)]?.click();
  } else if (e.key.toLowerCase() === "p") {
    e.preventDefault();
    rows[Math.max(0, presetCursor)]?.querySelector(".bi-hear")?.click();
  }
}

// Save (or release) whatever row the bank is pointing at. Shared by the row
// button, the bank list's own key handler and the global one, so all three
// mean exactly the same thing.
function saveCursorRow() {
  const id = rateTargetId();
  if (id == null) {
    note("Nothing selected to save — click a bank row, or step to one with [ and ].");
    return false;
  }
  send({ type: "set_pinned", id, pinned: !(rowOf(id) || {}).pinned });
  return true;
}

// What a digit rates. The keyboard cursor if there is one; otherwise the
// patch on the bench, which is the row the app is already drawing as `live`
// and the only other row the user can be said to have chosen. Never an index
// — the old fallback was `bankRows[0]`, so a second rating after the
// highlight was lost silently landed on whatever happened to be at the top of
// the list and taught the model a preference nobody expressed.
function rateTargetId() {
  if (kbdRowId != null && bankRows.some((r) => r.id === kbdRowId)) return kbdRowId;
  if (wb.subjectId != null && bankRows.some((r) => r.id === wb.subjectId)) return wb.subjectId;
  return null;
}

function rateRow(rating, explicitId) {
  const id = explicitId != null ? explicitId : rateTargetId();
  if (id == null) {
    note("Nothing selected to rate — click a bank row, or step to one with [ and ].");
    return;
  }
  // Re-asserting a rating is not new evidence — logging it again would weight
  // one opinion twice. But returning in silence made a lit star a dead button,
  // so say what the state already is.
  if ((starsById.get(id) || 0) === rating) {
    note(`${nameOf(id)} is already ${rating}★ — pick a different number to change it.`);
    return;
  }
  kbdRowId = id; // rating something makes it the cursor, so 1-5 can correct it
  starsById.set(id, rating);
  send({ type: "record_stars", id, rating });
  renderBank();
  note(`${nameOf(id)} rated ${rating}★`);
}

$("bank-list").addEventListener("keydown", (e) => {
  if (bankFilter === "preset") return presetKeydown(e);
  if (bankRows.length === 0) return;
  if (e.key === "ArrowDown") { e.preventDefault(); moveKbdRow(kbdRowId == null ? 0 : 1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); moveKbdRow(-1); }
  else if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    const id = kbdRowId ?? bankRows[0].id;
    bankScrollTo = id;
    openOnBench(id);
  } else if (e.key.toLowerCase() === "m") {
    // Save from the keyboard, since the row's buttons are deliberately out of
    // the tab order and a screen-reader user would otherwise have no path to
    // the one control that protects their work.
    //
    // `m` for "my patches", and — the actual constraint — `m` is one of the
    // few letters the Ableton note layout leaves free. `s` would have been the
    // obvious mnemonic and is a note: the global handler deliberately lets note
    // letters through even when a control has focus, so binding it here would
    // have both saved the patch and played a D, and silently cost a player one
    // key of their keyboard whenever the bank had focus.
    e.preventDefault();
    e.stopPropagation();
    saveCursorRow();
  } else if (/^[1-5]$/.test(e.key)) {
    e.preventDefault();
    e.stopPropagation(); // digit keys are evolve-view shortcuts elsewhere
    rateRow(Number(e.key));
  }
});


// ---------- the three banks, explained ----------
//
// Splitting one list into three named banks only helps if the names mean
// something, and two of them are load-bearing jargon: *pool* and *generation*.
// Nothing on screen ever said what a generation was, what EVOLVE POOL does to
// the bank, or why a patch you liked could disappear. That is the single
// hardest idea in the product and it was left entirely implicit.
//
// Two surfaces carry it. A one-line note under the chips, always there, saying
// what you are looking at. And a walkthrough that steps through all three,
// switching banks as it goes — reading about the pool while looking at the
// presets teaches nobody anything.

// One line each. The depth lives in the walkthrough; this is a label, and at
// three lines it was costing more of the rail than it was worth.
const BANK_NOTES = {
  pool: `Every patch the model is weighing.`,
  mine: `Never replaced — but still in the pool, still being learned from.`,
  preset: `Hand-made. <b>▶</b> loads one into the pool.`,
};

function renderBankNote() {
  const el = $("bank-note");
  if (!el) return;
  el.innerHTML = `${BANK_NOTES[bankFilter] || ""} <button class="note-more" id="bank-note-more">what's this?</button>`;
  const more = $("bank-note-more");
  if (more) more.onclick = () => startBankTour(BANKS.indexOf(bankFilter));
}

const PRESET_COUNT_TOKEN = "%PRESETS%";
const PIN_CAP_TOKEN = "%CAP%";

// Each step names the bank it is about, so the tour can drive the chips.
const TOUR = [
  {
    bank: "preset",
    title: "presets — where you start",
    body:
      `${PRESET_COUNT_TOKEN} hand-made patches that shipped with the instrument. ` +
      `They never change and they are never lost. Press <b>▶</b> to hear one — ` +
      `that also loads it into the pool, because the engine can only play what it holds.`,
  },
  {
    bank: "pool",
    title: "evolution — the living bank",
    body:
      `The pool holds a fixed number of patches. The model scores every one of ` +
      `them for how much it thinks <i>you</i> would like it — that is the bar and ` +
      `the % on each row. Rating with ★ and cutting with ✕ is how it learns.`,
  },
  {
    bank: "pool",
    title: "what a generation is",
    body:
      `Press <b>EVOLVE POOL</b> and it breeds: it takes the patches it thinks you ` +
      `like best and makes mutated children of them. Children that score better ` +
      `than the worst patch in the pool get in. That round is a <b>generation</b>. ` +
      `The ⚡ glyph marks every patch evolution has bred — the newest ones glow.`,
  },
  {
    bank: "pool",
    title: "…and what it costs",
    body:
      `The pool is a fixed size, so every child that gets in <b>replaces</b> the ` +
      `patch the model rates lowest. That is deliberate — the pool is the model's ` +
      `working set, not a hard drive. But it means a sound you loved can be bred ` +
      `away before the model has learned why you loved it.`,
  },
  {
    bank: "mine",
    title: "my patches — how you keep one",
    body:
      `Press <b>save</b> on any row. A saved patch is <b>never</b> replaced, ` +
      `however many generations you run. It stays in the pool — still played, ` +
      `still duelled, still teaching the model — it just cannot be bred away. ` +
      `You get ${PIN_CAP_TOKEN} slots: enough to keep what matters, few enough that the ` +
      `pool still has room to evolve. ` +
      `<br><br>★ and <b>save</b> are different questions: stars tell the model what you ` +
      `think of a patch, saving tells the bank what to hold on to.`,
  },
];


let tourAt = -1;

function tourText(s) {
  return s
    // No invented fallbacks: the old ones said "Two dozen" and "12" while the
    // library held 29 and the cap was 10. A number on screen is a claim.
    .replace(PRESET_COUNT_TOKEN, String((presetRows || []).length || "The"))
    .replace(PIN_CAP_TOKEN, pinBudget[1] ? String(pinBudget[1]) : "a fixed number of");
}

function startBankTour(from = 0) {
  tourAt = Math.max(0, from);
  showTourStep();
}

function showTourStep() {
  const el = $("bank-tour");
  if (tourAt < 0 || tourAt >= TOUR.length) return endBankTour();
  const step = TOUR[tourAt];
  selectBank(step.bank);
  // Highlight the chip this step is about — the tour is a pointer, not a
  // pamphlet.
  document.querySelectorAll(".bank-filters .bf").forEach((b) => {
    b.classList.toggle("tour-lit", b.dataset.f === step.bank);
  });
  $("tour-step").textContent = `${tourAt + 1} / ${TOUR.length}`;
  $("tour-title").textContent = step.title;
  $("tour-body").innerHTML = tourText(step.body);
  $("tour-back").disabled = tourAt === 0;
  $("tour-next").textContent = tourAt === TOUR.length - 1 ? "got it" : "next";
  el.classList.remove("hidden");
  $("tour-next").focus();
}

function endBankTour() {
  tourAt = -1;
  $("bank-tour").classList.add("hidden");
  document.querySelectorAll(".bank-filters .bf").forEach((b) => b.classList.remove("tour-lit"));
  localStorage.setItem("ricercar-bank-toured", "1");
}

$("bank-tour-btn").onclick = () => (tourAt >= 0 ? endBankTour() : startBankTour(0));
$("tour-next").onclick = () => { tourAt += 1; showTourStep(); };
$("tour-back").onclick = () => { tourAt -= 1; showTourStep(); };
$("tour-skip").onclick = endBankTour;

// The one moment the eviction rule stops being trivia: the first time a
// generation actually lands. Offer the explanation then rather than at boot,
// where it would be one more thing to dismiss before making a sound.
function offerBankTourAfterFirstGeneration() {
  if (localStorage.getItem("ricercar-bank-toured")) return;
  localStorage.setItem("ricercar-bank-toured", "1");
  // `note` takes `undo`/`undoLabel`, not `label`/`run` — that is `alarm`'s
  // shape. Passing the wrong one rendered a bare toast with no button, so the
  // single designed entry point to the walkthrough was consumed silently and
  // never offered again. The action here is not an undo, but the toast's one
  // action slot is what it is; the label carries the meaning.
  note("The bank just bred a generation — some patches were replaced.", {
    undoLabel: "what happened?",
    undo: () => startBankTour(2),
  });
}

// ---------- presets ----------
// The library itself lives in the bank list now (see `renderPresetBank`).
// What stays here is the *loading* protocol, which is subtler than it looks.
let presetRows = null;

document.addEventListener("click", (e) => {
  // …but not the click that a long-press produces on its way up, which lands
  // on the very plate the menu was just opened for.
  if (!e.target.closest(".ctx-menu") && !e.target.closest(".mod-menu-btn") &&
      Date.now() - menuOpenedAt > 350) {
    closeMenu();
  }
  // One dismissal law for every popover: a click that is not inside it closes
  // it. The ovf button used to stopPropagation, which kept THIS handler from
  // ever seeing the click — so opening one popover left the other one up.
  if (!e.target.closest(".ovf")) {
    $("ovf-menu").classList.add("hidden");
    $("ovf-btn").setAttribute("aria-expanded", "false");
  }
});

// ---------- workbench ----------
function openOnBench(id) {
  // No separate `explain` request any more: the bench reply carries the
  // decomposition of the tree it is describing, so the readout can never name
  // a patch other than the one on screen. See `renderBelief`.
  send({ type: "edit_begin", id });
}

// The categorical sites that reach the running voices without a recompile.
//
// `isIndex` used to be a synonym for "not live", because it was: every enum
// selected a quiver output port at compile time. Two of them never did.
// `table` is a *crossfade position* on the wavetable's stack — the port's own
// comment in compile.rs says so — and `oct` is a V/Oct offset that was already
// being summed as CV into the pitch node every other modulation lands on.
// Both were baked constants for no reason but the assumption in this line, and
// both cost a fade-out, a per-quantum voice rebuild and a re-attack of every
// held note to move a number that is one addition on a wire.
//
// The rest of the enums (`wave`, `fkind`, `dmode`, `rmode`) stay non-live and
// must: they choose a port at compile time, so making them live means a
// crossfading selector network, which changes the rendered signal for every
// existing patch and invalidates the bank's featurisation and the taste
// posterior. That needs a measured evolution revalidation, not this stage.
const LIVE_INDEX_SITES = new Set(["table", "oct"]);

function sendEdit(addr, value, isIndex) {
  // Sound first: continuous knobs — and the two live categorical sites —
  // write straight into the running voices.
  const liveIndex = isIndex && LIVE_INDEX_SITES.has(addr.split("#").pop());
  if (isIndex && !liveIndex) nonLiveAddrs.add(addr);
  else if (live) live.param(addr, value);
  // The readout above the rack describes the tree before this write until the
  // bench answers with the new φ. Say so rather than leave a stale number
  // looking current.
  beliefStale();
  pendingEditTag = { op: "param", addr };
  // Genome second: the worker validates, re-renders the phrase, updates φ.
  if (editInFlight) {
    editQueue = { addr, value, isIndex };
    return;
  }
  editInFlight = true;
  send({ type: "edit_param", addr, value, isIndex });
}

function playBench() {
  if (wb.buffer) {
    markHeard();
    playBuffer(wb.buffer, $("rack-play"));
  } else if (!wb.vetOk) note("⚠ unvetted state — audio withheld");
}

// Layout constants.
// Sized around the rack type tokens in style.css: the plate has to fit a
// 10px knob label and a 9px unit readout at zoom 1, not just at zoom 2.
//
// Width is content-driven now, the way height already was. Every plate being
// 168 units wide meant a one-knob drive wore the same faceplate as a
// four-knob filter: half of the rack was empty plate, an eight-module chain
// overflowed a 1700px frame for no reason, and the panel read as a flowchart
// rather than as gear — real racks have a wide/narrow HP rhythm you can see
// from across the room. Three steps, because two is not a rhythm and four is
// noise at this plate count.
const PLATE_W = [96, 168, 240];
// Knobs per row, indexed the same as PLATE_W: the pitch stays ~56-80 units at
// every step, which is what the 10px silkscreen label was measured against.
const PLATE_COLS = [1, 2, 3];
const KNOB_R = 15;

// Row pitch has to clear the knob's tick ring plus its label and its unit
// readout — the readout grew from "0.41" to "24 ms".
const KNOB_ROW = 64;

// One gutter serves two jobs: the horizontal space between layers, and the
// vertical clearance a branch input departs the spine by. Keeping them the
// same number is what makes the arrangement read as a grid rather than as two
// unrelated spacings that happen to be near each other.
const GUTTER = 28;
// Two plates stacked inside one layer.
const STACK_GAP = 16;

// An enum chip is a 62-unit plate, not a 30-unit knob, so it costs two slots.
// Without that a vco's `wave` and `octave` chips sat on a 56-unit pitch and
// overlapped by 6 units on every single patch — the collision the SILK
// abbreviation table was papering over one label at a time.
function plateStep(mod) {
  const slots =
    mod.knobs.length + mod.knobs.filter((k) => k.kind.t !== "continuous").length;
  const step = slots <= 1 ? 0 : slots <= 4 ? 1 : 2;
  // A binary node's two input labels are content too: `carrier` and `mod`
  // printed inside a 96-unit plate land on top of the one knob it has. Two
  // named sockets buy a step, the same way a chip does.
  return MOD_BY_KIND[mod.kind]?.ins === 2 ? Math.max(1, step) : step;
}

/** Plate geometry for one module: width, height, and its knob grid. */
function moduleBox(mod) {
  const step = plateStep(mod);
  const perRow = PLATE_COLS[step];
  const rows = Math.max(1, Math.ceil(mod.knobs.length / perRow));
  return { w: PLATE_W[step], h: 36 + rows * KNOB_ROW, perRow };
}

// Knob pitch for the row `i` lands in — a short last row centres itself, so a
// four-knob module on a three-wide plate puts its orphan knob in the middle
// instead of hard against the left edge.
function knobPitch(mod, i, box) {
  const row = Math.floor(i / box.perRow);
  const inRow = Math.min(box.perRow, mod.knobs.length - row * box.perRow);
  return box.w / (inRow + 1);
}

function knobPos(mod, i, box) {
  const row = Math.floor(i / box.perRow);
  return {
    x: knobPitch(mod, i, box) * ((i % box.perRow) + 1),
    y: 50 + row * KNOB_ROW,
  };
}

// Which arrangement the rack draws in. Persisted, because it is a reading
// preference rather than a property of the patch — the mode you can read is
// the mode you want back after a reload. One button in the rack chrome for
// now; it gets its proper home beside the level-of-detail selector when that
// lands, and `compact` becomes the export default after that.
const LAYOUT_MODES = ["chain", "compact", "freeform"];
let layoutMode = LAYOUT_MODES.includes(localStorage.getItem("ricercar-layout"))
  ? localStorage.getItem("ricercar-layout")
  : "chain";

// The freeform grid, and the fixed inset `buildRack` lays content out at.
// Both are needed by the snap: the dot grid is painted in *rack* coordinates
// (`#dotGrid`, 24px, origin 0) while `layout` works in an un-inset space, so a
// plate snapped to a multiple of 24 in layout space would land 15px off the
// dots it is visibly aiming at. `snapL` does the round trip once, in one
// place, so the hand and the offered-slot placer agree.
const GRID = 24;
const RACK_OFF_X = 15;
const RACK_OFF_Y = 12;
const snapL = (v, off) => Math.round((v + off) / GRID) * GRID - off;

// ---------- layout ----------
// The seam. Cables, plates and knobs were already pure consumers of a
// `key → box` map; this pulls the map out of the renderer so that a new
// arrangement is a new y-assignment rather than a second copy of buildRack.
//
// Two modes ship now:
//   chain   — the reading mode. The trunk is one straight horizontal run and
//             every departure from it means something: up is a second audio
//             input, down is modulation. Nothing else is allowed to bend it.
//   compact — the same layering packed tight. This is the mode a screenshot
//             or an export wants, where bounding box beats legibility.
//
//   freeform — the hand's mode. Positions come from the player, keyed by node
//             identity, and everything the player has *not* placed is offered
//             a slot next to the neighbour it is wired to. Chain is its seed,
//             so a patch that arrives from evolution with no layout at all
//             opens readable rather than in a heap at the origin.
//
// The layering itself is not recomputed: `RackModule.column` out of
// describe.rs is already a correct longest-path-from-sink, and re-deriving it
// in JS would be a second implementation of the same fact that can disagree
// with the engine.
//
// `places` is the freeform store — `Map<mid,{x,y}>` in layout space. It is
// passed in rather than read from module scope because `layout` is also the
// duel minis' arrangement function, and a mini draws a *different patch* than
// the one whose hand positions are on file.
function layout(rack, mode, places) {
  if (mode === "freeform") return layoutFree(rack, layoutFlow(rack, "chain"), places);
  return layoutFlow(rack, mode);
}

// The two flow arrangements: layered, and derived entirely from the term.
function layoutFlow(rack, mode) {
  const box = new Map();
  const byKey = new Map();
  for (const m of rack.modules) {
    box.set(m.key, moduleBox(m));
    byKey.set(m.key, m);
  }
  const maxCol = Math.max(...rack.modules.map((m) => m.column));
  // Flip the column so signal flows left to right and the amp — the anchor of
  // the whole mental model — sits at the right edge where the ear expects it.
  const layerOf = (k) => maxCol - byKey.get(k).column;
  const layers = [];
  for (let l = 0; l <= maxCol; l++) layers.push([]);
  for (const m of rack.modules) layers[maxCol - m.column].push(m.key);

  // A node's parent is one layer to the right, always: every wire runs from a
  // child to its consumer and `column` is the distance from the sink.
  const parent = new Map();
  for (const w of rack.wires) parent.set(w.from, w.to);
  const kidsOf = (k) =>
    (k === "amp" ? ["node"] : [`${k}/0`, `${k}/1`, `${k}/m`]).filter((c) => byKey.has(c));

  // 2×2 alternating median sweeps. The term is a strict tree (term.rs is
  // `Box<AudioNode>` — one parent per node), so the downward sweep alone
  // already converges on a zero-crossing order and the upward one only
  // centres a parent over its children; both are cheap and they are what
  // compact mode reads its stacking order from.
  const indexIn = (l) => {
    const m = new Map();
    layers[l].forEach((k, i) => m.set(k, i));
    return m;
  };
  const median = (xs) => {
    if (!xs.length) return null;
    const s = xs.slice().sort((a, b) => a - b);
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  };
  // A node with no neighbour in the fixed layer holds its current position
  // rather than being swept to one end — the standard barycentre treatment,
  // and here it means a leaf keeps the engine's depth-first order, which is
  // the order the player built the patch in.
  const orderBy = (keys, weight) =>
    keys
      .map((k, i) => ({ k, i, w: weight(k) }))
      .map((e) => (e.w == null ? { ...e, w: e.i } : e))
      .sort((a, b) => a.w - b.w || a.i - b.i)
      .map((e) => e.k);
  for (let pass = 0; pass < 2; pass++) {
    for (let l = maxCol - 1; l >= 0; l--) {
      const above = indexIn(l + 1);
      layers[l] = orderBy(layers[l], (k) => above.get(parent.get(k)) ?? null);
    }
    for (let l = 1; l <= maxCol; l++) {
      const below = indexIn(l - 1);
      layers[l] = orderBy(layers[l], (k) =>
        median(kidsOf(k).map((c) => below.get(c)).filter((v) => v != null)));
    }
  }

  const cy = new Map(); // centre y, before normalisation
  const pinned = new Set(); // the spine: never moved by the overlap pass

  if (mode === "compact") {
    // Minimum bounding box: pack every layer from a shared top edge. No spine,
    // because straightening the trunk costs vertical space and an export is
    // being read as a picture, not traced with a finger.
    for (const keys of layers) {
      let y = 0;
      for (const k of keys) {
        const b = box.get(k);
        cy.set(k, y + b.h / 2);
        y += b.h + STACK_GAP;
      }
    }
  } else {
    // SPINE RULE. Walk the repeated `/0` chain down from the sink and pin every
    // module on it to one shared baseline. That run is the signal path; a
    // player traces it with a finger, and a staircase makes them stop and
    // re-read at every step.
    const root = byKey.has("amp") ? "amp" : layers[maxCol][0];
    for (let k = root; k && byKey.has(k); k = k === "amp" ? "node" : `${k}/0`) {
      if (byKey.get(k).is_mod) break;
      pinned.add(k);
    }
    // Audio: `/0` continues the local baseline, `/1` is the deliberate
    // departure. The sign is fixed upward rather than the plan's ±, because
    // modulation owns "below" — if a branch could also go down, the two kinds
    // of departure would look identical at a glance, which is the one thing
    // this rule exists to prevent.
    const placeAudio = (key, y) => {
      cy.set(key, y);
      const h = box.get(key).h;
      const kids = key === "amp" ? ["node"] : [`${key}/0`, `${key}/1`];
      kids.forEach((c, i) => {
        if (!byKey.has(c) || byKey.get(c).is_mod) return;
        const ch = box.get(c).h;
        placeAudio(c, i === 0 ? y : y - (h / 2 + GUTTER + ch / 2));
      });
    };
    placeAudio(root, 0);

    // Modulation gets its own band under the whole audio field. Chains are
    // packed into rows by the layers they span — two modulators that never
    // share a column share a row — so the band costs the least height it can
    // while still never colliding, and a chain never has to kink to dodge a
    // neighbour the way a per-layer push-down would make it.
    let audioBottom = -Infinity;
    for (const [k, y] of cy) audioBottom = Math.max(audioBottom, y + box.get(k).h / 2);
    const chains = [];
    for (const m of rack.modules) {
      if (!m.is_mod || !m.key.endsWith("/m")) continue;
      const rel = new Map();
      (function walk(key, y) {
        rel.set(key, y);
        const h = box.get(key).h;
        [`${key}/0`, `${key}/1`].forEach((c, i) => {
          if (!byKey.has(c)) return;
          walk(c, i === 0 ? y : y + (h / 2 + GUTTER + box.get(c).h / 2));
        });
      })(m.key, 0);
      const ch = { rel, top: Infinity, bot: -Infinity, l0: Infinity, l1: -Infinity };
      for (const [k, y] of rel) {
        ch.top = Math.min(ch.top, y - box.get(k).h / 2);
        ch.bot = Math.max(ch.bot, y + box.get(k).h / 2);
        ch.l0 = Math.min(ch.l0, layerOf(k));
        ch.l1 = Math.max(ch.l1, layerOf(k));
      }
      chains.push(ch);
    }
    const rows = [];
    for (const ch of chains) {
      let r = rows.findIndex((row) => row.every((c) => c.l1 < ch.l0 || c.l0 > ch.l1));
      if (r < 0) r = rows.push([]) - 1;
      rows[r].push(ch);
    }
    // Clearance is a gutter plus the `→ cut` label the mod jack prints under
    // the plate it belongs to; without the second term the band lands on top
    // of the very text that says what it modulates.
    let top = audioBottom + GUTTER + 18;
    for (const row of rows) {
      for (const c of row) for (const [k, y] of c.rel) cy.set(k, top + (y - c.top));
      top += Math.max(...row.map((c) => c.bot - c.top)) + STACK_GAP;
    }
  }

  // Priority method: the spine is immovable and everything else yields around
  // it. A layer is resolved outward from its pinned plate in both directions
  // and never through it — resolving a layer top-down would bend the trunk,
  // which is the whole thing we just spent the y-assignment straightening.
  for (const keys of layers) {
    const ord = keys.slice().sort((a, b) => cy.get(a) - cy.get(b));
    const p = ord.findIndex((k) => pinned.has(k));
    const anchor = p >= 0 ? p : 0;
    for (let i = anchor - 1; i >= 0; i--) {
      const lim =
        cy.get(ord[i + 1]) - box.get(ord[i + 1]).h / 2 - STACK_GAP - box.get(ord[i]).h / 2;
      if (cy.get(ord[i]) > lim) cy.set(ord[i], lim);
    }
    for (let i = anchor + 1; i < ord.length; i++) {
      const lim =
        cy.get(ord[i - 1]) + box.get(ord[i - 1]).h / 2 + STACK_GAP + box.get(ord[i]).h / 2;
      if (cy.get(ord[i]) < lim) cy.set(ord[i], lim);
    }
  }

  // Layer bands are as wide as their widest plate, and plates are right-
  // aligned inside them so every `out` jack in a layer departs from the same
  // x. Cables then read as a bundle rather than as a ragged fan.
  const bandW = layers.map((keys) => Math.max(...keys.map((k) => box.get(k).w)));
  const xs = [];
  let x = 0;
  for (let l = 0; l < layers.length; l++) {
    xs[l] = x;
    x += bandW[l] + GUTTER;
  }
  let minY = Infinity;
  let maxY = -Infinity;
  for (const m of rack.modules) {
    const b = box.get(m.key);
    minY = Math.min(minY, cy.get(m.key) - b.h / 2);
    maxY = Math.max(maxY, cy.get(m.key) + b.h / 2);
  }
  const pos = new Map();
  for (const m of rack.modules) {
    const b = box.get(m.key);
    const l = maxCol - m.column;
    pos.set(m.key, {
      x: xs[l] + bandW[l] - b.w,
      y: cy.get(m.key) - b.h / 2 - minY,
      w: b.w,
      h: b.h,
      perRow: b.perRow,
    });
  }
  return { pos, natW: x - GUTTER, natH: maxY - minY };
}

// ---------- freeform ----------
// Everything above is a function of the term. This is the one arrangement that
// is not: it is a function of what the player did with their hands, and the
// term only gets a say about the modules the player has not touched yet.
//
// Two rules do all the work.
//
//   1. A stored position is honoured exactly. Not "as a hint", not "as a seed
//      for a relaxation pass" — a hand position that a layout pass is allowed
//      to improve is not a hand position. This is why relayout is a *command*
//      (WS-4 §3): switching to chain is a thing you ask for, never a thing the
//      renderer decides for you because the patch grew.
//
//   2. A module with no stored position is offered a slot beside the neighbour
//      it is wired to — upstream of its consumer for audio, under it for
//      modulation — and then slid down the grid until it is clear of anything
//      already placed. That is what "an evolved child does not appear at 0,0"
//      means in practice: a generation of ⚡ typically keeps most of the tree
//      (uids are inherited, WS-4 §6), so the two or three genuinely new
//      modules arrive next to the modules they feed.
//
// Placement runs right to left — the sink first — so a consumer is on the
// board before the thing that feeds it asks where the consumer went.
function layoutFree(rack, seed, places) {
  const store = places || new Map();
  const pos = new Map();
  const placed = [];
  // The consumer of each module, which is the anchor an unplaced module wants.
  const parent = new Map();
  for (const w of rack.wires) parent.set(w.from, w.to);

  // A hair over the gutter: two plates that merely touch read as one wide
  // plate, and the offered slot should never produce that by itself.
  const CLEAR = 12;
  const hits = (x, y, w, h) =>
    placed.some((b) =>
      x < b.x + b.w + CLEAR && x + w + CLEAR > b.x &&
      y < b.y + b.h + CLEAR && y + h + CLEAR > b.y);
  const put = (m, x, y) => {
    const s = seed.pos.get(m.key);
    // Layout space has an origin, and the camera's content box starts there.
    // Clamping here rather than normalising afterwards is deliberate: a
    // normalising pass would shift *every* plate the moment the leftmost one
    // moved, so a stored position would silently stop meaning what it said.
    const b = { x: Math.max(0, x), y: Math.max(0, y), w: s.w, h: s.h, perRow: s.perRow };
    pos.set(m.key, b);
    placed.push(b);
  };

  for (const m of rack.modules) {
    const p = store.get(midOf(m));
    if (p) put(m, p.x, p.y);
  }

  // Keys whose position is a hand position or descends from one. Only these
  // are worth anchoring to; see below.
  const rooted = new Set(pos.keys());
  const rest = rack.modules
    .filter((m) => !pos.has(m.key))
    .sort((a, b) => seed.pos.get(b.key).x - seed.pos.get(a.key).x);
  for (const m of rest) {
    const s = seed.pos.get(m.key);
    const pk = parent.get(m.key);
    // The consumer is only worth chasing if it is *rooted* in a hand position
    // — placed by the player, or placed relative to something that was.
    // Anchoring to it unconditionally would mean the first plate dropped in an
    // untouched patch re-derived every other position in the rack, and a hand
    // edit that reflows everything it did not touch is the thing §3 forbids.
    // So the default is the seed, unrounded: with nothing placed, freeform is
    // the chain layout to the pixel, and entering the mode changes nothing
    // until you do something. Rootedness is transitive so that a whole new
    // *chain* — a duplicate and the modulator that came with it — arrives
    // beside the module it feeds rather than at its flow-layout coordinates,
    // which describe an arrangement this rack is no longer in.
    const pb = pk && rooted.has(pk) ? pos.get(pk) : null;
    let ax = s.x;
    let ay = s.y;
    if (pb) {
      rooted.add(m.key);
      // Modulation goes under the module it drives — the mod jack is on the
      // bottom edge, so anywhere else means a cable across a faceplate.
      // Audio goes upstream, left, on the consumer's own centreline.
      ax = m.is_mod ? pb.x + (pb.w - s.w) / 2 : pb.x - s.w - GUTTER;
      ay = m.is_mod ? pb.y + pb.h + GUTTER + 18 : pb.y + (pb.h - s.h) / 2;
      ax = Math.max(0, snapL(ax, RACK_OFF_X));
      ay = Math.max(0, snapL(ay, RACK_OFF_Y));
    }
    // Clear of anything already on the board, either way: a plate the player
    // has not placed must never be the one that ends up hidden.
    for (let n = 0; n < 80 && hits(ax, ay, s.w, s.h); n++) ay += GRID;
    put(m, ax, ay);
  }

  let natW = 0;
  let natH = 0;
  for (const b of pos.values()) {
    natW = Math.max(natW, b.x + b.w);
    natH = Math.max(natH, b.y + b.h);
  }
  return { pos, natW, natH };
}

// ---------- freeform positions, kept ----------
// `Map<subject, Map<mid,{x,y}>>`, in layout space (WS-4 §8). Keyed by subject
// because a `mid` is only unique where uids are: the amp and any unsettled
// tree fall back to `k<key>`, and every patch in the bank has a `kamp`.
//
// Rides in the same `ui` blob as HELD and the bank filter, so hand positions
// survive a reload the way the plan says they must. Old saves simply have no
// `positions` key and start empty — nothing to migrate, because an absent
// layout and an empty one mean the same thing here.
const ffLayouts = new Map();
const FF_KEEP = 60;       // subjects' worth of layout; the bank holds 40
let ffLast = null;        // the subject whose layout was most recently written
// A layout read out of an imported file, waiting for the engine to say which
// id that patch landed as. See the `patch_imported` handler.
let pendingLayout = null;

function ffKey() {
  return wb.subjectId == null ? "bench" : String(wb.subjectId);
}

/** The store for the current subject, creating it on first write. */
function ffStore(create) {
  const k = ffKey();
  let m = ffLayouts.get(k);
  if (!m && create) {
    m = new Map();
    ffLayouts.set(k, m);
    ffTrim();
  }
  if (m && create) ffLast = k;
  return m || null;
}
function ffTrim() {
  // Insertion order is eviction order, which is what a Map already gives us.
  while (ffLayouts.size > FF_KEEP) ffLayouts.delete(ffLayouts.keys().next().value);
}

/** The positions to draw the *current* rack with, inheriting the layout of the
 *  patch this one came from when it is the first time we have seen this id.
 *
 *  Inheritance is by evidence rather than by provenance: uids are minted from
 *  one monotonic counter for the whole session, so a patch that shares a uid
 *  with the last one the player arranged is that patch's descendant — a commit,
 *  or a generation of ⚡. That is the acceptance criterion "positions persist
 *  for surviving nodes" (§5 P2.2), and it holds without the UI having to know
 *  which message benched the new tree. */
function ffPlaces() {
  const k = ffKey();
  const mine = ffLayouts.get(k);
  // Drawing from a layout is the same evidence of "this is the arrangement in
  // front of the player" as writing one, so it has to move `ffLast` too. It
  // did not, and a layout that came off disk was therefore never a *source*
  // for inheritance: bench a patch whose positions were restored, press ⚡,
  // and the child compared its uids against whatever subject happened to have
  // been dragged last — a patch it shares nothing with — so the test below
  // failed and every survivor fell back to the chain seed.
  if (mine) { ffLast = k; return mine; }
  const src = ffLast != null ? ffLayouts.get(ffLast) : null;
  if (!src || !wb.rack) return null;
  // Asked through `midOf`, which is how the store is keyed, rather than by
  // re-deriving `u${uid}` here — the same rule spelled twice is the same rule
  // waiting to drift.
  //
  // The amp stays out of it on purpose. It is the envelope, not a node: uid 0,
  // key `amp`, therefore mid `kamp` in *every* patch in the bank. Letting it
  // count would make any layout inherit into any patch, which is the positional
  // bleed identity was introduced to end — so it may ride along inside an
  // overlap, but it can never be the whole of one.
  if (!wb.rack.modules.some((m) => m.uid && src.has(midOf(m)))) return null;
  const copy = new Map(src);
  ffLayouts.set(k, copy);
  ffLast = k;
  ffTrim();
  return copy;
}

/** Snap everything on screen to the grid and pin it — the "apply grid" verb.
 *  The seed is whatever is currently drawn, which for a patch arriving without
 *  a layout is the chain arrangement, exactly as ruled. */
function applyGrid() {
  if (!wb.rack || !rackBoxes.size) return;
  const store = ffStore(true);
  for (const m of wb.rack.modules) {
    const b = rackBoxes.get(m.key);
    if (!b) continue;
    store.set(midOf(m), {
      x: Math.max(0, snapL(b.x - RACK_OFF_X, RACK_OFF_X)),
      y: Math.max(0, snapL(b.y - RACK_OFF_Y, RACK_OFF_Y)),
    });
  }
  camHold = true;
  renderRack();
  scheduleSave();
  note(`${store.size} modules pinned to the grid — drag any of them from here.`);
}

function moduleLockAddrs(mod) {
  return [...mod.structural_addrs, ...mod.knobs.map((k) => k.addr)];
}

function isModuleLocked(mod) {
  const addrs = moduleLockAddrs(mod);
  return addrs.length > 0 && addrs.every(isLockedAddr);
}

function svgEl(tag, attrs, cls) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
  if (cls) el.setAttribute("class", cls);
  return el;
}

// ---------- touch ----------
// Take a gesture away from the browser before it takes it away from us.
// The rack frame scrolls on touch, and a pan beats a control every time: a
// finger dragged down a knob inside a scrollable frame scrolls the frame,
// and the knob receives one pointermove and then a pointercancel. Both lines
// say "this drag is mine" — `touch-action` is the modern one, and the
// non-passive touchstart preventDefault is the one that holds in engines that
// don't apply touch-action to SVG *children*, which is where every control in
// this rack lives. Only ever called on elements whose whole job is a drag, so
// suppressing the synthetic click it would otherwise produce costs nothing.
// Both are inert for a mouse.
function claimGesture(el) {
  el.style.touchAction = "none";
  el.addEventListener("touchstart", (ev) => ev.preventDefault(), { passive: false });
}

// A 10px glyph is a fine mouse target and a poor thumb one. Rather than grow
// the glyph — which would redraw the faceplate for everyone — give it an
// invisible pad, and only where a finger is doing the aiming. `pad` is the
// full width/height of the target area in viewBox units.
// Appended last so it hit-tests above the glyph it pads, and always inside
// the control's own group so the pad inherits the control's identity — the
// document-level "a click outside closes it" guard reads `.mod-menu-btn` off
// the target, and a pad that sat outside the group would open the menu and
// then be seen as an outside click that closes it again.
function fingerPad(g, x, y, w, h) {
  if (!COARSE) return;
  hitPad(g, x, y, w, h);
}

// The same trick, unconditionally. ⋯ and ▢ are the only two entry points to
// structural editing on the whole faceplate and they measure 6×13 CSS pixels —
// under half the 24×24 minimum, for a mouse as much as for a thumb, and the
// aim cost lands on the *most consequential* control on the plate. The two
// pads deliberately meet between the glyphs rather than around them: the strip
// where they overlap is the gap between the two, so whichever wins there, no
// glyph is ever stolen from.
function hitPad(g, x, y, w, h) {
  g.appendChild(svgEl("rect", { x: x - w / 2, y: y - h / 2, width: w, height: h, fill: "transparent" }));
}

/** A screw's rotation, in degrees, hashed off the module's identity and the
 *  screw's corner. FNV-1a, plus a final avalanche — without it two plates
 *  whose uids differ by one came out with visibly the same four angles,
 *  because FNV's last multiply only stirs the high bits and `% 71` was
 *  reading a difference of exactly one multiplied constant. Four screws that
 *  repeat across the rack is the tell this rule exists to remove. */
function screwAngle(mid, i) {
  const s = `${mid}:${i}`;
  let h = 2166136261;
  for (let j = 0; j < s.length; j++) {
    h ^= s.charCodeAt(j);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return ((h >>> 0) % 71) - 35;
}

// ---------- the readout flash ----------
// Green is reserved for things that carry signal. A knob's readout does not
// — it reports — so it sits in `--silk-dim` and borrows `--phos-a` for ~400ms
// when it changes, which is the moment it *is* about the sound. Three
// payoffs: the plate calms, the cables become the brightest green on screen
// (correct: they are what you are reading), and every parameter change gets a
// free highlight that says "this edit reached the instrument".
//
// A map rather than a class on the element, because `renderRack` is a full
// teardown: the element that was flashing is gone by the time the flash would
// have ended, and the one that replaces it has to inherit the state.
const KNOB_FLASH_MS = 420;
const knobFlash = new Map();
function markKnobChanged(addr) {
  knobFlash.set(addr, performance.now() + KNOB_FLASH_MS);
  // The map is per-session and knob addresses are positional, so a long
  // session with many splices would otherwise accumulate dead keys.
  if (knobFlash.size > 200) {
    const now = performance.now();
    for (const [k, t] of knobFlash) if (t < now) knobFlash.delete(k);
  }
}

// ---------- cable terminations ----------
// A cable used to stop at a coordinate. On a real panel it stops in a *plug*,
// and the difference is most of why the old rack read as a flowchart: a line
// that ends on a dot is a graph edge, a line that disappears into a barrel
// sunk in a nut is a patch lead. The barrel is 7 across and 11 along the
// cable's axis; the strain-relief boot is the 3-unit sleeve the lead actually
// emerges from, so the cable leaves the plug rather than the socket.
//
// Orientation is one number: `rot` is the direction the cable departs in, so
// an `out` jack is 0, an `in` jack is 180 (the lead comes from the left), and
// a mod tab is 90 (the lead comes up from the bus below). Drawn inside the
// jack group, which means it inherits the jack's transform for free — and,
// more importantly, it rides the plate through a FLIP tween instead of having
// to be re-placed every frame the way the cable itself is.
function plugArt(rot) {
  const g = svgEl("g", rot ? { transform: `rotate(${rot})` } : {}, "plug");
  g.appendChild(svgEl("rect", { x: 1.5, y: -3.5, width: 11, height: 7, rx: 3 }, "plug-barrel"));
  g.appendChild(svgEl("rect", { x: 3, y: -3.5, width: 3, height: 7, rx: 1.4 }, "plug-collar"));
  g.appendChild(svgEl("rect", { x: 11.5, y: -2, width: 3.4, height: 4, rx: 1.6 }, "plug-boot"));
  return g;
}

// Five stops inside the green family — hue ±14°, lightness ±10% off
// `--phos-a` (#8ef0b1 ≈ hsl(141 76% 75%)). Green still unambiguously means
// audio; what the ramp buys is that two cables converging on one mixer are
// two *different* greens, so you can follow either one back to where it came
// from. Amber stays unsplit: there is only ever one modulation story per
// cable and splitting it would compete with the amber-means-the-model law.
const AUDIO_INK = [
  "hsl(127, 74%, 68%)",
  "hsl(134, 75%, 71%)",
  "hsl(141, 76%, 75%)",
  "hsl(148, 77%, 79%)",
  "hsl(155, 78%, 82%)",
];

/** Which stop each audio cable takes, keyed by its *source* — the term is a
 *  tree, so a module has exactly one outgoing cable and its source names it.
 *  Seeded by the source's index so the assignment is stable across a render,
 *  then bumped by two whenever a target has already taken that stop, which is
 *  the acceptance condition: no two converging cables share a green. */
function audioInkStops(rack) {
  const order = new Map(rack.modules.map((m, i) => [m.key, i]));
  const taken = new Map();
  const stop = new Map();
  for (const w of rack.wires) {
    if (w.kind === "mod") continue;
    let seen = taken.get(w.to);
    if (!seen) taken.set(w.to, (seen = new Set()));
    let s = (order.get(w.from) ?? 0) % AUDIO_INK.length;
    // Two, not one: adjacent stops are 7° and 4% apart by construction, which
    // is a ramp you can read as an ordering and not as a distinction.
    for (let i = 0; i < AUDIO_INK.length && seen.has(s); i++) s = (s + 2) % AUDIO_INK.length;
    seen.add(s);
    stop.set(w.from, s);
  }
  return stop;
}

// ---------- differential flow ----------
// Uniform perpetual motion on every cable is noise: it says "this is a synth"
// and nothing else. Motion scaled by the level actually present at that point
// in the chain is a meter — crossfade a mixer to one side and the other
// branch visibly stops, which is a fact about the patch you can otherwise
// only get by ear.
//
// The level is estimated from the patch rather than measured, because the
// analyser hangs off the master and there is no per-node tap: sources are
// unity, and every cable inherits its source's level times whatever its
// consumer does to it. That is cheap (one pass over ≤24 modules per render,
// and the render is the only thing that can change the answer) and it is
// exactly right for the case that matters — a mixer's balance knob.
function wireLevels(rack) {
  const byKey = new Map(rack.modules.map((m) => [m.key, m]));
  // Each module has exactly one consumer — the term is a tree — so one wire
  // out, indexed by its source.
  const outWire = new Map();
  for (const w of rack.wires) if (w.kind !== "mod") outWire.set(w.from, w);
  // How much of a child's signal its consumer passes on. Only two consumers
  // actually attenuate: a mixer's balance, at equal power because that is the
  // law the DSP crossfades under (describe.rs `bal`), and the second input of
  // the three dynamics modules — a sidechain key is not summed into the
  // output at all, so its cable is drawn as a permanently quiet one.
  const weight = (to, w) => {
    if (!to) return 1;
    const second = w.from === `${to.key}/1`;
    if (to.kind === "mix") {
      const b = to.knobs.find((k) => k.addr.endsWith("#bal"));
      const v = b ? b.value : 0.5;
      return second ? Math.sin(v * Math.PI / 2) : Math.cos(v * Math.PI / 2);
    }
    if (second && MOD_BY_KIND[to.kind]?.inNames?.[1] === "key") return 0.5;
    return 1;
  };
  // The quantity drawn is *reach*: how much of what is on this cable arrives
  // at the amp. Not "how much signal is present here" — that number would
  // leave the four cables upstream of a muted mixer branch running at full
  // speed with only the last one stopping, which reads as a fault rather than
  // as a branch that has been turned off. Reach makes the whole limb go
  // still, together, which is what the ear hears.
  //
  // `column` is the distance from the sink, so ascending order visits every
  // consumer before the modules that feed it — no recursion, and no cycle to
  // guard against (there cannot be one; the term is a tree).
  const reach = new Map();
  for (const m of [...rack.modules].sort((a, b) => a.column - b.column)) {
    const w = outWire.get(m.key);
    // No consumer: this is the amp, and everything it has reaches the ear.
    reach.set(m.key, w ? (reach.get(w.to) ?? 1) * weight(byKey.get(w.to), w) : 1);
  }
  const lvl = new Map();
  for (const w of rack.wires) {
    if (w.kind === "mod") continue;
    lvl.set(w.from, reach.get(w.from) ?? 1);
  }
  return lvl;
}

// ---------- the mod-slot housing ----------
// An empty modulation slot used to render as an orphan ring floating below
// the plate, and a filled one as the same ring with a cable in it — so
// "this module can be modulated at X" was only legible on the modules that
// already were. The tab is a permanent 96×22 housing notched into the bottom
// edge, identical in silhouette whether or not anything is plugged into it:
// occupancy reads from the stroke (dashed → solid), never from whether the
// element exists.
//
// One function, because `wirePathD` has to land the cable in the jack and the
// renderer has to draw the jack in the tab, and a housing whose cable arrives
// somewhere else is worse than no housing.
const MOD_TAB_W = 96;
const MOD_TAB_H = 22;
// How far below the plate's bottom edge the tab's centre line sits. Not zero:
// a tab centred exactly on the edge is half over the last knob row, and the
// bottom row's readout — the one piece of text on the plate that had just
// been given the contrast — lands underneath it. Seven units puts the tab's
// top edge 4 below the deepest descender and still leaves a third of the
// housing inside the panel, which is what makes it read as notched in rather
// than as a badge stuck on.
const MOD_TAB_DY = 7;
function modTab(w) {
  const tw = Math.min(MOD_TAB_W, w - 8);
  const x = (w - tw) / 2;
  return { x, w: tw, jx: x + 13, jy: MOD_TAB_DY };
}

// ---------- cable routing ----------
// Hoisted out of `buildRack` because a cable's shape is a function of where
// its two plates are, and during a relayout that is a different answer every
// frame. One generator, two callers: the build asks for the resting shape and
// the motion system asks for the shape at 37% of the way there. A plate that
// tweens while its cable stays where it was does not read as a module moving,
// it reads as a cable coming unplugged.
//
// `orth` takes a polyline and rounds its corners, clamping each radius to
// half the shorter of the two segments so a short run can never make a corner
// overshoot back into the one before it.
function orth(raw) {
  const p = [raw[0]];
  for (const q of raw.slice(1)) {
    const last = p[p.length - 1];
    if (Math.abs(q[0] - last[0]) > 0.5 || Math.abs(q[1] - last[1]) > 0.5) p.push(q);
  }
  if (p.length < 2) return `M ${p[0][0]} ${p[0][1]}`;
  let d = `M ${p[0][0].toFixed(1)} ${p[0][1].toFixed(1)}`;
  for (let i = 1; i < p.length - 1; i++) {
    const [a, b, c] = [p[i - 1], p[i], p[i + 1]];
    const la = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const lc = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const r = Math.min(12, la / 2, lc / 2);
    d += ` L ${(b[0] + ((a[0] - b[0]) / la) * r).toFixed(1)} ${(b[1] + ((a[1] - b[1]) / la) * r).toFixed(1)}`;
    d += ` Q ${b[0].toFixed(1)} ${b[1].toFixed(1)}` +
      ` ${(b[0] + ((c[0] - b[0]) / lc) * r).toFixed(1)} ${(b[1] + ((c[1] - b[1]) / lc) * r).toFixed(1)}`;
  }
  const e = p[p.length - 1];
  return `${d} L ${e[0].toFixed(1)} ${e[1].toFixed(1)}`;
}
// The mod jack is on the plate's *bottom* edge, so the cable has to arrive
// from below or it crosses the panel it is plugging into — which is exactly
// what happens in compact mode, where a modulator often sits above its
// target. Drop to a bus level under both plates first, then rise into it.
// In chain mode the modulator is already below and both jogs collapse away,
// leaving the plain out-and-up the mod band was designed to read as.
function modRoute(x1, y1, x2, y2) {
  const yb = Math.max(y1, y2 + 26);
  const xm = yb > y1 + 0.5 ? x1 + 22 : x1;
  return orth([[x1, y1], [xm, y1], [xm, yb], [x2, yb], [x2, y2]]);
}
// Into the left edge of the next plate in a CV chain: leave horizontally,
// step across at the midpoint, arrive horizontally.
function chainRoute(x1, y1, x2, y2) {
  return orth([[x1, y1], [(x1 + x2) / 2, y1], [(x1 + x2) / 2, y2], [x2, y2]]);
}

/** The `d` for one cable, given where the plates are *now*. `null` when either
 *  end is missing, which is a wire the caller should skip rather than draw. */
function wirePathD(w, pos, modByKey) {
  const from = pos.get(w.from);
  const to = pos.get(w.to);
  if (!from || !to) return null;
  const x1 = from.x + from.w;
  const y1 = from.y + from.h / 2;
  const toMod = modByKey.get(w.to);
  if (w.kind === "mod") {
    if (toMod && toMod.is_mod) {
      // A link inside a CV chain: both plates sit on the same mod row, so
      // the honest route is a straight run into the next plate's left edge.
      return chainRoute(x1, y1, to.x, to.y + to.h / 2);
    }
    // Into an audio module's bottom jack: out along the mod row, then one
    // vertical into the plate's bottom edge. The jack is no longer at the
    // plate's midpoint — it sits at the left end of the mod tab (§4) — and a
    // cable that arrives at the old midpoint would terminate on the tab's
    // silkscreen instead of in its socket.
    return modRoute(x1, y1, to.x + modTab(to.w).jx, to.y + to.h + MOD_TAB_DY);
  }
  // Audio cables land on the target's in jack.
  const x2 = to.x;
  // A binary node's two sockets sit at 0.38/0.68 of the plate — all six of
  // them, not just `mix`. Testing for `kind === "mix"` left a ducker's key
  // cable and a vocoder's carrier cable landing on the plate edge halfway
  // between the two jacks they were supposed to terminate in.
  const y2 = toMod && MOD_BY_KIND[toMod.kind]?.ins === 2
    ? to.y + to.h * (w.from === `${w.to}/0` ? 0.38 : 0.68)
    : to.y + to.h / 2;
  // A consumer *behind* its source. The flow layouts cannot produce this — a
  // node's parent is always one layer to the right — but freeform can, and the
  // span-proportional cubic below degenerates into a straight line drawn
  // backwards through both plates when it happens. Route it the way the mod
  // cables are routed instead: out, down to a bus level clear of both plates,
  // back, and up into the socket. A cubic bowed wide enough to clear a long
  // backwards run balloons with the distance; a right-angle run reads the same
  // at any length, and it says "this one goes backwards" at a glance.
  // The threshold is 8 rather than something comfortable on purpose: the
  // tightest gap either flow layout can produce is the 28px gutter, so this
  // branch is unreachable from chain or compact and cannot change how an
  // existing patch draws.
  if (x2 < x1 + 8) {
    const yb = Math.max(from.y + from.h, to.y + to.h) + 26;
    return orth([[x1, y1], [x1 + 26, y1], [x1 + 26, yb], [x2 - 26, yb], [x2 - 26, y2], [x2, y2]]);
  }
  // Sag proportional to span. A flat `max(24, span/2)` put control point 1
  // *past* control point 2 whenever the span was under 48px — which it is
  // between adjacent columns — so short runs kinked into a V instead of
  // hanging. A constant sag was also 40% of a short span and 4% of a long
  // one, so cables never read as the same kind of object.
  const span = Math.max(1, x2 - x1);
  const dx = Math.min(span * 0.42, 90);
  const sag = Math.min(span * 0.22, 46) + Math.abs(y2 - y1) * 0.06;
  return `M ${x1} ${y1} C ${x1 + dx} ${y1 + sag}, ${x2 - dx} ${y2 + sag}, ${x2} ${y2}`;
}

/** A module's identity as the motion system spells it. `uid` is the real
 *  answer (WS-4 §6); the amp has none — it is the envelope, not a node — and
 *  a tree that has not been settled yet has none either, so both fall back to
 *  the position, which is exactly as stable as the old behaviour was. */
function midOf(m) {
  return m && m.uid ? `u${m.uid}` : `k${m ? m.key : "?"}`;
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
  // Preconditions on hover: `title` never fires on a disabled element, so
  // the reason lives on the wrapper span.
  const reason = (id, text) => {
    const wrap = $(id)?.closest(".tt");
    if (wrap) wrap.title = $(id).disabled ? text : "";
  };
  reason("rack-play", !hasRack ? "Pick a patch from the bank first" : "This patch failed the safety vet and is muted");
  reason("rack-commit", !hasRack ? "Pick a patch from the bank first" : !wb.dirty ? "Nothing to commit — turn a knob first" : "This patch failed the safety vet");
  reason("rack-evolve", "Pick a patch from the bank first");
  reason("lock-knobs", "Pick a patch from the bank first");
  reason("lock-structure", "Pick a patch from the bank first");
  reason("lock-clear", !hasRack ? "Pick a patch from the bank first" : "No locks set — click a lock dot or ▢ on a module first");
  renderSubject();
  if (!hasRack) {
    svg.innerHTML = "";
    rackBoxes = new Map();
    rackFrame = null;
    cancelRackMotion();
    rackContent = { w: frameSize().w, h: frameSize().h };
    syncMapBtn();
    nbSync();
    return;
  }

  // Measured before the teardown, because after it there is nothing left to
  // measure: where every plate was, and where the keyboard was standing.
  const before = captureRackMotion();
  const focusMark = markRackFocus();

  buildRack(svg, wb.rack, {
    interactive: true,
    locks: lockedAddrs(),
    compact: effectiveLod() === "compact",
    placeholders: placeholderKeys,
    // Only the workbench has hand positions; the duel minis draw other
    // patches, whose layout this player has never touched. An *empty* store is
    // still a store: freeform with nothing placed is the chain arrangement,
    // and it has to draw through the freeform path so the first drop does not
    // switch arrangements underneath the plate being dropped.
    places: layoutMode === "freeform" ? (ffPlaces() || new Map()) : null,
  });
  // Then play the difference. This has to happen before the camera is aimed,
  // because whether anything is moving is what decides whether the camera
  // travels on the motion curve or on its own.
  const moving = startRackMotion(before);
  // The camera is pointed after the build, not during it: a rebuild that
  // changed the patch's bounding box asks for a fit, and one that did not
  // (a knob release, a lock toggle, a bench reply) must leave the view
  // exactly where the player put it.
  aimCamera(moving);

  // One roving tab stop for the whole rack, so Tab lands on the patch editor
  // instead of skipping it. It enters at a *module*, not at a knob: the module
  // is the thing the structural verbs act on, and from there ←/→ is one press
  // into its controls.
  const first = $("rack-svg").querySelector("g.mod-group") ||
                $("rack-svg").querySelector("[data-addr]");
  if (first) first.setAttribute("tabindex", "0");
  // …unless the keyboard was already somewhere, in which case it stays there.
  // Strictly after the default stop is set, or both would claim tabindex 0.
  restoreRackFocus(focusMark);

  // The rack is rebuilt from scratch on every edit, which throws away the lit
  // sockets. Re-light them, or a knob turn while something is in hand would
  // silently leave the user holding a module with nowhere visible to put it.
  nbSync();
  // Same argument for a cable half-connected by clicks, and for everything
  // pick mode draws — all of it lives in the DOM the build just replaced.
  connectSync();
  pickFeedback();

  // Cache the amp faceplate for the per-note flash (see flashAmp).
  // Match the module *kind*, not its silkscreen: the title renders as
  // "ENV / OUT" only because of `text-transform`, so its textContent is
  // lowercase and a `startsWith("ENV")` test silently never matches.
  ampPlateEl = $("rack-svg").querySelector('g[data-kind="amp"] .mod-plate');

}

// The patch is the headline; its provenance is the caption. While a TEACH
// candidate sounds, the header says so where the eye already is.
function renderSubject() {
  const nameEl = $("rack-subject");
  const metaEl = $("rack-meta");
  if (!nameEl || !metaEl) return;
  if (hearingSide && currentDuel) {
    const id = hearingSide === "a" ? currentDuel[0] : currentDuel[1];
    nameEl.classList.add("hearing");
    nameEl.textContent = `${rowOf(id) ? nameOf(id) : "…"} · candidate ${hearingSide.toUpperCase()}`;
    metaEl.textContent =
      benchBeforeAudition != null ? `← bench returns to ${nameOf(benchBeforeAudition)}` : "";
    return;
  }
  nameEl.classList.remove("hearing");
  const hasRack = wb.rack && wb.rack.modules && wb.rack.modules.length > 0;
  if (!hasRack || wb.subjectId == null) {
    nameEl.textContent = "no patch loaded";
    metaEl.textContent = "";
    return;
  }
  nameEl.textContent = `${nameOf(wb.subjectId)}${wb.dirty ? " · edited" : ""}`;
  metaEl.textContent = [
    `#${wb.subjectId}`,
    sigOf(wb.subjectId),
    wb.locks.size ? `${wb.locks.size} locked` : "",
    wb.vetOk ? "" : "⚠ muted",
  ]
    .filter(Boolean)
    .join(" · ");
}

// Shared rack renderer: the interactive workbench and the read-only duel
// minis draw through the same code, so the circuit always looks the same.
function buildRack(svg, rack, opts) {
  const {
    interactive = false,
    locks = new Set(),
    fit = false,
    compact = false,
    placeholders = new Set(),
    places = null,
  } = opts || {};
  // A caller with no hand positions to draw cannot draw freeform: the duel
  // minis inherit the workbench's mode for chain-vs-compact, but "where the
  // player put the plates" is a fact about one patch and they are showing
  // another. Chain is the honest fallback, and it is freeform's own seed.
  let { mode = layoutMode } = opts || {};
  if (mode === "freeform" && !places) mode = "chain";
  svg.innerHTML = "";
  const defs = svgEl("defs", {});
  // Light comes from 315° (top-left) everywhere: plate bevel, knob body,
  // screw head and jack nut all agree, so the panel reads as one object under
  // one lamp rather than a collage.
  defs.innerHTML = `
    <linearGradient id="plateGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#22272f"/><stop offset="1" stop-color="#13161a"/>
    </linearGradient>
    <radialGradient id="knobGrad" cx="0.35" cy="0.3" r="0.9">
      <stop offset="0" stop-color="#3b414c"/><stop offset="0.7" stop-color="#20242b"/>
      <stop offset="1" stop-color="#101216"/>
    </radialGradient>
    <radialGradient id="jackNut" cx="0.35" cy="0.3" r="0.85">
      <stop offset="0" stop-color="#4a505b"/><stop offset="1" stop-color="#1a1d22"/>
    </radialGradient>
    <linearGradient id="bevelTop" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.13"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <!-- One blur reads as a CSS card: a single soft shadow puts the plate at
         a constant distance from a surface it never touches. An object
         sitting on a surface has two shadows — a tight dark contact shadow
         where it meets the panel, and a wide soft cast further out. Merged
         rather than chained, so the cast is a shadow of the plate and not a
         shadow of the contact shadow. -->
    <filter id="plateShadow" x="-40%" y="-40%" width="200%" height="220%">
      <feDropShadow in="SourceGraphic" dx="0" dy="1" stdDeviation="1"
                    flood-color="#000" flood-opacity="0.8" result="contact"/>
      <feDropShadow in="SourceGraphic" dx="0" dy="5" stdDeviation="7"
                    flood-color="#000" flood-opacity="0.35" result="cast"/>
      <feMerge><feMergeNode in="cast"/><feMergeNode in="contact"/></feMerge>
    </filter>
    <g id="screw">
      <circle r="3.1" fill="url(#jackNut)"/>
      <path d="M -2 0.6 L 2 -0.6" stroke="#07080a" stroke-width="0.9" stroke-linecap="round"/>
    </g>
    <pattern id="dotGrid" width="24" height="24" patternUnits="userSpaceOnUse">
      <circle cx="1.2" cy="1.2" r="1.05" fill="rgba(255,255,255,0.025)"/>
    </pattern>
    <radialGradient id="patchPool" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.045"/>
      <stop offset="0.55" stop-color="#ffffff" stop-opacity="0.018"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>`;
  svg.appendChild(defs);

  // Arrangement is decided by `layout` and consumed here. The renderer never
  // computes a coordinate of its own any more — that separation is what lets a
  // second mode be a second y-assignment instead of a second renderer.
  const L = layout(rack, mode, places);
  const natW = L.natW + 30;
  const natH = L.natH + 24;
  // Content is laid out at its natural size at a fixed origin, always. It used
  // to be laid out into whatever box the frame happened to be, at a
  // magnification derived on the spot and baked into the viewBox — which is
  // why the rack could only ever zoom *in*: `Math.max(1, …)` floored the fit
  // factor at unity, so past about six columns the patch, and the amp with
  // it, simply ran off the right-hand edge. Where you are looking is now a
  // camera (`view`, below) and not a property of the last render, so the two
  // callers can each get what they want: the duel minis take the natural box
  // as their viewBox, and the workbench points the camera at it.
  const xOff = RACK_OFF_X;
  const yOff = RACK_OFF_Y;
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  if (fit) svg.setAttribute("viewBox", `0 0 ${natW} ${natH}`);
  const pos = new Map();
  for (const [k, b] of L.pos) {
    pos.set(k, { x: b.x + xOff, y: b.y + yOff, w: b.w, h: b.h, perRow: b.perRow });
  }

  // Three layers, in this order: plates, then cables, then controls.
  //
  // Cables used to paint *under* the plates, so a run that crossed a module
  // simply vanished and reappeared — the graph told you two modules were
  // connected and then hid the evidence. Front-panel cables are physically
  // true for this instrument, so they go on top, with a casing and a cast
  // shadow (see .rack-wires in style.css) that makes a crossing read as a
  // cable lying on a panel rather than as a line drawn through it. Controls
  // then go above the cables, because a cable that covers a knob you have to
  // grab is a worse problem than the one we just fixed.
  const plateLayer = svgEl("g", {}, "rack-plates");
  const wireLayer = svgEl("g", {}, "rack-wires");
  const ctrlLayer = svgEl("g", {}, "rack-controls");
  // Underneath all three: a floor. A canvas you can pan needs something that
  // moves with the world or the motion is invisible — you cannot tell a pan
  // from a relayout in a black void. The dots are in rack coordinates, so they
  // travel and scale with the patch; the pool of light sits on the patch's own
  // bounds so the rack reads as an object standing on a surface rather than
  // as ink floating in one. Off for the duel minis, which are cutouts.
  if (!fit) {
    const ground = svgEl("g", {}, "rack-ground");
    ground.appendChild(svgEl("ellipse", {
      cx: xOff + L.natW / 2, cy: yOff + L.natH / 2,
      rx: Math.max(240, L.natW * 0.78), ry: Math.max(180, L.natH * 0.82),
      fill: "url(#patchPool)",
    }, "rack-pool"));
    // One rect, deliberately far bigger than any reachable view: the pattern
    // tiles for free and this costs less than tracking the camera.
    ground.appendChild(svgEl("rect", { x: -6000, y: -6000, width: 16000, height: 16000 }, "rack-dots"));
    svg.appendChild(ground);
  }
  svg.appendChild(plateLayer);
  svg.appendChild(wireLayer);
  svg.appendChild(ctrlLayer);
  const modByKey = new Map(rack.modules.map((m) => [m.key, m]));
  // What the motion system will need after the next teardown: the elements it
  // has to move, and the identity that says which of them is "the same one".
  const mGroups = [];
  const mWires = [];

  // Which green each cable takes, and how much signal it is carrying. Both
  // are properties of the patch, not of the frame, so they are computed once
  // per build and read by the loop below rather than per cable.
  const inkStop = audioInkStops(rack);
  const flow = wireLevels(rack);
  // Which sockets have something in them, so the plug art (§1) goes only
  // where a lead actually terminates. The term is total, so every audio
  // socket is occupied; a mod tab is the one socket in the instrument that
  // can honestly be empty, which is exactly why it needed a housing.
  const cabled = new Set(rack.wires.filter((w) => w.kind !== "mod").map((w) => w.from));
  const modIn = new Set(rack.wires.filter((w) => w.kind === "mod").map((w) => w.to));

  for (const w of rack.wires) {
    // Orthogonal routing for modulation, span-proportional cubics for audio —
    // all of it in `wirePathD` (above), because the same shape has to be
    // computable mid-relayout from a set of interpolated plate positions.
    const d = wirePathD(w, pos, modByKey);
    if (d == null) continue;
    // Identity for a cable is the identity of the two plates it joins, so a
    // run that survives an edit is recognised as the same run even though
    // both its endpoints were renamed by the splice.
    const wid = `${midOf(modByKey.get(w.from))}>${midOf(modByKey.get(w.to))}`;
    // The casing is the cable's jacket, not a glow: it is background-coloured
    // and wider than the ink, so a run crossing a plate cuts a channel through
    // it instead of tinting it.
    const caseEl = svgEl("path", { d }, `wire ${w.kind}-case`);
    // The ink carries the endpoints so pick mode can put its caret on *this*
    // cable rather than near it — "insert after wavefolder" has to point at
    // the run that is about to be cut, and there may be four of them.
    const wireEl = svgEl("path", { d, "data-from": w.from, "data-to": w.to }, `wire ${w.kind}`);
    if (w.kind !== "mod") {
      // The ramp, and the meter. Inline because both are per-cable facts
      // about this patch — a class per stop would be five rules that say the
      // same thing, and a level is a number, not a state.
      wireEl.style.stroke = AUDIO_INK[inkStop.get(w.from) ?? 2];
      const lv = Math.max(0, Math.min(1, flow.get(w.from) ?? 1));
      // Floor at 0.2: a silent cable is still a cable, and drawing it away to
      // nothing would say "unplugged", which is a different and much worse
      // claim. It stops moving instead — that is the part you read as level.
      wireEl.style.strokeOpacity = (0.2 + 0.62 * lv).toFixed(3);
      if (lv < 0.06) wireEl.classList.add("still");
      else wireEl.style.animationDuration = `${Math.round(560 / Math.max(0.1, lv))}ms`;
    }
    mWires.push({ w, wid, caseEl, inkEl: wireEl });
    if (w.kind === "mod") {
      // The wire breathes at (roughly) the modulator's own rate, so the
      // patch looks alive where it sounds alive.
      const src = modByKey.get(w.from);
      let dur = 1.6;
      if (src) {
        const rate = src.knobs.find((k) => k.addr.endsWith("#rate"));
        if (rate) dur = 0.25 + (1 - rate.value) * 2.4;
        else {
          const att = src.knobs.find((k) => k.addr.endsWith("#att"));
          const dec = src.knobs.find((k) => k.addr.endsWith("#dec"));
          if (att && dec) dur = 0.4 + (att.value + dec.value) * 1.4;
        }
      }
      // Only the ink breathes. A casing that pulsed would read as the cable
      // itself thinning and thickening, which is not what modulation does.
      wireEl.classList.add("pulse");
      wireEl.style.animationDuration = `${dur.toFixed(2)}s`;
    }
    wireLayer.appendChild(caseEl);
    wireLayer.appendChild(wireEl);
  }

  // Silkscreen never overruns its knob. Abbreviating case by case is whack-a-
  // mole — it fixed `resonance`/`mod depth` and left `mode`/`cutoff` colliding
  // — so any label still wider than its pitch is condensed to fit. SVG
  // `textLength` + `spacingAndGlyphs` squeezes tracking first and glyphs only
  // as far as it must, which is exactly how a real panel handles a long name.
  const fitLabels = () => {
    for (const t of svg.querySelectorAll(".knob-label, .mod-title, .plate-hint, .mod-tab-name")) {
      const avail = Number(t.dataset.fit || 0);
      if (!avail) continue;
      let w = 0;
      try { w = t.getBBox().width; } catch (_) { continue; }
      if (w > avail) {
        t.setAttribute("textLength", avail.toFixed(1));
        t.setAttribute("lengthAdjust", "spacingAndGlyphs");
      }
    }
  };

  const isModuleLockedIn = (mod) => {
    const addrs = moduleLockAddrs(mod);
    return addrs.length > 0 && addrs.every((a) => locks.has(a));
  };

  for (const m of rack.modules) {
    const p = pos.get(m.key);
    const box = { w: p.w, h: p.h, perRow: p.perRow };
    // `plateG` is the faceplate — panel, bevel, screws, silkscreen — and lives
    // under the cables. `g` is everything you can put a hand on, and lives
    // over them. Same transform, same `data-kind`, so every existing selector
    // (`g[data-kind="amp"] .mod-plate`, `[data-addr]`, `.jack[data-childkey]`)
    // still finds what it went looking for.
    //
    // `data-key` rides along on both: a drop on a module *body* has to know
    // which module it landed on, and pick mode has to be able to dim, halo
    // and pin a chip to one plate. `data-kind` alone cannot name a plate —
    // a patch routinely carries three filters.
    // `data-uid` is the *identity* alongside the position. `renderRack` is a
    // full teardown (`svg.innerHTML = ""`), so the only way anything can be
    // said to have "moved" rather than "been replaced" is a key that outlives
    // the rebuild — which is what a FLIP tween, a sticky hand position and a
    // selection that survives a splice all need. `0` on the amp, which is the
    // envelope rather than a node.
    // `data-mid` is that same identity made total: the amp and any tree that
    // has not been settled yet have no uid, and the motion system, the focus
    // restore and the selection cannot have a module they are unable to name.
    const mid = midOf(m);
    const ids = { "data-kind": m.kind, "data-key": m.key, "data-uid": m.uid, "data-mid": mid };
    const plateG = svgEl("g", { transform: `translate(${p.x},${p.y})`, ...ids });
    const g = svgEl("g", { transform: `translate(${p.x},${p.y})`, ...ids }, "mod-group");
    plateLayer.appendChild(plateG);
    ctrlLayer.appendChild(g);
    mGroups.push({ mid, key: m.key, plateG, g, x: p.x, y: p.y, w: p.w, h: p.h });
    if (interactive) {
      // A module is a thing you can act on, so it is a stop. The rack's roving
      // tabstop used to hold knobs only, which meant every structural verb in
      // the app — the ones behind ⋯, the ones behind a right-click — was
      // unreachable without a pointer. ↑/↓ walk the plates, ←/→ drop into
      // their knobs, Enter opens the same menu the ⋯ opens.
      g.setAttribute("role", "group");
      g.setAttribute("tabindex", "-1");
      g.setAttribute("aria-label", `${m.title} module`);
      g.appendChild(svgEl("rect", {
        x: -3, y: -3, width: p.w + 6, height: p.h + 6, rx: 8,
      }, "plate-focus"));
    }
    // A socket nothing is plugged into. The node under it is real — the
    // grammar has no hole — but the player unplugged it and must be able to
    // see that, so the plate is drawn as the absence it stands for.
    const isEmpty = interactive && !m.is_mod && m.kind !== "amp" && placeholders.has(m.key);
    const plateCls = `mod-plate${m.is_mod ? " modside" : ""}${isModuleLockedIn(m) ? " locked" : ""}${isEmpty ? " placeholder" : ""}`;
    const plate = svgEl("rect", { width: p.w, height: p.h, rx: 5 }, plateCls);
    // Compact is the zoomed-out reading mode: title and jacks, and none of
    // the material that only means anything at a size where you could grab
    // it. A 1px bevel and a 3px screw at 0.4× are four elements of noise per
    // plate and a blurred filter region the compositor still has to paint.
    if (!compact) plate.setAttribute("filter", "url(#plateShadow)");
    plateG.appendChild(plate);
    // Faceplate material: a lit top edge and a shaded bottom edge give the
    // plate thickness, and four screws say it is bolted to a rail. Without
    // these it renders as a rounded div and the rack reads as a wiring
    // diagram rather than an instrument you could put your hands on.
    if (!compact && !isEmpty) {
      // A raised bevel, not a drawn outline. Three elements, all of them
      // agreeing with the 315° lamp: a 2px lit top edge over a 6px gradient
      // falling away from it (the roll-off is what makes the edge read as
      // *raised* rather than as a white line), a 2px shade along the bottom,
      // and a 1px lit left edge — the one the lamp also catches.
      plateG.appendChild(svgEl("rect", { x: 1, y: 1, width: p.w - 2, height: 6, fill: "url(#bevelTop)" }, "plate-roll"));
      plateG.appendChild(svgEl("rect", { x: 1, y: 0.5, width: p.w - 2, height: 2, rx: 1 }, "plate-lit"));
      plateG.appendChild(svgEl("rect", { x: 1, y: p.h - 2.5, width: p.w - 2, height: 2, rx: 1 }, "plate-shade"));
      plateG.appendChild(svgEl("rect", { x: 0.5, y: 2, width: 1, height: p.h - 4 }, "plate-edge"));
      // Four screws, each at its own angle. A rack of identical screwdriver
      // slots is the single loudest tell that a panel was generated rather
      // than built — nobody has ever bolted four screws in at the same
      // rotation. Hashed off the module's own identity so the pattern is
      // this plate's, stable across every rebuild, and different from its
      // neighbour's even when they are the same kind of module.
      [[7, 7], [p.w - 7, 7], [7, p.h - 7], [p.w - 7, p.h - 7]].forEach(([sx, sy], si) => {
        const use = svgEl("use", { transform: `translate(${sx},${sy}) rotate(${screwAngle(mid, si)})` }, "plate-screw");
        use.setAttribute("href", "#screw");
        plateG.appendChild(use);
      });
    }
    // The control well (§5): a recessed 56×20 pocket top-right holding the
    // two verbs that live on every plate. Before this they were two glyphs
    // floating on bare panel, which is why "the only two entry points to all
    // structure editing" read as decoration — nothing said they were
    // controls. The well says it at rest, and it is where bypass and solo go
    // when they land. Narrow plates get a shorter pocket: 56 units on a
    // 96-unit plate would leave the silkscreen nowhere to be.
    const wellW = interactive ? (p.w >= 168 ? 56 : 44) : 0;
    const wellX = p.w - wellW - 4;
    const lockedIn = isModuleLockedIn(m);
    if (interactive && !compact) {
      plateG.appendChild(svgEl("rect", {
        x: wellX, y: 5, width: wellW, height: 20, rx: 3,
      }, `ctrl-well${lockedIn ? " locked" : ""}`));
    }
    // Title: 13px at 500 in `--silk-mute`. A silkscreened panel name is large
    // and quiet — it is the one piece of text on the plate that never
    // changes, so it has no business owning the contrast. The hairline under
    // it turns the name into a masthead and gives the knob grid something to
    // hang from. A 96-unit plate takes the same type one step down: with a
    // control well beside it there is not room for 13px without condensing
    // the glyphs, and a squeezed title is worse than a small one.
    const narrow = p.w < 168;
    const title = svgEl("text", { x: 14, y: 18 },
      `mod-title${narrow ? " narrow" : ""}${m.is_mod ? " modside" : ""}${isEmpty ? " empty" : ""}`);
    title.textContent = isEmpty ? "empty" : m.title;
    // A title is silkscreened onto the panel, so it belongs under the cables
    // — but it must not be *squeezed* by them: the fit pass measures against
    // the room left between the left edge and the control well.
    title.dataset.fit = String(Math.max(30, (interactive ? wellX : p.w - 8) - 20));
    plateG.appendChild(title);
    if (!compact && !isEmpty) {
      plateG.appendChild(svgEl("rect", {
        x: 14, y: 25, width: Math.max(20, p.w - 26), height: 1,
      }, "plate-rule"));
    }
    if (isEmpty) {
      // The plate says what it is *for*, because "empty" alone reads as a
      // fault rather than as an invitation.
      const hint = svgEl("text", { x: p.w / 2, y: p.h / 2 + 8, "text-anchor": "middle" }, "plate-hint");
      hint.textContent = "drop a source here";
      hint.dataset.fit = String(Math.max(40, p.w - 24));
      plateG.appendChild(hint);
    }

    if (interactive) {
      // "Plate hover" is not a CSS state anything can express here: the
      // faceplate is in one layer and the controls on it are in another, so
      // `g:hover` never fires for a pointer resting on bare panel and the
      // well would only light when you were already on it. Two listeners on
      // the plate mark both groups instead, which is what makes the well
      // brighten as the hand approaches rather than as it arrives.
      const hot = (on) => {
        plateG.classList.toggle("plate-hot", on);
        g.classList.toggle("plate-hot", on);
      };
      for (const el of [plateG, g]) {
        el.addEventListener("pointerenter", () => hot(true));
        el.addEventListener("pointerleave", () => hot(false));
      }
      // Structure menu (⋯) — every module; the amp offers insert-at-output.
      // The glyph lives in a group so a finger can be given more to aim at
      // than the 10px ellipsis itself. Both glyphs sit in the well now: the
      // amp has no lock, so its ⋯ takes the whole pocket.
      const hasLock = m.kind !== "amp" && !isEmpty;
      const menuX = wellX + (hasLock ? wellW * 0.3 : wellW / 2);
      const lockX = wellX + wellW * 0.72;
      const menuG = svgEl("g", {}, "mod-menu-btn");
      const menuBtn = svgEl("text", { x: menuX, y: 19 });
      menuBtn.textContent = "⋯";
      const mt = svgEl("title", {});
      mt.textContent = m.kind === "amp"
        ? "Add a module at the output"
        : "Restructure: replace, insert, delete, rewire";
      menuBtn.appendChild(mt);
      menuG.appendChild(menuBtn);
      hitPad(menuG, menuX, 15, 24, 26);
      menuG.addEventListener("click", (ev) => {
        ev.stopPropagation();
        openStructMenu(m, ev.clientX, ev.clientY);
      });
      g.appendChild(menuG);

      if (hasLock) {
        const lockOn = lockedIn;
        const lockG = svgEl("g", {}, `mod-lock${lockOn ? " on" : ""}`);
        const mlock = svgEl("text", { x: lockX, y: 19 });
        mlock.textContent = lockOn ? "▣" : "▢";
        const mtitle = svgEl("title", {});
        mtitle.textContent = lockOn
          ? "Unlock this module (evolution may change it again)"
          : "Lock this whole module (evolution keeps it exactly as-is)";
        mlock.appendChild(mtitle);
        lockG.appendChild(mlock);
        hitPad(lockG, lockX, 15, 24, 26);
        lockG.addEventListener("click", () => {
          const on = isModuleLockedIn(m);
          for (const a of moduleLockAddrs(m)) setLock(a, !on);
          renderRack();
        });
        g.appendChild(lockG);
      }
    }

    // ---- labeled jacks (green = audio, amber = modulation) ----
    const addJack = (gx, gy, cls, label, labelSide, data, plugRot) => {
      const jg = svgEl("g", { transform: `translate(${gx},${gy})` }, `jack${cls ? " " + cls : ""}`);
      if (interactive && data) {
        for (const [dk, dv] of Object.entries(data)) jg.setAttribute(dk, dv);
      }
      // A real jack: knurled nut, dark bore, and a specular arc at 315°.
      // Cables then terminate *in* something instead of on a flat dot.
      jg.appendChild(svgEl("circle", { r: 6.5 }, "j-nut"));
      jg.appendChild(svgEl("circle", { r: 3.4 }, "j-bore"));
      jg.appendChild(svgEl("path", { d: "M -4.4 -3.2 A 5.4 5.4 0 0 1 1.2 -5.3" }, "j-spec"));
      // The lead in the socket, if there is one. Under the hit circle so it
      // can never take a press away from the jack, and above the bore
      // because a plug that is in a socket covers it. Not in compact: at
      // 0.4× it is two more rects per jack and no information at all.
      if (plugRot != null && !compact) jg.appendChild(plugArt(plugRot));
      jg.appendChild(svgEl("circle", { r: 5.5 }));
      const attrs =
        labelSide === "right" ? { x: 9, y: 3 } :
        labelSide === "left" ? { x: -9, y: 3, "text-anchor": "end" } :
        labelSide === "none" ? null :
        { x: 0, y: 15, "text-anchor": "middle" };
      if (attrs) {
        const t = svgEl("text", attrs);
        t.textContent = label;
        jg.appendChild(t);
      }
      g.appendChild(jg);
      // A socket is a place you can put something, so it is a control — the
      // rack had no keyboard path to one, which made wiring the only gesture
      // in the app a keyboard user could not perform at all.
      if (interactive && data) {
        jg.setAttribute("role", "button");
        jg.setAttribute("tabindex", "-1");
        jg.setAttribute("aria-label", `${label} socket`);
      }
      return jg;
    };
    // While a module is in hand, a socket is a destination, not a cable to
    // pull: the same press has to mean "place here" instead of "unplug this".
    const placeGuard = (j, ev) => {
      if (connectPick) { ev.preventDefault(); connectClick(j); return true; }
      if (!armed) return false;
      ev.preventDefault();
      nbSocketClick(j);
      return true;
    };
    const isSource = SOURCE_KINDS.includes(m.kind);
    if (m.is_mod) {
      // A modulator's output is a cable source too, but only the one sitting
      // *in* the slot: the deeper links of a CV chain are the chain's own
      // wiring, and moving one out of the middle is a different edit from
      // moving the chain.
      const top = m.key.endsWith("/m");
      const oj = addJack(p.w, p.h / 2, "modjack", "out", "left", top ? { "data-outkey": m.key } : null, 0);
      if (interactive && top) attachOutJack(oj, m.key, "mod");
      // A link *arriving* from further down a CV chain lands on this plate's
      // left edge, where there is no socket to draw — the chain's internal
      // wiring is not a patch point. It still gets a plug, because the cable
      // has to end in something; it just gets no ring and no label.
      if (!compact && modIn.has(m.key)) {
        const inPlug = svgEl("g", { transform: `translate(0,${p.h / 2})` }, "jack modjack bare");
        inPlug.appendChild(plugArt(180));
        g.appendChild(inPlug);
      }
    } else if (m.kind === "amp") {
      const j = addJack(0, p.h / 2, "", "in", "right", { "data-childkey": "node" }, 180);
      if (interactive) {
        claimGesture(j);
        j.addEventListener("pointerdown", (ev) => {
          if (placeGuard(j, ev)) return;
          ev.preventDefault();
          startWireDrag({ mode: "unplug-audio", childKey: "node", kind: "audio" }, ev);
        });
      }
    } else {
      if (!isSource) {
        // A binary node's two sockets are not interchangeable and must not
        // read as if they were: a ducker's second input is a *key*, and
        // labelling it "b" tells the player nothing about what to plug in.
        const spec = MOD_BY_KIND[m.kind];
        const names = spec?.inNames || (spec?.ins === 2 ? ["a", "b"] : ["in"]);
        const ins = spec?.ins === 2
          ? [[p.h * 0.38, names[0], `${m.key}/0`], [p.h * 0.68, names[1], `${m.key}/1`]]
          : [[p.h / 2, names[0], `${m.key}/0`]];
        for (const [jy, lbl, ck] of ins) {
          const j = addJack(0, jy, "", lbl, "right", { "data-childkey": ck }, cabled.has(ck) ? 180 : null);
          if (interactive) {
            claimGesture(j);
            j.addEventListener("pointerdown", (ev) => {
              if (placeGuard(j, ev)) return;
              ev.preventDefault();
              startWireDrag({ mode: "unplug-audio", childKey: ck, kind: "audio" }, ev);
            });
          }
        }
      }
      // Every `out` used to be decoration: no data attribute, no listener, so
      // there was literally no gesture in the product that connected A to B.
      // It is now the primary cable source, which is what the drawing has
      // been promising since the first plate was rendered.
      // …except on a hole, which has nothing to give: the cable leaving it
      // exists only because the term is total, and offering to drag it would
      // be offering to move an absence.
      const oj = addJack(p.w, p.h / 2, "", "out", "left", isEmpty ? null : { "data-outkey": m.key },
        cabled.has(m.key) ? 0 : null);
      if (interactive && !isEmpty) attachOutJack(oj, m.key, "audio");
      // The mod slot, in its permanent housing. The jack names the port it
      // drives — on a four-knob module an unlabelled "mod" input is a
      // mystery, and now that eight different modules carry one, "mod" would
      // mean eight different things.
      // A hole does not advertise a mod destination either — "pitch" on an
      // empty socket names a port on a module the player has not chosen yet.
      const modDest = isEmpty ? null : kindModTarget(m.kind);
      if (modDest) {
        const filled = modIn.has(m.key);
        const tab = modTab(p.w);
        if (!compact) {
          // Notched into the bottom edge, half in and half out, so it reads
          // as part of the panel rather than as a badge stuck under it.
          plateG.appendChild(svgEl("rect", {
            x: tab.x, y: p.h + tab.jy - MOD_TAB_H / 2, width: tab.w, height: MOD_TAB_H, rx: 3,
          }, `mod-tab${filled ? " filled" : ""}`));
          const nm = svgEl("text", {
            x: tab.x + tab.w - 8, y: p.h + tab.jy + 3.5, "text-anchor": "end",
          }, `mod-tab-name${filled ? " filled" : ""}`);
          nm.textContent = modDest;
          nm.dataset.fit = String(Math.max(24, tab.w - 34));
          plateG.appendChild(nm);
        }
        // The label is carried but not drawn: the tab already prints the
        // destination in silkscreen, and printing it twice would be the one
        // thing the housing was built to stop. It still has to reach the
        // accessible name.
        const j = addJack(tab.jx, p.h + tab.jy, "modjack", `${modDest} mod`, "none", { "data-modkey": m.key },
          filled ? 90 : null);
        if (filled) j.classList.add("pulse");
        if (interactive) {
          claimGesture(j);
          j.addEventListener("pointerdown", (ev) => {
            if (placeGuard(j, ev)) return;
            if (!modAtKey(m.key)) return; // empty slot: target only
            ev.preventDefault();
            startWireDrag({ mode: "unplug-mod", key: m.key, kind: "mod" }, ev);
          });
        }
      }
    }

    // `kind` is "filter" for all four filter modes, but they do not share a
    // resonance law — read the sibling mode enum so the unit formatter can
    // tell an SVF from a diode ladder.
    const fkind = m.knobs.find((k) => k.addr.endsWith("#fkind"));
    const variant =
      fkind && fkind.kind.t === "enum"
        ? (fkind.kind.options[Math.round(fkind.value)] || "").replace(/^svf /, "svf-")
        : null;
    // Which knobs on this plate are *actually being moved by something else*
    // right now. The mod cable's destination is a port, not always a knob
    // (a vco's slot lands on a pitch offset with no knob of its own), so the
    // rule is: the port if it has a knob, and always the mod-depth knob,
    // which is the one whose value the incoming cable is scaled by.
    const modPort = modIn.has(m.key) ? kindModTarget(m.kind) : null;
    const isModulated = (k) =>
      modPort != null && (k.label === modPort || k.label === "mod depth");
    // The knob detail is the whole of the difference between the two levels
    // of detail, so it is one conditional rather than a second renderer.
    if (!compact && !isEmpty) m.knobs.forEach((k, i) => {
      const { x, y } = knobPos(m, i, box);
      const pitch = knobPitch(m, i, box);
      const kg = svgEl("g", { transform: `translate(${x},${y})` });
      const locked = locks.has(k.addr);

      if (k.kind.t === "continuous") {
        // Tick ring, then the travel track, then the value arc. The arc is
        // what turns a clock hand into a control you can read across the room.
        const ticks = svgEl("g", {}, "knob-ticks");
        for (let t = 0; t <= 10; t++) {
          const a = (-135 + 27 * t) * (Math.PI / 180);
          ticks.appendChild(svgEl("line", {
            x1: (Math.sin(a) * (KNOB_R + 5)).toFixed(2),
            y1: (-Math.cos(a) * (KNOB_R + 5)).toFixed(2),
            x2: (Math.sin(a) * (KNOB_R + 7)).toFixed(2),
            y2: (-Math.cos(a) * (KNOB_R + 7)).toFixed(2),
          }));
        }
        kg.appendChild(ticks);
        kg.appendChild(svgEl("path", { d: arcPath(KNOB_R + 3, 0, 1) }, "knob-track"));
        if (k.value > 0.004) {
          kg.appendChild(
            svgEl("path", { d: arcPath(KNOB_R + 3, 0, k.value) },
              `knob-arc${m.is_mod ? " modside" : ""}${isModulated(k) ? " modulated" : ""}`)
          );
        }
        const body = svgEl("circle", { r: KNOB_R }, "knob-body");
        kg.appendChild(body);
        // The pointer starts at 45% radius: a full-radius spoke reads as a pie
        // slice, not a pointer.
        const ang = (-135 + 270 * k.value) * (Math.PI / 180);
        kg.appendChild(
          svgEl("line", {
            x1: (Math.sin(ang) * KNOB_R * 0.45).toFixed(2),
            y1: (-Math.cos(ang) * KNOB_R * 0.45).toFixed(2),
            x2: (Math.sin(ang) * (KNOB_R - 3)).toFixed(2),
            y2: (-Math.cos(ang) * (KNOB_R - 3)).toFixed(2),
          }, `knob-ind${m.is_mod ? " modside" : ""}`)
        );
        if (locked) kg.appendChild(svgEl("circle", { r: KNOB_R + 9 }, "knob-locked-halo"));
        if (interactive) {
          // The knob you *see* is the body plus its travel ring: the value arc
          // at r+3 is the brightest thing in the control and reads as its rim.
          // Only the body was draggable, so a press on the ring landed on
          // `.knob-track` — decoration with no listener — and the knob did not
          // move. Scanning out from a knob's centre found the body to 17px,
          // then a dead band at 18, then three more pixels of track that
          // swallowed the press: a 36px control wearing a 44px face.
          //
          // One transparent target covers the whole face. It goes on last so
          // it sits above the decoration, and the lock dot is appended after
          // it so the dot still wins its own corner.
          const hit = svgEl("circle", { r: KNOB_R + 7 }, "knob-hit");
          const tt = svgEl("title", {});
          tt.textContent = `${k.label}: ${knobUnit(k.addr, k.value, m.kind, variant)} — drag up/down`;
          hit.appendChild(tt);
          kg.appendChild(hit);
          attachKnobDrag(hit, m, k);
        }
      } else {
        // The chip is as wide as its slot allows, capped at the 62 units the
        // longest option name ("triangle", "notch out") was drawn against.
        const bw = Math.max(40, Math.min(62, pitch - 4));
        const body = svgEl("rect", { x: -bw / 2, y: -11, width: bw, height: 22, rx: 3 }, "enum-body");
        const txt = svgEl("text", { y: 4 }, "enum-text");
        txt.textContent = enumDisplay(k);
        if (interactive) {
          const sweepable = LIVE_INDEX_SITES.has(k.addr.split("#").pop());
          const tt = svgEl("title", {});
          tt.textContent = sweepable
            ? `${k.label} — click to cycle, drag up/down to sweep (live)`
            : `${k.label} — click to cycle`;
          body.appendChild(tt);
          body.addEventListener("click", (ev) => {
            // The click a sweep leaves behind on its way up is not a cycle.
            if (Date.now() - enumSweptAt < 300) return;
            pushUndo();
            const n = k.kind.t === "octave" ? 5 : k.kind.options.length;
            const next = (Math.round(k.value) + (ev.shiftKey ? n - 1 : 1)) % n;
            k.value = next;
            txt.textContent = enumDisplay(k);
            sendEdit(k.addr, next, true);
          });
          // A live categorical site is worth dragging. `table` is a crossfade
          // position and every step now ramps over the live path's ~25 ms
          // smoother, so dragging it *morphs* the oscillator rather than
          // switching it; `oct` slides. The other enums are deliberately left
          // click-only — each of their steps is a full patch swap, and a drag
          // across four of them would be four dropouts.
          if (sweepable) attachEnumSweep(body, txt, k);
        }
        kg.appendChild(body);
        kg.appendChild(txt);
        if (locked) {
          kg.appendChild(svgEl("rect", { x: -bw / 2 - 3, y: -14, width: bw + 6, height: 28, rx: 5 }, "knob-locked-halo"));
        }
      }

      if (interactive) {
        // Ten knobs meant ten amber dots glowing at all times, competing with
        // the amber-means-the-model law for no reason. They appear on hover,
        // on focus, or once anything is actually locked.
        const dot = svgEl("g", { transform: `translate(${KNOB_R + 8},${-KNOB_R - 4})` },
          `lock-dot${locked ? " on" : ""}`);
        dot.appendChild(svgEl("circle", { r: 3.4 }, ""));
        const dt = svgEl("title", {});
        dt.textContent = locked ? `Unlock ${k.label}` : `Lock ${k.label} (evolution won't touch it)`;
        dot.appendChild(dt);
        dot.addEventListener("click", () => {
          setLock(k.addr, !locked);
          renderRack();
        });
        // A 3.4-unit dot is a 7px target. The pad stops 10 units out, which
        // still clears the knob body it sits beside (29.8 units away, r 15).
        fingerPad(dot, 0, 0, 20, 20);
        kg.appendChild(dot);

        // Keyboard operation: the rack was entirely pointer-only, which made
        // the patch editor — the deep half of the product — unusable without a
        // mouse. One roving tab stop per control; arrows move, up/down turn.
        kg.setAttribute("tabindex", "-1");
        kg.setAttribute("role", k.kind.t === "continuous" ? "slider" : "button");
        kg.setAttribute("aria-label", `${m.title} ${k.label}`);
        kg.dataset.addr = k.addr;
        kg.dataset.kind = m.kind;
        if (variant) kg.dataset.variant = variant;
        if (k.kind.t === "continuous") {
          kg.setAttribute("aria-valuetext", knobUnit(k.addr, k.value, m.kind, variant));
          kg.setAttribute("aria-valuenow", k.value.toFixed(3));
          kg.setAttribute("aria-valuemin", "0");
          kg.setAttribute("aria-valuemax", "1");
        }
      }

      const lbl = svgEl("text", { y: KNOB_R + 15 }, "knob-label");
      lbl.textContent = silkLabel(k.label);
      // Available width is the knob pitch less a hair of breathing room.
      lbl.dataset.fit = String(
        Math.max(24, pitch - 6)
      );
      kg.appendChild(lbl);
      if (k.kind.t === "continuous") {
        const val = svgEl("text", { y: KNOB_R + 25 }, "knob-value");
        val.textContent = knobUnit(k.addr, k.value, m.kind, variant);
        // Still inside its window: this readout changed a moment ago and the
        // teardown must not be what ends the flash.
        const until = knobFlash.get(k.addr);
        if (until != null && until > performance.now()) {
          val.classList.add("flashing");
          setTimeout(() => val.classList.remove("flashing"), until - performance.now());
        }
        kg.appendChild(val);
      }
      g.appendChild(kg);
    });
  }

  // Must run after insertion — `getBBox` needs a laid-out element.
  fitLabels();

  // Hand the camera the two things it needs and cannot recompute: how big the
  // patch is, and where each module sits. The minimap, every fit, and
  // "scroll that control into view" all read these rather than measuring the
  // DOM, which would be a layout flush per pan frame.
  if (!fit) {
    rackContent = { w: natW, h: natH };
    rackBoxes = pos;
    lodApplied = compact ? "compact" : "full";
    // And the motion system's own record of this build. It is deliberately
    // the live element references rather than a description of them: FLIP
    // works by writing transforms onto the *new* DOM, and re-querying for
    // thirty groups on every frame of a 260 ms tween is a selector engine
    // doing the work a variable already did.
    rackFrame = {
      pos,
      mods: modByKey,
      groups: mGroups,
      wires: mWires,
      mids: new Set(mGroups.map((it) => it.mid)),
      wids: new Set(mWires.map((it) => it.wid)),
    };
  }
}

// ===========================================================================
// MOTION — the rack moves instead of cutting
// ===========================================================================
// `renderRack` is a full teardown: `svg.innerHTML = ""` and thirty fresh
// plates on every edit, knob release, lock toggle, bench reply and resize
// (risk R8). That is a hard cut, and a cut is the one thing a graph editor
// cannot afford — after an insert the player has to re-find every module by
// reading it, because nothing on screen said "this one moved, that one is
// new, and the one you deleted was *there*".
//
// This does not replace the teardown; it makes the teardown invisible. FLIP:
// measure where everything is before the rebuild, let the rebuild put
// everything where it now belongs, then play the difference. What makes it
// possible at all is `uid` (WS-4 §6) — without a name that outlives a splice
// there is no such thing as "the same plate", only two renders that happen to
// contain a filter each.
//
// Three motions, one curve, one duration:
//   survivors  tween from their old position to their new one, and every
//              cable is re-routed each frame from the interpolated positions
//              so the patch deforms as one object rather than as plates
//              sliding out from under their wiring;
//   arrivals   fade and scale up from 0.96;
//   departures leave a ghost that fades, shrinks and drops 6px, so a deletion
//              is *seen* leaving rather than simply never having been there.
const MOTION_MS = 260;
const STILL_MQ = window.matchMedia("(prefers-reduced-motion: reduce)");
/** Live, not a snapshot: the OS switch can be thrown while the app is open,
 *  and a page that only honours it at load time honours it by luck. */
function prefersStill() { return STILL_MQ.matches; }

// The app's easing curve, in CSS for the WAAPI fades and in JS for the rAF
// loop that drives the tween — the same numbers both times, because a camera
// on one curve and its plates on another reads as two motions fighting, which
// is precisely what §9 asks for one of.
const EASE_CSS = "cubic-bezier(0.2,0,0.6,1)";
function bezierEase(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const fx = (t) => ((ax * t + bx) * t + cx) * t;
  const dfx = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (u) => {
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    // Newton from t = u. Six steps is well past convergence for a curve this
    // gentle, and the guard on a flat derivative keeps a pathological control
    // point from dividing by nothing.
    let t = u;
    for (let i = 0; i < 6; i++) {
      const e = fx(t) - u;
      if (Math.abs(e) < 1e-5) break;
      const d = dfx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return ((ay * t + by) * t + cy) * t;
  };
}
const EASE_MOTION = bezierEase(0.2, 0, 0.6, 1);

let rackFrame = null;  // the last interactive build, as the motion system sees it
let rackTween = null;  // rAF handle for the survivors' tween

/** A CSS transform placing a plate at (x,y) and scaled about its own centre.
 *  Written out rather than left to `transform-origin`, because a CSS
 *  transform on an SVG element *replaces* its `transform` attribute — there is
 *  no offsetting it, so every keyframe has to carry the whole position. */
function xform(x, y, s, w, h) {
  if (s === 1) return `translate(${x.toFixed(2)}px,${y.toFixed(2)}px)`;
  return `translate(${(x + w / 2).toFixed(2)}px,${(y + h / 2).toFixed(2)}px) ` +
    `scale(${s}) translate(${(-w / 2).toFixed(2)}px,${(-h / 2).toFixed(2)}px)`;
}

// A ghost keeps its paint and gives up its name. A clone that still answered
// to `[data-addr]` or `.mod-group` would be a second copy of the module as far
// as every query in the app is concerned: the roving tabstop would walk into
// it, `connectSync` would light its jacks, `elementFromPoint` could hand a
// cable drop to a plate that no longer exists, and `ampPlateEl` could end up
// pointing at a faceplate that is fading out.
const GHOST_STRIP = [
  "data-addr", "data-key", "data-uid", "data-mid", "data-kind", "data-childkey",
  "data-modkey", "data-outkey", "data-from", "data-to", "id", "tabindex", "role",
  "aria-label", "aria-valuenow", "aria-valuetext",
];
function ghostOf(el) {
  const c = el.cloneNode(true);
  for (const n of [c, ...c.querySelectorAll("*")]) {
    for (const a of GHOST_STRIP) n.removeAttribute(a);
    n.classList?.remove("mod-group");
  }
  return c;
}

/** Everything the motion system needs about the render that is about to be
 *  thrown away. Must be read *before* `buildRack`, because after it the old
 *  DOM is gone and with it every position the player last saw. */
function captureRackMotion() {
  if (!rackFrame || !wb.rack) return null;
  // Asked here rather than only at playback time: the capture's expensive part
  // is cloning the departing plates, and there is no point paying for ghosts
  // nobody has asked to see.
  if (prefersStill()) return null;
  const prev = new Map();
  for (const it of rackFrame.groups) {
    // Mid-tween, "where it was" is where it *is* on screen, not where the
    // last build meant to put it. A bench reply landing 100 ms into an insert
    // would otherwise snap every plate back to its pre-edit position and
    // replay the whole move from the start.
    prev.set(it.mid, { x: it.cx ?? it.x, y: it.cy ?? it.y, w: it.w, h: it.h });
  }
  const keep = new Set(wb.rack.modules.map(midOf));
  const ghosts = [];
  for (const it of rackFrame.groups) {
    if (keep.has(it.mid)) continue;
    ghosts.push({ ...prev.get(it.mid), nodes: [ghostOf(it.plateG), ghostOf(it.g)] });
  }
  // A deleted module's cables go with it. Nothing redraws them — the rebuild
  // simply does not contain them — so without a ghost they blink out a quarter
  // of a second before the plate they were plugged into.
  if (ghosts.length) {
    for (const it of rackFrame.wires) {
      const [f, t] = it.wid.split(">");
      if (keep.has(f) && keep.has(t)) continue;
      ghosts.push({ wire: true, nodes: [ghostOf(it.caseEl), ghostOf(it.inkEl)] });
    }
  }
  return { prev, ghosts, wids: rackFrame.wids, count: rackFrame.groups.length };
}

function cancelRackMotion() {
  if (rackTween != null) cancelAnimationFrame(rackTween);
  rackTween = null;
}

/** Play the difference between `before` and the build that just landed.
 *  Returns whether anything is actually moving, which is what tells the camera
 *  to travel on the same curve rather than on its own. */
function startRackMotion(before) {
  cancelRackMotion();
  if (!before || !rackFrame || prefersStill()) return false;
  const moves = [];
  const enters = [];
  for (const it of rackFrame.groups) {
    const o = before.prev.get(it.mid);
    if (!o) { enters.push(it); continue; }
    // Half a pixel is not a move; animating it costs a frame budget and buys
    // a shimmer. Most renders — a knob release, a lock toggle, a bench reply —
    // land entirely in this branch and start no animation at all.
    if (Math.abs(o.x - it.x) < 0.4 && Math.abs(o.y - it.y) < 0.4) continue;
    it.ox = o.x;
    it.oy = o.y;
    moves.push(it);
  }
  // Nothing survived: this is not a relayout, it is a different patch. Two
  // unrelated racks cross-fading through each other is a double exposure, not
  // a motion, so the departing one is simply gone and the new one fades up.
  const ghosts = rackFrame.groups.length - enters.length === 0 && before.count > 0
    ? []
    : before.ghosts;
  const arriving = rackFrame.wires.filter((it) => !before.wids.has(it.wid));
  if (!moves.length && !enters.length && !arriving.length && !ghosts.length) return false;

  const fade = { duration: MOTION_MS, easing: EASE_CSS };
  for (const it of enters) {
    for (const el of [it.plateG, it.g]) {
      el.animate(
        [{ opacity: 0, transform: xform(it.x, it.y, 0.96, it.w, it.h) },
         { opacity: 1, transform: xform(it.x, it.y, 1, it.w, it.h) }],
        fade,
      );
    }
  }
  for (const it of arriving) {
    for (const el of [it.caseEl, it.inkEl]) el.animate([{ opacity: 0 }, { opacity: 1 }], fade);
  }
  if (ghosts.length) {
    const layer = svgEl("g", {}, "rack-exit");
    // Departing cables go in a `.rack-wires` of their own so they keep the
    // cast shadow that rule carries — a wire that changed material on its way
    // out would read as a different object leaving than the one that was
    // there.
    const wireBin = svgEl("g", {}, "rack-wires");
    for (const gh of ghosts) {
      for (const n of gh.nodes) (gh.wire ? wireBin : layer).appendChild(n);
    }
    layer.appendChild(wireBin);
    $("rack-svg").appendChild(layer);
    for (const gh of ghosts) {
      // A cable has no plate to shrink: its geometry is absolute, so a
      // transform would slide it off its own endpoints on the way out.
      const kf = gh.wire
        ? [{ opacity: 1 }, { opacity: 0 }]
        : [{ opacity: 1, transform: xform(gh.x, gh.y, 1, gh.w, gh.h) },
           { opacity: 0, transform: xform(gh.x, gh.y + 6, 0.96, gh.w, gh.h) }];
      for (const n of gh.nodes) n.animate(kf, { ...fade, fill: "forwards" });
    }
    // The next teardown would take the layer with it anyway; this is for the
    // case where there isn't one.
    setTimeout(() => layer.remove(), MOTION_MS + 60);
  }

  if (!moves.length) return enters.length > 0 || ghosts.length > 0;

  // Promote the movers for the duration. Every faceplate carries
  // `filter: url(#plateShadow)`, and a filtered SVG element under a changing
  // transform is re-rasterised from scratch on every frame unless the
  // compositor has been told to keep it: measured on an 18-module patch, the
  // tween ran at 25-33 ms a frame with the plates and at 8 ms without them
  // (the compact level of detail, which drops the filter), while rewriting
  // all 34 cable paths per frame cost nothing measurable. Dropped again on
  // the last frame — a permanent `will-change` is a permanent layer, which is
  // the memory version of the same mistake.
  for (const it of moves) {
    it.plateG.style.willChange = "transform";
    it.g.style.willChange = "transform";
  }

  const t0 = performance.now();
  const step = (now) => {
    const u = Math.min(1, (now - t0) / MOTION_MS);
    const e = EASE_MOTION(u);
    // The whole layout at this instant: final positions for everything that
    // did not move, interpolated ones for everything that did. The cables are
    // then re-routed from it, which is the difference between "the patch is
    // deforming" and "the plates are sliding out from under their wiring".
    const at = new Map(rackFrame.pos);
    for (const it of moves) {
      it.cx = it.ox + (it.x - it.ox) * e;
      it.cy = it.oy + (it.y - it.oy) * e;
      const tf = xform(it.cx, it.cy, 1, it.w, it.h);
      it.plateG.style.transform = tf;
      it.g.style.transform = tf;
      at.set(it.key, { ...rackFrame.pos.get(it.key), x: it.cx, y: it.cy });
    }
    for (const it of rackFrame.wires) {
      const d = wirePathD(it.w, at, rackFrame.mods);
      if (d == null) continue;
      it.caseEl.setAttribute("d", d);
      it.inkEl.setAttribute("d", d);
    }
    if (u < 1) { rackTween = requestAnimationFrame(step); return; }
    rackTween = null;
    // Hand the plates back to their `transform` attribute, which has held the
    // final position all along — the last frame already agrees with it, so
    // dropping the inline style is invisible.
    for (const it of moves) {
      it.cx = it.x;
      it.cy = it.y;
      it.plateG.style.transform = "";
      it.g.style.transform = "";
      it.plateG.style.willChange = "";
      it.g.style.willChange = "";
    }
  };
  step(t0);
  return true;
}

// ===========================================================================
// FREEFORM — the plate is a thing you can pick up
// ===========================================================================
// The gesture is deliberately *not* a listener on the plate. Every control on
// a faceplate already owns its own press — knobs via `attachKnobDrag`, jacks
// via `startWireDrag`, ⋯ and ▢ via their click handlers and their 24px pads —
// and a second handler underneath them would be a race decided by whichever
// element happened to be on top. Instead this runs in the same capture-phase
// handler on `#rack-scroll` that already arbitrates the pan, from the same
// `onControl` test, so there is exactly one place in the app that decides what
// a press on the rack means. In freeform, that decision reads:
//
//     a control  → the control                (unchanged)
//     a plate    → move the plate             (new)
//     bare canvas→ pan the camera             (unchanged)
//
// and space-drag, middle-drag, right-click and long-press all keep the meaning
// they had, because they are tested first.
//
// `rackFrame` (WS-4 §9) is the whole seam: it already holds live element
// references and the `pos` map `wirePathD` consumes, so moving a plate is two
// attribute writes and a re-route, with no rebuild and no layout flush.
let plateDrag = null;

/** Paint one plate at a rack-space position and re-route everything plugged
 *  into it. Writes the `transform` *attribute*, not `style.transform`: the
 *  motion system owns the inline style, and the two would fight — and the
 *  attribute is where the next `captureRackMotion` expects to find the truth
 *  (via `it.cx`, which is why this sets it). */
function movePlateTo(it, x, y) {
  it.cx = x;
  it.cy = y;
  const tf = `translate(${x.toFixed(2)},${y.toFixed(2)})`;
  it.plateG.setAttribute("transform", tf);
  it.g.setAttribute("transform", tf);
  // `rackFrame.pos` *is* `rackBoxes` — the same Map object — so mutating it
  // here keeps fit-selection, the minimap and drop-on-body hit testing honest
  // about where the plate is, mid-drag, for free.
  const b = rackFrame.pos.get(it.key);
  if (b) { b.x = x; b.y = y; }
  for (const w of rackFrame.wires) {
    const d = wirePathD(w.w, rackFrame.pos, rackFrame.mods);
    if (d == null) continue;
    w.caseEl.setAttribute("d", d);
    w.inkEl.setAttribute("d", d);
  }
}

/** True if this press was taken. */
function startPlateDrag(ev) {
  if (!rackFrame || !wb.rack) return false;
  const g = ev.target?.closest?.("g[data-mid]");
  const mid = g && g.getAttribute("data-mid");
  const it = mid && rackFrame.groups.find((q) => q.mid === mid);
  if (!it) return false;
  ev.preventDefault();
  ev.stopPropagation();
  // A tween writing `style.transform` every frame would drag the plate back
  // out of the hand that is holding it.
  cancelRackMotion();
  const el = $("rack-scroll");
  el.classList.add("moving-plate");
  // Capture keeps the plate under a pointer that leaves the frame — and the
  // guard keeps a pointer the browser has already forgotten (a cancelled
  // touch, a synthesised press) from throwing on the way in. The listeners
  // below are on `el` either way, so the drag degrades to "while the pointer
  // is over the rack" rather than to nothing.
  try { el.setPointerCapture(ev.pointerId); } catch (_) {}
  const grab = clientToRack(ev.clientX, ev.clientY);
  const from = { x: it.cx ?? it.x, y: it.cy ?? it.y };
  let at = { ...from };
  plateDrag = it;

  const move = (mv) => {
    const p = clientToRack(mv.clientX, mv.clientY);
    let x = from.x + (p.x - grab.x);
    let y = from.y + (p.y - grab.y);
    // Snap is on by default and `shift` escapes it — the way every editor
    // that has a grid does it, and the reason the grid is drawn at all.
    if (!mv.shiftKey) {
      x = Math.round(x / GRID) * GRID;
      y = Math.round(y / GRID) * GRID;
    }
    at = { x: Math.max(RACK_OFF_X, x), y: Math.max(RACK_OFF_Y, y) };
    movePlateTo(it, at.x, at.y);
  };
  const up = () => {
    el.classList.remove("moving-plate");
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", up);
    plateDrag = null;
    ffStore(true).set(it.mid, { x: at.x - RACK_OFF_X, y: at.y - RACK_OFF_Y });
    // One rebuild, so the content box, the minimap rects and any unplaced
    // neighbour that now has to make room all agree with the drop. The camera
    // is held: the player just told us what they were looking at, and a fit
    // triggered by the bounding box they themselves changed would answer a
    // 24px nudge by moving the entire world.
    camHold = true;
    renderRack();
    scheduleSave();
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
  return true;
}

// ---------- focus retention ----------
// A rebuild used to drop the keyboard on the floor: `innerHTML = ""` removes
// the focused element, focus falls to `<body>`, and the roving tabstop resets
// to the first plate. Every bench reply — one per knob release, several per
// structural edit — therefore threw a keyboard user back to the start of the
// rack. Identity fixes this the same way it fixes the locks: focus is not on
// "the third knob of the fourth plate", it is on `#cut` of the module named
// `u41`, and that survives a splice that renumbers every key in the patch.

/** Where the keyboard is, in terms that outlive the rebuild. */
function markRackFocus() {
  const a = document.activeElement;
  if (!a || !$("rack-svg").contains(a)) return null;
  const g = a.closest?.("g.mod-group");
  const mid = g?.getAttribute("data-mid");
  if (!mid) return null;
  const addr = a.getAttribute?.("data-addr");
  // A knob is named by its parameter, which is what does *not* move when the
  // module does — the same slice `lockIdOf` takes.
  const hash = addr ? addr.indexOf("#") : -1;
  if (hash >= 0) return { mid, param: addr.slice(hash) };
  for (const attr of ["data-childkey", "data-modkey", "data-outkey"]) {
    const v = a.getAttribute?.(attr);
    // A socket is named by which socket it is: `/0`, `/1`, or the module's
    // own key for an out or a mod jack.
    if (v != null) return { mid, attr, tail: v.slice(v.lastIndexOf("/")) };
  }
  return { mid };
}

/** Put it back. Silent when the module it named is gone — a deleted plate has
 *  no focus to keep, and stealing focus for the plate that took its place
 *  would be the app deciding what the player is looking at. */
function restoreRackFocus(mark) {
  if (!mark) return;
  const g = $("rack-svg").querySelector(`g.mod-group[data-mid="${mark.mid}"]`);
  if (!g) return;
  let el = g;
  if (mark.param) el = g.querySelector(`[data-addr$="${mark.param}"]`) || g;
  else if (mark.attr) {
    el = [...g.querySelectorAll(`.jack[${mark.attr}]`)]
      .find((j) => j.getAttribute(mark.attr).endsWith(mark.tail)) || g;
  }
  setRackStop(el);
  // No `ensureRackVisible`: this is not navigation. The player did not move,
  // the patch did, and the camera's own answer to that is `aimCamera`.
  el.focus({ preventScroll: true });
}

// ===========================================================================
// CANVAS NAVIGATION — one camera, no scrollbars
// ===========================================================================
// The rack frame used to be an `overflow: auto` div wrapped around an SVG
// sized in pixels, with the magnification chosen at build time and baked into
// the viewBox. That arrangement can only zoom in. Past about six columns the
// patch ran off the right-hand edge and the amp — the anchor of the entire
// mental model — left the screen, with no fit, no pan and no map back to it.
//
// So there is a camera. `view.x/y` is the viewBox origin in rack units and
// `view.zoom` is CSS pixels per rack unit, which is enough to make every
// conversion two lines instead of a matrix chain, and it is the *only* thing
// that decides what you are looking at. Zoom range is 0.3×–2.5×; the old
// 2.2× magnification for small patches survives as the cap on the initial
// fit, where it was always the good idea, rather than as a floor everything
// else kept hitting.
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 2.5;
const FIT_MAX = 2.2;
// …and the floor a *fit* may reach past it. "Home shows you the whole patch"
// is the promise the key makes, and 0.3× could not keep it: fourteen modules
// in a 787×295 frame need 0.28×, so Home clipped three plates by six pixels
// and left no clue that it had. A floor is there to stop you zooming out into
// an empty grey field by accident — which is a thing a hand does, not a thing
// a fit does. So the fit may go below it, as far as legibility survives, and
// the wheel and the keys may not.
const FIT_MIN = 0.22;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

const view = { x: 0, y: 0, zoom: 1 };
let rackContent = { w: 640, h: 360 }; // natural size of the last interactive build
let rackBoxes = new Map();            // key → {x,y,w,h} in rack units
let viewUserSet = false;              // has the player aimed the camera themselves?
let camAimed = false;                 // first fit done?
let camHold = false;                  // leave the next build's framing alone
let camSig = "";                      // bounding-box signature of the last build
let viewTween = null;

function frameSize() {
  const el = $("rack-scroll");
  return { w: Math.max(80, el.clientWidth), h: Math.max(80, el.clientHeight) };
}
function contentBox() {
  return { x: 0, y: 0, w: rackContent.w, h: rackContent.h };
}
// The SVG fills the frame's content box exactly and its viewBox has the frame's
// aspect ratio, so there is never any letterboxing to account for and these two
// are exact inverses. Measuring the SVG rather than the frame keeps the 1px
// border out of the arithmetic.
function clientToRack(cx, cy) {
  const r = $("rack-svg").getBoundingClientRect();
  return { x: view.x + (cx - r.left) / view.zoom, y: view.y + (cy - r.top) / view.zoom };
}
function rackToClient(rx, ry) {
  const r = $("rack-svg").getBoundingClientRect();
  return { x: r.left + (rx - view.x) * view.zoom, y: r.top + (ry - view.y) * view.zoom };
}

function applyView() {
  const { w, h } = frameSize();
  // The absolute floor, not the manual one: this runs on every frame of the
  // tween a fit rides in on, so clamping to `ZOOM_MIN` here would take back
  // whatever `fitBox` went below it for.
  view.zoom = clamp(view.zoom, FIT_MIN, ZOOM_MAX);
  const vw = w / view.zoom;
  const vh = h / view.zoom;
  // A soft leash, not a cage: you can push the patch to the frame edge but
  // not past it, so "where did my patch go" needs a bug rather than a flick.
  const slack = 90 / view.zoom;
  view.x = clamp(view.x, -vw + slack, rackContent.w - slack);
  view.y = clamp(view.y, -vh + slack, rackContent.h - slack);
  $("rack-svg").setAttribute(
    "viewBox",
    `${view.x.toFixed(2)} ${view.y.toFixed(2)} ${vw.toFixed(2)} ${vh.toFixed(2)}`,
  );
  updateEdgeFade(vw);
  drawMinimap();
  // A cable in flight is anchored in rack space, so anything that moves the
  // world has to redraw it or the cable detaches from the jack it came out of.
  if (wire) redrawWireBand();
  // Same argument for the pick chip: it is pinned to a plate, and the plate
  // is in the world.
  positionPickChip();
  if (effectiveLod() !== lodApplied) scheduleRelod();
}

/** 48px of fade on whichever horizontal edge actually has patch beyond it.
 *  A hard cut mid-plate says "the window ends here"; a fade says "there is
 *  more this way", and the fitted case keeps its full contrast either side. */
function updateEdgeFade(vw) {
  const el = $("rack-scroll");
  const l = view.x > 4;
  const r = view.x + vw < rackContent.w - 4;
  el.style.setProperty("--fade-l", l ? "48px" : "0px");
  el.style.setProperty("--fade-r", r ? "48px" : "0px");
  el.classList.toggle("faded", l || r);
}

// ---------- level of detail ----------
// Explicit switch, automatic default (Reaktor's Compact/Ports, with the
// override users always end up wanting). `auto` is a threshold on zoom rather
// than on module count, because the thing that makes a knob unreadable is how
// many pixels it got, not how many friends it has.
let lodMode = localStorage.getItem("ricercar-lod") || "auto";
let lodApplied = "full";
let relodRaf = null;

function effectiveLod() {
  if (lodMode === "full" || lodMode === "compact") return lodMode;
  return view.zoom < 0.55 ? "compact" : "full";
}
// Deferred by a frame on purpose: this is reached from applyView, which is
// reached from renderRack, and a synchronous rebuild there would re-enter the
// renderer mid-render. A frame's latency on a detail switch is free.
function scheduleRelod() {
  if (relodRaf != null) return;
  relodRaf = requestAnimationFrame(() => {
    relodRaf = null;
    if (effectiveLod() !== lodApplied && wb.rack) renderRack();
  });
}
function syncLodBtn() {
  const b = $("rack-lod");
  if (!b) return;
  b.textContent = lodMode === "auto" ? "detail auto" : lodMode === "full" ? "detail full" : "detail lite";
  b.setAttribute("aria-pressed", String(lodMode !== "auto"));
  b.closest(".tt").title =
    lodMode === "auto"
      ? "Detail: automatic. Plates lose their knobs when you zoom out past 0.55×."
      : lodMode === "full"
        ? "Detail: full, at every zoom. Click for plates without knobs."
        : "Detail: plates, titles and jacks only. Click to go back to automatic.";
}
$("rack-lod").onclick = () => {
  lodMode = lodMode === "auto" ? "full" : lodMode === "full" ? "compact" : "auto";
  try { localStorage.setItem("ricercar-lod", lodMode); } catch (_) {}
  syncLodBtn();
  renderRack();
};
syncLodBtn();

// ---------- fits and moves ----------
function cancelTween() {
  if (viewTween != null) cancelAnimationFrame(viewTween);
  viewTween = null;
}

/** Move the camera to `t` over ~180ms. Short enough not to be a wait, long
 *  enough that the player's eye tracks the patch instead of re-finding it.
 *  `ease` overrides the default curve: when the rack itself is moving, the
 *  camera rides the *rack's* curve and duration, so a structural edit is one
 *  motion rather than a fit racing a relayout. */
function tweenView(t, ms, ease) {
  cancelTween();
  if (prefersStill()) { Object.assign(view, t); applyView(); return; }
  const from = { x: view.x, y: view.y, zoom: view.zoom };
  const t0 = performance.now();
  const dur = ms || 180;
  const curve = ease || ((u) => 1 - (1 - u) * (1 - u) * (1 - u)); // ease-out cubic
  const step = (now) => {
    const u = clamp((now - t0) / dur, 0, 1);
    const e = curve(u);
    // Zoom interpolates geometrically: linear zoom on a big change ramps the
    // apparent speed instead of holding it, which is what makes a fit feel
    // like a lurch.
    view.zoom = from.zoom * Math.pow(t.zoom / from.zoom, e);
    view.x = from.x + (t.x - from.x) * e;
    view.y = from.y + (t.y - from.y) * e;
    applyView();
    viewTween = u < 1 ? requestAnimationFrame(step) : null;
  };
  viewTween = requestAnimationFrame(step);
}

// What the bezel may cost the patch, as a fraction of the frame along the axis
// the fit clears it on. A third of a short frame handed to the scope draws the
// circuit too small to read; this is where that trade turns.
const SCOPE_CAP = 0.38;
// …and how far the bezel may be shrunk in service of it. Below this it stops
// being an instrument and becomes a smudge, and the honest answer is the old
// one: let it sit over the corner, where the player can move either one.
const SCOPE_MIN_SCALE = 0.4;

/** Hold the bezel inside the cap by *shrinking* it, so that the reserve below
 *  never has to be skipped. This used to be a bail-out: a bezel over the cap
 *  meant no reserve at all, so the size control had a cliff in it — at
 *  1700×1000 an L bezel is 41% of the rack frame, the reserve was skipped
 *  entirely, and the fit put four plates underneath the glass. A guarantee
 *  with a hole in it at one
 *  setting is not a guarantee, and "the trace is over the module I am reading"
 *  is exactly the complaint the reserve exists to answer. So the scope
 *  degrades instead: it keeps its proportions and its corner, and gives up
 *  only the size it cannot have. */
function scopeCapBezel(shell, fr) {
  const cur = parseFloat(shell.style.getPropertyValue("--scope-scale")) || 1;
  const r = shell.getBoundingClientRect();
  if (!r.width || !r.height) return;
  // Every dimension in the size classes carries the factor, so the natural
  // size is what is on screen divided by it — no second measurement, and no
  // copy of the CSS in here.
  const natW = r.width / cur;
  const natH = r.height / cur;
  // The reserve only ever clears one axis, so the bezel only has to fit under
  // the cap on one of them: take whichever costs the least shrinking.
  const s = clamp(
    Math.max((SCOPE_CAP * fr.width - 14) / natW, (SCOPE_CAP * fr.height - 14) / natH),
    SCOPE_MIN_SCALE,
    1,
  );
  if (Math.abs(s - cur) > 0.005) {
    shell.style.setProperty("--scope-scale", s.toFixed(3));
    // The canvas is sized in percentages of the bezel, so it has just been
    // re-backed at a new pixel size and blanked. A parked scope has no frame
    // coming to repaint it; the running one repaints itself in a sixtieth of
    // a second either way.
    if (scopeRaf == null) scopeApply();
  }
}

/** The band the scope's bezel occupies, as padding the fit has to respect.
 *  The scope is parented to the frame, so it cannot desync under a pan any
 *  more — but a corner overlay over an auto-fitted patch will still sit on a
 *  plate, and "the trace is over the module I am reading" is the complaint.
 *  A fit that lands the patch beside the scope instead of under it is the
 *  cheap ninety percent: the overlap can still be created by hand, with a
 *  pan or a zoom, and that is a place the player put it. */
function scopeReserve() {
  const z = { l: 0, r: 0, t: 0, b: 0 };
  const shell = $("scope-shell");
  const frame = $("rack-frame");
  if (!shell || !frame || shell.classList.contains("hidden")) return z;
  const fr = frame.getBoundingClientRect();
  if (!fr.width) return z;
  scopeCapBezel(shell, fr);
  const sr = shell.getBoundingClientRect();
  if (!sr.width) return z;
  // Push the patch out of the scope's way along whichever axis costs less —
  // a corner-anchored box only ever has to be cleared one way.
  const overW = sr.width + 14;
  const overH = sr.height + 14;
  // The cap holds by construction now, except on a frame so small that even a
  // shrunken bezel eats it — where skipping the reserve is still the right
  // answer, because there is no fit left to protect.
  if (Math.min(overW / fr.width, overH / fr.height) > SCOPE_CAP + 0.005) return z;
  if (overW <= overH) {
    if (sr.left - fr.left < fr.right - sr.right) z.l = overW; else z.r = overW;
  } else {
    if (sr.top - fr.top < fr.bottom - sr.bottom) z.t = overH; else z.b = overH;
  }
  return z;
}

function fitBox(box, animate, coMotion) {
  const { w, h } = frameSize();
  const pad = 20;
  const ins = scopeReserve();
  const availW = Math.max(80, w - pad * 2 - ins.l - ins.r);
  const availH = Math.max(80, h - pad * 2 - ins.t - ins.b);
  const z = clamp(
    Math.min(availW / Math.max(1, box.w), availH / Math.max(1, box.h)),
    FIT_MIN,
    FIT_MAX,
  );
  // Centre in what is left, not in the whole frame: the reserve is only a
  // reserve if the content is actually placed beside it.
  const cx = pad + ins.l + availW / 2;
  const cy = pad + ins.t + availH / 2;
  const t = { zoom: z, x: box.x + box.w / 2 - cx / z, y: box.y + box.h / 2 - cy / z };
  // …but the reserve is the weaker of the two promises. At the floor the patch
  // can be bigger than what the reserve leaves, and centring it in a box it
  // overflows spills it equally both ways — half of that spill going straight
  // off the frame, which is how a scope in a *top* corner put a plate fifteen
  // pixels below the bottom edge. So: if the patch fits the frame at all, it is
  // held inside the frame, and the reserve gets whatever is left. A plate under
  // the glass is a nuisance; a plate off the edge is gone.
  const fit = (lo, hi, v) => (lo <= hi ? clamp(v, lo, hi) : v);
  t.x = fit(box.x + box.w - (w - pad) / z, box.x - pad / z, t.x);
  t.y = fit(box.y + box.h - (h - pad) / z, box.y - pad / z, t.y);
  viewUserSet = false;
  if (animate) tweenView(t, coMotion ? MOTION_MS : 180, coMotion ? EASE_MOTION : null);
  else { Object.assign(view, t); applyView(); }
}
function fitAll(animate) {
  if (!wb.rack) return;
  fitBox(contentBox(), animate);
  nbAnnounce?.(`fit — ${Math.round(view.zoom * 100)}%`);
}
/** Fit "the selection". There is no selection object yet (that arrives with
 *  node identity), so the honest reading is: whatever the keyboard is on. */
function fitSelection(animate) {
  if (!wb.rack) return;
  // The plate is a tabstop in its own right — the whole structural keyboard
  // hangs off it — and it was the one focus this could not read, so a player
  // arrowing between modules got fit-all from a key that promises the
  // opposite. `closest` still finds the innermost match, so a focused knob is
  // answered with its knob's key rather than its plate's.
  const el = document.activeElement?.closest?.("[data-addr], .jack, g[data-key]");
  const key = el && (el.dataset?.addr?.split("#")[0] || el.getAttribute("data-modkey") ||
    (el.getAttribute("data-childkey") || "").replace(/\/[01]$/, "") ||
    el.getAttribute("data-key"));
  const b = key && rackBoxes.get(key);
  if (!b) return fitAll(animate);
  fitBox({ x: b.x - 40, y: b.y - 40, w: b.w + 80, h: b.h + 80 }, animate);
}
function zoomAt(clientX, clientY, factor) {
  const before = clientToRack(clientX, clientY);
  // The hand keeps its own floor — but it cannot be a floor that *lifts* you.
  // A fit is allowed below `ZOOM_MIN` to contain a big patch, and clamping to
  // it here would turn the next scroll-out over that patch into a zoom *in*,
  // which is the control doing the opposite of what it was pushed to do.
  const z = clamp(view.zoom * factor, Math.min(ZOOM_MIN, view.zoom), ZOOM_MAX);
  if (z === view.zoom) return;
  cancelTween();
  view.zoom = z;
  // Put the same rack point back under the same pixel: that identity is the
  // whole of "anchored at the cursor", and it is why this cannot be a zoom
  // followed by a centring.
  const after = clientToRack(clientX, clientY);
  view.x += before.x - after.x;
  view.y += before.y - after.y;
  viewUserSet = true;
  applyView();
}
/** Give up a text field's focus in favour of the canvas. Only text entry is
 *  taken: a focused knob or plate is a tabstop the player is deliberately on,
 *  and the rack frame — not the body — receives the focus so the keyboard
 *  stays somewhere meaningful. */
function releaseTextEntry() {
  const a = document.activeElement;
  if (!a || !a.matches?.("input:not([type=range]), select, textarea, [contenteditable]")) return;
  a.blur();
  const frame = $("rack-frame");
  if (!frame) return;
  if (!frame.hasAttribute("tabindex")) frame.setAttribute("tabindex", "-1");
  frame.focus({ preventScroll: true });
}

/** Keyboard zoom has no cursor to anchor to, so it anchors the frame centre. */
function zoomStep(factor) {
  const r = $("rack-svg").getBoundingClientRect();
  zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor);
}
function zoomActual() {
  const r = $("rack-svg").getBoundingClientRect();
  zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1 / view.zoom);
}
function panBy(dxClient, dyClient) {
  cancelTween();
  view.x += dxClient / view.zoom;
  view.y += dyClient / view.zoom;
  viewUserSet = true;
  applyView();
}
function contentFullyVisible() {
  const { w, h } = frameSize();
  return view.x <= 1 && view.y <= 1 &&
    view.x + w / view.zoom >= rackContent.w - 1 &&
    view.y + h / view.zoom >= rackContent.h - 1;
}

/** Called after every interactive build. Auto-fit on load and whenever a
 *  structural edit changes the bounding box — animated, so the player is
 *  carried to the new framing rather than teleported. A knob release, a lock
 *  toggle or a bench reply leaves the box alone and so leaves the camera
 *  alone; and once the player has aimed it themselves we only intervene when
 *  the patch has actually grown out of the frame.
 *
 *  `coMotion` says the rack is tweening underneath: the fit then borrows the
 *  motion system's duration and curve so the two arrive together. A 180 ms
 *  ease-out camera over a 260 ms bezier relayout is two animations disagreeing
 *  about where the patch is, which is worse than either alone. */
function aimCamera(coMotion) {
  syncMapBtn();
  const sig = `${Math.round(rackContent.w)}x${Math.round(rackContent.h)}:${rackBoxes.size}`;
  const changed = sig !== camSig;
  camSig = sig;
  // One render whose framing the player has already chosen with their hands —
  // a freeform drop, or "apply grid". The bounding box changed by definition
  // in both cases, and answering that with a fit would move the whole world in
  // reply to a 24px nudge. The signature is still updated, so the *next* real
  // structural edit is compared against what is actually on screen.
  const hold = camHold;
  camHold = false;
  if (!camAimed) { camAimed = true; fitBox(contentBox(), false); return; }
  if (!hold && changed && (!viewUserSet || !contentFullyVisible())) fitBox(contentBox(), true, coMotion);
  else applyView();
}

/** Bring a control into view without the browser's help. `scrollIntoView` and
 *  the implicit scroll-on-focus used to yank the canvas — including on hover,
 *  which moved the rack out from under the pointer that caused it. There is
 *  no scroller left to yank, so explicit navigation pans the camera instead,
 *  by the minimum that makes the control visible. */
function ensureRackVisible(el) {
  if (!el || !wb.rack) return;
  const r = el.getBoundingClientRect();
  const f = $("rack-svg").getBoundingClientRect();
  const m = 36;
  let dx = 0, dy = 0;
  if (r.left < f.left + m) dx = r.left - (f.left + m);
  else if (r.right > f.right - m) dx = r.right - (f.right - m);
  if (r.top < f.top + m) dy = r.top - (f.top + m);
  else if (r.bottom > f.bottom - m) dy = r.bottom - (f.bottom - m);
  if (dx === 0 && dy === 0) return;
  tweenView({ zoom: view.zoom, x: view.x + dx / view.zoom, y: view.y + dy / view.zoom }, 160);
}

// ---------- minimap ----------
// Forty lines of SVG against "lost in a field of nodes", and it doubles as the
// fit-all affordance: the viewport rect is the only place in the app that says
// how much of the patch you are currently looking at.
const MM_W = 172;
const MM_H = 116;
let mmT = null;        // {s, ox, oy} — rack units → map units
let mmBuiltFor = null; // which rackBoxes the node rects were drawn from
let mapOn = localStorage.getItem("ricercar-map") === "1";

function syncMapBtn() {
  const b = $("rack-map-btn");
  const el = $("rack-map");
  if (!b || !el) return;
  const show = mapOn && !!wb.rack;
  el.classList.toggle("hidden", !show);
  b.setAttribute("aria-pressed", String(mapOn));
  b.closest(".tt").title = mapOn ? "Hide the minimap" : "Show the minimap (bottom-left of the rack)";
  if (show) { mmBuiltFor = null; drawMinimap(); }
}
// The chip is dismissible by mouse as well as by esc — a keyboard-only
// escape hatch is not one.
$("pick-chip").querySelector(".pick-chip-x").onclick = () => {
  cancelPending();
  endConnectPick();
  disarm();
};
$("rack-map-btn").onclick = () => {
  mapOn = !mapOn;
  try { localStorage.setItem("ricercar-map", mapOn ? "1" : "0"); } catch (_) {}
  syncMapBtn();
};

function drawMinimap() {
  const el = $("rack-map");
  if (!el || !mapOn || !wb.rack) return;
  const pad = 7;
  const s = Math.min((MM_W - pad * 2) / Math.max(1, rackContent.w), (MM_H - pad * 2) / Math.max(1, rackContent.h));
  mmT = { s, ox: (MM_W - rackContent.w * s) / 2, oy: (MM_H - rackContent.h * s) / 2 };
  // The node rects only change when the rack is rebuilt; the viewport rect
  // changes on every pan frame. Splitting them keeps a pan at two attribute
  // writes instead of an innerHTML reparse per frame.
  if (mmBuiltFor !== rackBoxes) {
    mmBuiltFor = rackBoxes;
    el.setAttribute("viewBox", `0 0 ${MM_W} ${MM_H}`);
    const kinds = new Map((wb.rack.modules || []).map((m) => [m.key, m]));
    const rects = [...rackBoxes.entries()].map(([k, b]) => {
      const m = kinds.get(k);
      const cls = m?.kind === "amp" ? "mm-node amp" : m?.is_mod ? "mm-node mod" : "mm-node";
      return `<rect class="${cls}" x="${(mmT.ox + b.x * s).toFixed(1)}" y="${(mmT.oy + b.y * s).toFixed(1)}" ` +
        `width="${Math.max(1.5, b.w * s).toFixed(1)}" height="${Math.max(1.5, b.h * s).toFixed(1)}" rx="0.8"/>`;
    });
    el.innerHTML = `<g class="mm-nodes">${rects.join("")}</g><rect class="mm-view" id="mm-view" rx="1.5"/>`;
  }
  const vr = $("mm-view");
  if (!vr) return;
  const { w, h } = frameSize();
  // Clamped to the map so a camera pushed off the patch still shows a rect on
  // the side it went — a viewport marker you can lose is worse than none.
  const x0 = clamp(mmT.ox + view.x * s, 0.5, MM_W - 3);
  const y0 = clamp(mmT.oy + view.y * s, 0.5, MM_H - 3);
  const x1 = clamp(mmT.ox + (view.x + w / view.zoom) * s, x0 + 2.5, MM_W - 0.5);
  const y1 = clamp(mmT.oy + (view.y + h / view.zoom) * s, y0 + 2.5, MM_H - 0.5);
  vr.setAttribute("x", x0.toFixed(1));
  vr.setAttribute("y", y0.toFixed(1));
  vr.setAttribute("width", (x1 - x0).toFixed(1));
  vr.setAttribute("height", (y1 - y0).toFixed(1));
}

/** Click or drag the map to put that part of the patch in the middle. */
function mmNavigate(ev) {
  if (!mmT) return;
  const r = $("rack-map").getBoundingClientRect();
  const rx = ((ev.clientX - r.left) * (MM_W / r.width) - mmT.ox) / mmT.s;
  const ry = ((ev.clientY - r.top) * (MM_H / r.height) - mmT.oy) / mmT.s;
  const { w, h } = frameSize();
  cancelTween();
  view.x = rx - w / (2 * view.zoom);
  view.y = ry - h / (2 * view.zoom);
  viewUserSet = true;
  applyView();
}
$("rack-map").addEventListener("pointerdown", (ev) => {
  ev.preventDefault();
  // Same guard as the plate drag: a pointer the browser has already forgotten
  // (a cancelled touch, a synthesised press) throws on capture, and the
  // `pointermove` listener below is on the element either way — so the drag
  // degrades to "while the pointer is over the map" rather than to a throw.
  try { $("rack-map").setPointerCapture(ev.pointerId); } catch (_) {}
  mmNavigate(ev);
});
$("rack-map").addEventListener("pointermove", (ev) => {
  if (ev.buttons & 1) mmNavigate(ev);
});

// ---------- pointer and wheel ----------
let rackHover = false;
let spacePan = false;   // space is down over the rack
let spacePanned = false; // ...and it was used to drag, so it is not an audition

$("rack-scroll").addEventListener("pointerenter", () => { rackHover = true; });
$("rack-scroll").addEventListener("pointerleave", () => { rackHover = false; });

$("rack-scroll").addEventListener("wheel", (ev) => {
  if (!wb.rack) return;
  // The frame has nothing to scroll any more, so the wheel is unambiguously
  // the camera's — and taking it here is also what stops the *page* from
  // scrolling out from under a pinch.
  ev.preventDefault();
  if (ev.ctrlKey || ev.metaKey) {
    // A trackpad pinch arrives as a wheel event with ctrlKey set. That is the
    // entirety of pinch support on the web, and it is why pinch and
    // ctrl+wheel cannot be given different behaviour even if we wanted to.
    zoomAt(ev.clientX, ev.clientY, Math.exp(-ev.deltaY * 0.0022));
    return;
  }
  const k = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? frameSize().h : 1;
  let dx = ev.deltaX * k;
  let dy = ev.deltaY * k;
  if (ev.shiftKey && dx === 0) { dx = dy; dy = 0; } // the mouse-wheel horizontal
  panBy(dx, dy);
}, { passive: false });

// Pan drags. Capture phase, because a knob or a jack under the pointer would
// otherwise claim the same press — the modifier decides, not the target.
$("rack-scroll").addEventListener("pointerdown", (ev) => {
  if (!wb.rack) return;
  // Whatever this press turns out to be, it is a press on the canvas — and the
  // camera gestures below call `preventDefault`, which suppresses the implicit
  // blur a click would otherwise perform. So the node bank's search field kept
  // focus straight through clicking and panning the rack, and every camera key
  // after it went into the text field: `Home` moved the caret instead of
  // fitting the patch, and `.` typed a full stop. Hand the focus back to the
  // thing the gesture is actually about.
  releaseTextEntry();
  const onControl = ev.target?.closest?.("[data-addr], .jack, .mod-menu-btn, .mod-lock");
  // In freeform, a plain press on a faceplate moves the module. Tested after
  // the modifier gestures below would be too late — they are tested here, in
  // order, and space still wins so the pan modifier keeps working over a plate
  // exactly as it does over the canvas. `armed`/`connectPick` win too: while a
  // module is in hand or a cable is half-drawn, a plate is a *destination*.
  if (
    layoutMode === "freeform" && ev.button === 0 && !spacePan && !armed && !connectPick &&
    !onControl && startPlateDrag(ev)
  ) return;
  const wants =
    ev.button === 1 ||                        // middle-drag, everywhere
    (ev.button === 0 && spacePan) ||          // space-drag, the graph-editor idiom
    (ev.button === 0 && !onControl && !armed); // ...and the bare canvas, which is
                                              // the only pan a finger can reach
  if (!wants) return;
  ev.preventDefault();
  ev.stopPropagation();
  spacePanned = spacePan;
  const el = $("rack-scroll");
  el.classList.add("grabbing");
  el.setPointerCapture(ev.pointerId);
  let px = ev.clientX, py = ev.clientY;
  const move = (mv) => {
    panBy(px - mv.clientX, py - mv.clientY);
    px = mv.clientX;
    py = mv.clientY;
  };
  const up = () => {
    el.classList.remove("grabbing");
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", up);
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
}, true);
// Chrome on Windows/Linux answers a middle press with autoscroll unless the
// click that follows is refused too.
$("rack-scroll").addEventListener("auxclick", (ev) => { if (ev.button === 1) ev.preventDefault(); });

// ---------- the plate is the menu's real hit target ----------
// The ⋯ was the *sole* route to every structural verb in the app. It is now a
// discoverability aid: right-click anywhere on a plate — or hold a finger on
// one — and the same menu opens, aimed at the same module. Both gestures are
// what every graph editor and every desktop already trained the hand to do,
// and neither of them needs a 24px target.
function menuForPlate(target, x, y) {
  const g = target?.closest?.("g[data-key]");
  const key = g && g.getAttribute("data-key");
  if (!key || !wb.rack) return false;
  const mod = wb.rack.modules.find((m) => m.key === key);
  if (!mod) return false;
  openStructMenu(mod, x, y);
  return true;
}
$("rack-svg").addEventListener("contextmenu", (ev) => {
  if (!menuForPlate(ev.target, ev.clientX, ev.clientY)) return;
  ev.preventDefault();
});
// Long-press, for the pointer that has no second button. Registered after the
// pan handler on the same element and phase, so the pan's `stopPropagation`
// (which is aimed at the descendants) still leaves this one to run — and a
// press that turns into a drag cancels the timer before it can fire.
$("rack-scroll").addEventListener("pointerdown", (ev) => {
  if (ev.pointerType === "mouse" || ev.button !== 0) return;
  if (ev.target?.closest?.("[data-addr], .jack, .mod-menu-btn, .mod-lock")) return;
  const sx = ev.clientX, sy = ev.clientY;
  let timer = setTimeout(() => {
    timer = null;
    if (menuForPlate(document.elementFromPoint(sx, sy), sx, sy)) {
      // A menu that opens under a finger already resting on the canvas must
      // not also be a pan that started 500 ms ago.
      $("rack-scroll").classList.remove("grabbing");
      if (navigator.vibrate) try { navigator.vibrate(8); } catch (_) {}
    }
  }, 500);
  const cancel = (mv) => {
    if (mv && mv.type === "pointermove" && Math.hypot(mv.clientX - sx, mv.clientY - sy) < 8) return;
    if (timer) clearTimeout(timer);
    timer = null;
    document.removeEventListener("pointermove", cancel);
    document.removeEventListener("pointerup", cancel);
    document.removeEventListener("pointercancel", cancel);
  };
  document.addEventListener("pointermove", cancel);
  document.addEventListener("pointerup", cancel);
  document.addEventListener("pointercancel", cancel);
}, true);

/** Space over the rack is the pan modifier every graph editor has, and space
 *  everywhere is this app's audition toggle. Both survive: over the rack the
 *  key arms a pan, and if it is released without one the audition happens
 *  then. The only cost is that the toggle fires on release instead of press,
 *  which is under the threshold of noticing. */
function rackSpaceDown() {
  if (!rackHover || currentView !== "play" || !wb.rack) return false;
  spacePan = true;
  spacePanned = false;
  $("rack-scroll").classList.add("grabbing");
  return true;
}
function rackSpaceUp() {
  if (!spacePan) return false;
  spacePan = false;
  $("rack-scroll").classList.remove("grabbing");
  if (!spacePanned) toggleAudition();
  return true;
}

// ---------- auto-pan while a cable is out ----------
// The inverse of the hover-scroll that was just removed: the canvas moves when
// the *player* drags something to the edge, and only then. VCV's rule.
let edgePan = null; // {x, y, cx, cy}
let edgeRaf = null;

function edgePanFrom(clientX, clientY) {
  const f = $("rack-svg").getBoundingClientRect();
  const m = 46;
  // Only from inside: dragging *to* the edge asks for more canvas, and a
  // pointer parked out in the node bank is not asking for anything.
  if (clientX < f.left || clientX > f.right || clientY < f.top || clientY > f.bottom) return stopEdgePan();
  const vel = (d) => (d < m ? -((m - Math.max(d, 0)) / m) * 13 : 0);
  const x = vel(clientX - f.left) - vel(f.right - clientX);
  const y = vel(clientY - f.top) - vel(f.bottom - clientY);
  if (x === 0 && y === 0) return stopEdgePan();
  edgePan = { x, y, cx: clientX, cy: clientY };
  if (edgeRaf != null) return;
  const step = () => {
    if (!edgePan || !wire) { edgeRaf = null; return; }
    panBy(edgePan.x, edgePan.y);
    edgeRaf = requestAnimationFrame(step);
  };
  edgeRaf = requestAnimationFrame(step);
}
function stopEdgePan() {
  edgePan = null;
  if (edgeRaf != null) cancelAnimationFrame(edgeRaf);
  edgeRaf = null;
}

// ---------- the frame changed shape ----------
// The node-bank divider changes the frame's width without a window resize, and
// nothing refit — the patch just got clipped. There was no ResizeObserver
// anywhere in the app; this is the one place that needs one.
let roSettled = false;
new ResizeObserver(() => {
  // The scope's canvas is sized in percentages of this same frame, so a
  // resize re-backs it at a new pixel size and blanks whatever was on it.
  // Repaint before the refit, which is about to read the bezel's new box.
  if (scopeRaf == null) scopeApply();
  if (!roSettled) { roSettled = true; return; } // the observer's own first call
  if (!wb.rack) return;
  if (viewUserSet && !contentFullyVisible()) applyView();
  else fitBox(contentBox(), camAimed);
}).observe($("rack-scroll"));

// ---------- structural edits ----------
// Structural edits are strictly serialized, one in flight at a time.
//
// Two reasons, and the second is the one with a body count. Every op addresses
// a node by its *position* in the tree, so an op built against the tree on
// screen and applied after another op has already reshaped that tree does not
// mean what the player meant — it means whatever now happens to live at that
// key. And the persisted console log from earlier builds carries
// `recursive use of an object detected … at WasmEngine.edit_structure`, which
// is what overlapping calls into one wasm object look like from the outside.
// Queue rather than drop: the ops came from deliberate gestures, and each is
// re-sent only once the tree it will land on is the tree it was aimed at.
let structInFlight = false;
const structQueue = [];
/** Post a structural op. `landed` is what it earns *if the engine accepts it* —
 *  `{text, opts}` for the confirmation, `{drop}` for a HELD entry that is only
 *  really gone once the module is really in the patch. See `landedNote`;
 *  neither is spent here. */
function sendStruct(op, landed) {
  queueStruct({ type: "edit_structure", op }, landed || null);
}
function queueStruct(msg, landed, tag) {
  if (structInFlight) {
    // Deliberately shallow. This is a hand at a menu, not a stream; a backlog
    // deeper than a rapid double-click means the worker is wedged, and
    // replaying a minute of stale intent into a tree that has moved on is
    // worse than saying so.
    if (structQueue.length >= 8) {
      return note("still applying the last edit — give it a moment");
    }
    // The confirmation travels with the op rather than being said now, for the
    // same reason it waits on the reply: nothing has happened yet. It cannot
    // ride *on* `msg`, which is structured-cloned to the worker and would
    // choke on the undo closure.
    structQueue.push({ msg, landed: landed || null, tag });
    // Waiting its turn is still in flight as far as the shelf is concerned.
    if (landed && landed.drop != null) setTrayPending(landed.drop, true);
    // Nothing went out, so nothing may be charged to the edit that is out.
    stagingBound = null;
    return;
  }
  structInFlight = true;
  bindLanded(landed);
  if (landed && landed.drop != null) setTrayPending(landed.drop, true);
  stageUndo();
  beliefStale();
  // Both halves of WS-8 §3's edit row come from here, because this is the one
  // place every structural gesture in the app funnels through: the op that is
  // about to happen, and the module it is about to happen to. A whole-tree
  // rewrite has no `StructOp` to report — it *is* the tree — so it says so
  // rather than inventing one.
  pendingEditTag = editTagOf(msg, tag);
  logImplicit("edit", pendingEditTag);
  send(msg);
}

/** `{op, kind, key}` for a structural message, from the payload the engine is
 *  about to be handed. `node`/`m` carry an explicit fragment whose serde tag
 *  is the module kind (`{"Reverb":{…}}`).
 *
 *  A client-side rewrite has no `StructOp` to report — it *is* a tree — so it
 *  carries the verb the player used instead. "duplicate" and "bypass" are
 *  real gestures with real intent behind them, and logging nine different ones
 *  as `set_tree` would throw away the only thing that distinguishes them. */
function editTagOf(msg, tag) {
  if (msg.type !== "edit_structure") return tag || { op: "set_tree" };
  const o = msg.op || {};
  const frag = o.node || o.m;
  return {
    op: o.op || "?",
    key: o.key,
    kind: o.kind || (frag && frag !== "None" ? nodeTag(frag) : undefined),
  };
}

// ---------- locks, keyed by node identity ----------
// A lock used to be a trace address (`node/0#cut`), and a trace address is a
// *position*: insert one module upstream and every key below it shifts a
// segment, delete a mixer branch and the survivor is re-rooted, run one
// generation and the tree is rebuilt from a trace that never saw the object
// graph. Under positional keys the only honest answer to a structural edit was
// to throw the locks away — and that broke the single loop this editor exists
// to serve: hand-build a routing, pin it, breed around it. Phase 1 bought time
// with per-op key remapping (a table of eight `StructOp` remappings, plus a
// second copy of the same reasoning inside `applyTreeRewrite` that tracked
// node objects by reference) and still cleared on ⚡ evolve, which is the one
// place it mattered most.
//
// The term now carries a `uid` on every node — minted in the engine, preserved
// by `apply_struct_op`, inherited by refinement (`PatchTree::inherit_uids`),
// and echoed onto every `RackModule` — so a lock can name the module instead
// of its address. All of the remapping is gone. Locks survive insert, delete,
// reconnect, undo, redo and ⚡ evolve, and are lost only when the module they
// name is actually gone.
//
// A lock id is `<uid><suffix-within-the-module>#<site>`: `41#cut` for a knob,
// `41/m#mod` for the empty modulation slot a module guards (whose address
// hangs below the module's own key). The `amp` pseudo-module is not a node at
// all — the envelope wraps the term — so it has no uid and its addresses ride
// through unchanged, which is also why they survive everything.

// Locks per patch, and across reloads. `wb.locks` is the set for whatever is
// on the bench; this is every set the session has produced, keyed by subject
// id, and it is what rides in the `ui` blob. Two things it buys, in order of
// how much they were missed:
//
//  1. A reload keeps your pins. The plan's loop is hand-build, pin, breed —
//     and half of it evaporated on every refresh, with no sign that it had.
//  2. Benching a patch you had pinned before gives them back. Locks were only
//     ever carried *forward* (a commit, a ⚡ child); going back to a patch in
//     the bank arrived at a rack with the dots dark and nothing to say why.
//
// Persisting them is only honest because a lock names a node. Under the old
// trace-address keys a restored lock would have pinned whatever had since
// moved into that address — which is the failure mode the whole identity pass
// exists to have ended.
const lockStore = new Map();
const LOCK_KEEP = 60; // same order as the layout store; the bank holds 40

function lockKey() {
  return wb.subjectId == null ? "bench" : String(wb.subjectId);
}

/** Write the bench's locks back to the store, and ask for a save. Every
 *  mutation of `wb.locks` goes through here — a lock nobody wrote down is a
 *  lock that survives until the tab closes, which is the bug. */
function locksRemember() {
  const k = lockKey();
  // Nothing changed, nothing to write — and nothing to save. This is called on
  // every bench reply as well as every toggle, and a save round trip per patch
  // click for a set that is identical to the one already stored is a cost
  // paid for no information.
  const prev = lockStore.get(k);
  const same = wb.locks.size === (prev ? prev.size : 0) &&
    (!prev || [...wb.locks].every((id) => prev.has(id)));
  if (same) return;
  if (wb.locks.size) {
    lockStore.delete(k); // re-insert, so eviction order stays recency order
    lockStore.set(k, new Set(wb.locks));
    while (lockStore.size > LOCK_KEEP) lockStore.delete(lockStore.keys().next().value);
  } else {
    // An empty set is not a set worth keeping: "no locks" is what an absent
    // entry already means, and keeping it would let a cleared patch evict a
    // pinned one.
    lockStore.delete(k);
  }
  scheduleSave();
}

/** Give a patch back the locks it had, if the bench arrived without any. The
 *  guard is the whole of the rule: a non-empty set here was *carried* — by a
 *  commit or by ⚡ — and carried locks are the live ones, so the store never
 *  overwrites them. */
function locksRestoreFor(id) {
  if (wb.locks.size) return;
  const saved = lockStore.get(String(id));
  if (!saved || !saved.size) return;
  wb.locks = new Set(saved);
  // Against this rack, not the one they were set on: the store can outlive a
  // patch's own eviction and reuse of an id, and a lock that names nothing
  // here has to go rather than sit in the count as a phantom.
  pruneLocks();
}

/** The inverse of the `ui` blob's `locks`, tolerant of a save from before it
 *  existed — which is every save on disk right now. */
function restoreLocks(saved) {
  if (!Array.isArray(saved)) return;
  for (const [id, list] of saved) {
    if (!Array.isArray(list) || !list.length) continue;
    lockStore.set(String(id), new Set(list.filter((x) => typeof x === "string")));
  }
  while (lockStore.size > LOCK_KEEP) lockStore.delete(lockStore.keys().next().value);
}

/** Address ↔ identity, both ways, for the rack currently on the bench.
 *  Rebuilt lazily and thrown away whenever `wb.rack` is replaced, because
 *  every address in it is only meaningful against that one rack. */
let lockIndex = null;
function lockIndexOf() {
  if (lockIndex) return lockIndex;
  const byAddr = new Map();
  const byId = new Map();
  for (const m of wb.rack ? wb.rack.modules : []) {
    if (!m.uid) continue; // the amp
    for (const a of [...m.structural_addrs, ...m.knobs.map((k) => k.addr)]) {
      // Everything the module owns hangs off its key, so what is left after
      // the key is exactly what does *not* move when the module does.
      if (!a.startsWith(m.key)) continue;
      const id = m.uid + a.slice(m.key.length);
      byAddr.set(a, id);
      byId.set(id, a);
    }
  }
  lockIndex = { byAddr, byId };
  return lockIndex;
}

/** Trace address → lock id. Addresses with no node under them (the amp's) are
 *  their own id: nothing can move them, so nothing needs to track them. */
function lockIdOf(addr) {
  return lockIndexOf().byAddr.get(addr) || addr;
}

/** Lock id → the trace address it names *right now*, or null if that module is
 *  no longer in the patch. */
function lockAddrOf(id) {
  const a = lockIndexOf().byId.get(id);
  if (a) return a;
  return /^\d/.test(id) ? null : id;
}

/** Is this trace address locked? The question every plate and knob asks. */
function isLockedAddr(addr) {
  return wb.locks.has(lockIdOf(addr));
}

/** Set or clear the lock on a trace address. */
function setLock(addr, on) {
  const id = lockIdOf(addr);
  if (on) wb.locks.add(id);
  else wb.locks.delete(id);
  locksRemember();
}

/** The locked set as trace addresses against the current rack — what
 *  `buildRack` draws from and what `refine_from` sends to the engine, which
 *  knows only positions. */
function lockedAddrs() {
  const out = new Set();
  for (const id of wb.locks) {
    const a = lockAddrOf(id);
    if (a) out.add(a);
  }
  return out;
}

/** Drop the locks whose module is gone, and report how many. The whole of
 *  "carrying locks through an edit" now: everything else simply stays. */
function pruneLocks() {
  let dropped = 0;
  for (const id of [...wb.locks]) {
    if (lockAddrOf(id) === null) {
      wb.locks.delete(id);
      dropped += 1;
    }
  }
  return dropped;
}

function drainStruct() {
  if (structInFlight) return;
  if (structQueue.length) {
    const q = structQueue.shift();
    queueStruct(q.msg, q.landed, q.tag);
    return;
  }
  // The lane is clear, so a ⌘Z burst that piled up behind it may take its next
  // step — one per reply, each read off the stack as it stands now.
  if (restoreBacklog === 0) return;
  const kind = restoreBacklog > 0 ? "undo" : "redo";
  restoreBacklog -= restoreBacklog > 0 ? 1 : -1;
  performRestore(kind);
}

// ---------- client-side tree rewrites ----------
// `StructOp` has no `Move`, and most of the connection grammar is moves:
// reconnect an output into another socket, promote a branch over its parent,
// join a second source through a Mix. Expressed as op pairs those cost two
// renders, two vets and two undo steps for one gesture — and the tree in
// between is one the player never asked to hear.
//
// So the rewrite happens here, on a copy of the bench tree, and goes back as
// one whole-tree replace: one round trip, one atomic undo step, one
// re-render. The engine now validates on the way in (`validate_tree`, the
// MAX_SIZE / MAX_DEPTH / MAX_MOD_DEPTH ceilings this route used to skip
// entirely), so a rewrite that would put the patch outside the prior's
// support comes back as `edit_rejected` carrying the reason, rather than as a
// patch the next ⚡ silently mutates back inside the ceilings.
//
// `fn(tree, marks)` mutates the clone in place. Returning a **string** is a
// refusal and that string is what the player is told — never a silent no-op.
// `tag` names the gesture for the implicit stream (WS-8 §3), because the wire
// message is only ever "here is a tree" and the intent behind it — duplicate,
// bypass, reconnect, unplug — is exactly what a later model would want.
function applyTreeRewrite(fn, tag) {
  if (!wb.tree) { note("no patch on the bench"); return false; }
  // Deliberately NOT queued, unlike an op. An op is a description of an edit
  // and is re-aimed at whatever tree it lands on; a whole-tree replace *is* a
  // tree, computed from the one on screen. Held until the tree has moved on,
  // it would post a patch that silently discards the edit in front of it.
  if (structInFlight) {
    note("still applying the last edit — give it a moment");
    return false;
  }
  const tree = JSON.parse(JSON.stringify(wb.tree));
  const marks = [];
  for (const k of placeholderKeys) {
    const n = nodeAtIn(tree, k);
    if (n) marks.push(n);
  }
  // Locks need nothing here any more. A rewrite moves subtrees by reference
  // and each of those nodes carries its own `uid` in the JSON being moved, so
  // the identity travels inside the thing that travelled — the tracking this
  // function used to do (anchor every locked node, walk the mutated tree, ask
  // where each object landed) was reconstructing exactly that, by hand,
  // because the node had no name of its own.
  const refusal = fn(tree, marks);
  if (typeof refusal === "string") { note(refusal); return false; }
  placeholderPending = keysOfNodes(tree, marks);

  queueStruct({ type: "edit_set_tree", json: JSON.stringify(tree) }, null, tag);
  return true;
}

// ---------- empty sockets ----------
// An unplugged socket has to look empty. The grammar cannot express that: the
// term is total, every input is filled, and adding a `Silence` production
// would move φ_struct's family counts and cost an evolution revalidation run
// (WS-1 §7, and the standing rule that a green `make check` says nothing
// about search health). So the engine keeps its substitute node and the UI
// knows which one it is: a plate drawn as a hole, and the first place the
// next module wants to go.
//
// Tracked by key, which is a position, so it survives exactly as long as the
// positions do — every rewrite carries it across by object identity, and any
// edit that goes through the op path drops it. Making it survive a reload is
// the `uid` work in phase 2.
let placeholderKeys = new Set();
let placeholderPending = null;

function placeholderNode() { return SEED_VCO(); }
function isPlaceholderKey(key) { return placeholderKeys.has(key); }

// ---------- the structure menu ----------
// It was nineteen flat items, fourteen of which were the modulator inventory
// reprinted from the node bank — with `delete` last, and on a short window
// below the fold entirely. The module *vocabulary* lives in exactly one place
// now (MODULES / the node bank), so this menu carries only **verbs** and hands
// the nouns off to the rail, which has their glyphs, their one-line blurbs,
// their ports and their θ±σ.
//
// Seven verbs, in the order a patch is actually edited — replace · insert
// before · insert after · duplicate · extract to HELD · bypass · delete — plus
// `modulate → <port>` as a single row that arms the rail filtered to the amber
// sorts, and, on the six binaries only, the one op that is meaningless
// anywhere else. `delete` is fenced off behind a rule and printed in the red
// the rest of the app reserves for loss.
function openStructMenu(mod, x, y) {
  if (mod.kind === "amp") {
    // A one-item menu is not a menu; it is a button wearing one. The amp's ⋯
    // has exactly one thing to offer, so it performs it.
    armFromRack("insert", "node");
    return;
  }
  if (mod.is_mod) {
    // A modulator is edited through the slot it sits in, which belongs to its
    // parent — that is why these rows name the parent's key.
    const parentKey = mod.key.replace(/\/m$/, "");
    const owner = rackKindAt(parentKey) || "";
    const port = kindModTarget(owner) || "?";
    showMenu(x, y, {
      glyph: MOD_BY_KIND[mod.kind]?.glyph,
      title: mod.title || kindName(mod.kind),
      sub: `modulating ${kindName(owner)} → ${port}`,
    }, [
      {
        label: "replace with…",
        sub: "pick another modulator from the rail",
        run: () => armFromRack("insert", parentKey, { accepts: ["mod"], verb: "modulate" }),
      },
      {
        label: "unplug this modulator",
        sub: "it goes to HELD; the knob stops moving",
        danger: true,
        sep: true,
        run: () => unplugMod(parentKey),
      },
    ]);
    return;
  }

  const key = mod.key;
  const node = nodeAtKey(key);
  const spec = MOD_BY_KIND[mod.kind];
  const fields = childFields(spec || {});
  const ins = fields.length;
  const inNames = spec?.inNames || (ins === 2 ? ["a", "b"] : ["in"]);
  const rows = [];
  rows.push({
    label: "replace with…",
    sub: "keeps what feeds it",
    run: () => armFromRack("replace", key),
  });
  rows.push({
    label: "insert before…",
    sub: ins === 0 ? "" : `a new module between ${inNames[0]} and this`,
    disabled: ins === 0,
    why: "a source has no input — there is no wire on this side of it",
    run: () => armFromRack("insert", `${key}/0`, { verb: "insert before", aim: key }),
  });
  rows.push({
    label: "insert after…",
    sub: "a new module between this and what it feeds",
    run: () => armFromRack("insert", key),
  });
  rows.push({
    label: "duplicate",
    sub: ins === 0 ? "" : "a second one, in series, with the same settings",
    disabled: ins === 0,
    why: "a source has nothing to chain into — branch from its out ○ instead",
    run: () => duplicateModule(key),
  });
  rows.push({
    label: "extract to HELD",
    sub: "leaves the socket empty; drag it back any time",
    run: () => extractModule(key),
  });
  rows.push({
    label: "bypass",
    sub: ins === 0 ? "" : `${inNames[0]} passes straight through`,
    disabled: ins === 0,
    why: "a source generates the signal — there is nothing to pass through it",
    run: () => bypassModule(key),
  });
  const port = kindModTarget(mod.kind);
  if (port) {
    rows.push({
      label: `modulate → ${port}`,
      sub: modAtKey(key)
        ? `replaces the ${fragLabel(modAtKey(key), true)} already on it`
        : "arms the rail at the modulators",
      run: () => armFromRack("insert", key, { accepts: ["mod"], verb: "modulate" }),
    });
  }
  if (ins === 2) {
    rows.push({
      label: "swap the two inputs",
      sub: `${inNames[0]} ⇄ ${inNames[1]}`,
      // The one structural verb in this menu that said nothing at all. On a
      // ducker or a vocoder it is the difference between the two patches, and
      // on a mix it is inaudible — either way the player is owed a receipt and
      // the undo that goes with it. Like every other confirmation here it is
      // said on the reply, so a refused swap stays silent.
      run: () => sendStruct({ op: "swap_mix", key }, {
        text: `${plateTitle(key)}: ${inNames[0]} and ${inNames[1]} swapped.`,
        opts: { undo: doUndo, undoLabel: "swap them back" },
      }),
    });
  }
  rows.push({
    label: "delete",
    sub: deleteBlurb(key, node, fields, inNames),
    danger: true,
    sep: true,
    run: (ev) => deleteModule(key, ev.clientX || x, ev.clientY || y),
  });
  showMenu(x, y, {
    glyph: spec?.glyph,
    title: isPlaceholderKey(key) ? "empty" : mod.title || kindName(mod.kind),
    sub: `${mod.knobs?.length || 0} knobs · ${subtreeSize(node || {})} modules from here down`,
  }, rows);
}

/** One line, said before the click, about what `delete` is going to cost. */
function deleteBlurb(key, node, fields, inNames) {
  if (!node) return "";
  const tag = nodeTag(node);
  if (fields.length === 2) {
    const a = subtreeSize(node[tag][fields[0]] || {});
    const b = subtreeSize(node[tag][fields[1]] || {});
    return `two inputs — you choose which survives (${inNames[0]} ${a}, ${inNames[1]} ${b})`;
  }
  const par = parentOfKey(key);
  if (par && par.binary) {
    return `takes this whole branch and the ${kindName(rackKindAt(par.key))} above it`;
  }
  return fields.length === 0 ? "a lone source cannot be deleted" : "one module; what it feeds moves up";
}

/** The parent of a trace key, and whether that parent is one of the six
 *  binaries — which is the fact that decides what `delete` really destroys. */
function parentOfKey(key) {
  if (key === "node") return null;
  const pk = key.slice(0, key.lastIndexOf("/"));
  const p = nodeAtKey(pk);
  if (!p) return null;
  return { key: pk, node: p, binary: childFields(MOD_BY_TAG[nodeTag(p)] || {}).length === 2 };
}

// ---------- the destructive verbs, staged and named ----------
// The rule the whole group is written to: **"removed" always means
// "recoverable without ⌘Z"**. Every one of these puts what it took on the
// HELD shelf *before* the edit goes out, names the loss in the toast in the
// patch's own words, and hangs an inline undo off it — because the player who
// needs the undo is the one who has just discovered that the verb meant
// something bigger than they thought, and hunting for a keystroke is not the
// moment to learn one.

/** A module without the chain under it: its primary input is swapped for a
 *  bare source, which `insert_tree`'s graft overwrites with whatever socket it
 *  is dropped into. So a head put on the shelf comes back with its own
 *  parameters and lands *in* a wire rather than over it. */
function headFragment(node) {
  const tag = nodeTag(node);
  const f = childFields(MOD_BY_TAG[tag] || {});
  const clone = JSON.parse(JSON.stringify(node));
  if (f.length > 0) clone[tag][f[0]] = SEED_VCO();
  return clone;
}

/** A second one in series, same settings. The clone's own copy of the input is
 *  thrown away and the *original* node is spliced under it, so this costs one
 *  module (plus a binary's second branch), not a whole second chain. */
function duplicateModule(key) {
  const here = nodeAtKey(key);
  if (!here) return note("that module has moved");
  const name = kindName(rackKindAt(key)) || fragLabel(here, false);
  const ok = applyTreeRewrite((tree) => {
    const node = nodeAtIn(tree, key);
    if (!node) return "that module has moved — try again";
    const tag = nodeTag(node);
    const f = childFields(MOD_BY_TAG[tag] || {});
    if (f.length === 0) return "a source has nothing to chain into — branch from its out ○ instead";
    const dup = JSON.parse(JSON.stringify(node));
    dup[tag][f[0]] = node;
    if (!setNodeAtIn(tree, key, dup)) return "that module has moved — try again";
    return null;
  }, { op: "duplicate", key, kind: rackKindAt(key) });
  if (!ok) return;
  noteOnLanding(`a second ${name} now sits after the first, with the same settings.`,
    { undo: doUndo, undoLabel: "take it out" });
}

/** Take the module and everything under it off the patch and onto the shelf,
 *  leaving the socket visibly empty. The unplug gesture, from the menu. */
function extractModule(key) {
  const here = nodeAtKey(key);
  if (!here) return note("that module has moved");
  // Named before the rewrite goes out, off the rack the player is looking at.
  const what = chainTitle(key);
  let doomed = null;
  const ok = applyTreeRewrite((tree, marks) => {
    const node = nodeAtIn(tree, key);
    if (!node) return "that module has moved — try again";
    const hole = placeholderNode();
    if (!setNodeAtIn(tree, key, hole)) return "that module has moved — try again";
    if (!marks.includes(node)) doomed = node;
    marks.push(hole);
    return null;
  }, { op: "extract", key, kind: rackKindAt(key) });
  if (!ok) return;
  const uid = doomed ? stageFragment(doomed, false) : null;
  noteOnLanding(
    doomed
      ? `${what} is held below — the socket is empty.`
      : "the socket is empty.",
    { undo: () => { if (uid != null) unstage(uid); doUndo(); }, undoLabel: "put it back" },
  );
}

/** Bypass, the verb every DAW user reaches for, as a client-side rewrite: the
 *  module's first input is routed straight through to whatever it fed, and the
 *  module itself — parameters and all — goes to HELD flagged `rewrap`, so
 *  dropping it back on a ○ splices it in rather than over. That is the
 *  un-bypass, and it restores the settings, which is the whole point of
 *  bypassing rather than deleting. (A side map keyed by `uid` is the phase-2
 *  version; the shelf is what there is until a node has an identity.) */
function bypassModule(key) {
  const here = nodeAtKey(key);
  if (!here) return note("that module has moved");
  const name = kindName(rackKindAt(key)) || fragLabel(here, false);
  const f = childFields(MOD_BY_TAG[nodeTag(here)] || {});
  if (f.length === 0) return note(`${name} generates the signal — there is nothing to pass through it.`);
  const lost = f.length === 2 ? subtreeSize(here[nodeTag(here)][f[1]] || {}) : 0;
  let head = null;
  const ok = applyTreeRewrite((tree) => {
    const node = nodeAtIn(tree, key);
    if (!node) return "that module has moved — try again";
    const tag = nodeTag(node);
    const ff = childFields(MOD_BY_TAG[tag] || {});
    const through = node[tag][ff[0]];
    if (!through) return "there is nothing plugged into it to pass through";
    head = headFragment(node);
    if (!setNodeAtIn(tree, key, through)) return "that module has moved — try again";
    return null;
  }, { op: "bypass", key, kind: rackKindAt(key) });
  if (!ok) return;
  const inNames = MOD_BY_KIND[rackKindAt(key)]?.inNames;
  const uid = head ? stageFragment(head, false, { rewrap: true, note: "bypassed" }) : null;
  noteOnLanding(
    lost > 1
      ? `${name} bypassed — its ${inNames ? inNames[1] : "second"} branch (${lost} modules) is held with it.`
      : `${name} bypassed — it is held below with its settings; drag it back onto a ○ to switch it in again.`,
    { undo: () => { if (uid != null) unstage(uid); doUndo(); }, undoLabel: "switch it back in" },
  );
}

/** `delete` on a binary used to silently eat one of its two branches: the
 *  engine keeps the primary input and drops the other, and nothing on screen
 *  said which one or how big it was. So the loss is pre-flighted here — the UI
 *  knows `MODULES[kind].ins` and it knows the tree — named, and *chosen*. */
function deleteModule(key, x, y) {
  const node = nodeAtKey(key);
  if (!node) return note("that module has moved");
  const tag = nodeTag(node);
  const spec = MOD_BY_KIND[rackKindAt(key)] || MOD_BY_TAG[tag];
  const f = childFields(spec || {});
  const name = kindName(rackKindAt(key)) || fragLabel(node, false);

  if (f.length === 2) {
    const names = spec?.inNames || ["a", "b"];
    return openChooser(x, y, `delete ${name} — which input survives?`, [0, 1].map((i) => {
      // Both branches are plates on screen, so both are named the way the rack
      // names them — a survivor choice is exactly the wrong place to make the
      // player decode a label they have never been shown.
      const keepName = plateTitle(`${key}/${i}`);
      const dropSize = subtreeSize(node[tag][f[1 - i]] || {});
      return {
        label: `delete, keep ${names[i]}`,
        sub: `${keepName} takes ${name}'s place · discards ${names[1 - i]} ` +
             `(${dropSize} module${dropSize === 1 ? "" : "s"}) to HELD`,
        run: () => deleteKeeping(key, i, name),
      };
    }));
  }

  // A child of a binary is a *branch*: the engine collapses the parent to the
  // sibling, so deleting it also deletes the module that was combining them.
  // Two modules and a whole subtree go for one click, which is exactly the
  // kind of edit that has to be said out loud first.
  const par = parentOfKey(key);
  if (par && par.binary) {
    const mine = Number(key.slice(key.lastIndexOf("/") + 1));
    const sib = plateTitle(`${par.key}/${1 - mine}`);
    const pname = kindName(rackKindAt(par.key)) || "the module above";
    return openChooser(x, y, `delete this branch?`, [{
      label: `delete ${name} and the ${pname}`,
      sub: `${sib} feeds straight through · this branch ` +
           `(${subtreeSize(node)} module${subtreeSize(node) === 1 ? "" : "s"}) goes to HELD`,
      danger: true,
      run: () => deleteKeeping(par.key, 1 - mine, pname),
    }]);
  }

  if (f.length === 0) {
    // Deliberately still sent: the engine's refusal is the right sentence, and
    // it is the one the player should hear from the thing that refuses.
    return sendStruct({ op: "delete", key });
  }

  // The plain case — one module out of a chain, what it feeds moves up. No
  // confirm: the loss is one module and the toast's undo is right there.
  let head = null;
  const ok = applyTreeRewrite((tree) => {
    const n = nodeAtIn(tree, key);
    if (!n) return "that module has moved — try again";
    const t = nodeTag(n);
    const through = n[t][childFields(MOD_BY_TAG[t] || {})[0]];
    if (!through) return "a lone source cannot be deleted — replace it instead";
    head = headFragment(n);
    if (!setNodeAtIn(tree, key, through)) return "that module has moved — try again";
    return null;
  }, { op: "delete_rewrite", key, kind: rackKindAt(key) });
  if (!ok) return;
  const uid = head ? stageFragment(head, false, { rewrap: true }) : null;
  noteOnLanding(`${name} deleted — it is held below.`,
    { undo: () => { if (uid != null) unstage(uid); doUndo(); }, undoLabel: "put it back" });
}

/** Collapse the binary at `key` onto child `keep`; the other branch goes to
 *  HELD whole, so "discards 3 modules" is a statement about where they went. */
function deleteKeeping(key, keep, name) {
  // Named while it is still in the rack, and by its plate: this sentence is
  // the receipt for a branch the player just agreed to lose.
  const droppedName = chainTitle(`${key}/${1 - keep}`);
  let doomed = null;
  const ok = applyTreeRewrite((tree, marks) => {
    const node = nodeAtIn(tree, key);
    if (!node) return "that module has moved — try again";
    const tag = nodeTag(node);
    const f = childFields(MOD_BY_TAG[tag] || {});
    if (f.length !== 2) return "that module no longer has two inputs";
    const survivor = node[tag][f[keep]];
    const dropped = node[tag][f[1 - keep]];
    if (!survivor) return "that module has moved — try again";
    if (dropped && !marks.includes(dropped)) doomed = dropped;
    if (!setNodeAtIn(tree, key, survivor)) return "that module has moved — try again";
    return null;
  }, { op: "delete_keeping", key, kind: rackKindAt(key) });
  if (!ok) return;
  const uid = doomed ? stageFragment(doomed, false) : null;
  noteOnLanding(
    doomed
      ? `${name} deleted — ${droppedName} is held below.`
      : `${name} deleted.`,
    { undo: () => { if (uid != null) unstage(uid); doUndo(); }, undoLabel: "put it back" },
  );
}

/** Pull the modulator out of a slot. The op path, because a modulation slot is
 *  one field and `set_mod` says exactly that. */
function unplugMod(ownerKey) {
  const old = modAtKey(ownerKey);
  let uid = null;
  sendStruct({ op: "set_mod", key: ownerKey, kind: "none" }, {
    text: old ? `${fragLabel(old, true)} unplugged — it is held below.` : "modulation unplugged.",
    opts: { undo: () => { if (uid != null) unstage(uid); doUndo(); }, undoLabel: "plug it back in" },
  });
  uid = old ? stageFragment(old, true) : null;
}

// ---------- one floating menu, one keyboard ----------
// `#ctx-menu` is the app's only popover of this shape, so the structure menu,
// the connect chooser and the delete confirm are the same element with the
// same dismissal law, the same flip-up, and the same `role="menu"` keyboard:
// ↑/↓ rove, Home/End jump, type-ahead selects by first letters, Enter runs,
// Escape closes and hands focus back.
let menuRows = [];
let menuTypeahead = { buf: "", at: 0 };
// A long-press opens the menu and *then* releases, and that release is a click
// on the plate underneath — which the app-wide "a click outside closes it" law
// would read as a dismissal. One timestamp is cheaper than an exception.
let menuOpenedAt = 0;
// Whatever had the keyboard when the menu took it. One dismissal law needs one
// restoration law, or Escape leaves focus on a hidden element and the next
// keystroke goes nowhere.
let menuOpener = null;

function showMenu(x, y, head, rows) {
  const menu = $("ctx-menu");
  menuRows = rows;
  if (!menu.contains(document.activeElement)) menuOpener = document.activeElement;
  const headHtml = head.title
    ? `<div class="cm-title">` +
      (head.glyph ? `<svg class="nb-glyph" viewBox="0 0 20 14" aria-hidden="true">${head.glyph}</svg>` : "") +
      `<span class="cm-title-name">${esc(head.title)}</span></div>` +
      (head.sub ? `<div class="cm-head">${esc(head.sub)}</div>` : "")
    : `<div class="cm-head">${esc(head.sub || "")}</div>`;
  menu.innerHTML = headHtml + rows.map((r, i) =>
    `<button class="cm-item cm-two${r.danger ? " danger" : ""}${r.sep ? " cm-sep" : ""}"` +
    ` role="menuitem" tabindex="-1" data-i="${i}"${r.disabled ? ` disabled aria-disabled="true" title="${esc(r.why || "")}"` : ""}>` +
    `${esc(r.label)}${r.sub ? `<span class="cm-sub">${esc(r.sub)}</span>` : ""}</button>`).join("");
  menu.setAttribute("role", "menu");
  menu.querySelectorAll(".cm-item").forEach((btn) => {
    btn.onclick = (ev) => {
      const r = menuRows[Number(btn.dataset.i)];
      if (!r || btn.disabled) return;
      closeMenu();
      r.run(ev);
    };
  });
  menu.classList.remove("hidden");
  // Measure unclamped, then place. The old code only ever clamped *downward*,
  // so a menu opened near the bottom of a short window had its last rows —
  // `delete` among them — rendered off-screen with no way to reach them.
  menu.style.left = "0px";
  menu.style.top = "0px";
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  const left = Math.max(8, Math.min(x, window.innerWidth - mw - 8));
  let top = y;
  if (y + mh > window.innerHeight - 8) {
    top = y - mh >= 8 ? y - mh : Math.max(8, window.innerHeight - mh - 8);
  }
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  // `max-height: 70vh` can still bite on a laptop in landscape. Say so with an
  // edge shadow rather than letting the list end in a clean cut that reads as
  // "that is all of them".
  menu.classList.toggle("cm-clamped", menu.scrollHeight > menu.clientHeight + 1);
  menuTypeahead = { buf: "", at: 0 };
  menuOpenedAt = Date.now();
  menu.querySelector(".cm-item:not([disabled])")?.focus();
}

function closeMenu() {
  const menu = $("ctx-menu");
  const had = menu.contains(document.activeElement);
  menu.classList.add("hidden");
  menu.classList.remove("cm-clamped");
  menuRows = [];
  if (had && menuOpener && menuOpener.isConnected) {
    try { menuOpener.focus({ preventScroll: true }); } catch (_) {}
  }
  menuOpener = null;
}

$("ctx-menu").addEventListener("keydown", (ev) => {
  const menu = $("ctx-menu");
  const items = [...menu.querySelectorAll(".cm-item:not([disabled])")];
  if (items.length === 0) return;
  const i = items.indexOf(document.activeElement);
  const go = (n) => {
    items[Math.max(0, Math.min(items.length - 1, n))].focus();
    ev.preventDefault();
  };
  if (ev.key === "ArrowDown") return go(i < 0 ? 0 : (i + 1) % items.length);
  if (ev.key === "ArrowUp") return go(i <= 0 ? items.length - 1 : i - 1);
  if (ev.key === "Home") return go(0);
  if (ev.key === "End") return go(items.length - 1);
  if (ev.key === "Escape") { ev.preventDefault(); return closeMenu(); }
  // Type-ahead: the verbs are words, and a menu of words that cannot be
  // reached by typing them is a menu that only a mouse can read.
  if (ev.key.length === 1 && !ev.metaKey && !ev.ctrlKey && !ev.altKey) {
    const now = Date.now();
    menuTypeahead.buf = now - menuTypeahead.at > 700 ? ev.key : menuTypeahead.buf + ev.key;
    menuTypeahead.at = now;
    const q = menuTypeahead.buf.toLowerCase();
    const hit = items.find((b) => (b.textContent || "").trim().toLowerCase().startsWith(q));
    if (hit) { hit.focus(); ev.preventDefault(); }
  }
});

/** The engine `kind` of the rack module at a trace key, if the rack has one. */
function rackKindAt(key) {
  return wb.rack?.modules.find((m) => m.key === key)?.kind ?? null;
}

// ---------- duel card flip ----------
const flipped = { a: false, b: false };

function setFlip(side, on) {
  flipped[side] = on;
  $(`scope-${side}`).classList.toggle("hidden", on);
  // The raw term is engine truth, not a label. It belongs *with* the circuit
  // view, not permanently under the waveform where it reads as the card's
  // description — truncated mid-token, at that.
  $(`readout-${side}`).classList.toggle("hidden", !on);
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
  send({ type: "log_event", kind: "promote", id: currentDuel[0], value: 1 });
  openOnBench(currentDuel[0]);
  showView("play");
};
$("promote-b").onclick = () => {
  if (!currentDuel) return;
  send({ type: "log_event", kind: "promote", id: currentDuel[1], value: 1 });
  openOnBench(currentDuel[1]);
  showView("play");
};

// Faceplate silkscreen. Two knobs on a 168-unit plate share a 56-unit pitch,
// and at the rack label size anything past seven characters overruns its
// neighbour — `resonance` measures 68 units against a 56 unit pitch, which
// printed as `RESONANCMOD DEPTH` on the filter. Hardware panels abbreviate for
// the same reason; these are the conventional forms.
const SILK = {
  resonance: "res",
  "mod depth": "mod",
  feedback: "fb",
  threshold: "thresh",
  balance: "bal",
};
const silkLabel = (label) => SILK[label] || label;

// ---------- knob geometry & units ----------
// An arc on the knob's outer ring from normalized v0 to v1, sweeping the
// standard −135°…+135° travel.
function arcPath(r, v0, v1) {
  const at = (v) => (-135 + 270 * v) * (Math.PI / 180);
  const pt = (t) => `${(Math.sin(t) * r).toFixed(2)} ${(-Math.cos(t) * r).toFixed(2)}`;
  const large = 270 * Math.abs(v1 - v0) > 180 ? 1 : 0;
  return `M ${pt(at(v0))} A ${r} ${r} 0 ${large} 1 ${pt(at(v1))}`;
}

// A synth does not show a filter cutoff as "0.25". These are quiver's real
// mappings (see quiver-dsp `modules/`), so the panel reports the physical
// value the DSP is actually using rather than the raw genome coordinate.
// Every one of them is already exponential inside quiver — the normalized
// site is the *knob*, not the parameter.
const HZ = (x, lo, span) => lo * Math.pow(span, x);
// Sub-1 Hz is an LFO's *primary* musical region — a 20-second sweep is a
// deliberate patch, not a rounding error. One decimal place there printed
// "0.0 Hz" for a modulator that was plainly running.
const fmtHz = (hz) =>
  hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 2)} kHz`
  : hz >= 100 ? `${Math.round(hz)} Hz`
  : hz >= 1 ? `${hz.toFixed(1)} Hz`
  : `${hz.toFixed(2)} Hz`;
// `toFixed` emits an ASCII hyphen; the panel uses a real minus (U+2212)
// everywhere else, and the two are visibly different weights in Plex Mono.
const minus = (t) => t.replace(/-/g, "\u2212");
const fmtSec = (s) => (s < 1 ? `${s < 0.01 ? (s * 1000).toFixed(1) : Math.round(s * 1000)} ms` : `${s.toFixed(2)} s`);
const pct = (x) => `${Math.round(x * 100)}%`;

// Keyed by `kind#site` first, then by bare site. The module kind is load-
// bearing: `#det` on a vco is a bipolar ±50-cent offset, while `#det` on a
// supersaw is a 0–1 spread amount. Formatting both as a percentage read
// "50%" for a vco sitting at concert pitch — a label that is worse than no
// label, because it looks like information.
const KNOB_UNITS = {
  "vco#det": (x) => {
    const c = (x * 2 - 1) * 50; // map::detune_voct, expressed in cents
    return minus(`${c > 0 ? "+" : ""}${c.toFixed(0)} ¢`);
  },
  "supersaw#det": pct,

  cut: (x) => fmtHz(HZ(x, 20, 1000)),                    // 20 Hz … 20 kHz
  // The SVF modes damp as k = 2 − 2·res, so Q = 1/k is a real Q. The diode
  // ladder does not: it uses k = res·4 as a feedback amount where 4 is
  // self-oscillation, which is not a Q and has none. Printing "Q 0.9" on a
  // module whose own mode plate reads "ladder" was the same one-site-name /
  // two-mappings defect as `det`.
  res: (x) => `Q ${(1 / Math.max(0.3, 2 - 2 * 0.85 * x)).toFixed(1)}`,
  "filter:ladder#res": (x) => `${Math.round(0.85 * x * 100)}% res`,
  rate: (x) => fmtHz(HZ(x, 0.01, 3000)),                 // LFO / S&H clock
  crate: (x) => fmtHz(HZ(x, 0.1, 50)),                   // quiver Chorus: 0.1–5 Hz
  time: (x) => fmtSec(HZ(x, 0.001, 2000)),               // delay, 1 ms … 2 s
  att: (x) => fmtSec(HZ(x, 0.001, 10000)),
  dec: (x) => fmtSec(HZ(x, 0.001, 10000)),
  attack: (x) => fmtSec(HZ(x, 0.001, 10000)),
  decay: (x) => fmtSec(HZ(x, 0.001, 10000)),
  release: (x) => fmtSec(HZ(x, 0.001, 10000)),
  // The VCA runs an exponential (square-law) response, so the sustain knob's
  // *gain* is cv², i.e. 40·log10(x) dB — not 20.
  sustain: (x) => (x <= 0.001 ? "−∞ dB" : minus(`${(40 * Math.log10(x)).toFixed(1)} dB`)),
  fb: (x) => pct(0.7 * x),
  // Equal-power law (a = √(1−x), b = √x), so the useful number is how much
  // louder one side actually is — "a 3%" at dead centre described neither the
  // position nor the levels.
  bal: (x) => {
    if (Math.abs(x - 0.5) < 0.005) return "centre";
    // At the ends the other side is genuinely silent, so the difference is
    // infinite; printing the clamp artifact ("a +60.0 dB") states a number
    // where the honest answer is a word.
    if (x <= 0.002) return "a only";
    if (x >= 0.998) return "b only";
    const d = 10 * Math.log10((1 - x) / x);
    return d > 0 ? `a +${d.toFixed(1)} dB` : `b +${(-d).toFixed(1)} dB`;
  },
  thresh: (x) => pct(0.1 + 0.9 * x),

  // The v2 palette. `#pfb` is the one that matters most: it is a *bipolar*
  // port, so 0.5 is zero feedback — printing "50%" on a knob whose centre
  // means "off" is the same one-site-name/two-mappings defect as `#det`.
  pfb: (x) => {
    const v = (x * 2 - 1) * 70;
    return Math.abs(v) < 0.5 ? "0%" : minus(`${v > 0 ? "+" : ""}${v.toFixed(0)}%`);
  },
  prate: (x) => fmtHz(HZ(x, 0.05, 200)),                 // quiver Phaser: 0.05–10 Hz
  bits: (x) => `${(1 + 15 * x).toFixed(1)} bit`,         // quiver Bitcrusher: 1–16
  dsamp: (x) => (x < 0.01 ? "off" : fmtHz(44100 / (1 + 63 * x))),
  // Karplus-Strong's loop filter opens as this rises: longer and brighter.
  // Labelled "decay" on the plate for that reason — see describe.rs.
  damp: (x) => pct(x),

  // ---- wave 2A ----
  // The vowel port is a continuous slide across five formant patterns, so the
  // honest readout is the vowel you are nearest, not "37%".
  vowel: (x) => {
    const v = ["ah", "eh", "ee", "oh", "oo"];
    return v[Math.min(v.length - 1, Math.round(x * (v.length - 1)))];
  },
  // Bipolar, and *not* a percentage: the compiler maps this to a ±5 V port that
  // quiver reads as `2^(cv/5)`, so the knob scales every formant frequency by
  // 0.5×–2× with no shift at centre. "+50%" would name neither end.
  fshift: (x) => {
    const mult = Math.pow(2, 2 * x - 1);
    return Math.abs(mult - 1) < 0.02 ? "natural" : `${mult.toFixed(2)}×`;
  },
  frate: (x) => fmtHz(HZ(x, 0.05, 100)),                 // quiver Flanger: 0.05–5 Hz
  trate: (x) => fmtHz(HZ(x, 0.1, 200)),                  // quiver Tremolo: 0.1–20 Hz
  vrate: (x) => fmtHz(HZ(x, 0.1, 150)),                  // quiver Vibrato: 0.1–15 Hz
  // Tremolo's shape leans the LFO from a sine toward a triangle; naming the two
  // ends is worth more than a percentage of nothing nameable.
  tshape: (x) => (x < 0.02 ? "sine" : x > 0.98 ? "triangle" : `${Math.round(x * 100)}% tri`),
  // The flanger's feedback is bipolar, like the phaser's: centre is none, and
  // the sign is what puts the comb's teeth between the harmonics or on them.
  ffb: (x) => {
    const v = (x * 2 - 1) * 70;
    return Math.abs(v) < 0.5 ? "0%" : minus(`${v > 0 ? "+" : ""}${v.toFixed(0)}%`);
  },
  // Three bipolar bands, ±12 dB, unity at centre — an eq that reads "50%" at
  // flat is an eq nobody can set by eye.
  low: (x) => eqBand(x),
  mid: (x) => eqBand(x),
  high: (x) => eqBand(x),
  gsize: (x) => fmtSec((0.01 + x * 0.49) * 1000),        // quiver Granular: 10–500 ms
  gdens: (x) => `${(1 + x * 19).toFixed(0)}/s`,          // grains per second

  // ---- wave 2B ----
  // The compiler halves quiver's ±24-semitone port so the knob and the mod
  // cable — which sum on it — cannot pin against the clamp. See map::semitones.
  semis: (x) => {
    const st = (x * 2 - 1) * 12;
    return Math.abs(st) < 0.05 ? "unison" : minus(`${st > 0 ? "+" : ""}${st.toFixed(1)} st`);
  },
  ratio: (x) => `${(1 + x * 19).toFixed(1)}:1`,          // quiver Compressor: 1:1–20:1
  makeup: (x) => minus(`+${(20 * Math.log10(1 + x * 3)).toFixed(1)} dB`),
  bands: (x) => `${Math.round(4 + x * 12)} bands`,       // quiver Vocoder: 4–16
  // The three detector thresholds share one geometric 0.05–5 V law
  // (map::detector_volts) because this instrument's sources are 27 dB apart —
  // a sine vco holds 3.18 V and a plucked string 0.14 V. So the readout is
  // where the detector opens, in dB below quiver's nominal full scale, which
  // is the number that tells you whether your key will actually reach it.
  "comp#thresh": (x) => threshDb(x),
  gthresh: (x) => threshDb(x),
  dthresh: (x) => threshDb(x),

  // ---- wave 2C: the modulation sort ----
  // quiver's Clock reads bpm as a 0–10 V port, `20·15^(cv/10)`, and the
  // compiler scales the knob onto it (map::ClockRate) — so this is real tempo,
  // not a fraction of a voltage.
  erate: (x) => `${Math.round(20 * Math.pow(15, x))} bpm`,
  hrate: (x) => `${Math.round(20 * Math.pow(15, x))} bpm`,
  // The compiler gives up the two shortest patterns so one CV floor serves
  // every step count — see map::euclid_steps.
  esteps: (x) => `${Math.round(4 + x * 12)} steps`,
  epulses: (x) => `${Math.round((0.25 + 0.74 * x) * 100)}% full`,
  // Both quantizer plates carry their selection in the label already
  // (`scale · minor`), so the value slot shows the raw position rather than
  // repeating the word.
  qroot: (x) => `${Math.round(x * 100)}%`,
  qscale: (x) => `${Math.round(x * 100)}%`,
  // SlewLimiter's own map is square-law and the compiler scales into its
  // usable quarter, so this is the real time constant.
  rise: (x) => fmtSec(1000 * (0.001 + Math.pow(0.4 * x, 2) * 10)),
  fall: (x) => fmtSec(1000 * (0.001 + Math.pow(0.4 * x, 2) * 10)),
};

/** A geometric 0.05–5 V detector threshold, as dB below full scale. */
function threshDb(x) {
  return minus(`${(40 * x - 40).toFixed(0)} dB`);
}

/** ±12 dB around unity, with the centre named rather than numbered. */
function eqBand(x) {
  const db = (x * 2 - 1) * 12;
  return Math.abs(db) < 0.25 ? "flat" : minus(`${db > 0 ? "+" : ""}${db.toFixed(1)} dB`);
}

// Anything else — mixes, depths, amounts — is a plain percentage.
function knobUnit(addr, value, kind, variant) {
  const site = addr.split("#").pop();
  const f =
    (kind && variant && KNOB_UNITS[`${kind}:${variant}#${site}`]) ||
    (kind && KNOB_UNITS[`${kind}#${site}`]) ||
    KNOB_UNITS[site];
  return f ? f(value) : pct(value);
}

function enumDisplay(k) {
  if (k.kind.t === "octave") {
    const v = Math.round(k.value) - 2;
    return (v >= 0 ? "+" : "") + v + " oct";
  }
  return k.kind.options[Math.round(k.value)] ?? "?";
}

// Repaint one knob in place, without rebuilding the rack — used by both the
// drag gesture and the keyboard, so a sweep stays at 60fps and the filter and
// delay state inside the running voices survive it.
function paintKnob(kg, knob) {
  const v = knob.value;
  const ang = (-135 + 270 * v) * (Math.PI / 180);
  const line = kg.querySelector(".knob-ind");
  if (line) {
    line.setAttribute("x1", (Math.sin(ang) * KNOB_R * 0.45).toFixed(2));
    line.setAttribute("y1", (-Math.cos(ang) * KNOB_R * 0.45).toFixed(2));
    line.setAttribute("x2", (Math.sin(ang) * (KNOB_R - 3)).toFixed(2));
    line.setAttribute("y2", (-Math.cos(ang) * (KNOB_R - 3)).toFixed(2));
  }
  const arc = kg.querySelector(".knob-arc");
  if (arc) {
    arc.setAttribute("d", arcPath(KNOB_R + 3, 0, Math.max(0.004, v)));
    arc.style.opacity = v > 0.004 ? "" : "0";
  }
  const valText = kg.querySelector(".knob-value");
  const kind = kg.dataset.kind;
  const variant = kg.dataset.variant;
  if (valText) {
    const next = knobUnit(knob.addr, v, kind, variant);
    // Only on a *change*. A drag emits a move per pixel and the readout
    // quantises to two significant figures, so most frames say the same
    // thing — and a flash retriggered sixty times a second is a steady glow,
    // which is exactly the always-on green this is meant to retire.
    if (valText.textContent !== next) {
      valText.textContent = next;
      markKnobChanged(knob.addr);
      valText.classList.add("flashing");
      clearTimeout(valText._flash);
      valText._flash = setTimeout(() => valText.classList.remove("flashing"), KNOB_FLASH_MS);
    }
  }
  kg.setAttribute("aria-valuenow", v.toFixed(3));
  kg.setAttribute("aria-valuetext", knobUnit(knob.addr, v, kind, variant));
}

function attachKnobDrag(el, mod, knob) {
  claimGesture(el); // a knob turn is not a scroll of the rack behind it
  el.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    el.setPointerCapture(ev.pointerId);
    pushUndo(); // one undo step per knob gesture
    knobDragging = true;
    const startY = ev.clientY;
    const startV = knob.value;
    const kg = el.parentNode;
    // The arc's glow is no longer unconditional (§6): it means "this one is
    // moving", so a drag has to say so. Hover says it too, in CSS.
    kg.classList.add("dragging");
    const onMove = (mv) => {
      // Shift is a fine-adjust gear, as on every hardware-modelled plugin.
      const travel = mv.shiftKey ? 700 : 140;
      const v = Math.min(1, Math.max(0, startV + (startY - mv.clientY) / travel));
      knob.value = v;
      paintKnob(kg, knob);
      sendEdit(knob.addr, v, false);
    };
    const onUp = () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      knobDragging = false;
      kg.classList.remove("dragging");
      renderRack();
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    // A cancelled touch used to leave knobDragging latched true, which froze
    // every subsequent rack repaint.
    el.addEventListener("pointercancel", onUp);
  });
}

/** When a sweep last moved, so the click it leaves behind is not read as a
 *  cycle of the chip it just finished dragging. */
let enumSweptAt = 0;

/** Drag an enum chip up/down to step through its options.
 *
 *  Only offered on the two sites that reach the voices without a recompile
 *  (`LIVE_INDEX_SITES`), which is what makes a drag a musical gesture instead
 *  of a burst of dropouts. One index per 26 px, so the whole eight-table stack
 *  is about one plate's height of travel; `shift` quadruples it for picking a
 *  single table out of a sweep.
 *
 *  A step that lands on the value already showing sends nothing: the pointer
 *  produces a move event per pixel, and the engine does not need to be told
 *  four hundred times that the table is still `saw`.
 *
 *  The click handler above stays: this suppresses the click only when the
 *  drag actually moved, so a tap still cycles. */
function attachEnumSweep(el, txt, knob) {
  claimGesture(el);
  el.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    el.setPointerCapture(ev.pointerId);
    const n = knob.kind.t === "octave" ? 5 : knob.kind.options.length;
    const startY = ev.clientY;
    const startV = Math.round(knob.value);
    let moved = false;
    let last = startV;
    const onMove = (mv) => {
      const travel = mv.shiftKey ? 104 : 26;
      const next = Math.min(n - 1, Math.max(0,
        startV + Math.round((startY - mv.clientY) / travel)));
      if (Math.abs(mv.clientY - startY) > 3) moved = true;
      if (next === last) return;
      // One undo step for the whole sweep, taken at the first real step so a
      // drag that never leaves its starting value costs nothing.
      if (last === startV) {
        pushUndo();
        knobDragging = true;
      }
      last = next;
      knob.value = next;
      txt.textContent = enumDisplay(knob);
      sendEdit(knob.addr, next, true);
    };
    const onUp = () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      // The browser fires `click` after `pointerup` on the same element, and
      // the cycle handler would add a ninth table to an eight-table sweep. A
      // timestamp rather than a one-shot capture listener, for the same reason
      // `menuOpenedAt` is one: a pointerdown that never produces a click must
      // not leave a suppressor behind to eat the *next* one.
      if (moved) enumSweptAt = Date.now();
      if (!knobDragging) return;
      knobDragging = false;
      renderRack();
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
  });
}

// ---------- rack keyboard navigation ----------
// One roving tab stop for the whole rack: Tab enters, arrows move between
// controls, Up/Down turn the focused knob (Shift = fine), Enter cycles an
// enum, L toggles its lock.
function rackControls() {
  return [...$("rack-svg").querySelectorAll("[data-addr]")];
}
/** Every module plate, in layout order. */
function rackPlates() {
  return [...$("rack-svg").querySelectorAll("g.mod-group")];
}
/** Everything the one roving stop can sit on. Plates and knobs share it, so
 *  Tab always returns to wherever the keyboard last was inside the rack. */
function rackStops() {
  return [...$("rack-svg").querySelectorAll("g.mod-group, [data-addr]")];
}
function setRackStop(el) {
  for (const e of rackStops()) e.setAttribute("tabindex", e === el ? "0" : "-1");
}

function focusRackControl(i) {
  const els = rackControls();
  if (els.length === 0) return;
  const el = els[Math.max(0, Math.min(els.length - 1, i))];
  setRackStop(el);
  // `focus()` scrolls its nearest scrollable ancestor by default, which used
  // to jerk the whole rack — and the page under it — sideways on every arrow
  // press. Moving the keyboard around the patch is explicit navigation, so it
  // gets a camera move, by the minimum that makes the control visible.
  el.focus({ preventScroll: true });
  ensureRackVisible(el);
}

function knobByAddr(addr) {
  if (!wb.rack) return null;
  for (const m of wb.rack.modules) {
    const k = m.knobs.find((x) => x.addr === addr);
    if (k) return k;
  }
  return null;
}

// ---- the module layer of the same tabstop ----
// Everything structural in this app lived behind two 6×13px glyphs and a
// pointer. With a plate focused the whole verb set is one key away, the menu
// that opens is a real `role="menu"`, and every result is spoken on the live
// region the node bank already owns.
function focusPlate(el, say) {
  if (!el) return;
  setRackStop(el);
  el.focus({ preventScroll: true });
  ensureRackVisible(el);
  if (say !== false) {
    const key = el.getAttribute("data-key");
    const m = wb.rack?.modules.find((x) => x.key === key);
    const plates = rackPlates();
    nbAnnounce(
      `${isPlaceholderKey(key) ? "empty socket" : m?.title || key} — ` +
      `module ${plates.indexOf(el) + 1} of ${plates.length}. ` +
      `Enter for the structure menu, right and left for its knobs.`,
    );
  }
}

$("rack-svg").addEventListener("keydown", (e) => {
  const plate = e.target.closest?.("g.mod-group");
  if (plate && !e.target.closest?.("[data-addr]")) {
    const plates = rackPlates();
    const i = plates.indexOf(plate);
    const key = plate.getAttribute("data-key");
    const mod = wb.rack?.modules.find((x) => x.key === key);
    const knobs = [...plate.querySelectorAll("[data-addr]")];
    const box = plate.getBoundingClientRect();
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      focusPlate(plates[Math.max(0, Math.min(plates.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]);
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      if (knobs.length === 0) return nbAnnounce("this module has no knobs");
      const k = e.key === "ArrowRight" ? knobs[0] : knobs[knobs.length - 1];
      focusRackControl(rackControls().indexOf(k));
    } else if (e.key === "Enter" || e.key === "F2") {
      e.preventDefault();
      if (mod) openStructMenu(mod, box.left + 24, box.bottom + 4);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      // Through the same confirm the pointer gets: on a binary this is the
      // survivor choice, and a Delete key is not a licence to skip it.
      if (mod && mod.kind !== "amp" && !mod.is_mod) deleteModule(key, box.left + 24, box.bottom + 4);
      else if (mod?.is_mod) unplugMod(key.replace(/\/m$/, ""));
    } else if (e.key === "/") {
      // Stopped here, or the global `/` would take it and open the rail with
      // no socket chosen — which is the same rail, aimed at nothing.
      e.preventDefault();
      e.stopPropagation();
      if (mod && mod.kind !== "amp" && !mod.is_mod) armFromRack("insert", key);
      else armFromRack("insert", "node");
    } else if (e.key.toLowerCase() === "l" && mod && mod.kind !== "amp") {
      e.preventDefault();
      const on = isModuleLocked(mod);
      for (const a of moduleLockAddrs(mod)) setLock(a, !on);
      nbAnnounce(on ? `${mod.title} unlocked` : `${mod.title} locked`);
      renderRack();
      focusPlate($("rack-svg").querySelector(`g.mod-group[data-key="${cssKey(key)}"]`), false);
    }
    return;
  }
  const kg = e.target.closest?.("[data-addr]");
  if (!kg) return;
  // Escape backs out to the plate the knob is on, which is the only way to
  // reach the structural verbs without reaching for the mouse again.
  if (e.key === "Escape" && plate) {
    e.preventDefault();
    focusPlate(plate);
    return;
  }
  const els = rackControls();
  const i = els.indexOf(kg);
  const knob = knobByAddr(kg.dataset.addr);
  if (!knob) return;
  const step = e.shiftKey ? 0.002 : 0.02;
  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
    e.preventDefault();
    focusRackControl(i + (e.key === "ArrowRight" ? 1 : -1));
  } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    e.preventDefault();
    if (knob.kind.t !== "continuous") return;
    pushUndo();
    knob.value = Math.min(1, Math.max(0, knob.value + (e.key === "ArrowUp" ? step : -step)));
    paintKnob(kg, knob);
    sendEdit(knob.addr, knob.value, false);
  } else if (e.key === "Enter" || e.key === " ") {
    if (knob.kind.t === "continuous") return;
    e.preventDefault();
    pushUndo();
    const n = knob.kind.t === "octave" ? 5 : knob.kind.options.length;
    knob.value = (Math.round(knob.value) + (e.shiftKey ? n - 1 : 1)) % n;
    sendEdit(knob.addr, knob.value, true);
  } else if (e.key.toLowerCase() === "l") {
    e.preventDefault();
    setLock(knob.addr, !isLockedAddr(knob.addr));
    renderRack();
    focusRackControl(i);
  }
});

function startEvolveFrom(id) {
  $("rack-evolve").disabled = true;
  $("wm-r").classList.add("thinking");
  note("⚡ evolving around the locked controls…");
  // Identity is the panel's business; the engine's refinement kernel rejects
  // proposals at *trace addresses*, so the set is projected back onto the rack
  // that is on screen on the way out.
  const locks = [...lockedAddrs()];
  logImplicit("evolve_from", { locks: locks.length }, { id });
  send({ type: "refine_from", id, locks });
}

// ---------- commit deals a real duel (WS-8 §1) ----------
// The hand edit is the richest preference signal in the app, and it was
// collected as an unverified checkbox: a claim about a comparison the player
// had usually never made. Worse, the checkbox had no *off* — `false` meant
// "said nothing", so an edit someone heard and rejected left no trace at all,
// and the log only ever saw edits that won. A preference log made only of
// successes is a biased sample of exactly the kind the model cannot defend
// against.
//
// So a commit that actually changed the patch plays both versions, takes the
// pick, and records it in whichever direction it went. The express checkbox
// stays for people who are sure — it is faster, and forcing a duel on someone
// who already knows is how you teach them to stop committing — but its answers
// are tagged `self_report` so the two streams can be scored against each other
// instead of averaged. Which of them is better calibrated is a question this
// build can now answer and previously could not even ask.
let commitDuel = null; // {orig, edit, origSide, then}

/** The bench is the bank's patch again. `wb.dirty` is the panel's own belief
 *  about whether anything has changed and it can only ever be an upper bound —
 *  it goes up on every edit and knows nothing about edits that cancel. The
 *  engine's tree comparison is the fact; when it says "identical", this is how
 *  the panel stops saying otherwise. */
function clearBenchDirty() {
  if (!wb.dirty) return;
  wb.dirty = false;
  if (wb.subjectId != null) {
    // The worklet is holding a tree byte-identical to the stored patch, so it
    // is playing that patch — "(edited)" was a caption on a difference that
    // does not exist.
    livePatchId = wb.subjectId;
    setLiveLabel(nameOf(wb.subjectId));
  }
  renderRack(); // the subject line and COMMIT both read `dirty`
}

/** Commit the bench. Deals the duel first when there is something to compare
 *  and the player has not already told us the answer. */
function commitBench(opts = {}) {
  if (wb.subjectId == null) return;
  if ($("improve-check").checked) {
    // The express path: asserted, not heard, and tagged as such.
    return sendCommit("self_edited", opts);
  }
  if (!wb.dirty || !wb.vetOk) return sendCommit("none", opts);
  // The engine answers whether the tree really differs (a knob turned and
  // turned back is not an edit) and hands back the original's audio in the
  // same round trip.
  send({ type: "edit_duel", then: opts.evolving ? "evolve" : "" });
}

function sendCommit(outcome, opts = {}) {
  if (opts.evolving) note("committing your edits, then evolving…");
  logImplicit("commit", { outcome, dirty: wb.dirty });
  send({ type: "edit_commit", outcome });
}

function openCommitDuel(m, then) {
  if (!wb.buffer) return sendCommit("none", { evolving: then === "evolve" });
  const orig = audioCtx.createBuffer(1, m.buffer.length, m.sampleRate);
  orig.copyToChannel(m.buffer, 0);
  // Randomise which side holds the original. The pick is a preference
  // judgement and position bias is real; the app already does this for the
  // dealt duel, and the answer here goes into the same log.
  commitDuel = { orig, edit: wb.buffer, origSide: Math.random() < 0.5 ? "a" : "b", then };
  // Shown before drawn, deliberately: `scopeCtx` sizes the backing store from
  // `clientWidth`, which is 0 while the overlay is `display:none`, and a
  // waveform drawn into a 0-wide canvas is a blank card.
  $("cduel").classList.remove("hidden");
  for (const side of ["a", "b"]) {
    const isOrig = side === commitDuel.origSide;
    $(`cd-name-${side}`).textContent = isOrig ? "the original" : "your edit";
    drawWave($(`cd-scope-${side}`), (isOrig ? orig : wb.buffer).getChannelData(0));
  }
  $(`cd-play-${commitDuel.origSide === "a" ? "a" : "b"}`).focus();
  nbAnnounce("Which one is better? Play A and B, then pick one.");
}

function closeCommitDuel() {
  commitDuel = null;
  $("cduel").classList.add("hidden");
}

function cdPlay(side) {
  if (!commitDuel) return;
  const buf = side === commitDuel.origSide ? commitDuel.orig : commitDuel.edit;
  playBuffer(buf, $(`cd-play-${side}`));
}

function cdPick(side) {
  if (!commitDuel) return;
  const editWon = side !== commitDuel.origSide;
  const then = commitDuel.then;
  closeCommitDuel();
  stopAudition();
  sendCommit(editWon ? "heard_edited" : "heard_original", { evolving: then === "evolve" });
  note(editWon
    ? "taught: you heard both and your edit won."
    : "taught: you heard both and the original won — that is the more useful half.");
}

$("cd-play-a").onclick = () => cdPlay("a");
$("cd-play-b").onclick = () => cdPlay("b");
$("cd-pick-a").onclick = () => cdPick("a");
$("cd-pick-b").onclick = () => cdPick("b");
$("cd-skip").onclick = () => {
  const then = commitDuel && commitDuel.then;
  closeCommitDuel();
  sendCommit("none", { evolving: then === "evolve" });
};
// The overlay owns the keyboard while it is up — the keys underneath it play
// notes, and a stray `a` while a modal asks a question is a note, not an answer.
window.addEventListener("keydown", (e) => {
  if (!commitDuel) return;
  const k = e.key;
  if (k === "Escape") { e.preventDefault(); $("cd-skip").click(); }
  else if (k === "1") { e.preventDefault(); cdPlay("a"); }
  else if (k === "2") { e.preventDefault(); cdPlay("b"); }
  else if (k === "ArrowLeft") { e.preventDefault(); cdPick("a"); }
  else if (k === "ArrowRight") { e.preventDefault(); cdPick("b"); }
  else e.stopPropagation();
}, true);

$("rack-play").onclick = () => playBench();
$("rack-commit").onclick = () => commitBench();
$("rack-evolve").onclick = () => {
  if (wb.subjectId == null) return;
  if (wb.dirty) {
    // The edit is about to become the seed of a whole generation. If there was
    // ever a moment to ask which of the two it should breed from, this is it —
    // so the same duel runs, and the evolve waits behind the answer.
    pendingEvolve = true;
    commitBench({ evolving: true });
  } else {
    startEvolveFrom(wb.subjectId);
  }
};
$("lock-knobs").onclick = () => {
  if (!wb.rack) return;
  for (const m of wb.rack.modules) for (const k of m.knobs) setLock(k.addr, true);
  renderRack();
};
$("lock-structure").onclick = () => {
  if (!wb.rack) return;
  for (const m of wb.rack.modules) for (const a of m.structural_addrs) setLock(a, true);
  renderRack();
};
$("lock-clear").onclick = () => {
  wb.locks.clear();
  locksRemember(); // clearing is a decision too, and it has to survive a reload
  renderRack();
};
// The arrangement switch. Deliberately a plain cycle rather than a menu: three
// modes is not a menu's worth of choice, and the label says which one you are
// in rather than which one you would get, because the rack in front of you is
// the only preview any of them needs.
//
// Switching is a *command* (WS-4 §3): chain and compact never overwrite the
// hand positions, they merely stop drawing them, so freeform is exactly where
// you left it when you come back — including after a reload.
const LAYOUT_TIP = {
  chain: "Chain: the signal path on one baseline. Click to pack it tight.",
  compact: "Compact: layers packed tight. Click to place modules by hand.",
  freeform: "Freeform: drag plates where you like — they snap to the grid, " +
    "hold shift to place freely. Click for the straight signal chain.",
};
function syncLayoutBtn() {
  const b = $("rack-layout");
  if (!b) return;
  b.textContent = layoutMode;
  b.setAttribute("aria-pressed", String(layoutMode !== "chain"));
  b.closest(".tt").title = LAYOUT_TIP[layoutMode];
  // "apply grid" only exists in the mode it acts on, and the frame advertises
  // that a plate can be picked up — a draggable object with a default cursor
  // is a draggable object nobody discovers.
  const g = $("rack-grid");
  if (g) g.closest(".tt").classList.toggle("hidden", layoutMode !== "freeform");
  $("rack-scroll").classList.toggle("freeform", layoutMode === "freeform");
}
$("rack-layout").onclick = () => {
  layoutMode = LAYOUT_MODES[(LAYOUT_MODES.indexOf(layoutMode) + 1) % LAYOUT_MODES.length];
  try { localStorage.setItem("ricercar-layout", layoutMode); } catch (_) {}
  syncLayoutBtn();
  renderRack();
};
$("rack-grid").onclick = () => applyGrid();
syncLayoutBtn();


// ===========================================================================
// THE MODULE TABLE — one inventory, six consumers
// ===========================================================================
// The node bank, the ⋯ structural menu, the tray, the spec card, search and the
// rack's jack labels all read from here. They used to keep six parallel lists
// (FRAG_DEFAULTS, KIND_LABELS, SOURCE_KINDS, PROC_KINDS, NB_AUDIO, NB_MOD) plus
// three duplicated label ternaries, which is how "mod env" managed to be called
// `env`, `Env` and `mod env` on three surfaces at once. Adding a module is now
// one entry, and the palette cannot describe a different instrument from the
// one the right-click menu builds.
//
// Fields
//   kind      the string the engine uses: RackModule.kind, NodeKind, ModKind
//   tag       the serde variant name in patch-tree JSON
//   name      what a synthesist calls it — the only display string
//   sort      source | proc | combine | mod   (what it can legally do)
//   group     which palette section it lives in (signal-flow order, not enum order)
//   ins       audio inputs: 0 source, 1 processor, 2 combiner
//   modTarget the *named destination* of its mod slot, or null for no slot.
//             The rack prints this on the mod jack: an unlabelled mod input on a
//             four-knob module is a mystery, and state is visible, never inferred.
//   tags      search synonyms — how people ask for a sound, not what we named it
//   blurb     one sentence of plain English. Nothing anywhere in the product used
//             to say what any module did.
//   heard     what φ can and cannot measure about it. Saying "the model won't
//             learn this one" is the difference between a trustworthy HITL
//             instrument and one that quietly implies more than it knows.
//   glyph     a transfer-function drawing in a 20×14 box — what this does to a
//             wave, never a pictogram. One drawing problem, nineteen answers, so
//             the set cannot drift as it grows.

// Every source fragment the palette hands out starts from the same saw, so a
// staged processor is audible the instant it lands rather than silent until you
// also give it an input.
const SEED_VCO = () => ({
  Vco: { wave: "Saw", octave: 0, detune: 0.5, mod_depth: 0.3, modulation: "None" },
});

const MODULES = [
  // ---- sources ----
  {
    kind: "vco", tag: "Vco", name: "vco", sort: "source", group: "sources",
    // The slot lands on the pitch Offset, whose input sums with the incoming
    // note CV. Until this existed nothing in the instrument could bend a
    // pitch — no vibrato, no envelope drop, no siren.
    ins: 0, modTarget: "pitch", phi: "n_vco",
    tags: ["osc", "oscillator", "analog", "saw", "square", "sine", "basic", "vibrato"],
    blurb: "The reference oscillator. One bandlimited shape at a time — sine, triangle, saw or square — tracking the keyboard. Cable its mod input and the pitch itself bends.",
    heard: "brightness and roughness, well.",
    glyph: `<path class="gl" d="M1 11.5 L7 2.5 L7 11.5 L13 2.5 L13 11.5 L19 2.5"/>`,
    frag: SEED_VCO,
  },
  {
    kind: "supersaw", tag: "Supersaw", name: "supersaw", sort: "source", group: "sources",
    ins: 0, modTarget: "pitch", phi: "n_supersaw",
    tags: ["saw", "stack", "detune", "wide", "trance", "unison", "thick"],
    blurb: "Seven saws detuned against each other, plus a sub. The sound of a chord played by one note.",
    heard: "brightness and roughness. The feature pipeline listens to the L/R sum, so the width collapses before the model hears it.",
    glyph:
      `<path class="gl-ghost" d="M0.5 9.5 L6 2 L6 9.5 L11.5 2 L11.5 9.5 L17 2"/>` +
      `<path class="gl-ghost" d="M2.5 13 L8 5.5 L8 13 L13.5 5.5 L13.5 13 L19 5.5"/>` +
      `<path class="gl" d="M1.5 11.5 L7 4 L7 11.5 L12.5 4 L12.5 11.5 L18 4"/>`,
    frag: () => ({ Supersaw: { octave: 0, detune: 0.35, mix: 0.5, mod_depth: 0.3, modulation: "None" } }),
  },
  {
    kind: "wavetable", tag: "Wavetable", name: "wavetable", sort: "source", group: "sources",
    ins: 0, modTarget: "morph", phi: "n_wavetable",
    tags: ["wt", "morph", "digital", "sweep", "table", "shape"],
    blurb: "Eight bandlimited shapes on one dial. Morph sweeps between them while the note is still sounding — the first source here whose timbre moves.",
    heard: "brightness, and the movement itself through the spectral change over the sample.",
    glyph:
      `<path class="gl" d="M1 3.4 q2.3 -2.8 4.6 0 t4.6 0 t4.6 0"/>` +
      `<path class="gl" d="M1 11.2 h2.6 v-3 h3.1 v3 h3.1 v-3 h3.1 v3 h2.9"/>` +
      `<path class="gl-mark" d="M17.6 4.6 V9.4 M16.3 8.2 l1.3 1.4 l1.3 -1.4"/>`,
    frag: () => ({ Wavetable: { table: "Saw", octave: 0, morph: 0.35, mod_depth: 0.3, modulation: "None" } }),
  },
  {
    kind: "pluck", tag: "Pluck", name: "pluck", sort: "source", group: "sources",
    // The slot drives the string's decay, not `brightness`: quiver only reads
    // brightness on the trigger edge, so modulating it would do nothing you
    // could hear between plucks. The rack prints this string on the mod jack,
    // so it has to name the control the compiler actually cables.
    ins: 0, modTarget: "decay", phi: "n_pluck",
    tags: ["string", "karplus", "physical", "guitar", "harp", "mallet", "koto"],
    blurb: "A string, modelled rather than sampled. Strike it and it rings — decay decides for how long, brightness decides what the pick was made of.",
    heard: "its decay and its brightness. It has no sustain to speak of, which the amp envelope's shape cannot hide.",
    glyph: `<path class="gl" d="M1 7 C2.4 0.8, 4 13.2, 5.6 7 C6.9 2.4, 8.2 11.6, 9.5 7 C10.6 3.8, 11.7 10.2, 12.8 7 C13.7 4.9, 14.6 9.1, 15.5 7 C16.3 5.6, 17.1 8.4, 17.9 7 L19 7"/>`,
    frag: () => ({ Pluck: { octave: 0, damping: 0.45, brightness: 0.6, mod_depth: 0.3, modulation: "None" } }),
  },
  {
    kind: "formant", tag: "Formant", name: "formant", sort: "source", group: "sources",
    // quiver's `vowel` port is a CONTINUOUS position interpolated across
    // A/E/I/O/U, not a five-way switch — which is why this earns a mod slot
    // and why the model can hear it at all: a vowel sweep is a spectral
    // movement, and spectral movement is what φ measures best.
    ins: 0, modTarget: "vowel", phi: "n_formant",
    tags: ["vowel", "voice", "vox", "throat", "talk", "choir", "ah", "oo"],
    blurb: "A glottal pulse through five resonators. Sweep the vowel and it speaks — ah, eh, ee, oh, oo — without ever leaving the keyboard.",
    heard: "as a moving centroid. The vowel itself is a formant pattern the model has no coordinate for; it hears the sweep, not the word.",
    glyph:
      `<path class="gl-rule" d="M0 12 H20"/>` +
      `<path class="gl" d="M1 12 C2.4 12, 2.7 3.2, 4.1 3.2 C5.5 3.2, 5.8 12, 7.2 12 ` +
      `C8.3 12, 8.6 5.8, 9.9 5.8 C11.2 5.8, 11.5 12, 12.8 12 ` +
      `C13.8 12, 14.1 8, 15.3 8 C16.5 8, 16.8 12, 18 12 L19 12"/>`,
    frag: () => ({ Formant: { vowel: 0.3, shift: 0.5, octave: 0, mod_depth: 0.3, modulation: "None" } }),
  },
  {
    kind: "noise", tag: "Noise", name: "noise", sort: "source", group: "sources",
    ins: 0, modTarget: null, phi: "n_noise",
    tags: ["white", "pink", "hiss", "wind", "percussion", "air", "snare"],
    blurb: "Every frequency at once — white flat, pink weighted toward the bottom. Filter it and it becomes wind, breath or a snare.",
    heard: "flatness, loudly. It is the one source φ can pick out on its own.",
    glyph: `<path class="gl" d="M1 7 L2.3 2.6 L3.6 10.8 L4.9 4 L6.2 12 L7.5 3.4 L8.8 9.6 L10.1 2.4 L11.4 11.4 L12.7 4.6 L14 12.2 L15.3 3 L16.6 10 L17.9 4.4 L19 7.4"/>`,
    frag: () => ({ Noise: { color: "White" } }),
  },

  // ---- shape: the nonlinearities ----
  {
    kind: "fold", tag: "Fold", name: "wavefolder", sort: "proc", group: "shape",
    ins: 1, modTarget: "threshold", phi: "n_drive",
    tags: ["fold", "west coast", "buchla", "metallic", "harmonics", "timbre"],
    blurb: "Folds the peaks back on themselves at a threshold. Quiet in, nothing happens; loud in, a whole new harmonic series that grows with the level.",
    heard: "brightness and roughness climbing together as it folds harder.",
    glyph:
      `<path class="gl-rule" d="M0 3.6 H20"/>` +
      `<path class="gl" d="M1 12.4 L4.6 3.6 L6.6 7.8 L8.6 3.6 L11.4 12.4 L14.6 3.6 L16.6 7.8 L18.6 3.6"/>`,
    frag: () => ({ Fold: { threshold: 0.5, mod_depth: 0.3, input: SEED_VCO(), modulation: "None" } }),
  },
  {
    kind: "distortion", tag: "Distortion", name: "distortion", sort: "proc", group: "shape", sx: "dist",
    ins: 1, modTarget: "drive", phi: "n_drive",
    tags: ["drive", "overdrive", "saturation", "fuzz", "grit", "warm", "tube", "dirt"],
    blurb: "Runs the signal into a wall. Soft rounds the peaks, hard clips them flat, tube leans on one side harder than the other.",
    heard: "brightness and roughness. Tube mode also shifts the DC the voice then has to block.",
    glyph:
      `<path class="gl-rule" d="M1 13 L19 1"/>` +
      `<path class="gl" d="M1 12.6 C5.4 12.4, 6.4 9.4, 10 7 C13.6 4.6, 14.6 1.7, 19 1.5"/>`,
    frag: () => ({ Distortion: { drive: 0.45, tone: 0.5, mode: "Soft", mod_depth: 0.3, input: SEED_VCO(), modulation: "None" } }),
  },
  {
    kind: "bitcrush", tag: "Bitcrush", name: "bitcrush", sort: "proc", group: "shape",
    ins: 1, modTarget: "bits", phi: "n_drive",
    tags: ["crush", "lo-fi", "digital", "8-bit", "aliasing", "sampler", "grit", "chiptune"],
    blurb: "Throws away bits and sample rate. The sound of an early sampler running out of memory — and nothing like saturation, because the damage is quantisation, not clipping.",
    heard: "roughness and flatness. Its aliasing sits above where the model listens most.",
    glyph: `<path class="gl" d="M1 10.6 h2.6 V8 h2.6 V5 h2.6 V3.4 h2.6 V5 h2.6 V8 h2.6 V10.6 h2"/>`,
    frag: () => ({ Bitcrush: { bits: 0.55, downsample: 0.3, mod_depth: 0.3, input: SEED_VCO(), modulation: "None" } }),
  },

  // ---- filter: a group of one, on purpose ----
  {
    kind: "filter", tag: "Filter", name: "filter", sort: "proc", group: "filter",
    ins: 1, modTarget: "cutoff", phi: "n_filter",
    tags: ["lowpass", "highpass", "bandpass", "ladder", "svf", "cutoff", "resonance", "303", "sweep"],
    blurb: "The identity of a subtractive synth. Four modes on one plate: three state-variable responses and a diode ladder that growls when you push it.",
    heard: "brightness and rolloff — the coordinates φ measures best. Nothing you do here is invisible to the model.",
    glyph: `<path class="gl" d="M1 5 H8.6 C10.6 5, 10.9 3, 12.1 3 C13.4 3, 13.7 7.2, 15.2 10 C16.4 12.3, 17.7 13, 19 13"/>`,
    frag: () => ({ Filter: { kind: "SvfLp", cutoff: 0.6, resonance: 0.3, mod_depth: 0.3, input: SEED_VCO(), modulation: "None" } }),
  },

  {
    kind: "eq", tag: "Eq", name: "eq", sort: "proc", group: "filter",
    ins: 1, modTarget: "mid", phi: "n_filter",
    tags: ["tone", "tilt", "shelf", "bass", "treble", "boost", "cut", "presence"],
    blurb: "Three bands of ±12 dB: a low shelf, a mid bell and a high shelf. It arrives flat and does nothing until you move it — that is what a tone control is.",
    heard: "directly, as brightness and rolloff. The most legible thing in the palette to the model.",
    glyph: `<path class="gl" d="M1 4.6 H3.4 C5 4.6, 5.4 10.4, 7.6 10.4 C9.4 10.4, 10.2 10.4, 11.6 10.4 C13.6 10.4, 14 4.6, 16.2 4.6 H19"/>`,
    frag: () => ({ Eq: { low: 0.5, mid: 0.5, high: 0.5, mod_depth: 0.3, input: SEED_VCO(), modulation: "None" } }),
  },

  // ---- space: time and movement ----
  {
    kind: "delay", tag: "Delay", name: "delay", sort: "proc", group: "space",
    ins: 1, modTarget: "time", phi: "n_time",
    tags: ["echo", "repeat", "feedback", "tape", "slap", "dub", "flutter"],
    blurb: "Repeats what it hears, quieter each time. Modulate the time and the repeats bend pitch — that is tape flutter.",
    heard: "as a longer, more sustained sample. Its rhythm is not a coordinate φ has.",
    glyph:
      `<path class="gl-rule" d="M0 12 H20"/>` +
      `<path class="gl" d="M1.6 12 V2.6 M6.4 12 V5.8 M11.2 12 V8.2 M16 12 V10.2"/>`,
    // 0.35 is 14 ms — quiver maps time as 1 ms · 2000^cv, so the old default
    // landed in comb-filter territory and read as a tone change, not an echo.
    frag: () => ({ Delay: { time: 0.72, feedback: 0.35, mix: 0.35, mod_depth: 0.3, input: SEED_VCO(), modulation: "None" } }),
  },
  {
    kind: "chorus", tag: "Chorus", name: "chorus", sort: "proc", group: "space",
    ins: 1, modTarget: "depth", phi: "n_mod_fx",
    tags: ["ensemble", "width", "thicken", "detune", "shimmer", "80s", "stereo"],
    blurb: "A copy of the signal drifting in and out of tune with itself. One voice becomes a section, and the two sides go different ways.",
    heard: "as comb filtering, not as width — the pipeline sums L and R, so the model learns the artefact rather than the effect.",
    glyph:
      `<path class="gl-ghost" d="M1 7 q2.6 4.2 5.2 0 t5.2 0 t5.2 0"/>` +
      `<path class="gl" d="M1 7 q2.2 -4.2 4.4 0 t4.4 0 t4.4 0 t4.4 0"/>`,
    frag: () => ({ Chorus: { rate: 0.3, depth: 0.4, mix: 0.35, mod_depth: 0.3, input: SEED_VCO(), modulation: "None" } }),
  },
  {
    kind: "reverb", tag: "Reverb", name: "reverb", sort: "proc", group: "space",
    ins: 1, modTarget: "size", phi: "n_reverb",
    tags: ["room", "hall", "space", "tail", "ambient", "wash", "verb"],
    blurb: "Puts the sound somewhere. Size is how far the walls are, damping is what they are made of — modulate size and the room breathes.",
    heard: "as a longer tail and a flatter spectrum. Its stereo depth is not measured.",
    glyph:
      `<path class="gl-rule" d="M0 12 H20"/>` +
      `<path class="gl" d="M2 12 V2 M5 12 V6.4 M7.2 12 V8.6 M9.4 12 V7.4 M11.6 12 V9.6 M13.8 12 V8.8 M16 12 V10.4 M18.2 12 V9.9"/>`,
    frag: () => ({ Reverb: { size: 0.5, damp: 0.5, mix: 0.3, mod_depth: 0.3, input: SEED_VCO(), modulation: "None" } }),
  },
  {
    kind: "phaser", tag: "Phaser", name: "phaser", sort: "proc", group: "space",
    ins: 1, modTarget: "depth", phi: "n_mod_fx",
    tags: ["sweep", "notch", "jet", "allpass", "swirl", "phase", "funk"],
    blurb: "Allpass stages sweeping a comb of notches through the sound. Where a chorus blurs, a phaser carves — and the feedback knob is what makes it whistle.",
    heard: "as a moving rolloff. Its notches are shallower than φ's brightness coordinates resolve.",
    // Drawn as a response curve on the same axis convention as `filter`, so
    // SHAPE / FILTER / SPACE each read in their own domain and the phaser stops
    // colliding with the chorus's two-waveform picture.
    glyph: `<path class="gl" d="M1 4.4 H3.2 C4.2 4.4, 4.4 10.6, 5.4 10.6 C6.4 10.6, 6.6 4.4, 7.6 4.4 C8.8 4.4, 9 10.6, 10 10.6 C11 10.6, 11.2 4.4, 12.4 4.4 C13.6 4.4, 13.8 10.6, 14.8 10.6 C15.8 10.6, 16 4.4, 17.2 4.4 H19"/>`,
    // feedback is bipolar: 0.5 is the zero crossing, i.e. no resonance at all,
    // which is a phaser with its defining character switched off.
    frag: () => ({ Phaser: { rate: 0.42, depth: 0.6, feedback: 0.78, mod_depth: 0.3, input: SEED_VCO(), modulation: "None" } }),
  },

  {
    kind: "flanger", tag: "Flanger", name: "flanger", sort: "proc", group: "space",
    ins: 1, modTarget: "depth", phi: "n_mod_fx",
    tags: ["jet", "whoosh", "comb", "sweep", "metallic", "tape", "swirl"],
    blurb: "A copy of the signal delayed by a millisecond or two and swept. Where the phaser carves four notches, a flanger carves a whole harmonic comb — that is the jet-plane sound.",
    heard: "as a moving rolloff, and only weakly: the comb's teeth are finer than φ's brightness coordinates resolve.",
    // A dense comb — deliberately more teeth than the phaser's four, because
    // that is exactly what separates them to anyone who is not already an
    // expert, and the two sit in the same group.
    glyph: `<path class="gl" d="M1 4.6 q1 5.6 2 0 t2 0 t2 0 t2 0 t2 0 t2 0 t2 0 t2 0 t2 0"/>`,
    frag: () => ({ Flanger: { rate: 0.35, depth: 0.6, feedback: 0.62, mod_depth: 0.3, input: SEED_VCO(), modulation: "None" } }),
  },
  {
    kind: "granular", tag: "Granular", name: "granular", sort: "proc", group: "space",
    ins: 1, modTarget: "position", phi: "n_time",
    tags: ["grains", "cloud", "texture", "smear", "stretch", "shimmer", "blur"],
    blurb: "Chops what it hears into short grains and sprays them back. Position picks where in the recent past to read from, density how many at once — a sound scattered and reassembled.",
    heard: "as a longer, flatter, less periodic sample. The scattering is exactly the kind of thing φ's flatness coordinate is for.",
    glyph:
      `<path class="gl" d="M2 5 v2 M4 8.4 v2 M5.6 3.6 v2 M7.2 9.6 v2 M8.8 6 v2 M10.4 3.4 v2 ` +
      `M12 8.6 v2 M13.6 5.4 v2 M15.2 10 v2 M16.8 6.8 v2 M18.4 4.4 v2"/>`,
    frag: () => ({ Granular: { position: 0.5, size: 0.4, density: 0.6, mod_depth: 0.3, input: SEED_VCO(), modulation: "None" } }),
  },

  // ---- motion: periodic movement applied to a whole chain ----
  {
    kind: "tremolo", tag: "Tremolo", name: "tremolo", sort: "proc", group: "motion",
    ins: 1, modTarget: "depth", phi: "n_mod_fx",
    tags: ["amplitude", "pulse", "throb", "chop", "surf", "helicopter", "am"],
    blurb: "Level, moving on its own clock. Shape leans the LFO from a sine toward a triangle — gentle swell at one end, a hard chop at the other.",
    heard: "as movement in loudness over the sample rather than in timbre — one of the few things φ measures that has nothing to do with brightness.",
    glyph:
      `<path class="gl-ghost" d="M1 7 q2.5 5 5 0 t5 0 t5 0 t3 0"/>` +
      `<path class="gl" d="M1 7 q2.5 -5 5 0 t5 0 t5 0 t3 0"/>`,
    frag: () => ({ Tremolo: { rate: 0.4, depth: 0.5, shape: 0.0, mod_depth: 0.3, input: SEED_VCO(), modulation: "None" } }),
  },
  {
    kind: "vibrato", tag: "Vibrato", name: "vibrato", sort: "proc", group: "motion",
    ins: 1, modTarget: "depth", phi: "n_mod_fx",
    tags: ["pitch", "wobble", "warble", "singer", "wow", "flutter", "tape"],
    blurb: "Pitch, moving on its own clock — applied to a whole chain rather than one oscillator. Wet all the way, because a half-wet vibrato is a chorus.",
    heard: "barely on its own. φ has no pitch coordinate; what reaches the model is the smearing a swept delay line leaves behind.",
    // Lobes that widen and narrow: the wavelength itself is what moves.
    glyph: `<path class="gl" d="M1 7 q0.7 -4.4 1.4 0 q0.9 4.4 1.8 0 q1.3 -4.4 2.6 0 q1.7 4.4 3.4 0 q1.3 -4.4 2.6 0 q0.9 4.4 1.8 0 q0.7 -4.4 1.4 0"/>`,
    frag: () => ({ Vibrato: { rate: 0.45, depth: 0.25, mix: 1.0, mod_depth: 0.3, input: SEED_VCO(), modulation: "None" } }),
  },

  {
    kind: "shift", tag: "Shift", name: "pitch shift", sort: "proc", group: "motion",
    ins: 1, modTarget: "shift", phi: "n_time",
    tags: ["harmony", "transpose", "octave", "detune", "harmonizer", "semitone", "chipmunk"],
    blurb: "Transposes what it hears without changing its speed, then blends the shifted copy back in. Set it to a third or a fifth and one note becomes an interval.",
    heard: "as a brighter or darker copy layered over the original — φ measures the sum, and has no coordinate for the interval itself.",
    glyph:
      `<path class="gl-ghost" d="M1 10.5 q1.6 -3.4 3.2 0 t3.2 0 t3.2 0 t3.2 0 t3.2 0"/>` +
      `<path class="gl" d="M1 4.2 q1.1 -3.4 2.2 0 t2.2 0 t2.2 0 t2.2 0 t2.2 0 t2.2 0 t2.2 0 t2.2 0"/>`,
    frag: () => ({ Shift: { semis: 0.62, window: 0.5, mix: 0.5, mod_depth: 0.3, input: SEED_VCO(), modulation: "None" } }),
  },

  // ---- dynamics: level shaped by a second signal ----
  // These are binary nodes like mix and ring mod, but the second child is a
  // *control*, not something you hear — which is exactly why they get their own
  // group rather than sitting in COMBINE.
  {
    kind: "comp", tag: "Comp", name: "compressor", sort: "combine", group: "dynamics",
    ins: 2, inNames: ["in", "key"], modTarget: "threshold", phi: "n_dynamics", fields: ["input", "sidechain"],
    tags: ["squash", "glue", "level", "sustain", "punch", "sidechain", "dynamics"],
    blurb: "Turns down whatever passes a threshold, by the ratio you set. Feed its key input from another chain and it is a sidechain compressor.",
    heard: "as a flatter, more sustained sample — φ's crest and RMS coordinates read this one directly.",
    glyph:
      `<path class="gl-rule" d="M1 13 L19 1"/>` +
      `<path class="gl" d="M1 13 L8.5 5.5 C10.2 4, 11.6 3.6, 13.6 3.3 L19 2.8"/>`,
    frag: () => ({
      Comp: { threshold: 0.4, ratio: 0.5, makeup: 0.4, mod_depth: 0.3, input: SEED_VCO(),
              sidechain: SEED_VCO(), modulation: "None" },
    }),
  },
  {
    kind: "duck", tag: "Duck", name: "ducker", sort: "combine", group: "dynamics",
    ins: 2, inNames: ["in", "key"], modTarget: "amount", phi: "n_dynamics", fields: ["input", "key"],
    tags: ["sidechain", "pump", "breathe", "dip", "edm", "kick", "dance"],
    blurb: "Pushes the signal down whenever its key input gets loud, and lets it swell back. The pumping that a pad does under a kick.",
    heard: "as movement in loudness across the sample. The pumping is a real φ coordinate, unlike most rhythm.",
    glyph:
      `<path class="gl-mark" d="M4.2 12.6 V8"/>` +
      `<path class="gl" d="M1 4.4 H3.6 L4.6 11.2 C6.6 11.2, 8.2 6, 11.2 4.9 C13.8 4.5, 16.2 4.4, 19 4.4"/>`,
    frag: () => ({
      Duck: { amount: 0.7, threshold: 0.4, release: 0.35, mod_depth: 0.3, input: SEED_VCO(),
              key: MOD_BY_KIND.pluck.frag(), modulation: "None" },
    }),
  },
  {
    kind: "gate", tag: "Gate", name: "gate", sort: "combine", group: "dynamics",
    ins: 2, inNames: ["in", "key"], modTarget: "threshold", phi: "n_dynamics", fields: ["input", "sidechain"],
    tags: ["chop", "stutter", "rhythm", "tighten", "trance", "silence", "noise gate"],
    blurb: "Passes the signal only while its key input is loud enough, and shuts otherwise. Key it from something rhythmic and a pad becomes a pattern.",
    heard: "as a shorter, more transient sample. Chopping a drone changes almost every temporal coordinate at once.",
    glyph:
      `<path class="gl-rule" d="M0 12 H20"/>` +
      `<path class="gl" d="M1.6 7.4 q0.7 -3.6 1.4 0 t1.4 0 t1.4 0 M9 7.4 q0.7 -3.6 1.4 0 t1.4 0 ` +
      `M15.4 7.4 q0.7 -3.6 1.4 0 t1.4 0"/>`,
    frag: () => ({
      Gate: { threshold: 0.35, range: 0.7, release: 0.3, mod_depth: 0.3, input: SEED_VCO(),
              sidechain: MOD_BY_KIND.pluck.frag(), modulation: "None" },
    }),
  },

  // ---- combine: the branching sort ----
  {
    kind: "mix", tag: "Mix", name: "mix", sort: "combine", group: "combine",
    ins: 2, modTarget: null, phi: null,
    tags: ["blend", "crossfade", "layer", "two", "sum", "branch", "parallel"],
    blurb: "Crossfades two chains into one, at equal power. This is how a patch branches — everything else here is a straight line.",
    heard: "as whichever side you favour. The balance knob moves every audio coordinate at once.",
    glyph: `<path class="gl" d="M1 2.8 L9.6 7 L19 7 M1 11.2 L9.6 7"/>`,
    frag: () => ({
      Mix: { balance: 0.5, a: SEED_VCO(), b: { Vco: { wave: "Triangle", octave: 0, detune: 0.5 } } },
    }),
  },
  {
    kind: "ringmod", tag: "RingMod", name: "ring mod", sort: "combine", group: "combine",
    ins: 2, inNames: ["carrier", "mod"], modTarget: null, phi: "n_drive",
    tags: ["am", "ring", "metallic", "bell", "inharmonic", "clang", "radio", "dalek"],
    blurb: "Multiplies two chains together. What comes out is the sum and difference of their frequencies — inharmonic, so it reads as bell, metal or radio rather than as a note.",
    heard: "as a jump in roughness and flatness. There is no ring-mod coordinate — the model hears the spectrum it produces, not the operation.",
    glyph:
      `<path class="gl-rule" d="M1 7 q4.5 -5.6 9 0 t9 0"/>` +
      `<path class="gl" d="M1 7 q1.5 -4 3 0 t3 0 t3 0 t3 0 t3 0 t3 0"/>`,
    // `b` is a sine, and deliberately NOT at a whole-octave interval: at an
    // exact octave the sum and difference tones land back on the harmonic
    // series and the result is a timbre change, not the bell the blurb
    // promises. detune 0.78 is +28 cents, enough to make it clang.
    frag: () => ({
      RingMod: { mix: 0.5, a: SEED_VCO(), b: { Vco: { wave: "Sine", octave: 1, detune: 0.78 } } },
    }),
  },

  {
    kind: "vocoder", tag: "Vocoder", name: "vocoder", sort: "combine", group: "combine",
    ins: 2, inNames: ["carrier", "voice"], modTarget: "bands", phi: "n_filter", fields: ["carrier", "modulator"],
    tags: ["talk", "robot", "vox", "speech", "choir", "formant", "daft"],
    blurb: "Splits one chain into bands, measures how loud each is, and imposes that shape on another. The carrier supplies the pitch, the voice supplies the words.",
    heard: "as the carrier's brightness following the voice's — a filter bank whose curve is drawn by a signal.",
    glyph:
      `<path class="gl-rule" d="M0 12 H20"/>` +
      `<path class="gl" d="M2 12 V6.2 M4.4 12 V3.6 M6.8 12 V7.8 M9.2 12 V4.6 M11.6 12 V9.2 ` +
      `M14 12 V5.2 M16.4 12 V8.2 M18.4 12 V6.6"/>` +
      `<path class="gl-ghost" d="M1.6 7.4 C4 2.6, 7 9, 9.8 4.8 C12.8 2.2, 15.6 8.6, 18.8 6.2"/>`,
    frag: () => ({
      Vocoder: {
        bands: 0.6, attack: 0.25, release: 0.3, mod_depth: 0.3,
        carrier: { Supersaw: { octave: 0, detune: 0.35, mix: 0.5, mod_depth: 0.3, modulation: "None" } },
        modulator: MOD_BY_KIND.formant.frag(),
        modulation: "None",
      },
    }),
  },

  // ---- modulation ----
  {
    kind: "lfo", tag: "Lfo", name: "lfo", sort: "mod", group: "modulation",
    ins: 0, modTarget: null, phi: "n_lfo",
    tags: ["wobble", "sweep", "cycle", "vibrato", "tremolo", "slow", "movement"],
    blurb: "A slow oscillator that never stops. Cabled anywhere, it makes that parameter breathe on its own clock.",
    heard: "as movement across the sample — φ measures how much things change, not what changed them.",
    glyph: `<path class="gl" d="M1 10.6 L5.5 3.4 L10 10.6 L14.5 3.4 L19 10.6"/>`,
    frag: () => ({ Lfo: { wave: "Triangle", rate: 0.4 } }),
  },
  {
    kind: "env", tag: "Env", name: "mod env", sort: "mod", group: "modulation",
    ins: 0, modTarget: null, phi: "n_env",
    tags: ["envelope", "ad", "attack", "decay", "per note", "sweep", "pluck"],
    blurb: "Fires once per note and decays. This is the classic filter sweep — the shape that makes a note sound plucked, bowed or blown.",
    heard: "clearly: it is the main thing shaping the sample's spectral contour over time.",
    glyph: `<path class="gl" d="M1 12 L5 2.4 L19 12"/>`,
    frag: () => ({ Env: { attack: 0.2, decay: 0.5 } }),
  },
  {
    kind: "rand", tag: "Rand", name: "s&h rand", sort: "mod", group: "modulation",
    ins: 0, modTarget: null, phi: "n_rand",
    tags: ["random", "sample and hold", "stepped", "wander", "burble", "chance", "glide"],
    blurb: "Holds a new random value at every tick. Glide smooths the steps, which is the difference between a burble and a wander.",
    heard: "as instability. Two takes of the same patch differ, which is itself a thing to like.",
    glyph: `<path class="gl" d="M1 9 h3 V4 h3 V11.2 h3 V6 h3 V8.6 h3 V3.4 h2"/>`,
    frag: () => ({ Rand: { rate: 0.4, glide: 0.0 } }),
  },
  {
    kind: "follow", tag: "Follow", name: "follower", sort: "mod", group: "modulation",
    ins: 0, modTarget: null, phi: "n_follow",
    tags: ["envelope follower", "dynamic", "react", "duck", "auto", "responsive", "self"],
    blurb: "Listens to what is already going into this module and turns its loudness into modulation. The patch starts responding to itself.",
    heard: "as a coupling between loudness and timbre — φ sees the result, not the cause.",
    glyph:
      `<path class="gl-ghost" d="M2 7 L3 3.6 L4 10.4 L5 4.2 L6 10 L7 4.8 L8 9.6 L9 5.4 L10 9 L11 5.9 L12 8.4 L13 6.3 L14 8 L15 6.6 L16 7.6 L17 6.9 L18 7.3"/>` +
      `<path class="gl" d="M1 12.4 C2.6 3, 3.4 2.6, 5.2 3.2 C8.6 4.2, 13 9.4, 19 11.8"/>`,
    frag: () => ({ Follow: { sens: 0.5, release: 0.4 } }),
  },
  {
    kind: "euclid", tag: "Euclid", name: "euclid", sort: "mod", modSort: "leaf", group: "modulation",
    ins: 0, modTarget: null, phi: "n_mod_logic",
    tags: ["rhythm", "pattern", "clock", "pulse", "gate", "steps", "polyrhythm", "tick"],
    blurb: "Spreads a number of pulses as evenly as it can across a number of steps — the pattern behind most drum machines. Cabled to a cutoff, a pad starts playing a rhythm.",
    heard: "as movement on a grid. φ has no coordinate for rhythm; what reaches the model is that the sample stops sitting still.",
    glyph:
      `<path class="gl-rule" d="M0 12 H20"/>` +
      `<path class="gl" d="M1.4 12 V5 M6.2 12 V5 M11 12 V5 M15.8 12 V5"/>` +
      `<path class="gl-ghost" d="M3.8 12 V8.6 M8.6 12 V8.6 M13.4 12 V8.6 M18.2 12 V8.6"/>`,
    frag: () => ({ Euclid: { rate: 0.45, steps: 0.35, pulses: 0.4 } }),
  },

  // ---- CV shapers: these WRAP the modulator already in the slot ----
  {
    kind: "quantize", tag: "Op", name: "quantize", sort: "mod", modSort: "op", group: "cvshape", params: ["root", "scale"],
    ins: 0, modTarget: null, phi: "n_mod_shape",
    tags: ["scale", "snap", "notes", "melody", "musical", "key", "semitone", "minor"],
    blurb: "Snaps whatever is driving it onto the notes of a scale. This is what turns a random voltage into a melody instead of a siren.",
    heard: "as pitch content that lands on a key. φ measures the spectrum, not the interval, so what it sees is the sample becoming less smeared.",
    glyph: `<path class="gl" d="M1 11 h2.6 V8.6 h2.6 V6.2 h2.6 V3.8 h2.6 V6.2 h2.6 V8.6 h2.6 V11 h2"/>`,
    frag: () => ({ Op: { kind: "quantize", p0: 0.0, p1: 0.4, input: { Rand: { rate: 0.5, glide: 0.0 } } } }),
  },
  {
    kind: "slew", tag: "Op", name: "slew", sort: "mod", modSort: "op", group: "cvshape", params: ["rise", "fall"],
    ins: 0, modTarget: null, phi: "n_mod_shape",
    tags: ["glide", "smooth", "portamento", "lag", "ramp", "soften", "sand"],
    blurb: "Limits how fast its input can move, with separate times up and down. Every step becomes a ramp — the difference between a burble and a wander.",
    heard: "as slower spectral movement. The steps it removes were the part φ noticed most.",
    glyph:
      `<path class="gl-ghost" d="M1 10.5 h4 V4 h5 V10.5 h4 V4 h5"/>` +
      `<path class="gl" d="M1 10.5 h2.6 L6.4 4 h2.2 L11 10.5 h2.4 L16 4 h3"/>`,
    frag: () => ({ Op: { kind: "slew", p0: 0.35, p1: 0.5, input: { Rand: { rate: 0.5, glide: 0.0 } } } }),
  },
  {
    kind: "rectify", tag: "Op", name: "rectify", sort: "mod", modSort: "op", group: "cvshape", params: ["mode"],
    ins: 0, modTarget: null, phi: "n_mod_shape",
    tags: ["fold", "abs", "positive", "negative", "half", "double", "polarity"],
    blurb: "Folds a modulator onto one side of zero. A triangle through it comes out at twice the rate; a bipolar source comes out only ever pushing one way.",
    heard: "as a doubling of the modulation rate, or as a modulator that only ever adds.",
    glyph:
      `<path class="gl-rule" d="M0 7 H20"/>` +
      `<path class="gl-ghost" d="M1 3.4 L5 10.6 L9 3.4 L13 10.6 L17 3.4"/>` +
      `<path class="gl" d="M1 3.4 L3 7 L5 3.4 L7 7 L9 3.4 L11 7 L13 3.4 L15 7 L17 3.4"/>`,
    frag: () => ({ Op: { kind: "rectify", p0: 0.5, p1: 0.0, input: { Lfo: { wave: "Triangle", rate: 0.4 } } } }),
  },
  {
    kind: "hold", tag: "Op", name: "hold", sort: "mod", modSort: "op", group: "cvshape", params: ["rate"],
    ins: 0, modTarget: null, phi: "n_mod_shape",
    tags: ["sample and hold", "step", "freeze", "latch", "clock", "stair"],
    blurb: "Samples whatever is driving it on a clock and holds that value until the next tick. Unlike s&h rand it samples a modulator you chose, not noise.",
    heard: "as stepped rather than continuous movement.",
    glyph:
      `<path class="gl-ghost" d="M1 7 q2.2 -4 4.4 0 t4.4 0 t4.4 0 t4.4 0"/>` +
      `<path class="gl" d="M1 8.6 h3 V4.4 h3 V6.6 h3 V10.4 h3 V6.6 h3 V4 h2"/>`,
    frag: () => ({ Op: { kind: "hold", p0: 0.45, p1: 0.0, input: { Lfo: { wave: "Sine", rate: 0.5 } } } }),
  },

  // ---- CV combiners: two modulators in, one out ----
  // Six variants of one shape, so they share a glyph vocabulary: the two
  // inputs on the left, the decision on the right.
  ...[
    ["min", "min", "the lower of the two, sample by sample — whichever modulator is quieter wins",
     `<path class="gl-ghost" d="M1 4 L9 4"/><path class="gl-ghost" d="M1 10 L9 10"/><path class="gl" d="M9 4 L11 10 L19 10"/>`,
     ["low", "floor", "smaller", "whichever"]],
    ["max", "max", "the higher of the two — the loudest modulator at each instant takes over",
     `<path class="gl-ghost" d="M1 4 L9 4"/><path class="gl-ghost" d="M1 10 L9 10"/><path class="gl" d="M9 10 L11 4 L19 4"/>`,
     ["high", "ceiling", "larger", "whichever"]],
    ["and", "and", "high only while both are high — the overlap of two patterns",
     `<path class="gl-ghost" d="M1 4 h5 v0 M1 10 h7"/><path class="gl" d="M6 11 h2 V4 h4 V11 h7"/>`,
     ["both", "overlap", "gate", "logic", "intersect"]],
    ["or", "or", "high while either is high — two patterns laid over each other",
     `<path class="gl-ghost" d="M1 4 h4 M1 10 h6"/><path class="gl" d="M1 11 h3 V4 h5 V11 h2 V4 h4 V11 h4"/>`,
     ["either", "union", "gate", "logic", "merge"]],
    ["xor", "xor", "high while exactly one is — two rhythms that never land together",
     `<path class="gl-ghost" d="M1 4 h4 M1 10 h6"/><path class="gl" d="M1 11 h3 V4 h3 V11 h3 V4 h3 V11 h6"/>`,
     ["exclusive", "either but not both", "polyrhythm", "logic", "cross"]],
    ["switch", "switch", "passes one or the other depending on which is winning — a hard cut between two modulators",
     `<path class="gl-ghost" d="M1 4 h6 M1 10 h6"/><path class="gl" d="M7 4 L11 4 M7 10 L10 10 L11 4 M11 4 h8"/>`,
     ["route", "select", "either", "punch", "swap"]],
  ].map(([kind, name, what, glyph, tags]) => ({
    kind, tag: "Pair", name, sort: "mod", modSort: "pair", group: "cvlogic",
    ins: 0, modTarget: null, phi: "n_mod_logic",
    tags: [...tags, "combine", "two"],
    blurb: `Takes two modulators and gives back ${what}.`,
    heard: "as a modulation shape φ has no name for — it sees only the movement that results.",
    glyph,
    // `a` is the modulator already in the slot when you place this; `b` is a
    // second one it needs to be worth having, so it arrives with an LFO
    // rather than an empty branch the grammar would fold away.
    frag: () => ({
      Pair: {
        // `ModOp`/`PairOp` serialise snake_case, and the palette's own kind
        // strings already are — capitalising here sent `"Min"` at an enum
        // spelled `"min"`, which failed to deserialise and rejected the whole
        // edit.
        kind,
        a: { Lfo: { wave: "Triangle", rate: 0.4 } },
        b: { Lfo: { wave: "Sine", rate: 0.62 } },
      },
    }),
  })),
];

const MOD_BY_KIND = Object.fromEntries(MODULES.map((m) => [m.kind, m]));
// The mod envelope is the one module whose engine spellings differ: `ModKind`
// serialises as `env` (what a structural edit sends) while `RackModule.kind`
// reads `modenv` (what the rack draws). Both resolve to the same entry, so no
// surface has to know which one it is holding.
MOD_BY_KIND.modenv = MOD_BY_KIND.env;
// `Op` and `Pair` are one serde tag each across ten palette entries, so a bare
// tag lookup would resolve every quantizer to whichever shaper was declared
// last. Those two go through `modEntry` instead, which reads the inner kind.
const MOD_BY_TAG = Object.fromEntries(
  MODULES.filter((m) => m.tag !== "Op" && m.tag !== "Pair").map((m) => [m.tag, m]),
);

/** The palette entry a modulation fragment came from, Op/Pair included. */
function modEntry(frag) {
  const tag = nodeTag(frag);
  if (tag === "Op" || tag === "Pair") {
    return MOD_BY_KIND[String(frag[tag].kind).toLowerCase()] || null;
  }
  return MOD_BY_TAG[tag] || null;
}
const SOURCE_TAGS = MODULES.filter((m) => m.sort === "source").map((m) => m.tag);

/** The palette's sections, in signal-flow order — which is deliberately not the
 *  order the grammar's categoricals are in. Enum order is an append-only wire
 *  format; this is how a person builds a patch. */
const NB_GROUPS = [
  { id: "sources", label: "sources", amber: false, note: "where the sound starts" },
  { id: "shape", label: "shape", amber: false, note: "what dirties it" },
  { id: "filter", label: "filter", amber: false, note: "what takes away" },
  { id: "space", label: "space", amber: false, note: "where it sits" },
  { id: "motion", label: "motion", amber: false, note: "what makes it move" },
  { id: "dynamics", label: "dynamics", amber: false, note: "what a second signal controls" },
  { id: "combine", label: "combine", amber: false, note: "how chains meet" },
  { id: "modulation", label: "modulation", amber: true, note: "what moves the knobs" },
  { id: "cvshape", label: "shape cv", amber: true, note: "what bends a modulator" },
  { id: "cvlogic", label: "combine cv", amber: true, note: "two modulators, one cable" },
];

/** Modules that can be inserted into a wire (everything but a source). */
const PROC_KINDS = MODULES.filter((m) => m.sort === "proc" || m.sort === "combine").map((m) => m.kind);
/** Modules that can only replace a node, never splice into one. */
const SOURCE_KINDS = MODULES.filter((m) => m.sort === "source").map((m) => m.kind);
/** Modulation sources, in the order the ⋯ menu offers them. */
const MOD_KINDS = MODULES.filter((m) => m.sort === "mod").map((m) => m.kind);

/** Display name for an engine `kind` string. */
function kindName(kind) {
  return MOD_BY_KIND[kind]?.name ?? kind;
}

/** Does the module at this rack kind carry a modulation slot? */
function kindModTarget(kind) {
  return MOD_BY_KIND[kind]?.modTarget ?? null;
}

// ---------- patch-tree JSON utils (serde externally-tagged AudioNode) ----------
function nodeTag(n) {
  return typeof n === "string" ? n : Object.keys(n)[0];
}

/** The serde field names holding a module's children, in `/0`, `/1` order.
 *  Binary nodes do not agree on them — a mixer has `a`/`b`, a ducker has
 *  `input`/`key`, a vocoder has `carrier`/`modulator` — so the walker reads
 *  them from the table rather than assuming. */
function childFields(m) {
  return m.fields || (m.ins === 2 ? ["a", "b"] : m.ins === 1 ? ["input"] : []);
}

function nodeChildrenJSON(n) {
  const tag = nodeTag(n);
  const v = n[tag];
  const m = MOD_BY_TAG[tag];
  if (!m || !v) return [];
  return childFields(m).map((f) => v[f]).filter(Boolean);
}

/** The child indices in a trace key: `node/0/1` → `[0, 1]`. */
function keyIndices(key) {
  return key === "node" ? [] : key.slice(5).split("/").map(Number);
}

function nodeAtKey(key) {
  if (!wb.tree) return null;
  return nodeAtIn(wb.tree, key);
}

/** `nodeAtKey`, but against a tree you are *holding* rather than the bench's.
 *  Every rewrite works on a clone, so it needs the walk without the global. */
function nodeAtIn(tree, key) {
  let cur = tree.root;
  for (const i of keyIndices(key)) {
    const ch = nodeChildrenJSON(cur);
    if (!ch[i]) return null;
    cur = ch[i];
  }
  return cur;
}

/** Put `node` at `key`. The parent's serde field name comes from the module
 *  table for the same reason `nodeChildrenJSON` reads it there: the binaries
 *  do not agree on their field names (`a`/`b`, `input`/`key`,
 *  `carrier`/`modulator`), and guessing one silently writes a field the
 *  engine will not deserialize. */
function setNodeAtIn(tree, key, node) {
  const path = keyIndices(key);
  if (path.length === 0) { tree.root = node; return true; }
  let cur = tree.root;
  for (let d = 0; d < path.length - 1; d++) {
    cur = nodeChildrenJSON(cur)[path[d]];
    if (!cur) return false;
  }
  const tag = nodeTag(cur);
  const field = childFields(MOD_BY_TAG[tag] || {})[path[path.length - 1]];
  if (!field || !cur[tag]) return false;
  cur[tag][field] = node;
  return true;
}

/** Every audio node in a tree, with the key it sits at *now*. */
function walkTreeKeys(tree, visit) {
  const rec = (n, key) => {
    visit(n, key);
    const tag = nodeTag(n);
    const v = n[tag];
    if (!v) return;
    childFields(MOD_BY_TAG[tag] || {}).forEach((f, i) => {
      if (v[f]) rec(v[f], `${key}/${i}`);
    });
  };
  if (tree && tree.root) rec(tree.root, "node");
}

/** Where a set of *node objects* ended up, as keys. A rewrite moves subtrees
 *  by reference, so object identity is the only handle on "the same node"
 *  that survives one — keys are positions and the positions are what moved.
 *  (A real `uid` is WS-4 §6; this is what there is until then.) */
function keysOfNodes(tree, nodes) {
  const out = new Set();
  if (!nodes || nodes.length === 0) return out;
  walkTreeKeys(tree, (n, key) => { if (nodes.includes(n)) out.add(key); });
  return out;
}

/** Is `k` the key `root`, or a key inside its subtree? This is the cycle test:
 *  the term is a tree, so a module cannot be plugged into itself or into
 *  anything it already feeds. */
function keyInside(k, root) {
  return k === root || k.startsWith(`${root}/`);
}

/** The key of the module a socket is drawn on: an input jack `node/0/1` hangs
 *  off the plate at `node/0`. The root's socket is the exception — the tree's
 *  root is `node` and the plate that carries its jack is the amp, whose rack
 *  key is `amp` and is not a trace address at all. */
function socketOwnerKey(childKey) {
  if (childKey === "node") return "amp";
  const i = childKey.lastIndexOf("/");
  return i < 0 ? childKey : childKey.slice(0, i);
}

function modAtKey(key) {
  const n = nodeAtKey(key);
  if (!n) return null;
  const tag = nodeTag(n);
  // Every module that declares a mod destination has a slot — the set used to
  // be hard-coded as filter-or-wavefolder, which is why a modulated delay was
  // unreachable in an instrument whose DSP had supported it all along.
  if (!MOD_BY_TAG[tag]?.modTarget) return null;
  const m = n[tag].modulation;
  return m === "None" ? null : m;
}

function subtreeSize(n) {
  return 1 + nodeChildrenJSON(n).reduce((s, c) => s + subtreeSize(c), 0);
}

// ---------- held modules (unplugged chains, waiting to go back) ----------
// This was "the tray", and it was a toll booth: the only route from the palette
// to the rack ran through it. Placement now goes direct, so its one remaining
// job is holding what you pulled out — which is what it is now named for.
const tray = [];
let trayUid = 1;

function fragLabel(frag, isMod) {
  const name = (isMod ? modEntry(frag) : MOD_BY_TAG[nodeTag(frag)])?.name
    ?? nodeTag(frag).toLowerCase();
  if (isMod) return name;
  const size = subtreeSize(frag);
  return name + (size > 1 ? `·${size}` : "");
}

/** The name on the plate at a trace key — the words the player has actually
 *  read off the rack. `fragLabel` answers in the term's own vocabulary
 *  (`wavefolder·3` is a kind plus a subtree size), which is right for a
 *  fragment on the shelf and a leak everywhere the thing being named is still
 *  a plate on screen: `·3` is notation nobody has been shown, and the number
 *  reads like an instance id. The pick chip has always named plates this way;
 *  these are the surfaces that had not. */
function plateTitle(key) {
  if (isPlaceholderKey(key)) return "the empty socket";
  const m = wb.rack?.modules.find((x) => x.key === key);
  const here = nodeAtKey(key);
  return m?.title || kindName(rackKindAt(key)) || (here ? fragLabel(here, false) : "that module");
}

/** …and how to name a whole subtree that is about to leave the patch: the
 *  plate at its head, plus an honest count of what is going with it. That
 *  count is the one true thing `·3` was saying, so it is kept — in the words
 *  the rest of the app already uses for it ("a 3-module chain"). */
function chainTitle(key) {
  const here = nodeAtKey(key);
  const n = here ? subtreeSize(here) : 1;
  const title = plateTitle(key);
  return n > 1 ? `${title} (a ${n}-module chain)` : title;
}

/** Put a fragment on the shelf. `opts.rewrap` marks a head-only module that
 *  wants to be spliced back *into* a wire rather than to take the socket —
 *  what bypass leaves behind. */
function stageFragment(frag, isMod, opts) {
  if (!frag) return null;
  const uid = trayUid++;
  const o = opts || {};
  // A `rewrap` head carries a stand-in input that `graft` will overwrite the
  // moment it goes back in, so counting it would print "wavefolder·2" for one
  // bypassed wavefolder — a number about an implementation detail.
  const label = o.rewrap
    ? (modEntry(frag)?.name ?? nodeTag(frag).toLowerCase())
    : fragLabel(frag, isMod);
  tray.push({ uid, isMod, frag, label, ...o });
  // Staging is part of the edit that caused it: if the engine refuses that
  // edit, this fragment describes a chain that never left the patch, and a
  // shelf holding a duplicate of something still wired up is a lie.
  if (stagingBound) stagingBound.trays.push(uid);
  renderTray();
  trayChanged();
  return uid;
}

/** Mark a shelf entry as belonging to an edit that is still in flight. It stays
 *  visible — the module is not in the patch yet, and a shelf that empties on a
 *  promise is how the chain got lost in the first place — but it is inert until
 *  the engine has answered, so the same chain cannot be placed twice. */
function setTrayPending(uid, on) {
  const t = tray.find((x) => x.uid === uid);
  if (!t || !!t.pending === !!on) return;
  t.pending = !!on;
  renderTray();
}

function unstage(uid) {
  const i = tray.findIndex((t) => t.uid === uid);
  if (i >= 0) tray.splice(i, 1);
  renderTray();
  trayChanged();
}

// The shelf used to be `const tray = []` and nothing else, so everything you
// had pulled out of a patch died on reload — the one place in the app where
// "removed, but recoverable" quietly stopped being true after a refresh. It
// rides in the same `ui` blob as the rest of the surface's state.
function trayChanged() {
  if (booted) scheduleSave();
}
function trayState() {
  return {
    // The subject it was pulled out of, so the shelf can say where a fragment
    // came from. Deliberately not a *gate*: a held chain is a chain, and it
    // is legal in any patch — refusing to show it because the bench happens
    // to have opened something else would make the shelf lie by omission.
    from: wb.subjectId ?? null,
    items: tray.map((t) => ({
      isMod: t.isMod, frag: t.frag, label: t.label,
      rewrap: !!t.rewrap, note: t.note || "",
    })),
  };
}
function restoreTray(saved) {
  if (!saved || !Array.isArray(saved.items)) return;
  for (const it of saved.items) {
    if (!it || !it.frag) continue;
    tray.push({
      uid: trayUid++, isMod: !!it.isMod, frag: it.frag,
      label: it.label || fragLabel(it.frag, !!it.isMod),
      rewrap: !!it.rewrap, note: it.note || "",
    });
  }
  renderTray();
}

// The head node's own parameters, as a readable strip — the staged module
// shows what it actually is, not just a name tag.
function fragParamStrip(frag) {
  const tag = nodeTag(frag);
  const body = frag[tag] || {};
  // `Op` and `Pair` carry their identity in a `kind` field and their two
  // parameters in generic `p0`/`p1` slots, because one term shape serves ten
  // palette entries. Neither belongs on a faceplate: the card's own title
  // already says `quantize`, and `p0` is a leaked identifier — the exact
  // defect `mod_depth` was fixed for.
  const named = modEntry(frag)?.params;
  const parts = [];
  let chain = 0;
  for (const [k, v] of Object.entries(body)) {
    if (v && typeof v === "object") { chain += subtreeSize(v); continue; }
    if (v === "None" || k === "kind") continue;
    const slot = k === "p0" ? 0 : k === "p1" ? 1 : -1;
    if (slot >= 0 && named && !named[slot]) continue; // a one-parameter op
    // Serde field names are the wire, not the silkscreen.
    const label = slot >= 0 && named ? named[slot] : k.replace(/_/g, " ");
    if (typeof v === "number") {
      parts.push(`${label} ${v >= 1 || v <= -1 || Number.isInteger(v) ? v : `${Math.round(v * 100)}%`}`);
    } else {
      parts.push(`${label} ${String(v).toLowerCase()}`);
    }
  }
  if (chain > 1) parts.push(`+${chain} in chain`);
  return parts.join(" · ");
}

function renderTray() {
  const holder = $("tray-items");
  holder.innerHTML = "";
  nbRenderRail();
  if (tray.length === 0) {
    holder.innerHTML =
      '<span class="tray-hint mono">Anything you unplug, delete or bypass is held here — and stays here across a reload. Drag it back onto a ○ to put it in.</span>';
    return;
  }
  for (const t of tray) {
    const el = document.createElement("div");
    el.className = "tray-item" + (t.isMod ? " mod" : "") + (t.pending ? " pending" : "");
    const jackTitle = t.pending
      ? "going into the patch — waiting for the engine"
      : `Drag onto a ${t.isMod ? "mod ○" : "in ○"} jack`;
    el.innerHTML = `
      <div class="ti-head">
        <span class="t-jack" title="${esc(jackTitle)}"></span>
        <span class="ti-name">${esc(t.label)}${t.note ? ` <span class="ti-why">${esc(t.note)}</span>` : ""}</span>
        <button class="t-x" title="Discard">✕</button>
      </div>
      <div class="ti-params mono">${esc(fragParamStrip(t.frag)) || "—"}</div>`;
    // Discarding something the engine is in the middle of accepting would race
    // its own reply, so the ✕ waits with it.
    el.querySelector(".t-x").onclick = () => {
      if (t.pending) return note("that one is going into the patch — give it a moment");
      unstage(t.uid);
    };
    const tjack = el.querySelector(".t-jack");
    claimGesture(tjack); // the tray scrolls sideways; the cable pull is not that
    tjack.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      if (t.pending) return;
      startWireDrag({ mode: t.isMod ? "tray-mod" : "tray-audio", item: t, kind: t.isMod ? "mod" : "audio" }, ev);
    });
    holder.appendChild(el);
  }
}

// ===========================================================================
// THE NODE BANK — the instrument's catalogue
// ===========================================================================
// It was twelve mono words in a 168px column with one tooltip repeated twelve
// times, and the only route out of it ran through the tray. It is now an
// indexed catalogue: it says what each module *does to a signal*, where it can
// legally go, and — where the model has enough evidence to be honest about it —
// what the model currently thinks of it.
//
// The primary gesture is ARM-AND-PLACE, not press-drag: click a module, the
// legal sockets light up and name what will happen to them, click one. That is
// the same two clicks whether you use the mouse or the keyboard, and unlike a
// 6px drop target it cannot miss. Press-drag from a chip still works as the
// expert path.

const NB_STORE = "ricercar-nodebank";
const nbState = {
  collapsed: false,
  width: 0, // 0 = follow the CSS clamp
  groups: {}, // id -> false when the section is folded shut
};

function nbLoad() {
  try {
    // Only the keys this version knows about: a stored preference that has
    // been retired should not keep round-tripping through the save forever.
    const saved = JSON.parse(localStorage.getItem(NB_STORE) || "{}");
    for (const k of Object.keys(nbState)) if (k in saved) nbState[k] = saved[k];
  } catch (e) { /* a corrupt preference is not worth a broken palette */ }
}
function nbSave() {
  try { localStorage.setItem(NB_STORE, JSON.stringify(nbState)); } catch (e) {}
}

/** What is currently in your hand: `{kind, mode, key}`, or null. */
let armed = null;
/** Sockets lit for the armed module, and which one the keyboard is on. */
let armedSockets = [];
let armedIdx = -1;
/** Set by the rack's ⋯ menu: the next module you pick goes straight here. */
let pendingTarget = null;

function nbAnnounce(text) {
  const el = $("nb-live");
  if (el) el.textContent = text;
}

// ---- pool support: how often the model has actually seen a module ----
// Counted client-side off the `sexpr` each ranked row already carries, so this
// costs no new wasm surface and is honest from the first vote.
function nbSupport() {
  // Cut patches are gone from every other count in the app (see bankSource),
  // and they are not what the model is reasoning over either.
  const rows = ((views && views.ranked) || []).filter((r) => !cutIds.has(r.id));
  const counts = {};
  for (const m of MODULES) counts[m.kind] = 0;
  for (const r of rows) {
    if (!r.sexpr) continue;
    // `sx` is the head token the grammar's compact s-expression actually
    // writes, which is not always the module kind (`distortion` prints as
    // `dist`). Counting the kind blind would have shown "the model has never
    // seen a distortion" on a pool full of them.
    for (const m of MODULES) if (r.sexpr.includes(`(${m.sx || m.kind} `)) counts[m.kind] += 1;
  }
  // The coefficient is fitted per FAMILY (`n_drive` covers fold, distortion
  // and bitcrush), so the evidence behind it is every patch using any of them.
  // Gating a family's θ on one member's prevalence measured a different
  // quantity from the one it was guarding.
  const byPhi = {};
  for (const m of MODULES) {
    if (!m.phi) continue;
    byPhi[m.phi] = (byPhi[m.phi] || 0) + counts[m.kind];
  }
  return { counts, byPhi, total: rows.length };
}

/** Below this many patches carrying the coordinate, the model has no business
 *  having an opinion at all — and the rail says so with a dash, not a bar. */
const NB_SUPPORT_MIN = 5;
/** …and having looked is still not the same as having found something. A
 *  coefficient whose |mean| is inside its own σ is not distinguishable from
 *  zero, so drawing a bar and saying "you lean toward it" asserts a direction
 *  the posterior does not have. The engine already refuses to let such a θ
 *  move a proposal (`shrink` in engine.rs); the surface has to be at least as
 *  careful, because here it is being read as the user's own taste. */
function beliefState(t, support) {
  if (!t) return "unfitted";
  if (support < NB_SUPPORT_MIN) return "thin";
  return Math.abs(t.mean) >= t.std ? "resolved" : "flat";
}

/** The φ coordinate a module's belief is read from, and the dominant style. */
function nbTheta(kind) {
  const phi = MOD_BY_KIND[kind]?.phi;
  if (!phi || !views || !views.styles || views.styles.length === 0) return null;
  const styles = activeStyles();
  const s = styles[0];
  if (!s || !s.theta) return null;
  const row = s.theta.find((t) => t.name === phi);
  if (!row) return null;
  return { mean: row.mean, std: row.std, style: s.k, share: s.share };
}

// ---- building ----
function nbChip(m) {
  const b = document.createElement("button");
  b.className = "nb-item" + (m.sort === "mod" ? " mod" : "");
  b.dataset.kind = m.kind;
  b.type = "button";
  b.setAttribute("aria-label", `${m.name} — ${m.blurb}`);
  // Port signature: green rings for audio, an amber one for a modulation slot.
  // Both phosphors are on the chip AT REST — hover intensifies them rather than
  // revealing them, which is the difference between a colour law being used
  // and merely obeyed. One invariant reading: [inputs] → [output], with the
  // modulation slot appended as a dashed amber pip. The first rule dropped the
  // arrow when there were no inputs, so vco, supersaw and noise printed
  // nothing at all in the column that is supposed to say what shape a module is.
  // Drawn, not typed: an 8px glyph would be the second exception to the type
  // scale's 10px floor, and this one has no argument for it.
  const arrow = '<svg class="pip-arrow" viewBox="0 0 8 6"><path d="M0.5 3 H6.4 M4.6 1.2 L6.6 3 L4.6 4.8"/></svg>';
  const pips =
    '<i class="pip"></i>'.repeat(m.sort === "mod" ? 0 : m.ins) +
    arrow +
    (m.sort === "mod" ? '<i class="pip mod"></i>' : '<i class="pip"></i>') +
    (m.modTarget ? '<i class="pip mod"></i>' : "");
  b.innerHTML =
    `<svg class="nb-glyph" viewBox="0 0 20 14" aria-hidden="true">${m.glyph}</svg>` +
    `<span class="ni-name">${esc(m.name)}</span>` +
    `<span class="ni-pips" aria-hidden="true">${pips}</span>` +
    `<span class="ni-theta" aria-hidden="true"></span>`;
  return b;
}

function buildNodeBank() {
  nbLoad();
  const groups = $("nb-groups");
  groups.innerHTML = "";
  for (const g of NB_GROUPS) {
    const sec = document.createElement("section");
    sec.className = "nb-group" + (g.amber ? " amber" : "");
    sec.dataset.group = g.id;
    const members = MODULES.filter((m) => m.group === g.id);
    const hid = `nb-h-${g.id}`;
    sec.innerHTML =
      `<h3 class="nb-sect" id="${hid}">` +
      `<button class="nb-fold" type="button" aria-expanded="true" aria-controls="nb-l-${g.id}">` +
      `<svg class="nb-caret" viewBox="0 0 7 5" aria-hidden="true"><path d="M0.8 1.2 L3.5 3.9 L6.2 1.2"/></svg>${esc(g.label)}` +
      `<span class="nb-note">${esc(g.note)}</span>` +
      `<span class="nb-n mono">${members.length}</span></button></h3>` +
      `<div class="nb-list" id="nb-l-${g.id}" role="group" aria-labelledby="${hid}"></div>` +
      `<p class="nb-why hidden"></p>`;
    const list = sec.querySelector(".nb-list");
    for (const m of members) list.appendChild(nbChip(m));
    const fold = sec.querySelector(".nb-fold");
    fold.onclick = () => {
      // Inert while a placement is armed. Folding a group under the pointer
      // while pick mode stays silently armed is how a player ends up with a
      // module in hand and no memory of picking one up.
      if (armed || pendingTarget) {
        return note(
          armed
            ? `${kindName(armed.kind)} is in your hand — click a lit socket, or esc to put it down.`
            : "A socket is waiting for a module — pick one, or esc to cancel.",
        );
      }
      const shut = sec.classList.toggle("folded");
      fold.setAttribute("aria-expanded", String(!shut));
      nbState.groups[g.id] = !shut;
      nbSave();
    };
    if (nbState.groups[g.id] === false) {
      sec.classList.add("folded");
      fold.setAttribute("aria-expanded", "false");
    }
    groups.appendChild(sec);
  }

  // One delegated listener for the whole catalogue — nineteen chips today, and
  // the count is the thing most likely to change.
  groups.addEventListener("click", (ev) => {
    const chip = ev.target.closest(".nb-item");
    if (!chip) return;
    // A dimmed chip still answers when clicked. Returning silently is how a
    // disabled control teaches nothing about why it is disabled.
    if (chip.classList.contains("unavailable")) {
      // The same sentence the chip already carries on hover, so the two
      // channels cannot drift — and so a click is never answered with silence.
      note(chip.title || "That module can't go here.");
      return;
    }
    pickModule(chip.dataset.kind);
  });
  groups.addEventListener("pointerdown", (ev) => {
    const chip = ev.target.closest(".nb-item");
    if (!chip || chip.classList.contains("unavailable") || ev.button !== 0) return;
    nbDragFrom(chip, ev);
  });
  groups.addEventListener("pointerover", (ev) => {
    const chip = ev.target.closest(".nb-item");
    if (chip) nbSpecShow(chip);
  });
  groups.addEventListener("focusin", (ev) => {
    const chip = ev.target.closest(".nb-item");
    // Only the keyboard gets a floating card, and it is anchored over the rail
    // rather than over the canvas — see nbSpecPaint.
    if (chip) nbSpecShow(chip, { float: true });
  });
  groups.addEventListener("pointerout", (ev) => {
    if (!ev.relatedTarget || !ev.relatedTarget.closest(".nb-item")) nbSpecHide();
  });
  groups.addEventListener("focusout", nbSpecHide);
  groups.addEventListener("keydown", nbGridKeys);

  const q = $("nb-q");
  q.addEventListener("input", renderNodeBank);
  q.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      // The ⋯ handoff drops focus in this field and says "esc to cancel", and
      // this listener used to stop the event before the document handler that
      // actually cancels it ever ran — so the pending socket survived, and the
      // next module you picked, minutes later, edited a stale key.
      if (pendingTarget) cancelPending();
      else if (q.value) { q.value = ""; renderNodeBank(); }
      else q.blur();
      ev.stopPropagation();
    } else if (ev.key === "Enter") {
      const first = $("nb-groups").querySelector(".nb-item:not(.hidden):not(.unavailable)");
      if (first) pickModule(first.dataset.kind);
    } else if (ev.key === "ArrowDown") {
      const first = $("nb-groups").querySelector(".nb-item:not(.hidden)");
      if (first) { first.focus(); ev.preventDefault(); }
    }
  });

  $("nb-tour-btn").onclick = () => {
    if (nbTourAt >= 0) return endNbTour();
    nbTourAt = 0;
    showNbTourStep();
  };
  $("nbt-next").onclick = () => { nbTourAt += 1; showNbTourStep(); };
  $("nbt-back").onclick = () => { nbTourAt -= 1; showNbTourStep(); };
  $("nbt-skip").onclick = endNbTour;

  // The group headers park under the header band, so the band's height is a
  // layout constant two rules apart. Measure it rather than write it twice.
  const headH = Math.round(
    document.querySelector(".nb-head")?.getBoundingClientRect().height || 0,
  );
  if (headH > 0) $("nodebank").style.setProperty("--nb-head-h", `${headH}px`);

  $("nb-collapse").onclick = () => nbSetCollapsed(!nbState.collapsed);
  $("nb-rail").onclick = () => nbSetCollapsed(false);
  nbSetCollapsed(nbState.collapsed, true);
  nbInitResize();
  renderNodeBank();
  renderSpecDock();
}

// ---- collapse: a drawer with an identity and a memory ----
function nbSetCollapsed(shut, silent) {
  nbState.collapsed = !!shut;
  const nb = $("nodebank");
  nb.classList.toggle("collapsed", nbState.collapsed);
  const btn = $("nb-collapse");
  btn.textContent = nbState.collapsed ? "◂" : "▸";
  btn.title = nbState.collapsed ? "Show the node bank" : "Collapse the node bank";
  btn.setAttribute("aria-expanded", String(!nbState.collapsed));
  if (nbState.collapsed) disarm();
  if (!silent) nbSave();
  renderNodeBank();
}

// ---- the rail can be dragged wider; the width is remembered ----
function nbInitResize() {
  const h = $("nb-resize");
  if (!h) return;
  if (nbState.width) $("nb-body").style.width = `${nbState.width}px`;
  h.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    const body = $("nb-body");
    const startX = ev.clientX;
    const startW = body.getBoundingClientRect().width;
    const move = (mv) => {
      const w = Math.round(Math.max(196, Math.min(320, startW + (startX - mv.clientX))));
      body.style.width = `${w}px`;
      nbState.width = w;
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      nbSave();
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  });
}

/** While something is in your hand the group headers stop being controls
 *  (WS-2 §2): the rail's job for the length of a placement is to narrow, not
 *  to rearrange itself under the pointer. Called from every place that changes
 *  what is in hand, because arming does not otherwise re-render the rail. */
function nbSetHolding() {
  const holding = !!(armed || pendingTarget);
  const groups = $("nb-groups");
  if (!groups) return holding;
  groups.classList.toggle("armed", holding);
  for (const fold of groups.querySelectorAll(".nb-fold")) {
    fold.setAttribute("aria-disabled", String(holding));
    fold.title = holding ? "Folding is off while a placement is armed — esc to put it down." : "";
  }
  return holding;
}

/** Why a chip is dimmed, in one sentence, in the player's terms. The reasons
 *  are genuinely different — no patch / nothing to modulate / wrong sort for
 *  the socket you already chose — and collapsing them into "unavailable" is
 *  what makes a filtered palette feel arbitrary. A *wrong* reason is worse
 *  than a collapsed one: the mismatch branch had two arms for three cases, so
 *  every source chip dimmed by an insert socket was told it "moves knobs" and
 *  "does not carry audio", which is false about all six of them. */
function chipBlockedWhy(m, { hasRack, hasModSocket, mismatch }) {
  if (!hasRack) return "No patch loaded — pick one from the bank on the left first.";
  if (mismatch) {
    if (pendingTarget.accepts.includes("mod")) {
      return `${m.name} carries audio — that jack carries control voltage. Pick something amber.`;
    }
    // A source has no input, so there is no wire to splice it into: it starts
    // the signal rather than passing one through. The socket already chosen is
    // an insert, and the only thing a source can do to a socket is take it.
    if (m.sort === "source") {
      return `${m.name} has no input — it starts a signal rather than passing one through, so it cannot go into a wire. It can only replace what feeds something.`;
    }
    return `${m.name} moves knobs; it does not carry audio, so it cannot sit in the signal path — it goes in a mod slot.`;
  }
  if (m.sort === "mod" && !hasModSocket) {
    return `Nothing in this patch takes modulation yet — add a filter and ${m.name} has somewhere to go.`;
  }
  return "";
}

/** The belief cell. A bar without evidence is a lie with a shape, so anything
 *  short of a resolved coefficient draws a mark that is not a bar.
 *  Shared by the catalogue chips and the in-patch chips: the model must not
 *  speak loudest about the modules you are merely browsing and go silent about
 *  the ones you actually built with (WS-2 §7). */
function nbPaintTheta(cell, m, byPhi, total) {
  if (!cell) return;
  const t = nbTheta(m.kind);
  const sup = m.phi ? (byPhi[m.phi] || 0) : 0;
  const state = m.phi ? beliefState(t, sup) : "unmeasured";
  if (state !== "resolved") {
    cell.className = "ni-theta " + (state === "flat" ? "flat" : "thin");
    cell.innerHTML = "";
    cell.title =
      state === "unmeasured" ? "Not something the taste model measures directly."
      : state === "unfitted" ? "The model hasn't been fitted yet — make a few picks."
      : state === "thin" ? `Too little to go on — ${sup} of ${total} patches carry this.`
      : `The model has looked and has no lean either way (θ ${t.mean.toFixed(2)} ± ${t.std.toFixed(2)}).`;
    return;
  }
  // 16px of travel each side of the zero rule (see .ni-theta), so the
  // clamps are the geometry rather than a number that overflows it.
  const scale = 14; // px per unit θ
  const len = Math.max(2, Math.min(15, Math.abs(t.mean) * scale));
  const whisk = Math.min(16, (Math.abs(t.mean) + t.std) * scale);
  const color = STYLE_COLORS[t.style % STYLE_COLORS.length];
  cell.className = "ni-theta" + (t.mean >= 0 ? " pos" : " neg");
  cell.innerHTML =
    `<i class="tb-whisk" style="width:${whisk}px"></i>` +
    `<i class="tb-bar" style="width:${len}px;background:${color}"></i>`;
  cell.title =
    `In ${styleName(views.styles[t.style], t.style)} (${Math.round(t.share * 100)}% of your bank) ` +
    `you lean ${t.mean >= 0 ? "toward" : "away from"} this ` +
    `— θ ${t.mean >= 0 ? "+" : "−"}${Math.abs(t.mean).toFixed(2)} ± ${t.std.toFixed(2)}, ` +
    `from ${sup} of ${total} patches.`;
}

// ---- render: filter, availability, and the model's belief ----
function renderNodeBank() {
  const groups = $("nb-groups");
  if (!groups || !groups.firstChild) return;
  const q = ($("nb-q").value || "").trim().toLowerCase();
  const hasRack = !!wb.rack;
  const hasModSocket = hasRack && wb.rack.modules.some((m) => kindModTarget(m.kind));
  const { byPhi, total } = nbSupport();

  let shown = 0;
  for (const chip of groups.querySelectorAll(".nb-item")) {
    const m = MOD_BY_KIND[chip.dataset.kind];
    const hit = !q || m.name.includes(q) || m.tags.some((t) => t.includes(q));
    chip.classList.toggle("hidden", !hit);
    if (hit) shown += 1;

    // Unavailable is explained, never silent — see the per-group note below.
    // A handoff from the canvas (the ⋯ menu, or a cable dropped in empty
    // space) narrows this further: the socket is already chosen, so a module
    // that cannot sit in it is dimmed *now* rather than refused after the
    // click. The reason rides on the chip so it is readable, not just
    // announced.
    const mismatch = !!pendingTarget && !pendingTarget.accepts.includes(m.sort);
    const blocked = !hasRack || (m.sort === "mod" && !hasModSocket) || mismatch;
    chip.classList.toggle("unavailable", blocked);
    chip.setAttribute("aria-disabled", String(blocked));
    // Every dimmed chip carries the sentence that explains it, on the chip
    // itself rather than only in the announcement — a disabled control that
    // does not say why teaches the player that the app is arbitrary.
    const why = blocked ? chipBlockedWhy(m, { hasRack, hasModSocket, mismatch }) : "";
    if (why) chip.title = why;
    else if (chip.title) chip.title = "";
    // Roving tab stop, set per group below: nineteen tab stops in a sidebar
    // would put the whole catalogue between the search field and the rack.
    chip.tabIndex = -1;

    nbPaintTheta(chip.querySelector(".ni-theta"), m, byPhi, total);
  }

  nbSetHolding();

  // Group-level counts, folding and the explained-unavailable copy.
  for (const g of NB_GROUPS) {
    const sec = groups.querySelector(`[data-group="${g.id}"]`);
    const vis = [...sec.querySelectorAll(".nb-item:not(.hidden)")].length;
    sec.classList.toggle("empty", vis === 0);
    // A group folded shut still matches the query, and its count still says
    // so — showing "2" above a collapsed panel is a count that points at
    // nothing. Search opens what it finds without overwriting the user's folds.
    if (q && vis > 0) sec.classList.remove("folded");
    else if (!q && nbState.groups[g.id] === false) sec.classList.add("folded");
    sec.querySelector(".nb-n").textContent = q ? `${vis}` : `${MODULES.filter((m) => m.group === g.id).length}`;
    // One tab stop per group; arrows move inside it, ←/→ jump between groups.
    const first = sec.querySelector(".nb-item:not(.hidden):not(.unavailable)");
    if (first) first.tabIndex = 0;
    const why = sec.querySelector(".nb-why");
    if (g.id === "modulation" && hasRack && !hasModSocket) {
      why.classList.remove("hidden");
      why.innerHTML =
        `Nothing in this patch takes modulation yet — ` +
        `<button class="nb-inline" type="button">add a filter</button> and its mod input appears.`;
      why.querySelector(".nb-inline").onclick = () => pickModule("filter");
    } else {
      why.classList.add("hidden");
      why.innerHTML = "";
    }
  }

  // The belief column appears the moment the model has any styles at all.
  groups.classList.toggle("has-belief", !!(views && views.styles && views.styles.length));
  nbRenderInPatch();

  $("nb-count").textContent = q ? `${shown} of ${MODULES.length}` : `${MODULES.length}`;
  const none = $("nb-none");
  none.classList.toggle("hidden", shown > 0 || !q);
  $("nb-empty").classList.toggle("hidden", hasRack);
  nbRenderRail();
}

/** What the bench patch is made of, as glyph chips. Clicking one puts the
 *  keyboard on that module in the rack — the rail is a legend for the canvas
 *  beside it, not only a shopping list. */
function nbRenderInPatch() {
  const sec = $("nb-inpatch");
  const list = $("nb-inpatch-list");
  const mods = (wb.rack && wb.rack.modules) || [];
  const real = mods.filter((m) => MOD_BY_KIND[m.kind]);
  sec.classList.toggle("hidden", real.length === 0);
  if (real.length === 0) { list.innerHTML = ""; return; }
  $("nb-inpatch-n").textContent = String(real.length);
  // The same three columns the catalogue chip has, including the belief cell:
  // the model was speaking loudest about modules you were merely shopping for
  // and going silent about the ones you had actually built with (WS-2 §7).
  list.innerHTML = real
    .map((m) => {
      const d = MOD_BY_KIND[m.kind];
      return (
        `<button class="nb-chip${d.sort === "mod" ? " mod" : ""}" type="button" ` +
        `data-key="${esc(m.key)}" data-kind="${esc(m.kind)}" ` +
        `title="${esc(d.name)} — jump to it in the rack">` +
        `<svg class="nb-glyph" viewBox="0 0 20 14" aria-hidden="true">${d.glyph}</svg>` +
        `<span>${esc(d.name)}</span>` +
        `<span class="ni-theta" aria-hidden="true"></span></button>`
      );
    })
    .join("");
  const { byPhi, total } = nbSupport();
  list.classList.toggle("has-belief", !!(views && views.styles && views.styles.length));
  list.querySelectorAll(".nb-chip").forEach((b) => {
    nbPaintTheta(b.querySelector(".ni-theta"), MOD_BY_KIND[b.dataset.kind], byPhi, total);
    // …and the same spec card. A module in your patch deserves at least the
    // transparency one you are browsing gets.
    b.addEventListener("pointerover", () => nbSpecShow(b));
    b.addEventListener("focus", () => nbSpecShow(b));
    b.onclick = () => {
      const g = $("rack-svg").querySelector(`.jack[data-childkey="${b.dataset.key}/0"], [data-addr^="${b.dataset.key}#"]`);
      const el = g || $("rack-svg").querySelector(`[data-addr^="${b.dataset.key}#"]`);
      if (el) {
        // Explicit navigation — the one case that *should* move the canvas.
        ensureRackVisible(el);
        if (el.hasAttribute("data-addr")) { el.setAttribute("tabindex", "0"); el.focus({ preventScroll: true }); }
      }
    };
  });
}

/** Re-apply the palette's view of the rack after the rack is rebuilt: the
 *  availability pass, and the lit sockets for whatever is still in hand. */
function nbSync() {
  renderNodeBank();
  if (!armed) return;
  if (!wb.rack) return disarm();
  lightSockets();
  if (armedSockets.length === 0) disarm();
}

function nbRenderRail() {
  const rail = $("nb-rail");
  const held = tray.length;
  rail.innerHTML =
    `<span class="rail-word">node bank</span>` +
    `<span class="rail-n mono">${MODULES.length}</span>` +
    (held ? `<span class="rail-held mono" title="${held} module${held > 1 ? "s" : ""} held below">${held}</span>` : "");
  rail.title = "Show the node bank";
}

// ---- the spec card ----
// Two surfaces, one body of copy.
//
// The DOCK is the primary one: a reserved strip in the bench's lower band that
// keeps whatever it last described. The card used to float over the graph it
// was describing, so you could read what a module does OR look at where it
// would land, never both — while ~40% of the bench sat empty underneath.
// Reading left to right: what it is, what it does, what the model thinks of
// it. Its height is reserved whatever is in it, so nothing under the pointer
// ever moves.
//
// The FLOATING variant survives for the keyboard path only, where the card has
// to be beside the chip that has focus, and it is anchored clear of the canvas.
let specTimer = null;
function nbSpecShow(chip, opts) {
  clearTimeout(specTimer);
  // `float` is the keyboard path only. A pointer already knows where it is
  // pointing; a card that follows it over the canvas is the thing that made
  // the spec and the landing site mutually exclusive to look at.
  const float = !!(opts && opts.float);
  const kind = chip.dataset.kind;
  specTimer = setTimeout(() => nbSpecPaint(kind, float ? chip : null), 180);
}
function nbSpecHide() {
  clearTimeout(specTimer);
  $("nb-spec").classList.add("hidden");
  // The dock deliberately keeps its subject. It is a place you read *from*,
  // not a tooltip: leaving the chip to look at where the module would go must
  // not take the description away at the moment it becomes useful.
}

/** The kind the dock is currently describing, or null for the resting line. */
let specSubject = null;

/** Everything both surfaces say about a module, derived once. */
function specParts(m) {
  const { byPhi, total } = nbSupport();
  const sup = m.phi ? (byPhi[m.phi] || 0) : 0;
  const t = nbTheta(m.kind);
  // Several modules share one coordinate on purpose (see structural.rs). Saying
  // "the model likes distortion" when the coefficient cannot separate it from a
  // wavefolder would be the surface claiming a resolution the model lacks.
  const shared = m.phi ? MODULES.filter((x) => x.phi === m.phi).map((x) => x.name) : [];

  const ports =
    m.sort === "mod"
      ? "out — modulation"
      : [m.ins === 2 ? "a, b — audio in" : m.ins === 1 ? "in — audio in" : null,
         "out — audio",
         m.modTarget ? `mod → ${m.modTarget}` : null]
          .filter(Boolean).join(" · ");

  // Four different silences, and they are not the same sentence: this is not
  // measured / the model has not been fitted / too few examples / here is what
  // it thinks. Collapsing any of them into "no data" is how a HITL surface
  // starts implying more than it knows.
  // Five distinct silences, and they are not the same sentence: this is not
  // measured / the model has not been fitted / too few examples / it looked and
  // found no lean / here is what it thinks. Collapsing any of them into "no
  // data" is how a human-in-the-loop surface starts implying more than it knows.
  const state = m.phi ? beliefState(t, sup) : "unmeasured";
  let belief;
  if (state === "unmeasured") {
    belief = `<span class="sp-dim">Not a coordinate the taste model measures on its own.</span>`;
  } else if (state === "unfitted") {
    belief = `<span class="sp-dim">The model hasn't been fitted yet — make a few picks.</span>`;
  } else if (state === "thin") {
    belief = `<span class="sp-dim">In ${sup} of ${total} patches — too few for the model to have an opinion yet.</span>`;
  } else if (state === "flat") {
    belief =
      `<span class="sp-dim">In ${sup} of ${total} patches. The model has looked and has no lean either way ` +
      `— θ ${t.mean.toFixed(2)} ± ${t.std.toFixed(2)}, an interval that straddles zero.</span>`;
  } else {
    const color = STYLE_COLORS[t.style % STYLE_COLORS.length];
    belief =
      `<span class="sp-dim">In ${sup} of ${total} patches.</span> ` +
      `<i class="sp-dot" style="background:${color}"></i>` +
      `<span class="sp-belief">in ${esc(styleName(views.styles[t.style], t.style))} ` +
      `(${Math.round(t.share * 100)}% of your bank) you lean ${t.mean >= 0 ? "toward" : "away from"} it` +
      ` — θ ${t.mean >= 0 ? "+" : "−"}${Math.abs(t.mean).toFixed(2)} ± ${t.std.toFixed(2)}</span>`;
  }
  if (shared.length > 1) {
    belief +=
      `<br><span class="sp-dim">The model does not separate ${esc(shared.join(", "))} — ` +
      `they share one coordinate, so this belief is about all of them.</span>`;
  }
  return { ports, belief, params: fragParamStrip(m.frag()) || "—" };
}

function specGlyph(m, cls) {
  return `<svg class="sp-glyph${cls || ""}${m.sort === "mod" ? " mod" : ""}" viewBox="0 0 20 14" aria-hidden="true">${m.glyph}</svg>`;
}

function nbSpecPaint(kind, chip) {
  const m = MOD_BY_KIND[kind];
  if (!m) return;
  specSubject = kind;
  renderSpecDock();
  if (!chip) return;
  // The keyboard's card. Compact — the dock already carries the long form —
  // and pinned to the right edge, over the rail it came from rather than over
  // the canvas the player is about to place into.
  const p = specParts(m);
  const card = $("nb-spec");
  card.innerHTML =
    `<div class="sp-head">${specGlyph(m)}<span class="panel-label">${esc(m.name)}</span></div>` +
    `<div class="sp-ports mono">${esc(p.ports)}</div>` +
    `<div class="sp-model mono">${p.belief}</div>`;
  const r = chip.getBoundingClientRect();
  card.classList.remove("hidden");
  const ch = card.offsetHeight;
  card.style.top = `${Math.max(8, Math.min(window.innerHeight - ch - 8, r.top - 6))}px`;
  card.style.right = `8px`;
}

/** The docked strip. Three states, and only one of them is a description:
 *  resting, describing, and — while something is in your hand — collapsed to
 *  one line, because the question has changed from "what is this" to "where
 *  is it going", and that one is answered on the canvas. */
function renderSpecDock() {
  const dock = $("spec-dock");
  if (!dock) return;
  const held = armed ? MOD_BY_KIND[armed.kind] : null;
  if (held) {
    // While something is in your hand the strip stops describing and starts
    // answering the two questions a placement actually raises: what does the
    // model expect of it (§5), and what does it sound like (§6). Both are
    // about the socket the pointer is on, so both move with it.
    const target = previewTarget();
    const p = target ? socketPrice(held.kind, target.mode, target.key) : socketPrice(held.kind, "insert", null);
    dock.className = "spec-dock armed";
    const html =
      `<div class="sd-line">${specGlyph(held, " small")}` +
      `<b>${esc(held.name)}</b><span class="sd-verb">in hand</span>` +
      `<span class="sd-price mono" title="${esc(priceWhatNotWhere(p))}">${priceHTML(p, true)}</span>` +
      previewStripHTML(target) +
      `<span class="sd-hint mono">${armedSockets.length} socket${armedSockets.length === 1 ? "" : "s"} lit` +
      ` · click one, or <kbd>esc</kbd> to put it down</span></div>`;
    // Rewritten only when it actually changed. This strip re-renders on every
    // socket enter and leave, and an unconditional `innerHTML =` there would
    // destroy and rebuild the ▶ *while the pointer is travelling to it* — the
    // click lands on an element that no longer exists. It also throws away the
    // painted waveform for no reason.
    if (dock.dataset.armedHtml !== html) {
      dock.innerHTML = html;
      dock.dataset.armedHtml = html;
    }
    paintPreviewScope(target);
    return;
  }
  delete dock.dataset.armedHtml;
  if (pendingTarget) {
    dock.className = "spec-dock armed";
    dock.innerHTML =
      `<div class="sd-line"><b>${esc(pendingTarget.prompt || "pick a module")}</b>` +
      `<span class="sd-hint mono">the socket is already chosen — anything dimmed cannot go in it` +
      ` · <kbd>esc</kbd> to cancel</span></div>`;
    return;
  }
  const m = specSubject ? MOD_BY_KIND[specSubject] : null;
  if (!m) {
    dock.className = "spec-dock rest";
    dock.innerHTML =
      `<div class="sd-rest mono">Point at a module — in the catalogue or in this patch — and this strip ` +
      `says what it does to a signal, where it can legally go, and what the model currently thinks of it.</div>`;
    return;
  }
  const p = specParts(m);
  dock.className = "spec-dock";
  dock.innerHTML =
    `<div class="sd-id">${specGlyph(m)}` +
    `<div class="sd-idtext"><div class="panel-label sd-name">${esc(m.name)}</div>` +
    `<div class="sd-ports mono">${esc(p.ports)}</div></div></div>` +
    `<div class="sd-body"><p class="sp-blurb">${esc(m.blurb)}</p>` +
    `<div class="sd-strip mono"><span class="sp-params">${esc(p.params)}</span>` +
    `<span class="sp-heard"><b>heard as</b> ${esc(m.heard)}</span></div></div>` +
    `<div class="sd-model mono">${p.belief}</div>`;
}

// ===========================================================================
// PRICED SOCKETS — what the model thinks this placement is worth (WS-2 §5)
// ===========================================================================
// The bank has always shown θ for a module: a bar with a whisker, in
// standardized coefficient units, which answers "does the model like filters"
// and not the question anyone actually has, which is "what happens to my score
// if I put one here". Those are one divide apart. φ_struct is a **count**
// vector, so adding one filter is a raw unit step in `n_filter`; the
// standardizer turns that into `1/scale` of a z-unit; θ turns that into
// utility. No compile, no render, no round trip — the whole price is
// `θ / scale`, and the only reason it was not on screen already is that the
// scale lived in the engine (see `WasmEngine::phi_scale`).
//
// Three honesty rules, and the first is the one the plan singled out:
//
//  1. **The structural half of φ is order-invariant.** `n_filter` counts
//     filters; it does not care which cable they sit on. So this number prices
//     *what* you are adding and not *where* — the same figure at every lit
//     socket — and the copy says so rather than letting a per-socket
//     annotation imply a per-socket opinion the model does not have.
//  2. **It is the module-count coordinates only.** The audio half of φ
//     (brightness, rolloff, the tail) needs a render to know, and the two
//     modulation ratios move in ways one insertion does not determine. Those
//     are precisely what the audition next door is for: §5 says what the model
//     expects, §6 lets you check.
//  3. **A placement that evicts something is not priced.** Replacing a chain
//     takes modules *out* of the count as well as putting one in, and half a
//     subtraction is worse than no number at all — so those sockets say what is
//     missing instead of quoting a figure that only counts the arrival.
//
// The units are utility, the same units as the contributions in the model's-
// guess line above the rack — deliberately, so "drive +0.09" up there and
// "+0.04" down here are the same kind of quantity and can be added.

/** The θ row a placement is priced from — under the **bench's** lens, so the
 *  price and the number it promises to move come from the same decomposition.
 *  Falls back to the lens that claims most of the bank before the first bench
 *  featurize, which is the same one the chips read. */
function priceTheta(kind) {
  const phi = MOD_BY_KIND[kind]?.phi;
  if (!phi || !views || !views.styles || views.styles.length === 0) return null;
  const scale = views.scale ? views.scale[phi] : null;
  if (!scale || !(scale > 0)) return null;
  const k =
    belief.styleK != null && views.styles[belief.styleK] ? belief.styleK : (activeStyles()[0] || {}).k;
  const s = k != null ? views.styles[k] : null;
  const row = s && s.theta ? s.theta.find((t) => t.name === phi) : null;
  if (!row) return null;
  return { phi, scale, style: k, mean: row.mean, std: row.std, share: s.share };
}

/** What placing `kind` at `key` is worth, and — when it is not a number — why.
 *  `mode` is the placement mode the click would use, because a replacement and
 *  an insertion are not the same edit to φ. */
function socketPrice(kind, mode, key) {
  const m = MOD_BY_KIND[kind];
  if (!m) return null;
  const { byPhi, total } = nbSupport();
  const sup = m.phi ? byPhi[m.phi] || 0 : 0;
  const t = priceTheta(kind);
  // The same five silences the spec card draws (`beliefState`), plus one this
  // surface has and that one does not: a socket where the arithmetic itself
  // does not hold.
  const evicts = key != null && placementEvicts(kind, mode, key);
  const state = !m.phi
    ? "unmeasured"
    : !t
      ? "unfitted"
      : evicts
        ? "evicts"
        : sup < NB_SUPPORT_MIN
          ? "thin"
          : Math.abs(t.mean) >= t.std
            ? "resolved"
            : "flat";
  return {
    state,
    kind,
    phi: m.phi || null,
    sup,
    total,
    du: t ? t.mean / t.scale : 0,
    sd: t ? t.std / t.scale : 0,
    lens: t && views.styles[t.style] ? styleName(views.styles[t.style], t.style) : "",
    evicted: evicts ? evicts : null,
  };
}

/** Does this placement take modules out as well as put one in? Returns a short
 *  phrase naming the loss, or `false`. */
function placementEvicts(kind, mode, key) {
  const m = MOD_BY_KIND[kind];
  if (!m) return false;
  if (m.sort === "mod") {
    // A shaper takes the slot's term as its own input; only a leaf evicts.
    const old = modAtKey(key);
    return old && m.modSort !== "op" && m.modSort !== "pair" ? "the modulator already in that slot" : false;
  }
  if (mode !== "replace" && m.sort !== "source") return false;
  const old = nodeAtKey(key);
  if (!old || isPlaceholderKey(key)) return false;
  const n = subtreeSize(old);
  return `the ${n === 1 ? fragLabel(old, false) : `${n}-module chain`} in that socket`;
}

const PRICE_SIGN = (x) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(2)}`;

/** The one sentence that keeps the figure from claiming more than it is. */
function priceWhatNotWhere(p) {
  return (
    `The model's structural features count modules; they do not record which cable a module sits on. ` +
    `So this prices WHAT you are adding, not WHERE — it is the same number at every lit socket. ` +
    `It covers the module count only: how it will actually sound is the ▶ beside it.` +
    (p && p.lens ? `\n\nUnder the lens "${p.lens}", the same one the model's-guess line above the rack uses.` : "")
  );
}

/** The price as a readout. `long` is the strip under the rack, which has a
 *  line to spend and says the whole sentence; short is the chip pinned to the
 *  plate, which sits between two modules and carries the rest as a tooltip.
 *
 *  The figure itself is printed in every state where one exists, including
 *  "no lean" — a number the model is not confident about is still the number,
 *  and hiding it would make "no lean" indistinguishable from "no answer". */
function priceHTML(p, long) {
  if (!p) return "";
  const fig = `${PRICE_SIGN(p.du)} ± ${p.sd.toFixed(2)}`;
  switch (p.state) {
    case "unmeasured":
      return `<span class="pr pr-mute">${long ? "not a coordinate the model measures" : "unmeasured"}</span>`;
    case "unfitted":
      return `<span class="pr pr-mute">${long ? "no price yet — the model needs a few picks" : "no price yet"}</span>`;
    case "evicts":
      return `<span class="pr pr-mute">${
        long
          ? `replaces ${esc(p.evicted)} — not priced, because that takes modules out too`
          : "not priced — this takes modules out too"
      }</span>`;
    case "thin":
      return `<span class="pr pr-mute">${
        long ? `in ${p.sup} of ${p.total} patches — too few to price` : "too few to price"
      }</span>`;
    case "flat":
      return long
        ? `<span class="pr pr-flat">the model has no lean here</span>` +
            ` <span class="pr-dim">(${fig}, straddling zero)</span>` +
            ` <span class="pr-note">what, not where</span>`
        : `<span class="pr pr-flat">no lean</span> <span class="pr-dim">${fig}</span>`;
    default:
      return long
        ? `<span class="pr ${p.du >= 0 ? "up" : "down"}">${fig}</span>` +
            ` <span class="pr-dim">predicted</span> <span class="pr-note">what, not where</span>`
        : `<span class="pr ${p.du >= 0 ? "up" : "down"}">${fig}</span>`;
  }
}

// ---------------------------------------------------------------------------
// PRE-PLACEMENT AUDITION (WS-2 §6)
// ---------------------------------------------------------------------------
// Nobody in the category lets you hear a module before you place it, and for a
// preference-learning instrument that is the natural gesture: §5 says what the
// model expects of this placement, and this says what it actually does — the
// two halves of the same question, side by side on the same strip.
//
// The render happens in `WasmEngine::preview_op`, on a clone: the bench never
// holds the proposal, so a hover costs nothing and undoes nothing. Two guards
// keep it from being an expense:
//
//  - **It never fires on a hover.** Explicit ▶, or 600 ms of dwell on one
//    socket. Sweeping a rack full of lit sockets renders exactly nothing.
//  - **One in flight at a time, and stale answers are dropped.** The worker is
//    serial, so a preview already begun cannot be recalled; "cancel" means the
//    reply is discarded on arrival and the request that superseded it goes out
//    then. Queueing them instead would put a second half-second of featurizing
//    between the player and their next knob.
//
// A dwell renders and paints; it does not play. The waveform arriving on its
// own is information; audio arriving on its own is a jump scare, and the one
// place this instrument makes sound without being asked is nowhere.
const PREVIEW_DWELL_MS = 600;
const PREVIEW_SECONDS = 2.0;   // the phrase's first held note, whole

const preview = {
  token: 0,          // monotonic; a reply with an older one is stale
  inflight: false,
  pending: null,     // the request that arrived while one was out
  want: null,        // {kind, key, mode} the strip is currently about
  have: null,        // {kind, key, mode, buffer} the last good render
  failed: null,      // {kind, key, mode} — rendered and came back empty
  playOnArrive: false,
  dwellTimer: null,
};

/** The exact `StructOp` a placement will send.
 *
 *  Extracted so that `placeModule` and its audition read the *same* function:
 *  a preview built from a re-derived splice would be a second implementation
 *  of insertion semantics, and the day the two disagreed the app would be
 *  playing one edit and committing another. */
function placementOp(kind, mode, key) {
  const m = MOD_BY_KIND[kind];
  if (!m) return null;
  if (m.sort === "mod") return { op: "set_mod_tree", key, m: wrapMod(m, modAtKey(key)) };
  if (mode === "replace" || m.sort === "source") return { op: "replace_tree", key, node: m.frag() };
  return { op: "insert_tree", key, node: m.frag() };
}

/** The socket an audition would splice into: the one under the pointer, else
 *  the one the arming pre-selected, else the first lit. Never null while
 *  something is in hand and anything is lit. */
function previewTarget() {
  if (!armed || !armedSockets.length) return null;
  const at = (k) =>
    k && armedSockets.find((j) => (j.getAttribute("data-childkey") || j.getAttribute("data-modkey")) === k);
  const jack =
    at(pickHoverKey) ||
    // Leaving the 6px nut is not leaving the decision. A render already paid
    // for stays on the strip until the player points at a different socket or
    // puts the module down — otherwise the waveform vanishes at the exact
    // moment the pointer travels to the ▶ that plays it.
    at(preview.have && preview.have.kind === armed.kind ? preview.have.key : null) ||
    (armedIdx >= 0 ? armedSockets[armedIdx] : null) ||
    armedSockets[0];
  const key = jack.getAttribute("data-childkey") || jack.getAttribute("data-modkey");
  return { kind: armed.kind, key, mode: armed.sort === "source" ? "replace" : "insert" };
}

const sameTarget = (a, b) => !!a && !!b && a.kind === b.kind && a.key === b.key && a.mode === b.mode;

/** Throw away everything rendered against the old bench. Called from every
 *  route that moves the tree — see `beliefStale`. */
function previewInvalidate() {
  clearTimeout(preview.dwellTimer);
  preview.dwellTimer = null;
  preview.token++;
  preview.inflight = false;
  preview.pending = null;
  preview.have = null;
  preview.failed = null;
  preview.playOnArrive = false;
  if (armed) renderSpecDock();
}

/** Ask for one. `play` means the player pressed ▶ and is waiting for sound. */
function requestPreview(target, play) {
  if (!target || wb.subjectId == null) return;
  if (sameTarget(preview.have, target)) {
    if (play) previewPlay();
    return;
  }
  if (sameTarget(preview.failed, target)) return; // it already said no
  preview.want = target;
  preview.playOnArrive = !!play;
  if (preview.inflight) {
    // Supersede rather than queue: the answer in flight is about a socket the
    // player has already left.
    preview.pending = target;
    renderSpecDock();
    return;
  }
  preview.inflight = true;
  preview.token += 1;
  send({
    type: "preview_render",
    token: preview.token,
    key: target.key,
    kind: target.kind,
    mode: target.mode,
    op: placementOp(target.kind, target.mode, target.key),
    seconds: PREVIEW_SECONDS,
  });
  renderSpecDock();
}

function onPreviewArrived(m) {
  if (m.token !== preview.token) return;   // stale: the cancellation
  preview.inflight = false;
  const target = { kind: m.kind, key: m.key, mode: preview.want ? preview.want.mode : "insert" };
  if (m.buffer && m.buffer.length > 0) {
    const buf = audioCtx.createBuffer(1, m.buffer.length, m.sampleRate);
    buf.copyToChannel(m.buffer, 0);
    preview.have = { ...target, buffer: buf };
    preview.failed = null;
  } else {
    // The grammar refused it, or it failed vetting. Say so — an empty scope
    // and a live ▶ would audition as "this placement makes silence".
    preview.have = null;
    preview.failed = target;
  }
  const next = preview.pending;
  preview.pending = null;
  const play = preview.playOnArrive;
  preview.playOnArrive = false;
  renderSpecDock();
  if (next) requestPreview(next, play);
  else if (play && preview.have) previewPlay();
}

function previewPlay() {
  if (!preview.have) return;
  playBuffer(preview.have.buffer, $("pv-play"));
}

/** Start the dwell clock on the socket under the pointer. Restarted, not
 *  extended, on every move to a new socket. */
function previewDwell() {
  clearTimeout(preview.dwellTimer);
  const target = previewTarget();
  if (!target || wb.subjectId == null) return;
  if (sameTarget(preview.have, target) || sameTarget(preview.failed, target)) return;
  preview.dwellTimer = setTimeout(() => requestPreview(target, false), PREVIEW_DWELL_MS);
}

/** The ▶ + waveform that rides the armed strip. Its state is the state of the
 *  render, said in words, because "a button that does nothing yet" and "a
 *  button that will not work here" look identical otherwise. */
function previewStripHTML(target) {
  const ready = sameTarget(preview.have, target);
  const dead = sameTarget(preview.failed, target);
  const busy = preview.inflight || !!preview.pending;
  const label = dead
    ? "can't audition that here"
    : ready
      ? "hear it here"
      : busy
        ? "rendering…"
        : "hold a socket, or ▶";
  return (
    `<span class="pv${busy ? " busy" : ""}${dead ? " dead" : ""}">` +
    `<button class="pv-play" id="pv-play" type="button" ${dead ? "disabled" : ""} ` +
    `aria-label="Audition this patch with the module spliced in" ` +
    `title="A 2-second render of THIS patch with the module spliced at the lit socket. Nothing is placed — the bench is untouched.">▶</button>` +
    `<canvas class="pv-scope" id="pv-scope" width="312" height="76" aria-hidden="true"></canvas>` +
    `<span class="pv-label mono">${esc(label)}</span></span>`
  );
}

/** Paint whatever the strip is currently holding. Called after the dock is in
 *  the DOM, because the canvas has to exist to be drawn on. */
function paintPreviewScope(target) {
  const c = $("pv-scope");
  if (!c) return;
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth || 156;
  const h = c.clientHeight || 38;
  if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  if (sameTarget(preview.have, target)) drawWave(c, preview.have.buffer.getChannelData(0));
  else scopeCtx(c).clearRect(0, 0, c.width, c.height);
}

// Delegated, and wired exactly once. The strip is rebuilt whenever the price
// or the render state changes, so a handler bound to the button would be bound
// to a button that has since been replaced — and the replacement happens on
// pointer-leave of the socket, which is the same movement that carries the
// pointer to the ▶.
$("spec-dock")?.addEventListener("click", (ev) => {
  if (ev.target.closest(".pv-play")) requestPreview(previewTarget(), true);
});

// ---- arm and place ----
function pickModule(kind) {
  const m = MOD_BY_KIND[kind];
  if (!m) return;
  if (!wb.rack) return note("No patch loaded — pick one from the bank on the left first.");

  // Straight from the rack's ⋯ menu: the socket is already chosen. The handoff
  // carries what it can accept, because "replace with…" on a filter cannot
  // take an LFO — and placeModule branches on the module's sort before it ever
  // looks at the mode, so an unchecked handoff would quietly rewrite the
  // filter's modulation slot instead of replacing the filter.
  if (pendingTarget) {
    const p = pendingTarget;
    if (!p.accepts.includes(m.sort)) {
      note(
        p.accepts.includes("mod")
          ? `${m.name} is an audio module — that jack carries control voltage. Pick something from the amber groups, or esc to cancel.`
          : m.sort === "mod"
            ? `${m.name} moves knobs; it does not carry audio, so it cannot ${p.mode === "replace" ? "replace" : "go after"} that. It goes in a mod ○.`
            // Same correction as `chipBlockedWhy`: telling someone holding a
            // vco to "pick an audio module" answers a question they did not
            // get wrong. What is missing is an input, not audio.
            : m.sort === "source"
              ? `${m.name} has no input — it starts a signal rather than passing one through, so it cannot go into a wire. Replace something with it instead, or esc to cancel.`
              : `${m.name} can't ${p.mode === "replace" ? "replace" : "go after"} that — pick an audio module, or esc to cancel.`,
      );
      return;
    }
    logLinkQuery(kind);
    cancelPending();
    placeModule(kind, p.mode, p.key);
    return;
  }
  if (armed && armed.kind === kind) return disarm();
  arm(kind);
}

/** The price this arming was quoted at, until it is either taken (logged by
 *  `placeModule`) or put down (logged by `disarm`). Both halves are needed:
 *  a ledger of accepted placements alone is a ledger with no negatives in it. */
let armPriced = null;

function arm(kind) {
  disarm();
  const m = MOD_BY_KIND[kind];
  armed = { kind, sort: m.sort, modSort: m.modSort || "leaf" };
  const chip = $("nb-groups").querySelector(`.nb-item[data-kind="${kind}"]`);
  if (chip) chip.classList.add("armed");
  lightSockets();
  if (armedSockets.length === 0) {
    disarm();
    note(
      m.sort === "mod"
        ? "Nothing in this patch takes modulation yet — add a filter first."
        : "Nowhere to put that yet.",
    );
    return;
  }
  $("rack-scroll").classList.add("placing");
  armPriced = socketPrice(kind, m.sort === "source" ? "replace" : "insert", null);
  pickFeedback();
  renderSpecDock();
  nbSetHolding();
  armStatus();
  nbAnnounce(`${m.name} in hand. ${armedSockets.length} sockets available. Arrow keys to step, Enter to place.`);
}

function armStatus() {
  if (!armed) return;
  const m = MOD_BY_KIND[armed.kind];
  const verb = m.sort === "mod" ? "cabling" : "placing";
  $("nb-status").innerHTML =
    `<b>${verb} ${esc(m.name)}</b> — click a lit socket <span class="sp-dim">· esc to put it down</span>`;
}

function lightSockets() {
  const svg = $("rack-svg");
  const sel = armed.sort === "mod" ? ".jack[data-modkey]" : ".jack[data-childkey]";
  armedSockets = [...svg.querySelectorAll(sel)];
  armedIdx = -1;
  for (const j of armedSockets) {
    j.classList.add("legal");
    // Name the two drops BEFORE either happens. A source evicts whatever is in
    // the socket; a processor splices in front of it. Those had the same
    // appearance right up until one of them had already thrown a chain away.
    // Amber means "something here goes away". A source evicts the chain in
    // the socket, and a *leaf* modulator evicts whatever is in the slot — but
    // a CV shaper or combiner takes the existing term as its own input, so
    // nothing is lost and the socket stays green.
    const key = j.getAttribute("data-childkey") || j.getAttribute("data-modkey");
    const evicts =
      (armed.sort === "source" && !isPlaceholderKey(key)) ||
      (armed.sort === "mod" && armed.modSort === "leaf" && modAtKey(key));
    if (evicts) j.classList.add("replaces");
    const label = socketLabel(j);
    j.setAttribute("aria-label", label);
    // …and where a sighted user can read it. This sentence is the entire
    // reason arm-and-place is safer than a drag, and it used to exist only in
    // the accessibility tree: everyone else got a colour and a guess.
    let t = j.querySelector("title");
    if (!t) { t = svgEl("title", {}); j.appendChild(t); }
    t.textContent = label;
    j.addEventListener("pointerenter", onSocketHover);
    j.addEventListener("pointerleave", onSocketLeave);
  }
  // An empty socket is where the next module obviously wants to go, so it
  // starts under the cursor rather than waiting to be found.
  const hole = armedSockets.findIndex((j) => isPlaceholderKey(j.getAttribute("data-childkey")));
  if (hole >= 0) {
    armedIdx = hole;
    armedSockets[hole].classList.add("hot");
  }
}

/** Echo the socket's promise into the status line the rail already reserves —
 *  and onto the canvas, where the decision is actually being made. */
function onSocketHover(ev) {
  if (!armed) return;
  const j = ev.currentTarget;
  // The socket key doubles as a plate key: an audio socket names its
  // occupant, a mod socket names its owner. Both are the plate the promise
  // is about, which is the plate the chip should be pinned to.
  pickHoverKey = j.getAttribute("data-childkey") || j.getAttribute("data-modkey") || null;
  const price = socketPrice(armed.kind, armed.sort === "source" ? "replace" : "insert", pickHoverKey);
  $("nb-status").innerHTML =
    `<b>${esc(socketLabel(j))}</b> <span class="sp-dim">· click to place · esc to put it down</span>` +
    `<span class="nb-price">${priceHTML(price, false)}</span>`;
  pickFeedback();
  // The price and the audition both belong to the socket under the pointer,
  // so both follow it — and the dwell clock restarts here rather than
  // accumulating across sockets, which is what stops a sweep across a lit rack
  // from queueing a render per socket.
  renderSpecDock();
  previewDwell();
}
function onSocketLeave() {
  pickHoverKey = null;
  clearTimeout(preview.dwellTimer);
  if (armed) { armStatus(); pickFeedback(); renderSpecDock(); }
}

function socketLabel(jack) {
  const key = jack.getAttribute("data-childkey") || jack.getAttribute("data-modkey");
  const name = kindName(armed ? armed.kind : "");
  if (armed && armed.sort === "mod") {
    const owner = rackKindAt(key);
    const dest = kindModTarget(owner) || "";
    const here = modAtKey(key);
    // Three different things can happen to a modulation slot, and they must
    // not share a sentence: fill it, replace what is in it, or take what is
    // in it as an input.
    if (here && armed.modSort !== "leaf") {
      return `${kindName(owner)} → ${dest} — put ${name} after the ${fragLabel(here, true)}`;
    }
    if (here) return `${kindName(owner)} → ${dest} — replaces the ${fragLabel(here, true)}`;
    return `${kindName(owner)} — modulate ${dest} with ${name}`;
  }
  // A hole is not an occupant: nothing is displaced and nothing is held, so
  // the promise must not be worded as if something were about to be lost.
  if (isPlaceholderKey(key)) return `fills the empty socket with ${name}`;
  // By the title on the plate, not by the trace id — this line is read at the
  // moment of the decision, with the plate itself right there to compare it
  // to. And "after", because that is the op: the socket's occupant keeps
  // feeding it, and the new module goes between the occupant and its parent.
  const what = plateTitle(key);
  return armed && armed.sort === "source"
    ? `replaces ${what}`
    : `insert ${name} after ${what}`;
}

function disarm() {
  if (!armed) return;
  // Put down without placing: the negative half of the price ledger.
  if (armPriced) { logPriceOutcome(armPriced, false, null); armPriced = null; }
  const chip = $("nb-groups").querySelector(".nb-item.armed");
  if (chip) chip.classList.remove("armed");
  for (const j of armedSockets) j.classList.remove("legal", "replaces", "hot");
  armedSockets = [];
  armedIdx = -1;
  armed = null;
  clearTimeout(preview.dwellTimer);
  preview.dwellTimer = null;
  preview.have = null;
  preview.failed = null;
  preview.pending = null;
  preview.playOnArrive = false;
  $("rack-scroll").classList.remove("placing");
  $("nb-status").textContent = "";
  nbAnnounce("");
  renderSpecDock();
  nbSetHolding();
  pickFeedback();
}

// ---------- the catalogue's walkthrough ----------
// Mirrors the bank's, for the same reason it exists: at 41 modules across ten
// groups, the two things that are not guessable — that clicking a module puts
// it in your hand, and that the θ column stays blank until there is evidence
// for it — are exactly the two a hover card cannot teach, because you have to
// know to hover first.
//
// It does not fire on its own. The bench tour already opens unprompted and now
// points here; a second uninvited panel is one more thing to dismiss before
// making a sound.
const NB_TOUR = [
  {
    lit: () => $("nb-groups"),
    title: "a catalogue, not a shelf",
    body:
      `Every module the instrument has, in the order a patch is built: what ` +
      `makes the sound, what dirties it, what filters it, where it sits, what ` +
      `moves it. Each row says what it <b>does to a signal</b> — that is what ` +
      `the drawing is — and how many cables it has.`,
  },
  {
    lit: () => $("nb-groups").querySelector('.nb-item[data-kind="filter"]'),
    title: "click one and it is in your hand",
    body:
      `Then every socket it can legally go into lights up <b>and says what will ` +
      `happen there</b> — green inserts it in front of what is already in the ` +
      `socket, amber replaces that. Click a lit ○ to place it, <kbd>esc</kbd> to ` +
      `put it down. Every placement is one undo, and the toast offers it.`,
  },
  {
    lit: () => $("nb-q"),
    title: "search by sound, not just by name",
    body:
      `<kbd>/</kbd> from anywhere. Modules answer to how you would ask for them: ` +
      `<i>grit</i> finds the distortion and the bitcrusher, <i>vowel</i> the ` +
      `formant oscillator, <i>pump</i> the ducker. Hover any row for a sentence ` +
      `on what it does and what it will arrive set to.`,
  },
  {
    lit: () => $("nb-groups").querySelector('[data-group="modulation"]'),
    title: "modulation chains",
    body:
      `Drop a <b>shape cv</b> module — quantize, slew — on a cable that already ` +
      `carries a modulator and it takes that modulator as its <i>input</i> ` +
      `rather than replacing it. That is how <i>s&amp;h rand → quantize → slew</i> ` +
      `gets built: three clicks, nothing lost.`,
  },
  {
    lit: () => $("nb-groups"),
    title: "what the model thinks",
    body:
      `The bar on the right of a row is the model's opinion of that module, with ` +
      `its uncertainty. It stays <b>blank until there is evidence for it</b>, and ` +
      `shows a dot on zero when the model has looked and found no lean either ` +
      `way. A short bar and "I do not know" must not look alike.`,
  },
];

let nbTourAt = -1;

function showNbTourStep() {
  const el = $("nb-tour");
  if (nbTourAt < 0 || nbTourAt >= NB_TOUR.length) return endNbTour();
  if (nbState.collapsed) nbSetCollapsed(false);
  const step = NB_TOUR[nbTourAt];
  document.querySelectorAll(".nb-tour-lit").forEach((e) => e.classList.remove("nb-tour-lit"));
  // The tour is a pointer, not a pamphlet: light the thing each step is about,
  // and scroll it into view, because the rail is three viewports tall.
  const target = step.lit();
  if (target) {
    target.classList.add("nb-tour-lit");
    target.scrollIntoView({ block: "nearest" });
  }
  $("nbt-step").textContent = `${nbTourAt + 1} / ${NB_TOUR.length}`;
  $("nbt-title").textContent = step.title;
  $("nbt-body").innerHTML = step.body;
  $("nbt-back").disabled = nbTourAt === 0;
  $("nbt-next").textContent = nbTourAt === NB_TOUR.length - 1 ? "got it" : "next";
  el.classList.remove("hidden");
  $("nbt-next").focus();
}

function endNbTour() {
  nbTourAt = -1;
  $("nb-tour").classList.add("hidden");
  document.querySelectorAll(".nb-tour-lit").forEach((e) => e.classList.remove("nb-tour-lit"));
}

/** Put down a pending ⋯ handoff — from Escape, a view change, or a new patch. */
function cancelPending() {
  if (!pendingTarget) return;
  logLinkQuery(null); // an abandoned search is as informative as a chosen one
  pendingTarget = null;
  $("nb-status").textContent = "";
  nbAnnounce("cancelled");
  renderNodeBank(); // the compatibility filter comes off with the handoff
  renderSpecDock();
  pickFeedback();
}

/** The rack's ⋯ menu hands off here: open the rail, wait for a module. */
// `opts.accepts` narrows the rail (the `modulate → port` row hands off to the
// amber sorts only); `opts.verb`/`opts.aim` let a row say what it means when
// the key it acts on is not the plate the player clicked — "insert before this
// filter" is `insert_tree` at the filter's *input*, and the chip must name the
// filter, not whatever happens to feed it.
function armFromRack(mode, key, opts) {
  const o = opts || {};
  pendingTarget = {
    mode,
    key,
    accepts: o.accepts || ["source", "proc", "combine"],
    verb: o.verb || null,
    aim: o.aim || null,
  };
  if (nbState.collapsed) nbSetCollapsed(false);
  const q = $("nb-q");
  q.value = "";
  renderNodeBank();
  q.focus();
  // The wording follows the menu item the user just clicked. Inserting *at*
  // this node's slot puts the new module between it and its parent, so from
  // the signal's point of view the new module comes after it — the same edit
  // the socket labels describe as "before" the node downstream of it.
  // Named the way the pick chip names it — the title silkscreened on the
  // plate. `fragLabel` answers in the term's vocabulary (`eq·3` is a kind plus
  // a subtree size), and §13 rules trace ids out of copy the player reads: the
  // `·3` is notation nobody has been shown and it reads like an instance id.
  // Where a whole chain is what goes away, `chainTitle` says so in words.
  const aimKey = o.aim || key;
  const here = nodeAtKey(aimKey);
  const name = here ? (mode === "replace" ? chainTitle(aimKey) : plateTitle(aimKey)) : "the output";
  const what = o.verb || (mode === "replace" ? "replace" : "insert after");
  pendingTarget.prompt = `${what} ${name} — pick a module`;
  $("nb-status").innerHTML =
    `<b>${esc(what)} ${esc(name)}</b> — pick a module <span class="sp-dim">· esc to cancel</span>`;
  nbAnnounce(`Choose a module to ${what} ${name}.`);
  renderSpecDock();
  pickFeedback();
}

function placeModule(kind, mode, key) {
  const m = MOD_BY_KIND[kind];
  if (!m) return;
  // Placement is one undo step, and the toast says so — trying a module out is
  // supposed to be cheap, and "how do I get rid of this" should never be a
  // question the user has to go and answer somewhere else.
  //
  // Taking it out has to undo BOTH halves of the edit. `doUndo` only restores
  // the tree, so an undone replacement used to put the chain back in the rack
  // *and* leave a second copy of it sitting in HELD.
  let staged = null;
  const undo = { undo: () => { if (staged != null) unstage(staged); doUndo(); }, undoLabel: "take it out" };
  // The price the player was shown, and the fact that they took it. Paired
  // with the rejections logged on `disarm`, this is calibration data at *edit*
  // granularity — far denser than the duel stream, and the rows where a
  // confident negative θ was placed anyway are exactly the ones that diagnose
  // a misspecified model. Logged before the send, because the send is what
  // makes the tree stop being the one the price was quoted against.
  logPriceOutcome(socketPrice(kind, mode, key), true, key);
  armPriced = null;   // the disarm below is a placement, not a refusal
  if (m.sort === "mod") {
    const owner = rackKindAt(key);
    const old = modAtKey(key);
    const dest = kindModTarget(owner) || "mod";
    // A CV shaper takes the slot's current term as its own input rather than
    // evicting it — chaining is the entire reason the modulation sort became
    // recursive, and "drop a quantizer on this cable" should not first cost
    // you the modulator that made the cable worth quantizing.
    const wraps = (m.modSort === "op" || m.modSort === "pair") && old;
    // Every one of these sentences is a confirmation, so it is handed to the
    // send and said on the reply — never here, where the engine has not yet
    // agreed that any of it is true. See `landedNote`.
    sendStruct(placementOp(kind, mode, key), {
      text: wraps
        ? `${m.name} now shapes the ${fragLabel(old, true)} on ${kindName(owner)} → ${dest}.`
        : old
          ? `${m.name} replaced the ${fragLabel(old, true)} on ${kindName(owner)} → ${dest} — the old one is held below.`
          : `${m.name} → ${dest} on ${kindName(owner)}`,
      opts: undo,
    });
    if (old && !wraps) staged = stageFragment(old, true);
  } else if (mode === "replace" || m.sort === "source") {
    const old = nodeAtKey(key);
    const chain = old && subtreeSize(old) > 1;
    sendStruct(placementOp(kind, mode, key), {
      text: chain
        ? `${m.name} took the socket — the ${subtreeSize(old)}-module chain it replaced is held below.`
        : `${m.name} took the socket.`,
      opts: undo,
    });
    if (chain) staged = stageFragment(old, false);
  } else {
    sendStruct(placementOp(kind, mode, key),
      { text: `${m.name} patched into the wire.`, opts: undo });
  }
  disarm();
  $("nb-status").textContent = "";
}

/** One row of the price ledger: what the model predicted, and whether the
 *  player did it anyway. `accepted` is the whole point — a prediction with no
 *  outcome beside it can never be scored.
 *
 *  It goes into the implicit stream and, like everything else there, stays out
 *  of the likelihood: a placement is confounded with curiosity, with the
 *  search query that led to it, and with the socket being the only lit one.
 *  It is logged because it cannot be logged retroactively. */
function logPriceOutcome(p, accepted, key) {
  if (!p) return;
  logImplicit(
    "price",
    {
      kind: p.kind,
      phi: p.phi,
      state: p.state,
      du: Number(p.du.toFixed(4)),
      sd: Number(p.sd.toFixed(4)),
      lens: p.lens || null,
      key: key || null,
      accepted: !!accepted,
    },
    { value: p.du },
  );
}

/** A shaper's fragment, with whatever is already in the slot as its input.
 *  Leaves, and shapers landing on an empty slot, keep their own defaults. */
function wrapMod(m, existing) {
  const frag = m.frag();
  if (!existing || (m.modSort !== "op" && m.modSort !== "pair")) return frag;
  const tag = nodeTag(frag);
  if (tag === "Op") frag.Op.input = existing;
  else if (tag === "Pair") frag.Pair.a = existing;
  return frag;
}

/** A click on a lit socket while something is armed. */
function nbSocketClick(jack) {
  if (!armed) return false;
  const key = jack.getAttribute("data-childkey") || jack.getAttribute("data-modkey");
  if (!key) return false;
  placeModule(armed.kind, armed.sort === "source" ? "replace" : "insert", key);
  return true;
}

// ===========================================================================
// CONNECTION GRAMMAR — outputs are cable sources
// ===========================================================================
// The rack drew labelled `out` nuts on every plate and attached nothing to
// them: no data attribute, no listener, and `onWireUp` read a drop on a jack
// as a cancel. So the instrument rendered a patchbay and implemented a splice
// tool — the one thing a patchbay is *for* was the one gesture missing.
//
// One grammar, four ways in, all of them the same edit underneath:
//   · drag out → in            (the cable)
//   · click out, click in      (touch, long distances, motor accessibility)
//   · drag out → module body   (forgiveness: one input fits, use it)
//   · drag out → empty space   (link-drag search: pick what goes next)
//
// The term is a strict tree — `Box<AudioNode>`, one parent, one consumer — so
// "connect A to B" can only mean *move* A into B's socket. Fan-out is not
// expressible and is never drawn as if it were; what it gets instead is the
// second row of the chooser, "branch here", which is a `Mix` with both sides
// in it. The grammar's biggest limitation, offered as a musical verb.

/** Every socket this output may legally reach, and — when there are none —
 *  the sentence that says why. A refusal in this app is always spoken. */
function connectTargets(srcKey, kind) {
  const svg = $("rack-svg");
  if (kind === "mod") {
    const owner = srcKey.replace(/\/m$/, "");
    const jacks = [...svg.querySelectorAll(".jack[data-modkey]")]
      .filter((j) => j.getAttribute("data-modkey") !== owner);
    return {
      attr: "data-modkey",
      jacks,
      reason: "nothing else in this patch takes modulation — add a filter, or a delay, and its mod input appears",
    };
  }
  // Cycle rejection, stated rather than silent: a module cannot feed itself,
  // and it cannot feed anything it is already feeding, because that is a loop
  // and the term is a tree.
  const jacks = [...svg.querySelectorAll(".jack[data-childkey]")]
    .filter((j) => !keyInside(j.getAttribute("data-childkey"), srcKey));
  return {
    attr: "data-childkey",
    jacks,
    reason: srcKey === "node"
      ? "this is the last module in the chain — its output already goes to the amp, and there is nowhere further downstream"
      : "every socket downstream of this module is fed by it — plugging it into its own chain would be a loop, and the patch is a tree",
  };
}

/** Wire up an `out` nut: press to pull a cable, click to pick a target. */
function attachOutJack(j, key, kind) {
  claimGesture(j);
  j.addEventListener("pointerdown", (ev) => {
    if (connectPick) {
      ev.preventDefault();
      // Pressing the source again puts the cable down; pressing a different
      // output re-aims it, which is what a hand at a patchbay does.
      if (connectPick.srcKey === key) endConnectPick("cable put down");
      else beginConnectPick(key, kind);
      return;
    }
    if (armed) {
      ev.preventDefault();
      return note(`${kindName(armed.kind)} is in your hand — it goes in a lit ○, not an output. esc to put it down.`);
    }
    const t = connectTargets(key, kind);
    ev.preventDefault();
    if (t.jacks.length === 0) return note(t.reason);
    startWireDrag(
      {
        mode: kind === "mod" ? "connect-mod" : "connect-audio",
        srcKey: key,
        kind,
        attr: t.attr,
        legalKeys: new Set(t.jacks.map((x) => x.getAttribute(t.attr))),
      },
      ev,
    );
  });
}

/** Forgiveness beats precision: the nuts are 6px, so a near miss lands. */
function nearestLegalJack(cx, cy, w, maxPx) {
  let best = null;
  let bestD = maxPx;
  for (const j of $("rack-svg").querySelectorAll(`.jack[${w.attr}]`)) {
    if (!w.legalKeys.has(j.getAttribute(w.attr))) continue;
    const r = j.getBoundingClientRect();
    const d = Math.hypot(cx - (r.left + r.width / 2), cy - (r.top + r.height / 2));
    if (d < bestD) { bestD = d; best = j; }
  }
  return best;
}

/** A drop on a module's *body*. Auto-connects when exactly one of its inputs
 *  fits; when two do — a ducker's `in` and its `key` are not interchangeable
 *  — it says so rather than guessing, because guessing a sidechain wrong is
 *  a different patch. */
function bodyTarget(cx, cy, w) {
  const el = document.elementFromPoint(cx, cy);
  const g = el && el.closest ? el.closest("g[data-key]") : null;
  if (!g) return null;
  const mk = g.getAttribute("data-key");
  const cands = [...$("rack-svg").querySelectorAll(`.jack[${w.attr}]`)].filter((j) => {
    const k = j.getAttribute(w.attr);
    return w.legalKeys.has(k) && (w.attr === "data-modkey" ? k === mk : socketOwnerKey(k) === mk);
  });
  if (cands.length === 1) return cands[0];
  if (cands.length > 1) {
    note(`${kindName(rackKindAt(mk))} has two inputs and they are not the same job — drop on one of the lit ○`);
    return "spoken";
  }
  // Over a plate, and none of its inputs will take this. That is a refusal,
  // not a miss — falling through to "what goes next" here would answer a
  // question the player did not ask, and leave the bank aimed at a socket
  // they were not aiming at.
  const name = kindName(rackKindAt(mk)) || "that module";
  note(
    w.attr === "data-modkey"
      ? `${name} is where this modulator already is — drop it on another module's mod ○`
      : `nothing on ${name} can take this cable — everything it feeds is downstream of the source, and the patch is a tree`,
  );
  return "spoken";
}

// ---- the chooser: move, or branch ----
// Both rows say what will happen to the patch, in the patch's own words,
// before either happens. The default is move; branch is one click away and
// is never hidden, because "you cannot have two consumers" is a true fact
// about the grammar and a useless answer to a musician.
function offerConnect(srcKey, targetKey, kind, cx, cy) {
  if (kind === "mod") return connectMoveMod(srcKey, targetKey);
  const srcName = kindName(rackKindAt(srcKey)) || "that";
  const here = nodeAtKey(targetKey);
  const ownerName = kindName(rackKindAt(socketOwnerKey(targetKey))) || "the socket";
  // A hole is not a decision. Dropping into one is unambiguously a move.
  if (isPlaceholderKey(targetKey)) return connectMove(srcKey, targetKey);
  // Two namings, because the two rows do different things to the same socket:
  // move displaces the whole subtree to HELD, branch mixes into its head.
  const hereName = here ? plateTitle(targetKey) : "what is there";
  const hereChain = here ? chainTitle(targetKey) : "what is there";
  openChooser(cx, cy, `${srcName} → ${ownerName}`, [
    {
      label: "move it here",
      sub: `${srcName} leaves where it is — its old socket becomes a hole — and ${hereChain} is held below.`,
      run: () => connectMove(srcKey, targetKey),
    },
    {
      label: "branch here",
      sub: `a copy of ${srcName} joins ${hereName} through a mix. Nothing moves. (A copy: one output cannot feed two places.)`,
      run: () => connectBranch(srcKey, targetKey),
    },
  ]);
}

/** A short popover in the context menu's own element, so there is exactly one
 *  floating menu in the app, one law that dismisses it, and one keyboard. */
function openChooser(x, y, head, rows) {
  showMenu(x, y, { sub: head }, rows);
}

/** Move the module at `srcKey` into the socket at `targetKey`. One rewrite,
 *  one undo step: the vacated socket becomes a hole and whatever was in the
 *  target is held below. */
function connectMove(srcKey, targetKey) {
  const srcName = kindName(rackKindAt(srcKey)) || "that";
  const ownerName = kindName(rackKindAt(socketOwnerKey(targetKey))) || "the socket";
  const hereChain = chainTitle(targetKey); // named before the tree moves
  let doomed = null;
  const ok = applyTreeRewrite((tree, marks) => {
    if (keyInside(targetKey, srcKey)) {
      return "that socket is downstream of this module — plugging it in there would be a loop, and the patch is a tree";
    }
    const src = nodeAtIn(tree, srcKey);
    if (!src) return "that module has moved — try the cable again";
    // The hole goes in *first*, so that if the target is an ancestor of the
    // source the subtree being displaced is read with the hole already in it
    // — otherwise it would be held below with a second live copy of the very
    // module we just promoted inside it.
    const hole = placeholderNode();
    if (!setNodeAtIn(tree, srcKey, hole)) return "that module has moved — try the cable again";
    const victim = nodeAtIn(tree, targetKey);
    if (!setNodeAtIn(tree, targetKey, src)) return "that socket has moved — try the cable again";
    marks.push(hole);
    if (victim && !marks.includes(victim)) doomed = victim;
    return null;
  }, { op: "reconnect", key: srcKey, kind: rackKindAt(srcKey) });
  if (!ok) return;
  const uid = doomed ? stageFragment(doomed, false) : null;
  const undo = { undo: () => { if (uid != null) unstage(uid); doUndo(); }, undoLabel: "put it back" };
  noteOnLanding(
    doomed
      ? `${srcName} now feeds ${ownerName} — the ${hereChain} it displaced is held below, and its old socket is empty.`
      : `${srcName} now feeds ${ownerName} — its old socket is empty.`,
    undo,
  );
}

/** The sanctioned answer to fan-out: a `Mix` at the target socket with what
 *  was there on one side and a copy of the source on the other. Honest copy
 *  — the term cannot share a node, and the toast says "a copy" for the same
 *  reason the socket labels say "replaces". */
function connectBranch(srcKey, targetKey) {
  const srcName = kindName(rackKindAt(srcKey)) || "that";
  const ownerName = kindName(rackKindAt(socketOwnerKey(targetKey))) || "the socket";
  const hereName = plateTitle(targetKey); // the plate it will mix with
  const ok = applyTreeRewrite((tree) => {
    if (keyInside(targetKey, srcKey)) {
      return "that socket is downstream of this module — branching into it would be a loop, and the patch is a tree";
    }
    const src = nodeAtIn(tree, srcKey);
    const here = nodeAtIn(tree, targetKey);
    if (!src || !here) return "that socket has moved — try the cable again";
    const spec = MOD_BY_KIND.mix;
    const mix = spec.frag();
    const f = childFields(spec);
    mix.Mix[f[0]] = here;
    mix.Mix[f[1]] = JSON.parse(JSON.stringify(src));
    if (!setNodeAtIn(tree, targetKey, mix)) return "that socket has moved — try the cable again";
    return null;
  }, { op: "branch_here", key: srcKey, kind: rackKindAt(srcKey) });
  if (!ok) return;
  noteOnLanding(`a copy of ${srcName} now mixes with ${hereName} into ${ownerName}.`, { undo: doUndo, undoLabel: "take it out" });
}

/** Modulation has one slot per module, so its only verb is move. */
function connectMoveMod(srcKey, targetKey) {
  const srcMod = modAtKey(srcKey.replace(/\/m$/, ""));
  if (!srcMod) return note("that modulator has moved — try the cable again");
  const from = srcKey.replace(/\/m$/, "");
  const dest = kindModTarget(rackKindAt(targetKey)) || "mod";
  let doomed = null;
  const ok = applyTreeRewrite((tree) => {
    const owner = nodeAtIn(tree, from);
    const target = nodeAtIn(tree, targetKey);
    if (!owner || !target) return "that modulator has moved — try the cable again";
    const oTag = nodeTag(owner), tTag = nodeTag(target);
    const m = owner[oTag]?.modulation;
    if (!m || m === "None") return "there is no modulator on that jack any more";
    const had = target[tTag]?.modulation;
    if (had && had !== "None") doomed = had;
    owner[oTag].modulation = "None";
    target[tTag].modulation = m;
    return null;
  }, { op: "reconnect_mod", key: from });
  if (!ok) return;
  const uid = doomed ? stageFragment(doomed, true) : null;
  noteOnLanding(
    `${fragLabel(srcMod, true)} → ${dest} on ${kindName(rackKindAt(targetKey))}` +
    (doomed ? ` — the ${fragLabel(doomed, true)} it replaced is held below.` : ""),
    { undo: () => { if (uid != null) unstage(uid); doUndo(); }, undoLabel: "put it back" },
  );
}

// ---- link-drag search ----
// Release a cable into nothing and the question stops being "where does this
// go" and becomes "what goes next" — which is the node bank's question. The
// query the player then types is the only explicit statement of intent in the
// app, so it is kept; WS-8 gives it a home in the implicit stream.
const linkSearchLog = [];

function openLinkSearch(w) {
  const isMod = w.kind === "mod";
  const key = isMod ? w.srcKey.replace(/\/m$/, "") : w.srcKey;
  // The plate's own title for an audio source, the same as the pick chip and
  // the ⋯ handoff. A modulator has no plate of its own — it is drawn in the
  // slot on its host — so it keeps `fragLabel`, which for a modulator is just
  // its name and carries no subtree count to leak.
  const srcName = isMod
    ? fragLabel(modAtKey(key) || {}, true)
    : plateTitle(w.srcKey) || "that";
  pendingTarget = {
    mode: "insert",
    key,
    accepts: isMod ? ["mod"] : ["proc", "combine"],
    prompt: `after ${srcName} — pick a module`,
    link: { srcKey: w.srcKey, kind: w.kind, at: Date.now() },
  };
  if (nbState.collapsed) nbSetCollapsed(false);
  const q = $("nb-q");
  q.value = "";
  renderNodeBank();
  q.focus();
  $("nb-status").innerHTML =
    `<b>after ${esc(srcName)}</b> — pick a module <span class="sp-dim">· esc to cancel</span>`;
  nbAnnounce(`Cable dropped. Choose a module to put after ${srcName}.`);
  renderSpecDock();
  pickFeedback();
}

/** The query string, kept with what it was aimed at and what it produced. */
function logLinkQuery(chosen) {
  const l = pendingTarget && pendingTarget.link;
  if (!l || l.logged) return; // the pick and the cancel both land here
  l.logged = true;
  const row = {
    q: ($("nb-q").value || "").trim(),
    kind: l.kind,
    src: rackKindAt(l.srcKey) || l.srcKey,
    chosen: chosen || null,
    ms: Date.now() - l.at,
  };
  linkSearchLog.push(row);
  window.__ricLinkSearch = linkSearchLog;
  // …and into the store that survives the tab. This array was a debugging
  // window, which is to say the only explicit statement of intent in the whole
  // app was being thrown away on every reload. A typed query aimed at a socket
  // is the one place a player says what they *want* rather than choosing from
  // what is offered.
  logImplicit("link_search", row, { value: row.ms });
}

// ---- click source, then click target ----
// The same grammar without a drag: for touch, for a target three screens
// away, and for anyone who cannot hold a button down while aiming.
let connectPick = null; // {srcKey, kind, attr, legalKeys}

function beginConnectPick(srcKey, kind) {
  endConnectPick();
  const t = connectTargets(srcKey, kind);
  if (t.jacks.length === 0) return note(t.reason);
  connectPick = {
    srcKey,
    kind,
    attr: t.attr,
    legalKeys: new Set(t.jacks.map((j) => j.getAttribute(t.attr))),
  };
  connectSync();
  const name = kind === "mod"
    ? fragLabel(modAtKey(srcKey.replace(/\/m$/, "")) || {}, true)
    : kindName(rackKindAt(srcKey)) || "that";
  $("nb-status").innerHTML =
    `<b>cable out of ${esc(name)}</b> — click a lit ○ <span class="sp-dim">· esc to put it down</span>`;
  nbAnnounce(`Cable out of ${name}. ${t.jacks.length} sockets available.`);
  pickFeedback();
}

/** Re-light after a rebuild; the DOM the lighting lived on is thrown away on
 *  every bench reply. */
function connectSync() {
  const svg = $("rack-svg");
  // `wire` owns the class while a cable is physically out; only take it off
  // when neither gesture is running.
  if (!connectPick) {
    if (!wire) svg.classList.remove("wiring");
    // A cable held in the hand rather than put down by a click: the `wire`
    // gesture's lit sockets were drawn once at pointerdown and died with the
    // DOM they were drawn on, so a rebuild mid-drag left the player dragging
    // a cable across a rack with nothing lit.
    else lightWireTargets();
    return;
  }
  svg.classList.add("wiring");
  if (!wb.rack) return endConnectPick();
  let lit = 0;
  for (const j of svg.querySelectorAll(`.jack[${connectPick.attr}]`)) {
    if (!connectPick.legalKeys.has(j.getAttribute(connectPick.attr))) continue;
    j.classList.add("legal");
    lit += 1;
  }
  const from = svg.querySelector(`.jack[data-outkey="${cssKey(connectPick.srcKey)}"]`);
  if (from) from.classList.add("hot");
  if (lit === 0) endConnectPick();
}

function endConnectPick(msg) {
  if (!connectPick) return;
  connectPick = null;
  const svg = $("rack-svg");
  svg.classList.remove("wiring");
  svg.querySelectorAll(".jack.legal, .jack.hot").forEach((j) => j.classList.remove("legal", "hot"));
  $("nb-status").textContent = "";
  if (msg) note(msg);
  pickFeedback();
}

/** A press on any socket while a cable is out of an output. */
function connectClick(jack) {
  if (!connectPick) return false;
  const key = jack.getAttribute(connectPick.attr);
  const w = connectPick;
  if (!key) return false;
  if (!w.legalKeys.has(key)) {
    note(connectTargets(w.srcKey, w.kind).reason);
    return true;
  }
  const r = jack.getBoundingClientRect();
  endConnectPick();
  offerConnect(w.srcKey, key, w.kind, r.left + r.width / 2, r.bottom + 6);
  return true;
}

/** CSS.escape for a trace key. Keys are `node/0/1`, and `/` is a combinator
 *  in a selector — an unescaped one silently matches nothing. */
function cssKey(k) {
  return window.CSS && CSS.escape ? CSS.escape(k) : k.replace(/\//g, "\\/");
}

// ===========================================================================
// PICK-MODE FEEDBACK — the canvas says what is about to happen
// ===========================================================================
// Arming used to be invisible on the canvas: the decision was announced in a
// rail a thousand pixels from the plate it was about to edit, and the target
// was named by its trace id ("wavefolder·3"), which the player has never
// seen. So: dim what is not a target, put a caret on the exact cable that
// will be cut, an amber halo on a plate that will be replaced, and a chip on
// the target plate naming it by the title silkscreened on it.
let pickHoverKey = null;  // the plate under the pointer while sockets are lit
let pickChipKey = null;   // the plate the chip is currently pinned to

function pickFeedback() {
  const svg = $("rack-svg");
  const chip = $("pick-chip");
  if (!svg || !chip) return;
  pickChipKey = null;
  svg.querySelectorAll("g[data-key].dimmed").forEach((g) => g.classList.remove("dimmed"));
  svg.querySelectorAll(".pick-caret, .pick-halo, .pick-ghost").forEach((e) => e.remove());
  svg.classList.remove("picking");
  chip.classList.add("hidden");
  if (!wb.rack) return;

  // Three ways to be armed, one vocabulary:
  //   targets  — every plate that can receive the thing in hand
  //   aimKey   — the one plate this is aimed at, if there is one
  //   caretKey — the trace key whose *outgoing* cable gets cut
  //   replaces — amber: something on that plate goes away
  let targets = null;
  let aimKey = null;
  let caretKey = null;
  let replaces = false;
  let verb = "";
  if (pendingTarget) {
    // The ⋯ handoff and the link-drag search both name one module and act on
    // its slot: `insert_tree` at key K puts the new module between K and its
    // parent, so from the signal's point of view it lands after K.
    // `aim` is the plate the *row* was about when that is not the key the op
    // acts on ("insert before this filter" inserts at the filter's input), so
    // the chip and the halo stay on the module the player pointed at while the
    // caret stays on the wire that is actually being cut.
    aimKey = pendingTarget.aim || pendingTarget.key;
    replaces = pendingTarget.mode === "replace";
    caretKey = replaces ? null : pendingTarget.key;
    verb = pendingTarget.verb || (replaces ? "replace" : "insert after");
    targets = new Set([aimKey, pendingTarget.key]);
  } else if (connectPick) {
    verb = "cable into";
    targets = new Set([...connectPick.legalKeys].map(
      (k) => (connectPick.attr === "data-modkey" ? k : socketOwnerKey(k)),
    ));
    targets.add(connectPick.srcKey);
  } else if (armed && armedSockets.length) {
    const isMod = armed.sort === "mod";
    targets = new Set(armedSockets.map((j) => {
      const k = j.getAttribute("data-childkey");
      return k ? socketOwnerKey(k) : j.getAttribute("data-modkey");
    }));
    // Every lit socket is a candidate, so the only one worth naming is the
    // one under the pointer. The socket key IS a plate key for audio — the
    // occupant's — which is exactly the plate the promise is about.
    if (pickHoverKey && rackBoxes.has(pickHoverKey)) {
      aimKey = pickHoverKey;
      if (isMod) {
        replaces = armed.modSort === "leaf" && !!modAtKey(pickHoverKey);
        verb = replaces ? "replace the modulator on" : "modulate";
      } else if (armed.sort === "source") {
        replaces = !isPlaceholderKey(pickHoverKey);
        verb = replaces ? "replace" : "fill";
      } else {
        caretKey = pickHoverKey;
        // The same op as the ⋯ handoff above, and therefore the same word for
        // it: `insert_tree` at this socket puts the module between its
        // occupant and whatever the occupant feeds, so the signal reaches it
        // *after* the plate the chip is naming. This said "insert before" and
        // the menu said "insert after" about the identical edit.
        verb = "insert after";
      }
    }
  } else {
    return;
  }

  svg.classList.add("picking");
  for (const g of svg.querySelectorAll("g[data-key]")) {
    if (!targets.has(g.getAttribute("data-key"))) g.classList.add("dimmed");
  }
  if (!aimKey) return;
  pickChipKey = aimKey;

  // The caret goes on the run that is about to be cut, measured off the path
  // itself so it sits *on* the curve rather than near it. A patch routinely
  // carries four cables into the same column; "near it" is not an answer.
  let caretPt = null;
  if (caretKey) {
    const w = svg.querySelector(`.rack-wires path.wire[data-from="${cssKey(caretKey)}"]`);
    if (w) {
      try {
        const pt = w.getPointAtLength(w.getTotalLength() / 2);
        caretPt = { x: pt.x, y: pt.y };
        const c = svgEl("g", { transform: `translate(${pt.x},${pt.y})` }, "pick-caret");
        c.appendChild(svgEl("path", { d: "M 0 -11 L 0 11" }));
        c.appendChild(svgEl("path", { d: "M -5 -11 L 5 -11 M -5 11 L 5 11" }));
        svg.querySelector(".rack-controls")?.appendChild(c);
      } catch (_) { /* a path with no length: nothing to point at */ }
    }
  }
  const b = rackBoxes.get(aimKey);
  if (b) {
    const halo = svgEl("rect", {
      x: b.x - 5, y: b.y - 5, width: b.w + 10, height: b.h + 10, rx: 9,
    }, `pick-halo${replaces ? " replaces" : ""}`);
    svg.querySelector(".rack-controls")?.appendChild(halo);
  }
  // The ghost. Only the `armed` branch can draw one, because it is the only
  // one of the three that knows *which module* — the ⋯ handoff and a dropped
  // cable are both still waiting for the player to name it.
  if (armed && b) drawPickGhost(svg, armed, b, caretPt);

  // …and the chip, pinned to that plate, naming it with the title
  // silkscreened on it — never the trace id, which the player has never seen.
  // "the title on the plate" — and on a hole the plate says EMPTY, not the
  // kind of the substitute node standing in for one.
  const mod = wb.rack.modules.find((m) => m.key === aimKey);
  const title = isPlaceholderKey(aimKey) ? "the empty socket" : mod ? mod.title : "the output";
  chip.querySelector(".pick-chip-text").textContent = `${verb} ${title}`;
  // …and what the model expects of it, on the plate where the decision is
  // being made rather than only in a rail across the room (WS-2 §5). The chip
  // has no room for the caveat, so it carries it as the tooltip — and the
  // strip below the rack carries it in words.
  const priceEl = chip.querySelector(".pick-chip-price");
  if (priceEl) {
    const p = armed && aimKey ? socketPrice(armed.kind, armed.sort === "source" ? "replace" : "insert", aimKey) : null;
    priceEl.innerHTML = p ? priceHTML(p, false) : "";
    priceEl.classList.toggle("hidden", !p);
    chip.title = p ? priceWhatNotWhere(p) : "";
  }
  chip.classList.remove("hidden");
  positionPickChip();
}

// ---------- the ghost plate ----------
// Everything else in pick mode says where the module goes; this says what will
// be *there*. The card knows the module's ports, its defaults and what the
// model thinks of it, and then the player had to imagine the object. So the
// faceplate is drawn for real — same geometry function, same plate, same knob
// travel — greyed, at the position the module will actually take.
//
// It is a member of the caret/chip system rather than a second one: it reads
// the same `aimKey`/`caretKey` the caret does, so the caret marks the cable
// that gets cut and the ghost sits on it.

/** A `RackModule`-shaped stand-in for a module that does not exist yet, read
 *  off the same `frag()` the placement will send. `moduleBox`, `knobPos` and
 *  `plateStep` are pure functions of this shape, so the ghost's geometry is
 *  the geometry the real plate will get — not an approximation of it. */
function ghostModule(kind) {
  const m = MOD_BY_KIND[kind];
  if (!m) return null;
  const frag = m.frag();
  const tag = nodeTag(frag);
  const body = frag[tag] || {};
  const named = modEntry(frag)?.params;
  // `kind` means two different things depending on the shape. On a CV `Op` or
  // `Pair` it is the module's own identity, already silkscreened on the title,
  // and printing it would leak the enum variant. On an audio node it is a
  // faceplate chip the player can cycle — a filter's mode — and dropping it
  // would draw a three-knob plate where a four-slot one is about to land.
  const identity = tag === "Op" || tag === "Pair";
  const knobs = [];
  for (const [k, v] of Object.entries(body)) {
    if (v && typeof v === "object") continue;   // a subterm, not a parameter
    if (v === "None") continue;                 // an empty modulation slot
    if (k === "kind" && identity) continue;
    const slot = k === "p0" ? 0 : k === "p1" ? 1 : -1;
    if (slot >= 0 && named && !named[slot]) continue; // a one-parameter op
    const label = k === "kind" ? "mode" : slot >= 0 && named ? named[slot] : k.replace(/_/g, " ");
    knobs.push(
      typeof v === "number"
        ? { addr: "", label, value: v, kind: { t: "continuous" } }
        // `SvfLp` is a Rust variant name, not a silkscreen; the real plate
        // prints "svf lp" and the ghost must not print anything else.
        : { addr: "", label, value: String(v).replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase(), kind: { t: "enum" } },
    );
  }
  return { key: "__ghost", kind, title: m.name, column: 0, is_mod: m.sort === "mod", knobs };
}

function drawPickGhost(svg, hand, b, caretPt) {
  const mod = ghostModule(hand.kind);
  if (!mod) return;
  const box = moduleBox(mod);
  // Where it lands, said three ways, because the three placements are three
  // different edits: a modulator hangs below the plate it drives, a source
  // takes the socket outright, and a processor is spliced into the cable the
  // caret is already pointing at.
  let cx, cy;
  if (hand.sort === "mod") {
    cx = b.x + b.w / 2;
    cy = b.y + b.h + GUTTER + box.h / 2;
  } else if (hand.sort === "source") {
    cx = b.x + b.w / 2;
    cy = b.y + b.h / 2;
  } else if (caretPt) {
    // On the cable the caret is marking — but never overlapping the plate the
    // chip is naming. "insert before WAVEFOLDER" is unreadable advice if the
    // wavefolder is the thing hidden behind the proposal.
    cx = Math.max(caretPt.x, b.x + b.w + 8 + box.w / 2);
    cy = caretPt.y;
  } else {
    cx = b.x + b.w + GUTTER + box.w / 2;
    cy = b.y + b.h / 2;
  }
  const g = svgEl(
    "g",
    { transform: `translate(${(cx - box.w / 2).toFixed(1)},${(cy - box.h / 2).toFixed(1)})` },
    `pick-ghost${mod.is_mod ? " modside" : ""}`,
  );
  g.appendChild(svgEl("rect", { width: box.w, height: box.h, rx: 5 }, "mod-plate"));
  const title = svgEl("text", { x: 14, y: 18 }, `mod-title${mod.is_mod ? " modside" : ""}`);
  title.textContent = mod.title;
  g.appendChild(title);
  mod.knobs.forEach((k, i) => {
    const { x, y } = knobPos(mod, i, box);
    const pitch = knobPitch(mod, i, box);
    const kg = svgEl("g", { transform: `translate(${x},${y})` });
    if (k.kind.t === "continuous") {
      kg.appendChild(svgEl("path", { d: arcPath(KNOB_R + 3, 0, 1) }, "knob-track"));
      if (k.value > 0.004) {
        kg.appendChild(svgEl("path", { d: arcPath(KNOB_R + 3, 0, k.value) },
          `knob-arc${mod.is_mod ? " modside" : ""}`));
      }
      kg.appendChild(svgEl("circle", { r: KNOB_R }, "knob-body"));
      const ang = (-135 + 270 * k.value) * (Math.PI / 180);
      kg.appendChild(svgEl("line", {
        x1: (Math.sin(ang) * KNOB_R * 0.45).toFixed(2),
        y1: (-Math.cos(ang) * KNOB_R * 0.45).toFixed(2),
        x2: (Math.sin(ang) * (KNOB_R - 3)).toFixed(2),
        y2: (-Math.cos(ang) * (KNOB_R - 3)).toFixed(2),
      }, `knob-ind${mod.is_mod ? " modside" : ""}`));
    } else {
      const bw = Math.max(40, Math.min(62, pitch - 4));
      kg.appendChild(svgEl("rect", { x: -bw / 2, y: -11, width: bw, height: 22, rx: 3 }, "enum-body"));
      const txt = svgEl("text", { y: 4 }, "enum-text");
      txt.textContent = String(k.value);
      kg.appendChild(txt);
    }
    const lbl = svgEl("text", { y: KNOB_R + 15 }, "knob-label");
    lbl.textContent = silkLabel(k.label);
    kg.appendChild(lbl);
    g.appendChild(kg);
  });
  svg.querySelector(".rack-controls")?.appendChild(g);
}

/** The chip lives in the frame, not the scroller, so it is re-aimed whenever
 *  the camera moves rather than riding away with the patch. */
function positionPickChip() {
  const chip = $("pick-chip");
  if (!chip || chip.classList.contains("hidden")) return;
  const b = pickChipKey && rackBoxes.get(pickChipKey);
  if (!b) return chip.classList.add("hidden");
  const fr = $("rack-frame").getBoundingClientRect();
  const p = rackToClient(b.x + b.w / 2, b.y);
  // Clamped into the frame. The chip is centre-anchored on the plate, so a
  // plate near an edge used to push half the sentence out of the frame and the
  // frame clipped it — "…RT AFTER SUPERSAW". It got worse when the chip
  // started carrying the price as well, which is what made it worth fixing:
  // sliding sideways breaks the exact centring and keeps every word.
  const half = chip.offsetWidth / 2 + 6;
  const x = Math.max(half, Math.min(fr.width - half, p.x - fr.left));
  chip.style.left = `${Math.round(x)}px`;
  chip.style.top = `${Math.round(p.y - fr.top - 8)}px`;
}

// ---- keyboard ----
function nbGridKeys(ev) {
  // While a module is armed the arrows belong to the socket walk. Both
  // handlers used to fire on the same press, so the focus ring and the lit
  // socket moved independently and Enter placed into whichever one won.
  if (armed) return;
  const chip = ev.target.closest(".nb-item");
  if (!chip) return;
  const groups = $("nb-groups");
  const all = [...groups.querySelectorAll(".nb-item:not(.hidden)")];
  const i = all.indexOf(chip);
  const go = (el) => {
    if (!el) return;
    // Keep the roving stop with the focus, or Tab would return to whichever
    // chip happened to hold it when the list was last rendered.
    all.forEach((c) => { c.tabIndex = -1; });
    el.tabIndex = 0;
    el.focus();
    ev.preventDefault();
  };
  if (ev.key === "ArrowDown") go(all[Math.min(all.length - 1, i + 1)]);
  else if (ev.key === "ArrowUp") go(all[Math.max(0, i - 1)]);
  else if (ev.key === "Home") go(all[0]);
  else if (ev.key === "End") go(all[all.length - 1]);
  else if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
    const secs = [...groups.querySelectorAll(".nb-group:not(.empty)")];
    const here = secs.indexOf(chip.closest(".nb-group"));
    const next = secs[Math.max(0, Math.min(secs.length - 1, here + (ev.key === "ArrowRight" ? 1 : -1)))];
    go(next?.querySelector(".nb-item:not(.hidden)"));
  } else if (ev.key === "Escape") {
    $("nb-q").focus();
    ev.preventDefault();
  }
}

/** Arrow-walk the lit sockets while something is armed. Returns true if the
 *  key was consumed, so the global handler can leave it alone. */
function nbArmedKeys(ev) {
  if (!armed || armedSockets.length === 0) return false;
  if (ev.key === "Escape") { disarm(); return true; }
  if (ev.key === "ArrowDown" || ev.key === "ArrowRight" || ev.key === "ArrowUp" || ev.key === "ArrowLeft") {
    const d = ev.key === "ArrowDown" || ev.key === "ArrowRight" ? 1 : -1;
    armedSockets[armedIdx]?.classList.remove("hot");
    armedIdx = (armedIdx + d + armedSockets.length) % armedSockets.length;
    const j = armedSockets[armedIdx];
    j.classList.add("hot");
    ensureRackVisible(j);
    // The keyboard walk is an aim like any other: the caret, the halo, the
    // chip and the ghost all read `pickHoverKey`, so stepping without setting
    // it left the canvas saying nothing for the one route that needs it most.
    pickHoverKey = j.getAttribute("data-childkey") || j.getAttribute("data-modkey") || null;
    pickFeedback();
    nbAnnounce(`socket ${armedIdx + 1} of ${armedSockets.length} — ${socketLabel(j)}`);
    return true;
  }
  if (ev.key === "Enter" && armedIdx >= 0) { nbSocketClick(armedSockets[armedIdx]); return true; }
  return false;
}

/** Press-drag straight off a chip — the expert path. */
function nbDragFrom(chip, ev) {
  const m = MOD_BY_KIND[chip.dataset.kind];
  if (!m || !wb.rack) return;
  let dragging = false;
  const startX = ev.clientX, startY = ev.clientY;
  const move = (mv) => {
    if (dragging) return;
    if (Math.hypot(mv.clientX - startX, mv.clientY - startY) < 6) return;
    dragging = true;
    cleanup();
    disarm();
    startWireDrag(
      {
        mode: m.sort === "mod" ? "palette-mod" : "palette-audio",
        item: { frag: m.frag(), kindId: m.kind },
        kind: m.sort === "mod" ? "mod" : "audio",
      },
      mv,
    );
  };
  const cleanup = () => {
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", cleanup);
    document.removeEventListener("pointercancel", cleanup);
  };
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", cleanup);
  document.addEventListener("pointercancel", cleanup);
}

// ---------- wire drawing ----------
let wire = null; // {mode, item?, childKey?, key?, kind}

/** Light every socket the cable in hand can legally land in.
 *
 *  Split out of `startWireDrag` because the lighting lives on DOM that a
 *  rebuild throws away, and a rebuild can land in the middle of a drag: a
 *  bench reply from an earlier edit, or the level-of-detail switch tripping
 *  when the edge-pan carries the camera past 0.55×. The lit set is the only
 *  thing on screen saying where the cable may go, so it has to be rebuilt with
 *  the rack rather than survive it. */
function lightWireTargets() {
  const spec = wire;
  if (!spec) return;
  const rackSvg = $("rack-svg");
  rackSvg.classList.add("wiring");
  // A palette drag lights the same sockets a tray drag does — the two gestures
  // differ only in where the module came from.
  if (spec.mode === "tray-audio" || spec.mode === "palette-audio") {
    rackSvg.querySelectorAll('.jack[data-childkey]').forEach((j) => {
      j.classList.add("legal");
      // Sources evict, processors splice. Say which before the drop, not after.
      if (SOURCE_TAGS.includes(nodeTag(spec.item.frag))) j.classList.add("replaces");
    });
  } else if (spec.mode === "tray-mod" || spec.mode === "palette-mod") {
    rackSvg.querySelectorAll('.jack[data-modkey]').forEach((j) => j.classList.add("legal"));
  } else if (spec.legalKeys) {
    // A cable out of an output. Everything the tree allows lights; everything
    // it does not stays dark AND gets a reason when you drop on it, which is
    // the difference between a rule and a shrug.
    for (const j of rackSvg.querySelectorAll(`.jack[${spec.attr}]`)) {
      if (spec.legalKeys.has(j.getAttribute(spec.attr))) j.classList.add("legal");
    }
  }
}

function startWireDrag(spec, ev) {
  if (wire) return; // one cable at a time — no re-entrant drags
  wire = spec;
  lightWireTargets();
  wire.sx = ev.clientX;
  wire.sy = ev.clientY;
  wire.tx = ev.clientX;
  wire.ty = ev.clientY;
  // Where the cable comes *out of* is a place on the patch, not a place on
  // the screen — so if it started on the rack it is remembered in rack units
  // and re-projected every frame. Without this the band stays nailed to the
  // pixel the press happened on while the world moves underneath it, which is
  // exactly what the auto-pan below does on purpose and what a zoom does by
  // accident. A drag that began in the node bank has no rack anchor: the chip
  // it came from really is at a fixed place on the screen.
  if ($("rack-svg").contains(ev.target)) wire.anchor = clientToRack(ev.clientX, ev.clientY);
  redrawWireBand();
  document.addEventListener("pointermove", onWireMove);
  document.addEventListener("pointerup", onWireUp, { once: true });
  // A touch the browser reclaims (an OS edge gesture, a second finger, a
  // system alert) fires pointercancel and *no* pointerup. Without this the
  // cable stays drawn across the screen, every legal jack stays lit, and
  // `wire` stays non-null — which the re-entrancy guard in startWireDrag
  // then reads as "a cable is already out", so no further wiring is possible
  // until reload.
  document.addEventListener("pointercancel", onWireCancel, { once: true });
}

function drawWireBand(x1, y1, x2, y2, kind) {
  // Same span-proportional law as the rack's own cables, and *no floor* — a
  // flat minimum is precisely what puts control point 1 past control point 2
  // on a short drag. At span 35 a floor of 24 gives cp1 = x1+24 and
  // cp2 = x1+11, i.e. crossed, which kinks the cable instead of hanging it.
  const dx = Math.min(Math.abs(x2 - x1) * 0.42, 90);
  $("wire-overlay").innerHTML =
    `<path class="${kind}" d="M ${x1} ${y1} C ${x1 + dx} ${y1 + 20}, ${x2 - dx} ${y2 + 20}, ${x2} ${y2}"/>`;
}

/** Re-project the band from whatever is still true about it. Called on every
 *  pointer move, and by `applyView` on every frame the camera moves — a cable
 *  that detaches from its jack while the canvas slides is the desync the
 *  overlay's client coordinates used to guarantee. */
function redrawWireBand() {
  if (!wire) return;
  const a = wire.anchor ? rackToClient(wire.anchor.x, wire.anchor.y) : { x: wire.sx, y: wire.sy };
  drawWireBand(a.x, a.y, wire.tx, wire.ty, wire.kind);
}

function onWireMove(ev) {
  if (!wire) return;
  wire.tx = ev.clientX;
  wire.ty = ev.clientY;
  redrawWireBand();
  edgePanFrom(ev.clientX, ev.clientY);
}

function onWireCancel() {
  if (wire) note("cable dropped");
  endWireDrag();
}

function endWireDrag() {
  stopEdgePan();
  document.removeEventListener("pointermove", onWireMove);
  document.removeEventListener("pointerup", onWireUp);
  document.removeEventListener("pointercancel", onWireCancel);
  $("wire-overlay").innerHTML = "";
  const rackSvg = $("rack-svg");
  rackSvg.classList.remove("wiring");
  rackSvg.querySelectorAll(".jack.legal").forEach((j) => j.classList.remove("legal", "replaces"));
  wire = null;
}

function onWireUp(ev) {
  if (!wire) return endWireDrag();
  const el = document.elementFromPoint(ev.clientX, ev.clientY);
  const jack = el && el.closest ? el.closest(".jack") : null;
  const w = wire;
  endWireDrag();

  if (w.mode === "tray-audio" || w.mode === "palette-audio") {
    const childKey = jack && jack.getAttribute("data-childkey");
    const label = w.item.kindId ? kindName(w.item.kindId) : fragLabel(w.item.frag, false);
    // A missed drop used to be completely silent: the cable vanished, nothing
    // moved, and there was no way to tell a miss from a refusal.
    if (!childKey) {
      if (w.item.uid) note(`nothing there — ${label} is still held below`);
      else note(`nothing there — drop ${label} on a lit ○`);
      return;
    }
    const frag = w.item.frag;
    // Which of the two edits a held fragment means is decided by what it *is*,
    // not by where it lands. `insert_tree` grafts the socket's occupant in as
    // the fragment's own first input — which is exactly right for one module
    // (bypass's `rewrap` head especially: it comes back with its parameters
    // and the wire runs through it again) and silently discards the tail of a
    // multi-module chain, which is why a chain takes the socket instead and
    // says what it displaced.
    // A palette fragment is always one module wearing a default input, so it
    // always splices; only the shelf can hand you a whole chain.
    const fromTray = w.mode === "tray-audio";
    const splice = !SOURCE_TAGS.includes(nodeTag(frag)) &&
                   (!fromTray || w.item.rewrap || subtreeSize(frag) === 1);
    if (splice) {
      sendStruct({ op: "insert_tree", key: childKey, node: frag }, {
        text: w.item.rewrap ? `${label} is back in the wire, with its settings.` : `${label} patched into the wire.`,
        drop: w.item.uid ?? null,
      });
    } else {
      const old = nodeAtKey(childKey);
      const chain = old && subtreeSize(old) > 1;
      sendStruct({ op: "replace_tree", key: childKey, node: frag }, {
        text: chain
          ? `${label} took the socket — the ${subtreeSize(old)}-module chain it replaced is held below.`
          : `${label} took the socket.`,
        drop: w.item.uid ?? null,
      });
      if (chain) stageFragment(old, false);
    }
  } else if (w.mode === "tray-mod" || w.mode === "palette-mod") {
    const modKey = jack && jack.getAttribute("data-modkey");
    const label = w.item.kindId ? kindName(w.item.kindId) : fragLabel(w.item.frag, true);
    if (!modKey) {
      if (w.item.uid) note(`nothing there — ${label} is still held below`);
      else note(`nothing there — drop ${label} on a lit mod ○`);
      return;
    }
    const old = modAtKey(modKey);
    sendStruct({ op: "set_mod_tree", key: modKey, m: w.item.frag }, {
      text: `${label} → ${kindModTarget(rackKindAt(modKey)) || "mod"} on ${kindName(rackKindAt(modKey))}`,
      drop: w.item.uid ?? null,
    });
    if (old) stageFragment(old, true);
  } else if (w.mode === "connect-audio" || w.mode === "connect-mod") {
    // No movement at all is a click, not a miss — the same gesture without a
    // drag, for touch and for long distances.
    if (Math.hypot(ev.clientX - w.sx, ev.clientY - w.sy) <= 6) {
      beginConnectPick(w.srcKey, w.kind);
      return;
    }
    let target = jack && jack.hasAttribute(w.attr) ? jack : null;
    if (target && !w.legalKeys.has(target.getAttribute(w.attr))) {
      return note(connectTargets(w.srcKey, w.kind).reason);
    }
    if (!target) target = nearestLegalJack(ev.clientX, ev.clientY, w, 24);
    if (!target) {
      const body = bodyTarget(ev.clientX, ev.clientY, w);
      if (body === "spoken") return;
      target = body;
    }
    // Nothing under the cable: the question becomes "what goes next".
    if (!target) return openLinkSearch(w);
    offerConnect(w.srcKey, target.getAttribute(w.attr), w.kind, ev.clientX, ev.clientY);
  } else if (w.mode === "unplug-audio") {
    if (jack) return; // dropped back on a jack: treat as cancel
    // The socket is left visibly empty. The engine still needs a node there —
    // the term is total — but the plate says "empty" and the next module goes
    // there by default, instead of a fresh vco quietly pretending the unplug
    // did nothing.
    const pulled = chainTitle(w.childKey); // while it is still in the rack
    let doomed = null;
    const ok = applyTreeRewrite((tree, marks) => {
      const old2 = nodeAtIn(tree, w.childKey);
      if (!old2) return "that cable is no longer there";
      const hole = placeholderNode();
      if (!setNodeAtIn(tree, w.childKey, hole)) return "that cable is no longer there";
      if (!marks.includes(old2)) doomed = old2;
      marks.push(hole);
      return null;
    }, { op: "unplug", key: w.childKey, kind: rackKindAt(w.childKey) });
    if (!ok) return;
    const uid = doomed ? stageFragment(doomed, false) : null;
    noteOnLanding(
      doomed
        ? `unplugged — the ${pulled} is held below and the socket is empty.`
        : "unplugged — the socket is empty.",
      { undo: () => { if (uid != null) unstage(uid); doUndo(); }, undoLabel: "plug it back in" },
    );
  } else if (w.mode === "unplug-mod") {
    if (jack) return;
    if (!modAtKey(w.key)) return;
    // Staged *after* the post, not before: `stageFragment` binds the fragment
    // to the edit that is going out, so an op that the engine refuses takes
    // its own shelf entry back with it.
    unplugMod(w.key);
  }
}

// ---------- live scope ----------
// The instrument had no visual pulse at all: no rAF loop and no analyser
// anywhere, so playing a note changed one key's background colour and nothing
// else. This is the trace that makes the rack look powered on. It runs only
// while something is sounding, so idling costs nothing.
let scopeRaf = null;
let scopeBuf = null;
let scopeBins = null;
let scopeQuiet = 0;
let scopeLast = 0;

// Everything about the scope that is a *choice*, persisted. Six of these were
// constants buried in the draw loop — the fft size, the trigger, the colour,
// the glow, how long it waits before parking, and which side of the master
// gain it listens to. A scope you cannot aim is a decoration; one you have to
// re-aim after every reload is worse, so the whole thing goes to localStorage
// through the same merge-on-load `nbState` uses: unknown keys in storage are
// ignored, missing keys keep their default, and a shipped default can change
// without stranding anyone's saved settings.
const SCOPE_STORE = "ricercar-scope";
const scopeState = {
  mode: "scope",     // off | scope | spectrum
  tap: "pre",        // pre | post  — the instrument, or what you hear
  fft: 2048,
  smooth: 0.6,       // the analyser's own window
  colour: "green",   // green | amber | ice
  glow: true,
  trigger: true,
  gain: 1,
  floor: 0.55,       // how present the trace and its grid stay once it parks
  park: 1.5,         // seconds of silence before it parks
  corner: "br",
  size: "M",
  freeze: false,
};
const SCOPE_INK = {
  green: { line: "#8ef0b1", glow: "rgba(142,240,177,0.75)" },
  amber: { line: "#ffb454", glow: "rgba(255,180,84,0.75)" },
  ice: { line: "#cfe6ff", glow: "rgba(207,230,255,0.7)" },
};
function scopeLoad() {
  try {
    const saved = JSON.parse(localStorage.getItem(SCOPE_STORE) || "{}");
    for (const k of Object.keys(scopeState)) if (k in saved) scopeState[k] = saved[k];
  } catch (e) { /* a corrupt blob is not worth a boot failure */ }
}
function scopeSave() {
  try { localStorage.setItem(SCOPE_STORE, JSON.stringify(scopeState)); } catch (e) {}
}
/** The analyser the current tap points at, or null before audio exists. */
function scopeAnalyser() {
  if (!live) return null;
  return scopeState.tap === "post" ? (live.analyserPost || live.analyser) : live.analyser;
}

function scopeShouldRun() {
  return scopeState.mode !== "off" && scopeAnalyser() != null &&
    (heldNotes.size > 0 || scopeQuiet < scopeState.park * 60);
}

/** Push the persisted settings at the DOM and the analyser. Called on boot,
 *  on every control in the panel, and whenever live audio (re)appears. */
function scopeApply() {
  const shell = $("scope-shell");
  if (!shell) return;
  shell.classList.toggle("hidden", scopeState.mode === "off");
  for (const c of ["tl", "tr", "bl", "br"]) shell.classList.toggle(`corner-${c}`, scopeState.corner === c);
  for (const s of ["s", "m", "l"]) shell.classList.toggle(`size-${s}`, scopeState.size.toLowerCase() === s);
  shell.style.setProperty("--scope-floor", String(scopeState.floor));
  $("scope-cap").textContent =
    (scopeState.tap === "post" ? "post-master" : "pre-master") +
    (scopeState.mode === "spectrum" ? " · spectrum" : "") +
    (scopeState.freeze ? " · frozen" : "");
  const an = scopeAnalyser();
  if (an) {
    // fftSize only accepts powers of two in range; a stored value from a
    // future build that dropped one would otherwise throw on assignment.
    try { an.fftSize = scopeState.fft; } catch (e) {}
    an.smoothingTimeConstant = scopeState.smooth;
  }
  scopeBuf = null;
  scopeBins = null;
  if (scopeState.mode === "off") {
    if (scopeRaf != null) cancelAnimationFrame(scopeRaf);
    scopeRaf = null;
    shell.classList.remove("live");
  } else {
    // Paint the graticule now, whether or not anything is sounding. A parked
    // scope with an empty screen is a hole in the panel; one with its grid up
    // is an instrument waiting for a signal, which is what it is.
    const canvas = $("live-scope");
    if (canvas && canvas.clientWidth) {
      const ctx = scopeCtx(canvas);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      scopeGraticule(ctx, canvas.width, canvas.height, window.devicePixelRatio || 1);
    }
    if (live) startScope();
  }
}

// The graticule. 8×4 divisions at 6% phosphor: enough to read amplitude and
// period off the trace, faint enough that it never competes with it. Drawn in
// the canvas rather than in CSS so it scales with the device pixel ratio the
// trace is drawn at, and so a frozen trace keeps its grid.
function scopeGraticule(ctx, w, h, dpr) {
  ctx.strokeStyle = "rgba(142,240,177,0.06)";
  ctx.lineWidth = Math.max(1, dpr * 0.5);
  ctx.beginPath();
  for (let i = 1; i < 8; i++) {
    const x = Math.round((w * i) / 8) + 0.5;
    ctx.moveTo(x, 0); ctx.lineTo(x, h);
  }
  for (let i = 1; i < 4; i++) {
    const y = Math.round((h * i) / 4) + 0.5;
    ctx.moveTo(0, y); ctx.lineTo(w, y);
  }
  ctx.stroke();
}

function startScope() {
  if (scopeRaf != null || scopeState.mode === "off" || !scopeAnalyser()) return;
  scopeQuiet = 0;
  const draw = (now) => {
    const canvas = $("live-scope");
    const shell = $("scope-shell");
    const on = currentView === "play" && wb.rack && scopeState.mode !== "off";
    if (!on) {
      scopeRaf = null;
      shell.classList.remove("live");
      return;
    }
    // Reduced motion does not mean "no instrument" — a scope that never
    // updates is a broken scope — it means "do not animate at 60 Hz". Ten
    // frames a second still reads as a live trace and stops being motion you
    // have to look away from.
    const budget = prefersStill() ? 100 : 0;
    if (budget && now - scopeLast < budget) { scopeRaf = requestAnimationFrame(draw); return; }
    scopeLast = now;

    const an = scopeAnalyser();
    if (!an) { scopeRaf = null; return; }
    const ctx = scopeCtx(canvas);
    const { width: w, height: h } = canvas;
    const dpr = window.devicePixelRatio || 1;
    // Freeze holds the last frame drawn, grid and all: nothing is cleared and
    // nothing is fetched, so the loop costs one branch while it is on.
    if (scopeState.freeze) {
      scopeRaf = requestAnimationFrame(draw);
      return;
    }
    if (!scopeBuf || scopeBuf.length !== an.fftSize) scopeBuf = new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(scopeBuf);
    let peak = 0;
    for (let i = 0; i < scopeBuf.length; i++) {
      const a = Math.abs(scopeBuf[i]);
      if (a > peak) peak = a;
    }
    if (heldNotes.size > 0 || peak > 1e-4) scopeQuiet = 0;
    else scopeQuiet += 1;

    ctx.clearRect(0, 0, w, h);
    scopeGraticule(ctx, w, h, dpr);
    const lit = peak > 1e-4;
    shell.classList.toggle("live", lit);
    if (lit) {
      const ink = SCOPE_INK[scopeState.colour] || SCOPE_INK.green;
      ctx.strokeStyle = ink.line;
      ctx.fillStyle = ink.line;
      ctx.lineWidth = 1.5 * dpr;
      if (scopeState.glow) {
        ctx.shadowColor = ink.glow;
        ctx.shadowBlur = 8 * dpr;
      }
      if (scopeState.mode === "spectrum") {
        // One `getByteFrequencyData` away the whole time. A spectrum answers
        // "what did that filter actually take out" in a way a waveform never
        // does, and this instrument is mostly filters.
        if (!scopeBins || scopeBins.length !== an.frequencyBinCount) {
          scopeBins = new Uint8Array(an.frequencyBinCount);
        }
        an.getByteFrequencyData(scopeBins);
        // Log-spaced columns: linear bins give three quarters of the width to
        // the top two octaves, where a synth patch has almost nothing.
        const cols = Math.max(24, Math.min(96, Math.floor(w / (4 * dpr))));
        const bw = w / cols;
        const n = scopeBins.length;
        for (let c = 0; c < cols; c++) {
          const lo = Math.floor(Math.pow(n, c / cols));
          const hi = Math.max(lo + 1, Math.floor(Math.pow(n, (c + 1) / cols)));
          let m = 0;
          for (let i = lo; i < hi && i < n; i++) if (scopeBins[i] > m) m = scopeBins[i];
          const bh = Math.min(h, (m / 255) * h * scopeState.gain);
          ctx.fillRect(c * bw + 0.5, h - bh, Math.max(1, bw - 1.5 * dpr), bh);
        }
      } else {
        const mid = h / 2;
        // Trigger on the first rising zero crossing so the trace stands still
        // instead of skating sideways. Off, it free-runs — which is what you
        // want for noise and for anything percussive.
        let start = 0;
        if (scopeState.trigger) {
          for (let i = 1; i < scopeBuf.length / 2; i++) {
            if (scopeBuf[i - 1] <= 0 && scopeBuf[i] > 0) { start = i; break; }
          }
        }
        const n = Math.floor(scopeBuf.length / 2);
        ctx.beginPath();
        for (let x = 0; x < w; x++) {
          const s = (scopeBuf[start + Math.floor((x / w) * n)] || 0) * scopeState.gain;
          const y = mid - Math.max(-1, Math.min(1, s)) * mid * 0.86;
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
    }
    if (scopeShouldRun()) scopeRaf = requestAnimationFrame(draw);
    else { scopeRaf = null; shell.classList.remove("live"); }
  };
  scopeRaf = requestAnimationFrame(draw);
}

// ---------- the scope's settings panel ----------
// Hung off the header's ⋯ rather than given its own gear on the rack: it is a
// preference, and preferences live where the app's other preferences live.
function scopePanelInit() {
  const panel = $("scope-panel");
  if (!panel) return;
  const bind = (id, get, set) => {
    const el = $(id);
    if (!el) return;
    get(el);
    el.addEventListener("input", () => { set(el); scopeSave(); scopeApply(); });
  };
  bind("sp-mode", (e) => { e.value = scopeState.mode; }, (e) => { scopeState.mode = e.value; });
  bind("sp-tap", (e) => { e.value = scopeState.tap; }, (e) => { scopeState.tap = e.value; });
  bind("sp-fft", (e) => { e.value = String(scopeState.fft); }, (e) => { scopeState.fft = Number(e.value); });
  bind("sp-smooth", (e) => { e.value = String(scopeState.smooth); }, (e) => { scopeState.smooth = Number(e.value); });
  bind("sp-colour", (e) => { e.value = scopeState.colour; }, (e) => { scopeState.colour = e.value; });
  bind("sp-corner", (e) => { e.value = scopeState.corner; }, (e) => { scopeState.corner = e.value; });
  bind("sp-size", (e) => { e.value = scopeState.size; }, (e) => { scopeState.size = e.value; });
  bind("sp-park", (e) => { e.value = String(scopeState.park); }, (e) => { scopeState.park = Number(e.value); });
  bind("sp-gain",
    (e) => { e.value = String(scopeState.gain); $("sp-gain-v").textContent = `${scopeState.gain.toFixed(2)}×`; },
    (e) => { scopeState.gain = Number(e.value); $("sp-gain-v").textContent = `${scopeState.gain.toFixed(2)}×`; });
  bind("sp-floor",
    (e) => { e.value = String(scopeState.floor); $("sp-floor-v").textContent = scopeState.floor.toFixed(2); },
    (e) => { scopeState.floor = Number(e.value); $("sp-floor-v").textContent = scopeState.floor.toFixed(2); });
  bind("sp-trigger", (e) => { e.checked = !!scopeState.trigger; }, (e) => { scopeState.trigger = e.checked; });
  bind("sp-glow", (e) => { e.checked = !!scopeState.glow; }, (e) => { scopeState.glow = e.checked; });
  bind("sp-freeze", (e) => { e.checked = !!scopeState.freeze; }, (e) => { scopeState.freeze = e.checked; });
  const close = () => {
    panel.classList.add("hidden");
    $("scope-btn")?.setAttribute("aria-expanded", "false");
  };
  $("scope-close").onclick = close;
  $("scope-btn").onclick = (ev) => {
    ev.stopPropagation();
    $("ovf-menu").classList.add("hidden");
    $("ovf-btn").setAttribute("aria-expanded", "false");
    const shut = panel.classList.toggle("hidden");
    $("scope-btn").setAttribute("aria-expanded", String(!shut));
    if (!shut) $("sp-mode").focus();
  };
  // The same dismissals the ⋯ menu itself honours, so the panel never
  // outlives the gesture that opened it.
  document.addEventListener("pointerdown", (ev) => {
    if (panel.classList.contains("hidden")) return;
    if (panel.contains(ev.target) || $("scope-btn").contains(ev.target)) return;
    close();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !panel.classList.contains("hidden")) { close(); $("scope-btn").focus(); }
  });
}

// Audio cables only look alive while audio is actually flowing — before this,
// amber modulation wires pulsed and green signal wires sat dead, which is
// backwards from what you hear.
function setSignalFlow(on) {
  const svg = $("rack-svg");
  if (svg) svg.classList.toggle("flowing", on);
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
  const dpr = window.devicePixelRatio || 1;
  ctx.clearRect(0, 0, w, h);
  drawGraticule(ctx, w, h, "rgba(142,240,177,0.07)");
  const mid = h / 2;

  // Two candidates rendered as bare envelopes are two green blobs. A zero
  // line, a full-scale reference and the note boundaries make them readable
  // as *the same measurement* — which is the whole point of an A/B.
  ctx.strokeStyle = "rgba(142,240,177,0.28)";
  ctx.lineWidth = 1 * dpr;
  ctx.beginPath();
  ctx.moveTo(0, mid);
  ctx.lineTo(w, mid);
  ctx.stroke();
  ctx.setLineDash([3 * dpr, 4 * dpr]);
  ctx.strokeStyle = "rgba(142,240,177,0.16)";
  for (const f of [0.92, -0.92]) {
    ctx.beginPath();
    ctx.moveTo(0, mid - f * mid * 0.92);
    ctx.lineTo(w, mid - f * mid * 0.92);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.fillStyle = INK.greenDim;
  ctx.font = `${9 * dpr}px ${getComputedStyle(document.body).getPropertyValue("--font-mono") || "monospace"}`;
  ctx.textAlign = "left";
  ctx.fillText("0 dBFS", 4 * dpr, mid - mid * 0.92 + 11 * dpr);
  const step = Math.max(1, Math.floor(data.length / w));
  ctx.strokeStyle = INK.green;
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
  held_centroid_std: "held-note motion", high_ratio: "speaks up high",
  chord_flatness_delta: "stack mud",
  // Structural coordinates. Several are FAMILIES — one column standing for
  // several modules — so the label has to name the family rather than any one
  // member, or the WHY line credits a wavefolder for a bitcrusher's evidence.
  n_vco: "VCOs", n_supersaw: "supersaws", n_noise: "noise srcs", n_mix: "mixers",
  n_wavetable: "wavetables", n_pluck: "plucked strings", n_formant: "formant voices",
  n_filter: "filtering", n_drive: "drive & fold", n_time: "delay & grains",
  n_mod_fx: "chorus & sweeps", n_reverb: "reverbs", n_dynamics: "level control",
  n_rand: "S&H mods", n_lfo: "LFO mods", n_env: "env mods", n_follow: "followers",
  n_mod_shape: "shaped mod", n_mod_logic: "gated mod", mod_depth_mean: "mod chaining",
  depth: "patch depth", size: "patch size",
  mod_density: "mod density", amp_attack: "amp attack", amp_sustain: "amp sustain",
  amp_release: "amp release",
};

// Audio feature names carry a stimulus tag (`centroid_mean:p2`) because their
// values only mean anything relative to the audition phrase that produced
// them; the human label is stimulus-agnostic, so strip the tag for display.
function niceName(name) {
  return NICE_NAMES[name] || NICE_NAMES[String(name).split(":")[0]] || name;
}

// Style hues are amber rotations, not an arbitrary categorical ramp: the
// taste map is the model's mind, and the model speaks amber.
const STYLE_COLORS = ["#ffb454", "#e08a3c", "#c9a86a", "#a8763f", "#d9d4c8"];

// A style's display name: the user's, or an auto-label from its strongest
// positive pulls ("bright + punchy").
function styleName(s, k) {
  if (s && s.name) return s.name;
  if (!s || !s.theta) return `style ${k + 1}`;
  const tops = [...s.theta]
    .filter((r) => r.mean > 0)
    .sort((a, b) => b.mean - a.mean)
    .slice(0, 2)
    .map((r) => niceName(r.name));
  return tops.length ? tops.join(" + ") : `style ${k + 1}`;
}

function styleBadge(el, k) {
  if (k == null || k < 0 || !views || !views.styles || !views.styles[k]) {
    el.innerHTML = "";
    return;
  }
  const color = STYLE_COLORS[k % STYLE_COLORS.length];
  el.innerHTML = `<i style="background:${color};box-shadow:0 0 6px ${color}"></i>${esc(styleName(views.styles[k], k))}`;
}

function renderStyleChips() {
  const holder = $("style-chips");
  const show = currentView === "taste" && views && views.styles;
  holder.classList.toggle("hidden", !show);
  if (!show) return;
  holder.innerHTML = "";
  views.styles.forEach((s, k) => {
    if (s.share < 0.02) return;
    const color = STYLE_COLORS[k % STYLE_COLORS.length];
    const chip = document.createElement("div");
    chip.className = "style-chip";
    chip.innerHTML =
      `<i style="background:${color};box-shadow:0 0 6px ${color}"></i>` +
      `<input class="sc-name" maxlength="24" value="${esc(s.name || "")}" placeholder="${esc(styleName(s, k))}" title="Name this style">` +
      `<span class="sc-share">${Math.round(s.share * 100)}%</span>` +
      `<button class="sc-play" title="Audition this style's exemplar">▶</button>`;
    const input = chip.querySelector(".sc-name");
    input.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") input.blur(); });
    input.addEventListener("keyup", (e) => e.stopPropagation());
    input.onblur = () => send({ type: "set_style_name", k, name: input.value });
    // A lens the model has learned but has no exemplar for yet cannot be
    // auditioned. Saying so on the control beats a ▶ that silently returns.
    const ex = s.exemplars && s.exemplars[0];
    const scPlay = chip.querySelector(".sc-play");
    if (ex == null) {
      scPlay.disabled = true;
      scPlay.title = "No exemplar for this style yet — it needs more patches on this lens";
    } else {
      scPlay.onclick = () => awaitRender(ex, () => play(ex, scPlay));
    }
    holder.appendChild(chip);
  });
}
const CAPTIONS = {
  map: "Every patch you’ve heard, mapped by sound & structure. Glow is how much the model thinks you’d like it, size is how sure it is — islands are styles. Click a dot to open it.",
  styles: "Your taste as separate styles — new lenses appear as you give the model more to work with (up to 5). Dim lenses are idle.",
  dir: "What each style listens for — learned directions in sound, not settings. Longer bar = stronger pull.",
  trust: "Should you believe it? Each dot is a bucket of forecasts: how confident it was, against how often it was right. On the line = honest.",
};
// While a chart is empty, the caption must describe the state on screen —
// "longer bar = stronger pull" over a void promises a chart that isn't there.
const EMPTY_CAPTIONS = {
  map: "Your patches will map here by sound & structure — a few picks and it lights up.",
  styles: "Your taste as separate styles. None on record yet.",
  dir: "The sound qualities that pull you — brightness, roughness, attack. Nothing learned yet.",
  trust: "Whether to believe the model. It forecasts every duel before your vote; the first 20 land here.",
};

const TRUST_MIN_N = 20;

// Empty states are HTML, not canvas paint: selectable, with a real CTA, and
// no two tabs identical.
function renderEmptyState(tab) {
  const holder = $("crt-empty");
  if (!holder) return;
  const n = status.observations;
  const cn = engineCalib ? engineCalib.n : 0;
  const skel = (rows, cls = "") =>
    `<div class="ce-skel ${cls}" aria-hidden="true">${"<i></i>".repeat(rows)}</div>`;
  const cta = `<button class="hw-btn small" id="ce-cta">Start ${FIT_EVERY} quick picks →</button>`;
  const content = {
    map: `
      <div class="ce-title">nothing predicted yet</div>
      <div class="ce-copy">Every patch you hear lands on this map. After your first
      ${FIT_EVERY} picks the model fits, and the dots glow by how much it thinks
      you'd like them.</div>
      <div class="ce-count">${Math.min(n, FIT_EVERY)} of ${FIT_EVERY} picks</div>${cta}`,
    styles: `${skel(3)}
      <div class="ce-title">one lens, waiting</div>
      <div class="ce-copy">Your taste gets up to five lenses as it splits — after a
      dozen picks it can separate ambient-you from acid-you, and you can name
      each one.</div>
      <div class="ce-count">${Math.min(n, FIT_EVERY)} of ${FIT_EVERY} picks</div>${cta}`,
    dir: `${skel(4, "dir")}
      <div class="ce-title">nothing learned yet</div>
      <div class="ce-copy">This shows which <i>qualities</i> pull you — brightness,
      roughness, attack — not which knobs. Longer bar, stronger pull.</div>
      <div class="ce-count">${Math.min(n, FIT_EVERY)} of ${FIT_EVERY} picks</div>${cta}`,
    trust: `<div class="ce-trust-skel" aria-hidden="true"></div>
      <div class="ce-title">${Math.min(cn, TRUST_MIN_N)} of ${TRUST_MIN_N} forecasts</div>
      <div class="ce-copy">Before every vote the model forecasts your pick. Dots land
      here: forecast against outcome, and on the line means honest. Dots inside
      their whisker are indistinguishable from honest.</div>${cta}`,
  }[tab];
  holder.innerHTML = content || "";
  const btn = holder.querySelector("#ce-cta");
  if (btn) btn.onclick = () => showView("evolve");
}

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
  renderStyleChips();
  mapHits = [];

  ctx.font = `${10 * dpr}px "IBM Plex Mono", monospace`;
  const noTaste = !views || !views.styles;
  const empty = {
    map: !(views && views.map && views.map.points && views.map.points.length),
    styles: noTaste,
    dir: noTaste,
    trust: !(engineCalib && engineCalib.n >= TRUST_MIN_N),
  }[tasteTab];
  // MAP before the first fit: the dots are real (patches by sound) but the
  // glow is not — draw the map AND overlay the pre-state invitation, so the
  // caption never describes a prediction that doesn't exist yet.
  const mapPrefit = tasteTab === "map" && !empty && noTaste;
  $("taste-caption").textContent = (empty || mapPrefit ? EMPTY_CAPTIONS : CAPTIONS)[tasteTab];
  $("crt-empty").classList.toggle("hidden", !empty && !mapPrefit);
  $("crt-empty").classList.toggle("translucent", mapPrefit);
  $("map-legend").classList.toggle("hidden", tasteTab !== "map" || empty || noTaste);
  if (empty) return renderEmptyState(tasteTab);
  if (mapPrefit) renderEmptyState("map");

  if (tasteTab === "map") drawMapTab(ctx, w, h, dpr);
  else if (tasteTab === "trust") drawTrustTab(ctx, w, h, dpr);
  else if (tasteTab === "styles") drawStylesTab(ctx, w, h, dpr);
  else drawDirectionsTab(ctx, w, h, dpr);
}

function drawTrustFromEngine(ctx, w, h, dpr, E) {
  const pad = 56 * dpr;
  const x0 = pad, y0 = pad * 0.5;
  const side = Math.min(w - pad * 2.4, h - pad * 2.0);
  const sx = (p) => x0 + p * side;
  const sy = (p) => y0 + (1 - p) * side;

  ctx.strokeStyle = "rgba(255,180,84,0.22)";
  ctx.lineWidth = 1 * dpr;
  ctx.strokeRect(x0, y0, side, side);
  ctx.setLineDash([4 * dpr, 4 * dpr]);
  ctx.beginPath();
  ctx.moveTo(sx(0), sy(0));
  ctx.lineTo(sx(1), sy(1));
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = INK.amberDim;
  ctx.textAlign = "center";
  // The axes are P(A wins) predicted vs observed — NOT "confidence" vs
  // "accuracy". A bin at p_a = 0.1 where A wins 10% of the time is perfectly
  // calibrated, and the old labels made that read as a failure.
  ctx.fillText("it said A would win this often", x0 + side / 2, y0 + side + 26 * dpr);
  ctx.fillText("perfectly honest", sx(0.82), sy(0.86));
  ctx.save();
  ctx.translate(x0 - 36 * dpr, y0 + side / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("A actually won this often", 0, 0);
  ctx.restore();

  for (const b of E.bins || []) {
    if (!b.n) continue;
    const r = (3 + 5 * Math.min(1, b.n / 12)) * dpr;
    const bx = sx(b.predicted);
    // A bin of two forecasts plots far off the diagonal under a caption that
    // says "on the line = honest" — without an interval, the user's correct
    // inference is that the model is lying. Wilson 95% on the observed rate.
    const z = 1.96;
    const denom = 1 + (z * z) / b.n;
    const centre = (b.observed + (z * z) / (2 * b.n)) / denom;
    const half =
      (z * Math.sqrt((b.observed * (1 - b.observed)) / b.n + (z * z) / (4 * b.n * b.n))) / denom;
    ctx.strokeStyle = "rgba(255,180,84,0.4)";
    ctx.lineWidth = 1 * dpr;
    ctx.beginPath();
    ctx.moveTo(bx, sy(Math.min(1, centre + half)));
    ctx.lineTo(bx, sy(Math.max(0, centre - half)));
    ctx.stroke();
    ctx.shadowColor = INK.amber;
    ctx.shadowBlur = 8 * dpr;
    ctx.beginPath();
    ctx.arc(bx, sy(b.observed), r, 0, Math.PI * 2);
    if (b.n >= 5) {
      ctx.fillStyle = INK.amber;
      ctx.fill();
    } else {
      // Too few forecasts to mean anything: hollow, recessed.
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = INK.amber;
      ctx.lineWidth = 1.2 * dpr;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.shadowBlur = 0;
    ctx.fillStyle = INK.amberDim;
    ctx.textAlign = "left";
    ctx.fillText(`n=${b.n}`, bx + r + 4 * dpr, sy(b.observed) + 3 * dpr);
  }
  ctx.fillStyle = INK.amberDim;
  ctx.textAlign = "left";
  ctx.fillText("dots inside their whisker are indistinguishable from honest", x0, y0 + side + 84 * dpr);

  ctx.textAlign = "left";
  ctx.fillStyle = INK.silk;
  ctx.fillText(
    `${E.n} forecasts · Brier ${E.brier.toFixed(3)} · ${skillLine(E.skill, E.n)}`,
    x0, y0 + side + 48 * dpr
  );
  ctx.fillStyle = INK.amberDim;
  ctx.fillText(
    E.check_n >= SKILL_MIN_N
      ? `on ${E.check_n} unbiased check duels: ${skillLine(E.check_skill, E.check_n)} — this is the number to trust`
      : `check duels (picked at random) are the unbiased measure — ${E.check_n} of ${SKILL_MIN_N} so far`,
    x0, y0 + side + 66 * dpr
  );
  // Where the answers came from. Committing a hand edit after hearing it
  // against the original is a different act from ticking "my edit is better",
  // and the model has no way to know which it was told — so the two are
  // scored apart, and the split is drawn rather than left in the log. Silent
  // until there is something to compare: one stream is not a comparison.
  const streams = (E.by_provenance || []).filter((p) => p.n > 0);
  if (streams.length > 1) {
    // Right-aligned against the panel's own edge, on the headline's baseline:
    // the three lines under the plot are full sentences with no room for a
    // fourth, and the plot is a square in a wide panel — the whole right half
    // of that line is empty.
    ctx.fillStyle = INK.amberDim;
    ctx.textAlign = "right";
    ctx.fillText(
      streams
        .map((p) => `${PROVENANCE_NAME[p.provenance] || p.provenance} ${p.n}: ${skillPct(p.skill)}`)
        .join("  ·  "),
      w - 24 * dpr, y0 + side + 48 * dpr
    );
    ctx.textAlign = "left";
  }
}

/** Brier skill as a signed percentage — a negative skill is worse than a coin
 *  flip and has to look like it, not like a small positive number. */
function skillPct(s) {
  return `${s >= 0 ? "+" : "−"}${Math.abs(Math.round(s * 100))}%`;
}

// How a preference reached the log, in the words the app uses for it.
const PROVENANCE_NAME = {
  duel: "dealt duels",
  heard_edit: "edits you heard",
  self_report: "edits you asserted",
};

// Reliability is computed by the engine, which is the only place that has
// both the forecast and the *outcome*. There is deliberately no client-side
// approximation: the obvious one — bin by forecast, plot the share above 0.5 —
// scores the forecast against itself and draws a staircase no matter how
// calibrated the model is. Emptiness is decided in drawTaste (n >= 20).
function drawTrustTab(ctx, w, h, dpr) {
  drawTrustFromEngine(ctx, w, h, dpr, engineCalib);
}

function drawMapTab(ctx, w, h, dpr) {
  const map = views && views.map;
  const pts = map.points;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const pad = 34 * dpr;
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const sx = (v) => pad + ((v - x0) / Math.max(1e-9, x1 - x0)) * (w - 2 * pad);
  const sy = (v) => pad + ((v - y0) / Math.max(1e-9, y1 - y0)) * (h - 2 * pad);
  // Absolute glow, same logistic map as the bank bar — min–max across the
  // visible map made the least-liked dot always dark and the most-liked
  // always bright, which the legend's absolute ramp contradicted. Pre-fit,
  // every dot glows uniformly dim: no prediction, no gradient.
  const fitted = !!(views && views.styles);
  const un = fitted ? (u) => 1 / (1 + Math.exp(-u)) : () => 0.35;

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
      // Size carries the model's *uncertainty*: "I don't know this region"
      // is the most useful thing an interactive-ML view can say, and the
      // posterior spread was already being computed and discarded.
      const base = p.origin === "edited" ? 5.5 : p.origin === "refined" ? 4.8 : 4;
      const unsure = p.utility_std != null ? Math.min(1, p.utility_std) : 0;
      const r = (base + unsure * 3.5) * dpr;
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
      mapHits.push({ x: cx, y: cy, id: p.id, u01: fitted ? glow : null });
      if (p.id === mapCursorId) {
        // Keyboard cursor: dashed ring, distinct from the solid subject ring.
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
        ctx.strokeStyle = INK.amber;
        ctx.lineWidth = 1.2 * dpr;
        ctx.setLineDash([3 * dpr, 3 * dpr]);
        ctx.beginPath();
        ctx.arc(cx, cy, r + 5 * dpr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
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

  ctx.fillStyle = INK.amberDim;
  ctx.textAlign = "left";
  ctx.fillText(
    `axes = sound-space PCA · ${Math.round((map.explained[0] + map.explained[1]) * 100)}% of variance · ${pts.filter((p) => p.id != null).length} patches`,
    10 * dpr, h - 8 * dpr
  );
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
    ctx.fillStyle = INK.silk;
    ctx.textAlign = "left";
    ctx.fillText(`${styleName(s, s.k)} — claims ${Math.round(s.share * 100)}% of the bank`, 30 * dpr, y0 + 24 * dpr);

    const rows = [...s.theta].sort((a, b) => Math.abs(b.mean) - Math.abs(a.mean)).slice(0, 5);
    const maxAbs = Math.max(0.12, ...rows.map((r) => Math.abs(r.mean)));
    const cx = w * 0.6, usable = w * 0.3;
    rows.forEach((r, i) => {
      const y = y0 + (42 + i * 18) * dpr;
      if (y > y0 + blockH - 8 * dpr) return;
      ctx.fillStyle = INK.amberDim;
      ctx.textAlign = "right";
      ctx.fillText(niceName(r.name), cx - usable - 10 * dpr, y + 3 * dpr);
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
  if (styles.length === 0) {
    // Fitted, but every lens is idle — show the pre-state, not a void.
    $("taste-caption").textContent = EMPTY_CAPTIONS.dir;
    $("crt-empty").classList.remove("hidden");
    return renderEmptyState("dir");
  }
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

  ctx.strokeStyle = "rgba(255,180,84,0.28)";
  ctx.beginPath(); ctx.moveTo(cx, rowH * 0.4); ctx.lineTo(cx, h - rowH * 0.4); ctx.stroke();

  names.forEach((name, i) => {
    const y = rowH * (i + 1);
    ctx.fillStyle = INK.amberDim;
    ctx.textAlign = "right";
    ctx.fillText(niceName(name), cx - usable - 10 * dpr, y + 3 * dpr);
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
    document.querySelectorAll(".tab").forEach((t) => {
      t.classList.remove("active");
      t.setAttribute("aria-selected", "false");
    });
    tab.classList.add("active");
    tab.setAttribute("aria-selected", "true");
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

// The dots are clickable and the surface should say so: pointer cursor over a
// hit, plus a tooltip naming the patch.
let mapTipEl = null;

function hideMapTip() {
  if (mapTipEl) {
    mapTipEl.remove();
    mapTipEl = null;
  }
}

function mapHitAt(ev) {
  const canvas = $("taste-crt");
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const x = (ev.clientX - rect.left) * dpr;
  const y = (ev.clientY - rect.top) * dpr;
  let best = null;
  let bestD = 12 * dpr;
  for (const hit of mapHits) {
    const d = Math.hypot(hit.x - x, hit.y - y);
    if (d < bestD) { bestD = d; best = hit; }
  }
  return best;
}

$("taste-crt").addEventListener("pointermove", (ev) => {
  const canvas = $("taste-crt");
  // A finger has no hover: a tap fires one pointermove at the touch point and
  // then never a pointerleave, so the hover tooltip would paint itself over
  // the map and stay there for the rest of the session. The tap's own job —
  // open that patch on the bench — is the same thing the tooltip was
  // advertising, so touch skips straight to it.
  if (ev.pointerType !== "mouse") return hideMapTip();
  if (tasteTab !== "map" || mapHits.length === 0) {
    canvas.classList.remove("hit");
    return hideMapTip();
  }
  const best = mapHitAt(ev);
  canvas.classList.toggle("hit", !!best);
  if (!best) return hideMapTip();
  if (!mapTipEl) {
    mapTipEl = document.createElement("div");
    mapTipEl.className = "map-tip";
    document.body.appendChild(mapTipEl);
  }
  const r = rowOf(best.id);
  mapTipEl.innerHTML =
    `<div class="mt-name"></div><div class="mt-dim mono"></div><div class="mt-u"></div><div class="mt-dim">click to open on the bench</div>`;
  mapTipEl.children[0].textContent = r ? r.name : `#${best.id}`;
  mapTipEl.children[1].textContent = r ? r.sig || r.signature || "" : "";
  mapTipEl.children[2].textContent =
    best.u01 != null ? `would like: ${Math.round(best.u01 * 100)}%` : "no prediction yet";
  // Clamp to the viewport — unclamped, the tooltip clips at the right edge.
  mapTipEl.style.left = `${Math.min(ev.clientX + 14, window.innerWidth - 250)}px`;
  mapTipEl.style.top = `${Math.min(ev.clientY + 12, window.innerHeight - 90)}px`;
});
$("taste-crt").addEventListener("pointerleave", () => {
  $("taste-crt").classList.remove("hit");
  hideMapTip();
});

// Keyboard traversal of the map: arrows step the dashed cursor in x-order,
// Enter opens the patch on the bench.
let mapCursorId = null;
$("taste-crt").addEventListener("keydown", (e) => {
  if (tasteTab !== "map" || mapHits.length === 0) return;
  const sorted = [...mapHits].sort((p, q) => p.x - q.x);
  const i = sorted.findIndex((hh) => hh.id === mapCursorId);
  if (e.key === "Enter") {
    if (mapCursorId != null) {
      e.preventDefault();
      bankScrollTo = mapCursorId;
      openOnBench(mapCursorId);
      note(`${nameOf(mapCursorId)} selected — it's on the workbench and under your fingers`);
    }
    return;
  }
  let j = null;
  if (e.key === "ArrowRight" || e.key === "ArrowDown") j = Math.min(sorted.length - 1, i + 1);
  else if (e.key === "ArrowLeft" || e.key === "ArrowUp") j = i < 0 ? 0 : Math.max(0, i - 1);
  else if (e.key === "Home") j = 0;
  else if (e.key === "End") j = sorted.length - 1;
  if (j == null) return;
  e.preventDefault();
  mapCursorId = sorted[j].id;
  drawTaste();
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
    ctx.strokeStyle = INK.amber;
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
  if (lineage.length === 0) {
    // Don't keep telling the user to press a button they have already pressed.
    log.innerHTML =
      status.generation > 0
        ? `<span class="silk-dim">Generation ${status.generation} ran, but no proposal beat its parent — that happens, and it is the search working, not failing. More picks sharpen it; ⚡ evolve from a patch you like aims it.</span>`
        : '<span class="silk-dim">No generations yet — make a few picks, then press EVOLVE POOL, or ⚡ evolve a patch you like.</span>';
    return;
  }
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

// The warm start stays reachable after a skip, and the profile can start
// over — previously the only reset was clearing site data by hand.
$("warm-rerun-btn").onclick = () => openWarmStart();
$("taste-reset-btn").onclick = () => {
  alarm("Reset the taste profile? Every pick, star and generation is forgotten.", {
    label: "reset it",
    run: async () => {
      clearTimeout(saveTimer); // a pending autosave would rewrite the record
      await idbDel("state");
      for (const k of ["ricercar-warmed", "ricercar-warm-deferred", "ricercar-warm-reoffered", "ricercar-played", "ricercar-bench-tour"])
        localStorage.removeItem(k);
      location.reload();
    },
  });
  const keep = document.createElement("button");
  keep.className = "toast-undo";
  keep.textContent = "keep it";
  keep.onclick = () => alarm(null);
  $("alarm").appendChild(keep);
};

// ---------- patch share (single-patch files) ----------
$("patch-export-btn").onclick = () => {
  if (!wb.tree) return note("nothing on the bench to export");
  const name = wb.subjectId != null ? nameOf(wb.subjectId) : "patch";
  const body = { ricercar_patch: 1, name, tree: wb.tree };
  // The layout rides along (WS-4 §8), keyed by the same node identities the
  // tree itself now carries — so a patch you send someone arrives arranged the
  // way you arranged it. Purely additive: the field is absent when nothing has
  // been placed by hand, and an older build that has never heard of `layout`
  // ignores it and loads the tree exactly as before, which is why this is
  // still `ricercar_patch: 1`.
  // `ffPlaces`, not `ffStore`: a patch that inherited its layout from the one
  // it was bred from has that layout even if it has not been drawn in freeform
  // since. Nothing placed by hand at all means no `layout` key — a chain-mode
  // patch is shared as a patch, not as an arrangement.
  const store = ffPlaces();
  const pins = [];
  if (store && store.size) {
    for (const m of wb.rack?.modules || []) {
      const mid = midOf(m);
      const p = store.get(mid) ||
        // Not placed by hand, but on screen in the arrangement being shared —
        // the modules a generation of ⚡ added since, sitting in their offered
        // slots. The recipient should get the picture the sender is looking
        // at, not that picture minus everything the sender never dragged.
        (layoutMode === "freeform" && rackBoxes.get(m.key)
          ? { x: rackBoxes.get(m.key).x - RACK_OFF_X, y: rackBoxes.get(m.key).y - RACK_OFF_Y }
          : null);
      if (p) pins.push([mid, Math.round(p.x), Math.round(p.y)]);
    }
  }
  if (pins.length) body.layout = { grid: GRID, pos: pins };
  const payload = JSON.stringify(body, null, 1);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
  a.download = `${name.replace(/[^\w-]+/g, "_").slice(0, 32)}.ricercar.json`;
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
    // Held until the engine says which id the patch landed as — that id is the
    // key the layout has to be filed under, and it does not exist yet. Cleared
    // either way in `patch_imported`, so a refused import cannot leave a
    // layout waiting to be adopted by the *next* one.
    pendingLayout = Array.isArray(data.layout?.pos) ? data.layout.pos : null;
    send({ type: "import_patch", json: JSON.stringify(tree), name: data.name || "" });
  } catch (_) {
    pendingLayout = null;
    note("that file isn't a patch");
  }
};

// The rack sizes itself from `#rack-scroll`'s client box, so a build that
// happens before layout has settled (first paint, a view becoming visible,
// fonts swapping in) measures a stale container and renders under-scaled.
// One rAF is enough to let layout flush.
let refitPending = false;
function refitRack() {
  if (refitPending) return;
  refitPending = true;
  requestAnimationFrame(() => {
    refitPending = false;
    if (!knobDragging) renderRack();
  });
}
if (document.fonts && document.fonts.ready) document.fonts.ready.then(refitRack);

// ---------- boot ----------
// The wait is ~10 s of real work; rather than stall on a bar, draw the search
// happening. Each vetted candidate lands as a dot on the same field the taste
// map uses, so the longest-dwell surface in the product previews its central
// idea instead of hiding it.
let bootPct = 0;
const bootDots = [];
// The app is handed over at `playable` (~8 patches) and keeps filling behind
// the user, so "booted" and "filled" are now two different moments and both
// need tracking: the veil must lift exactly once, and the bank header has to
// keep saying how many patches are still on their way.
let booted = false;
let fillPool = 0;
let fillTarget = 0;

// Fade, don't cut — this is the surface the user has been staring at.
// Idempotent: `playable` normally lifts it and `filled` re-asserts, and a
// second fade would re-run the transition on an already-hidden element.
function dropBootVeil() {
  if (booted) return;
  booted = true;
  $("boot").classList.add("done");
  setTimeout(() => $("boot").classList.add("hidden"), 460);
}

// The bank keeps growing after the veil lifts. The count in the bank header is
// the honest place to say so — a toast would be long gone by the time the last
// patch lands, and the boot meter is behind a veil nobody can see any more.
// The head no longer counts anything: each chip now carries its own count, and
// this one always counted the *pool* whatever bank you were looking at — so it
// read "BANK 40" directly above "Nothing saved yet." It keeps only the thing
// no chip can say, which is that patches are still landing.
function renderFillHint() {
  const el = $("bank-count");
  if (!el) return;
  const arriving = Math.max(0, fillTarget - fillPool);
  el.textContent = arriving ? `+${arriving} arriving` : "";
  el.title = arriving ? `${arriving} more patches are still being rendered` : "";
}

function bootField(pool, target) {
  const canvas = $("boot-field");
  if (!canvas || target <= 1) return;
  const ctx = scopeCtx(canvas);
  const { width: w, height: h } = canvas;
  if (w === 0) return;
  const dpr = window.devicePixelRatio || 1;
  while (bootDots.length < pool) {
    // Deterministic-looking scatter from the index — no RNG, so a re-render
    // never reshuffles dots that have already landed.
    const i = bootDots.length;
    const a = i * 2.399963; // golden angle
    const rad = Math.sqrt((i + 0.5) / target);
    bootDots.push({ x: 0.5 + 0.44 * rad * Math.cos(a), y: 0.5 + 0.44 * rad * Math.sin(a) });
  }
  ctx.clearRect(0, 0, w, h);
  drawGraticule(ctx, w, h, "rgba(255,180,84,0.05)");
  for (let i = 0; i < bootDots.length; i++) {
    const d = bootDots[i];
    const age = Math.min(1, (bootDots.length - i) / 6);
    ctx.globalAlpha = 0.25 + 0.6 * age;
    ctx.fillStyle = INK.amber;
    ctx.shadowColor = INK.amber;
    ctx.shadowBlur = (1 - age) * 12 * dpr;
    ctx.beginPath();
    ctx.arc(d.x * w, d.y * h, 2.1 * dpr, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}

// ---------- first-run taste elicitation ----------
// Cold start is the model's hardest problem: the repo's own synthetic gates put
// θ recovery at hundreds of random duels. Picking 3 favourites out of 9 is one
// ~30 s interaction that yields 18 pairwise observations — worth far more per
// second of attention than the same time spent on A/B duels, and it means the
// model is already pointed somewhere before the user casts a single vote.
let warmRows = null;
const warmPicked = new Set();
let warmLoaded = null;

function openWarmStart() {
  send({ type: "presets" });
  warmPending = true;
}
let warmPending = false;

// Nine cards, drawn one per family, however big the library gets.
//
// This screen used to render a card for *every* preset and `warm-go` loaded
// every one of them — which was survivable at nine and is not at twenty-eight:
// a first-run screen you have to scroll, and 58% of a 48-slot pool spent
// before the user has expressed a single preference. Library size and grid
// size are now independent.
//
// Stratified rather than uniform on purpose. An unstratified sample of nine
// from a library that is deliberately unevenly weighted (five basses, three
// perc) keeps landing in the same corner, and a cold start taught from one
// corner is the exact bias this screen exists to remove. One per family first,
// then fill from what is left, so the first thirty seconds *span* the space.
function warmSample(rows) {
  const byCat = new Map();
  for (const r of rows) {
    if (!byCat.has(r.category)) byCat.set(r.category, []);
    byCat.get(r.category).push(r);
  }
  const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];
  const chosen = [];
  const taken = new Set();
  for (const [, xs] of byCat) {
    const r = pick(xs);
    chosen.push(r);
    taken.add(r.index);
  }
  const rest = rows.filter((r) => !taken.has(r.index)).sort(() => Math.random() - 0.5);
  while (chosen.length < 9 && rest.length) chosen.push(rest.pop());
  // Back into library order so the grid reads as a shelf, not a shuffle.
  return chosen.slice(0, 9).sort((a, b) => a.index - b.index);
}

function renderWarmStart(all) {
  const rows = warmSample(all);
  warmRows = rows;
  const grid = $("warm-grid");
  grid.innerHTML = "";
  rows.forEach((r) => {
    // The card and its ▶ are two different questions — "do you like this?"
    // and "what does it sound like?" — so they are two different buttons. The
    // ▶ used to be an aria-hidden span inside the pick button: it looked like
    // a transport, and pressing it cast a vote on a patch the user had never
    // heard. That is the exact opposite of what this screen is for, and the
    // card above it says "Play them" in so many words. A real button cannot
    // nest inside the pick button, so the pair share a positioned cell.
    const cell = document.createElement("div");
    cell.className = "warm-cell";
    const b = document.createElement("button");
    b.className = "warm-item";
    // The blurb, not the topology signature. `tri·cho·ladr` describes the
    // graph, which is the one thing this screen is not asking about.
    b.innerHTML = `<span class="wi-name">${esc(r.name)}</span><span class="wi-sig">${esc(r.blurb || r.sig)}</span>`;
    b.setAttribute("aria-pressed", "false");
    const pb = document.createElement("button");
    pb.className = "wi-play";
    pb.textContent = "▶";
    pb.title = `Hear ${r.name}`;
    pb.setAttribute("aria-label", `Hear ${r.name}`);
    pb.onclick = (ev) => {
      ev.stopPropagation();
      previewPreset(r, pb);
    };
    b.onclick = () => {
      if (warmPicked.has(r.index)) warmPicked.delete(r.index);
      else if (warmPicked.size < 3) warmPicked.add(r.index);
      b.classList.toggle("picked", warmPicked.has(r.index));
      b.setAttribute("aria-pressed", String(warmPicked.has(r.index)));
      $("warm-go").disabled = warmPicked.size !== 3;
      $("warm-go").textContent =
        warmPicked.size === 3 ? "teach it"
        : warmPicked.size === 0 ? "pick any three"
        : `${3 - warmPicked.size} more`;
    };
    cell.append(b, pb);
    grid.appendChild(cell);
  });
  $("warm-go").disabled = true;
  $("warm-go").textContent = "pick any three";
  $("warmstart").classList.remove("hidden");
}

// Hearing a preset means having it: the only way the engine can render one is
// to insert it, and `load_preset` returns the existing id when the identical
// patch is already in the bank, so this is idempotent with the load that
// "teach it" does at the end anyway. The cost of a preview is therefore one
// preset in your bank early — which is what the PRESETS button does on
// purpose, and strictly better than a screen that asks you to judge nine
// sounds you cannot hear.
const presetIds = new Map(); // preset index -> bank id
let warmPreview = null; // {index, btn} — the one preview in flight

function previewPreset(row, btn) {
  if (stopAudition()) return; // pressing ▶ again stops it
  const known = presetIds.get(row.index);
  if (known != null) return awaitRender(known, () => play(known, btn));
  if (warmPreview) return; // one load at a time; the engine is single-file
  btn.classList.add("loading");
  warmPreview = { index: row.index, btn };
  send({ type: "load_preset", index: row.index, preview: true });
}

function warmPreviewLoaded(id, evicted) {
  const req = warmPreview;
  warmPreview = null;
  if (!req) return;
  req.btn.classList.remove("loading");
  if (!id) return note("That preset wouldn't load.");
  presetIds.set(req.index, id);
  if (evicted && evicted.length) note(`Loaded to play it.${madeRoom(evicted)}`);
  if (bankFilter === "preset") renderBank(); // it can now say "in bank"
  awaitRender(id, () => play(id, req.btn));
}

function closeWarmStart(mark = true) {
  $("warmstart").classList.add("hidden");
  if (mark) localStorage.setItem("ricercar-warmed", "1");
}

$("warm-skip").onclick = () => {
  // Straight to the instrument. Stacking the help dialog behind this one made
  // the first thing a new user did be dismissing two modals in a row; the
  // keymap is one click away in ⋯ and the next-step chip says what to do.
  // A skip DEFERS the warm start rather than destroying it — it is the
  // highest-value-per-second elicitation in the product, so it is re-offered
  // once after a few duels and stays reachable from the ⋯ menu.
  closeWarmStart(false);
  localStorage.setItem("ricercar-warm-deferred", "1");
  localStorage.setItem("ricercar-helped", "1");
  note("Press a key to hear it. The ⋯ menu has the full keyboard map.");
};

$("warm-go").onclick = () => {
  if (warmPicked.size !== 3 || !warmRows) return;
  // Load every preset into the bank, then log each chosen ≻ each unchosen as a
  // duel. Same likelihood, same log format — no new inference path.
  warmLoaded = { want: warmRows.length, ids: new Map(), picked: new Set(warmPicked) };
  for (const r of warmRows) {
    send({
      type: "load_preset",
      index: r.index,
      warm: r.index,
      // The three the user picked are saved as they are inserted, so the six
      // they did not pick cannot evict them on the way in.
      pin: warmPicked.has(r.index),
    });
  }
  closeWarmStart();
  note("Loading those in and teaching the model what you picked…");
};

function warmPresetLoaded(index, id) {
  if (!warmLoaded || id <= 0) return;
  warmLoaded.ids.set(index, id);
  // The picks are saved by the worker as it inserts them (`load_preset`'s
  // `pin`), because `warm-go` pushes nine presets into a pool that is already
  // full and they evict each other on the way in. Doing it from here, one
  // message later, measured 1 of 3 surviving: the whole burst has already run
  // by the time the first reply comes back.
  if (warmLoaded.ids.size < warmLoaded.want) return;
  let n = 0;
  for (const chosen of warmLoaded.picked) {
    for (const [idx, id2] of warmLoaded.ids) {
      if (warmLoaded.picked.has(idx)) continue;
      const a = warmLoaded.ids.get(chosen);
      if (a == null) continue;
      send({ type: "record_duel", a, b: id2, choseA: true });
      n += 1;
    }
  }
  const first = warmLoaded.ids.get([...warmLoaded.picked][0]);
  warmLoaded = null;
  send({ type: "fit" });
  fitting = true;
  $("wm-r").classList.add("thinking");
  note(`${n} preferences learned from your three picks — the model starts out pointed at you. Your three are saved.`);
  if (first != null) openOnBench(first);
}

// ---------- overflow menu ----------
$("ovf-btn").onclick = () => {
  const menu = $("ovf-menu");
  const open = menu.classList.toggle("hidden");
  $("ovf-btn").setAttribute("aria-expanded", String(!open));
  if (!open) menu.querySelector(".ovf-item")?.focus();
};
$("ovf-menu").addEventListener("click", (e) => {
  if (e.target.closest("button, label")) {
    $("ovf-menu").classList.add("hidden");
    $("ovf-btn").setAttribute("aria-expanded", "false");
  }
});

// ---------- help overlay ----------
let helpReturnFocus = null;

function showHelp(on) {
  const el = $("help");
  const wasOpen = !el.classList.contains("hidden");
  el.classList.toggle("hidden", !on);
  if (on && !wasOpen) {
    // A modal that doesn't move focus is a modal a keyboard user cannot reach
    // or leave.
    helpReturnFocus = document.activeElement;
    $("help-close").focus();
  } else if (!on && wasOpen) {
    if (helpReturnFocus && helpReturnFocus.focus) helpReturnFocus.focus();
    helpReturnFocus = null;
  }
}
$("help-btn").onclick = () => showHelp(true);
$("help-open").onclick = () => showHelp(true);
$("help-close").onclick = () => {
  showHelp(false);
  localStorage.setItem("ricercar-helped", "1");
};
$("help").addEventListener("click", (e) => {
  if (e.target === $("help")) showHelp(false);
});
document.addEventListener("keydown", (e) => {
  // Same optional-chaining as the note-key guard: a keydown targeting the
  // document has no `closest`, and the throw stopped `?` opening help.
  if (e.key === "?" && !e.target?.closest?.("input")) showHelp(true);
  if (e.key === "Escape") showHelp(false);
});

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

// ---------- the render farm ----------
//
// Boot renders ~40 candidates, each a pure function of (term, phrase). This
// thread compiles the wasm binary once, spawns N stateless farm workers, and
// hands the engine worker one end of a MessageChannel per farm — then steps
// out. No nested workers (Safari only shipped those in 16.4, and the app's
// floor is 15), no SharedArrayBuffer, no COOP/COEP, no build change: each farm
// worker is an ordinary module worker with its own linear memory, which is
// also why the render determinism contract survives the move unchanged.
//
// Width: leave the UI thread and the AudioWorklet render thread a core each,
// cap at 6 (the marginal worker is memory bandwidth, not throughput), and cap
// harder on small-memory devices where N × ~15 MB is the binding constraint.
// Below 2 there is nothing to gain over the serial path, so take it.
function farmWidth() {
  const override =
    new URLSearchParams(location.search).get("farm") ??
    localStorage.getItem("ricercar-renderers");
  if (override != null && override !== "") {
    const n = Number(override);
    if (Number.isFinite(n)) return Math.max(0, Math.min(8, Math.floor(n)));
  }
  let n = Math.min(6, Math.max(0, (navigator.hardwareConcurrency || 2) - 2));
  if (navigator.deviceMemory && navigator.deviceMemory <= 4) n = Math.min(n, 2);
  return n < 2 ? 0 : n;
}

// Can this browser structured-clone a compiled module to a worker? Chrome 55 /
// Firefox 47 / Safari 11 can; where it throws, each farm fetches and compiles
// the binary itself — N × 2 MB and N compiles, still correct.
function canShareModule(mod) {
  const probe = new MessageChannel();
  try {
    probe.port1.postMessage(mod);
    return true;
  } catch (_) {
    return false;
  } finally {
    probe.port1.close();
    probe.port2.close();
  }
}

async function spawnFarm() {
  const n = farmWidth();
  if (n === 0) return { ports: [], module: null };

  let mod = null;
  try {
    mod = await WebAssembly.compileStreaming(fetch(`./pkg/ricercar_wasm_bg.wasm?v=${BUILD}`));
    if (!canShareModule(mod)) mod = null;
  } catch (err) {
    // No shared module: the workers fetch it themselves. Slower start, and
    // nothing else changes.
    console.warn("[ricercar] shared wasm module unavailable:", err);
    mod = null;
  }

  // Width 0 — the serial path — is a fully supported, gated configuration, so
  // *nothing* in here may escape: farm setup must never be the reason the app
  // fails to boot. The whole per-worker block is guarded, not just the
  // `new Worker`, because `new MessageChannel()` can throw and, more to the
  // point, `postMessage` can reject the structured clone of the compiled
  // module — `canShareModule` probes a MessagePort, and a Worker is a
  // different receiving agent, which is precisely where the engines that
  // restrict module cloning differ. Bailing returns `module: null` as well as
  // no ports, so the `init` send below cannot then hit the same clone.
  const ports = [];
  try {
    for (let k = 0; k < n; k++) {
      const w = new Worker(`./farm.js?v=${BUILD}`, { type: "module" });
      const ch = new MessageChannel();
      // A worker that dies is reported to the *engine*, which re-issues the
      // job it was holding by index. Main only carries the news.
      const index = k;
      w.onerror = (e) => {
        try { send({ type: "farm_lost", index, reason: String(e.message || e) }); } catch (_) {}
      };
      w.postMessage(
        {
          type: "boot",
          module: mod,
          url: `./pkg/ricercar_wasm_bg.wasm?v=${BUILD}`,
          glue: `./pkg/ricercar_wasm.js?v=${BUILD}`,
          port: ch.port2,
          build: BUILD,
        },
        [ch.port2]
      );
      farmWorkers.push(w);
      ports.push(ch.port1);
    }
  } catch (err) {
    console.warn("[ricercar] farm setup failed; filling serially:", err);
    for (const w of farmWorkers) {
      try { w.terminate(); } catch (_) {}
    }
    farmWorkers.length = 0;
    for (const p of ports) {
      try { p.close(); } catch (_) {}
    }
    return { ports: [], module: null };
  }
  return { ports, module: mod };
}

// ---------- boot ----------
buildPiano();
buildNodeBank();
// Before `bootLiveAudio`, so the bezel is already in the right corner at the
// right size on the first paint rather than jumping there when audio arrives.
scopeLoad();
scopePanelInit();
scopeApply();
renderNextStep(); // never leave the "what now?" control blank on first paint
renderTray();
bootLiveAudio();
bootMidi();
(async () => {
  // Spawn the render farm BEFORE the save read, so N wasm instantiations
  // overlap with IndexedDB and with the engine worker's own init instead of
  // queueing behind them.
  // Belt to `spawnFarm`'s braces: `send({type:"init"})` below must be reached
  // on every path, or the app sits on the boot veil forever with no engine.
  let farm = { ports: [], module: null };
  try {
    farm = await spawnFarm();
  } catch (err) {
    console.warn("[ricercar] farm unavailable; filling serially:", err);
  }
  let saved = await idbGet("state");
  if (!saved) {
    // One-time migration: this app used to be called EVOSYNTH — adopt any
    // save left behind under the old name so nobody loses their bank.
    saved = await new Promise((resolve) => {
      // Open *without* a version, and with no upgrade handler: this must
      // read a database that already exists and must never bring one into
      // being. Opening it with `open(name, 1)` + `onupgradeneeded` created an
      // empty phantom `evosynth` DB for every brand-new user, and left the
      // connection open so it could never afterwards be deleted.
      const req = indexedDB.open("evosynth");
      req.onupgradeneeded = () => {
        // Only fires if the DB did not exist; abort so it is not created.
        try { req.transaction.abort(); } catch (_) {}
        resolve(null);
      };
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("kv")) { db.close(); return resolve(null); }
        const tx = db.transaction("kv", "readonly").objectStore("kv").get("state");
        tx.onsuccess = () => { const v = tx.result || null; db.close(); resolve(v); };
        tx.onerror = () => { db.close(); resolve(null); };
      };
      req.onerror = () => resolve(null);
    });
    if (saved) idbPut("state", saved);
  }
  if (localStorage.getItem("evosynth-helped")) localStorage.setItem("ricercar-helped", "1");
  if (saved && saved.ui) {
    // Restore UI prefs before the engine finishes booting.
    for (const [id, s] of saved.ui.stars || []) starsById.set(id, s);
    for (const id of saved.ui.cut || []) cutIds.add(id);
    if (saved.ui.vol != null) {
      volume = saved.ui.vol;
      $("vol").value = volume;
      master.gain.value = volume;
      renderVolVal();
    }
    if (saved.ui.oct != null) { octShift = saved.ui.oct; buildPiano(); }
    if (saved.ui.perf) Object.assign(perf, saved.ui.perf);
    for (const id of saved.ui.born || []) lastBorn.add(id);
    restoreTray(saved.ui.held);
    restorePositions(saved.ui.positions);
    restoreLocks(saved.ui.locks);
    // `selectBank` re-applies the `active` class, which the markup hard-codes
    // onto the first chip — restoring the variable alone would leave the
    // highlight and the list disagreeing.
    if (saved.ui.bank) selectBank(saved.ui.bank);
    applyPerfUi();
  }
  send(
    {
      type: "init",
      seed: Math.floor(Math.random() * 2 ** 31),
      poolSize: 40,
      // Hand the app over at 8 vetted patches and let the other 32 land behind
      // it. A duel needs a bank wide enough to hold an interesting question, not
      // a full one — and 8 arrives in seconds where 40 takes half a minute.
      playableAt: 8,
      saved: saved && saved.session ? saved.session : null,
      // One end of each farm channel. Transferring them *into* the engine
      // worker is what keeps this thread out of the data path: from here on,
      // every ~565 KB audition buffer goes worker-to-worker and never touches
      // the thread drawing the UI.
      farmPorts: farm.ports,
      module: farm.module,
    },
    farm.ports
  );
})();

// Debug/testing hook (no UI surface).
// `note` rides along because the toast lane's guarantee — that nothing
// transient ever lands on PICK A / PICK B — is only testable by forcing a
// toast at a moment the app would not normally produce one.
window.__ric = { audioCtx, getLive: () => live, wb, tray, nonLiveAddrs, note };
