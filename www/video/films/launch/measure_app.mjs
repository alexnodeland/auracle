// Where the app puts every part at 1920 × 1080, for the kit's drawings of it
// (www/video/stage/kit.js `appScreen`, `performView`, `evolveView`,
// `patchView`): the menu bar, the bank, the levels' cross, the keybed, and
// PERFORM (with and without an offer), PATCH and EVOLVE, on the launch film's
// seeded session holding Slow Weather. Run it again when the app's layout
// changes, and move the kit's numbers to what it prints.
//
//   www/video/tools/one_browser.sh node www/video/films/launch/measure_app.mjs [OUT_DIR]
//
// Writes OUT_DIR/layout.json and a screenshot of each level (OUT_DIR is
// www/video/out/launch/measure by default).
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, "../../../..");
const OUT = process.argv[2] || path.join(ROOT, "www/video/out/launch/measure");
fs.mkdirSync(OUT, { recursive: true });
const require = createRequire(path.join(ROOT, "tests/web/package.json"));
const { chromium } = require("playwright");
// The film's own seeded session, as its shots open it.
const INIT = JSON.parse(fs.readFileSync(path.join(HERE, "shots.json"), "utf8")).init;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png" };
const base = path.join(ROOT, "apps/web");
const srv = http.createServer((req, res) => {
  let u = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (u.endsWith("/")) u += "index.html";
  const f = path.join(base, u);
  if (!f.startsWith(base) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return res.writeHead(404), res.end();
  res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream", "Cache-Control": "no-store" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--force-color-profile=srgb"] });
const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
await page.addInitScript(INIT);
await page.goto(`http://127.0.0.1:${srv.address().port}/?film`);
await page.waitForFunction(() => document.querySelector("#boot")?.classList.contains("done"), null, { timeout: 300000 });
await page.locator("#warm-skip").click().catch(() => {});
const preset = async (name) => {
  await page.locator('[role=tab][data-bank="presets"]').click();
  const nm = page.locator(".bi-name").filter({ hasText: new RegExp(`^\\s*${name}\\s*$`) });
  await page.locator(".bank-item.preset-item").filter({ has: nm }).first().click();
  await page.waitForFunction((n) => (document.getElementById("rack-subject")?.textContent || "").includes(n), name, { timeout: 90000 });
};
const view = (v) => page.locator(`.rail-stop[data-level="${v}"]`).click();
const M = () =>
  page.evaluate(() => {
    const R = (e) => {
      const b = e.getBoundingClientRect();
      return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) };
    };
    const all = (sel, f = (e) => ({})) => [...document.querySelectorAll(sel)].filter((e) => e.getClientRects().length).map((e) => ({ ...R(e), cls: e.getAttribute("class"), text: (e.innerText || e.textContent || "").trim().slice(0, 80), ...f(e) }));
    const cs = (e, p) => getComputedStyle(e)[p];
    return {
      menubar: all(".menubar > *"),
      bankTabs: all(".btab"),
      bankFind: all(".bank-find-row"),
      bankRows: all(".bank-list > *").slice(0, 30),
      rail: all(".rail-stop", (e) => ({ level: e.dataset.level, cur: e.getAttribute("aria-current") })),
      railBits: all(".rail-line, .rail-branch, .rail-hint"),
      keys: all(".pkey, .bkey", (e) => ({ down: e.classList.contains("down") })),
      keysSide: all(".keybar > *, .kb-side > *"),
      perform: {
        cap: all(".pf-cap-row, .pf-cap, .pf-moved > *"),
        name: all(".pf-name", (e) => ({ fs: cs(e, "fontSize") })),
        share: all(".pf-share"),
        blurb: all(".pf-blurb"),
        well: all(".pf-well"),
        faces: all(".pf-faces, .pf-face, .pf-offer, .pf-offer > *"),
        scope: all(".pf-scope"),
        corner: all(".pf-corner > *"),
        blend: all(".pf-blend-slot, .pf-blend > *"),
        ctl: all(".pf-ctlhead, .pf-ctlcap, .pf-actions > *, .pf-status"),
        knobs: all(".pf-knob", (e) => ({ i: e.dataset.i, svg: R(e.querySelector("svg")), name: e.querySelector(".pf-k-name")?.textContent, ends: e.querySelector(".pf-k-ends")?.textContent, sub: e.querySelector(".pf-k-sub")?.textContent, where: e.querySelector(".pf-k-where")?.getAttribute("transform") || [...e.querySelectorAll(".pf-k-where")].map((w) => [w.getAttribute("cx"), w.getAttribute("cy")]).join(";"), arc: e.querySelector(".pf-k-arc")?.getAttribute("d"), ptr: e.querySelector(".pf-k-turn")?.getAttribute("transform"), halves: [...e.querySelectorAll(".pf-k-half")].map((h) => h.getAttribute("class")).join("|") })),
        hood: all(".pf-hood-h, .pf-hood-row", (e) => ({ parts: [...e.children].map((c) => ({ cls: c.className, text: c.textContent, ...R(c) })) })),
        pads: all(".pf-pads > *", (e) => ({ key: e.dataset.key, sub: e.dataset.sub, wait: e.dataset.wait, disabled: e.disabled })),
      },
      evolve: {
        head: all(".ev-head, .ev-head-words > *, .ev-title, .ev-map, .duel-mid, .duel-mid *"),
        cards: all(".duel-card, .duel-well, .duel-side, .duel-corner > *, .duel-foot, .duel-who > *, .duel-controls > *, .duel-or"),
        foot: all(".ev-foot, .ev-foot > *, .ev-foot button"),
      },
      patch: {
        head: all("#view-patch .lv-head, #view-patch .lv-head *, #rack-subject"),
        frame: all(".rack-scroll"),
        plates: all(".mod-plate"),
        texts: all("#rack-svg text", (e) => ({ fs: e.getAttribute("font-size") || cs(e, "fontSize"), fill: cs(e, "fill") })).slice(0, 120),
      },
    };
  });
const out = {};
await preset("Slow Weather");
await view("perform");
await page.waitForFunction(() => /controls reach/.test(document.querySelector(".pf-status")?.textContent || "") && !/re-checking|opening|listening/.test(document.querySelector(".pf-status")?.textContent || ""), null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(1500);
await page.mouse.move(1916, 1076);
out.perform = await M();
await page.screenshot({ path: path.join(OUT, "m-perform.png") });
await page.locator(".pf-pad.primary").click();
await page.waitForFunction(() => document.querySelector(".pf-well")?.classList.contains("offered") && document.querySelector(".pf-offer .face"), null, { timeout: 90000 }).catch(() => console.log("no offer face"));
await page.waitForTimeout(2500);
await page.mouse.move(1916, 1076);
out.offered = await M();
await page.screenshot({ path: path.join(OUT, "m-offered.png") });
await view("patch");
await page.waitForTimeout(2500);
out.patch = await M();
await view("evolve");
await page.waitForFunction(() => Number(document.querySelector(".btab .bt-n[data-n='pool']")?.textContent || 0) >= 40, null, { timeout: 300000 }).catch(() => {});
await page.waitForTimeout(3000);
out.evolve = await M();
fs.writeFileSync(path.join(OUT, "layout.json"), JSON.stringify(out, null, 1));
await browser.close();
srv.close();
console.log("ok");
