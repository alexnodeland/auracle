// PATCH editing under a slow engine: the order of edits, and what the rack
// draws while they are on their way.
//
// Every one of these is a race, and every one is lost only when the engine
// worker is slow — which on a loaded machine is most of the time, and in a
// fresh headless browser almost never. So the worker is made slow for real:
// `worker.js` is served with a listener prepended that busy-waits before the
// engine's own handler sees chosen request types. The worker stays serial,
// requests queue behind each other exactly as they do when the machine is
// busy, and nothing in apps/web is reached into except through the page. The
// slowdown is switched on by a message (`__pw_slow`) only once the patch is
// on the bench, so boot runs at full speed.
//
// Edits are counted on the way out (`edit_*` posted to the worker) and on the
// way back (a `bench` reply that answers an edit, or `edit_rejected`); the
// lane has settled when the two agree and stay agreed. That works the same
// against any build, so each test here can be run against the code before its
// fix to watch it fail.
const { test, expect } = require("@playwright/test");

const INIT = `(() => {
  const Orig = window.Worker;
  const workers = (window.__pwWorkers = []);
  const io = (window.__pwIO = { out: 0, in: 0, sent: [], posted: {}, previews: [] });
  const last = (window.__pwLast = {});
  const EDITS = new Set(["edit_param", "edit_structure", "edit_set_tree"]);
  function Wrapped(url, opts) {
    const w = new Orig(url, opts);
    w.__pwUrl = String(url);
    workers.push(w);
    if (/worker\\.js/.test(w.__pwUrl)) {
      const post = w.postMessage.bind(w);
      w.postMessage = (m, t) => {
        if (m && typeof m.type === "string") io.posted[m.type] = (io.posted[m.type] || 0) + 1;
        if (m && m.type === "preview_render" && m.tag !== "port") io.previews.push(m.key);
        if (m && EDITS.has(m.type)) {
          io.out += 1;
          io.sent.push({ type: m.type, addr: m.addr, value: m.value });
        }
        return post(m, t);
      };
      // Registered before main's \`onmessage\`, so it counts a reply before
      // main reacts to it (and possibly sends the next edit).
      w.addEventListener("message", (e) => {
        const d = e.data;
        if (!d || typeof d.type !== "string") return;
        last[d.type] = d;
        if ((d.type === "bench" && d.edited !== undefined) || d.type === "edit_rejected") io.in += 1;
      });
    }
    return w;
  }
  Wrapped.prototype = Orig.prototype;
  window.Worker = Wrapped;
  window.__pwEngine = () => workers.find((w) => /worker\\.js/.test(w.__pwUrl)) || null;
  const toasts = (window.__pwToasts = []);
  document.addEventListener("DOMContentLoaded", () => {
    const lane = document.getElementById("toasts");
    if (!lane) return;
    new MutationObserver((muts) => {
      for (const m of muts)
        for (const n of m.addedNodes) {
          const msg = n.querySelector && n.querySelector(".toast-msg");
          if (msg) toasts.push(msg.textContent);
        }
    }).observe(lane, { childList: true });
  });
  try {
    for (const k of ["auracle-warmed", "auracle-played", "auracle-bench-tour", "auracle-bank-toured"])
      localStorage.setItem(k, "1");
  } catch (_) {}
})();`;

// Prepended to worker.js. A busy-wait, not a timer: the worker's handler is
// async, and an awaited delay would let the next request start underneath it.
const SLOW = `let __pwSlow = {};
self.addEventListener("message", (e) => {
  const d = e.data;
  if (d && d.type === "__pw_slow") { __pwSlow = d.slow || {}; e.stopImmediatePropagation(); return; }
  const ms = d && __pwSlow[d.type];
  if (ms) { const until = performance.now() + ms; while (performance.now() < until) {} }
});
`;

async function boot(page) {
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.addInitScript(INIT);
  await page.route(/\/worker\.js(\?|$)/, async (route) => {
    const resp = await route.fetch();
    const body = await resp.text();
    await route.fulfill({ response: resp, body: SLOW + body, contentType: "text/javascript" });
  });
  await page.goto("/");
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 120_000 });
  return errors;
}

/** Open a library preset on the bench, and wait until the rack is its. */
async function openPreset(page, name) {
  await page.locator('.bf[data-f="preset"]').click();
  await page.locator(".bank-item", { hasText: name }).first().click();
  await expect(page.locator("#rack-subject")).toContainText(name, { timeout: 60_000 });
  await expect(page.locator("#rack-svg .knob-hit").first()).toBeVisible();
  await settled(page);
}

const slow = (page, map) =>
  page.evaluate((m) => window.__pwEngine().postMessage({ type: "__pw_slow", slow: m }), map);

/** Every edit posted has been answered, and stays that way for `quiet` ms —
 *  the lane has nothing in flight and nothing it is about to send. */
async function settled(page, quiet = 700) {
  await expect
    .poll(
      async () => {
        const a = await page.evaluate(() => [window.__pwIO.out, window.__pwIO.in]);
        if (a[0] !== a[1]) return false;
        await page.waitForTimeout(quiet);
        const b = await page.evaluate(() => [window.__pwIO.out, window.__pwIO.in]);
        return a[0] === b[0] && a[1] === b[1];
      },
      { timeout: 90_000, intervals: [250] },
    )
    .toBe(true);
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
async function commitAndDescribe(page) {
  await page.evaluate(() => { document.getElementById("improve-check").checked = true; });
  const before = await page.evaluate(() => (window.__pwLast.committed ? window.__pwLast.committed.id : null));
  await page.locator("#rack-commit").click();
  await expect
    .poll(() => page.evaluate(() => (window.__pwLast.committed ? window.__pwLast.committed.id : null)), { timeout: 60_000 })
    .not.toBe(before);
  const id = await page.evaluate(() => window.__pwLast.committed.id);
  expect(id).toBeGreaterThan(0);
  await page.evaluate((i) => {
    window.__pwLast.described = null;
    window.__pwEngine().postMessage({ type: "describe", id: i });
  }, id);
  await expect.poll(() => page.evaluate(() => !!window.__pwLast.described), { timeout: 30_000 }).toBe(true);
  return page.evaluate(() => {
    const out = {};
    for (const m of window.__pwLast.described.rack.modules) for (const k of m.knobs) out[k.addr] = k.value;
    return out;
  });
}

test("two knobs turned in quick succession under a slow engine both land, in the rack and in the commit", async ({ page }) => {
  const errors = await boot(page);
  await openPreset(page, "Glass Pad");
  const ks = (await knobs(page)).filter((k) => k.value < 0.55);
  expect(ks.length).toBeGreaterThanOrEqual(2);
  const [a, b] = ks;
  await slow(page, { edit_param: 1500 });
  // Each drag's first write goes out; the rest wait behind it. The second
  // drag starts while the first one's last value is still waiting.
  const valueNow = async (addr) =>
    Number(await page.locator(`#rack-svg g[data-addr="${addr}"]`).getAttribute("aria-valuenow"));
  await dragKnob(page, a, 42);
  const aWant = await valueNow(a.addr); // where the hand left it
  await page.waitForTimeout(120);
  await dragKnob(page, b, 42);
  const bWant = await valueNow(b.addr);
  expect(aWant).toBeGreaterThan(a.value + 0.25);
  expect(bWant).toBeGreaterThan(b.value + 0.25);
  await settled(page);
  await slow(page, {});
  // What the rack draws, and the engine's own description of the bench.
  expect(await valueNow(a.addr)).toBeCloseTo(aWant, 2);
  expect(await valueNow(b.addr)).toBeCloseTo(bWant, 2);
  expect(await rackValue(page, a.addr)).toBeCloseTo(aWant, 2);
  expect(await rackValue(page, b.addr)).toBeCloseTo(bWant, 2);
  const committed = await commitAndDescribe(page);
  expect(committed[a.addr]).toBeCloseTo(aWant, 2);
  expect(committed[b.addr]).toBeCloseTo(bWant, 2);
  expect(errors).toEqual([]);
});

test("a second drag of the same knob starts from where the first one left it", async ({ page }) => {
  // The film's vp-cold: cutoff up 64 px over ~3 s, then 250 ms later down
  // 50 px. The second drag used to start from the value before the first,
  // whose last write was still queued, and the knob ended far below.
  const errors = await boot(page);
  await openPreset(page, "Acid Line");
  const k = (await knobs(page)).find((x) => x.addr === "node#cut") || (await knobs(page))[0];
  const was = await rackValue(page, k.addr);
  await slow(page, { edit_param: 1500 });
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
  await page.waitForTimeout(250);
  await path(-50, 12, 3000);
  await settled(page);
  await slow(page, {});
  const want = Math.min(1, Math.max(0, was + 14 / 140));
  expect(await rackValue(page, k.addr)).toBeCloseTo(want, 2);
  expect(Number(await page.locator(`#rack-svg g[data-addr="${k.addr}"]`).getAttribute("aria-valuenow"))).toBeCloseTo(want, 2);
  expect(errors).toEqual([]);
});

test("⌘Z right after letting go of a knob undoes the turn, whatever was still on its way", async ({ page }) => {
  const errors = await boot(page);
  await openPreset(page, "Glass Pad");
  const [k] = (await knobs(page)).filter((x) => x.value < 0.55);
  const was = await rackValue(page, k.addr);
  const wasText = await knobText(page, k.addr);
  await slow(page, { edit_param: 1500, edit_set_tree: 800 });
  await dragKnob(page, k, 42, 10);
  // The most natural thing a player does: let go, and take it back.
  await page.keyboard.press("Control+z");
  await settled(page);
  await slow(page, {});
  expect(await rackValue(page, k.addr)).toBeCloseTo(was, 4);
  expect(await knobText(page, k.addr)).toBe(wasText);
  expect(errors).toEqual([]);
});

test("once a knob has moved, no reply repaints it at an older value", async ({ page }) => {
  const errors = await boot(page);
  await openPreset(page, "Glass Pad");
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
  await slow(page, { edit_param: 1500 });
  // A slow drag: the first value is long gone from the hand by the time the
  // engine has rendered it.
  await page.mouse.move(k.x, k.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(k.x, k.y - 7 * i);
    await page.waitForTimeout(250);
  }
  await page.mouse.up();
  const finalText = await knobText(page, k.addr);
  expect(finalText).not.toBe(startText);
  await settled(page);
  await slow(page, {});
  expect(await knobText(page, k.addr)).toBe(finalText);
  // After the hand let go, the readout says the final value and nothing else:
  // every text it showed from the last drag frame on is that one.
  const seen = await page.evaluate(() => window.__pwSeen);
  const fromFinal = seen.slice(seen.lastIndexOf(finalText) >= 0 ? seen.indexOf(finalText) : 0);
  expect(fromFinal.every((t) => t === finalText)).toBe(true);
  expect(errors).toEqual([]);
});

test("arrow-key nudges on a slow engine all count, and are one undo step", async ({ page }) => {
  const errors = await boot(page);
  await openPreset(page, "Glass Pad");
  const [k] = (await knobs(page)).filter((x) => x.value < 0.6);
  const was = await rackValue(page, k.addr);
  await slow(page, { edit_param: 700 });
  await page.locator(`#rack-svg g[data-addr="${k.addr}"]`).focus();
  // Slower than the engine answers, so replies land between presses: each
  // one used to redraw the knob at an older value, and the next press added
  // its step to that.
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(250);
  }
  await settled(page);
  expect(await rackValue(page, k.addr)).toBeCloseTo(Math.min(1, was + 0.16), 3);
  await page.keyboard.press("Control+z");
  await settled(page);
  await slow(page, {});
  expect(await rackValue(page, k.addr)).toBeCloseTo(was, 4);
  expect(errors).toEqual([]);
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

test("bypass pressed while a knob turn is still landing waits its turn, then happens", async ({ page }) => {
  const errors = await boot(page);
  await openPreset(page, "Glass Pad");
  const target = await plateWith(page, "bypass");
  expect(target).not.toBeNull();
  const [k] = (await knobs(page)).filter((x) => x.value < 0.55);
  await slow(page, { edit_param: 2000 });
  await dragKnob(page, k, 30);
  const want = Number(await page.locator(`#rack-svg g[data-addr="${k.addr}"]`).getAttribute("aria-valuenow"));
  await menuVerb(page, target.key, "bypass");
  // Waiting, and saying so: the caption counts it and the plate is marked.
  await expect(page.locator("#rack-meta")).toContainText("waiting");
  await expect(page.locator("#rack-svg g.mod-group.queued")).toHaveCount(1);
  await settled(page);
  await slow(page, {});
  expect(await uidOnRack(page, target.uid)).toBe(false);
  // The lane shows one toast at a time, so the receipt may still be waiting
  // its turn behind the preset's own: polled, as failure_flows does.
  await expect
    .poll(() => page.evaluate(() => window.__pwToasts.some((t) => /bypassed/.test(t))), { timeout: 20_000 })
    .toBe(true);
  expect(await page.evaluate(() => window.__pwToasts.some((t) => /still applying/.test(t)))).toBe(false);
  await expect(page.locator("#rack-meta")).not.toContainText("waiting");
  // …and the knob turn in front of it landed first, and stayed.
  expect(await rackValue(page, k.addr)).toBeCloseTo(want, 2);
  expect(errors).toEqual([]);
});

test("⌘Z retires the toast that described the edit it undid", async ({ page }) => {
  const errors = await boot(page);
  await openPreset(page, "Glass Pad");
  const target = await plateWith(page, "extract to HELD");
  await menuVerb(page, target.key, "extract to HELD");
  await settled(page);
  // The lane shows one toast at a time: this one may wait behind the
  // preset's own before it is on screen.
  const toast = page.locator("#toasts .toast", { hasText: "held below" });
  await expect(toast).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press("Control+z");
  await settled(page);
  expect(await uidOnRack(page, target.uid)).toBe(true);
  // Gone well inside its seven seconds: it describes a patch that is not there.
  await expect(toast).toHaveCount(0, { timeout: 2_000 });
  // And a toast whose edit has another edit on top of it can no longer be
  // pressed to undo *that* one.
  await menuVerb(page, target.key, "extract to HELD");
  await settled(page);
  const again = page.locator("#toasts .toast", { hasText: "held below" });
  await expect(again).toBeVisible({ timeout: 20_000 });
  const [k] = await knobs(page);
  await dragKnob(page, k, 10, 3);
  await settled(page);
  await expect(again.locator(".toast-undo")).toBeDisabled();
  expect(errors).toEqual([]);
});

test("▶ plays the socket the preview was rendering, after the pointer has left it", async ({ page }) => {
  const errors = await boot(page);
  await openPreset(page, "Glass Pad");
  await page.locator('.nb-item[data-kind="distortion"]').click();
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
  await slow(page, { preview_render: 2500 });
  const box = await j.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(() => page.evaluate(() => window.__pwIO.previews.length), { timeout: 5_000 }).toBe(1);
  // The render is still at the worker; the pointer goes to ▶.
  const play = page.locator("#pv-play");
  await play.hover();
  await expect(page.locator(".pv-label")).toContainText(/rendering (after|in)/);
  await expect(j).toHaveClass(/\bpreviewed\b/);
  await play.click();
  await expect(page.locator(".pv-label")).toContainText(/hear it (after|in)/, { timeout: 30_000 });
  // One render, for the socket the pointer rested on — ▶ did not ask for
  // another one somewhere else.
  expect(await page.evaluate(() => window.__pwIO.previews)).toEqual([key]);
  await slow(page, {});
  expect(errors).toEqual([]);
});

test("HOLD, the octave buttons and notes leave the arp drawer open", async ({ page }) => {
  const errors = await boot(page);
  await openPreset(page, "Glass Pad");
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
  expect(errors).toEqual([]);
});

test("with SYNC on, a sequencer's RATE reads the division it plays", async ({ page }) => {
  const errors = await boot(page);
  await openPreset(page, "Loom");
  const rate = page.locator('#rack-svg g[data-addr$="#srate"]').first();
  await expect(rate).toHaveCount(1);
  const free = await rate.locator(".knob-value").textContent();
  expect(free).toMatch(/Hz$/);
  await page.locator("#sync-btn").click();
  await expect(rate.locator(".knob-value")).toHaveText(/Hz sync$/);
  await expect(rate).toHaveAttribute("aria-valuetext", /synced to \d+ BPM/);
  await page.locator("#sync-btn").click();
  await expect(rate.locator(".knob-value")).toHaveText(free);
  expect(errors).toEqual([]);
});

test("step bars and LENGTH drawn in quick succession under a slow engine all land (Loom)", async ({ page }) => {
  const errors = await boot(page);
  await openPreset(page, "Loom");
  const bars = page.locator("#rack-svg g.step-bar[data-addr]");
  expect(await bars.count()).toBeGreaterThanOrEqual(2);
  const slen = await page.evaluate(() => {
    const g = document.querySelector('#rack-svg g[data-addr$="#slen"]');
    const r = g.querySelector(":scope > .knob-hit").getBoundingClientRect();
    return { addr: g.dataset.addr, x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await slow(page, { edit_param: 1500 });
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
  await page.waitForTimeout(120);
  await draw(1, 0.15);
  await page.waitForTimeout(120);
  await dragKnob(page, slen, 150, 6); // all the way up: 8 steps
  const want = await page.evaluate((as) => as.map((a) =>
    Number(document.querySelector(`#rack-svg g[data-addr="${CSS.escape(a)}"]`).getAttribute("aria-valuenow"))), addrs);
  await settled(page);
  await slow(page, {});
  await expect(page.locator(`#rack-svg g[data-addr="${slen.addr}"] .knob-value`)).toHaveText("8 steps");
  expect(await rackValue(page, addrs[0])).toBeCloseTo(want[0], 2);
  expect(await rackValue(page, addrs[1])).toBeCloseTo(want[1], 2);
  const committed = await commitAndDescribe(page);
  expect(committed[slen.addr]).toBeCloseTo(1, 2);
  expect(committed[addrs[0]]).toBeCloseTo(want[0], 2);
  expect(committed[addrs[1]]).toBeCloseTo(want[1], 2);
  expect(errors).toEqual([]);
});
