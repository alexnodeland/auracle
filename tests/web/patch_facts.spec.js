// PATCH's four engine facts (Plan-008 C2b, round 2's "Engine facts, all
// four"), each drawn from the engine's own reply, at rest:
//
// - Without this module: the selected module's absence, measured. Over the
//   face at OUT, a dashed outline of the face of the patch the structure
//   menu's verb would leave (a processor bypassed, a source's socket empty, a
//   modulator unplugged), rendered by the worker (`face_of_tree`); a patch
//   that would be silent without it says so in the readout instead. Shown
//   again it is drawn again; its own module's knobs leave it up; and the
//   readout is not rewritten by a turn that changes nothing it says.
//
// - What goes here?: the selection's ⋯ (or Q on a module) asks the model's
//   guess for that module's place (`guess`'s `at`, which the page never sent
//   before); its ghost is drawn there with where it goes and its reason on
//   the well's top line, Enter takes it, Esc on it (or the line's ✕) goes
//   back to the output's, and it never takes the focus from a knob.
//
// - What a generation changed: on a bred sound as it was bred, the subtitle
//   names its seed and counts the changes, each changed module has a silk
//   tick and each changed knob a pale pointer at the seed's value, from its
//   `LineageEvent`; gone after an edit, back after undo to as opened.
//
// - Which PERFORM controls turn a knob: the readout names them for the knob
//   under the pointer ("BRIGHT and SPACE turn this cutoff"), and for a
//   module each control with its knobs, from PERFORM's measured wiring
//   (`perform_wire`).
//
// The worker is reached through the fixture's tap (fixtures.js): the faces
// a page asks for, with their trees, and every face it is handed back.
const { test, expect, goLevel } = require("./fixtures");
const { openPreset } = require("./patch_page.js");
const { FLOOR_MS } = require("./perform_budget.js");

/** Select a module on the canvas by its kind, as a press on its plate does. */
async function selectPlate(page, kind, nth = 0) {
  const plate = page.locator(`#rack-svg .rack-plates g[data-kind="${kind}"] .mod-plate`).nth(nth);
  const b = await plate.boundingBox();
  await page.mouse.click(b.x + 10, b.y + b.height - 6);
  await page.mouse.move(4, 400);
}

test("the face of the patch without the selected module is drawn at OUT, measured by the worker, and a patch silent without it says so", async ({ page, app }) => {
  await app.boot();
  // Hornet: a square VCO into a bandpass filter, a S&H modulating the cutoff.
  // The app opens at PERFORM, whose measurement of the sound it boots with
  // goes on in the background once PATCH shows: the outline does not wait
  // for it (a face the player is looking at goes first, `seen`).
  await openPreset(app, "Hornet");
  const out = page.locator("#out-without");
  const img = page.locator("#out-without img");
  await expect(out).toBeHidden();

  // The filter: bypassed, the VCO goes straight to the amp.
  await selectPlate(page, "filter");
  const key = await page.locator('#rack-svg .rack-plates g[data-kind="filter"]').getAttribute("data-key");
  await app.engine((timeout) => expect(out).toBeVisible({ timeout }), { ms: FLOOR_MS });
  await expect(img).toHaveCount(1);
  await expect(out).toHaveAttribute("data-of", key);
  const drawn = { ref: await out.getAttribute("data-face"), key: await out.getAttribute("data-key") };
  const got = await page.evaluate(({ ref, key: k }) => {
    const T = window.__tap;
    const ask = T.sent.filter((s) => s.type === "faces" && s.m.trees).flatMap((s) => s.m.trees).find((t) => t.ref === ref);
    const reply = T.replies.filter((r) => r.type === "faces" && !r.injected).flatMap((r) => r.d.items || []).find((it) => it.ref === ref);
    const bench = JSON.parse(T.last.bench.treeJson);
    // The bypass the structure menu makes: the filter's input in its place.
    const node = k === "node" ? bench.root : null;
    const expected = node ? JSON.stringify({ ...bench, root: node.Filter.input }) : null;
    return { asked: ask ? ask.tree || null : null, seen: ask ? !!ask.seen : null, replyKey: reply ? reply.key : null, expected };
  }, { ref: drawn.ref, key });
  expect(got.asked, "the outline's tree was asked of the worker").not.toBeNull();
  expect(got.seen, "…as a face the player is looking at").toBe(true);
  expect(got.expected, "Hornet's filter is its root").not.toBeNull();
  expect(got.asked, "…and it is the patch with the filter bypassed").toBe(got.expected);
  expect(got.replyKey, "the worker's own face for that tree is the one drawn").toBe(drawn.key);
  await expect(page.locator("#pt-read .pr-without")).toHaveCount(0);

  // The VCO is the only source: without it the patch is silent, which the
  // readout says, and nothing is drawn.
  await selectPlate(page, "vco");
  await expect(page.locator("#pt-read .pr-without")).toHaveText("silent without it");
  await expect(out).toBeHidden();

  // The filter again: the same face, drawn again (it was an empty box).
  await selectPlate(page, "filter");
  await app.engine((timeout) => expect(out).toBeVisible({ timeout }), { ms: 30_000 });
  await expect(img).toHaveCount(1);
  await expect(out).toHaveAttribute("data-key", drawn.key);

  // A knob of the selected filter leaves the patch without it as it was:
  // the outline stays, drawn, through the turn and after it.
  // And the readout (a polite live region), which says nothing new during
  // the turn, is not written again for it.
  const hit = page.locator('#rack-svg .rack-controls g[data-kind="filter"] [data-addr] > .knob-hit').first();
  const b = await hit.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await expect(page.locator("#pt-read .pr-name")).toHaveText(/filter/i);
  await page.evaluate(() => {
    window.__pwHid = 0;
    window.__pwDockWrites = 0;
    const el = document.getElementById("out-without");
    new MutationObserver(() => { if (el.hidden) window.__pwHid++; }).observe(el, { attributes: true, attributeFilter: ["hidden"] });
    new MutationObserver(() => { window.__pwDockWrites++; }).observe(document.getElementById("pt-read"), { childList: true });
  });
  const t0 = await app.now();
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 - 25, { steps: 5 });
  await page.mouse.up();
  await app.reply("bench", { after: t0 });
  await app.quiet(); // past the settle the outline is measured again after
  expect(await page.evaluate(() => window.__pwHid), "the outline never hid for its own module's knob").toBe(0);
  expect(await page.evaluate(() => window.__pwDockWrites), "the readout was not rewritten with the same words").toBe(0);
  await expect(img).toHaveCount(1);
  await expect(out).toHaveAttribute("data-key", drawn.key);

  // Nothing selected: nothing at OUT.
  await page.mouse.move(4, 400);
  await page.keyboard.press("Escape");
  await expect(out).toBeHidden();
  await expect(img).toHaveCount(0);
});

/** The newest ranking with a guess in it for a guess the page asked at `at`
 *  after `after` (an empty one, its time spent, is asked again). An engine
 *  wait. */
async function hereRanked(app, at, after, timeout = 120_000) {
  const find = ([a, t]) => {
    const T = window.__tap;
    const tokens = new Set(T.sent.filter((s) => s.type === "guess" && s.m.at === a && s.at >= t).map((s) => s.m.token));
    const r = T.replies.filter((x) => x.type === "guess" && !x.injected && tokens.has(x.d.token) && x.d.data && x.d.data.guesses && x.d.data.guesses.length).pop();
    return r ? { ...r.d, _at: r.at } : null;
  };
  let found = null;
  await app.engine((ms) => expect.poll(async () => (found = await app.page.evaluate(find, [at, after])) != null, { timeout: ms }).toBe(true), { ms: timeout });
  return found;
}

test("What goes here? asks the model's guess for a module's place, draws it there with where it goes, and Enter takes it", { tag: "@slow" }, async ({ page, app }) => {
  await app.boot({ warmed: false });
  await app.warmStart();
  // Reese: two VCOs into a mix, a filter, the amp; the mix is mid-chain.
  await openPreset(app, "Reese");
  const keyOf = (kind) => page.locator(`#rack-svg .rack-plates g[data-kind="${kind}"]`).first().getAttribute("data-key");
  const mixKey = await keyOf("mix");

  // The pointer: the mix's ⋯ › what goes here?
  await selectPlate(page, "mix");
  const t0 = await app.now();
  await page.locator('#rack-svg .rack-controls g[data-kind="mix"] .mod-menu-btn').first().click();
  await page.locator("#ctx-menu .cm-item", { hasText: /^what goes here/ }).click();
  // Asked for the mix's place: at once, or once a ranking for the output
  // already out comes back (one guess is out at a time).
  await app.engine((timeout) => expect.poll(async () => (await app.sent({ type: "guess", at: mixKey }, { after: t0 })).length,
    { timeout, message: "the guess is asked for the mix's place" }).toBeGreaterThan(0), { ms: 60_000 });
  // While it is ranked, the top line says what it is doing (or, on a fast
  // machine, the ranking is in already).
  await expect(page.locator("#guess-read")).toHaveText(/hearing the modules that fit at the mix…|^guess · /);
  const atMix = await hereRanked(app, mixKey, t0);
  const top = atMix.data.guesses[0];
  // Every guess it ranked is for that place: after the mix, or its slot.
  for (const g of atMix.data.guesses) expect(g.op.key, `${g.kind} ${g.op.op}`).toBe(mixKey);
  const ghost = page.locator("#rack-svg .guess-plate");
  await app.engine((timeout) => expect(ghost).toHaveAttribute("data-at", mixKey, { timeout }), { ms: 30_000 });
  await expect(ghost).toHaveAttribute("data-kind", top.kind);
  await expect(ghost).toHaveAttribute("data-socket", top.socket);
  await expect(page.locator("#guess-read .gr-chip")).toHaveText(/^guess · \S/);
  await expect(page.locator("#guess-read .gr-at")).toHaveText(top.op.op === "set_mod" ? /^on the mix’s / : /^after the mix$/);
  // Esc on the ghost goes back to the output's guess.
  await ghost.focus();
  const t1 = await app.now();
  await page.keyboard.press("Escape");
  await expect(page.locator("#guess-read .gr-at")).toHaveCount(0);
  await app.engine((timeout) => expect.poll(async () => (await app.sent({ type: "guess", at: false }, { after: t1 })).length, { timeout }).toBeGreaterThan(0), { ms: 30_000 });

  // Q on a VCO, then straight into its knobs: the ghost lands without taking
  // the focus from the knob. The pointer's way back is the line's ✕ (the
  // ghost's own × skips that kind of module for the place).
  const vcoKey = await keyOf("vco");
  await page.locator('#rack-svg .rack-controls g.mod-group[data-kind="vco"]').first().focus();
  const tv = await app.now();
  await page.keyboard.press("q");
  await page.keyboard.press("Enter");
  const onKnob = () => page.evaluate(() => !!document.activeElement?.closest?.("#rack-svg [data-addr], #rack-svg [data-stop]"));
  await expect.poll(onKnob).toBe(true);
  await hereRanked(app, vcoKey, tv);
  await app.engine((timeout) => expect(ghost).toHaveAttribute("data-at", vcoKey, { timeout }), { ms: 30_000 });
  expect(await onKnob(), "the focus stayed on the knob").toBe(true);
  const t4 = await app.now();
  await page.locator("#guess-read .gr-back").click();
  await expect(page.locator("#guess-read .gr-at")).toHaveCount(0);
  await app.engine((timeout) => expect.poll(async () => (await app.sent({ type: "guess", at: false }, { after: t4 })).length, { timeout }).toBeGreaterThan(0), { ms: 30_000 });

  // The keyboard: Q on the filter asks for its place; the ghost takes the
  // focus when it lands, and Enter adds it, through the edit lane.
  const filterKey = await keyOf("filter");
  await page.locator('#rack-svg .rack-controls g.mod-group[data-kind="filter"]').focus();
  const t2 = await app.now();
  await page.keyboard.press("q");
  const atFilter = await hereRanked(app, filterKey, t2);
  const g = atFilter.data.guesses[0];
  await app.engine((timeout) => expect(ghost).toHaveAttribute("data-at", filterKey, { timeout }), { ms: 30_000 });
  await expect(ghost).toHaveAttribute("data-kind", g.kind);
  await expect(ghost).toBeFocused();
  const t3 = await app.now();
  await page.keyboard.press("Enter");
  const landed = (await app.reply("bench", { where: { edited: "structure" }, after: t3, timeout: 60_000 }))._at;
  const [took] = await app.sent("edit_structure", { after: t3 });
  expect(took.op).toEqual(g.op);
  expect(took.guess && took.guess.socket).toBe(g.socket);
  expect(landed).toBeGreaterThan(t3);
  await expect(page.locator(`#rack-svg .rack-plates g[data-kind="${g.kind}"]`).first()).toBeVisible();
  // The structure changed: the guess is the output's again.
  await expect(page.locator("#guess-read .gr-at")).toHaveCount(0);
});

test("a bred sound shows what its generation changed: from its seed and how many changes, a tick on each module and the seed's pointer on each knob, until it is edited", { tag: "@slow" }, async ({ page, app }) => {
  await app.boot({ warmed: false });
  await app.warmStart();
  await openPreset(app, "Reese");
  const seedId = await page.evaluate(() => window.__aur.wb.subjectId);
  // ⚡ breeds a child from Reese and opens it.
  await page.locator("#rack-evolve").click();
  await app.engine((timeout) => expect.poll(() => page.evaluate((s) => {
    const id = window.__aur.wb.subjectId;
    return id !== s && window.__tap.last.bench && window.__tap.last.bench.subject === id ? id : null;
  }, seedId), { timeout }).not.toBeNull(), { ms: 240_000 });
  await expect(page.locator("#rack-svg g.mod-group").first()).toBeVisible();
  // What the engine recorded of it, and what the canvas should mark.
  const want = await page.evaluate(() => {
    const id = window.__aur.wb.subjectId;
    const ev = (window.__tap.last.evolved_from.views.lineage || []).find((e) => e.child_id === id && e.kind === "refine");
    const keys = new Set();
    const seeds = {};
    const latent = (v) => v != null && /^-?\d+\.\d\d$/.test(v) && Number(v) >= 0 && Number(v) <= 1;
    for (const d of ev.diff) {
      const i = d.addr.lastIndexOf("#");
      const site = d.addr.slice(i + 1);
      if (d.after == null || site === "leaf" || site === "uid") continue;
      keys.add(d.addr.slice(0, i));
      if (latent(d.before) && latent(d.after)) seeds[d.addr] = d.before;
    }
    const plates = [...document.querySelectorAll("#rack-svg .rack-plates > g[data-key]")].map((g) => g.dataset.key);
    const knobs = {};
    for (const m of window.__aur.wb.rack.modules) for (const k of m.knobs) knobs[k.addr] = k;
    const pointers = Object.entries(seeds).filter(([a, b]) => knobs[a] && knobs[a].kind.t === "continuous" && Math.abs(Number(b) - knobs[a].value) >= 0.004 &&
      document.querySelector(`#rack-svg .rack-controls [data-addr="${CSS.escape(a)}"]`));
    return { parent: ev.parent_id, ticked: plates.filter((k) => keys.has(k)).sort(), pointers };
  });
  expect(want.parent).toBe(seedId);
  expect(want.ticked.length, "the generation changed something on the canvas").toBeGreaterThan(0);
  const marks = async () => page.evaluate(() => ({
    from: document.querySelector("#rack-meta .pt-from")?.textContent || null,
    ticked: [...document.querySelectorAll("#rack-svg .rack-plates > g[data-key]")].filter((g) => g.querySelector(".lineage-tick")).map((g) => g.dataset.key).sort(),
    pointers: [...document.querySelectorAll("#rack-svg .knob-seed")].map((l) => [l.closest("[data-addr]").dataset.addr, l.dataset.seed]),
  }));
  const at = await marks();
  expect(at.from).toMatch(/^from Reese · \d+ changes?$/);
  expect(at.ticked).toEqual(want.ticked);
  expect(at.pointers.sort()).toEqual(want.pointers.map(([a, b]) => [a, Number(b).toFixed(2)]).sort());
  // The count is the bank row's: its line lists the same changes.
  const rowParts = await page.evaluate((id) => {
    const t = document.querySelector(`#bank-list .bank-item[data-id="${id}"] .bi-from`)?.textContent || "";
    const m = /^from .+? · (.*?)(?:, \+(\d+) more)?$/.exec(t);
    return m ? m[1].split(", ").length + Number(m[2] || 0) : null;
  }, await page.evaluate(() => window.__aur.wb.subjectId));
  if (rowParts != null) expect(at.from).toContain(`· ${rowParts} change`);

  // An edit: the bench is no longer the child as bred, and the marks go.
  const hit = page.locator("#rack-svg g[data-addr] > .knob-hit").first();
  const b = await hit.boundingBox();
  const t0 = await app.now();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 - 30, { steps: 5 });
  await page.mouse.up();
  await app.reply("bench", { after: t0 });
  await expect(page.locator("#rack-meta .pt-from")).toHaveCount(0);
  await expect(page.locator("#rack-svg .lineage-tick, #rack-svg .knob-seed")).toHaveCount(0);
  // Undo to as opened: the child as bred again, and its marks with it.
  const t1 = await app.now();
  await page.locator("#pt-revert").click();
  await app.reply("bench", { after: t1 });
  await expect(page.locator("#rack-meta .pt-from")).toHaveText(at.from);
  await expect.poll(async () => (await marks()).ticked).toEqual(want.ticked);
  await expect(page.locator("#rack-svg .knob-seed")).toHaveCount(want.pointers.length);
});

test("the readout names the PERFORM controls that turn the knob under the pointer, and a module's, from PERFORM's measurement", async ({ page, app }) => {
  await app.boot();
  // PERFORM measures the sound it plays at boot; that is the patch on the
  // bench. Its measurement, as the worker answered it: for each control on
  // the panel, the knobs it turns.
  await app.engine((timeout) => expect.poll(() => page.evaluate(() => {
    const T = window.__tap;
    const bench = T.last.bench && T.last.bench.treeJson;
    if (!bench) return false;
    const sh = (j) => j.replace(/-?\d+(\.\d+)?(e-?\d+)?/g, "#");
    const reqs = new Set(T.sent.filter((s) => s.type === "perform_wire" && s.m.tree && sh(s.m.tree) === sh(bench)).map((s) => s.m.req));
    return T.replies.some((r) => r.type === "perform_wired" && !r.injected && r.d.data && reqs.has(r.d.req));
  }), { timeout }).toBe(true), { ms: FLOOR_MS });
  await goLevel(page, "patch");
  await expect(page.locator("#rack-svg g.mod-group").first()).toBeVisible();
  const m = await page.evaluate(() => {
    const T = window.__tap;
    const bench = T.last.bench.treeJson;
    const sh = (j) => j.replace(/-?\d+(\.\d+)?(e-?\d+)?/g, "#");
    const reqs = new Set(T.sent.filter((s) => s.type === "perform_wire" && s.m.tree && sh(s.m.tree) === sh(bench)).map((s) => s.m.req));
    const wired = T.replies.filter((r) => r.type === "perform_wired" && !r.injected && r.d.data && reqs.has(r.d.req)).pop().d;
    const turning = wired.data.wiring.filter((w) => !w.search && (w.knobs || []).length);
    // A knob on the canvas some control turns, and the module it is on.
    for (const mod of window.__aur.wb.rack.modules) {
      for (const k of mod.knobs) {
        const names = turning.filter((w) => w.knobs.some(([a]) => a === k.addr)).map((w) => w.name);
        if (names.length && document.querySelector(`#rack-svg .rack-controls [data-addr="${CSS.escape(k.addr)}"] .knob-hit`)) {
          const byControl = turning.map((w) => [w.name, mod.knobs.filter((x) => w.knobs.some(([a]) => a === x.addr)).map((x) => x.label)]).filter(([, ks]) => ks.length);
          return { addr: k.addr, label: k.label, names, key: mod.key, kind: mod.kind, byControl };
        }
      }
    }
    return null;
  });
  expect(m, "PERFORM turns some knob of the sound it plays").not.toBeNull();
  const caps = (n) => n.toUpperCase();
  const series = (p) => (p.length <= 1 ? p.join("") : p.length === 2 ? `${p[0]} and ${p[1]}` : `${p.slice(0, -1).join(", ")}, and ${p[p.length - 1]}`);
  // The knob under the pointer: the controls that turn it, by name.
  const hit = page.locator(`#rack-svg .rack-controls [data-addr="${m.addr}"] .knob-hit`);
  await hit.hover();
  // (In the panel's order, which the reply's wiring need not be in.)
  const verb = `${m.names.length === 1 ? "turns" : "turn"} this ${m.label}`;
  await expect.poll(async () => {
    const t = (await page.locator("#pt-read .pr-wired").textContent()) || "";
    if (!t.endsWith(` ${verb}`)) return t;
    return t.slice(0, -verb.length - 1).replace(/, and |, | and /g, "|").split("|").sort();
  }).toEqual(m.names.map(caps).sort());
  // The module selected, nothing under the pointer: each control with its knobs.
  const plate = page.locator(`#rack-svg .rack-plates g[data-key="${m.key}"] .mod-plate`);
  const b = await plate.boundingBox();
  await page.mouse.click(b.x + 10, b.y + b.height - 6);
  await page.mouse.move(4, 400);
  // Each control with its knobs (in the panel's order, which the reply's
  // wiring need not be in: compared as a set).
  const want = m.byControl.map(([n, ks]) => `${caps(n)} turns its ${series(ks)}`).sort();
  await expect.poll(async () => ((await page.locator("#pt-read .pr-wired").textContent()) || "").split("; ").sort()).toEqual(want);
});
