// Faces (Plan-005 task 3, RFC-006 §2, ADR-012): every row, chip and card
// carries its sound's face, the engine's measurement of the render in 40
// bands × 12 slices (`auracle_features::face`) drawn against the bank's mean
// and spread (`apps/web/faces.js`).
//
// - A face appears in every place a sound is named once its face lands: the
//   bank's rows, EVOLVE's two cards, PATCH's header and its teach strip,
//   PERFORM's sound in hand and its offer, and the warm start's cards.
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
//   still lands, without a scroll.
// - A face's render never goes ahead of a refit: with sixty of them queued
//   (a list of presets scrolled through), a refit is answered at once.
//
// Sessions are seeded (the films' own Math.random), so the pool is the same
// run to run.
const { test, expect } = require("@playwright/test");
const { goLevel, bankTab } = require("./shell");
const fs = require("fs");

const SEED = `(() => { let s = 20260928 >>> 0; Math.random = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();`;

const init = (warmed) => `(() => {
  const Orig = window.Worker;
  function Wrapped(url, opts) {
    const w = new Orig(url, opts);
    if (/worker\\.js/.test(String(url))) {
      window.__pwEngine = w;
      // When each request went out and each answer came back, by type.
      const log = (window.__pwLog = []);
      const post = w.postMessage.bind(w);
      w.postMessage = (m, t) => {
        if (m && m.type) log.push({ dir: "sent", type: m.type, at: performance.now() });
        return post(m, t);
      };
      w.addEventListener("message", (e) => {
        const d = e.data;
        if (d && d.type) log.push({ dir: "got", type: d.type, at: performance.now(), refs: d.type === "faces" ? (d.items || []).map((x) => x.ref).filter(Boolean) : undefined });
      });
      // main.js sets onmessage; with __pwNoFaces the faces never reach it.
      let fn = null;
      Object.defineProperty(w, "onmessage", {
        get: () => fn,
        set: (f) => {
          fn = f;
          w.addEventListener("message", (e) => {
            if (window.__pwNoFaces && e.data && e.data.type === "faces") return;
            f.call(w, e);
          });
        },
      });
    }
    return w;
  }
  Wrapped.prototype = Orig.prototype;
  window.Worker = Wrapped;
  // What a slot shows: its drawing, as the image it is (vessel.js draws it).
  window.__pwOutline = async (img) => (img ? img.getAttribute("src") || "" : "");
  try {
    for (const k of ["auracle-played", "auracle-bench-tour", "auracle-bank-toured"${warmed ? ', "auracle-warmed"' : ""}]) localStorage.setItem(k, "1");
  } catch (_) {}
})();`;

async function boot(page, { warmed = true, noFaces = false } = {}) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(SEED);
  await page.addInitScript(init(warmed));
  if (noFaces) await page.addInitScript(() => { window.__pwNoFaces = true; });
  await page.goto("/");
  return errors;
}
const booted = (page) => expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 150_000 });

/** Every pool row drawn: 40 rows, each with its face. */
async function bankDrawn(page) {
  await expect
    .poll(() => page.evaluate(() => {
      const rows = [...document.querySelectorAll("#bank-list .bank-item[data-id]")];
      return rows.length >= 40 && rows.every((r) => r.querySelector(".face-slot img.face"));
    }), { timeout: 120_000 })
    .toBe(true);
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

test("a face appears on every row, card and chip once its render lands", async ({ page }) => {
  const errors = await boot(page);
  await booted(page);
  await bankDrawn(page);
  // EVOLVE's two cards.
  await goLevel(page, "evolve");
  await expect(page.locator("#face-a.face-slot img.face")).toHaveCount(1, { timeout: 30_000 });
  await expect(page.locator("#face-b.face-slot img.face")).toHaveCount(1);
  // PATCH: the header and the teach strip's A and B.
  await page.locator("#bank-list .bank-item[data-id] .bi-name").first().click();
  await expect(page.locator("#out-face img.face")).toHaveCount(1, { timeout: 60_000 });
  await expect(page.locator("#pd-a .face-slot img.face")).toHaveCount(1, { timeout: 30_000 });
  await expect(page.locator("#pd-b .face-slot img.face")).toHaveCount(1);
  // PERFORM: the sound in hand, and B once an offer has grown.
  await goLevel(page, "perform");
  await expect(page.locator(".pf-faces > .pf-face img.face")).toHaveCount(1, { timeout: 60_000 });
  await expect(page.locator(".pf-offer .pf-face img.face")).toHaveCount(0);
  await expect(page.locator(".pf-status")).toContainText("controls reach", { timeout: 120_000 });
  await page.evaluate(() => {
    const pad = document.querySelector(".pf-pad.primary");
    pad.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 1 }));
    pad.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId: 1 }));
  });
  await expect(page.locator(".pf-offer.ready")).toHaveCount(1, { timeout: 120_000 });
  await expect(page.locator(".pf-offer .pf-face img.face")).toHaveCount(1, { timeout: 30_000 });
  // The offer's face is its own render's, not the sound in hand's.
  const [held, offer] = await page.evaluate(async () => [
    await window.__pwOutline(document.querySelector(".pf-faces > .pf-face img.face")),
    await window.__pwOutline(document.querySelector(".pf-offer .pf-face img.face")),
  ]);
  expect(held).not.toBe("");
  expect(offer).not.toBe(held);
  expect(errors).toEqual([]);
});

test("the warm start's cards carry their faces", async ({ page }) => {
  const errors = await boot(page, { warmed: false });
  await expect(page.locator("#warmstart")).toBeVisible({ timeout: 150_000 });
  await expect(page.locator("#warm-grid .warm-item")).toHaveCount(9);
  // Their renders wait for the bank to arrive, then each lands.
  await expect(page.locator("#warm-grid .warm-item .face-slot img.face")).toHaveCount(9, { timeout: 150_000 });
  expect(errors).toEqual([]);
});

test("a face's whitening moves when the bank changes", async ({ page }) => {
  const errors = await boot(page);
  await booted(page);
  await bankDrawn(page);
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
  expect(errors).toEqual([]);
});

for (const [label, ctx] of [
  ["on a desktop", {}],
  ["on a phone", { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }],
]) {
  test.describe(label, () => {
    test(`a name is at the same x and width with or without its face, ${label}`, async ({ browser }, info) => {
      test.setTimeout(360_000); // two boots
      const measure = async (noFaces) => {
        const context = await browser.newContext({ ...ctx, baseURL: info.project.use.baseURL });
        const page = await context.newPage();
        const errors = await boot(page, { noFaces });
        if (ctx.isMobile) await page.locator("#hg-anyway").click();
        await booted(page);
        await expect.poll(() => page.evaluate(() => document.querySelectorAll("#bank-list .bank-item[data-id]").length), { timeout: 120_000 }).toBeGreaterThanOrEqual(40);
        if (!noFaces) await bankDrawn(page);
        else await page.waitForTimeout(2000);
        const boxes = await nameBoxes(page);
        await context.close();
        return { boxes, errors };
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
      expect([...without.errors, ...withFaces.errors]).toEqual([]);
    });
  });
}

test("the sound's card downloads with its face, its name and its patch", async ({ page }) => {
  const errors = await boot(page);
  await booted(page);
  await bankDrawn(page);
  await page.locator("#bank-list .bank-item[data-id] .bi-name").first().click();
  await expect(page.locator("#out-face img.face")).toHaveCount(1, { timeout: 60_000 });
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
  expect(errors).toEqual([]);
});

test("a face is the same drawing for the same render after a reload", async ({ page }) => {
  const errors = await boot(page);
  await booted(page);
  await bankDrawn(page);
  const first = await outlines(page);
  // Saved on leaving, restored on the reload: the same pool, its faces now
  // from the worker's store rather than the featurization.
  await page.reload();
  await booted(page);
  await bankDrawn(page);
  const again = await outlines(page);
  const ids = Object.keys(first).filter((id) => again[id]);
  expect(ids.length).toBeGreaterThan(30);
  for (const id of ids) expect(again[id], `row ${id}`).toBe(first[id]);
  expect(errors).toEqual([]);
});

test("a refit is answered promptly while sixty face renders wait", async ({ page }) => {
  test.setTimeout(300_000);
  const errors = await boot(page);
  await booted(page);
  await bankDrawn(page);
  await goLevel(page, "evolve");
  for (let i = 1; i <= 6; i++) {
    await expect(page.locator("#choose-a")).toBeEnabled({ timeout: 30_000 });
    await page.locator("#choose-a").click();
  }
  // The sixth pick's own refit, once its undo window has closed.
  await expect.poll(() => page.evaluate(() => window.__pwLog.some((m) => m.dir === "got" && m.type === "fitted")), { timeout: 60_000 }).toBe(true);
  // Sixty presets' faces, none rendered yet: sixty renders queued (a list of
  // presets scrolled through asks for that many).
  await page.evaluate(() => {
    window.__pwLog.length = 0;
    window.__pwEngine.postMessage({ type: "faces", ids: [], trees: Array.from({ length: 60 }, (_, i) => ({ ref: `p${i}`, preset: i })), render: true });
  });
  await expect.poll(() => page.evaluate(() => window.__pwLog.some((m) => m.dir === "got" && m.type === "faces" && m.refs && m.refs.length)), { timeout: 30_000 }).toBe(true);
  // A refit asked for now is answered without waiting for them.
  await page.evaluate(() => window.__pwEngine.postMessage({ type: "fit" }));
  await expect.poll(() => page.evaluate(() => window.__pwLog.some((m) => m.dir === "got" && m.type === "fitted")), { timeout: 60_000 }).toBe(true);
  const t = await page.evaluate(() => {
    const sent = window.__pwLog.find((m) => m.dir === "sent" && m.type === "fit");
    const got = window.__pwLog.find((m) => m.dir === "got" && m.type === "fitted");
    const facesBefore = window.__pwLog.filter((m) => m.dir === "got" && m.type === "faces" && m.at < got.at).reduce((n, m) => n + (m.refs || []).length, 0);
    return { ms: got.at - sent.at, facesBefore };
  });
  expect(t.facesBefore, `${t.facesBefore} faces landed before the fit's answer`).toBeLessThan(40);
  expect(t.ms, `the fit took ${Math.round(t.ms)} ms`).toBeLessThan(6000);
  expect(errors).toEqual([]);
});

test("a preset's face still lands after the bank redraws while it was on its way", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await boot(page);
  await booted(page);
  await bankDrawn(page);
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
  await expect.poll(async () => {
    const v = await inView();
    return v.rows > 3 && v.faces === v.rows;
  }, { timeout: 120_000 }).toBe(true);
  expect(errors).toEqual([]);
});
