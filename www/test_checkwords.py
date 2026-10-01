#!/usr/bin/env python3
"""The voice check's tests: the list it reads, what it reads as copy, how it
matches, and the ratchet.

    python3 www/test_checkwords.py      (run by `make dev-check`)

The ratchet's cases run on a throwaway copy of every file the check reads,
the guide and the baseline, so a planted word never touches the tree. Python 3
standard library only.
"""

import contextlib
import io
import json
import os
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import checkwords as W  # noqa: E402

LIST = W.parse_banned(
    """
```banned
AI | all | the model
HELD | player | set aside
MODEL'S GUESS | player | 59% · leaning
generate | player | breed
next-generation | all | (say what it does)
commit | player | keep as new
bench | player | the sound you're playing
workbench | player | the sound you're playing
duel | player | pair
made room | player | replaced
measuring… | player | listening…
```
"""
)


def words(segments, kind="md", entries=LIST):
    """Each hit as (line, rule)."""
    return [(h.line, h.rule) for h in W.hits_in(segments, entries, kind)]


def rules(text, kind="md", entries=LIST):
    return [h.rule for h in W.hits_in([(1, text)], entries, kind)]


class Tree:
    """A copy of the guide, the baseline and every file the check reads."""

    def __enter__(self):
        self.root = tempfile.mkdtemp(prefix="checkwords-")
        for rel in [W.VOICE, W.BASELINE] + [f for f, *_ in W.files()]:
            dst = os.path.join(self.root, rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copyfile(os.path.join(W.ROOT, rel), dst)
        self.real, W.ROOT = W.ROOT, self.root
        return self

    def __exit__(self, *exc):
        W.ROOT = self.real
        shutil.rmtree(self.root)

    def edit(self, rel, fn):
        p = os.path.join(self.root, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        text = open(p, encoding="utf-8").read() if os.path.exists(p) else ""
        with open(p, "w", encoding="utf-8") as f:
            f.write(fn(text))

    def run(self, *argv):
        """The check's exit code, and what it printed to stdout and stderr."""
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = W.main(list(argv))
        return code, out.getvalue(), err.getvalue()

    def baseline(self):
        return json.loads(open(os.path.join(self.root, W.BASELINE), encoding="utf-8").read())


class TheList(unittest.TestCase):
    def test_the_guides_banned_block_parses(self):
        got = W.parse_banned(open(os.path.join(W.ROOT, W.VOICE), encoding="utf-8").read())
        self.assertGreaterEqual(len(got), 30)
        self.assertIn(W.Entry("AI", "all", "the model, or say what it does"), got)
        self.assertIn(W.Entry("bench", "player", "the sound you're playing"), got)
        self.assertIn(W.Entry("MODEL'S GUESS", "player", "59% · leaning"), got)

    def test_each_line_is_a_word_a_scope_and_what_to_say(self):
        got = W.parse_banned("text\n\n```banned\nfoo | player | bar\n\nmade room |all|  replaced \n```\n\n```\nx | y | z\n```")
        self.assertEqual(got, [W.Entry("foo", "player", "bar"), W.Entry("made room", "all", "replaced")])

    def test_a_malformed_list_is_refused_with_its_line(self):
        for bad, why in [
            ("```banned\nfoo | everywhere | bar\n```", ":2:"),
            ("```banned\nfoo | player\n```", ":2:"),
            ("```banned\nfoo | player | a\nfoo | all | b\n```", "listed twice"),
            ("```\nfoo | player | bar\n```", "no ```banned block"),
        ]:
            with self.assertRaises(ValueError) as e:
                W.parse_banned(bad)
            self.assertIn(why, str(e.exception))

    def test_the_check_reads_the_list_from_the_guide_when_it_runs(self):
        with Tree() as t:
            t.edit("www/docs/src/bank.md", lambda s: s + "\nA wobbly sound.\n")
            self.assertEqual(t.run()[0], 0)
            t.edit(W.VOICE, lambda s: s.replace("```banned\n", "```banned\nwobbly | player | (say what it does)\n", 1))
            code, _, err = t.run()
            self.assertEqual(code, 1)
            self.assertIn("www/docs/src/bank.md: wobbly ((say what it does)): 1 hits", err)


class WhatItReads(unittest.TestCase):
    def test_a_scripts_literals_not_its_comments_or_names(self):
        src = "\n".join(
            [
                "// the bench, in a comment",  # 1
                "/* a bench in a block",  # 2
                "   comment */ const bench = benchTree.bench;",  # 3
                'note("nothing on the bench");',  # 4
                "const t = `${bench} is on the bench`;",  # 5
                'const r = /bench"/g; const q = "a duel";',  # 6: a regex with a quote in it, then a literal
                "const x = a / b / c; // bench",  # 7: division, then a comment
                "note('it\\'s the bench');",  # 8
                '$("bench-tour"); send({ type: "bench" }); if (k === "bench") {}',  # 9: names
                'el.classList.toggle("bench"); el.querySelector(".lit .bench");',  # 10: names
                'el.title = `pick ${n > 1 ? "duels" : "a duel"} ${`one duel`}`;',  # 11: literals inside ${}
                "const multi = `one",  # 12
                "and a bench`;",  # 13
            ]
        )
        self.assertEqual(
            words(W.js_literals(src), "js"),
            [(4, "bench"), (5, "bench"), (6, "duel"), (8, "bench"), (11, "duel"), (11, "duel"), (11, "duel"), (13, "bench")],
        )

    def test_markup_in_a_literal_is_read_as_a_page(self):
        src = 'h.innerHTML = `<span class="bench-row" title="the bench">${name}</span> <!-- a bench --> on the bench`;'
        self.assertEqual(words(W.js_literals(src), "js"), [(1, "bench"), (1, "bench")])

    def test_code_held_in_a_literal_by_name_is_not_copy(self):
        self.assertEqual(W.js_literals('const POLYFILL = `note("a bench")`;\nconst y = "a bench";', "apps/web/live-audio.js"), [(2, "a bench")])

    def test_a_pages_text_and_shown_attributes(self):
        src = (
            '<head><title>A bench</title><meta name="description" content="the bench">'
            '<meta name="viewport" content="bench"></head>\n'
            '<div class="bench" id="bench-x" data-x="bench" title="the bench"><!-- a bench -->\n'
            '<script>var s = "a bench";</script><style>.bench { color: red }</style>\n'
            'on the bench <img alt="a bench" src="bench.png"> <input placeholder="a bench">'
            '<button aria-label="a bench">x</button></div>'
        )
        self.assertEqual(words(W.html_text(src), "html"), [(1, "bench"), (1, "bench"), (2, "bench"), (4, "bench"), (4, "bench"), (4, "bench"), (4, "bench")])

    def test_markdowns_prose_not_its_code(self):
        src = "\n".join(
            [
                "On the bench.",  # 1
                "```js",
                "the bench",
                "```",
                "The `bench` field, and ``a `bench` too``.",  # 5
                "[the guide](views/bench.md) and ![a bench](img/bench.png) and https://example.com/bench",  # 6
                "<!-- a bench -->",
                '<kbd>bench</kbd> <a href="bench.html">here</a>',  # 8
                "[bench]: ../bench.md",
                "{{#include bench.md}} $a_{bench}$ and",  # 10
                "a duel",  # 11
                "  ~~~",
                "  a bench",
                "  ~~~",
            ]
        )
        self.assertEqual(words(W.md_prose(src)), [(1, "bench"), (6, "bench"), (8, "bench"), (11, "duel")])

    def test_a_film_scripts_spoken_lines_only(self):
        src = json.dumps(
            {"title": "The bench", "description": "a bench", "beats": [{"id": "bench", "lines": [{"id": "b1", "text": "Back to the bench."}]}]},
            indent=2,
        )
        self.assertEqual(words(W.script_lines(src), "script"), [(10, "bench")])


class HowItMatches(unittest.TestCase):
    def test_capitals_match_only_in_capitals(self):
        for text, want in [
            ("AI picks for you", ["AI"]),
            ("the AI’s guess", ["AI"]),
            ("said, ai, Ai, MAIN, AIR, FAIR, AIFF", []),
            ("it goes to HELD", ["HELD"]),
            ("you held a chord", []),
            ("MODEL’S GUESS 0.59", ["MODEL'S GUESS"]),
            ("the model's guess, and how sure it is", []),
        ]:
            self.assertEqual(rules(text), want, text)

    def test_a_label_that_is_a_capitals_entry_in_lowercase_matches(self):
        # Silk labels are lowercase in the source and capitals on screen.
        self.assertEqual(words(W.html_text('<span class="tray-label">held</span>'), "html"), [(1, "HELD")])
        self.assertEqual(words(W.js_literals("x.innerHTML = `<b>model’s guess</b>`;"), "js"), [(1, "MODEL'S GUESS")])

    def test_whole_words_with_their_inflections(self):
        for text, want in [
            ("it generated two, generates more, generating", ["generate"] * 3),
            ("a generation, regenerate, generator", []),
            ("a next-generation synth", ["next-generation"]),
            ("committed, commits, committing", ["commit"] * 3),
            ("a commitment", []),
            ("the workbench", ["workbench"]),
            ("benches and duels, duelled", ["bench", "duel", "duel"]),
            ("it made\n  room", ["made room"]),
            ("measuring… and measuring...", ["measuring…", "measuring…"]),
            ("re-measuring…", ["measuring…"]),
        ]:
            self.assertEqual(rules(text), want, text)

    def test_em_dashes(self):
        self.assertEqual(rules("a — b—c"), ["em dash", "em dash"])
        self.assertEqual(words(W.html_text("<p>a &mdash; b</p>"), "html"), [(1, "em dash")])
        self.assertEqual(words(W.js_literals('note("a \\u2014 b")'), "js"), [(1, "em dash")])
        self.assertEqual(rules("a – b, a - b"), [])

    def test_british_spellings(self):
        flagged = (
            "colour colours coloured centre centred behaviour behavioural favourite towards maths analyse "
            "analyser organise organisation normalised recognise recognisable realise grey greyed licence "
            "catalogue dialogue modelling modelled cancelled cancelling visualisation quantised optimising"
        ).split()
        fine = (
            "color center toward math analyses analyze organism realism realist cancellation promised rising "
            "raised surprising advertising improvisation Ising license catalog dialog gray modeling canceled "
            "otherwise expertise"
        ).split()
        for w in flagged:
            self.assertTrue(W.british(w), w)
        for w in fine:
            self.assertIsNone(W.british(w), w)

    def test_a_spoken_dialogue_is_fine_and_a_written_one_is_not(self):
        self.assertEqual(rules("a dialogue between two sounds", "script"), [])
        self.assertEqual(rules("the save dialogue opens", "md"), ["dialogue"])

    def test_a_player_word_is_the_references_own(self):
        # `all` surfaces take only `all` entries.
        hits = W.hits_in([(1, "a duel with the AI")], [e for e in LIST if e.scope == "all"], "md")
        self.assertEqual([h.rule for h in hits], ["AI"])


class TheRatchet(unittest.TestCase):
    def test_the_tree_as_committed_passes_at_its_baseline(self):
        with Tree() as t:
            code, out, err = t.run()
            self.assertEqual((code, err), (0, ""))
            self.assertRegex(out, r"^  voice: \d+ files, \d+ hits under baseline, 0 rises\n$")

    def test_a_new_hit_fails_and_says_where(self):
        with Tree() as t:
            t.edit("apps/web/main.js", lambda s: s + '\nnote("Nothing to generate here — yet.");\n')
            code, _, err = t.run()
            self.assertEqual(code, 1)
            self.assertIn("apps/web/main.js: generate (breed, grow, offer):", err)
            self.assertIn("apps/web/main.js: em dash (a colon, a comma, a period, or parentheses):", err)
            self.assertIn('note("Nothing to generate here — yet.");', err)

    def test_a_new_word_in_a_comment_or_a_code_span_passes(self):
        with Tree() as t:
            t.edit("apps/web/main.js", lambda s: s + "\n// generate the colour — later\n")
            t.edit("www/docs/src/bank.md", lambda s: s + "\nThe `generate_colour` field.\n")
            self.assertEqual(t.run()[0], 0)

    def test_a_new_hit_on_each_surface_fails(self):
        planted = {
            "apps/web/index.html": ("vote", lambda s: s.replace("</body>", "<p>A vote.</p></body>", 1)),
            "apps/web/perform.js": ("bench", lambda s: s + '\nnote("back on the bench");\n'),
            "www/landing/index.html": ("colour", lambda s: s.replace("</body>", '<img alt="the colour of it"></body>', 1)),
            "www/landing/hero.js": ("AI", lambda s: s + '\nconst x = "an AI";\n'),
            "www/docs/src/bank.md": ("towards", lambda s: s + "\nSave it towards the end.\n"),
            "www/reference/src/introduction.md": ("magic", lambda s: s + "\nIt is not magic.\n"),
            "README.md": ("grey", lambda s: s + "\nA grey area.\n"),
            "CHANGELOG.md": ("stunning", lambda s: s + "\nA stunning fix.\n"),
            "www/video/films/launch/script.json": ("duel", lambda s: s.replace('"text": "', '"text": "A duel. ', 1)),
        }
        with Tree() as t:
            for rel, (_, fn) in planted.items():
                t.edit(rel, fn)
            code, _, err = t.run()
            self.assertEqual(code, 1)
            for rel, (rule, _) in planted.items():
                self.assertIn(f"  {rel}: {rule} (", err)
            self.assertEqual(err.count(" hits, and "), len(planted))

    def test_a_player_word_in_the_reference_passes(self):
        with Tree() as t:
            t.edit("www/reference/src/introduction.md", lambda s: s + "\nEach duel updates the posterior.\n")
            self.assertEqual(t.run()[0], 0)

    def test_a_film_scripts_title_is_not_a_spoken_line(self):
        with Tree() as t:
            t.edit("www/video/films/launch/script.json", lambda s: s.replace('"title": "', '"title": "The duel — ', 1))
            self.assertEqual(t.run()[0], 0)

    def test_a_file_the_baseline_does_not_list_fails_on_any_hit(self):
        with Tree() as t:
            t.edit("www/docs/src/new-page.md", lambda s: "# A page\n\nPick the one you'd reach for.\n")
            self.assertEqual(t.run()[0], 0)
            t.edit("www/docs/src/new-page.md", lambda s: s + "\nThen vote.\n")
            code, _, err = t.run()
            self.assertEqual(code, 1)
            self.assertIn("www/docs/src/new-page.md: vote (pick): 1 hits, and a file the baseline does not list", err)

    def test_a_drop_passes_and_update_lowers_the_baseline_to_it(self):
        with Tree() as t:
            was = t.baseline()["apps/web/main.js"]["bench"]
            app = sum(v.get("bench", 0) for k, v in t.baseline().items() if k.startswith("apps/web/"))
            t.edit("apps/web/main.js", lambda s: s.replace('note("no patch on the bench")', 'note("no sound to play")', 1))
            code, out, _ = t.run()
            self.assertEqual(code, 0)
            self.assertIn("1 fewer than the baseline holds", out)
            code, out, _ = t.run("--update")
            self.assertEqual(code, 0)
            self.assertIn(f"  app: bench {app} → {app - 1}\n", out)
            self.assertEqual(t.baseline()["apps/web/main.js"]["bench"], was - 1)
            # The floor moved: putting it back is now a rise.
            t.edit("apps/web/main.js", lambda s: s.replace('note("no sound to play")', 'note("no patch on the bench")', 1))
            self.assertEqual(t.run()[0], 1)

    def test_update_never_raises_a_count_unless_told_to(self):
        with Tree() as t:
            was = t.baseline()["www/docs/src/bank.md"].get("vote", 0)
            t.edit("www/docs/src/bank.md", lambda s: s + "\nThen vote.\n")
            code, _, err = t.run("--update")
            self.assertEqual(code, 1)
            self.assertIn("--update --allow-rise takes them", err)
            self.assertEqual(t.baseline()["www/docs/src/bank.md"].get("vote", 0), was)
            self.assertEqual(t.run("--update", "--allow-rise")[0], 0)
            self.assertEqual(t.baseline()["www/docs/src/bank.md"]["vote"], was + 1)
            self.assertEqual(t.run()[0], 0)

    def test_update_drops_what_has_no_hits_left(self):
        with Tree() as t:
            self.assertIn("README.md", t.baseline())
            t.edit("README.md", lambda s: "# Auracle\n\nA synthesizer that grows toward you.\n")
            self.assertEqual(t.run("--update")[0], 0)
            self.assertNotIn("README.md", t.baseline())

    def test_the_summary_counts_each_surface(self):
        with Tree() as t:
            code, out, _ = t.run("--summary")
            self.assertEqual(code, 0)
            for surface, tier, _ in W.SURFACES:
                self.assertRegex(out, rf"(?m)^  {surface} \({tier}, \d+ files\): \d+ hits")

    def test_a_broken_baseline_is_reported_not_a_traceback(self):
        with Tree() as t:
            t.edit(W.BASELINE, lambda s: "{")
            code, _, err = t.run()
            self.assertEqual(code, 1)
            self.assertIn("is not JSON", err)

    def test_the_guide_and_this_check_are_never_read(self):
        read = {f for f, *_ in W.files()}
        for rel in (W.VOICE, W.BASELINE, "www/checkwords.py", "www/test_checkwords.py"):
            self.assertNotIn(rel, read)
        self.assertFalse(any(f.startswith("docs/") for f in read))


if __name__ == "__main__":
    # One line when they pass, like the rest of `make dev-check`; everything
    # unittest says when one fails.
    out = io.StringIO()
    result = unittest.TextTestRunner(stream=out, verbosity=2).run(unittest.defaultTestLoader.loadTestsFromModule(sys.modules[__name__]))
    if not result.wasSuccessful():
        sys.stderr.write(out.getvalue())
        sys.exit(1)
    print(f"  voice tests: {result.testsRun} passed")
