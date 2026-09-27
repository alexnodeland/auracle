#!/usr/bin/env python3
"""Lay a film out in time: narration on the music's bar grid.

usage: timeline.py FILM_DIR [--voice MANIFEST.json] [--words WORDS.json]

Reads FILM_DIR/script.json and writes:

  FILM_DIR/timeline.json     every line's and beat's start and end, the music
                             grid, and word times when --words is given. The
                             stage pins every scene to these cues.
  FILM_DIR/arrangement.json  the soundtrack's sections in order with their bar
                             counts, for the score renderer: each beat that
                             names a `music` section starts that section, and
                             it runs until the next one starts.

Without --voice, line durations are estimated at 2.75 words a second, so the
visuals can be built before the voice exists; with it, the measured durations
from tools/../voice/tts.py are used and nothing else changes.

A beat starts on the next bar line (`snap: "bar"`, the default), the next beat
(`"beat"`), or immediately (`"none"`). Cutting on the bar is what makes an
edit feel played rather than assembled.
"""
import argparse
import json
import math
import os
import re

WPS = 2.75


def est_duration(text):
    words = len(re.findall(r"[\w'’-]+", text))
    commas = text.count(",") + text.count(";")
    stops = len(re.findall(r"[.!?:]", text))
    return words / WPS + 0.18 * commas + 0.3 * max(0, stops - 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("film_dir")
    ap.add_argument("--voice", help="manifest.json from voice/tts.py")
    ap.add_argument("--words", help="per-line word times, {line_id: [t, …]} relative to the line start")
    args = ap.parse_args()

    script = json.load(open(os.path.join(args.film_dir, "script.json")))
    fps = script.get("fps", 30)
    bpm = script["music"]["bpm"]
    meter = script["music"].get("meter", 4)
    spb = 60.0 / bpm
    bar = spb * meter

    durs = {}
    if args.voice:
        man = json.load(open(args.voice))
        for l in man["lines"]:
            durs[l["id"]] = l["duration_s"]
    words = json.load(open(args.words)) if args.words else {}

    t = 0.0
    lines, beats = [], []
    sections = []  # (name, start_time)
    default_snap = script.get("snap", "bar")
    for b in script["beats"]:
        snap = b.get("snap", default_snap)
        if snap == "bar":
            t = math.ceil(t / bar - 1e-6) * bar
        elif snap == "beat":
            t = math.ceil(t / spb - 1e-6) * spb
        b0 = t
        if b.get("music"):
            sections.append((b["music"], b0))
        t += b.get("lead", 0.0)
        for l in b["lines"]:
            d = durs.get(l["id"]) or est_duration(l["text"])
            entry = {"id": l["id"], "text": l["text"], "beat": b["id"], "t0": round(t, 3), "t1": round(t + d, 3)}
            if l["id"] in words:
                entry["words"] = [round(t + w, 3) for w in words[l["id"]]]
            lines.append(entry)
            t += d + l.get("post", 0.0)
        t += b.get("tail", 0.0)
        beats.append({"id": b["id"], "t0": round(b0, 3), "t1": round(t, 3), "music": b.get("music")})

    # The film ends with the last beat, rounded up to a whole bar so the sting
    # rings out on the grid.
    end = math.ceil(t / bar - 1e-6) * bar
    beats[-1]["t1"] = round(end, 3)
    # The music: each section runs to the next section's start (whole bars).
    arrangement = []
    for i, (name, s0) in enumerate(sections):
        s1 = sections[i + 1][1] if i + 1 < len(sections) else end
        bars = max(1, round((s1 - s0) / bar))
        arrangement.append({"section": name, "bars": bars, "t0": round(s0, 3)})

    timeline = {
        "film": script["film"],
        "fps": fps,
        "duration": round(end, 3),
        "grid": {"bpm": bpm, "meter": meter, "t0": 0.0},
        "estimated": not bool(args.voice),
        "beats": beats,
        "lines": lines,
        "cues": {},
    }
    old = os.path.join(args.film_dir, "timeline.json")
    if os.path.exists(old):
        prev = json.load(open(old))
        if "env" in prev:
            timeline["env"] = prev["env"]
    json.dump(timeline, open(old, "w"), indent=1, ensure_ascii=False)
    json.dump(
        {"film": script["film"], "bpm": bpm, "meter": meter, "bed": script["music"]["bed"], "sections": arrangement},
        open(os.path.join(args.film_dir, "arrangement.json"), "w"),
        indent=1,
    )
    print(f"{script['film']}: {end:.1f} s ({end / bar:.0f} bars at {bpm} BPM), {len(lines)} lines"
          + (" — ESTIMATED durations" if not args.voice else ""))
    for b in beats:
        print(f"  {b['id']:<8} {b['t0']:7.2f} → {b['t1']:7.2f}  {b['music'] or ''}")
    for a in arrangement:
        print(f"  music {a['section']:<10} {a['bars']:3d} bars from {a['t0']:.2f}")


if __name__ == "__main__":
    main()
