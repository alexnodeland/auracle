#!/usr/bin/env python3
"""Lay PATCH: inside the sound on bar lines, end to end.

usage (from the repo root): python3 www/video/films/view-patch/align_tails.py

Every beat starts on a bar line (script.json `snap: "bar"`), so a beat that ends
mid-bar would leave a gap before the next one: black picture, and a bed that
turns on off the beat. This sets each beat's `tail` in script.json so it ends
where the next one starts (its own base tail plus the gap), then writes
timeline.json and arrangement.json with tools/timeline.py from the measured
voice (www/video/out/view-patch/voice/manifest.json). Running it twice gives
the same result. Run gen_shots.py after it.
"""
import json
import os
import subprocess

FDIR = os.path.dirname(os.path.abspath(__file__))
VIDEO = os.path.dirname(os.path.dirname(FDIR))
FILM = os.path.basename(FDIR)
MANIFEST = os.path.join(VIDEO, "out", FILM, "voice", "manifest.json")
# Each beat's own tail, before the bar is filled: the chapter cards (t-*) are
# one bar with no tail, the cold open none, the outro rings out.
BASE = {"cold": 0.0, "title": 0.3, "together": 0.5, "outro": 2.5}


def base_tail(beat_id):
    return BASE.get(beat_id, 0.0 if beat_id.startswith("t-") else 0.3)


def timeline():
    subprocess.run(["python3", os.path.join(VIDEO, "tools", "timeline.py"), FDIR, "--voice", MANIFEST],
                   check=True, capture_output=True)
    return json.load(open(os.path.join(FDIR, "timeline.json")))


def main():
    path = os.path.join(FDIR, "script.json")
    script = json.load(open(path))
    for b in script["beats"]:
        b["tail"] = base_tail(b["id"])
    json.dump(script, open(path, "w"), indent=2, ensure_ascii=False)
    tl = timeline()
    for b, nxt in zip(tl["beats"], tl["beats"][1:]):
        gap = nxt["t0"] - b["t1"]
        if gap > 0.03:
            sb = next(x for x in script["beats"] if x["id"] == b["id"])
            sb["tail"] = round(sb["tail"] + gap - 0.02, 3)
    json.dump(script, open(path, "w"), indent=2, ensure_ascii=False)
    tl = timeline()
    bar = 60 / tl["grid"]["bpm"] * tl["grid"]["meter"]
    worst = max(nb["t0"] - b["t1"] for b, nb in zip(tl["beats"], tl["beats"][1:]))
    print(f"{FILM}: {tl['duration']:.1f} s ({tl['duration'] / bar:.0f} bars), largest gap between beats {worst:.3f} s")
    for b in tl["beats"]:
        print(f"  {b['id']:<11} {b['t0']:7.2f} → {b['t1']:7.2f}  ({(b['t1'] - b['t0']) / bar:4.1f} bars)")


if __name__ == "__main__":
    main()
