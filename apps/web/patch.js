// PATCH, Plan-005 task 7: the parts of the view that read the engine's facts
// about the patch in hand, beside the rack that `main.js` draws. It reaches
// the rack, the bench lane and the worker only through `host` (see the call
// in main.js), so the rack's own code stays where it is.
//
//  - **The model's guess** for the next module (the worker's `guess`,
//    `guess_skip`, and `edit_structure` with `guess`; `auracle_session::guess`):
//    drawn at its socket as a dashed amber module, GUESS · FILTER above the
//    rack with its reason in the model's italic. Nothing before the warm
//    start (`no_taste`).
//  - **Each audio cable's measured level at rest** (the worker's
//    `cable_levels`, `WasmEngine::edit_cable_levels`, `probe_cables`): the
//    cable's light and a level mark at its middle. One render, asked once an
//    edit has settled; while notes sound, the live meter takes over.
//  - **A patch from nothing:** NEW PATCH, CLEAR and BACK TO ‹name›.
//  - **The module sheet** on touch: every setting of a tapped module.

export function createPatch(host) {
  const $ = (id) => document.getElementById(id);
  const SVG_NS = "http://www.w3.org/2000/svg";
  const svgEl = (tag, attrs = {}, cls) => {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, String(v));
    if (cls) el.setAttribute("class", cls);
    return el;
  };
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : String(v));
    }
    for (const k of kids) if (k != null && k !== false) n.append(k);
    return n;
  };
  const W = host.words;

  // A structure: everything a structural edit or an open changes. A level or
  // a guess measured on another structure describes cables and sockets that
  // are not on screen.
  let epoch = 0;
  let seq = 0;
  let settleTimer = null;

  // ---------------------------------------------------------------- settle
  // The probe and the guess are each a render or more on the engine's one
  // thread, so they are asked for once the bench has settled (nothing in the
  // lane, nothing opening, no knob held), never per knob step, and only while
  // PATCH is in sight; a view that comes back asks for what it missed.
  // Arriving is not settling. After PATCH comes into view, or a sound opens,
  // the player often clicks on (another sound, straight away), and a render
  // started then is one that click waits behind: on a slow machine the open
  // took over a second and was announced (`OPEN_SAID_MS`, "Opened …"). So
  // after an arrival the bench must be quiet for longer first.
  const ARRIVE_MS = 1200;
  function scheduleSettle(ms = 450) {
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(onSettle, ms);
  }
  function onSettle() {
    settleTimer = null;
    if (!host.visible() || !host.hasRack()) return;
    if (!host.benchSettled() || host.knobDragging()) {
      scheduleSettle(400);
      return;
    }
    if (probe.want) askProbe();
    if (guess.want) askGuess();
  }

  // ---------------------------------------------------------------- levels
  // `edit_cable_levels`: every audio cable of the patch in hand, measured on
  // one render of the phrase, keyed as the rack draws it (`from`, `to`), in
  // the live meter's dB scale. A modulation cable is not measured (the
  // compiler taps audio nodes only), so it carries no light and no mark: it
  // keeps its dashes, moving at its modulator's rate as set (`modBreath`).
  const probe = { want: false, out: null, again: false, levels: null, tree: null, stale: false };
  // The meter's mapping (`METER_FLOOR_DB` in main.js): −54 dB is the quietest
  // level worth lighting, 0 dB re 1 V is full.
  const FLOOR_DB = -54;
  const gainOf = (db) => (db == null || !Number.isFinite(db) ? 0 : Math.max(0, Math.min(1, (db - FLOOR_DB) / -FLOOR_DB)));
  const wireKey = (w) => `${w.from}>${w.to}`;

  // At most one probe at the engine and one owed: a probe asked while one is
  // out waits for its answer, and is then asked for the tree on screen then
  // (the latest wins), so edits settling faster than a render cannot pile
  // renders up in the `later` lane.
  function askProbe() {
    probe.want = false;
    if (probe.out) {
      probe.again = true;
      return;
    }
    probe.out = ++seq;
    host.send({ type: "cable_levels", token: probe.out });
  }
  function onLevels(m) {
    if (m.token !== probe.out) return;
    probe.out = null;
    if (probe.again) {
      probe.again = false;
      probe.want = true;
      scheduleSettle(0);
    }
    // Measured on a tree the bench has since left (a knob turned while the
    // probe rendered): ask again for the tree on screen.
    if (m.tree !== host.benchTreeJson()) {
      probe.want = true;
      scheduleSettle();
      return;
    }
    const map = new Map();
    for (const c of (m.levels && m.levels.cables) || []) map.set(`${c.from}>${c.to}`, c.rms_db);
    probe.levels = map;
    probe.tree = m.tree;
    probe.stale = false;
    paintLevels();
  }

  /** The light an audio cable carries at rest: its measured level, or null
   *  when this structure has not been measured yet (it then sits at the
   *  floor, unlit, until the probe lands). Read by the rack's build and by
   *  its meter when no note sounds (`repaintMeasuredFlow`). */
  function restLevel(w) {
    if (!probe.levels || w.kind === "mod") return null;
    const db = probe.levels.get(wireKey(w));
    return db == null ? null : gainOf(db);
  }

  function paintLevels() {
    const frame = host.rackFrame();
    const svg = host.rackSvg();
    if (!frame || !svg) return;
    if (!host.flowing()) {
      for (const it of frame.wires) {
        if (it.w.kind === "mod") continue;
        const lv = restLevel(it.w);
        host.paintWireLevel(it.inkEl, lv == null ? 0 : lv);
      }
    }
    drawMarks(svg, frame);
  }

  // The level mark: three bars on the cable's middle, lit by its measured
  // level (`edit_cable_levels`' `rms_db`), its number on hover. Hollow while
  // the patch has changed since it was measured, and on a structure not yet
  // measured, where it says nothing.
  function drawMarks(svg, frame) {
    let layer = svg.querySelector(":scope > g.cable-marks");
    if (!layer) {
      layer = svgEl("g", { "aria-hidden": "true" }, "cable-marks");
      svg.appendChild(layer);
    } else layer.replaceChildren();
    for (const it of frame.wires) {
      if (it.w.kind === "mod") continue;
      let len = 0;
      try { len = it.inkEl.getTotalLength(); } catch (_) { len = 0; }
      if (!len) continue;
      const p = it.inkEl.getPointAtLength(len / 2);
      const db = probe.levels ? probe.levels.get(wireKey(it.w)) : null;
      const known = db != null && !probe.stale;
      const lv = known ? gainOf(db) : 0;
      const g = svgEl("g", {
        transform: `translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`,
        "data-from": it.w.from, "data-to": it.w.to,
        "data-db": db == null ? null : db.toFixed(1),
      }, `cable-mark${known ? "" : " unknown"}`);
      g.appendChild(svgEl("rect", { x: -8, y: -7, width: 16, height: 14, rx: 3 }, "lm-box"));
      const lit = known ? (lv > 0.66 ? 3 : lv > 0.33 ? 2 : lv > 0.02 ? 1 : 0) : 0;
      for (let k = 0; k < 3; k++) {
        const bh = 3 + k * 2.2;
        g.appendChild(svgEl("rect", { x: -5 + k * 3.8, y: 4 - bh, width: 2, height: bh }, `lm-bar${k < lit ? " on" : ""}`));
      }
      const t = svgEl("title");
      t.textContent = known
        ? `measured at rest: ${W.levelWord(db)}`
        : probe.levels && probe.stale ? "changed since it was measured" : "not measured yet";
      g.appendChild(t);
      layer.appendChild(g);
    }
  }

  // ---------------------------------------------------------------- the guess
  // `guess_rank`'s ranking for the patch in hand, best first by the lower
  // bound of the gain. Only the top guess is drawn; a skip shows the next one
  // the engine ranks (`guess_skip`, then `guess` again).
  // `tree`: the bench's tree the ranking was made on (the reply's), which
  // the faces beside the plate describe.
  // `at`: "What goes here?" (the selection's ⋯, or Q): the module key whose
  // place the guess is ranked for (`guess_rank`'s `at`: its wire, its
  // modulation slot, and itself if it is an empty socket), until the
  // structure changes or Esc goes back to the output's.
  const guess = { want: false, out: null, again: false, data: null, tree: null, epoch: -1, skipping: false, retries: 0, at: null, atData: null };

  function askGuess() {
    if (guess.out) {
      guess.again = true;
      return;
    }
    guess.want = false;
    guess.out = { token: ++seq, epoch, at: guess.at };
    host.send({ type: "guess", token: guess.out.token, ...(guess.at ? { at: guess.at } : {}) });
  }
  function onGuess(m) {
    if (!guess.out || m.token !== guess.out.token) return;
    const asked = guess.out;
    guess.out = null;
    if (guess.again) {
      guess.again = false;
      guess.want = true;
      scheduleSettle(0);
    }
    // Ranked for another place than the one now asked about (a "What goes
    // here?" asked while the output's ranking was out, or Esc since): not
    // this answer. The place asked about now is asked for.
    if (asked.at !== guess.at) {
      guess.want = true;
      scheduleSettle(0);
      return;
    }
    if (m.error) {
      guess.data = null;
      drawGuess();
      return;
    }
    // Ranked on a structure the bench has left: the sockets it names are not
    // the ones on screen. The settle after that edit asks again.
    if (asked.epoch !== epoch) {
      guess.want = true;
      scheduleSettle();
      return;
    }
    guess.data = m.data || null;
    guess.tree = m.tree || null;
    guess.epoch = epoch;
    guess.skipping = false;
    guess.atData = asked.at;
    // A ranking that came back with nothing in it because its time ran out
    // before any candidate was heard (a crew still starting, a slow machine)
    // is not an answer: what it did render is in the engine's memo, so
    // asking again, at most twice for one structure, goes on from there.
    const d = guess.data;
    if (d && Array.isArray(d.guesses) && !d.guesses.length && d.rendered < d.planned && guess.retries < 2) {
      guess.retries += 1;
      guess.want = true;
      scheduleSettle();
    }
    drawGuess();
  }
  const guessCurrent = () => guess.data && guess.epoch === epoch && guess.atData === guess.at;
  const topGuess = () =>
    guessCurrent() && !guess.skipping && Array.isArray(guess.data.guesses) ? guess.data.guesses[0] || null : null;

  /** "What goes here?": the guess for the place of the module at `key`
   *  (the selection's ⋯, or Q). Its ghost is drawn there with its reason on
   *  the well's top line, Enter takes it and × skips it, as the output's. */
  function askHere(key, { focus = false } = {}) {
    if (!key || !host.hasRack()) return;
    guess.at = key;
    // Asked from the keyboard: the ghost takes the focus when it lands, so
    // Enter takes it, if the keyboard is still on the canvas then.
    guess.focusWhenDrawn = focus;
    guess.retries = 0;
    guess.skipping = false;
    drawGuess();
    // Asked now, not on the next settle: the player asked.
    if (!host.benchSettled() || host.knobDragging()) {
      guess.want = true;
      scheduleSettle(0);
    } else askGuess();
  }
  /** Back to the output's guess (Esc on the ghost, or a structural edit). */
  function clearHere() {
    if (!guess.at) return;
    guess.at = null;
    guess.focusWhenDrawn = false;
    guess.retries = 0;
    guess.want = true;
    drawGuess();
    scheduleSettle(0);
  }
  /** Where a guess at `g` goes, in words, for the top line ("after the drive"). */
  function placeWords(g) {
    const owner = host.kindName(host.kindAt(g.op.key)) || "module";
    if (g.op.op === "set_mod") return `on the ${owner}’s ${host.kindModTarget(host.kindAt(g.op.key)) || "modulation"}`;
    if (g.op.op === "replace") return "in the empty socket";
    return `after the ${owner}`;
  }

  function nameOfKind(kind) {
    return host.kindName(kind) || String(kind).replace(/_/g, " ");
  }

  /** Take the top guess: the same edit, through the one ordered lane, with
   *  the guess attached so the engine remembers it (`guess_take`) and a ⌘Z
   *  back to the tree before it counts as a skip. A guess no longer current
   *  is refused by the engine with its reason (`edit_rejected`). */
  function takeGuess() {
    const g = topGuess();
    if (!g) return;
    const name = nameOfKind(g.kind);
    // The receipts the module rail's own placements give (`nbSocketClick`).
    const owner = g.op.op === "set_mod" ? host.kindAt(g.op.key) : null;
    const text =
      g.op.op === "replace" ? `${host.capital(name)} took the socket.`
      : g.op.op === "set_mod" ? `${host.capital(name)} → ${host.kindModTarget(owner) || "mod"} on ${host.kindName(owner)}.`
      : `${host.capital(name)} patched into the wire.`;
    guess.skipping = true; // drawn no more: it is on its way in
    drawGuess();
    host.queueStruct(
      { type: "edit_structure", op: g.op, guess: { op: g.op, socket: g.socket, family: g.family } },
      { text, opts: { undo: host.doUndo } },
      { op: "guess_take", kind: g.kind, socket: g.socket },
    );
  }

  /** Skip the top guess: its family stays away from its socket for this
   *  patch (`guess_skip`), and the next guess is ranked. */
  function skipGuess() {
    const g = topGuess();
    if (!g) return;
    guess.skipping = true;
    drawGuess();
    host.send({ type: "guess_skip", token: ++seq, guess: { socket: g.socket, family: g.family } });
  }

  // Where a guess goes, in rack units (`rackBoxes`): over the empty socket
  // it would fill (`replace`), above the wire it would be patched into
  // (`insert`), or under the module whose slot it would plug (`set_mod`).
  const GW = 150;
  const GH = 92;
  function placeOf(g) {
    const boxes = host.rackBoxes();
    const frame = host.rackFrame();
    const key = g.op && g.op.key;
    const box = boxes.get(key);
    if (!box) return null;
    if (g.op.op === "replace") {
      return { x: box.x, y: box.y, w: box.w, h: box.h, over: true };
    }
    if (g.op.op === "set_mod") {
      const jack = [box.x + 13 + Math.max(0, (box.w - Math.min(96, box.w - 8)) / 2), box.y + box.h + 7];
      return inView(box.x + Math.max(0, (box.w - GW) / 2), box.y + box.h + 44, jack, null, box.y + box.h + 44);
    }
    // insert: the wire out of `key`, into whatever consumes it.
    const it = frame && frame.wires.find((x) => x.w.kind !== "mod" && x.w.from === key);
    if (!it) return null;
    let len = 0;
    try { len = it.inkEl.getTotalLength(); } catch (_) { len = 0; }
    if (!len) return null;
    const p = it.inkEl.getPointAtLength(len / 2);
    const to = boxes.get(it.w.to);
    const top = Math.min(box.y, to ? to.y : box.y);
    const bottom = Math.max(box.y + box.h, to ? to.y + to.h : box.y + box.h);
    return inView(p.x - GW / 2, top - GH - 30, [p.x, p.y], top - GH - 30, bottom + 36);
  }

  // Where the camera is looking, in rack units, and how many pixels a unit
  // is, from the rack's viewBox (`applyView`).
  function cameraBox() {
    const svg = host.rackSvg();
    const vb = svg && svg.getAttribute("viewBox");
    if (!vb) return null;
    const [x, y, w, h] = vb.split(/\s+/).map(Number);
    if (!(w > 0 && h > 0)) return null;
    return { x, y, w, h, s: svg.clientWidth / w || 1 };
  }

  /** A guess plate kept in sight: above its socket where there is room in
   *  the camera's view (`above`), else below the chain (`below`), else at
   *  the view's top; its dashed lead always ends at the socket (`at`). The
   *  camera is the player's, so the plate moves into it rather than the
   *  view moving to the plate, and the line above the rack names it
   *  whatever the camera shows. */
  function inView(x, y, at, above, below) {
    const cam = cameraBox();
    if (cam) {
      const top = cam.y + 44 / cam.s; // clear of the GUESS · line over the rack
      const foot = cam.y + cam.h - 12 / cam.s;
      if (above != null && above >= top) y = above;
      else if (below != null && below + GH <= foot) y = below;
      else y = Math.max(top, Math.min(y, foot - GH));
      x = Math.max(cam.x + 8 / cam.s, Math.min(x, cam.x + cam.w - GW - 8 / cam.s));
    }
    const fromTop = y > at[1];
    return { x, y, w: GW, h: GH, lead: [x + GW / 2, fromTop ? y : y + GH, at[0], at[1]] };
  }

  /** The camera moved: the plate follows, to stay in sight. */
  function cameraMoved() {
    if (topGuess()) drawGuess();
  }

  function drawGuess() {
    const svg = host.rackSvg();
    const read = $("guess-read");
    const g = topGuess();
    let say = !g && guessCurrent() && !guess.skipping ? W.guessRefusal(guess.data) : null;
    // A place asked about: before the warm start the model says so (the
    // output's guess says nothing then, but here the player asked), and
    // while it is ranked, what it is doing.
    const here = guess.at ? host.kindName(host.kindAt(guess.at)) || "module" : null;
    if (here && !g && !say) {
      say = guessCurrent() && guess.data && (guess.data.reason === "no_taste" || guess.data.reason === "no_patch")
        ? "no guess yet: it needs a few picks first"
        : guessCurrent() ? null : `hearing the modules that fit at the ${here}…`;
    }
    // The line above the rack: GUESS · FILTER and the model's reason.
    if (read) {
      read.classList.toggle("here", !!here);
      if (g) {
        read.replaceChildren(
          el("span", { class: "gr-chip", text: `guess · ${nameOfKind(g.kind)}` }),
          ...(here ? [el("span", { class: "gr-at", text: placeWords(g) })] : []),
          el("span", { class: "gr-why", text: W.guessLine(g, guess.data.against, host.niceName) }),
        );
        read.hidden = false;
      } else if (say) {
        read.replaceChildren(el("span", { class: "gr-why", text: say }));
        read.hidden = false;
      } else {
        read.replaceChildren();
        read.hidden = true;
      }
    }
    drawRailMark(g);
    if (!svg) return;
    // A redraw (a face landing beside it, the camera moving, the model view)
    // replaces the plate: the keyboard standing on it stays on it.
    const old = svg.querySelector(":scope > g.rack-guess");
    const held = old && old.contains(document.activeElement);
    const onSkip = held && document.activeElement.classList.contains("gp-skip");
    old?.remove();
    if (!g) return;
    const at = placeOf(g);
    if (!at) return;
    const name = nameOfKind(g.kind);
    // A guess looks like a guess (ADR-012, voice.md): dashed amber, the
    // engine's ranking (`guess_rank`) drawn at the socket its edit names.
    const layer = svgEl("g", {}, "rack-guess");
    if (at.lead) {
      const [x1, y1, x2, y2] = at.lead;
      layer.appendChild(svgEl("path", { d: `M ${x1} ${y1} L ${x2} ${y2}` }, "guess-lead"));
      layer.appendChild(svgEl("circle", { cx: x2, cy: y2, r: 3.2 }, "guess-at"));
    }
    const plate = svgEl("g", {
      transform: `translate(${at.x},${at.y})`,
      role: "button", tabindex: "0",
      "data-kind": g.kind, "data-family": g.family, "data-socket": g.socket, "data-at": guess.at || null,
      "aria-label": `The model's guess${guess.at ? ` ${placeWords(g)}` : ""}: ${name}. ${W.guessLine(g, guess.data.against, host.niceName)}. Press Enter to add it.`,
    }, `guess-plate${at.over ? " over" : ""}`);
    plate.appendChild(svgEl("rect", { x: 0, y: 0, width: at.w, height: at.h, rx: 8 }, "gp-body"));
    const t1 = svgEl("text", { x: 14, y: 22 }, "gp-name");
    t1.textContent = name;
    const t2 = svgEl("text", { x: 14, y: 40 }, "gp-word");
    t2.textContent = "guess";
    const t3 = svgEl("text", { x: 14, y: at.h - 16 }, "gp-p");
    t3.textContent = W.guessLabel(g.p);
    plate.append(t1, t2, t3);
    const x = svgEl("g", { transform: `translate(${at.w - 16},16)`, role: "button", tabindex: "0", "aria-label": `Skip this guess (${name})` }, "gp-skip");
    x.appendChild(svgEl("circle", { r: 11 }, "gp-skip-hit"));
    x.appendChild(svgEl("path", { d: "M -4 -4 L 4 4 M 4 -4 L -4 4" }));
    const xt = svgEl("title");
    xt.textContent = "Skip";
    x.appendChild(xt);
    const pt = svgEl("title");
    pt.textContent = `Add the ${name}`;
    plate.appendChild(pt);
    plate.appendChild(x);
    const stop = (ev) => { ev.stopPropagation(); };
    x.addEventListener("pointerdown", stop);
    x.addEventListener("click", (ev) => { ev.stopPropagation(); skipGuess(); });
    // Enter only: Space plays the sound everywhere (ADR-016).
    x.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); ev.stopPropagation(); skipGuess(); }
    });
    plate.addEventListener("pointerdown", stop);
    plate.addEventListener("click", (ev) => { ev.stopPropagation(); takeGuess(); });
    plate.addEventListener("keydown", (ev) => {
      if (ev.target !== plate) return;
      if (ev.key === "Enter") { ev.preventDefault(); ev.stopPropagation(); takeGuess(); }
      else if (ev.key === "Delete" || ev.key === "Backspace") { ev.preventDefault(); ev.stopPropagation(); skipGuess(); }
      // Esc on a guess asked for a place: back to the output's guess.
      else if (ev.key === "Escape" && guess.at) { ev.preventDefault(); ev.stopPropagation(); clearHere(); }
    });
    layer.appendChild(plate);
    svg.appendChild(layer);
    if (held) (onSkip ? x : plate).focus({ preventScroll: true });
    else if (guess.focusWhenDrawn && guess.at) {
      guess.focusWhenDrawn = false;
      const a = document.activeElement;
      if (!a || a === document.body || svg.contains(a)) plate.focus({ preventScroll: true });
    }
    // The faces' hook (Plan-005 task 3, #102): the guess's candidate is a
    // real render in the engine's memo (`GuessCandidate::key`), so its face
    // is a measurement, not the specimen's estimate. Once faces exist the
    // host draws it beside the plate, labelled as the patch with this module,
    // with the patch's own face to compare (`guessFace(g, at, layer)`).
    // Both describe the tree the guess was ranked on (`guess.tree`), so the
    // host draws them only while the bench is still that tree.
    if (host.guessFace) host.guessFace(g, at, layer, guess.tree);
    // Over a narrow socket the words can be wider than the plate: condensed
    // to fit, as the rack's own silkscreen is (`fitLabels`).
    for (const t of [t1, t2, t3]) condense(t, at.w - (t === t1 ? 40 : 24));
    // Under the model view, the ranking's next two (`guess_rank` ranks them
    // by the lower bound of the gain, mean − 1 sd, best first): fainter
    // dashed chips at their own sockets, each with its lower bound. Drawn
    // only while the view is up; the top guess stays as it is.
    if (host.modelOn && host.modelOn()) drawRunnersUp(layer, at);
  }

  function condense(t, avail) {
    let w = 0;
    try { w = t.getBBox().width; } catch (_) { w = 0; }
    if (w > avail) {
      t.setAttribute("textLength", avail.toFixed(1));
      t.setAttribute("lengthAdjust", "spacingAndGlyphs");
    }
  }

  // A runner-up: smaller than the top guess, fainter, not a control (the top
  // guess is the one Enter takes; skipping it shows the next).
  const RW = 132;
  const RH = 44;
  function drawRunnersUp(layer, top) {
    const list = (guess.data && guess.data.guesses) || [];
    const taken = [{ x: top.x, y: top.y, w: top.w, h: top.h }];
    // The faces beside the top guess, as `guessFace` lays them out.
    taken.push({ x: top.x + top.w, y: top.y, w: 150, h: top.h });
    const plates = [...host.rackBoxes().values()].map((b) => ({ x: b.x - 6, y: b.y - 6, w: b.w + 12, h: b.h + 12 }));
    const cam = cameraBox();
    const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const inCam = (b) => !cam || (b.x >= cam.x && b.y >= cam.y + 44 / cam.s && b.x + b.w <= cam.x + cam.w && b.y + b.h <= cam.y + cam.h - 12 / cam.s);
    const clear = (b) => inCam(b) && !plates.some((q) => overlaps(b, q)) && !taken.some((q) => overlaps(b, q));
    list.slice(1, 3).forEach((g, i) => {
      const spot = placeOf(g);
      if (!spot) return;
      // Near its own socket (where the top guess would go for it, at the
      // runner's size), else beside the top guess, above it, or under the
      // patch: the first place that covers no module, no other guess and
      // stays in the camera's view. A modulation guess hangs under its plate.
      const own = { x: spot.x + Math.max(0, (spot.w - RW) / 2), y: spot.over ? spot.y + spot.h + 10 : spot.y, w: RW, h: RH };
      const prev = taken[taken.length - 1];
      const bottom = Math.max(...plates.map((q) => q.y + q.h), top.y + top.h);
      const tries = [
        own,
        { ...own, x: top.x - RW - 10, y: top.y },
        { ...own, x: top.x - RW - 10, y: top.y + RH + 8 },
        { ...own, x: top.x, y: top.y - RH - 8 },
        { ...own, x: prev.x, y: prev.y - RH - 8 },
        { ...own, x: top.x, y: bottom + 8 + i * (RH + 8) },
      ];
      const box = tries.find(clear) || own;
      taken.push(box);
      // A socket other than the top guess's gets a faint lead to it.
      const at = spot.lead ? [spot.lead[2], spot.lead[3]] : spot.over ? [spot.x + spot.w / 2, spot.y + spot.h] : null;
      if (at && g.socket !== list[0].socket) {
        const fromTop = box.y > at[1];
        layer.appendChild(svgEl("path", { d: `M ${box.x + RW / 2} ${fromTop ? box.y : box.y + RH} L ${at[0]} ${at[1]}` }, "runner-lead"));
      }
      const name = nameOfKind(g.kind);
      const lcb = `lower bound ${g.lcb >= 0 ? "+" : "−"}${Math.abs(g.lcb).toFixed(2)}`;
      const chip = svgEl("g", {
        transform: `translate(${box.x.toFixed(1)},${box.y.toFixed(1)})`,
        role: "img",
        "data-rank": i + 2, "data-kind": g.kind, "data-socket": g.socket, "data-lcb": g.lcb,
        "aria-label": `The model's guess number ${i + 2}: ${name}, ${lcb}`,
      }, "guess-runner");
      chip.appendChild(svgEl("rect", { x: 0, y: 0, width: RW, height: RH, rx: 6 }, "gr-body"));
      const n = svgEl("text", { x: 10, y: 18 }, "gr-name");
      n.textContent = `${i + 2} · ${name}`;
      const l = svgEl("text", { x: 10, y: RH - 11 }, "gr-lcb");
      l.textContent = lcb;
      chip.append(n, l);
      const tt = svgEl("title");
      tt.textContent = "Ranked by its lower bound";
      chip.appendChild(tt);
      layer.appendChild(chip);
      condense(n, RW - 20);
      condense(l, RW - 20);
    });
  }

  /** The model view came or went: the runners-up with it. */
  function modelViewChanged() {
    drawGuess();
  }

  // The module rail's row for the guessed kind carries an amber mark, left of
  // its name in the padding the row already has, so the name never moves.
  function drawRailMark(g) {
    for (const old of document.querySelectorAll(".nb-item.guessed")) old.classList.remove("guessed");
    if (!g) return;
    const chip = document.querySelector(`#nb-groups .nb-item[data-kind="${CSS.escape(g.kind)}"]`);
    if (chip) chip.classList.add("guessed");
  }

  // ---------------------------------------------------------------- a patch from nothing
  // A new patch is the patch in hand with nothing in its socket: the root is
  // the grammar's empty source (`Silence`), and the amp envelope is kept (the
  // maintainer's choice, the guess note's item 2). One whole-tree edit, so
  // ⌘Z takes it back. Opening another sound, keep as new, or an undo past
  // the start ends it; BACK TO ‹name› reopens the sound it was started from,
  // and a new patch left with modules in it is waiting under NEW PATCH.
  const fresh = { on: false, fromId: null, fromName: "", depth: 0, pending: false, saved: null, key: 0 };

  function enterNew() {
    if (!host.hasRack() || fresh.on) return;
    const fromId = host.subjectId();
    const saved = fresh.saved && fresh.saved.fromId === fromId ? fresh.saved : null;
    const resume = saved ? saved.tree : null;
    const ok = host.applyTreeRewrite((tree) => {
      if (resume) {
        tree.root = JSON.parse(JSON.stringify(resume.root));
        if (resume.amp) tree.amp = JSON.parse(JSON.stringify(resume.amp));
      } else {
        tree.root = { Silence: {} };
      }
      return null;
    }, { op: "new_patch" });
    if (!ok) return;
    // A patch of its own: the model's guesses for it are filed under a key
    // of its own (`guess_patch_as`), not the sound's it was started from, and
    // a new patch come back to finds its own skips again.
    fresh.key = saved && saved.key ? saved.key : 0;
    host.send({ type: "guess_patch_as", token: ++seq, key: fresh.key });
    fresh.on = true;
    fresh.fromId = fromId;
    fresh.fromName = host.benchName(fromId);
    fresh.pending = true;
    host.noteOnLanding(resume ? "Back to your new patch." : "A new patch: nothing in it yet.", { undo: host.doUndo });
    renderTools();
    host.renderSubject();
    host.openCatalog?.();
  }

  function clearNew() {
    if (!fresh.on || !host.hasRack() || moduleCount() === 0) return;
    const ok = host.applyTreeRewrite((tree) => {
      tree.root = { Silence: {} };
      return null;
    }, { op: "clear_patch" });
    if (!ok) return;
    host.noteOnLanding("Cleared the patch.", { undo: host.doUndo });
  }

  function backFrom() {
    if (!fresh.on) return;
    const id = fresh.fromId;
    // A new patch with something in it waits under NEW PATCH.
    const tree = host.benchTree();
    fresh.saved = tree && moduleCount() > 0 ? { fromId: id, tree: JSON.parse(JSON.stringify(tree)), key: fresh.key } : null;
    exitNew();
    host.openOnBench(id);
  }

  function exitNew() {
    if (!fresh.on) return;
    fresh.on = false;
    fresh.pending = false;
    renderTools();
    host.renderSubject();
    closeSheet();
    host.closeCatalog?.();
  }

  /** Modules in the patch, as the rack counts them: not the amp, not an
   *  empty socket, modulators apart. */
  function counts() {
    const mods = (host.rack() && host.rack().modules) || [];
    let a = 0;
    let c = 0;
    for (const m of mods) {
      if (m.kind === "amp" || m.kind === "silence") continue;
      if (m.is_mod) c += 1;
      else a += 1;
    }
    return { a, c };
  }
  const moduleCount = () => { const n = counts(); return n.a + n.c; };

  /** What PATCH's name and caption say for a new patch, or null. */
  function subject() {
    if (!fresh.on) return null;
    const { a, c } = counts();
    // "from nothing" is the cap's (PATCH · FROM NOTHING), as the specimen
    // sets it; the subtitle counts.
    const parts = [
      W.count(a, "module"),
      c ? W.count(c, "modulator") : "",
      host.vetSilent() ? "nothing to hear yet" : "",
    ].filter(Boolean);
    return { name: "New patch", meta: parts.join(" · ") };
  }

  // The brand set's glyphs (the specimen's `icon`): a 24 px grid, a 2 px
  // stroke in the button's own colour.
  const GLYPHS = {
    patch: '<path d="M6.5 11.9c0 8 11 8 11 0"/><circle cx="6.5" cy="9" r="2.9"/><circle cx="17.5" cy="9" r="2.9"/>',
    x: '<path d="M7.5 7.5l9 9M16.5 7.5l-9 9"/>',
    undo: '<path d="M9 6.5L5 10.5l4 4"/><path d="M5 10.5h9.5a4.5 4.5 0 0 1 0 9H12"/>',
  };
  // Rebuilt only when what it shows changes: every bench reply asks, and a
  // rebuild takes the focus off a button the keyboard is standing on.
  let toolsSig = "";
  function renderTools() {
    const seg = $("patch-new");
    if (!seg) return;
    const has = host.hasRack();
    const sig = `${fresh.on}|${has}|${fresh.on ? moduleCount() > 0 : ""}|${fresh.fromName}`;
    if (sig === toolsSig && seg.childElementCount) return;
    toolsSig = sig;
    // The specimen's glyph beside each label; under 1280 px the label goes
    // (the toolbar keeps its rows), and the button is named by its
    // aria-label and its tooltip.
    const btn = (id, glyph, label, title, on, extra) => {
      const b = el("button", { class: "pt-act", id, type: "button", title, "aria-label": title, ...extra });
      const svg = document.createElementNS(SVG_NS, "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("class", "pt-ic");
      svg.innerHTML = GLYPHS[glyph];
      b.append(svg, el("span", { class: "pt-act-l", text: label }));
      b.disabled = !on;
      return b;
    };
    if (fresh.on) {
      const back = btn("patch-back", "undo", `back to ${fresh.fromName}`, `Back to ${fresh.fromName} · Esc`, true, { onclick: backFrom });
      back.append(el("kbd", { text: "esc" }));
      seg.replaceChildren(
        btn("patch-clear", "x", "clear", "Clear the patch", moduleCount() > 0, { onclick: clearNew }),
        back,
      );
    } else {
      seg.replaceChildren(btn("patch-new-btn", "patch", "new patch", "New patch", has, { onclick: enterNew }));
    }
  }

  // ---------------------------------------------------------------- the module sheet
  // On touch, a knob drawn for a pointer is too small to turn: a tapped module
  // opens a sheet with every one of its settings, a wide slider with − and +
  // steps for each continuous one and its choices as buttons for each named
  // one, edited through the same lane as the rack's knobs. It closes by ×, a
  // swipe down, a tap outside, or Esc.
  const sheet = { el: null, uid: null, key: null, rows: [], holding: false, drag: null, returnTo: null };

  function moduleByUid(uid, key) {
    const mods = (host.rack() && host.rack().modules) || [];
    return mods.find((m) => uid && m.uid === uid) || mods.find((m) => !uid && m.key === key) || null;
  }

  function openSheet(key, focusAddr) {
    const mods = (host.rack() && host.rack().modules) || [];
    const m = mods.find((x) => x.key === key);
    if (!m || m.kind === "silence") return;
    if (!sheet.el) buildSheetShell();
    sheet.uid = m.uid || null;
    sheet.key = m.key;
    // Focus moves into the sheet, and goes back where it was when it closes.
    const was = document.activeElement;
    if (!sheet.el.contains(was)) sheet.returnTo = was && was !== document.body ? was : null;
    renderSheet(m, focusAddr);
    sheet.el.classList.add("on");
    sheet.el.setAttribute("aria-hidden", "false");
    const hl = focusAddr && sheet.el.querySelector(`.ms-row[data-addr="${CSS.escape(focusAddr)}"]`);
    const first = (hl || sheet.el).querySelector(".ms-track, .ms-seg [tabindex='0']") || sheet.el.querySelector(".ms-x");
    if (first) first.focus({ preventScroll: true });
  }

  function closeSheet() {
    if (!sheet.el || !sheet.el.classList.contains("on")) return;
    const inside = sheet.el.contains(document.activeElement);
    sheet.el.classList.remove("on");
    sheet.el.setAttribute("aria-hidden", "true");
    const back = sheet.returnTo;
    sheet.returnTo = null;
    if (inside) {
      if (back && back.isConnected) back.focus({ preventScroll: true });
      else document.activeElement.blur();
    }
    sheet.uid = null;
    sheet.key = null;
    sheet.rows = [];
  }

  function buildSheetShell() {
    const s = el("div", { class: "msheet", role: "dialog", "aria-modal": "false", "aria-hidden": "true", id: "module-sheet" });
    document.body.appendChild(s);
    sheet.el = s;
    // Down by the grabber or the title puts it away.
    s.addEventListener("pointerdown", (e) => {
      if (!e.target.closest(".ms-grab, .ms-head") || e.target.closest("button")) return;
      sheet.drag = { y: e.clientY, id: e.pointerId };
      try { s.setPointerCapture(e.pointerId); } catch (_) { /* gone */ }
      s.classList.add("dragging");
    });
    s.addEventListener("pointermove", (e) => {
      if (!sheet.drag) return;
      s.style.transform = `translateY(${Math.max(0, e.clientY - sheet.drag.y)}px)`;
    });
    const end = (e) => {
      if (!sheet.drag) return;
      const dy = e.clientY - sheet.drag.y;
      sheet.drag = null;
      s.classList.remove("dragging");
      s.style.transform = "";
      if (dy > 70) closeSheet();
    };
    s.addEventListener("pointerup", end);
    s.addEventListener("pointercancel", end);
    // A tap outside the sheet and the rack puts it away; a tap on another
    // module opens that one instead (the rack's own handler).
    document.addEventListener("pointerdown", (e) => {
      if (!s.classList.contains("on") || s.contains(e.target)) return;
      if (e.target.closest && e.target.closest("#rack-svg")) return;
      closeSheet();
    }, true);
  }

  function knobVariant(m) {
    const fk = (m.knobs || []).find((k) => k.addr.endsWith("#fkind"));
    return fk && fk.kind.t === "enum" ? (fk.kind.options[Math.round(fk.value)] || "").replace(/^svf /, "svf-") : null;
  }

  function renderSheet(m, focusAddr) {
    const s = sheet.el;
    const name = m.kind === "amp" ? "amp" : host.kindName(m.kind) || m.title;
    // Beside the name, the setting that says which kind of it this is (the
    // specimen's "filter lowpass", "vco saw"), as the rack prints it.
    const which = (m.knobs || []).find((k) => k.kind.t === "enum" && /^(mode|wave|kind|color|table|type)$/i.test(k.label));
    const sub = which ? host.enumDisplay(which) : "";
    const says = host.blurbOf(m.kind);
    sheet.rows = [];
    const rows = el("div", { class: "ms-rows" });
    for (const k of m.knobs || []) rows.append(rowFor(m, k));
    // AUDIO IN's and CAPTURE's lane buttons (the input line, MONITOR, NEW
    // CLIP, ALLOW INPUT; RECORD) are in the sheet too, a finger's size: each
    // presses the lane's own button on the rack, so there is one of each.
    sheet.lane = null;
    if (m.kind === "audio_in" || m.kind === "capture") {
      const box = el("div", { class: "ms-lane", role: "group", "aria-label": m.kind === "capture" ? "Recording" : "Your input" });
      sheet.lane = { box, key: m.key, buttons: [] };
      rows.append(box);
    }
    const head = el("div", { class: "ms-head" },
      el("div", { class: "ms-title" },
        el("span", { class: "ms-name", text: name }),
        sub ? el("span", { class: "ms-sub", text: sub }) : null),
      el("button", { class: "ms-x", type: "button", "aria-label": "Close", onclick: closeSheet, text: "✕" }));
    // Anything but the amp, an empty socket, or a link deep in a modulation
    // chain (which comes out with the modulator in its slot).
    const removable = m.kind !== "amp" && m.kind !== "silence" && (!m.is_mod || m.key.endsWith("/m"));
    const foot = removable
      ? el("div", { class: "ms-foot" },
        el("button", {
          class: "util-btn ms-rm", type: "button",
          onclick: (e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const key = m.key;
            closeSheet();
            host.removeModule(key, r.left, r.top);
          },
        }, "remove module"))
      : null;
    s.setAttribute("aria-label", `${name} settings`);
    // The sound's face beside the settings (the specimen's `.ms` figure): the
    // bench's measured face, the same as the one at OUT, never an estimate;
    // "as made" until it is edited, "measured" after, "measuring…" while an
    // edit is on its way to its render.
    const face = el("span", { class: "ms-face" });
    const cap = el("figcaption", { class: "ms-cap" });
    sheet.face = face;
    sheet.cap = cap;
    s.replaceChildren(
      el("div", { class: "ms-grab", "aria-hidden": "true" }),
      head,
      el("div", { class: "ms-body" },
        el("div", { class: "ms-left" }, says ? el("p", { class: "ms-says", text: says }) : null, rows),
        el("figure", { class: "ms-fig", "aria-label": "The sound's face" }, face, cap)),
      foot,
    );
    paintSheet(m);
    const hl = focusAddr && s.querySelector(`.ms-row[data-addr="${CSS.escape(focusAddr)}"]`);
    if (hl) {
      hl.classList.add("hl");
      hl.scrollIntoView?.({ block: "nearest" });
    }
  }

  function rowFor(m, k) {
    const label = String(k.label || "").replace(/_/g, " ");
    if (k.kind.t === "continuous") {
      const val = el("span", { class: "ms-val" });
      const fill = el("i", { class: "ms-fill" });
      const thumb = el("i", { class: "ms-thumb" });
      const track = el("div", {
        class: "ms-track", role: "slider", tabindex: "0", "aria-label": label,
        "aria-valuemin": "0", "aria-valuemax": "1",
      }, el("i", { class: "ms-rail" }), fill, thumb);
      const minus = el("button", { class: "ms-step", type: "button", "aria-label": `Lower ${label}`, text: "−" });
      const plus = el("button", { class: "ms-step", type: "button", "aria-label": `Raise ${label}`, text: "+" });
      const row = el("div", { class: "ms-row", "data-addr": k.addr },
        el("div", { class: "ms-lab" }, el("span", { class: "ms-n", text: label }), val),
        minus, track, plus);
      const r = { addr: k.addr, kind: k.kind, row, val, fill, thumb, track };
      sheet.rows.push(r);
      const set = (v) => setValue(k.addr, Math.max(0, Math.min(1, v)), false);
      const at = (e) => {
        const b = track.getBoundingClientRect();
        set((e.clientX - b.left - 14) / Math.max(1, b.width - 28));
      };
      track.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        try { track.setPointerCapture(e.pointerId); } catch (_) { /* gone */ }
        beginHold();
        at(e);
        const move = (mv) => at(mv);
        const up = () => {
          track.removeEventListener("pointermove", move);
          track.removeEventListener("pointerup", up);
          track.removeEventListener("pointercancel", up);
          endHold();
        };
        track.addEventListener("pointermove", move);
        track.addEventListener("pointerup", up);
        track.addEventListener("pointercancel", up);
      });
      track.addEventListener("keydown", (e) => {
        const v = current(k.addr);
        const step = e.shiftKey ? 0.1 : 0.01;
        let next = null;
        if (e.key === "ArrowRight" || e.key === "ArrowUp") next = v + step;
        else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = v - step;
        else if (e.key === "Home") next = 0;
        else if (e.key === "End") next = 1;
        if (next == null) return;
        e.preventDefault();
        e.stopPropagation();
        host.pushUndo();
        set(next);
        host.releaseHeldEdits();
      });
      stepper(minus, () => set(current(k.addr) - 0.01));
      stepper(plus, () => set(current(k.addr) + 0.01));
      return row;
    }
    // A named setting (a wave, a filter mode) or an octave: its choices.
    const n = k.kind.t === "octave" ? 5 : (k.kind.options || []).length;
    const opts = [];
    for (let i = 0; i < n; i++) {
      const text = k.kind.t === "octave" ? `${i - 2 >= 0 ? "+" : ""}${i - 2}` : String(k.kind.options[i]);
      const b = el("button", { type: "button", role: "radio", tabindex: "-1", "data-v": String(i), text });
      b.addEventListener("click", () => choose(i));
      opts.push(b);
    }
    const choose = (i) => {
      if (Math.round(current(k.addr)) === i) return;
      host.pushUndo();
      setValue(k.addr, i, true);
      host.renderRack();
    };
    const seg = el("div", { class: "ms-seg", role: "radiogroup", "aria-label": label }, ...opts);
    // A radio group: one stop for Tab (the checked choice), and the arrows
    // move between choices, choosing as they go.
    seg.addEventListener("keydown", (e) => {
      const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      e.stopPropagation();
      const at = opts.indexOf(document.activeElement);
      const i = ((at < 0 ? Math.round(current(k.addr)) : at) + d + n) % n;
      choose(i);
      opts[i].focus();
    });
    const row = el("div", { class: "ms-row ms-row-seg", "data-addr": k.addr },
      el("div", { class: "ms-lab" }, el("span", { class: "ms-n", text: label })), seg);
    sheet.rows.push({ addr: k.addr, kind: k.kind, row, seg });
    return row;
  }

  // A held − or + repeats, for the last few hundredths; one undo step for
  // the hold, as a knob drag is one.
  function stepper(b, fn) {
    let t = null;
    let r = null;
    const stop = () => {
      if (t == null && r == null) return;
      clearTimeout(t);
      clearInterval(r);
      t = r = null;
      endHold();
    };
    b.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      beginHold();
      fn();
      t = setTimeout(() => { r = setInterval(fn, 60); }, 380);
    });
    for (const ev of ["pointerup", "pointerleave", "pointercancel"]) b.addEventListener(ev, stop);
    b.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      e.stopPropagation();
      host.pushUndo();
      fn();
      host.releaseHeldEdits();
    });
  }

  // While a finger is on a slider the rack is not rebuilt under it (the same
  // rule as a knob held on the rack, `knobDragging`), and the engine hears
  // the value it settles on.
  function beginHold() {
    if (sheet.holding) return;
    sheet.holding = true;
    host.pushUndo();
    host.setKnobDragging(true);
  }
  function endHold() {
    if (!sheet.holding) return;
    sheet.holding = false;
    host.setKnobDragging(false);
    host.releaseHeldEdits();
    host.renderRack();
  }

  /** A setting's value as the player last set it: the rack's, with every
   *  write still in the lane drawn over it (`overlayPending`). */
  function current(addr) {
    const k = host.knobByAddr(addr);
    return k ? Number(k.value) : 0;
  }

  function setValue(addr, v, isIndex) {
    const k = host.knobByAddr(addr);
    if (!k) return;
    k.value = v;
    host.sendEdit(addr, v, isIndex);
    host.paintRackKnob(addr);
    const m = moduleByUid(sheet.uid, sheet.key);
    if (m) paintSheet(m);
  }

  /** The sheet's lane buttons, read off the lane on the rack as it is now. */
  function paintLane() {
    const L = sheet.lane;
    if (!L) return;
    const svg = host.rackSvg();
    const plate = svg && svg.querySelector(`g.mod-group[data-key="${CSS.escape(L.key)}"]`);
    const stops = plate ? [...plate.querySelectorAll("[data-stop]")] : [];
    L.box.replaceChildren();
    for (const s of stops) {
      if (s.closest(".hidden")) continue;
      const word = (s.querySelector(".ain-btn-text, .ain-dev-text")?.textContent || s.getAttribute("aria-label") || "").trim();
      const on = s.getAttribute("aria-pressed") === "true" || s.classList.contains("on");
      const b = el("button", {
        class: `ms-lane-btn${on ? " on" : ""}`, type: "button", "data-stop": s.dataset.stop,
        "aria-label": s.getAttribute("aria-label") || word,
        "aria-pressed": s.hasAttribute("aria-pressed") ? String(on) : null,
        text: word,
      });
      b.addEventListener("click", () => {
        const now = plate.isConnected ? s : host.rackSvg()?.querySelector(`g.mod-group[data-key="${CSS.escape(L.key)}"] [data-stop="${s.dataset.stop}"]`);
        now?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
        // What the press changed (MONITOR lit, RECORD rolling), said back.
        setTimeout(paintLane, 60);
        setTimeout(paintLane, 600);
      });
      L.box.append(b);
    }
  }

  function paintSheet(m) {
    if (!sheet.el) return;
    paintLane();
    if (sheet.face) {
      host.paintFace?.(sheet.face);
      const st = host.benchState?.() || {};
      sheet.cap.textContent = st.pending ? "measuring…" : st.dirty ? "measured" : "as made";
    }
    const variant = knobVariant(m);
    for (const r of sheet.rows) {
      const k = (m.knobs || []).find((x) => x.addr === r.addr) || host.knobByAddr(r.addr);
      if (!k) continue;
      const v = Number(k.value);
      if (r.kind.t === "continuous") {
        const t = Math.max(0, Math.min(1, v));
        const pos = `calc(14px + ${t.toFixed(4)} * (100% - 28px))`;
        r.thumb.style.left = pos;
        r.fill.style.width = `calc(${t.toFixed(4)} * (100% - 28px))`;
        r.val.textContent = host.heardUnit(r.addr, v, m.kind, variant);
        r.track.setAttribute("aria-valuenow", v.toFixed(3));
        r.track.setAttribute("aria-valuetext", host.heardUnit(r.addr, v, m.kind, variant, true));
      } else {
        for (const b of r.seg.children) {
          const on = Number(b.dataset.v) === Math.round(v);
          b.setAttribute("aria-checked", String(on));
          b.tabIndex = on ? 0 : -1;
        }
      }
    }
  }

  /** The rack was described again: the open sheet follows its module (by
   *  identity, as a lock does), or closes if the module has gone. */
  function syncSheet() {
    if (!sheet.el || !sheet.el.classList.contains("on")) return;
    const m = moduleByUid(sheet.uid, sheet.key);
    if (!m) { closeSheet(); return; }
    const same = sheet.rows.length === (m.knobs || []).length && sheet.rows.every((r, i) => r.addr === m.knobs[i].addr);
    sheet.key = m.key;
    if (same || sheet.holding) paintSheet(m);
    else renderSheet(m);
  }

  // A tap on a module, on a touch screen: a press that lifts where it went
  // down. A knob dragged is a knob turned, and a jack, ⋯, lock or plate button
  // (`data-stop`: AUDIO IN's MONITOR, NEW CLIP and input line, CAPTURE's
  // RECORD) keeps its own meaning.
  // On the document, in capture: the rack's frame takes the pointer for a pan
  // (`#rack-scroll`), so the lift is not seen by the rack itself.
  let tapsWired = false;
  function wireTaps() {
    if (tapsWired) return;
    tapsWired = true;
    let down = null;
    document.addEventListener("pointerdown", (e) => {
      const svg = host.rackSvg();
      if (!host.touch(e) || !svg || !svg.contains(e.target)) { down = null; return; }
      // The event's own time, not the handler's: a busy main thread must not
      // turn a tap into a hold.
      down = { x: e.clientX, y: e.clientY, t: e.timeStamp, target: e.target };
    }, true);
    document.addEventListener("pointerup", (e) => {
      const d = down;
      down = null;
      if (!d || !host.touch(e)) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10 || e.timeStamp - d.t > 600) return;
      const t = d.target;
      if (!t || !t.closest) return;
      if (t.closest(".jack, .mod-menu-btn, .mod-lock, .lock-dot, .rack-guess, [data-stop]")) return;
      const g = t.closest("[data-key]");
      if (!g) return;
      const knob = t.closest("[data-addr]");
      openSheet(g.getAttribute("data-key"), knob ? knob.getAttribute("data-addr") : null);
    }, true);
  }

  // ---------------------------------------------------------------- hooks from main.js
  /** A `bench` reply landed (and main has drawn it). */
  function benchLanded(m) {
    const structural = m.subject !== undefined || m.edited === "structure" || m.edited === "restore";
    if (m.subject !== undefined) {
      // Another sound opened (or this one again): a new patch is over. BACK
      // TO ‹name› ends it the same way.
      if (fresh.on) exitNew();
    }
    if (fresh.pending && m.edited === "restore") {
      fresh.pending = false;
      fresh.depth = host.undoDepth();
    } else if (fresh.on && !fresh.pending && host.undoDepth() < fresh.depth) {
      // ⌘Z past the start of the new patch: the sound it was started from
      // is back, and its guesses are filed under its own id again.
      host.send({ type: "guess_patch_as", token: ++seq, key: fresh.fromId });
      exitNew();
    }
    if (structural) {
      epoch += 1;
      // A place asked about was a place in the structure that just changed:
      // the guess goes back to the output's.
      guess.at = null;
      probe.levels = null;
      probe.tree = null;
      probe.stale = false;
      guess.data = null;
      guess.tree = null;
      guess.skipping = false;
      guess.want = true;
      guess.retries = 0;
      // The rack was rebuilt for this reply before it reached here (main
      // draws, then calls this), with the last structure's levels and guess:
      // a cable whose key survived the edit (`node>amp`) was lit by a level
      // measured on another patch, and the old guess was drawn on the new
      // rack. Painted again now, in the same task, so neither is ever seen.
      paintLevels();
      drawGuess();
    } else if (m.edited !== undefined) {
      // A knob: the cables are where they were, and their levels are no
      // longer measured (hollow marks) until the probe has heard the change.
      if (probe.levels) probe.stale = true;
      // A knob is not ranked again: the guess stands, but the faces beside it
      // describe the tree it was ranked on, which the bench has left. They go
      // until the next ranking (ADR-012); the plate is not rebuilt for it.
      if (guess.tree && guess.tree !== host.benchTreeJson()) {
        host.rackSvg()?.querySelector(":scope > g.rack-guess > g.gp-faces")?.remove();
      }
    }
    probe.want = true;
    renderTools();
    if (!structural) {
      const svg = host.rackSvg();
      const frame = host.rackFrame();
      if (svg && frame) drawMarks(svg, frame);
    }
    syncSheet();
    scheduleSettle(m.subject !== undefined ? ARRIVE_MS : 450);
  }

  /** The rack was built again (`buildRack` replaced every element). */
  function rackBuilt() {
    wireTaps();
    paintLevels();
    drawGuess();
  }

  /** A plate moved without a rebuild (a freeform drag, a relayout's tween
   *  ending): the marks follow their cables. */
  function platesMoved() {
    const svg = host.rackSvg();
    const frame = host.rackFrame();
    if (svg && frame) drawMarks(svg, frame);
    drawGuess();
  }

  function onWorker(m) {
    switch (m.type) {
      case "cable_levels":
        onLevels(m);
        return true;
      case "guess":
        onGuess(m);
        return true;
      case "guess_patch":
        // The key a new patch's guesses are filed under, kept so the new
        // patch, left and come back to, is filed under it again.
        if (fresh.on) fresh.key = m.key;
        return true;
      case "guess_skipped":
        // The next guess the engine ranks, with that family kept away.
        guess.want = true;
        scheduleSettle(0);
        return true;
      default:
        return false;
    }
  }

  /** An edit was refused: a taken guess no longer current says why in the
   *  refusal's toast (main's `edit_rejected`); the guess is ranked again. */
  function rejected() {
    // A new patch the engine would not take is no new patch.
    if (fresh.pending) exitNew();
    if (guess.skipping) {
      guess.skipping = false;
      guess.want = true;
      scheduleSettle();
    }
  }

  /** The model was fitted again: the guess was ranked under the old fit. */
  function refit() {
    guess.want = true;
    scheduleSettle();
  }

  /** KEEP AS NEW landed: a new patch is now a sound of its own. */
  function committed(m) {
    if (m.id > 0 && fresh.on) {
      fresh.saved = null;
      exitNew();
    }
  }

  function shown() {
    renderTools();
    scheduleSettle(ARRIVE_MS);
  }
  function hidden() {
    closeSheet();
  }

  // Esc ends a new patch, back to the sound it was started from, when nothing
  // else on screen is waiting for it.
  // Capture, so the question "is anything else waiting for Esc" is asked
  // before the rack's own handler answers it.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !host.visible()) return;
    if (sheet.el && sheet.el.classList.contains("on")) {
      // One thing a press: the sheet closes, and the rack's chain (the
      // selection, the catalog) waits for the next Esc.
      closeSheet();
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (fresh.on && !host.escBusy() && !e.defaultPrevented) {
      const t = e.target;
      if (t && t.closest && t.closest("input, textarea, select, [contenteditable]")) return;
      backFrom();
      e.preventDefault();
    }
  }, true);

  return {
    onWorker,
    benchLanded,
    rackBuilt,
    modelViewChanged,
    askHere,
    clearHere,
    asking: () => guess.at,
    platesMoved,
    cameraMoved,
    restLevel,
    subject,
    rejected,
    refit,
    committed,
    shown,
    hidden,
    renderTools,
    counts,
    isNew: () => fresh.on,
    openSheet,
    closeSheet,
    // For the debugging handle (`window.__aur`), never for a test to drive.
    state: () => ({ epoch, probe: { ...probe, levels: probe.levels ? Object.fromEntries(probe.levels) : null }, guess: { ...guess }, fresh: { ...fresh } }),
  };
}
