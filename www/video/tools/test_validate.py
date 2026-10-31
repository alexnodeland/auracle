#!/usr/bin/env python3
"""validate.mjs and framing.mjs on every kind of film: a walkthrough (its shots
and its plan), an illustrated film that cuts to takes of the app (its shots
only, as launch does; film.js is never run), and one drawn with no takes at
all. A broken reference exits 1 on a scratch copy, and a committed film does
not.

    python3 www/video/tools/test_validate.py      (run by `make dev-check`)

Needs node. Plain files and the standard library: no browser, no audio.
"""
import copy
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
FILMS = os.path.join(os.path.dirname(HERE), "films")


def node(tool, film, films=None):
    """(exit code, stdout, stderr) of `node tools/<tool> film`, reading the
    films from `films` when it is given."""
    env = {k: v for k, v in os.environ.items() if k != "FILMS_DIR"}
    if films:
        env["FILMS_DIR"] = films
    r = subprocess.run(["node", os.path.join(HERE, tool), film], env=env, capture_output=True, text=True, timeout=120)
    return r.returncode, r.stdout, r.stderr


def read_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_json(path, value):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(value, f)


class Scratch(unittest.TestCase):
    """A directory of films of our own, to plant a defect in."""

    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="test-validate-")
        self.addCleanup(shutil.rmtree, self.dir, ignore_errors=True)

    def copy_film(self, film, files=("timeline.json", "shots.json", "film.js", "cards.js")):
        dest = os.path.dirname(self.path(film, "timeline.json"))
        for name in files:
            src = os.path.join(FILMS, film, name)
            if os.path.exists(src):
                shutil.copy(src, dest)
        return dest

    def write(self, film, name, text):
        with open(self.path(film, name), "w", encoding="utf-8") as f:
            f.write(text)

    def synthetic(self, film="syn", js="", shots=True):
        """A film of one beat `a`, one line `l1` ("Play the keys") and, unless
        `shots` is off, one shot `s`; `js` is its film.js."""
        write_json(self.path(film, "timeline.json"), {
            "film": film,
            "lines": [{"id": "l1", "text": "Play the keys", "t0": 1.0, "t1": 2.0}],
            "beats": [{"id": "a", "t0": 0.0, "t1": 4.0}],
        })
        if shots:
            write_json(self.path(film, "shots.json"),
                       {"shots": [{"id": "s", "beat": "a", "actions": [{"at": "l1:keys", "op": "click", "sel": "x"}]}]})
        if js:
            self.write(film, "film.js", js)
        return film

    def path(self, film, name):
        os.makedirs(os.path.join(self.dir, film), exist_ok=True)
        return os.path.join(self.dir, film, name)

    def run_node(self, film, tool="validate.mjs"):
        return node(tool, film, self.dir)

    def problems(self, film):
        code, out, err = self.run_node(film)
        self.assertEqual(code, 1, out + err)
        return out + err


class AnIllustratedFilmWithTakes(Scratch):
    """launch: drawn on the stage, cuts to takes of the app (shots.json)."""

    def test_the_committed_film_is_clean(self):
        code, out, err = node("validate.mjs", "launch")
        self.assertEqual(code, 0, out + err)
        self.assertIn("launch: ok", out)

    def test_its_film_js_is_not_run(self):
        # Its copy sits where film.js's relative imports (the stage, the kit)
        # resolve to nothing, and build() draws on a DOM: run, it would crash.
        self.copy_film("launch")
        code, out, err = self.run_node("launch")
        self.assertEqual(code, 0, out + err)
        self.assertIn("launch: ok", out)

    def test_a_word_that_is_not_in_the_line_fails(self):
        self.copy_film("launch")
        path = os.path.join(self.dir, "launch", "shots.json")
        spec = read_json(path)
        action = next(a for sh in spec["shots"] for a in sh["actions"] if re.match(r"^\w+:\w+", str(a.get("at"))))
        line = action["at"].split(":")[0]
        action["at"] = f"{line}:nosuchword"
        write_json(path, spec)
        out = self.problems("launch")
        self.assertIn(f'footage finds no word "nosuchword" in {line}', out)
        self.assertIn(f'walk finds no "nosuchword" in {line}', out)

    def test_a_clip_on_a_line_that_is_not_there_fails(self):
        self.copy_film("launch")
        path = os.path.join(self.dir, "launch", "shots.json")
        spec = read_json(path)
        spec["shots"][0]["clips"] = [["nosuchline:x", 1.0]]
        write_json(path, spec)
        self.assertIn("no line nosuchline", self.problems("launch"))

    def test_a_shot_in_a_beat_that_is_not_there_fails(self):
        self.copy_film("launch")
        path = os.path.join(self.dir, "launch", "shots.json")
        spec = read_json(path)
        spec["shots"][0]["beat"] = "nosuchbeat"
        write_json(path, spec)
        self.assertIn("no beat nosuchbeat", self.problems("launch"))

    def test_it_has_nothing_to_frame(self):
        code, out, err = node("framing.mjs", "launch")
        self.assertEqual(code, 0, err)
        self.assertEqual(json.loads(out), None)
        self.assertIn("nothing to frame", err)

    @unittest.skipUnless(subprocess.run([sys.executable, "-c", "import PIL"], capture_output=True).returncode == 0, "framing.py needs Pillow")
    def test_framing_py_says_so(self):
        r = subprocess.run([sys.executable, os.path.join(HERE, "framing.py"), "launch"], capture_output=True, text=True, timeout=120)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("nothing to frame", r.stdout)


class AFilmDrawnWithNoTakes(Scratch):
    """taste, math, dsp, engine: no shots.json, and a film.js that draws."""

    DRAWS = 'import { el } from "../../stage/stage.js";\nexport async function build(stage) { document.body.append(el("div")); }\n'

    def test_it_says_so_and_passes(self):
        self.synthetic("drawn", js=self.DRAWS, shots=False)
        code, out, err = self.run_node("drawn")
        self.assertEqual(code, 0, out + err)
        self.assertIn("no shots.json", out)
        self.assertIn("nothing to check", out)

    def test_a_walkthrough_named_only_in_a_comment_is_not_one(self):
        js = '// It is not a walkthrough( of the app, and no plan is read from it.\n/* walkthrough(stage, {}) */\n' + self.DRAWS
        self.synthetic("drawn", js=js, shots=False)
        code, out, err = self.run_node("drawn")
        self.assertEqual(code, 0, out + err)

    def test_it_has_nothing_to_frame(self):
        # framing.mjs reads the committed films, and dsp has no plan.
        code, out, err = node("framing.mjs", "dsp")
        self.assertEqual(code, 0, err)
        self.assertEqual(json.loads(out), None)

    def test_a_film_with_no_timeline_fails(self):
        self.write("early", "film.js", self.DRAWS)
        self.assertIn("no timeline.json", self.problems("early"))

    def test_a_film_that_is_not_there_is_a_usage_error(self):
        code, out, err = self.run_node("nosuchfilm")
        self.assertEqual(code, 2, out + err)


class AWalkthrough(Scratch):
    def test_the_committed_films_are_clean(self):
        # The committed films: view-perform and view-patch were checked by
        # hand before this test; the others by the stub it replaced.
        for film in sorted(os.listdir(FILMS)):
            if not os.path.isdir(os.path.join(FILMS, film)):
                continue
            with self.subTest(film=film):
                code, out, err = node("validate.mjs", film)
                self.assertEqual(code, 0, out + err)

    def test_view_perform_and_view_patch_check_their_plans(self):
        for film in ("view-perform", "view-patch"):
            with self.subTest(film=film):
                code, out, err = node("validate.mjs", film)
                self.assertEqual(code, 0, out + err)
                self.assertEqual(out.strip(), f"{film}: ok")

    def test_a_scratch_copy_is_clean(self):
        self.copy_film("view-patch")
        code, out, err = self.run_node("view-patch")
        self.assertEqual(code, 0, out + err)

    def test_a_beat_with_no_plan_entry_fails(self):
        self.copy_film("view-patch")
        path = os.path.join(self.dir, "view-patch", "timeline.json")
        tl = read_json(path)
        tl["beats"].append(copy.deepcopy(tl["beats"][-1]) | {"id": "nosuchbeat"})
        write_json(path, tl)
        self.assertIn("beat nosuchbeat has no plan entry", self.problems("view-patch"))

    def test_a_word_in_the_plan_that_is_not_in_the_line_fails(self):
        self.copy_film("view-patch")
        path = os.path.join(self.dir, "view-patch", "film.js")
        with open(path, encoding="utf-8") as f:
            js = f.read()
        broken = js.replace('"read2:flows"', '"read2:nosuchword"')
        self.assertNotEqual(broken, js, "view-patch's plan no longer has the word this test plants a defect in")
        with open(path, "w", encoding="utf-8") as f:
            f.write(broken)
        self.assertIn('footage finds no word "nosuchword" in read2', self.problems("view-patch"))

    def test_a_plan_with_no_shots_json_fails(self):
        self.copy_film("view-patch")
        os.remove(os.path.join(self.dir, "view-patch", "shots.json"))
        self.assertIn("has no shots.json", self.problems("view-patch"))

    def test_the_standin_brings_in_only_what_the_film_imports(self):
        # The film has its own `aim` and a `clamp` of its own from a sibling
        # module, and reaches that module by a relative path from its own
        # directory: none of it may meet the stand-in for walk.js.
        self.synthetic("syn", js="""
import { walkthrough } from "../../stage/walk.js";
import { clamp, WORD } from "./helper.js";
const aim = (z) => [z, clamp(0.4), 0.5];
export async function build(stage) {
  await walkthrough(stage, { plan: [{ beat: "a", shot: "s", cam: [[`l1:${WORD}`, ...aim(1.2)]] }] });
  const later = await import("./helper.js");
  if (!later.WORD) throw new Error("a dynamic import from the film's directory");
}
""")
        self.write("syn", "helper.js", 'export const clamp = (x) => x;\nexport const WORD = "keys";\n')
        code, out, err = self.run_node("syn")
        self.assertEqual(code, 0, out + err)
        self.write("syn", "helper.js", 'export const clamp = (x) => x;\nexport const WORD = "nosuchword";\n')
        self.assertIn('no word "nosuchword" in l1', self.problems("syn"))

    def test_a_film_that_cannot_be_run_says_why(self):
        # Top-level imports of the stage load a DOM-only module; the plan is
        # read in Node, so the message points to view-perform's way round.
        self.synthetic("syn", js="""
import { walkthrough } from "../../stage/walk.js";
import { el } from "./needs_a_dom.js";
export async function build(stage) { await walkthrough(stage, { plan: [] }); }
""")
        self.write("syn", "needs_a_dom.js", "export const el = getComputedStyle(document.body);\n")
        out = self.problems("syn")
        self.assertIn("could not be run for its plan", out)
        self.assertIn("inside build()", out)

    def test_a_film_that_imports_something_else_from_walk_js_says_so(self):
        self.synthetic("syn", js="""
import { walkthrough, wordTime } from "../../stage/walk.js";
export async function build(stage) { await walkthrough(stage, { plan: [] }); }
""")
        self.assertIn('imports "wordTime" from walk.js', self.problems("syn"))

    def test_the_standin_aim_is_walk_jss(self):
        # aim(1.5, 1005, 390) in view-patch's cold open, from walk.js's formula.
        z = 1.5

        def f(p, span):
            return min(1, max(0, ((p * z) / span - 0.5) / (z - 1)))

        r = subprocess.run(
            ["node", "--input-type=module", "-e",
             f'import {{ loadPlan }} from {json.dumps("file://" + os.path.join(HERE, "plan.mjs"))};'
             f'const plan = await loadPlan({json.dumps(os.path.join(FILMS, "view-patch"))});'
             'console.log(JSON.stringify(plan.find((p) => p.beat === "cold").cam));'],
            capture_output=True, text=True, timeout=120)
        self.assertEqual(r.returncode, 0, r.stderr)
        cam = json.loads(r.stdout)
        want = [z, f(1005, 1920), f(390, 1080)]
        self.assertTrue(any(len(k) == 4 and all(abs(a - b) < 1e-9 for a, b in zip(k[1:], want)) for k in cam), f"{want} not in {cam}")

    def test_framing_reads_the_plan_too(self):
        code, out, err = node("framing.mjs", "view-patch")
        self.assertEqual(code, 0, err)
        self.assertIsInstance(json.loads(out), list)


if __name__ == "__main__":
    unittest.main()
