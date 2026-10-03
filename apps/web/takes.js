// CAPTURE's recordings on the main thread (Plan-007 tasks 4 and 6): the
// RECORD control on the module, and the sounds a restore kept safe because
// their recording couldn't be read.
//
// What it owns, and the rules it keeps:
//
// - **The audio thread only copies.** RECORD hands the worklet a buffer
//   (`take_start`), and while it is lit the worklet copies the recorder's
//   input into it; STOP (or the take's limit, the engine's `take_seconds`)
//   hands it back (`take_done`). The engine worker then plays it through one
//   voice of the patch, its key held and the CAPTURE's record gate raised
//   (`render_take`), and encodes the take. So recording needs no MONITOR,
//   leaves the voices under the player's hands alone, costs the audio thread
//   a copy, and what it records is what the CAPTURE's own input branch makes,
//   not the raw input.
// - **A recording goes into the sound as an edit.** On the bench it is
//   `edit_structure` with `set_take`, through the bench lane like any other
//   structural edit: one undo step, rendered and vetted. For a sound kept
//   safe it is `readmit_held`, which puts the take where the unreadable one
//   was and brings the sound back into the pool.
// - **A take lands on the sound it was recorded for.** RECORD remembers the
//   sound on the bench (`benchId`); moving to another sound stops the
//   recording and drops it, and says so, rather than land the take on
//   whichever sound is on the bench at STOP (`benchMoved`).
// - **Input.** A recording reads the input the AUDIO IN under its CAPTURE
//   reads, through the worklet's second input: audio-in.js lends it (`lend`),
//   whether the bench reads it (RECORD) or not (RECORD AGAIN on a sound kept
//   safe, while the bench may read another). The recording starts only once
//   that input is open and connected, so it never records an input still
//   opening, and a refusal says so rather than record silence.

const W = await import(new URL(`./words.js${new URL(import.meta.url).search}`, import.meta.url).href);

const SVG_NS = "http://www.w3.org/2000/svg";
/** The longest take a CAPTURE holds until the engine says (`take_seconds`,
 *  in its `ready`): `TAKE_SECONDS` in auracle-grammar. RECORD stops itself
 *  a little after it. */
const TAKE_SECONDS_UNTIL_READY = 4;
/** The lane under a CAPTURE's setting (rack units): see `drawLane`. */
export const TAKE_LANE_H = 30;

export function createTakes(host) {
  // host: live(), note(text, opts), send(msg, transfer), setTake(key, take, text),
  // lend(slot) → {ready, release}, ensureAudio(), renderBank(), benchTree(),
  // nodeAt(key), nodeIn(tree, key), benchId() → the sound on the bench,
  // sampleRate() → the audio's, keptCursor() → the kept-safe row the bank's
  // cursor is on
  let rolling = null;   // {key, tree, held: entry|null, bench, moved, waiting, timer, release}
  const rendering = new Map(); // render_take id → its recording, until the worker answers
  let renderSeq = 0;
  let held = [];        // the sounds a restore kept safe: {id, name, auto_name, note, capture, tree}
  let limit = TAKE_SECONDS_UNTIL_READY; // seconds: the engine's take_seconds once it is ready

  // ---- recording ----
  /** The input slot the first AUDIO IN under the CAPTURE at `key` of `tree`
   *  reads (what it records); null for a CAPTURE that records a chain with no
   *  input. */
  function inputSlot(tree, key) {
    let slot = null;
    const walk = (n) => {
      if (!n || typeof n !== "object" || slot != null) return;
      if (n.AudioIn) { slot = n.AudioIn.input | 0; return; }
      for (const v of Object.values(n)) {
        if (v && typeof v === "object") walk(v);
      }
    };
    walk(host.nodeIn(tree, key));
    return slot;
  }

  function start(treeJson, key, heldEntry) {
    if (rolling) return;
    const live = host.live();
    if (!live) return;
    host.ensureAudio();
    let slot = null;
    try { slot = inputSlot(JSON.parse(treeJson), key); } catch (_) { /* records nothing below */ }
    const lease = slot != null ? host.lend(slot) : null;
    const r = {
      key, tree: treeJson, held: heldEntry || null, bench: heldEntry ? null : host.benchId(), moved: false,
      waiting: !!lease, release: lease ? lease.release : null, timer: null,
    };
    rolling = r;
    paint();
    const go = () => {
      r.waiting = false;
      // Room for the whole take and a little more, interleaved stereo.
      live.takeStart(key, new Float32Array(Math.ceil((limit + 0.5) * host.sampleRate()) * 2));
      // The take's own limit stops the recording; the control stops a moment
      // after it, so the whole take is read back.
      r.timer = setTimeout(() => stop(), limit * 1000 + 250);
      host.note(heldEntry ? W.takeAgain(nameOf(heldEntry), limit) : W.takeRolling(limit), {
        urgent: true, replace: "take",
      });
      paint();
    };
    if (!lease) return go();
    // The input first: open, connected to the recorder, permission included.
    lease.ready.then((res) => {
      if (rolling !== r) return; // stopped, or moved on, while it opened
      if (res.ok) return go();
      rolling = null;
      r.release();
      host.note(W.TAKE_INPUT[res.why] || W.TAKE_INPUT.failed, { urgent: true, replace: "take" });
      paint();
    });
  }

  function stop() {
    if (!rolling) return;
    if (rolling.waiting) {
      // Still waiting for the input: nothing was started, so nothing to read.
      const r = rolling;
      rolling = null;
      if (r.release) r.release();
      paint();
      return;
    }
    clearTimeout(rolling.timer);
    const live = host.live();
    if (live) live.takeStop(rolling.key);
  }

  /** The player moved to another sound (`id`, or null for one still on its
   *  way): a recording for the sound they left stops, and its take is
   *  dropped rather than landed on this one. A recording for a sound kept
   *  safe is not about the bench, and goes on. */
  function benchMoved(id) {
    if (!rolling || rolling.held || rolling.moved) return;
    if (id != null && id === rolling.bench) return;
    rolling.moved = true;
    host.note(W.TAKE_SAID.moved, { urgent: true, replace: "take" });
    stop();
    paint();
  }

  /** The worklet's reply: the input it copied, or why there is none. */
  function onWorklet(m) {
    if (!rolling) return;
    if (m.type !== "take_done" && m.type !== "take_error") return;
    const r = rolling;
    rolling = null;
    clearTimeout(r.timer);
    if (r.release) r.release();
    paint();
    if (m.type === "take_error") {
      if (!r.moved) host.note(W.TAKE_ERRORS[m.code] || W.TAKE_ERRORS.failed, { urgent: true, replace: "take" });
      return;
    }
    // Nothing copied: a STOP before the first quantum, and no take (not the
    // one the CAPTURE already holds, sent back as if it were new).
    const frames = m.frames | 0;
    if (r.moved) return;
    if (!m.buf || frames <= 0) {
      host.note(W.TAKE_SAID.empty, { urgent: true, replace: "take" });
      return;
    }
    // The engine worker plays it through the CAPTURE and encodes the take.
    const id = ++renderSeq;
    rendering.set(id, r);
    host.send({
      type: "render_take", id, tree: r.tree, key: r.key,
      samples: m.buf.subarray(0, frames * 2), channels: 2, sampleRate: host.sampleRate(),
    }, [m.buf.buffer]);
  }

  /** The edit on the bench was kept as new: the sound `from` is `to` now, the
   *  same tree under the child's id. A recording for it, rolling or being
   *  rendered, follows it rather than read the new id as a move. */
  function benchKept(from, to) {
    if (rolling && !rolling.held && rolling.bench === from) rolling.bench = to;
    for (const r of rendering.values()) if (!r.held && r.bench === from) r.bench = to;
  }

  /** The worker's take, rendered from what was recorded. */
  function rendered(m) {
    const r = rendering.get(m.id);
    if (!r) return;
    rendering.delete(m.id);
    if (!m.take) {
      host.note(W.TAKE_ERRORS[m.code] || W.TAKE_ERRORS.failed, { urgent: true, replace: "take" });
      return;
    }
    let take = null;
    try { take = JSON.parse(m.take); } catch (_) { take = null; }
    const seconds = take && take.sample_rate > 0 ? (take.length | 0) / take.sample_rate : 0;
    if (!take || seconds <= 0) {
      if (!r.moved) host.note(W.TAKE_SAID.empty, { urgent: true, replace: "take" });
      return;
    }
    if (r.held) {
      host.send({ type: "readmit_held", id: r.held.id, take: JSON.stringify(take) });
      return;
    }
    // Recorded for a sound the player has left: dropped, never landed on the
    // sound on the bench now (said when they moved, or here if the move
    // reached the bench without passing `benchMoved`).
    if (r.moved) return;
    if (host.benchId() !== r.bench) {
      host.note(W.TAKE_SAID.moved, { urgent: true, replace: "take" });
      return;
    }
    host.setTake(r.key, take, W.takeLanded(seconds));
  }

  // ---- the CAPTURE lane ----
  /** The rack's lanes of class `cls`, not the leaving rack's copies (a
   *  `.rack-exit` fading out after a move, whose plates have lost their keys). */
  const lanes = (cls) => [...document.querySelectorAll(`#rack-svg ${cls}`)].filter((l) => !l.closest(".rack-exit"));
  const el = (tag, attrs, cls) => {
    const e = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
    if (cls) e.setAttribute("class", cls);
    return e;
  };

  /** The take's length, in seconds, the CAPTURE at `key` on the bench holds
   *  (0 for none). */
  function takeSeconds(key) {
    const n = host.nodeAt(key);
    const t = n && n.Capture && n.Capture.take;
    return t && t.sample_rate > 0 ? (t.length | 0) / t.sample_rate : 0;
  }

  /** Draw a CAPTURE module's lane into its control group `g`, `top` units
   *  down the plate, `w` wide: RECORD (STOP while it rolls) and the length of
   *  the recording it holds. Painted again by `paint`, never rebuilt. */
  function drawLane(g, m, w, top) {
    const lane = el("g", { transform: `translate(0,${top})` }, "take-lane");
    lane.dataset.key = m.key;
    const inset = 10;
    const bw = 70;
    const btn = el("g", { transform: `translate(${inset},0)` }, "ain-btn ain-ctl take-rec");
    btn.appendChild(el("rect", { width: bw, height: 18, rx: 3 }, "ain-btn-body"));
    const t = el("text", { x: bw / 2, y: 12.5 }, "ain-btn-text");
    btn.appendChild(t);
    const tt = el("title", {});
    tt.textContent = W.TAKE_TIPS.record;
    btn.appendChild(tt);
    btn.setAttribute("role", "button");
    btn.setAttribute("tabindex", "-1");
    btn.setAttribute("aria-label", W.TAKE_TIPS.record);
    btn.dataset.stop = "take-rec"; // on the rack's roving stop, after the knobs
    const run = () => {
      if (rolling) return stop();
      const tree = host.benchTree();
      if (tree) start(JSON.stringify(tree), m.key, null);
    };
    btn.addEventListener("click", (ev) => { ev.stopPropagation(); run(); if (ev.detail > 0) btn.blur(); });
    btn.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      ev.preventDefault();
      if (ev.repeat) return; // a held key presses once: RECORD, not RECORD-STOP-RECORD
      run();
    });
    lane.appendChild(btn);
    const line = el("text", { x: inset + bw + 8, y: 12.5 }, "take-line");
    lane.appendChild(line);
    g.appendChild(lane);
    paintLane(lane);
  }

  function paintLane(lane) {
    const key = lane.dataset.key;
    const mine = !!rolling && !rolling.held && !rolling.moved && rolling.key === key;
    const btn = lane.querySelector(".take-rec");
    if (btn) {
      btn.classList.toggle("on", mine);
      btn.setAttribute("aria-pressed", String(mine));
      const t = btn.querySelector(".ain-btn-text");
      const label = mine ? W.TAKE_SILK.stop : W.TAKE_SILK.record;
      if (t && t.textContent !== label) t.textContent = label;
    }
    const line = lane.querySelector(".take-line");
    const text = mine ? (rolling.waiting ? W.TAKE_SILK.opening : W.TAKE_SILK.rolling) : W.takeLine(takeSeconds(key));
    if (line && line.textContent !== text) line.textContent = text;
  }

  function paint() {
    for (const lane of lanes(".take-lane")) paintLane(lane);
    for (const b of document.querySelectorAll("#bank-list .kept-rec")) {
      const mine = !!rolling && rolling.held && String(rolling.held.id) === b.dataset.id;
      b.classList.toggle("on", mine);
      b.textContent = mine ? W.TAKE_SILK.stop : W.TAKE_SILK.again;
      b.disabled = !!rolling && !mine;
    }
  }

  // ---- the sounds kept safe ----
  const nameOf = (h) => h.name || h.auto_name || W.TAKE_SAID.unnamed;

  /** The worker's list of the sounds a restore kept safe. */
  function setHeld(list) {
    held = Array.isArray(list) ? list : [];
    host.renderBank();
  }

  /** The worker's answer to a recording sent for a sound kept safe. */
  function readmitted(m) {
    if (m.ok) {
      const h = held.find((x) => x.id === m.id);
      host.note(W.takeReadmitted(h ? nameOf(h) : W.TAKE_SAID.unnamed), { urgent: true, replace: "take" });
    } else {
      host.note(m.error || W.TAKE_SAID.empty, { urgent: true, replace: "take" });
    }
  }

  /** RECORD AGAIN on the sound kept safe `id` (STOP while anything records). */
  function recordAgain(id) {
    if (rolling) return stop();
    const h = held.find((x) => x.id === id);
    if (!h || !h.tree || !h.capture) return;
    start(JSON.stringify(h.tree), h.capture, h);
  }

  /** Append the sounds kept safe to the pool's list, under their own group:
   *  each with the engine's sentence and RECORD AGAIN. */
  // `match`: Find a sound's test on a name (main.js); the group lists the
  // ones it passes.
  function appendKept(frag, group, match = () => true) {
    const shown = held.filter((h) => match(nameOf(h)));
    if (!shown.length) return;
    frag.appendChild(group(W.TAKE_SILK.kept, W.TAKE_TIPS.kept, shown.length));
    for (const h of shown) {
      const row = document.createElement("div");
      // An option of the bank's listbox: the cursor reaches it past the
      // pool's last row, and Enter or Space presses RECORD AGAIN (main.js).
      row.className = host.keptCursor && host.keptCursor() === h.id ? "kept-row kbd" : "kept-row";
      row.id = `kept-row-${h.id}`;
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", "false");
      const name = document.createElement("span");
      name.className = "kept-name";
      name.textContent = nameOf(h);
      const note = document.createElement("span");
      note.className = "kept-note";
      note.textContent = h.note || "";
      const b = document.createElement("button");
      b.type = "button";
      b.className = "kept-rec util-btn";
      b.tabIndex = -1;
      b.dataset.id = String(h.id);
      b.textContent = W.TAKE_SILK.again;
      b.title = W.TAKE_TIPS.again;
      b.onclick = (ev) => {
        ev.stopPropagation();
        recordAgain(h.id);
      };
      row.append(name, note, b);
      frag.appendChild(row);
    }
    paint();
  }

  return {
    drawLane,
    paint,
    onWorklet,
    benchMoved,
    benchKept,
    rendered,
    recordAgain,
    /** The sounds kept safe, in the order they are listed. */
    keptIds: () => held.map((h) => h.id),
    /** The engine's longest take, in seconds (its `ready`). */
    setLimit: (s) => { if (Number.isFinite(s) && s > 0) limit = s; },
    setHeld,
    readmitted,
    appendKept,
    /** For the debugging handle: what is rolling and what is kept safe. */
    state: () => ({
      rolling: rolling ? { key: rolling.key, held: rolling.held ? rolling.held.id : null, waiting: rolling.waiting } : null,
      rendering: rendering.size,
      held: held.map((h) => h.id),
    }),
  };
}
