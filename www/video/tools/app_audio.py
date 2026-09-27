#!/usr/bin/env python3
"""The recorded app sound under a walkthrough, as mix.py's --app list.

usage: app_audio.py FILM [--gain-db G] > out/FILM/app.json

Each shot in films/FILM/shots.json was recorded from `pre` seconds before its
beat (tools/footage.mjs), and the app's own recorder started `audio_offset`
seconds before the picture (the shot's sidecar JSON). So a shot's WAV starts
at film time beat.t0 − pre + audio_offset, and is heard only over the stretch
of film its beat shows (the scene's quarter-second overlaps included).
"""
import argparse
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEO = os.path.dirname(HERE)


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
    out = []
    for shot in spec["shots"]:
        b = beats.get(shot["beat"])
        wav = os.path.join(sdir, f"{shot['id']}.wav")
        meta_f = os.path.join(sdir, f"{shot['id']}.json")
        if not b or not os.path.exists(wav) or not os.path.exists(meta_f):
            continue
        meta = json.load(open(meta_f))
        origin = b["t0"] - shot.get("pre", 0)
        out.append({
            "file": wav,
            "t": round(origin + meta.get("audio_offset", 0), 4),
            "from": round(b["t0"] - 0.25, 4),
            "to": round(b["t1"] + 0.25, 4),
            "gain_db": args.gain_db,
        })
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
