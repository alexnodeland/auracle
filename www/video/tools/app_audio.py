#!/usr/bin/env python3
"""The recorded app sound under a walkthrough, as mix.py's --app list.

usage: app_audio.py FILM [--gain-db G] > out/FILM/app.json

Each shot in films/FILM/shots.json was recorded from `pre` seconds before its
beat (tools/footage.mjs), and the app's own recorder started `audio_offset`
seconds after the picture (the shot's sidecar JSON; negative if before). So
with no cut, a shot's WAV starts at film time beat.t0 − pre + audio_offset,
and is heard over the stretch of film its beat shows (the scene's
quarter-second overlaps included).

A shot with cuts (`clips` in its sidecar: the film jumps from a press to its
result tens of seconds later) is heard the way stage/walk.js shows it: one
window per stretch between cuts, each placing the same WAV so that film time
t hears shot time `from + (t − at)`. The cut times come from the narration's
word times (timeline.json), exactly as walk.js resolves them, and a cut never
goes back. Sound cannot be stretched, so a cut played at a rate other than 1
is left silent, and said so.
"""
import argparse
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEO = os.path.dirname(HERE)
OFFSET = re.compile(r"([+-]\d+(?:\.\d+)?)$")


def word_time(line, word):
    """When the narrator reaches `word` in `line` (walk.js's wordTime)."""
    i = line["text"].lower().find(word.lower())
    if i < 0:
        return line["t0"]
    if line.get("words"):
        idx = len(line["text"][:i].split())
        return line["words"][min(idx, len(line["words"]) - 1)]
    return line["t0"] + (line["t1"] - line["t0"]) * i / len(line["text"])


def film_time(spec, beat, lines):
    """A number (seconds from the beat) or "line:word±s" (walk.js's at)."""
    if isinstance(spec, (int, float)):
        return beat["t0"] + spec
    m = OFFSET.search(spec)
    if m:
        return film_time(spec[: m.start()], beat, lines) + float(m.group(1))
    lid, _, word = spec.partition(":")
    line = lines[lid]
    return word_time(line, word) if word else line["t0"]


def windows(shot, beat, meta, lines):
    """[(film from, film to, film time where the WAV starts)] for one shot."""
    origin = beat["t0"] - shot.get("pre", 0)
    off = meta.get("audio_offset", 0)
    lo, hi = beat["t0"] - 0.25, beat["t1"] + 0.25
    cuts = []
    for c in meta.get("clips") or []:
        spec, start = c[0], c[1]
        rate = c[2] if len(c) > 2 else 1
        cuts.append({"t": film_time(spec, beat, lines), "from": start, "rate": rate})
    cuts.sort(key=lambda c: c["t"])
    for i, c in enumerate(cuts):
        prev = cuts[i - 1] if i else None
        floor = prev["from"] + (c["t"] - prev["t"]) * prev["rate"] if prev else c["t"] - origin
        c["from"] = max(c["from"], floor)
    out = []
    edges = [lo] + [c["t"] for c in cuts] + [hi]
    for k in range(len(edges) - 1):
        a, b = max(edges[k], lo), min(edges[k + 1], hi)
        if b <= a:
            continue
        if k == 0:
            out.append((a, b, origin + off))
            continue
        c = cuts[k - 1]
        if c["rate"] != 1:
            print(f"{shot['id']}: the cut at {c['t']:.2f} s plays at rate {c['rate']}; its sound is left out", file=sys.stderr)
            continue
        out.append((a, b, c["t"] - c["from"] + off))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("film")
    ap.add_argument("--gain-db", type=float, default=-3.0)
    args = ap.parse_args()
    fdir = os.path.join(VIDEO, "films", args.film)
    sdir = os.path.join(VIDEO, "out", args.film, "shots")
    tl = json.load(open(os.path.join(fdir, "timeline.json")))
    spec = json.load(open(os.path.join(fdir, "shots.json")))
    beats = {b["id"]: b for b in tl["beats"]}
    lines = {l["id"]: l for l in tl["lines"]}
    out = []
    for shot in spec["shots"]:
        b = beats.get(shot["beat"])
        wav = os.path.join(sdir, f"{shot['id']}.wav")
        meta_f = os.path.join(sdir, f"{shot['id']}.json")
        if not b or not os.path.exists(wav) or not os.path.exists(meta_f):
            continue
        meta = json.load(open(meta_f))
        for a, z, t in windows(shot, b, meta, lines):
            out.append({"file": wav, "t": round(t, 4), "from": round(a, 4), "to": round(z, 4), "gain_db": args.gain_db})
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
