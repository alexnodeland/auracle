#!/usr/bin/env python3
"""The colour tokens' check, and the two drifts it closed, held in place.

    python3 www/brand/test_tokens.py      (run by `make dev-check`)

The check's cases run on a throwaway copy of every file it reads, so a
planted colour never touches the tree. Each case runs the whole check on its
copy, about a third of a second each, so run as a script the cases are
spread over worker processes, one per core: seconds, not the half minute they
take one after another. `python3 -m unittest` still runs them in one process.
Python 3 standard library only.
"""

import concurrent.futures
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
        # The check globs the scanned files again for each file it counts. A
        # case edits files but never adds or removes one: glob the copy once.
        self.globbed = T.scanned_files
        scanned = self.globbed()
        T.scanned_files = lambda: list(scanned)
        return self

    def __exit__(self, *exc):
        T.ROOT, T.scanned_files = self.real, self.globbed
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

    def test_the_figures_the_docs_layer_and_the_raster_source_are_scanned(self):
        # The four files NOT_YET held until #146, each with the literal it held.
        planted = {
            "www/viz/viz.js": lambda s: s + "\nconst tint = 'rgba(142,240,177,.10)';\n",
            "www/viz/viz.css": lambda s: s + "\n.viz-stage { border-color: #999; }\n",
            "www/theme/fonts/auracle.css": lambda s: s + "\n.x { background: var(--bezel, #07080a); }\n",
            "www/brand/render.html": lambda s: s.replace("</style>", "body { background: #333; }\n</style>", 1),
        }
        with Tree() as t:
            for rel, fn in planted.items():
                t.edit(rel, fn)
            got = t.problems()
            for rel in planted:
                self.assertTrue(any(p.startswith(rel + ":") and "a colour outside the tokens" in p for p in got), (rel, got))

    def test_a_file_on_not_yet_is_not_scanned(self):
        saved = T.NOT_YET
        T.NOT_YET = [("www/viz/viz.css", "a decision it waits on")]
        try:
            self.assertNotIn("www/viz/viz.css", {rel for rel, _ in T.scanned_files()})
        finally:
            T.NOT_YET = saved

    def test_a_figure_reading_a_token_one_of_its_pages_lacks_fails_the_check(self):
        # The figures are loaded under Rack, under Paper and on the landing
        # page: a tile filled with a token Paper lacks is filled with nothing
        # there.
        with Tree() as t:
            t.edit(T.SOURCE, lambda s: s.replace('"white": [70],\n        "phos-a": [10],\n', '"white": [70],\n', 1))
            with contextlib.redirect_stdout(io.StringIO()):
                T.generate(check=False)
            got = t.problems()
            self.assertTrue(any(p.startswith("www/viz/viz.js:") and "var(--phos-a-10) is not defined on docs-paper," in p for p in got), got)
        with Tree() as t:
            t.edit("www/viz/viz.css", lambda s: s + "\n.viz-x { background: var(--popup); }\n")
            got = t.problems()
            self.assertTrue(any(p.startswith("www/viz/viz.css:") and "var(--popup) is not defined on docs, landing," in p for p in got), got)

    def test_a_figure_reading_an_alias_one_of_its_pages_lacks_fails_the_check(self):
        # The stage's ground is `var(--code-bg)`, an alias each page defines
        # beside its tokens; without it the landing page's stage has none.
        with Tree() as t:
            t.edit("www/landing/style.css", lambda s: s.replace("  --code-bg: var(--white-02);\n", "", 1))
            got = t.problems()
            self.assertTrue(
                any(
                    p.startswith("www/viz/viz.css:")
                    and "var(--code-bg) is not defined on landing, which loads this file; define it in www/landing/style.css (:root)" in p
                    for p in got
                ),
                got,
            )
        # Rack and Paper share a stylesheet: an alias Paper's rule lacks is
        # missing on Paper alone, though Rack's rule defines it.
        with Tree() as t:

            def drop_paper_fg(s):
                at = s.rindex("html.light {")  # the hand rule, after the block's
                return s[:at] + s[at:].replace("    --fg: var(--silk);\n", "", 1)

            t.edit("www/theme/css/variables.css", drop_paper_fg)
            got = [p for p in t.problems() if "var(--fg)" in p]
            self.assertTrue(got, "no report of --fg")
            self.assertTrue(all("is not defined on docs-paper, which loads this file; define it in www/theme/css/variables.css (html.light)" in p for p in got), got)

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

    def test_an_edit_inside_the_reduced_motion_line_leaves_the_block_stale(self):
        with Tree() as t:
            t.edit("apps/web/style.css", lambda s: s.replace(":root { --d-press: 0ms; --d-state: 0ms; --d-move: 0ms; }", ":root { --d-press: 0ms; --d-state: 0ms; --d-move: 90ms; }", 1))
            self.assertTrue(any(p.startswith("apps/web/style.css") and "stale" in p for p in t.problems()))

    def test_the_generator_is_idempotent(self):
        with Tree() as t:
            with contextlib.redirect_stdout(io.StringIO()) as out:
                T.generate(check=False)
            self.assertEqual(out.getvalue(), "", "a second run wrote a block the first had written")
            before = {c["file"]: open(os.path.join(t.root, c["file"]), encoding="utf-8").read() for c in T.CONSUMERS}
            with contextlib.redirect_stdout(io.StringIO()):
                T.generate(check=False)
            after = {c["file"]: open(os.path.join(t.root, c["file"]), encoding="utf-8").read() for c in T.CONSUMERS}
            self.assertEqual(before, after)


class TheRatchetsHoles(unittest.TestCase):
    """Each way a size or duration slipped past the count, planted in the app
    and expected to count."""

    def counts_in(self, rel, add):
        with Tree() as t:
            t.edit(rel, lambda s: s + "\n" + add + "\n")
            return [p for p in t.problems() if p.startswith(rel)]

    def test_an_em_or_percent_or_uppercase_font_size_counts(self):
        for rule in (".x { font-size: 0.9em; }", ".x { font-size: 85%; }", ".x { font: 600 0.8em/1 var(--font-mono); }", ".x { font-size: 13PX; }"):
            self.assertTrue(any("literal font sizes" in p for p in self.counts_in("apps/web/style.css", rule)), rule)

    def test_a_scripts_animation_duration_counts(self):
        for line in ("el.animate(kf, { duration: 300, easing: e });", "el.animate([{ opacity: 0 }, { opacity: 1 }], 240);"):
            self.assertTrue(any("literal time sizes" in p for p in self.counts_in("apps/web/main.js", line)), line)

    def test_a_canvas_font_in_any_form_counts(self):
        for line in (
            "ctx.font = `${dpr * 11}px mono`;",
            'ctx.font = Math.round(10 * dpr) + "px mono";',
            "ctx.font = f;",
            'ctx.font = size + "px mono";',
        ):
            self.assertTrue(any("literal font sizes" in p for p in self.counts_in("apps/web/main.js", line)), line)
        self.assertEqual(self.counts_in("apps/web/main.js", "ctx.font = canvasFont(dpr);"), [])

    def test_set_property_counts(self):
        for line in ('el.style.setProperty("padding", "6px");', 'el.style.setProperty("padding", wide ? "6px" : "0px");'):
            self.assertTrue(any("literal space sizes" in p for p in self.counts_in("apps/web/main.js", line)), line)

    def test_an_svg_font_size_attribute_counts(self):
        line = 'svg.innerHTML = `<text font-size="9" x="1">in</text>`;'
        self.assertTrue(any("literal font sizes" in p for p in self.counts_in("apps/web/main.js", line)))

    def test_a_literal_held_in_a_custom_property_counts_where_a_counted_declaration_uses_it(self):
        self.assertTrue(any("literal space sizes" in p for p in self.counts_in("apps/web/style.css", ".x { --pad: 10px; }\n.y { padding: var(--pad); }")))
        self.assertTrue(any("literal time sizes" in p for p in self.counts_in("apps/web/main.js", 'el.style.setProperty("--fade-in", "200ms"); const r = "transition: opacity var(--fade-in)";')))
        # A height in a custom property is not a space.
        self.assertEqual(self.counts_in("apps/web/style.css", ".x { --tall: 44px; }\n.y { height: var(--tall); }"), [])

    def test_a_token_another_surface_owns_cannot_be_defined_or_used(self):
        got = self.counts_in("apps/web/style.css", ":root { --s8: 72px; }")
        self.assertTrue(any("defines --s8, which belongs to" in p for p in got), got)
        got = self.counts_in("apps/web/style.css", ".x { margin: var(--s8); }")
        self.assertTrue(any("var(--s8) belongs to" in p for p in got), got)

    def test_two_surfaces_sharing_a_custom_property_name_do_not_count_for_each_other(self):
        # The brand page's --frame is a width. The landing page padding with a
        # --frame of its own must not make the brand page's count as a space.
        with Tree() as t:
            t.edit("www/landing/style.css", lambda s: s + "\n.x { padding: var(--frame); }\n")
            got = t.problems()
            self.assertFalse(any(p.startswith("www/brand/index.html") for p in got), got)
        # Within one surface the app's script and stylesheet count together.
        self.assertTrue(any("literal space sizes" in p for p in self.counts_in("apps/web/main.js", 'el.style.setProperty("--gap-x", "10px"); const r = "gap: var(--gap-x)";')))

    def test_a_duration_outside_animate_is_not_an_animation(self):
        self.assertEqual(self.counts_in("apps/web/main.js", "note(text, { duration: 4000 });\nconst clip = { duration: 2.5 };"), [])

    def test_only_a_canvas_contexts_font_counts_and_a_style_font_counts_once(self):
        self.assertEqual(self.counts_in("apps/web/main.js", "label.font = fontFor(kind);"), [])
        self.assertTrue(any("literal font sizes" in p for p in self.counts_in("apps/web/main.js", 'this.ctx.font = "10px mono";')))
        got = self.counts_in("apps/web/main.js", 'el.style.font = "12px mono";')
        self.assertTrue(any(": 1 literal font sizes" in p for p in got), got)

    def test_a_font_size_that_is_the_parents_is_not_counted(self):
        self.assertEqual(self.counts_in("apps/web/style.css", ".x { font-size: 100%; }\n.y { font-size: 1em; }\n.z { font: inherit; }"), [])

    def test_an_exemption_attaches_past_a_strings_quote_and_another_comment(self):
        self.assertEqual(self.counts_in("apps/web/main.js", 'el.style.cssText = "padding: 6px"; // token-exempt: geometry'), [])
        self.assertEqual(self.counts_in("apps/web/style.css", ".x { font-size: 13px; /* a note */ /* token-exempt: a glyph */ }"), [])

    def test_an_exemption_covers_only_the_declaration_it_trails(self):
        got = self.counts_in("apps/web/style.css", ".x { font-size: 13px; animation: spin 1.2s linear infinite; } /* token-exempt: a loop's period */")
        self.assertTrue(any("literal font sizes" in p for p in got), got)
        self.assertFalse(any("literal time sizes" in p for p in got), got)
        self.assertEqual(self.counts_in("apps/web/style.css", ".x { font-size: 13px; /* token-exempt: a glyph */ animation: spin 1.2s linear infinite; /* token-exempt: a loop */ }"), [])


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
        # The app's lit lamp (the round lamp after the wordmark, Plan-008),
        # then the brand page's two drawings of a lit one: the "lamp live"
        # lockup and the "two lamps" example.
        self.assertRegex(app, r"\.lamp\.thinking \{[^}]*?\bbackground: var\(--phos-b\);")
        self.assertRegex(brand, r'AURACLE<i class="lamp-live" style="[^"]*\bbackground:var\(--phos-b\)"></i>')
        self.assertRegex(brand, r"\.versus \.no \.wm b \{[^}]*?\bcolor: var\(--phos-b\);")


def case_ids(suite):
    for t in suite:
        yield from case_ids(t) if isinstance(t, unittest.TestSuite) else [t.id()]


def run_one(name):
    """One case, in a worker. By its name within the module: a spawned worker
    imports this file as `__mp_main__`, not `__main__`."""
    out = io.StringIO()
    case = unittest.defaultTestLoader.loadTestsFromName(name, sys.modules[__name__])
    result = unittest.TextTestRunner(stream=out, verbosity=2).run(case)
    return result.testsRun, result.wasSuccessful(), out.getvalue()


if __name__ == "__main__":
    # One line when they pass, like the rest of `make dev-check`; everything
    # unittest says about each case that fails.
    names = [i.split(".", 1)[1] for i in case_ids(unittest.defaultTestLoader.loadTestsFromModule(sys.modules[__name__]))]
    cores = getattr(os, "process_cpu_count", os.cpu_count)() or 1
    with concurrent.futures.ProcessPoolExecutor(max_workers=min(cores, len(names))) as pool:
        results = list(pool.map(run_one, names))
    failed = [out for _, ok, out in results if not ok]
    if failed:
        sys.stderr.write("".join(failed))
        sys.exit(1)
    print(f"  tokens tests: {sum(n for n, _, _ in results)} passed")
