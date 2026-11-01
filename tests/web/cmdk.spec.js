// ⌘K, the one list (Plan-008 §2.4, ADR-017): every command, with its key,
// and every sound, by its face, found by typing.
//
// What this claims:
//
// - ⌘K (and Ctrl K) opens it at any level: the focus in its field, the
//   level's own commands first (This level), then Anywhere, then Sounds.
//   It opens and filters from what the page holds, with no engine wait
//   (ADR-025: within 100 ms on the reference machine, from the key or the
//   letter to the frame that shows it painted, a budget here).
// - The key or the letter draws the rows the list can show in its own task,
//   and the rest after (#513); the list stands at the whole list's height
//   from the first frame, each row says where it stands in the whole list,
//   ↑ from the first row chooses the last at once, and a hand on the
//   list's scroll draws the rest at once. A letter puts the list back at
//   its top, its first row chosen and in sight, typed in the same frame as
//   the arrows that scrolled it down too, and that scroll back draws no
//   more than the rows in sight.
// - Typing ranks a label's start first: "patch" puts PATCH's level first,
//   ahead of the commands that only hold the word.
// - ↵ runs the row chosen (the arrows choose), and the list closes; with
//   nothing found, ↵ leaves the list open with what was typed; Tab
//   walks the field and the foot's links (the author, the source) and stays
//   in the list; Esc closes it and gives the focus back where it was, and
//   that press ends nothing behind it (a tapped model view stays).
// - A file's command (Open a taste file…) opens the file's picker, in the
//   same gesture.
// - While it is open the keys are its field's: a note key plays no note,
//   ⌥↑ moves no level, ⌘Z takes nothing back.
// - At PATCH, "undo" finds Undo an edit first, with ⌘Z, and ↵ on it takes
//   back the last edit, not every one (Undo to as opened does that).
// - Every item the ⋯ menu held is a command in it (Download your taste,
//   Open a taste file…, Download this patch, Download as a picture…, Open a
//   patch file…, Scope & analyzer…, Re-run the three-pick warm start, Reset
//   your taste…, Show measurements, Booth mode, Keys and gestures, Watch the
//   films), and so is every setting KEYS ⋯ holds; Show measurements and
//   Booth mode keep the ⋯ items' tooltips; a setting says *on*, the
//   scope's and the picture's panels open whole under the menu bar (they hung
//   inside it, which clips them) and stand under the list's scrim when it
//   opens over them, and a level's own run as their
//   controls do (Freeze Wander freezes WANDER; How the catalog works opens
//   the catalog's walkthrough).
// - With no query it shows five sounds, each with its face's slot; a sound
//   picked from it is the sound in hand, at the level you were at. A preset
//   the pool lacks is listed with the face the app ships for it, and the
//   engine is asked for none.
// - ? over a PERFORM control asks about it (explain.js, which claims the
//   key first); ? anywhere else opens the list; and the list's What does
//   BRIGHT do? opens BRIGHT's answer as ? over it does, printing no key,
//   since ? away from BRIGHT is the list's.
const fs = require("fs");
const path = require("path");
const { test, expect, goLevel, bankTab, commandRow, runCommand, listWhole, PERFORM_SEED } = require("./fixtures");
const patchPage = require("./patch_page.js");

// The faces the app ships for the presets (`make preset-faces`), by the key the
// worker files each under.
const SHIPPED = JSON.parse(fs.readFileSync(path.join(__dirname, "../../apps/web/preset-faces.json"), "utf8"));
const SHIPPED_KEY = new Map(SHIPPED.presets.map((p) => [p.name, `${SHIPPED.ns}/${p.key}`]));

const list = (page) => page.locator("#cmdk");
const field = (page) => page.locator("#cmdk-input");
const options = (page) => page.locator("#cmdk-list .cmdk-it");
/** The group names, in the order the list shows them, once it is whole. */
const groups = async (page) => {
  await listWhole(page);
  return page.locator("#cmdk-list .cmdk-grp").allTextContents();
};

/** The rows under the group `name`, once the list is drawn whole. */
const rowsUnder = async (page, name) => {
  await listWhole(page);
  return page.evaluate((name) => {
    const out = [];
    let inside = false;
    for (const li of document.querySelectorAll("#cmdk-list > li")) {
      if (li.classList.contains("cmdk-grp")) inside = li.textContent === name;
      else if (inside) out.push(li.querySelector(".cmdk-lab").textContent);
    }
    return out;
  }, name);
};

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

  // How long the list takes to open and to filter, from the key (or the
  // letter) to the task after the frame that shows it, which runs once that
  // frame is painted: from what the page holds (ADR-025, 100 ms). The list's
  // frame is painted before the first letter, and each letter is timed on
  // its own, the slower of two typed in turn. (Timed to the next frame's
  // start, the open left out its own frame's paint and the letter counted
  // it.)
  const took = await page.evaluate(async () => {
    const painted = () => new Promise((r) => requestAnimationFrame(() => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => r();
      ch.port2.postMessage(0);
    }));
    const t0 = performance.now();
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "k", code: "KeyK", metaKey: true, bubbles: true }));
    await painted();
    const open = performance.now() - t0;
    const input = document.getElementById("cmdk-input");
    let filter = 0;
    for (const q of ["t", "ta"]) {
      const t1 = performance.now();
      input.value = q;
      input.dispatchEvent(new Event("input"));
      await painted();
      filter = Math.max(filter, performance.now() - t1);
    }
    return { open, filter, rows: document.querySelectorAll("#cmdk-list .cmdk-it").length };
  });
  expect(took.rows).toBeGreaterThan(0);
  app.budget("⌘K → the list drawn", took.open, 100);
  app.budget("a letter typed → the list filtered", took.filter, 100);
});

test("the key draws the rows in sight at once and the rest after, the list at its whole height from the first frame", async ({ page, app }) => {
  // A window of a known height: its list shows about twenty lines, and
  // PERFORM's list holds over fifty, which this test needs.
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.boot();
  // In the key's own task: the rows the list can show, the first chosen.
  const opened = () => page.evaluate(() => {
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "k", code: "KeyK", metaKey: true, bubbles: true }));
    const ul = document.getElementById("cmdk-list");
    const rows = [...ul.querySelectorAll(".cmdk-it")];
    return {
      drawn: rows.length,
      whole: Number(rows[0].getAttribute("aria-setsize")),
      places: rows.map((r) => Number(r.getAttribute("aria-posinset"))),
      // The last row drawn stands at or past the list's foot.
      fills: rows[rows.length - 1].getBoundingClientRect().bottom >= ul.getBoundingClientRect().bottom,
      // The list keeps to the dialog, its foot inside it.
      footIn: document.querySelector("#cmdk .cmdk-foot").getBoundingClientRect().bottom <= document.getElementById("cmdk").getBoundingClientRect().bottom + 1,
      box: ul.clientHeight,
      height: ul.scrollHeight,
      chosen: document.getElementById("cmdk-input").getAttribute("aria-activedescendant"),
      first: rows[0].id,
    };
  });
  const first = await opened();
  // The rest come after the rows the key drew: counted before anything
  // waits on what a row says of the whole list.
  await expect.poll(() => options(page).count(), { message: "the key drew the rows in sight, and the rest came after" }).toBeGreaterThan(first.drawn);
  await listWhole(page);
  expect(first.whole, "each row said how long the whole list is").toBe(await options(page).count());
  expect(first.fills, "the rows drawn fill the list").toBe(true);
  expect(first.footIn, "the list's foot is inside the dialog while the list fills").toBe(true);
  expect(first.places).toEqual(first.places.map((_, i) => i + 1));
  expect(first.chosen).toBe(first.first);
  await page.keyboard.press("Escape");
  // Opened again, with its rows measured: the list stood at the height the
  // rest take.
  const at = await opened();
  expect(at.drawn, "the key drew the rows in sight, not every row").toBeLessThan(at.whole);
  await expect(options(page)).toHaveCount(at.whole);
  const whole = await page.evaluate(() => {
    const ul = document.getElementById("cmdk-list");
    return { box: ul.clientHeight, height: ul.scrollHeight };
  });
  expect(whole.box, "the list's box is the same size while it fills").toBe(at.box);
  expect([at.height - 1, at.height, at.height + 1], `the list scrolled ${at.height} px while it filled, and ${whole.height} px whole`).toContain(whole.height);
  await page.keyboard.press("Escape");
  // ↑ from the first row chooses the last, drawn for it in the key's task;
  // a wheel on the list draws the rest in its own.
  const moved = await page.evaluate(() => {
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "k", code: "KeyK", metaKey: true, bubbles: true }));
    const input = document.getElementById("cmdk-input");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", code: "ArrowUp", bubbles: true }));
    const last = document.getElementById(input.getAttribute("aria-activedescendant"));
    const up = { selected: last?.getAttribute("aria-selected"), place: last?.getAttribute("aria-posinset"), of: last?.getAttribute("aria-setsize") };
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "k", code: "KeyK", metaKey: true, bubbles: true }));
    const ul = document.getElementById("cmdk-list");
    ul.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, bubbles: true }));
    const rows = ul.querySelectorAll(".cmdk-it");
    return { up, wheeled: rows.length, whole: Number(rows[0].getAttribute("aria-setsize")) };
  });
  expect(moved.up.selected).toBe("true");
  expect(moved.up.place, "↑ from the first row chose the last").toBe(moved.up.of);
  expect(moved.wheeled, "the wheel drew every row").toBe(moved.whole);
});

test("a letter typed in the arrows' own frame shows its first row at the list's top, and draws only the rows in sight", async ({ page, app }) => {
  // A window of a known height: its list shows about twenty lines, and
  // TASTE's list for "e" holds over forty, which this test needs.
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.boot();
  // TASTE's commands ask the layout nothing, so nothing but the list itself
  // brings it back to its top.
  await app.level("taste");
  await page.keyboard.press("Meta+k");
  await expect(list(page)).toBeVisible();
  await listWhole(page);
  const at = await page.evaluate(async () => {
    const input = document.getElementById("cmdk-input");
    const ul = document.getElementById("cmdk-list");
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    const key = (k) => input.dispatchEvent(new KeyboardEvent("keydown", { key: k, code: k, bubbles: true }));
    // Twenty ↓ and a letter in one task, as keys typed during a long task
    // are handled: no frame, and so no scroll event, between them.
    for (let i = 0; i < 20; i++) key("ArrowDown");
    const down = ul.scrollTop;
    input.value = "e";
    input.dispatchEvent(new Event("input"));
    // The next frame: its scroll event has been heard, the idle steps not.
    await frame();
    const rows = ul.querySelectorAll(".cmdk-it");
    const drawn = rows.length;
    const whole = Number(rows[0].getAttribute("aria-setsize"));
    await frame();
    const chosen = document.getElementById(input.getAttribute("aria-activedescendant"));
    const box = ul.getBoundingClientRect();
    const r = chosen.getBoundingClientRect();
    return { down, top: ul.scrollTop, drawn, whole, chosen: chosen.id, inSight: r.top >= box.top - 1 && r.bottom <= box.bottom + 1 };
  });
  expect(at.down, "twenty ↓ scrolled the list").toBeGreaterThan(0);
  expect(at.chosen).toBe("cmdk-o0");
  expect(at.inSight, `the first row, chosen, is in sight (the list stood ${at.top} px down)`).toBe(true);
  expect(at.top, "the list is back at its top").toBe(0);
  expect(at.drawn, "the letter's frame holds the rows in sight, not every row").toBeLessThan(at.whole);
});

test("typing ranks a label's start first, ↵ runs the row chosen, and with nothing found leaves the list open", async ({ page, app }) => {
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

  // With nothing found, ↵ runs nothing and leaves the list open, with what
  // was typed still in the field.
  await page.keyboard.press("Meta+k");
  await page.keyboard.type("zqxj");
  await expect(options(page)).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(list(page)).toBeVisible();
  await expect(field(page)).toHaveValue("zqxj");
  await expect(field(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(list(page)).toBeHidden();
});

test("Esc closes the list and gives the focus back, and ends nothing behind it", async ({ page, app }) => {
  await app.boot();
  // A tapped model view, and the focus on MODEL as the keyboard left it.
  await page.locator("#model-btn").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("body")).toHaveClass(/\bmodel-view\b/);
  await page.keyboard.press("Meta+k");
  await expect(field(page)).toBeFocused();
  // Tab walks the field and the foot's two links, and stays in the list.
  const foot = page.locator("#cmdk .cmdk-foot a");
  await page.keyboard.press("Tab");
  await expect(foot.first()).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(foot.last()).toHaveText("source");
  await expect(foot.last()).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(field(page)).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(foot.last()).toBeFocused();
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

test("at PATCH, undo finds Undo an edit first, and ↵ takes back the last edit, not every one", async ({ page, app }) => {
  await app.boot();
  await patchPage.openPreset(app, "Glass Pad");
  await patchPage.settled(app);
  // Two edits: a nudge on each of two knobs, each a step of its own.
  const addrs = await page.evaluate(() =>
    [...document.querySelectorAll("#rack-svg g[data-addr]")]
      .filter((g) => g.querySelector(":scope > .knob-hit") && Number(g.getAttribute("aria-valuenow")) < 0.9)
      .slice(0, 2)
      .map((g) => g.dataset.addr));
  expect(addrs).toHaveLength(2);
  const knob = (addr) => page.locator(`#rack-svg g[data-addr="${addr}"]`);
  const was = [];
  for (const addr of addrs) {
    const before = await knob(addr).getAttribute("aria-valuenow");
    was.push(before);
    await knob(addr).focus();
    await page.keyboard.press("ArrowUp");
    await expect(knob(addr)).not.toHaveAttribute("aria-valuenow", before);
    await patchPage.settled(app);
  }
  await page.keyboard.press("Meta+k");
  await page.keyboard.type("undo");
  await expect(options(page).first().locator(".cmdk-lab")).toHaveText("Undo an edit");
  await expect(options(page).first().locator("kbd")).toHaveText(/Z$/);
  await expect(commandRow(page, "Undo to as opened")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(list(page)).toBeHidden();
  // The restore is an edit in the bench lane: the rack is drawn from its
  // reply once the lane has settled.
  await patchPage.settled(app);
  await expect(knob(addrs[1]), "the last edit was taken back").toHaveAttribute("aria-valuenow", was[1]);
  await expect(knob(addrs[0]), "the edit before it stayed").not.toHaveAttribute("aria-valuenow", was[0]);
});

test("a file's command opens its picker", async ({ page, app }) => {
  await app.boot();
  // The listener goes in before anything is pressed: Playwright turns the
  // file chooser's interception on when the first listener is added, and
  // that takes a round trip to the browser. A `waitForEvent` set beside the
  // press missed the picker the press opened in about one run in eight (the
  // click reached the input, with the gesture active; the event never came).
  const choosers = [];
  page.on("filechooser", (c) => choosers.push(c));
  await page.keyboard.press("Meta+k");
  await page.keyboard.type("open a taste");
  await expect(options(page).first().locator(".cmdk-lab")).toHaveText("Open a taste file…");
  await page.keyboard.press("Enter");
  await expect.poll(() => choosers.length, { message: "↵ opened the taste file's picker" }).toBe(1);
  expect(choosers[0].isMultiple()).toBe(false);
  await expect(list(page)).toBeHidden();
  // And with the mouse.
  await runCommand(page, "Open a patch file…");
  await expect.poll(() => choosers.length, { message: "the click opened the patch file's picker" }).toBe(2);
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
  // What a label can't say is its row's tooltip, as it was the ⋯ item's.
  await expect(commandRow(page, "Show measurements")).toHaveAttribute("title", /engine’s own bookkeeping/);
  await expect(commandRow(page, "Booth mode")).toHaveAttribute("title", /For a kiosk/);
  // A setting says its state, and running it changes it.
  await page.keyboard.type("hold: latch");
  await page.keyboard.press("Enter");
  await expect(page.locator("#hold-btn")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Meta+k");
  await page.keyboard.type("hold: latch");
  await expect(options(page).first().locator(".cmdk-hint")).toHaveText("on");
  await page.keyboard.press("Enter");
  await expect(page.locator("#hold-btn")).toHaveAttribute("aria-pressed", "false");
  // A panel a command opens takes the focus, whole under the menu bar: it
  // hung inside the bar, which clips to its one row, and taking the focus
  // scrolled the bar's own contents out of place.
  for (const [label, panel, first] of [["Scope & analyzer…", "#scope-panel", "#sp-mode"], ["Download as a picture…", "#image-panel", "#ix-scope"]]) {
    await runCommand(page, label);
    await expect(page.locator(first)).toBeFocused();
    await expect(page.locator(panel)).toBeInViewport({ ratio: 1 });
    await expect.poll(() => page.evaluate((sel) => {
      const r = document.querySelector(sel).getBoundingClientRect();
      return !!document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest(sel);
    }, panel), `${panel} is what is under the point at its center`).toBe(true);
    await expect.poll(() => page.evaluate(() => document.querySelector(".menubar").scrollTop)).toBe(0);
    // Left open, it stands under the list's scrim when ⌘K opens: a click
    // there is the scrim's, not one on the panel's fields.
    await page.keyboard.press("Meta+k");
    await expect(list(page)).toBeVisible();
    await expect.poll(() => page.evaluate((sel) => {
      const r = document.querySelector(sel).getBoundingClientRect();
      return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest("#cmdk-scrim, #cmdk")?.id || null;
    }, panel), `the list's scrim covers ${panel}`).not.toBeNull();
    await page.keyboard.press("Escape");
    await expect(list(page)).toBeHidden();
    await expect(page.locator(first), "the focus went back into the panel").toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator(panel)).toBeHidden();
  }
  // A level's own: PERFORM's Freeze Wander, as a tap on WANDER freezes it,
  // and PATCH's walkthrough of the catalog.
  const wander = page.locator("#view-perform .pf-wander");
  await expect(wander).not.toHaveAttribute("data-frozen", "true");
  await runCommand(page, "Freeze Wander");
  await expect(wander).toHaveAttribute("data-frozen", "true");
  await page.keyboard.press("Meta+k");
  await page.keyboard.type("freeze wander");
  await expect(options(page).first().locator(".cmdk-hint")).toHaveText("frozen");
  await page.keyboard.press("Escape");
  await goLevel(page, "patch");
  await page.keyboard.press("Meta+k");
  await expect.poll(() => rowsUnder(page, "This level")).toContain("How the catalog works");
  await page.keyboard.press("Escape");
  await runCommand(page, "How the catalog works");
  await expect(page.locator("#nb-tour")).toBeVisible();
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

test("a preset the pool lacks is listed with the face the app ships for it, and the engine is asked for none", async ({ page, app }) => {
  await app.boot();
  await bankTab(page, "presets");
  const row = page.locator("#bank-list .preset-item:not(.in-bank)").first();
  const name = (await row.locator(".bi-name").textContent()).trim();
  const index = await row.getAttribute("data-index");
  await page.keyboard.press("Meta+k");
  await page.keyboard.type(name);
  const slot = page.locator(`#cmdk-list .face-slot[data-face="p${index}"]`);
  await expect(slot).toHaveCount(1);
  // Drawn against the bank, whose faces are the engine's: an engine wait.
  await app.engine((timeout) => expect(slot.locator("img.face")).toHaveCount(1, { timeout }));
  expect((await slot.getAttribute("data-drawn")).split("|")[0], "the face is the preset's, from the file").toBe(SHIPPED_KEY.get(name));
  const asked = (await app.sent({ type: "faces" })).flatMap((s) => (s.trees || []).filter((t) => t.preset != null));
  expect(asked, "no preset's face was asked of the engine").toEqual([]);
});

test("? over a control asks about it, and anywhere else opens the list", async ({ page, app }) => {
  await app.boot({ seed: PERFORM_SEED, random: PERFORM_SEED });
  await app.level("patch");
  await app.openOnPerform("Reese");
  const knob = page.locator('.pf-knob[data-i="0"]');
  await knob.hover();
  await page.keyboard.press("?");
  await expect(page.locator(".xp.on")).toBeVisible();
  await expect(list(page)).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(page.locator(".xp.on")).toHaveCount(0);
  await page.mouse.move(5, 5);
  await page.keyboard.press("?");
  await expect(list(page)).toBeVisible();
  await expect(field(page)).toBeFocused();
  // Typed into the field, ? is a letter like any other.
  await page.keyboard.press("?");
  await expect(field(page)).toHaveValue("?");
  await page.keyboard.press("Escape");
  // The list's way to the same answer. It prints no key: ? asks about
  // BRIGHT only over it, and from here opens this list.
  await page.keyboard.press("Meta+k");
  await page.keyboard.type("What does BRIGHT do?");
  await expect(commandRow(page, "What does BRIGHT do?")).toHaveCount(1);
  await expect(commandRow(page, "What does BRIGHT do?").locator("kbd")).toHaveCount(0);
  await runCommand(page, "What does BRIGHT do?");
  await expect(page.locator(".xp.on")).toBeVisible();
  await expect(page.locator(".xp.on #xp-title")).toHaveText("Bright · what it does");
});
