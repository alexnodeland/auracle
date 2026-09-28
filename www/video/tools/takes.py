#!/usr/bin/env python3
"""Check a real recording's takes (footage.mjs without --dry): each shot's
errors, its paint rate while the page moves (a starved compositor repeats
frames), the offset
between picture and sound, and the sound itself (level, and a WAV that ends
before the shot does).

usage: takes.py FILM [--shot a,b]   (exit 1 if a take needs a re-shoot)
"""
import json, os, sys
import numpy as np
from scipy.io import wavfile

def moving_fps(paints, gap=0.25, least=1.0):
    """Paints per second while the page is moving. Chromium's screencast sends
    a frame only when something changed, so a still page paints rarely and
    that is not a fault; a starved compositor is one that paints slowly while
    things move. Moving = runs of paints closer than `gap` apart, lasting at
    least `least` seconds. None when nothing moved that long."""
    n = dur = 0.0
    run = []
    for t in list(paints) + [float("inf")]:
        if run and t - run[-1] > gap:
            if run[-1] - run[0] >= least:
                n += len(run) - 1
                dur += run[-1] - run[0]
            run = []
        run.append(t)
    return n / dur if dur else None


film = sys.argv[1]
only = set(sys.argv[sys.argv.index("--shot") + 1].split(",")) if "--shot" in sys.argv else None
V = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = json.load(open(f"{V}/films/{film}/shots.json"))
sd = f"{V}/out/{film}/shots"
bad = 0
for shot in spec["shots"]:
    sid = shot["id"]
    if only and sid not in only:
        continue
    mf, wf, vf = f"{sd}/{sid}.json", f"{sd}/{sid}.wav", f"{sd}/{sid}.webm"
    ff = f"{sd}/{sid}.frames.json"
    if not os.path.exists(mf):
        print(f"{sid:18s} MISSING sidecar"); bad += 1; continue
    m = json.load(open(mf))
    probs = list(m.get("errors") or [])
    if m.get("dry"):
        probs.append("sidecar is a rehearsal's")
    moving = None
    if os.path.exists(ff):
        moving = moving_fps(json.load(open(ff)).get("paints", []))
        if moving is not None and moving < 20:
            probs.append(f"only {moving:.1f} paints/s while the page moves")
    elif not os.path.exists(vf):
        probs.append("no picture (neither frames nor .webm)")
    elif m.get("paints_per_s", 0) < 20:
        # An older take: only the overall rate is known, and a still page
        # paints rarely, so this is a hint rather than a verdict.
        print(f"{sid:18s} (older take: {m.get('paints_per_s', 0):.1f} paints/s overall; check it by eye)")
    rms_db = peak_db = float("nan")
    if os.path.exists(wf):
        sr, x = wavfile.read(wf)
        x = x.astype(np.float32) / 32768.0 if x.dtype == np.int16 else x.astype(np.float32)
        if x.ndim > 1:
            x = x.mean(axis=1)
        dur_w = len(x) / sr
        rms_db = 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-12)
        peak_db = 20 * np.log10(np.max(np.abs(x)) + 1e-12)
        want = m.get("audio_until") or m.get("dur", 0)
        if dur_w < 0.9 * (want - max(0, m.get("audio_offset", 0))):
            probs.append(f"wav {dur_w:.1f}s < shot {want:.1f}s")
    else:
        probs.append("no .wav")
    rate = f"{moving:4.1f}/s moving" if moving is not None else f"{m.get('paints_per_s', 0):4.1f}/s"
    print(f"{sid:18s} {m.get('dur', 0):5.1f}s  paints {rate}  "
          f"offset {m.get('audio_offset', 0):+.3f}  wav rms {rms_db:6.1f} peak {peak_db:6.1f} dBFS"
          + (f"  clips {m['clips']}" if m.get("clips") else "")
          + (f"  PROBLEMS: {'; '.join(probs)}" if probs else ""))
    if probs:
        bad += 1
print(f"{bad} take(s) need attention" if bad else "all takes clean")
sys.exit(1 if bad else 0)
