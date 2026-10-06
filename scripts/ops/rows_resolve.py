#!/usr/bin/env python3
"""Resolve a rebase's line-wise conflicts: rows of a docs table, a list, the
Makefile's DEV_CHECKS line (docs/process.md § Waves; the ship-wave skill).

    python3 scripts/ops/rows_resolve.py FILE [FILE ...]

Most conflicts a branch meets on its way into the merge queue are two
branches adding or editing different rows of the same table (testing.md's
tiers, gates and spec tables), or adding a word to the same line. Neither
side's change is wrong; git only can't tell that they don't overlap.

The conflicts must carry their base (diff3): rebase with
`git -c merge.conflictStyle=diff3 rebase origin/main`, or redraw one file's
conflicts with `git checkout --conflict=diff3 -- FILE`. Changing git's
config is not needed and not done.

For each conflict, the side marked `<<<<<<<` is kept: in a rebase that is
origin/main with the commits replayed so far. The other side's changes to
the base are applied to it, line by line, where each is aligned with the
base:

- a line it changed, or removed, is swapped or removed where the kept side
  still has that line as the base had it;
- a line it added goes after the base line it followed (after anything the
  kept side added there too), or at the end when the kept side changed that
  line;
- when every side is one line, the same is done word by word, so two words
  added to one line (DEV_CHECKS := … a b) are both kept.

A line both sides changed is a real overlap: that conflict is left as it is
for a person, the file says so, and the exit code is 1. Every other conflict
in the file is still resolved. A conflict with no base (merge style) is left
too, with the command that redraws it. Python 3 standard library only.
"""

from __future__ import annotations

import difflib
import re
import sys
from collections import Counter

LINES = r"((?:(?![<|=>]{7})[^\n]*\n)*)"
DIFF3 = re.compile(
    r"^<{7}[^\n]*\n" + LINES + r"^\|{7}[^\n]*\n" + LINES + r"^={7}\n" + LINES + r"^>{7}[^\n]*(?:\n|\Z)",
    re.M,
)
TWO_WAY = re.compile(r"^<{7}[^\n]*\n" + LINES + r"^={7}\n" + LINES + r"^>{7}[^\n]*(?:\n|\Z)", re.M)
WORDS = re.compile(r"\S+|\s+")


def merge(kept: list[str], base: list[str], theirs: list[str]) -> list[str] | None:
    """`kept` with `theirs`' changes to `base` applied, or None where both
    changed the same element. Elements are lines, or a line's words."""
    if kept == theirs or theirs == base:
        return list(kept)
    if kept == base:
        return list(theirs)
    where: dict[int, int] = {}  # a base element's index in `kept`, where kept has it unchanged
    added = Counter()  # how many elements `kept` added before base[i]
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, base, kept, autojunk=False).get_opcodes():
        if tag == "equal":
            where.update({i1 + k: j1 + k for k in range(i2 - i1)})
        elif tag == "insert":
            added[i1] += j2 - j1
    edits = []  # (start, end, new) in `kept`, applied from the bottom up
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, base, theirs, autojunk=False).get_opcodes():
        if tag == "equal":
            continue
        new = theirs[j1:j2]
        if tag in ("replace", "delete"):
            spots = [where.get(i) for i in range(i1, i2)]
            if None in spots or spots != list(range(spots[0], spots[0] + len(spots))):
                return None
            edits.append((spots[0], spots[-1] + 1, new))
        elif i1 == 0:
            edits.append((added[0], added[0], new))
        elif i1 - 1 in where:
            at = where[i1 - 1] + 1 + added[i1]
            edits.append((at, at, new))
        elif i1 in where:
            edits.append((where[i1], where[i1], new))
        else:
            edits.append((len(kept), len(kept), new))
    out = list(kept)
    for start, end, new in sorted(edits, key=lambda e: (e[0], e[1]), reverse=True):
        out[start:end] = new
    return out


def resolve_block(kept: str, base: str, theirs: str) -> str | None:
    k, b, t = (s.splitlines(keepends=True) for s in (kept, base, theirs))
    lines = merge(k, b, t)
    if lines is not None:
        return "".join(lines)
    if len(k) == len(b) == len(t) == 1:
        words = merge(*(WORDS.findall(s[0]) for s in (k, b, t)))
        if words is not None:
            return "".join(words)
    return None


def resolve(text: str) -> tuple[str, list[str]]:
    """The text with every conflict it can resolve resolved, and a line for
    each it left."""
    left: list[str] = []

    def one(m: re.Match) -> str:
        kept, base, theirs = m.groups()
        out = resolve_block(kept, base, theirs)
        if out is None:
            line = text.count("\n", 0, m.start()) + 1
            left.append(f"line {line}: both sides changed the same line")
            return m.group(0)
        return out

    text = DIFF3.sub(one, text)
    for m in TWO_WAY.finditer(text):
        line = text.count("\n", 0, m.start()) + 1
        left.append(f"line {line}: no base (redraw it with: git checkout --conflict=diff3 -- FILE)")
    return text, left


def main(argv: list[str]) -> int:
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__.strip())
        return 0 if argv else 2
    ok = True
    for path in argv:
        with open(path, newline="") as f:
            before = f.read()
        if "<<<<<<<" not in before:
            print(f"{path}: no conflict")
            continue
        after, left = resolve(before)
        if after != before:
            with open(path, "w", newline="") as f:
                f.write(after)
        resolved = before.count("\n<<<<<<<") + before.startswith("<<<<<<<") - len(left)
        print(f"{path}: {resolved} resolved, {len(left)} left")
        for why in left:
            print(f"  {why}")
        ok = ok and not left
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
