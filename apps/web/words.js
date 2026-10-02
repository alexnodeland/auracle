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
