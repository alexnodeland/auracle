// PATCH's four engine facts (Plan-008 C2b, round 2's "Engine facts, all
// four"), each drawn from the engine's own reply, at rest:
//
// - Without this module: the selected module's absence, measured. Over the
//   face at OUT, a dashed outline of the face of the patch the structure
//   menu's verb would leave (a processor bypassed, a source's socket empty, a
//   modulator unplugged), rendered by the worker (`face_of_tree`); a patch
//   that would be silent without it says so in the readout instead.
//
// - What goes here?: the selection's ⋯ (or Q on a module) asks the model's
//   guess for that module's place (`guess`'s `at`, which the page never sent
//   before); its ghost is drawn there with where it goes and its reason on
//   the well's top line, Enter takes it, Esc goes back to the output's.
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
// The worker is reached as every PATCH spec reaches it (patch_page.js): the
// faces a page asks for, with their trees, and every face it is handed back.
const { test, expect } = require("@playwright/test");
const { boot, openPreset, warmStartAndFit, now, replied } = require("./patch_page.js");
const { goLevel } = require("./shell");

/** Select a module on the canvas by its kind, as a press on its plate does. */
async function selectPlate(page, kind, nth = 0) {
  const plate = page.locator(`#rack-svg .rack-plates g[data-kind="${kind}"] .mod-plate`).nth(nth);
  const b = await plate.boundingBox();
  await page.mouse.click(b.x + 10, b.y + b.height - 6);
  await page.mouse.move(4, 400);
}

test("the face of the patch without the selected module is drawn at OUT, measured by the worker, and a patch silent without it says so", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await boot(page, { warmed: true });
  // Hornet: a square VCO into a bandpass filter, a S&H modulating the cutoff.
  await openPreset(page, "Hornet");
  const out = page.locator("#out-without");
  await expect(out).toBeHidden();

  // The filter: bypassed, the VCO goes straight to the amp.
  await selectPlate(page, "filter");
  const key = await page.locator('#rack-svg .rack-plates g[data-kind="filter"]').getAttribute("data-key");
  await expect(out).toBeVisible({ timeout: 90_000 });
  await expect(out).toHaveAttribute("data-of", key);
  const drawn = { ref: await out.getAttribute("data-face"), key: await out.getAttribute("data-key") };
  const got = await page.evaluate(({ ref, key: k }) => {
    const ask = window.__pwPosted.filter((p) => p.type === "faces" && p.trees).flatMap((p) => p.trees).find((t) => t.ref === ref);
    const reply = window.__pwReplies.find((r) => r.type === "face" && r.ref === ref);
    const bench = JSON.parse(window.__pwLast.bench.treeJson);
    // The bypass the structure menu makes: the filter's input in its place.
    const node = k === "node" ? bench.root : null;
    const expected = node ? JSON.stringify({ ...bench, root: node.Filter.input }) : null;
    return { asked: ask ? ask.tree : null, replyKey: reply ? reply.key : null, expected };
  }, { ref: drawn.ref, key });
  expect(got.asked, "the outline's tree was asked of the worker").not.toBeNull();
  expect(got.expected, "Hornet's filter is its root").not.toBeNull();
  expect(got.asked, "…and it is the patch with the filter bypassed").toBe(got.expected);
  expect(got.replyKey, "the worker's own face for that tree is the one drawn").toBe(drawn.key);
  await expect(page.locator("#pt-read .pr-without")).toHaveCount(0);

  // The VCO is the only source: without it the patch is silent, which the
  // readout says, and nothing is drawn.
  await selectPlate(page, "vco");
  await expect(page.locator("#pt-read .pr-without")).toHaveText("silent without it");
  await expect(out).toBeHidden();

  // Nothing selected: nothing at OUT.
  await selectPlate(page, "filter");
  await expect(out).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("Escape");
  await expect(out).toBeHidden();
  expect(errors).toEqual([]);
});

/** The newest ranking with a guess in it for a guess the page asked at `at`
 *  after `after` (an empty one, its time spent, is asked again). */
async function hereRanked(page, at, after, timeout = 120_000) {
  const find = ([a, t]) => {
    const tokens = new Set(window.__pwPosted.filter((p) => p.type === "guess" && p.at === a && p.t >= t).map((p) => p.token));
    return window.__pwReplies.filter((r) => r.type === "guess" && tokens.has(r.token) && r.data && r.data.guesses && r.data.guesses.length).pop() || null;
  };
  await expect.poll(() => page.evaluate(find, [at, after]), { timeout }).not.toBeNull();
  return page.evaluate(find, [at, after]);
}

test("What goes here? asks the model's guess for a module's place, draws it there with where it goes, and Enter takes it", { tag: "@slow" }, async ({ page }) => {
  test.setTimeout(420_000);
  const errors = await boot(page, { warmed: false });
  await warmStartAndFit(page);
  // Reese: two VCOs into a mix, a filter, the amp; the mix is mid-chain.
  await openPreset(page, "Reese");
  const keyOf = (kind) => page.locator(`#rack-svg .rack-plates g[data-kind="${kind}"]`).first().getAttribute("data-key");
  const mixKey = await keyOf("mix");

  // The pointer: the mix's ⋯ › what goes here?
  await selectPlate(page, "mix");
  const t0 = await now(page);
  await page.locator('#rack-svg .rack-controls g[data-kind="mix"] .mod-menu-btn').first().click();
  await page.locator("#ctx-menu .cm-item", { hasText: /^what goes here/ }).click();
  const asked = await page.evaluate((t) => window.__pwPosted.find((p) => p.type === "guess" && p.t >= t), t0);
  expect(asked && asked.at, "the guess is asked for the mix's place").toBe(mixKey);
  // While it is ranked, the top line says what it is doing (or, on a fast
  // machine, the ranking is in already).
  await expect(page.locator("#guess-read")).toHaveText(/hearing the modules that fit at the mix…|^guess · /);
  const atMix = await hereRanked(page, mixKey, t0);
  const top = atMix.data.guesses[0];
  // Every guess it ranked is for that place: after the mix, or its slot.
  for (const g of atMix.data.guesses) expect(g.op.key, `${g.kind} ${g.op.op}`).toBe(mixKey);
  const ghost = page.locator("#rack-svg .guess-plate");
  await expect(ghost).toHaveAttribute("data-at", mixKey, { timeout: 30_000 });
  await expect(ghost).toHaveAttribute("data-kind", top.kind);
  await expect(ghost).toHaveAttribute("data-socket", top.socket);
  await expect(page.locator("#guess-read .gr-chip")).toHaveText(/^guess · \S/);
  await expect(page.locator("#guess-read .gr-at")).toHaveText(top.op.op === "set_mod" ? /^on the mix’s / : /^after the mix$/);
  // Esc on the ghost goes back to the output's guess.
  await ghost.focus();
  const t1 = await now(page);
  await page.keyboard.press("Escape");
  await expect(page.locator("#guess-read .gr-at")).toHaveCount(0);
  await expect.poll(() => page.evaluate((t) => window.__pwPosted.some((p) => p.type === "guess" && p.t >= t && p.at == null), t1), { timeout: 30_000 }).toBe(true);

  // The keyboard: Q on the filter asks for its place; the ghost takes the
  // focus when it lands, and Enter adds it, through the edit lane.
  const filterKey = await keyOf("filter");
  await page.locator('#rack-svg .rack-controls g.mod-group[data-kind="filter"]').focus();
  const t2 = await now(page);
  await page.keyboard.press("q");
  const atFilter = await hereRanked(page, filterKey, t2);
  const g = atFilter.data.guesses[0];
  await expect(ghost).toHaveAttribute("data-at", filterKey, { timeout: 30_000 });
  await expect(ghost).toHaveAttribute("data-kind", g.kind);
  await expect(ghost).toBeFocused();
  const t3 = await now(page);
  await page.keyboard.press("Enter");
  const landed = await replied(page, "bench", t3, { edited: "structure" }, 60_000);
  const took = await page.evaluate((t) => window.__pwPosted.find((p) => p.type === "edit_structure" && p.t >= t), t3);
  expect(took.op).toEqual(g.op);
  expect(took.guess && took.guess.socket).toBe(g.socket);
  expect(landed).toBeGreaterThan(t3);
  await expect(page.locator(`#rack-svg .rack-plates g[data-kind="${g.kind}"]`).first()).toBeVisible();
  // The structure changed: the guess is the output's again.
  await expect(page.locator("#guess-read .gr-at")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a bred sound shows what its generation changed: from its seed and how many changes, a tick on each module and the seed's pointer on each knob, until it is edited", { tag: "@slow" }, async ({ page }) => {
  test.setTimeout(420_000);
  const errors = await boot(page, { warmed: false });
  await warmStartAndFit(page);
  await openPreset(page, "Reese");
  const seedId = await page.evaluate(() => window.__aur.wb.subjectId);
  // ⚡ breeds a child from Reese and opens it.
  await page.locator("#rack-evolve").click();
  await expect.poll(() => page.evaluate((s) => {
    const id = window.__aur.wb.subjectId;
    return id !== s && window.__pwLast.bench && window.__pwLast.bench.subject === id ? id : null;
  }, seedId), { timeout: 240_000 }).not.toBeNull();
  await expect(page.locator("#rack-svg g.mod-group").first()).toBeVisible();
  // What the engine recorded of it, and what the canvas should mark.
  const want = await page.evaluate(() => {
    const id = window.__aur.wb.subjectId;
    const ev = (window.__pwLast.evolved_from.views.lineage || []).find((e) => e.child_id === id && e.kind === "refine");
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
  const t0 = await now(page);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 - 30, { steps: 5 });
  await page.mouse.up();
  await replied(page, "bench", t0);
  await expect(page.locator("#rack-meta .pt-from")).toHaveCount(0);
  await expect(page.locator("#rack-svg .lineage-tick, #rack-svg .knob-seed")).toHaveCount(0);
  // Undo to as opened: the child as bred again, and its marks with it.
  const t1 = await now(page);
  await page.locator("#pt-revert").click();
  await replied(page, "bench", t1);
  await expect(page.locator("#rack-meta .pt-from")).toHaveText(at.from);
  await expect.poll(async () => (await marks()).ticked).toEqual(want.ticked);
  await expect(page.locator("#rack-svg .knob-seed")).toHaveCount(want.pointers.length);
  expect(errors).toEqual([]);
});

test("the readout names the PERFORM controls that turn the knob under the pointer, and a module's, from PERFORM's measurement", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await boot(page, { warmed: true });
  // PERFORM measures the sound it plays at boot; that is the patch on the
  // bench. Its measurement, as the worker answered it: for each control on
  // the panel, the knobs it turns.
  await expect.poll(() => page.evaluate(() => {
    const bench = window.__pwLast.bench && window.__pwLast.bench.treeJson;
    if (!bench) return false;
    const sh = (j) => j.replace(/-?\d+(\.\d+)?(e-?\d+)?/g, "#");
    const reqs = new Set(window.__pwPosted.filter((p) => p.type === "perform_wire" && p.ptree && sh(p.ptree) === sh(bench)).map((p) => p.req));
    return window.__pwReplies.some((r) => r.type === "perform_wired" && reqs.has(r.req));
  }), { timeout: 120_000 }).toBe(true);
  await goLevel(page, "patch");
  await expect(page.locator("#rack-svg g.mod-group").first()).toBeVisible();
  const m = await page.evaluate(() => {
    const bench = window.__pwLast.bench.treeJson;
    const sh = (j) => j.replace(/-?\d+(\.\d+)?(e-?\d+)?/g, "#");
    const reqs = new Set(window.__pwPosted.filter((p) => p.type === "perform_wire" && p.ptree && sh(p.ptree) === sh(bench)).map((p) => p.req));
    const wired = window.__pwReplies.filter((r) => r.type === "perform_wired" && reqs.has(r.req)).pop();
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
  await expect(page.locator("#pt-read .pr-wired")).toHaveText(`${series(m.names.map(caps))} ${m.names.length === 1 ? "turns" : "turn"} this ${m.label}`);
  // The module selected, nothing under the pointer: each control with its knobs.
  const plate = page.locator(`#rack-svg .rack-plates g[data-key="${m.key}"] .mod-plate`);
  const b = await plate.boundingBox();
  await page.mouse.click(b.x + 10, b.y + b.height - 6);
  await page.mouse.move(4, 400);
  await expect(page.locator("#pt-read .pr-wired")).toHaveText(m.byControl.map(([n, ks]) => `${caps(n)} turns its ${series(ks)}`).join("; "));
  expect(errors).toEqual([]);
});
