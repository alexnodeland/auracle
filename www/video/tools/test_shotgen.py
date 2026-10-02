#!/usr/bin/env python3
"""shotgen.py's cast: the films' shots play presets from the shortlist in
www/brand/sound.json, or say why not.

    python3 www/video/tools/test_shotgen.py      (run by `make dev-check`)

Plain files and the standard library: no browser, no audio.
"""
import contextlib
import io
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import shotgen  # noqa: E402
import sound_defaults  # noqa: E402

def spec(*shots, setup=()):
    return {"viewport": [1920, 1080], "dpr": 1, "query": "?film", "init": "", "setup": list(setup), "shots": list(shots)}


def shot(sid, setup=(), actions=(), **kw):
    return {"id": sid, "beat": sid, "pre": 0.5, **kw, "setup": list(setup), "marks": {}, "actions": list(actions)}


class TheShortlist(unittest.TestCase):
    def test_is_sound_jsons(self):
        with open(os.path.join(HERE, "..", "..", "brand", "sound.json"), encoding="utf-8") as f:
            roles = json.load(f)["cast"]["shortlist"]["roles"]
        self.assertEqual(shotgen.SHORTLIST, [n for names in roles.values() for n in names])
        self.assertEqual(len(shotgen.SHORTLIST), 16)

    def test_every_role_is_cast_from_it(self):
        for role, name in shotgen.CAST.items():
            self.assertIn(name, shotgen.SHORTLIST, role)

    def test_a_preset_off_it_is_refused(self):
        with self.assertRaises(ValueError):
            shotgen.cast("Glass Pad")

    def test_a_wiring_the_shot_needs_is_checked(self):
        self.assertEqual(shotgen.cast("Morph Pad", Space="up", Grit="search"), "Morph Pad")
        with self.assertRaises(ValueError):
            shotgen.cast("Slow Weather", Space="up")

    def test_the_cast_card_on_the_warm_start_is_any_on_the_list(self):
        sel = shotgen.pick("cast", " + .wi-play")
        self.assertEqual(sel.count(".warm-item:has"), len(sound_defaults.SHORTLIST["roles"]["pads_and_textures"])
                         + len(sound_defaults.SHORTLIST["roles"]["soft_leads"])
                         + len(sound_defaults.SHORTLIST["roles"]["low_and_burbling"]))


class WhatAShotPlays(unittest.TestCase):
    def test_loads_opens_and_warm_start_plays(self):
        steps = [
            {"op": "preset", "name": "Slow Weather"},
            {"op": "seq", "steps": [{"op": "click", "sel": ".bank-item.preset-item:has(.bi-name:text-is('Bell Jar'))"}]},
            {"op": "click", "sel": shotgen.pick("cast", " + .wi-play")},
            {"op": "click", "sel": shotgen.pick("bass", " + .wi-play")},
            {"op": "click", "sel": shotgen.pick("bass")},  # picked, not heard
            {"op": "hold", "keys": ["a"], "ms": 300},
        ]
        self.assertEqual(shotgen.plays(steps), ["Slow Weather", "Bell Jar", "the shortlist", shotgen.WARM_CARD])


class Dump(unittest.TestCase):
    def setUp(self):
        self.out = os.path.join(os.environ.get("TMPDIR", "/tmp"), f"test_shotgen_{os.getpid()}.json")

    def tearDown(self):
        if os.path.exists(self.out):
            os.remove(self.out)

    def test_refuses_an_off_list_preset_with_no_reason(self):
        s = spec(shot("a", setup=[{"op": "preset", "name": "Glass Pad"}]))
        with self.assertRaises(SystemExit) as e:
            shotgen.dump(s, self.out)
        self.assertIn("a: Glass Pad", str(e.exception))
        self.assertFalse(os.path.exists(self.out))

    def test_takes_one_with_a_reason_and_says_so(self):
        s = spec(shot("a", setup=[{"op": "preset", "name": "Loom"}], uncast={"Loom": "its line names it"}),
                 shot("b", setup=[{"op": "preset", "name": "Slow Weather"}]))
        log = io.StringIO()
        with contextlib.redirect_stdout(log):
            shotgen.dump(s, self.out)
        self.assertIn("uncast a: Loom (its line names it)", log.getvalue())
        written = {sh["id"]: sh for sh in json.load(open(self.out))["shots"]}
        self.assertEqual(written["b"]["cast"], ["Slow Weather"])
        self.assertNotIn("cast", written["a"])
        self.assertEqual(written["a"]["uncast"], {"Loom": "its line names it"})

    def test_refuses_a_reason_for_what_it_does_not_play(self):
        s = spec(shot("a", setup=[{"op": "preset", "name": "Slow Weather"}], uncast={"Loom": "stale"}))
        with self.assertRaises(SystemExit):
            shotgen.dump(s, self.out)


if __name__ == "__main__":
    out = io.StringIO()
    result = unittest.TextTestRunner(stream=out, verbosity=0).run(unittest.defaultTestLoader.loadTestsFromModule(sys.modules[__name__]))
    if not result.wasSuccessful():
        print(out.getvalue())
        sys.exit(1)
    print(f"  shotgen tests: {result.testsRun} passed")
