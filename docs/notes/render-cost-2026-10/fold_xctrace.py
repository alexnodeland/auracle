#!/usr/bin/env python3
"""Fold a native Time Profiler trace of the render into the profile's buckets.

    xctrace record --template 'Time Profiler' --output render.trace --launch -- \\
        target/release/examples/bench_render --loop=2
    xctrace export --input render.trace \\
        --xpath '/trace-toc/run[@number="1"]/data/table[@schema="time-profile"]' > render.xml
    python3 docs/notes/render-cost-2026-10/fold_xctrace.py render.xml

Every sample of the process's threads is put in one bucket, by its stack
read from the top (the leaf) down:

- a module's `tick` (a `GraphModule` impl, quiver's or the grammar's own):
  that module kind's DSP, with every function it calls (libm's `tanh`, `exp`
  and the rest), whether inlined or not;
- `quiver::graph::Patch::tick` itself (its own time, nothing it calls through
  a module's vtable): the graph walk, the per-sample work beyond the DSP:
  gathering each node's inputs, the `PortValues` it hands the module,
  scattering and sanitizing its outputs;
- the analysis, by function: φ's audio features, loudness, vetting, the face,
  the FFTs they run (rustfft), the structural features;
- compiling the term to a patch (`auracle_grammar::compile`), quiver's own
  graph compile, allocation, and what is left.

Prints each bucket's share of the samples, and of the DSP alone the share of
each module kind. Shares, not times: under load a sampler's share is what
holds (a descheduled thread takes no samples).
"""
import collections
import re
import sys
import xml.etree.ElementTree as ET

MODULE = re.compile(r"_\$LT\$(?:[a-z_]+\.\.)+([A-Za-z0-9]+)(?:\$LT\$.*?\$GT\$)?\$u20\$as\$u20\$quiver\.\.port\.\.GraphModule\$GT\$::tick")
MODULE_WANTED = re.compile(r"quiver::modules::[a-z_]+::([A-Za-z0-9]+)::tick_wanted")
STAGES = [
    ("φ audio", re.compile(r"auracle_features::audio::")),
    ("loudness", re.compile(r"auracle_features::loudness::")),
    ("vet", re.compile(r"auracle_features::vet::")),
    ("face", re.compile(r"auracle_features::face::")),
    ("φ struct", re.compile(r"auracle_features::structural::")),
    ("compile (grammar)", re.compile(r"auracle_grammar::compile::")),
    ("compile (quiver)", re.compile(r"quiver::graph::Patch::(compile|add|connect)")),
    ("memo key", re.compile(r"auracle_features::cache::")),
]


def main(path):
    root = ET.parse(path).getroot()
    frames, stacks = {}, {}

    def name(f):
        if "ref" in f.attrib:
            return frames[f.attrib["ref"]]
        frames[f.attrib["id"]] = f.attrib.get("name", "?")
        return frames[f.attrib["id"]]

    buckets = collections.Counter()
    kinds = collections.Counter()
    graph_leaf = collections.Counter()
    total = 0
    for row in root.iter("row"):
        bt = row.find("backtrace")
        if bt is None:
            continue
        if "ref" in bt.attrib:
            names = stacks[bt.attrib["ref"]]
        else:
            names = [name(f) for f in bt.findall("frame")]
            stacks[bt.attrib["id"]] = names
        total += 1
        bucket = None
        for i, n in enumerate(names):
            m = MODULE.search(n) or MODULE_WANTED.search(n)
            if m:
                bucket = "DSP"
                kinds[m.group(1)] += 1
                break
            if n.startswith("quiver::graph::Patch::tick"):
                bucket = "graph walk"
                graph_leaf[names[0]] += 1
                break
            if n.startswith("quiver::port::GraphModule::tick_masked"):
                # A module's default tick_masked calling its tick: a module
                # whose tick was inlined into it; name it by the frame below
                # nothing better: count it as DSP of an unnamed kind.
                bucket = "DSP"
                kinds["(tick_masked, inlined)"] += 1
                break
            hit = next((s for s, rx in STAGES if rx.search(n)), None)
            if hit:
                bucket = hit
                break
        if bucket is None:
            leaf = names[0]
            if "rustfft" in leaf:
                bucket = "FFT (outside a stage)"
            elif re.search(r"malloc|free|realloc|memmove|memcpy|memset|_platform_", leaf):
                bucket = "allocation, copies"
            else:
                bucket = "other"
        buckets[bucket] += 1

    print(f"{total} samples")
    for b, v in buckets.most_common():
        print(f"{100 * v / total:6.1f}%  {b}")
    dsp = buckets["DSP"]
    if dsp:
        print(f"\nthe DSP ({100 * dsp / total:.1f}% of all), by module kind:")
        for k, v in kinds.most_common():
            print(f"{100 * v / dsp:6.1f}% of DSP  {100 * v / total:5.1f}% of all  {k}")
    gw = buckets["graph walk"]
    if gw:
        print(f"\nthe graph walk ({100 * gw / total:.1f}% of all), by the function on top:")
        for k, v in graph_leaf.most_common(8):
            print(f"{100 * v / gw:6.1f}%  {k[:110]}")


if __name__ == "__main__":
    main(sys.argv[1])
