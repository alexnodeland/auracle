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
      if (m.json && m.json !== "null" && live) {
        live.setPatch(m.json, m.makeup);
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
    case "explained": {
      renderExplain(m.id, m.ex);
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
      views = m.views;
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
      const prevIds = new Set(((views && views.ranked) || []).map((r) => r.id));
      views = m.views;
      const nowIds = new Set(((views && views.ranked) || []).map((r) => r.id));
      const evicted = [...prevIds].filter((id) => !nowIds.has(id) && !cutIds.has(id));
      const evictedStarred = evicted.filter((id) => (starsById.get(id) || 0) > 0);
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
        const made = evicted.length
          ? ` ${evicted.length} lowest-predicted made room.`
          : "";
        note(`Gen ${m.status.generation}: ${m.born.length} new patch${m.born.length > 1 ? "es" : ""} in the bank.${made}`);
      } else {
        note(`Generation ${m.status.generation} bred.`);
      }
      if (evictedStarred.length > 0) {
        alarm(
          `Breeding replaced ${evictedStarred.length} starred patch${evictedStarred.length > 1 ? "es" : ""} — stars don't protect from eviction yet. Export patches you must keep.`,
          { label: "ok", run: () => alarm(null) }
        );
      }
      break;
    }
    case "bench": {
      wb.rack = m.rack;
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
        wb.locks = new Set();
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
      alarm(
        wb.vetOk
          ? null
          : "Muted — this setting can run away (self-oscillation or runaway feedback). Turn the last knob back, or undo.",
        wb.vetOk ? null : { label: "undo", run: doUndo }
      );
      if (!knobDragging) renderRack();
      renderBank();
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
      $("wm-r").classList.remove("thinking");
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
      if (warmPending) { warmPending = false; renderWarmStart(m.rows); }
      else renderPresetsPop();
      break;
    }
    case "preset_loaded": {
      views = m.views;
      applyStatus(m.status);
      refreshInstruments();
      if (m.warm !== undefined) {
        warmPresetLoaded(m.warm, m.id);
        scheduleSave();
        break;
      }
      if (m.id > 0) {
        openOnBench(m.id);
        note(`Preset loaded as ${nameOf(m.id)}`);
        scheduleSave();
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

function note(text, opts = {}) {
  const holder = $("toasts");
  const el = document.createElement("div");
  el.className = `toast${opts.kind ? " " + opts.kind : ""}`;
  const msg = document.createElement("span");
  msg.textContent = text;
  el.appendChild(msg);
  if (opts.undo) {
    const b = document.createElement("button");
    b.className = "toast-undo";
    b.textContent = opts.undoLabel || "undo";
    b.onclick = () => {
      opts.undo();
      el.remove();
    };
    el.appendChild(b);
  }
  holder.appendChild(el);
  while (holder.children.length > MAX_TOASTS) holder.firstChild.remove();
  // Must not outlive the action it can still cancel (see the cut handler).
  const ttl = opts.undo ? UNDO_WINDOW_MS : 4200;
  setTimeout(() => {
    // Retire the *action* on the window boundary, not when the animation
    // finishes — the 300 ms fade kept a clickable undo on screen past the
    // moment its commit had already fired.
    const b = el.querySelector(".toast-undo");
    if (b) { b.disabled = true; b.style.pointerEvents = "none"; }
    el.classList.add("out");
    setTimeout(() => el.remove(), 300);
  }, ttl);
  return el;
}

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
wireArrowNav($("presets-pop"), ".pp-item", { vertical: true });

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

// ---------- live instrument ----------
async function bootLiveAudio() {
  const { initLiveAudio } = await import(`./live-audio.js?v=${BUILD}`);
  live = await initLiveAudio(audioCtx, BUILD, master);
  live.onMessage((m) => {
    (window.__ricLog = window.__ricLog || []).push(m);
    if (m.type === "patch_error") note(`live patch failed to compile: ${m.error}`);
    if (m.type === "param_miss") nonLiveAddrs.add(m.addr);
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
  const lo = PIANO_LO + 12 * octShift;
  const hi = PIANO_HI + 12 * octShift;
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
    if (!restoreInFlight) e.shiftKey ? doRedo() : doUndo();
    return;
  }
  if (e.key === "Escape") {
    // One dismissal law for the keyboard too: Escape closes whatever floats,
    // and hands focus back to the control that opened it.
    if (!$("ovf-menu").classList.contains("hidden")) {
      $("ovf-menu").classList.add("hidden");
      $("ovf-btn").setAttribute("aria-expanded", "false");
      $("ovf-btn").focus();
    }
    if (!$("presets-pop").classList.contains("hidden")) {
      $("presets-pop").classList.add("hidden");
      $("presets-btn").focus();
    }
    $("ctx-menu").classList.add("hidden");
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
  if (k === " ") { e.preventDefault(); return toggleAudition(); }
  if (k === "[") return stepBank(-1);
  if (k === "]") return stepBank(1);
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
const perf = { arp: false, arpMode: 0, arpDiv: 2, bpm: 120, uni: false, glide: 0, arpGate: 0.5, arpOct: 1, arpSwing: 0 };

function sendArp() {
  if (live) live.arp(perf.arp, perf.arpMode, perf.arpDiv, perf.bpm, perf.arpGate, perf.arpOct, perf.arpSwing);
  $("arp-btn").classList.toggle("lit", perf.arp);
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
$("arp-gate").oninput = (e) => { perf.arpGate = Number(e.target.value); renderArpVals(); sendArp(); scheduleSave(); };
$("arp-swing").oninput = (e) => { perf.arpSwing = Number(e.target.value); renderArpVals(); sendArp(); scheduleSave(); };
$("arp-oct").onchange = (e) => { perf.arpOct = Number(e.target.value); sendArp(); scheduleSave(); };
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
    `${nameOf(id)}<span class="dn-id">#${id}</span><span class="dn-sig mono">${sigOf(id)}</span>`;
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

// Why does the model like this? Utility is linear *within* a style lens, so the
// per-feature contributions are exact — no SHAP, no surrogate, no sampling.
function renderExplain(id, ex) {
  const holder = $("explain");
  if (!holder) return;
  if (!ex || !ex.contributions || ex.contributions.length === 0) {
    holder.classList.add("hidden");
    return;
  }
  holder.classList.remove("hidden");
  const top = ex.contributions.slice(0, 3);
  const parts = top.map((c) => {
    const nice = niceName(c.name);
    const sign = c.contribution >= 0 ? "+" : "−";
    return `<b class="${c.contribution >= 0 ? "up" : "down"}">${nice}</b> ${sign}${Math.abs(c.contribution).toFixed(2)}`;
  });
  holder.innerHTML =
    `<span class="ex-why">why:</span> ${parts.join(" · ")} ` +
    `<span class="ex-lens">under your <b>${ex.style_name || `style ${ex.style + 1}`}</b> lens</span>`;
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

function renderBank() {
  const list = $("bank-list");
  const ranked = (views && views.ranked) || [];
  let rows = ranked.filter((r) => !cutIds.has(r.id));
  renderFillHint(); // owns the header count; it also carries "N arriving"
  // Provenance filter: where your saves, the newest generation, the presets
  // and your edits each live.
  if (bankFilter === "starred") rows = rows.filter((r) => (starsById.get(r.id) || 0) > 0);
  else if (bankFilter === "gen") rows = rows.filter((r) => lastBorn.has(r.id));
  else if (bankFilter === "preset") rows = rows.filter((r) => r.origin === "preset");
  else if (bankFilter === "edited") rows = rows.filter((r) => r.origin === "edited");
  bankRows = rows; // assigned before ANY return: [ ] and 1–5 step THIS list
  list.innerHTML = "";
  if (rows.length === 0) {
    const msg = {
      starred: "No saves yet — star a patch to keep track of it. (Stars don't yet protect it from eviction; export what you must keep.)",
      gen: "Nothing bred this session yet — press EVOLVE POOL, or ⚡ evolve a patch you like.",
      preset: "No presets loaded — the PRESETS button seeds the bank with hand-made patches.",
      edited: "No committed edits yet — turn knobs on the bench, then COMMIT.",
      all: "Nothing here yet.",
    }[bankFilter] || "Nothing here yet.";
    list.innerHTML = `<div class="bench-empty">${msg}</div>`;
    return;
  }
  // Absolute scale, not min–max across the visible bank: the old
  // normalisation made the worst patch always read 0% and the best always
  // 100%, so the widget could never say "it likes none of these". The
  // logistic of the posterior mean is a fixed, monotone map.
  const fitted = !!(views && views.styles);
  const sq = (u) => 1 / (1 + Math.exp(-u));
  const sortMode = $("bank-sort") ? $("bank-sort").value : "rank";
  if (sortMode === "number") rows.sort((x, y) => x.id - y.id);
  else if (sortMode === "unsure") rows.sort((x, y) => (y.std || 0) - (x.std || 0));
  else if (sortMode === "disagree") {
    const d = (r) => {
      const s = starsById.get(r.id) || 0;
      return s === 0 ? -1 : Math.abs(sq(r.mean) * 5 - s);
    };
    rows.sort((x, y) => d(y) - d(x));
  }
  const ORIGIN_GLYPH = { prior: "◇", refined: "⚡", edited: "✎", preset: "▤" };
  const ORIGIN_TITLE = {
    prior: "◇ sampled fresh from the grammar",
    refined: "⚡ bred by evolution toward your taste",
    edited: "✎ committed from your bench edits",
    preset: "▤ hand-made preset",
  };
  for (const r of rows) {
    const el = document.createElement("div");
    el.className = "bank-item" + (r.id === wb.subjectId ? " live" : "");
    const frac = fitted ? sq(r.mean) : 0;
    const lo = fitted ? sq(r.mean - (r.std || 0)) : 0;
    const hi = fitted ? sq(r.mean + (r.std || 0)) : 0;
    const stars = starsById.get(r.id) || 0;
    const sig = r.sig || r.signature || "";
    el.setAttribute("role", "option");
    el.setAttribute("aria-selected", String(r.id === wb.subjectId));
    // The list is one tab stop. Without pulling the rows *and their buttons*
    // out of the tab order, the ARIA says listbox while the tab order says
    // 280 individually-focusable buttons — and the rack sits behind all of
    // them.
    el.tabIndex = -1;
    el.setAttribute("aria-label", `${r.name}, patch ${r.id}${sig ? `, ${sig}` : ""}`);
    // Two lines: what it is, then what the model thinks of it. The prediction
    // bar is the product's whole thesis, so it gets its own row and a label —
    // it used to be a 60×4px sliver next to five stars.
    el.innerHTML = `
      <div class="bi-top">
        <span class="bi-origin ${r.origin}" title="${ORIGIN_TITLE[r.origin] || r.origin}">${ORIGIN_GLYPH[r.origin] || ""}</span>
        <span class="bi-name ${r.named ? "custom" : ""}" title="${sig ? `${sig} — ` : ""}double-click to rename">${r.name}</span>
        <span class="bi-id">#${r.id}</span>
      </div>
      ${sig ? `<div class="bi-sig mono">${sig}</div>` : ""}
      <div class="bi-row">
        <button class="bi-hear" title="Audition sample" aria-label="Audition ${r.name}">▶</button>
        <span class="stars" role="group" aria-label="Rate ${r.name} — press 1 to 5 on the highlighted row">
        ${[1, 2, 3, 4, 5]
          .map((s) => `<button class="star ${stars >= s ? "lit" : ""}" data-s="${s}" aria-pressed="${stars >= s}" aria-label="${s} star${s > 1 ? "s" : ""}">★</button>`)
          .join("")}
        </span>
        <span class="bi-u${fitted ? "" : " nofit"}" title="${fitted ? `How much the model thinks you'd like this — the band is how sure it is` : "No prediction yet — teach it with a few picks"}">${fitted ? `<i style="width:${Math.round(frac * 100)}%"></i><b style="left:${Math.round(lo * 100)}%;width:${Math.max(1, Math.round((hi - lo) * 100))}%"></b>` : ""}</span>
        ${fitted ? `<span class="bi-pct mono" title="Predicted appeal">${Math.round(frac * 100)}%</span>` : ""}
        <button class="bi-kill" title="Cut: teach the model you don't want this" aria-label="Cut ${r.name}">cut</button>
      </div>`;
    el.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      openOnBench(r.id);
      showView("play");
    });
    el.querySelector(".bi-hear").onclick = () => awaitRender(r.id, () => play(r.id));
    el.querySelectorAll(".star").forEach((btn) => {
      btn.onclick = () => {
        starsById.set(r.id, Number(btn.dataset.s));
        send({ type: "record_stars", id: r.id, rating: Number(btn.dataset.s) });
        renderBank();
      };
    });
    el.querySelector(".bi-kill").onclick = () => {
      // Undo, not confirm. A confirm dialog trains people to click through it;
      // an undo window costs nothing and actually protects the work. Cutting
      // used to remove a patch silently, irreversibly, with no message at all.
      //
      // The observation is *held* for the length of the undo window rather
      // than logged and compensated — a taste log that contains "killed it,
      // then kept it" for the same patch is a log of the user's mouse, not of
      // their taste.
      cutIds.add(r.id);
      renderBank();
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
        },
      });
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
    el.querySelectorAll("button").forEach((b) => { b.tabIndex = -1; });
    list.appendChild(el);
  }
  if (bankScrollTo != null) {
    const target = list.querySelector(".bank-item.live");
    if (target) target.scrollIntoView({ block: "nearest", behavior: "smooth" });
    bankScrollTo = null;
  }
}

// The bank is one tab stop, not 280. Before this, reaching the rack from the
// menubar took ~287 Tab presses through unlabelled star buttons.
$("bank-sort").onchange = () => renderBank();

let bankFilter = "all";
let bankRows = []; // the filtered, sorted rows the rail currently shows
const lastBorn = new Set(); // ids born in the latest bred generation
document.querySelectorAll(".bank-filters .bf").forEach((b) => {
  b.setAttribute("aria-pressed", String(b.classList.contains("active")));
  b.onclick = () => {
    bankFilter = b.dataset.f;
    document.querySelectorAll(".bank-filters .bf").forEach((x) => {
      x.classList.toggle("active", x === b);
      x.setAttribute("aria-pressed", String(x === b));
    });
    renderBank();
  };
});

$("bank-list").addEventListener("keydown", (e) => {
  const rows = [...$("bank-list").querySelectorAll(".bank-item")];
  if (rows.length === 0) return;
  const cur = rows.findIndex((r) => r.classList.contains("kbd"));
  const move = (d) => {
    const next = Math.max(0, Math.min(rows.length - 1, (cur < 0 ? 0 : cur) + d));
    rows.forEach((r) => r.classList.remove("kbd"));
    rows[next].classList.add("kbd");
    rows[next].scrollIntoView({ block: "nearest" });
  };
  if (e.key === "ArrowDown") { e.preventDefault(); move(cur < 0 ? 0 : 1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
  else if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    const row = rows[cur < 0 ? 0 : cur];
    if (row) row.click();
  } else if (/^[1-5]$/.test(e.key)) {
    // Rate the highlighted row from the keyboard — the stars' whole
    // keyboard path.
    e.preventDefault();
    e.stopPropagation(); // digit keys are evolve-view shortcuts elsewhere
    const i = cur < 0 ? 0 : cur;
    const target = bankRows[i];
    if (target) {
      starsById.set(target.id, Number(e.key));
      send({ type: "record_stars", id: target.id, rating: Number(e.key) });
      renderBank();
    }
  }
});

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
  pop.innerHTML =
    `<div class="pp-head">presets — load one to hear it</div>` +
    presetRows
      .map(
        (r) =>
          `<button class="pp-item" data-i="${r.index}"><span class="pp-name">${r.name}</span><span class="pp-sig" title="topology signature — the modules in its chain">${r.sig}</span></button>`
      )
      .join("");
  pop.querySelectorAll(".pp-item").forEach((btn) => {
    btn.onclick = () => {
      pop.classList.add("hidden");
      $("presets-btn").focus();
      send({ type: "load_preset", index: Number(btn.dataset.i) });
    };
  });
  pop.classList.remove("hidden");
  pop.querySelector(".pp-item")?.focus();
}

document.addEventListener("click", (e) => {
  if (!e.target.closest(".presets-pop") && !e.target.closest("#presets-btn")) {
    $("presets-pop").classList.add("hidden");
  }
  if (!e.target.closest(".ctx-menu") && !e.target.closest(".mod-menu-btn")) {
    $("ctx-menu").classList.add("hidden");
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
  send({ type: "edit_begin", id });
  send({ type: "explain", id });
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
// Sized around the rack type tokens in style.css: the plate has to fit a
// 10px knob label and a 9px unit readout at zoom 1, not just at zoom 2.
const MOD_W = 168;
const COL_W = 196;
const KNOB_R = 15;
const KNOBS_PER_ROW = 2;

// Row pitch has to clear the knob's tick ring plus its label and its unit
// readout — the readout grew from "0.41" to "24 ms".
const KNOB_ROW = 64;

function moduleHeight(mod) {
  const rows = Math.max(1, Math.ceil(mod.knobs.length / KNOBS_PER_ROW));
  return 36 + rows * KNOB_ROW;
}

function knobPos(mod, i) {
  const row = Math.floor(i / KNOBS_PER_ROW);
  const inRow = mod.knobs.length - row * KNOBS_PER_ROW >= KNOBS_PER_ROW
    ? KNOBS_PER_ROW
    : mod.knobs.length - row * KNOBS_PER_ROW;
  const col = i % KNOBS_PER_ROW;
  const x = (MOD_W / (inRow + 1)) * (col + 1);
  const y = 50 + row * KNOB_ROW;
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
  if (!hasRack) { svg.innerHTML = ""; return; }

  buildRack(svg, wb.rack, {
    interactive: true,
    locks: wb.locks,
    minW: $("rack-scroll").clientWidth - 4,
    minH: $("rack-scroll").clientHeight - 4,
  });

  // One roving tab stop for the whole rack, so Tab lands on a control instead
  // of skipping the patch editor entirely.
  const first = $("rack-svg").querySelector("[data-addr]");
  if (first) first.setAttribute("tabindex", "0");

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
  const { interactive = false, locks = new Set(), minW = 0, minH = 0, fit = false } = opts || {};
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
    <filter id="plateShadow" x="-30%" y="-30%" width="180%" height="190%">
      <feDropShadow dx="1" dy="3" stdDeviation="4" flood-color="#000" flood-opacity="0.55"/>
    </filter>
    <g id="screw">
      <circle r="3.1" fill="url(#jackNut)"/>
      <path d="M -2 0.6 L 2 -0.6" stroke="#07080a" stroke-width="0.9" stroke-linecap="round"/>
    </g>`;
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
  // Fill the frame. The rack used to stretch its SVG to the container while
  // laying content out at a fixed pitch from x=15, so a two-module patch sat
  // in the top-left corner of a 1440×690 canvas — 5% ink, and the hero of the
  // product was the emptiest thing on screen. Zooming the viewBox scales the
  // whole panel, so knobs and 8px labels grow with it. Capped at 2.2× so a
  // nine-module chain still lays out at 1×.
  const zoom = fit
    ? 1
    : Math.min(2.2, Math.max(1, Math.min(svgW / natW, svgH / natH)));
  const viewW = svgW / zoom;
  const viewH = svgH / zoom;
  if (fit) {
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.setAttribute("viewBox", `0 0 ${natW} ${natH}`);
  } else {
    svg.setAttribute("width", svgW);
    svg.setAttribute("height", svgH);
    svg.setAttribute("viewBox", `0 0 ${viewW} ${viewH}`);
  }
  const layoutH = fit ? natH : viewH;
  // ...and centre horizontally, which it never did (vertical always was).
  const xOff = fit ? 15 : Math.max(15, (viewW - natW) / 2 + 15);
  for (const [cx, mods] of byCol) {
    const total = mods.reduce((s, m) => s + moduleHeight(m) + 16, -16);
    let y = (layoutH - total) / 2;
    for (const m of mods) {
      const h = moduleHeight(m);
      pos.set(m.key, { x: xOff + cx * COL_W, y, w: MOD_W, h });
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
      // Sag proportional to span. A flat `max(24, span/2)` put control point 1
      // *past* control point 2 whenever the span was under 48px — which it is
      // between adjacent columns — so short runs kinked into a V instead of
      // hanging. A constant sag was also 40% of a short span and 4% of a long
      // one, so cables never read as the same kind of object.
      const span = Math.max(1, x2 - x1);
      const dx = Math.min(span * 0.42, 90);
      const sag = Math.min(span * 0.22, 46) + Math.abs(y2 - y1) * 0.06;
      d = `M ${x1} ${y1} C ${x1 + dx} ${y1 + sag}, ${x2 - dx} ${y2 + sag}, ${x2} ${y2}`;
    }
    const glowEl = svgEl("path", { d }, `wire ${w.kind}-glow`);
    const wireEl = svgEl("path", { d }, `wire ${w.kind}`);
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
      for (const el of [glowEl, wireEl]) {
        el.classList.add("pulse");
        el.style.animationDuration = `${dur.toFixed(2)}s`;
      }
    }
    wireLayer.appendChild(glowEl);
    wireLayer.appendChild(wireEl);
  }

  // Silkscreen never overruns its knob. Abbreviating case by case is whack-a-
  // mole — it fixed `resonance`/`mod depth` and left `mode`/`cutoff` colliding
  // — so any label still wider than its pitch is condensed to fit. SVG
  // `textLength` + `spacingAndGlyphs` squeezes tracking first and glyphs only
  // as far as it must, which is exactly how a real panel handles a long name.
  const fitLabels = () => {
    for (const t of svg.querySelectorAll(".knob-label, .mod-title")) {
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
    const g = svgEl("g", { transform: `translate(${p.x},${p.y})`, "data-kind": m.kind });
    const plateCls = `mod-plate${m.is_mod ? " modside" : ""}${isModuleLockedIn(m) ? " locked" : ""}`;
    const plate = svgEl("rect", { width: p.w, height: p.h, rx: 5 }, plateCls);
    plate.setAttribute("filter", "url(#plateShadow)");
    g.appendChild(plate);
    // Faceplate material: a lit top edge and a shaded bottom edge give the
    // plate thickness, and four screws say it is bolted to a rail. Without
    // these it renders as a rounded div and the rack reads as a wiring
    // diagram rather than an instrument you could put your hands on.
    g.appendChild(svgEl("rect", { x: 1, y: 0.5, width: p.w - 2, height: 1, rx: 0.5 }, "plate-lit"));
    g.appendChild(svgEl("rect", { x: 1, y: p.h - 1.5, width: p.w - 2, height: 1, rx: 0.5 }, "plate-shade"));
    for (const [sx, sy] of [[7, 7], [p.w - 7, 7], [7, p.h - 7], [p.w - 7, p.h - 7]]) {
      const use = svgEl("use", { x: sx, y: sy }, "plate-screw");
      use.setAttribute("href", "#screw");
      g.appendChild(use);
    }
    const title = svgEl("text", { x: 14, y: 18 }, `mod-title${m.is_mod ? " modside" : ""}`);
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
      // A real jack: knurled nut, dark bore, and a specular arc at 315°.
      // Cables then terminate *in* something instead of on a flat dot.
      jg.appendChild(svgEl("circle", { r: 6.5 }, "j-nut"));
      jg.appendChild(svgEl("circle", { r: 3.4 }, "j-bore"));
      jg.appendChild(svgEl("path", { d: "M -4.4 -3.2 A 5.4 5.4 0 0 1 1.2 -5.3" }, "j-spec"));
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
        if (rack.wires.some((w) => w.kind === "mod" && w.to === m.key)) {
          j.classList.add("pulse");
        }
        if (interactive) {
          j.addEventListener("pointerdown", (ev) => {
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
    m.knobs.forEach((k, i) => {
      const { x, y } = knobPos(m, i);
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
              `knob-arc${m.is_mod ? " modside" : ""}`)
          );
        }
        const body = svgEl("circle", { r: KNOB_R }, "knob-body");
        if (interactive) {
          const tt = svgEl("title", {});
          tt.textContent = `${k.label}: ${knobUnit(k.addr, k.value, m.kind, variant)} — drag up/down`;
          body.appendChild(tt);
        }
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
        if (interactive) attachKnobDrag(body, m, k);
      } else {
        const bw = 62;
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
          locked ? wb.locks.delete(k.addr) : wb.locks.add(k.addr);
          renderRack();
        });
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
        Math.max(24, MOD_W / (Math.min(KNOBS_PER_ROW, m.knobs.length) + 1) - 6)
      );
      kg.appendChild(lbl);
      if (k.kind.t === "continuous") {
        const val = svgEl("text", { y: KNOB_R + 25 }, "knob-value");
        val.textContent = knobUnit(k.addr, k.value, m.kind, variant);
        kg.appendChild(val);
      }
      g.appendChild(kg);
    });
    svg.appendChild(g);
  }

  // Must run after insertion — `getBBox` needs a laid-out element.
  fitLabels();
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

// Faceplate silkscreen. Two knobs share a `MOD_W / 3` pitch (~56 user units),
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
};

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
  if (valText) valText.textContent = knobUnit(knob.addr, v, kind, variant);
  kg.setAttribute("aria-valuenow", v.toFixed(3));
  kg.setAttribute("aria-valuetext", knobUnit(knob.addr, v, kind, variant));
}

function attachKnobDrag(el, mod, knob) {
  el.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    el.setPointerCapture(ev.pointerId);
    pushUndo(); // one undo step per knob gesture
    knobDragging = true;
    const startY = ev.clientY;
    const startV = knob.value;
    const kg = el.parentNode;
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
      renderRack();
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    // A cancelled touch used to leave knobDragging latched true, which froze
    // every subsequent rack repaint.
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

function focusRackControl(i) {
  const els = rackControls();
  if (els.length === 0) return;
  const el = els[Math.max(0, Math.min(els.length - 1, i))];
  els.forEach((e) => e.setAttribute("tabindex", e === el ? "0" : "-1"));
  el.focus();
}

function knobByAddr(addr) {
  if (!wb.rack) return null;
  for (const m of wb.rack.modules) {
    const k = m.knobs.find((x) => x.addr === addr);
    if (k) return k;
  }
  return null;
}

$("rack-svg").addEventListener("keydown", (e) => {
  const kg = e.target.closest?.("[data-addr]");
  if (!kg) return;
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
    wb.locks.has(knob.addr) ? wb.locks.delete(knob.addr) : wb.locks.add(knob.addr);
    renderRack();
    focusRackControl(i);
  }
});

function startEvolveFrom(id) {
  $("rack-evolve").disabled = true;
  $("wm-r").classList.add("thinking");
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

// The head node's own parameters, as a readable strip — the staged module
// shows what it actually is, not just a name tag.
function fragParamStrip(frag) {
  const tag = nodeTag(frag);
  const body = frag[tag] || {};
  const parts = [];
  let chain = 0;
  for (const [k, v] of Object.entries(body)) {
    if (v && typeof v === "object") { chain += subtreeSize(v); continue; }
    if (v === "None") continue;
    if (typeof v === "number") {
      parts.push(`${k} ${v >= 1 || v <= -1 || Number.isInteger(v) ? v : `${Math.round(v * 100)}%`}`);
    } else {
      parts.push(`${k} ${String(v).toLowerCase()}`);
    }
  }
  if (chain > 1) parts.push(`+${chain} in chain`);
  return parts.join(" · ");
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
    el.innerHTML = `
      <div class="ti-head">
        <span class="t-jack" title="Drag onto a ${t.isMod ? "mod ○" : "in ○"} jack"></span>
        <span class="ti-name">${t.label}</span>
        <button class="t-x" title="Discard">✕</button>
      </div>
      <div class="ti-params mono">${fragParamStrip(t.frag) || "—"}</div>`;
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
    const shut = nb.classList.contains("collapsed");
    const btn = $("nb-collapse");
    btn.textContent = shut ? "◂" : "▸";
    // The glyph used to flip while the tooltip permanently read "Collapse".
    btn.title = shut ? "Show the node bank" : "Collapse the node bank";
    btn.setAttribute("aria-expanded", String(!shut));
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
  // Same span-proportional law as the rack's own cables, and *no floor* — a
  // flat minimum is precisely what puts control point 1 past control point 2
  // on a short drag. At span 35 a floor of 24 gives cp1 = x1+24 and
  // cp2 = x1+11, i.e. crossed, which kinks the cable instead of hanging it.
  const dx = Math.min(Math.abs(x2 - x1) * 0.42, 90);
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

// ---------- live scope ----------
// The instrument had no visual pulse at all: no rAF loop and no analyser
// anywhere, so playing a note changed one key's background colour and nothing
// else. This is the trace that makes the rack look powered on. It runs only
// while something is sounding, so idling costs nothing.
let scopeRaf = null;
let scopeBuf = null;
let scopeQuiet = 0;

function scopeShouldRun() {
  return live && live.analyser && (heldNotes.size > 0 || scopeQuiet < 90);
}

function startScope() {
  if (scopeRaf != null || !live || !live.analyser) return;
  scopeQuiet = 0;
  const draw = () => {
    const canvas = $("live-scope");
    const on = currentView === "play" && wb.rack;
    if (!on) {
      scopeRaf = null;
      canvas.style.opacity = "0";
      return;
    }
    const an = live.analyser;
    if (!scopeBuf || scopeBuf.length !== an.fftSize) scopeBuf = new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(scopeBuf);
    let peak = 0;
    for (let i = 0; i < scopeBuf.length; i++) {
      const a = Math.abs(scopeBuf[i]);
      if (a > peak) peak = a;
    }
    if (heldNotes.size > 0 || peak > 1e-4) scopeQuiet = 0;
    else scopeQuiet += 1;

    const ctx = scopeCtx(canvas);
    const { width: w, height: h } = canvas;
    ctx.clearRect(0, 0, w, h);
    canvas.style.opacity = peak > 1e-4 ? "1" : "0";
    if (peak > 1e-4) {
      const dpr = window.devicePixelRatio || 1;
      const mid = h / 2;
      // Trigger on the first rising zero crossing so the trace stands still
      // instead of skating sideways.
      let start = 0;
      for (let i = 1; i < scopeBuf.length / 2; i++) {
        if (scopeBuf[i - 1] <= 0 && scopeBuf[i] > 0) { start = i; break; }
      }
      const n = Math.floor(scopeBuf.length / 2);
      ctx.strokeStyle = INK.green;
      ctx.lineWidth = 1.5 * dpr;
      ctx.shadowColor = "rgba(142,240,177,0.75)";
      ctx.shadowBlur = 8 * dpr;
      ctx.beginPath();
      for (let x = 0; x < w; x++) {
        const s = scopeBuf[start + Math.floor((x / w) * n)] || 0;
        const y = mid - s * mid * 0.86;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    if (scopeShouldRun()) scopeRaf = requestAnimationFrame(draw);
    else { scopeRaf = null; canvas.style.opacity = "0"; }
  };
  scopeRaf = requestAnimationFrame(draw);
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
  n_vco: "VCOs", n_supersaw: "supersaws", n_noise: "noise srcs", n_mix: "mixers",
  n_filter: "filters", n_fold: "wavefolders", n_delay: "delays", n_chorus: "choruses",
  n_reverb: "reverbs", n_rand: "S&H mods",
  n_lfo: "LFO mods", n_env: "env mods", depth: "patch depth", size: "patch size",
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
  el.innerHTML = `<i style="background:${color};box-shadow:0 0 6px ${color}"></i>${styleName(views.styles[k], k)}`;
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
      `<input class="sc-name" maxlength="24" value="${s.name || ""}" placeholder="${styleName(s, k)}" title="Name this style">` +
      `<span class="sc-share">${Math.round(s.share * 100)}%</span>` +
      `<button class="sc-play" title="Audition this style's exemplar">▶</button>`;
    const input = chip.querySelector(".sc-name");
    input.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") input.blur(); });
    input.addEventListener("keyup", (e) => e.stopPropagation());
    input.onblur = () => send({ type: "set_style_name", k, name: input.value });
    chip.querySelector(".sc-play").onclick = () => {
      const ex = s.exemplars && s.exemplars[0];
      if (ex == null) return;
      awaitRender(ex, () => play(ex));
    };
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
}

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
  const payload = JSON.stringify({ ricercar_patch: 1, name, tree: wb.tree }, null, 1);
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
    send({ type: "import_patch", json: JSON.stringify(tree), name: data.name || "" });
  } catch (_) {
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
function renderFillHint() {
  const el = $("bank-count");
  if (!el) return;
  const ranked = (views && views.ranked) || [];
  const shown = ranked.filter((r) => !cutIds.has(r.id)).length;
  const arriving = Math.max(0, fillTarget - fillPool);
  el.textContent = shown ? `${shown}${arriving ? ` +${arriving}` : ""}` : arriving ? `+${arriving}` : "";
  el.title = `${shown} patches in the bank${arriving ? ` — ${arriving} more arriving` : ""}`;
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

function renderWarmStart(rows) {
  warmRows = rows;
  const grid = $("warm-grid");
  grid.innerHTML = "";
  rows.forEach((r) => {
    const b = document.createElement("button");
    b.className = "warm-item";
    b.innerHTML = `<span class="wi-name">${r.name}</span><span class="wi-sig mono">${r.sig}</span><span class="wi-play" aria-hidden="true">▶</span>`;
    b.setAttribute("aria-pressed", "false");
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
    grid.appendChild(b);
  });
  $("warm-go").disabled = true;
  $("warm-go").textContent = "pick any three";
  $("warmstart").classList.remove("hidden");
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
  for (const r of warmRows) send({ type: "load_preset", index: r.index, warm: r.index });
  closeWarmStart();
  note("Loading those in and teaching the model what you picked…");
};

function warmPresetLoaded(index, id) {
  if (!warmLoaded || id <= 0) return;
  warmLoaded.ids.set(index, id);
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
  note(`${n} preferences learned from your three picks — the model starts out pointed at you.`);
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
window.__ric = { audioCtx, getLive: () => live, wb, tray, nonLiveAddrs };
