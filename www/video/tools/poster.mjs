// A film's README poster: its frame with the play badge and running time on it.
//
//   node www/video/tools/poster.mjs launch        → www/landing/assets/film/launch-play.jpg
//
// Reads the published poster (assets/film/FILM.jpg) and the running time from
// films.json, so run it after publish.py; publish.py links the result from the
// README when it exists. The layout is stage/poster.html.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const { chromium } = require(path.join(ROOT, "tests/web/node_modules/playwright"));
const film = process.argv[2];
if (!film) {
  console.error("usage: poster.mjs FILM");
  process.exit(2);
}
const FILM_DIR = path.join(ROOT, "www/landing/assets/film");
const reg = JSON.parse(fs.readFileSync(path.join(FILM_DIR, "films.json"), "utf8"));
if (!reg[film]) {
  console.error(`${film} is not in films.json — publish it first`);
  process.exit(1);
}
const d = reg[film].duration;
const len = `${Math.floor(d / 60)}:${String(Math.round(d % 60)).padStart(2, "0")}`;

const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".woff2": "font/woff2", ".jpg": "image/jpeg" };
const srv = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
  const src = `/www/landing/assets/film/${film}.jpg`;
  await page.goto(`http://127.0.0.1:${srv.address().port}/www/video/stage/poster.html?src=${encodeURIComponent(src)}&len=${len}`);
  await page.waitForFunction(() => document.body.dataset.ready === "1");
  await page.evaluate(() => document.fonts.ready);
  const out = path.join(FILM_DIR, `${film}-play.jpg`);
  await page.locator("#poster").screenshot({ path: out, type: "jpeg", quality: 86 });
  console.log(`${out}  (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
} finally {
  await browser.close();
  srv.close();
}
