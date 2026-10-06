#!/usr/bin/env node
// The specs a change reaches: for `make browser-changed`, what to run on a
// workstation before pushing, and for CI's fast lane on a PR (ci.yml's
// `changes` job), what runs there. The merge queue's run is the whole tier,
// twelve wide.
//
//   node changed.mjs [base]     prints spec files, one per line (base: origin/main)
//
// A changed spec runs; a changed helper runs every spec that requires it; a
// changed app module runs the specs named for what it draws (MODULES below).
// main.js, worker.js, index.html, style.css and the engine reach every level,
// so a change to them prints nothing and says so: pick the specs for what you
// changed by name, or let CI run them (a PR's fast lane then runs the smoke
// only, and the merge queue's run the whole tier).
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

// An app module, and the spec-name prefixes that exercise what it draws.
const MODULES = {
  "apps/web/perform.js": ["perform_", "pad_keys", "responsive"],
  "apps/web/patch.js": ["patch_"],
  "apps/web/taste.js": ["taste_"],
  "apps/web/taste-geom.js": ["taste_"],
  "apps/web/audio-in.js": ["audio_in"],
  "apps/web/takes.js": ["audio_in_takes"],
  "apps/web/explain.js": ["explain"],
  "apps/web/faces.js": ["faces", "evolve_cards", "bank_row"],
  "apps/web/vessel.js": ["faces", "perform_stage"],
  "apps/web/guide.js": ["guide_pill", "first_run"],
  "apps/web/deal.js": ["evolve_ahead", "evolve_truth", "evolve_feedback"],
  "apps/web/shell.js": ["shell_levels", "model_view", "guide_pill"],
  "apps/web/levels.js": ["shell_levels"],
  "apps/web/midi.js": ["midi_announced"],
  "apps/web/booth.js": ["booth"],
  "apps/web/words.js": ["text_fits"],
  "apps/web/support.js": ["taste_marks", "patch_model_view", "patch_catalog"],
  "apps/web/live-audio.js": ["smoke", "patch_audible", "audio_in"],
  "apps/web/farm.js": ["faces", "evolve_breeds_beside_you", "evolve_generation_timing"],
};
const EVERYWHERE = /^(apps\/web\/(main\.js|worker\.js|index\.html|style\.css)|crates\/|Cargo\.(toml|lock)$)/;

const base = process.argv[2] || "origin/main";
let files;
try {
  const mergeBase = execFileSync("git", ["merge-base", base, "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  const committed = execFileSync("git", ["diff", "--name-only", mergeBase], { cwd: ROOT, encoding: "utf8" });
  const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { cwd: ROOT, encoding: "utf8" });
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

const out = new Set();
const wide = [];
for (const f of files) {
  const rel = relative("tests/web", f);
  if (f.startsWith("tests/web/") && f.endsWith(".spec.js")) {
    if (existsSync(join(ROOT, f))) out.add(rel);
  } else if (f.startsWith("tests/web/") && helpers.includes(rel)) {
    for (const s of specs) if (requires(s, rel)) out.add(s);
  } else if (MODULES[f]) {
    for (const s of specs) if (MODULES[f].some((p) => s.startsWith(p))) out.add(s);
  } else if (EVERYWHERE.test(f) || f === "tests/web/playwright.config.js") {
    wide.push(f);
  }
}

if (wide.length) {
  console.error(`changed.mjs: ${wide.join(", ")} reach every level; name the specs for what you changed, or let CI run the tier.`);
}
for (const s of [...out].sort()) console.log(s);
