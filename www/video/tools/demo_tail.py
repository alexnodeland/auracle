#!/usr/bin/env python3
"""Measure a demo's tail: how long after its last note-off it takes to fall
`grammar.demo_tail_db` (30 dB) under its playing level (www/brand/sound.json).

usage: demo_tail.py WAV T0 OFF [--id ID] [--demos DEMOS.json]

T0 and OFF are the demo's first note and last note-off, in seconds into the
WAV (a recorded take, or a render of the demo). It prints the tail; with --id
and --demos it also records it there, as {ID: {"tail_s": …}}, the file
timeline.py --demos lays the demo out on. The voice then waits for the tail and
0.8 s more (the grammar), so a demo that rings longer moves the next line.

The playing level is the median of the RMS of the sound's mono sum over 50 ms
frames (`grammar.demo_tail_hop_s`) between T0 and OFF, measured as mix.py
measures a mixed demo (mix.demo_tail).
"""
import argparse
import json
import os
import sys

import mix


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("wav")
    ap.add_argument("t0", type=float)
    ap.add_argument("off", type=float)
    ap.add_argument("--id")
    ap.add_argument("--demos")
    args = ap.parse_args()
    tail = mix.demo_tail(mix.load(args.wav), args.t0, args.off)
    if tail is None:
        floor = -mix.sound_defaults.TIMINGS["demo_tail_db"]
        sys.exit(f"demo_tail.py: {args.wav} never falls {floor:g} dB under its playing level after {args.off} s")
    print(f"{args.id or args.wav}: tail {tail:.3f} s")
    if args.demos and args.id:
        demos = {}
        if os.path.exists(args.demos):
            with open(args.demos) as f:
                demos = json.load(f)
        demos.setdefault(args.id, {})["tail_s"] = tail
        with open(args.demos, "w") as f:
            json.dump(demos, f, indent=1)
            f.write("\n")


if __name__ == "__main__":
    main()
