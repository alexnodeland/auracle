#!/usr/bin/env python3
"""What each tour shot played, measured from its rehearsal.

usage (from the repo root): python3 www/video/films/tour/check_audio.py [SHOT ...]

Every tour shot stops its own capture just after its beat (gen_shots.py), so
a rehearsal (www/video/tools/rehearse.sh tour) keeps the app's sound in
www/video/out/tour/dry/ID.dl/. This lays that sound on the film's clock,
through any cut, beside the narration, and flags any stretch of more than
1.5 s where the bed is out (arrangement.json `levels`), nothing is said and
the app is silent: dead air. Exit 1 if any shot has some, or no capture.
"""
import glob
import json
import os
import re
import sys

import numpy as np
from scipy.io import wavfile

FDIR = os.path.dirname(os.path.abspath(__file__))
VIDEO = os.path.dirname(os.path.dirname(FDIR))
DRY = os.path.join(VIDEO, "out", "tour", "dry")
tl = json.load(open(os.path.join(FDIR, "timeline.json")))
spec = json.load(open(os.path.join(FDIR, "shots.json")))
levels = sorted(json.load(open(os.path.join(FDIR, "arrangement.json"))).get("levels", []))
beats = {b["id"]: b for b in tl["beats"]}
lines = {l["id"]: l for l in tl["lines"]}
only = set(sys.argv[1:])
HOP = 0.25
SILENT_DB = -50.0


def bed_db(t):
    db = 0.0
    for t0, d in levels:
        if t >= t0:
            db = d
    return db


def film_time(s, beat):
    """walk.js's `at`: seconds from the beat, or "line:word±s"."""
    if isinstance(s, (int, float)):
        return beat["t0"] + s
    m = re.search(r"([+-]\d+(?:\.\d+)?)$", s)
    if m:
        return film_time(s[: m.start()], beat) + float(m.group(1))
    lid, _, w = s.partition(":")
    l = lines[lid]
    if not w:
        return l["t0"]
    i = l["text"].lower().find(w.lower())
    if i < 0:
        return l["t0"]
    k = len(l["text"][:i].split())
    return l["words"][min(k, len(l["words"]) - 1)] if l.get("words") else l["t0"]


bad = 0
for sh in spec["shots"]:
    if only and sh["id"] not in only:
        continue
    meta_f = os.path.join(DRY, f"{sh['id']}.json")
    wavs = sorted(glob.glob(os.path.join(DRY, f"{sh['id']}.dl", "*.wav")), key=os.path.getsize)
    if not wavs or not os.path.exists(meta_f):
        print(f"{sh['id']}: no capture — rehearse it first")
        bad += 1
        continue
    meta = json.load(open(meta_f))
    sr, x = wavfile.read(wavs[-1])  # the capture; a take pressed on camera is shorter
    x = x.astype(np.float32) / (32768.0 if x.dtype == np.int16 else 1.0)
    if x.ndim > 1:
        x = x.mean(axis=1)
    b = beats[sh["beat"]]
    origin = b["t0"] - sh.get("pre", 0)
    # A cut: from film time `at`, shot time `from` (the sidecar resolved it).
    cuts = sorted((film_time(c[0], b), c[1]) for c in meta.get("clips") or [])

    def shot_at(t):
        s = t - origin
        for ft, frm in cuts:
            if t >= ft:
                s = frm + (t - ft)
        return s

    said = [l for l in tl["lines"] if l["beat"] == sh["beat"]]
    peak = 20 * np.log10(np.abs(x).max() + 1e-9)
    print(f"== {sh['id']} ({sh['beat']} {b['t0']:.2f}–{b['t1']:.2f} s): capture {len(x) / sr:.1f} s, peak {peak:.1f} dBFS"
          + (f", cuts at {[round(c[0], 2) for c in cuts]}" if cuts else ""))
    quiet, worst, t = 0.0, 0.0, b["t0"] - 0.25
    while t < b["t1"] + 0.25:
        i0 = int(shot_at(t) * sr)
        seg = x[max(0, i0): max(0, i0 + int(HOP * sr))]
        db = 20 * np.log10(np.sqrt(np.mean(seg ** 2)) + 1e-9) if len(seg) else -120.0
        speaking = next((l["id"] for l in said if l["t0"] - 0.05 <= t < l["t1"]), "")
        if db < SILENT_DB and not speaking and bed_db(t) <= -60:
            quiet += HOP
            worst = max(worst, quiet)
        else:
            quiet = 0.0
        bar = "#" * max(0, int((db + 60) / 2))
        print(f"  {t:7.2f} {db:6.1f} {speaking:8s} {bar}{'  <-- dead air' if quiet >= 1.5 else ''}")
        t += HOP
    if worst >= 1.5:
        bad += 1
        print(f"  !! {worst:.2f} s with no voice, no bed and no sound")
sys.exit(1 if bad else 0)
