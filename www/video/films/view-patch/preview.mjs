// Stills of PATCH: inside the sound at given film times, for checking the
// cards (cards.js: the title, the chapter cards, the outro) and the callouts
// without recording or rendering.
//
// Every beat of this film shows a recorded shot, and the stage waits for its
// video. A shot not recorded yet (out/FILM/shots/ID.webm missing) is stood in
// for by its rehearsal (footage.mjs --dry): a still video of its first
// screenshot, and its dry sidecar for the marks and stamps, so the cards and
// callouts land where they will, over the rack as it was at the shot's start.
// The stand-ins live in www/video/out/view-patch/preview/stand-in/. It opens
// a browser, so run it through the machine's browser queue.
//
// usage (from the repo root):
//   www/video/tools/one_browser.sh nice -n 10 node www/video/films/view-patch/preview.mjs 14.5 21.6 …
//   → www/video/out/view-patch/preview/t-<time>.jpg
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const FDIR = path.dirname(fileURLToPath(import.meta.url));
const FILM = path.basename(FDIR);
const ROOT = path.resolve(FDIR, "../../../..");
const { chromium } = require(path.join(ROOT, "tests/web/node_modules/playwright"));
const OUTF = path.join(ROOT, "www/video/out", FILM);
const OUT = path.join(OUTF, "preview");
const STAND = path.join(OUT, "stand-in");
fs.mkdirSync(STAND, { recursive: true });

const FF = execFileSync("python3", ["-c", "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"]).toString().trim();

/** A still video of shot `id`'s first rehearsal screenshot, as long as the
 *  rehearsed shot, made once per rehearsal. */
function standIn(id) {
  const jpg = path.join(OUTF, "dry", `${id}-00-start.jpg`);
  if (!fs.existsSync(jpg)) return null;
  const out = path.join(STAND, `${id}.webm`);
  if (fs.existsSync(out) && fs.statSync(out).mtimeMs > fs.statSync(jpg).mtimeMs) return out;
  let dur = 60;
  try {
    dur = Math.ceil(JSON.parse(fs.readFileSync(path.join(OUTF, "dry", `${id}.json`), "utf8")).dur + 2);
  } catch {
    /* no sidecar: a minute */
  }
  execFileSync("nice", ["-n", "10", FF, "-loglevel", "error", "-y", "-loop", "1", "-framerate", "2", "-i", jpg, "-t", String(dur),
    "-vf", "scale=960:540", "-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "8", "-b:v", "600k", "-pix_fmt", "yuv420p", out]);
  return out;
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2", ".jpg": "image/jpeg", ".webm": "video/webm", ".svg": "image/svg+xml" };
const SHOT = new RegExp(`^/www/video/out/${FILM}/shots/([\\w-]+)\\.(webm|json)$`);
const srv = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let f = path.join(ROOT, u);
  const m = SHOT.exec(u);
  if (m && !fs.existsSync(f)) {
    // Not recorded yet: the rehearsal stands in.
    f = m[2] === "webm" ? standIn(m[1]) || f : path.join(OUTF, "dry", `${m[1]}.json`);
  }
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404);
    return res.end();
  }
  const size = fs.statSync(f).size;
  const type = TYPES[path.extname(f)] || "application/octet-stream";
  // Ranges, so the video element can seek.
  const r = /bytes=(\d*)-(\d*)/.exec(req.headers.range || "");
  if (r) {
    const a = r[1] ? Number(r[1]) : 0;
    const b = r[2] ? Number(r[2]) : size - 1;
    res.writeHead(206, { "Content-Type": type, "Content-Range": `bytes ${a}-${b}/${size}`, "Accept-Ranges": "bytes", "Content-Length": b - a + 1, "Cache-Control": "no-store" });
    return fs.createReadStream(f, { start: a, end: b }).pipe(res);
  }
  res.writeHead(200, { "Content-Type": type, "Accept-Ranges": "bytes", "Content-Length": size, "Cache-Control": "no-store" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const times = process.argv.slice(2).map(Number);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on("pageerror", (e) => console.log("page error:", e.message));
  await page.goto(`http://127.0.0.1:${srv.address().port}/www/video/films/${FILM}/index.html?capture&t=${times[0]}`);
  await page.waitForFunction(() => window.__stage && window.__stage.ready, null, { timeout: 120000 });
  for (const t of times) {
    await Promise.race([page.evaluate((tt) => window.__stage.seek(tt), t), new Promise((r) => setTimeout(r, 15000))]);
    await page.waitForTimeout(200);
    const f = path.join(OUT, `t-${t.toFixed(2)}.jpg`);
    await page.screenshot({ path: f, type: "jpeg", quality: 80 });
    console.log(path.relative(process.cwd(), f));
  }
} finally {
  await browser.close();
  srv.close();
}
