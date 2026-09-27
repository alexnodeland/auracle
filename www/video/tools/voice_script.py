#!/usr/bin/env python3
"""A film's narration, as voice/tts.py reads it.

usage: voice_script.py FILM_DIR OUT.json

Flattens films/<film>/script.json (beats of lines) into tts.py's script (one
list of lines), keeping each line's id and its pause, and adds the shared
pronunciation lexicon (voice/lexicon.json), so that every film says "Auracle"
the same way.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    film_dir, out = sys.argv[1], sys.argv[2]
    s = json.load(open(os.path.join(film_dir, "script.json")))
    # One lexicon for every film, so "Auracle" is said the same way in all of
    # them; its ASR aliases keep asr_check.py from scoring a correct
    # pronunciation ("oracle") as a wrong word.
    lex_path = os.path.join(HERE, "..", "films", "lexicon.json")
    shared = json.load(open(lex_path)) if os.path.exists(lex_path) else {}
    lexicon = shared.get("lexicon", {})
    aliases = shared.get("asr_aliases", {})
    lines = []
    for b in s["beats"]:
        for l in b["lines"]:
            lines.append({"id": l["id"], "text": l["text"], "pause_after": l.get("post", 0.4)})
    v = s.get("voice", {})
    doc = {"voice": v.get("voice", "af_heart"), "speed": v.get("speed", 1.0), "lexicon": lexicon, "asr_aliases": aliases, "lines": lines}
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    json.dump(doc, open(out, "w"), indent=1, ensure_ascii=False)
    print(f"{out}: {len(lines)} lines, voice {doc['voice']} at {doc['speed']}")


if __name__ == "__main__":
    main()
