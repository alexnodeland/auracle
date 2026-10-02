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
