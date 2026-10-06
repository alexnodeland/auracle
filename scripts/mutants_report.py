#!/usr/bin/env python3
"""What a mutation run found, read from cargo-mutants' output directories
(`make mutants`; crates/AGENTS.md § Mutation testing).

    python3 scripts/mutants_report.py DIR [DIR ...]
        [--markdown FILE]   append the report, as Markdown, to FILE
                            (CI passes $GITHUB_STEP_SUMMARY)
        [--link URL]        link each mutant it names as URL/path#Lnn
        [--issue FILE]      write the body of the weekly run's issue to FILE

Each DIR is one run's `mutants.out` (CI's weekly run has one per shard).
It prints, per crate, how many mutants were listed and tested and how each
ended, then every survivor (a mutant no test failed on) and every mutant
stopped at the time limit, each as file:line, function and change. A run
stopped before its end (a time cap, an interrupt or a crash) is said to be,
with how far it got:
cargo-mutants writes each mutant's outcome as it goes. A DIR that is not
there, or that lists mutants and holds no outcomes, is reported as missing,
and the others are reported all the same. One that lists no mutant (a
shard with none to test, where cargo-mutants writes no outcomes) is empty,
not missing.

It exits 1 when a mutant survived, when a run's unmutated tests failed (so
nothing it says about mutants holds), or when a DIR is missing; else 0. A
timeout is reported and does not fail: a mutant that hangs the tests is
one they would not pass.

The issue body is the counts and the survivors grouped by file, cut to fit
an issue (GitHub's limit is 65,536 characters), with what was cut counted.

Python 3 standard library only.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict
from dataclasses import dataclass, field

# Room for the issue's own first lines and its advice, under GitHub's 65,536.
ISSUE_BUDGET = 50_000
OUTCOMES = ("caught", "survived", "timeout", "unviable")
# Why a run that wrote outcomes has no end time: the files cannot tell.
STOPPED = "a time cap, an interrupt, or a crash (the shard's job says which)"
NONE_REPORTED = "No shard reported: every one is missing, so nothing was judged."
# cargo-mutants' summary of a mutant's scenario, to the word used here.
SUMMARY = {
    "CaughtMutant": "caught",
    "MissedMutant": "survived",
    "Timeout": "timeout",
    "Unviable": "unviable",
}


@dataclass(frozen=True)
class Mutant:
    crate: str
    file: str
    line: int
    function: str
    change: str

    def where(self) -> str:
        return f"{self.file}:{self.line}"


@dataclass
class Run:
    """One output directory."""

    path: str
    # How many mutants the run listed, per crate, tested or not.
    listed: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    finished: bool = False
    baseline: str | None = None
    mutants: dict[str, list[Mutant]] = field(default_factory=lambda: defaultdict(list))
    # Unexpected outcomes, as cargo-mutants named them.
    other: list[str] = field(default_factory=list)
    # Why the directory holds no run to read, when it holds none.
    missing: str | None = None


def mutant_of(m: dict) -> Mutant:
    """A mutant from cargo-mutants' description of one. Its name is
    `file:line:col: change`, and an operator's change ends `in function`,
    which the report shows apart."""
    name = m["name"]
    change = name.split(": ", 1)[1] if name.startswith(f"{m['file']}:") and ": " in name else name
    fn = (m.get("function") or {}).get("function_name", "")
    if fn and change.endswith(f" in {fn}"):
        change = change[: -len(f" in {fn}")]
    return Mutant(m.get("package", "?"), m["file"], m["span"]["start"]["line"], fn, change)


def read_json(path: str):
    """The file's JSON, or None when it is not there."""
    try:
        with open(path) as f:
            return json.load(f)
    except FileNotFoundError:
        return None


def read_run(path: str) -> Run:
    """One directory's run. A directory with nothing to read comes back
    `missing`, with why; one whose files cannot be parsed, too."""
    run = Run(path)
    try:
        listed = read_json(os.path.join(path, "mutants.json"))
        outcomes = read_json(os.path.join(path, "outcomes.json"))
    except (OSError, ValueError) as e:
        run.missing = f"unreadable: {e}"
        return run
    if listed is None:
        run.missing = "no mutants.json: the run did not start, or its files never came"
        return run
    for m in listed:
        run.listed[m.get("package", "?")] += 1
    if outcomes is None:
        if listed:
            run.missing = f"listed {len(listed):,} mutants and left no outcomes: it ended before its first"
        else:
            # cargo-mutants writes no outcomes when it has nothing to test.
            run.finished = True
        return run
    run.finished = outcomes.get("end_time") is not None
    try:
        for o in outcomes.get("outcomes", []):
            scenario = o.get("scenario")
            if scenario == "Baseline":
                run.baseline = o.get("summary")
                continue
            m = mutant_of(scenario["Mutant"])
            kind = SUMMARY.get(o.get("summary"))
            if kind is None:
                run.other.append(f"{m.where()}: {m.change} ({o.get('summary')})")
                continue
            run.mutants[kind].append(m)
    except (KeyError, TypeError, AttributeError) as e:
        run.missing = f"outcomes.json is not in the shape cargo-mutants 27.1 writes ({e!r})"
    return run


@dataclass
class Report:
    runs: list[Run]

    def all(self, kind: str) -> list[Mutant]:
        return sorted(
            (m for r in self.runs for m in r.mutants[kind]),
            key=lambda m: (m.file, m.line, m.change),
        )

    def per_crate(self) -> dict[str, dict[str, int]]:
        """Each crate's mutants listed, tested, and tested by outcome, summed
        over the runs, in name order."""
        rows: dict[str, dict[str, int]] = defaultdict(lambda: {k: 0 for k in ("listed", "tested", *OUTCOMES)})
        for r in self.runs:
            for crate, n in r.listed.items():
                rows[crate]["listed"] += n
            for kind in OUTCOMES:
                for m in r.mutants[kind]:
                    rows[m.crate][kind] += 1
                    rows[m.crate]["tested"] += 1
        return dict(sorted(rows.items()))

    def broken(self) -> list[str]:
        """Why nothing a run says about mutants holds, for each such run."""
        out = []
        for r in self.runs:
            if r.missing:
                out.append(f"{r.path}: missing, {r.missing}")
            if r.baseline is not None and r.baseline != "Success":
                out.append(f"{r.path}: the unmutated tests did not pass ({r.baseline}), so no mutant was judged")
            out += [f"{r.path}: {o}" for o in r.other]
        return out

    def none_reported(self) -> bool:
        return all(r.missing for r in self.runs)

    def unfinished(self) -> list[Run]:
        return [r for r in self.runs if not r.finished and not r.missing]

    def failed(self) -> bool:
        return bool(self.all("survived")) or bool(self.broken())


def totals(rows: dict[str, dict[str, int]]) -> dict[str, int]:
    out: dict[str, int] = defaultdict(int)
    for row in rows.values():
        for k, v in row.items():
            out[k] += v
    return out


def counts_line(t: dict[str, int]) -> str:
    return (
        f"{t['listed']:,} listed, {t['tested']:,} tested: {t['caught']:,} caught, "
        f"{t['survived']:,} survived, {t['timeout']:,} timed out, {t['unviable']:,} unviable"
    )


def cell(text: str) -> str:
    """Text for a Markdown table cell, in a code span: a `|` would end the cell."""
    return "`" + text.replace("|", "\\|") + "`"


def where_md(m: Mutant, link: str | None) -> str:
    return f"[{m.where()}]({link}/{m.file}#L{m.line})" if link else f"`{m.where()}`"


def text_report(rep: Report, rows: dict[str, dict[str, int]]) -> str:
    lines = [f"  mutants: {counts_line(totals(rows))}"]
    if rep.none_reported():
        lines.append(f"  {NONE_REPORTED}")
    for crate, row in rows.items():
        lines.append(f"    {crate}: {counts_line(row)}")
    for r in rep.unfinished():
        lines.append(f"  {r.path}: stopped before its end ({STOPPED}); the rest were not tested")
    for b in rep.broken():
        lines.append(f"  {b}")
    for kind, title in (("survived", "survived (each is a finding)"), ("timeout", "timed out")):
        ms = rep.all(kind)
        if ms:
            lines.append(f"  {title}:")
            lines += [f"    {m.where()}  {m.function}  {m.change}" for m in ms]
    return "\n".join(lines) + "\n"


def markdown_report(rep: Report, rows: dict[str, dict[str, int]], link: str | None) -> str:
    out = ["## Mutants", ""]
    out += [
        "| Crate | Listed | Tested | Caught | Survived | Timed out | Unviable |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for crate, row in [*rows.items(), ("**All**", totals(rows))]:
        out.append(f"| {crate} | " + " | ".join(f"{row[k]:,}" for k in ("listed", "tested", *OUTCOMES)) + " |")
    out.append("")
    if rep.none_reported():
        out += [f"**{NONE_REPORTED}**", ""]
    for r in rep.unfinished():
        out.append(f"**Stopped before its end** (`{r.path}`): {STOPPED}. The mutants not tested are not judged.")
        out.append("")
    for b in rep.broken():
        out.append(f"**Not judged:** {b}.")
        out.append("")
    survived = rep.all("survived")
    if survived:
        out += [
            f"**Survived: {len(survived):,}.** No test failed on these changes. Review treats each as a "
            "finding: kill it with a test that asserts what the code does, or say why no behavior can "
            "show it (crates/AGENTS.md § Mutation testing).",
            "",
            "| Where | Function | Change |",
            "| --- | --- | --- |",
        ]
        out += [f"| {where_md(m, link)} | {cell(m.function)} | {cell(m.change)} |" for m in survived]
        out.append("")
    elif not rep.broken():
        out += ["No mutant survived.", ""]
    timeouts = rep.all("timeout")
    if timeouts:
        out += [
            f"**Timed out: {len(timeouts):,}.** The tests were stopped at the time limit: most often a "
            "mutant that hangs them, which they would not pass. Not survivors; listed so a slow test "
            "is seen.",
            "",
            "| Where | Function | Change |",
            "| --- | --- | --- |",
        ]
        out += [f"| {where_md(m, link)} | {cell(m.function)} | {cell(m.change)} |" for m in timeouts]
        out.append("")
    return "\n".join(out) + "\n"


def issue_body(rep: Report, rows: dict[str, dict[str, int]], link: str | None, budget: int = ISSUE_BUDGET) -> str:
    """The counts per crate, then the survivors grouped by file, as many as
    fit in `budget` characters, with the number left out."""
    head = ["| Crate | Tested | Survived | Timed out |", "| --- | ---: | ---: | ---: |"]
    for crate, row in [*rows.items(), ("**All**", totals(rows))]:
        head.append(f"| {crate} | {row['tested']:,} | {row['survived']:,} | {row['timeout']:,} |")
    head.append("")
    if rep.none_reported():
        head += [f"**{NONE_REPORTED}**", ""]
    if rep.unfinished():
        head += ["Some shards stopped before their end; their untested mutants are not counted.", ""]
    if rep.broken():
        head += [*(f"- {b}" for b in rep.broken()), ""]
    body = "\n".join(head) + "\n"
    by_file: dict[str, list[Mutant]] = defaultdict(list)
    for m in rep.all("survived"):
        by_file[m.file].append(m)
    shown = 0
    total = sum(len(v) for v in by_file.values())
    for file, ms in by_file.items():
        block = [f"**{file}**", ""]
        for m in ms:
            where = f"[{m.line}]({link}/{m.file}#L{m.line})" if link else str(m.line)
            block.append(f"- {where} `{m.function}`: `{m.change}`")
        text = "\n".join(block) + "\n\n"
        if len(body) + len(text) > budget:
            # The file whole or not at all, so a file is never half listed.
            break
        body += text
        shown += len(ms)
    if shown < total:
        body += f"And {total - shown:,} more: the run's summary lists every one.\n"
    return body


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(prog="scripts/mutants_report.py", description=__doc__.split("\n\n")[0])
    p.add_argument("dirs", nargs="+", help="cargo-mutants output directories (mutants.out)")
    p.add_argument("--markdown", help="append the report, as Markdown, to this file")
    p.add_argument("--link", help="link each mutant as LINK/path#Lnn")
    p.add_argument("--issue", help="write the weekly issue's body to this file")
    a = p.parse_args(argv)
    rep = Report([read_run(d) for d in a.dirs])
    rows = rep.per_crate()
    sys.stdout.write(text_report(rep, rows))
    if a.markdown:
        with open(a.markdown, "a") as f:
            f.write(markdown_report(rep, rows, a.link))
    if a.issue:
        with open(a.issue, "w") as f:
            f.write(issue_body(rep, rows, a.link))
    return 1 if rep.failed() else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
