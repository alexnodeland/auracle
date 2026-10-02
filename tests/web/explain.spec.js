// Explain anything (Plan-005 task 10, RFC-006 §9): point at a control on
// PERFORM's panel and press ? (or press its ? chip), and a figure answers:
// the sound in hand rendered with the control at its center and turned
// (`explain` in worker.js, `WasmEngine::explain_render`), drawn as the
// measurement the control's direction is made of, with a sentence built from
// those numbers. From BRIGHT's figure, the lesson on filters renders the
// sound in hand through the grammar's lowpass (`explain_lesson`,
// `WasmEngine::lesson_filter`).
//
// The spec reaches the engine worker by wrapping `Worker` before `main.js`
// runs, as the other PERFORM specs do, and keeps every explain request and
// reply, so what a figure says can be held against what the worker posted.
const { test, expect } = require("@playwright/test");

const INIT = `(() => {
  const Orig = window.Worker;
  const sent = (window.__xsent = []);
  const got = (window.__xgot = []);
  function Wrapped(url, opts) {
    const w = new Orig(url, opts);
    if (/worker\\.js/.test(String(url))) {
      const post = w.postMessage.bind(w);
      w.postMessage = (m, t) => {
        if (m && /^explain/.test(m.type)) sent.push(JSON.parse(JSON.stringify(m)));
        return post(m, t);
      };
      w.addEventListener("message", (e) => {
        const d = e.data;
        if (!d || !/^explain/.test(d.type)) return;
        got.push(JSON.parse(JSON.stringify({ ...d, buffer: d.buffer ? d.buffer.length : null })));
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
  await page.locator('.viewtab[data-view="play"]').click();
  await page.locator('.bf[data-f="preset"]').click();
  await page.locator(".bank-item", { hasText: name }).first().click();
  await page.waitForFunction((n) => (document.getElementById("rack-subject")?.textContent || "").includes(n), name, { timeout: 90_000 });
  await page.locator('.viewtab[data-view="perform"]').click();
  await expect(page.locator(".pf-name")).toHaveText(name, { timeout: 30_000 });
  await expect(page.locator(".pf-status")).toContainText("controls reach", { timeout: 120_000 });
}

const knob = (page, j) => page.locator(`.pf-knob[data-i="${j}"]`);
const say = (page) => page.locator(".xp.on .xp-say");

// The figure has its measurement: it is drawn (a drawn figure plays again
// when clicked), not listening, and not waiting for the control's own.
async function settled(page, timeout = 120_000) {
  await page.waitForFunction(() => {
    const s = document.querySelector(".xp.on .xp-say")?.textContent || "";
    return s && !/listening…|hasn’t been measured/.test(s) && !!document.querySelector(".xp.on .xp-fig[title]");
  }, null, { timeout });
}

async function askAbout(page, j) {
  await knob(page, j).hover();
  await page.keyboard.press("?");
  await expect(page.locator(".xp.on")).toBeVisible();
  await settled(page);
}

// What the page says, held against what it was posted: the sentence words.js
// builds from the last reply for the control at panel position `j`.
async function expectedSay(page, j) {
  return page.evaluate(async (j) => {
    const words = await import("/words.js");
    const knob = document.querySelector(`.pf-knob[data-i="${j}"]`);
    const k = Number(knob.dataset.index);
    const got = window.__xgot.filter((m) => m.type === "explain" && m.k === k);
    const reply = got[got.length - 1];
    const req = window.__xsent.find((m) => m.type === "explain" && m.token === reply.token);
    return { k, reply, req, words: { PALETTE: words.PALETTE } };
  }, j);
}

test("each control on the panel opens its figure, by ?, by its chip, and from the next one's", async ({ page }) => {
  test.setTimeout(400_000);
  const errs = await boot(page);
  await openOnPerform(page, "Reese");
  const names = ["Bright", "Snap", "Motion", "Body", "Grit", "Space"];
  for (const [j, name] of names.entries()) {
    await askAbout(page, j);
    await expect(page.locator(".xp.on .xp-title")).toHaveText(`${name} · what it does`);
    await expect(page.locator(".xp.on .xp-sw button[aria-pressed='true']")).toHaveText(name);
    const fig = page.locator(".xp.on .xp-fig");
    await expect(fig).toHaveAttribute("role", "img");
    expect(await fig.getAttribute("aria-label")).toContain(`${name.toUpperCase()} on Reese`);
    // The figure was asked of the engine for this control, on this sound.
    const { req, reply } = await expectedSay(page, j);
    expect(req.k).toBe(j);
    expect(reply.made.portrait.bands.length).toBe(40);
    await page.keyboard.press("Escape");
    await expect(page.locator(".xp.on")).toHaveCount(0);
  }
  // The chip beside a control asks too.
  await knob(page, 1).hover();
  await expect(page.locator(".xp-chip.on")).toBeVisible();
  await page.locator(".xp-chip").click();
  await expect(page.locator(".xp.on .xp-title")).toHaveText("Snap · what it does");
  // Every control is a tap, or an arrow, away.
  await page.locator(".xp.on .xp-sw button", { hasText: "Space" }).click();
  await expect(page.locator(".xp.on .xp-title")).toHaveText("Space · what it does");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".xp.on .xp-title")).toHaveText("Bright · what it does");
  // A view change puts it away: it belongs to where it was asked.
  await page.locator('.viewtab[data-view="evolve"]').click();
  await expect(page.locator(".xp.on")).toHaveCount(0);
  expect(errs).toEqual([]);
});

test("every control in the palette opens its figure", { tag: "@slow" }, async ({ page }) => {
  test.setTimeout(900_000);
  const errs = await boot(page);
  await openOnPerform(page, "Glass Pad");
  const row = (name, placed) => page.locator(`.pp-row${placed ? ".on" : ":not(.on)"}`, { has: page.locator(".pp-name", { hasText: new RegExp(`^${name}$`) }) });
  const arrange = async (hide, place) => {
    await page.locator(".pf-arrange").click();
    await expect(page.locator(".pp")).toBeVisible();
    for (const n of hide) await row(n, true).locator(".pp-hide").click();
    for (const n of place) await row(n, false).locator(".pp-place").click();
    await page.keyboard.press("Escape");
  };
  const askAll = async (names) => {
    for (const name of names) {
      const j = await page.evaluate((n) => [...document.querySelectorAll(".pf-knob[data-index]")].findIndex((k) => k.getAttribute("aria-label") === n), name);
      expect(j).toBeGreaterThanOrEqual(0);
      await askAbout(page, j);
      await expect(page.locator(".xp.on .xp-title")).toHaveText(`${name} · what it does`);
      await page.keyboard.press("Escape");
    }
  };
  await askAll(["Bright", "Snap", "Motion", "Body", "Grit", "Space"]);
  const second = ["Warmth", "Air", "Thump", "Heft", "Punch", "Round", "Throb"];
  await arrange(["Snap", "Motion", "Body", "Grit", "Space"], second);
  await askAll(second);
  const third = ["Sway", "Distance", "Haze", "Bite", "Lo-fi"];
  await arrange(second, third);
  await askAll(third);
  expect(errs).toEqual([]);
});

test("a control asked about before it is measured answers once it is, a search control too", async ({ page }) => {
  test.setTimeout(400_000);
  const errs = await boot(page);
  await openOnPerform(page, "Glass Pad");
  // Placed now, asked at once: their measurement lands with the figure open.
  // On Glass Pad, with these five beside BRIGHT, nothing turns SWAY: a
  // measurement that changes no knob still changes what is said.
  const row = (name, placed) => page.locator(`.pp-row${placed ? ".on" : ":not(.on)"}`, { has: page.locator(".pp-name", { hasText: new RegExp(`^${name}$`) }) });
  await page.locator(".pf-arrange").click();
  for (const n of ["Snap", "Motion", "Body", "Grit", "Space"]) await row(n, true).locator(".pp-hide").click();
  for (const n of ["Sway", "Distance", "Haze", "Bite", "Lo-fi"]) await row(n, false).locator(".pp-place").click();
  await page.keyboard.press("Escape");
  await askAbout(page, 1);
  await expect(page.locator(".xp.on .xp-title")).toHaveText("Sway · what it does");
  // Whatever the measurement found (it turns, or nothing here does), the
  // answer says it, from the wiring that landed and the engine's render.
  const said = await say(page).textContent();
  expect(said).toMatch(/^(Turned (to|\d+% toward) (fixed|swaying), |Nothing here turns SWAY: )/);
  expect(said).toMatch(/between 0\.5 and 2\sHz/);
  expect(errs).toEqual([]);
});

test("a figure says what the worker posted, and follows its control", async ({ page }) => {
  test.setTimeout(400_000);
  const errs = await boot(page);
  await openOnPerform(page, "Reese");
  await askAbout(page, 0);
  const check = async () => {
    const { reply, req } = await expectedSay(page, 0);
    // The sentence's measurement, built by the app's own words from the
    // reply alone (the turn it names is the page's: the request's).
    const text = (await say(page).textContent()).replace(/\u00a0/g, " ");
    const sentence = await page.evaluate(async ({ reply, req }) => {
      const w = await import("/words.js");
      const c = w.PALETTE[req.k];
      const p = (x) => (x && !x.error ? x.portrait.facts : null);
      const m = /^Turned (to \w+|(\d+)% toward (\w+)),/.exec(document.querySelector(".xp.on .xp-say").textContent);
      const at = !m ? 0 : m[2] ? (Number(m[2]) / 100) * (m[3] === c.high ? 1 : -1) : m[1] === `to ${c.high}` ? 1 : -1;
      return w.explainSays(c, { at, knobs: [] }, p(reply.made), p(reply.turned)).replace(/\u00a0/g, " ");
    }, { reply, req });
    expect(text.startsWith(sentence)).toBe(true);
    expect((await page.locator(".xp.on .xp-fig").getAttribute("aria-label")).replace(/\u00a0/g, " ")).toContain(text);
    // The numbers are the engine's: BRIGHT's center, made and turned.
    const hz = await page.evaluate(async (f) => {
      const w = await import("/words.js");
      return [w.hzWord(f[0]), w.hzWord(f[1])];
    }, [reply.made.portrait.facts.centroid_hz, reply.turned.portrait.facts.centroid_hz]);
    expect(text).toContain(`from ${hz[0]} to ${hz[1]}`);
    return { reply, req };
  };
  const first = await check();
  expect(await say(page).textContent()).toMatch(/^Turned to bright,/);
  // Asked about the sound in hand: the performed state, BRIGHT at its center
  // and at a full turn.
  const sounding = await page.evaluate(() => window.__xsent.filter((m) => m.type === "explain").pop());
  expect(sounding.tree).toBe(first.req.tree);
  expect(first.req.turned).not.toEqual(first.req.made);
  // Turn BRIGHT with the keys: the open figure follows, measured again.
  const before = await page.evaluate(() => window.__xgot.length);
  await knob(page, 0).focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowUp");
  await page.waitForFunction((n) => window.__xgot.length > n, before, { timeout: 60_000 });
  await expect(say(page)).toHaveText(/^Turned 20% toward bright,/, { timeout: 60_000 });
  const second = await check();
  expect(second.req.token).toBeGreaterThan(first.req.token);
  expect(second.req.turned).not.toEqual(first.req.turned);
  expect(errs).toEqual([]);
});

test("the lesson on filters is the sound in hand: another sound, another lesson", async ({ page }) => {
  test.setTimeout(400_000);
  const errs = await boot(page);
  const lessonOf = async (name) => {
    await openOnPerform(page, name);
    await askAbout(page, 0);
    await page.locator(".xp.on .xp-learn").click();
    await expect(page.locator(".xl.on")).toBeVisible();
    await expect(page.locator(".xl.on .xl-h")).toHaveText("A sound has a shape");
    await expect(page.locator(".xl.on .xl-body p").first()).toContainText(`This is ${name},`);
    await page.waitForFunction(() => window.__xgot.some((m) => m.type === "explain_lesson" && m.cutoff == null && m.token === Math.max(...window.__xsent.filter((s) => s.type === "explain_lesson").map((s) => s.token))), null, { timeout: 60_000 });
    const plain = await page.evaluate(() => {
      const r = window.__xgot.filter((m) => m.type === "explain_lesson" && m.cutoff == null).pop();
      const q = window.__xsent.find((s) => s.type === "explain_lesson" && s.token === r.token);
      return { bands: r.data.portrait.bands, facts: r.data.portrait.facts, tree: q.tree, buffer: r.buffer };
    });
    expect(plain.buffer).toBeGreaterThan(0);
    // The filter's step: a lowpass on this sound, its cutoff where the
    // player puts it, its response the engine's.
    await page.locator(".xl.on .xl-next").click();
    await expect(page.locator(".xl.on .xl-h")).toHaveText("A filter lets some through");
    const filt = page.locator(".xl.on .xl-filter");
    await expect(filt).toBeFocused();
    // Down from 12 kHz to about 400 Hz, a key at a time.
    for (let i = 0; i < 30; i++) await page.keyboard.press("ArrowLeft");
    await page.waitForFunction(() => {
      const last = Math.max(...window.__xsent.filter((s) => s.type === "explain_lesson").map((s) => s.token));
      const r = window.__xgot.find((m) => m.type === "explain_lesson" && m.token === last);
      return r && r.cutoff != null;
    }, null, { timeout: 90_000 });
    const filtered = await page.evaluate(() => {
      const last = Math.max(...window.__xsent.filter((s) => s.type === "explain_lesson").map((s) => s.token));
      const r = window.__xgot.find((m) => m.type === "explain_lesson" && m.token === last);
      return { bands: r.data.portrait.bands, facts: r.data.portrait.facts, cutoff_hz: r.data.cutoff_hz, response: r.data.response };
    });
    const text = await filt.getAttribute("aria-valuetext");
    const want = await page.evaluate(async (hz) => (await import("/words.js")).cutoffWord(hz), filtered.cutoff_hz);
    expect(text).toBe(want);
    // Above the cutoff the filter takes the top away: where the sound has
    // something an octave over the cutoff, the filtered render has less of it
    // against its lows, and its center and its top both come down.
    const lo = 35;
    const hi = 14000;
    const centre = (i) => lo * Math.pow(hi / lo, (i + 0.5) / 40);
    const above = plain.bands.map((d, i) => [d, filtered.bands[i], centre(i)]).filter(([d, , hz]) => hz > 2 * filtered.cutoff_hz && d > -48);
    expect(above.length).toBeGreaterThan(0);
    for (const [d, f] of above) expect(f).toBeLessThan(d - 3);
    expect(filtered.facts.centroid_hz).toBeLessThan(plain.facts.centroid_hz);
    expect(filtered.response[0]).toBeGreaterThan(-1);
    expect(filtered.response[39]).toBeLessThan(-12);
    await page.keyboard.press("Escape");
    await expect(page.locator(".xl.on")).toHaveCount(0);
    return plain;
  };
  const reese = await lessonOf("Reese");
  const glass = await lessonOf("Glass Pad");
  expect(glass.tree).not.toBe(reese.tree);
  expect(glass.bands).not.toEqual(reese.bands);
  expect(errs).toEqual([]);
});

test("under reduced motion a figure is drawn whole at once, and holds", async ({ page }) => {
  test.setTimeout(400_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errs = await boot(page);
  await openOnPerform(page, "Reese");
  const frames = async () => {
    const a = await page.locator(".xp.on .xp-fig").evaluate((c) => c.toDataURL());
    await page.waitForTimeout(500);
    const b = await page.locator(".xp.on .xp-fig").evaluate((c) => c.toDataURL());
    return [a, b];
  };
  // MOTION's figure runs the held note at its real rate; still, it is the
  // whole track, from the first frame drawn.
  await askAbout(page, 2);
  const [a, b] = await frames();
  expect(a).toBe(b);
  await page.keyboard.press("Escape");
  // And with motion, it runs.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await askAbout(page, 2);
  const [c, d] = await frames();
  expect(c).not.toBe(d);
  expect(errs).toEqual([]);
});

test("asking about a control moves no label", async ({ page }) => {
  test.setTimeout(400_000);
  const errs = await boot(page);
  await openOnPerform(page, "Reese");
  const labels = () =>
    page.evaluate(() =>
      [...document.querySelectorAll(".pf-knob .pf-k-name, .bank-item .bi-name, .bank-item .name")].map((n) => {
        const r = n.getBoundingClientRect();
        return [n.textContent, Math.round(r.x * 10) / 10, Math.round(r.y * 10) / 10];
      }),
    );
  const at = await labels();
  expect(at.length).toBeGreaterThan(5);
  await knob(page, 0).hover();
  await expect(page.locator(".xp-chip.on")).toBeVisible();
  expect(await labels()).toEqual(at);
  await page.keyboard.press("?");
  await settled(page);
  expect(await labels()).toEqual(at);
  await page.locator(".xp.on .xp-sw button", { hasText: "Motion" }).click();
  await settled(page);
  expect(await labels()).toEqual(at);
  await page.keyboard.press("Escape");
  expect(await labels()).toEqual(at);
  expect(errs).toEqual([]);
});
