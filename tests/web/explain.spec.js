// Explain anything (Plan-005 task 10, RFC-006 §9): point at a control on
// PERFORM's panel and press ? (or press its ? chip), and a figure answers:
// the sound in hand rendered with the control at its center and turned
// (`explain` in worker.js, `WasmEngine::explain_render`), drawn as the
// measurement the control's direction is made of, with a sentence built from
// those numbers. From BRIGHT's figure, the lesson on filters renders the
// sound in hand through the grammar's lowpass (`explain_lesson`,
// `WasmEngine::lesson_filter`).
//
// Every explain request and reply is read through the fixture's tap, so what
// a figure says can be held against what the worker posted; a lesson reply
// is rewritten there when a test asks (`app.amend`), so a render that fails
// can be met on any sound.
const { test, expect, PERFORM_SEED } = require("./fixtures");

const INIT = `(() => {
  // The output level, read through an analyser on everything the app
  // connects to the destination (space_after_a_click.spec.js's tap).
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...rest) {
    const r = connect.call(this, dest, ...rest);
    if (typeof AudioDestinationNode !== "undefined" && dest instanceof AudioDestinationNode) {
      let a = this.context.__pwTap;
      if (!a) {
        a = this.context.createAnalyser();
        a.fftSize = 2048;
        this.context.__pwTap = a;
        window.__pwTap = a;
      }
      connect.call(this, a);
    }
    return r;
  };
  window.__pwPeakDb = () => {
    const a = window.__pwTap;
    if (!a) return -Infinity;
    const b = new Float32Array(a.fftSize);
    a.getFloatTimeDomainData(b);
    let peak = 0;
    for (const x of b) peak = Math.max(peak, Math.abs(x));
    return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
  };
})();`;
const peakDb = (page) => page.evaluate(() => window.__pwPeakDb());
const sounds = (page, message) => expect.poll(() => peakDb(page), { timeout: 15_000, intervals: [100], message }).toBeGreaterThan(-50);
const silent = (page, message) => expect.poll(() => peakDb(page), { timeout: 15_000, intervals: [100], message }).toBeLessThan(-80);

// What the page asks the engine for a figure or the lesson (and to cancel
// one): every request a type of which starts "explain".
const EXPLAIN = ["explain", "explain_lesson", "explain_cancel"];

// A finger held still long enough to be a long press, and a drag's pace.
const LONG_PRESS_MS = 900;
const DRAG_STEP_MS = 50;

// AURACLE_CPU_THROTTLE=4 runs the page and the engine worker at a quarter of
// the machine's speed (the fixture's boot), the slow laptop the figures must
// still answer on.
async function boot(page, app) {
  await page.addInitScript(INIT);
  await app.boot({ seed: PERFORM_SEED, random: PERFORM_SEED });
}

async function openOnPerform(app, name) {
  await app.level("patch");
  await app.openOnPerform(name);
}

const knob = (page, j) => page.locator(`.pf-knob[data-i="${j}"]`);
const say = (page) => page.locator(".xp.on .xp-say");

// The figure has its measurement: it is drawn (a drawn figure plays again
// when clicked), not measuring, and not waiting for the control's own.
function settled(page, app, timeout = 120_000) {
  return app.engine(
    (ms) =>
      page.waitForFunction(() => {
        const s = document.querySelector(".xp.on .xp-say")?.textContent || "";
        return s && !/measuring…|hasn’t been measured/.test(s) && !!document.querySelector(".xp.on .xp-fig[title]");
      }, null, { timeout: ms }),
    { ms: timeout },
  );
}

async function askAbout(page, app, j) {
  await knob(page, j).hover();
  await page.keyboard.press("?");
  await expect(page.locator(".xp.on")).toBeVisible();
  await settled(page, app);
}

// What the page says, held against what it was posted: the last reply for the
// control at panel position `j`, and the request it answers.
async function expectedSay(page, app, j) {
  const k = Number(await knob(page, j).getAttribute("data-index"));
  const reply = (await app.replies("explain", { where: { k } })).pop();
  const [req] = await app.sent({ type: "explain", token: reply.token });
  return { k, reply, req };
}

// The newest lesson request's token, and its reply once it has landed.
const lastLessonToken = async (app) => Math.max(...(await app.sent({ type: "explain_lesson" })).map((s) => s.token));
async function lessonReply(app, where, timeout) {
  let found = null;
  await app.engine(
    (ms) =>
      expect
        .poll(async () => {
          const token = await lastLessonToken(app);
          found = (await app.replies("explain_lesson", { where: { ...where, token } })).pop() || null;
          return found != null;
        }, { timeout: ms })
        .toBe(true),
    { ms: timeout },
  );
  return found;
}

// The lesson's filter, turned `n` times with `key`, and the engine's reply
// to the request for where it ends up. The lesson keeps one request out at a
// time and asks for the latest cutoff when that one lands, so the first
// request with a cutoff the page posts at or after the last key's own task
// is the one for the slider's final position: found by its place in the
// tap's log (`window.__tap.sent`), recorded as each key arrives, not by the
// clock, and its reply by its token. The newest request's reply, read as it
// landed, was on a slow runner the reply to an earlier key (#185).
async function turnLesson(page, app, key, n, timeout) {
  await page.evaluate(() => {
    window.__xlKeys = [];
    if (window.__xlKeysOn) return;
    window.__xlKeysOn = true;
    document.addEventListener("keydown", (e) => {
      if (e.target && e.target.closest && e.target.closest(".xl-filter")) window.__xlKeys.push(window.__tap.sent.length);
    }, { capture: true });
  });
  for (let i = 0; i < n; i++) await page.keyboard.press(key);
  await expect.poll(() => page.evaluate(() => window.__xlKeys.length), { message: "every key reached the filter" }).toBe(n);
  let found = null;
  await app.engine(
    (ms) =>
      expect
        .poll(async () => {
          const req = await page.evaluate(() => {
            const from = window.__xlKeys[window.__xlKeys.length - 1];
            const q = window.__tap.sent.slice(from).find((s) => s.type === "explain_lesson" && s.m.cutoff != null);
            return q ? q.m.token : null;
          });
          if (req == null) return false;
          found = (await app.replies("explain_lesson", { where: { token: req } })).pop() || null;
          return found != null;
        }, { timeout: ms, message: "the lesson's reply for the filter where the keys left it" })
        .toBe(true),
    { ms: timeout },
  );
  return found;
}

test("each control on the panel opens its figure, by ?, by its chip, and from the next one's", async ({ page, app }) => {
  await boot(page, app);
  await openOnPerform(app, "Reese");
  const names = ["Bright", "Snap", "Motion", "Body", "Grit", "Space"];
  for (const [j, name] of names.entries()) {
    await askAbout(page, app, j);
    await expect(page.locator(".xp.on .xp-title")).toHaveText(`${name} · what it does`);
    await expect(page.locator(".xp.on .xp-sw button[aria-pressed='true']")).toHaveText(name);
    const fig = page.locator(".xp.on .xp-fig");
    await expect(fig).toHaveAttribute("role", "img");
    expect(await fig.getAttribute("aria-label")).toContain(`${name.toUpperCase()} on Reese`);
    // The figure was asked of the engine for this control, on this sound.
    const { req, reply } = await expectedSay(page, app, j);
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
  await app.level("evolve");
  await expect(page.locator(".xp.on")).toHaveCount(0);
});

test("every control in the palette opens its figure", { tag: "@slow" }, async ({ page, app }) => {
  test.setTimeout(190_000); // about 81 to 92 s on CI: eighteen figures, each measured
  await boot(page, app);
  await openOnPerform(app, "Glass Pad");
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
      await askAbout(page, app, j);
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
});

test("a control asked about before it is measured answers once it is, a search control too", async ({ page, app }) => {
  await boot(page, app);
  await openOnPerform(app, "Glass Pad");
  // Placed now, asked at once: their measurement lands with the figure open.
  // On Glass Pad, with these five beside BRIGHT, nothing turns SWAY: a
  // measurement that changes no knob still changes what is said.
  const row = (name, placed) => page.locator(`.pp-row${placed ? ".on" : ":not(.on)"}`, { has: page.locator(".pp-name", { hasText: new RegExp(`^${name}$`) }) });
  await page.locator(".pf-arrange").click();
  for (const n of ["Snap", "Motion", "Body", "Grit", "Space"]) await row(n, true).locator(".pp-hide").click();
  for (const n of ["Sway", "Distance", "Haze", "Bite", "Lo-fi"]) await row(n, false).locator(".pp-place").click();
  await page.keyboard.press("Escape");
  await askAbout(page, app, 1);
  await expect(page.locator(".xp.on .xp-title")).toHaveText("Sway · what it does");
  // Whatever the measurement found (it turns, or nothing here does), the
  // answer says it, from the wiring that landed and the engine's render.
  const said = await say(page).textContent();
  expect(said).toMatch(/^(Turned (to|\d+% toward) (fixed|swaying), |Nothing here turns SWAY: )/);
  expect(said).toMatch(/between 0\.5 and 2\sHz/);
});

test("a figure says what the worker posted, and follows its control", async ({ page, app }) => {
  await boot(page, app);
  await openOnPerform(app, "Reese");
  await askAbout(page, app, 0);
  const check = async () => {
    const { reply, req } = await expectedSay(page, app, 0);
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
    // The sentence is read where it stands, a live region; the figure's own
    // text says what is drawn, and does not repeat it.
    await expect(say(page)).toHaveAttribute("role", "status");
    expect(((await page.locator(".xp.on .xp-fig").getAttribute("aria-label")) || "").replace(/\u00a0/g, " ")).not.toContain(text);
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
  const sounding = (await app.sent({ type: "explain" })).pop();
  expect(sounding.tree).toBe(first.req.tree);
  expect(first.req.turned).not.toEqual(first.req.made);
  // Turn BRIGHT with the keys: the open figure follows, measured again.
  const turned = await app.now();
  await knob(page, 0).focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowUp");
  await app.reply("explain", { after: turned, timeout: 60_000 });
  await app.engine((timeout) => expect(say(page)).toHaveText(/^Turned 20% toward bright,/, { timeout }), { ms: 60_000 });
  const second = await check();
  expect(second.req.token).toBeGreaterThan(first.req.token);
  expect(second.req.turned).not.toEqual(first.req.turned);
});

test("the lesson on filters is the sound in hand: another sound, another lesson", async ({ page, app }) => {
  await boot(page, app);
  const lessonOf = async (name) => {
    await openOnPerform(app, name);
    await askAbout(page, app, 0);
    await page.locator(".xp.on .xp-learn").click();
    await expect(page.locator(".xl.on")).toBeVisible();
    await expect(page.locator(".xl.on .xl-h")).toHaveText("A sound has a shape");
    await expect(page.locator(".xl.on .xl-body p").first()).toContainText(`This is ${name},`);
    const r = await lessonReply(app, { cutoff: false }, 60_000);
    const [q] = await app.sent({ type: "explain_lesson", token: r.token });
    const plain = { bands: r.data.portrait.bands, facts: r.data.portrait.facts, tree: q.tree, buffer: r.buffer && r.buffer.bytes };
    expect(plain.buffer).toBeGreaterThan(0);
    // The filter's step: a lowpass on this sound, its cutoff where the
    // player puts it, its response the engine's.
    await page.locator(".xl.on .xl-next").click();
    await expect(page.locator(".xl.on .xl-h")).toHaveText("A filter lets some through");
    const filt = page.locator(".xl.on .xl-filter");
    // The lesson holds focus itself, so Space is its; the slider is a Tab
    // or a click away.
    await expect(page.locator(".xl.on .xl-panel")).toBeFocused();
    await filt.focus();
    // Down from 12 kHz to about 400 Hz, a key at a time, and the reply for
    // where it ends up.
    const f = await turnLesson(page, app, "ArrowLeft", 30, 90_000);
    const filtered = { bands: f.data.portrait.bands, facts: f.data.portrait.facts, cutoff_hz: f.data.cutoff_hz, response: f.data.response };
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
});

test("under reduced motion a figure is drawn whole at once, and holds", async ({ page, app }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await boot(page, app);
  await openOnPerform(app, "Reese");
  const frame = () => page.locator(".xp.on .xp-fig").evaluate((c) => c.toDataURL());
  // MOTION's figure runs the held note at its real rate; still, it is the
  // whole track, from the first frame drawn, and nothing redraws it.
  await askAbout(page, app, 2);
  const a = await frame();
  await app.quiet();
  expect(await frame()).toBe(a);
  await page.keyboard.press("Escape");
  // And with motion, it runs.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await askAbout(page, app, 2);
  const c = await frame();
  await expect.poll(frame).not.toBe(c);
});

test("asking about a control moves no label", async ({ page, app }) => {
  await boot(page, app);
  await openOnPerform(app, "Reese");
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
  await settled(page, app);
  expect(await labels()).toEqual(at);
  await page.locator(".xp.on .xp-sw button", { hasText: "Motion" }).click();
  await settled(page, app);
  expect(await labels()).toEqual(at);
  await page.keyboard.press("Escape");
  expect(await labels()).toEqual(at);
});

test("a turn with an answer open asks the engine once it rests, not on every move", { tag: "@quarantine", annotation: { type: "issue", description: "#336" } }, async ({ page, app }) => {
  await boot(page, app);
  await openOnPerform(app, "Reese");
  await askAbout(page, app, 0);
  const before = await app.now();
  // Three seconds of drag on BRIGHT, up and down, a move every 50 ms.
  const b = await knob(page, 0).boundingBox();
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 3;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 0; i < 60; i++) {
    await page.mouse.move(x, y - 40 * Math.sin((i / 60) * Math.PI * 2) - i * 0.3);
    await page.waitForTimeout(DRAG_STEP_MS);
  }
  await page.mouse.up();
  await settled(page, app);
  // Nothing more is asked once it has answered.
  await app.quiet();
  const asked = (await app.sent({ type: "explain" }, { after: before })).length;
  expect(asked).toBeGreaterThanOrEqual(1);
  expect(asked).toBeLessThanOrEqual(2);
});

test("Space plays with an answer open and in the lesson, after a click on its buttons too", async ({ page, app }) => {
  await boot(page, app);
  await openOnPerform(app, "Reese");
  await askAbout(page, app, 0);
  // A click on another control's name leaves no focus on it: Space plays.
  await page.locator(".xp.on .xp-sw button", { hasText: "Snap" }).click();
  await expect(page.locator(".xp.on .xp-title")).toHaveText("Snap · what it does");
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("BUTTON");
  await silent(page, "quiet before Space");
  await page.keyboard.press(" ");
  await sounds(page, "Space plays with the answer open");
  await page.keyboard.press(" ");
  await silent(page, "Space again stops it");
  // The lesson: NEXT clicked, Space plays the step's sound and does not step.
  await page.locator(".xp.on .xp-sw button", { hasText: "Bright" }).click();
  await settled(page, app);
  await page.locator(".xp.on .xp-learn").click();
  await app.engine((timeout) => expect(page.locator(".xl.on .xl-play")).toBeEnabled({ timeout }), { ms: 60_000 });
  await page.locator(".xl.on .xl-next").click();
  await expect(page.locator(".xl.on .xl-count")).toHaveText("2 of 3");
  await app.engine((timeout) => expect(page.locator(".xl.on .xl-play")).toBeEnabled({ timeout }), { ms: 60_000 });
  await page.keyboard.press(" ");
  await sounds(page, "Space plays the filtered sound");
  await expect(page.locator(".xl.on .xl-count")).toHaveText("2 of 3");
  await expect(page.locator(".xl.on .xl-play")).toHaveText("Stop");
  // Focus on NEXT itself: Space is still the lesson's, Enter steps on.
  await page.locator(".xl.on .xl-next").focus();
  await page.keyboard.press(" ");
  await expect(page.locator(".xl.on .xl-play")).toHaveText("Play Reese through it");
  await expect(page.locator(".xl.on .xl-count")).toHaveText("2 of 3");
  await page.keyboard.press("Enter");
  await expect(page.locator(".xl.on .xl-count")).toHaveText("3 of 3");
});

test("the lesson says why a render failed, draws nothing for it, and never plays the sound without the filter as through it", async ({ page, app }) => {
  await boot(page, app);
  await openOnPerform(app, "Reese");
  // Every filtered render refused by the check: said, not drawn, not played.
  await app.amend({ type: "explain_lesson", cutoff: true }, { "data.portrait": null, "data.error": "vet", buffer: null });
  await askAbout(page, app, 0);
  await page.locator(".xp.on .xp-learn").click();
  await app.engine((timeout) => expect(page.locator(".xl.on .xl-play")).toBeEnabled({ timeout }), { ms: 60_000 });
  await page.locator(".xl.on .xl-next").click();
  await app.engine(
    (timeout) =>
      expect(page.locator(".xl.on .xl-trouble")).toHaveText("Through the filter at this cutoff, Reese doesn’t pass the vet, so it isn’t played: try another cutoff.", { timeout }),
    { ms: 60_000 },
  );
  await expect(page.locator(".xl.on .xl-play")).toBeDisabled();
  await page.keyboard.press(" ");
  // Nothing plays.
  await app.quiet();
  expect(await peakDb(page)).toBeLessThan(-80);
  // A drag still asks: another cutoff may render.
  const before = await app.now();
  await page.locator(".xl.on .xl-filter").focus();
  await page.keyboard.press("End");
  await expect.poll(async () => (await app.sent({ type: "explain_lesson" }, { after: before })).length).toBeGreaterThan(0);
  // And when it renders after the sound, there is no room in it: said, and played.
  await app.unamend();
  await app.amend({ type: "explain_lesson", cutoff: true }, { "data.placement": "after" });
  await page.keyboard.press("ArrowLeft");
  await app.engine(
    (timeout) =>
      expect(page.locator(".xl.on .xl-trouble")).toHaveText("Reese has no room for one more module, so this filter goes after it, at one cutoff for every note.", { timeout }),
    { ms: 60_000 },
  );
  await expect(page.locator(".xl.on .xl-play")).toBeEnabled();
  await page.keyboard.press("Escape");
  // The sound itself failing: said, nothing to play, and nothing more asked.
  await app.unamend();
  await app.amend({ type: "explain_lesson", cutoff: false }, { "data.portrait": null, "data.error": "silent", buffer: null });
  await askAbout(page, app, 0);
  await page.locator(".xp.on .xp-learn").click();
  await app.engine((timeout) => expect(page.locator(".xl.on .xl-trouble")).toHaveText("Reese is silent on the phrase, so the lesson has nothing to show.", { timeout }), { ms: 60_000 });
  await expect(page.locator(".xl.on .xl-play")).toBeDisabled();
  const asked = await app.now();
  await page.locator(".xl.on .xl-next").click();
  await app.quiet();
  expect(await app.sent({ type: "explain_lesson" }, { after: asked })).toEqual([]);
  await expect(page.locator(".xl.on .xl-play")).toBeDisabled();
});

test("? opens ⌘K's list once the pointer has left a control a mouse turned, and never over an open answer", async ({ page, app }) => {
  await boot(page, app);
  await openOnPerform(app, "Reese");
  // Turn SNAP with the mouse: it keeps focus, but not keyboard focus.
  const b = await knob(page, 1).boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 3);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 3 - 20, { steps: 5 });
  await page.mouse.up();
  await page.mouse.move(5, 5);
  await page.keyboard.press("?");
  await expect(page.locator("#cmdk")).toBeVisible();
  await expect(page.locator(".xp.on")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.locator("#cmdk")).toBeHidden();
  // An answer open, the pointer elsewhere: ? leaves the list closed.
  await askAbout(page, app, 0);
  await page.mouse.move(5, 5);
  await page.keyboard.press("?");
  await expect(page.locator(".xp.on")).toBeVisible();
  await expect(page.locator("#cmdk")).toBeHidden();
});

test("a long press on a touch screen opens the answer, and a turn does not", async ({ page, app }) => {
  await boot(page, app);
  await openOnPerform(app, "Reese");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  const b = await knob(page, 2).boundingBox();
  const x = Math.round(b.x + b.width / 2);
  const y = Math.round(b.y + b.height / 3);
  // A finger that moves is a turn: no answer.
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - 12 }] });
  await page.waitForTimeout(LONG_PRESS_MS);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await app.quiet();
  await expect(page.locator(".xp.on")).toHaveCount(0);
  // Held still: the answer opens.
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await page.waitForTimeout(LONG_PRESS_MS);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(page.locator(".xp.on .xp-title")).toHaveText("Motion · what it does");
});

test("with a bank of faces, BRIGHT's figure and the lesson draw the sound's face", async ({ page, app }) => {
  await boot(page, app);
  await openOnPerform(app, "Reese");
  // Four faces drawn in the bank: there is a mean and a spread to draw against.
  await app.engine((timeout) => page.waitForFunction(() => document.querySelectorAll(".face-slot img.face").length >= 4, null, { timeout }), { ms: 120_000 });
  await askAbout(page, app, 0);
  await expect(page.locator(".xp.on .xp-fig")).toHaveAttribute("aria-label", /its face, low at the base/);
  // The portrait carries the render's own face, beside its bands.
  const face = (await app.replies("explain", { where: { k: 0 } })).pop().made.portrait.face;
  expect(typeof face).toBe("string");
  expect(face.length).toBeGreaterThan(100);
  await page.locator(".xp.on .xp-learn").click();
  await app.engine((timeout) => expect(page.locator(".xl.on .xl-body p").first()).toHaveText(/^This is Reese’s face: /, { timeout }), { ms: 60_000 });
  await expect(page.locator(".xl.on .xl-shape")).toHaveAttribute("aria-label", "Reese’s face, low at the base");
});

test("with no answer or lesson open, nothing asks the engine for a figure, and putting one away cancels its wait", async ({ page, app }) => {
  await boot(page, app);
  await openOnPerform(app, "Reese");
  const OFFER_MS = await app.offerBudget({ waits: 1 });
  // Nothing open: an Offer grows with no explain request beside it.
  await page.locator(".pf-pad", { hasText: /^(Offer|Next)$/ }).click();
  await expect(page.locator(".pf-offer")).toHaveClass(/\bready\b/, { timeout: OFFER_MS });
  await app.quiet();
  expect(await app.sent({ type: EXPLAIN })).toEqual([]);
  // An answer opened and put away at once: its request, if still waiting,
  // is cancelled, answered, and nothing more is sent while nothing is open.
  await knob(page, 0).hover();
  await page.keyboard.press("?");
  await page.keyboard.press("Escape");
  await expect(page.locator(".xp.on")).toHaveCount(0);
  const away = await app.now();
  await page.mouse.move(5, 5);
  // Watched for two seconds, as it always was.
  await app.quiet(2_000);
  expect(await app.sent({ type: "explain" }, { after: away })).toEqual([]);
  // Every explain request got its reply (rendered or cancelled).
  const replies = (await app.replies("explain")).map((m) => m.token);
  for (const m of await app.sent({ type: "explain" })) expect(replies).toContain(m.token);
});
