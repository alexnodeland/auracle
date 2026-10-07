// Faces of the presets (Plan-008, #130, #287): a preset's face is a real
// render of the preset (ADR-012), rendered natively ahead of time and shipped
// with the app (`apps/web/preset-faces.json`, `make preset-faces`), so the
// page draws it from the file without asking the engine. The engine renders
// one only where the file is not the session's (another build's render
// namespace), in its faces lane, below everything the player is waiting on.
//
// - The warm start's cards are drawn from the file at once on an engine
//   slowed four times (as on an older laptop): each card from its preset's
//   face, under the key the worker files it under, while PERFORM's first
//   measurement is still out, and no preset's face is asked of the engine.
//   Its time is a budget (ADR-022).
// - The PRESETS rows are drawn from the file: the rows in view, then the rest
//   while the page is idle, so a row at the list's foot has its face before
//   it is scrolled to; and no preset's face is asked of the engine.
// - A preset row's face is the face the worker gives for that preset: the
//   key it is drawn from is the key of the worker's own answer, and the
//   file's bytes are the bytes the engine renders in the page's wasm.
// - With another build's file, scrolling the list asks for the rows that came
//   into view, and each gets its face; none of them had one before the
//   scroll, and no name moves for it.
// - A sound opened while preset faces wait to render is not kept waiting
//   behind them: each of the open's requests waits at most for the face
//   render already running when it arrived, and the faces go on landing
//   after it (an order, read through the tap, not a time).
const fs = require("fs");
const path = require("path");
const { test, expect, bankTab } = require("./fixtures");

const SHIPPED = JSON.parse(fs.readFileSync(path.join(__dirname, "../../apps/web/preset-faces.json"), "utf8"));
/** The key the worker files a preset's face under, by the preset's name. */
const SHIPPED_KEY = new Map(SHIPPED.presets.map((p) => [p.name, `${SHIPPED.ns}/${p.key}`]));

/** The file as another build would ship it: the same faces, in a render
 *  namespace this session does not measure in, so the page asks the engine. */
async function anotherBuildsFaces(page) {
  const body = JSON.stringify({ ...SHIPPED, ns: `${SHIPPED.ns}-another-build` });
  await page.route("**/preset-faces.json*", (r) => r.fulfill({ body, contentType: "application/json" }));
}

/** Boot with PERFORM's first measurement of the sound the app opens with
 *  kept from the engine (`app.stall`): thirty-odd renders the faces lane
 *  waits behind by design (about 33 s on a laptop, over a minute on a CI
 *  runner), and nothing these specs are about. */
async function boot(app) {
  await app.stall({ type: "perform_wire" });
  await app.boot();
}

/** The preset rows in the list's view, in order: their index and name,
 *  whether a face is drawn in them, and the key it is drawn from (the slot's
 *  `data-drawn`, `<key>|<bank>|…`). Read in one task. */
const presetsInView = (page) =>
  page.evaluate(() => {
    const list = document.getElementById("bank-list").getBoundingClientRect();
    return [...document.querySelectorAll("#bank-list .preset-item")]
      .filter((r) => {
        const b = r.getBoundingClientRect();
        return b.bottom > list.top && b.top < list.bottom;
      })
      .map((r) => {
        const slot = r.querySelector(".face-slot");
        const nameX = Math.round(r.querySelector(".bi-name").getBoundingClientRect().left - r.getBoundingClientRect().left);
        return { index: Number(r.dataset.index), name: r.querySelector(".bi-name").textContent, face: !!slot.querySelector("img.face"), key: (slot.dataset.drawn || "").split("|")[0], nameX };
      });
  });

/** Every preset row in view has its face: an engine wait (a face is drawn
 *  against the bank, whose faces are the engine's, and with another build's
 *  file the faces lane waits for the bank to finish arriving). */
const allInViewDrawn = (app, page) =>
  app.engine((timeout) =>
    expect
      .poll(async () => {
        const rows = await presetsInView(page);
        return rows.length > 3 && rows.every((r) => r.face);
      }, { timeout, message: "every preset row in view drawn with its face" })
      .toBe(true));

/** The presets' faces asked of the engine so far: each `faces` request's
 *  entries that name a preset. */
const presetAsks = async (app) => (await app.sent({ type: "faces" })).flatMap((s) => (s.trees || []).filter((t) => t.preset != null));

// What the warm start's cards drew, read in the microtask after the task that
// drew the last of them: when the card was first shown and when every face was
// in, the key each face is drawn from, and how many of PERFORM's measurements
// were still out then (the tap's own record, `sent` without a last reply).
const WARM_WATCH = `(() => {
  const W = (window.__warmFaces = { shownAt: null, drawnAt: null, cards: null, measuring: null });
  const look = () => {
    const card = document.getElementById("warmstart");
    if (W.drawnAt != null || !card || card.classList.contains("hidden")) return;
    if (W.shownAt == null) W.shownAt = performance.now();
    const cards = [...document.querySelectorAll("#warm-grid .warm-item")];
    if (!cards.length || !cards.every((c) => c.querySelector(".face-slot img.face"))) return;
    W.drawnAt = performance.now();
    W.cards = cards.map((c) => ({ name: c.querySelector(".wi-name").textContent, key: (c.querySelector(".face-slot").dataset.drawn || "").split("|")[0] }));
    const T = window.__tap;
    W.measuring = T.sent.filter((s) => s.type === "perform_wire" && !(s.m.rid in T.finals)).length;
  };
  const watch = () => new MutationObserver(look).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
  if (document.documentElement) watch();
  else document.addEventListener("DOMContentLoaded", watch);
})();`;

test("the warm start's cards draw their presets' faces from the app's own file, at once on a slowed engine, and ask the engine for none", async ({ page, app }) => {
  await page.addInitScript(WARM_WATCH);
  // The engine's wasm four times slower, as on an older laptop: PERFORM's
  // first measurement of the sound the app opens with takes minutes.
  await app.boot({ warmed: false, slowEngine: 4 });
  await app.engine((timeout) =>
    expect
      .poll(() => page.evaluate(() => window.__warmFaces.drawnAt), { timeout, message: "the warm start shown with every card's face" })
      .not.toBeNull());
  const warm = await page.evaluate(() => window.__warmFaces);
  expect(warm.cards).toHaveLength(9);
  // Each card is drawn from its own preset's face in the file, under the key
  // the worker files that preset's face under.
  expect(warm.cards.map((c) => c.key)).toEqual(warm.cards.map((c) => SHIPPED_KEY.get(c.name)));
  // They waited for no engine work: PERFORM's measurement was still out…
  expect(warm.measuring, "PERFORM's measurements out when the cards' faces were drawn").toBeGreaterThan(0);
  // …and no preset's face was asked of the engine.
  expect(await presetAsks(app)).toEqual([]);
  app.budget("the warm start shown → its nine faces drawn, engine slowed 4×", warm.drawnAt - warm.shownAt, 1000);
});

test("the PRESETS rows draw their presets' faces from the app's own file, those out of view before they are scrolled to, and ask the engine for none", async ({ page, app }) => {
  await app.boot({ slowEngine: 4 });
  await bankTab(page, "presets");
  await allInViewDrawn(app, page);
  const head = await presetsInView(page);
  expect(head.map((r) => r.key)).toEqual(head.map((r) => SHIPPED_KEY.get(r.name)));
  // The rows out of view are drawn too, while the page is idle (main.js
  // `paintFaces`): every row of the list has its face before any is
  // scrolled to.
  await expect
    .poll(() => page.locator("#bank-list .preset-item").evaluateAll((rows) => ({ rows: rows.length, bare: rows.filter((r) => !r.querySelector(".face-slot img.face")).length })), { message: "every preset row drawn, in view or not" })
    .toEqual({ rows: SHIPPED.presets.length, bare: 0 });
  // To the list's foot: rows none of which was in view, each with its own
  // preset's face from the file.
  await page.evaluate(() => {
    const list = document.getElementById("bank-list");
    list.scrollTop = list.scrollHeight;
  });
  await expect
    .poll(async () => {
      const rows = await presetsInView(page);
      return rows.length > 3 && !rows.some((r) => head.some((h) => h.index === r.index));
    }, { message: "the list scrolled to rows none of which was in view" })
    .toBe(true);
  const foot = await presetsInView(page);
  expect(foot.filter((r) => !r.face), "a row at the foot without its face").toEqual([]);
  expect(foot.map((r) => r.key)).toEqual(foot.map((r) => SHIPPED_KEY.get(r.name)));
  expect(await presetAsks(app)).toEqual([]);
});

test("a preset row's face is the face the worker gives for that preset", async ({ page, app }) => {
  await boot(app);
  await bankTab(page, "presets");
  await allInViewDrawn(app, page);
  const rows = await presetsInView(page);
  // Each row is drawn from a face of its own.
  expect(new Set(rows.map((r) => r.key)).size, "one face per preset").toBe(rows.length);
  const row = rows[1];
  // The worker's own answer for that preset, asked by index as a row would
  // be: its faces lane renders it in the page's wasm.
  const ref = `spec-p${row.index}`;
  await app.post({ type: "faces", ids: [], trees: [{ ref, preset: row.index }], render: true });
  const own = await app.reply("faces", { where: (r) => (r.items || []).some((i) => i.ref === ref), timeout: 60_000 });
  const ownKey = own.items.find((i) => i.ref === ref).key;
  expect(row.key, "the row is drawn from the key of the worker's face for its preset").toBe(ownKey);
  // And the file's bytes for the row are the bytes the worker rendered.
  const rendered = await page.evaluate((want) => {
    for (const r of window.__tap.replies) {
      const it = r.type === "faces" && (r.d.items || []).find((i) => i.ref === want);
      if (it) return Array.from(it.face);
    }
    return null;
  }, ref);
  const shipped = Array.from(Buffer.from(SHIPPED.presets.find((p) => p.name === row.name).face, "base64"));
  expect(rendered, "the worker rendered a face").not.toBeNull();
  expect(shipped, `${row.name}'s face in the file is the one the engine renders`).toEqual(rendered);
});

test("scrolling the presets renders the rows that come into view", async ({ page, app }) => {
  // Another build's file: its faces are not this session's, so each row is
  // asked of the engine as it comes into view, as before the file existed.
  await anotherBuildsFaces(page);
  await boot(app);
  await bankTab(page, "presets");
  await allInViewDrawn(app, page);
  const t0 = await app.now();
  // To the list's foot, and what is in view there, read in the same task.
  const revealed = await page.evaluate(() => {
    const list = document.getElementById("bank-list");
    list.scrollTop = list.scrollHeight;
    const box = list.getBoundingClientRect();
    return [...list.querySelectorAll(".preset-item")]
      .filter((r) => {
        const b = r.getBoundingClientRect();
        return b.bottom > box.top && b.top < box.bottom;
      })
      .map((r) => ({
        index: Number(r.dataset.index),
        face: !!r.querySelector(".face-slot img.face"),
        nameX: Math.round(r.querySelector(".bi-name").getBoundingClientRect().left - r.getBoundingClientRect().left),
      }));
  });
  expect(revealed.length).toBeGreaterThan(3);
  expect(revealed.filter((r) => r.face), "no row at the foot had a face before it came into view").toEqual([]);
  // Asked for once they are in view, by their presets…
  await expect
    .poll(async () => {
      const asked = new Set((await app.sent({ type: "faces" }, { after: t0 })).flatMap((s) => (s.trees || []).map((t) => t.preset)));
      return revealed.every((r) => asked.has(r.index));
    }, { message: "a faces request names every row that came into view" })
    .toBe(true);
  // …and each drawn as its face lands, its name where it was without it.
  await allInViewDrawn(app, page);
  const now = await presetsInView(page);
  expect(now.map((r) => [r.index, r.nameX]), "the same rows, each name at the x it had before its face").toEqual(revealed.map((r) => [r.index, r.nameX]));
});

test("a sound opened while preset faces wait to render is not kept waiting behind them", async ({ page, app }) => {
  await boot(app);
  await bankTab(page, "presets");
  await allInViewDrawn(app, page);
  // Twenty more presets' faces asked of the engine at once (posted here:
  // with the app's own file the rows ask for none), none of them rendered
  // yet: the faces lane is long, as a bank stored before faces, or a list of
  // presets under another build's file, makes it.
  const shown = new Set((await presetsInView(page)).map((r) => r.index));
  const all = await page.locator("#bank-list .preset-item").evaluateAll((rows) => rows.map((r) => Number(r.dataset.index)));
  const asked = all.filter((i) => !shown.has(i)).slice(0, 20);
  expect(asked).toHaveLength(20);
  const refs = asked.map((i) => `spec-q${i}`);
  const t0 = await app.now();
  await app.post({ type: "faces", ids: [], trees: asked.map((preset, i) => ({ ref: refs[i], preset })), render: true });
  const landed = async (from, to = Infinity) =>
    (await app.replies("faces", { after: from }))
      .filter((r) => r._at < to)
      .flatMap((r) => (r.items || []).map((i) => i.ref))
      .filter((ref) => refs.includes(ref));
  // The first has been rendered: the rest wait behind it.
  await app.engine((timeout) => expect.poll(async () => (await landed(t0)).length, { timeout }).toBeGreaterThan(0), { ms: 60_000 });
  // A preset not in the pool, opened from its row.
  const opened = await app.now();
  await page.locator("#bank-list .preset-item:not(.in-bank)").first().click();
  await expect.poll(async () => (await app.sent({ type: "load_preset", open: true }, { after: opened })).length).toBe(1);
  const [load] = await app.sent({ type: "load_preset", open: true }, { after: opened });
  const loaded = await app.replyTo(load);
  // Main opens it on the bench in a second request once the first is answered.
  await app.engine((timeout) => expect.poll(async () => (await app.sent({ type: "edit_begin" }, { after: opened })).length, { timeout }).toBe(1), { ms: 30_000 });
  const [begin] = await app.sent({ type: "edit_begin" }, { after: opened });
  const benched = await app.replyTo(begin);
  // Each waited at most for the face render running when it arrived. A face
  // is counted when it reaches main, so the open's window can hold one more:
  // a face the worker posted just before the open reached it, still on its
  // way to main when the open was sent (the click lands at any point in a
  // render). The bench open is sent once the open's first answer is in, and
  // every face posted before that answer reaches main ahead of it.
  expect((await landed(load._at, loaded._at)).length, "faces landing between the open and its answer").toBeLessThanOrEqual(2);
  expect((await landed(begin._at, benched._at)).length, "faces rendered between the bench open and its answer").toBeLessThanOrEqual(1);
  // And the faces were waiting when it was answered (so the open went ahead
  // of them, and this is not a lane that had emptied), and go on landing
  // after it.
  expect((await landed(t0, loaded._at)).length, "faces still waiting when the open was answered").toBeLessThan(refs.length);
  await app.engine((timeout) => expect.poll(async () => (await landed(loaded._at)).length, { timeout }).toBeGreaterThan(0), { ms: 60_000 });
});
