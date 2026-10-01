#!/usr/bin/env python3
"""The films' sound: sound.py's generation and its drift check.

    python3 www/brand/test_sound.py      (run by `make dev-check`)
    AURACLE_RENDER_SCORES=1 python3 www/brand/test_sound.py
                                         also render every generated score
                                         with the engine, and check each stock
                                         knob value against its preset (cargo;
                                         under a minute once it is built)

The check's cases run on a throwaway copy of every file it reads, so a planted
edit never touches the tree. Python 3 standard library only.
"""

import contextlib
import glob
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import sound as S  # noqa: E402


class Tree:
    """A copy of sound.json, the scores it names, what it generates, the bank
    and the film tools the check scans."""

    def __enter__(self):
        self.root = tempfile.mkdtemp(prefix="sound-")
        src = S.load()
        files = {S.SOURCE, S.PRESETS, *S.outputs(src)}
        files |= {block["score"] for _, block in S.scores(src)} | {src["cast"]["parts"]["demo"]["heard_in"]}
        files |= {os.path.relpath(f, S.ROOT) for g in S.LEVEL_FILES for f in glob.glob(os.path.join(S.ROOT, g))}
        for rel in files:
            dst = os.path.join(self.root, rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copyfile(os.path.join(S.ROOT, rel), dst)
        self.real, S.ROOT = S.ROOT, self.root
        return self

    def __exit__(self, *exc):
        S.ROOT = self.real
        shutil.rmtree(self.root)

    def read(self, rel):
        with open(os.path.join(self.root, rel), encoding="utf-8") as f:
            return f.read()

    def edit(self, rel, fn):
        text = self.read(rel)
        with open(os.path.join(self.root, rel), "w", encoding="utf-8") as f:
            f.write(fn(text))

    def edit_source(self, fn):
        src = json.loads(self.read(S.SOURCE))
        fn(src)
        self.edit(S.SOURCE, lambda _: json.dumps(src, indent=2, ensure_ascii=False) + "\n")

    def generate(self):
        with contextlib.redirect_stdout(io.StringIO()):
            return S.generate(check=False)

    def problems(self):
        return S.generate(check=True) or S.scan()


def score(rel):
    with open(os.path.join(S.ROOT, rel), encoding="utf-8") as f:
        return json.load(f)


class TheCheck(unittest.TestCase):
    def test_the_tree_as_committed_passes(self):
        with Tree() as t:
            self.assertEqual(t.problems(), [])

    def test_generation_is_deterministic(self):
        src = S.load()
        first, second = S.outputs(src), S.outputs(S.load())
        self.assertEqual(first, second)
        with Tree() as t:
            for rel in first:
                os.remove(os.path.join(t.root, rel))
            self.assertEqual(t.generate(), [])
            for rel, text in first.items():
                self.assertEqual(t.read(rel), text, rel)
            self.assertEqual(t.generate(), [])

    def test_a_hand_edit_to_a_generated_score_fails_the_check(self):
        with Tree() as t:
            t.edit("www/video/sound/bloom.json", lambda s: s.replace('"amp#release": 0.45', '"amp#release": 0.3', 1))
            self.assertEqual(t.problems(), ["www/video/sound/bloom.json: stale or edited by hand; run `make sound`"])

    def test_a_hand_edit_to_the_mix_defaults_fails_the_check(self):
        with Tree() as t:
            t.edit(S.DEFAULTS, lambda s: s.replace('"duck_db": -9', '"duck_db": -8', 1))
            self.assertEqual(t.problems(), [f"{S.DEFAULTS}: stale or edited by hand; run `make sound`"])

    def test_a_deleted_generated_file_fails_the_check(self):
        with Tree() as t:
            os.remove(os.path.join(t.root, "www/video/sound/n3.json"))
            self.assertEqual(t.problems(), ["www/video/sound/n3.json: missing; run `make sound`"])

    def test_a_knob_changed_in_the_source_reaches_every_score_that_plays_it(self):
        with Tree() as t:
            t.edit_source(lambda src: src["cast"]["parts"]["lead"]["knobs"]["amp#release"].update(used=0.5))
            stale = t.problems()
            self.assertEqual(sorted(stale), sorted(f"{p}: stale or edited by hand; run `make sound`" for p in (
                "www/video/sound/bloom.json", "www/video/sound/reach.json", "www/video/sound/n3.json")))
            t.generate()
            self.assertEqual(t.problems(), [])
            for name in ("bloom", "reach", "n3"):
                leads = [x for x in score(f"www/video/sound/{name}.json")["tracks"] if x["preset"] == "Wobble Board"]
                self.assertTrue(leads, name)
                self.assertEqual({x["params"]["amp#release"] for x in leads}, {0.5}, name)

    def test_the_drones_breath_comes_from_the_source(self):
        with Tree() as t:
            t.edit_source(lambda src: src["cast"]["parts"]["drone"]["breath"].update(low=0.48, high=0.62))
            t.generate()
            drone = next(x for x in score("www/video/sound/n3.json")["tracks"] if x["name"] == "drone")
            values = [p[3] for p in drone["automation"][0]["points"]]
            self.assertEqual(values[:3], [0.48, 0.62, 0.48])
            self.assertEqual(set(values), {0.48, 0.62})

    def test_a_preset_not_in_the_bank_fails_the_check(self):
        with Tree() as t:
            t.edit_source(lambda src: src["cast"]["parts"]["burble"].update(preset="Held Over"))
            self.assertEqual(t.problems(), [
                f"{S.SOURCE}: `cast.parts.burble`: no preset 'Held Over' in the bank ({S.PRESETS})"])

    def test_a_knob_outside_its_range_fails_the_check(self):
        with Tree() as t:
            t.edit_source(lambda src: src["cast"]["parts"]["lead"]["knobs"]["node#cut"].update(used=58))
            self.assertEqual(t.problems(), [
                f"{S.SOURCE}: `cast.parts.lead.knobs.node#cut.used` is not a knob value (0-1)"])

    def test_a_breath_outside_its_range_fails_the_check(self):
        with Tree() as t:
            t.edit_source(lambda src: src["cast"]["parts"]["drone"]["breath"].update(low=0.6))
            self.assertEqual(t.problems(), [
                f"{S.SOURCE}: `cast.parts.drone.breath` must run 0 <= low <= stock <= high <= 1, low below high"])

    def test_a_part_that_turns_the_rooms_knob_fails_the_check(self):
        with Tree() as t:
            t.edit_source(lambda src: src["cast"]["parts"]["bed_pad"]["knobs"].update(
                {"node#rmix": {"stock": 0.5, "used": 0.3}}))
            self.assertEqual(t.problems(), [
                f"{S.SOURCE}: `cast.parts.bed_pad` turns node#rmix, but the room (`cast.room`) stays at its stock"])


class WhatTheRecordsHold(unittest.TestCase):
    """The values sound.json holds that describe the records' notes rather
    than being written into them: each change the scores do not make fails."""

    def fails(self, edit, *expect):
        with Tree() as t:
            t.edit_source(edit)
            problems = t.problems()
            self.assertTrue(problems, "the check passed")
            for want in expect:
                self.assertTrue(any(want in p for p in problems), f"{want!r} not in {problems}")
            # Nothing is written while the source disagrees with the records.
            self.assertEqual(t.generate(), problems)

    def test_a_voicing(self):
        self.fails(lambda s: s["bed"]["parts"]["pad"]["voicings"].update({"G6/F": ["B3", "D4", "E4", "A4"]}),
                   "`bed.parts.pad.voicings.G6/F` is B3 D4 E4 A4, but docs/notes/sound-2026-09/scores/n3.json's "
                   "pad sounds B3 D4 E4 G4 at bar 3")

    def test_a_burble_cell_and_its_rhythm(self):
        self.fails(lambda s: s["bed"]["parts"]["burble"]["cells"].update({"Bbm6/F": ["Db3", "Bb3", "F3"]}),
                   "cell Db3 Bb3 F3 on Bbm6/F")
        self.fails(lambda s: s["bed"]["parts"]["burble"].update(step_beats=0.5), "every 0.5 beat")
        self.fails(lambda s: s["bed"]["parts"]["burble"]["velocity"].update(depth=0.2), "`bed.parts.burble.velocity`")

    def test_a_sigh_and_its_shape(self):
        self.fails(lambda s: s["bed"]["parts"]["melody"]["sighs"].update({"Fmaj9": ["G5", "E5"]}),
                   "`bed.parts.melody.sighs.Fmaj9` is G5 E5")
        self.fails(lambda s: s["bed"]["parts"]["melody"].update(shape_beats=[2, 2]), "`bed.parts.melody.shape_beats`")

    def test_the_leads_legato_and_swell(self):
        self.fails(lambda s: s["cast"]["parts"]["lead"]["legato"].update(s=0.1), "`cast.parts.lead.legato.s` is 0.1")
        self.fails(lambda s: s["cast"]["parts"]["lead"]["swell"].update(marks_s=1.5), "m2_bloom.json's E5 (mel4)")
        self.fails(lambda s: s["cast"]["parts"]["lead"]["swell"].update(bed_beats=2), "n3.json's E5 (mel2)")

    def test_the_pedal_and_the_marks_length(self):
        self.fails(lambda s: s["key"].update(pedal=["F2", "F3"]), "`key.pedal` is F2 F3")
        self.fails(lambda s: s["marks"].update(length_s=5), "`marks.length_s` is 5")

    def test_the_demo_against_the_reel(self):
        self.fails(lambda s: s["cast"]["parts"]["demo"]["knobs"]["amp#release"].update(used=0.6),
                   "`cast.parts.demo.knobs`")
        self.fails(lambda s: s["cast"]["parts"]["demo"]["bright"].update(over_beats=4), "`cast.parts.demo.bright`")


class ThePlantedLevels(unittest.TestCase):
    def test_a_level_written_into_a_pipeline_fails_the_check(self):
        # How the duck came to have three values: each pipeline passed its own.
        with Tree() as t:
            t.edit("www/video/tools/walkthrough.sh",
                   lambda s: s.replace('${DUCK_DB:+--duck-db "$DUCK_DB"}', '--duck-db "${DUCK_DB:--9}"', 1))
            problems = t.problems()
            self.assertEqual(len(problems), 1, problems)
            self.assertRegex(problems[0], r"^www/video/tools/walkthrough\.sh:\d+: a numeric fallback for DUCK_DB")

    def test_a_number_as_mix_pys_default_fails_the_check(self):
        with Tree() as t:
            t.edit("www/video/tools/mix.py",
                   lambda s: s.replace('default=sound_defaults.MIX_NOW["duck_db"]', "default=-8.0", 1))
            problems = t.problems()
            self.assertEqual(len(problems), 1, problems)
            self.assertRegex(problems[0], r"^www/video/tools/mix\.py:\d+: a number as the default of --duck-db")

    def test_a_negative_number_as_mix_pys_default_fails_the_check_however_it_is_written(self):
        with Tree() as t:
            t.edit("www/video/tools/mix.py",
                   lambda s: s.replace('default=sound_defaults.MIX_NOW["music_db"]', "default = -(6)", 1))
            problems = t.problems()
            self.assertEqual(len(problems), 1, problems)
            self.assertRegex(problems[0], r"^www/video/tools/mix\.py:\d+: a number as the default of --music-db")

    def test_a_level_quoted_in_a_docstring_help_string_or_comment_passes(self):
        # Task 3 will write the new levels into prose like this.
        with Tree() as t:
            t.edit("www/video/tools/mix.py", lambda s: s.replace(
                '"""Lay a film\'s sound in', '"""(The new mix: --music-db -3 --duck-db -2.) Lay a film\'s sound in', 1
            ).replace(
                'help="the music\'s duck under the voice (default: sound.json mix_now)"',
                'help="the music\'s duck under the voice, e.g. --duck-db -2 (default: sound.json mix_now)"', 1))
            t.edit("www/video/tools/walkthrough.sh", lambda s: s.replace(
                '${DUCK_DB:+--duck-db "$DUCK_DB"})',
                '${DUCK_DB:+--duck-db "$DUCK_DB"})  # the spec: --duck-db -2, DUCK_DB:--2', 1
            ) + "# MUSIC_DB:--3 and --music-db -3 come with task 3\n")
            self.assertIn("--music-db -3 --duck-db -2.)", t.read("www/video/tools/mix.py"))
            self.assertIn("e.g. --duck-db -2", t.read("www/video/tools/mix.py"))
            self.assertIn("# the spec: --duck-db -2", t.read("www/video/tools/walkthrough.sh"))
            self.assertEqual(t.problems(), [])

    def test_a_shell_comment_starts_a_word_outside_quotes(self):
        self.assertEqual(S.shell_code('X=1 # --duck-db -9'), "X=1 ")
        self.assertEqual(S.shell_code('echo "a # b" # c'), 'echo "a # b" ')
        self.assertEqual(S.shell_code("echo 'a # b'"), "echo 'a # b'")
        self.assertEqual(S.shell_code('n=${#A[@]} $# x\\#y'), 'n=${#A[@]} $# x\\#y')
        self.assertEqual(S.shell_code('echo "say \\"#\\"" #c'), 'echo "say \\"#\\"" ')


class TheScores(unittest.TestCase):
    def test_each_score_keeps_its_records_notes_and_takes_the_cast(self):
        src = S.load()
        parts = src["cast"]["parts"]
        for where, block in S.scores(src):
            gen, rec = score(block["out"]), score(block["score"])
            self.assertTrue(gen["_generated"].startswith(S.GENERATED), block["out"])
            self.assertEqual(gen["title"], block["title"])
            self.assertEqual(gen["sections"], rec["sections"], block["out"])
            self.assertEqual([x["name"] for x in gen["tracks"]], [x["name"] for x in rec["tracks"]])
            for g, r in zip(gen["tracks"], rec["tracks"]):
                self.assertEqual(g.get("notes"), r.get("notes"), f"{block['out']} {g['name']}")
                part = parts[S.part_of(g["name"], block["tracks"])]
                self.assertEqual(g["preset"], part["preset"])
                self.assertEqual(g["params"], {k: v["used"] for k, v in part["knobs"].items()})

    def test_the_scores_cast_is_the_one_the_finals_used(self):
        # sound.json as committed reproduces the records exactly: the same
        # preset, voices, trim, transpose and knobs on every track.
        src = S.load()
        for _, block in S.scores(src):
            gen, rec = score(block["out"]), score(block["score"])
            for g, r in zip(gen["tracks"], rec["tracks"]):
                for k in ("preset", "voices", "trim_db", "transpose", "params", "pitch_drop", "automation"):
                    self.assertEqual(g.get(k), r.get(k), f"{block['out']} {g['name']} {k}")

    def test_the_wobble_board_lead_holds_and_releases_as_chosen(self):
        lead = S.load()["cast"]["parts"]["lead"]["knobs"]
        self.assertEqual((lead["amp#sustain"]["used"], lead["amp#release"]["used"]), (0.8, 0.45))


@unittest.skipUnless(os.environ.get("AURACLE_RENDER_SCORES") == "1", "set AURACLE_RENDER_SCORES=1 to render with cargo")
class EachScoreRenders(unittest.TestCase):
    def test_each_generated_score_renders_and_plays(self):
        src = S.load()
        out = tempfile.mkdtemp(prefix="sound-render-")
        try:
            for where, block in S.scores(src):
                with self.subTest(score=block["out"]):
                    run = subprocess.run(
                        ["cargo", "run", "-q", "--release", "-p", "auracle-wasm", "--example", "score", "--",
                         os.path.join(S.ROOT, block["out"]), out, "--jobs", "3"],
                        cwd=S.ROOT, capture_output=True, text=True)
                    self.assertEqual(run.returncode, 0, run.stderr[-2000:])
                    slug = "".join(c.lower() if c.isalnum() else "_" for c in block["title"]).strip("_")
                    man = json.load(open(os.path.join(out, slug, "manifest.json")))
                    self.assertEqual(man["title"], block["title"])
                    gen = score(block["out"])
                    for f in man["files"]:
                        self.assertGreater(f["peak_dbfs"], -40, f"{block['out']} {f['file']} is silent")
                        self.assertLessEqual(f["true_peak_dbtp"], -0.99, f"{block['out']} {f['file']} clips")
                        stems = {st["track"]: st for st in f["stems"]}
                        for t in gen["tracks"]:
                            self.assertIn(t["name"], stems, f"{block['out']}: {t['name']} made no sound")
                            self.assertGreater(stems[t["name"]]["peak_dbfs"], -60, f"{block['out']}: {t['name']}")
                            self.assertFalse(stems[t["name"]]["instrument_limited"], f"{block['out']}: {t['name']}")
                    knobs = {t["name"]: dict(t["knobs"]) for t in man["tracks"]}
                    for t in gen["tracks"]:
                        self.assertEqual(knobs[t["name"]], t["params"], f"{block['out']}: {t['name']}'s knobs")
        finally:
            shutil.rmtree(out)

    def test_each_knobs_stock_value_is_the_presets_own(self):
        src = S.load()
        for name, part in src["cast"]["parts"].items():
            with self.subTest(part=name):
                run = subprocess.run(
                    ["cargo", "run", "-q", "--release", "-p", "auracle-wasm", "--example", "score", "--",
                     "--list-params", part["preset"]],
                    cwd=S.ROOT, capture_output=True, text=True)
                self.assertEqual(run.returncode, 0, run.stderr[-2000:])
                live = {}
                for line in run.stdout.splitlines():
                    bits = line.split()
                    if len(bits) == 2 and "#" in bits[0]:
                        live[bits[0]] = float(bits[1])
                for knob, v in part["knobs"].items():
                    self.assertIn(knob, live, f"{part['preset']} has no live knob {knob}")
                    self.assertAlmostEqual(live[knob], v["stock"], places=4, msg=f"{part['preset']} {knob}")
                room = src["cast"]["room"]
                if part["preset"] == room["preset"]:
                    for knob, stock in room["stock"].items():
                        self.assertAlmostEqual(live[knob], stock, places=4, msg=f"{part['preset']} {knob}")
                if "breath" in part:
                    b = part["breath"]
                    self.assertAlmostEqual(live[b["param"]], b["stock"], places=4, msg=f"{part['preset']} breath")


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
    print(f"  sound tests: {result.testsRun - len(result.skipped)} passed{skipped}")
