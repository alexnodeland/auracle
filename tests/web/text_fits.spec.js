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
// - At 1000 and 1080 px, PATCH's callout is whole in each of its short
//   states: the step it names and its ▸.
const { test, expect } = require("@playwright/test");
const { goLevel } = require("./shell");

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
// the longest words each can carry. A knob list is what `knobCaption` makes:
// two names while they fit 24 characters, else one and how many more.
const WORDS = ["dark", "bright", "bloom", "snap", "still", "restless", "thin", "full", "smooth", "rough", "close", "far"];
const CAPTIONS = [
  "turn to ask for it", "turn further to ask", "let go to add a wavefolder", "let go to add a distortion",
  ...WORDS.map((w) => `let go to ask for ${w}`),
  ...WORDS.map((w) => `turns toward ${w} only`),
  "listening…", "no offer yet", "100% offer",
  "resonance · threshold +1", "env / out attack · decay", "cutoff · resonance +3", "wavefolder mod depth +2",
  "env / out attack +2", "wavefolder threshold",
  "frozen", "still", "paused 3 s", "drift · gliding · no taste yet", "roam · gliding · no taste yet", "roam · walking…",
  "ideas · one in B", "ideas · growing…", "nothing better nearby", "drift · next in 12 s",
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
      await goLevel(page, "perform");
      await expect(page.locator(".pf-knob .pf-k-sub")).toHaveCount(8);
      await expect(page.locator(".pf-deck")).toBeVisible();
      // Every caption state in every column, measured in the same task, so
      // nothing repaints between the write and the read. Twice: as this
      // machine draws it, and with each character widened to 7.2 px.
      // Linux's Chromium (CI) sets the same 11 px Plex Mono wider than
      // macOS's 6.6 px, and a caption that fitted macOS by a hair took a
      // fourth line there; 7.2 px is wider than either, so a caption passes
      // on both renderers or fails on both.
      for (const advance of [null, 7.2]) {
        const out = await page.evaluate(([caps, advance]) => {
          const subs = [...document.querySelectorAll(".pf-knob .pf-k-sub")];
          const deck = document.querySelector(".pf-deck");
          const was = subs.map((s) => s.textContent);
          // This renderer's advance: twenty digits of the caption's font.
          const probe = document.createElement("span");
          probe.className = subs[0].className;
          Object.assign(probe.style, { position: "absolute", visibility: "hidden", whiteSpace: "pre", display: "inline", minHeight: "0" });
          probe.textContent = "01234567890123456789";
          document.body.appendChild(probe);
          const own = probe.getBoundingClientRect().width / 20;
          probe.remove();
          const spacing = advance == null ? "normal" : `${Math.max(0, advance - own).toFixed(2)}px`;
          subs.forEach((s) => { s.style.letterSpacing = spacing; });
          const lineH = parseFloat(getComputedStyle(subs[0]).lineHeight);
          const lines = {};
          const height = () => deck.getBoundingClientRect().height;
          subs.forEach((s) => { s.textContent = "still"; });
          const base = height();
          const bad = [];
          let tallest = base;
          for (const c of caps) {
            subs.forEach((s) => { s.textContent = c; });
            tallest = Math.max(tallest, height());
            // Lines the words take, unwrapped from the reserved height.
            subs[0].style.minHeight = "0";
            lines[c] = Math.round(subs[0].getBoundingClientRect().height / lineH);
            subs[0].style.minHeight = "";
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
          subs.forEach((s, i) => { s.textContent = was[i]; s.style.letterSpacing = ""; });
          const column = subs[0].closest(".pf-knob").clientWidth;
          return { bad, base: Math.round(base), tallest: Math.round(tallest), lines, column, own: own.toFixed(2), spacing };
        }, [CAPTIONS, advance]);
        // On a miss, every caption's line count, so the one that ran long names itself.
        const counts = Object.entries(out.lines).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${n}  ${c}`).join("\n");
        const say = `this renderer's advance ${out.own} px, letter-spacing ${out.spacing}, a ${out.column} px column; lines per caption:\n${counts}`;
        expect(out.bad, `captions cut (${say})`).toEqual([]);
        expect(Math.max(...Object.values(out.lines)), `a caption past three lines (${say})`).toBeLessThanOrEqual(3);
        expect(out.tallest, `the knob row's height with the longest captions, against the shortest (${say})`).toBe(out.base);
      }
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

// PATCH's callout (`renderNextStep`) names the step it takes, and its ▸ says
// it is a button: at 1000 and 1080 px, beside a name column and a bank both
// wider by their faces, each of its short states is whole. (A generation's
// "bred N new sounds: they're at the top of the bank" was cut here before
// faces too; its words up to the count still show.)
const CALLOUTS = [
  "Play it first: press A, or tap a key below ▸",
  "Teach it your taste: 6 quick picks below ▸",
  "3 more picks and it refits ▸",
  "It’s learned something. Breed a generation ▸",
  "Breeding: keep playing ▸",
  "Generation 3 bred: see what it learned ▸",
];
for (const width of [1000, 1080]) {
  test.describe(`PATCH at ${width} px`, () => {
    test.use({ viewport: { width, height: 800 } });
    test(`PATCH's callout is whole at ${width} px, its step and its ▸`, async ({ page }) => {
      test.setTimeout(240_000);
      const errs = [];
      page.on("pageerror", (e) => errs.push(e.message));
      await page.addInitScript(SEEN(true));
      await page.goto("/");
      await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 180_000 });
      await goLevel(page, "patch");
      await expect(page.locator("#nextstep")).toBeVisible();
      const cut = await page.evaluate((labels) => {
        const el = document.getElementById("nextstep");
        const was = el.textContent;
        const out = [];
        for (const l of labels) {
          el.textContent = l;
          if (el.scrollWidth > el.clientWidth + 0.5) out.push(`"${l}": ${el.scrollWidth} px in ${el.clientWidth}`);
        }
        el.textContent = was;
        return out;
      }, CALLOUTS);
      expect(cut, "callouts cut").toEqual([]);
      expect(errs).toEqual([]);
    });
  });
}
