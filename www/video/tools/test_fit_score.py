#!/usr/bin/env python3
"""fit_score.py: a fitted bed fills its section, and stops at its end.

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
        self.score, self.dropped = fit_score.fit(study(), self.TARGETS)

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

    def test_nothing_is_dropped(self):
        self.assertEqual(self.dropped, [])


class AShortenedSectionStopsAtItsEnd(unittest.TestCase):
    def test_no_note_runs_past_a_shortened_section(self):
        # circuit and taste fit loop_a to 13 bars, tour loop_b to 7.
        score, _ = fit_score.fit(study(), {"loop_a": 13, "loop_b": 7})
        for sec, bars in (("loop_a", 13), ("loop_b", 7)):
            end = bars * 4
            for track in ("pad", "pluck"):
                notes = notes_of(score, track, sec)
                self.assertLessEqual(max(e for _, e in notes), end + 1e-9, f"{track} in {sec}")
            self.assertEqual(gaps(notes_of(score, "pad", sec), end), [], f"pad in {sec}")


class TheComposedLength(unittest.TestCase):
    def test_fitting_to_the_composed_length_changes_no_note(self):
        s = study()
        fitted, dropped = fit_score.fit(s, {"loop_a": 16, "loop_b": 16})
        self.assertEqual(fitted["tracks"], s["tracks"])
        self.assertEqual(dropped, [])

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
        fitted, _ = fit_score.fit(s, {"s": 11})
        ps = fitted["tracks"][0]["patterns"]
        self.assertEqual(ps[0]["repeat"], 5)
        self.assertEqual([p["notes"] for p in ps[1:]], [[[11, 1, 4, "C4", 0.5]]])
        self.assertEqual(max(e for _, e in notes_of(fitted, "t", "s")), 44)

    def test_a_repeat_offset_by_fractional_bars_keeps_a_whole_start_bar(self):
        s = self.score({"start_bar": 1, "repeat": 4, "every_bars": 2.5,
                        "notes": [[1, 1, 2, "C4", 0.5]]})
        s["sections"][0]["bars"] = 10
        fitted, _ = fit_score.fit(s, {"s": 14})
        for p in fitted["tracks"][0]["patterns"]:
            self.assertIsInstance(p["start_bar"], int)
        starts = [st for st, _ in notes_of(fitted, "t", "s")]
        self.assertEqual(starts, [0, 10, 20, 30, 40, 50])

    def test_a_phrase_anchored_to_the_end_moves_with_it(self):
        s = self.score({"start_bar": 7, "repeat": 1, "every_bars": 2, "notes": [[1, 1, 8, "C4", 0.5]]})
        fitted, _ = fit_score.fit(s, {"s": 12})
        self.assertEqual(fitted["tracks"][0]["patterns"][0]["start_bar"], 11)
        self.assertEqual(fitted["tracks"][0]["patterns"][0]["repeat"], 1)

    def test_a_phrase_that_ends_early_is_left_alone(self):
        s = self.score({"start_bar": 1, "repeat": 1, "every_bars": 2, "notes": [[1, 1, 4, "C4", 0.5]]})
        fitted, _ = fit_score.fit(s, {"s": 30})
        self.assertEqual(fitted["tracks"][0]["patterns"], s["tracks"][0]["patterns"])


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
