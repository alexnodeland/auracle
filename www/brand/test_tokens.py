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
        files = {c["file"] for c in T.CONSUMERS} | {rel for rel, _ in T.scanned_files()} | {T.SOURCE, T.SIZES_BASELINE}
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
        errs = T.generate(check=True)
        if errs:
            return errs
        now, exempt = T.size_counts()
        return T.scan(T.load()) + exempt + T.size_problems(now, T.load_size_baseline())


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

    def test_a_named_colour_used_as_a_colour_fails_the_check(self):
        cases = [
            ("apps/web/style.css", "\n.x { color: white; }\n"),
            ("apps/web/style.css", "\n.x { border: 1px solid RebeccaPurple; }\n"),
            ("apps/web/style.css", "\n.x { background: var(--nope, black); }\n"),
            ("www/404.html", '\n<svg><path fill="black"/></svg>\n'),
            ("www/404.html", '\n<p style="color: red">x</p>\n'),
            ("www/video/films/dsp/film.js", '\nctx.fillStyle = "red";\n'),
            ("www/video/films/dsp/film.js", '\nObject.assign(d.style, { background: "navy" });\n'),
            ("www/video/films/dsp/film.js", '\nr.setAttribute("stroke", "white");\n'),
            ("www/video/films/dsp/film.js", '\nq.innerHTML = `<span style="color:tomato">x</span>`;\n'),
        ]
        for rel, add in cases:
            with Tree() as t:
                t.edit(rel, lambda s: s + add)
                self.assertTrue(any("a named colour outside the tokens" in p for p in t.problems()), add)

    def test_a_word_that_names_a_colour_but_is_not_one_passes(self):
        with Tree() as t:
            t.edit("apps/web/style.css", lambda s: s + "\n.x { color: transparent; fill: currentColor; stroke: inherit; }\n.red:not(.white) { color: var(--silk); }\n")
            t.edit("www/video/films/dsp/film.js", lambda s: s + '\nconst mode = "white";\nconst o = { colour: "green", tags: ["pink"] };\nif (color === "red") mode;\n')
            t.edit("www/brand/index.html", lambda s: s.replace("</main>", "<p>Green is sound, and nothing is red.</p></main>", 1))
            self.assertEqual(t.problems(), [])

    def test_the_new_pages_are_scanned(self):
        with Tree() as t:
            t.edit("www/landing/index.html", lambda s: s.replace('content="#0c0d10"', 'content="#000000"', 1))
            t.edit("www/video/stage/poster.html", lambda s: s.replace("var(--bezel-66)", "rgba(7, 8, 10, 0.66)", 1))
            t.edit("www/theme/highlight.css", lambda s: s + "\n.hljs-x { color: #123456; }\n")
            got = t.problems()
            for rel in ("www/landing/index.html", "www/video/stage/poster.html", "www/theme/highlight.css"):
                self.assertTrue(any(p.startswith(rel) for p in got), rel)

    def test_the_not_yet_files_are_named_and_not_scanned(self):
        scanned = {rel for rel, _ in T.scanned_files()}
        for rel, why in T.NOT_YET:
            self.assertTrue(os.path.exists(os.path.join(T.ROOT, rel)), rel)
            self.assertNotIn(rel, scanned)
            self.assertTrue(why)

    def test_a_value_that_is_not_a_colour_is_reported_as_one(self):
        # Even when opacities are derived from it: a friendly line, not a traceback.
        for bad in ("#12345", "rgb(1, 2)", "blue"):
            with Tree() as t:
                t.edit(T.SOURCE, lambda s: s.replace('"scrim": { "value": "#0a0c0f"', f'"scrim": {{ "value": "{bad}"', 1))
                got = t.problems()
                self.assertTrue(any(f"--scrim: `{bad}` is not a colour" in p for p in got), (bad, got))

    def test_an_opacity_of_a_colour_that_is_already_see_through_is_refused(self):
        with Tree() as t:
            t.edit(T.SOURCE, lambda s: s.replace('"alpha": {\n        "white"', '"alpha": {\n        "rack-map-glass": [50],\n        "white"', 1))
            self.assertTrue(any("need an opaque colour" in p for p in t.problems()))

    def test_prose_may_quote_a_colour_only_if_it_is_a_tokens_value(self):
        with Tree() as t:
            t.edit("www/brand/index.html", lambda s: s.replace("</main>", "<p><code>#7a5526</code></p></main>", 1))
            self.assertEqual(t.problems(), [])
            t.edit("www/brand/index.html", lambda s: s.replace("</main>", "<p><code>#6e4d22</code></p></main>", 1))
            self.assertTrue(any("in prose is not a token's value" in p for p in t.problems()))


class TheSizesRatchet(unittest.TestCase):
    def test_a_literal_font_size_spacing_radius_or_duration_in_the_app_fails_the_check(self):
        for rule, kind in (
            (".x { font-size: 13px; }", "font"),
            (".x { padding: 6px 10px; }", "space"),
            (".x { border-radius: 6px; }", "radius"),
            (".x { transition: opacity 200ms ease; }", "time"),
        ):
            with Tree() as t:
                t.edit("apps/web/style.css", lambda s: s + f"\n{rule}\n")
                got = t.problems()
                self.assertTrue(any(p.startswith("apps/web/style.css:") and f"literal {kind} sizes" in p for p in got), (rule, got))

    def test_a_literal_size_in_a_script_fails_the_check(self):
        for line in ("ctx.font = `${10 * dpr}px mono`;", 'ctx.font = "11px mono";', 'el.style.fontSize = "13px";', 'Object.assign(el.style, { padding: "6px" });'):
            with Tree() as t:
                t.edit("apps/web/main.js", lambda s: s + "\n" + line + "\n")
                self.assertTrue(any(p.startswith("apps/web/main.js:") for p in t.problems()), line)

    def test_a_nudge_a_shape_and_a_token_pass(self):
        with Tree() as t:
            t.edit(
                "apps/web/style.css",
                lambda s: s + "\n.x { padding: 3px var(--s2); margin: -1px 0; border-radius: 999px; gap: var(--s1);"
                " transition: color var(--d-state) var(--e-settle); font-size: var(--t-body); }\n.y { border-radius: 50%; }\n",
            )
            self.assertEqual(t.problems(), [])

    def test_a_literal_that_says_why_passes_and_one_that_does_not_fails(self):
        with Tree() as t:
            t.edit("apps/web/style.css", lambda s: s + "\n.x { animation: spin 1.2s linear infinite; } /* token-exempt: a loop's period */\n")
            self.assertEqual(t.problems(), [])
        with Tree() as t:
            t.edit("apps/web/style.css", lambda s: s + "\n.x { animation: spin 1.2s linear infinite; } /* token-exempt: */\n")
            self.assertTrue(any("a token-exempt says why" in p for p in t.problems()))

    def test_a_count_that_falls_without_lowering_the_baseline_fails(self):
        with Tree() as t:
            t.edit("www/404.html", lambda s: s.replace("padding: 24px;", "padding: var(--s5);", 1))
            got = t.problems()
            self.assertTrue(any(p.startswith("www/404.html") and "under the baseline" in p for p in got), got)
            now, _ = T.size_counts()
            T.write_size_baseline(T.updated_baseline(now, T.load_size_baseline(), allow_rise=False))
            self.assertEqual(t.problems(), [])

    def test_the_baseline_only_goes_down_without_allow_rise(self):
        base = {"a.css": {"font": 2}}
        self.assertEqual(T.updated_baseline({"a.css": {"font": 5}}, base, allow_rise=False), base)
        self.assertEqual(T.updated_baseline({"a.css": {"font": 1}}, base, allow_rise=False), {"a.css": {"font": 1}})
        self.assertEqual(T.updated_baseline({"a.css": {"font": 5}}, base, allow_rise=True), {"a.css": {"font": 5}})

    def test_a_token_redefined_after_its_block_fails_the_check(self):
        with Tree() as t:
            t.edit("apps/web/style.css", lambda s: s + "\n:root { --s3: 11px; }\n")
            self.assertTrue(any("defines --s3, which the tokens block already does" in p for p in t.problems()))

    def test_a_size_off_the_scale_in_the_source_is_refused(self):
        cases = [
            ('"t-body": { "value": "14px"', '"t-body": { "value": "15px"', "is step 1 up from 12px at 1.2, which is 14px"),
            ('"s3": { "value": "12px" }', '"s3": { "value": "1.2rem" }', "is not a whole number of px"),
            ('"d-state": { "value": "180ms"', '"d-state": { "value": "0.18s"', "is not a duration in ms"),
            ('"e-swap": { "value": "cubic-bezier(0.6, 0, 0.2, 1)"', '"e-swap": { "value": "ease"', "is not a cubic-bezier()"),
        ]
        for old, new, want in cases:
            with Tree() as t:
                t.edit(T.SOURCE, lambda s: s.replace(old, new, 1))
                got = t.problems()
                self.assertTrue(any(want in p for p in got), (new, got))

    def test_every_block_carries_the_reduced_motion_rule(self):
        for c in T.CONSUMERS:
            block = T.BLOCK_RE.search(source(c["file"])).group(0)
            self.assertRegex(block, r"@media \(prefers-reduced-motion: reduce\) \{\s*:root \{ --d-press: 0ms; --d-state: 0ms; --d-move: 0ms; \}", c["file"])


class TheSpecimensScale(unittest.TestCase):
    """The approved specimen (prototype v2) is a dated record; tokens.json
    carries its type, space, radii and motion, and must not drift from it."""

    def test_the_tokens_are_the_specimens(self):
        css = source("docs/notes/vision-2026-09/prototype/style.css")
        root = re.search(r":root \{(.*?)\n\}", css, re.S).group(1)
        spec = dict(re.findall(r"--([\w-]+):\s*([^;]+);", root))
        src = T.load()
        names = {n: t["value"] for g in T.SIZE_GROUPS for n, t in src[g]["tokens"].items()}
        nums = lambda v: [float(x) for x in re.findall(r"-?\d*\.?\d+", v)]  # noqa: E731
        for name, want in spec.items():
            if name in names:
                self.assertEqual(nums(names[name]), nums(want), name)
        self.assertEqual(sum(n in spec for n in names), len(names) - 1, "every token but the canvas floor is the specimen's")
        self.assertEqual(src["type"]["ratio"], 1.2)
        self.assertEqual(names["t-canvas"], "12px")
        still = re.search(r"prefers-reduced-motion: reduce\)\s*\{\s*:root \{([^}]*)\}", css).group(1)
        self.assertEqual(dict(re.findall(r"--([\w-]+):\s*([^;]+);", still)), src["motion"]["reduced"])


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
        app, brand = source("apps/web/style.css"), source("www/brand/index.html")
        # The app's lit lamp, then the brand page's two drawings of a lit one:
        # the "lamp live" lockup and the "two lamps" example.
        self.assertRegex(app, r"\.wordmark b\.thinking \{[^}]*?\bcolor: var\(--phos-b\);")
        self.assertRegex(brand, r'AURACL<b style="[^"]*\bcolor:var\(--phos-b\)">E</b>')
        self.assertRegex(brand, r"\.versus \.no \.wm b \{[^}]*?\bcolor: var\(--phos-b\);")


if __name__ == "__main__":
    # One line when they pass, like the rest of `make dev-check`; everything
    # unittest says when one fails.
    out = io.StringIO()
    result = unittest.TextTestRunner(stream=out, verbosity=2).run(unittest.defaultTestLoader.loadTestsFromModule(sys.modules[__name__]))
    if not result.wasSuccessful():
        sys.stderr.write(out.getvalue())
        sys.exit(1)
    print(f"  tokens tests: {result.testsRun} passed")
