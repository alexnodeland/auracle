#!/usr/bin/env python3
"""The coverage gate's arithmetic, over what `cargo llvm-cov` measured on the
fast tier (`make coverage`; docs/architecture/testing.md § Coverage).

    python3 scripts/coverage_gate.py floors SUMMARY            each crate against its floor
    python3 scripts/coverage_gate.py floors SUMMARY --raise    write each floor up to today's value
    python3 scripts/coverage_gate.py floors SUMMARY --base BRANCH
                                      also fail when a floor is lower than at the merge base
    python3 scripts/coverage_gate.py diff LCOV [--base BRANCH]
                                      every line changed since the merge base with BRANCH
                                      (origin/main) that no test ran

SUMMARY is `cargo llvm-cov report --json --summary-only`, LCOV is
`cargo llvm-cov report --lcov`. Both commands take `--markdown FILE`, which
appends what they print as Markdown (CI passes $GITHUB_STEP_SUMMARY), and
`diff` takes `--link URL` to link each line it names (URL/path#Lnn).

**The floors.** `crates/coverage-baseline.json` holds each crate's line and
function coverage in percent, to two decimals. `floors` prints each crate's
lines, functions and regions (regions are reported, not gated) and fails when
a crate's lines or functions are under its floor, when a crate has no floor,
or when a floor names a crate the run did not measure. `--raise` writes each
floor up to the measured value, truncated to two decimals so the run that
wrote it passes; it never lowers one, and it writes nothing while a crate is
under its floor. `--base BRANCH` compares the file with its copy at the
merge base with BRANCH and fails when a floor went down or went away: a
floor only rises. The one floor that may go is a removed crate's (no
crates/<name>/Cargo.toml): it fails until `--raise` drops it, and `--base`
lets it go. A renamed crate is a removed one and a new one with no floor
yet. The table prints in full before anything fails.

**The changed lines.** `diff` reads `git diff` from the merge base to the
working tree (and untracked files, whole), keeps the Rust under `crates/`,
and names every changed line the run left uncovered: a line whose count is
0, or the first line of a function (a closure, often) that never ran, which
a line count alone misses when other code on the line did run. A changed
file the run did not measure (an integration test under `tests/`, an
example, a `tests.rs`, code only `wasm32` builds) has no lines to cover and
is listed as not measured.

Python 3 standard library only.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from collections import defaultdict
from dataclasses import dataclass, field

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
BASELINE = "crates/coverage-baseline.json"
RAISE = "make coverage-floors"
GATED = ("lines", "functions")
KINDS = ("lines", "functions", "regions")


# ─── where a file belongs ────────────────────────────────────────────────────


def repo_path(filename: str, root: str = ROOT) -> str | None:
    """`filename` (absolute, as llvm-cov writes it) relative to the repository,
    or None when it is not under `crates/`. A path from another checkout (a
    runner's, say) is read from its last `/crates/` on."""
    path = filename.replace("\\", "/")
    rel = os.path.relpath(path, root).replace("\\", "/") if os.path.isabs(path) else path
    if rel.startswith("../") or not rel.startswith("crates/"):
        k = path.rfind("/crates/")
        if k < 0:
            return None
        rel = path[k + 1 :]
    return rel


def crate_of(rel: str) -> str:
    return rel.split("/")[1]


# ─── the floors ──────────────────────────────────────────────────────────────


@dataclass
class Tally:
    count: int = 0
    covered: int = 0

    def percent(self) -> float:
        """Truncated to two decimals, as the floors are: a crate shown at
        94.41% is at a floor of 94.41, never under it."""
        return self.hundredths() / 100

    def hundredths(self) -> int:
        """The percentage in hundredths, truncated: 97.919% is 9791."""
        return 10000 if self.count == 0 else self.covered * 10000 // self.count

    def at_least(self, floor: float) -> bool:
        # Exact: covered / count >= floor / 100, in integers.
        return self.count == 0 or self.covered * 10000 >= round(floor * 100) * self.count


@dataclass
class Crate:
    name: str
    tallies: dict[str, Tally] = field(default_factory=lambda: {k: Tally() for k in KINDS})


def per_crate(summary: dict, root: str = ROOT) -> dict[str, Crate]:
    """Each crate's lines, functions and regions, summed over its files."""
    crates: dict[str, Crate] = {}
    for data in summary.get("data", []):
        for f in data.get("files", []):
            rel = repo_path(f["filename"], root)
            if rel is None:
                continue
            c = crates.setdefault(crate_of(rel), Crate(crate_of(rel)))
            for k in KINDS:
                s = f["summary"][k]
                c.tallies[k].count += s["count"]
                c.tallies[k].covered += s["covered"]
    return crates


def read_floors(text: str) -> dict[str, dict[str, float]]:
    floors = json.loads(text)
    for crate, f in floors.items():
        if set(f) != set(GATED) or not all(isinstance(f[k], (int, float)) for k in GATED):
            raise ValueError(f"{BASELINE}: {crate} needs exactly {' and '.join(GATED)}, as numbers")
    return floors


def write_floors(floors: dict[str, dict[str, float]]) -> str:
    """Two decimals each, one crate a line, in name order."""
    rows = [
        f'  "{crate}": {{' + ", ".join(f'"{k}": {floors[crate][k]:.2f}' for k in GATED) + "}"
        for crate in sorted(floors)
    ]
    return "{\n" + ",\n".join(rows) + "\n}\n"


@dataclass
class Verdict:
    failures: list[str]
    raised: dict[str, dict[str, float]]


GONE = "the crate is gone"


def gone_crates(names, root: str = ROOT) -> set[str]:
    """The crates among `names` with no crates/<name>/Cargo.toml: removed, or
    renamed (the new name is a crate with no floor yet)."""
    return {n for n in names if not os.path.isfile(os.path.join(root, "crates", n, "Cargo.toml"))}


def judge(crates: dict[str, Crate], floors: dict[str, dict[str, float]], gone: set[str] = frozenset()) -> Verdict:
    """What fails, and the floors raised to today's values (never lowered).
    A floor for a crate in `gone` fails until it is dropped, and the raised
    floors drop it."""
    failures = []
    raised = {c: dict(f) for c, f in floors.items()}
    for name in sorted(set(crates) | set(floors)):
        if name not in crates:
            if name in gone:
                failures.append(f"{name}: has a floor, but {GONE}; `{RAISE}` drops it")
                del raised[name]
            else:
                failures.append(f"{name}: has a floor, but the run measured no file of it")
            continue
        c = crates[name]
        if name not in floors:
            failures.append(f"{name}: no floor yet; `{RAISE}` records today's")
            raised[name] = {k: c.tallies[k].hundredths() / 100 for k in GATED}
            continue
        for k in GATED:
            t, floor = c.tallies[k], floors[name][k]
            if not t.at_least(floor):
                missed = t.count - t.covered
                failures.append(
                    f"{name}: {k} {t.percent():.2f}% ({missed:,} of {t.count:,} not covered) is under its floor of {floor:.2f}%"
                )
            raised[name][k] = max(floor, t.hundredths() / 100)
    return Verdict(failures, raised)


def lowered(old: dict[str, dict[str, float]], new: dict[str, dict[str, float]], gone: set[str] = frozenset()) -> list[str]:
    """Every floor `new` holds lower than `old` did, or no longer holds,
    except the floor of a crate in `gone`, which goes with its crate."""
    out = []
    for crate in sorted(old):
        if crate not in new:
            if crate not in gone:
                out.append(f"{crate}: its floor was removed")
            continue
        for k in GATED:
            if round(new[crate][k] * 100) < round(old[crate][k] * 100):
                out.append(f"{crate}: the {k} floor went from {old[crate][k]:.2f} to {new[crate][k]:.2f}")
    return out


def table(crates: dict[str, Crate], floors: dict[str, dict[str, float]], markdown: bool = False) -> list[str]:
    def cell(t: Tally) -> str:
        return f"{t.percent():.2f}% ({t.count - t.covered:,} of {t.count:,} missed)"

    def floor_of(name: str, k: str) -> str:
        return f"{floors[name][k]:.2f}%" if name in floors else "none"

    def mark(name: str) -> str:
        if name not in floors:
            return "no floor"
        ok = all(crates[name].tallies[k].at_least(floors[name][k]) for k in GATED)
        return "ok" if ok else "UNDER"

    total = Crate("workspace")
    for c in crates.values():
        for k in KINDS:
            total.tallies[k].count += c.tallies[k].count
            total.tallies[k].covered += c.tallies[k].covered
    names = sorted(crates)
    if markdown:
        out = [
            "| Crate | Lines | Functions | Regions (not gated) | Floor: lines | Floor: functions | |",
            "| --- | --- | --- | --- | --- | --- | --- |",
        ]
        for n in names:
            t = crates[n].tallies
            out.append(
                f"| `{n}` | {cell(t['lines'])} | {cell(t['functions'])} | {cell(t['regions'])} "
                f"| {floor_of(n, 'lines')} | {floor_of(n, 'functions')} | {mark(n)} |"
            )
        t = total.tallies
        out.append(f"| **workspace** | {cell(t['lines'])} | {cell(t['functions'])} | {cell(t['regions'])} | | | |")
        return out
    out = [f"  {'crate':<18} {'lines':>8} {'functions':>10} {'regions':>8}   floor: lines  functions"]
    for n in names:
        t = crates[n].tallies
        fl = f"{floor_of(n, 'lines'):>13}  {floor_of(n, 'functions'):>9}"
        out.append(
            f"  {n:<18} {t['lines'].percent():>7.2f}% {t['functions'].percent():>9.2f}% {t['regions'].percent():>7.2f}%   {fl}  {mark(n)}"
        )
    t = total.tallies
    out.append(
        f"  {'workspace':<18} {t['lines'].percent():>7.2f}% {t['functions'].percent():>9.2f}% {t['regions'].percent():>7.2f}%"
        f"   ({t['lines'].count - t['lines'].covered:,} of {t['lines'].count:,} lines missed)"
    )
    return out


def warn(text: str) -> None:
    """To stderr, after whatever stdout holds, so a log keeps their order."""
    sys.stdout.flush()
    print(text, file=sys.stderr)


# Which config files git reads, kept through own_env: they name no
# repository. A caller that says "no global config" (the tests' scratch
# repositories, so no fsmonitor daemon starts in each and outlives it) is
# heard. `git` below also turns the monitor off itself, whatever config it
# reads, so a caller that names none gets no daemon either.
CONFIG_VARS = ("GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM", "GIT_CONFIG_SYSTEM")


def own_env() -> dict[str, str]:
    """The environment without git's own variables. A git hook runs with
    GIT_DIR and GIT_INDEX_FILE set to the repository being committed, and a
    git command given them works on that repository wherever it runs: the
    repository is the one at `root`, and only it. Which config files to read
    (CONFIG_VARS) is kept."""
    return {k: v for k, v in os.environ.items() if not k.startswith("GIT_") or k in CONFIG_VARS}


def git(args: list[str], root: str = ROOT, check: bool = True) -> str:
    """`git args` in the checkout at `root`, without the file-system monitor
    whatever config says (as changes.py's and wasm_pkg.py's): a user's
    core.fsmonitor=true makes `diff` and `ls-files --others` ask a daemon, and
    start one for a checkout that has none. In a scratch repository that was
    a daemon to outlive it, and with hundreds running a git blocked on one's
    socket for minutes (the pre-commit hook's run of this script's tests). On
    a loaded machine a daemon that fell behind also called an edited file
    unchanged, and a changed line the gate never saw is a check that passes
    on anything."""
    r = subprocess.run(["git", "-C", root, "-c", "core.fsmonitor=false", *args], capture_output=True, text=True, env=own_env())
    if check and r.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)}: {r.stderr.strip()}")
    return r.stdout if r.returncode == 0 else ""


def cmd_floors(a: argparse.Namespace, root: str = ROOT) -> int:
    with open(a.summary) as f:
        crates = per_crate(json.load(f), root)
    path = os.path.join(root, BASELINE)
    floors, unreadable = {}, None
    if os.path.exists(path):
        with open(path) as f:
            try:
                floors = read_floors(f.read())
            except ValueError as e:
                # The table still prints, with no floors, so a run's numbers
                # are never lost to a broken file.
                unreadable = str(e)
    v = judge(crates, floors, gone_crates(floors, root))
    failures = ([unreadable] if unreadable else []) + list(v.failures)
    if a.base:
        mb = git(["merge-base", a.base, "HEAD"], root).strip()
        old = git(["show", f"{mb}:{BASELINE}"], root, check=False)
        if old:
            was = read_floors(old)
            failures += [
                f"{BASELINE}: {s} since {a.base}; a floor only rises" for s in lowered(was, floors, gone_crates(was, root))
            ]
        else:
            print(f"  coverage: {a.base} ({mb[:12]}) has no {BASELINE}, so no floor of it can have gone down")
    # The whole table first, to the log and the run's summary, whatever fails.
    print("\n".join(table(crates, floors)))
    if a.markdown:
        with open(a.markdown, "a") as f:
            md = ["### Coverage of the fast tier, by crate", "", *table(crates, floors, True), ""]
            if failures:
                md += ["**Failed:**", "", *[f"- {s}" for s in failures], ""]
            f.write("\n".join(md) + "\n")
    if a.raise_:
        under = [s for s in failures if "no floor yet" not in s and GONE not in s]
        if unreadable:
            under.append(unreadable)
        if under:
            warn("\n".join(f"  {s}" for s in under))
            warn("  coverage: wrote nothing; a floor is never lowered (raise the coverage, not the file)")
            return 1
        with open(path, "w") as f:
            f.write(write_floors(v.raised))
        changed = [
            f"{c}: {k} {floors[c][k]:.2f} → {v.raised[c][k]:.2f}"
            for c in sorted(floors)
            if c in v.raised
            for k in GATED
            if round(v.raised[c][k] * 100) != round(floors[c][k] * 100)
        ]
        changed += [f"{c}: dropped ({GONE})" for c in sorted(floors) if c not in v.raised]
        changed += [
            f"{c}: new, lines {v.raised[c]['lines']:.2f} and functions {v.raised[c]['functions']:.2f}"
            for c in sorted(v.raised)
            if c not in floors
        ]
        print("\n".join(f"  {s}" for s in changed) or "  coverage: every floor is already at today's value")
        print(f"  coverage: wrote {BASELINE}")
        return 0
    if failures:
        warn("\n".join(f"  {s}" for s in failures))
        warn(
            f"  coverage: {len(failures)} failure(s); a crate's coverage may rise, never fall "
            f"(crates/AGENTS.md § Coverage), and `{RAISE}` records a rise"
        )
        return 1
    print(f"  coverage: every crate at or over its floor ({BASELINE})")
    return 0


# ─── the changed lines ───────────────────────────────────────────────────────


@dataclass
class Measured:
    """One file's lines from lcov: each line's count, and the counts of the
    functions that start on it."""

    lines: dict[int, int] = field(default_factory=dict)
    starts: dict[int, list[int]] = field(default_factory=lambda: defaultdict(list))

    def uncovered(self, line: int) -> bool:
        if self.lines.get(line) == 0:
            return True
        counts = self.starts.get(line)
        return bool(counts) and all(c == 0 for c in counts)


def read_lcov(text: str, root: str = ROOT) -> dict[str, Measured]:
    """Every file under crates/ the run measured. A function appears once per
    binary and per instantiation, so its counts are summed by name, and a
    line where functions start counts as run when any of them ran."""
    out: dict[str, Measured] = {}
    cur: Measured | None = None
    starts: dict[str, int] = {}
    counts: dict[str, int] = defaultdict(int)

    def close() -> None:
        if cur is not None:
            for name, line in starts.items():
                cur.starts[line].append(counts[name])

    for raw in text.splitlines():
        line = raw.strip()
        if line.startswith("SF:"):
            close()
            rel = repo_path(line[3:], root)
            cur = out.setdefault(rel, Measured()) if rel else None
            starts, counts = {}, defaultdict(int)
        elif cur is None:
            continue
        elif line.startswith("DA:"):
            n, c = line[3:].split(",")[:2]
            cur.lines[int(n)] = cur.lines.get(int(n), 0) + int(c)
        elif line.startswith("FN:"):
            n, name = line[3:].split(",", 1)
            starts[name] = int(n)
        elif line.startswith("FNDA:"):
            c, name = line[5:].split(",", 1)
            counts[name] += int(c)
        elif line == "end_of_record":
            close()
            cur = None
    close()
    return out


HUNK = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@")


def changed_lines(diff: str) -> dict[str, set[int]]:
    """Each file's added or changed lines, from `git diff --unified=0
    --dst-prefix=b/`. A new-side path without that prefix is an error, not a
    file no one changed: misread, every path would be outside crates/ and
    the check would pass on anything."""
    out: dict[str, set[int]] = defaultdict(set)
    path = None
    for line in diff.splitlines():
        if line.startswith("+++ "):
            target = line[4:].strip().strip('"')
            if target != "/dev/null" and not target.startswith("b/"):
                raise ValueError(f"git diff named a changed file without its b/ prefix: {line!r}")
            path = None if target == "/dev/null" else target[2:]
        elif path and (m := HUNK.match(line)):
            start, n = int(m.group(1)), int(m.group(2) if m.group(2) is not None else 1)
            out[path].update(range(start, start + n))
    return {p: s for p, s in out.items() if s}


def rust_in_crates(path: str) -> bool:
    return path.startswith("crates/") and path.endswith(".rs")


def changes_since(base: str, root: str = ROOT) -> tuple[str, dict[str, set[int]]]:
    """The merge base with `base`, and every line changed since it in the
    working tree, untracked files included."""
    mb = git(["merge-base", base, "HEAD"], root).strip()
    # The prefixes named, so a config's diff.mnemonicPrefix (`w/`) or
    # diff.noprefix cannot make every path unreadable and the check vacuous.
    diff = git(
        ["diff", "--unified=0", "--no-color", "--no-ext-diff", "--src-prefix=a/", "--dst-prefix=b/", "-M", mb, "--", "crates"],
        root,
    )
    changed = changed_lines(diff)
    for rel in git(["ls-files", "--others", "--exclude-standard", "--", "crates"], root).split("\n"):
        if rel and os.path.isfile(os.path.join(root, rel)):
            with open(os.path.join(root, rel), errors="replace") as f:
                n = len(f.read().split("\n"))
            changed[rel] = set(range(1, n + 1))
    return mb, {p: s for p, s in changed.items() if rust_in_crates(p)}


@dataclass
class DiffReport:
    changed: int
    measured: int
    uncovered: dict[str, list[int]]
    unmeasured: list[str]


def uncovered_changes(changed: dict[str, set[int]], measured: dict[str, Measured]) -> DiffReport:
    unc, unmeasured, n_changed, n_measured = {}, [], 0, 0
    for path in sorted(changed):
        lines = changed[path]
        n_changed += len(lines)
        m = measured.get(path)
        if m is None:
            unmeasured.append(path)
            continue
        n_measured += sum(1 for n in lines if n in m.lines or n in m.starts)
        bad = sorted(n for n in lines if m.uncovered(n))
        if bad:
            unc[path] = bad
    return DiffReport(n_changed, n_measured, unc, unmeasured)


def runs(lines: list[int]) -> list[tuple[int, int]]:
    """Consecutive lines as (first, last)."""
    out: list[tuple[int, int]] = []
    for n in lines:
        if out and n == out[-1][1] + 1:
            out[-1] = (out[-1][0], n)
        else:
            out.append((n, n))
    return out


def source(root: str, path: str) -> list[str]:
    try:
        with open(os.path.join(root, path), errors="replace") as f:
            return f.read().split("\n")
    except OSError:
        return []


def diff_text(r: DiffReport, base: str, mb: str, root: str = ROOT) -> list[str]:
    n_unc = sum(len(v) for v in r.uncovered.values())
    out = [
        f"  coverage: {r.changed:,} changed line(s) in crates/ since {base} ({mb[:12]}), "
        f"{r.measured:,} of them code the run measured, {n_unc:,} not covered"
    ]
    for path, lines in r.uncovered.items():
        src = source(root, path)
        out.append(f"  {path}")
        for n in lines:
            text = src[n - 1].strip() if n - 1 < len(src) else ""
            out.append(f"    {n:>5}  {text}")
    if r.unmeasured:
        out.append("  not measured (no code the native fast tier builds): " + ", ".join(r.unmeasured))
    return out


def diff_markdown(r: DiffReport, base: str, link: str | None, root: str = ROOT) -> list[str]:
    n_unc = sum(len(v) for v in r.uncovered.values())
    out = ["### Changed lines the fast tier does not cover", ""]
    if not n_unc:
        out.append(f"None: every one of the {r.measured:,} changed lines the run measured is covered (against `{base}`).")
    else:
        out.append(f"{n_unc:,} of the {r.measured:,} changed lines the run measured (against `{base}`):")
        out.append("")
        for path, lines in r.uncovered.items():
            src = source(root, path)
            for a, b in runs(lines):
                where = f"{path}:{a}" if a == b else f"{path}:{a}-{b}"
                anchor = f"#L{a}" if a == b else f"#L{a}-L{b}"
                head = f"[`{where}`]({link.rstrip('/')}/{path}{anchor})" if link else f"`{where}`"
                text = src[a - 1].strip().replace("`", "'") if a - 1 < len(src) else ""
                out.append(f"- {head}: `{text}`" if text else f"- {head}")
    if r.unmeasured:
        out += ["", "Not measured (no code the native fast tier builds): " + ", ".join(f"`{p}`" for p in r.unmeasured)]
    return out + [""]


def cmd_diff(a: argparse.Namespace, root: str = ROOT) -> int:
    with open(a.lcov) as f:
        measured = read_lcov(f.read(), root)
    mb, changed = changes_since(a.base, root)
    r = uncovered_changes(changed, measured)
    text = diff_text(r, a.base, mb, root)
    bad = bool(r.uncovered)
    (warn if bad else print)("\n".join(text))
    if a.markdown:
        with open(a.markdown, "a") as f:
            f.write("\n".join(diff_markdown(r, a.base, a.link, root)) + "\n")
    if bad:
        warn(
            "  coverage: every line a change adds or changes in crates/ is run by a fast-tier test that "
            "checks what it does (crates/AGENTS.md § Coverage)"
        )
        return 1
    return 0


def main(argv: list[str], root: str = ROOT) -> int:
    p = argparse.ArgumentParser(prog="scripts/coverage_gate.py", description=__doc__.split("\n\n")[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("floors", help="each crate against its floor")
    f.add_argument("summary")
    f.add_argument("--raise", dest="raise_", action="store_true", help="write each floor up to today's value")
    f.add_argument("--base", help="fail when a floor is lower than this revision's")
    f.add_argument("--markdown", help="append the table, as Markdown, to this file")
    d = sub.add_parser("diff", help="changed lines in crates/ that no test ran")
    d.add_argument("lcov")
    d.add_argument("--base", default="origin/main", help="the branch to diff against (default origin/main)")
    d.add_argument("--markdown", help="append the lines, as Markdown, to this file")
    d.add_argument("--link", help="link each line as LINK/path#Lnn")
    a = p.parse_args(argv)
    try:
        return cmd_floors(a, root) if a.cmd == "floors" else cmd_diff(a, root)
    except (OSError, ValueError, RuntimeError) as e:
        warn(f"  coverage: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
