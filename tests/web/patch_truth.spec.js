// PATCH tells the truth about what is sounding.
//
// Two lies the films caught, each pinned here in a real browser against the
// real engine:
//
// - An EMPTY socket played a saw. Unplugging a source drew a dashed "empty"
//   plate over a stand-in VCO, and the stand-in kept sounding under a held
//   chord (vp-change-08: a clean saw on the scope). The socket holds the
//   grammar's `Silence` leaf now, so the live output goes quiet and stays
//   quiet, and the plate still says EMPTY.
// - A knob turned in PATCH was redrawn at its old value, in PERFORM's amber,
//   with a ghost claiming PERFORM was playing it (vp-change-01: CUTOFF turned
//   to 7.83 kHz read "1.78 kHz"). PERFORM's copy of the knob never heard the
//   turn, so its next move also wrote the old value back into the voices.
//
// The engine is reached through the fixture's tap (fixtures.js): edits are
// counted out and replies back, and the lane has settled when they agree
// (patch_page.js `settled`).
const { test, expect, goLevel } = require("./fixtures");
const patchPage = require("./patch_page.js");
const { settled } = patchPage;

/** Open a library preset on the bench, and wait until the rack is its and
 *  the lane has settled. */
async function openPreset(app, name) {
  await patchPage.openPreset(app, name);
  await expect(app.page.locator("#rack-svg .knob-hit").first()).toBeVisible();
  await settled(app);
}

/** The live output's peak over ~0.3 s, in dBFS, off the worklet's own
 *  analyser (the one the scope reads). −Infinity for digital silence. */
const livePeakDb = (page) =>
  page.evaluate(async () => {
    const a = window.__aur.getLive()?.analyser;
    if (!a) return null;
    const buf = new Float32Array(a.fftSize);
    let peak = 0;
    for (let i = 0; i < 6; i++) {
      a.getFloatTimeDomainData(buf);
      for (const x of buf) peak = Math.max(peak, Math.abs(x));
      await new Promise((r) => setTimeout(r, 50));
    }
    return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
  });

/** Open PERFORM on the patch on the bench and wait until its controls are
 *  wired — the state in which PERFORM holds its own copy of every knob. Its
 *  measurement is the engine's: an engine wait. */
async function wirePerform(app, name) {
  const { page } = app;
  await goLevel(page, "perform");
  await app.engine((timeout) => expect(page.locator(".pf-name")).toHaveText(name, { timeout }), { ms: 30_000 });
  await app.engine((timeout) => page.waitForFunction(
    () => /controls reach/.test(document.querySelector(".pf-status")?.textContent || ""),
    null,
    { timeout },
  ), { ms: 90_000 });
}

/** A rack knob's centre on screen, and what it says. */
async function rackKnob(page, addr) {
  await expect(page.locator(`#rack-svg g[data-addr="${addr}"] .knob-hit`)).toBeVisible();
  return page.evaluate((a) => {
    const g = document.querySelector(`#rack-svg g[data-addr="${CSS.escape(a)}"]`);
    if (!g) return null;
    const r = g.querySelector(":scope > .knob-hit").getBoundingClientRect();
    return {
      x: r.x + r.width / 2,
      y: r.y + r.height / 2,
      value: Number(g.getAttribute("aria-valuenow")),
      text: g.querySelector(".knob-value")?.textContent || "",
      valuetext: g.getAttribute("aria-valuetext") || "",
      performed: g.classList.contains("performed"),
      ghost: g.querySelector(".knob-ghost > title")?.textContent || null,
    };
  }, addr);
}

/** Drag a rack knob up by `dy` pixels (140 px is its full travel). */
async function dragUp(page, k, dy, steps = 8) {
  await page.mouse.move(k.x, k.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(k.x, k.y - (dy * i) / steps);
  await page.mouse.up();
}

test("an unplugged socket goes quiet under a held note, and its plate still reads EMPTY", async ({ page, app }) => {
  await app.boot();
  // Glass Pad is a chorus over a filter over one supersaw: the supersaw's
  // socket is the only thing it can hear, as in the film.
  await openPreset(app, "Glass Pad");
  const key = await page.evaluate(() => window.__aur.wb.rack.modules.find((m) => m.kind === "supersaw")?.key);
  expect(key, "Glass Pad has a supersaw").toBeTruthy();

  await page.keyboard.down("a");
  await expect.poll(() => livePeakDb(page), { timeout: 20_000, message: "the held note sounds" }).toBeGreaterThan(-40);

  await page.locator(`#rack-svg g.mod-group[data-key="${key}"] .mod-menu-btn`).first().click();
  const t0 = await app.now();
  await page.locator("#ctx-menu .cm-item").filter({ hasText: /^set aside/ }).first().click();
  // The new tree reaches the voices as the engine takes the edit (its early
  // `tree_json`), which waits for the call the engine is in when the click
  // arrives: the open's probe, a measurement's render, or a dealt pair's
  // sound rendered in the background. On a slow CI runner the tree came 2.2
  // to 2.9 s after the click (#176). An engine wait; the swap is timed from
  // there.
  const early = await app.reply("tree_json", { where: { edited: "restore" }, after: t0, timeout: 30_000 });
  // Quiet promptly once the voices have the tree. (A saw never goes quiet at
  // all, so the margin here is for a loaded machine, not for the behaviour.)
  await expect.poll(() => livePeakDb(page), { timeout: 3_000, intervals: [100] }).toBeLessThan(-60);
  const quietAfterMs = Math.round((await app.now()) - early._at);
  // …and stays quiet once the swap has rebuilt the voices with the note
  // still held: the stand-in used to fade back in here.
  await settled(app);
  for (let i = 0; i < 4; i++) expect(await livePeakDb(page)).toBeLessThan(-60);
  await page.keyboard.up("a");
  console.log(`[patch_truth] quiet ${quietAfterMs} ms after the unplug's tree reached the page, ${Math.round(early._at - t0)} ms after the click`);

  // The plate says so, and so does the patch under it.
  const mod = await page.evaluate((k) => window.__aur.wb.rack.modules.find((m) => m.key === k), key);
  expect(mod.kind).toBe("silence");
  await expect(page.locator(`#rack-svg g[data-key="${key}"] .mod-title`)).toHaveText(/^empty$/i);
  await expect(page.locator(`#nb-inpatch-list .nb-chip[data-key="${key}"]`)).toHaveAttribute("data-empty", "1");
  // Nothing reaches the output, and the words say that — not a runaway.
  await expect(page.locator("#rack-meta")).toContainText("silent");
  await expect(page.locator("#alarm")).not.toContainText("run away");
});

test("a knob turned in PATCH keeps its value, with no ghost", async ({ page, app }) => {
  await app.boot();
  await openPreset(app, "First Bass");
  // PERFORM measured first, so it holds its own copy of the cutoff — the
  // state the films were in.
  await wirePerform(app, "First Bass");
  await goLevel(page, "patch");
  const before = await rackKnob(page, "node#cut");
  expect(before, "First Bass has a cutoff on the rack").not.toBeNull();

  await dragUp(page, before, 45);
  await settled(app);
  // PERFORM's paint runs every 100 ms; give it twenty chances to be wrong.
  await app.quiet(2_000);
  const after = await rackKnob(page, "node#cut");
  expect(after.value).toBeGreaterThan(before.value + 0.2);
  expect(after.text, "the readout says the value the knob was turned to").toBe(after.valuetext.split(" · ")[0]);
  expect(after.performed).toBe(false);
  await expect(page.locator("#rack-svg .knob-ghost")).toHaveCount(0);
});

test("moving a PERFORM control after a PATCH edit plays from the new base", async ({ page, app }) => {
  await app.boot();
  await openPreset(app, "First Bass");
  await wirePerform(app, "First Bass");
  await goLevel(page, "patch");
  // A big turn in PATCH (about +0.45 of the knob's travel) and a small one
  // in PERFORM (Bright to about +0.2), so "from the new base" and "from the
  // preset's" land far apart whatever Bright's gain on the cutoff is.
  const before = await rackKnob(page, "node#cut");
  await dragUp(page, before, 63);
  await settled(app);
  const edited = (await rackKnob(page, "node#cut")).value;
  expect(edited).toBeGreaterThan(before.value + 0.3);

  // Bright reaches the ladder's cutoff on First Bass (perform_circuit.spec).
  await goLevel(page, "perform");
  const box = await page.locator('.pf-knob[data-i="0"]').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 3; i++) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - i * 6);
  await page.mouse.up();

  await goLevel(page, "patch");
  await expect(page.locator('#rack-svg g.performed[data-addr="node#cut"]')).toHaveCount(1, { timeout: 5_000 });
  const k = await rackKnob(page, "node#cut");
  // The rack still shows the value the hand set; the ghost is what plays,
  // which is that value plus Bright's turn — not the preset's cutoff plus it.
  expect(k.value).toBeCloseTo(edited, 2);
  expect(k.ghost).toContain("Bright");
  const played = Number(/Playing at (\d+)%/.exec(k.ghost)[1]) / 100;
  const said = `played ${played}, edited ${edited}, preset ${before.value}`;
  expect(Math.abs(played - edited), said).toBeLessThan(0.12);
  expect(played - before.value, said).toBeGreaterThan(0.25);
});
