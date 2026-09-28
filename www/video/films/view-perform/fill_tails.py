# Stretch each beat's tail in script.json so it ends where the next beat
# begins (the next beat snaps to the grid, so its start does not move), then
# re-time. Without it, a beat that ends before the next bar line leaves an
# empty frame between scenes.
#
#   python3 www/video/films/view-perform/fill_tails.py      (from the repo root)
#
# Needs the measured voice (out/view-perform/voice/manifest.json, from tts.py
# and asr_check.py). Runs tools/timeline.py --voice twice and rewrites
# script.json's tails, timeline.json and arrangement.json. Then run
# gen_shots.py, since the shots' timing follows the timeline.
import json
import os
import subprocess

FILM = os.path.dirname(os.path.abspath(__file__))
VIDEO = os.path.abspath(os.path.join(FILM, "..", ".."))
MANIFEST = os.path.join(VIDEO, "out", "view-perform", "voice", "manifest.json")


def timeline():
    subprocess.run(["python3", os.path.join(VIDEO, "tools", "timeline.py"), FILM, "--voice", MANIFEST], check=True, capture_output=True)
    return json.load(open(os.path.join(FILM, "timeline.json")))


tl = timeline()
s = json.load(open(os.path.join(FILM, "script.json")))
beats = tl["beats"]
changed = 0
for i, b in enumerate(beats[:-1]):
    gap = beats[i + 1]["t0"] - b["t1"]
    if gap > 0.015:
        sb = next(x for x in s["beats"] if x["id"] == b["id"])
        sb["tail"] = round(sb.get("tail", 0) + gap - 0.01, 3)
        changed += 1
        print(f"  {b['id']:<14} tail +{gap - 0.01:.3f} → {sb['tail']}")
open(os.path.join(FILM, "script.json"), "w").write(json.dumps(s, indent=2, ensure_ascii=False) + "\n")
tl2 = timeline()
bad = [(a["id"], round(c["t0"] - a["t1"], 3)) for a, c in zip(tl2["beats"], tl2["beats"][1:]) if abs(c["t0"] - a["t1"]) > 0.02]
print(f"{changed} tails stretched; film {tl2['duration']:.1f} s; gaps left: {bad}")
