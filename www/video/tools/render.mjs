// Render a film's frames, exactly.
//
//   node www/video/tools/render.mjs launch                 → www/video/out/launch/picture.mp4
//   node www/video/tools/render.mjs launch --at 3,12.5     → stills, for review
//   node www/video/tools/render.mjs launch --from 10 --to 20 --jobs 3
//
// The page is served from the repo root (so a film can reach apps/web/fonts
// and recorded footage), opened once per job at exactly 1920×1080, and told
// each frame's time through `window.__stage.seek(t)`. The stage awaits its own
// video seeks, so a frame is never captured half-drawn. Frames are captured as
// JPEG at quality 95 and muxed as they are (MJPEG in Matroska, no encode here):
// PNG capture plus an x264 intermediate cost ~0.5 s a frame on this machine,
// most of it compressing a picture that mix.py compresses again anyway. The
// picture is compressed for the web once, in mix.py, after the sound is laid
// in. `--lossless` keeps the old PNG → x264 CRF 12 4:4:4 path, for a film
// whose fine lines show the JPEG.
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

function arg(name, dflt = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
}
const film = process.argv[2];
if (!film || film.startsWith("--")) {
  console.error("usage: render.mjs FILM [--at t1,t2] [--from s] [--to s] [--jobs n] [--out file]");
  process.exit(2);
}
const jobs = Number(arg("jobs", 2));
const outDir = path.join(ROOT, "www/video/out", film);
fs.mkdirSync(outDir, { recursive: true });

function ffmpegPath() {
  const r = spawn("python3", ["-c", "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"]);
  return new Promise((res, rej) => {
    let s = "";
    r.stdout.on("data", (d) => (s += d));
    r.on("close", (c) => (c === 0 ? res(s.trim()) : rej(new Error("imageio_ffmpeg not installed"))));
  });
}

// A tiny static server over the repo, with byte ranges (video seeking needs them).
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".mp4": "video/mp4", ".webm": "video/webm", ".wav": "audio/wav" };
function serve() {
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const f = path.join(ROOT, u);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(404);
      return res.end();
    }
    const size = fs.statSync(f).size;
    const type = TYPES[path.extname(f)] || "application/octet-stream";
    const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
    if (range) {
      const a = range[1] ? Number(range[1]) : 0;
      const b = range[2] ? Number(range[2]) : size - 1;
      res.writeHead(206, { "Content-Type": type, "Content-Range": `bytes ${a}-${b}/${size}`, "Accept-Ranges": "bytes", "Content-Length": b - a + 1, "Cache-Control": "no-store" });
      fs.createReadStream(f, { start: a, end: b }).pipe(res);
    } else {
      res.writeHead(200, { "Content-Type": type, "Content-Length": size, "Accept-Ranges": "bytes", "Cache-Control": "no-store" });
      fs.createReadStream(f).pipe(res);
    }
  });
  return new Promise((res) => srv.listen(0, "127.0.0.1", () => res(srv)));
}

async function openPage(browser, port) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(`http://127.0.0.1:${port}/www/video/films/${film}/index.html?capture`);
  await page.waitForFunction(() => window.__stage?.ready, null, { timeout: 60_000 }).catch(() => {});
  if (errors.length) throw new Error(`film page errors:\n  ${errors.join("\n  ")}`);
  return page;
}

async function main() {
  const srv = await serve();
  const port = srv.address().port;
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--force-color-profile=srgb", "--disable-lcd-text"] });
  try {
    if (process.argv.includes("--cues")) {
      const page = await openPage(browser, port);
      const cues = await page.evaluate(() => window.__stage.cues);
      const f = path.join(outDir, "cues.json");
      fs.writeFileSync(f, JSON.stringify(cues, null, 1));
      console.log(`${f}  (${cues.length} cues)`);
      return;
    }
    const at = arg("at");
    if (at) {
      const page = await openPage(browser, port);
      for (const s of at.split(",").map(Number)) {
        await page.evaluate((t) => window.__stage.seek(t), s);
        const f = path.join(outDir, `still-${s.toFixed(2)}.png`);
        await page.screenshot({ path: f });
        console.log(f);
      }
      return;
    }
    const probe = await openPage(browser, port);
    const { duration, fps } = await probe.evaluate(() => ({ duration: window.__stage.duration, fps: window.__stage.fps }));
    await probe.close();
    const from = Number(arg("from", 0));
    const to = Math.min(Number(arg("to", duration)), duration);
    const f0 = Math.round(from * fps);
    const f1 = Math.round(to * fps);
    const n = f1 - f0;
    const ff = await ffmpegPath();
    const per = Math.ceil(n / jobs);
    const parts = [];
    const t0 = Date.now();
    let done = 0;
    await Promise.all(
      Array.from({ length: jobs }, async (_, j) => {
        const a = f0 + j * per;
        const b = Math.min(f1, a + per);
        if (a >= b) return;
        const part = path.join(outDir, `part-${String(j).padStart(2, "0")}.mkv`);
        parts[j] = part;
        const lossless = process.argv.includes("--lossless");
        const encArgs = lossless
          ? ["-c:v", "png", "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "12", "-pix_fmt", "yuv444p"]
          : ["-c:v", "mjpeg", "-i", "-", "-c:v", "copy"];
        const enc = spawn(ff, ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), ...encArgs, part], { stdio: ["pipe", "inherit", "inherit"] });
        const page = await openPage(browser, port);
        for (let i = a; i < b; i++) {
          await page.evaluate((t) => window.__stage.seek(t), i / fps);
          const shot = lossless ? await page.screenshot({ type: "png" }) : await page.screenshot({ type: "jpeg", quality: 95 });
          if (!enc.stdin.write(shot)) await new Promise((r) => enc.stdin.once("drain", r));
          done++;
          if (done % 60 === 0) {
            const el = (Date.now() - t0) / 1000;
            process.stdout.write(`\r  ${done}/${n} frames  ${(done / el).toFixed(1)} fps  eta ${((n - done) / (done / el)).toFixed(0)} s   `);
          }
        }
        enc.stdin.end();
        await new Promise((r) => enc.on("close", r));
        await page.close();
      }),
    );
    process.stdout.write("\n");
    const list = path.join(outDir, "parts.txt");
    fs.writeFileSync(list, parts.filter(Boolean).map((p) => `file '${p}'`).join("\n"));
    const out = arg("out", path.join(outDir, "picture.mkv"));
    await new Promise((res, rej) => {
      const c = spawn(ff, ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", out], { stdio: "inherit" });
      c.on("close", (code) => (code === 0 ? res() : rej(new Error("concat failed"))));
    });
    for (const p of parts.filter(Boolean)) fs.unlinkSync(p);
    fs.unlinkSync(list);
    console.log(`${out}  (${n} frames, ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  } finally {
    await browser.close();
    srv.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
