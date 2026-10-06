// The model view (Plan-008 §2.5, ADR-017): what the model believes, raised
// over whatever level shows. Held (⌥ for 220 ms, or MODEL pressed) it shows
// while held; tapped it stays until a tap or Esc. It shows engine facts only:
// each bank row's guess and, once fitted, the pool in the order the model
// rates it (letting go puts the order back); TASTE's side of its toggle;
// EVOLVE's guess for the pair before you pick, on the card it favours.
// Another key during the hold cancels it, so ⌥↑ never flashes it; a text
// field and a modal dialog keep ⌥; the window's blur ends it, and Esc does
// when nothing nearer takes the press (in PATCH: the selection, the catalog
// first). A tapped view is remembered across a reload, and PATCH's old LEANS
// switch, left on, comes back as one. Its words say "the model view", never
// "lens" (www/brand/voice.md).
const { test, expect, goLevel, bankTab, modelView } = require("./fixtures");
const { rackAtRest } = require("./patch_page");
const fs = require("fs");
const path = require("path");

const PKG = path.join(__dirname, "..", "..", "apps", "web", "pkg", "auracle_wasm_bg.wasm");

/** ⌥ held past the model view's hold (220 ms, apps/web/shell.js
 *  `MODEL_HOLD_MS`): the gesture that raises it. */
const ALT_HELD_MS = 400;

// Every time the page wore the model view, however briefly.
const INIT = `(() => {
  window.__pwModelSeen = 0;
  const watch = () => new MutationObserver(() => {
    if (document.body.classList.contains("model-view")) window.__pwModelSeen += 1;
  }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  if (document.body) watch();
  else document.addEventListener("DOMContentLoaded", watch);
})();`;

/** Seeded, with the tours seen and the warm start not (the fixture's
 *  `app.boot`, which also runs AURACLE_CPU_THROTTLE's slower page and
 *  engine), the model view watched. */
async function boot(page, app) {
  expect(fs.existsSync(PKG), `no built engine at ${PKG}: run \`make wasm\` first`).toBe(true);
  await page.addInitScript(INIT);
  await app.boot({ warmed: false });
}

/** The warm start's three picks, which fit the model, and a full pool. */
async function fitted(page, app) {
  await app.warmStart([1, 4, 7]);
  await bankTab(page, "pool");
  await app.poolRows(40);
}

const rowIds = (page) =>
  page.evaluate(() => [...document.querySelectorAll("#bank-list .bank-item[data-id]")].map((e) => Number(e.dataset.id)));
const pcts = (page) =>
  page.evaluate(() => [...document.querySelectorAll("#bank-list .bank-item[data-id] .bi-pct")].map((e) => parseInt(e.textContent, 10)));
const body = (page) => page.locator("body");

test("holding ⌥ shows each row's guess and the pool in the order it rates them; letting go puts the order back", async ({ page, app }) => {
  await boot(page, app);
  await fitted(page, app);
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
});

test("⌥ and an arrow move a level and never flash the model view", async ({ page, app }) => {
  await boot(page, app);
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
  await app.quiet();
  expect(await page.evaluate(() => window.__pwModelSeen), "the model view showed during ⌥↑").toBe(0);
  await key("keyup", "Alt", "AltLeft", false);
  await expect(body(page)).not.toHaveClass(/\bmodel-view\b/);
});

test("a tap on MODEL keeps the model view until a second tap or Esc; a press held on it shows it only while held", async ({ page, app }) => {
  await boot(page, app);
  await page.locator("#warm-skip").click();
  const btn = page.locator("#model-btn");
  await btn.click();
  await expect(body(page)).toHaveClass(/\bmodel-view\b/);
  await expect(btn).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#model-tag .mt-voice")).toHaveText(/^still guessing · /);
  // A held ⌥ and its release do not end a view that was tapped on.
  await page.mouse.move(700, 450);
  await page.keyboard.down("Alt");
  // eslint-disable-next-line playwright/no-wait-for-timeout -- ⌥ held past the model view's hold, a gesture
  await page.waitForTimeout(ALT_HELD_MS);
  await page.keyboard.up("Alt");
  await expect(body(page)).toHaveClass(/\bmodel-view\b/);
  await btn.click();
  await expect(body(page)).not.toHaveClass(/\bmodel-view\b/);
  await expect(btn).toHaveAttribute("aria-pressed", "false");
  // Esc in a text field is the field's: Find a sound clears, and the view
  // stays. Esc elsewhere ends it.
  await btn.click();
  await expect(body(page)).toHaveClass(/\bmodel-view\b/);
  await page.locator("#bank-find").fill("warm");
  await page.locator("#bank-find").press("Escape");
  await expect(page.locator("#bank-find")).toHaveValue("");
  await expect(body(page)).toHaveClass(/\bmodel-view\b/);
  await page.locator("#bank-find").blur();
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
  await app.quiet();
  await expect(body(page)).not.toHaveClass(/\bmodel-view\b/);
});

test("a text field and a modal dialog keep ⌥, and the window going away ends a held model view", async ({ page, app }) => {
  await boot(page, app);
  // The warm start is a modal dialog: ⌥ held under it shows nothing.
  await app.engine((timeout) => expect(page.locator("#warmstart")).not.toHaveClass(/\bhidden\b/, { timeout }), { ms: 60_000 });
  await page.evaluate(() => { window.__pwModelSeen = 0; });
  await page.keyboard.down("Alt");
  await app.quiet();
  await page.keyboard.up("Alt");
  expect(await page.evaluate(() => window.__pwModelSeen), "the model view showed under a modal dialog").toBe(0);
  await page.locator("#warm-skip").click();
  // Find a sound is a text field: ⌥ is its own there (it moves by word).
  await page.locator("#bank-find").focus();
  await page.keyboard.down("Alt");
  await app.quiet();
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
});

test("under the model view TASTE shows its side of the toggle, and EVOLVE its guess on the card it favours", async ({ page, app }) => {
  await boot(page, app);
  await fitted(page, app);
  // TASTE: the toggle on its TASTE side while the view is up, and back.
  await goLevel(page, "taste");
  const tog = page.locator("#taste-tog");
  await expect(tog).toHaveAttribute("aria-pressed", "false");
  await modelView(page, true);
  await expect(tog).toHaveAttribute("aria-pressed", "true");
  // While the view holds the map there, the switch rests and says why.
  await expect(tog).toBeDisabled();
  await expect(tog).toHaveAttribute("title", /model view/);
  await modelView(page, false);
  await expect(tog).toHaveAttribute("aria-pressed", "false");
  await expect(tog).toBeEnabled();
  // EVOLVE: the guess for the pair before the pick, asked of the engine
  // (`duel_pred` with `pre`), on one card only; and the cards' style badges
  // come out of hiding (their visibility: a badge is empty when no style
  // claims its sound, so its text is not what is checked).
  await goLevel(page, "evolve");
  await app.engine((timeout) => expect(page.locator("#choose-a")).toBeEnabled({ timeout }), { ms: 60_000 });
  await expect(page.locator(".duel-guess:visible")).toHaveCount(0);
  await expect(page.locator("#style-a")).toHaveCSS("visibility", "hidden");
  await modelView(page, true);
  const guess = page.locator(".duel-guess:visible");
  await app.engine((timeout) => expect(guess).toHaveCount(1, { timeout }), { ms: 30_000 });
  await expect(guess).toHaveText(/^it guesses this · \d+% · (a hunch|leaning|fairly sure)$/);
  expect((await app.replies("duel_pred", { where: { pre: true } })).length).toBeGreaterThan(0);
  await expect(page.locator("#style-a")).toHaveCSS("visibility", "visible");
  // Picked: the line after the pick says it, and the guess before it goes.
  await page.locator("#choose-a").click();
  await expect(page.locator("#duel-pred")).toHaveText(/^it guessed (this|the other) · /, { timeout: 15_000 });
  await modelView(page, false);
  await expect(page.locator(".duel-guess:visible")).toHaveCount(0);
});

test("the model view's words say what it is, never a lens", async ({ page, app }) => {
  await boot(page, app);
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
});

test("in PATCH Esc closes what is nearer before it ends a tapped model view, and a tapped view is remembered across a reload", async ({ page, app }) => {
  await boot(page, app);
  await page.locator("#warm-skip").click();
  await goLevel(page, "patch");
  await bankTab(page, "presets");
  await page.locator(".bank-item", { hasText: "Reese" }).first().click();
  await app.engine((timeout) => expect(page.locator("#rack-subject")).toContainText("Reese", { timeout }), { ms: 60_000 });
  const btn = page.locator("#model-btn");
  await btn.click();
  await expect(body(page)).toHaveClass(/\bmodel-view\b/);
  // The selection goes first, the view stays. The press is aimed at the
  // rack at rest: the name changes as Reese lands, while the camera is
  // still on its way from the last sound's fit and that sound's plates are
  // still leaving, so a plate's box read then is not where it is clicked.
  await rackAtRest(page);
  const plate = page.locator('#rack-svg .rack-plates g[data-kind="filter"] .mod-plate').first();
  const b = await plate.boundingBox();
  await page.mouse.click(b.x + 10, b.y + b.height - 6);
  await page.mouse.move(4, 400);
  await expect(page.locator('#rack-svg .rack-plates g[data-kind="filter"].selected')).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator("#rack-svg .rack-plates g.selected")).toHaveCount(0);
  await expect(body(page)).toHaveClass(/\bmodel-view\b/);
  // Then the catalog, the view still up.
  await page.locator("#pt-add").click();
  await expect(page.locator("#nodebank")).toBeVisible();
  await page.mouse.move(4, 400);
  await page.locator("#rack-subject").click();
  await page.keyboard.press("Escape");
  await expect(page.locator("#nodebank")).toBeHidden();
  await expect(body(page)).toHaveClass(/\bmodel-view\b/);
  // With nothing nearer, Esc ends it, and that is remembered too.
  await page.keyboard.press("Escape");
  await expect(body(page)).not.toHaveClass(/\bmodel-view\b/);
  expect(await page.evaluate(() => localStorage.getItem("auracle-model-view"))).toBe("0");
  // Tapped on, and the page reloaded: still up, as a tap (MODEL pressed).
  await btn.click();
  await expect(body(page)).toHaveClass(/\bmodel-view\b/);
  await app.reload();
  await expect(body(page)).toHaveClass(/\bmodel-view\b/);
  await expect(btn).toHaveAttribute("aria-pressed", "true");
});

test("PATCH's old LEANS switch, left on, comes back as a tapped model view, once", async ({ page, app }) => {
  await page.addInitScript(() => {
    try {
      if (!sessionStorage.getItem("pw-seeded")) {
        sessionStorage.setItem("pw-seeded", "1");
        localStorage.setItem("auracle-belief", "1");
      }
    } catch (_) {}
  });
  await boot(page, app);
  await expect(body(page)).toHaveClass(/\bmodel-view\b/);
  await expect(page.locator("#model-btn")).toHaveAttribute("aria-pressed", "true");
  const keys = await page.evaluate(() => ({ old: localStorage.getItem("auracle-belief"), now: localStorage.getItem("auracle-model-view") }));
  expect(keys).toEqual({ old: null, now: "1" });
});
