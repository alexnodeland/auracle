// ⌘K, the one list (Plan-008 §2.4, ADR-017): every command, with its key,
// and every sound, by its face, found by typing.
//
// What this claims:
//
// - ⌘K (and Ctrl K) opens it at any level: the focus in its field, the
//   level's own commands first (This level), then Anywhere, then Sounds.
//   It opens and filters from what the page holds, with no engine wait
//   (ADR-025: within 100 ms on the reference machine, a budget here).
// - Typing ranks a label's start first: "patch" puts PATCH's level first,
//   ahead of the commands that only hold the word.
// - ↵ runs the row chosen (the arrows choose), and the list closes; Esc
//   closes it and gives the focus back where it was, and that press ends
//   nothing behind it (a tapped model view stays).
// - A file's command (Open a taste file…) opens the file's picker, in the
//   same gesture.
// - While it is open the keys are its field's: a note key plays no note,
//   ⌥↑ moves no level, ⌘Z takes nothing back.
// - Every item the ⋯ menu held is a command in it (Download your taste,
//   Open a taste file…, Download this patch, Download as a picture…, Open a
//   patch file…, Scope & analyzer…, Re-run the three-pick warm start, Reset
//   your taste…, Show measurements, Booth mode, Keys and gestures, Watch the
//   films), and so is every setting KEYS ⋯ holds.
// - With no query it shows five sounds, each with its face's slot; a sound
//   picked from it is the sound in hand, at the level you were at.
const { test, expect, commandRow, runCommand } = require("./fixtures");

const list = (page) => page.locator("#cmdk");
const field = (page) => page.locator("#cmdk-input");
const options = (page) => page.locator("#cmdk-list .cmdk-it");
/** The group names, in the order the list shows them. */
const groups = (page) => page.locator("#cmdk-list .cmdk-grp").allTextContents();

/** The rows under the group `name`. */
const rowsUnder = (page, name) =>
  page.evaluate((name) => {
    const out = [];
    let inside = false;
    for (const li of document.querySelectorAll("#cmdk-list > li")) {
      if (li.classList.contains("cmdk-grp")) inside = li.textContent === name;
      else if (inside) out.push(li.querySelector(".cmdk-lab").textContent);
    }
    return out;
  }, name);

test("⌘K and Ctrl K open the list over any level, its own commands first, at once", async ({ page, app }) => {
  await app.boot();
  await page.keyboard.press("Meta+k");
  await expect(list(page)).toBeVisible();
  await expect(field(page)).toBeFocused();
  await expect(field(page)).toHaveAttribute("role", "combobox");
  await expect(list(page)).toHaveAttribute("aria-modal", "true");
  expect(await groups(page)).toEqual(["This level", "Anywhere", "Sounds"]);
  // PERFORM's commands are This level's; another level's are not listed.
  expect(await rowsUnder(page, "This level")).toContain("Offer: grow a variant into B");
  expect(await rowsUnder(page, "This level")).not.toContain("Another pair");
  // The chosen row is the first, named to a screen reader by the field.
  const first = options(page).first();
  await expect(first).toHaveAttribute("aria-selected", "true");
  await expect(field(page)).toHaveAttribute("aria-activedescendant", await first.getAttribute("id"));
  await page.keyboard.press("Escape");
  await expect(list(page)).toBeHidden();

  await app.level("evolve");
  await page.keyboard.press("Control+k");
  await expect(list(page)).toBeVisible();
  expect(await rowsUnder(page, "This level")).toContain("Another pair");
  // ⌘K again closes it.
  await page.keyboard.press("Control+k");
  await expect(list(page)).toBeHidden();

  // How long the list takes to open and to filter, from the key to the
  // frame after: from what the page holds (ADR-025, 100 ms).
  const took = await page.evaluate(async () => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    const t0 = performance.now();
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "k", code: "KeyK", metaKey: true, bubbles: true }));
    await frame();
    const open = performance.now() - t0;
    const input = document.getElementById("cmdk-input");
    const t1 = performance.now();
    input.value = "ta";
    input.dispatchEvent(new Event("input"));
    await frame();
    return { open, filter: performance.now() - t1, rows: document.querySelectorAll("#cmdk-list .cmdk-it").length };
  });
  expect(took.rows).toBeGreaterThan(0);
  app.budget("⌘K → the list drawn", took.open, 100);
  app.budget("a letter typed → the list filtered", took.filter, 100);
});

test("typing ranks a label's start first, and ↵ runs the row chosen", async ({ page, app }) => {
  await app.boot();
  await page.keyboard.press("Meta+k");
  await page.keyboard.type("patch");
  // PATCH's level starts with it; "Download this patch" only holds it.
  await expect(options(page).first().locator(".cmdk-lab")).toHaveText("PATCH: what the sound is made of");
  await expect(commandRow(page, "Download this patch")).toHaveCount(1);
  // What matched is marked.
  await expect(options(page).first().locator("mark")).toHaveText("PATCH");
  await page.keyboard.press("Enter");
  await expect(list(page)).toBeHidden();
  await expect(page.locator('.rail-stop[data-level="patch"]')).toHaveAttribute("aria-current", "location");

  // The arrows choose: ↓ then ↵ runs the second row. Both start with it,
  // the shorter first; a label that only holds it comes after them.
  await page.keyboard.press("Meta+k");
  await page.keyboard.type("octave");
  await expect(options(page).nth(0).locator(".cmdk-lab")).toHaveText("Octave up");
  await expect(options(page).nth(1).locator(".cmdk-lab")).toHaveText("Octave down");
  const before = (await page.locator("#oct-label").textContent()).trim();
  await page.keyboard.press("ArrowDown");
  await expect(options(page).nth(1)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(list(page)).toBeHidden();
  await expect(page.locator("#oct-label")).not.toHaveText(before);
});

test("Esc closes the list and gives the focus back, and ends nothing behind it", async ({ page, app }) => {
  await app.boot();
  // A tapped model view, and the focus on MODEL as the keyboard left it.
  await page.locator("#model-btn").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("body")).toHaveClass(/\bmodel-view\b/);
  await page.keyboard.press("Meta+k");
  await expect(field(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(list(page)).toBeHidden();
  await expect(page.locator("#model-btn")).toBeFocused();
  await expect(page.locator("body"), "the press that closed the list left the model view up").toHaveClass(/\bmodel-view\b/);
  // Opened with a click, it leaves no focus behind it (Space then plays).
  await page.locator("#cmdk-btn").click();
  await expect(field(page)).toBeFocused();
  await page.locator("#cmdk-scrim").click({ position: { x: 5, y: 5 } });
  await expect(list(page)).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.activeElement === document.body)).toBe(true);
});

test("a file's command opens its picker", async ({ page, app }) => {
  await app.boot();
  await page.keyboard.press("Meta+k");
  await page.keyboard.type("open a taste");
  await expect(options(page).first().locator(".cmdk-lab")).toHaveText("Open a taste file…");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 5_000 }), page.keyboard.press("Enter")]);
  expect(chooser.isMultiple()).toBe(false);
  await expect(list(page)).toBeHidden();
  // And with the mouse.
  const [again] = await Promise.all([page.waitForEvent("filechooser", { timeout: 5_000 }), runCommand(page, "Open a patch file…")]);
  expect(again).toBeTruthy();
});

test("while the list is open no note plays, no level moves and ⌘Z takes nothing back", async ({ page, app }) => {
  await app.boot();
  await page.keyboard.press("Meta+k");
  await page.keyboard.down("a");
  await expect(field(page)).toHaveValue("a");
  await expect(page.locator('.pkey[data-note="60"]')).not.toHaveClass(/\bdown\b/);
  await page.keyboard.up("a");
  await page.keyboard.press("Alt+ArrowUp");
  await page.keyboard.press("Meta+z");
  await app.quiet();
  await expect(page.locator('.pkey[data-note="60"]')).not.toHaveClass(/\bdown\b/);
  await expect(page.locator('.rail-stop[data-level="perform"]')).toHaveAttribute("aria-current", "location");
  await expect(page.locator("#toasts"), "⌘Z in the field said nothing about undoing").not.toContainText("Nothing to undo here");
  await page.keyboard.press("Escape");
  // Closed, the keys are the keybed's again.
  await page.keyboard.down("a");
  await expect(page.locator('.pkey[data-note="60"]')).toHaveClass(/\bdown\b/);
  await page.keyboard.up("a");
});

test("every item the ⋯ menu held, and every setting in KEYS ⋯, is a command", async ({ page, app }) => {
  await app.boot();
  await page.keyboard.press("Meta+k");
  await expect(list(page)).toBeVisible();
  const anywhere = await rowsUnder(page, "Anywhere");
  for (const label of [
    "Download your taste", "Open a taste file…", "Download this patch", "Download as a picture…", "Open a patch file…",
    "Scope & analyzer…", "Re-run the three-pick warm start", "Reset your taste…", "Show measurements", "Booth mode",
    "Keys and gestures", "Watch the films", "What are the three banks?",
    "Hold: latch held notes", "Unison: all 4 voices on one note, detuned wide", "Arpeggiator: hold a chord, it plays the pattern",
    "Tempo sync: step sequencers play the nearest division of the tempo", "Glide: how long a note takes to slide to the next one in a line",
    "Taller keybed, for fingers rather than a mouse", "How much of the keybed to show: fewer octaves, wider keys", "Silence all voices",
    "Master volume: live keys and every ▶", "MIDI: devices, knob mapping, clock", "Record what you play; stop to download a WAV",
  ]) expect(anywhere, label).toContain(label);
  // A setting says its state, and running it changes it.
  await page.keyboard.type("hold: latch");
  await page.keyboard.press("Enter");
  await expect(page.locator("#hold-btn")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Meta+k");
  await page.keyboard.type("hold: latch");
  await expect(options(page).first().locator(".cmdk-hint")).toHaveText("on");
  await page.keyboard.press("Enter");
  await expect(page.locator("#hold-btn")).toHaveAttribute("aria-pressed", "false");
  // A panel a command opens takes the focus.
  await runCommand(page, "Scope & analyzer…");
  await expect(page.locator("#scope-panel")).toBeVisible();
  await expect(page.locator("#sp-mode")).toBeFocused();
});

test("five sounds with no query, each with its face's slot, and one picked is in your hands at this level", async ({ page, app }) => {
  await app.boot();
  await app.poolRows(40);
  const name = (await page.locator("#bank-list .bank-item[data-id] .bi-name").nth(6).textContent()).trim();
  await page.keyboard.press("Meta+k");
  await expect.poll(() => rowsUnder(page, "Sounds")).toHaveLength(5);
  await expect(page.locator("#cmdk-list .cmdk-it .face-slot.face-cmdk")).toHaveCount(5);
  await page.keyboard.type(name);
  await expect(options(page).first().locator(".cmdk-lab")).toHaveText(name);
  await page.keyboard.press("Enter");
  await app.engine((timeout) => expect(page.locator("#live-label")).toHaveText(name, { timeout }), { ms: 30_000 });
  await expect(page.locator('.rail-stop[data-level="perform"]')).toHaveAttribute("aria-current", "location");
});
