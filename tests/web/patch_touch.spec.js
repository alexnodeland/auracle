// PATCH under a finger (Plan-008 C2a): every function the canvas has is
// reachable by a coarse pointer, and what a finger presses is at least 40 px.
// A touch screen here is a tablet in landscape (1024 × 768, a coarse
// pointer), as patch_sheet.spec.js has it.
//
// What this claims:
//
// - The head's acts, the camera's corner and ⚡'s ▾ are 40 px or more, and
//   answer a tap.
// - Every module shows its ⋯ at rest on touch, and a tap on it opens the
//   structure menu.
// - A tapped module's sheet shows the bench's face beside its settings, "as
//   made" while the sound is unedited.
// - AUDIO IN's and CAPTURE's lane buttons are in their module's sheet, a
//   finger's size, and press the lane's own: MONITOR lights, RECORD rolls
//   and stops.
const fs = require("fs");
const path = require("path");
const { test, expect, goLevel } = require("./fixtures");
const { openPreset } = require("./patch_page.js");
const { STUB } = require("./audio_in_stub.js");

test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true });

/** Tap a module's plate on bare panel, clear of every control on it, once
 *  the rack has stopped moving: its plate in the same place across three
 *  frames, read in the page. */
async function tapPlate(page, kind) {
  await expect.poll(() => page.evaluate((k) => new Promise((done) => {
    const rect = () => JSON.stringify(document.querySelector(`#rack-svg g[data-kind="${k}"]:not(.mod-group) .mod-plate`)?.getBoundingClientRect() || null);
    const a = rect();
    requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => done(a !== "null" && a === rect()))));
  }), kind), { timeout: 30_000 }).toBe(true);
  const at = await page.evaluate((k) => {
    const plate = document.querySelector(`#rack-svg g[data-kind="${k}"]:not(.mod-group) .mod-plate`);
    const b = plate.getBoundingClientRect();
    const group = document.querySelector(`#rack-svg g.mod-group[data-kind="${k}"]`);
    const ctrls = [...group.querySelectorAll("[data-addr], [data-stop], .jack, .mod-menu-btn, .mod-lock, .lock-dot")].map((e) => e.getBoundingClientRect());
    let best = null;
    for (let fx = 0.08; fx < 0.95; fx += 0.04) {
      for (let fy = 0.08; fy < 0.95; fy += 0.04) {
        const x = b.left + fx * b.width;
        const y = b.top + fy * b.height;
        if (document.elementFromPoint(x, y) !== plate) continue;
        const d = Math.min(...ctrls.map((r) => Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom))));
        if (!best || d > best.d) best = { x, y, d };
      }
    }
    return best;
  }, kind);
  await page.touchscreen.tap(at.x, at.y);
}

test("on touch, the head's acts, the camera's corner and ⚡'s ▾ are a finger's size and answer a tap", async ({ page, app }) => {
  await app.boot();
  expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
  await openPreset(app, "Reese");
  for (const id of ["#pt-add", "#patch-new-btn", "#pt-how", "#pt-evolve-more", "#pt-fit", "#pt-zoom-out", "#pt-zoom-in", "#rack-map-btn", "#rack-layout"]) {
    const b = await page.locator(id).boundingBox();
    expect(b.height, `${id} height`).toBeGreaterThanOrEqual(40);
    expect(b.width, `${id} width`).toBeGreaterThanOrEqual(40);
  }
  await page.locator("#pt-add").tap();
  await expect(page.locator("#nodebank")).toBeVisible();
  const close = await page.locator("#nb-collapse").boundingBox();
  expect(close.height).toBeGreaterThanOrEqual(40);
  await page.locator("#nb-collapse").tap();
  await expect(page.locator("#nodebank")).toBeHidden();
  await page.locator("#pt-evolve-more").tap();
  await expect(page.locator("#pt-evmenu")).toBeVisible();
  const item = await page.locator("#lock-knobs").boundingBox();
  expect(item.height).toBeGreaterThanOrEqual(40);
  await page.locator("#lock-knobs").tap();
  await expect(page.locator("#rack-meta")).toContainText("locked");
  await page.locator("#rack-layout").tap();
  await expect(page.locator("#pt-laymenu")).toBeVisible();
  await page.locator('#pt-laymenu [data-layout="compact"]').tap();
  await expect(page.locator("#rack-layout")).toHaveText(/^compact/);
});

test("on touch, every module shows its ⋯, and a tap on it opens the structure menu", async ({ page, app }) => {
  await app.boot();
  await openPreset(app, "Reese");
  const menu = page.locator('#rack-svg .rack-controls g[data-kind="filter"] .mod-menu-btn').first();
  await expect(menu).toHaveCSS("opacity", "1");
  await menu.tap();
  await expect(page.locator("#ctx-menu")).toBeVisible();
  await expect(page.locator("#ctx-menu .cm-item").filter({ hasText: /^replace with/ })).toHaveCount(1);
});

test("on touch, a tapped module's sheet shows the bench's face, as made", async ({ page, app }) => {
  await app.boot();
  await openPreset(app, "Reese");
  await app.engine((timeout) => expect(page.locator("#rack-svg .cable-mark:not(.unknown)").first()).toBeVisible({ timeout }), { ms: 60_000 });
  await tapPlate(page, "filter");
  const sheet = page.locator("#module-sheet");
  await expect(sheet).toHaveClass(/\bon\b/);
  await app.engine((timeout) => expect(sheet.locator(".ms-face img.face")).toHaveCount(1, { timeout }), { ms: 60_000 });
  await expect(sheet.locator(".ms-cap")).toHaveText("as made");
});

test("on touch, AUDIO IN's and CAPTURE's lane buttons are in the sheet and press the lane's own", async ({ page, app }, info) => {
  // The microphone, stubbed as granted (audio_in_stub.js).
  await page.addInitScript(`try { sessionStorage.setItem("__pwMicGranted", "1"); } catch (_) {}`);
  await page.addInitScript(STUB);
  await app.boot({ wait: false });
  const anyway = page.locator("#hg-anyway");
  if (await anyway.isVisible().catch(() => false)) await anyway.click();
  await app.booted();
  await goLevel(page, "patch");
  const amp = { attack: 0.01, decay: 0.3, sustain: 0.95, release: 0.05 };
  const take = (n) => {
    const f = new Float32Array(n);
    for (let i = 0; i < n; i++) f[i] = 0.4 * Math.sin((i * 330 * 2 * Math.PI) / 44_100);
    return { format: "f32le-base64", sample_rate: 44_100, length: n, data: Buffer.from(f.buffer).toString("base64") };
  };
  const data = { name: "Mic Loop", tree: { amp, root: { Capture: { play: "hold", input: { AudioIn: { input: 0, gain: 24 / 36, channel: "Both" } }, take: take(4000) } } } };
  fs.mkdirSync(info.outputDir, { recursive: true });
  const file = path.join(info.outputDir, "Mic-Loop.json");
  fs.writeFileSync(file, JSON.stringify(data));
  await page.setInputFiles("#patch-import-input", file);
  await app.engine((timeout) => expect(page.locator("#rack-svg .take-lane").first()).toBeVisible({ timeout }), { ms: 60_000 });
  await expect(page.locator("#rack-svg .ain-lane").first()).toHaveAttribute("data-state", "live", { timeout: 30_000 });

  // AUDIO IN: its input line, MONITOR and NEW CLIP, each 44 px.
  await tapPlate(page, "audio_in");
  const sheet = page.locator("#module-sheet");
  await expect(sheet).toHaveClass(/\bon\b/);
  const mon = sheet.locator('.ms-lane-btn[data-stop="ain-monitor"]');
  await expect(mon).toBeVisible();
  await expect(sheet.locator('.ms-lane-btn[data-stop="ain-clip"]')).toBeVisible();
  await expect(sheet.locator('.ms-lane-btn[data-stop="ain-dev"]')).toBeVisible();
  expect((await mon.boundingBox()).height).toBeGreaterThanOrEqual(40);
  await mon.tap();
  await expect(page.locator("#rack-svg .ain-monitor").first()).toHaveAttribute("aria-pressed", "true");
  await expect(mon).toHaveAttribute("aria-pressed", "true");
  await sheet.locator(".ms-x").tap();
  await expect(sheet).not.toHaveClass(/\bon\b/);

  // CAPTURE: RECORD rolls, and stops.
  await tapPlate(page, "capture");
  await expect(sheet).toHaveClass(/\bon\b/);
  const rec = sheet.locator('.ms-lane-btn[data-stop="take-rec"]');
  await expect(rec).toBeVisible();
  await rec.tap();
  await expect(page.locator("#rack-svg .take-rec").first()).toHaveClass(/\bon\b/, { timeout: 15_000 });
  // Rolling, not still opening the input: then STOP has something to keep.
  await expect.poll(() => page.evaluate(() => {
    const r = window.__aur.takes().rolling;
    return !!r && !r.waiting;
  }), { timeout: 15_000 }).toBe(true);
  await sheet.locator('.ms-lane-btn[data-stop="take-rec"]').tap();
  await expect(page.locator("#rack-svg .take-rec").first()).not.toHaveClass(/\bon\b/, { timeout: 15_000 });
});
