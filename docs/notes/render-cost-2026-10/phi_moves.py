#!/usr/bin/env python3
"""How far a change that moves the sound moves φ.

    bench_render --phi --bank > before.json      # on each build
    python3 docs/notes/render-cost-2026-10/phi_moves.py before.json after.json

Both files are `bench_render --phi` on the same trees. Each coordinate's
change on each tree is divided by that coordinate's spread (its standard
deviation over the trees, before), so a move reads in the units the taste
model sees after standardizing. Prints, per coordinate, the largest move and
the tree it was on, then the trees that moved most, and how many trees moved
at all. A tree refused on one side and not the other is named.
"""
import json
import math
import sys


def main(a_path, b_path):
    a, b = json.load(open(a_path)), json.load(open(b_path))
    names = a["names"]
    rows_a = {r["name"]: r["phi"] for r in a["rows"]}
    rows_b = {r["name"]: r["phi"] for r in b["rows"]}
    both = [n for n in rows_a if rows_a[n] is not None and rows_b.get(n) is not None]
    for n in rows_a:
        if (rows_a[n] is None) != (rows_b.get(n) is None):
            print(f"vetting changed on {n}: before {'refused' if rows_a[n] is None else 'kept'}")
    spread = []
    for i in range(len(names)):
        xs = [rows_a[n][i] for n in both]
        m = sum(xs) / len(xs)
        spread.append(math.sqrt(sum((x - m) ** 2 for x in xs) / len(xs)) or 1.0)
    moved = [n for n in both if rows_a[n] != rows_b[n]]
    print(f"{len(both)} trees measured on both sides; {len(moved)} moved")
    per_coord = []
    for i, name in enumerate(names):
        worst, at = max(((abs(rows_b[n][i] - rows_a[n][i]) / spread[i], n) for n in both), default=(0, ""))
        per_coord.append((worst, name, at))
    per_coord.sort(reverse=True)
    print("\nlargest move of each coordinate, in its spread over the trees (top 15):")
    for worst, name, at in per_coord[:15]:
        print(f"  {worst:9.2e}  {name:<28} on {at}")
    print("\nthe trees that moved most (largest move of any coordinate):")
    per_tree = sorted(
        ((max(abs(rows_b[n][i] - rows_a[n][i]) / spread[i] for i in range(len(names))), n) for n in moved),
        reverse=True,
    )
    for worst, n in per_tree[:10]:
        print(f"  {worst:9.2e}  {n}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
