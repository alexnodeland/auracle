#!/usr/bin/env node
// Capture the raw app screenshots the site uses, from the real app.
//
//   node www/capture-screens.mjs <out-dir> [--url URL] [--picks N] [--gens N]
//                                [--profile DIR] [--only shot,shot] [--patch NAME]
//
// SCREENSHOTS.md's recipe, run by a browser instead of by hand: boot the app at
// 1440×900, teach it, groom away the test debris, and save one raw PNG per shot
// into <out-dir>. `encode-screens.sh <out-dir>` crops and encodes them.
//
//   play  nodebank  evolve  taste  styles  directions  trust  warmstart  perform
//
// The session is *taught*, not staged. The three-pick warm start, then duels in
// EVOLVE, each answered with one consistent synthetic taste (see TASTE below),
// with EVOLVE POOL pressed every ten picks — until it has at least --picks
// picks (default 44, the warm start's 18 included) and --gens generations
// (default 3). A consistent taste is the point: a coin-flip voter teaches the
// model nothing, and TASTE would show noise where it should show a listener.
//
//   --url      the app (default http://localhost:8642/, which is `make serve`)
//   --profile  keep the browser profile in DIR. The app saves its session, so a
//              second run finds it already taught and goes straight to the shots.
//   --only     capture only these shots (the session is still taught if needed)
//   --patch    the PATCH shot's patch, by its bank name (default: chosen, below)
//
// It fails loudly: any page error or console error stops the run before the
// next shot, because a shot of a broken app is worse than no shot. The machine
// this runs on is often busy, so every wait is generous and every step is timed.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const { chromium } = require(path.join(ROOT, "tests/web/node_modules/playwright"));

// ---------------------------------------------------------------- arguments
const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};
const OUT = argv.find((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--")));
if (!OUT) {
  console.error("usage: node www/capture-screens.mjs <out-dir> [--url URL] [--picks N] [--gens N] [--profile DIR] [--only a,b] [--patch NAME]");
  process.exit(2);
}
const APP = flag("url", "http://localhost:8642/");
const PICKS = Number(flag("picks", 44));
const GENS = Number(flag("gens", 3));
const PROFILE = flag("profile", null);
const ONLY = flag("only", null)?.split(",");
const PATCH = flag("patch", null);
const EVOLVE_EVERY = 10;
const VIEWPORT = { width: 1440, height: 900 };
// Where the pointer waits while a frame is taken: the empty middle of the menu
// bar, clear of every hover state and tooltip in the app.
const PARK = { x: 820, y: 24 };

// ---------------------------------------------------------------- logging
const T0 = Date.now();
const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;
const log = (...a) => console.log(`[${secs(Date.now() - T0).padStart(7)}]`, ...a);
async function timed(name, fn) {
  const t = Date.now();
  log(`▸ ${name}`);
  const r = await fn();
  log(`  ${name} done in ${secs(Date.now() - t)}`);
  return r;
}

// ---------------------------------------------------------------- the taste
// One listener, held for the whole session: dark and tonal over bright and
// noisy, slow and sustained over fast and short. The app names every pool
// patch `<character> <role>` from its measured features (auracle-session's
// naming.rs: character is brightness × noisiness, role is attack × sustain),
// so voting on the name is voting on the sound — the same four features, read
// the same way every time. Preset names and blurbs use the vocabulary below
// the grid. The topology signature only breaks ties.
const LIKE = {
  // character: [dark, mid, bright] × [tonal, mid, noisy]
  warm: 3, round: 2, murky: 0, fat: 1, soft: 2, gritty: -3, glass: 0, bright: -1, noisy: -3,
  // role: [fast, medium, slow attack] × [short, mid, long sustain]
  pluck: -2, stab: -2, lead: -1, bell: 0, key: 0, drone: 2, swell: 2, pad: 3, wash: 3,
  // preset names and the blurbs on the warm-start cards
  ember: 2, glows: 2, cathedral: 2, slow: 2, sacred: 1, wide: 1, dream: 1, smear: 1, drifts: 1,
  room: 1, builds: 1, fog: 1, tides: 1, tidal: 1, undertow: 1, weather: 1, sea: 1, cloud: 1,
  sines: 1, sing: 1, sings: 1, choirboy: 1, vowels: 1, sine: 1,
  noise: -2, white: -1, jet: -2, buzzing: -2, metallic: -2, angry: -2, nasal: -2, hornet: -2,
  acid: -2, anvil: -2, hammered: -2, driven: -1, square: -1, fold: -2, folded: -2, grainy: -1,
  spark: -1, flint: -1, struck: -1, drum: -1, snare: -2, gated: -1, ping: -2, ricochet: -2,
  ticker: -1, woodblock: -1, hard: -1, dry: -1, woody: -1, burble: -1, megaphone: -1,
  loudhailer: -1, heartbeat: -1, pulse: -1, machine: -1, rotor: -1, static: -1, telegraph: -1,
  wrong: -1, hunting: -1,
};
const SIG_LIKE = { lp: 1, ladr: 1, cho: 1, rvb: 1, dly: 1, sin: 1, wsin: 1, tri: 0.5, noiz: -1, fold: -1, crsh: -1, clip: -1, ring: -1, hp: -1, drv: -0.5 };
const words = (s) => (s || "").toLowerCase().split(/[^a-z]+/).filter(Boolean);
const taste = (text) => words(text).reduce((s, w) => s + (LIKE[w] || 0), 0);
const sigTaste = (sig) => (sig || "").split(/[·+\s]+/).reduce((s, t) => s + (SIG_LIKE[t] || 0), 0);

// ---------------------------------------------------------------- page helpers
const problems = [];
function assertClean(where) {
  if (problems.length) {
    throw new Error(`the page raised errors before ${where} — not capturing a broken app:\n  ${problems.join("\n  ")}`);
  }
}

async function until(page, fn, arg, what, ms) {
  try {
    await page.waitForFunction(fn, arg, { timeout: ms, polling: 250 });
  } catch (e) {
    throw new Error(`timed out after ${secs(ms)} waiting for ${what}${e.message.includes("Timeout") ? "" : `: ${e.message}`}`);
  }
}
const num = (page, id) => page.$eval(`#${id}`, (e) => Number(e.textContent) || 0);
const visible = (page, sel) => page.locator(sel).first().isVisible().catch(() => false);

/** The model is not fitting or breeding. */
const modelIdle = (page, ms = 600_000) =>
  until(page, () => !document.getElementById("wm-lamp").classList.contains("thinking"), null, "the model to finish thinking", ms);

/** Every pool patch has landed (the bank head stops saying "+N arriving"). */
const poolFull = (page) =>
  until(page, () => !/arriving/.test(document.getElementById("bank-count")?.textContent || ""), null, "the pool to fill", 600_000);

/** Nothing transient on screen: toasts gone, pointer parked, model idle, no
 *  first-run coach, the alarm strip down. Toasts are waited out, never
 *  removed — each one is a real message and the lane empties on its own. */
async function settle(page, { ms = 120_000 } = {}) {
  await page.mouse.move(PARK.x, PARK.y);
  // No focus ring left behind by the last gesture (a dragged knob keeps focus).
  await page.evaluate(() => document.activeElement?.blur?.());
  await modelIdle(page);
  await until(page, () => !document.querySelector("#toasts .toast"), null, "the toast lane to empty", ms);
  await until(page, () => !document.querySelector(".coach, .map-tip"), null, "the coach and tooltips to go", ms);
  if (!(await page.locator("#alarm").evaluate((e) => e.classList.contains("hidden")))) {
    throw new Error(`the alarm strip is up: ${await page.locator("#alarm").textContent()}`);
  }
  await page.waitForTimeout(400); // one more frame of every animation that was finishing
}

async function view(page, v) {
  await page.click(`.viewtab[data-view="${v}"]`);
  await until(page, (v) => !document.getElementById(`view-${v}`).classList.contains("hidden"), v, `the ${v} view`, 30_000);
}

/** A bench open can show the one-time bench walkthrough; it is dismissed the
 *  way a person dismisses it. */
async function closeBenchTour(page) {
  if (await visible(page, "#bench-tour:not(.hidden)")) await page.click("#bt-close");
}

const rects = {};
async function measure(page, shot, named) {
  const r = {};
  for (const [name, sel] of Object.entries(named)) {
    const b = await page.locator(sel).first().boundingBox().catch(() => null);
    if (b) r[name] = { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
  }
  rects[shot] = r;
  for (const [name, b] of Object.entries(r)) log(`    ${shot}: ${name} at ${b.w}x${b.h}+${b.x}+${b.y}`);
}

async function shoot(page, name) {
  assertClean(`${name}.png`);
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  log(`  ✓ ${file}`);
}

// ---------------------------------------------------------------- teaching
async function warmStart(page) {
  const cards = await page.$$eval(".warm-cell .warm-item", (els) => els.map((e) => ({
    name: e.querySelector(".wi-name")?.textContent.trim(),
    blurb: e.querySelector(".wi-sig")?.textContent.trim(),
  })));
  const ranked = cards.map((c, i) => ({ i, ...c, s: taste(`${c.name} ${c.blurb}`) })).sort((p, q) => q.s - p.s || p.i - q.i);
  log(`  warm start offers: ${ranked.map((c) => `${c.name} ${c.s > 0 ? "+" : ""}${c.s}`).join(", ")}`);
  const picked = ranked.slice(0, 3);
  log(`  warm start picks: ${picked.map((c) => c.name).join(", ")}`);
  const items = page.locator(".warm-cell .warm-item");
  for (const p of picked) await items.nth(p.i).click();
  await page.click("#warm-go");
  await until(page, () => Number(document.getElementById("duel-count").textContent) >= 18, null, "the warm start's 18 picks", 300_000);
  await modelIdle(page);
}

/** The pair on the table: each side's name, id and topology signature. */
const pairNow = (page) => page.evaluate(() => ["a", "b"].map((s) => {
  const n = document.getElementById(`name-${s}`);
  return {
    name: (n.childNodes[0]?.textContent || "").trim(),
    id: n.querySelector(".dn-id")?.textContent || "",
    sig: n.querySelector(".dn-sig")?.textContent || "",
  };
}));
const dealt = () => !document.getElementById("choose-a").disabled && !document.getElementById("choose-b").disabled;

/** One duel: wait for a pair to be dealt and heard, then vote by the taste.
 *  Returns what it did, or null when it re-dealt instead of voting. */
async function duel(page) {
  await until(page, dealt, null, "a pair to be dealt", 300_000);
  // Both sides named. A side still showing a bare #id has no row in the bank
  // yet, so there is nothing to judge it by — re-deal it (↻ records nothing)
  // rather than guess.
  const named = await page.waitForFunction(() => ["a", "b"].every((s) => {
    const t = (document.getElementById(`name-${s}`).childNodes[0]?.textContent || "").trim();
    return t && !t.startsWith("#") && !/^candidate/.test(t);
  }), null, { timeout: 20_000, polling: 250 }).then(() => true, () => false);
  if (!named) {
    const was = (await pairNow(page)).map((p) => p.id).join();
    await page.click("#skip-duel");
    // ↻ leaves the controls live, so "dealt" cannot say when the new pair is
    // up; its ids can. The engine may deal the same pair again, so not forever.
    await until(page, (w) => [...document.querySelectorAll("#name-a .dn-id, #name-b .dn-id")].map((e) => e.textContent).join() !== w,
      was, "a different pair", 60_000).catch(() => {});
    return null;
  }
  // Heard before judged: both buffers rendered. A pair whose render failed is
  // judged by name rather than waited on forever.
  await until(page, () => !document.querySelector("#play-a.pending, #play-b.pending"), null, "the pair to render", 90_000)
    .catch(() => log("    (pair still rendering — judged by name)"));
  const pair = await pairNow(page);
  const score = pair.map((p) => taste(p.name) + 0.1 * sigTaste(p.sig));
  const side = score[1] > score[0] ? "b" : "a";
  await page.click(`#choose-${side}`);
  return `${pair[0].name} vs ${pair[1].name} → ${side.toUpperCase()}`;
}

async function breed(page) {
  const before = await num(page, "gen-count");
  // The last vote is held in its 7 s undo window and only then sent. Breeding
  // first would queue it behind a generation that may evict one of its pair,
  // and the engine drops a vote on a patch that has left the pool.
  await page.waitForTimeout(7500);
  await until(page, () => !document.getElementById("evolve-btn").disabled, null, "EVOLVE POOL to be free", 600_000);
  const t = Date.now();
  await page.click("#evolve-btn");
  await until(page, () => !document.getElementById("evolve-btn").disabled, null, "the generation to be bred", 1_800_000);
  const after = await num(page, "gen-count");
  log(`    generation ${after} bred in ${secs(Date.now() - t)}${after > before ? "" : " (the engine took nothing)"}`);
}

async function teach(page) {
  if (await visible(page, "#warmstart:not(.hidden)")) await timed("warm start", () => warmStart(page));
  let picks = await num(page, "duel-count");
  let gens = await num(page, "gen-count");
  log(`  session: ${picks} picks, ${gens} generations`);
  if (picks >= PICKS && gens >= GENS) return false;
  // A first note, as anyone would play one: it retires the first-run coach.
  await page.keyboard.down("a");
  await page.waitForTimeout(300);
  await page.keyboard.up("a");
  // Duels once the pool has landed: until then every deal queues behind the
  // renders still filling it, and half the pairs have no bank row to name them.
  await timed("pool fill", () => poolFull(page));
  await view(page, "evolve");
  let since = 0;
  let n = 0;
  let redeals = 0;
  const vote = async (why = "") => {
    const t = Date.now();
    const said = await duel(page);
    if (!said) {
      redeals += 1;
      log(`    (re-dealt a pair with an unnamed side)`);
      if (redeals > 60) throw new Error("sixty pairs in a row with an unnamed side");
      return false;
    }
    redeals = 0;
    n += 1;
    picks += 1;
    log(`    pick ${picks}${why} (${secs(Date.now() - t)}): ${said}`);
    return true;
  };
  while (picks < PICKS || gens < GENS) {
    if (!(await vote())) continue;
    since += 1;
    if (since >= EVOLVE_EVERY && gens < GENS) {
      await breed(page);
      gens = await num(page, "gen-count");
      since = 0;
    }
  }
  // Stop on a refit boundary, so the meter reads "N picks in. Every 6 it
  // redraws your taste map." rather than a countdown — the state the teaching
  // figure's caption describes.
  for (let extra = 0; extra < 12; extra++) {
    // The refit is armed by a vote but sent when the next pair lands, and the
    // meter hands its line to "it just learned" for a beat when it is.
    await until(page, dealt, null, "the next pair", 300_000);
    await page.waitForTimeout(500);
    await until(page, () => !document.getElementById("duel-mid").classList.contains("learning"), null, "the refit beat", 60_000);
    if (/picks in/.test(await page.textContent("#teach-copy"))) break;
    await vote(" (to the refit)");
  }
  // The last vote sits in its undo window for 7 s; then any refit it armed.
  await page.waitForTimeout(8000);
  await modelIdle(page);
  log(`  taught: ${await num(page, "duel-count")} picks, ${await num(page, "gen-count")} generations, ${n} duels this run`);
  return true;
}

// ---------------------------------------------------------------- grooming
/** HELD: automated runs leave modules in it; a real session has a handful at
 *  most. Discarded with their own ✕. */
async function emptyTray(page) {
  for (let i = 0; i < 100; i++) {
    const x = page.locator(".tray-item:not(.pending) .t-x").first();
    if (!(await x.count())) break;
    await x.click();
    await page.waitForTimeout(150);
  }
  const left = await page.locator(".tray-item").count();
  if (left) throw new Error(`${left} held modules would not discard`);
}

async function openRow(page, id, name) {
  await page.click(`#${id} .bi-name`);
  await until(page, (n) => document.getElementById("rack-subject").textContent.trim() === n, name, `${name} on the bench`, 120_000);
  await closeBenchTour(page);
  // Plates drawn, and the count no longer changing.
  let last = -1;
  for (let i = 0; i < 40; i++) {
    const c = await page.locator("#rack-svg rect.mod-plate").count();
    if (c > 0 && c === last) break;
    last = c;
    await page.waitForTimeout(400);
  }
  // Modules as the app's own budget counts them: the audio nodes — not the
  // amp envelope's plate, and not the modulation sources (`modside`).
  return page.evaluate(() => ({
    modules: [...document.querySelectorAll("#rack-svg .rack-plates > g[data-kind]")]
      .filter((g) => g.dataset.kind !== "amp" && !g.querySelector("rect.mod-plate.modside")).length,
    mod: document.querySelectorAll("#rack-svg path.wire.mod").length,
  }));
}

/** PATCH needs a patch that shows the rack: 6–10 modules, so plates, knobs,
 *  values and both cable colours are legible at two zoom steps, with a
 *  modulation chain so the amber cables are there at all. Taken from the
 *  evolution bank's second row down, so the patch on show is one the taught
 *  model believes in, and so there is a ranked row to sit above it (see
 *  `groom`). */
async function pickPatch(page) {
  await view(page, "play");
  await page.click('.bf[data-f="pool"]');
  await page.waitForTimeout(300);
  const rows = await page.$$eval("#bank-list .bank-item", (els) => els.map((e) => ({
    id: e.id,
    name: e.querySelector(".bi-name")?.textContent.trim(),
    pct: parseInt(e.querySelector(".bi-pct")?.textContent, 10) || 0,
  })));
  let best = null;
  for (const r of PATCH ? rows : rows.slice(1)) {
    if (PATCH && r.name !== PATCH) continue;
    const shape = await openRow(page, r.id, r.name);
    log(`    ${r.name} (${r.pct}%): ${shape.modules} modules, ${shape.mod} mod cables`);
    const fit = shape.modules >= 6 && shape.modules <= 10 && shape.mod >= 1;
    if (fit || PATCH) return r;
    const miss = Math.abs(shape.modules - 8) + (shape.mod ? 0 : 3);
    if (!best || miss < best.miss) best = { ...r, miss };
  }
  if (!best) throw new Error(PATCH ? `no bank row named ${PATCH}` : "the bank is empty");
  log(`    nothing ideal; taking ${best.name}`);
  await openRow(page, best.id, best.name);
  return best;
}

async function groom(page) {
  await poolFull(page);
  await view(page, "play");
  await emptyTray(page);
  // The rows carry the model's predictions once a fitted posterior is up. A
  // restored session refits on load, and until then the rail is unranked.
  await page.click('.bf[data-f="pool"]');
  await until(page, () => /%/.test(document.querySelector("#bank-list .bank-item .bi-pct")?.textContent || ""),
    null, "the bank's predictions", 600_000);
  await modelIdle(page);
  const row = await pickPatch(page);
  log(`  PATCH shows ${row.name}`);
  // Rated the way the listener who liked it most would: five stars. A rating
  // is an observation, so it is a pick like any other.
  if (!(await page.locator(".bank-item.live .star.lit[data-s='5']").count())) await page.click(".bank-item.live .star[data-s='5']");
  await modelIdle(page);
  // The rail scrolled by whole rows so the row on the bench sits in its second
  // slot, under the row the model ranks next above it. The same slot in every
  // capture is what keeps bank-row's crop rectangle a fixed one.
  await page.waitForTimeout(800); // the row's own smooth scroll-into-view
  const at = await page.evaluate(() => {
    const list = document.getElementById("bank-list");
    const rows = [...list.querySelectorAll(".bank-item")];
    const i = rows.findIndex((r) => r.classList.contains("live"));
    if (i < 0 || rows.length < 2) return { i, slot: -1 };
    const pitch = rows[1].offsetTop - rows[0].offsetTop;
    list.scrollTop = Math.max(0, i - 1) * pitch;
    return { i, slot: Math.round((rows[i].offsetTop - rows[0].offsetTop - list.scrollTop) / pitch) };
  });
  log(`    bench row: bank row ${at.i + 1}, rail slot ${at.slot + 1}`);
  if (at.slot !== 1) log("    !! the bench row is not in the rail's second slot; check bank-row's crop against rects.json");
  // The minimap on, so the zoomed-in frame still shows the whole patch.
  if ((await page.getAttribute("#rack-map-btn", "aria-pressed")) !== "true") await page.click("#rack-map-btn");
  // The camera auto-fits on open; then ⌘= steps: two, and more while the
  // knob labels and the modulation tabs' destination names are still under
  // the rack's 8px silkscreen floor — they are what the rack figures read.
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.activeElement?.blur?.());
  for (let i = 0; i < 5; i++) {
    const illegible = await page.$eval("#rack-svg", (s) => s.dataset.illegible || "");
    if (i >= 2 && !/\blabel\b/.test(illegible)) break;
    await page.keyboard.press("Control+Equal");
    await page.waitForTimeout(700);
  }
  log(`    zoomed in; still under the silkscreen floor: ${(await page.$eval("#rack-svg", (s) => s.dataset.illegible)) || "nothing"}`);
  return row;
}

/** Open the spec strip tall enough for the description it is showing. Its
 *  short-screen default (92px at 1440×900) clips the end of a long one — the
 *  formant card loses most of its "heard as" line — and the divider above it
 *  is the app's own control for exactly this; it remembers the height. */
async function fitSpecDock(page, chip) {
  const short = await page.$eval("#spec-dock", (d) => d.scrollHeight - d.clientHeight);
  if (short <= 0) return;
  await page.mouse.move(PARK.x, PARK.y);
  await until(page, () => document.getElementById("spec-dock").classList.contains("rest"), null, "the spec strip to rest", 10_000);
  const grip = await page.locator("#dock-resize").boundingBox();
  const x = grip.x + grip.width / 2;
  const y = grip.y + grip.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - short / 2);
  await page.mouse.move(x, y - short - 2);
  await page.mouse.up();
  await page.mouse.move(PARK.x, PARK.y);
  await page.hover(chip);
  log(`    spec strip opened ${short + 2}px taller`);
}

// ---------------------------------------------------------------- the shots
async function shotPlay(page) {
  await view(page, "play");
  await settle(page);
  await until(page, () => !document.querySelector(".bl-stale"), null, "the model's guess to be current", 120_000);
  await measure(page, "play", { bank: ".bank", row: ".bank-item.live", frame: "#rack-frame", minimap: "#rack-map" });
  await shoot(page, "play");
}

async function shotNodebank(page) {
  const chip = ".nb-item[data-kind='formant']";
  const card = () => page.waitForFunction(() => /formant/i.test(document.querySelector("#spec-dock .sd-name")?.textContent || ""),
    null, { timeout: 30_000, polling: 250 });
  await view(page, "play");
  await settle(page);
  // The rail scrolled to formant's group, as a person scrolls to find it: the
  // group's heading directly under the rail's own, so the catalogue reads
  // from there down rather than from a sticky "in this patch" with its chips
  // scrolled away beneath it.
  await page.evaluate((sel) => {
    const body = document.getElementById("nb-body");
    const group = document.querySelector(sel).closest(".nb-group");
    const head = body.querySelector(".nb-head");
    if (group && head) body.scrollTop += group.getBoundingClientRect().top - head.getBoundingClientRect().bottom;
  }, chip);
  await page.waitForTimeout(300);
  await page.hover(chip);
  await card();
  await fitSpecDock(page, chip);
  await card();
  await page.waitForTimeout(500);
  await measure(page, "nodebank", { dock: "#spec-dock", chip: ".nb-item[data-kind='formant']" });
  await shoot(page, "nodebank");
  await page.mouse.move(PARK.x, PARK.y);
}

async function shotTaste(page, tab, name) {
  await view(page, "taste");
  await page.click(`.tab[data-tab="${tab}"]`);
  await settle(page);
  const empty = await visible(page, "#crt-empty:not(.hidden)");
  if (empty) log(`    !! TASTE › ${tab} is showing its empty state: ${await page.textContent("#crt-empty")}`);
  // Style names are the fit's own, and a long one runs past the chip's 30ch
  // cap and is cut mid-word. Not the capture's to fix; worth a re-take (the
  // names change on every refit).
  const clipped = await page.$$eval("#style-chips .sc-name", (els) => els.filter((e) => {
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.font = getComputedStyle(e).font;
    return ctx.measureText(e.value || e.placeholder).width > e.clientWidth + 1;
  }).map((e) => e.value || e.placeholder));
  if (clipped.length) log(`    !! style chip names cut off by the chip's width: ${clipped.join("; ")}`);
  await measure(page, name, { panel: "#taste-crt", chips: "#style-chips" });
  await shoot(page, name);
}

async function shotEvolve(page) {
  await view(page, "evolve");
  // A pair on the table, both sides named and heard.
  await until(page, () => !document.getElementById("choose-a").disabled &&
    !document.querySelector("#play-a.pending, #play-b.pending") &&
    ["a", "b"].every((s) => !/^(#|candidate)/.test((document.getElementById(`name-${s}`).childNodes[0]?.textContent || "#").trim())),
  null, "a named, heard pair", 300_000);
  // The meter's probe note, which the teaching figure shows (see "reload").
  await until(page, () => !!document.querySelector("#duel-pred.check"), null, "the probe note", 15_000)
    .catch(() => log("    !! the pair is not marked as an unbiased probe; the meter shows without its note"));
  await settle(page);
  await measure(page, "evolve", { meter: "#duel-mid", lineage: ".lineage-strip" });
  await shoot(page, "evolve");
}

async function shotWarmstart(page) {
  await page.click("#ovf-btn");
  await page.click("#warm-rerun-btn");
  await until(page, () => !document.getElementById("warmstart").classList.contains("hidden") &&
    document.querySelectorAll(".warm-cell").length === 9, null, "the warm start card", 60_000);
  await settle(page);
  await measure(page, "warmstart", { card: ".warm-card" });
  await shoot(page, "warmstart");
  await page.click("#warm-skip"); // records nothing
}

async function shotPerform(page, preset = "Ceiling") {
  await view(page, "play");
  await page.click('.bf[data-f="preset"]');
  await page.locator(".bank-item", { hasText: preset }).first().click();
  await closeBenchTour(page);
  await view(page, "perform");
  await until(page, (n) => (document.querySelector(".pf-name")?.textContent || "").includes(n), preset, `PERFORM to name ${preset}`, 120_000);
  await until(page, () => /controls reach/.test(document.querySelector(".pf-status")?.textContent || ""), null, `${preset} to be measured`, 300_000);
  // A chord held on the latch: C4, G4, C5.
  if ((await page.getAttribute("#hold-btn", "aria-pressed")) !== "true") await page.click("#hold-btn");
  for (const k of ["a", "g", "k"]) {
    await page.keyboard.down(k);
    await page.waitForTimeout(120);
    await page.keyboard.up(k);
  }
  // PERFORM's first steps tick off as they happen: the chord was the first,
  // and the other two are what anyone does next — turn a lit control, then
  // ask for an offer. Done, the strip retires, and B holds an offer.
  if (/Turn/.test((await page.locator(".pf-step.now").textContent().catch(() => "")) || "")) {
    const box = await page.locator(".pf-knob").first().boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 4; i++) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - i * 6);
    await page.mouse.up();
  }
  if (!/Take it/.test((await page.locator(".pf-offer-body").textContent().catch(() => "")) || "")) {
    await page.locator(".pf-pads").getByRole("button", { name: "Offer", exact: true }).click();
  }
  await until(page, () => /Take it/.test(document.querySelector(".pf-offer-body")?.textContent || ""), null, "an offer to be waiting in B", 600_000);
  await until(page, () => document.querySelector(".pf-steps")?.classList.contains("hidden") ?? true, null, "the first steps to retire", 60_000);
  await settle(page);
  await until(page, () => !/measuring/.test(document.getElementById("view-perform").textContent), null, "PERFORM to stop measuring", 120_000);
  await shoot(page, "perform");
}

const SHOTS = [
  ["play", shotPlay],
  ["nodebank", shotNodebank],
  ["taste", (p) => shotTaste(p, "map", "taste")],
  ["styles", (p) => shotTaste(p, "styles", "styles")],
  ["directions", (p) => shotTaste(p, "dir", "directions")],
  ["trust", (p) => shotTaste(p, "trust", "trust")],
  ["evolve", shotEvolve],
  ["warmstart", shotWarmstart],
  ["perform", shotPerform],
];

// ---------------------------------------------------------------- main
fs.mkdirSync(OUT, { recursive: true });
const launch = { args: ["--autoplay-policy=no-user-gesture-required"] };
const context = { viewport: VIEWPORT, deviceScaleFactor: 1 };
let browser = null;
let ctx;
if (PROFILE) {
  ctx = await chromium.launchPersistentContext(PROFILE, { ...launch, ...context });
} else {
  browser = await chromium.launch(launch);
  ctx = await browser.newContext(context);
}
const page = ctx.pages()[0] || (await ctx.newPage());
page.on("pageerror", (e) => {
  problems.push(`pageerror: ${e.message}`);
  log(`!! pageerror: ${e.message}`);
});
page.on("console", (m) => {
  if (m.type() === "error") {
    problems.push(`console.error: ${m.text()}`);
    log(`!! console.error: ${m.text()}`);
  }
});

let failed = null;
try {
  await timed("boot", async () => {
    await page.goto(APP);
    await until(page, () => document.getElementById("boot")?.classList.contains("done"), null, "the engine to boot", 300_000);
    // A fresh profile gets the warm start a moment after the veil lifts.
    await page.waitForTimeout(2000);
  });
  assertClean("teaching");
  const taught = await timed("teach", () => teach(page));
  // The shots are taken from a fresh load of the saved session — what the
  // person sees coming back to it. That clears the last vote's forecast and
  // its toasts, and it is the state in which EVOLVE marks the pair as an
  // unbiased probe: under the default random acquisition every duel is one,
  // and the badge only shows while the last six deals have not all been.
  if (taught) await timed("reload", async () => {
    await page.waitForTimeout(5000); // the app's 2.5 s save debounce, and the worker's reply
    await page.reload();
    await until(page, () => document.getElementById("boot")?.classList.contains("done"), null, "the engine to boot", 300_000);
    await page.waitForTimeout(2000);
  });
  assertClean("grooming");
  await timed("groom", () => groom(page));
  for (const [name, take] of SHOTS) {
    if (ONLY && !ONLY.includes(name)) continue;
    await timed(`shot ${name}`, () => take(page));
  }
  fs.writeFileSync(path.join(OUT, "rects.json"), JSON.stringify(rects, null, 2) + "\n");
  log(`session: ${await num(page, "duel-count")} picks, ${await num(page, "gen-count")} generations`);
} catch (e) {
  failed = e;
  await page.screenshot({ path: path.join(OUT, "_failure.png") }).catch(() => {});
} finally {
  // Let the app's own save land, so a --profile run can pick up from here.
  await page.waitForTimeout(3000).catch(() => {});
  await ctx.close();
  if (browser) await browser.close();
}
if (failed) {
  console.error(`\ncapture failed after ${secs(Date.now() - T0)}: ${failed.message}`);
  process.exit(1);
}
log(`done in ${secs(Date.now() - T0)}`);
