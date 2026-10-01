#!/usr/bin/env python3
"""Fit a score to a film: change its sections' lengths, keep its music; or
write a film's bed (N3) and its two marks from its timeline.

usage: fit_score.py SCORE.json OUT.json name=bars [name=bars ...]
       fit_score.py --film FILM_DIR OUT.json

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
  - anything pushed before bar 1 or past bar N is dropped, and said so, and
    a repeat cut at the end is said so too.

It is a composer's rule of thumb, applied mechanically: the output is meant to
be listened to (or measured) before it is used.

**A film's bed** (--film). A film on the N3 bed is not a stretched score: its
music is written to its timeline (timeline.json: the lines, the demos and the
marks) from the generated scores (sound/n3.json for the bed's cast,
sound/bloom.json and sound/reach.json for the marks) and the bed's notes in
sound_defaults.py (`BED`, `LEAD`, `MARKS`, from www/brand/sound.json), as
SPEC.md sections 3, 4 and 9 lay it out:

  - the drone is held: one note of each pedal pitch from the entrance mark to
    the end of the exit mark, never struck again, fading in under the
    entrance and breathing once a cycle;
  - the entrance mark (Bloom) by time, its 60 BPM placed into the bed's
    66 BPM. Its last chord is the bed's bar 1: the notes it shares with the
    bed's first voicing stay on the marks' pad until their voice moves, and
    the bed's pad strikes only the voice the mark lacks, as the mark ends;
  - the cycle (two bars a chord) from bar 1 for as long as the film needs,
    each voice tied while its note stays, across the cycle's turn too, and
    struck again only when it moves; the burble from bar 2, its cell starting
    again at each chord;
  - each demo: the bed's pad stops at its line's end, the marks' pad holds
    the voicing under a demo until the bed comes back after the note-off, and
    the cycle resumes there, on the chord after the one the demo makes;
  - no chord change in the bar before the exit mark; the bed's voices and the
    burble end on its downbeat, where the exit mark (Reach) takes over;
  - the bed's sighs in the narration's gaps (`BED['placement']`): on each
    chord change that comes after a line has ended and leaves room for the
    whole sigh and its release before the next line starts, outside the
    demos' slots, the marks, and the bar before the exit mark. A chord change
    with no room gets no sigh. Where a sigh's note is one the pad is
    sounding, that voice rests from the sigh to the next chord change.

Every track carries its `role` (drone, pad, mpad, burble, melody, lead): the
part whose EQ, pan and level mix.py gives it. The score carries `_film`: the
entrance's film time (the score's beat 0), the chords and the sighs. Render it
with the score example; mix.py --score mixes its stems.
"""
import copy
import json
import math
import os
import sys

import sound_defaults

EPS = 1e-6


def fit(s, targets, src="score"):
    """The score `s` with each section in `targets` ({name: bars}) refitted.

    Returns the fitted score, what was dropped and what was cut at a section's
    end, each a list of lines to show. `s` is not changed."""
    bpb = s.get("beats_per_bar", 4)
    composed = {x["name"]: x["bars"] for x in s["sections"]}
    for name in targets:
        if name not in composed:
            raise ValueError(f"no section {name!r} in {src}")
    fitted = copy.deepcopy(s)
    fitted["sections"] = [{"name": x["name"], "bars": targets.get(x["name"], x["bars"])} for x in s["sections"]]
    dropped, cut = [], []

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
                extra += fit_phrase(t["name"], p, m, n, bpb, dropped, cut)
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
    return fitted, dropped, cut


def fit_phrase(track, p, m, n, bpb, dropped, cut):
    """Refit one `phrase` pattern (`notes` relative to `start_bar`, played
    `repeat` times every `every_bars`) from an M-bar section to N bars, in
    place. Returns the extra one-repeat phrases that hold a last, cut repeat.

    The score example places a phrase's notes without looking at the section's
    end, so a repeat that ran past it would sound over the start of the next
    section. A repeat that would is cut at the end: its notes that start
    before the end are kept and shortened to end there, and it is written as a
    phrase of its own, offset through its notes' bars (`start_bar` is a whole
    number; `every_bars` need not be). Each cut repeat is added to `cut`, and
    each composed repeat that loses every note to `dropped`."""
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
    extra, lost = [], []
    name = f"{track}/{sec} phrase from bar {start}"
    # Past `whole`: the repeats that reach the end (cut), and any composed
    # repeat that now starts after it (dropped). A repeat a stretch added that
    # has no note before the end is simply not written.
    for r in range(whole, max(reps, rep)):
        off = first + r * period
        kept = []
        for nb, beat, dur, *rest in notes:
            at = off + (nb - 1) * bpb + (beat - 1)
            if at >= end - EPS:
                continue
            kept.append([round(nb + r * every, 6), beat, round(min(dur, end - at), 6), *rest])
        if kept:
            extra.append(dict(p, repeat=1, notes=kept))
            cut.append(f"{name}: repeat {r + 1} cut at the end of bar {n} ({len(kept)} of {len(notes)} notes kept)")
        elif r < rep:
            lost.append(r + 1)
    if lost:
        which = f"repeat {lost[0]}" if len(lost) == 1 else f"repeats {lost[0]}-{lost[-1]}"
        dropped.append(f"{name}: {which} of {rep}, past bar {n}")
    return extra


# ─── a film's bed: N3 and the marks, written to the film's timeline ─────────

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
STEPS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
# Not a musical rule: the score's one section runs this many bars past the
# bar the exit mark ends in, as the reel's did, so the drone's release and the
# room ring out inside the section before the render's own tail.
SPARE_BARS = 1


def midi(p):
    if isinstance(p, int):
        return p
    acc = p[1:-1]
    return 12 * (int(p[-1]) + 1) + STEPS[p[0]] + (1 if acc == "#" else -1 if acc == "b" else 0)


def _track(template, name, role, notes, bpb):
    """A track of the film score: the template's cast (the generated score's
    preset, voices, trim, transpose, knobs), at unity: the mix levels each
    part on its stem. Its notes in time order (`bpb` beats a bar), the
    lowest first at the same time."""
    t = {"name": name, "role": role, "preset": template["preset"], "gain_db": 0.0}
    for k in ("voices", "trim_db", "transpose"):
        if k in template:
            t[k] = template[k]
    t["params"] = dict(template.get("params") or {})
    t["notes"] = {"s": sorted(notes, key=lambda n: ((n[0] - 1) * bpb + n[1], midi(n[3])))}
    return t


def _mark_notes(score):
    """A mark's notes by track, in seconds from its start: [(t, dur, pitch,
    vel)], with each track's fader (times in seconds)."""
    spb = 60.0 / score["tempo"]
    bpb = score.get("beats_per_bar", 4)
    sec = score["sections"][0]["name"]
    out = {}
    for t in score["tracks"]:
        notes = [(((bar - 1) * bpb + beat - 1) * spb, dur * spb, p, v) for bar, beat, dur, p, v in t["notes"][sec]]
        fader = [(((bar - 1) * bpb + beat - 1) * spb, db) for _, bar, beat, db in t.get("fader") or []]
        out[t["name"]] = {"track": t, "notes": notes, "fader": fader}
    return out


def film_score(tl, bed, bloom, reach):
    """The film's music, written to its timeline `tl`: (score, what was
    placed). `bed`, `bloom` and `reach` are the generated scores
    (sound/n3.json, sound/bloom.json, sound/reach.json)."""
    D = sound_defaults
    tempo, B, LEAD, M = D.TEMPO, D.BED, D.LEAD, D.MARKS
    spb = 60.0 / tempo["bpm"]
    bpb = tempo["beats_per_bar"]
    per = tempo["bars_per_chord"] * bpb
    cyc = tempo["cycle_bars"] * bpb
    marks = tl.get("marks") or {}
    if marks.get("entrance") is None:
        raise ValueError("the timeline has no entrance mark: the film is not on the N3 bed (script `music.bed`)")
    te, tx = marks["entrance"], marks.get("exit")
    length = M["length_s"]
    into = M["into_the_bed"]

    def b(t):  # film seconds to the score's beats
        return (t - te) / spb

    def pos(beat):
        return int(beat // bpb) + 1, round(beat % bpb + 1, 6)

    def note(beat, dur, p, vel):
        bar, bt = pos(beat)
        return [bar, bt, round(dur, 6), p, round(vel, 3)]

    tracks = {t["name"]: t for t in bed["tracks"]}
    drone_t, pad_t, burble_t = tracks["drone"], tracks["pad"], tracks["burble"]
    sigh_t = [t for t in bed["tracks"] if t["name"].startswith("mel")]
    pad_vel = pad_t["notes"]["s"][0][4]
    m_in, m_out = _mark_notes(bloom), _mark_notes(reach)

    B1 = b(te + into["bed_bar_1_at_s"])
    XB = b(tx) if tx is not None else b(tl["duration"])
    END = b(tx + length) if tx is not None else XB
    hold = M["hold_bars"] * bpb
    under = B["under_demo"]
    up = D.LADDER["bed_under_demo_up_s"]
    cycle = B["cycle"]

    # The cycle, in runs between the demos: each demo stops the bed's pad at
    # its line's end, and the cycle resumes after it on the chord after the
    # one the demo makes. No chord is struck in the bar before the exit mark,
    # nor so close before a demo's pause that it could not bloom: the chord
    # before it holds. A bed that would come back inside the bar before the
    # exit does not: the voicing under the demo carries on to the exit.
    demos = sorted(tl.get("demos") or [], key=lambda d: d["t0"])
    before = under["hold_before_s"] / spb
    resume = (cycle.index(under["counts_as"]) + 1) % len(cycle)
    runs, start, first = [], B1, 0
    under_to = []  # where each demo's voicing (and the burble's cell under it) ends
    for i, d in enumerate(demos):
        runs.append((start, b(d["pause"]), first, True))
        back = b(d["off"] + up)
        nxt = b(demos[i + 1]["pause"]) if i + 1 < len(demos) else None
        if back >= XB - hold - EPS:
            back = XB  # it would come back in the bar before the exit: carry on to it
        elif nxt is not None and nxt - back < before - EPS:
            back = nxt  # it would come back too briefly to bloom: carry on to the next demo
        under_to.append(back)
        start, first = back, resume
    runs.append((start, XB, first, False))
    plan = []  # per run: [(from, to, chord)]
    for s0, s1, i, to_demo in runs:
        spans, t = [], s0
        while t < s1 - EPS:
            nxt = t + per
            if nxt >= s1 - EPS or nxt > XB - hold + EPS or (to_demo and nxt > s1 - before + EPS):
                spans.append((t, s1, cycle[i % len(cycle)]))
                break
            spans.append((t, nxt, cycle[i % len(cycle)]))
            t, i = nxt, i + 1
        plan.append(spans)
    changes = sorted(a for spans in plan for a, _, _ in spans)

    def voices(spans):
        """Each voice over a run, low to high: tied while it stays, struck
        again when it moves. [[from, to, pitch]] per voice."""
        lines = [[] for _ in range(max(len(v) for v in B["voicings"].values()))]
        for a, z, ch in spans:
            for v, p in enumerate(B["voicings"][ch]):
                if lines[v] and lines[v][-1][2] == p and abs(lines[v][-1][1] - a) < EPS:
                    lines[v][-1][1] = z
                else:
                    lines[v].append([a, z, p])
        return lines

    pad, mpad_in = [], []
    for k, spans in enumerate(plan):
        if not spans:
            continue
        lines = voices(spans)
        if k == 0:
            # Into the bed: the mark's last chord is bar 1. Its notes that the
            # bed's first voicing shares stay on the marks' pad until their
            # voice moves; the bed's pad strikes the rest as the mark ends.
            last = {midi(p): (t0, v) for t0, d, p, v in m_in["pad"]["notes"] if abs(t0 + d - length) < EPS}
            held = set()
            for line in lines:
                a, z, p = line[0]
                if abs(a - B1) > EPS:
                    continue
                if midi(p) in last:
                    t0, v = last[midi(p)]
                    mpad_in.append(note(b(te + t0), z - b(te + t0), p, v))
                    held.add(midi(p))
                    line.pop(0)
                else:
                    line[0][0] = b(te + into["bed_e4_at_s"])
            for t0, d, p, v in m_in["pad"]["notes"]:
                if not (abs(t0 + d - length) < EPS and midi(p) in held):
                    mpad_in.append(note(b(te + t0), d / spb, p, v))
        for line in lines:
            pad += [[a, z, p] for a, z, p in line if z - a > EPS]
    for d, z in zip(demos, under_to):
        a = b(d["pause"])
        mpad_in += [note(a, z - a, p, pad_vel) for p in under["voicing"]]

    # The burble: from bar 2; under a demo, the cell of the chord it makes.
    bu = B["burble"]
    b_start = B1 + (into["burble_enters_bar"] - 1) * bpb
    spans = [(max(a, b_start), z, ch) for a, z, ch in plan[0] if z > b_start + EPS]
    for d, z, later in zip(demos, under_to, plan[1:]):
        spans.append((b(d["pause"]), z, under["counts_as"]))
        spans += later
    burble, k = [], 0
    vel = bu["velocity"]
    for a, z, ch in spans:
        j, t = 0, a
        while t < z - 1e-9:
            cell = bu["cells"][ch]
            burble.append(note(t, min(bu["held_beats"], z - t), cell[j % len(cell)],
                               vel["base"] * (1 + vel["depth"] * math.sin(2 * math.pi * k / vel["period_notes"]))))
            j, k, t = j + 1, k + 1, t + bu["step_beats"]

    # The sighs, in the narration's gaps.
    pl = B["placement"]
    shape = B["shape_beats"]
    legato = LEAD["legato_s"] / spb
    sigh_s = (shape[0] + shape[1]) * spb + LEAD["tail_s"]
    spoken = sorted((l["t0"], l["t1"]) for l in tl["lines"])
    slots = [(d["pause"], d["off"] + up) for d in demos]
    limit = tx - pl["bars_before_exit"] * bpb * spb if tx is not None else tl["duration"]
    chord_at = {a: ch for spans in plan for a, _, ch in spans}
    sighs = []
    for a in changes:
        t0 = te + a * spb
        t1 = t0 + sigh_s
        if t0 < te + length - EPS or t1 > limit + EPS:
            continue
        # After a line has ended, and clear of every line.
        if not any(l1 + pl["after_line_s"] <= t0 + EPS for _, l1 in spoken):
            continue
        if any(not (l1 + pl["after_line_s"] <= t0 + EPS or l0 - pl["before_line_s"] >= t1 - EPS) for l0, l1 in spoken):
            continue
        if any(s0 < t1 and s1 > t0 for s0, s1 in slots):
            continue
        sighs.append((a, chord_at[a]))
    melody = []
    v1, v2 = (t["notes"]["s"][0][4] for t in sigh_t[:2])
    for n, (a, ch) in enumerate(sighs, 1):
        p1, p2 = B["sighs"][ch]
        one = _track(sigh_t[0], f"sigh{n}a", "melody", [note(a, shape[0] + legato, p1, v1)], bpb)
        two = _track(sigh_t[1], f"sigh{n}b", "melody", [note(a + shape[0], shape[1], p2, v2)], bpb)
        if midi(p1) != midi(p2):
            two["pitch_drop"] = {"semis": float(midi(p1) - midi(p2)), **LEAD["bend"]}
        sw = LEAD["swell"]
        two["fader"] = [["s", *pos(a + shape[0]), float(sw["from_db"])],
                        ["s", *pos(a + shape[0] + sw["bed_beats"]), float(sw["to_db"])]]
        melody += [one, two]
        # Where it would double the pad, that voice rests to the next change.
        nxt = next((c for c in changes if c > a + EPS), None)
        kept = []
        for x in pad:
            if midi(x[2]) in (midi(p1), midi(p2)) and x[0] < a + shape[0] + shape[1] - EPS and x[1] > a + EPS:
                if x[0] < a - EPS:
                    kept.append([x[0], a, x[2]])
                if nxt is not None and x[1] > nxt + EPS:
                    kept.append([nxt, x[1], x[2]])
            else:
                kept.append(x)
        pad = kept

    # The drone: held from the entrance to the end of the exit mark, fading
    # in under the entrance and breathing once a cycle, lowest at its start.
    breath = sorted({p[3] for a in drone_t.get("automation") or [] for p in a["points"]})
    low, high = breath[0], breath[-1]
    pts, c = [], B1
    while c <= END + cyc:
        pts += [(c, low), (c + cyc / 2, high)]
        c += cyc
    auto = []
    for x, v in sorted(pts):
        if x + cyc / 2 < 0:
            continue
        x = max(0.0, x)
        if auto and abs(auto[-1][0] - x) < 1e-9:
            continue
        auto.append((x, v))
    fade = M["drone_fade_in"]
    drone = _track(drone_t, "drone", "drone", [note(0, END, p, v) for _, _, _, p, v in drone_t["notes"]["s"]], bpb)
    drone["automation"] = [{"param": drone_t["automation"][0]["param"], "points": [["s", *pos(x), v] for x, v in auto]}]
    drone["fader"] = [["s", *pos(0), float(fade["from_db"])], ["s", *pos(b(te + fade["over_s"])), 0.0]]

    def lead(prefix, m, t_mark):
        out = []
        names = sorted((n for n in m if n.startswith("mel")), key=lambda n: m[n]["notes"][0][0])
        for k, name in enumerate(names, 1):
            x = m[name]
            t = _track(x["track"], f"{prefix}{k}", "lead",
                       [note(b(t_mark + t0), d / spb, p, v) for t0, d, p, v in x["notes"]], bpb)
            if x["track"].get("pitch_drop"):
                t["pitch_drop"] = dict(x["track"]["pitch_drop"])
            if x["fader"]:
                t["fader"] = [["s", *pos(b(t_mark + s)), float(db)] for s, db in x["fader"]]
            out.append(t)
        return out

    out_tracks = [drone, _track(m_in["pad"]["track"], "epad", "mpad", mpad_in, bpb),
                  _track(pad_t, "pad", "pad", [note(a, z - a, p, pad_vel) for a, z, p in pad], bpb),
                  _track(burble_t, "burble", "burble", burble, bpb)]
    if tx is not None:
        out_tracks.append(_track(m_out["pad"]["track"], "xpad", "mpad",
                                 [note(b(tx + t0), d / spb, p, v) for t0, d, p, v in m_out["pad"]["notes"]], bpb))
    out_tracks += lead("elead", m_in, te)
    if tx is not None:
        out_tracks += lead("xlead", m_out, tx)
    out_tracks += melody

    score = {
        "title": bed["title"],
        "tempo": tempo["bpm"],
        "sample_rate": bed.get("sample_rate", 48000),
        "beats_per_bar": bpb,
        "seed": bed.get("seed", 0),
        "render": dict(bed["render"]),
        "master": dict(bed["master"]),
        "sections": [{"name": "s", "bars": int(math.ceil(END / bpb)) + SPARE_BARS}],
        "_film": {
            "film": tl.get("film"),
            "t0": te,
            "exit": tx,
            "chords": [[round(te + a * spb, 3), ch] for spans in plan for a, _, ch in spans],
            "sighs": [[round(te + a * spb, 3), ch] for a, ch in sighs],
        },
        "tracks": out_tracks,
    }
    return score, {"chords": score["_film"]["chords"], "sighs": score["_film"]["sighs"]}


def film_main(argv):
    if len(argv) != 2:
        sys.exit("usage: fit_score.py --film FILM_DIR OUT.json")
    film_dir, out = argv
    with open(os.path.join(film_dir, "timeline.json"), encoding="utf-8") as f:
        tl = json.load(f)
    scores = {}
    for k in ("bed", "bloom", "reach"):
        with open(os.path.join(ROOT, sound_defaults.SCORES[k]["score"]), encoding="utf-8") as f:
            scores[k] = json.load(f)
    try:
        score, placed = film_score(tl, scores["bed"], scores["bloom"], scores["reach"])
    except ValueError as e:
        sys.exit(f"fit_score.py: {e}")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(score, f, indent=1, ensure_ascii=False)
    bars = score["sections"][0]["bars"]
    n = len(placed["sighs"])
    print(f"{out}: {bars} bars at {score['tempo']} BPM from {score['_film']['t0']:.2f} s, "
          f"{len(placed['chords'])} chords, {n} sigh{'s' if n != 1 else ''}")
    for t, ch in placed["sighs"]:
        print(f"  sigh on {ch} at {t:.2f} s")


def main():
    if sys.argv[1:2] == ["--film"]:
        return film_main(sys.argv[2:])
    src, out = sys.argv[1], sys.argv[2]
    targets = dict((a.split("=")[0], int(a.split("=")[1])) for a in sys.argv[3:])
    s = json.load(open(src))
    try:
        fitted, dropped, cut = fit(s, targets, src)
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
    for c in cut:
        print(f"  cut: {c}")


if __name__ == "__main__":
    main()
