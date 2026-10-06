// changed.mjs's selection (`make web-check`): what CI's fast lane runs for a
// change, and what `make browser-changed` runs on a workstation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MODULES, VIEWS, NO_VIEW, ENGINE_SPECS, EVERYWHERE, SECTIONS, headings, hunks, sectionsTouched, viewsOf, select } from "./changed.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const SPECS = readdirSync(HERE).filter((f) => f.endsWith(".spec.js")).sort();
const HELPERS = ["fixtures.js", "shell.js", "patch_page.js"];
// patch_page.js requires shell.js; the patch specs require patch_page.js.
const REQUIRES = (spec, helper) =>
  helper === "fixtures.js" ? spec !== "smoke.spec.js" : helper === "patch_page.js" || helper === "shell.js" ? spec.startsWith("patch_") : false;
const pick = (files, opts = {}) => select({ files, specs: SPECS, helpers: HELPERS, requires: REQUIRES, ...opts });
const samples = Object.values(VIEWS).flatMap((v) => v.sample.map((s) => `${s}.spec.js`));
const startsWithAny = (s, prefixes) => prefixes.some((p) => s.startsWith(p));

test("CI's selection names no spec for main.js, worker.js, the page or a crate, and says so", () => {
  for (const f of ["apps/web/main.js", "apps/web/worker.js", "apps/web/index.html", "apps/web/style.css", "crates/auracle-session/src/engine.rs", "Cargo.lock"]) {
    const got = pick([f]);
    assert.deepEqual(got.specs, [], f);
    assert.deepEqual(got.wide, [f], f);
    assert.deepEqual(got.reached, [], f);
  }
});

test("a changed spec runs, and a deleted one does not", () => {
  assert.deepEqual(pick(["tests/web/patch_truth.spec.js"]).specs, ["patch_truth.spec.js"]);
  assert.deepEqual(pick(["tests/web/gone.spec.js"]).specs, []);
});

test("a changed helper runs the specs that require it, and an app module the specs named for it", () => {
  const helper = pick(["tests/web/patch_page.js"]).specs;
  assert.ok(helper.length > 0 && helper.every((s) => s.startsWith("patch_")), helper.join(" "));
  const mod = pick(["apps/web/taste.js"]).specs;
  assert.deepEqual(mod, SPECS.filter((s) => s.startsWith("taste_")));
});

test("with --views, a change in one of main.js's views runs that view's specs and no other's", () => {
  const got = pick(["apps/web/main.js"], { views: true, sections: { "apps/web/main.js": ["cable routing", { title: "keyboard", parent: "PICK-MODE FEEDBACK" }] } });
  assert.deepEqual(got.reached, [{ file: "apps/web/main.js", views: ["patch"], every: false, unnamed: [] }]);
  assert.deepEqual(got.specs, SPECS.filter((s) => startsWithAny(s, VIEWS.patch.specs)));
  assert.ok(!got.specs.some((s) => s.startsWith("perform_")));
});

test("with --views, main.js changed in two views runs both", () => {
  const got = pick(["apps/web/main.js"], { views: true, sections: { "apps/web/main.js": ["PERFORM", "patch bank"] } });
  assert.deepEqual(got.reached[0].views, ["bank", "perform"]);
  assert.ok(got.specs.includes("perform_truth.spec.js") && got.specs.includes("bank_find.spec.js"));
  assert.ok(!got.specs.some((s) => s.startsWith("patch_")));
});

test("with --views, a main.js section no rule names runs every view's sample, beside the views named", () => {
  for (const touched of [["worker protocol"], [null]]) {
    const got = pick(["apps/web/main.js"], { views: true, sections: { "apps/web/main.js": touched } });
    assert.equal(got.reached[0].every, true, String(touched));
    assert.deepEqual(got.reached[0].views, [], String(touched));
    assert.deepEqual(got.specs, [...samples].sort(), String(touched));
  }
  const both = pick(["apps/web/main.js"], { views: true, sections: { "apps/web/main.js": ["minimap", "state"] } });
  assert.deepEqual(both.reached, [{ file: "apps/web/main.js", views: ["patch"], every: true, unnamed: ["state"] }]);
  const patch = SPECS.filter((s) => startsWithAny(s, VIEWS.patch.specs));
  assert.deepEqual(both.specs, [...new Set([...patch, ...samples])].sort());
});

test("with --views, the engine runs every view's sample and the engine's own spec", () => {
  for (const f of ["crates/auracle-session/src/perform.rs", "apps/web/worker.js", "Cargo.lock", "rust-toolchain.toml"]) {
    const got = pick([f], { views: true });
    assert.deepEqual(got.specs, [...samples, ...ENGINE_SPECS.map((s) => `${s}.spec.js`)].sort(), f);
  }
});

test("with --views, the page's markup and styles and the suite's config run every view's sample", () => {
  for (const f of ["apps/web/style.css", "apps/web/index.html", "tests/web/playwright.config.js", "tests/web/package-lock.json"]) {
    assert.deepEqual(pick([f], { views: true }).specs, [...samples].sort(), f);
  }
});

test("with --views, prose and the app's unit tests reach no browser", () => {
  for (const f of ["crates/AGENTS.md", "apps/web/README.md", "apps/web/tests/toasts.test.mjs", "docs/process.md"]) {
    assert.deepEqual(pick([f], { views: true }).specs, [], f);
  }
});

test("main.js's headings name their views, the narrow rules before the broad", () => {
  assert.deepEqual(viewsOf("THE NODE BANK — the instrument's catalog"), ["patch"]);
  assert.deepEqual(viewsOf("patch bank"), ["bank"]);
  assert.deepEqual(viewsOf("first-run taste elicitation"), ["shell"]);
  assert.deepEqual(viewsOf("taste instruments"), ["taste"]);
  assert.deepEqual(viewsOf("which PERFORM controls turn a knob (Plan-008 C2b, the fourth engine fact)"), ["patch", "perform"]);
  assert.deepEqual(viewsOf("what a generation changed (Plan-008 C2b, the third engine fact)"), ["patch"]);
  assert.deepEqual(viewsOf("what a generation does: its seeds, and what it may replace"), ["evolve"]);
  assert.deepEqual(viewsOf("duel flow"), ["evolve"]);
  assert.deepEqual(viewsOf("differential flow"), ["patch"]);
  assert.deepEqual(viewsOf("overflow menu"), ["shell"]);
  assert.equal(viewsOf("worker protocol"), null);
});

test("headings are read from both kinds of heading, a subsection under its section, and a diff's lines land in theirs", () => {
  const src = [
    "import x;", //                                      1
    "// ---------- duel flow ----------", //             2
    "a();", //                                           3
    "// ===========================================================================", // 4
    "// MOTION — the rack moves instead of cutting", //   5
    "// ===========================================================================", // 6
    "b();", //                                           7
    "// ---- keyboard ----", //                          8
    "c();", //                                           9
    "// ---------- PERFORM ----------", //               10
    "d();", //                                           11
  ].join("\n");
  assert.deepEqual(headings(src), [
    { line: 2, title: "duel flow" },
    { line: 5, title: "MOTION — the rack moves instead of cutting" },
    { line: 8, title: "keyboard", parent: "MOTION — the rack moves instead of cutting" },
    { line: 10, title: "PERFORM" },
  ]);
  assert.deepEqual(sectionsTouched(src, [[3, 3]]), [{ title: "duel flow" }]);
  assert.deepEqual(sectionsTouched(src, [[9, 11]]), [
    { title: "keyboard", parent: "MOTION — the rack moves instead of cutting" },
    { title: "PERFORM" },
  ]);
  assert.deepEqual(sectionsTouched(src, [[1, 1]]), [null]);
  // A subsection whose own heading names no view is its section's.
  assert.deepEqual(viewsOf({ title: "keyboard", parent: "MOTION — the rack moves instead of cutting" }), ["patch"]);
  assert.equal(viewsOf({ title: "keyboard" }), null);
});

test("a -U0 diff's hunks are read on the new side, a deletion at the line it follows", () => {
  const diff = "diff --git a/m.js b/m.js\n@@ -10,2 +10,3 @@ fn\n+x\n@@ -40 +41 @@\n-y\n+z\n@@ -60,4 +61,0 @@\n-gone\n@@ -0,0 +1,2 @@\n+top\n";
  assert.deepEqual(hunks(diff), [[10, 12], [41, 41], [61, 61], [1, 2]]);
});

test("every spec belongs to a view, or is named as drawn by none", () => {
  const all = Object.values(VIEWS).flatMap((v) => v.specs);
  const orphans = SPECS.filter((s) => !startsWithAny(s, all) && !NO_VIEW.includes(s.replace(/\.spec\.js$/, "")));
  assert.deepEqual(orphans, [], "a new spec without a view never runs for a change to main.js: name its view in changed.mjs's VIEWS");
});

test("every name in the maps is a spec file that exists, and each sample is its view's", () => {
  for (const [file, prefixes] of Object.entries(MODULES)) {
    for (const p of prefixes) assert.ok(SPECS.some((s) => s.startsWith(p)), `${file}: ${p} names no spec`);
  }
  for (const [view, { specs, sample }] of Object.entries(VIEWS)) {
    for (const p of specs) assert.ok(SPECS.some((s) => s.startsWith(p)), `${view}: ${p} names no spec`);
    assert.ok(sample.length > 0, `${view} has no sample`);
    for (const s of sample) {
      assert.ok(SPECS.includes(`${s}.spec.js`), `${view}'s sample ${s} is no spec`);
      assert.ok(startsWithAny(s, specs), `${view}'s sample ${s} is not ${view}'s`);
    }
  }
  for (const s of [...NO_VIEW, ...ENGINE_SPECS]) assert.ok(SPECS.includes(`${s}.spec.js`), `${s} is no spec`);
});

test("every app script reaches some spec: a module named in MODULES, or a file that reaches every level", () => {
  const scripts = readdirSync(join(ROOT, "apps/web")).filter((f) => f.endsWith(".js")).map((f) => `apps/web/${f}`);
  const unmapped = scripts.filter((f) => !MODULES[f] && !EVERYWHERE.test(f));
  assert.deepEqual(unmapped, [], "a new app module selects no spec: name the specs that exercise it in changed.mjs's MODULES");
});

test("the real main.js's headings are read: some name a view, and some reach every view", () => {
  const hs = headings(readFileSync(join(ROOT, "apps/web/main.js"), "utf8"));
  assert.ok(hs.length > 50, `${hs.length} headings`);
  assert.ok(hs.some((h) => viewsOf(h.title) === null) && hs.some((h) => viewsOf(h.title)?.includes("patch")));
});

test("every alternative of every section rule wins a heading of the real main.js", () => {
  // An alternative that only matches headings an earlier rule wins sends
  // them nowhere it says: PATCH's `flow` once took the shell's "overflow
  // menu". A rule for a heading main.js no longer has is as wrong.
  const titles = headings(readFileSync(join(ROOT, "apps/web/main.js"), "utf8")).map((h) => h.title);
  const first = (t) => SECTIONS.findIndex(([re]) => re.test(t));
  const dead = [];
  SECTIONS.forEach(([re], i) => {
    assert.ok(!/[()]/.test(re.source), `rule ${i} has a group, which splitting at | would cut: ${re.source}`);
    for (const alt of re.source.split("|")) {
      const one = new RegExp(alt, re.flags);
      if (!titles.some((t) => first(t) === i && one.test(t))) dead.push(`rule ${i}: /${alt}/`);
    }
  });
  assert.deepEqual(dead, [], "a rule above it takes every heading these match, or main.js has none: anchor it, move it, or drop it");
});
