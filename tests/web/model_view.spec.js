// The model view (Plan-008 §2.5, ADR-017): what the model believes, raised
// over whatever level shows. Held (⌥ for 220 ms, or MODEL pressed) it shows
// while held; tapped it stays until a tap or Esc. It shows engine facts only:
// each bank row's guess and, once fitted, the pool in the order the model
// rates it (letting go puts the order back); TASTE's side of its toggle;
// EVOLVE's guess for the pair before you pick, on the card it favours.
// Another key during the hold cancels it, so ⌥↑ never flashes it; a text
// field and a modal dialog keep ⌥; Esc and the window's blur end it. Its
// words say "the model view", never "lens" (www/brand/voice.md).
const { test, expect } = require("@playwright/test");
const { goLevel, bankTab, modelView } = require("./shell");
const fs = require("fs");
const path = require("path");

const PKG = path.join(__dirname, "..", "..", "apps", "web", "pkg", "auracle_wasm_bg.wasm");

const INIT = `(() => {
  const Orig = window.Worker;
  window.__pwCounts = {};
  function Wrapped(url, opts) {
    const w = new Orig(url, opts);
    if (/worker\\.js/.test(String(url))) {
      window.__pwEngine = w;
      w.addEventListener("message", (e) => {
        const d = e.data;
        if (d && d.type) window.__pwCounts[d.type] = (window.__pwCounts[d.type] || 0) + 1;
        if (d && d.type === "duel_pred" && d.pre) window.__pwPre = (window.__pwPre || 0) + 1;
      });
    }
    return w;
  }
  Wrapped.prototype = Orig.prototype;
  window.Worker = Wrapped;
  // Every time the page wore the model view, however briefly.
  window.__pwModelSeen = 0;
  const watch = () => new MutationObserver(() => {
    if (document.body.classList.contains("model-view")) window.__pwModelSeen += 1;
  }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  if (document.body) watch();
  else document.addEventListener("DOMContentLoaded", watch);
  try {
    for (const k of ["auracle-played", "auracle-bench-tour", "auracle-bank-toured"]) localStorage.setItem(k, "1");
  } catch (_) {}
})();`;

async function boot(page) {
  expect(fs.existsSync(PKG), `no built engine at ${PKG}: run \`make wasm\` first`).toBe(true);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(INIT);
  await page.goto("/");
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 150_000 });
  return errors;
}

/** The warm start's three picks, which fit the model, and a full pool. */
async function fitted(page) {
  await expect(page.locator("#warmstart")).not.toHaveClass(/\bhidden\b/, { timeout: 60_000 });
  const cards = page.locator(".warm-cell .warm-item");
  for (const i of [1, 4, 7]) await cards.nth(i).click();
  await page.locator("#warm-go").click();
  await page.waitForFunction(() => (window.__pwCounts.fitted || 0) > 0, null, { timeout: 150_000 });
  await bankTab(page, "pool");
  await expect.poll(() => rowIds(page), { timeout: 120_000 }).toHaveLength(40);
}

const rowIds = (page) =>
  page.evaluate(() => [...document.querySelectorAll("#bank-list .bank-item[data-id]")].map((e) => Number(e.dataset.id)));
const pcts = (page) =>
  page.evaluate(() => [...document.querySelectorAll("#bank-list .bank-item[data-id] .bi-pct")].map((e) => parseInt(e.textContent, 10)));
const body = (page) => page.locator("body");

test("holding ⌥ shows each row's guess and the pool in the order it rates them; letting go puts the order back", async ({ page }) => {
  test.setTimeout(300_000);
  const errors = await boot(page);
  await fitted(page);
  await page.mouse.move(700, 450);
  // At rest: no guess drawn, and the pool in the order its sounds joined it.
  const rest = await rowIds(page);
  expect(rest, "at rest the pool stands in the order it joined (by id)").toEqual([...rest].sort((a, b) => a - b));
  await expect(page.locator("#bank-list .bank-item[data-id] .bi-pct").first()).toBeHidden();
  await expect(page.locator("#bank-list .bank-item[data-id] .bi-u").first()).toBeHidden();

  await page.keyboard.down("Alt");
  await expect(body(page)).toHaveClass(/\bmodel-view\b/);
  await expect(page.locator("#model-tag .mt-voice")).toHaveText(/^what it believes, from \d+ picks?/);
  // Held, not tapped: the LED is lit and the pill is not pressed.
  await expect(page.locator("#model-btn")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#bank-list .bank-item[data-id] .bi-pct").first()).toBeVisible();
  await expect(page.locator("#bank-list .bank-item[data-id] .bi-u").first()).toBeVisible();
  // The rows in the order it rates them: each guess no higher than the one
  // above it, and the same sounds as at rest.
  const held = await rowIds(page);
  const shown = await pcts(page);
  expect([...held].sort((a, b) => a - b)).toEqual([...rest].sort((a, b) => a - b));
  for (let i = 1; i < shown.length; i++) expect(shown[i], `row ${i} under row ${i - 1}`).toBeLessThanOrEqual(shown[i - 1]);
  expect(held, "the model's order is not the pool's").not.toEqual(rest);

  await page.keyboard.up("Alt");
  await expect(body(page)).not.toHaveClass(/\bmodel-view\b/);
  await expect(page.locator("#bank-list .bank-item[data-id] .bi-pct").first()).toBeHidden();
  expect(await rowIds(page), "letting go puts the order back").toEqual(rest);
  expect(errors).toEqual([]);
});

test("⌥ and an arrow move a level and never flash the model view", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await boot(page);
  await page.locator("#warm-skip").click();
  await expect(page.locator(".rail-stop[data-level=perform]")).toHaveAttribute("aria-current", "location");
  await page.evaluate(() => { window.__pwModelSeen = 0; });
  // ⌥ goes down and ↑ follows at once, as a hand plays the chord, in one
  // task so a loaded machine cannot stretch the gap past the 220 ms hold;
  // ⌥ then stays down well past it.
  const key = (type, k, code, alt) => page.evaluate(([t, kk, c, a]) => {
    (document.activeElement || document.body).dispatchEvent(new KeyboardEvent(t, { key: kk, code: c, altKey: a, bubbles: true, cancelable: true }));
  }, [type, k, code, alt]);
  await page.evaluate(() => {
    const at = document.activeElement || document.body;
    const send = (type, key, code) => at.dispatchEvent(new KeyboardEvent(type, { key, code, altKey: true, bubbles: true, cancelable: true }));
    send("keydown", "Alt", "AltLeft");
    send("keydown", "ArrowUp", "ArrowUp");
    send("keyup", "ArrowUp", "ArrowUp");
  });
  await expect(page.locator(".rail-stop[data-level=taste]")).toHaveAttribute("aria-current", "location");
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.__pwModelSeen), "the model view showed during ⌥↑").toBe(0);
  await key("keyup", "Alt", "AltLeft", false);
  await expect(body(page)).not.toHaveClass(/\bmodel-view\b/);
  expect(errors).toEqual([]);
});

test("a tap on MODEL keeps the model view until a second tap or Esc; a press held on it shows it only while held", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await boot(page);
  await page.locator("#warm-skip").click();
  const btn = page.locator("#model-btn");
  await btn.click();
  await expect(body(page)).toHaveClass(/\bmodel-view\b/);
  await expect(btn).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#model-tag .mt-voice")).toHaveText(/^still guessing · /);
  // A held ⌥ and its release do not end a view that was tapped on.
  await page.mouse.move(700, 450);
  await page.keyboard.down("Alt");
  await page.waitForTimeout(400);
  await page.keyboard.up("Alt");
  await expect(body(page)).toHaveClass(/\bmodel-view\b/);
  await btn.click();
  await expect(body(page)).not.toHaveClass(/\bmodel-view\b/);
  await expect(btn).toHaveAttribute("aria-pressed", "false");
  // Esc ends it.
  await btn.click();
  await expect(body(page)).toHaveClass(/\bmodel-view\b/);
  await page.keyboard.press("Escape");
  await expect(body(page)).not.toHaveClass(/\bmodel-view\b/);
  // Pressed and held: up while held, gone when let go, and that release is
  // not also a tap.
  const box = await btn.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(body(page)).toHaveClass(/\bmodel-view\b/);
  await expect(btn).toHaveAttribute("aria-pressed", "false");
  await page.mouse.up();
  await expect(body(page)).not.toHaveClass(/\bmodel-view\b/);
  await page.waitForTimeout(400);
  await expect(body(page)).not.toHaveClass(/\bmodel-view\b/);
  expect(errors).toEqual([]);
});

test("a text field and a modal dialog keep ⌥, and the window going away ends a held model view", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await boot(page);
  // The warm start is a modal dialog: ⌥ held under it shows nothing.
  await expect(page.locator("#warmstart")).not.toHaveClass(/\bhidden\b/, { timeout: 60_000 });
  await page.evaluate(() => { window.__pwModelSeen = 0; });
  await page.keyboard.down("Alt");
  await page.waitForTimeout(600);
  await page.keyboard.up("Alt");
  expect(await page.evaluate(() => window.__pwModelSeen), "the model view showed under a modal dialog").toBe(0);
  await page.locator("#warm-skip").click();
  // Find a sound is a text field: ⌥ is its own there (it moves by word).
  await page.locator("#bank-find").focus();
  await page.keyboard.down("Alt");
  await page.waitForTimeout(600);
  await page.keyboard.up("Alt");
  expect(await page.evaluate(() => window.__pwModelSeen), "the model view showed from a text field").toBe(0);
  // Held, then the window loses focus: the keyup will never come, so it ends.
  await page.locator("#bank-find").blur();
  await page.mouse.move(700, 450);
  await page.keyboard.down("Alt");
  await expect(body(page)).toHaveClass(/\bmodel-view\b/);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(body(page)).not.toHaveClass(/\bmodel-view\b/);
  await page.keyboard.up("Alt");
  expect(errors).toEqual([]);
});

test("under the model view TASTE shows its side of the toggle, and EVOLVE its guess on the card it favours", async ({ page }) => {
  test.setTimeout(300_000);
  const errors = await boot(page);
  await fitted(page);
  // TASTE: the toggle on its TASTE side while the view is up, and back.
  await goLevel(page, "taste");
  const tog = page.locator("#taste-tog");
  await expect(tog).toHaveAttribute("aria-pressed", "false");
  await modelView(page, true);
  await expect(tog).toHaveAttribute("aria-pressed", "true");
  await modelView(page, false);
  await expect(tog).toHaveAttribute("aria-pressed", "false");
  // EVOLVE: the guess for the pair before the pick, asked of the engine
  // (`duel_pred`, before the pick), on one card only; and each card's style.
  await goLevel(page, "evolve");
  await expect(page.locator("#choose-a")).toBeEnabled({ timeout: 60_000 });
  await expect(page.locator(".duel-guess:visible")).toHaveCount(0);
  await expect(page.locator("#style-a")).toHaveCSS("visibility", "hidden");
  await modelView(page, true);
  const guess = page.locator(".duel-guess:visible");
  await expect(guess).toHaveCount(1, { timeout: 30_000 });
  await expect(guess).toHaveText(/^it guesses this · \d+% · (a hunch|leaning|fairly sure)$/);
  expect(await page.evaluate(() => window.__pwPre || 0)).toBeGreaterThan(0);
  await expect(page.locator("#style-a")).toHaveCSS("visibility", "visible");
  // Picked: the line after the pick says it, and the guess before it goes.
  await page.locator("#choose-a").click();
  await expect(page.locator("#duel-pred")).toHaveText(/^it guessed (this|the other) · /, { timeout: 15_000 });
  await modelView(page, false);
  await expect(page.locator(".duel-guess:visible")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the model view's words say what it is, never a lens", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await boot(page);
  await page.locator("#warm-skip").click();
  await modelView(page, true);
  await expect(page.locator("#model-tag .mt-voice")).not.toHaveText("");
  const copy = await page.evaluate(() => [
    document.body.innerText,
    ...[...document.querySelectorAll("[title]")].map((e) => e.title),
    ...[...document.querySelectorAll("[aria-label]")].map((e) => e.getAttribute("aria-label")),
  ].join("\n"));
  expect(copy).not.toMatch(/\blens\b/i);
  await expect(page.locator("#model-btn")).toHaveAttribute("title", /the model view/i);
  expect(errors).toEqual([]);
});
