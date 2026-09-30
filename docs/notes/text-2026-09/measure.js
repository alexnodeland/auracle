// How much the app says: visible words per view, at rest on a first visit and
// mid-session, and on the surfaces a player opens. 1440x900, Chromium.
//
//   python3 apps/web/serve.py 8691 &
//   BROWSER_LANE=shared www/video/tools/one_browser.sh \
//     env PORT=8691 node docs/notes/text-2026-09/measure.js OUT_DIR
//
// A word is a whitespace-separated token with a letter or digit in it. Text
// counts if its element is visible and on screen. A "block" is the nearest
// non-inline ancestor of a run of text; a block of 6+ words is a sentence of
// guidance or explanation, not a label. Tooltip words are the `title`
// attributes of visible elements. Writes OUT_DIR/text.json and a screenshot
// of every state.
const path = require("path");
const { chromium } = require(path.resolve(__dirname, "../../../tests/web/node_modules/playwright"));
const PORT = process.env.PORT || "8691";
const OUT = process.argv[2] || ".";

function measure(rootSel) {
  const root = rootSel ? document.querySelector(rootSel) : document.body;
  if (!root) return { words: 0, tooltip_words: 0, sentences: 0, blocks: [] };
  const vis = (el) => {
    if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  };
  const count = (s) => (s.trim().match(/\S+/g) || []).filter((w) => /[A-Za-z0-9]/.test(w)).length;
  let words = 0;
  const byBlock = new Map();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const el = walker.currentNode.parentElement;
    if (!el || ["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(el.tagName) || !vis(el)) continue;
    const n = count(walker.currentNode.textContent);
    if (!n) continue;
    words += n;
    let b = el;
    while (b.parentElement && b !== root && getComputedStyle(b).display.startsWith("inline")) b = b.parentElement;
    byBlock.set(b, (byBlock.get(b) || 0) + n);
  }
  const blocks = [];
  for (const [el, n] of byBlock) {
    if (n < 6) continue;
    const id = el.id ? `#${el.id}` : "";
    const cls = typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
    const anc = el.closest("[id]");
    blocks.push({ where: `${el.tagName.toLowerCase()}${id}${cls}` + (anc && anc !== el ? ` in #${anc.id}` : ""), words: n, text: el.innerText.replace(/\s+/g, " ").slice(0, 160) });
  }
  blocks.sort((a, b) => b.words - a.words);
  const tooltip_words = [...root.querySelectorAll("[title]")].filter(vis).reduce((s, e) => s + count(e.title), 0);
  return { words, tooltip_words, sentences: blocks.length, blocks };
}

(async () => {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const res = {};
  let page;
  const snap = async (key, sel) => {
    await page.waitForTimeout(1500);
    res[key] = await page.evaluate(measure, sel || null);
    await page.screenshot({ path: path.join(OUT, `${key}.png`) });
    const r = res[key];
    console.log(`\n== ${key}: ${r.words} words, ${r.tooltip_words} in tooltips, ${r.sentences} blocks of 6+ words`);
    for (const b of r.blocks.slice(0, 6)) console.log(`  ${String(b.words).padStart(4)}  ${b.where}  | ${b.text}`);
  };
  const boot = async () => {
    page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForSelector("#boot.done", { state: "attached", timeout: 180000 });
    await page.waitForSelector("#warmstart:not(.hidden)", { timeout: 60000 });
    await page.waitForTimeout(2000);
  };
  const views = async (suffix) => {
    for (const v of ["perform", "play", "evolve", "taste"]) {
      await page.click(`.viewtab[data-view="${v}"]`);
      await page.waitForTimeout(2500);
      await snap(`${v === "play" ? "patch" : v}-${suffix}`);
    }
  };

  // 1. A first visit, at rest: the warm start, then each view after "skip".
  await boot();
  await snap("warm-start");
  await page.locator("#warm-skip").click();
  await page.waitForTimeout(3000);
  await views("first-visit");
  await page.context().close();

  // 2. Mid-session: three warm-start favourites (18 picks), then six duels.
  await boot();
  const cards = page.locator(".warm-cell .warm-item");
  for (const i of [0, 3, 6]) await cards.nth(i).click();
  await page.locator("#warm-go").click();
  await page.waitForTimeout(6000);
  await page.click('.viewtab[data-view="evolve"]');
  await page.waitForTimeout(3000);
  for (let i = 0; i < 6; i++) { await page.keyboard.press(i % 2 ? "ArrowRight" : "ArrowLeft"); await page.waitForTimeout(1800); }
  await page.waitForTimeout(4000);
  await views("mid-session");

  // 3. On request.
  for (const t of ["styles", "dir", "trust"]) {
    await page.click(`#view-taste .tab[data-tab="${t}"]`);
    await snap(`taste-${t}`);
  }
  await page.click('.viewtab[data-view="play"]');
  await page.waitForTimeout(1500);
  const mod = page.locator("#view-play .nb-item:visible").first();
  if (await mod.count()) { await mod.hover(); await page.mouse.move(0, 0, { steps: 1 }).catch(() => {}); await mod.hover(); await snap("spec-strip-hover", "#spec-dock"); }
  await page.locator("#help-open").click();
  await snap("help-card", "#help");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);
  if (await page.locator("#bank-tour-btn").isVisible()) { await page.locator("#bank-tour-btn").click(); await snap("bank-tour", "#tour-body"); await page.keyboard.press("Escape"); }
  await page.click('.viewtab[data-view="evolve"]');
  const breed = page.getByRole("button", { name: /evolve pool/i }).first();
  if (await breed.isVisible()) { await breed.click(); await page.waitForTimeout(60000); await snap("evolve-after-a-generation", "#lineage-log"); }

  require("fs").writeFileSync(path.join(OUT, "text.json"), JSON.stringify(res, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
