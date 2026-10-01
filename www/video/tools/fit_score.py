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
  - a phrase (a pattern repeated every few bars) that ran to the section's end
    repeats until the new end. Where the new end falls inside a repeat, that
    last repeat plays as far as the end and its notes are cut there, and a
    phrase in a shortened section is cut the same way. Without this a phrase
    kept its composed repeats, so a stretched bed fell silent after its
    written length (16 bars of Study, about 46 s);
  - anything pushed before bar 1 or past bar N is dropped, and said so.

It is a composer's rule of thumb, applied mechanically: the output is meant to
be listened to (or measured) before it is used.
"""
import copy
import json
import math
import sys

EPS = 1e-6


def fit(s, targets, src="score"):
    """The score `s` with each section in `targets` ({name: bars}) refitted.

    Returns the fitted score and a list of what was dropped. `s` is not
    changed."""
    bpb = s.get("beats_per_bar", 4)
    composed = {x["name"]: x["bars"] for x in s["sections"]}
    for name in targets:
        if name not in composed:
            raise ValueError(f"no section {name!r} in {src}")
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
                if nb == bar and abs(end - (m + 1)) < EPS:
                    note = [bar, beat, dur + (n - m) * bpb] + note[3:]
                else:
                    note = [nb] + note[1:]
                if note[0] < 1 or note[0] > n:
                    dropped.append(f"{t['name']}/{sec} note at bar {bar}")
                    continue
                kept.append(note)
            t["notes"][sec] = kept
        extra = []
        for p in t.get("patterns") or []:
            sec = p.get("section")
            if sec not in targets:
                continue
            m, n = composed[sec], targets[sec]
            if p.get("type") == "phrase":
                extra += fit_phrase(t["name"], p, m, n, bpb, dropped)
                continue
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
        if extra:
            t["patterns"] = t["patterns"] + extra
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
    return fitted, dropped


def fit_phrase(track, p, m, n, bpb, dropped):
    """Refit one `phrase` pattern (`notes` relative to `start_bar`, played
    `repeat` times every `every_bars`) from an M-bar section to N bars, in
    place. Returns the extra one-repeat phrases that hold a last, cut repeat.

    The score example places a phrase's notes without looking at the section's
    end, so a repeat that ran past it would sound in the next section (or, in a
    loop, wrap onto its downbeat). A repeat that would is cut at the end: its
    notes that start before the end are kept and shortened to end there, and
    it is written as a phrase of its own, offset through its notes' bars
    (`start_bar` is a whole number; `every_bars` need not be)."""
    sec = p["section"]
    start = p.get("start_bar", 1)
    rep = p.get("repeat", 1)
    every = p.get("every_bars", 4)
    notes = p.get("notes") or []
    if not notes or rep < 1:
        return []
    if start > m / 2:
        # Anchored to the section's end: it moves with it, whole.
        start += n - m
        if start < 1:
            dropped.append(f"{track}/{sec} phrase")
            p["repeat"] = 0
            return []
        p["start_bar"] = start
        return []
    ran_to_end = start + rep * every - 1 >= m - EPS
    first = (start - 1) * bpb  # beats from the section's start
    period = every * bpb
    end = n * bpb
    span = max((nb - 1) * bpb + (beat - 1) + dur for nb, beat, dur, *_ in notes)
    if ran_to_end:
        # Every repeat that starts before the new end.
        reps = max(0, math.ceil((end - first) / period - EPS))
    else:
        reps = rep
    whole = 0
    while whole < reps and first + whole * period + span <= end + EPS:
        whole += 1
    p["repeat"] = whole
    extra = []
    for r in range(whole, reps):
        off = first + r * period
        kept = []
        for nb, beat, dur, *rest in notes:
            at = off + (nb - 1) * bpb + (beat - 1)
            if at >= end - EPS:
                continue
            kept.append([round(nb + r * every, 6), beat, round(min(dur, end - at), 6), *rest])
        if kept:
            extra.append(dict(p, repeat=1, notes=kept))
    return extra


def main():
    src, out = sys.argv[1], sys.argv[2]
    targets = dict((a.split("=")[0], int(a.split("=")[1])) for a in sys.argv[3:])
    s = json.load(open(src))
    try:
        fitted, dropped = fit(s, targets, src)
    except ValueError as e:
        sys.exit(str(e))
    bpb = s.get("beats_per_bar", 4)
    composed = {x["name"]: x["bars"] for x in s["sections"]}
    json.dump(fitted, open(out, "w"), indent=1, ensure_ascii=False)
    total = sum(x["bars"] for x in fitted["sections"])
    print(f"{out}: {total} bars ({total * 60 * bpb / s['tempo']:.1f} s at {s['tempo']} BPM)")
    for k, v in targets.items():
        print(f"  {k:<10} {composed[k]} → {v} bars")
    for d in dropped:
        print(f"  dropped: {d}")


if __name__ == "__main__":
    main()
