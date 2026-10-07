#!/usr/bin/env node
// The specs a change reaches: for `make browser-changed`, what to run on a
// workstation before pushing, and for CI's fast lane on a PR (ci.yml's
// `changes` job), what runs there. The merge queue's run is the whole tier,
// twelve wide.
//
//   node changed.mjs [base]           CI's selection, one spec file per line (base: origin/main)
//   node changed.mjs --views [base]   a workstation's: the same, and the views a
//                                     change to main.js, worker.js, the page or
//                                     the engine reaches (`make browser-changed`)
//   node changed.mjs --touched [base] the spec files the change adds or edits
//                                     itself: `make browser-changed REPEAT=n`
//                                     runs these n times, and the rest once
//
// A changed spec runs; a changed helper runs every spec that requires it; a
// changed app module runs the specs named for what it draws (MODULES below).
// main.js, worker.js, index.html, style.css and the engine reach every level,
// so without --views a change to them prints nothing and says so: CI's fast
// lane then runs the smoke pair, and the merge queue's run the whole tier.
//
// With --views they reach the views (VIEWS below). A change to main.js runs
// the specs of each view its changed lines are drawn in, told by the section
// heading above them (SECTIONS); a section no rule names (the state, the
// worker protocol, boot) reaches every view. Every view, and worker.js, the
// page's markup and styles, the suite's config and the engine, run each
// view's sample: a few specs per view that go through it end to end.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync, realpathSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

// An app module, and the spec-name prefixes that exercise what it draws.
export const MODULES = {
  "apps/web/perform.js": ["perform_", "pad_keys", "responsive"],
  "apps/web/patch.js": ["patch_"],
  "apps/web/taste.js": ["taste_"],
  "apps/web/taste-geom.js": ["taste_"],
  "apps/web/audio-in.js": ["audio_in"],
  "apps/web/takes.js": ["audio_in_takes"],
  "apps/web/explain.js": ["explain"],
  "apps/web/faces.js": ["faces", "evolve_cards", "bank_row"],
  // The presets' shipped faces, and which a session draws: the warm start's
  // cards and the PRESETS rows; the file's bytes are the built wasm's own
  // render of each preset (boot_agrees, which opens no page).
  "apps/web/shipped-faces.js": ["faces", "first_run"],
  "apps/web/preset-faces.json": ["faces", "first_run", "boot_agrees"],
  "apps/web/vessel.js": ["faces", "perform_stage", "shell_zoom"],
  "apps/web/guide.js": ["guide_pill", "first_run"],
  "apps/web/deal.js": ["evolve_ahead", "evolve_truth", "evolve_feedback", "budgets"],
  "apps/web/bank-find.js": ["bank_find"],
  "apps/web/marks.js": ["bank_lineage", "bank_kept"],
  "apps/web/params.js": ["session_seed"],
  "apps/web/warm.js": ["first_run", "faces", "text_fits"],
  "apps/web/shell.js": ["shell_levels", "shell_zoom", "model_view", "guide_pill", "cmdk"],
  "apps/web/levels.js": ["shell_levels", "shell_zoom", "cmdk"],
  "apps/web/midi.js": ["midi_announced"],
  "apps/web/booth.js": ["booth"],
  "apps/web/words.js": ["text_fits", "evolve_feedback", "taste_profile"],
  "apps/web/support.js": ["taste_marks", "patch_model_view", "patch_catalog"],
  "apps/web/live-audio.js": ["smoke", "patch_audible", "audio_in", "perform_struggling_audio"],
  // Whether the audio is struggling: the protections main switches on.
  "apps/web/strain.js": ["perform_struggling_audio"],
  "apps/web/farm.js": ["faces", "evolve_breeds_beside_you", "evolve_generation_timing"],
  // Both workers open the render cache's store through it, at boot; the
  // fixture writes and reads the store through it too (`reuseRenders`).
  "apps/web/render-store.js": ["faces", "evolve_breeds_beside_you", "evolve_generation_timing", "fixture_renders"],
  // The toast lane's queue: main.js's `note` hands it every toast.
  "apps/web/toasts.js": ["failure_flows", "evolve_truth", "fixture_tap"],
};
export const EVERYWHERE = /^(apps\/web\/(main\.js|worker\.js|index\.html|style\.css)|crates\/|Cargo\.(toml|lock)$)/;

// The views main.js draws: the spec-name prefixes that exercise each, and
// its sample. A spec belongs to the view it opens and asserts on; one that
// crosses views (the levels, the keys, the boot) is the shell's.
export const VIEWS = {
  perform: { specs: ["perform_", "pad_keys", "booth", "midi_announced", "explain"], sample: ["perform_truth"] },
  patch: { specs: ["patch_", "audio_in", "keys_are_not_notes", "space_after_a_click"], sample: ["patch_truth"] },
  evolve: { specs: ["evolve_", "faces"], sample: ["evolve_truth"] },
  taste: { specs: ["taste_"], sample: ["taste_marks"] },
  bank: { specs: ["bank_"], sample: ["bank_row"] },
  shell: {
    specs: [
      "shell_levels", "shell_zoom", "model_view", "guide_pill", "cmdk", "first_run", "warm_start", "film_chip", "text_fits", "type_scale",
      "narrow_gate", "keys_for_the_platform", "responsive", "session_seed", "restore", "budgets", "smoke", "failure_flows",
    ],
    sample: ["smoke", "failure_flows", "shell_levels"],
  },
};
// Specs no view draws: the fixture's own tests (its tap, and the renders a
// boot reuses), and the engine's, which opens no page (the browser's engine
// deals what the native one deals). A change to the engine runs the last
// beside the samples.
export const NO_VIEW = ["fixture_tap", "fixture_renders", "boot_agrees"];
export const ENGINE_SPECS = ["boot_agrees"];

// main.js's sections, by their headings, and the views each draws. The first
// rule a heading matches wins, so the narrow rules come first, and a word a
// broader heading holds is anchored (`flow` alone would be in "overflow"):
// every alternative must win a heading of main.js, or changed.test.mjs
// fails. A heading no rule matches (the state, the worker protocol, boot)
// reaches every view.
export const SECTIONS = [
  // The rack's engine facts are drawn on PATCH; the fourth names PERFORM's controls.
  [/PERFORM controls turn a knob/, ["patch", "perform"]],
  [/engine fact|family lean/, ["patch"]],
  [/commit deals a real duel/, ["patch", "evolve"]],
  [/first-run/, ["shell"]],
  [/^PERFORM$|performed circuit|^measurements, for those|^booth mode|^live instrument|^virtual keyboard|^performance controls|^recording|Web MIDI/, ["perform"]],
  [/duel|pair|utility readout|structural budget|teaching act|^what a generation does|^a child buds|^Compare/, ["evolve"]],
  [/^patch bank|^the three banks|^presets$|^lineage$|^patch share/, ["bank"]],
  [/^the model view/, ["shell"]],
  [/taste|TASTE|^profile$/, ["taste"]],
  [
    /^undo\/redo|workbench|bench|^layout$|freeform|FREEFORM|^touch$|readout flash|cable|differential flow|flow animation|mod-slot|MOTION|focus retention|CANVAS|level of detail|silkscreen|fits and moves|minimap|pointer and wheel|plate|auto-pan|frame changed|structural edits|^locks|tree rewrites|sockets|SOCKETS|structure menu|destructive verbs|floating menu|knob geometry|rack keyboard|MODULE TABLE|patch-tree|held modules|NODE BANK|AUDITION|catalog|CONNECTION GRAMMAR|PICK-MODE|wire drawing|SCOPE|scope|IMAGE EXPORT|^selection$|^fonts$|style inlining|PNG tEXt|^an open reaches the voices/,
    ["patch"],
  ],
  [/^the levels$|^the face carried between the levels|^a sound taken up from the bank|toast|^next step$|job slot|^the films and the guide$|^⌘K|engine failing/, ["shell"]],
];
// The files whose section headings say which views a change reaches.
export const SECTIONED = ["apps/web/main.js"];
// With --views: the engine, which every view's sample and the engine's own
// spec run for; and the page's markup and styles, its dev server, its
// wirings, the suite's config and its packages, which every view's sample
// runs for.
const ENGINE = /^(apps\/web\/worker\.js|crates\/|Cargo\.(toml|lock)$|rust-toolchain\.toml$)/;
const PAGE = /^(apps\/web\/(index\.html|style\.css|serve\.py|perform-wirings\.json|fonts\/)|tests\/web\/(playwright\.config\.js|package(-lock)?\.json)$)/;

/** The views a section names: its heading's, or for a subsection whose
 *  heading names none, its section's; null for every view. A section is a
 *  heading's title, or `{ title, parent }` (a subsection, under `parent`). */
export function viewsOf(section) {
  const { title, parent } = typeof section === "string" ? { title: section } : section;
  for (const [re, views] of SECTIONS) if (re.test(title)) return views;
  return parent === undefined ? null : viewsOf(parent);
}

/** A file's section headings, in order: a banner (a rule of `=` or `-`, the
 *  title, the rule again) or `// ---------- title ----------`, and under
 *  either, a subsection's `// ---- title ----` (shorter rules), which
 *  carries the title of the section it is in as `parent`. */
export function headings(source) {
  const lines = source.split("\n");
  const rule = (s) => s !== undefined && /^\/\/ (={20,}|-{40,})$/.test(s);
  const out = [];
  let section;
  for (let i = 0; i < lines.length; i++) {
    const m = /^\/\/ (-{3,}) (.+?) -{3,}$/.exec(lines[i]);
    if (m && m[1].length < 10 && section !== undefined) out.push({ line: i + 1, title: m[2], parent: section });
    else if (m) out.push({ line: i + 1, title: (section = m[2]) });
    else if (rule(lines[i]) && rule(lines[i + 2]) && /^\/\/ \S/.test(lines[i + 1] || "")) {
      out.push({ line: i + 2, title: (section = lines[i + 1].slice(3)) });
      i += 2;
    }
  }
  return out;
}

/** The changed line ranges of a `git diff -U0`, on the new side: [first,
 *  last]; a deletion is the line it follows (or 1). */
export function hunks(diff) {
  const out = [];
  for (const m of diff.matchAll(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Math.max(Number(m[1]), 1);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    out.push([start, start + Math.max(count, 1) - 1]);
  }
  return out;
}

/** The sections the ranges touch, as `headings` gives them (without their
 *  line). A line above the first heading is in none, and gives null (every
 *  view). */
export function sectionsTouched(source, ranges) {
  const hs = headings(source);
  const out = new Map();
  for (const [a, b] of ranges) {
    if (!hs.length || a < hs[0].line) out.set(null, null);
    hs.forEach((h, k) => {
      const end = k + 1 < hs.length ? hs[k + 1].line - 1 : Infinity;
      if (h.line <= b && end >= a) out.set(h.line, h.parent === undefined ? { title: h.title } : { title: h.title, parent: h.parent });
    });
  }
  return [...out.values()];
}

const named = (spec, prefixes) => prefixes.some((p) => spec.startsWith(p));

/** The selection, from the files that changed. `specs` and `helpers` are
 *  tests/web's; `requires(spec, helper)` says whether a spec reaches a
 *  helper; `sections[file]` lists the sections a change to a sectioned file
 *  touched (`sectionsTouched`'s; a bare title will do). Returns the specs;
 *  of them, the ones the change adds or edits itself (`touched`: a helper's
 *  or a module's specs, or a view's, are not); the files that reach every
 *  level (which CI's selection names no spec for); and, with `views`, what
 *  each of those reached: the views its sections name, and whether every
 *  view's sample runs (`every`, with the sections no rule names). */
export function select({ files, specs, helpers, requires, views = false, sections = {} }) {
  const out = new Set();
  const touched = new Set();
  const wide = [];
  const reached = [];
  const add = (prefixes) => {
    for (const s of specs) if (named(s, prefixes)) out.add(s);
  };
  const samples = Object.values(VIEWS).flatMap((v) => v.sample);
  for (const f of files) {
    const rel = relative("tests/web", f);
    if (f.startsWith("tests/web/") && f.endsWith(".spec.js")) {
      if (specs.includes(rel)) {
        out.add(rel);
        touched.add(rel);
      }
    } else if (f.startsWith("tests/web/") && helpers.includes(rel)) {
      for (const s of specs) if (requires(s, rel)) out.add(s);
    } else if (MODULES[f]) {
      add(MODULES[f]);
    } else if (EVERYWHERE.test(f) || f === "tests/web/playwright.config.js") {
      wide.push(f);
    }
    // Prose reaches no browser.
    if (!views || f.endsWith(".md")) continue;
    if (SECTIONED.includes(f)) {
      // Each named view's specs; and a section no rule names (or a line
      // above the first heading) reaches every view, which runs the samples.
      const vs = new Set();
      const unnamed = [];
      for (const t of sections[f] || [null]) {
        const v = t === null ? null : viewsOf(t);
        if (v === null) unnamed.push(t === null ? "(above the first heading)" : t.title || t);
        else v.forEach((x) => vs.add(x));
      }
      for (const v of vs) add(VIEWS[v].specs);
      if (unnamed.length) add(samples);
      reached.push({ file: f, views: [...vs].sort(), every: unnamed.length > 0, unnamed });
    } else if (ENGINE.test(f)) {
      add([...samples, ...ENGINE_SPECS]);
      reached.push({ file: f, views: [], every: true, unnamed: [] });
    } else if (PAGE.test(f)) {
      add(samples);
      reached.push({ file: f, views: [], every: true, unnamed: [] });
    }
  }
  return { specs: [...out].sort(), touched: [...touched].sort(), wide, reached };
}

// git, without a GIT_* variable from whoever called it (a hook's GIT_DIR or
// GIT_INDEX_FILE would point it at another repository or index), and
// without the file-system monitor: on a loaded machine its daemon fell
// behind, and git called an edited file unchanged.
function git(args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
  return execFileSync("git", ["-c", "core.fsmonitor=false", ...args], { cwd: ROOT, encoding: "utf8", env, maxBuffer: 64 << 20 });
}

function main(argv) {
  const views = argv.includes("--views");
  const onlyTouched = argv.includes("--touched");
  const base = argv.filter((a) => !a.startsWith("--"))[0] || "origin/main";
  let files;
  let mergeBase;
  try {
    mergeBase = git(["merge-base", base, "HEAD"]).trim();
    const committed = git(["diff", "--name-only", mergeBase]);
    const untracked = git(["ls-files", "--others", "--exclude-standard"]);
    files = [...new Set(`${committed}\n${untracked}`.split("\n").filter(Boolean))];
  } catch (e) {
    console.error(`changed.mjs: cannot diff against ${base}: ${e.message.split("\n")[0]}`);
    process.exit(2);
  }

  const specs = readdirSync(HERE).filter((f) => f.endsWith(".spec.js")).sort();
  const helpers = readdirSync(HERE).filter((f) => f.endsWith(".js") && !f.endsWith(".spec.js") && f !== "playwright.config.js");
  const requiresDirectly = (file, helper) => {
    const src = readFileSync(join(HERE, file), "utf8");
    const name = helper.replace(/\.js$/, "");
    return new RegExp(`require\\(["']\\./${name}(\\.js)?["']\\)`).test(src);
  };
  // Through other helpers too: patch_page.js requires shell.js, so a spec that
  // requires patch_page.js reaches shell.js.
  const requires = (spec, helper, seen = new Set()) => {
    if (requiresDirectly(spec, helper)) return true;
    return helpers.some((h) => !seen.has(h) && h !== helper && requiresDirectly(spec, h) && (seen.add(h), requires(h, helper, seen)));
  };

  // The headings a change to a sectioned file touched: its diff against the
  // merge base, on the working tree's lines, so uncommitted edits count. An
  // untracked file has no diff, and reaches every view.
  const sections = {};
  if (views) {
    for (const f of SECTIONED.filter((s) => files.includes(s) && existsSync(join(ROOT, s)))) {
      const ranges = hunks(git(["diff", "-U0", "--no-color", mergeBase, "--", f]));
      sections[f] = ranges.length ? sectionsTouched(readFileSync(join(ROOT, f), "utf8"), ranges) : [null];
    }
  }

  const got = select({ files, specs, helpers, requires, views, sections });
  if (onlyTouched) {
    for (const s of got.touched) console.log(s);
    return;
  }
  if (views) {
    for (const r of got.reached) {
      const named_ = r.views.length ? `${r.views.join(", ")} (by its sections)` : "";
      const every = r.every ? `every view's sample${r.unnamed.length ? ` (sections no view names: ${r.unnamed.join("; ")})` : ""}` : "";
      console.error(`changed.mjs: ${r.file} reaches ${[named_, every].filter(Boolean).join(", and ")}`);
    }
  } else if (got.wide.length) {
    console.error(`changed.mjs: ${got.wide.join(", ")} reach every level; name the specs for what you changed, or let CI run the tier.`);
  }
  for (const s of got.specs) console.log(s);
}

// Run as a script, not imported (changed.test.mjs): Node gives
// import.meta.url as the file's real path, so argv's path is resolved too,
// or a run through a symbolic link would select nothing and say nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main(process.argv.slice(2));
