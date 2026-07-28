// EVOSYNTH web app — main thread: UI, WebAudio playback, instrumentation.
// All engine compute (rendering, MCMC) lives in worker.js.

const $ = (id) => document.getElementById(id);

const worker = new Worker("./worker.js", { type: "module" });
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

// ---------- state ----------
const renders = new Map(); // idx -> {buffer: AudioBuffer, sexpr}
let currentDuel = null;    // [a, b]
let duelsSinceFit = 0;
const FIT_EVERY = 6;
let fitting = false;
let playingSrc = null;
const bench = [];          // {idx, sexpr, stars}

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
      drawTaste(null);
      send({ type: "duel" });
      break;
    }
    case "duel": {
      currentDuel = m.pair;
      renders.delete(-1);
      loadSide("a", m.pair[0]);
      loadSide("b", m.pair[1]);
      break;
    }
    case "render": {
      const buf = audioCtx.createBuffer(1, m.buffer.length, m.sampleRate);
      buf.copyToChannel(m.buffer, 0);
      renders.set(m.idx, { buffer: buf, sexpr: m.sexpr });
      onRenderArrived(m.idx);
      break;
    }
    case "status": {
      $("duel-count").textContent = m.status.observations;
      $("session-num").textContent = m.status.session;
      break;
    }
    case "fitted": {
      fitting = false;
      $("led-learn").classList.remove("on");
      drawTaste(m.taste);
      break;
    }
    case "refined": {
      $("led-evolve").classList.remove("on");
      $("evolve-btn").disabled = false;
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
      if (m.ok) $("session-num").textContent = m.status.session;
      break;
    }
  }
};

// ---------- duel flow ----------
function loadSide(side, idx) {
  $(`readout-${side}`).textContent = "…";
  clearScope($(`scope-${side}`));
  if (renders.has(idx)) onRenderArrived(idx);
  else send({ type: "render", idx });
}

function onRenderArrived(idx) {
  if (!currentDuel) return;
  const side = idx === currentDuel[0] ? "a" : idx === currentDuel[1] ? "b" : null;
  if (!side) return;
  const r = renders.get(idx);
  $(`readout-${side}`).textContent = r.sexpr;
  drawWave($(`scope-${side}`), r.buffer.getChannelData(0));
}

function play(idx, btn) {
  const r = renders.get(idx);
  if (!r) return;
  if (audioCtx.state === "suspended") audioCtx.resume();
  if (playingSrc) { try { playingSrc.stop(); } catch (_) {} }
  const src = audioCtx.createBufferSource();
  src.buffer = r.buffer;
  src.connect(audioCtx.destination);
  src.start();
  playingSrc = src;
  if (btn) {
    btn.classList.add("playing");
    src.onended = () => btn.classList.remove("playing");
  }
}

function choose(side) {
  if (!currentDuel) return;
  const [a, b] = currentDuel;
  const choseA = side === "a";
  const winner = choseA ? a : b;
  send({ type: "record_duel", a, b, choseA });
  addToBench(winner);
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
function addToBench(idx) {
  if (bench.some((b) => b.idx === idx)) return;
  const r = renders.get(idx);
  bench.unshift({ idx, sexpr: r ? r.sexpr : `#${idx}`, stars: 0 });
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
    const name = item.sexpr.length > 42 ? item.sexpr.slice(0, 42) + "…" : item.sexpr;
    el.innerHTML = `
      <div class="b-name">${name}</div>
      <div class="b-row">
        <button class="b-play" title="Play">▶</button>
        ${[1, 2, 3, 4, 5]
          .map((s) => `<button class="star ${item.stars >= s ? "lit" : ""}" data-s="${s}" title="${s} star${s > 1 ? "s" : ""}">★</button>`)
          .join("")}
        <button class="b-kill" title="Cut from the bench">cut</button>
      </div>`;
    el.querySelector(".b-play").onclick = () => {
      if (renders.has(item.idx)) play(item.idx);
      else {
        send({ type: "render", idx: item.idx });
        const wait = setInterval(() => {
          if (renders.has(item.idx)) { clearInterval(wait); play(item.idx); }
        }, 120);
      }
    };
    el.querySelectorAll(".star").forEach((btn) => {
      btn.onclick = () => {
        item.stars = Number(btn.dataset.s);
        send({ type: "record_stars", idx: item.idx, rating: item.stars });
        renderBench();
      };
    });
    el.querySelector(".b-kill").onclick = () => {
      send({ type: "record_keep", idx: item.idx, kept: false });
      bench.splice(bench.indexOf(item), 1);
      renderBench();
    };
    list.appendChild(el);
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

// ---------- taste CRT ----------
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

function drawTaste(taste) {
  const canvas = $("taste-crt");
  const ctx = scopeCtx(canvas);
  const { width: w, height: h } = canvas;
  const dpr = window.devicePixelRatio || 1;
  ctx.clearRect(0, 0, w, h);
  drawGraticule(ctx, w, h, "rgba(255,180,84,0.06)");

  ctx.font = `${10 * dpr}px "IBM Plex Mono", monospace`;

  if (!taste) {
    ctx.fillStyle = "#7a5526";
    ctx.textAlign = "center";
    ctx.fillText("NO TASTE ON RECORD", w / 2, h / 2 - 8 * dpr);
    ctx.fillText("— duel to teach it —", w / 2, h / 2 + 10 * dpr);
    ctx.textAlign = "left";
    return;
  }

  // Strongest 14 dimensions by |mean|, drawn as deflection bars from center.
  const rows = [...taste].sort((x, y) => Math.abs(y.mean) - Math.abs(x.mean)).slice(0, 14);
  const maxAbs = Math.max(0.15, ...rows.map((r) => Math.abs(r.mean) + r.std));
  const cx = w * 0.60;
  const usable = w * 0.32;
  const rowH = h / (rows.length + 1);

  ctx.strokeStyle = "rgba(255,180,84,0.25)";
  ctx.beginPath(); ctx.moveTo(cx, rowH * 0.4); ctx.lineTo(cx, h - rowH * 0.4); ctx.stroke();

  rows.forEach((r, i) => {
    const y = rowH * (i + 1);
    const len = (r.mean / maxAbs) * usable;
    const wl = (r.std / maxAbs) * usable;

    // label
    ctx.fillStyle = "#a08050";
    ctx.textAlign = "right";
    ctx.fillText(NICE_NAMES[r.name] || r.name, cx - usable - 10 * dpr, y + 3 * dpr);
    ctx.textAlign = "left";

    // bar
    ctx.fillStyle = r.mean >= 0 ? "#ffb454" : "#c47445";
    ctx.shadowColor = "rgba(255,180,84,0.7)";
    ctx.shadowBlur = 8;
    ctx.fillRect(Math.min(cx, cx + len), y - 3 * dpr, Math.abs(len), 6 * dpr);
    ctx.shadowBlur = 0;

    // credible-interval whisker
    ctx.strokeStyle = "rgba(255,220,160,0.8)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx + len - wl, y);
    ctx.lineTo(cx + len + wl, y);
    ctx.moveTo(cx + len - wl, y - 3 * dpr); ctx.lineTo(cx + len - wl, y + 3 * dpr);
    ctx.moveTo(cx + len + wl, y - 3 * dpr); ctx.lineTo(cx + len + wl, y + 3 * dpr);
    ctx.stroke();
  });
}

// ---------- controls ----------
$("play-a").onclick = () => currentDuel && play(currentDuel[0], $("play-a"));
$("play-b").onclick = () => currentDuel && play(currentDuel[1], $("play-b"));
$("choose-a").onclick = () => choose("a");
$("choose-b").onclick = () => choose("b");
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

document.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  if (e.key === "1") $("play-a").click();
  else if (e.key === "2") $("play-b").click();
  else if (e.key === "ArrowLeft") $("choose-a").click();
  else if (e.key === "ArrowRight") $("choose-b").click();
});

// ---------- boot ----------
send({ type: "init", seed: Math.floor(Math.random() * 2 ** 31), poolSize: 40 });
