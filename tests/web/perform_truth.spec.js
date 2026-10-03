// PERFORM says what is true, and a gesture on a control does what its look
// says it will.
//
// Pinned in a real browser against the real engine, on Glass Pad, whose
// measured wiring is deterministic: Bright turns both ways, some controls turn
// only one way (half-closed) and some are search controls.
//
// - A half-closed control's ring is drawn on the side it turns toward (it was
//   drawn on the closed side), with a stop at 12 o'clock, and its caption says
//   what the player can do ("turns toward far only"), not where the app
//   guessed the sound sits.
// - A control not measured yet is "listening…": never the search look (its
//   ring stays neutral; only its waiting sign is amber, while a measurement is
//   out), no strike-through on the XY pad, and a turn of it springs back
//   without grafting a module or growing an offer.
// - Choosing an XY axis gives the note keys back.
// - A search control springs back whenever it is let go, and says while it is
//   turned what letting go would do.
// - After a pass, Blend comes home.
// - A stalled fetch of the shipped wirings does not hold a patch on
//   "listening…": after a few seconds it is measured as any other patch is.
// - A drift is not a new patch: the status never says "listening", and the
//   re-measure after it waits in the engine's background lane.
//
// A spec reaches the engine only by wrapping `Worker` before `main.js` runs:
// here, to record what PERFORM asks it for.
const { test, expect } = require("@playwright/test");
const { goLevel, bankTab } = require("./shell");
const budget = require("./perform_budget.js");

const INIT = `(() => {
  const Orig = window.Worker;
  const posts = (window.__pfPosts = []);
  function Wrapped(url, opts) {
    const w = new Orig(url, opts);
    if (/worker\\.js/.test(String(url))) {
      const post = w.postMessage.bind(w);
      w.postMessage = (m, t) => {
        if (m && typeof m.type === "string" && /^perform_/.test(m.type))
          posts.push({ type: m.type, bg: !!m.bg, t: performance.now() });
        return post(m, t);
      };
    }
    return w;
  }
  Wrapped.prototype = Orig.prototype;
  window.Worker = Wrapped;
})();`;

// `shipped: false` blocks the presets' shipped wirings, so a preset is
// measured as a patch never seen before is: the only way to watch a
// measurement in progress on a known patch.
// `stalled: true` holds the file's fetch open for good, as a stuck connection
// does.
async function boot(page, { shipped = true, stalled = false } = {}) {
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  if (!shipped) await page.route("**/perform-wirings.json*", (r) => r.abort());
  if (stalled) await page.route("**/perform-wirings.json*", () => {});
  await budget.watch(page);
  await page.addInitScript(INIT);
  await page.goto("/");
  await expect(page.locator("#boot")).toHaveClass(/\bdone\b/, { timeout: 120_000 });
  await page.locator("#warm-skip").click();
  return errs;
}

/** Open a preset from the library and go to PERFORM, without waiting for it
 *  to be measured. */
async function openOnPerform(page, name) {
  await bankTab(page, "presets");
  await page.locator(".bank-item", { hasText: name }).first().click();
  await page.waitForFunction((n) => (document.getElementById("rack-subject")?.textContent || "").includes(n), name, { timeout: 90_000 });
  await goLevel(page, "perform");
  await expect(page.locator(".pf-name")).toHaveText(name, { timeout: 30_000 });
}

async function wired(page) {
  await page.waitForFunction(
    () =>
      /controls reach/.test(document.querySelector(".pf-status")?.textContent || "") &&
      ![0, 1, 2, 3, 4, 5].some((i) => document.querySelector(`.pf-knob[data-i="${i}"]`)?.classList.contains("unwired")),
    null,
    { timeout: 120_000 },
  );
}

/** Drag a knob vertically by `dy` px (negative is up), and let go. */
async function drag(page, loc, dy, { hold } = {}) {
  const b = await loc.boundingBox();
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + dy, { steps: 10 });
  if (hold) await hold();
  await page.mouse.up();
}

test("a half-closed control draws its ring on the side it turns toward, and says so", async ({ page }) => {
  test.setTimeout(300_000);
  const errs = await boot(page);
  await openOnPerform(page, "Glass Pad");
  await wired(page);

  const halves = await page.evaluate(() =>
    [...document.querySelectorAll(".pf-knob.half-lo, .pf-knob.half-hi")].map((k) => {
      const ends = (p) => {
        const n = (p.getAttribute("d") || "").match(/-?\d+(\.\d+)?/g).map(Number);
        return [[n[0], n[1]], [n[n.length - 2], n[n.length - 1]]];
      };
      const lo = k.querySelector(".pf-k-lo");
      const hi = k.querySelector(".pf-k-hi");
      const up = k.classList.contains("half-lo"); // the low half is closed: it turns up
      const open = up ? hi : lo;
      const closed = up ? lo : hi;
      return {
        name: k.querySelector(".pf-k-name").textContent,
        up,
        words: k.querySelector(".pf-k-ends").textContent.split(" · "),
        sub: k.querySelector(".pf-k-sub").textContent,
        openCls: open.getAttribute("class"),
        closedCls: closed.getAttribute("class"),
        openEnds: ends(open),
        openDash: getComputedStyle(open).strokeDasharray,
        openWidth: parseFloat(getComputedStyle(open).strokeWidth),
        closedDash: getComputedStyle(closed).strokeDasharray,
        closedWidth: parseFloat(getComputedStyle(closed).strokeWidth),
        stop: getComputedStyle(k.querySelector(".pf-k-stop")).display,
        dot: k.querySelector(".pf-k-where title")?.textContent || "",
        valuetext: k.getAttribute("aria-valuetext"),
      };
    }),
  );
  expect(halves.length, "Glass Pad has a half-closed control").toBeGreaterThan(0);
  for (const h of halves) {
    // The open half runs from 12 o'clock (0, -44) toward the side it turns.
    expect(h.openCls, h.name).toContain("open");
    expect(h.closedCls, h.name).toContain("closed");
    const xs = h.openEnds.map(([x]) => x);
    if (h.up) expect(Math.min(...xs), `${h.name}: open ring on the right`).toBeGreaterThan(-0.5);
    else expect(Math.max(...xs), `${h.name}: open ring on the left`).toBeLessThan(0.5);
    expect(h.openEnds.some(([x, y]) => Math.abs(x) < 0.5 && y < -40), `${h.name}: open half starts at the stop`).toBe(true);
    // Solid and wide on the open side, a dotted hairline on the closed one.
    expect(h.openDash, h.name).toBe("none");
    expect(h.closedDash, h.name).not.toBe("none");
    expect(h.openWidth).toBeGreaterThan(h.closedWidth);
    expect(h.stop, `${h.name}: a stop at 12 o'clock`).not.toBe("none");
    // The caption says what the player can do, in the open end's word.
    expect(h.sub, h.name).toBe(`turns toward ${h.up ? h.words[1] : h.words[0]} only`);
    expect(h.dot, `${h.name}: the amber dot says what it is`).toMatch(/where this sound measures on/);
    expect(h.valuetext).toBe("center");
  }

  // Driven into its stop, the pointer bumps (and the dial stays at centre).
  const half = page.locator(".pf-knob.half-lo, .pf-knob.half-hi").first();
  const up = halves[0].up;
  await page.evaluate(() => {
    window.__bumps = 0;
    const k = document.querySelector(".pf-knob.half-lo, .pf-knob.half-hi");
    new MutationObserver(() => {
      if (/\bbump-(lo|hi)\b/.test(k.className)) window.__bumps += 1;
    }).observe(k, { attributes: true, attributeFilter: ["class"] });
  });
  await drag(page, half, up ? 90 : -90);
  expect(await half.getAttribute("aria-valuenow")).toBe("0.00");
  expect(await page.evaluate(() => window.__bumps), "the stop was felt").toBeGreaterThan(0);
  expect(errs).toEqual([]);
});

test("a control still being listened to does nothing, and never looks or acts like a search control", async ({ page }) => {
  test.setTimeout(300_000);
  const errs = await boot(page, { shipped: false });
  await openOnPerform(page, "Glass Pad");
  // A fresh profile has no wiring cached: the first measurement takes seconds.
  await expect(page.locator(".pf-status")).toContainText("listening to this sound", { timeout: 30_000 });
  expect(await page.locator(".pf-status").textContent()).not.toMatch(/measuring/);

  const look = await page.evaluate(() => {
    const ks = [0, 1, 2, 3, 4, 5].map((i) => document.querySelector(`.pf-knob[data-i="${i}"]`));
    const field = document.querySelector(".pf-xy-field");
    return {
      subs: ks.map((k) => k.querySelector(".pf-k-sub").textContent),
      pending: ks.every((k) => k.classList.contains("pending")),
      search: ks.some((k) => k.classList.contains("search")),
      dead: /\bdead-[xy]\b/.test(field.className),
      struck: [...field.querySelectorAll(".pf-xy-l, .pf-xy-r, .pf-xy-t, .pf-xy-b")].some((e) => getComputedStyle(e).textDecorationLine.includes("line-through")),
      note: field.querySelector(".pf-xy-note").textContent,
    };
  });
  expect(look.subs).toEqual(Array(6).fill("listening…"));
  expect(look.pending).toBe(true);
  expect(look.search, "no amber search look while listening").toBe(false);
  expect(look.dead, "no dead XY axis while listening").toBe(false);
  expect(look.struck, "no struck-through XY words while listening").toBe(false);
  expect(look.note).toBe("listening to this sound…");

  // Turn Grit hard (a search control on Glass Pad, once measured) and let go.
  const grit = page.locator('.pf-knob[data-i="4"]');
  const before = await page.evaluate(() => window.__pfPosts.length);
  await drag(page, grit, -120);
  expect(await page.locator(".pf-status").textContent(), "still listening when it was turned").toContain("listening to this sound");
  await expect(grit).toHaveAttribute("aria-valuenow", "0.00");
  await page.waitForTimeout(1500);
  const asked = await page.evaluate((n) => window.__pfPosts.slice(n).filter((p) => p.type === "perform_graft" || (p.type === "perform_offer" && !p.bg)), before);
  expect(asked, "a turn while listening grafts nothing and grows no offer").toEqual([]);
  expect(await page.locator("#toasts").textContent()).not.toMatch(/growing an offer|giving it a/);
  expect(errs).toEqual([]);
});

test("first steps name a control that turns on this patch, and speak alone", async ({ page }) => {
  test.setTimeout(300_000);
  const errs = await boot(page);
  // A newcomer, at PERFORM, where the app opens: step 1 says what the keybed
  // coach would, so the coach keeps quiet. In PATCH it is up until the first
  // note.
  await expect(page.locator("#guide .pf-steps")).toBeVisible();
  await expect(page.locator(".coach")).toBeHidden();
  await goLevel(page, "patch");
  await expect(page.locator(".coach")).toBeVisible();
  await openOnPerform(page, "Glass Pad");
  await expect(page.locator("#guide .pf-steps")).toBeVisible();
  // One voice per lesson: step 1 says what the coach says.
  await expect(page.locator(".coach")).toBeHidden();
  await wired(page);
  // Back in PATCH the coach speaks again (until the first note).
  await goLevel(page, "patch");
  await expect(page.locator(".coach")).toBeVisible();
  await goLevel(page, "perform");
  // The pill shows one step at a time: a note played, step 2 is next (and
  // the note retires the coach for good).
  await expect(page.locator("#guide .pf-step.now")).toContainText("Play a key");
  await page.keyboard.press("a");
  await expect(page.locator("#guide .pf-step.now")).toContainText(/^Turn /);
  const step2 = (await page.locator("#guide .pf-step.now").textContent()).trim();
  const m = step2.match(/Turn ([A-Z]+): drag (up or down|up|down)$/);
  expect(m, step2).not.toBeNull();
  const k = page.locator(".pf-knob", { has: page.locator(".pf-k-name", { hasText: new RegExp(`^${m[1]}$`, "i") }) });
  await expect(k).toHaveCount(1);
  const cls = await k.getAttribute("class");
  expect(cls, `${m[1]} turns on this patch`).not.toMatch(/\b(search|pending|unwired)\b/);
  if (m[2] === "up or down") expect(cls).not.toMatch(/\bhalf-(lo|hi)\b/);
  expect(errs).toEqual([]);
});

test("choosing an XY axis gives the note keys back", async ({ page }) => {
  test.setTimeout(300_000);
  const errs = await boot(page);
  await openOnPerform(page, "Glass Pad");
  await page.locator(".pf-xy-btn").click();
  const ysel = page.locator(".pf-xy-head select").nth(1);
  // As a click does: the select has focus when the choice is made.
  await ysel.focus();
  await ysel.selectOption("5");
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("SELECT");
  // `a` plays middle C and lights its key; `s` is a note too, and must not
  // type-ahead the axis to Snap or Space.
  await page.keyboard.down("a");
  await expect(page.locator('.pkey[data-note="60"]')).toHaveClass(/\bdown\b/);
  await page.keyboard.up("a");
  await page.keyboard.press("s");
  expect(await ysel.inputValue()).toBe("5");
  expect(errs).toEqual([]);
});

test("a search control springs back when let go, and says what letting go will do", async ({ page }) => {
  test.setTimeout(300_000);
  const errs = await boot(page);
  await openOnPerform(page, "Glass Pad");
  await wired(page);
  const grit = page.locator('.pf-knob[data-i="4"]');
  await expect(grit, "Grit is a search control on Glass Pad").toHaveClass(/\bsearch\b/);
  const sub = grit.locator(".pf-k-sub");
  const notch = grit.locator(".pf-k-notch");

  // A nudge: short of the notch, it asks nothing and springs back.
  let during = "";
  let notchShown = "";
  await drag(page, grit, -25, {
    hold: async () => {
      during = await sub.textContent();
      notchShown = await notch.evaluate((e) => getComputedStyle(e).display);
    },
  });
  expect(during).toBe("turn further to ask");
  expect(notchShown).not.toBe("none");
  await expect(grit).toHaveAttribute("aria-valuenow", "0.00");
  await expect(sub).toHaveText("turn to ask for it");
  expect(await page.locator("#toasts").textContent()).not.toMatch(/growing an offer/);

  // Past it: the caption says what letting go asks for, and letting go asks.
  await drag(page, grit, -90, { hold: async () => { during = await sub.textContent(); } });
  expect(during).toBe("let go to ask for rough");
  await expect(grit).toHaveAttribute("aria-valuenow", "0.00");
  // A refusal answering the turn: it takes the lane at once, ahead of the
  // preset's own arrival toasts still queued.
  await expect(page.locator("#toasts")).toContainText("growing a grittier offer instead", { timeout: 5_000 });
  expect(errs).toEqual([]);
});

test("after a pass, Blend comes home", async ({ page }) => {
  test.setTimeout(300_000);
  const errs = await boot(page);
  await openOnPerform(page, "Glass Pad");
  await wired(page);
  const OFFER_MS = await budget.offerBudget(page, { waits: 1 });
  await page.locator(".pf-pad", { hasText: "Offer" }).click();
  await page.waitForSelector(".pf-offer.ready", { timeout: OFFER_MS });
  // Blend, the slider under the two faces, toward B.
  const blend = page.locator('.pf-blend[data-i="6"] input');
  await blend.focus();
  await page.keyboard.press("End");
  expect(Number(await blend.getAttribute("aria-valuenow"))).toBeGreaterThan(0.5);
  // NEXT (Offer, while B holds one) is a pass: B empties, and Blend glides
  // home.
  await expect(page.locator(".pf-pad.primary")).toHaveText("Next");
  await page.locator(".pf-pad", { hasText: "Next" }).click();
  await expect(blend).toHaveAttribute("aria-valuenow", "0.00", { timeout: 2_000 });
  await expect(page.locator('.pf-blend[data-i="6"] .pf-blend-v')).toHaveText(/^(no offer yet|0% offer)$/);
  expect(errs).toEqual([]);
});

test("a drift is not a new patch: the status never says listening, and its re-check waits in the background", { tag: "@slow" }, async ({ page }) => {
  test.setTimeout(360_000);
  const errs = await boot(page);
  await openOnPerform(page, "Glass Pad");
  await wired(page);
  // A drift waits behind the shipped wiring's background re-check, then
  // walks twelve renders: engine growth, bounded by the budget.
  const DRIFT_MS = await budget.offerBudget(page, { waits: 1 });
  // Every status line from here on.
  await page.evaluate(() => {
    const s = document.querySelector(".pf-status");
    window.__statuses = [s.textContent];
    new MutationObserver(() => window.__statuses.push(s.textContent)).observe(s, { childList: true, characterData: true, subtree: true });
    // Wander says what it is doing under its own name.
    const w = document.querySelector('.pf-knob[data-i="7"] .pf-k-sub');
    window.__wander = [w.textContent];
    new MutationObserver(() => window.__wander.push(w.textContent)).observe(w, { childList: true, characterData: true, subtree: true });
  });
  const from = await page.evaluate(() => performance.now());
  // Wander all the way to roam, from the keyboard.
  const wander = page.locator('.pf-knob[data-i="7"]');
  await wander.focus();
  for (let i = 0; i < 20; i++) await page.keyboard.press("ArrowUp");
  await expect(wander.locator(".pf-k-sub")).toHaveText(/^roam/);
  await page.evaluate(() => document.activeElement?.blur()); // off the dial, hands off
  // A drift arrives and glides.
  await page.waitForFunction(() => window.__wander.some((t) => /gliding/.test(t)), null, { timeout: DRIFT_MS });
  // …and finishes: give the glide (3 s at most in roam) time to land.
  await page.waitForTimeout(4000);
  const seen = await page.evaluate(() => window.__statuses);
  expect(seen.filter((t) => /listening|measuring/.test(t)), "the dials never went back to waiting").toEqual([]);
  expect(await page.locator(".pf-name").textContent(), "the drift did not arrive as a new patch").toBe("Glass Pad");
  const wires = await page.evaluate((t) => window.__pfPosts.filter((p) => p.type === "perform_wire" && p.t > t), from);
  for (const w of wires) expect(w.bg, "a re-check after a drift is background work").toBe(true);
  if (wires.length) expect(seen.some((t) => /re-checking/.test(t)), "a re-check says so").toBe(true);
  // Keep: the sound did not move, so there is nothing to measure in front of
  // the player's next request.
  const k0 = await page.evaluate(() => performance.now());
  await wander.focus();
  await page.keyboard.press("Home"); // Wander still
  await page.locator(".pf-moved .pf-keep").click();
  await expect(page.locator("#toasts")).toContainText("Kept: this is home now. Back returns here.", { timeout: 10_000 });
  await page.waitForTimeout(1500);
  const afterKeep = await page.evaluate((t) => window.__pfPosts.filter((p) => p.type === "perform_wire" && p.t > t && !p.bg), k0);
  expect(afterKeep, "Keep never re-measures in front of the player").toEqual([]);
  expect(errs).toEqual([]);
});

test("a shipped-wirings fetch that never answers does not hold a patch on listening", async ({ page }) => {
  test.setTimeout(300_000);
  const errs = await boot(page, { stalled: true });
  const t0 = Date.now();
  await openOnPerform(page, "Glass Pad");
  await wired(page);
  console.log(`Glass Pad wired with the file stalled: ${((Date.now() - t0) / 1000).toFixed(1)} s after its click`);
  const how = await page.evaluate(() => window.__aur.marks().filter((m) => m.name === "perform-wired").map((m) => m.detail && m.detail.how));
  expect(how).toContain("measured");
  expect(await page.evaluate(() => window.__pfPosts.some((p) => p.type === "perform_wire"))).toBe(true);
  expect(errs).toEqual([]);
});
