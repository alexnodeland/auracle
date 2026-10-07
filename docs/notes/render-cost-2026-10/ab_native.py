#!/usr/bin/env python3
"""Two builds of the native render benchmark, against each other.

    python3 docs/notes/render-cost-2026-10/ab_native.py BEFORE AFTER [rounds] [reps] [-- bench flags]
    python3 docs/notes/render-cost-2026-10/ab_native.py BEFORE AFTER [rounds] [reps] -- --kinds

BEFORE and AFTER are two `bench_render` binaries (`target/release/examples/
bench_render` of two checkouts). They run alternately, `rounds` times each
(default 4), every run the least of `reps` repeats (default 3) of each tree
in this thread's CPU time; a tree's figure on each side is its least over
the rounds. Alternating, and taking the least, is what makes the two sides
comparable on a machine whose load moves from minute to minute: each side
sees the same spread of load, and the least is the run that waited least
for a core. The load average is printed beside every run.

Prints each tree's ms per render on both sides and the ratio, and the set's
total. With `-- --kinds`, the rows are `bench_render --kinds`'s one voice of
each module kind, and the figure is the live voice's ms per voice-second.
"""
import os
import re
import subprocess
import sys

ROW = re.compile(r"^(.{20}) +([0-9.]+) +([0-9.]+)$")
# --kinds: kind (22), nodes, live, + on saw, render, + on saw.
KIND = re.compile(r"^(.{22}) +([0-9]+) +([0-9.]+) +(-?[0-9.]+) +([0-9.]+) +(-?[0-9.]+)$")


def run(binary, reps, extra):
    out = subprocess.run(
        [binary, f"--reps={reps}", *extra], capture_output=True, text=True, check=True
    ).stdout
    rows = {}
    for line in out.splitlines():
        m = KIND.match(line) if "--kinds" in extra else ROW.match(line)
        if m:
            rows[m.group(1).strip()] = float(m.group(3) if "--kinds" in extra else m.group(2))
    return rows


def main():
    args = sys.argv[1:]
    extra = []
    if "--" in args:
        i = args.index("--")
        args, extra = args[:i], args[i + 1 :]
    before, after = args[0], args[1]
    rounds = int(args[2]) if len(args) > 2 else 4
    reps = int(args[3]) if len(args) > 3 else 3
    best = {"before": {}, "after": {}}
    order = []
    for r in range(rounds):
        for side, binary in (("before", before), ("after", after)):
            load = os.getloadavg()[0]
            rows = run(binary, reps, extra)
            for name, ms in rows.items():
                if name not in order:
                    order.append(name)
                best[side][name] = min(ms, best[side].get(name, float("inf")))
            total = sum(rows.values())
            print(f"round {r + 1} {side:6}: {total:8.0f} ms for the set, load {load:.0f}", flush=True)
    print(f"\n{'tree':<20} {'before':>9} {'after':>9} {'after/before':>13}")
    tb = ta = 0.0
    for name in order:
        b, a = best["before"][name], best["after"][name]
        tb += b
        ta += a
        print(f"{name:<20} {b:9.1f} {a:9.1f} {a / b:13.3f}")
    print(f"{'set':<20} {tb:9.1f} {ta:9.1f} {ta / tb:13.3f}")
    print(f"load average {os.getloadavg()[0]:.0f}, after")


if __name__ == "__main__":
    main()
