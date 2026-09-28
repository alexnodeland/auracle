// Stills of PATCH: inside the sound at given film times, for checking the
// cards (cards.js: the title, the chapter cards, the outro) without a render.
// A walkthrough beat needs its recorded shot, so ask for times inside the cards
// (a chapter card falls back to its shot's rehearsal still while the shot is
// not recorded). Waits until no rehearsal holds the browser.
// usage (from the repo root): node www/video/films/view-patch/preview.mjs 14.5 21.6 …
//   → www/video/out/view-patch/preview/t-<time>.jpg
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const FDIR = path.dirname(fileURLToPath(import.meta.url));
const FILM = path.basename(FDIR);
const ROOT = path.resolve(FDIR, "../../../..");
const { chromium } = require(path.join(ROOT, "tests/web/node_modules/playwright"));
const OUT = path.join(ROOT, "www/video/out", FILM, "preview");
fs.mkdirSync(OUT, { recursive: true });

// One browser at a time on a shared machine.
for (;;) {
  const busy = execSync("pgrep -f '^node [^ ]*tools/footage.mjs' || true").toString().trim();
  if (!busy) break;
  await new Promise((r) => setTimeout(r, 5000));
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2", ".jpg": "image/jpeg", ".webm": "video/webm", ".svg": "image/svg+xml" };
const srv = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream", "Cache-Control": "no-store" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const times = process.argv.slice(2).map(Number);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on("pageerror", (e) => console.log("page error:", e.message));
  // Opened at the first time asked for: the stage's first seek must not land
  // on a walkthrough beat whose footage is not recorded yet.
  await page.goto(`http://127.0.0.1:${srv.address().port}/www/video/films/${FILM}/index.html?capture&t=${times[0]}`);
  await page.waitForFunction(() => window.__stage && window.__stage.ready, null, { timeout: 60000 });
  for (const t of times) {
    await Promise.race([page.evaluate((tt) => window.__stage.seek(tt), t), new Promise((r) => setTimeout(r, 8000))]);
    await page.waitForTimeout(150);
    const f = path.join(OUT, `t-${t.toFixed(2)}.jpg`);
    await page.screenshot({ path: f, type: "jpeg", quality: 80 });
    console.log(path.relative(process.cwd(), f));
  }
} finally {
  await browser.close();
  srv.close();
}
