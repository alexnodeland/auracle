// EVOSYNTH web app — main thread: UI, WebAudio playback, instrumentation,
// and the interactive workbench (the patch as hardware). All engine compute
// (rendering, MCMC, evolution) lives in worker.js; candidates are addressed
// by stable id.

const $ = (id) => document.getElementById(id);
const SVG_NS = "http://www.w3.org/2000/svg";

// Version-stamp the worker (and, transitively, the wasm module it imports)
// so a stale browser-cached engine can never run against a newer UI.
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
const bench = [];          // {id, sexpr, stars}

let views = null;          // {map, styles, lineage, ranked} from the worker
let tasteTab = "map";

// Workbench state.
const wb = {
  subjectId: null,   // pool id the bench was loaded from (stale after edits)
  rack: null,        // RackDescription
  buffer: null,      // AudioBuffer of the bench render
  vetOk: true,
  dirty: false,      // edited since load/commit
  locks: new Set(),  // trace addresses frozen for ⚡ evolve
};
let editInFlight = false;
let editQueue = null;      // latest pending {addr, value, isIndex}
let auditionOnSettle = false;
let pendingEvolve = false; // commit-then-evolve chain
let knobDragging = false;  // suppress rack re-render while a knob is held

// ---------- worker protocol ----------
const send = (msg, transfer) => worker.postMessage(msg, transfer || []);

worker.onmessage = (e) => {
  const m = e.data;
  switch (m.type) {
    case "fill_progress": {
      $("boot-fill").style.width = `${(100 * m.pool) / m.target}%`;
      $("boot-status").textContent = `rendering & vetting candidate ${m.pool} / ${m.target}`;
      break;
    }
    case "filled": {
      $("boot").classList.add("hidden");
      $("main").classList.remove("hidden");
      drawTaste();
      send({ type: "duel" });
      send({ type: "taste_views" }); // the map exists before the first fit
      break;
    }
    case "duel": {
      currentDuel = m.pair;
      if (m.pair) {
        loadSide("a", m.pair[0]);
        loadSide("b", m.pair[1]);
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
    case "status": {
      applyStatus(m.status);
      break;
    }
    case "fitted": {
      fitting = false;
      $("led-learn").classList.remove("on");
      views = m.views;
      applyStatus(m.status);
      drawTaste();
      drawLineage();
      break;
    }
    case "refined": {
      $("led-evolve").classList.remove("on");
      $("evolve-btn").disabled = false;
      views = m.views;
      applyStatus(m.status);
      drawTaste();
      drawLineage();
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
        note(`patch #${m.subject} on the bench`);
      }
      if (m.edited !== undefined) wb.dirty = true;
      if (m.buffer && m.buffer.length > 0) {
        const buf = audioCtx.createBuffer(1, m.buffer.length, m.sampleRate);
        buf.copyToChannel(m.buffer, 0);
        wb.buffer = buf;
      } else {
        wb.buffer = null;
      }
      if (!wb.vetOk) note("⚠ this setting fails the safety vet — audio withheld until you turn back");
      if (!knobDragging) renderRack();
      editInFlight = false;
      if (editQueue) {
        const q = editQueue;
        editQueue = null;
        sendEdit(q.addr, q.value, q.isIndex);
      } else if (auditionOnSettle) {
        auditionOnSettle = false;
        playBench();
      }
      break;
    }
    case "committed": {
      views = m.views;
      applyStatus(m.status);
      if (m.id > 0) {
        wb.subjectId = m.id;
        wb.dirty = false;
        addToBench(m.id, currentSexpr());
        note(`committed as patch #${m.id}${$("improve-check").checked ? " · taught: your edit beat the original" : ""}`);
        if (pendingEvolve) {
          pendingEvolve = false;
          startEvolveFrom(m.id);
        }
      } else {
        pendingEvolve = false;
        note("commit failed (duplicate or unvetted state)");
      }
      drawTaste();
      renderRack();
      break;
    }
    case "evolved_from": {
      $("rack-evolve").disabled = false;
      $("led-evolve").classList.remove("on");
      views = m.views;
      applyStatus(m.status);
      drawTaste();
      drawLineage();
      if (m.childId > 0) {
        note(`⚡ gen ${m.status.generation}: evolution proposed patch #${m.childId} — now on the bench`);
        send({ type: "edit_begin", id: m.childId });
        addToBench(m.childId, null);
      } else {
        note("⚡ evolution found no accepted move — try again, or loosen some locks");
      }
      break;
    }
    case "edit_rejected": {
      editInFlight = false;
      if (editQueue) {
        const q = editQueue;
        editQueue = null;
        sendEdit(q.addr, q.value, q.isIndex);
      }
      break;
    }
    case "taste_views": {
      views = m.views;
      drawTaste();
      drawLineage();
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
      } else {
        note("could not read that profile file");
      }
      break;
    }
  }
};

function applyStatus(st) {
  $("duel-count").textContent = st.observations;
  $("session-num").textContent = st.session;
  $("gen-count").textContent = st.generation;
}

function note(text) {
  $("rack-note").textContent = text;
}

function currentSexpr() {
  return wb.rack ? rackTitle(wb.rack) : null;
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

function playBuffer(buffer, btn) {
  if (!buffer) return;
  if (audioCtx.state === "suspended") audioCtx.resume();
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

function choose(side) {
  if (!currentDuel) return;
  const [a, b] = currentDuel;
  const choseA = side === "a";
  const winner = choseA ? a : b;
  send({ type: "record_duel", a, b, choseA });
  addToBench(winner, renders.get(winner)?.sexpr);
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

// ---------- bench ----------
function addToBench(id, sexpr) {
  if (bench.some((b) => b.id === id)) return;
  bench.unshift({ id, sexpr: sexpr || `patch #${id}`, stars: 0 });
  if (bench.length > 12) bench.pop();
  renderBench();
}

function renderBench() {
  const list = $("bench-list");
  list.innerHTML = "";
  if (bench.length === 0) {
    list.innerHTML = '<div class="bench-empty">No keepers yet.</div>';
    return;
  }
  for (const item of bench) {
    const el = document.createElement("div");
    el.className = "bench-item";
    const name = item.sexpr.length > 38 ? item.sexpr.slice(0, 38) + "…" : item.sexpr;
    el.innerHTML = `
      <div class="b-name">${name}</div>
      <div class="b-row">
        <button class="b-play" title="Play">▶</button>
        <button class="b-open" title="Open on the workbench">⌖</button>
        ${[1, 2, 3, 4, 5]
          .map((s) => `<button class="star ${item.stars >= s ? "lit" : ""}" data-s="${s}" title="${s} star${s > 1 ? "s" : ""}">★</button>`)
          .join("")}
        <button class="b-kill" title="Cut from the bench">cut</button>
      </div>`;
    el.querySelector(".b-play").onclick = () => {
      if (renders.has(item.id)) play(item.id);
      else {
        send({ type: "render", id: item.id });
        const wait = setInterval(() => {
          if (renders.has(item.id)) { clearInterval(wait); play(item.id); }
        }, 120);
      }
    };
    el.querySelector(".b-open").onclick = () => openOnBench(item.id);
    el.querySelectorAll(".star").forEach((btn) => {
      btn.onclick = () => {
        item.stars = Number(btn.dataset.s);
        send({ type: "record_stars", id: item.id, rating: item.stars });
        renderBench();
      };
    });
    el.querySelector(".b-kill").onclick = () => {
      send({ type: "record_keep", id: item.id, kept: false });
      bench.splice(bench.indexOf(item), 1);
      renderBench();
    };
    list.appendChild(el);
  }
}

// ---------- workbench ----------
function openOnBench(id) {
  send({ type: "edit_begin", id });
}

function sendEdit(addr, value, isIndex) {
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

function rackTitle(rack) {
  const kinds = rack.modules.filter((m) => m.kind !== "amp").map((m) => m.title);
  return kinds.join(" → ") || "empty patch";
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
  svg.innerHTML = "";
  const hasRack = wb.rack && wb.rack.modules && wb.rack.modules.length > 0;
  $("rack-empty").style.display = hasRack ? "none" : "flex";
  const enable = (id, on) => { $(id).disabled = !on; };
  enable("rack-play", hasRack && wb.vetOk);
  enable("rack-commit", hasRack && wb.dirty && wb.vetOk);
  enable("rack-evolve", hasRack);
  enable("lock-knobs", hasRack);
  enable("lock-structure", hasRack);
  enable("lock-clear", hasRack && wb.locks.size > 0);
  if (!hasRack) return;

  // defs: plate + knob gradients.
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
  const maxCol = Math.max(...wb.rack.modules.map((m) => m.column));
  const byCol = new Map();
  for (const m of wb.rack.modules) {
    const cx = maxCol - m.column; // 0 = leftmost (deepest)
    if (!byCol.has(cx)) byCol.set(cx, []);
    byCol.get(cx).push(m);
  }
  const nCols = maxCol + 1;
  const pos = new Map(); // key -> {x, y, w, h}
  let maxHeight = 0;
  for (const [cx, mods] of byCol) {
    let stack = 0;
    for (const m of mods) stack += moduleHeight(m) + 16;
    maxHeight = Math.max(maxHeight, stack);
  }
  const svgH = Math.max(240, maxHeight + 24);
  const svgW = nCols * COL_W + 30;
  svg.setAttribute("width", svgW);
  svg.setAttribute("height", svgH);
  svg.setAttribute("viewBox", `0 0 ${svgW} ${svgH}`);
  for (const [cx, mods] of byCol) {
    let total = mods.reduce((s, m) => s + moduleHeight(m) + 16, -16);
    let y = (svgH - total) / 2;
    for (const m of mods) {
      const h = moduleHeight(m);
      pos.set(m.key, { x: 15 + cx * COL_W, y, w: MOD_W, h });
      y += h + 16;
    }
  }

  // Wires first (under modules).
  const wireLayer = svgEl("g", {});
  svg.appendChild(wireLayer);
  for (const w of wb.rack.wires) {
    const from = pos.get(w.from);
    const to = pos.get(w.to);
    if (!from || !to) continue;
    const x1 = from.x + from.w;
    const y1 = from.y + from.h / 2;
    const x2 = to.x;
    const y2 = to.y + to.h / 2;
    const dx = Math.max(24, (x2 - x1) / 2);
    const sag = 14 + Math.abs(y2 - y1) * 0.08;
    const d = `M ${x1} ${y1} C ${x1 + dx} ${y1 + sag}, ${x2 - dx} ${y2 + sag}, ${x2} ${y2}`;
    wireLayer.appendChild(svgEl("path", { d }, `wire ${w.kind}-glow`));
    wireLayer.appendChild(svgEl("path", { d }, `wire ${w.kind}`));
    wireLayer.appendChild(svgEl("circle", { cx: x1, cy: y1, r: 3.4 }, "port"));
    wireLayer.appendChild(svgEl("circle", { cx: x2, cy: y2, r: 3.4 }, "port"));
  }

  // Modules.
  for (const m of wb.rack.modules) {
    const p = pos.get(m.key);
    const g = svgEl("g", { transform: `translate(${p.x},${p.y})` });
    const plateCls = `mod-plate${m.is_mod ? " modside" : ""}${isModuleLocked(m) ? " locked" : ""}`;
    g.appendChild(svgEl("rect", { width: p.w, height: p.h, rx: 5 }, plateCls));
    const title = svgEl("text", { x: 9, y: 17 }, `mod-title${m.is_mod ? " modside" : ""}`);
    title.textContent = m.title;
    g.appendChild(title);

    // Module lock (padlock glyph) — locks type + all controls.
    const lockOn = isModuleLocked(m);
    const mlock = svgEl("text", { x: p.w - 16, y: 17 }, `mod-lock${lockOn ? " on" : ""}`);
    mlock.textContent = lockOn ? "▣" : "▢";
    const mtitle = svgEl("title", {});
    mtitle.textContent = lockOn
      ? "Unlock this module (evolution may change it again)"
      : "Lock this whole module (evolution keeps it exactly as-is)";
    mlock.appendChild(mtitle);
    mlock.addEventListener("click", () => {
      const addrs = moduleLockAddrs(m);
      const on = isModuleLocked(m);
      for (const a of addrs) on ? wb.locks.delete(a) : wb.locks.add(a);
      renderRack();
    });
    g.appendChild(mlock);

    m.knobs.forEach((k, i) => {
      const { x, y } = knobPos(m, i);
      const kg = svgEl("g", { transform: `translate(${x},${y})` });
      const locked = wb.locks.has(k.addr);

      if (k.kind.t === "continuous") {
        // Rotary knob: −135°..+135°.
        kg.appendChild(svgEl("circle", { r: KNOB_R + 3 }, "knob-ring"));
        const body = svgEl("circle", { r: KNOB_R }, "knob-body");
        const tt = svgEl("title", {});
        tt.textContent = `${k.label}: ${k.value.toFixed(2)} — drag up/down`;
        body.appendChild(tt);
        kg.appendChild(body);
        const ang = (-135 + 270 * k.value) * (Math.PI / 180);
        const ix = Math.sin(ang) * (KNOB_R - 3);
        const iy = -Math.cos(ang) * (KNOB_R - 3);
        kg.appendChild(
          svgEl("line", { x1: 0, y1: 0, x2: ix, y2: iy }, `knob-ind${m.is_mod ? " modside" : ""}`)
        );
        if (locked) kg.appendChild(svgEl("circle", { r: KNOB_R + 6 }, "knob-locked-halo"));
        attachKnobDrag(body, m, k);
      } else {
        // Enum / octave selector: click to cycle (shift = backwards).
        const bw = 52;
        const body = svgEl("rect", { x: -bw / 2, y: -11, width: bw, height: 22, rx: 3 }, "enum-body");
        const txt = svgEl("text", { y: 4 }, "enum-text");
        txt.textContent = enumDisplay(k);
        const tt = svgEl("title", {});
        tt.textContent = `${k.label} — click to cycle`;
        body.appendChild(tt);
        body.addEventListener("click", (ev) => {
          const n = k.kind.t === "octave" ? 5 : k.kind.options.length;
          const next = (Math.round(k.value) + (ev.shiftKey ? n - 1 : 1)) % n;
          k.value = next;
          txt.textContent = enumDisplay(k);
          auditionOnSettle = true;
          sendEdit(k.addr, next, true);
        });
        kg.appendChild(body);
        kg.appendChild(txt);
        if (locked) {
          kg.appendChild(svgEl("rect", { x: -bw / 2 - 3, y: -14, width: bw + 6, height: 28, rx: 5 }, "knob-locked-halo"));
        }
      }

      // Per-control lock dot.
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

  const subj = wb.subjectId != null ? `patch #${wb.subjectId}${wb.dirty ? " · edited" : ""}` : "";
  const lockInfo = wb.locks.size ? ` · ${wb.locks.size} locked` : "";
  $("rack-subject").textContent = `— ${subj}${lockInfo}${wb.vetOk ? "" : " · ⚠ UNVETTED"}`;
}

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
      auditionOnSettle = true;
      if (!editInFlight && !editQueue) {
        auditionOnSettle = false;
        playBench();
      }
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
  n_lfo: "LFO mods", n_env: "env mods", depth: "patch depth", size: "patch size",
  mod_density: "mod density", amp_attack: "amp attack", amp_sustain: "amp sustain",
  amp_release: "amp release",
};

const STYLE_COLORS = ["#ffb454", "#8ef0b1", "#7ec8ff", "#ff8fb2", "#d9d4c8"];
const CAPTIONS = {
  map: "Every patch you’ve heard, mapped by sound & structure. Glow is how much the model thinks you’d like it — islands are styles. Click a dot to open it on the workbench.",
  styles: "Your taste as separate styles: each lens claims part of the pool and champions its own exemplar patches. Dim lenses are idle.",
  dir: "What each style listens for — learned directions in sound, not settings. Longer bar = stronger pull.",
};

let mapHits = []; // {x, y, id} in canvas coords, for click-to-open

function drawTaste() {
  const canvas = $("taste-crt");
  const ctx = scopeCtx(canvas);
  const { width: w, height: h } = canvas;
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
  const pad = 30 * dpr;
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const sx = (v) => pad + ((v - x0) / Math.max(1e-9, x1 - x0)) * (w - 2 * pad);
  const sy = (v) => pad + ((v - y0) / Math.max(1e-9, y1 - y0)) * (h - 2 * pad);
  const us = pts.map((p) => p.utility);
  const [u0, u1] = [Math.min(...us), Math.max(...us)];
  const un = (u) => (u - u0) / Math.max(1e-9, u1 - u0);

  // History ghosts underneath, pool on top.
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
      const r = (p.origin === "edited" ? 5 : p.origin === "refined" ? 4.4 : 3.6) * dpr;
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

    // Header: swatch + share.
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = active ? 8 : 0;
    ctx.beginPath();
    ctx.arc(18 * dpr, y0 + 20 * dpr, 5 * dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#d9d4c8";
    ctx.textAlign = "left";
    ctx.fillText(`style ${s.k + 1} — claims ${Math.round(s.share * 100)}% of the pool`, 30 * dpr, y0 + 24 * dpr);

    // Top-4 features as mini deflection bars.
    const rows = [...s.theta].sort((a, b) => Math.abs(b.mean) - Math.abs(a.mean)).slice(0, 4);
    const maxAbs = Math.max(0.12, ...rows.map((r) => Math.abs(r.mean)));
    const cx = w * 0.66, usable = w * 0.26;
    rows.forEach((r, i) => {
      const y = y0 + (38 + i * 17) * dpr;
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
  // Union of each active style's top features.
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

// ---------- lineage ----------
function drawLineage() {
  const lineage = (views && views.lineage) || [];
  const canvas = $("lineage-spark");
  const ctx = scopeCtx(canvas);
  const { width: w, height: h } = canvas;
  const dpr = window.devicePixelRatio || 1;
  ctx.clearRect(0, 0, w, h);
  drawGraticule(ctx, w, h, "rgba(255,180,84,0.05)");

  if (lineage.length > 0) {
    // Champion-utility trajectory across events.
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

  // Log: latest events, humanized.
  const log = $("lineage-log");
  if (lineage.length === 0) return;
  log.innerHTML = lineage
    .slice(-4)
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

// ---------- controls ----------
$("play-a").onclick = () => currentDuel && play(currentDuel[0], $("play-a"));
$("play-b").onclick = () => currentDuel && play(currentDuel[1], $("play-b"));
$("choose-a").onclick = () => choose("a");
$("choose-b").onclick = () => choose("b");
$("inspect-a").onclick = () => currentDuel && openOnBench(currentDuel[0]);
$("inspect-b").onclick = () => currentDuel && openOnBench(currentDuel[1]);
$("evolve-btn").onclick = () => {
  $("evolve-btn").disabled = true;
  $("led-evolve").classList.add("on");
  send({ type: "refine" });
};
$("export-btn").onclick = () => send({ type: "export" });
$("import-input").onchange = async (e) => {
  const file = e.target.files[0];
  if (file) send({ type: "import", json: await file.text() });
};

$("rack-play").onclick = () => playBench();
$("rack-commit").onclick = () => {
  send({ type: "edit_commit", asImprovement: $("improve-check").checked });
};
$("rack-evolve").onclick = () => {
  if (wb.subjectId == null) return;
  if (wb.dirty) {
    // Uncommitted edits: commit first (respecting the improvement toggle),
    // then evolve from the committed child.
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
  if (best) openOnBench(best.id);
});

document.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  if (e.key === "1") $("play-a").click();
  else if (e.key === "2") $("play-b").click();
  else if (e.key === "ArrowLeft") $("choose-a").click();
  else if (e.key === "ArrowRight") $("choose-b").click();
});

// ---------- boot ----------
send({ type: "init", seed: Math.floor(Math.random() * 2 ** 31), poolSize: 40 });
