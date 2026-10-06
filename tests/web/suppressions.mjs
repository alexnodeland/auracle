// What ESLint does not check about eslint-suppressions.json (make spec-lint
// runs this after the lint): every key names a file here, and against the
// base no count has risen and no file has gained an entry. ESLint fails a
// file above its count and records a fall (--prune-suppressions), but the
// file itself can be rewritten (--suppress-all) or keep a key for a file that
// is gone, and it says nothing of either.
//
//   node suppressions.mjs [base]   # from tests/web; base: origin/main
//
// The base is the merge base of HEAD and `base`, or `base` itself where
// there is none (CI's Web job passes HEAD^1, the branch its merge commit
// went onto). With no git, or no such commit, the comparison is skipped and
// says so. A renamed file's entry moves to its new name by hand, its counts
// unchanged (tests/web/AGENTS.md § The lint).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const FILE = "eslint-suppressions.json";
const HOW = "tests/web/AGENTS.md § The lint";

/** Keys that name no file here: a deleted file's entry, which
 *  `npx eslint --prune-suppressions` removes, or a renamed one's, which
 *  moves to its new name. */
export function stale(head, exists) {
  return Object.keys(head)
    .filter((file) => !exists(file))
    .map((file) => `${file}: no such file. Deleted: run npx eslint --prune-suppressions. Renamed: move its entry to the new name, counts unchanged (${HOW})`);
}

/** Every way `head` holds more than `base`: a count above the base's, a rule
 *  new to a file's entry, an entry for a file the base had without one, or
 *  an entry for a new file that is not a renamed file's, moved unchanged.
 *  `existedAtBase(file)` says whether the base's tree had the file. A rule
 *  the base holds nowhere is new to the set, and its findings are taken in
 *  once, in the change that brings it (`npx eslint --suppress-rule <rule>`):
 *  it is left out. */
export function rises(base, head, existedAtBase) {
  const out = [];
  const known = new Set(Object.values(base).flatMap((entry) => Object.keys(entry)));
  const gone = Object.keys(base).filter((file) => !(file in head));
  const within = (entry, than) => Object.entries(entry).every(([rule, { count }]) => rule in than && count <= than[rule].count);
  for (const [file, all] of Object.entries(head)) {
    const entry = Object.fromEntries(Object.entries(all).filter(([rule]) => known.has(rule)));
    if (!Object.keys(entry).length) continue;
    if (file in base) {
      for (const [rule, { count }] of Object.entries(entry)) {
        const was = base[file][rule];
        if (!was) out.push(`${file}: ${rule} has no entry at the base, and now holds ${count}: fix them rather than suppress them (${HOW})`);
        else if (count > was.count) out.push(`${file}: ${rule} rose from ${was.count} to ${count}: a count only falls (${HOW})`);
      }
    } else if (existedAtBase(file)) {
      out.push(`${file}: it had no entry at the base, and now has one: fix what the lint found rather than suppress it (${HOW})`);
    } else if (!gone.some((old) => within(entry, base[old]))) {
      out.push(`${file}: a new file starts at zero. A renamed one takes its old entry, moved by hand with its counts unchanged (${HOW})`);
    }
  }
  return out;
}

const total = (s) => Object.values(s).reduce((n, entry) => n + Object.values(entry).reduce((m, { count }) => m + count, 0), 0);

function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const head = JSON.parse(readFileSync(join(here, FILE), "utf8"));
  const problems = stale(head, (file) => existsSync(join(here, file)));
  const base = process.argv[2] || "origin/main";
  // Without git's own variables: a git hook runs with GIT_DIR and
  // GIT_INDEX_FILE set, and a git command given them works on that
  // repository wherever it runs (scripts/coverage_gate.py, own_env).
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
  const git = (...args) => execFileSync("git", ["-C", here, ...args], { env, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const tryGit = (...args) => {
    try {
      return git(...args);
    } catch {
      return null;
    }
  };
  const at = (tryGit("merge-base", "HEAD", base) || tryGit("rev-parse", "--verify", "--quiet", `${base}^{commit}`) || "").trim();
  let against = "";
  if (!at) {
    against = `; no ${base} to compare with (no git, or no such commit), so no rise was looked for`;
  } else {
    const old = tryGit("show", `${at}:./${FILE}`);
    if (old == null) {
      against = `; ${base} (${at.slice(0, 12)}) has no ${FILE}, so nothing can have risen`;
    } else {
      problems.push(...rises(JSON.parse(old), head, (file) => tryGit("cat-file", "-e", `${at}:./${file}`) != null));
      against = `, none above ${base} (${at.slice(0, 12)}, ${total(JSON.parse(old))})`;
    }
  }
  if (problems.length) {
    console.error(`  ${FILE}:\n${problems.map((p) => `    ${p}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`  tests/web: lint OK; ${total(head)} suppressed in ${Object.keys(head).length} files${against}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
