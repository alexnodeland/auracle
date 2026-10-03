// PERFORM's palette (Plan-005 task 5): the player places, hides and orders up
// to eight of the engine's eighteen controls (`perform::PALETTE`), and the
// panel is kept with the session.
//
// What the engine's contract asks of the page (#92): a measurement names the
// controls it wires (`perform_wire`'s `controls`), each wiring comes back with
// its palette `index`, and the page names a control back by that index,
// never by its position; its cache of wirings (`wireKey`) holds the set as
// well as the patch. A placed control is measured lazily, and says so while
// it is (`listening…`, #88's waiting sign).
//
// The spec watches the page's requests to the engine worker and its replies
// by wrapping `Worker` before `main.js` runs, as the other PERFORM specs do.
const { test, expect } = require("@playwright/test");
const { goLevel, bankTab } = require("./shell");

const INIT = `(() => {
  const Orig = window.Worker;
  const sent = (window.__sent = []);
  const got = (window.__got = []);
  function Wrapped(url, opts) {
    const w = new Orig(url, opts);
    if (/worker\\.js/.test(String(url))) {
      const post = w.postMessage.bind(w);
      w.postMessage = (m, t) => {
        if (m && /^perform_/.test(m.type)) sent.push(JSON.parse(JSON.stringify({ type: m.type, req: m.req, controls: m.controls, control: m.control, sign: m.sign, k: m.k })));
        return post(m, t);
      };
      w.addEventListener("message", (e) => {
        // A knob write in PATCH landed on the bench (the reply that carries
        // PERFORM's tree text along, \`followTree\`).
        if (e.data && e.data.type === "bench" && e.data.edited !== undefined) window.__benched = (window.__benched || 0) + 1;
        if (e.data && e.data.type === "perform_wired" && e.data.data) got.push({ req: e.data.req, wiring: e.data.data.wiring.map((w) => ({ name: w.name, index: w.index, search: w.search })) });
      });
    }
    return w;
  }
  Wrapped.prototype = Orig.prototype;
  window.Worker = Wrapped;
})();`;

async function boot(page) {
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.addInitScript(INIT);
  await page.goto("/");
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 120_000 });
  await page.locator("#warm-skip").click();
  return errs;
}

async function openOnPerform(page, name) {
  await bankTab(page, "presets");
  await page.locator(".bank-item", { hasText: name }).first().click();
  await page.waitForFunction((n) => (document.getElementById("rack-subject")?.textContent || "").includes(n), name, { timeout: 90_000 });
  await goLevel(page, "perform");
  await expect(page.locator(".pf-name")).toHaveText(name, { timeout: 30_000 });
  await expect(page.locator(".pf-status")).toContainText("controls reach", { timeout: 120_000 });
}

// Watch the page every frame for what `probe` (a function's source, run in
// the page) reports, keeping every distinct answer: a state that lasts a
// second (a measurement on a fast machine) is seen however the test is timed.
async function watch(page, probe) {
  await page.evaluate((src) => {
    const f = new Function(`return (${src})();`);
    const seen = (window.__seen = []);
    const tick = () => {
      if (window.__seen !== seen) return;
      const v = f();
      if (v != null && !seen.some((x) => JSON.stringify(x) === JSON.stringify(v))) seen.push(v);
      requestAnimationFrame(tick);
    };
    tick();
  }, probe.toString());
  return () => page.evaluate(() => window.__seen.slice());
}

// The deck's named controls, in order, by their names.
const deckNames = (page) =>
  page.evaluate(() => [...document.querySelectorAll(".pf-knob[data-index]")].map((k) => k.getAttribute("aria-label")));

const row = (page, name, placed) => page.locator(`.pp-row${placed ? ".on" : ":not(.on)"}`, { has: page.locator(".pp-name", { hasText: new RegExp(`^${name}$`) }) });

// The app's own store (`idbGet` in main.js): the panel as saved.
const savedPanel = (page) =>
  page.evaluate(async () => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open("auracle", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    try {
      const v = await new Promise((res) => {
        const q = db.transaction("kv", "readonly").objectStore("kv").get("state");
        q.onsuccess = () => res(q.result);
        q.onerror = () => res(null);
      });
      return v && v.ui && v.ui.perf ? v.ui.perf.panel || null : null;
    } finally {
      db.close();
    }
  });

test("the palette places, hides and orders up to eight controls, and the panel comes back after a reload", async ({ page }) => {
  test.setTimeout(300_000);
  let errs = await boot(page);
  await openOnPerform(page, "Glass Pad");
  expect(await deckNames(page)).toEqual(["Bright", "Snap", "Motion", "Body", "Grit", "Space"]);

  await page.locator(".pf-arrange").click();
  const pal = page.locator(".pp");
  await expect(pal).toBeVisible();
  await expect(pal.locator(".pp-sub")).toHaveText("6 of 8 on the panel");
  // Every one of the eighteen is listed once: six on the panel, twelve to place.
  await expect(pal.locator(".pp-row.on")).toHaveCount(6);
  await expect(pal.locator(".pp-row:not(.on)")).toHaveCount(12);

  // Place two: the panel is full, and nothing more can be placed.
  await row(page, "Bite", false).locator(".pp-place").click();
  await row(page, "Warmth", false).locator(".pp-place").click();
  await expect(pal.locator(".pp-sub")).toHaveText("8 of 8 on the panel");
  expect(await deckNames(page)).toEqual(["Bright", "Snap", "Motion", "Body", "Grit", "Space", "Bite", "Warmth"]);
  const places = pal.locator(".pp-place");
  await expect(places).toHaveCount(10);
  for (let i = 0; i < 10; i++) await expect(places.nth(i)).toBeDisabled();
  // Blend and Wander stay at the end of the deck, after the eight.
  await expect(page.locator(".pf-knob")).toHaveCount(10);
  await expect(page.locator('.pf-knob[data-i="8"]')).toHaveAttribute("aria-label", "Blend");
  await expect(page.locator('.pf-knob[data-i="9"]')).toHaveAttribute("aria-label", "Wander");

  // Hide one, and there is room again.
  await row(page, "Snap", true).locator(".pp-hide").click();
  await expect(pal.locator(".pp-sub")).toHaveText("7 of 8 on the panel");
  expect(await deckNames(page)).toEqual(["Bright", "Motion", "Body", "Grit", "Space", "Bite", "Warmth"]);
  await expect(row(page, "Snap", false).locator(".pp-place")).toBeEnabled();

  // Order: Bite to the front, one step at a time. The same set in another
  // order is the same measurement, so nothing is asked of the engine. A knob
  // turned in PATCH first makes the sound's tree new (`followTree`), so no
  // kept wiring answers for it: only the set being unchanged keeps a
  // reorder from asking. The panel's set is measured first, so nothing of
  // its own is still out when the order changes.
  await expect(page.locator(".pf-knob.waiting")).toHaveCount(0, { timeout: 150_000 });
  await expect(page.locator(".pf-status")).not.toContainText("re-checking", { timeout: 150_000 });
  await goLevel(page, "patch");
  await expect(page.locator("#rack-svg .knob-hit").first()).toBeVisible({ timeout: 30_000 });
  const hit = await page.evaluate(() => {
    const g = [...document.querySelectorAll("#rack-svg g[data-addr]")].find((g) => {
      const k = g.querySelector(":scope > .knob-hit");
      if (!k) return false;
      const r = k.getBoundingClientRect();
      return r.width > 0 && r.y > 80 && r.bottom < window.innerHeight - 160 && r.x > 0 && r.right < window.innerWidth;
    });
    const r = g.querySelector(":scope > .knob-hit").getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.move(hit.x, hit.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(hit.x, hit.y - i * 5);
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__benched || 0), { timeout: 30_000 }).toBeGreaterThan(0);
  await goLevel(page, "perform");
  await page.locator(".pf-arrange").click();
  const asked = () => page.evaluate(() => window.__sent.filter((m) => m.type === "perform_wire").length);
  await expect.poll(async () => { const a = await asked(); await page.waitForTimeout(500); return (await asked()) === a; }, { timeout: 30_000 }).toBe(true);
  const before = await asked();
  for (let i = 0; i < 5; i++) await row(page, "Bite", true).locator(".pp-up").click();
  await page.waitForTimeout(1000);
  expect(await asked(), "a reorder asks for no measurement").toBe(before);
  await expect(row(page, "Bite", true).locator(".pp-up")).toBeDisabled();
  const arranged = ["Bite", "Bright", "Motion", "Body", "Grit", "Space", "Warmth"];
  expect(await deckNames(page)).toEqual(arranged);

  // Esc puts the palette away, and the keys still play while it is open.
  await page.keyboard.press("Escape");
  await expect(pal).toBeHidden();

  // Kept with the session: saved, then back after a reload.
  await expect.poll(() => savedPanel(page), { timeout: 30_000 }).toEqual([16, 0, 2, 3, 4, 5, 6]);
  expect(errs).toEqual([]);
  await page.reload();
  errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 120_000 });
  if (await page.locator("#warm-skip").isVisible()) await page.locator("#warm-skip").click();
  await goLevel(page, "perform");
  await expect.poll(() => deckNames(page), { timeout: 30_000 }).toEqual(arranged);
  expect(errs).toEqual([]);
});

test("a placed control is measured with the panel's set, keyed by that set, and says listening… until it is", { tag: "@slow" }, async ({ page }) => {
  test.setTimeout(300_000);
  const errs = await boot(page);
  await openOnPerform(page, "Glass Pad");
  // From a settled sound: the six's background re-check is done first.
  await expect(page.locator(".pf-status")).not.toContainText("re-checking", { timeout: 120_000 });
  const base = await page.evaluate(() => window.__sent.length);
  await page.locator(".pf-arrange").click();
  const seen = await watch(page, () => {
    const k = document.querySelector('.pf-knob[data-index="16"]');
    const r = document.querySelector('.pp-row.on[data-index="16"]');
    if (!k) return null;
    return {
      waiting: k.classList.contains("waiting"),
      sign: k.querySelector(".pf-k-wait").textContent,
      status: /listening to Bite…/.test(document.querySelector(".pf-status").textContent),
      row: r ? r.querySelector(".pp-wait").textContent : null,
      // The controls already measured still turn meanwhile.
      bright: !document.querySelector('.pf-knob[data-index="0"]').classList.contains("unwired"),
    };
  });
  await row(page, "Bite", false).locator(".pp-place").click();

  // While it was measured, the new control waited, and said so in its own
  // box, on its palette row and on the status line, with Bright playing on.
  const bite = page.locator('.pf-knob[data-index="16"]');
  await expect
    .poll(async () => (await seen()).some((v) => v.waiting && v.sign === "listening…" && v.status && v.row === "listening…" && v.bright), { timeout: 150_000 })
    .toBe(true);

  // The request names the set, in palette order.
  const asked = await page.evaluate((n) => window.__sent.slice(n).filter((m) => m.type === "perform_wire" && m.controls), base);
  expect(asked.length).toBeGreaterThan(0);
  expect(asked[0].controls).toEqual([0, 1, 2, 3, 4, 5, 16]);

  // Measured: the sign goes, and the control is wired (or a search control).
  await expect(bite).not.toHaveClass(/\bwaiting\b/, { timeout: 150_000 });
  await expect(bite).not.toHaveClass(/\bpending\b/);
  await expect(bite.locator(".pf-k-wait")).toHaveText("");

  // Hidden and placed again: the set was measured, so its row and its knob
  // say what it does at once, never "not measured".
  await row(page, "Bite", true).locator(".pp-hide").click();
  await row(page, "Bite", false).locator(".pp-place").click();
  const again = await page.evaluate(() => ({
    mark: document.querySelector('.pp-row.on[data-index="16"] .pp-mark').dataset.mark,
    sign: document.querySelector('.pp-row.on[data-index="16"] .pp-wait').textContent,
    pending: document.querySelector('.pf-knob[data-index="16"]').classList.contains("pending"),
  }));
  expect(["turns", "search"]).toContain(again.mark);
  expect(again.sign).toBe("");
  expect(again.pending).toBe(false);

  // The kept wirings hold this sound once per set: the six's key, and the
  // same key with the set.
  const keys = async () =>
    page.evaluate(() => {
      try {
        return JSON.parse(localStorage.getItem("auracle-perform-wirings") || "[]").map(([k]) => k);
      } catch {
        return [];
      }
    });
  await expect.poll(async () => (await keys()).filter((k) => k.endsWith("#controls=0,1,2,3,4,5,16")).length, { timeout: 30_000 }).toBe(1);
  const withSet = (await keys()).find((k) => k.endsWith("#controls=0,1,2,3,4,5,16"));
  const six = withSet.slice(0, withSet.indexOf("#controls="));
  // Another set of the same sound is another key.
  await row(page, "Bite", true).locator(".pp-hide").click();
  await row(page, "Warmth", false).locator(".pp-place").click();
  await expect(page.locator('.pf-knob[data-index="6"]')).not.toHaveClass(/\bwaiting\b/, { timeout: 150_000 });
  await expect.poll(async () => (await keys()).includes(`${six}#controls=0,1,2,3,4,5,6`), { timeout: 30_000 }).toBe(true);
  expect(new Set([withSet, `${six}#controls=0,1,2,3,4,5,6`]).size).toBe(2);
  expect(errs).toEqual([]);
});

test("a control is named back by its palette index, on a panel in another order", { tag: "@slow" }, async ({ page }) => {
  test.setTimeout(300_000);
  const errs = await boot(page);
  // A preset on which GRIT is a search control (most are: the shipped
  // wirings say which), so turning it asks for an aimed offer.
  const name = await page.evaluate(async () => {
    const f = await (await fetch("/perform-wirings.json")).json();
    const p = f.presets.find((p) => p.data && p.data.wiring.find((w) => w.index === 4)?.search && p.name === "Glass Pad") ||
      f.presets.find((p) => p.data && p.data.wiring.find((w) => w.index === 4)?.search);
    return p.name;
  });
  await openOnPerform(page, name);
  await page.locator(".pf-arrange").click();
  // Bite placed, then Bite and Grit moved to the front: the panel reads
  // Grit, Bite, Bright, …, which is not the order a measurement wires them
  // in (palette order), so a position is never a control's index.
  await row(page, "Bite", false).locator(".pp-place").click();
  for (let i = 0; i < 6; i++) await row(page, "Bite", true).locator(".pp-up").click();
  for (let i = 0; i < 5; i++) await row(page, "Grit", true).locator(".pp-up").click();
  await page.keyboard.press("Escape");
  expect(await deckNames(page)).toEqual(["Grit", "Bite", "Bright", "Snap", "Motion", "Body", "Space"]);
  await expect(page.locator('.pf-knob[data-index="16"]')).not.toHaveClass(/\bwaiting\b/, { timeout: 150_000 });

  // Each knob shows its own control's wiring: its title is named from the
  // wiring laid on it, which a reply in palette order would put elsewhere.
  for (const [i, n] of [[0, "Grit"], [1, "Bite"], [2, "Bright"]]) {
    await expect(page.locator(`.pf-knob[data-i="${i}"]`)).toHaveAttribute("title", new RegExp(`^${n}`));
  }
  // The panel's set's reply (a re-check of the six may land beside it).
  const reply = await page.evaluate(() => window.__got.filter((g) => g.wiring.some((w) => w.index === 16)).pop().wiring);
  expect(reply.map((w) => w.index)).toEqual([0, 1, 2, 3, 4, 5, 16]);
  // The page's palette (words.js) names each index as the engine does.
  const names = await page.evaluate(async () => (await import("/words.js")).PALETTE.map((c) => c.name));
  for (const w of reply) expect(names[w.index], `index ${w.index}`).toBe(w.name);
  const biteSearch = await page.locator('.pf-knob[data-i="1"]').evaluate((e) => e.classList.contains("search"));
  expect(biteSearch, "the Bite knob wears Bite's wiring (search or not)").toBe(!!reply[6].search);

  // Grit, at position 0, turned up past its notch and let go: the aimed
  // offer names Grit by its index, 4, not by its place on the panel.
  const before = await page.evaluate(() => window.__sent.length);
  const grit = page.locator('.pf-knob[data-i="0"]');
  await expect(grit).toHaveClass(/\bsearch\b/);
  const b = await grit.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 - 120, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate((n) => window.__sent.slice(n).filter((m) => m.type === "perform_offer" && m.control != null).length, before), { timeout: 10_000 }).toBe(1);
  const aimed = await page.evaluate((n) => window.__sent.slice(n).find((m) => m.type === "perform_offer" && m.control != null), before);
  expect(aimed.control).toBe(4);
  expect(aimed.sign).toBe(1);
  expect(errs).toEqual([]);
});

test("How it works lists every placed control, and explains the one last touched", async ({ page }) => {
  test.setTimeout(240_000);
  const errs = await boot(page);
  await openOnPerform(page, "Glass Pad");
  await page.locator(".pf-why-btn").click();
  const tabs = page.locator(".pf-how-tab");
  await expect(tabs).toHaveText(["Bright", "Snap", "Motion", "Body", "Grit", "Space"]);
  await page.locator(".pf-arrange").click();
  await row(page, "Round", false).locator(".pp-place").click();
  await row(page, "Lo-fi", false).locator(".pp-place").click();
  await page.keyboard.press("Escape");
  await expect(tabs).toHaveText(["Bright", "Snap", "Motion", "Body", "Grit", "Space", "Round", "Lo-fi"]);
  // Each says what it does and what it turns here.
  await tabs.filter({ hasText: "Round" }).click();
  await expect(page.locator(".pf-how-name")).toHaveText("Round");
  await expect(page.locator(".pf-how-ends")).toHaveText("hard · round");
  await expect(page.locator(".pf-how-hear")).toHaveText("A soft attack and few harmonics.");
  await expect(page.locator(".pf-how-here")).toContainText("Round");
  // Touching a control opens it there.
  await page.locator('.pf-knob[data-index="1"]').focus();
  await page.keyboard.press("ArrowUp");
  await expect(page.locator(".pf-how-name")).toHaveText("Snap");
  await expect(tabs.filter({ hasText: "Snap" })).toHaveAttribute("aria-pressed", "true");
  expect(errs).toEqual([]);
});

test("a row's mark never moves its name: every name starts at the same x", { tag: "@slow" }, async ({ page }) => {
  test.setTimeout(240_000);
  const errs = await boot(page);
  await openOnPerform(page, "Glass Pad");
  // From a settled sound: the six's background re-check is done first.
  await expect(page.locator(".pf-status")).not.toContainText("re-checking", { timeout: 120_000 });
  await page.locator(".pf-arrange").click();
  // While Haze is listened to, the palette holds every kind of row: a
  // control that turns, one that can't (a search control), one listening,
  // and the unplaced, with no mark. Read in the frame it shows.
  const seen = await watch(page, () => {
    const rows = [...document.querySelectorAll(".pp-row")];
    if (!rows.some((r) => r.querySelector(".pp-mark").dataset.mark === "listening")) return null;
    return rows.map((r) => ({ mark: r.querySelector(".pp-mark").dataset.mark || "", x: r.querySelector(".pp-name").getBoundingClientRect().left.toFixed(1) }));
  });
  await row(page, "Haze", false).locator(".pp-place").click();
  await expect.poll(async () => (await seen()).length, { timeout: 150_000 }).toBeGreaterThan(0);
  const read = () =>
    page.evaluate(() =>
      [...document.querySelectorAll(".pp-row")].map((r) => ({
        mark: r.querySelector(".pp-mark").dataset.mark || "",
        x: r.querySelector(".pp-name").getBoundingClientRect().left,
        w: r.querySelector(".pp-name").scrollWidth - r.querySelector(".pp-name").clientWidth,
      })),
    );
  const now = (await seen())[0];
  const marks = new Set(now.map((r) => r.mark));
  expect(marks.has("listening"), "a row listening").toBe(true);
  expect(marks.has(""), "a row with no mark").toBe(true);
  expect(marks.has("turns"), "a row that turns").toBe(true);
  const xs = new Set(now.map((r) => r.x));
  expect([...xs], "one x for every name").toHaveLength(1);
  // …and once Haze is measured, the same x.
  await expect(row(page, "Haze", true).locator(".pp-mark")).not.toHaveAttribute("data-mark", "listening", { timeout: 150_000 });
  const after = await read();
  expect(new Set(after.map((r) => r.x.toFixed(1)))).toEqual(xs);
  // No name is cut short.
  expect(after.every((r) => r.w <= 0)).toBe(true);
  expect(errs).toEqual([]);
});
