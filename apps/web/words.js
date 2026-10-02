// Sentences the instrument builds from what the engine reports, rather than
// writes once, and the platform's own names for its keys. Pure (no DOM, no
// state), so tests/words.test.mjs holds them to www/brand/voice.md: plain
// sentences, digits, no em dashes, a word beside every percentage, each
// outcome said as what actually happened, and each platform's own key.

/** n and its noun, singular or plural: "1 pick", "52 picks". */
export function count(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** A probability as the whole percentage the app prints. */
export function pctOf(p) {
  return Math.round(Math.max(0, Math.min(1, Number(p) || 0)) * 100);
}

/** How sure a percentage reads, on the one scale voice.md gives the model:
 *  a hunch · leaning · fairly sure. It reads the printed percentage's distance
 *  from an even 50%, so the word and the number beside it never disagree:
 *  46–54% is a hunch, 55–69% (or 31–45%) leaning, 70% and over (or 30% and
 *  under) fairly sure. How wide the model's own doubt is stays with the
 *  marks that draw it (the bank row's block, TASTE's whiskers). */
export function sureWord(p) {
  const d = Math.abs(pctOf(p) - 50);
  return d < 5 ? "a hunch" : d < 20 ? "leaning" : "fairly sure";
}

/** A prediction, never a bare number: "59% · leaning". */
export function guessLabel(p) {
  return `${pctOf(p)}% · ${sureWord(p)}`;
}

/** The forecast for a pair, in the model's voice, once you have picked:
 *  "it guessed this · 72% · fairly sure", or for a miss the side it guessed,
 *  at the probability it gave that side: "it guessed the other · 62% ·
 *  leaning". `pChosen` is its forecast for the sound you picked. */
export function forecastLine(pChosen) {
  const hit = pChosen >= 0.5;
  const p = hit ? pChosen : 1 - pChosen;
  return `it guessed ${hit ? "this" : "the other"} · ${guessLabel(p)}`;
}

/** TAUGHT's tooltip: everything it learned from, by kind. */
export function taughtTitle({ picks = 0, stars = 0, cuts = 0 } = {}) {
  return `${count(picks, "pick")} · ${count(stars, "star")} · ${count(cuts, "cut")}`;
}

/** The same counts in a sentence: "52 picks, 4 stars, and 2 cuts". */
export function taughtSentence({ picks = 0, stars = 0, cuts = 0 } = {}) {
  return series([count(picks, "pick"), count(stars, "star"), count(cuts, "cut")]);
}

/** The kinds in a taste file's log (`log.observations`, each feedback
 *  externally tagged: Duel, Stars, KeepKill), or null if it has none. */
export function kindsInLog(observations) {
  if (!Array.isArray(observations)) return null;
  const k = { picks: 0, stars: 0, cuts: 0 };
  for (const o of observations) {
    const f = o && o.feedback && typeof o.feedback === "object" ? Object.keys(o.feedback)[0] : "Duel"; // voice: name
    if (f === "Stars") k.stars += 1;
    else if (f === "KeepKill") k.cuts += 1;
    else k.picks += 1;
  }
  return k;
}

// What each walk of a generation that joined nothing came back as, from the
// engine's reason for it (`RefineOutcome` in engine.rs, posted per walk by
// worker.js `genLanded`).
//   no_move          the walk ended where it started
//   duplicate        it landed on a sound the pool already holds
//   not_admitted     a new sound that did not pass the vet, or did not rate
//                    above the sound it would replace (the lowest unsaved
//                    one: `admit_refined`'s bar), so it was not kept
//   outside_support  its seed is somewhere the walk cannot start from
function tally(reasons) {
  const t = { no_move: 0, duplicate: 0, not_admitted: 0, outside_support: 0, other: 0 };
  for (const r of reasons || []) {
    if (r in t) t[r] += 1;
    else t.other += 1;
  }
  return t;
}

/** The toast for a generation that put nothing into the pool. `reasons` is
 *  one engine reason per walk that came back without a child: every walk of
 *  a generation that ran to its end, only the walks that came back before a
 *  stop. `replaced` is what the end of the generation replaced (main.js
 *  `madeRoom`, a sentence with a leading space, or ""). At most two
 *  sentences: what happened, then what was replaced or what to try. */
export function emptyGeneration(gen, reasons, { stopped = false, replaced = "" } = {}) {
  const list = reasons || [];
  const n = list.length;
  const t = tally(list);
  const tail = (advice) => replaced || (advice ? ` ${advice}` : "");
  if (n === 0) {
    return stopped
      ? `Generation ${gen} stopped before it bred anything.${replaced || " The pool is as it was."}`
      : `Generation ${gen}: nothing joined the pool.${tail("")}`;
  }
  // A stop drops the walks still out, so a stopped generation is counted
  // walk by walk: "every walk" would claim the ones that never came back.
  const head = stopped ? `Generation ${gen} stopped` : `Generation ${gen}`;
  const before = stopped ? " before it stopped" : "";
  if (t.outside_support === n) {
    const what = stopped
      ? `${count(n, "seed")} it picked couldn’t be bred from${before}`
      : "nothing could be bred, because every seed it picked has a knob on its stop or is deeper than the model scores";
    return `${head}: ${what}.${tail("Nudge those knobs off their stops.")}`;
  }
  if (t.no_move === n) {
    const what = stopped ? `${count(n, "walk")} came back unchanged${before}` : "every walk came back unchanged";
    return `${head}: ${what}.${tail("A few more picks, or ⚡ on a sound you like, gives the next one a direction.")}`;
  }
  if (t.not_admitted === n) {
    return `${head}: ${n} ${n === 1 ? "was" : "were"} bred${before}, but ${n === 1 ? "it didn’t rate above the sound it would replace" : "none rated above the sounds they would replace"}.${tail("")}`;
  }
  if (t.duplicate === n) {
    return `${head}: ${n} ${n === 1 ? "was" : "were"} bred${before}, but ${n === 1 ? "it matched a sound" : "each matched a sound"} already in the pool.${tail("")}`;
  }
  const parts = [];
  if (t.not_admitted) parts.push(`${t.not_admitted} rated below the ${t.not_admitted === 1 ? "sound it" : "sounds they"} would replace`);
  if (t.duplicate) parts.push(`${t.duplicate} matched ${t.duplicate === 1 ? "a sound" : "sounds"} already there`);
  if (t.no_move) parts.push(`${count(t.no_move, "walk")} came back unchanged`);
  if (t.outside_support) parts.push(`${t.outside_support} couldn’t start from ${t.outside_support === 1 ? "its seed" : "their seeds"}`);
  if (t.other && parts.length === 0) parts.push(`${count(t.other, "walk")} bred nothing`);
  // One sentence, so the replaced clause still leaves two at most.
  return stopped
    ? `Generation ${gen} stopped with nothing new in the pool (before the stop, ${series(parts)}).${replaced}`
    : `Generation ${gen} put nothing new in the pool: ${series(parts)}.${replaced}`;
}

/** Why ⚡ evolve from this added nothing, from the engine's reason. `name`
 *  is the sound it walked from. */
export function evolveRefusal(reason, name) {
  const from = name ? ` from ${name}` : "";
  switch (reason) {
    case "outside_support":
      return `⚡ can’t start${from}: a knob is on its stop, or the patch is deeper than the model scores. Nudge a knob off its stop, or take a module out, and try again.`;
    case "no_taste":
      return "Nothing to breed toward yet. Make a few picks first, then evolve.";
    case "unknown_seed":
      return `${name || "That sound"} isn’t in the pool any more: a generation replaced it.`;
    case "duplicate":
      return `⚡${from} landed on a sound the pool already holds. Try again.`;
    case "not_admitted":
      return `⚡ bred a new sound${from}, but it didn’t pass the vet or rate above the sound it would replace. Try again.`;
    default:
      return `⚡${from} came back unchanged. Try again, or loosen some locks.`;
  }
}

// ---- AUDIO IN: your input in the patch (Plan-007 task 4) ----

/** What AUDIO IN says as it asks for an input, is refused one, or loses one.
 *  Plain sentences; the silk labels on the module are `INPUT_SILK`. */
export const INPUT_SAID = Object.freeze({
  asking: "AUDIO IN asks the browser for a microphone or an interface. What it hears stays in this browser.",
  refused: "The browser was refused the input, so AUDIO IN stays in the patch, silent. Allow the microphone in this site’s settings, then press ASK AGAIN.",
  missing: "No input was found, so AUDIO IN stays in the patch, silent. Plug in a microphone or an interface, then press ASK AGAIN.",
  failed: "The input didn’t open, so AUDIO IN is silent. Close any app holding it, then press ASK AGAIN.",
  unsupported: "This browser doesn’t offer its inputs to web pages, so AUDIO IN stays silent.",
  monitorOn: "Monitoring on: your input plays through the sound at its sustain level, with no key down. Use headphones, or the speakers feed back into the microphone.",
  monitorOff: "Monitoring off: your input reaches the meter, not the speakers.",
  monitorNone: "Nothing to monitor yet: AUDIO IN has no input.",
  clipNone: "Nothing to capture yet: AUDIO IN has no input.",
});

/** The labels on the AUDIO IN module: silk, set in capitals by CSS. */
export const INPUT_SILK = Object.freeze({
  monitor: "monitor",
  newClip: "new clip",
  allow: "allow input",
  askAgain: "ask again",
  headphones: "use headphones",
});

/** An input that went away, and the same one back. `label` is the browser's
 *  name for the device. */
export function inputGone(label) {
  return `${label || "The input"} was unplugged, so AUDIO IN is silent until it’s back.`;
}
export function inputBack(label) {
  return `${label || "The input"} is back.`;
}

/** The clip being captured: `seconds` of `label` (Plan-007's audition clip). */
export function clipCapturing(label, seconds) {
  return `Capturing ${seconds} s of ${label || "your input"} as the clip the model hears it through…`;
}
/** NEW CLIP pressed: the capture waits for the input to carry a signal. */
export function clipArmed(label, seconds) {
  return `The next ${seconds} s of ${label || "your input"} become the clip, from the moment it carries a signal. Play into it.`;
}

/** The AUDIO IN module's input line: which input it reads, or why none.
 *  `slot` counts from 0, as the engine's `input` knob does; it is shown
 *  from 1, as a desk numbers its inputs. `state`:
 *  - `live`: its input is open (`label` is the device);
 *  - `meter`: open for the meter only, because the keys read another input;
 *  - `unplugged`: the device it was given is gone;
 *  - `opening`: allowed, and its stream not open yet;
 *  - `empty`: no device has been given that slot;
 *  - `unasked`, `asking`, `refused`, `missing`, `failed`, `unsupported`:
 *    no input at all yet, and why. */
export function inputLine(state, slot, label) {
  const n = `${(slot | 0) + 1}`;
  switch (state) {
    case "live": return `${n} · ${label}`;
    case "meter": return `${n} · ${label} · meter only`;
    case "unplugged": return `${n} · ${label} · unplugged`;
    case "empty": return `${n} · nothing plugged in`;
    case "opening": return `${n} · ${label} · opening…`;
    case "asking": return "asking…";
    case "refused": return "input refused";
    case "missing": return "no input found";
    case "failed": return "input didn’t open";
    case "unsupported": return "no inputs in this browser";
    default: return "no input yet";
  }
}

/** An input's row in the AUDIO IN input menu: "2 · Scarlett 2i2". */
export function inputRow(slot, label) {
  return `${(slot | 0) + 1} · ${label}`;
}

/** An input the browser has not named: "input 3". */
export function inputName(slot) {
  return `input ${(slot | 0) + 1}`;
}

/** The input line as a control's name, for a screen reader: the whole line,
 *  which the module may have cut to fit. */
export function inputLineName(line) {
  return `Input ${line}`;
}

/** AUDIO IN's tooltips (a name and what it does) and its input menu. */
export const INPUT_TIPS = Object.freeze({
  line: "Input: pick a microphone or interface",
  monitor: "Monitor: hear your input through the sound",
  newClip: "New clip: what the model hears it through",
  allow: "Allow input: ask the browser for one",
});
export const INPUT_MENU = Object.freeze({
  title: "audio in",
  sub: "input",
  inUse: "in use",
  unplugged: "unplugged",
});

// ---- a generation as it runs, and the lineage it leaves in the bank ----

/** What one walk came back as, for EVOLVE POOL's narration ("walk 3 of 10 ·
 *  joined the pool"): `child` is the id the engine admitted (`refine_child`'s
 *  `child`, 0 for none) and `reason` the engine's `RefineOutcome` when there
 *  is none. Only `not_admitted` is a child refused: `duplicate` landed on a
 *  sound the pool holds, `no_move` bred nothing, `outside_support` never
 *  started. "" for a reason with nothing to say. */
export function walkSaid(child, reason) {
  if (child > 0) return "joined the pool";
  switch (reason) {
    case "not_admitted":
      return "rated below the pool";
    case "duplicate":
      return "already in the pool";
    case "no_move":
      return "came back unchanged";
    case "outside_support":
      return "couldn’t start";
    default:
      return "";
  }
}

/** EVOLVE POOL once a walk has come back: "walk 3 of 10" (the jobs are
 *  absorbed in order, so the third to come back is the third walk). */
export function walkLabel(done, total) {
  return `walk ${done} of ${total}`;
}

/** Under the bank's New group: the children of its generation that are not
 *  in it, refused when they landed or replaced when it ended. */
export function belowNote(n) {
  return `${n} more ${n === 1 ? "was" : "were"} bred and rated below the pool.`;
}

/** A bred sound's line on its bank row: its seed (`LineageEvent.parent_id`,
 *  by the name it has or last had) and what changed (`LineageEvent.diff`, in
 *  words), "from Soft Pad · +reverb, cutoff 1.2 kHz → 3.4 kHz". */
export function fromLine(seedName, changes) {
  return changes ? `from ${seedName} · ${changes}` : `from ${seedName}`;
}

/** The line under a sound's name on its card (Plan-005 task 3): where it
 *  came from. A bred sound's is its bank row's (`fromLine`, from its
 *  `LineageEvent`); any other's is its origin, as the bank's glyph says it. */
export function cardLine(origin, seedName, changes) {
  if (seedName) return fromLine(seedName, changes);
  return {
    prior: "grown fresh, with no taste in it yet",
    refined: "bred toward your taste",
    edited: "your edit, kept as new",
    preset: "a hand-made preset",
  }[origin] || "";
}

/** Under the two faces beside PATCH's guess plate: the patch as it is, and
 *  the patch with the guessed module, as rendered for the guess. */
export const GUESS_FACES = ["as it is", "with it"];

/** Why a card has no face (`noplay`, `few`, `coming`), in the dialog's
 *  readout. */
export function cardNoFace(why) {
  return {
    noplay: "this edit doesn't play, so it has no face",
    few: "a face needs at least four sounds to compare with",
    coming: "its face is on its way",
  }[why] || "";
}

/** The download dialog's readout for a card: its size and format. */
export function cardDims(w, h, fmt) {
  return `${w} × ${h} px · the sound's card · ${fmt}`;
}

/** Compare's sentence under its figure. */
export function grownFrom(seedName, generation) {
  return `Grown from ${seedName} in generation ${generation}.`;
}

/** What the model rated a seed and its child when it bred them
 *  (`LineageEvent`'s `parent_utility` and `child_utility`, as the bank's
 *  percentages), in its own voice and with the word for how sure each reads. */
export function bredRatings(seedName, seedP, childName, childP) {
  return `when it bred them, it rated ${seedName} ${guessLabel(seedP)} and ${childName} ${guessLabel(childP)}`;
}

/** The word on a bank row while EVOLVE POOL is pointed at:
 *  - `seed`: a generation breeds from it (`ratings.seeds`, or the running
 *    generation's own);
 *  - `may`: a generation opened now may replace it (`ratings.may_replace`; no
 *    sound outside the list can go at its end), or ⚡'s child would, if the
 *    pool takes it;
 *  - `will`: the running generation's end will replace it, stopped now or
 *    run out (`refine_child`'s `retiring`: the lowest unsaved members, as
 *    many as its children put the pool over size, under the posterior it
 *    opened with, so a child taken in adds one and takes none away). Each
 *    child still to come adds the next lowest, so it is not the whole of
 *    what may go: "will", not "may".
 *  The longest fits the stars' place on the narrowest bank (200 px). */
export function markWord(kind) {
  return kind === "seed" ? "seed" : kind === "may" ? "may be replaced" : kind === "will" ? "will be replaced" : "";
}

// ---- what changed from a seed to its child ----

/** The sites of a module, as `tree_diff` names them: its kind (`op`, `src`,
 *  `mod`), whose value is the module's name, or the empty slot's. */
export const STRUCT_SITES = new Set(["op", "src", "mod"]);
/** Grammar bookkeeping a player never sees (a leaf's kind flips whenever a
 *  module is swapped, which says it better). */
export const SKIP_SITES = new Set(["leaf", "uid"]);

/** What changed from a seed to its child (a `LineageEvent`'s `diff`), each
 *  change a phrase, the modules first and then the knobs (`knob(d, site)`
 *  words one).
 *
 *  `tree_diff` is positional: a module inserted above others shifts their
 *  addresses, so one change to what the patch holds can show as several
 *  swaps, removals and additions, and a module that only moved shows as gone
 *  in one place and new in another. So the modules are counted, not read
 *  entry by entry: every module site nets its old name −1 and its new name
 *  +1. A swap `X → Y` is said only where it accounts for a lost X and a
 *  gained Y (walked in the diff's order, one of each consumed per swap);
 *  what is left is said as `+name` (all the gains) then `−name` (all the
 *  losses), `×n` for more than one. A
 *  module that moved nets to nothing and is not said. */
export function changeParts(diff, knob = (d, site) => `${site} ${d.before} → ${d.after}`) {
  // "no mod" / "none" are the empty slot, not a module.
  const empty = (v) => v == null || /^(no\b|none$)/.test(v);
  const net = new Map(); // module name -> gained (+) or lost (−), first seen first
  const bump = (name, n) => net.set(name, (net.get(name) || 0) + n);
  const swaps = [];
  const knobs = [];
  for (const d of diff || []) {
    const site = d.addr.split("#").pop();
    if (SKIP_SITES.has(site)) continue;
    if (STRUCT_SITES.has(site)) {
      if (!empty(d.before)) bump(d.before, -1);
      if (!empty(d.after)) bump(d.after, 1);
      if (!empty(d.before) && !empty(d.after) && d.before !== d.after) swaps.push([d.before, d.after]);
      continue;
    }
    if (d.before == null || d.after == null) continue; // a knob of a module added or removed
    knobs.push(knob(d, site));
  }
  const mods = [];
  for (const [x, y] of swaps) {
    if (net.get(x) < 0 && net.get(y) > 0) {
      mods.push(`${x} → ${y}`);
      bump(x, 1);
      bump(y, -1);
    }
  }
  // What it gained, then what it lost, each in the order first seen.
  for (const [name, n] of net) if (n > 0) mods.push(`+${name}${n > 1 ? ` ×${n}` : ""}`);
  for (const [name, n] of net) if (n < 0) mods.push(`−${name}${n < -1 ? ` ×${-n}` : ""}`);
  return [...mods, ...knobs];
}

/** "a", "a and b", "a, b, and c" (the serial comma, always). */
export function series(parts) {
  if (parts.length <= 1) return parts.join("");
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

/** The first letter capitalized: toasts are sentences. */
export function capital(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** What the model makes of a module it is sure about, on the module rail's
 *  spec card: a sentence after "In 12 of 40 sounds.", where it used to
 *  run on in lowercase ("in analog sustain (60% of your pool) you lean
 *  toward it"). `share` is the style's share of the pool (0..1), `mean` and
 *  `std` the coefficient's posterior (θ). */
export function leanSentence(style, share, mean, std) {
  const sign = mean >= 0 ? "+" : "−";
  return `In ${style} (${Math.round(share * 100)}% of your pool), you lean ` +
    `${mean >= 0 ? "toward" : "away from"} it (θ ${sign}${Math.abs(mean).toFixed(2)} ± ${std.toFixed(2)}).`;
}

// ---------- TASTE and LEARNING ----------

/** The line under TASTE's and LEARNING's title: what the model was fitted
 *  from, in the kinds TAUGHT counts ("From 18 picks and 2 stars."), or how
 *  far it is from its first fit. `left` is picks until the refit that fits
 *  it, 0 while that fit is due or running. */
export function fittedFrom({ fitted = false, picks = 0, stars = 0, cuts = 0, left = 0 } = {}) {
  if (fitted) {
    const parts = [count(picks, "pick")];
    if (stars) parts.push(count(stars, "star"));
    if (cuts) parts.push(count(cuts, "cut"));
    return `From ${series(parts)}.`;
  }
  return left > 0 ? `${count(left, "more pick")} and it fits your taste.` : "Fitting your taste…";
}

/** The map's footer: how many sounds, and how much of how they differ two
 *  axes can hold (`TasteMap::explained`). */
export function mapFoot(n, share) {
  return `A flat view of ${count(n, "sound")}: close dots usually sound alike (it shows ${pctOf(share)}% of how they differ).`;
}

/** The map legend's words beside its halos. */
export function haloLegend(fitted) {
  return fitted ? "it likes more" : "still a guess";
}

/** What a pick taught, for the map's live region (the arrow drawn on it). */
export function pickSaid(picked, passed) {
  return picked && passed ? `You picked ${picked} over ${passed}. Every rating moved.` : "Every rating moved.";
}

/** What a refit did, for the map's live region. */
export function refitSaid() {
  return "It fitted your taste again. Every rating settled.";
}

/** A weight row's words for a screen reader: the quality, which way it
 *  leans, the weight and its spread, and whether it is still a guess. */
export function weightSaid(word, mean, std, guess) {
  const sign = mean >= 0 ? "+" : "−";
  const way = mean >= 0 ? "likes more" : "likes less";
  return `${word}: ${way}, ${sign}${Math.abs(mean).toFixed(2)} ± ${Math.max(0, std).toFixed(2)}${guess ? ", still a guess" : ""}`;
}

/** The disclosure under the weights: all of them, or the few that weigh most. */
export function weightsMore(open, all, few) {
  return open ? `the ${few} that weigh most` : `all ${all} weights`;
}

/** The direction panel's legend. `g` is `likingGradient`'s answer, null
 *  until the ratings spread (no fit yet). */
export function directionLegend(g) {
  return g ? `the arrow: liking rises · explains ${pctOf(g.r2)}%` : "no direction yet";
}

/** Under the forecasts' count: what it expected against what it got. */
export function forecastNote(score) {
  return `expected ${pctOf(score.expected)}% · was ${pctOf(score.was)}%`;
}

/** The weights panel before the first fit, when there are none. */
export const NO_WEIGHTS = "none yet: it weighs nothing until it first fits";

/** The forecasts panel with none to show: before the first fit, when there
 *  is nothing to forecast with, or after it, before the next pick. */
export function noForecasts(fitted) {
  return fitted ? "none yet: it guesses before each pick from here" : "none yet: it starts guessing when it first fits";
}

/** The forecast strip's words for a screen reader. */
export function stripSaid(n) {
  return `${count(n, "forecast")}: the chance it gave the sound you picked.`;
}

/** The math, in sentences, from the engine's own numbers
 *  (`WasmEngine::model_facts`) and the app's refit cadence. Each under 25
 *  words. */
export function mathLines(facts, fitEvery) {
  const f = facts || {};
  return [
    `φ is a sound’s ${f.audio} audio and ${f.structural} structural features, standardized, and w holds one weight for each.`,
    "A pick moves w along φ(picked) − φ(passed), so every sound’s rating moves at once, not only the two you heard.",
    `It holds ${f.draws} draws of w. Each pick reweights them, and every ${fitEvery} picks it fits them again.`,
    `It is allowed one more style for every ${f.obs_per_style} things it learns from, up to ${f.styles_max}.`,
    "It rates a sound by the style that likes it most.",
  ];
}

/** The short labels TASTE and LEARNING draw: silk labels lowercase (CSS sets
 *  them in capitals), tooltips a name and a key. */
export const TASTE_LABELS = {
  play: "▶ play",
  open: "open",
  openTitle: "Open it · Enter",
  noGuess: "no guess yet",
  chipTitle: "Show its weights",
  nameTitle: "Name this style",
  exemplarTitle: "Hear the sound it rates highest",
  noExemplarTitle: "Nothing to play for this style yet",
  stripEnd: "100% for the one picked",
  stripEndShort: "100%",
  togTitle: "Color by taste",
  sound: "sound",
  taste: "taste",
  track: "Taste over time",
  trackPlay: "Replay how your taste moved",
  trackStop: "Stop the replay",
  replay: "replay",
  replayTitle: "Replay · R",
  noReplayTitle: "Nothing to replay yet",
};

/** The picks a moment on the track came after: "after 7 picks", or before
 *  any. */
export function pickWords(n) {
  return n === 0 ? "before any picks" : `after ${count(n, "pick")}`;
}

/** The track's label: the moment shown, "now · after 7 picks" at its end. */
export function trackLabel(n, now) {
  return now ? `now · ${pickWords(n)}` : pickWords(n);
}

/** The line under TASTE's title while the track shows an earlier moment. */
export const LOOKING_BACK = "Looking back.";

/** A generation's mark on the track: how many sounds joined the map. */
export function joinedLabel(n) {
  return `+${n}`;
}

/** What one step of LEARNING's replay moved most, for a screen reader. */
export function movedMost(word, d) {
  return `That pick moved ${word} most (${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(2)}).`;
}

// What a kept moment was, by its kind (taste-geom's history).
const MOMENT = { map: "refit", gen: "generation", file: "opened file", star: "a star", cut: "a cut", keep: "a cut" };

/** REPLAY's label for a step: which moment, and the picks it came after
 *  ("refit · after 24 picks"; a pick's is "after 21 picks"). */
export function replayAt(kind, n) {
  return MOMENT[kind] ? `${MOMENT[kind]} · ${pickWords(n)}` : pickWords(n);
}

/** What a REPLAY step moved most, credited to what it was: a single pick, a
 *  refit, a generation, an opened file, a star or a cut; or, when moments
 *  between were not kept, the change since the one before. */
export function stepMoved(kind, single, word, d) {
  const by = `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(2)}`;
  if (kind === "map") return `The refit moved ${word} most (${by}).`;
  if (kind === "gen") return `The generation moved ${word} most (${by}).`;
  if (kind === "file") return `The opened file moved ${word} most (${by}).`;
  if (!single) return `Since the moment before, ${word} moved most (${by}).`;
  if (kind === "star") return `That star moved ${word} most (${by}).`;
  if (kind === "cut" || kind === "keep") return `That cut moved ${word} most (${by}).`;
  return movedMost(word, d);
}

/** The small map's legend while a weight is pointed at. */
export function dotsLegend(word) {
  return `dots: ${word}`;
}

/** The card beside a sound on the map: the bank's number for it, as a
 *  prediction ("would like: 59% · leaning"). */
export function plateGuess(like) {
  return `would like: ${guessLabel(like)}`;
}

/** A play button's tooltip: the sound's name. */
export function playTitle(name) {
  return `Play ${name}`;
}

/** A style chip, for a screen reader: its name and its share of the pool. */
export function chipSaid(name, share) {
  return `${name}, ${pctOf(share)}% of the pool`;
}

/** The weights' own label, for a screen reader: how many are settled. */
export function weightsSaid(style, settled, guesses) {
  return `${style}: ${settled} settled, ${guesses} still a guess`;
}

/** The direction panel, for a screen reader. */
export function directionSaid(name, legend) {
  return `The pool on the map${name ? `, ${name} ringed` : ""}. ${legend}.`;
}

/** The copy button's label as it answers. */
export function copyLabel(state) {
  return state === "copied" ? "copied" : state === "select" ? "select and copy" : "copy as JSON";
}

/** Whether this browser is on an Apple platform, whose keyboards say ⌘. */
export function onApple(nav = globalThis.navigator) {
  const p = (nav && (nav.userAgentData?.platform || nav.platform)) || "";
  return /mac|iphone|ipad|ipod/i.test(p);
}

/** Every key chord in `s` written with the Mac's symbols (⌘Z, ⇧⌘Z, ⌘0,
 *  ⇧Esc, ⇧1–9, a lone ⇧), in the platform's own words: unchanged on an Apple
 *  platform, and elsewhere Ctrl, Alt and Shift in that order, spelled as
 *  the guide spells them (voice.md: "⌘K (Ctrl K)"): Ctrl Z, Ctrl Shift Z,
 *  Shift Esc. The app accepts Ctrl wherever it accepts ⌘. */
export function platformKeys(s, apple = onApple()) {
  if (apple || !s) return s;
  return s.replace(/([⌃⌥⇧⌘]+)([A-Za-z0-9]+(?:–[0-9]+)?|[^\sA-Za-z0-9])?/g, (_, mods, key) => {
    const names = [];
    if (/[⌘⌃]/.test(mods)) names.push("Ctrl");
    if (mods.includes("⌥")) names.push("Alt");
    if (mods.includes("⇧")) names.push("Shift");
    // A modifier on its own ("⇧ places them freely") is just its name.
    return key ? `${names.join(" ")} ${key}` : names.join(" ");
  });
}

// ---- PATCH: the model's guess for the next module ----
// The worker's `guess` reply (`WasmEngine::guess_rank`): a ranking, best
// first by the lower bound of the gain (`lcb`), each guess with the pick
// forecast `p` and `why`, the part of the gain that leads (a PERFORM control
// and the end word it moves toward, or a structural coordinate); or a
// refusal (`reason`). Its reason is the model's italic, lowercase and in the
// third person (voice.md, the **guess** row).

/** Why the top guess leads, or null when no part of it leans the player's
 *  way. `nice` names a structural coordinate (`n_reverb` → "reverbs"). */
export function guessWhy(why, nice = (s) => s) {
  if (!why) return null;
  if (why.control && why.word) return `it moves toward ${why.word}, as your picks lean`;
  if (why.coordinate) return `your picks lean toward ${why.moved < 0 ? "less" : "more"} ${nice(why.coordinate)}`;
  return null;
}

/** The model's line for the top guess: its reason, then its forecast with
 *  the sure word, said over the pool's average when the patch makes no sound
 *  (`against` "pool"). The lower bound it is ranked by can be under zero
 *  (the list leads with the best bound, not with a module it is sure will
 *  help), and then the line says so. */
export function guessLine(g, against = "patch", nice) {
  const reason = guessWhy(g.why, nice) || "no part of it leans your way";
  const pct = `${pctOf(g.p)}%`;
  const forecast = against === "pool"
    ? `${pct} over your pool’s average · ${sureWord(g.p)}`
    : `${pct} · ${sureWord(g.p)}`;
  return `${reason} · ${forecast}${g.lcb < 0 ? " · it may not help" : ""}`;
}

/** What the model says when it has no guess to show, or null when it says
 *  nothing: before the warm start (`no_taste`) and with no patch open. */
export function guessRefusal(data) {
  if (!data) return null;
  switch (data.reason) {
    case "no_taste":
    case "no_patch":
      return null;
    case "full":
      return "no guess: nothing more fits, so a module has to come out first";
    case "unmeasured":
      return "no guess yet: it hasn’t heard this patch";
    default:
      break;
  }
  if (Array.isArray(data.guesses) && data.guesses.length === 0) {
    if (data.rendered < data.planned) return "no guess yet: it has not heard the modules that fit here";
    return data.skipped > 0
      ? "no guess left here: every module that fits was skipped"
      : "no guess: none of the modules that fit here passed the safety check";
  }
  return null;
}

/** A cable's measured level (`edit_cable_levels`, dB re 1 V, the live
 *  meter's scale) as a tooltip: "−14 dB", or "nothing" at the probe's floor. */
export function levelWord(db, floor = -120) {
  if (db == null || !Number.isFinite(db) || db <= floor + 0.5) return "nothing";
  const r = Math.round(db);
  return `${r < 0 ? "−" : ""}${Math.abs(r)} dB`;
}

/** PERFORM's palette: the eighteen controls the engine can measure, in the
 *  engine's order (`auracle_session::perform::PALETTE`, whose index is how a
 *  control is named across the boundary: a wiring's `index`, an aimed
 *  offer's `control`, a graft's `k`). The first six are the panel's six
 *  (`CONTROLS`), at the same indices. Names and end words are the engine's
 *  (`NamedControl::name`, `low`, `high`), approved with the palette
 *  (www/brand/voice.md's word table); `aim` is "more of it" each way, [low,
 *  high], for an aimed offer's line (*grittier by 0.8σ*); `hear` is what a
 *  player hears it do, and `how` what it listens to, for How it works. Keep
 *  this table in step with `PALETTE`: `tests/words.test.mjs` checks its
 *  shape, and `perform_palette.spec.js` checks the names against what the
 *  engine wires. */
export const PALETTE = [
  { name: "Bright", low: "dark", high: "bright", family: "Tone", aim: ["darker", "brighter"],
    hear: "Where the energy sits, low or high: the top opens or closes.",
    how: "It listens to where the spectrum’s center sits and where its top rolls off." },
  { name: "Snap", low: "bloom", high: "snap", family: "Dynamics", aim: ["softer", "snappier"],
    hear: "How fast the attack is, and how sharp its peak.",
    how: "It listens to the attack’s length and how far the peak stands above the rest." },
  { name: "Motion", low: "still", high: "restless", family: "Movement", aim: ["stiller", "more restless"],
    hear: "How much a held note moves: slow sweeps, pulsing, and flutter.",
    how: "It listens to a held note’s movement in all three bands, and how far its center wanders." },
  { name: "Body", low: "thin", high: "full", family: "Weight", aim: ["thinner", "fuller"],
    hear: "How much weight sits below about 250 Hz.",
    how: "It listens to the share of the sound below about 250 Hz." },
  { name: "Grit", low: "smooth", high: "rough", family: "Character", aim: ["smoother", "grittier"],
    hear: "How noisy the sound is, rather than tonal.",
    how: "It listens to how flat the spectrum is: noise is flat, a note is peaked." },
  { name: "Space", low: "close", high: "far", family: "Space", aim: ["closer", "farther"],
    hear: "How loud the tail is after the notes stop.",
    how: "It listens to the tail’s level after the notes end, which the release sets." },
  { name: "Warmth", low: "cold", high: "warm", family: "Tone", aim: ["colder", "warmer"],
    hear: "Weight low down, and a softer top of the keyboard.",
    how: "It listens to the share below about 250 Hz, and how much quieter the highest note is than the held one." },
  { name: "Air", low: "closed", high: "airy", family: "Tone", aim: ["more closed", "airier"],
    hear: "The very top, above the notes, opening while the body stays.",
    how: "It listens to the highest partials and any breath, against where the spectrum’s center sits." },
  { name: "Thump", low: "light", high: "thumping", family: "Weight", aim: ["lighter", "more thumping"],
    hear: "Weight low down that hits.",
    how: "It listens to the share below about 250 Hz, and how far the peaks stand above the rest." },
  { name: "Heft", low: "slight", high: "heavy", family: "Weight", aim: ["slighter", "heavier"],
    hear: "Dense, held weight: the opposite of a light pluck.",
    how: "It listens to how full of level the sound stays, and the share below about 250 Hz." },
  { name: "Punch", low: "gentle", high: "punchy", family: "Dynamics", aim: ["gentler", "punchier"],
    hear: "The size of the hit against the rest.",
    how: "It listens to the peaks, and how much the level moves over the phrase." },
  { name: "Round", low: "hard", high: "round", family: "Dynamics", aim: ["harder", "rounder"],
    hear: "A soft attack and few harmonics.",
    how: "It listens to the attack’s length and where the top rolls off." },
  { name: "Throb", low: "steady", high: "throbbing", family: "Movement", aim: ["steadier", "more throbbing"],
    hear: "Pulsing and tremolo.",
    how: "It listens to a held note’s movement between 2 and 8 Hz, alone." },
  { name: "Sway", low: "fixed", high: "swaying", family: "Movement", aim: ["more fixed", "more swaying"],
    hear: "Slow sweeps and breathing.",
    how: "It listens to a held note’s movement between 0.5 and 2 Hz, alone." },
  { name: "Distance", low: "near", high: "distant", family: "Space", aim: ["nearer", "more distant"],
    hear: "What distance does to a sound: a longer tail, a softer attack, smaller peaks, and a duller top.",
    how: "It listens to the tail, and at half weight to the attack, the peaks, and where the top rolls off." },
  { name: "Haze", low: "clear", high: "hazy", family: "Space", aim: ["clearer", "hazier"],
    hear: "A wash: a tail, a shimmer, and the peaks smoothed away.",
    how: "It listens to the tail, a held note’s movement between 8 and 30 Hz, and the peaks." },
  { name: "Bite", low: "mild", high: "biting", family: "Character", aim: ["milder", "more biting"],
    hear: "An edge: a filter that snaps open, or a resonance that rings.",
    how: "It listens to how fast the spectrum changes, and to the highest partials." },
  { name: "Lo-fi", low: "clean", high: "worn", family: "Character", aim: ["cleaner", "more worn"],
    hear: "Worn like tape: hiss, a dull top, and flutter.",
    how: "It listens to how flat the spectrum is, where the top rolls off, and movement between 8 and 30 Hz." },
];

/** The palette's six families, in the order the palette lists them. */
export const FAMILIES = ["Tone", "Weight", "Dynamics", "Movement", "Space", "Character"];

/** What a control does on the sound you're playing, from its measured
 *  wiring (`perform_wire`'s entry for it), for How it works: the knobs it
 *  turns, that the knobs here can't do it, or that it hasn't been measured
 *  yet. `knobs` is the knobs' names, already in words. */
export function onThisSound(name, { search = false, pending = false, knobs = [], only = "" } = {}) {
  if (pending) return `${name} hasn’t been measured on this sound yet. It turns once it has.`;
  if (search) return `Nothing here turns ${name}: turn it past the notch, and it asks for an offer instead.`;
  const turns = knobs.length ? `On this sound it turns ${series(knobs)}.` : `On this sound it turns nothing yet.`;
  return only ? `${turns} It turns toward ${only} only.` : turns;
}

/** The palette's count, for its header: "6 of 8 on the panel". */
export function panelCount(n, max) {
  return `${n} of ${max} on the panel`;
}
