// PATCH: a press shows it was taken (#305, ADR-025).
//
// - KEEP AS NEW or ⚡ pressed while an edit is still on its way waits for
//   the edit, so what is kept is what the player hears. It used to show
//   nothing until the edit landed. Now the job slot says "keeping your edit
//   first…" with the lamp lit, from the press until the edit lands.
// - A patch file dropped on the window said nothing until its import had
//   landed and been rendered. Now the job slot says "Opening ‹its name›…",
//   with the lamp, from the drop until the import lands, whatever the toast
//   lane is showing.
//
// Each sign is read in the press's own task (ADR-022), or, by the keyboard,
// before the request it waits on is let through (`app.holdRequests`).
const fs = require("node:fs");
const { test, expect, runCommand } = require("./fixtures");
const { openPreset } = require("./patch_page");

const KEEPING = "keeping your edit first…";
/** The keep's wait is over: the slot says something else, or nothing. */
const keepGone = (page) =>
  expect.poll(() => page.evaluate((k) => !document.getElementById("job-slot").classList.contains("hidden") && document.getElementById("job-text").textContent === k, KEEPING), { message: "the slot still says the keep waits" }).toBe(false);
/** The job slot and the lamp, as the menu bar shows them. */
const slot = (page) =>
  page.evaluate(() => ({
    shown: !document.getElementById("job-slot").classList.contains("hidden"),
    text: document.getElementById("job-text").textContent,
    lamp: document.getElementById("wm-lamp").classList.contains("thinking"),
  }));

/** A knob turned from the keyboard, its write held from the engine. */
async function editInFlight(page, app) {
  await app.holdRequests("edit_param");
  const knob = page.locator("#rack-svg g[data-addr][role=slider]").first();
  await knob.focus();
  await page.keyboard.press("ArrowUp");
  await expect.poll(() => page.evaluate(() => window.__tap.reqHeld.length)).toBeGreaterThan(0);
}

test("KEEP AS NEW and ⚡ pressed with an edit on its way say so at the press, with the lamp", async ({ page, app }) => {
  await app.boot();
  await openPreset(app, "Glass Pad");
  await expect(page.locator("#job-slot")).toHaveClass(/\bhidden\b/);

  // KEEP AS NEW by the mouse: said in the click's own task.
  await editInFlight(page, app);
  const keep = await page.evaluate(() => {
    const t0 = performance.now();
    document.getElementById("rack-commit").click();
    const job = document.getElementById("job-slot");
    return {
      shown: !job.classList.contains("hidden"),
      text: document.getElementById("job-text").textContent,
      lamp: document.getElementById("wm-lamp").classList.contains("thinking"),
      ms: performance.now() - t0,
    };
  });
  expect(keep, "KEEP AS NEW: the job slot and the lamp in the click's task").toEqual({ shown: true, text: KEEPING, lamp: true, ms: keep.ms });
  app.budget("KEEP AS NEW behind an edit: the press → its sign", keep.ms, 100);
  // The edit lands, and the keep goes on: the comparison asks, and the wait
  // is over.
  await app.releaseRequests();
  await app.engine((timeout) => expect(page.locator("#cduel")).not.toHaveClass(/\bhidden\b/, { timeout }), { ms: 30_000 });
  await keepGone(page);
  await page.locator("#cd-cancel").click();

  // ⚡ by the keyboard (focused, Enter): said before the edit is let through.
  await editInFlight(page, app);
  await page.locator("#rack-evolve").focus();
  await page.keyboard.press("Enter");
  // The edit is still held, so the sign came before it landed.
  await expect.poll(() => slot(page), { message: "⚡: the job slot and the lamp before the edit landed" })
    .toEqual({ shown: true, text: KEEPING, lamp: true });
  expect(await page.evaluate(() => window.__tap.reqHeld.length), "the edit is still held").toBeGreaterThan(0);
  await app.releaseRequests();
  await app.engine((timeout) => expect(page.locator("#cduel")).not.toHaveClass(/\bhidden\b/, { timeout }), { ms: 30_000 });
  await page.locator("#cd-cancel").click();
  await keepGone(page);
});

test("a patch file dropped on the window says it is opening it, by name, until the import lands", async ({ page, app }) => {
  await app.boot();
  await openPreset(app, "Glass Pad");
  const [download] = await Promise.all([page.waitForEvent("download"), runCommand(page, "Download this patch")]);
  const sidecar = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
  sidecar.name = "Dropped Pad";
  // Not the pool's own Glass Pad, so it joins as a new sound and its toast
  // is one about the player's sounds, which always has its turn.
  sidecar.tree.amp.attack = Math.min(1, sidecar.tree.amp.attack + 0.013);
  const id = (await app.facts()).ranked[0].id; // a sound in the pool
  await app.hold(["patch_imported"]);
  // Something else holds the toast lane (a Save refused at the cap, which
  // jumps the queue), and the file is dropped in the same task.
  const said = await page.evaluate(([text, id]) => {
    window.__tap.inject({ type: "pinned", id, pinned: true, ok: false, budget: [8, 8] });
    const dt = new DataTransfer();
    dt.items.add(new File([text], "glass.auracle.json", { type: "application/json" }));
    const t0 = performance.now();
    window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    const job = document.getElementById("job-slot");
    return {
      shown: !job.classList.contains("hidden") && job.getBoundingClientRect().width > 0,
      text: document.getElementById("job-text").textContent,
      toast: document.querySelector("#toasts .toast-msg")?.textContent,
      ms: performance.now() - t0,
    };
  }, [JSON.stringify(sidecar), id]);
  expect(said.toast, "the lane holds another toast").toMatch(/would pass your limit/);
  expect({ shown: said.shown, text: said.text }, "the drop says so on screen in its own task, by the file's name").toEqual({ shown: true, text: "Opening glass…" });
  app.budget("a dropped patch file: the drop → its sign", said.ms, 100);
  // Its sidecar read, by the name it carries; the import still on its way.
  await expect(page.locator("#job-text")).toHaveText("Opening Dropped Pad…");
  await app.engine(() => expect.poll(() => app.held().then((h) => h.map((x) => x.type)), { timeout: 30_000 }).toEqual(["patch_imported"]));
  await expect(page.locator("#job-text"), "still said while the import is on its way").toHaveText("Opening Dropped Pad…");
  await app.release();
  await expect.poll(() => app.toasts(), { timeout: 30_000 }).toContainEqual(expect.stringMatching(/^Opened the patch file as /));
  await expect.poll(() => page.evaluate(() => (document.getElementById("job-slot").classList.contains("hidden") ? "" : document.getElementById("job-text").textContent)), { message: "the slot still says the file is opening" }).not.toMatch(/^Opening/);
});
