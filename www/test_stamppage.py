#!/usr/bin/env python3
"""The page stamp's tests (`www/stamppage.py`).

    python3 www/test_stamppage.py      (run by `make dev-check`)

Each case builds a throwaway copy of a page, so no test reads or writes the
real one, except the last, which checks that the real page is still written
the way the stamp expects. Python 3 standard library only.
"""

import os
import pathlib
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import stamppage as S  # noqa: E402

PAGE = '<link rel="stylesheet" href="style.css">\n<script>\n    s.src = "main.js";\n</script>\n'


class Stamp(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.tmp.name)
        (self.root / "style.css").write_text("body { color: red }")
        (self.root / "main.js").write_text("console.log(1)")

    def tearDown(self):
        self.tmp.cleanup()

    def test_each_file_gets_its_own_content_hash(self):
        out = S.stamp(PAGE, self.root)
        self.assertIn(f'href="style.css?v={S.digest(self.root / "style.css")}"', out)
        self.assertIn(f's.src = "main.js?v={S.digest(self.root / "main.js")}"', out)
        self.assertNotEqual(S.digest(self.root / "style.css"), S.digest(self.root / "main.js"))

    def test_same_bytes_same_url_and_a_change_a_new_one(self):
        first = S.stamp(PAGE, self.root)
        self.assertEqual(first, S.stamp(PAGE, self.root))
        (self.root / "main.js").write_text("console.log(2)")
        second = S.stamp(PAGE, self.root)
        self.assertNotEqual(first, second)
        # Only main.js's URL moved.
        self.assertEqual(first.splitlines()[0], second.splitlines()[0])

    def test_a_missing_or_doubled_name_stops_the_build(self):
        for page in (PAGE.replace('href="style.css"', 'href="style.css?b=1"'), PAGE + PAGE):
            with self.assertRaises(SystemExit):
                S.stamp(page, self.root)

    def test_main_stamps_the_page_in_place(self):
        (self.root / "index.html").write_text(PAGE)
        S.main(["stamppage.py", str(self.root)])
        self.assertIn("main.js?v=", (self.root / "index.html").read_text())

    def test_the_real_page_is_written_the_way_the_stamp_expects(self):
        real = pathlib.Path(HERE).parent / "apps" / "web" / "index.html"
        text = real.read_text(encoding="utf-8")
        for ref, _ in S.REFS:
            self.assertEqual(text.count(ref), 1, ref)
        self.assertNotIn("?b=", text)


if __name__ == "__main__":
    unittest.main(verbosity=1)
