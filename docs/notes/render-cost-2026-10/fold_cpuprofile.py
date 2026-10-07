#!/usr/bin/env python3
"""Fold a V8 CPU profile of the wasm render into the profile's buckets.

    wasm-pack build crates/auracle-wasm --target web --out-dir /tmp/pkg-prof --profiling
      (with RUSTFLAGS="-C link-arg=-zstack-size=8388608", as `make wasm` sets: a
      release build that keeps the function names wasm-opt strips)
    node --cpu-prof --cpu-prof-dir=/tmp/prof --cpu-prof-interval=500 \\
        crates/auracle-wasm/examples/bench_render.mjs --reps=2 /tmp/pkg-prof
    python3 docs/notes/render-cost-2026-10/fold_cpuprofile.py /tmp/prof/*.cpuprofile

Each sample's time goes to the function it was in (V8's self time); the
function's name puts it in a bucket, as `fold_xctrace.py` does natively:

- a module's `tick` (or `tick_wanted`, `tick_masked`): that kind's DSP, with
  its own math (libm's `tanh`, `exp`, `pow`, `sin` and the rest go to "libm",
  shown apart, since in wasm they are calls of their own);
- `Patch::tick` and what it inlines (the gather, the scatter, `PortValues`):
  the graph walk;
- the analysis by function (φ's audio features, loudness, vetting, the face,
  rustfft), compiling, serde (the JSON at the boundary), the allocator, and
  what is JavaScript (the glue, the bench).
"""
import collections
import json
import re
import sys

MODULE = re.compile(r"<(?:[a-z_]+::)+([A-Za-z0-9]+)(?:<[^>]*>)? as quiver::port::GraphModule>::tick")
WANTED = re.compile(r"quiver::modules::[a-z_]+::([A-Za-z0-9]+)::tick_wanted")
BUCKETS = [
    ("graph walk", re.compile(r"quiver::graph::|quiver::port::PortValues|NodeExec")),
    ("libm", re.compile(r"libm::")),
    ("φ audio", re.compile(r"auracle_features::audio::")),
    ("loudness", re.compile(r"auracle_features::loudness::")),
    ("vet", re.compile(r"auracle_features::vet::")),
    ("face", re.compile(r"auracle_features::face::")),
    ("FFT (rustfft)", re.compile(r"rustfft")),
    ("render loop", re.compile(r"auracle_features::render::")),
    ("compile", re.compile(r"auracle_grammar::compile|quiver::graph::Patch::(add|connect|compile)")),
    ("serde (boundary JSON)", re.compile(r"serde")),
    ("allocator, copies", re.compile(r"dlmalloc|alloc::|memcpy|memset|memmove")),
]


def main(path):
    prof = json.load(open(path))
    nodes = {n["id"]: n for n in prof["nodes"]}
    self_us = collections.Counter()
    for sample, dt in zip(prof["samples"], prof["timeDeltas"]):
        self_us[sample] += dt
    buckets = collections.Counter()
    kinds = collections.Counter()
    fns = collections.Counter()
    total = 0
    for nid, us in self_us.items():
        cf = nodes[nid]["callFrame"]
        name = cf["functionName"] or "(anonymous)"
        url = cf.get("url", "")
        if name in ("(idle)", "(program)", "(garbage collector)", "(root)"):
            continue
        total += us
        fns[name] += us
        m = MODULE.search(name) or WANTED.search(name)
        if m:
            buckets["DSP (module ticks)"] += us
            kinds[m.group(1)] += us
            continue
        hit = next((b for b, rx in BUCKETS if rx.search(name)), None)
        if hit is None:
            hit = "JavaScript" if url.endswith(".js") or url.endswith(".mjs") else "other wasm"
        buckets[hit] += us
    print(f"{total / 1e3:.0f} ms of samples")
    for b, us in buckets.most_common():
        print(f"{100 * us / total:6.1f}%  {b}")
    dsp = buckets["DSP (module ticks)"]
    if dsp:
        print("\nthe module ticks, by kind (libm is apart, above):")
        for k, us in kinds.most_common(20):
            print(f"{100 * us / total:6.1f}% of all  {k}")
    print("\nthe heaviest functions:")
    for f, us in fns.most_common(15):
        print(f"{100 * us / total:6.1f}%  {f[:110]}")


if __name__ == "__main__":
    main(sys.argv[1])
