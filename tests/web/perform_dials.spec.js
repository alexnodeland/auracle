// PERFORM's dials and the pads beside them (#532, #523).
//
// - A control's caption names its knobs in the rack's words (its
//   description's labels: "cutoff", "mod depth", with the module where two
//   share a name), from the moment a sound opens, and never says a word
//   twice. A sound opens in the click's task and the bench's rack of it
//   comes back about a render later; the captions were drawn in that gap
//   from the rack still there, the last sound's, and read the knobs' sites
//   ("cut · cut +1", "attack · dec +2") until a re-measurement repainted
//   them, seconds later ("filter cutoff +2", "attack +3"). A pool sound's
//   names now ride with its tree, and a preset's rack ships with its wiring:
//   each caption is the same before the bench's rack lands as after, and as
//   PERFORM drawn afresh. Every caption shown is read, by an observer
//   installed before boot: a read after the open would miss the gap.
// - A dial or the XY pad pressed with the mouse takes the focus with no
//   ring, once a key has been pressed too (any key in Chromium, Tab in
//   Firefox, made focus a script gives count as the keyboard's: the ring
//   came up under the mouse). A dial reached with Tab still shows it, and
//   its arrows still turn it.
// - PEEK and TAKE pressed (by their keys: the pads wait, dashed) while an
//   offer grows say it is still growing, not "Nothing offered yet", and the
//   toasts go as it lands. B held until the offer lands plays it at once,
//   all of B; TAKE pressed while it grew takes nothing. Every offer is kept
//   from the engine (the tap's `holdRequests`, from boot, so a spare cannot
//   land first) and B's is answered by the spec.
const { readFileSync } = require("fs");
const path = require("path");
const { test, expect, goLevel, bankTab, PERFORM_SEED } = require("./fixtures");

// The sites a caption printed in the gap where the rack's labels belong:
// none is a word of a knob's name. On the app before the fix a preset's
// controls painted once, in the gap, and were not painted again (Glass Pad:
// "cut", "mdepth · rate +2"), so `oneEach` passed for the presets: this
// check, and the one for a word said twice, are what fail them.
const STEMS = /\b(cut|res|mdepth|dec|att|det|smix|crate|cdepth|cmix|thresh|rmix|rsize|rdamp|dmix|fb|fkind|dsamp)\b/;
// A caption that names knobs (not one of a control's states).
const NAMES_KNOBS = (t) => !!t && !/…|^turns toward|^let go|^turn further|^after you let go|^in a moment/.test(t);
// The words of a caption, without its separators and its count.
const wordsOf = (t) => t.split(/\s+/).filter((w) => w && w !== "·" && w !== "/" && !/^\+\d+$/.test(w));
// The presets' wirings and racks the app ships.
const WIRINGS = JSON.parse(readFileSync(path.join(__dirname, "../../apps/web/perform-wirings.json"), "utf8"));
const PRESETS = ["Glass Pad", "Acid Line", "Cathedral", "Reese"];

// Each pool member's tree as main was last handed it (`trees`, beside the
// rows), by id: the knob names that ride with it (`names`, [addr, module,
// label]), and its shape and the wiring the engine predicted for it
// (`first`). A wrapper outside the fixture's tap, its listener ahead of
// main.js's own.
function recordTrees() {
  window.__trees = new Map();
  const Orig = window.Worker;
  function Wrapped(url, opts) {
    const w = new Orig(url, opts);
    if (/worker\.js/.test(String(url))) {
      w.addEventListener("message", (e) => {
        const d = e.data || {};
        for (const [id, t] of Object.entries(d.trees || (d.views && d.views.trees) || {})) {
          const first = t.first || {};
          window.__trees.set(Number(id), { json: t.json, names: t.names, shape: first.shape, wiring: (first.predicted && first.predicted.wiring) || [] });
        }
      });
    }
    return w;
  }
  Wrapped.prototype = Orig.prototype;
  window.Worker = Wrapped;
}

// Up to two pool members, by id (so the choice holds on any seed), whose
// captions must name a module from the click: a control of the wiring
// predicted for each whose first knob shares its name with another of its
// knobs, so its caption names that knob's module ("env / out attack +3",
// `knobNames`). Without the names that ride with the tree, it said
// "attack · sustain +2" until the bench's rack landed. None whose shape a
// measured sound shares (a preset's, `shapes`, or one PERFORM asked to
// measure here, `measured`): it would play that sound's wiring
// (`relativeWiring`), not this one. Names unlike each other's and the
// presets', as the captions are read by name. `{ id, name, index, says }`:
// the control's palette index, and the name its caption starts with.
function telling(page, shapes, measured) {
  return page.evaluate(([shapes, measured, taken]) => {
    const sound = (j) => {
      try {
        return JSON.stringify(JSON.parse(j), (k, v) => (k === "uid" ? undefined : v));
      } catch {
        return j;
      }
    };
    const heard = new Set(measured.map(sound));
    const near = new Set(shapes);
    for (const t of window.__trees.values()) if (heard.has(sound(t.json))) near.add(t.shape);
    const nameOf = (k) => String(k.label || "").split(" · ")[0].toLowerCase();
    const out = [];
    for (const [id, t] of window.__trees) {
      const name = document.querySelector(`#bank-list .bank-item[data-id="${id}"] .bi-name`)?.textContent.trim();
      if (!name || !t.names || near.has(t.shape) || taken.includes(name) || out.some((o) => o.name === name)) continue;
      const by = new Map(t.names.map(([a, module, label]) => [a, { module, label }]));
      const w = t.wiring.find((w) => {
        const ks = (w.knobs || []).map(([a]) => by.get(a));
        return ks.length > 1 && ks.every(Boolean) && ks[0].module && ks.slice(1).some((k) => nameOf(k) === nameOf(ks[0]));
      });
      if (!w) continue;
      const k = by.get(w.knobs[0][0]);
      out.push({ id, name, index: w.index, says: `${k.module.toLowerCase()} ${nameOf(k)}` });
    }
    return out.slice(0, 2);
  }, [shapes, measured, PRESETS]);
}

test("a control's caption names its knobs in the rack's words from the moment a sound opens, and never says a word twice", async ({ page, app }) => {
  await page.addInitScript(recordTrees);
  // Every caption the six controls show, with the sound PERFORM names.
  await page.addInitScript(() => {
    window.__captions = [];
    const was = new Map();
    const read = () => {
      const name = document.querySelector(".pf-name")?.textContent || "";
      for (const sub of document.querySelectorAll(".pf-knob[data-index] .pf-k-sub")) {
        const i = sub.parentElement.parentElement.dataset.i;
        const t = sub.textContent;
        if (was.get(i) === `${name}|${t}`) continue;
        was.set(i, `${name}|${t}`);
        window.__captions.push({ name, i, t });
      }
    };
    new MutationObserver(read).observe(document, { subtree: true, childList: true, characterData: true });
  });
  await app.boot({ seed: PERFORM_SEED, random: PERFORM_SEED });
  await goLevel(page, "perform");
  await app.reached();
  const frames = () => page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
  // Each control's knob-naming captions while `name` was the sound shown:
  // one, the same before the bench's rack of it landed as after.
  const oneEach = async (name) => {
    const shown = await page.evaluate((n) => window.__captions.filter((c) => c.name === n), name);
    const byDial = {};
    for (const c of shown.filter((c) => NAMES_KNOBS(c.t))) (byDial[c.i] ||= new Set()).add(c.t);
    console.log(`[perform_dials] ${name}: ${JSON.stringify(Object.fromEntries(Object.entries(byDial).map(([i, s]) => [i, [...s]])))}`);
    expect(Object.keys(byDial).length, `${name}: some control names its knobs`).toBeGreaterThan(0);
    for (const [i, said] of Object.entries(byDial)) expect([...said], `${name}: control ${i}'s caption`).toHaveLength(1);
  };
  // What the controls say, captions and tooltips (*raises filter cutoff*).
  const said = () =>
    page.evaluate(() => [...document.querySelectorAll(".pf-knob[data-index]")].map((k) => `${k.querySelector(".pf-k-sub").textContent} | ${k.title}`));
  for (const name of PRESETS) {
    // Its shipped wiring stays the one in hand: the re-check it is owed
    // never reaches the engine, so a caption changes only with the words.
    await app.stall("perform_wire");
    await bankTab(page, "presets");
    await page.locator(".bank-item", { hasText: name }).first().click();
    await app.engine((timeout) => expect(page.locator("#rack-subject")).toContainText(name, { timeout }), { ms: 90_000 });
    await expect(page.locator(".pf-name")).toHaveText(name);
    // The bench's rack has landed, and the frame after it painted.
    await frames();
    await oneEach(name);
  }
  // Pool sounds, whose racks do not ship, opened from the bank, their
  // guesses' measurements stalled as the presets' re-checks are: two whose
  // captions name a module only with the names that ride with their trees
  // (`telling`). Once the bench's rack has landed, their controls also say
  // what PERFORM drawn afresh says (a trip to PATCH and back paints every
  // control again).
  await bankTab(page, "pool");
  await app.poolRows(40);
  const measured = (await app.sent({ type: "perform_wire" })).map((m) => m.tree);
  const chosen = await telling(page, WIRINGS.presets.map((p) => p.shape), measured);
  console.log(`[perform_dials] pool members whose captions name a module: ${JSON.stringify(chosen)}`);
  expect(chosen.length, "a pool member whose caption names a module").toBeGreaterThan(0);
  for (const { id, name, index, says } of chosen) {
    await app.stall("perform_wire");
    await page.locator(`#bank-list .bank-item[data-id="${id}"]`).click();
    await app.engine((timeout) => expect(page.locator("#rack-subject")).toContainText(name, { timeout }), { ms: 90_000 });
    await expect(page.locator(".pf-name")).toHaveText(name);
    await frames();
    await oneEach(name);
    // The control chosen for it named its first knob's module from the
    // click, before the bench's rack of it landed as after.
    const at = await page.locator(`.pf-knob[data-index="${index}"]`).getAttribute("data-i");
    const told = await page.evaluate(([n, i]) => window.__captions.filter((c) => c.name === n && c.i === i).map((c) => c.t), [name, at]);
    expect([...new Set(told.filter(NAMES_KNOBS))], `${name}: control ${at}'s caption, from the click`).toEqual([expect.stringContaining(says)]);
    const landed = await said();
    await goLevel(page, "patch");
    await goLevel(page, "perform");
    expect(await said(), `${name}: its controls once its rack landed, against PERFORM drawn afresh`).toEqual(landed);
  }
  const all = (await page.evaluate(() => window.__captions)).filter((c) => NAMES_KNOBS(c.t));
  const stems = all.filter((c) => STEMS.test(c.t)).map((c) => `${c.name}: ${c.t}`);
  expect(stems, "captions that print a knob's site").toEqual([]);
  const twice = all.filter((c) => new Set(wordsOf(c.t)).size !== wordsOf(c.t).length).map((c) => `${c.name}: ${c.t}`);
  expect(twice, "captions that say a word twice").toEqual([]);
});

test("a dial or the XY pad pressed with the mouse shows no focus ring, and a dial reached with Tab shows one", async ({ page, app }) => {
  await app.boot({ seed: PERFORM_SEED, random: PERFORM_SEED });
  await goLevel(page, "perform");
  await app.reached();
  const dial = page.locator('.pf-knob[data-i="0"]');
  // A key first: after one, focus a script gives counts as the keyboard's
  // (Tab in Firefox, any key in Chromium), and that drew the ring.
  await page.keyboard.press("Tab");
  const b = await dial.boundingBox();
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 3;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 30, { steps: 5 });
  // Held: the dial has the keys, and no ring.
  await expect(dial).toBeFocused();
  await expect(dial).toHaveCSS("outline-style", "none");
  await page.mouse.up();
  // Let go: a pointer's turn leaves no focus (↵ is KEEP).
  await expect(dial).not.toBeFocused();
  await expect(dial).toHaveCSS("outline-style", "none");

  // The XY pad, the same: pressed after a key, it keeps the focus (its
  // arrows), with no ring.
  await page.locator(".pf-xy-btn").click();
  const field = page.locator(".pf-xy-field");
  await expect(field).toBeVisible();
  await page.keyboard.press("Tab");
  const f = await field.boundingBox();
  await page.mouse.move(f.x + f.width * 0.3, f.y + f.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(f.x + f.width * 0.6, f.y + f.height * 0.4, { steps: 5 });
  await expect(field).toBeFocused();
  await expect(field).toHaveCSS("outline-style", "none");
  await page.mouse.up();
  await expect(field).toHaveCSS("outline-style", "none");
  await page.locator(".pf-xy-btn").click();
  await expect(field).toBeHidden();

  // Reached with the keyboard (Shift+Tab back from the next dial), the ring
  // shows, and the arrows turn it.
  await page.locator('.pf-knob[data-i="1"]').focus();
  await page.keyboard.press("Shift+Tab");
  await expect(dial).toBeFocused();
  await expect(dial).toHaveCSS("outline-style", "solid");
  const before = await dial.getAttribute("aria-valuetext");
  await page.keyboard.press("ArrowUp");
  await expect(dial).not.toHaveAttribute("aria-valuetext", before);
  await expect(dial).toHaveCSS("outline-style", "solid");
});

test("PEEK and TAKE pressed while an offer grows say it is growing until it lands, B held until then plays all of it, and TAKE takes nothing", async ({ page, app }) => {
  // What B is told to play at, each time (the worklet's `b_mix`), and the
  // toasts on screen the moment B holds the offer (read after the task that
  // put it there, so a toast that task took down is gone).
  await page.addInitScript(() => {
    window.__bMix = [];
    const post = MessagePort.prototype.postMessage;
    MessagePort.prototype.postMessage = function (m, ...rest) {
      if (m && m.type === "b_mix") window.__bMix.push(m.mix);
      return post.call(this, m, ...rest);
    };
    window.__toastsAsBLanded = null;
    new MutationObserver(() => {
      if (window.__toastsAsBLanded || !document.querySelector(".pf-offer.ready")) return;
      window.__toastsAsBLanded = [...document.querySelectorAll("#toasts .toast:not(.out) .toast-msg")].map((t) => t.textContent);
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ["class"] });
  });
  // Every offer kept from the engine, from boot: a spare grown ahead too.
  await app.holdRequests("perform_offer");
  await app.boot({ seed: PERFORM_SEED, random: PERFORM_SEED });
  await app.openOnPerform("Glass Pad");
  await page.keyboard.press("n");
  const b = page.locator(".pf-offer");
  await expect(b).toContainText("growing an offer…");
  const t0 = await app.toastMark();
  // PEEK held (its key: the pad waits, dashed), then TAKE.
  await page.keyboard.down("b");
  await app.toast("Still growing an offer. Keep holding Peek to hear it as it lands.", { since: t0 });
  await page.keyboard.press("Shift+Enter");
  await app.toast("Still growing an offer. Take it once it’s in B.", { since: t0 });
  const said = await app.toasts(t0);
  expect(said.filter((t) => /Nothing offered/.test(t)), "nothing said there was nothing offered").toEqual([]);
  const lastMix = () => page.evaluate(() => window.__bMix[window.__bMix.length - 1]);
  // B lands, B still held: every offer out is answered with Glass Pad's own
  // tree, which B then plays.
  const glass = WIRINGS.presets.find((p) => p.name === "Glass Pad");
  const out = await app.sent({ type: "perform_offer" });
  expect(out.length, "an offer is out").toBeGreaterThan(0);
  for (const m of out) await app.inject({ type: "perform_offered", req: m.req, re: m.rid, offer: { tree: JSON.parse(m.tree), makeup: glass.makeup, taste: false, diff: [] } });
  await expect(b).toHaveClass(/\bready\b/);
  // The toasts said B was growing: they went as it landed, not when their
  // window ran out (4.2 s on, beside the offer B showed). This reads the one
  // on screen (TAKE's, which took the floor); PEEK's, waiting behind it, is
  // taken out of the queue by the same drop, which toasts.test.mjs holds
  // ("drop: a toast taken back goes at once").
  const asItLanded = await page.evaluate(() => window.__toastsAsBLanded);
  expect(asItLanded, "the toasts on screen as B landed").not.toBeNull();
  expect(asItLanded.filter((t) => /Still growing/.test(t)), "a toast still saying B is growing as it lands").toEqual([]);
  await expect.poll(lastMix, { message: "B is all of what is heard while PEEK is held" }).toBe(1);
  await page.keyboard.up("b");
  await expect.poll(lastMix, { message: "let go, B goes back to Blend's home" }).toBe(0);
  // TAKE pressed while it grew took nothing: B is still in B.
  await expect(page.locator(".pf-name")).toHaveText("Glass Pad");
  await expect(b).toHaveClass(/\bready\b/);
});
