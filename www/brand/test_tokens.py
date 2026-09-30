#!/usr/bin/env python3
"""The colour tokens' check, and the two drifts it closed, held in place.

    python3 www/brand/test_tokens.py      (run by `make dev-check`)

The check's cases run on a throwaway copy of every file it reads, so a
planted colour never touches the tree. Python 3 standard library only.
"""

import contextlib
import io
import os
import re
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import tokens as T  # noqa: E402


class Tree:
    """A copy of the token source, the consumers and every scanned file."""

    def __enter__(self):
        self.root = tempfile.mkdtemp(prefix="tokens-")
        files = {c["file"] for c in T.CONSUMERS} | {rel for rel, _ in T.scanned_files()} | {T.SOURCE}
        for rel in files:
            dst = os.path.join(self.root, rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copyfile(os.path.join(T.ROOT, rel), dst)
        self.real, T.ROOT = T.ROOT, self.root
        return self

    def __exit__(self, *exc):
        T.ROOT = self.real
        shutil.rmtree(self.root)

    def edit(self, rel, fn):
        p = os.path.join(self.root, rel)
        with open(p, encoding="utf-8") as f:
            text = f.read()
        with open(p, "w", encoding="utf-8") as f:
            f.write(fn(text))

    def problems(self):
        return T.generate(check=True) or T.scan(T.load())


def source(rel):
    with open(os.path.join(T.ROOT, rel), encoding="utf-8") as f:
        return f.read()


class TheCheck(unittest.TestCase):
    def test_the_tree_as_committed_passes(self):
        with Tree() as t:
            self.assertEqual(t.problems(), [])

    def test_a_colour_written_in_a_rule_fails_the_check(self):
        for lit in ("#ff0000", "rgba(255, 0, 0, 0.5)", "hsl(0 100% 50%)"):
            with Tree() as t:
                t.edit("apps/web/style.css", lambda s: s + f"\n.x {{ color: {lit}; }}\n")
                self.assertTrue(any("a colour outside the tokens" in p for p in t.problems()), lit)

    def test_a_colour_written_in_a_script_fails_the_check(self):
        for line in ('const x = "#123456";', "const y = `0 0 4px rgba(1,2,3,.5)`;", 'const z = "142, 240, 177";'):
            with Tree() as t:
                t.edit("www/video/films/dsp/film.js", lambda s: s + "\n" + line + "\n")
                self.assertTrue(any("a colour outside the tokens" in p for p in t.problems()), line)

    def test_a_colour_in_a_comment_passes(self):
        with Tree() as t:
            t.edit("apps/web/style.css", lambda s: s + "\n/* #ff0000 was the old red */\n")
            t.edit("apps/web/main.js", lambda s: s + "\n// #ff0000 was the old red\n")
            self.assertEqual(t.problems(), [])

    def test_a_block_edited_by_hand_fails_the_check(self):
        with Tree() as t:
            t.edit("www/landing/style.css", lambda s: s.replace("--silk: #d9d4c8;", "--silk: #d9d4c9;", 1))
            self.assertTrue(any("stale" in p for p in t.problems()))

    def test_a_token_changed_in_the_source_leaves_every_block_stale_until_regenerated(self):
        with Tree() as t:
            t.edit(T.SOURCE, lambda s: s.replace('"#ff5747"', '"#ff5748"'))
            self.assertEqual(sum("stale" in p for p in t.problems()), len(T.CONSUMERS))
            with contextlib.redirect_stdout(io.StringIO()):
                T.generate(check=False)
            self.assertEqual(t.problems(), [])

    def test_a_script_reading_a_token_its_surface_lacks_fails_the_check(self):
        with Tree() as t:
            t.edit("www/video/stage/kit.js", lambda s: s + '\nexport const Q = ink("--paper-stock");\n')
            self.assertTrue(any("reads --paper-stock" in p for p in t.problems()))

    def test_a_stylesheet_using_another_surfaces_token_fails_the_check(self):
        with Tree() as t:
            t.edit("apps/web/style.css", lambda s: s + "\n.x { color: var(--paper-stock); }\n")
            self.assertTrue(any("belongs to brand" in p for p in t.problems()))

    def test_prose_may_quote_a_colour_only_if_it_is_a_tokens_value(self):
        with Tree() as t:
            t.edit("www/brand/index.html", lambda s: s.replace("</main>", "<p><code>#7a5526</code></p></main>", 1))
            self.assertEqual(t.problems(), [])
            t.edit("www/brand/index.html", lambda s: s.replace("</main>", "<p><code>#6e4d22</code></p></main>", 1))
            self.assertTrue(any("in prose is not a token's value" in p for p in t.problems()))


class TheDriftsItClosed(unittest.TestCase):
    def test_the_films_deep_amber_is_the_palettes(self):
        src = T.load()
        deep = T.names_of(src, "app")["phos-b-deep"]
        self.assertEqual(T.names_of(src, "stage")["phos-b-deep"], deep)
        kit = source("www/video/stage/kit.js")
        self.assertIn('PHOS_DEEP = { a: ink("--phos-a-deep"), b: ink("--phos-b-deep") }', kit)
        stale = T.rgba_of("#6e4d22")
        self.assertNotIn(stale, {T.rgba_of(v) for s in src["surfaces"] for v in T.names_of(src, s).values()})

    def test_the_brand_page_lights_the_lamp_in_the_apps_amber(self):
        app = source("apps/web/style.css")
        lit = re.search(r"\.wordmark b\.thinking \{[^}]*?\bcolor: (var\(--[\w-]+\))", app).group(1)
        brand = source("www/brand/index.html")
        live = re.search(r'AURACL<b style="[^"]*color:(var\(--[\w-]+\))">E</b>', brand).group(1)
        second = re.search(r"\.versus \.no \.wm b \{[^}]*?\bcolor: (var\(--[\w-]+\))", brand).group(1)
        self.assertEqual(lit, "var(--phos-b)")
        self.assertEqual(live, lit)
        self.assertEqual(second, lit)


if __name__ == "__main__":
    # One line when they pass, like the rest of `make dev-check`; everything
    # unittest says when one fails.
    out = io.StringIO()
    result = unittest.TextTestRunner(stream=out, verbosity=2).run(unittest.defaultTestLoader.loadTestsFromModule(sys.modules[__name__]))
    if not result.wasSuccessful():
        sys.stderr.write(out.getvalue())
        sys.exit(1)
    print(f"  tokens tests: {result.testsRun} passed")
