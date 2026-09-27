#!/usr/bin/env python3
"""Fit a score to a film: change its sections' lengths, keep its music.

usage: fit_score.py SCORE.json OUT.json name=bars [name=bars ...]

A score (www/video/sound/*.json) is written in sections of a composed length,
with some events anchored to where a section starts (an intro's first chord,
its first bells) and some to where it ends (a riser into the next downbeat, a
final chord). Most of a score is patterns that fill whatever length they are
given. This retimes a section from M bars to N:

  - an event in the first half of the section stays where it is;
  - an event in the second half moves with the section's end (by N − M bars);
  - a note held to the section's end is lengthened (or shortened) to reach
    the new end;
  - a pattern's bar range that ended at the section's end ends at the new one,
    and one that started in the second half moves with the end;
  - anything pushed before bar 1 or past bar N is dropped, and said so.

It is a composer's rule of thumb, applied mechanically: the output is meant to
be listened to (or measured) before it is used.
"""
import copy
import json
import sys


def main():
    src, out = sys.argv[1], sys.argv[2]
    targets = dict((a.split("=")[0], int(a.split("=")[1])) for a in sys.argv[3:])
    s = json.load(open(src))
    bpb = s.get("beats_per_bar", 4)
    composed = {x["name"]: x["bars"] for x in s["sections"]}
    for name in targets:
        if name not in composed:
            sys.exit(f"no section {name!r} in {src}")
    fitted = copy.deepcopy(s)
    fitted["sections"] = [{"name": x["name"], "bars": targets.get(x["name"], x["bars"])} for x in s["sections"]]
    dropped = []

    def move(sec, bar):
        m = composed[sec]
        n = targets.get(sec, m)
        return bar + (n - m) if bar > m / 2 else bar

    for t in fitted["tracks"]:
        for sec, notes in list((t.get("notes") or {}).items()):
            if sec not in targets:
                continue
            m, n = composed[sec], targets[sec]
            kept = []
            for note in notes:
                bar, beat, dur = note[0], note[1], note[2]
                end = bar + (beat - 1 + dur) / bpb  # in bars, exclusive
                nb = move(sec, bar)
                if nb == bar and abs(end - (m + 1)) < 1e-6:
                    note = [bar, beat, dur + (n - m) * bpb] + note[3:]
                else:
                    note = [nb] + note[1:]
                if note[0] < 1 or note[0] > n:
                    dropped.append(f"{t['name']}/{sec} note at bar {bar}")
                    continue
                kept.append(note)
            t["notes"][sec] = kept
        for p in t.get("patterns") or []:
            sec = p.get("section")
            if sec not in targets:
                continue
            m, n = composed[sec], targets[sec]
            if "bars" in p:
                a, b = p["bars"]
                if a > m / 2:
                    a += n - m
                b = n if b == m else (b + (n - m) if b > m / 2 else b)
                a, b = max(1, a), min(n, b)
                if a > b:
                    dropped.append(f"{t['name']}/{sec} {p.get('type')} pattern")
                    p["bars"] = [1, 0]
                else:
                    p["bars"] = [a, b]
            if "start_bar" in p and p["start_bar"] > m / 2:
                p["start_bar"] += n - m
        for a in t.get("automation") or []:
            pts = []
            for pt in a.get("points", []):
                sec, bar = pt[0], pt[1]
                if sec in targets:
                    nb = move(sec, bar)
                    if nb < 1 or nb > targets[sec] + 1:
                        dropped.append(f"{t['name']} automation at {sec} bar {bar}")
                        continue
                    pt = [sec, nb] + pt[2:]
                pts.append(pt)
            a["points"] = pts
    fitted["_fitted_from"] = {"score": src, "sections": {k: [composed[k], v] for k, v in targets.items()}}
    json.dump(fitted, open(out, "w"), indent=1, ensure_ascii=False)
    total = sum(x["bars"] for x in fitted["sections"])
    print(f"{out}: {total} bars ({total * 60 * bpb / s['tempo']:.1f} s at {s['tempo']} BPM)")
    for k, v in targets.items():
        print(f"  {k:<10} {composed[k]} → {v} bars")
    for d in dropped:
        print(f"  dropped: {d}")


if __name__ == "__main__":
    main()
