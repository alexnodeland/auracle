// TASTE and LEARNING: a press shows it was taken (#305, ADR-025).
//
// - The ▶ on a sound's card on the map, and a style's ▶ on its chip, changed
//   nothing when the sound was not here yet: the press looked lost until the
//   render landed. Each now wears the bank's dotted ring (`.pending`) from
//   the press until it plays, which is in the `render` reply's own task.
// - Download your taste said nothing until the file arrived, and opening a
//   taste file said nothing while it was read. Each now says so at once
//   ("Downloading your taste…", "Opening ‹the file›…"), until the engine's
//   answer takes its place.
//
// A press and what it shows are read in one `page.evaluate` (ADR-022), the
// render replies held at the tap and let through in the task that reads the
// ▶; the files' signs are read while the engine's answer is still held, so
// they came first.
const fs = require("node:fs");
const { test, expect, goLevel, runCommand } = require("./fixtures");

async function boot(app) {
  await app.boot({ warmed: false, random: 20261030 });
  await app.warmStart([1, 4, 7]);
}

/** A pool sound main has not heard, from the posted map. */
const unheardOnMap = (page) =>
  page.evaluate(() => {
    const T = window.__tap;
    const heard = new Set(T.replies.filter((r) => r.type === "render").map((r) => r.d.id));
    return T.facts.views.map.points.map((p) => p.id).filter((id) => id != null && !heard.has(id));
  });

/** Press `sel` and read it in the press's own task. */
const pressAndRead = (page, sel) =>
  page.evaluate((sel) => {
    const b = document.querySelector(sel);
    const before = getComputedStyle(b).outlineStyle;
    const t0 = performance.now();
    b.click();
    return { before, after: getComputedStyle(b).outlineStyle, pending: b.classList.contains("pending"), ms: performance.now() - t0 };
  }, sel);

/** Let the held replies through, and read `sel` in the same task. */
const releaseAndRead = (page, sel) =>
  page.evaluate((sel) => {
    window.__tap.release();
    const b = document.querySelector(sel);
    return { playing: b.classList.contains("playing"), pending: b.classList.contains("pending") };
  }, sel);

const heldFor = (page, id) =>
  expect.poll(() => page.evaluate((id) => window.__tap.held.some((h) => h.type === "render" && h.d.id === id), id), { timeout: 60_000 }).toBe(true);

test("a ▶ on a sound's card or a style's chip says so at the press, and plays as its sound lands", async ({ page, app }) => {
  await boot(app);
  await goLevel(page, "taste");
  await app.hold(["render"]);
  // The card, opened on a sound with nothing heard (from the keyboard: the
  // map focused, an arrow steps from sound to sound, until one is).
  const plate = page.locator("#taste-plate");
  await page.locator("#taste-crt").focus();
  await expect(async () => {
    await page.keyboard.press("ArrowRight");
    await expect(plate).toHaveClass(/\bon\b/, { timeout: 2_000 });
    expect(await unheardOnMap(page)).toContain(Number(await plate.getAttribute("data-id")));
  }).toPass({ timeout: 30_000 });
  const id = Number(await plate.getAttribute("data-id"));
  const other = (await unheardOnMap(page)).find((x) => x !== id);
  const card = await pressAndRead(page, "#taste-plate .util-btn");
  expect(card.before).not.toBe("dotted");
  expect(card.after, "the card's ▶: the dotted ring in the press's task").toBe("dotted");
  expect(card.pending).toBe(true);
  app.budget("the map card's ▶, its sound not here: the press → its ring", card.ms, 100);
  await app.engine(() => heldFor(page, id), { ms: 60_000 });
  expect(await releaseAndRead(page, "#taste-plate .util-btn"), "it plays in the render reply's own task").toEqual({ playing: true, pending: false });
  await page.locator("#taste-plate .util-btn").first().click(); // stop it

  // A style's chip, its exemplar made a sound with nothing heard.
  await goLevel(page, "learning");
  const chip = page.locator(".md-chip").first();
  await expect(chip.locator(".md-chip-play")).toBeEnabled();
  const k = Number(await chip.getAttribute("data-k"));
  await app.hold(["render"]);
  await page.evaluate(([k, other]) => {
    const T = window.__tap;
    const styles = JSON.parse(JSON.stringify(T.facts.views.styles));
    styles[k].exemplars = [other];
    T.inject({ type: "styles", styles, observations: (T.facts.status && T.facts.status.observations) || 0 });
  }, [k, other]);
  const sel = `.md-chip[data-k="${k}"] .md-chip-play`;
  const style = await pressAndRead(page, sel);
  expect(style.before).not.toBe("dotted");
  expect(style.after, "the chip's ▶: the dotted ring in the press's task").toBe("dotted");
  app.budget("a style's ▶, its sound not here: the press → its ring", style.ms, 100);
  await app.engine(() => heldFor(page, other), { ms: 60_000 });
  expect(await releaseAndRead(page, sel), "it plays in the render reply's own task").toEqual({ playing: true, pending: false });
});

test("Download your taste and opening a taste file say so until the engine answers", async ({ page, app }) => {
  await app.boot();
  const lane = page.locator("#toasts .toast-msg");
  // Download: said before the file is here (the `exported` reply held).
  await app.hold(["exported"]);
  await runCommand(page, "Download your taste");
  await expect.poll(() => app.toasts()).toContain("Downloading your taste…");
  expect((await app.held()).map((h) => h.type), "the file was still on its way").toEqual(["exported"]);
  const [file] = await Promise.all([page.waitForEvent("download"), app.release()]);
  await expect(lane.last()).toContainText(/^Downloaded your taste \(auracle-profile\.json\)/);
  const json = fs.readFileSync(await file.path(), "utf8");

  // Opened again (nothing taught, so no question first): said while the
  // engine reads it (the `imported` reply held), in the file's name.
  await app.hold(["imported"]);
  await page.locator("#import-input").setInputFiles({ name: "my-taste.json", mimeType: "application/json", buffer: Buffer.from(json) });
  await expect.poll(() => app.toasts()).toContain("Opening my-taste.json…");
  await app.engine(() => expect.poll(() => app.held().then((h) => h.map((x) => x.type)), { timeout: 30_000 }).toEqual(["imported"]));
  await app.release();
  await expect(lane.last()).toContainText(/^Opened that taste file/);
});
