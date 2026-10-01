#!/usr/bin/env python3
"""mix.py: a cue with no WAV stops the mix.

    python3 www/video/tools/test_mix.py      (run by `make dev-check`)

The cue tests import mix.py, which needs numpy and scipy (the film tools'
packages, in .venv-voice); without them they are skipped. `make dev-check`
runs this on .venv-voice when it exists.
"""

import importlib.util
import io
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

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
