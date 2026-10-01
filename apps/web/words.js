// Sentences the instrument builds from what the engine reports, rather than
// writes once. Pure (no DOM, no state), so tests/words.test.mjs holds them to
// www/brand/voice.md: plain sentences, digits, no em dashes, a word beside
// every percentage, and each outcome said as what actually happened.

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
