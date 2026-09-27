// Record the real instrument for a film: picture and its own sound.
//
//   node www/video/tools/footage.mjs FILM            → every shot in films/FILM/shots.json
//   node www/video/tools/footage.mjs FILM --shot ID  → one shot
//
// Each shot boots the app from apps/web (the committed wasm, so the footage
// matches the build), runs its setup off camera, then records while it plays
// its actions on a clock. Actions can be pinned to the narration: `at:
// "hood1:Turn"` is the moment the voice reaches "Turn" in line hood1, measured
// from the shot's beat (timeline.json carries word times once the voice is
// in).
//
// Picture: Chromium's screencast, JPEG q92, every frame the page paints, with
// its own timestamp; resampled to a constant 30 fps by time, not by count, so
// a dropped paint repeats a frame instead of shortening the clip. Sound: the
// app's own recorder (the same bounce as the ● rec button), started through
// the capture hook so no toast lands in the shot. Both are stamped in wall
// time, and the offset between them is written beside the clip.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const { chromium } = require(path.join(ROOT, "tests/web/node_modules/playwright"));

const film = process.argv[2];
const only = (() => {
  const i = process.argv.indexOf("--shot");
  return i > 0 ? process.argv[i + 1] : null;
})();
const fdir = path.join(ROOT, "www/video/films", film);
const odir = path.join(ROOT, "www/video/out", film, "shots");
fs.mkdirSync(odir, { recursive: true });
const spec = JSON.parse(fs.readFileSync(path.join(fdir, "shots.json"), "utf8"));
const timeline = JSON.parse(fs.readFileSync(path.join(fdir, "timeline.json"), "utf8"));
const FPS = 30;

function ffmpegPath() {
  const r = spawn("python3", ["-c", "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"]);
  return new Promise((res) => {
    let s = "";
    r.stdout.on("data", (d) => (s += d));
    r.on("close", () => res(s.trim()));
  });
}

// The app's own dev-server rules: no-store, so a rebuilt pkg/ is never stale.
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp" };
function serve() {
  const base = path.join(ROOT, "apps/web");
  const srv = http.createServer((req, res) => {
    let u = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (u.endsWith("/")) u += "index.html";
    const f = path.join(base, u);
    if (!f.startsWith(base) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream", "Cache-Control": "no-store" });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv)));
}

/** Resolve an action time: seconds, or "lineId:word" against the timeline. */
function when(at, shot) {
  if (typeof at === "number") return at;
  const [id, word] = at.split(":");
  const line = timeline.lines.find((l) => l.id === id);
  if (!line) throw new Error(`no line ${id}`);
  const beat = timeline.beats.find((b) => b.id === shot.beat);
  const origin = (beat ? beat.t0 : 0) - (shot.pre || 0);
  let t = line.t0;
  if (word) {
    const words = line.text.split(/\s+/);
    const k = words.findIndex((w) => w.toLowerCase().replace(/[^\w']/g, "").startsWith(word.toLowerCase()));
    if (k >= 0) t = line.words ? line.words[k] : line.t0 + ((line.t1 - line.t0) * words.slice(0, k).join(" ").length) / line.text.length;
  }
  return t - origin;
}

async function step(page, s) {
  switch (s.op) {
    case "wait":
      return page.waitForTimeout(s.ms);
    case "click":
      return page.locator(s.sel).first().click();
    case "view":
      return page.locator(`.viewtab[data-view="${s.v}"]`).click();
    case "preset":
      await page.locator('.bf[data-f="preset"]').click();
      await page.locator(".bank-item", { hasText: s.name }).first().click();
      return page.waitForTimeout(600);
    case "measured":
      // The status line belongs to whatever patch PERFORM last measured, so a
      // fresh load must first show its own name, then its own measurement.
      if (s.name) await page.waitForFunction((n) => (document.querySelector(".pf-name")?.textContent || "").includes(n), s.name, { timeout: 60_000 });
      await page.waitForFunction(() => /controls reach/.test(document.querySelector(".pf-status")?.textContent || ""), null, { timeout: 120_000 });
      return page.waitForTimeout(s.settle ?? 400);
    case "key":
      await page.keyboard.down(s.key);
      await page.waitForTimeout(s.ms || 250);
      return page.keyboard.up(s.key);
    case "hold": {
      for (const k of s.keys) await page.keyboard.down(k);
      await page.waitForTimeout(s.ms);
      for (const k of s.keys) await page.keyboard.up(k);
      return;
    }
    case "drag": {
      const box = await page.locator(s.sel).first().boundingBox();
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      const n = Math.max(2, Math.round((s.ms || 800) / 33));
      for (let i = 1; i <= n; i++) {
        const u = i / n;
        const e = u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u);
        await page.mouse.move(x + (s.dx || 0) * e, y + (s.dy || 0) * e);
        await page.waitForTimeout((s.ms || 800) / n);
      }
      return page.mouse.up();
    }
    case "move": {
      const box = await page.locator(s.sel).first().boundingBox();
      return page.mouse.move(box.x + box.width / 2 + (s.ox || 0), box.y + box.height / 2 + (s.oy || 0), { steps: s.steps || 20 });
    }
    case "eval":
      return page.evaluate(s.js);
    default:
      throw new Error(`unknown op ${s.op}`);
  }
}

async function shoot(browser, port, shot, ff) {
  const [W, H] = spec.viewport || [1920, 1080];
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: spec.dpr || 1, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  if (spec.init) await page.addInitScript(spec.init);
  await page.goto(`http://127.0.0.1:${port}/${spec.query || "?film"}`);
  await page.waitForFunction(() => document.querySelector("#boot")?.classList.contains("done"), null, { timeout: 180_000 });
  for (const s of spec.setup || []) await step(page, s);
  for (const s of shot.setup || []) await step(page, s);
  // Park the pointer off the panel unless the shot moves it.
  await page.mouse.move(W - 4, H - 4);
  const cdp = await ctx.newCDPSession(page);
  const frames = [];
  cdp.on("Page.screencastFrame", async (f) => {
    frames.push({ t: f.metadata.timestamp, data: f.data });
    cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  const download = page.waitForEvent("download", { timeout: 120_000 });
  const recAt = await page.evaluate(() => {
    const t = (performance.timeOrigin + performance.now()) / 1000;
    if (window.__film?.rec) window.__film.rec(true);
    else document.getElementById("rec-btn").click();
    return t;
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: W * (spec.dpr || 1), maxHeight: H * (spec.dpr || 1), everyNthFrame: 1 });
  const t0 = Date.now() / 1000;
  const plan = (shot.actions || []).map((a) => ({ ...a, t: when(a.at ?? 0, shot) })).sort((a, b) => a.t - b.t);
  const running = [];
  for (const a of plan) {
    const wait = t0 + a.t - Date.now() / 1000;
    if (wait > 0) await page.waitForTimeout(wait * 1000);
    running.push(step(page, a).catch((e) => errors.push(`${a.op}: ${e.message}`)));
  }
  const left = t0 + shot.dur - Date.now() / 1000;
  if (left > 0) await page.waitForTimeout(left * 1000);
  await Promise.all(running);
  await cdp.send("Page.stopScreencast");
  await page.evaluate(() => {
    if (window.__film?.rec) window.__film.rec(false);
    else document.getElementById("rec-btn").click();
  });
  const dl = await download;
  const wav = path.join(odir, `${shot.id}.wav`);
  await dl.saveAs(wav);
  await ctx.close();
  if (errors.length) console.warn(`  [${shot.id}] ${errors.join(" | ")}`);

  // Resample the paints to a constant frame rate, by timestamp.
  frames.sort((a, b) => a.t - b.t);
  const start = t0;
  const n = Math.round(shot.dur * FPS);
  // WebM/VP9: Playwright's Chromium has no H.264, and the stage seeks this
  // clip frame by frame, so a keyframe every half second keeps seeks cheap.
  const out = path.join(odir, `${shot.id}.webm`);
  const enc = spawn(ff, ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-", "-c:v", "libvpx-vp9", "-crf", "16", "-b:v", "0", "-g", "15", "-deadline", "good", "-cpu-used", "4", "-row-mt", "1", "-pix_fmt", "yuv420p", out], { stdio: ["pipe", "inherit", "inherit"] });
  let j = 0;
  for (let i = 0; i < n; i++) {
    const tt = start + i / FPS;
    while (j + 1 < frames.length && frames[j + 1].t <= tt) j++;
    const buf = Buffer.from(frames[j].data, "base64");
    if (!enc.stdin.write(buf)) await new Promise((r) => enc.stdin.once("drain", r));
  }
  enc.stdin.end();
  await new Promise((r) => enc.on("close", r));
  const paints = frames.filter((f) => f.t >= start && f.t <= start + shot.dur).length;
  const meta = { id: shot.id, dur: shot.dur, fps: FPS, audio_offset: recAt - start, paints_per_s: paints / shot.dur, errors };
  fs.writeFileSync(path.join(odir, `${shot.id}.json`), JSON.stringify(meta, null, 1));
  console.log(`  ${shot.id}: ${shot.dur}s, ${meta.paints_per_s.toFixed(1)} paints/s, audio offset ${meta.audio_offset.toFixed(3)} s`);
}

(async () => {
  const srv = await serve();
  const port = srv.address().port;
  const ff = await ffmpegPath();
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--force-color-profile=srgb"] });
  try {
    for (const shot of spec.shots) {
      if (only && shot.id !== only) continue;
      await shoot(browser, port, shot, ff);
    }
  } finally {
    await browser.close();
    srv.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
