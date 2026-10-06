// The levels (Plan-008 PR A, ADR-017): the rail at the stage's right edge and
// the level keys move between PERFORM, PATCH, EVOLVE, TASTE and LEARNING, the
// header names where you are, and the keys bar keeps every control it had.
//
// What this claims:
//
// - The app opens at PERFORM, with no hash and no saved level.
// - A stop on the rail goes to its level; ⌥↑ zooms out and ⌥↓ in, ⌥← goes to
//   EVOLVE and ⌥→ back to PERFORM, ⌥1–5 go to PERFORM, PATCH, EVOLVE, TASTE
//   and LEARNING; the arrows on a focused stop walk the rail. After each,
//   exactly one level's section shows, its stop alone is
//   `aria-current=location`, `body[data-level]` names it, and `#where` says
//   its name and its line.
// - A text field keeps ⌥ and an arrow (there it moves by word): ⌥↑ in PATCH's
//   module search and in the tempo field changes no level. A modal dialog
//   keeps them too. ⌥ alone is taken (Firefox and Edge on Windows open the
//   window's menu on it).
// - Pointing at the levels puts no names over the stage: each stop holds its
//   icon alone, its name and key are its tooltip (`title`, the platform's
//   own keys), and its name, line and key a screen reader's (`aria-label`,
//   `aria-keyshortcuts`).
// - Space plays the sound in hand at every level (ADR-016): the output
//   sounds, the header's ▶ lights, and Space again stops it.
// - A reload comes back to the level you were at; a link with a level's hash
//   opens that level, and so does the hash changed in place.
// - KEYS ⋯ reaches every control that left the bar (HOLD, UNI, ARP, SYNC,
//   glide, ⇕ tall, the span, silence, and with ARP the arp's settings), is lit
//   and says so while one plays differently, and folds on Esc; VOL, MIDI and
//   ● REC stay on the bar.
//
// It reads the output level through an analyser on everything the app
// connects to the destination, as space_after_a_click.spec.js does.
const { test, expect, goLevel, openKeys, bankTab, openCatalog } = require("./fixtures");

const INIT = `(() => {
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...rest) {
    const r = connect.call(this, dest, ...rest);
    if (typeof AudioDestinationNode !== "undefined" && dest instanceof AudioDestinationNode) {
      let a = this.context.__pwTap;
      if (!a) {
        a = this.context.createAnalyser();
        a.fftSize = 2048;
        this.context.__pwTap = a;
        window.__pwTap = a;
      }
      connect.call(this, a);
    }
    return r;
  };
  window.__pwPeakDb = () => {
    const a = window.__pwTap;
    if (!a) return -Infinity;
    const b = new Float32Array(a.fftSize);
    a.getFloatTimeDomainData(b);
    let peak = 0;
    for (const x of b) peak = Math.max(peak, Math.abs(x));
    return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
  };
  // Whether ⌥ alone reached the page's bubble phase already taken.
  window.__pwAlt = [];
  document.addEventListener("keydown", (e) => { if (e.key === "Alt") window.__pwAlt.push(e.defaultPrevented); });
})();`;

/** Seeded, with the warm start and the tours seen (the fixture's
 *  `app.boot`), the output and ⌥ watched. */
async function boot(page, app) {
  await page.addInitScript(INIT);
  await app.boot();
}

const WHERE = {
  perform: ["Perform", "the sound, under your hands"],
  patch: ["Patch", "what the sound is made of"],
  evolve: ["Evolve", "what it could become"],
  taste: ["Taste", "the sound among all sounds"],
  learning: ["Learning", "how it learns your taste"],
};

/** One level on, its stop alone current, and the header naming it. */
async function expectAt(page, level) {
  await expect(page.locator("body")).toHaveAttribute("data-level", level);
  await expect(page.locator(`#view-${level}`)).toBeVisible();
  expect(await page.locator("section.view:not(.hidden)").count(), `one level shows at ${level}`).toBe(1);
  await expect(page.locator('.rail-stop[aria-current="location"]')).toHaveCount(1);
  await expect(page.locator(`.rail-stop[data-level="${level}"]`)).toHaveAttribute("aria-current", "location");
  await expect(page.locator("#where .where-n")).toHaveText(WHERE[level][0]);
  await expect(page.locator("#where .where-d")).toHaveText(WHERE[level][1]);
}

test("the rail and the level keys move between the levels, and the header says where you are", async ({ page, app }) => {
  await boot(page, app);
  // At rest is PERFORM.
  await expectAt(page, "perform");
  await expect(page).toHaveURL(/#perform$/);

  // The rail, each stop.
  for (const level of ["patch", "evolve", "taste", "learning", "perform"]) {
    await goLevel(page, level);
    await expectAt(page, level);
  }

  // ⌥↑ zooms out, ⌥↓ in, and the axis ends.
  const key = async (k, level) => {
    await page.keyboard.press(k);
    await expectAt(page, level);
  };
  await key("Alt+ArrowUp", "taste");
  await key("Alt+ArrowUp", "learning");
  await key("Alt+ArrowUp", "learning");
  await key("Alt+ArrowDown", "taste");
  await key("Alt+ArrowDown", "perform");
  await key("Alt+ArrowDown", "patch");
  await key("Alt+ArrowDown", "patch");
  // ⌥← to EVOLVE, beside PERFORM; ⌥→ back; a step from EVOLVE is measured
  // from PERFORM.
  await key("Alt+ArrowLeft", "evolve");
  await key("Alt+ArrowRight", "perform");
  await key("Alt+ArrowLeft", "evolve");
  await key("Alt+ArrowUp", "taste");
  // ⌥1–5.
  for (const [d, level] of [["1", "perform"], ["2", "patch"], ["3", "evolve"], ["4", "taste"], ["5", "learning"]]) {
    await key(`Alt+Digit${d}`, level);
  }
  // The arrows on a focused stop walk the rail, and the focus follows.
  await page.locator('.rail-stop[data-level="learning"]').focus();
  await page.keyboard.press("ArrowDown");
  await expectAt(page, "taste");
  await expect(page.locator('.rail-stop[data-level="taste"]')).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowLeft");
  await expectAt(page, "evolve");
  await page.keyboard.press("End");
  await expectAt(page, "patch");

  // ⌥ alone is taken before the window's menu can have it.
  await page.locator("#view-patch").focus();
  await page.evaluate(() => { window.__pwAlt.length = 0; });
  await page.keyboard.press("Alt");
  expect(await page.evaluate(() => window.__pwAlt)).toEqual([true]);
});

// The names that popped up beside every stop while the levels were pointed at
// (#286) are gone: a stop's name and key are its tooltip, and its name, line
// and key a screen reader's.
test("pointing at the levels puts no names over the stage, and each stop keeps its name and key", async ({ page, app }) => {
  await boot(page, app);
  const KEY = { perform: 1, patch: 2, evolve: 3, taste: 4, learning: 5 };
  for (const [level, n] of Object.entries(KEY)) {
    const [name, line] = WHERE[level];
    const stop = page.locator(`.rail-stop[data-level="${level}"]`);
    await stop.hover();
    // Pointed at, the stop holds its icon alone, and the levels hold no words
    // but their ends' (out, in).
    await expect(stop).toHaveText("");
    await expect(page.locator("#rail")).toHaveText(/^\s*out\s*in\s*$/);
    // Its tooltip, in the platform's own keys: Taste · ⌥4 on a Mac, Taste · Alt 4 elsewhere.
    await expect(stop).toHaveAttribute("title", new RegExp(`^${name} · (⌥|Alt )${n}$`));
    await expect(stop).toHaveAttribute("aria-label", `${name}: ${line}`);
    await expect(stop).toHaveAttribute("aria-keyshortcuts", `Alt+${n}`);
  }
});

test("a text field and a modal dialog keep ⌥ and the arrows", async ({ page, app }) => {
  await boot(page, app);
  // PATCH's module search: ⌥↑ and ⌥← move by word there, never a level.
  await goLevel(page, "patch");
  await openCatalog(page);
  const search = page.locator("#nb-q");
  await search.click();
  await search.fill("grit vowel");
  await page.keyboard.press("Alt+ArrowUp");
  await page.keyboard.press("Alt+ArrowLeft");
  await page.keyboard.press("Alt+Digit4");
  await expectAt(page, "patch");
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("grit vowel");
  await page.keyboard.press("Escape");

  // KEYS ⋯'s tempo field, with ARP on.
  await openKeys(page);
  await page.locator("#arp-btn").click();
  await page.locator("#bpm").click();
  await page.keyboard.press("Alt+ArrowUp");
  await expectAt(page, "patch");
  await expect(page.locator("#bpm")).toBeFocused();
  await page.locator("#arp-btn").click();

  // The ? card is modal: the level behind it does not move.
  await page.locator("#view-patch").click({ position: { x: 4, y: 4 } });
  await page.keyboard.press("?");
  await expect(page.locator("#help")).toBeVisible();
  await page.keyboard.press("Alt+ArrowUp");
  await expectAt(page, "patch");
  await page.locator("#help-close").click();
  await page.keyboard.press("Alt+ArrowUp");
  await expectAt(page, "perform");
});

test("Space plays the sound in hand at every level, and the header's ▶ says so", async ({ page, app }) => {
  await boot(page, app);
  await bankTab(page, "presets");
  await page.locator(".bank-item", { hasText: "Glass Pad" }).first().click();
  await app.engine((timeout) => expect(page.locator("#live-label")).toHaveText("Glass Pad", { timeout }), { ms: 60_000 });
  await app.engine((timeout) => expect(page.locator("#rack-subject")).toContainText("Glass Pad", { timeout }), { ms: 60_000 });
  const play = page.locator("#inhand-play");
  await expect(play).toBeEnabled();
  for (const level of ["perform", "patch", "evolve", "taste", "learning"]) {
    await goLevel(page, level);
    await page.keyboard.press(" ");
    await app.engine((timeout) => expect.poll(() => page.evaluate(() => window.__pwPeakDb()), { timeout, message: `Space sounds at ${level}` }).toBeGreaterThan(-50), { ms: 30_000 });
    await expect(play).toHaveClass(/\bplaying\b/);
    await page.keyboard.press(" ");
    await expect.poll(() => page.evaluate(() => window.__pwPeakDb()), { timeout: 15_000, message: `Space again stops it at ${level}` }).toBeLessThan(-80);
    await expect(play).not.toHaveClass(/\bplaying\b/);
  }
  // The header's ▶ is Space too.
  await play.click();
  await app.engine((timeout) => expect.poll(() => page.evaluate(() => window.__pwPeakDb()), { timeout }).toBeGreaterThan(-50), { ms: 30_000 });
  await play.click();
  await expect.poll(() => page.evaluate(() => window.__pwPeakDb()), { timeout: 15_000 }).toBeLessThan(-80);
});

test("a reload comes back to the level you were at, and a level's link opens it", async ({ page, app }) => {
  await boot(page, app);
  // A full load of `path`, never a move within the page (`app.visit`).
  const load = (path) => app.visit(path);
  await goLevel(page, "taste");
  await expect(page).toHaveURL(/#taste$/);
  // A fresh visit with no hash: the level saved last time.
  await load("/");
  await expectAt(page, "taste");
  // A link to another level wins over the saved one, on a full load.
  expect(await page.evaluate(() => localStorage.getItem("auracle-view"))).toBe("taste");
  await load("/#learning");
  await expectAt(page, "learning");
  // The hash changed in place moves too.
  await page.evaluate(() => { location.hash = "#evolve"; });
  await expectAt(page, "evolve");
  // A reload keeps the hash's level over a different saved one.
  await page.evaluate(() => localStorage.setItem("auracle-view", "taste"));
  await app.reload();
  await expectAt(page, "evolve");
  // PATCH's old name, saved before the levels, still opens PATCH.
  await page.evaluate(() => localStorage.setItem("auracle-view", "play"));
  await load("/");
  await expectAt(page, "patch");
  // The wordmark goes to PERFORM without a new history entry.
  const entries = await page.evaluate(() => history.length);
  await page.locator(".brand").click();
  await expectAt(page, "perform");
  expect(await page.evaluate(() => history.length), "the wordmark's move replaces the address").toBe(entries);
});

test("stage mode, which is modal, keeps the level keys", async ({ page, app }) => {
  await boot(page, app);
  await bankTab(page, "presets");
  await page.locator(".bank-item", { hasText: "Glass Pad" }).first().click();
  await app.engine((timeout) => expect(page.locator(".pf-name")).toHaveText("Glass Pad", { timeout }), { ms: 60_000 });
  await page.locator("#view-perform").click({ position: { x: 4, y: 4 } });
  await page.keyboard.press("Shift+F");
  await expect(page.locator(".st-stage")).toBeVisible();
  await page.keyboard.press("Alt+ArrowDown");
  await page.keyboard.press("Alt+Digit2");
  await expectAt(page, "perform");
  await expect(page.locator(".st-stage")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".st-stage")).toHaveCount(0);
  await page.keyboard.press("Alt+ArrowDown");
  await expectAt(page, "patch");
});

test("a note held while ⌥ goes down is let go by its key", async ({ page, app }) => {
  await boot(page, app);
  // On a Mac, ⌥ held turns the A key's keyup into "å": the note is let go by
  // the physical key, or it would sound for good.
  await page.evaluate(() => {
    const send = (type, key) => document.dispatchEvent(new KeyboardEvent(type, { key, code: "KeyA", bubbles: true }));
    send("keydown", "a");
  });
  await expect(page.locator('.pkey[data-note="60"]')).toHaveClass(/\bdown\b/);
  await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", code: "AltLeft", altKey: true, bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keyup", { key: "å", code: "KeyA", altKey: true, bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt", code: "AltLeft", bubbles: true }));
  });
  await expect(page.locator('.pkey[data-note="60"]')).not.toHaveClass(/\bdown\b/);
});

// Every control a level shows, as it is drawn (clipped by any scrolling or
// clipping box it sits in), against the levels' stops: none may lie under
// one. EVOLVE's stop branches left of PERFORM's, so this is where a level
// laid out to the stage's edge would lose a control.
const COVERED = `(() => {
  const stops = [...document.querySelectorAll(".rail-stop")].map((s) => s.getBoundingClientRect());
  const sel = "button, a[href], input, select, textarea, [role=slider], [role=button], [data-addr], .pf-knob, .nb-item, .bank-item";
  const out = [];
  for (const el of document.querySelectorAll(sel)) {
    if (el.closest(".rail") || el.closest(".hidden")) continue;
    let r = el.getBoundingClientRect();
    if (!r.width || !r.height || getComputedStyle(el).visibility === "hidden") continue;
    let box = { l: r.left, t: r.top, r: r.right, b: r.bottom };
    for (let p = el.parentElement; p && box; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.overflow === "visible" && cs.overflowX === "visible" && cs.overflowY === "visible") continue;
      const q = p.getBoundingClientRect();
      box = { l: Math.max(box.l, q.left), t: Math.max(box.t, q.top), r: Math.min(box.r, q.right), b: Math.min(box.b, q.bottom) };
      if (box.r - box.l < 1 || box.b - box.t < 1) box = null;
    }
    if (!box) continue;
    for (const s of stops) {
      if (box.l < s.right && box.r > s.left && box.t < s.bottom && box.b > s.top) {
        out.push((el.id ? "#" + el.id : el.className.baseVal ?? el.className) + " " + (el.textContent || "").trim().slice(0, 24));
        break;
      }
    }
  }
  return out;
})()`;

for (const width of [1000, 1080, 1440]) {
  test(`at ${width} px the levels cover no control at any level`, async ({ page, app }) => {
    await page.setViewportSize({ width, height: 800 });
    await boot(page, app);
    await bankTab(page, "presets");
    await page.locator(".bank-item", { hasText: "Glass Pad" }).first().click();
    await app.engine((timeout) => expect(page.locator("#rack-subject")).toContainText("Glass Pad", { timeout }), { ms: 60_000 });
    for (const level of ["perform", "patch", "evolve", "taste", "learning"]) {
      await goLevel(page, level);
      await page.mouse.move(10, 400);
      expect(await page.evaluate(COVERED), `controls under the levels at ${level}, ${width} px`).toEqual([]);
    }
  });
}

test("KEYS ⋯ reaches every control that left the bar, and the bar keeps VOL, MIDI and REC", async ({ page, app }) => {
  await boot(page, app);
  for (const id of ["vol", "midi-ind", "rec-btn", "keys-btn", "oct-down", "oct-label", "oct-up", "live-label"]) {
    await expect(page.locator(`#${id}`), `#${id} is on the bar`).toBeVisible();
  }
  await expect(page.locator("#keys-pop")).toBeHidden();
  await openKeys(page);
  await expect(page.locator("#keys-btn")).toHaveAttribute("aria-expanded", "true");
  for (const id of ["hold-btn", "uni-btn", "arp-btn", "sync-btn", "glide", "bigkeys-btn", "key-span", "panic-btn"]) {
    await expect(page.locator(`#${id}`), `#${id} is in KEYS ⋯`).toBeVisible();
  }
  // The arp's settings, with ARP on; the chip on the bar says what it plays,
  // and KEYS ⋯ is lit and says why.
  await expect(page.locator("#arp-ctl")).toBeHidden();
  await page.locator("#arp-btn").click();
  for (const id of ["arp-mode", "arp-div", "bpm", "arp-oct", "arp-gate", "arp-swing"]) {
    await expect(page.locator(`#${id}`), `#${id} shows with ARP on`).toBeVisible();
  }
  await expect(page.locator("#arp-chip")).toBeVisible();
  await expect(page.locator("#arp-chip")).toHaveText(/^arp 1\/8 · 120$/);
  await expect(page.locator("#keys-btn")).toHaveClass(/\blit\b/);
  await expect(page.locator("#keys-btn")).toHaveAttribute("title", /on now: arp$/);
  // It stays open through the dock's own controls and a note.
  await page.locator("#hold-btn").click();
  await page.locator("#oct-up").click();
  await expect(page.locator("#oct-label")).toHaveText("C5");
  await page.locator("#oct-down").click();
  await page.keyboard.press("a");
  await expect(page.locator("#keys-pop")).toBeVisible();
  await expect(page.locator("#keys-btn")).toHaveAttribute("title", /on now: hold, arp$/);
  // Esc folds it; the chip opens it again.
  await page.keyboard.press("Escape");
  await expect(page.locator("#keys-pop")).toBeHidden();
  await page.locator("#arp-chip").click();
  await expect(page.locator("#keys-pop")).toBeVisible();
  // Off again, and a press outside the dock folds it.
  await page.locator("#arp-btn").click();
  await page.locator("#hold-btn").click();
  await expect(page.locator("#arp-chip")).toBeHidden();
  await expect(page.locator("#keys-btn")).not.toHaveClass(/\blit\b/);
  await page.locator("#where").click();
  await expect(page.locator("#keys-pop")).toBeHidden();
});
