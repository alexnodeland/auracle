# Running it yourself

<p class="lede">Hosted in a browser, from a release bundle, or from source.</p>

## In the browser, hosted

[**alexnodeland.github.io/auracle/play/**](../../play/) is the live build. Every
push to `main` deploys it, and so does every tagged release.

Nothing to install, and nothing leaves your machine: the engine is WebAssembly
running in your tab, and your bank and taste model live in your browser's
storage. There is no account and no server to send anything to.

## From a release bundle, offline

Every [release](https://github.com/alexnodeland/auracle/releases) attaches
`auracle-vX.Y.Z-web.zip`, the prebuilt instrument, no toolchain required. Unzip
it and serve the directory over HTTP:

```bash
unzip auracle-v0.2.0-web.zip
cd auracle-v0.2.0-web
python3 serve.py        # → http://localhost:8642
```

Any static server works (`npx serve`, `php -S`, …), but it must be **HTTP, not
`file://`**. The instrument uses module workers, and browsers refuse to load
those from a file URL.

The bundle is built from the same commit as the tagged live site, so the two
are identical.

## From source

Auracle's foundations ([`quiver-dsp`](https://crates.io/crates/quiver-dsp),
[`fugue-ppl`](https://crates.io/crates/fugue-ppl),
[`fugue-evo`](https://crates.io/crates/fugue-evo)) come from crates.io:

```bash
git clone https://github.com/alexnodeland/auracle.git
cd auracle
make wasm     # build the engine into apps/web/pkg
make serve    # → http://localhost:8642
```

You need a Rust toolchain with the `wasm32-unknown-unknown` target and
[`wasm-pack`](https://rustwasm.github.io/wasm-pack/). `make wasm` puts
`~/.cargo/bin` first in `PATH`: a Homebrew `rustc` earlier in the path lacks
the wasm standard library and fails confusingly.

To work *on* Auracle rather than with it, see
[`DEVELOPMENT.md`](https://github.com/alexnodeland/auracle/blob/main/DEVELOPMENT.md).

```admonish warning title="Use the bundled dev server"
`make serve` runs `apps/web/serve.py`, which sends `Cache-Control: no-store`.
Plain `python3 -m http.server` does not, and a browser's heuristic cache will
keep serving a stale `worker.js` or `.wasm` across rebuilds. That looks like a
rebuild that changed nothing, or an engine and a UI from two different commits.
```

## Browser support

Auracle needs a current desktop browser. Specifically it needs AudioWorklet,
WebAssembly, module workers and IndexedDB, all of which have been standard for
years. It uses them hard.

| | |
|---|---|
| **Chrome / Edge** | Recommended. Best worker throughput, and Web MIDI works |
| **Firefox** | Fully supported. No Web MIDI, so keyboard and on-screen keys only |
| **Safari** | Supported. No Web MIDI. Boot is slower; render workers are capped |

**Web MIDI** is Chromium-only today. Without it everything still works from the
computer keyboard and the on-screen keys; see [Playing it](../playing.md).

### Handheld devices

A coarse pointer with a viewport narrower than 620px **does not boot the
engine**. You get a stand-in screen asking for a desktop, with a *look around
anyway* link if you want to see the interface.

This is deliberate. Boot costs about forty audio renders, and a phone would pay
for all of them and then have nowhere to draw a rack, a bank and a keyboard at
once. A real handheld layout is still to be designed.

**Tablets are supported** if the viewport is big enough. Every rack gesture
works under a finger: knob drags, cable pulls, locks, the ⋯ menus. Anything a
mouse reveals by hovering is shown outright on a touch device, because
hover-to-reveal on a tablet means never.

## What it costs your machine

- **CPU on boot.** Around forty renders, spread across `min(cores − 2, 6)`
  background workers, or two if the device reports 4 GB of memory or less. Set
  `?farm=0` in the URL to force the single-threaded path.
- **CPU while playing.** Four voices of modular DSP on a real-time audio
  thread. Modest, but a browser doing heavy work in another tab can cause
  dropouts.
- **CPU on a refit.** Seconds of Markov-chain inference, off the audio thread.
  You can keep playing through it.
- **Storage.** Your session in IndexedDB. Tens of megabytes at most, dominated
  by the observation log.

## Overrides

A few knobs, for when the defaults are wrong for your machine:

| | |
|---|---|
| `?farm=k` | Use exactly `k` render workers. `0` is the serial path |
| `localStorage["auracle-renderers"]` | The same, persisted |

The candidate pool is **identical at every worker count, including zero**: the
draw stream is indexed and absorbed in index order. If a worker dies mid-boot,
the fill falls back to the serial path over the same draws.
