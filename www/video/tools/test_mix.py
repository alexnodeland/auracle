#!/usr/bin/env python3
"""mix.py: the ladder, the voice chain, the duck, carve and dip, the marks and
the demo windows, all read from www/brand/sound.json; and no cues.

    python3 www/video/tools/test_mix.py      (run by `make dev-check`)

The tests import mix.py, which needs numpy and scipy (the film tools'
packages, in .venv-voice); without them they are skipped. `make dev-check`
runs this on .venv-voice when it exists. Every sound here is synthetic: no
render, voice or recording is read.
"""

import contextlib
import importlib.util
import io
import json
import math
import os
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import sound_defaults  # noqa: E402

HAVE_AUDIO = all(importlib.util.find_spec(m) for m in ("numpy", "scipy"))
SOUND_JSON = os.path.join(HERE, "..", "..", "brand", "sound.json")

if HAVE_AUDIO:
    import numpy as np

    import mix

    SR = mix.SR


def tone(hz, s, db=-20.0, sr=48000):
    t = np.arange(int(s * sr)) / sr
    x = 10 ** (db / 20) * np.sqrt(2) * np.sin(2 * math.pi * hz * t)
    return np.stack([x, x], axis=1).astype(np.float32)


def level_db(x):
    return 10 * math.log10(float(np.mean(x.astype(np.float64) ** 2)) + 1e-30)


@unittest.skipUnless(HAVE_AUDIO, "mix.py needs numpy and scipy (make film-setup)")
class TheLadder(unittest.TestCase):
    def test_the_ladder_is_sound_jsons(self):
        with open(SOUND_JSON, encoding="utf-8") as f:
            src = json.load(f)
        for k in ("narration_lufs", "bed_rest_lu", "demo_lufs", "bed_under_demo_lu", "marks_lufs", "master_lufs"):
            self.assertEqual(mix.LADDER[k], src["ladder"][k], k)
        self.assertIs(mix.LADDER, sound_defaults.LADDER)
        self.assertEqual((mix.LADDER["narration_lufs"], mix.LADDER["bed_rest_lu"], mix.LADDER["demo_lufs"],
                          mix.LADDER["marks_lufs"], mix.LADDER["master_lufs"]), (-18, -3, -18, -18, -16))

    def test_the_bed_duck_and_master_defaults_are_read_from_the_ladder(self):
        # Read, not copied: a change to sound.json's ladder reaches mix.py.
        saved = dict(mix.LADDER), dict(mix.DUCK)
        mix.LADDER.update(bed_rest_lu=-1.25, master_lufs=-14.5)
        mix.DUCK.update(broadband_db=-3.5)
        try:
            args = mix.parser().parse_args(["f"])
        finally:
            mix.LADDER.clear()
            mix.LADDER.update(saved[0])
            mix.DUCK.clear()
            mix.DUCK.update(saved[1])
        self.assertEqual((args.music_db, args.duck_db, args.target), (-1.25, -3.5, -14.5))
        args = mix.parser().parse_args(["f"])
        self.assertEqual((args.music_db, args.duck_db, args.target), (-3, -2, -16))

    def test_while_it_sounds_and_the_tails_frames_are_sound_jsons(self):
        with open(SOUND_JSON, encoding="utf-8") as f:
            src = json.load(f)
        self.assertEqual((mix.SOUNDING_LUFS, mix.PAD_SOUNDING_LUFS),
                         (src["mix"]["sounding"]["part_lufs"], src["mix"]["sounding"]["pad_lufs"]))
        self.assertEqual(sound_defaults.TIMINGS["demo_tail_hop_s"], src["grammar"]["demo_tail_hop_s"])

    def test_there_is_no_cue_layer(self):
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            mix.parser().parse_args(["f", "--sfx", "out/sound/stingers"])
        self.assertFalse(hasattr(mix, "cue_files"))


@unittest.skipUnless(HAVE_AUDIO, "mix.py needs numpy and scipy (make film-setup)")
class UnderTheVoice(unittest.TestCase):
    def test_the_duck_and_the_carve_are_sound_jsons(self):
        duck, carve = sound_defaults.DUCK["broadband_db"], sound_defaults.CARVE["db"]
        self.assertEqual((duck, carve, sound_defaults.CARVE["band_hz"]), (-2, -3, [1000, 4000]))
        for hz, want in ((300, duck), (2000, duck + carve), (9000, duck)):
            x = tone(hz, 2.0)
            on = mix.under_voice(x, np.ones(len(x)), duck)
            off = mix.under_voice(x, np.zeros(len(x)), duck)
            mid = slice(SR // 2, -SR // 2)
            self.assertAlmostEqual(level_db(on[mid]) - level_db(x[mid]), want, delta=0.1, msg=f"{hz} Hz")
            self.assertAlmostEqual(level_db(off[mid]) - level_db(x[mid]), 0.0, delta=0.01, msg=f"{hz} Hz")

    def test_the_pads_dip_is_sound_jsons(self):
        dip = sound_defaults.PAD_DIP["db"]
        self.assertEqual((dip, sound_defaults.PAD_DIP["band_hz"]), (-2, [300, 600]))
        # The band is an octave wide and its edges are 4th-order, so its
        # middle (424 Hz) takes most of the dip, never more.
        for hz, lo, hi in ((424, dip, 0.85 * dip), (110, -0.02, 0.0), (1600, -0.02, 0.0)):
            x = tone(hz, 2.0)
            y = mix.dip(x, np.ones(len(x)))
            mid = slice(SR // 2, -SR // 2)
            got = level_db(y[mid]) - level_db(x[mid])
            self.assertTrue(lo - 0.01 <= got <= hi + 0.01, f"{hz} Hz: {got:.2f} dB")

    def test_the_band_splits_reconstruct_exactly(self):
        x = np.random.default_rng(1).standard_normal((SR, 2)).astype(np.float32)
        lo, band, hi = mix.split(x, 1000, 4000)
        self.assertLess(float(np.max(np.abs(lo + band + hi - x))), 1e-5)

    def test_the_follower_is_its_recurrence(self):
        rng = np.random.default_rng(2)
        mask = np.repeat(rng.integers(0, 2, 400).astype(float), 240)
        a = math.exp(-1.0 / (80 * SR / 1000))
        r = math.exp(-1.0 / (450 * SR / 1000))
        want, cur = np.empty_like(mask), 0.0
        for i, m in enumerate(mask):
            cur = m + (cur - m) * (a if m > cur else r)
            want[i] = cur
        self.assertLess(float(np.max(np.abs(mix.follower(mask) - want))), 1e-9)
        self.assertEqual((sound_defaults.DUCK["follower"]["attack_ms"], sound_defaults.DUCK["follower"]["release_ms"]),
                         (80, 450))

    def test_the_detector_hears_the_voice_above_its_threshold(self):
        x = np.concatenate([tone(300, 1.0, -30), np.zeros((SR, 2), np.float32)])
        env = mix.voice_env(x)
        self.assertGreater(env[int(0.9 * SR)], 0.99)
        self.assertLess(env[int(1.9 * SR)], 0.15, "released over 450 ms")
        self.assertEqual(float(mix.voice_env(tone(300, 1.0, -60)).max()), 0.0, "-60 dBFS is under the detector's -45")


@unittest.skipUnless(HAVE_AUDIO, "mix.py needs numpy and scipy (make film-setup)")
class TheVoiceChain(unittest.TestCase):
    def voice(self, lowmid_db):
        rng = np.random.default_rng(3)
        n = 4 * SR
        spec = np.fft.rfft(rng.standard_normal(n))
        f = np.fft.rfftfreq(n, 1 / SR)
        spec[(f >= 250) & (f < 400)] *= 10 ** (lowmid_db / 20)
        x = np.fft.irfft(spec, n)
        x = np.stack([x, x], axis=1).astype(np.float32)
        return x * 10 ** ((-18 - mix.lufs(x)) / 20)

    def test_the_low_mid_cut_follows_its_rule(self):
        _, heavy = mix.voice_chain(self.voice(6.0))
        _, flat = mix.voice_chain(self.voice(0.0))
        self.assertTrue(any(s.startswith("-2 dB at 315 Hz") for s in heavy), heavy)
        self.assertTrue(any(s.startswith("no 315 Hz cut") for s in flat), flat)
        self.assertEqual([s.split()[0] for s in flat], ["high-pass", "no", "+2", "de-essed"])

    def test_the_high_pass_takes_the_rumble(self):
        x = tone(40, 2.0, -24)
        y, _ = mix.voice_chain(x, [s for s in sound_defaults.VOICE_CHAIN if s["type"] == "highpass"])
        self.assertLess(level_db(y[SR:]) - level_db(x[SR:]), -6)

    def test_the_de_esser_cuts_at_most_its_maximum_and_only_over_its_threshold(self):
        st = next(s for s in sound_defaults.VOICE_CHAIN if s["type"] == "deesser")
        loud, quiet = tone(12000, 1.0, -6), tone(12000, 1.0, -40)
        mid = slice(SR // 4, -SR // 4)
        y, _ = mix.deess(loud.astype(np.float64), st)
        self.assertAlmostEqual(level_db(y[mid]) - level_db(loud[mid]), -st["max_cut_db"], delta=0.05)
        y, _ = mix.deess(quiet.astype(np.float64), st)
        self.assertAlmostEqual(level_db(y[mid]) - level_db(quiet[mid]), 0.0, delta=0.01)
        low = tone(1000, 1.0, -6)
        y, _ = mix.deess(low.astype(np.float64), st)
        self.assertAlmostEqual(level_db(y[mid]) - level_db(low[mid]), 0.0, delta=0.05, msg="below its band")


@unittest.skipUnless(HAVE_AUDIO, "mix.py needs numpy and scipy (make film-setup)")
class EachPartInItsPlace(unittest.TestCase):
    def test_eq_stereo_and_pan_follow_sound_json(self):
        rng = np.random.default_rng(4)
        x = rng.standard_normal((2 * SR, 2)).astype(np.float32) * 0.05
        drone = mix.place("drone", x)
        self.assertLess(float(np.max(np.abs(drone[:, 0] - drone[:, 1]))), 1e-6, "the drone is mono")
        burble = mix.place("burble", x)
        self.assertGreater(level_db(burble[:, 0]), level_db(burble[:, 1]), "the burble sits left")
        melody = mix.place("melody", x)
        self.assertLess(level_db(melody[:, 0]), level_db(melody[:, 1]), "the melody sits right")
        self.assertEqual((mix.PARTS["burble"]["pan"], mix.PARTS["melody"]["pan"]), (-0.2, 0.15))

    def test_below_150_hz_everything_is_centred(self):
        t = np.arange(2 * SR) / SR
        side = np.sin(2 * math.pi * 60 * t)
        x = np.stack([side, -side], axis=1).astype(np.float32) * 0.1
        for role in ("pad", "burble", "lead"):
            y = mix.place(role, x)
            self.assertLess(level_db(y[SR // 2 : -SR // 2]), level_db(x) - 20, role)


class Film:
    """A short synthetic film in a throwaway copy of www/video/: lines of
    "speech", a score with every role on its own stem, the two marks, one demo
    in the app's sound, and two cues the picture still asks for."""

    LINES = [("a1", 7.0, 9.0), ("a2", 9.6, 12.0), ("b1", 21.0, 23.5)]
    DEMO = {"line": "a2", "id": "d", "pause": 12.0, "t0": 12.7, "off": 17.2, "tail_s": 1.0, "next": 21.0}
    MARKS = {"entrance": 0.75, "exit": 25.25}
    DURATION = 32.0

    def __enter__(self):
        self.root = tempfile.mkdtemp(prefix="mix-")
        for d in ("films/f", "out/f", "voice", "score/stems/s", "app"):
            os.makedirs(os.path.join(self.root, d))
        rng = np.random.default_rng(5)
        man = {"lines": []}
        for lid, t0, t1 in self.LINES:
            n = int((t1 - t0) * SR)
            x = rng.standard_normal(n) * 0.1
            syl = (np.sin(2 * math.pi * 4 * np.arange(n) / SR) > -0.3).astype(float)
            mix.write(os.path.join(self.root, "voice", f"{lid}.wav"), np.stack([x * syl] * 2, axis=1))
            man["lines"].append({"id": lid, "file": f"{lid}.wav"})
        self.json("voice/manifest.json", man)
        self.json("films/f/timeline.json", {
            "film": "f", "duration": self.DURATION,
            "lines": [{"id": lid, "text": "A line.", "t0": t0, "t1": t1} for lid, t0, t1 in self.LINES],
            "demos": [self.DEMO], "marks": self.MARKS})
        self.json("out/f/cues.json", [{"name": "whoosh", "t": 1.0}, {"name": "blip", "t": 2.0}])
        # The score's origin is the entrance; its stems run from there.
        length = self.DURATION - self.MARKS["entrance"]
        ex = self.MARKS["exit"] - self.MARKS["entrance"]
        stems = {
            "drone": (tone(87.3, length, -30) + tone(130.8, length, -32)),
            "pad": self.span(tone(220, length, -26) + tone(440, length, -28) + tone(1760, length, -40), 1.5, ex),
            "mpad": self.span(tone(261.6, length, -26), 0, 4.5) + self.span(tone(261.6, length, -26), ex, ex + 4.5),
            "burble": tone(174.6, length, -34),
            "lead1": self.span(tone(523.3, length, -24), 0, 4.5),
            "lead2": self.span(tone(440, length, -24), ex, ex + 4.5),
        }
        for name, x in stems.items():
            mix.write(os.path.join(self.root, "score/stems/s", f"{name}.wav"), x)
        roles = {"drone": "drone", "pad": "pad", "mpad": "mpad", "burble": "burble", "lead1": "lead", "lead2": "lead"}
        self.json("score.json", {"title": "F", "tempo": 66, "beats_per_bar": 4, "sections": [{"name": "s", "bars": 9}],
                                 "tracks": [{"name": k, "preset": "x", "role": r} for k, r in roles.items()],
                                 "_film": {"t0": self.MARKS["entrance"]}})
        demo = self.span(tone(174.6, 9.0, -20) + tone(329.6, 9.0, -22), 0, self.DEMO["off"] - self.DEMO["t0"])
        k = int((self.DEMO["off"] - self.DEMO["t0"]) * SR)
        demo[k:] = (tone(174.6, 9.0, -20) + tone(329.6, 9.0, -22))[k:] * np.exp(-np.arange(len(demo) - k) / (0.12 * SR))[:, None]
        mix.write(os.path.join(self.root, "app", "demo.wav"), demo)
        self.json("app.json", [{"file": os.path.join(self.root, "app", "demo.wav"), "t": self.DEMO["t0"], "gain_db": -3}])
        return self

    @staticmethod
    def span(x, a, b):
        y = np.zeros_like(x)
        i, j = int(a * SR), int(b * SR)
        y[i:j] = x[i:j]
        return y

    def json(self, rel, obj):
        with open(os.path.join(self.root, rel), "w") as f:
            json.dump(obj, f)

    def mix(self, *extra):
        saved = mix.VIDEO, sys.argv
        mix.VIDEO = self.root
        sys.argv = ["mix.py", "f", "--voice", os.path.join(self.root, "voice"),
                    "--score", os.path.join(self.root, "score.json"), "--music", os.path.join(self.root, "score"),
                    "--app", os.path.join(self.root, "app.json"), *extra]
        out = io.StringIO()
        try:
            with contextlib.redirect_stdout(out):
                mix.main()
        finally:
            mix.VIDEO, sys.argv = saved
        with open(os.path.join(self.root, "out/f/ladder.json")) as f:
            return json.load(f), out.getvalue()

    def __exit__(self, *exc):
        shutil.rmtree(self.root)


@unittest.skipUnless(HAVE_AUDIO, "mix.py needs numpy and scipy (make film-setup)")
class AFilmMixedToTheLadder(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.film = Film().__enter__()
        cls.report, cls.log = cls.film.mix()

    @classmethod
    def tearDownClass(cls):
        cls.film.__exit__()

    def test_the_voice_and_the_bed_at_rest(self):
        lad = self.report["ladder"]
        self.assertAlmostEqual(lad["voice_lufs"], -18.0, delta=0.05)
        self.assertAlmostEqual(lad["bed_rest_vs_voice_lu"], -3.0, delta=0.05)

    def test_under_the_voice_the_bed_ducks_and_is_carved(self):
        lad = self.report["ladder"]
        # Measured over speech, where the follower is above a half: no more
        # than the duck and the carve, and most of them.
        self.assertTrue(-2.0 <= lad["duck_db"] < -1.2, lad["duck_db"])
        self.assertTrue(-3.0 <= lad["carve_db"] < -1.8, lad["carve_db"])
        self.assertTrue(-2.0 <= lad["pad_dip_db"] < -1.0, lad["pad_dip_db"])

    def test_each_mark_is_at_the_ladders_level(self):
        marks = self.report["marks"]
        self.assertEqual([m["mark"] for m in marks], ["entrance", "exit"])
        for m in marks:
            self.assertAlmostEqual(m["span_lufs"], -18.0, delta=0.05, msg=m["mark"])

    def test_the_demo_is_at_its_level_and_the_bed_nine_under_it(self):
        (d,) = self.report["demos"]
        self.assertAlmostEqual(d["demo_lufs"], -18.0, delta=0.05)
        self.assertAlmostEqual(d["demo_over_bed_db"], 9.0, delta=0.6)
        self.assertLess(d["bed_gain_db"], 0)
        self.assertAlmostEqual(d["tail_s"], 0.41, delta=0.06, msg="a 0.12 s time constant falls 30 dB in 0.41 s")

    def test_the_master_is_at_the_ladders_level_under_the_limiters_ceiling(self):
        m = self.report["master"]
        self.assertAlmostEqual(m["integrated_lufs"], -16.0, delta=0.1)
        self.assertLessEqual(m["true_peak_dbtp"], -1.2 + 0.05)

    def test_the_timing_is_reported(self):
        t = self.report["timing"]
        self.assertAlmostEqual(t["entrance_end_to_first_word_s"], 1.75, places=3)
        self.assertAlmostEqual(t["last_word_to_exit_s"], 1.75, places=3)
        self.assertEqual(t["demos"][0]["line_end_to_demo_s"], 0.7)

    def test_the_cues_are_not_laid_and_the_mix_says_so_once(self):
        said = [l for l in self.log.splitlines() if l.startswith("cues:")]
        self.assertEqual(said, ["cues: 2 in cues.json (blip, whoosh) not laid: the films have no cues (ADR-014)"])

    def test_the_mix_is_the_same_without_the_cues(self):
        with_cues = mix.load(os.path.join(self.film.root, "out/f/mix.wav"))
        os.remove(os.path.join(self.film.root, "out/f/cues.json"))
        try:
            _, log = self.film.mix()
            without = mix.load(os.path.join(self.film.root, "out/f/mix.wav"))
        finally:
            self.film.json("out/f/cues.json", [{"name": "whoosh", "t": 1.0}, {"name": "blip", "t": 2.0}])
        self.assertNotIn("cues:", log)
        self.assertTrue(np.array_equal(with_cues, without))


@unittest.skipUnless(HAVE_AUDIO, "mix.py needs numpy and scipy (make film-setup)")
class AFilmNotYetOnN3(unittest.TestCase):
    """A film still on Study: its bed as one sound (bed.wav), at the ladder's
    level and duck, with its bed levels; and a mix with no bed at all."""

    def setUp(self):
        self.film = Film().__enter__()
        root = self.film.root
        os.makedirs(os.path.join(root, "bed"))
        bed = tone(220, Film.DURATION, -26) + tone(1760, Film.DURATION, -40)
        mix.write(os.path.join(root, "bed", "bed.wav"), bed)
        with open(os.path.join(root, "films/f/timeline.json")) as f:
            tl = json.load(f)
        tl.pop("demos")
        tl.pop("marks")
        self.film.json("films/f/timeline.json", tl)
        # The old rule: the bed out from 13 s to 20 s.
        self.film.json("films/f/arrangement.json", {"bed": "study", "sections": [], "levels": [[0.0, 0], [13.0, -60], [20.0, 0]]})

    def tearDown(self):
        self.film.__exit__()

    def run_mix(self, *args):
        saved = mix.VIDEO, sys.argv
        mix.VIDEO = self.film.root
        sys.argv = ["mix.py", "f", "--voice", os.path.join(self.film.root, "voice"), *args]
        out = io.StringIO()
        try:
            with contextlib.redirect_stdout(out):
                mix.main()
        finally:
            mix.VIDEO, sys.argv = saved
        with open(os.path.join(self.film.root, "out/f/ladder.json")) as f:
            return json.load(f), out.getvalue()

    def test_its_bed_is_mixed_as_one_sound_to_the_ladder_with_its_levels(self):
        report, log = self.run_mix("--music", os.path.join(self.film.root, "bed"))
        lad = report["ladder"]
        self.assertAlmostEqual(lad["voice_lufs"], -18.0, delta=0.05)
        # The whole bed is set to the ladder, then its levels take it out for
        # a while; measured where the voice speaks, the 0.4 s ramps show.
        self.assertAlmostEqual(lad["bed_rest_vs_voice_lu"], -3.0, delta=0.3)
        self.assertTrue(-2.0 <= lad["duck_db"] < -1.2, lad["duck_db"])
        self.assertTrue(-3.0 <= lad["carve_db"] < -1.8, lad["carve_db"])
        self.assertIsNone(lad["pad_dip_db"], "a bed as one sound has no pad to dip")
        self.assertIn("music: 3 bed levels", log)
        mixed = mix.load(os.path.join(self.film.root, "out/f/mix.wav"))
        self.assertLess(level_db(mixed[int(14.5 * SR):int(18.5 * SR)]), level_db(mixed[int(0.5 * SR):int(6.5 * SR)]) - 40,
                        "the bed is out where its level says -60")
        self.assertEqual(report["marks"], [])

    def test_a_mix_with_no_bed_still_runs_and_says_what_it_has(self):
        report, log = self.run_mix()
        self.assertIsNone(report["ladder"]["bed_rest_vs_voice_lu"])
        self.assertIn("ladder: voice -18.0 LUFS, bed at rest – LU, under the voice – dB", log)


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
    print(f"  mix tests: {result.testsRun - len(result.skipped)} passed{skipped}")
