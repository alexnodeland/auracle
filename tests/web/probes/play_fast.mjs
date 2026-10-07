// What the page and the workers do around a fast run of keys (#288): the
// probe behind "playing fast crackles and lags" on a slow laptop. Not a spec
// (the suite matches `*.spec.js` only) and not a gate: it measures and
// prints.
//
//   cd tests/web && AURACLE_TEST_PORT=8823 \
//     ../../www/video/tools/one_browser.sh node probes/play_fast.mjs [flags]
//
//   --browser=chromium|firefox   (chromium)
//   --view=evolve|patch|perform  the level the keys are played in (perform)
//   --preset="Glass Pad"         the sound opened first, so every view plays one patch
//   --cores=4                    navigator.hardwareConcurrency (the Air's), so the farm's width
//                                follows `farmWidth`; Firefox gets dom.maxHardwareConcurrency
//   --farm=N                     ?farm=N, the maintainer's check (0 = the serial path)
//   --throttle=4                 CDP CPU throttling of the page, Chromium only, and the page only
//                                (not the workers, not the audio thread: Chrome's own rule)
//   --rate=16 --seconds=5        notes a second, and how long to play
//   --settle=4                   seconds of nothing, before, to see what the workers do alone
//   --timeline                   print each worker's busy share per 5 s window of the whole run,
//                                and what its time went to, by engine call
//   --audio-slowdown=4.5         make the audio thread k times slower in the real worklet: k-1 shadow
//                                copies of the playing sound's LivePoly are given the same notes and
//                                rendered each quantum beside the real one (the glue is served with
//                                them appended; nothing on disk changes). Not a faster-ageing copy: a
//                                shadow lives at real time, so its voices ring and park as the real ones
//   --offer                      after the settle, press Offer (N) and wait for B to load, then play:
//                                the worklet then renders a second four voices every quantum
//   --runs=1
//
// What it records, in the page's clock unless said:
//
// - **key → note-on**: each keydown's input delay (its `timeStamp` to the
//   capture handler: the main thread was busy, or not), and the time from the
//   handler to the `on` message leaving for the worklet (the page's own work
//   before the note: `liveNoteOn` posts first). The sum is what the player's
//   key waits for the page.
// - **what a note sends**: every message the page posts to the worklet's port
//   (`on`, `off`, `meter`, …) and to the engine worker, counted by type for
//   the playing window, per note.
// - **the worklet's own report** (Chromium: `AudioContext.playbackStats`, the
//   underrun events and the seconds of silence the output was short, and its
//   latency, over the playing window); in both browsers **a render-stall proxy**
//   (`getOutputTimestamp()` every 50 ms: how far the audio clock fell behind
//   the page's clock over the playing window, and its worst single jump; zero
//   when the audio thread keeps up, checked in Chromium against the
//   playbackStats' underruns), **whether B was loaded** (the `b_patch`
//   messages the page had sent before the keys: B renders a second four voices
//   a quantum while it is) and **note latency in
//   audio time**: for each `on`, the audio clock the worklet read when it ran
//   `note_on` (`currentFrame`, posted back by a probe line added to
//   live-audio.js as it is served) minus the context's `currentTime` when the
//   page posted it. A device buffer's worth is the floor; more is the message
//   waiting for the audio thread.
// - **long tasks** (50 ms+; with CPU throttling at rate r a task of 50/r ms
//   unthrottled), and in Chromium the long animation frames with the script
//   that ran longest in each.
// - **frames**: requestAnimationFrame intervals while playing.
// - **the workers' wasm time**: every call of 2 ms or more the engine worker
//   and each farm worker make into the engine, from a prefix put on their
//   scripts (like the suite's SLOW_ENGINE), summed over the idle and the
//   playing windows into a busy fraction per worker.
//
// The machine's own load average is printed with every run, because every one
// of these times stretches with it.
import { createRequire } from "node:module";
import os from "node:os";

const require = createRequire(import.meta.url);
const { chromium, firefox } = require("@playwright/test");

const flags = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, v] = a.slice(2).split("=");
      return [k, v ?? true];
    }),
);
const BROWSER = flags.browser || "chromium";
const VIEW = flags.view || "perform";
const PRESET = flags.preset || "Glass Pad";
const CORES = Number(flags.cores || 4);
const THROTTLE = Number(flags.throttle || 0);
const RATE = Number(flags.rate || 16);
const SECONDS = Number(flags.seconds || 5);
const SETTLE = Number(flags.settle ?? 4);
const RUNS = Number(flags.runs || 1);
const SLOWDOWN = Number(flags["audio-slowdown"] || 1);
const TIMELINE = !!flags.timeline;
const PORT = process.env.AURACLE_TEST_PORT || "8642";
const SEED = 20261005;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A worker's wasm calls, timed: a prefix to worker.js and farm.js, in the
// way perform_budget.js's SLOW_ENGINE wraps the instance. Calls of 2 ms or
// more are logged as [epoch ms, duration, export] and sent over a
// BroadcastChannel the page listens on.
const BUSY = (who) => `(() => {
  const ch = new BroadcastChannel("auracle-probe");
  const who = ${JSON.stringify(who)} + (${who === "farm"} ? "-" + Math.random().toString(36).slice(2, 6) : "");
  const origin = performance.timeOrigin;
  let log = [];
  let sentAt = 0;
  const flush = () => { if (log.length) { ch.postMessage({ who, log }); log = []; } sentAt = performance.now(); };
  setInterval(flush, 250);
  const timed = (name, fn) => function (...args) {
    const t = performance.now();
    const out = fn.apply(this, args);
    const d = performance.now() - t;
    if (d >= 2) log.push([origin + t, d, name]);
    if (performance.now() - sentAt > 250) flush();
    return out;
  };
  const wrap = (inst) => {
    const ex = {};
    for (const [k, v] of Object.entries(inst.exports)) ex[k] = typeof v === "function" ? timed(k, v) : v;
    const fake = Object.create(WebAssembly.Instance.prototype);
    Object.defineProperty(fake, "exports", { value: Object.freeze(ex) });
    return fake;
  };
  const wrapResult = (r) => (r instanceof WebAssembly.Instance ? wrap(r) : r && r.instance ? { module: r.module, instance: wrap(r.instance) } : r);
  const instantiate = WebAssembly.instantiate.bind(WebAssembly);
  WebAssembly.instantiate = (...a) => instantiate(...a).then(wrapResult);
  if (WebAssembly.instantiateStreaming) {
    const streaming = WebAssembly.instantiateStreaming.bind(WebAssembly);
    WebAssembly.instantiateStreaming = (...a) => streaming(...a).then(wrapResult);
  }
})();
`;

// The page's side: what leaves it, what the keys do, what blocks it.
const PAGE = (cores) => `(() => {
  try { Object.defineProperty(navigator, "hardwareConcurrency", { get: () => ${cores} }); } catch (_) {}
  const P = (window.__probe = { worklet: [], engine: [], keys: [], long: [], loaf: [], frames: [], busy: [], onAt: [], ots: [] });
  setInterval(() => {
    try {
      const t = window.__aur.audioCtx.getOutputTimestamp();
      if (t && t.performanceTime > 0) P.ots.push([t.contextTime, t.performanceTime]);
    } catch (_) {}
  }, 50);
  const wpost = MessagePort.prototype.postMessage;
  MessagePort.prototype.postMessage = function (d, ...rest) {
    if (d && typeof d.type === "string") {
      P.worklet.push([performance.now(), d.type]);
      if (d.type === "on") { try { P.onAt.push(window.__aur.audioCtx.currentTime); } catch (_) { P.onAt.push(NaN); } }
    }
    return wpost.call(this, d, ...rest);
  };
  const epost = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function (d, ...rest) {
    if (d && typeof d.type === "string") P.engine.push([performance.now(), d.type]);
    return epost.call(this, d, ...rest);
  };
  addEventListener("keydown", (e) => { if (!e.repeat) P.keys.push([e.timeStamp, performance.now(), e.key]); }, true);
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) P.long.push([e.startTime, e.duration]); }).observe({ type: "longtask", buffered: true });
  } catch (_) {}
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        const top = [...(e.scripts || [])].sort((a, b) => b.duration - a.duration)[0];
        P.loaf.push([e.startTime, e.duration, e.blockingDuration, top ? (top.sourceFunctionName || top.invoker || "") + " " + (top.sourceURL || "").split("/").pop() + ":" + (top.sourceCharPosition ?? "") + " " + Math.round(top.duration) + "ms" : ""]);
      }
    }).observe({ type: "long-animation-frame", buffered: true });
  } catch (_) {}
  const ch = new BroadcastChannel("auracle-probe");
  ch.onmessage = (e) => P.busy.push(e.data);
  let last = performance.now();
  const frame = (t) => { P.frames.push([t, t - last]); last = t; requestAnimationFrame(frame); };
  requestAnimationFrame(frame);
  try {
    localStorage.setItem("auracle-played", "1");
    localStorage.setItem("auracle-bench-tour", "1");
    localStorage.setItem("auracle-bank-toured", "1");
    localStorage.setItem("auracle-warmed", "1");
  } catch (_) {}
  // The films' seeded Math.random, so the session deals what it dealt.
  let s = ${SEED} >>> 0;
  Math.random = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
})();
`;

// Appended to the engine's glue as the worklet (and the page, and the engine
// worker, which never call process_ptr) load it: k-1 shadow LivePolys of the
// sound being played, each given every note the real one gets and rendered
// once a quantum (a fraction of them on the quanta in between), so the audio
// thread spends k times what the sound costs it.
const SHADOWS = (k, tree) => `
;(() => {
  const K = ${k};
  const TREE = ${JSON.stringify(tree)};
  const isShadow = new WeakSet();
  const shadows = new WeakMap();
  const forward = ["note_on", "note_off", "all_off", "set_bend", "set_glide", "set_unison"];
  const orig = {};
  for (const n of forward) {
    orig[n] = LivePoly.prototype[n];
    LivePoly.prototype[n] = function (...a) {
      const s = shadows.get(this);
      if (s) for (const p of s.list) orig[n].apply(p, a);
      return orig[n].apply(this, a);
    };
  }
  const proc = LivePoly.prototype.process_ptr;
  LivePoly.prototype.process_ptr = function (n) {
    if (isShadow.has(this)) return proc.call(this, n);
    let s = shadows.get(this);
    if (!s) {
      s = { list: [], acc: 0 };
      for (let i = 0; i < Math.ceil(K - 1); i++) { const p = new LivePoly(TREE, sampleRate, 4); isShadow.add(p); s.list.push(p); }
      shadows.set(this, s);
    }
    s.acc += K - 1;
    const runs = Math.floor(s.acc);
    s.acc -= runs;
    for (let i = 0; i < runs; i++) proc.call(s.list[i], n);
    return proc.call(this, n);
  };
})();
`;

// A preset's tree, as the engine hands it out, read here in node.
async function presetTree(name) {
  const pkg = new URL("../../../apps/web/pkg/", import.meta.url).pathname;
  const { readFileSync } = await import("node:fs");
  const mod = await import(`${pkg}auracle_wasm.js`);
  mod.initSync({ module: readFileSync(`${pkg}auracle_wasm_bg.wasm`) });
  const e = new mod.WasmEngine(1n, 4);
  const p = JSON.parse(e.preset_list()).find((x) => x.name === name);
  if (!p) throw new Error(`no preset called ${name}`);
  return e.preset_tree_json(p.index);
}

const pct = (xs, p) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))] : NaN);
const f = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : "-");

async function run(n) {
  const loadBefore = os.loadavg()[0];
  const launch =
    BROWSER === "firefox"
      ? () => firefox.launch({ firefoxUserPrefs: { "dom.maxHardwareConcurrency": CORES, "media.autoplay.default": 0, "media.autoplay.blocking_policy": 0 } })
      : () => chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const browser = await launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.log(`  [pageerror] ${e.message}`));
    await page.addInitScript(PAGE(CORES));
    for (const [pat, who] of [[/\/worker\.js(\?|$)/, "engine"], [/\/farm\.js(\?|$)/, "farm"]]) {
      await page.route(pat, async (route) => {
        const resp = await route.fetch();
        await route.fulfill({ response: resp, body: BUSY(who) + (await resp.text()), contentType: "text/javascript" });
      });
    }
    await page.route(/\/live-audio\.js(\?|$)/, async (route) => {
      const resp = await route.fetch();
      const src = (await resp.text()).replace(
        "this.held.set(m.note, vel);",
        'this.held.set(m.note, vel); this.port.postMessage({ type: "probe_on", frame: currentFrame, sr: sampleRate });',
      );
      if (!src.includes("probe_on")) throw new Error("live-audio.js has no `this.held.set(m.note, vel);` to hang the probe on");
      await route.fulfill({ response: resp, body: src, contentType: "text/javascript" });
    });
    if (SLOWDOWN > 1) {
      const tree = await presetTree(PRESET);
      await page.route(/\/pkg\/auracle_wasm\.js(\?|$)/, async (route) => {
        const resp = await route.fetch();
        await route.fulfill({ response: resp, body: (await resp.text()) + SHADOWS(SLOWDOWN, tree), contentType: "text/javascript" });
      });
    }
    const params = new URLSearchParams({ seed: String(SEED) });
    if (flags.farm !== undefined) params.set("farm", String(flags.farm));
    await page.goto(`http://localhost:${PORT}/?${params}`);
    await page.locator("#boot.done").waitFor({ state: "attached", timeout: 240_000 });
    // The sound the keys play: a preset, opened as a player opens one.
    await page.locator('.bank-tabs [role=tab][data-bank="presets"]').click();
    await page.locator(".bank-item", { hasText: PRESET }).first().click();
    await page.locator("#rack-subject", { hasText: PRESET }).waitFor({ state: "attached", timeout: 90_000 });
    await page.locator(`.rail-stop[data-level="${VIEW}"]`).click();
    if (VIEW === "perform") {
      await page.locator(".pf-name", { hasText: PRESET }).waitFor({ timeout: 60_000 });
      await page.waitForFunction(() => /controls reach/.test(document.querySelector(".pf-status")?.textContent || ""), null, { timeout: 120_000 });
    }
    if (THROTTLE > 1 && BROWSER === "chromium") {
      const cdp = await ctx.newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
    }
    const state = await page.evaluate(() => ({ cores: navigator.hardwareConcurrency, ctx: window.__aur?.audioCtx?.state, rate: window.__aur?.audioCtx?.sampleRate }));

    // Nothing: what the workers do while the player does nothing.
    const t0 = await page.evaluate(() => performance.now());
    await sleep(SETTLE * 1000);
    if (flags.offer) {
      await page.keyboard.press("n");
      await page.waitForFunction(() => window.__probe.worklet.some((m) => m[1] === "b_patch"), null, { timeout: 180_000 });
      await sleep(1000);
    }

    const t1 = await page.evaluate(() => {
      const s = window.__aur.audioCtx.playbackStats;
      window.__stats0 = s ? { ...s.toJSON() } : null;
      return performance.now();
    });

    // A fast run: a new key every 1/RATE s, each let go after 60% of the gap.
    const KEYS = ["a", "s", "d", "f", "g", "h", "j", "k"];
    const gap = 1000 / RATE;
    const notes = Math.round(SECONDS * RATE);
    const start = Date.now();
    for (let i = 0; i < notes; i++) {
      const k = KEYS[i % KEYS.length];
      const at = start + i * gap;
      if (Date.now() < at) await sleep(at - Date.now());
      await page.keyboard.down(k);
      await sleep(Math.max(0, at + gap * 0.6 - Date.now()));
      await page.keyboard.up(k);
    }
    const t2 = await page.evaluate(() => performance.now());
    await sleep(300);
    const P = await page.evaluate(() => ({ ...window.__probe, origin: performance.timeOrigin }));
    const ctxState = await page.evaluate(() => window.__aur?.audioCtx?.state);
    const stats = await page.evaluate(() => {
      const c = window.__aur.audioCtx;
      const s = c.playbackStats ? c.playbackStats.toJSON() : null;
      return { s, s0: window.__stats0, base: c.baseLatency, out: c.outputLatency, log: (window.__aurLog || []).filter((m) => m.type === "probe_on").map((m) => [m.frame, m.sr]) };
    });
    const loadAfter = os.loadavg()[0];

    // ---- summarize ----
    const inWin = (t, a, b) => t >= a && t < b;
    const play = (e) => inWin(e[0], t1, t2 + 300);
    const keys = P.keys.filter((k) => inWin(k[1], t1, t2 + 300));
    const ons = P.worklet.filter((m) => m[1] === "on" && play(m));
    const delay = keys.map((k) => k[1] - k[0]);
    const toPost = keys.map((k) => {
      const m = ons.find((o) => o[0] >= k[1]);
      return m ? m[0] - k[1] : NaN;
    }).filter(Number.isFinite);
    const count = (list) => {
      const c = {};
      for (const m of list.filter(play)) c[m[1]] = (c[m[1]] || 0) + 1;
      return Object.entries(c).sort((a, b) => b[1] - a[1]).map(([t, v]) => `${t}:${v}`).join(" ");
    };
    const long = P.long.filter((l) => inWin(l[0], t1, t2 + 300));
    const loaf = P.loaf.filter((l) => inWin(l[0], t1, t2 + 300));
    const frames = P.frames.filter((fr) => inWin(fr[0], t1, t2)).map((fr) => fr[1]);
    // The workers: wasm time inside each window, from the logged calls.
    const busy = {};
    for (const m of P.busy) for (const [at, d, name] of m.log) {
      const t = at - P.origin; // page clock
      (busy[m.who] = busy[m.who] || []).push([t, d, name]);
    }
    const share = (calls, a, b) => {
      let ms = 0;
      for (const [t, d] of calls) {
        const lo = Math.max(t, a), hi = Math.min(t + d, b);
        if (hi > lo) ms += hi - lo;
      }
      return (100 * ms) / (b - a);
    };
    const longest = (calls, a, b) => {
      const inside = calls.filter(([t]) => t >= a && t < b);
      if (!inside.length) return "";
      const [t, d, name] = inside.reduce((x, y) => (y[1] > x[1] ? y : x));
      return `${name} ${f(d, 0)} ms`;
    };

    console.log(`\nrun ${n}: ${BROWSER}, ${VIEW}, ${PRESET}, cores ${state.cores}${flags.farm !== undefined ? `, ?farm=${flags.farm}` : ""}${THROTTLE > 1 ? `, page throttled ${THROTTLE}x` : ""}, ${RATE} notes/s for ${SECONDS} s; audio context ${state.ctx} -> ${ctxState} at ${state.rate} Hz`);
    console.log(`  load average ${f(loadBefore, 0)} before, ${f(loadAfter, 0)} after`);
    console.log(`  keys ${keys.length}, 'on' messages to the worklet ${ons.length}`);
    console.log(`  input delay (event timeStamp -> handler) ms: min ${f(Math.min(...delay))} p50 ${f(pct(delay, 0.5))} p95 ${f(pct(delay, 0.95))} max ${f(Math.max(...delay))}`);
    console.log(`  handler -> 'on' posted ms: p50 ${f(pct(toPost, 0.5), 2)} p95 ${f(pct(toPost, 0.95), 2)} max ${f(Math.max(...toPost), 2)}`);
    if (stats.s && stats.s0) {
      const d = (k) => stats.s[k] - stats.s0[k];
      console.log(`  output (AudioContext.playbackStats, over the playing window): underrun events ${d("underrunEvents")}, ${f(d("underrunDuration") * 1000, 0)} ms short of ${f(d("totalDuration"), 1)} s; latency avg ${f(stats.s.averageLatency * 1000, 0)} max ${f(stats.s.maximumLatency * 1000, 0)} ms (baseLatency ${f(stats.base * 1000, 0)}, outputLatency ${f(stats.out * 1000, 0)} ms)`);
    } else {
      console.log(`  output: no playbackStats in this browser (baseLatency ${f(stats.base * 1000, 0)}, outputLatency ${f(stats.out * 1000, 0)} ms)`);
    }
    {
      const before = {};
      for (const [t, type] of P.worklet) if (t < t1) before[type] = (before[type] || 0) + 1;
      console.log(`  B slot before the keys: ${before.b_patch ? `loaded (${before.b_patch} b_patch, ${before.b_clear || 0} b_clear)` : "not loaded"}; page-to-worklet messages so far: ${Object.entries(before).map(([k, v]) => `${k}:${v}`).join(" ") || "none"}`);
      // render-stall proxy: offset = the page's clock at the output minus the audio clock there
      const o = P.ots.filter(([, perf]) => perf >= t1 && perf <= t2 + 300);
      if (o.length > 3) {
        const off = o.map(([c, perf]) => perf - c * 1000);
        let jump = 0;
        for (let i = 1; i < off.length; i++) jump = Math.max(jump, off[i] - off[i - 1]);
        console.log(`  audio clock vs the page's clock over the playing window (getOutputTimestamp, ${o.length} samples): fell behind by ${f(off.at(-1) - off[0], 0)} ms in all, worst single jump ${f(jump, 0)} ms, spread ${f(Math.max(...off) - Math.min(...off), 0)} ms (a clock that keeps up holds within a few ms)`);
      } else {
        console.log(`  audio clock vs the page's clock: too few getOutputTimestamp samples (${o.length})`);
      }
    }
    {
      // note latency in audio time: the worklet's clock at note_on minus the context's when posted
      const lat = [];
      const all = P.worklet.map((m, i) => [m, i]).filter(([m]) => m[1] === "on");
      all.forEach(([m], i) => {
        const at = P.onAt[i];
        const got = stats.log[i];
        if (got && Number.isFinite(at) && play(m)) lat.push((got[0] / got[1] - at) * 1000);
      });
      console.log(`  note latency in audio time (worklet clock at note_on - context clock at post), ms: n ${lat.length}, min ${f(Math.min(...lat), 0)} p50 ${f(pct(lat, 0.5), 0)} p95 ${f(pct(lat, 0.95), 0)} max ${f(Math.max(...lat), 0)}`);
    }
    console.log(`  posted to the worklet while playing: ${count(P.worklet)}`);
    console.log(`  posted to the engine worker while playing: ${count(P.engine) || "nothing"}`);
    console.log(`  long tasks (50 ms+): ${long.length}, total ${f(long.reduce((s, l) => s + l[1], 0), 0)} ms, max ${f(Math.max(0, ...long.map((l) => l[1])), 0)} ms`);
    if (loaf.length) {
      console.log(`  long animation frames: ${loaf.length}, worst ${f(Math.max(...loaf.map((l) => l[1])), 0)} ms; the longest ones:`);
      for (const l of loaf.sort((a, b) => b[1] - a[1]).slice(0, 3)) console.log(`    ${f(l[1], 0)} ms (blocking ${f(l[2], 0)})  ${l[3]}`);
    }
    console.log(`  frames while playing: ${frames.length}, interval p50 ${f(pct(frames, 0.5))} p95 ${f(pct(frames, 0.95))} max ${f(Math.max(0, ...frames))} ms; over 50 ms: ${frames.filter((x) => x > 50).length}`);
    console.log(`  workers' time in wasm calls of 2 ms or more, % of the window (idle ${SETTLE} s | playing ${SECONDS} s), longest call while playing:`);
    for (const [who, calls] of Object.entries(busy).sort()) {
      console.log(`    ${who.padEnd(12)} ${f(share(calls, t0, t1), 0).padStart(4)}% | ${f(share(calls, t1, t2), 0).padStart(4)}%   ${longest(calls, t1, t2)}`);
    }
    if (TIMELINE) {
      const before = {};
      for (const [t, type] of P.engine) if (t < t1) before[type] = (before[type] || 0) + 1;
      console.log(`  requests the page sent the engine worker before the keys: ${Object.entries(before).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}:${n}`).join(" ")}`);
      const end = t2;
      const win = 5000;
      console.log(`  timeline: busy % per ${win / 1000} s window of the page's life (window 0 starts at the page's load; keys played from ${f(t1 / 1000, 0)} s to ${f(t2 / 1000, 0)} s)`);
      for (const [who, calls] of Object.entries(busy).sort()) {
        const row = [];
        for (let a = 0; a < end; a += win) row.push(f(share(calls, a, Math.min(a + win, end)), 0).padStart(3));
        console.log(`    ${who.padEnd(12)} ${row.join(" ")}`);
        const byName = {};
        for (const [, d, name] of calls) {
          byName[name] = byName[name] || [0, 0];
          byName[name][0] += d;
          byName[name][1] += 1;
        }
        const top = Object.entries(byName).sort((x, y) => y[1][0] - x[1][0]).slice(0, 4);
        console.log(`    ${"".padEnd(12)} total ${f(calls.reduce((x, c) => x + c[1], 0) / 1000, 1)} s in wasm calls of 2 ms+: ${top.map(([name, [ms, c]]) => `${name} ${f(ms / 1000, 1)} s in ${c} calls`).join("; ")}`);
      }
    }
  } finally {
    await browser.close();
  }
}

for (let n = 1; n <= RUNS; n++) await run(n);
