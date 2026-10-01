#!/usr/bin/env python3
"""The voice check's tests: the list it reads, what it reads as copy, how it
matches, and the ratchet.

    python3 www/test_checkwords.py      (run by `make dev-check`)

No test reads the real copy. The ratchet's cases run in a throwaway tree of
fixture files, one on each surface, with a guide and a baseline of its own,
so a sweep of the real copy never breaks a test. Python 3 standard library
only.
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

REAL_ROOT = W.ROOT

BANNED = """```banned
AI | all | the model
HELD | player | set aside
MODEL'S GUESS | player | 59% · leaning
generate | player | breed, grow, offer
next-generation | all | (say what it does)
commit | player | keep as new
bench | player | the sound you're playing
workbench | player | the sound you're playing
duel | player | pair, pick
vote | player | pick
magic | all | (say what it does)
made room | player | replaced
measuring… | player | listening…
```"""
LIST = W.parse_banned(BANNED)

# The fixture tree: a guide, and one file on each surface, each holding a hit
# or two its baseline starts with.
VOICE = f"# Voice\n\nThe guide quotes the bench, the AI and an em dash — and is never read.\n\n{BANNED}\n"
FIXTURES = {
    "apps/web/index.html": "<!doctype html>\n<title>Auracle</title>\n<p>Back on the bench.</p>\n</body>\n",
    "apps/web/main.js": 'const bench = 1;\nnote("Back on the bench: play it.");\n$("bench-tour");\n',
    "www/landing/index.html": "<body>\n<p>Every duel grows closer — to you.</p>\n</body>\n",
    "www/landing/hero.js": 'const line = "Every duel is two sounds.";\n',
    "www/viz/viz.js": 'cap.textContent = "Each duel, forecast first.";\n',
    "www/docs/src/page.md": "# A page\n\nThe bench, and a colour.\n",
    "www/video/films/demo/script.json": json.dumps(
        {"title": "Demo", "beats": [{"id": "a", "lines": [{"id": "a1", "text": "Pick between two sounds, then vote."}]}]}, indent=2
    )
    + "\n",
    "www/video/films/demo/film.js": 'voiceLine(over, "A duel.");\n',
    "www/video/films/demo/cards.js": 'export const CARDS = [{ name: "One pair" }];\n',
    "www/reference/src/page.md": "# Reference\n\nEach duel updates the posterior, and none of it is magic.\n",
    "README.md": "# Auracle\n\nA grey note — once.\n",
    "CHANGELOG.md": "# Changelog\n\n- A centre fix.\n",
}


def words(segments, kind="md", entries=LIST):
    """Each hit as (line, rule)."""
    return [(h.line, h.rule) for h in W.hits_in(segments, entries, kind)]


def rules(text, kind="md", entries=LIST):
    return [h.rule for h in W.hits_in([(1, text)], entries, kind)]


def js(src):
    return words(W.js_literals(src), "js")


class Tree:
    """The fixture tree, with the baseline it starts at."""

    def __enter__(self):
        self.root = tempfile.mkdtemp(prefix="checkwords-")
        self.real, W.ROOT = W.ROOT, self.root
        for rel, text in {W.VOICE: VOICE, **FIXTURES}.items():
            self.edit(rel, lambda _, text=text: text)
        code, _, err = self.run("--update", "--allow-rise")
        assert code == 0, err
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
        got = W.parse_banned(open(os.path.join(REAL_ROOT, W.VOICE), encoding="utf-8").read())
        self.assertGreaterEqual(len(got), 25)
        self.assertTrue(all(e.scope in ("player", "all") and e.instead for e in got))

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
            t.edit("www/docs/src/page.md", lambda s: s + "\nA wobbly sound.\n")
            self.assertEqual(t.run()[0], 0)
            t.edit(W.VOICE, lambda s: s.replace("```banned\n", "```banned\nwobbly | player | (say what it does)\n", 1))
            code, _, err = t.run()
            self.assertEqual(code, 1)
            self.assertIn("www/docs/src/page.md: wobbly ((say what it does)): 1 hits", err)


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
                'const y = i++ / 2; note("the bench");',  # 14: a division after i++, not a regex
                'log("commit", { kind: "duel" }); // voice: name',  # 15: marked as names
            ]
        )
        self.assertEqual(
            js(src),
            [(4, "bench"), (5, "bench"), (6, "duel"), (8, "bench"), (11, "duel"), (11, "duel"), (11, "duel"), (13, "bench"), (14, "bench")],
        )

    def test_a_name_looks_like_one(self):
        names = [
            '["plate-hot", "dragging"]',
            'bind("sp-colour", f)',
            'x = "edit_commit"',
            'x = "#play-duel"',
            "key = `duel:${id}`",
            'x = "./bench.js"',
            'case "duel":',
            'send({ type: "bench" })',
            'if (k === "vote") {}',
            'el.classList.toggle("held")',
            'el("div", { class: "plate" })',
            'const b = beat("duel")',
            'const at0 = wordTime(l, "duel")',
            '{ at: "change3:HELD", until: "x" }',
            'el.querySelector("g[data-kind=amp] .mod-plate")',
        ]
        for src in names:
            self.assertEqual(js(src), [], src)

    def test_copy_that_looks_a_little_like_a_name_is_copy(self):
        copy = {
            'note("Committed.")': "commit",
            'x = "commit."': "commit",
            'label = "Colour:"': "colour",
            'note("re-generate")': "generate",
            'el.textContent = "re-generate"': "generate",
            'el.textContent = "commit"': "commit",
            'const word = "Bench"': "bench",
            'x.innerHTML = "<b>held</b>"': "HELD",
            "x.innerHTML = `<b>${n}</b>duels`": "duel",
            "x.innerHTML = `${n}&nbsp;duels`": "duel",
            'note("Saved &mdash; it stays")': "em dash",
            'note("Saved \\u2014 it stays")': "em dash",
        }
        for src, rule in copy.items():
            self.assertEqual([r for _, r in js(src)], [rule], src)

    def test_markup_in_a_literal_is_read_as_a_page(self):
        src = 'h.innerHTML = `<span class="bench-row" title="the bench">${name}</span> <!-- a bench --> on the bench`;'
        self.assertEqual(js(src), [(1, "bench"), (1, "bench")])

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

    def test_a_marked_quotation_is_not_read(self):
        src = "\n".join(
            [
                "*<!-- voice: quote -->Loudness normalisation — and colour<!-- /voice -->*, then a colour.",  # 1
                "The toast said <!-- voice: quote -->*Kept — this is",  # 2: a quote that wraps a line
                "home now.*<!-- /voice --> and the bench — once.",  # 3
                "<!--voice:quote-->a duel<!--/voice--> and a duel",  # 4: no spaces needed
            ]
        )
        self.assertEqual(words(W.md_prose(src)), [(1, "colour"), (3, "bench"), (3, "em dash"), (4, "duel")])

    def test_a_quotation_without_its_closer_exempts_nothing(self):
        # No closer at all: the opener is a comment, and the words are read.
        self.assertEqual(words(W.md_prose("<!-- voice: quote -->a colour — and a duel.\n\nThe bench.")), [(1, "colour"), (1, "duel"), (1, "em dash"), (3, "bench")])
        # A closer past a blank line: a quote never crosses a paragraph.
        src = "<!-- voice: quote -->a colour\n\nthe bench<!-- /voice -->, then a duel."
        self.assertEqual(words(W.md_prose(src)), [(1, "colour"), (3, "bench"), (3, "duel")])

    def test_an_admonish_callout_is_prose(self):
        src = "\n".join(
            [
                '```admonish tip title="Vote fast"',  # 1: its title is read
                "A duel is a gut reaction.",  # 2
                "````js",
                "const bench = 1;",
                "````",
                "Then the bench.",  # 6
                "```",
                "```rust",
                "let duel = 1;",
                "```",
            ]
        )
        self.assertEqual(words(W.md_prose(src)), [(1, "vote"), (2, "duel"), (6, "bench")])

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
        self.assertEqual(js("x.innerHTML = `<b>model’s guess</b>`;"), [(1, "MODEL'S GUESS")])

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
        self.assertEqual(rules("a – b, a - b"), [])

    def test_british_spellings(self):
        flagged = {
            "colour colours coloured": "colour",
            "centre centred": "centre",
            "behaviour behavioural": "behaviour",
            "favourite": "favourite",
            "towards": "towards",
            "maths": "maths",
            "grey greyed": "grey",
            "licence": "licence",
            "catalogue": "catalogue",
            "dialogue": "dialogue",
            "judgement judgements": "judgement",
            "modelling modelled": "modelling",
            "labelled labelling": "labelled",
            "travelled travelling": "travelled",
            "cancelled cancelling": "cancelled",
            "analyse analysed analyser": "analyse",
            "optimise optimised optimises optimising optimisation": "optimise",
            "normalise unnormalised normalisation": "normalise",
            "organise organisation reorganised": "organise",
            "recognise recognisable": "recognise",
            "realise realisation": "realise",
            "penalise prioritise minimise maximise summarise utilise visualise categorise": None,
            "characterise emphasise standardise synthesise synthesiser": None,
        }
        for ws, rule in flagged.items():
            for w in ws.split():
                self.assertEqual(W.british(w), rule or w.removesuffix("r").removesuffix("ise") + "ise", w)
        fine = (
            "color center toward math analyses analyze organism realism realist cancellation rise rising "
            "precise otherwise noise promise promised exercise surprising advertising improvisation "
            "liaising Ising license catalog dialog gray modeling labeled judgment canceled expertise "
            "synthesis"
        ).split()
        for w in fine:
            self.assertIsNone(W.british(w), w)
            self.assertEqual(rules(w), [], w)

    def test_a_spoken_dialogue_is_fine_and_a_written_one_is_not(self):
        self.assertEqual(rules("a dialogue between two sounds", "script"), [])
        self.assertEqual(rules("the save dialogue opens", "md"), ["dialogue"])

    def test_a_player_word_is_the_references_own(self):
        # `all` surfaces take only `all` entries.
        hits = W.hits_in([(1, "a duel with the AI")], [e for e in LIST if e.scope == "all"], "md")
        self.assertEqual([h.rule for h in hits], ["AI"])


class TheRatchet(unittest.TestCase):
    def test_the_tree_passes_at_its_own_baseline(self):
        with Tree() as t:
            code, out, err = t.run()
            self.assertEqual((code, err), (0, ""))
            self.assertEqual(out, f"  voice: {len(FIXTURES)} files, 14 hits under baseline, 0 rises\n")

    def test_a_new_hit_fails_and_says_where(self):
        with Tree() as t:
            t.edit("apps/web/main.js", lambda s: s + 'note("Nothing to generate here — yet.");\n')
            code, _, err = t.run()
            self.assertEqual(code, 1)
            self.assertIn("apps/web/main.js: generate (breed, grow, offer): 1 hits, and the baseline holds 0", err)
            self.assertIn("apps/web/main.js: em dash (a colon, a comma, a period, or parentheses):", err)
            self.assertIn('apps/web/main.js:4: generate: note("Nothing to generate here — yet.");', err)

    def test_a_new_word_in_a_comment_a_name_or_a_code_span_passes(self):
        with Tree() as t:
            t.edit("apps/web/main.js", lambda s: s + '// generate the colour — later\n$("duel-count");\n')
            t.edit("www/docs/src/page.md", lambda s: s + "\nThe `generate_colour` field.\n")
            self.assertEqual(t.run()[0], 0)

    def test_a_new_hit_on_each_surface_fails(self):
        planted = {
            "apps/web/index.html": ("vote", lambda s: s.replace("</body>", "<p>A vote.</p></body>", 1)),
            "apps/web/main.js": ("bench", lambda s: s + 'note("back on the bench");\n'),
            "www/landing/index.html": ("colour", lambda s: s.replace("</body>", '<img alt="the colour of it"></body>', 1)),
            "www/landing/hero.js": ("AI", lambda s: s + 'const x = "an AI";\n'),
            "www/viz/viz.js": ("commit", lambda s: s + 'cap.textContent = "Commit it.";\n'),
            "www/docs/src/page.md": ("towards", lambda s: s + "\nSave it towards the end.\n"),
            "www/video/films/demo/script.json": ("duel", lambda s: s.replace('"text": "', '"text": "A duel. ', 1)),
            "www/video/films/demo/film.js": ("HELD", lambda s: s + 'txt(over, "goes to HELD");\n'),
            "www/video/films/demo/cards.js": ("duel", lambda s: s.replace('"One pair"', '"The duel"')),
            "www/reference/src/page.md": ("AI", lambda s: s + "\nIt is not AI.\n"),
            "README.md": ("next-generation", lambda s: s + "\nA next-generation synth.\n"),
            "CHANGELOG.md": ("em dash", lambda s: s + "- Fixed — at last.\n"),
        }
        self.assertEqual(set(planted), set(FIXTURES))
        with Tree() as t:
            for rel, (_, fn) in planted.items():
                t.edit(rel, fn)
            code, _, err = t.run()
            self.assertEqual(code, 1)
            for rel, (rule, _) in planted.items():
                self.assertIn(f"  {rel}: {rule} (", err)
            self.assertEqual(err.count(" hits, and "), len(planted))

    def test_a_marked_quotation_passes(self):
        with Tree() as t:
            t.edit(
                "www/reference/src/page.md",
                lambda s: s + "\n*<!-- voice: quote -->Loudness normalisation —\nand colour<!-- /voice -->.*\n",
            )
            self.assertEqual(t.run()[0], 0)
            t.edit("www/reference/src/page.md", lambda s: s + "\nThe colour, unquoted.\n")
            code, _, err = t.run()
            self.assertEqual(code, 1)
            self.assertIn("www/reference/src/page.md:8: colour: The colour, unquoted.", err)

    def test_a_player_word_in_the_reference_passes(self):
        with Tree() as t:
            t.edit("www/reference/src/page.md", lambda s: s + "\nEach duel is a vote on the bench.\n")
            self.assertEqual(t.run()[0], 0)

    def test_a_film_scripts_title_is_not_a_spoken_line(self):
        with Tree() as t:
            t.edit("www/video/films/demo/script.json", lambda s: s.replace('"title": "', '"title": "The duel — ', 1))
            self.assertEqual(t.run()[0], 0)

    def test_a_file_the_baseline_does_not_list_fails_on_any_hit(self):
        with Tree() as t:
            t.edit("www/docs/src/new-page.md", lambda s: "# A page\n\nPick the one you'd reach for.\n")
            self.assertEqual(t.run()[0], 0)
            t.edit("www/docs/src/new-page.md", lambda s: s + "\nThen vote.\n")
            code, _, err = t.run()
            self.assertEqual(code, 1)
            self.assertIn("www/docs/src/new-page.md: vote (pick): 1 hits, and a file the baseline does not list", err)

    def test_a_drop_fails_until_the_sweep_lowers_the_baseline(self):
        with Tree() as t:
            t.edit("www/docs/src/page.md", lambda s: s.replace("The bench", "The sound you're playing"))
            code, _, err = t.run()
            self.assertEqual(code, 1)
            self.assertIn("fewer hits than www/brand/voice-baseline.json holds, in www/docs/src/page.md (1)", err)
            self.assertIn("python3 www/checkwords.py --update", err)
            code, out, _ = t.run("--update")
            self.assertEqual(code, 0)
            self.assertIn("  guide: bench 1 → 0\n", out)
            self.assertNotIn("bench", t.baseline()["www/docs/src/page.md"])
            self.assertEqual(t.run()[0], 0)
            # The floor moved: putting it back is a rise.
            t.edit("www/docs/src/page.md", lambda s: s.replace("The sound you're playing", "The bench"))
            self.assertEqual(t.run()[0], 1)

    def test_a_file_no_longer_read_is_a_drop(self):
        with Tree() as t:
            os.remove(os.path.join(t.root, "README.md"))
            code, _, err = t.run()
            self.assertEqual(code, 1)
            self.assertIn("README.md (2)", err)
            self.assertEqual(t.run("--update")[0], 0)
            self.assertNotIn("README.md", t.baseline())

    def test_update_never_raises_a_count_unless_told_to(self):
        with Tree() as t:
            t.edit("www/docs/src/page.md", lambda s: s + "\nThen vote.\n")
            code, _, err = t.run("--update")
            self.assertEqual(code, 1)
            self.assertIn("--update --allow-rise takes them", err)
            self.assertNotIn("vote", t.baseline()["www/docs/src/page.md"])
            self.assertEqual(t.run("--update", "--allow-rise")[0], 0)
            self.assertEqual(t.baseline()["www/docs/src/page.md"]["vote"], 1)
            self.assertEqual(t.run()[0], 0)

    def test_the_summary_counts_each_surface(self):
        with Tree() as t:
            code, out, _ = t.run("--summary")
            self.assertEqual(code, 0)
            for surface, tier, _ in W.SURFACES:
                self.assertRegex(out, rf"(?m)^  {surface} \({tier}, \d+ files\): \d+ hits")
            self.assertIn("  readme (all, 1 files): 2 hits: em dash 1 · grey 1\n", out)
            self.assertIn("  films (player, 3 files): 2 hits: duel 1 · vote 1\n", out)

    def test_a_broken_baseline_is_reported_not_a_traceback(self):
        with Tree() as t:
            t.edit(W.BASELINE, lambda s: "{")
            code, _, err = t.run()
            self.assertEqual(code, 1)
            self.assertIn("is not JSON", err)


class TheSurfaces(unittest.TestCase):
    def test_every_surface_reads_files_in_the_real_tree(self):
        read = W.files()
        for surface, _, _ in W.SURFACES:
            self.assertTrue(any(s == surface for _, s, _, _ in read), surface)
        for rel in ("www/viz/viz.js", "README.md", "CHANGELOG.md", "apps/web/index.html", "www/landing/index.html"):
            self.assertIn(rel, {f for f, *_ in read})

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
