#!/usr/bin/env python3
"""mix.py: a cue with no WAV stops the mix before any audio is read, and the
bed's level and duck are read from one source.

    python3 www/video/tools/test_mix.py      (run by `make dev-check`)

The cue tests import mix.py, which needs numpy and scipy (the film tools'
packages, in .venv-voice); without them they are skipped. `make dev-check`
runs this on .venv-voice when it exists.
"""

import importlib.util
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

HAVE_AUDIO = all(importlib.util.find_spec(m) for m in ("numpy", "scipy"))


@unittest.skipUnless(HAVE_AUDIO, "mix.py needs numpy and scipy (make film-setup)")
class ACue(unittest.TestCase):
    def setUp(self):
        import mix

        self.mix = mix
        self.dir = tempfile.mkdtemp(prefix="sfx-")
        open(os.path.join(self.dir, "whoosh.wav"), "wb").close()

    def tearDown(self):
        for f in os.listdir(self.dir):
            os.remove(os.path.join(self.dir, f))
        os.rmdir(self.dir)

    def test_a_cue_with_no_wav_stops_the_mix_and_names_it(self):
        cues = [{"name": "whoosh", "t": 1.0}, {"name": "render_glass_pad", "t": 2.0}, {"name": "blip", "t": 3.0}]
        with self.assertRaises(SystemExit) as stop:
            self.mix.cue_files(cues, self.dir)
        message = str(stop.exception.code)
        self.assertIn("blip, render_glass_pad", message)
        self.assertNotIn("whoosh", message)

    def test_every_cue_with_a_wav_is_laid_in(self):
        files = self.mix.cue_files([{"name": "whoosh", "t": 1.0}, {"name": "whoosh", "t": 4.0}], self.dir)
        self.assertEqual(files, {"whoosh": os.path.join(self.dir, "whoosh.wav")})

    def test_no_cues_need_no_wavs(self):
        self.assertEqual(self.mix.cue_files([], self.dir), {})

    def test_the_mix_stops_on_a_missing_cue_before_it_reads_any_audio(self):
        # A film with a line of narration and a cue whose WAV is missing, in a
        # throwaway copy of www/video/. mix.py must stop before it loads the
        # voice: a mix that died after minutes of loading would be the same
        # bug, found late.
        root = tempfile.mkdtemp(prefix="mix-")
        voice = os.path.join(root, "voice")
        for d in ("films/f", "out/f", "voice"):
            os.makedirs(os.path.join(root, d))
        with open(os.path.join(root, "films/f/timeline.json"), "w") as f:
            json.dump({"duration": 2.0, "lines": [{"id": "l1", "t0": 0.0, "t1": 1.0, "text": "A line."}]}, f)
        with open(os.path.join(voice, "manifest.json"), "w") as f:
            json.dump({"lines": [{"id": "l1", "file": "l1.wav"}]}, f)
        with open(os.path.join(root, "out/f/cues.json"), "w") as f:
            json.dump([{"name": "whoosh", "t": 0.2, "gain": 0}, {"name": "render_glass_pad", "t": 0.5, "gain": -6}], f)
        read = []
        saved = self.mix.VIDEO, self.mix.load, sys.argv
        self.mix.VIDEO = root
        self.mix.load = read.append
        sys.argv = ["mix.py", "f", "--voice", voice, "--sfx", self.dir]
        try:
            with self.assertRaises(SystemExit) as stop:
                self.mix.main()
        finally:
            self.mix.VIDEO, self.mix.load, sys.argv = saved
            shutil.rmtree(root)
        self.assertIn("render_glass_pad", str(stop.exception.code))
        self.assertEqual(read, [], "mix.py read audio before it checked the cues")

    def test_the_bed_and_duck_defaults_are_read_from_mix_now(self):
        # Not only equal to today's values: read from sound_defaults, so a
        # change to sound.json's `mix_now` reaches mix.py.
        saved = sound_defaults.MIX_NOW
        sound_defaults.MIX_NOW = {"music_db": -1.25, "duck_db": -3.5}
        try:
            args = self.mix.parser().parse_args(["f"])
        finally:
            sound_defaults.MIX_NOW = saved
        self.assertIs(self.mix.sound_defaults, sound_defaults)
        self.assertEqual((args.music_db, args.duck_db), (-1.25, -3.5))


class TheLevels(unittest.TestCase):
    def test_the_films_keep_todays_bed_and_duck_until_the_new_mix(self):
        # illustrated.sh and walkthrough.sh used to pass -6 and -9 themselves,
        # and mix.py's own default duck was -8. They now all take sound.json's
        # `mix_now`, which must stay at what the pipelines passed until
        # Plan-006 task 3 moves the mix to the ladder (the bed at -3 LU, a 2 dB
        # duck), so that no film's mix changes before then.
        self.assertEqual(sound_defaults.MIX_NOW, {"music_db": -6, "duck_db": -9})


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
