#!/usr/bin/env python3
"""validate.mjs and framing.mjs on every kind of film: a walkthrough (its shots
and its plan), an illustrated film that cuts to takes of the app (its shots,
and the marks its film.js reads from them, as launch does; film.js is never
run), and one drawn with no takes at all. A broken reference exits 1 on a
scratch copy, and a committed film does not.

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


def without_mark(spec, shot, name):
    """`spec` with the mark `name` no longer measured by `shot`: gone from its
    `marks` and from its `mark` steps, wherever they are nested."""
    def strip(steps):
        keep = []
        for a in steps:
            if a.get("op") == "mark" and a.get("name") == name:
                continue
            if a.get("op") == "seq":
                a = dict(a, steps=strip(a["steps"]))
            keep.append(a)
        return keep

    for sh in spec["shots"]:
        if sh["id"] == shot:
            sh["marks"] = {k: v for k, v in sh.get("marks", {}).items() if k != name}
            sh["actions"] = strip(sh.get("actions", []))
    return spec


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

    def synthetic(self, film="syn", js="", shots=True, marks=None):
        """A film of one beat `a`, one line `l1` ("Play the keys") and, unless
        `shots` is off, one shot `s` (measuring `marks`, name to selector);
        `js` is its film.js."""
        write_json(self.path(film, "timeline.json"), {
            "film": film,
            "lines": [{"id": "l1", "text": "Play the keys", "t0": 1.0, "t1": 2.0}],
            "beats": [{"id": "a", "t0": 0.0, "t1": 4.0}],
        })
        if shots:
            write_json(self.path(film, "shots.json"),
                       {"shots": [{"id": "s", "beat": "a", "marks": marks or {}, "actions": [{"at": "l1:keys", "op": "click", "sel": "x"}]}]})
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

    # The marks launch's film.js reads from each take (a pointer drawn on the
    # control a take measured), by the shot that measures them: `ck?.mark(…)`,
    # `rects?.…` and, through `rail(…)` and `rc(…)`, a local function's literal.
    READS = {
        "l-play": ["bright", "wander"],
        "l-offer": ["offer", "take", "blend"],
        "l-circuit": ["patch", "taste", "learning", "filter", "fc", "strip"],
    }

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

    def measured_by(self, shot):
        """The marks the committed shot measures: its `marks` and `mark` steps."""
        found = set()

        def walk(steps):
            for a in steps:
                if a.get("op") == "mark":
                    found.add(a["name"])
                if a.get("op") == "seq":
                    walk(a["steps"])

        sh = next(x for x in read_json(os.path.join(FILMS, "launch", "shots.json"))["shots"] if x["id"] == shot)
        walk(sh.get("actions", []))
        return found | set(sh.get("marks", {}))

    def test_its_shots_measure_every_mark_it_reads(self):
        # The film is clean (above), and not because the reader found nothing:
        # each shot measures what film.js reads from it, and the tests below
        # take each of them away.
        for shot, names in self.READS.items():
            with self.subTest(shot=shot):
                self.assertLessEqual(set(names), self.measured_by(shot))

    def test_a_mark_it_reads_that_its_shot_does_not_measure_fails(self):
        for shot, names in self.READS.items():
            for name in names:
                with self.subTest(shot=shot, mark=name):
                    self.copy_film("launch")
                    path = os.path.join(self.dir, "launch", "shots.json")
                    write_json(path, without_mark(read_json(os.path.join(FILMS, "launch", "shots.json")), shot, name))
                    out = self.problems("launch")
                    self.assertIn(f'reads the mark "{name}" of take {shot}, but shot {shot} measures no mark "{name}"', out)

    def test_a_shot_with_no_marks_at_all_fails_for_every_one_it_is_read_for(self):
        # Pointers drawn at the kit's estimates, not at what the take measured:
        # `bright` and `wander` of l-play and `take` of l-offer, found missing.
        self.copy_film("launch")
        path = os.path.join(self.dir, "launch", "shots.json")
        spec = read_json(os.path.join(FILMS, "launch", "shots.json"))
        for name in self.READS["l-play"]:
            spec = without_mark(spec, "l-play", name)
        spec = without_mark(spec, "l-offer", "take")
        write_json(path, spec)
        out = self.problems("launch")
        for name, shot in (("bright", "l-play"), ("wander", "l-play"), ("take", "l-offer")):
            self.assertIn(f'reads the mark "{name}" of take {shot}', out)
        self.assertEqual(out.count("reads the mark"), 3, out)

    def test_a_mark_another_shot_measures_does_not_count(self):
        # `bright` is l-offer's and not l-play's: the pointer in PERFORM's scene
        # would still be drawn at an estimate.
        self.copy_film("launch")
        path = os.path.join(self.dir, "launch", "shots.json")
        spec = without_mark(read_json(os.path.join(FILMS, "launch", "shots.json")), "l-play", "bright")
        next(sh for sh in spec["shots"] if sh["id"] == "l-offer")["marks"]["bright"] = "#anything"
        write_json(path, spec)
        self.assertIn('reads the mark "bright" of take l-play', self.problems("launch"))

    def test_a_take_its_shots_json_lacks_fails(self):
        self.copy_film("launch")
        path = os.path.join(self.dir, "launch", "shots.json")
        spec = read_json(path)
        spec["shots"][0]["id"] = "l-renamed"
        write_json(path, spec)
        self.assertIn('reads the take "l-play" but shots.json has no shot l-play', self.problems("launch"))

    def test_it_has_nothing_to_frame(self):
        code, out, err = node("framing.mjs", "launch")
        self.assertEqual(code, 0, err)
        self.assertEqual(json.loads(out), None)

    def test_framing_py_says_so_once(self):
        # It needs no Pillow, so this runs wherever node does (CI's Web job).
        r = subprocess.run([sys.executable, os.path.join(HERE, "framing.py"), "launch"], capture_output=True, text=True, timeout=120)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual((r.stdout + r.stderr).count("nothing to frame"), 1, r.stdout + r.stderr)
        self.assertNotIn("drawn", r.stdout + r.stderr)


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

    def test_a_film_with_no_film_js_has_nothing_to_frame_either(self):
        # zzprobe has shots and no film.js at all: nothing is drawn, and
        # framing.py must not say it is.
        r = subprocess.run([sys.executable, os.path.join(HERE, "framing.py"), "zzprobe"], capture_output=True, text=True, timeout=120)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual((r.stdout + r.stderr).count("nothing to frame"), 1, r.stdout + r.stderr)
        self.assertNotIn("drawn", r.stdout + r.stderr)

    def test_a_film_with_no_timeline_fails(self):
        self.write("early", "film.js", self.DRAWS)
        self.assertIn("no timeline.json", self.problems("early"))

    def test_a_film_that_is_not_there_is_a_usage_error(self):
        code, out, err = self.run_node("nosuchfilm")
        self.assertEqual(code, 2, out + err)


class TheMarksAFilmReads(Scratch):
    """film.js is never run, so what it reads from its takes is found in its
    text (reads.mjs): the marks it names, by the take its block reads."""

    @staticmethod
    def film_js(body, outside=""):
        return ('export async function build(stage) { const takes = {}; scene({ takes }); }\n'
                'function scene({ takes }) {\n  const take = takes["s"];\n  const ck = take;\n'
                f'{body}\n}}\n{outside}\n')

    def check(self, body, outside="", marks=None):
        self.synthetic("syn", js=self.film_js(body, outside), marks={"hood": "#hood"} if marks is None else marks)
        return self.run_node("syn")

    def test_a_measured_mark_passes(self):
        code, out, err = self.check('const p = ck?.mark("hood");')
        self.assertEqual(code, 0, out + err)
        self.assertEqual(out.strip(), "syn: ok (takes only: the film has no walkthrough plan)")

    def test_a_mark_made_mid_shot_by_a_step_is_measured_too(self):
        self.synthetic("syn", js=self.film_js('const p = ck?.mark("late");'))
        path = os.path.join(self.dir, "syn", "shots.json")
        spec = read_json(path)
        spec["shots"][0]["actions"] = [{"op": "seq", "steps": [{"op": "mark", "name": "late", "sel": "#toast"}]}]
        write_json(path, spec)
        code, out, err = self.run_node("syn")
        self.assertEqual(code, 0, out + err)

    def test_each_way_to_spell_a_read_is_seen(self):
        body = """
  const a = take.meta.rects.ghost1;
  const b = take?.meta?.rects?.ghost2;
  const c = take.meta.rects["ghost3"];
  const d = take.meta.rects?.['ghost4'];
  const e = take.meta.rects[`ghost5`];
  const f = ck.mark('ghost6');
  const g = ck?.mark( "ghost7" );
"""
        out = self.problems_of(body)
        for i in range(1, 8):
            self.assertIn(f'reads the mark "ghost{i}" of take s, but shot s measures no mark "ghost{i}"', out)

    def problems_of(self, body, outside="", marks=None):
        self.synthetic("syn", js=self.film_js(body, outside), marks={"hood": "#hood"} if marks is None else marks)
        return self.problems("syn")

    def test_a_read_through_a_local_function_is_seen(self):
        body = """
  const rail = (lv) => ck?.mark(lv);
  const rc = (name, fb) => {
    const r = take?.meta?.rects?.[name];
    return r ? [r.x, r.y] : fb;
  };
  function pick(n) { return take.meta.rects[n]; }
  rail("ghost1"); rc("ghost2", [0, 0]); pick("ghost3");
  rail("hood");
"""
        out = self.problems_of(body)
        for i in range(1, 4):
            self.assertIn(f'reads the mark "ghost{i}" of take s', out)
        self.assertEqual(out.count("reads the mark"), 3, out)

    def test_a_function_that_does_not_read_a_mark_is_not_a_helper(self):
        body = """
  const near = (name) => name.length;
  const other = (n) => take.clips.length + n;
  near("ghost1"); other("ghost2");
"""
        code, out, err = self.check(body)
        self.assertEqual(code, 0, out + err)

    def test_comments_strings_and_regular_expressions_are_not_reads(self):
        body = r"""
  // ck.mark("ghost1")
  /* take.meta.rects.ghost2 */
  const a = "ck.mark('ghost3')";
  const b = `rects?.ghost4 ${a} and ck.mark("ghost5")`;
  const c = /['"]/.test(a) ? ck?.mark("hood") : 6 / 2 / 1;
  const d = a.replace(/\/\*|"/g, "") + 'rects.ghost6';
"""
        code, out, err = self.check(body)
        self.assertEqual(code, 0, out + err)

    def test_a_name_built_at_run_time_is_not_seen(self):
        # The check's limit: it reads what the source says and guesses nothing.
        code, out, err = self.check('const n = "gho" + "st"; const a = take.meta.rects?.[n]; const b = ck?.mark(n);')
        self.assertEqual(code, 0, out + err)

    def test_a_film_that_reads_no_take_is_not_checked(self):
        # `.mark(` of something that is not a take (the kit's mark drawer, say).
        self.synthetic("syn", js='export async function build(stage) { stage.logo.mark("ghost"); }\n', marks={"hood": "#hood"})
        code, out, err = self.run_node("syn")
        self.assertEqual(code, 0, out + err)

    def test_a_read_outside_the_block_that_reads_a_take_is_checked_against_every_shot(self):
        outside = 'function aside(ck) { return [ck.mark("hood"), ck.mark("ghost")]; }'
        out = self.problems_of("", outside)
        self.assertIn('reads the mark "ghost", but no shot of the film measures it', out)
        self.assertEqual(out.count("reads the mark"), 1, out)

    def test_a_take_with_no_shots_json_fails(self):
        self.synthetic("syn", js=self.film_js('const a = ck.mark("hood");'), shots=False)
        self.assertIn('reads the take "s" but the film has no shots.json', self.problems("syn"))

    def test_a_film_js_it_cannot_scan_says_so(self):
        out = self.problems_of('const broken = "never closed;')
        self.assertIn("could not be scanned", out)


class TheCommittedFilms(Scratch):
    def test_every_one_is_clean(self):
        # Every film in films/, whatever it has: walkthroughs, launch (takes,
        # no plan), the illustrated ones (nothing to check) and the probe.
        for film in sorted(os.listdir(FILMS)):
            if not os.path.isdir(os.path.join(FILMS, film)):
                continue
            with self.subTest(film=film):
                code, out, err = node("validate.mjs", film)
                self.assertEqual(code, 0, out + err)

    def test_each_kind_says_what_it_checked(self):
        for film, says in (
            ("view-patch", "view-patch: ok"),
            ("view-perform", "view-perform: ok"),
            ("launch", "launch: ok (takes only: the film has no walkthrough plan)"),
            ("dsp", "dsp: no shots.json and no walkthrough plan: nothing to check"),
        ):
            with self.subTest(film=film):
                code, out, err = node("validate.mjs", film)
                self.assertEqual(code, 0, out + err)
                self.assertEqual(out.strip(), says)


class AWalkthrough(Scratch):
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
