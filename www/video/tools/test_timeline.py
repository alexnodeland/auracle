#!/usr/bin/env python3
"""timeline.py: a demo after its line, its measured tail, then the voice; the
marks a fixed distance from the first and last words; all from sound.json.

    python3 www/video/tools/test_timeline.py      (run by `make dev-check`)

Python 3 standard library only.
"""

import contextlib
import copy
import io
import json
import os
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import sound_defaults  # noqa: E402
import timeline  # noqa: E402

# The final reel's narration (view-perform's lines, as voiced on 2026-09-29),
# its gaps, and its stand-in demo: 7.15 beats at 66 BPM, its tail taken as
# 1.12 s (SPEC section 9's table was laid out on that; measured, it was 1.08).
REEL_DURS = {"title1": 1.97, "title2": 4.725, "named2": 4.225, "named3": 2.635, "named4": 3.147}
REEL_PLAY = 7.15 * 60 / 66


def reel_script(tail=1.12):
    return {
        "film": "reel", "fps": 30, "music": {"bed": "n3"}, "snap": "none",
        "beats": [{"id": "reel", "lead": 0.0, "lines": [
            {"id": "title1", "text": "PERFORM is where you play the sound.", "post": 0.6},
            {"id": "title2", "text": "Its controls are named for what you hear.", "post": 0.5},
            {"id": "named2", "text": "Hold a chord and ride Bright up.",
             "demo": {"id": "bright", "play_s": REEL_PLAY, "tail_s": tail}},
            {"id": "named3", "text": "Underneath, the patch's own knobs move with it.", "post": 0.6},
            {"id": "named4", "text": "Long-press a control to hear what it does on this patch."},
        ]}],
    }


def lines(tl):
    return {l["id"]: l for l in tl["lines"]}


@contextlib.contextmanager
def timings(**changes):
    saved = copy.deepcopy(sound_defaults.TIMINGS)
    sound_defaults.TIMINGS.update(changes)
    try:
        yield
    finally:
        sound_defaults.TIMINGS.clear()
        sound_defaults.TIMINGS.update(saved)


class ADemo(unittest.TestCase):
    def script(self, demo, post=0.4, bed="study"):
        return {
            "film": "f", "music": {"bed": bed, "bpm": 84}, "snap": "none",
            "beats": [{"id": "b", "lines": [
                {"id": "l1", "text": "Ride it up.", "post": post, "demo": demo},
                {"id": "l2", "text": "The top opened."},
            ]}],
        }

    def test_the_line_a_pause_the_demo_its_tail_a_pause_then_the_next_line(self):
        tl, arr = timeline.lay_out(self.script({"id": "d", "play_s": 5.0}), {"l1": 2.0, "l2": 1.5},
                                   measured={"d": {"tail_s": 1.25}})
        (d,) = tl["demos"]
        l1, l2 = lines(tl)["l1"], lines(tl)["l2"]
        self.assertEqual(sound_defaults.TIMINGS["demo_after_line_s"], 0.7)
        self.assertEqual(sound_defaults.TIMINGS["voice_after_tail_s"], 0.8)
        self.assertAlmostEqual(d["pause"], l1["t1"])
        self.assertAlmostEqual(d["t0"], l1["t1"] + 0.7)
        self.assertAlmostEqual(d["off"], d["t0"] + 5.0)
        self.assertAlmostEqual(l2["t0"], d["off"] + 1.25 + 0.8)
        self.assertAlmostEqual(d["next"], l2["t0"])
        self.assertNotIn("estimated", d)
        self.assertEqual(arr["demos"], [[d["t0"], d["off"]]])

    def test_the_tail_is_measured_not_a_fixed_length(self):
        def next_line(tail):
            tl, _ = timeline.lay_out(self.script({"id": "d", "play_s": 5.0}), {"l1": 2.0, "l2": 1.5},
                                     measured={"d": {"tail_s": tail}})
            return lines(tl)["l2"]["t0"]
        self.assertAlmostEqual(next_line(2.5) - next_line(1.0), 1.5, places=3)

    def test_an_unmeasured_tail_is_the_scripts_estimate_and_says_so(self):
        tl, _ = timeline.lay_out(self.script({"id": "d", "play_s": 5.0, "tail_s": 1.5}), {"l1": 2.0, "l2": 1.5})
        self.assertTrue(tl["demos"][0]["estimated"])
        self.assertAlmostEqual(lines(tl)["l2"]["t0"], 2.0 + 0.7 + 5.0 + 1.5 + 0.8, places=3)
        tl, _ = timeline.lay_out(self.script({"id": "d", "play_s": 5.0, "tail_s": 1.5}), {"l1": 2.0, "l2": 1.5},
                                 measured={"d": {"tail_s": 1.0}})
        self.assertAlmostEqual(lines(tl)["l2"]["t0"], 2.0 + 0.7 + 5.0 + 1.0 + 0.8, places=3)

    def test_a_tail_neither_measured_nor_estimated_stops_the_timeline(self):
        with self.assertRaisesRegex(ValueError, "line l1: its demo's tail is neither measured"):
            timeline.lay_out(self.script({"id": "d", "play_s": 5.0}), {"l1": 2.0, "l2": 1.5})

    def test_the_demos_line_has_no_post_the_demo_sets_the_gap(self):
        a, _ = timeline.lay_out(self.script({"id": "d", "play_s": 5.0}, post=0.0), {"l1": 2.0},
                                measured={"d": {"tail_s": 1.0}})
        b, _ = timeline.lay_out(self.script({"id": "d", "play_s": 5.0}, post=3.0), {"l1": 2.0},
                                measured={"d": {"tail_s": 1.0}})
        self.assertEqual(lines(a)["l2"]["t0"], lines(b)["l2"]["t0"])

    def test_the_pauses_are_read_from_sound_json(self):
        with timings(demo_after_line_s=1.0, voice_after_tail_s=0.5):
            tl, _ = timeline.lay_out(self.script({"id": "d", "play_s": 5.0}), {"l1": 2.0, "l2": 1.5},
                                     measured={"d": {"tail_s": 1.0}})
        self.assertAlmostEqual(tl["demos"][0]["t0"], 3.0)
        self.assertAlmostEqual(lines(tl)["l2"]["t0"], 3.0 + 5.0 + 1.0 + 0.5)


class TheMarks(unittest.TestCase):
    def test_bloom_before_the_first_word_and_reach_after_the_last(self):
        tl, arr = timeline.lay_out(reel_script(), REEL_DURS)
        m, ls = tl["marks"], lines(tl)
        length = sound_defaults.MARKS["length_s"]
        self.assertEqual((length, sound_defaults.TIMINGS["first_word_after_entrance_s"]["reel"],
                          sound_defaults.TIMINGS["exit_after_last_word_s"]["reel"]), (4.5, 1.75, 1.75))
        self.assertAlmostEqual(ls["title1"]["t0"] - (m["entrance"] + length), 1.75, places=3)
        self.assertAlmostEqual(m["exit"] - ls["named4"]["t1"], 1.75, places=3)
        self.assertAlmostEqual(tl["duration"], m["exit"] + length + sound_defaults.TIMINGS["exit_ring_out_s"], places=3)
        self.assertEqual(arr["marks"], m)
        self.assertEqual((tl["grid"]["bpm"], arr["bpm"], arr["bed"]), (66, 66, "n3"))
        self.assertAlmostEqual(tl["grid"]["t0"], m["entrance"] + 1.5)

    def test_the_offsets_are_read_from_sound_json(self):
        with timings(first_word_after_entrance_s={"min": 1.5, "max": 2.0, "reel": 2.0},
                     exit_after_last_word_s={"min": 1.5, "max": 2.0, "reel": 1.5}):
            tl, _ = timeline.lay_out(reel_script(), REEL_DURS)
        m, ls = tl["marks"], lines(tl)
        self.assertAlmostEqual(ls["title1"]["t0"] - m["entrance"], 4.5 + 2.0, places=3)
        self.assertAlmostEqual(m["exit"] - ls["named4"]["t1"], 1.5, places=3)

    def test_the_entrance_sits_where_the_first_line_would_have(self):
        s = reel_script()
        s["beats"].insert(0, {"id": "open", "lead": 12.0, "lines": []})
        tl, _ = timeline.lay_out(s, REEL_DURS)
        self.assertAlmostEqual(tl["marks"]["entrance"], 12.0)
        self.assertAlmostEqual(lines(tl)["title1"]["t0"], 12.0 + 6.25)

    def test_after_a_last_demo_the_exit_comes_where_the_next_line_would_have(self):
        s = reel_script()
        s["beats"][0]["lines"][-1]["demo"] = {"id": "last", "play_s": 4.0, "tail_s": 1.0}
        tl, _ = timeline.lay_out(s, REEL_DURS)
        self.assertAlmostEqual(tl["marks"]["exit"], tl["demos"][-1]["next"])

    def test_a_film_on_another_bed_has_no_marks_and_ends_on_a_bar(self):
        s = reel_script()
        s["music"] = {"bed": "study", "bpm": 84}
        tl, arr = timeline.lay_out(s, REEL_DURS)
        self.assertNotIn("marks", tl)
        self.assertNotIn("marks", arr)
        bar = 4 * 60 / 84
        self.assertAlmostEqual(tl["duration"], round(tl["duration"] / bar) * bar, places=3)
        self.assertEqual(lines(tl)["title1"]["t0"], 0.0)


class TheReel(unittest.TestCase):
    def test_the_reels_timeline_comes_back(self):
        # SPEC section 9's table, laid out from its lines, gaps and demo.
        tl, _ = timeline.lay_out(reel_script(), REEL_DURS)
        ls, (d,), m = lines(tl), tl["demos"], tl["marks"]
        want = {"title1": 6.25, "title2": 8.82, "named2": 14.045, "named3": 27.39, "named4": 30.625}
        for k, v in want.items():
            self.assertAlmostEqual(ls[k]["t0"], v, places=2, msg=k)
        self.assertAlmostEqual(d["pause"], 18.27, places=2)
        self.assertAlmostEqual(d["t0"], 18.97, places=2)
        self.assertAlmostEqual(d["off"], 25.47, places=2)
        self.assertAlmostEqual(ls["named4"]["t1"], 33.772, places=2)
        self.assertAlmostEqual(m["entrance"], 0.0)
        self.assertAlmostEqual(m["exit"], 35.522, places=2)
        self.assertAlmostEqual(tl["duration"], 42.62, places=2)

    def test_with_its_measured_tail_everything_after_the_demo_comes_sooner(self):
        assumed, _ = timeline.lay_out(reel_script(1.12), REEL_DURS)
        measured, _ = timeline.lay_out(reel_script(), REEL_DURS, measured={"bright": {"tail_s": 1.08}})
        self.assertAlmostEqual(lines(assumed)["named3"]["t0"] - lines(measured)["named3"]["t0"], 0.04, places=3)
        self.assertAlmostEqual(assumed["marks"]["exit"] - measured["marks"]["exit"], 0.04, places=3)


class TheCommand(unittest.TestCase):
    def test_it_writes_the_demos_and_the_marks(self):
        d = tempfile.mkdtemp(prefix="timeline-")
        try:
            with open(os.path.join(d, "script.json"), "w") as f:
                json.dump(reel_script(None), f)
            with open(os.path.join(d, "manifest.json"), "w") as f:
                json.dump({"lines": [{"id": k, "duration_s": v} for k, v in REEL_DURS.items()]}, f)
            with open(os.path.join(d, "demos.json"), "w") as f:
                json.dump({"bright": {"tail_s": 1.08}}, f)
            saved = sys.argv
            sys.argv = ["timeline.py", d, "--voice", os.path.join(d, "manifest.json"),
                        "--demos", os.path.join(d, "demos.json")]
            try:
                with contextlib.redirect_stdout(io.StringIO()) as out:
                    timeline.main()
            finally:
                sys.argv = saved
            with open(os.path.join(d, "timeline.json")) as f:
                tl = json.load(f)
            with open(os.path.join(d, "arrangement.json")) as f:
                arr = json.load(f)
            self.assertEqual(tl["demos"][0]["tail_s"], 1.08)
            self.assertEqual(arr["demos"], [[tl["demos"][0]["t0"], tl["demos"][0]["off"]]])
            self.assertEqual(arr["marks"], tl["marks"])
            self.assertIn("mark  exit", out.getvalue())
        finally:
            shutil.rmtree(d)


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
    print(f"  timeline tests: {result.testsRun - len(result.skipped)} passed{skipped}")
