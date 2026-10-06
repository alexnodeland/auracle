// PATCH editing under a slow engine: the order of edits, and what the rack
// draws while they are on their way.
//
// Every one of these is a race, and every one is lost only when the engine
// worker is slow — which on a loaded machine is most of the time, and in a
// fresh headless browser almost never. So the worker is made slow for real:
// the fixture serves `worker.js` with a listener prepended that busy-waits
// before the engine's own handler sees chosen request types (`app.busy`). The
// worker stays serial, requests queue behind each other exactly as they do
// when the machine is busy, and nothing in apps/web is reached into except
// through the page. The slowdown is switched on only once the patch is on the
// bench, so boot runs at full speed.
//
// Each edit (`edit_*` posted to the worker) is matched to its last reply (a
// `bench`, or `edit_rejected`) by the request number the reply carries back,
// through the fixture's tap; the lane has settled when every edit sent has
// had it (patch_page.js `settled`). A test here run against the code before
// its fix watches it fail, as long as that code numbers its requests.
const { test, expect, openKeys, openCatalog } = require("./fixtures");
const patchPage = require("./patch_page.js");
const { settled } = patchPage;

// A player's pace: between two gestures in quick succession, and between the
// steps of a slow drag or of arrow-key nudges (slower than the engine answers
// a nudge, so its replies land between presses).
const GESTURE_GAP_MS = 120;
const REGRAB_MS = 250;
const SLOW_STEP_MS = 250;

/** Open a library preset on the bench, and wait until the rack is its and
 *  the lane has settled. */
async function openPreset(app, name) {
  await patchPage.openPreset(app, name);
  await expect(app.page.locator("#rack-svg .knob-hit").first()).toBeVisible();
  await settled(app);
}

/** Continuous knobs on the rack, with where they are on screen. */
async function knobs(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("#rack-svg g[data-addr]")]
      .filter((g) => g.querySelector(":scope > .knob-hit"))
      .map((g) => {
        const r = g.querySelector(":scope > .knob-hit").getBoundingClientRect();
        return {
          addr: g.dataset.addr,
          value: Number(g.getAttribute("aria-valuenow")),
          text: g.querySelector(".knob-value")?.textContent || "",
          x: r.x + r.width / 2,
          y: r.y + r.height / 2,
          visible: r.width > 0 && r.y > 0 && r.bottom < window.innerHeight && r.x > 0 && r.right < window.innerWidth,
        };
      })
      .filter((k) => k.visible),
  );
}

/** Drag a knob up by `dy` pixels in `steps` moves (140 px is its full travel). */
async function dragKnob(page, k, dy, steps = 8) {
  await page.mouse.move(k.x, k.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(k.x, k.y - (dy * i) / steps);
  await page.mouse.up();
}

/** A knob's value as the engine's last description of the bench has it. */
const rackValue = (page, addr) =>
  page.evaluate((a) => {
    for (const m of window.__aur.wb.rack.modules) {
      const k = m.knobs.find((x) => x.addr === a);
      if (k) return k.value;
    }
    return null;
  }, addr);
const knobText = (page, addr) =>
  page.evaluate((a) => document.querySelector(`#rack-svg g[data-addr="${CSS.escape(a)}"] .knob-value`)?.textContent || null, addr);

/** Commit the bench as it stands (the express path: no duel), and read the
 *  committed patch back from the engine by its new id. */
async function commitAndDescribe(app) {
  const { page } = app;
  await page.evaluate(() => { document.getElementById("improve-check").checked = true; });
  const t0 = await app.now();
  await page.locator("#rack-commit").click();
  const { id } = await app.reply("committed", { after: t0, timeout: 60_000 });
  expect(id).toBeGreaterThan(0);
  const t1 = await app.now();
  await app.post({ type: "describe", id });
  const described = await app.reply("described", { where: { id }, after: t1, timeout: 30_000 });
  const out = {};
  for (const m of described.rack.modules) for (const k of m.knobs) out[k.addr] = k.value;
  return out;
}

test("two knobs turned in quick succession under a slow engine both land, in the rack and in the commit", async ({ page, app }) => {
  await app.boot({ busy: true });
  await openPreset(app, "Glass Pad");
  const ks = (await knobs(page)).filter((k) => k.value < 0.55);
  expect(ks.length).toBeGreaterThanOrEqual(2);
  const [a, b] = ks;
  await app.busy({ edit_param: 1500 });
  // Each drag's first write goes out; the rest wait behind it. The second
  // drag starts while the first one's last value is still waiting.
  const valueNow = async (addr) =>
    Number(await page.locator(`#rack-svg g[data-addr="${addr}"]`).getAttribute("aria-valuenow"));
  await dragKnob(page, a, 42);
  const aWant = await valueNow(a.addr); // where the hand left it
  await page.waitForTimeout(GESTURE_GAP_MS);
  await dragKnob(page, b, 42);
  const bWant = await valueNow(b.addr);
  expect(aWant).toBeGreaterThan(a.value + 0.25);
  expect(bWant).toBeGreaterThan(b.value + 0.25);
  await settled(app);
  await app.busy({});
  // What the rack draws, and the engine's own description of the bench.
  expect(await valueNow(a.addr)).toBeCloseTo(aWant, 2);
  expect(await valueNow(b.addr)).toBeCloseTo(bWant, 2);
  expect(await rackValue(page, a.addr)).toBeCloseTo(aWant, 2);
  expect(await rackValue(page, b.addr)).toBeCloseTo(bWant, 2);
  const committed = await commitAndDescribe(app);
  expect(committed[a.addr]).toBeCloseTo(aWant, 2);
  expect(committed[b.addr]).toBeCloseTo(bWant, 2);
});

test("a second drag of the same knob starts from where the first one left it", async ({ page, app }) => {
  // The film's vp-cold: cutoff up 64 px over ~3 s, then 250 ms later down
  // 50 px. The second drag used to start from the value before the first,
  // whose last write was still queued, and the knob ended far below.
  await app.boot({ busy: true });
  await openPreset(app, "Acid Line");
  const k = (await knobs(page)).find((x) => x.addr === "node#cut") || (await knobs(page))[0];
  const was = await rackValue(page, k.addr);
  await app.busy({ edit_param: 1500 });
  const path = async (dy, steps, ms) => {
    const b = await page.locator(`#rack-svg g[data-addr="${k.addr}"] > .knob-hit`).boundingBox();
    const x = b.x + b.width / 2;
    const y = b.y + b.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(x, y - (dy * i) / steps);
      await page.waitForTimeout(ms / steps);
    }
    await page.mouse.up();
  };
  await path(64, 12, 2900);
  await page.waitForTimeout(REGRAB_MS);
  await path(-50, 12, 3000);
  const want = Math.min(1, Math.max(0, was + 14 / 140));
  // At once, not only once the engine has caught up: the film saw 12 kHz
  // here, with the knob let go at 2.9 kHz.
  expect(Number(await page.locator(`#rack-svg g[data-addr="${k.addr}"]`).getAttribute("aria-valuenow"))).toBeCloseTo(want, 2);
  await settled(app);
  await app.busy({});
  expect(await rackValue(page, k.addr)).toBeCloseTo(want, 2);
  expect(Number(await page.locator(`#rack-svg g[data-addr="${k.addr}"]`).getAttribute("aria-valuenow"))).toBeCloseTo(want, 2);
});

test("a knob's element survives the redraw of a knob edit, and is never rebuilt under a held pointer", async ({ page, app }) => {
  await app.boot({ busy: true });
  await openPreset(app, "Acid Line");
  const [a, b] = await knobs(page);
  // Something that found the second knob before the first one's reply
  // landed must still be holding a knob after it.
  await page.evaluate((addr) => {
    window.__pwKnob = document.querySelector(`#rack-svg g[data-addr="${CSS.escape(addr)}"]`);
  }, b.addr);
  await app.busy({ edit_param: 1200 });
  await dragKnob(page, a, 20, 4);
  await settled(app);
  expect(await page.evaluate(() => window.__pwKnob.isConnected)).toBe(true);
  // A pointer held down on a knob while a reply lands: the element under it
  // stays the one it pressed.
  await page.evaluate((addr) => {
    window.__pwHeld = document.querySelector(`#rack-svg g[data-addr="${CSS.escape(addr)}"]`);
  }, a.addr);
  const box = await page.locator(`#rack-svg g[data-addr="${a.addr}"] > .knob-hit`).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await dragKnob(page, b, 20, 4); // a write goes out, its reply lands below
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 6);
  // The replies to b land while a is held: every write sent is answered
  // (a's own waits in the lane while the hand is on it).
  await app.answered({ lanes: ["bench"], timeout: 30_000 });
  expect(await page.evaluate(() => window.__pwHeld.isConnected)).toBe(true);
  await page.mouse.up();
  await settled(app);
  await app.busy({});
});

test("⌘Z right after letting go of a knob undoes the turn, whatever was still on its way", async ({ page, app }) => {
  await app.boot({ busy: true });
  await openPreset(app, "Glass Pad");
  const [k] = (await knobs(page)).filter((x) => x.value < 0.55);
  const was = await rackValue(page, k.addr);
  const wasText = await knobText(page, k.addr);
  await app.busy({ edit_param: 1500, edit_set_tree: 800 });
  await dragKnob(page, k, 42, 10);
  // The most natural thing a player does: let go, and take it back.
  await page.keyboard.press("Control+z");
  await settled(app);
  await app.busy({});
  expect(await rackValue(page, k.addr)).toBeCloseTo(was, 4);
  expect(await knobText(page, k.addr)).toBe(wasText);
});

test("once a knob has moved, no reply repaints it at an older value", async ({ page, app }) => {
  await app.boot({ busy: true });
  await openPreset(app, "Glass Pad");
  const [k] = (await knobs(page)).filter((x) => x.value < 0.5);
  const startText = await knobText(page, k.addr);
  // Every text the knob's readout shows from here on, in order.
  await page.evaluate((addr) => {
    const seen = (window.__pwSeen = []);
    const read = () => {
      const t = document.querySelector(`#rack-svg g[data-addr="${CSS.escape(addr)}"] .knob-value`)?.textContent;
      if (t != null && t !== seen[seen.length - 1]) seen.push(t);
    };
    new MutationObserver(read).observe(document.getElementById("rack-svg"), {
      childList: true, subtree: true, characterData: true,
    });
  }, k.addr);
  await app.busy({ edit_param: 1500 });
  // A slow drag: the first value is long gone from the hand by the time the
  // engine has rendered it.
  await page.mouse.move(k.x, k.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(k.x, k.y - 7 * i);
    await page.waitForTimeout(SLOW_STEP_MS);
  }
  await page.mouse.up();
  const finalText = await knobText(page, k.addr);
  expect(finalText).not.toBe(startText);
  await settled(app);
  await app.busy({});
  expect(await knobText(page, k.addr)).toBe(finalText);
  // After the hand let go, the readout says the final value and nothing else:
  // every text it showed from the last drag frame on is that one.
  const seen = await page.evaluate(() => window.__pwSeen);
  const fromFinal = seen.slice(seen.lastIndexOf(finalText) >= 0 ? seen.indexOf(finalText) : 0);
  expect(fromFinal.every((t) => t === finalText)).toBe(true);
});

test("arrow-key nudges on a slow engine all count, and are one undo step", async ({ page, app }) => {
  await app.boot({ busy: true });
  await openPreset(app, "Glass Pad");
  const [k] = (await knobs(page)).filter((x) => x.value < 0.6);
  const was = await rackValue(page, k.addr);
  await app.busy({ edit_param: 700 });
  await page.locator(`#rack-svg g[data-addr="${k.addr}"]`).focus();
  // Slower than the engine answers, so replies land between presses: each
  // one used to redraw the knob at an older value, and the next press added
  // its step to that.
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(SLOW_STEP_MS);
  }
  await settled(app);
  expect(await rackValue(page, k.addr)).toBeCloseTo(Math.min(1, was + 0.16), 3);
  await page.keyboard.press("Control+z");
  await settled(app);
  await app.busy({});
  expect(await rackValue(page, k.addr)).toBeCloseTo(was, 4);
});

/** The first plate on the bench whose structure menu offers `verb` enabled. */
async function plateWith(page, verb) {
  const keys = await page.evaluate(() =>
    window.__aur.wb.rack.modules.filter((m) => !m.is_mod && m.kind !== "amp").map((m) => m.key));
  for (const key of keys) {
    await page.locator(`#rack-svg g.mod-group[data-key="${key}"] .mod-menu-btn`).first().click();
    const row = page.locator("#ctx-menu .cm-item").filter({ hasText: new RegExp(`^${verb}`) });
    const ok = (await row.count()) > 0 && (await row.first().isEnabled());
    await page.keyboard.press("Escape");
    if (ok) {
      const uid = await page.evaluate((k) => window.__aur.wb.rack.modules.find((m) => m.key === k).uid, key);
      return { key, uid };
    }
  }
  return null;
}
async function menuVerb(page, key, verb) {
  await page.locator(`#rack-svg g.mod-group[data-key="${key}"] .mod-menu-btn`).first().click();
  await page.locator("#ctx-menu .cm-item").filter({ hasText: new RegExp(`^${verb}`) }).first().click();
}
const uidOnRack = (page, uid) =>
  page.evaluate((u) => window.__aur.wb.rack.modules.some((m) => m.uid === u), uid);

test("bypass pressed while a knob turn is still landing waits its turn, then happens", async ({ page, app }) => {
  await app.boot({ busy: true });
  await openPreset(app, "Glass Pad");
  const target = await plateWith(page, "bypass");
  expect(target).not.toBeNull();
  const [k] = (await knobs(page)).filter((x) => x.value < 0.55);
  await app.busy({ edit_param: 2000 });
  await dragKnob(page, k, 30);
  const want = Number(await page.locator(`#rack-svg g[data-addr="${k.addr}"]`).getAttribute("aria-valuenow"));
  await menuVerb(page, target.key, "bypass");
  // Waiting, and saying so: the caption counts it and the plate is marked.
  await expect(page.locator("#rack-meta")).toContainText("waiting");
  await expect(page.locator("#rack-svg g.mod-group.queued")).toHaveCount(1);
  await settled(app);
  await app.busy({});
  expect(await uidOnRack(page, target.uid)).toBe(false);
  // The lane shows one toast at a time, so the receipt may still be waiting
  // its turn behind the preset's own: it has entered the lane.
  await app.toast(/bypassed/, { timeout: 20_000 });
  expect((await app.toasts()).some((t) => /still applying/.test(t))).toBe(false);
  await expect(page.locator("#rack-meta")).not.toContainText("waiting");
  // …and the knob turn in front of it landed first, and stayed.
  expect(await rackValue(page, k.addr)).toBeCloseTo(want, 2);
});

test("⌘Z retires the toast that described the edit it undid", async ({ page, app }) => {
  await app.boot({ busy: true });
  await openPreset(app, "Glass Pad");
  const target = await plateWith(page, "set aside");
  await menuVerb(page, target.key, "set aside");
  await settled(app);
  // The lane shows one toast at a time: this one may wait behind the
  // preset's own before it is on screen.
  const toast = page.locator("#toasts .toast", { hasText: "set aside below" });
  await expect(toast).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press("Control+z");
  await settled(app);
  expect(await uidOnRack(page, target.uid)).toBe(true);
  // Gone well inside its seven seconds: it describes a patch that is not there.
  await expect(toast).toHaveCount(0, { timeout: 2_000 });
  // And a toast whose edit has another edit on top of it can no longer be
  // pressed to undo *that* one.
  await menuVerb(page, target.key, "set aside");
  await settled(app);
  const again = page.locator("#toasts .toast", { hasText: "set aside below" });
  await expect(again).toBeVisible({ timeout: 20_000 });
  const [k] = await knobs(page);
  await dragKnob(page, k, 10, 3);
  await settled(app);
  await expect(again.locator(".toast-undo")).toBeDisabled();
});

test("the newest edit's receipt replaces the last one's, and ⌘Z takes it down", async ({ page, app }) => {
  // The film's vp-change: a bypass, then a cable pulled. The bypass's
  // receipt stayed up over the empty socket with the unplug's queued behind
  // it, and the unplug's surfaced only after it had been undone.
  await app.boot({ busy: true });
  await openPreset(app, "Glass Pad");
  const p = await plateWith(page, "bypass");
  await menuVerb(page, p.key, "bypass");
  await settled(app);
  const q = await plateWith(page, "set aside");
  await menuVerb(page, q.key, "set aside");
  await settled(app);
  await expect(page.locator("#toasts .toast", { hasText: "bypassed" })).toHaveCount(0, { timeout: 3_000 });
  const receipt = page.locator("#toasts .toast", { hasText: "set aside below" });
  await expect(receipt).toBeVisible({ timeout: 20_000 });
  const seen = await app.toastMark();
  await page.keyboard.press("Control+z");
  await settled(app);
  await expect(receipt).toHaveCount(0, { timeout: 2_000 });
  // Nothing about either edit surfaces afterwards: the undone one's receipt
  // is gone, and the replaced one does not come back (watched for as long as
  // it always was).
  await app.quiet(3_000);
  const after = await app.toasts(seen);
  expect(after.filter((t) => /held below|bypassed/.test(t))).toEqual([]);
});

test("▶ plays the socket the preview was rendering, after the pointer has left it", async ({ page, app }) => {
  await app.boot({ busy: true });
  await openPreset(app, "Glass Pad");
  await openCatalog(page);
  await page.locator('.nb-item[data-kind="distortion"]').click();
  // The previews asked for a socket (a port's own aside).
  const previews = async () => (await app.sent("preview_render")).filter((m) => m.tag !== "port").map((m) => m.key);
  const jacks = page.locator("#rack-svg .jack.legal[data-childkey]");
  const n = await jacks.count();
  expect(n).toBeGreaterThan(1);
  // Not the socket the arming pre-selects, nor the first: those are the
  // fallbacks a stray ▶ used to land on.
  let j = null;
  for (let i = n - 1; i > 0; i--) {
    if (!(await jacks.nth(i).evaluate((el) => el.classList.contains("hot")))) { j = jacks.nth(i); break; }
  }
  expect(j).not.toBeNull();
  const key = await j.getAttribute("data-childkey");
  await app.busy({ preview_render: 2500 });
  const box = await j.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(async () => (await previews()).length, { timeout: 5_000 }).toBe(1);
  // The render is still at the worker; the pointer goes to ▶.
  const play = page.locator("#pv-play");
  await play.hover();
  await expect(page.locator(".pv-label")).toContainText(/rendering (after|in)/);
  await expect(j).toHaveClass(/\bpreviewed\b/);
  await play.click();
  await app.engine((timeout) => expect(page.locator(".pv-label")).toContainText(/hear it (after|in)/, { timeout }), { ms: 30_000 });
  // One render, for the socket the pointer rested on — ▶ did not ask for
  // another one somewhere else.
  expect(await previews()).toEqual([key]);
  await app.busy({});
});

test("HOLD, the octave buttons and notes leave the arp drawer open", async ({ page, app }) => {
  await app.boot({ busy: true });
  await openPreset(app, "Glass Pad");
  // ARP is in KEYS ⋯ (Plan-008); the arp's settings are a row there.
  await openKeys(page);
  await page.locator("#arp-btn").click();
  const drawer = page.locator("#arp-ctl");
  await expect(drawer).toHaveClass(/\bopen\b/);
  await page.locator("#hold-btn").click();
  await expect(drawer).toHaveClass(/\bopen\b/);
  await page.locator("#oct-up").click();
  await page.locator("#oct-down").click();
  await expect(drawer).toHaveClass(/\bopen\b/);
  // A chord, from the computer keys, and a note from the keybed.
  await page.keyboard.press("a");
  await page.keyboard.press("d");
  const pb = await page.locator("#piano").boundingBox();
  await page.mouse.click(pb.x + pb.width / 2, pb.y + pb.height - 8);
  await expect(drawer).toHaveClass(/\bopen\b/);
  await expect(page.locator("#hold-btn")).toHaveAttribute("aria-pressed", "true");
  // Outside the dock, it folds.
  await page.locator("#rack-subject").click();
  await expect(drawer).not.toHaveClass(/\bopen\b/);
});

test("with SYNC on, a sequencer's RATE reads the division it plays", async ({ page, app }) => {
  await app.boot({ busy: true });
  await openPreset(app, "Loom");
  const rate = page.locator('#rack-svg g[data-addr$="#srate"]').first();
  await expect(rate).toHaveCount(1);
  const free = await rate.locator(".knob-value").textContent();
  expect(free).toMatch(/Hz$/);
  await openKeys(page);
  await page.locator("#sync-btn").click();
  await expect(rate.locator(".knob-value")).toHaveText(/Hz sync$/);
  await expect(rate).toHaveAttribute("aria-valuetext", /synced to \d+ BPM/);
  await page.locator("#sync-btn").click();
  await expect(rate.locator(".knob-value")).toHaveText(free);
});

test("step bars and LENGTH drawn in quick succession under a slow engine all land (Loom)", async ({ page, app }) => {
  await app.boot({ busy: true });
  await openPreset(app, "Loom");
  const bars = page.locator("#rack-svg g.step-bar[data-addr]");
  expect(await bars.count()).toBeGreaterThanOrEqual(2);
  const slen = await page.evaluate(() => {
    const g = document.querySelector('#rack-svg g[data-addr$="#slen"]');
    const r = g.querySelector(":scope > .knob-hit").getBoundingClientRect();
    return { addr: g.dataset.addr, x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await app.busy({ edit_param: 1500 });
  // Draw a bar: press on its track and move a hair.
  const draw = async (i, frac) => {
    const r = await bars.nth(i).locator(".step-track").boundingBox();
    const y = r.y + r.height * (1 - frac);
    await page.mouse.move(r.x + r.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(r.x + r.width / 2, y - 1);
    await page.mouse.up();
  };
  const addrs = [await bars.nth(0).getAttribute("data-addr"), await bars.nth(1).getAttribute("data-addr")];
  await draw(0, 0.9);
  await page.waitForTimeout(GESTURE_GAP_MS);
  await draw(1, 0.15);
  await page.waitForTimeout(GESTURE_GAP_MS);
  await dragKnob(page, slen, 150, 6); // all the way up: 8 steps
  const want = await page.evaluate((as) => as.map((a) =>
    Number(document.querySelector(`#rack-svg g[data-addr="${CSS.escape(a)}"]`).getAttribute("aria-valuenow"))), addrs);
  await settled(app);
  await app.busy({});
  await expect(page.locator(`#rack-svg g[data-addr="${slen.addr}"] .knob-value`)).toHaveText("8 steps");
  expect(await rackValue(page, addrs[0])).toBeCloseTo(want[0], 2);
  expect(await rackValue(page, addrs[1])).toBeCloseTo(want[1], 2);
  const committed = await commitAndDescribe(app);
  expect(committed[slen.addr]).toBeCloseTo(1, 2);
  expect(committed[addrs[0]]).toBeCloseTo(want[0], 2);
  expect(committed[addrs[1]]).toBeCloseTo(want[1], 2);
});

// ---- the keep-as-new comparison (COMMIT's card) ----
// Esc on the card committed ("esc skip" sent the commit with no answer); its
// sides were titled "your edit" and "the original", which answered the
// question it asked; and "my edit is better", once ticked, stayed ticked, so
// every later commit skipped the comparison without a word. These need no
// slow engine: they are about what the card and the checkbox do.

/** Turn the first low knob up a little and wait for the lane to settle. */
async function editAKnob(app, nth = 0) {
  const k = (await knobs(app.page)).filter((x) => x.value < 0.55)[nth];
  await dragKnob(app.page, k, 30);
  await settled(app);
}

test("Esc on the comparison card commits nothing, and its sides are A and B until the pick", async ({ page, app }) => {
  await app.boot({ busy: true });
  await openPreset(app, "Glass Pad");
  await editAKnob(app);
  const commits = () => app.sentCount("edit_commit");
  const before = await commits();

  await page.locator("#rack-commit").click();
  await app.engine((timeout) => expect(page.locator("#cduel")).not.toHaveClass(/\bhidden\b/, { timeout }), { ms: 30_000 });
  // Blind: a letter each, no name for either side.
  await expect(page.locator("#cd-name-a")).toHaveText("");
  await expect(page.locator("#cd-name-b")).toHaveText("");
  for (const cell of await page.locator("#cduel .cduel-cell").all()) {
    await expect(cell).not.toContainText(/your edit|the original/);
  }
  await expect(page.locator("#cduel .cd-hint")).toContainText("esc cancel");
  await expect(page.locator("#cd-skip")).toHaveText("skip comparing");

  // Esc: the card goes, nothing is committed, the edit is still on the bench.
  await page.keyboard.press("Escape");
  await expect(page.locator("#cduel")).toHaveClass(/\bhidden\b/);
  await app.quiet(2_000); // as long as it was always watched
  expect(await commits()).toBe(before);
  await expect(page.locator("#rack-commit")).toBeEnabled();
  expect(await page.evaluate(() => window.__aur.wb.dirty)).toBe(true);

  // Asked again and answered: the receipt says which side was the edit.
  await page.locator("#rack-commit").click();
  await app.engine((timeout) => expect(page.locator("#cduel")).not.toHaveClass(/\bhidden\b/, { timeout }), { ms: 30_000 });
  await page.keyboard.press("ArrowLeft");
  await expect.poll(commits).toBe(before + 1);
  await app.engine((timeout) => expect(page.locator("#toasts .toast-msg").first()).toHaveText(
    /^Kept .+ as new: [AB] was your edit, and you picked (it|the original \(it learns most from that\))\./,
    { timeout },
  ), { ms: 30_000 });
});

test("“pick the edit” skips the comparison once, then unticks itself", async ({ page, app }) => {
  await app.boot({ busy: true });
  await openPreset(app, "Glass Pad");
  await editAKnob(app);
  await page.locator("#improve-check").check();
  const t0 = await app.now();
  await page.locator("#rack-commit").click();
  const committed = await app.reply("committed", { after: t0, timeout: 60_000 });
  expect(committed.outcome).toBe("self_edited");
  await expect(page.locator("#cduel")).toHaveClass(/\bhidden\b/);
  await expect(page.locator("#improve-check")).not.toBeChecked();

  // The next commit asks again.
  await editAKnob(app, 1);
  await page.locator("#rack-commit").click();
  await app.engine((timeout) => expect(page.locator("#cduel")).not.toHaveClass(/\bhidden\b/, { timeout }), { ms: 30_000 });
  await page.keyboard.press("Escape");
});

test("a landed commit takes the edits' receipts down, and its own is said next", async ({ page, app }) => {
  // The film's vp-together: 1.3 s after COMMIT the lane still showed the
  // placement's "… TAKE IT OUT +1", the commit's receipt the "+1" behind it.
  await app.boot({ busy: true });
  await openPreset(app, "Glass Pad");
  const p = await plateWith(page, "bypass");
  expect(p).not.toBeNull();
  await menuVerb(page, p.key, "bypass");
  await settled(app);
  await expect(page.locator("#toasts .toast", { hasText: "bypassed" })).toBeVisible({ timeout: 20_000 });
  await page.locator("#improve-check").check();
  await page.locator("#rack-commit").click();
  await app.engine((timeout) => expect(page.locator("#toasts .toast-msg").first()).toHaveText(/^Kept .+ as new/, { timeout }), { ms: 30_000 });
  await expect(page.locator("#toasts .toast", { hasText: "bypassed" })).toHaveCount(0);
  const seen = await app.toastMark();
  await app.quiet(3_000); // as long as it was always watched
  const after = await app.toasts(seen);
  expect(after.filter((t) => /bypassed/.test(t))).toEqual([]);
});
