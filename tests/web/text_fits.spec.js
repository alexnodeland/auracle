// Text the type scale made larger still fits where it is set.
//
// - The warm start's nine cards fit a phone's screen, at 390 and 360 px wide
//   (behind "look around anyway"): no card runs past the viewport, and no
//   card's words run past the card. Its third column was pushed off the
//   right edge once its words were 11 and 14 px.
// - At 1000 px, the narrowest window the app allows, every PERFORM control
//   caption is whole in every state it can say: wrapped, never cut with an
//   ellipsis or a clamp. The knob row keeps one height whatever the captions
//   say, so it does not jump when one changes (Wander's does, every few
//   seconds). The same at 1280.
const { test, expect } = require("@playwright/test");

const SEEN = (warmed) => `(() => {
  try {
    const seen = ["auracle-played", "auracle-bench-tour", "auracle-bank-toured"];
    if (${warmed}) seen.push("auracle-warmed");
    for (const k of seen) localStorage.setItem(k, "1");
  } catch (_) {}
})();`;

for (const width of [390, 360]) {
  test.describe(`a ${width} px phone`, () => {
    test.use({ viewport: { width, height: 844 }, hasTouch: true, isMobile: true });
    test(`the warm start's cards fit the screen at ${width} px`, async ({ page }) => {
      test.setTimeout(240_000);
      const errs = [];
      page.on("pageerror", (e) => errs.push(e.message));
      await page.addInitScript(SEEN(false));
      await page.goto("/");
      await page.locator("#hg-anyway").click();
      await page.waitForLoadState("load");
      await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 180_000 });
      await expect(page.locator("#warmstart")).not.toHaveClass(/\bhidden\b/, { timeout: 60_000 });
      await expect(page.locator(".warm-cell .warm-item")).toHaveCount(9, { timeout: 60_000 });
      const out = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const bad = [];
        for (const cell of document.querySelectorAll(".warm-cell")) {
          const r = cell.getBoundingClientRect();
          const name = cell.querySelector(".wi-name")?.textContent || "?";
          if (r.left < 0 || r.right > vw + 0.5) bad.push(`${name}: ${Math.round(r.left)}–${Math.round(r.right)} of ${vw}`);
          for (const t of cell.querySelectorAll(".wi-name, .wi-sig")) {
            if (t.scrollWidth > t.clientWidth + 1) bad.push(`${name}: "${t.textContent}" ${t.scrollWidth} in ${t.clientWidth}`);
          }
          const item = cell.querySelector(".warm-item");
          if (item.scrollWidth > item.clientWidth + 1) bad.push(`${name}: the card's words ${item.scrollWidth} in ${item.clientWidth}`);
        }
        return bad;
      });
      expect(out, "cards or words past their edge").toEqual([]);
      expect(errs).toEqual([]);
    });
  });
}

// Every state a control's caption can be in (perform.js `paintKnob`), with
// the longest words each can carry.
const WORDS = ["dark", "bright", "bloom", "snap", "still", "restless", "thin", "full", "smooth", "rough", "close", "far"];
const CAPTIONS = [
  "turn to ask for it", "turn further to ask", "let go to add a wavefolder", "let go to add a distortion",
  ...WORDS.map((w) => `let go to ask for ${w}`),
  ...WORDS.map((w) => `turns toward ${w} only`),
  "listening…", "no offer yet", "100% offer",
  "env / out attack · sustain +2", "mod depth · chorus rate +2", "ladder cutoff · env / out decay +1",
  "wavefolder threshold · mod depth",
  "frozen", "still", "paused 3 s", "drift · gliding · no taste yet", "roam · gliding · no taste yet", "roam · walking…",
  "ideas · one in B", "ideas · growing…", "staying: nothing better nearby", "drift · next in 12 s",
];

for (const [width, height] of [[1000, 800], [1280, 800]]) {
  test.describe(`a ${width} px window`, () => {
    test.use({ viewport: { width, height } });
    test(`every PERFORM control caption is whole at ${width} px, and the knob row keeps its height`, async ({ page }) => {
      test.setTimeout(240_000);
      const errs = [];
      page.on("pageerror", (e) => errs.push(e.message));
      await page.addInitScript(SEEN(true));
      await page.goto("/");
      await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 180_000 });
      await page.locator('.viewtab[data-view="perform"]').click();
      await expect(page.locator(".pf-knob .pf-k-sub")).toHaveCount(8);
      await expect(page.locator(".pf-deck")).toBeVisible();
      // Every caption state in every column, measured in the same task, so
      // nothing repaints between the write and the read.
      const out = await page.evaluate((caps) => {
        const subs = [...document.querySelectorAll(".pf-knob .pf-k-sub")];
        const deck = document.querySelector(".pf-deck");
        const was = subs.map((s) => s.textContent);
        const height = () => deck.getBoundingClientRect().height;
        subs.forEach((s) => { s.textContent = "still"; });
        const base = height();
        const bad = [];
        let tallest = base;
        for (const c of caps) {
          subs.forEach((s) => { s.textContent = c; });
          tallest = Math.max(tallest, height());
          for (const s of subs) {
            const cs = getComputedStyle(s);
            const cut = s.scrollHeight > s.clientHeight + 1 || s.scrollWidth > s.clientWidth + 1;
            const clamped = cs.webkitLineClamp !== "none" && cs.webkitLineClamp !== "" && cs.overflow !== "visible";
            if (cut || clamped || cs.textOverflow === "ellipsis") {
              bad.push(`"${c}" in ${Math.round(s.getBoundingClientRect().width)} px: ${s.scrollWidth}×${s.scrollHeight} in ${s.clientWidth}×${s.clientHeight}`);
              break;
            }
          }
        }
        subs.forEach((s, i) => { s.textContent = was[i]; });
        return { bad, base: Math.round(base), tallest: Math.round(tallest) };
      }, CAPTIONS);
      expect(out.bad, "captions cut").toEqual([]);
      expect(out.tallest, "the knob row's height with the longest captions, against the shortest").toBe(out.base);
      // Nothing else in a knob cuts its words either.
      const ends = await page.evaluate(() =>
        [...document.querySelectorAll(".pf-knob .pf-k-ends, .pf-knob .pf-k-name")]
          .filter((e) => e.scrollWidth > e.clientWidth + 1)
          .map((e) => e.textContent));
      expect(ends, "control names and ends cut").toEqual([]);
      expect(errs).toEqual([]);
    });
  });
}
