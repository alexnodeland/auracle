#!/usr/bin/env python3
"""fit_score.py: a fitted bed fills its section, and stops at its end; and a
film's bed, written to its timeline, is the approved reel's music on the
reel's timeline, holds its drone, keeps its ties across the cycle, makes way
for each demo, and sighs only in the narration's gaps.

    python3 www/video/tools/test_fit_score.py      (run by `make dev-check`)

The notes are laid out here the way the score example
(crates/auracle-wasm/examples/score.rs) places them: a phrase's note sounds at
start_bar + r × every_bars + (bar − 1), and nothing stops a note at its
section's end. Python 3 standard library only.
"""

import copy
import io
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fit_score  # noqa: E402
import sound_defaults  # noqa: E402

STUDY = os.path.join(HERE, "..", "sound", "study.json")


def study():
    with open(STUDY, encoding="utf-8") as f:
        return json.load(f)


def notes_of(score, track, section):
    """Every note a track plays in a section from its `notes` and `phrase`
    patterns, as (start, end) in beats from the section's start."""
    bpb = score.get("beats_per_bar", 4)
    t = next(x for x in score["tracks"] if x["name"] == track)
    out = []
    for bar, beat, dur, *_ in (t.get("notes") or {}).get(section, []):
        s = (bar - 1) * bpb + (beat - 1)
        out.append((s, s + dur))
    for p in t.get("patterns") or []:
        if p.get("type") != "phrase" or p["section"] != section:
            continue
        for r in range(p.get("repeat", 1)):
            for bar, beat, dur, *_ in p["notes"]:
                b = p.get("start_bar", 1) + r * p.get("every_bars", 4) + (bar - 1)
                s = (b - 1) * bpb + (beat - 1)
                out.append((s, s + dur))
    return sorted(out)


def gaps(notes, end):
    """The stretches of [0, end) where no note sounds, as (from, to)."""
    out, cur = [], 0.0
    for s, e in notes:
        if s > cur + 1e-9:
            out.append((cur, s))
        cur = max(cur, e)
    if cur < end - 1e-9:
        out.append((cur, end))
    return out


class AFittedBedFillsItsSection(unittest.TestCase):
    # The longest sections the films ask for today: view-patch's loop_a and
    # view-evolve's loop_b. Neither is a whole number of Study's 4- or 8-bar
    # phrases, so each ends inside a repeat.
    TARGETS = {"loop_a": 65, "loop_b": 52}

    def setUp(self):
        self.score, self.dropped, self.cut = fit_score.fit(study(), self.TARGETS)

    def test_the_pad_sounds_from_the_first_beat_to_the_last(self):
        for sec, bars in self.TARGETS.items():
            end = bars * 4
            notes = notes_of(self.score, "pad", sec)
            self.assertEqual(gaps(notes, end), [], f"pad in {sec}")

    def test_pad_and_pluck_reach_the_last_bar_and_stop_at_the_end(self):
        for sec, bars in self.TARGETS.items():
            end = bars * 4
            for track in ("pad", "pluck"):
                notes = notes_of(self.score, track, sec)
                self.assertTrue(any(s < end and e > end - 4 for s, e in notes),
                                f"{track} in {sec}: nothing sounds in bar {bars}")
                self.assertTrue(any(s >= end - 8 for s, _ in notes),
                                f"{track} in {sec}: no note starts in the last two bars")
                self.assertLessEqual(max(e for _, e in notes), end + 1e-9,
                                     f"{track} in {sec}: a note runs past bar {bars}")

    def test_the_repeats_are_scaled_where_they_used_to_stop_at_bar_16(self):
        # What the old fit did: the phrases kept their composed repeats.
        old = copy.deepcopy(study())
        for sec in self.TARGETS:
            self.assertEqual(max(e for _, e in notes_of(old, "pad", sec)), 16 * 4)
        # And now the repeats are scaled.
        pad = next(t for t in self.score["tracks"] if t["name"] == "pad")
        whole = {p["section"]: p["repeat"] for p in pad["patterns"] if p["repeat"] > 1}
        self.assertEqual(whole, {"loop_a": 16, "loop_b": 13})

    def test_nothing_is_dropped_and_each_last_repeat_is_reported_cut(self):
        self.assertEqual(self.dropped, [])
        # 52 bars is 13 whole repeats of the pad's 4, so only the pluck's
        # 8-bar phrase is cut there.
        self.assertEqual(self.cut, [
            "pad/loop_a phrase from bar 1: repeat 17 cut at the end of bar 65 (5 of 11 notes kept)",
            "pluck/loop_a phrase from bar 1: repeat 9 cut at the end of bar 65 (4 of 37 notes kept)",
            "pluck/loop_b phrase from bar 1: repeat 7 cut at the end of bar 52 (17 of 37 notes kept)",
        ])


class AShortenedSectionStopsAtItsEnd(unittest.TestCase):
    def test_no_note_runs_past_a_shortened_section(self):
        # circuit and taste fit loop_a to 13 bars, tour loop_b to 7.
        score, dropped, _ = fit_score.fit(study(), {"loop_a": 13, "loop_b": 7})
        for sec, bars in (("loop_a", 13), ("loop_b", 7)):
            end = bars * 4
            for track in ("pad", "pluck"):
                notes = notes_of(score, track, sec)
                self.assertLessEqual(max(e for _, e in notes), end + 1e-9, f"{track} in {sec}")
            self.assertEqual(gaps(notes_of(score, "pad", sec), end), [], f"pad in {sec}")
        self.assertEqual(dropped, [
            "pad/loop_b phrase from bar 1: repeats 3-4 of 4, past bar 7",
            "pluck/loop_b phrase from bar 1: repeat 2 of 2, past bar 7",
        ])


class TheComposedLength(unittest.TestCase):
    def test_fitting_to_the_composed_length_changes_no_note(self):
        s = study()
        fitted, dropped, cut = fit_score.fit(s, {"loop_a": 16, "loop_b": 16})
        self.assertEqual(fitted["tracks"], s["tracks"])
        self.assertEqual((dropped, cut), ([], []))

    def test_the_input_is_not_changed(self):
        s = study()
        before = json.dumps(s)
        fit_score.fit(s, {"loop_a": 40})
        self.assertEqual(json.dumps(s), before)


class APhrase(unittest.TestCase):
    def score(self, phrase):
        return {
            "tempo": 60, "beats_per_bar": 4,
            "sections": [{"name": "s", "bars": 8}],
            "tracks": [{"name": "t", "preset": "x", "patterns": [dict({"type": "phrase", "section": "s"}, **phrase)]}],
        }

    def test_a_repeat_cut_by_the_end_keeps_what_starts_before_it_shortened_to_fit(self):
        s = self.score({"start_bar": 1, "repeat": 4, "every_bars": 2,
                        "notes": [[1, 1, 8, "C4", 0.5], [2, 3, 1, "E4", 0.5]]})
        fitted, dropped, cut = fit_score.fit(s, {"s": 11})
        ps = fitted["tracks"][0]["patterns"]
        self.assertEqual(ps[0]["repeat"], 5)
        self.assertEqual([p["notes"] for p in ps[1:]], [[[11, 1, 4, "C4", 0.5]]])
        self.assertEqual(max(e for _, e in notes_of(fitted, "t", "s")), 44)
        self.assertEqual(dropped, [])
        self.assertEqual(cut, ["t/s phrase from bar 1: repeat 6 cut at the end of bar 11 (1 of 2 notes kept)"])

    def test_a_repeat_cut_at_fractional_bars_keeps_a_whole_start_bar(self):
        # Every 2.5 bars, a note held 8 beats: in 13 bars the sixth repeat
        # starts at bar 13.5 and must be cut to the 2 beats that are left.
        s = self.score({"start_bar": 1, "repeat": 4, "every_bars": 2.5,
                        "notes": [[1, 1, 8, "C4", 0.5]]})
        s["sections"][0]["bars"] = 10
        fitted, _, cut = fit_score.fit(s, {"s": 13})
        ps = fitted["tracks"][0]["patterns"]
        self.assertEqual([(p["start_bar"], p["repeat"]) for p in ps], [(1, 5), (1, 1)])
        for p in ps:
            self.assertIsInstance(p["start_bar"], int)
        self.assertEqual(ps[1]["notes"], [[13.5, 1, 2, "C4", 0.5]])
        self.assertEqual(notes_of(fitted, "t", "s"), [(0, 8), (10, 18), (20, 28), (30, 38), (40, 48), (50, 52)])
        self.assertEqual(len(cut), 1)

    def test_a_phrase_that_starts_after_a_shortened_end_is_dropped_and_said_so(self):
        # A 16-bar section with a phrase from bar 8, fitted to 6 bars.
        s = self.score({"start_bar": 8, "repeat": 2, "every_bars": 2, "notes": [[1, 1, 4, "C4", 0.5]]})
        s["sections"][0]["bars"] = 16
        fitted, dropped, cut = fit_score.fit(s, {"s": 6})
        self.assertEqual(fitted["tracks"][0]["patterns"][0]["repeat"], 0)
        self.assertEqual(notes_of(fitted, "t", "s"), [])
        self.assertEqual(dropped, ["t/s phrase from bar 8: repeats 1-2 of 2, past bar 6"])
        self.assertEqual(cut, [])

    def test_a_phrase_anchored_to_the_end_that_falls_before_bar_1_is_dropped_and_said_so(self):
        s = self.score({"start_bar": 7, "repeat": 1, "every_bars": 2, "notes": [[1, 1, 8, "C4", 0.5]]})
        fitted, dropped, _ = fit_score.fit(s, {"s": 1})
        self.assertEqual(fitted["tracks"][0]["patterns"][0]["repeat"], 0)
        self.assertEqual(dropped, ["t/s phrase"])

    def test_a_phrase_anchored_to_the_end_moves_with_it(self):
        s = self.score({"start_bar": 7, "repeat": 1, "every_bars": 2, "notes": [[1, 1, 8, "C4", 0.5]]})
        fitted, _, _ = fit_score.fit(s, {"s": 12})
        self.assertEqual(fitted["tracks"][0]["patterns"][0]["start_bar"], 11)
        self.assertEqual(fitted["tracks"][0]["patterns"][0]["repeat"], 1)

    def test_a_phrase_that_ends_early_is_left_alone(self):
        s = self.score({"start_bar": 1, "repeat": 1, "every_bars": 2, "notes": [[1, 1, 4, "C4", 0.5]]})
        fitted, _, _ = fit_score.fit(s, {"s": 30})
        self.assertEqual(fitted["tracks"][0]["patterns"], s["tracks"][0]["patterns"])


# ─── a film's bed (fit_score.py --film) ─────────────────────────────────────

ROOT = os.path.normpath(os.path.join(HERE, "..", "..", ".."))
SPB = 60 / 66
BAR = 4 * SPB


def generated(name):
    with open(os.path.join(ROOT, sound_defaults.SCORES[name]["score"]), encoding="utf-8") as f:
        return json.load(f)


def film(tl):
    return fit_score.film_score(tl, generated("bed"), generated("bloom"), generated("reach"))


def at(n, bpb=4):
    return (n[0] - 1) * bpb + n[1] - 1


def notes(score, role=None, name=None):
    """(start, end, pitch) in seconds of film time, for a role's or a track's notes."""
    t0 = score["_film"]["at"]
    out = []
    for t in score["tracks"]:
        if (role and t["role"] != role) or (name and t["name"] != name):
            continue
        for n in t["notes"]["s"]:
            out.append((t0 + at(n) * SPB, t0 + (at(n) + n[2]) * SPB, n[3]))
    return sorted(out)


def a_film(lines, demos=(), entrance=0.0, exit_after=1.75):
    """A timeline: lines [(t0, t1)], demos [(line end, play, tail)], the marks
    around them as timeline.py places them."""
    tl = {"film": "f", "lines": [{"id": f"l{i}", "text": ".", "t0": a, "t1": b} for i, (a, b) in enumerate(lines)],
          "marks": {"entrance": entrance, "exit": lines[-1][1] + exit_after}}
    tl["demos"] = [{"line": "l", "id": f"d{i}", "pause": p, "t0": p + 0.7, "off": p + 0.7 + play, "tail_s": tail,
                    "next": p + 0.7 + play + tail + 0.8} for i, (p, play, tail) in enumerate(demos)]
    tl["duration"] = tl["marks"]["exit"] + 4.5 + 2.6
    return tl


def sigh_length():
    shape = sound_defaults.BED["shape_beats"]
    return (shape[0] + shape[1]) * SPB + sound_defaults.LEAD["tail_s"]


def with_the_bed_first(reel):
    """The approved reel as it plays under sound.json's `form.bed_first`
    (chosen on 2026-10-07): the bed's drone from the film's first frame and
    Bloom `entrance_after_beats` later, the score starting `preroll_bars`
    before the film (2026-10-08) so the drone's attack is over by its first
    frame. Every note, fader and breath moves that many beats later; the
    drone starts at the score's beat 0 and holds that much longer, fading in
    over `marks.drone_fade_in` from the film's start; the score is the
    pre-roll's bars longer."""
    first = sound_defaults.MARKS["bed_first"]
    pre = first["preroll_bars"] * 4
    lead = first["entrance_after_beats"] + pre
    out = copy.deepcopy(reel)
    out["sections"] = [{**s, "bars": s["bars"] + first["preroll_bars"]} if i == 0 else s for i, s in enumerate(out["sections"])]

    def moved(bar, beat):
        b = (bar - 1) * 4 + beat - 1 + lead
        return [int(b // 4) + 1, round(b % 4 + 1, 6)]

    for t in out["tracks"]:
        if t["name"] == "drone":
            t["notes"]["s"] = [[1, 1, round(n[2] + lead, 6), *n[3:]] for n in t["notes"]["s"]]
            fade = sound_defaults.MARKS["drone_fade_in"]
            end = pre + fade["over_s"] / SPB
            t["fader"] = [["s", pre // 4 + 1, 1, float(fade["from_db"])], ["s", int(end // 4) + 1, round(end % 4 + 1, 6), 0.0]]
        else:
            t["notes"]["s"] = [[*moved(n[0], n[1]), *n[2:]] for n in t["notes"]["s"]]
            if t.get("fader"):
                t["fader"] = [[f[0], *moved(f[1], f[2]), f[3]] for f in t["fader"]]
        for a in t.get("automation") or []:
            a["points"] = [[p[0], *moved(p[1], p[2]), p[3]] for p in a["points"]]
    return out


class TheReelsMusicComesBack(unittest.TestCase):
    """Written to the final reel's timeline, the film's bed is the approved
    reel's music (docs/notes/sound-2026-09/scores/reel.json), note for note,
    with the bed first (`with_the_bed_first`): Bloom's chord held into bar 1,
    the pad re-voiced for the demo, G6/F after it and held to Reach, the
    burble, the held drone and both marks."""

    def test_every_track_but_the_demo(self):
        import test_timeline
        import timeline

        tl, _ = timeline.lay_out(test_timeline.reel_script(1.12), test_timeline.REEL_DURS)
        score, placed = film(tl)
        with open(os.path.join(ROOT, "docs/notes/sound-2026-09/scores/reel.json"), encoding="utf-8") as f:
            reel = with_the_bed_first(json.load(f))
        want = {t["name"]: t for t in reel["tracks"] if t["name"] != "demo"}
        got = {t["name"]: t for t in score["tracks"]}
        self.assertEqual(sorted(got), sorted(want))
        self.assertEqual(score["sections"], reel["sections"])
        for name, w in want.items():
            g = got[name]
            key = lambda n: (at(n), n[3])  # noqa: E731
            gn, wn = sorted(g["notes"]["s"], key=key), sorted(w["notes"]["s"], key=key)
            self.assertEqual(len(gn), len(wn), name)
            for a, b in zip(gn, wn):
                self.assertAlmostEqual(at(a), at(b), places=6, msg=name)
                self.assertAlmostEqual(a[2], b[2], places=6, msg=name)
                self.assertEqual((a[3], a[4]), (b[3], b[4]), name)
            for k in ("preset", "voices", "trim_db", "transpose", "params", "pitch_drop", "fader", "automation"):
                self.assertEqual(g.get(k), w.get(k), f"{name} {k}")
        self.assertEqual(placed["sighs"], [], "the reel's narration leaves no gap that holds a sigh")
        self.assertEqual([ch for _, ch in placed["chords"]], ["Fmaj9", "G6/F", "Bbmaj7/F", "G6/F"])


class TheDroneIsHeld(unittest.TestCase):
    def test_one_note_a_pitch_from_the_beds_start_to_the_exits_end_breathing_once_a_cycle(self):
        lead = sound_defaults.MARKS["bed_first"]["entrance_after_s"]
        lines = [(lead + 6.25 + 12 * k, lead + 6.25 + 12 * k + 9) for k in range(10)]
        score, _ = film(a_film(lines, entrance=lead))
        drone = next(t for t in score["tracks"] if t["name"] == "drone")
        exit_end = score["_film"]["exit"] + sound_defaults.MARKS["length_s"]
        # The bed sounds first, from the film's start, the entrance its lead
        # later; the score starts its pre-roll before the film, where the
        # drone is struck, so its attack is over by the first frame.
        pre = sound_defaults.MARKS["bed_first"]["preroll_s"]
        self.assertAlmostEqual(score["_film"]["bed"], 0.0, places=3)
        self.assertAlmostEqual(score["_film"]["at"], -pre, places=3)
        self.assertAlmostEqual(score["_film"]["t0"], lead, places=6)
        self.assertEqual([n[3] for n in drone["notes"]["s"]], sound_defaults.BED["pedal"])
        for n in drone["notes"]["s"]:
            self.assertEqual(at(n), 0)
            self.assertAlmostEqual(n[2] * SPB, exit_end + pre, places=4)
        pts = drone["automation"][0]["points"]
        lows = [at(p[1:3]) for p in pts if p[3] == min(q[3] for q in pts)]
        b1 = (pre + lead + sound_defaults.MARKS["into_the_bed"]["bed_bar_1_at_s"]) / SPB
        self.assertEqual([round(x - b1, 4) + 0 for x in lows[:4] if x >= b1 - 1e-4][:3], [0, 32, 64], "lowest at each cycle's start")
        # Faded in from the film's first frame, not from the pre-roll.
        fade = sound_defaults.MARKS["drone_fade_in"]
        self.assertEqual(drone["fader"][0][3], fade["from_db"])
        self.assertAlmostEqual(at(drone["fader"][0][1:3]) * SPB, pre, places=4)
        self.assertAlmostEqual(at(drone["fader"][1][1:3]) * SPB, pre + fade["over_s"], places=4)


class TheCycleKeepsItsTies(unittest.TestCase):
    def test_a_voice_that_stays_is_held_across_the_cycles_turn_and_only_movers_are_struck(self):
        lines = [(6.25 + 12 * k, 6.25 + 12 * k + 9) for k in range(10)]
        score, placed = film(a_film(lines))
        pad = notes(score, name="pad")
        cycles = [t for t, ch in placed["chords"] if ch == "Fmaj9"][1:]
        self.assertGreaterEqual(len(cycles), 3)
        for t in cycles:
            struck = sorted(p for a, _, p in pad if abs(a - t) < 1e-3)
            self.assertEqual(struck, ["A3", "C4", "E4"], f"at {t:.2f} s only the voices that move are struck")
            g4 = [(a, b) for a, b, p in pad if p == "G4" and a < t - 0.1 and b > t + 0.1]
            self.assertEqual(len(g4), 1, f"G4 is held across the cycle's turn at {t:.2f} s")
        # Two bars a chord, in the cycle's order, until the bar before the exit.
        chords = placed["chords"]
        order = sound_defaults.BED["cycle"]
        for (t0, a), (t1, b) in zip(chords, chords[1:]):
            self.assertAlmostEqual(t1 - t0, 2 * BAR, places=2)
            self.assertEqual(order.index(b), (order.index(a) + 1) % 4)
        self.assertLessEqual(chords[-1][0], score["_film"]["exit"] - BAR + 1e-3)

    def test_the_bed_fills_the_film_from_bloom_to_reach(self):
        lines = [(6.25 + 12 * k, 6.25 + 12 * k + 9) for k in range(6)]
        tl = a_film(lines, demos=[(lines[2][1], 5.0, 1.0)])
        tl["lines"][3]["t0"] = tl["demos"][0]["next"]
        tl["lines"][3]["t1"] = tl["lines"][3]["t0"] + 2
        score, _ = film(tl)
        sounding = sorted((a, b) for a, b, _ in notes(score, role="pad") + notes(score, role="mpad"))
        cur, holes = 0.0, []
        for a, b in sounding:
            if a > cur + 1e-3:
                holes.append((cur, a))
            cur = max(cur, b)
        self.assertEqual(holes, [])
        self.assertGreaterEqual(cur, score["_film"]["exit"] + sound_defaults.MARKS["length_s"] - 1e-3)


class ADemo(unittest.TestCase):
    def test_the_pad_is_re_voiced_in_the_pause_and_the_cycle_resumes_after_it(self):
        lines = [(6.25, 12.0), (12.6, 16.0), (24.0, 30.0), (30.6, 34.0)]
        tl = a_film(lines, demos=[(16.0, 5.5, 1.0)])
        (d,) = tl["demos"]
        tl["lines"][2]["t0"] = d["next"]
        score, placed = film(tl)
        up = sound_defaults.LADDER["bed_under_demo_up_s"]
        back = d["off"] + up
        bed_pad = notes(score, name="pad")
        self.assertFalse([n for n in bed_pad if n[0] < back - 1e-3 and n[1] > d["pause"] + 1e-3],
                         "the bed's pad is quiet from the line's end to its return")
        under = [(a, b, p) for a, b, p in notes(score, name="epad") if abs(a - d["pause"]) < 1e-3]
        self.assertEqual(sorted(p for *_, p in under), sound_defaults.BED["under_demo"]["voicing"])
        for a, b, _ in under:
            self.assertAlmostEqual(b, back, places=3)
        resumed = [ch for t, ch in placed["chords"] if abs(t - back) < 1e-3]
        self.assertEqual(resumed, ["G6/F"], "the demo makes Fmaj9, so the cycle resumes on the chord after it")
        cell = sound_defaults.BED["burble"]["cells"]["Fmaj9"]
        under_burble = [p for a, _, p in notes(score, name="burble") if d["pause"] - 1e-3 <= a < back - 1e-3]
        self.assertTrue(under_burble and set(under_burble) <= set(cell))


def n3_film(lines, demo_on=(), tail=1.08, play=5.0):
    """A film on N3 laid out by timeline.py: `lines` are durations, and the
    lines named in `demo_on` (indices) carry a demo of `play` s whose tail
    measured `tail` s."""
    import timeline

    script = {"film": "f", "music": {"bed": "n3"}, "beats": [{"id": "b", "lines": []}]}
    for i, d in enumerate(lines):
        line = {"id": f"l{i}", "text": "A line.", "post": 0.6}
        if i in demo_on:
            line["demo"] = {"id": f"d{i}", "play_s": play}
        script["beats"][0]["lines"].append(line)
    tl, _ = timeline.lay_out(script, {f"l{i}": d for i, d in enumerate(lines)},
                             measured={f"d{i}": {"tail_s": tail} for i in demo_on})
    return tl


class TheBarBeforeReach(unittest.TestCase):
    """Nothing is struck in the bar before Reach, even when a demo's bed would
    come back there, and nothing of the bed sounds past Reach's downbeat."""

    def check(self, tl):
        score, placed = film(tl)
        xb = tl["marks"]["exit"]
        self.assertFalse([c for c in placed["chords"] if xb - BAR + 1e-3 < c[0] < xb], "a chord change in the bar before Reach")
        struck = [n for n in notes(score, name="pad") if xb - BAR + 1e-3 < n[0] <= xb + 1e-3]
        self.assertEqual(struck, [], "the bed's pad struck in the bar before Reach")
        for name in ("pad", "burble", "epad"):
            late = [n for n in notes(score, name=name) if n[1] > xb + 1e-3]
            self.assertEqual(late, [], f"{name} sounds past Reach's downbeat")
        reach_pad = {p for a, _, p in notes(score, name="xpad") if abs(a - xb) < 1e-3}
        self.assertTrue({"A3", "C4"} <= reach_pad)
        return score, placed

    def test_a_last_line_with_a_demo_and_a_measured_tail(self):
        tl = n3_film([3.0, 3.2], demo_on=[1], tail=1.08)
        score, _ = self.check(tl)
        (d,) = tl["demos"]
        self.assertAlmostEqual(tl["marks"]["exit"], d["next"], places=3)
        under = [(a, b) for a, b, p in notes(score, name="epad") if abs(a - d["pause"]) < 1e-3]
        self.assertEqual(len(under), 2)
        for a, b in under:
            self.assertAlmostEqual(b, tl["marks"]["exit"], places=3, msg="the voicing under the demo carries on to Reach")

    def test_a_short_last_line_after_a_demo(self):
        for last in (1.0, 0.6):
            with self.subTest(last=last):
                tl = n3_film([3.0, 3.2, last], demo_on=[1], tail=1.08)
                back = tl["demos"][0]["off"] + sound_defaults.LADDER["bed_under_demo_up_s"]
                self.assertGreater(back, tl["marks"]["exit"] - BAR, "the bed would have come back in the bar before Reach")
                self.check(tl)

    def test_a_very_short_tail(self):
        tl = n3_film([3.0, 3.2], demo_on=[1], tail=0.15)
        back = tl["demos"][0]["off"] + sound_defaults.LADDER["bed_under_demo_up_s"]
        self.assertGreater(back, tl["marks"]["exit"], "the bed would have come back after Reach's downbeat")
        self.check(tl)


class AChordBeforeADemo(unittest.TestCase):
    def test_no_chord_is_struck_too_close_before_a_demos_pause(self):
        # The pause 29 ms after bar 5's change (Bbmaj7/F at 16.045 s): G6/F
        # holds into it instead of a 29 ms sliver of Bbmaj7/F.
        hold = sound_defaults.BED["under_demo"]["hold_before_s"]
        self.assertEqual(hold, 2.2)
        change = 1.5 + 2 * 2 * BAR
        pause = change + 0.029
        tl = a_film([(6.25, pause), (pause + 0.7 + 5.0 + 1.0 + 0.8, pause + 12.0), (pause + 12.6, pause + 40)],
                    demos=[(pause, 5.0, 1.0)])
        score, placed = film(tl)
        self.assertFalse([c for c in placed["chords"] if pause - hold < c[0] < pause], placed["chords"])
        into = [(t, ch) for t, ch in placed["chords"] if t < pause][-1]
        self.assertEqual(into[1], "G6/F")
        onsets = sorted(a for a, _, _ in notes(score, name="burble") if pause - 1.0 < a < pause + 0.5)
        self.assertFalse([b - a for a, b in zip(onsets, onsets[1:]) if b - a < 0.1], f"a flam in the burble: {onsets}")
        # Further away than the hold, the change is struck as before.
        tl = a_film([(6.25, change + hold + 0.1), (change + hold + 7.6, change + 40)], demos=[(change + hold + 0.1, 5.0, 1.0)])
        _, placed = film(tl)
        self.assertIn([round(change, 3), "Bbmaj7/F"], placed["chords"])

    def test_a_bed_that_would_come_back_too_briefly_holds_the_voicing_to_the_next_demo(self):
        p1, p2 = 12.0, 12.0 + 0.7 + 3.0 + 1.0 + 1.5  # back 1.5 s before the next pause: too brief to bloom
        tl = a_film([(6.25, p1), (p1 + 0.7 + 3.0 + 1.8, p2), (p2 + 0.7 + 3.0 + 1.8, p2 + 20)],
                    demos=[(p1, 3.0, 1.0), (p2, 3.0, 1.0)])
        score, placed = film(tl)
        self.assertFalse([c for c in placed["chords"] if p1 < c[0] < p2], "no chord between the two demos")
        # Held, not struck again at the second pause: one note a pitch over both
        # demos, and the burble's cell runs on without starting again.
        back = tl["demos"][1]["off"] + sound_defaults.LADDER["bed_under_demo_up_s"]
        for pitch in sound_defaults.BED["under_demo"]["voicing"]:
            under = sorted((a, b) for a, b, p in notes(score, name="epad") if p == pitch and a >= p1 - 1e-3)
            self.assertEqual(len(under), 1, f"{pitch} struck again: {under}")
            self.assertAlmostEqual(under[0][0], p1, places=3)
            self.assertAlmostEqual(under[0][1], back, places=3)
        check_one_burble(self, score, p1, back)

    def test_a_demo_whose_bed_would_come_back_near_reach_carries_on_to_the_next_demo_first(self):
        # The review's case: three lines of 8.0, 3.0 and 0.6 s, the last two
        # each handing over to a 1.2 s demo with a 0.05 s tail. The first
        # demo's bed would come back in the bar before Reach, and the second
        # demo starts before then.
        tl = n3_film([8.0, 3.0, 0.6], demo_on=[1, 2], tail=0.05, play=1.2)
        score, _ = film(tl)
        xb = tl["marks"]["exit"]
        p1 = tl["demos"][0]["pause"]
        for pitch in sound_defaults.BED["under_demo"]["voicing"]:
            under = sorted((a, b) for a, b, p in notes(score, name="epad") if p == pitch and a >= p1 - 1e-3)
            self.assertEqual(len(under), 1, f"{pitch} doubled or struck again: {under}")
            self.assertAlmostEqual(under[0][1], xb, places=3)
        check_one_burble(self, score, p1, xb)


def check_one_burble(case, score, a, z):
    """Between a and z the burble is one stream, its cell running on: notes a
    step apart, none overlapping, the cell's three notes in turn."""
    step = sound_defaults.BED["burble"]["step_beats"] * SPB
    cell = sound_defaults.BED["burble"]["cells"][sound_defaults.BED["under_demo"]["counts_as"]]
    burble = [(s, e, p) for s, e, p in notes(score, name="burble") if a - 1e-3 <= s < z - 1e-3]
    case.assertTrue(burble)
    for (s0, e0, _), (s1, _, _) in zip(burble, burble[1:]):
        case.assertAlmostEqual(s1 - s0, step, places=3, msg=f"the burble's cell starts again at {s1:.3f} s")
        case.assertLessEqual(e0, s1 + 1e-3)
    case.assertEqual([p for *_, p in burble], [cell[k % len(cell)] for k in range(len(burble))])
    case.assertLessEqual(burble[-1][1], z + 1e-3)


class TheSighs(unittest.TestCase):
    def check_in_gaps(self, tl, score):
        L = sigh_length()
        exit_ = tl["marks"]["exit"]
        for t, ch in score["_film"]["sighs"]:
            for l in tl["lines"]:
                self.assertTrue(l["t1"] <= t + 1e-3 or l["t0"] >= t + L - 1e-3, f"the sigh at {t:.2f} s crosses {l['id']}")
            for d in tl["demos"]:
                up = sound_defaults.LADDER["bed_under_demo_up_s"]
                self.assertTrue(t + L <= d["pause"] + 1e-3 or t >= d["off"] + up - 1e-3, f"the sigh at {t:.2f} s is in a demo")
            self.assertLessEqual(t + L, exit_ - BAR + 1e-3, "never in the bar before the exit mark")
            self.assertIn([t, ch], score["_film"]["chords"], "a sigh starts on a chord change")

    def test_the_hand_placed_sigh_comes_back(self):
        # The narration clip: the tour's views1-views5, cut from 24.4 s, the
        # clip ending 3.5 s past the narration, over N3 placed so that its
        # third cycle starts 16.25 s in. By hand, one sigh (F5 E5) sat there,
        # 0.16 s after the last line ended.
        views = [(24.886, 26.661), (27.061, 29.031), (29.531, 33.046), (33.546, 38.033), (38.533, 40.488)]
        lines = [(a - 24.4, b - 24.4) for a, b in views]
        bar1 = 16.25 - 16 * BAR
        tl = {"film": "n3_narration", "lines": [{"id": f"views{i + 1}", "text": ".", "t0": a, "t1": b}
                                                for i, (a, b) in enumerate(lines)],
              "marks": {"entrance": bar1 - sound_defaults.MARKS["into_the_bed"]["bed_bar_1_at_s"]},
              "demos": [], "duration": 21.5}
        score, placed = film(tl)
        self.assertEqual(placed["sighs"], [[16.25, "Fmaj9"]])
        a, b = (next(t for t in score["tracks"] if t["name"] == n) for n in ("sigh1a", "sigh1b"))
        self.assertEqual((a["notes"]["s"][0][3], b["notes"]["s"][0][3]), ("F5", "E5"))
        self.assertEqual((a["role"], b["role"]), ("melody", "melody"))
        self.assertEqual(b["pitch_drop"]["semis"], 1.0)

    def test_a_gap_that_holds_a_sigh_gets_one_and_one_a_little_short_gets_none(self):
        b1 = 1.5
        change = b1 + 4 * 2 * BAR  # the fifth chord change: Fmaj9 again
        L = sigh_length()
        base = [(6.25, 10.0), (10.6, change - 0.3)]
        for room, want in ((L + 0.05, 1), (L - 0.05, 0)):
            lines = base + [(change + room, change + room + 3), (change + room + 3.6, change + room + 30)]
            tl = a_film(lines)
            score, placed = film(tl)
            here = [s for s in placed["sighs"] if abs(s[0] - change) < 1e-2]
            self.assertEqual(len(here), want, f"{room:.2f} s of room")
            self.check_in_gaps(tl, score)

    def test_sighs_sit_only_in_the_narrations_gaps(self):
        # A long film with gaps of every length, and demos.
        lines, t = [], 6.25
        for k in range(24):
            lines.append((t, t + 2.5 + (k % 5)))
            t = lines[-1][1] + (0.5, 1.2, 3.0, 4.2, 6.5, 9.0)[k % 6]
        tl = a_film(lines, demos=[(lines[5][1], 5.0, 1.1), (lines[14][1], 6.5, 1.08)])
        for i in (5, 14):
            shift = tl["demos"][0 if i == 5 else 1]["next"] - tl["lines"][i + 1]["t0"]
            for l in tl["lines"][i + 1:]:
                l["t0"] += shift
                l["t1"] += shift
            for d in tl["demos"][(1 if i == 5 else 2):]:
                for k in ("pause", "t0", "off", "next"):
                    d[k] += shift
        tl["marks"]["exit"] = tl["lines"][-1]["t1"] + 1.75
        tl["duration"] = tl["marks"]["exit"] + 7.1
        score, placed = film(tl)
        self.assertGreaterEqual(len(placed["sighs"]), 2, "the long gaps get sighs")
        self.check_in_gaps(tl, score)
        # Each sigh is its chord's: two notes, falling, the second swelling.
        for n, (t, ch) in enumerate(placed["sighs"], 1):
            a, b = (next(x for x in score["tracks"] if x["name"] == f"sigh{n}{s}") for s in "ab")
            self.assertEqual([a["notes"]["s"][0][3], b["notes"]["s"][0][3]], sound_defaults.BED["sighs"][ch])
            self.assertEqual(b["fader"][0][3], sound_defaults.LEAD["swell"]["from_db"])

    def test_a_sigh_that_would_double_the_pad_rests_its_voice_to_the_next_change(self):
        # Bbmaj7/F's sigh (Bb4 A4) and the pad's top A4.
        change = 1.5 + 2 * 2 * BAR  # bar 5: Bbmaj7/F
        lines = [(6.25, change - 0.2), (change + 6.0, change + 9.0), (change + 9.6, change + 40)]
        score, placed = film(a_film(lines))
        self.assertIn([round(change, 3), "Bbmaj7/F"], placed["sighs"])
        nxt = change + 2 * BAR
        a4 = [(a, b) for a, b, p in notes(score, name="pad") if p == "A4"]
        self.assertFalse([1 for a, b in a4 if a < nxt - 1e-3 and b > change + 1e-3], "the pad's A4 rests under the sigh")
        others = sorted(p for a, b, p in notes(score, name="pad") if a <= change + 1e-3 < b)
        self.assertEqual(others, ["Bb3", "D4", "F4"])


if __name__ == "__main__":
    # One line when they pass, like the rest of `make dev-check`; everything
    # unittest says when one fails.
    out = io.StringIO()
    result = unittest.TextTestRunner(stream=out, verbosity=2).run(
        unittest.defaultTestLoader.loadTestsFromModule(sys.modules[__name__]))
    if not result.wasSuccessful():
        sys.stderr.write(out.getvalue())
        sys.exit(1)
    why = sorted({why for _, why in result.skipped})
    skipped = f"; {len(result.skipped)} skipped ({'; '.join(why)})" if why else ""
    print(f"  fit_score tests: {result.testsRun - len(result.skipped)} passed{skipped}")
