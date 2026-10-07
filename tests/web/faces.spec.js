// Faces (Plan-005 task 3, RFC-006 §2, ADR-012): every row, chip and card
// carries its sound's face, the engine's measurement of the render in 40
// bands × 12 slices (`auracle_features::face`) drawn against the bank's mean
// and spread (`apps/web/faces.js`).
//
// - A face appears in every place a sound is named once its face lands: the
//   bank's rows, EVOLVE's two cards, PATCH's header and its teach strip, and
//   PERFORM's sound in hand and its offer. The warm start's cards draw theirs
//   from the app's own file of the presets' faces: faces_presets.spec.js.
// - Its whitening is the bank's: a sound cut from the bank redraws the
//   others, against the bank they are in now.
// - A face is drawn in a slot its place always has: a row's name is at the
//   same x, at the same width and never cut short, with or without its face,
//   on a desktop and on a phone. (Run without faces by dropping the worker's
//   `faces` messages before main.js hears them.)
// - The sound's card downloads with its face, its name and its patch.
// - A face is a pure function of the render: the same session reloaded (its
//   faces now from the worker's store) draws every row the same.
// - A preset row's face, on its way when the bank redraws (a play, a load),
//   still lands, without a scroll (with the app's own file of the presets'
//   faces kept back, so each is a render: faces_presets.spec.js holds the
//   file's own).
// - A face's render never goes ahead of a refit: with sixty of them queued
//   (posted here, more than a whole bank stored before faces asks for), a
//   refit is answered before most of them land (an order); within 6 s is a
//   budget (ADR-022).
//
// Sessions are seeded (the films' own Math.random, no `?seed`: the session's
// seed is drawn from it), so the pool is the same run to run. What was asked
// of the engine and what it answered is the fixture's tap.
const { test, expect, goLevel, bankTab, openApp } = require("./fixtures");
const fs = require("fs");

// What a slot shows: its drawing, as the image it is (vessel.js draws it).
const INIT = `(() => {
  window.__pwOutline = async (img) => (img ? img.getAttribute("src") || "" : "");
})();`;

/** Boot the films' way (Math.random 20260928), the tours and the warm start
 *  seen; with `noFaces`, the worker's `faces` messages are kept from main
 *  (`app.hold`), so no face ever lands. Not waited for: `booted`. */
async function boot(page, app, { noFaces = false } = {}) {
  await page.addInitScript(INIT);
  if (noFaces) await app.hold("faces");
  await app.boot({ random: 20260928, wait: false });
}
const booted = (app) => app.booted();

/** Every pool row drawn: 40 rows, each with its face. An engine wait. */
async function bankDrawn(page, app) {
  await app.engine((timeout) => expect
    .poll(() => page.evaluate(() => {
      const rows = [...document.querySelectorAll("#bank-list .bank-item[data-id]")];
      return rows.length >= 40 && rows.every((r) => r.querySelector(".face-slot img.face"));
    }), { timeout })
    .toBe(true), { ms: 120_000 });
}

/** Where each row's name sits in its row, how wide it is, and whether it is cut. */
const nameBoxes = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("#bank-list .bank-item[data-id]")].map((r) => {
      const b = r.getBoundingClientRect();
      const n = r.querySelector(".bi-name");
      const q = n.getBoundingClientRect();
      return { id: r.dataset.id, name: n.textContent, x: Math.round((q.left - b.left) * 10) / 10, w: Math.round(q.width * 10) / 10, cut: n.scrollWidth > n.clientWidth + 0.5, face: !!r.querySelector(".face-slot img.face") };
    }));

/** The drawing each row's face shows (its image). */
const outlines = (page) =>
  page.evaluate(async () => {
    const out = {};
    for (const r of document.querySelectorAll("#bank-list .bank-item[data-id]")) {
      out[r.dataset.id] = await window.__pwOutline(r.querySelector(".face-slot img.face"));
    }
    return out;
  });

test("a face appears on every row, card and chip once its render lands", async ({ page, app }) => {
  await boot(page, app);
  await booted(app);
  await bankDrawn(page, app);
  // EVOLVE's two cards.
  await goLevel(page, "evolve");
  await app.engine((timeout) => expect(page.locator("#face-a.face-slot img.face")).toHaveCount(1, { timeout }), { ms: 30_000 });
  await expect(page.locator("#face-b.face-slot img.face")).toHaveCount(1);
  // PATCH: the header and the teach strip's A and B.
  await page.locator("#bank-list .bank-item[data-id] .bi-name").first().click();
  await app.engine((timeout) => expect(page.locator("#out-face img.face")).toHaveCount(1, { timeout }), { ms: 60_000 });
  await app.engine((timeout) => expect(page.locator("#pd-a .face-slot img.face")).toHaveCount(1, { timeout }), { ms: 30_000 });
  await expect(page.locator("#pd-b .face-slot img.face")).toHaveCount(1);
  // PERFORM: the sound in hand, and B once an offer has grown.
  await goLevel(page, "perform");
  await app.engine((timeout) => expect(page.locator(".pf-faces > .pf-face img.face")).toHaveCount(1, { timeout }), { ms: 60_000 });
  await expect(page.locator(".pf-offer .pf-face img.face")).toHaveCount(0);
  await app.reached();
  await page.evaluate(() => {
    const pad = document.querySelector(".pf-pad.primary");
    pad.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 1 }));
    pad.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId: 1 }));
  });
  await app.engine((timeout) => expect(page.locator(".pf-offer.ready")).toHaveCount(1, { timeout }), { ms: 120_000 });
  await app.engine((timeout) => expect(page.locator(".pf-offer .pf-face img.face")).toHaveCount(1, { timeout }), { ms: 30_000 });
  // The offer's face is its own render's, not the sound in hand's.
  const [held, offer] = await page.evaluate(async () => [
    await window.__pwOutline(document.querySelector(".pf-faces > .pf-face img.face")),
    await window.__pwOutline(document.querySelector(".pf-offer .pf-face img.face")),
  ]);
  expect(held).not.toBe("");
  expect(offer).not.toBe(held);
});

test("a face's whitening moves when the bank changes", async ({ page, app }) => {
  await boot(page, app);
  await booted(app);
  await bankDrawn(page, app);
  const before = await outlines(page);
  // Cut three rows: the bank is three sounds smaller, so its mean and spread
  // move, and every other face is drawn against the bank as it is now. (One
  // cut can move them less than a pixel's worth, and then nothing is
  // redrawn: faces.js `statsMoved`.)
  for (let i = 0; i < 3; i++) {
    const first = await page.locator("#bank-list .bank-item[data-id]").first().getAttribute("data-id");
    await page.locator(`#bank-list .bank-item[data-id="${first}"]`).hover();
    await page.locator(`#bank-list .bank-item[data-id="${first}"] .bi-kill`).click();
    await expect(page.locator(`#bank-list .bank-item[data-id="${first}"]`)).toHaveCount(0, { timeout: 10_000 });
  }
  await expect.poll(async () => {
    const after = await outlines(page);
    return Object.keys(after).filter((id) => before[id] && after[id] && after[id] !== before[id]).length;
  }, { timeout: 10_000 }).toBeGreaterThan(25);
});

for (const [label, ctx] of [
  ["on a desktop", {}],
  ["on a phone", { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }],
]) {
  test.describe(label, () => {
    test(`a name is at the same x and width with or without its face, ${label}`, async ({ newContext }) => {
      test.setTimeout(130_000); // about 57 to 63 s on CI: two boots, each in a context of its own
      const measure = async (noFaces) => {
        const context = await newContext(ctx);
        const page = await context.newPage();
        const app = await openApp(page);
        await boot(page, app, { noFaces });
        if (ctx.isMobile) await page.locator("#hg-anyway").click();
        await booted(app);
        await app.engine((timeout) => expect.poll(() => page.evaluate(() => document.querySelectorAll("#bank-list .bank-item[data-id]").length), { timeout }).toBeGreaterThanOrEqual(40), { ms: 120_000 });
        if (!noFaces) await bankDrawn(page, app);
        // With no faces, none comes, however long it is given.
        else await app.quiet(2_000);
        const boxes = await nameBoxes(page);
        await context.close();
        return { boxes };
      };
      const without = await measure(true);
      const withFaces = await measure(false);
      expect(without.boxes.every((b) => !b.face), "no faces drawn when none reach main").toBe(true);
      expect(withFaces.boxes.every((b) => b.face)).toBe(true);
      // Row by row, for the sounds both runs show by the same name (the pool
      // is seeded; a generated name can take another number between runs).
      const plain = new Map(without.boxes.map((b) => [`${b.id}:${b.name}`, b]));
      const both = withFaces.boxes.filter((b) => plain.has(`${b.id}:${b.name}`));
      expect(both.length).toBeGreaterThan(20);
      for (const b of both) {
        const p = plain.get(`${b.id}:${b.name}`);
        expect({ id: b.id, x: b.x, w: b.w, cut: b.cut }).toEqual({ id: p.id, x: p.x, w: p.w, cut: p.cut });
      }
      // And every row's name starts where every other's does.
      expect(new Set(withFaces.boxes.map((b) => b.x)).size).toBe(1);
      expect(withFaces.boxes.some((b) => b.cut), "a face cuts no name short").toBe(false);
    });
  });
}

test("the sound's card downloads with its face, its name and its patch", async ({ page, app }) => {
  await boot(page, app);
  await booted(app);
  await bankDrawn(page, app);
  await page.locator("#bank-list .bank-item[data-id] .bi-name").first().click();
  await app.engine((timeout) => expect(page.locator("#out-face img.face")).toHaveCount(1, { timeout }), { ms: 60_000 });
  const name = (await page.locator("#rack-subject").textContent()).trim();
  await page.locator("#ovf-btn").click();
  await page.locator("#image-btn").click();
  await page.locator("#ix-scope").selectOption("card");
  await page.locator("#ix-scale").selectOption("2");
  await page.locator("#ix-fmt").selectOption("png");
  await expect(page.locator("#ix-dims")).toHaveText("1200 × 630 px · the sound's card · PNG", { timeout: 30_000 });
  const [png] = await Promise.all([page.waitForEvent("download"), page.locator("#ix-go").click()]);
  expect(png.suggestedFilename()).toMatch(/-card\.png$/);
  const bytes = fs.readFileSync(await png.path());
  // The patch rides inside, as in every picture Auracle downloads.
  expect(bytes.includes(Buffer.from("tEXtauracle\0"))).toBe(true);
  // 1200 × 630, and the sound's green where its face is.
  const seen = await page.evaluate(async (b64) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const x = c.getContext("2d");
    x.drawImage(bmp, 0, 0);
    // The face's column: 48 to 204 in the card's 600 units, over its middle.
    let green = 0;
    for (let px = 100; px < 400; px += 10) {
      const [r, g, bl] = x.getImageData(px, 315, 1, 1).data;
      if (g > 120 && g > r + 30 && g > bl + 10) green++;
    }
    return { w: bmp.width, h: bmp.height, green };
  }, bytes.toString("base64"));
  expect(seen.w).toBe(1200);
  expect(seen.h).toBe(630);
  expect(seen.green).toBeGreaterThan(5);
  // The SVG: the face drawn into it, the name in words.
  await page.locator("#ix-fmt").selectOption("svg");
  const [svg] = await Promise.all([page.waitForEvent("download"), page.locator("#ix-go").click()]);
  const text = fs.readFileSync(await svg.path(), "utf8");
  expect(text).toMatch(/<image [^>]*href="data:image\/png;base64,/);
  expect(text).toContain(name.replace(/&/g, "&amp;"));
  expect(text).toContain('<metadata id="auracle-patch">');
});

test("a face is the same drawing for the same render after a reload", async ({ page, app }) => {
  await boot(page, app);
  await booted(app);
  await bankDrawn(page, app);
  const first = await outlines(page);
  // Saved on leaving, restored on the reload: the same pool, its faces now
  // from the worker's store rather than the featurization.
  await app.reload();
  await bankDrawn(page, app);
  const again = await outlines(page);
  const ids = Object.keys(first).filter((id) => again[id]);
  expect(ids.length).toBeGreaterThan(30);
  for (const id of ids) expect(again[id], `row ${id}`).toBe(first[id]);
});

test("a refit is answered promptly while sixty face renders wait", async ({ page, app }) => {
  test.setTimeout(100_000); // about 37 to 46 s on CI, most of it engine waits: a boot, six picks, two refits, the faces
  await boot(page, app);
  await booted(app);
  await bankDrawn(page, app);
  await goLevel(page, "evolve");
  for (let i = 1; i <= 6; i++) {
    await app.engine((timeout) => expect(page.locator("#choose-a")).toBeEnabled({ timeout }), { ms: 30_000 });
    await page.locator("#choose-a").click();
  }
  // The sixth pick's own refit, once its undo window has closed.
  await app.reply("fitted", { timeout: 60_000 });
  // Sixty presets' faces asked of the engine, none rendered yet: sixty
  // renders queued (posted here: with the app's own file the PRESETS rows
  // ask for none, and a whole bank stored before faces asks for forty).
  // What was asked and heard from here on is the tap's, after `t0`.
  const t0 = await app.now();
  await app.post({ type: "faces", ids: [], trees: Array.from({ length: 60 }, (_, i) => ({ ref: `p${i}`, preset: i })), render: true });
  // The preset faces (each item named by its `ref`) begin to land.
  await app.engine((timeout) => page.waitForFunction(
    (t) => window.__tap.replies.some((r) => r.type === "faces" && r.at > t && (r.d.items || []).some((x) => x.ref)),
    t0, { timeout },
  ), { ms: 30_000 });
  // A refit asked for now is answered without waiting for them.
  await app.post({ type: "fit" });
  await app.reply("fitted", { after: t0, timeout: 60_000 });
  const t = await page.evaluate((t) => {
    const T = window.__tap;
    const refs = (m) => (m.d.items || []).map((x) => x.ref).filter(Boolean).length;
    const sent = T.sent.find((m) => m.type === "fit" && m.at > t);
    const got = T.replies.find((m) => m.type === "fitted" && !m.injected && m.at > t);
    const facesBefore = T.replies.filter((m) => m.type === "faces" && m.at > t && m.at < got.at).reduce((n, m) => n + refs(m), 0);
    return { ms: got.at - sent.at, facesBefore };
  }, t0);
  expect(t.facesBefore, `${t.facesBefore} faces landed before the fit's answer`).toBeLessThan(40);
  app.budget("a refit asked with sixty face renders queued → fitted", t.ms, 6000);
});

test("a preset's face still lands after the bank redraws while it was on its way", async ({ page, app }) => {
  // The app's own file of the presets' faces kept back: each row's face is
  // then a render, on its way while the bank redraws.
  await page.route("**/preset-faces.json*", (r) => r.abort());
  await boot(page, app);
  await booted(app);
  await bankDrawn(page, app);
  // PRESETS asks for the faces of the rows in view, each a render; a play at
  // once redraws the bank (the preset joins the pool) while they are pending.
  await bankTab(page, "presets");
  await expect(page.locator("#bank-list .preset-item").first()).toBeVisible();
  await page.locator("#bank-list .preset-item").first().hover(); // its ▶ shows on approach
  await page.locator("#bank-list .preset-item .bi-hear").first().click();
  // Every row in view gets its face, without a scroll.
  const inView = () => page.evaluate(() => {
    const list = document.getElementById("bank-list").getBoundingClientRect();
    const rows = [...document.querySelectorAll("#bank-list .preset-item")].filter((r) => {
      const b = r.getBoundingClientRect();
      return b.top >= list.top && b.bottom <= list.bottom;
    });
    return { rows: rows.length, faces: rows.filter((r) => r.querySelector(".face-slot img.face")).length };
  });
  await app.engine((timeout) => expect.poll(async () => {
    const v = await inView();
    return v.rows > 3 && v.faces === v.rows;
  }, { timeout }).toBe(true), { ms: 120_000 });
});
