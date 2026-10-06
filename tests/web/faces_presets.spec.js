// Faces on the PRESETS rows (Plan-008, #130): a preset's face is a real
// render of the preset (ADR-012), asked for only while its row is in view
// (`faceWhenSeen`) and rendered in the engine's faces lane, below everything
// the player is waiting on.
//
// - A preset row's face is the face the worker gives for that preset: the
//   key its slot is drawn from is the key of the worker's own answer for the
//   preset, and the bytes main was handed for the row are those bytes (not
//   pixels).
// - Scrolling the list asks for the rows that came into view, and each gets
//   its face; none of them had one before the scroll, and no name moves for
//   it.
// - A sound opened while preset faces wait to render is not kept waiting
//   behind them: each of the open's requests waits at most for the face
//   render already running when it arrived, and the faces go on landing
//   after it (an order, read through the tap, not a time).
const { test, expect, bankTab } = require("./fixtures");

/** Boot with PERFORM's first measurement of the sound the app opens with
 *  kept from the engine (`app.stall`): thirty-odd renders the faces lane
 *  waits behind by design (about 33 s on a laptop, over a minute on a CI
 *  runner), and nothing these specs are about. */
async function boot(app) {
  await app.stall({ type: "perform_wire" });
  await app.boot();
}

/** The preset rows in the list's view, in order: their index, whether a face
 *  is drawn in them, and the key it is drawn from (the slot's `data-drawn`,
 *  `<key>|<bank>|…`). Read in one task. */
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
        return { index: Number(r.dataset.index), face: !!slot.querySelector("img.face"), key: (slot.dataset.drawn || "").split("|")[0], nameX };
      });
  });

/** Every preset row in view has its face: an engine wait (the faces lane
 *  waits for the bank to finish arriving). */
const allInViewDrawn = (app, page) =>
  app.engine((timeout) =>
    expect
      .poll(async () => {
        const rows = await presetsInView(page);
        return rows.length > 3 && rows.every((r) => r.face);
      }, { timeout, message: "every preset row in view drawn with its face" })
      .toBe(true));

test("a preset row's face is the face the worker gives for that preset", async ({ page, app }) => {
  await boot(app);
  await bankTab(page, "presets");
  await allInViewDrawn(app, page);
  const rows = await presetsInView(page);
  // Each row is drawn from a face of its own.
  expect(new Set(rows.map((r) => r.key)).size, "one face per preset").toBe(rows.length);
  const row = rows[1];
  // The worker's own answer for that preset, asked by index as the row is.
  const ref = `spec-p${row.index}`;
  await app.post({ type: "faces", ids: [], trees: [{ ref, preset: row.index }], render: true });
  const own = await app.reply("faces", { where: (r) => (r.items || []).some((i) => i.ref === ref), timeout: 60_000 });
  const ownKey = own.items.find((i) => i.ref === ref).key;
  expect(row.key, "the row is drawn from the key of the worker's face for its preset").toBe(ownKey);
  // And the bytes main was handed for the row are the worker's bytes.
  const same = await page.evaluate(([target, ref]) => {
    const bytes = (want) => {
      for (const r of window.__tap.replies) {
        const it = r.type === "faces" && (r.d.items || []).find((i) => i.ref === want);
        if (it) return Array.from(it.face);
      }
      return null;
    };
    const a = bytes(target);
    const b = bytes(ref);
    return { a: a && a.length, b: b && b.length, equal: !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]) };
  }, [`p${row.index}`, ref]);
  expect(same.a, "main was handed a face for the row").toBeGreaterThan(0);
  expect(same.equal, `the row's face (${same.a} bytes) is the worker's (${same.b} bytes)`).toBe(true);
});

test("scrolling the presets renders the rows that come into view", async ({ page, app }) => {
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
  // Twenty more presets' faces asked for at once, none of them rendered yet
  // (a list of presets looked through asks for one per row): the faces lane
  // is long.
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
  // Each waited at most for the face render running when it arrived.
  expect((await landed(load._at, loaded._at)).length, "faces rendered between the open and its answer").toBeLessThanOrEqual(1);
  expect((await landed(begin._at, benched._at)).length, "faces rendered between the bench open and its answer").toBeLessThanOrEqual(1);
  // And the faces were waiting: they go on landing after it.
  await app.engine((timeout) => expect.poll(async () => (await landed(benched._at)).length, { timeout }).toBeGreaterThan(3), { ms: 120_000 });
});
