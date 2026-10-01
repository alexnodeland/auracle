#!/usr/bin/env python3
"""Fit view-evolve's timing to its measured voice, then lay the timeline:

    python3 www/video/films/view-evolve/fit_timing.py

Run it after the voice (tools/voice.sh view-evolve), and again whenever a
line changes. It rewrites three things in script.json, then runs
tools/timeline.py --voice:

- **Tails.** Chapter turns, the title and the outro start on a bar line, so
  the beat before one would otherwise end up to a bar early, leaving a gap
  with no scene in it (a black frame in walk.js). That beat's tail is
  stretched to end GAP s before the bar line; its shot simply runs on.
- **Turn leads.** A turn is one bar: its lead ends GAP s before the next beat
  line, where its chapter starts (film.js relies on the chapter starting
  exactly one bar after its turn).
- **The bed's sections.** loop_a from the title, loop_b from the fifth
  chapter's turn, as in the other films (a bed section runs until the next
  one starts; walkthrough.sh fits the study score to those lengths). Section
  names are used once each: tools/fit_score.py fits by name. The bed is heard
  where a beat's bed_db says (0 under the title, the turns and the outro; out
  under the demos).
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
SCRIPT = os.path.join(HERE, "script.json")
VOICE = os.path.join(ROOT, "www", "video", "out", "view-evolve", "voice", "manifest.json")
TIMELINE = os.path.join(ROOT, "www", "video", "tools", "timeline.py")
DEMOS = os.path.join(ROOT, "www", "video", "out", "view-evolve", "demos.json")  # measured tails (tools/demo_tail.py)
GAP = 0.12
BAR = 240 / 84
# The tail each beat is written with, before stretching.
BASE_TAIL = {"open": 0.0, "title": 0.6, "outro": 2.5}


def timeline(quiet=True):
    demos = ["--demos", DEMOS] if os.path.exists(DEMOS) else []
    r = subprocess.run([sys.executable, TIMELINE, HERE, "--voice", VOICE, *demos], check=True, capture_output=True, text=True)
    if not quiet:
        print(r.stdout, end="")
    return json.load(open(os.path.join(HERE, "timeline.json")))


def save(s):
    with open(SCRIPT, "w") as f:
        f.write(json.dumps(s, indent=2, ensure_ascii=False) + "\n")


def main():
    s = json.load(open(SCRIPT))
    beats = s["beats"]
    # From the written tails and a turn's full bar, every time.
    for b in beats:
        if b["id"].startswith("turn"):
            b["lead"], b["tail"] = 2.74, 0.0
        elif b["lines"]:
            b["tail"] = BASE_TAIL.get(b["id"], 0.2)
    save(s)
    tb = {b["id"]: b for b in timeline()["beats"]}
    for i, b in enumerate(beats[:-1]):
        gap = tb[beats[i + 1]["id"]]["t0"] - tb[b["id"]]["t1"]
        if gap <= GAP + 0.02:
            continue
        if b["id"].startswith("turn"):
            b["lead"] = round(b["lead"] + gap - GAP, 2)
        else:
            b["tail"] = round(b.get("tail", 0.0) + gap - GAP, 2)
    save(s)
    # The bed: loop_a from the title, loop_b from the fifth chapter's turn.
    for b in beats:
        b.pop("music", None)
    MUSIC = {"title": "loop_a", "turn5": "loop_b"}
    # `music` goes first among a beat's fields, where the other films keep it.
    s["beats"] = [dict([("id", b["id"])] + ([("music", MUSIC[b["id"]])] if b["id"] in MUSIC else []) + [(x, y) for x, y in b.items() if x != "id"]) for b in beats]
    save(s)
    tl = timeline(quiet=False)
    t = tl["beats"]
    gaps = [round(t[i + 1]["t0"] - t[i]["t1"], 2) for i in range(len(t) - 1)]
    print("gaps between beats:", gaps)
    return 1 if max(gaps) > 0.3 else 0


if __name__ == "__main__":
    sys.exit(main())
