// Stills of the tour's two cards (cards.js) at given film times, before any
// footage is recorded: the page is served with film.js replaced by a build of
// the cards alone (the walkthrough's clips would wait forever on footage that
// does not exist yet). Stills land in www/video/out/tour/cards/.
//
//   www/video/tools/one_browser.sh node www/video/films/tour/preview_cards.mjs 15.2 17 19.6 127.6 131
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FDIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(FDIR, "../../../..");
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(ROOT, "tests/web/node_modules/playwright"));
const OUT = path.join(ROOT, "www/video/out/tour/cards");
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2" };

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
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on("pageerror", (e) => console.log(`page: ${e.message}`));
  await page.route("**/films/tour/film.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: 'export async function build(stage) { (await import("./cards.js")).cards(stage); }' }),
  );
  for (const t of process.argv.slice(2).map(Number)) {
    await page.goto(`http://127.0.0.1:${srv.address().port}/www/video/films/tour/index.html?capture&t=${t}`);
    await page.waitForFunction(() => window.__stage && window.__stage.ready, null, { timeout: 30000 });
    const f = path.join(OUT, `card-${t.toFixed(2)}.jpg`);
    await page.screenshot({ path: f, type: "jpeg", quality: 85 });
    console.log(path.relative(ROOT, f));
  }
} finally {
  await browser.close();
  srv.close();
}
