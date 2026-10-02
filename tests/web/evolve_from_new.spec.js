// ⚡ evolve from this, and what the bank and the toasts say about its child
// (RFC-006, "Found along the way").
//
// A generation's children go into the bank's New group ("new · generation N", each
// row tagged NEW) as they land. A ⚡ child never did: it was bred, the engine
// stamped it with a generation of its own, and the bank listed it among the
// ranked rows with nothing to say it was new. It joins the group now, as a
// generation's children do. A ⚡ that bred nothing says why in the engine's
// own terms: a refused child's bar is the sound it would replace, never "its
// parent", which the toast used to say.
//
// Seeded (the films' own Math.random), so the session is the same run to run.
const { test, expect } = require("@playwright/test");

const SEED = `(() => { let s = 20260928 >>> 0; Math.random = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();`;

const init = `(() => {
  const Orig = window.Worker;
  const last = (window.__pwLast = {});
  const counts = (window.__pwCounts = {});
  function Wrapped(url, opts) {
    const w = new Orig(url, opts);
    w.addEventListener("message", (e) => {
      const d = e.data;
      if (d && typeof d.type === "string") {
        last[d.type] = d;
        counts[d.type] = (counts[d.type] || 0) + 1;
      }
    });
    return w;
  }
  Wrapped.prototype = Orig.prototype;
  window.Worker = Wrapped;
  const toasts = (window.__pwToasts = []);
  document.addEventListener("DOMContentLoaded", () => {
    const lane = document.getElementById("toasts");
    if (lane) {
      new MutationObserver((muts) => {
        for (const m of muts)
          for (const n of m.addedNodes) {
            const msg = n.querySelector && n.querySelector(".toast-msg");
            if (msg) toasts.push(msg.textContent);
          }
      }).observe(lane, { childList: true });
    }
  });
  try {
    for (const k of ["auracle-played", "auracle-bench-tour", "auracle-bank-toured", "auracle-warmed"]) localStorage.setItem(k, "1");
  } catch (_) {}
})();`;

const count = (page, type) => page.evaluate((t) => window.__pwCounts[t] || 0, type);

test("a ⚡ child joins the bank's New group, as a generation's children do", { tag: "@slow" }, async ({ page }) => {
  test.setTimeout(600_000);
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await page.addInitScript(SEED);
  await page.addInitScript(init);
  await page.goto("/");
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 150_000 });

  // Six picks and their refit: a taste to breed toward.
  await page.waitForFunction(() => window.__pwLast.duel && window.__pwLast.duel.pair, null, { timeout: 60_000 });
  await page.locator('.viewtab[data-view="evolve"]').click();
  for (let i = 1; i <= 6; i++) {
    await expect(page.locator(i % 2 ? "#choose-a" : "#choose-b")).toBeEnabled({ timeout: 30_000 });
    await page.locator(i % 2 ? "#choose-a" : "#choose-b").click();
  }
  await expect.poll(() => count(page, "fitted"), { timeout: 120_000 }).toBeGreaterThan(0);
  await expect(page.locator("#job-slot")).toBeHidden({ timeout: 30_000 });

  // ⚡ from the sound on the bench, until one breeds a child (a walk can
  // come back with nothing; each refusal says why, never "its parent").
  await page.locator('.viewtab[data-view="play"]').click();
  let landed = null;
  for (let attempt = 0; attempt < 4 && !landed; attempt++) {
    await expect(page.locator("#rack-evolve")).toBeEnabled({ timeout: 60_000 });
    const before = await count(page, "evolved_from");
    await page.locator("#rack-evolve").click();
    await expect.poll(() => count(page, "evolved_from"), { timeout: 300_000 }).toBeGreaterThan(before);
    const m = await page.evaluate(() => window.__pwLast.evolved_from);
    console.log(`⚡ ${attempt + 1}: child ${m.childId}, reason ${m.reason}, generation ${m.status.generation}`);
    if (m.childId > 0) landed = m;
    else {
      await expect.poll(() => page.evaluate(() => window.__pwToasts.filter((t) => t.startsWith("⚡")).pop() || ""), { timeout: 10_000 })
        .not.toBe("");
      const said = await page.evaluate(() => window.__pwToasts.filter((t) => t.startsWith("⚡")).pop());
      console.log(`  said: ${said}`);
      expect(said).not.toMatch(/parent|no accepted move|—/);
    }
  }
  expect(landed, "no ⚡ bred a child in four tries").not.toBeNull();

  // The bank's pool leads with the New group, its heading names the ⚡'s
  // generation, and the child's row is in it, tagged NEW.
  if (await page.locator('.bf[data-f="pool"]').getAttribute("class").then((c) => !/\bactive\b/.test(c))) {
    await page.locator('.bf[data-f="pool"]').click();
  }
  const head = page.locator("#bank-list .bank-group.new .bg-label");
  await expect(head).toHaveText(`new · generation ${landed.status.generation}`, { timeout: 10_000 });
  const row = page.locator(`#bank-list .bank-item[data-id="${landed.childId}"]`);
  await expect(row).toHaveClass(/\bfresh\b/);
  await expect(row.locator(".bi-new")).toHaveText("new");
  // It is the first row under the heading: the group holds it and nothing else.
  const firstId = await page.locator("#bank-list .bank-item[data-id]").first().getAttribute("data-id");
  expect(Number(firstId)).toBe(landed.childId);
  // The next-step chip counts it as that generation's one new sound.
  await expect(page.locator("#nextstep")).toHaveText(
    `Generation ${landed.status.generation} bred a new sound: it’s at the top of the bank ▸`,
  );
  // The toast names the sound it bred, not an id.
  await expect.poll(() => page.evaluate(() => window.__pwToasts.filter((t) => t.startsWith("⚡ bred")).pop() || ""), { timeout: 30_000 })
    .toMatch(/^⚡ bred .+/);
  const said = await page.evaluate(() => window.__pwToasts.filter((t) => t.startsWith("⚡ bred")).pop());
  console.log(`  said: ${said}`);
  expect(said).not.toMatch(/#\d|patch #|—/);
  expect(pageErrors, `uncaught exceptions:\n${pageErrors.join("\n")}`).toEqual([]);
});
