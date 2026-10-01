#!/usr/bin/env python3
"""Lay A tour of Auracle end to end: no gap between one beat and the next.

usage (from the repo root): python3 www/video/films/tour/align_tails.py

A beat starts on the next beat or bar line (script.json `snap`), so one that
ends between them would leave a gap before the next: the film shows a shot
only a quarter second either side of its beat, so a longer gap is a blank,
silent frame. This sets each beat's `tail` in script.json to its own base tail
plus the gap (less 0.02 s, so the next start stays put), then writes
timeline.json and arrangement.json with tools/timeline.py from the measured
voice (www/video/out/tour/voice/manifest.json). The shot under a lengthened
beat simply runs on (the arpeggio, the first pick being played). Running it
twice gives the same result. Run gen_shots.py after it.
"""
import json
import os
import subprocess

FDIR = os.path.dirname(os.path.abspath(__file__))
VIDEO = os.path.dirname(os.path.dirname(FDIR))
FILM = os.path.basename(FDIR)
MANIFEST = os.path.join(VIDEO, "out", FILM, "voice", "manifest.json")
DEMOS = os.path.join(VIDEO, "out", FILM, "demos.json")  # the demos' measured tails (tools/demo_tail.py)
# Each beat's own tail, before the gap is filled: the cold open is its lead,
# the title holds the map a moment, the outro rings out under the end card.
BASE = {"open": 0.0, "title": 1.2, "views": 0.5, "bank": 0.5, "dock": 0.6, "header": 0.5, "first": 0.6, "next": 3.2}


def timeline():
    subprocess.run(["python3", os.path.join(VIDEO, "tools", "timeline.py"), FDIR, "--voice", MANIFEST]
                   + (["--demos", DEMOS] if os.path.exists(DEMOS) else []), check=True, capture_output=True)
    return json.load(open(os.path.join(FDIR, "timeline.json")))


def write(script, path):
    with open(path, "w") as f:
        f.write(json.dumps(script, indent=2, ensure_ascii=False) + "\n")


def main():
    path = os.path.join(FDIR, "script.json")
    script = json.load(open(path))
    for b in script["beats"]:
        b["tail"] = BASE.get(b["id"], 0.5)
    write(script, path)
    tl = timeline()
    for b, nxt in zip(tl["beats"], tl["beats"][1:]):
        gap = nxt["t0"] - b["t1"]
        if gap > 0.03:
            sb = next(x for x in script["beats"] if x["id"] == b["id"])
            sb["tail"] = round(sb["tail"] + gap - 0.02, 3)
    write(script, path)
    tl = timeline()
    worst = max(nb["t0"] - b["t1"] for b, nb in zip(tl["beats"], tl["beats"][1:]))
    print(f"{FILM}: {tl['duration']:.2f} s, largest gap between beats {worst:.3f} s")
    for b in tl["beats"]:
        print(f"  {b['id']:<7} {b['t0']:7.2f} → {b['t1']:7.2f}")


if __name__ == "__main__":
    main()
