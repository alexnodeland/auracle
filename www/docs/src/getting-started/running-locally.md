# Running it yourself

<p class="lede">Auracle runs in a browser: the hosted app, a release bundle you
serve yourself, or a build from source. This page covers all three, a booth
set-up, and what it asks of your machine.</p>

## In the browser, hosted

1. Open [**auracle.alexnodeland.com/play/**](../../play/).

That’s the live build. It tracks `main`: it deploys from `main` once
`main`’s CI is green. A tagged release doesn’t deploy on its own; it is tagged
on `main`, and the live build follows `main`.

There is nothing to install, and nothing leaves your machine. The engine is
WebAssembly running in your tab, and your sounds and taste live in your
browser’s storage. There is no account, and no server to send anything to.

## From a release bundle, offline

Every [release](https://github.com/alexnodeland/auracle/releases) carries
`auracle-vX.Y.Z-web.zip`: the instrument, built, with no tools needed.

1. Unzip it.
2. Serve the folder over HTTP.
3. Open the address it prints.

```bash
unzip auracle-vX.Y.Z-web.zip
cd auracle-vX.Y.Z-web
python3 serve.py        # → http://localhost:8642
```

Any static server works (`npx serve`, `php -S`, and others), but it must be
HTTP, not `file://`. The instrument uses module workers, and browsers won’t
load those from a file.

The bundle is pinned to its tag. The live site tracks `main`, so it’s the same
build on the day a release is cut, and may be newer after.

## From source

Auracle’s foundations ([`quiver-dsp`](https://crates.io/crates/quiver-dsp),
[`fugue-ppl`](https://crates.io/crates/fugue-ppl), and
[`fugue-evo`](https://crates.io/crates/fugue-evo)) come from crates.io.

1. Install a Rust toolchain with the `wasm32-unknown-unknown` target, and
   [`wasm-pack`](https://rustwasm.github.io/wasm-pack/).
2. Clone the repository, build the engine, and serve it:

```bash
git clone https://github.com/alexnodeland/auracle.git
cd auracle
make wasm     # build the engine into apps/web/pkg
make serve    # → http://localhost:8642
```

`make wasm` puts `~/.cargo/bin` first in `PATH`: a Homebrew `rustc` earlier in
the path lacks the wasm standard library, and fails in confusing ways.

To work on Auracle rather than with it, see
[`CONTRIBUTING.md`](https://github.com/alexnodeland/auracle/blob/main/CONTRIBUTING.md).

```admonish warning title="Use the bundled server"
`make serve` runs `apps/web/serve.py`, which sends `Cache-Control: no-store`.
Plain `python3 -m http.server` doesn’t, and the browser’s cache will keep
serving an old `worker.js` or `.wasm` across rebuilds. That looks like a
rebuild that changed nothing, or an engine and a page from two different
builds.
```

## At a booth

For a kiosk or a show floor:

1. Turn on *Booth mode* in [⌘K](../levels.md#k-find-anything), or open the app with `?booth` on
   the address (`?booth=30` sets the idle time to thirty seconds; the default
   is a minute).
2. Leave it. With nobody at the keys, it plays itself.

What happens:

- **It plays itself.** With nobody at the keys, the instrument plays itself in
  PERFORM, through a set of presets. It holds a chord progression, moves two
  named controls under an invisible hand (their dials turn), lets Wander turn
  the knobs, then grows an offer in B and blends it in.
- **It hands over.** Any key, click, touch, wheel, or MIDI note stops it on
  the spot. The visitor is holding whatever was playing, with Wander still and
  BLEND home. Nothing it did while playing itself is logged or counted as a
  pick.
- **The next visitor.** <kbd>⇧Esc</kbd> (or *New visitor* in ⌘K)
  forgets the visitor’s taste and starts again with the warm start, on a new
  pool (it takes `?seed` off the address). Booth mode and PERFORM’s measured
  controls are kept, so the set stays instant.
- **It measures ahead.** As soon as booth mode is on, it measures the set’s
  presets for PERFORM in the background (Glass Pad, Acid Line, Loom, Undertow,
  Sub & Sparkle, Detune Dream, Wobble Board, and Cathedral), one at a time and
  only in a quiet moment. PERFORM keeps each measurement across reloads, so
  after the machine’s first boot no visitor waits for one.

A MIDI controller with eight knobs is picked up with nothing to set: the first
eight knobs you turn take the first eight controls on PERFORM’s deck: with
the six named controls on the panel, those six, BLEND, and WANDER.

## Browser support

Auracle needs a current desktop browser, with AudioWorklet, WebAssembly, module
workers, and IndexedDB. All have been standard for years, and Auracle uses
them hard.

| | |
|---|---|
| **Chrome, Edge** | Recommended. The fastest render workers, and Web MIDI works |
| **Firefox** | Supported. Web MIDI works once you allow its site permission |
| **Safari** | Supported. No Web MIDI; boot is slower, and render workers are limited |

Without Web MIDI, everything still works from the computer keyboard and the
keybed on screen; see [playing it](../playing.md).

### Handheld devices

A touch screen whose window is under 620 px on its shorter side doesn’t start
the engine, and turning it sideways doesn’t change that. You get a screen
asking for a desktop, with *look around anyway →* if you want to see the
interface.

This is deliberate. Boot costs about 40 renders, and a phone would pay for all
of them and then have nowhere to draw a rack, a bank, and a keybed at once. A
phone layout is still to be designed.

**Tablets work** if the window is big enough. Every rack gesture works under a
finger: knob drags, cable pulls, locks, and the ⋯ menus. Whatever a mouse finds
by hovering is shown outright on a touch screen, because on a tablet,
hover-to-reveal means never.

## What it asks of your machine

- **At boot:** about 40 renders, spread across `min(cores − 2, 6)` background
  workers, or two if the device reports 4 GB of memory or less. Add `?farm=0`
  to the address to boot without them.
- **While you play:** four voices of modular sound on a real-time audio thread,
  and four more while PERFORM’s B holds an offer. Modest, but heavy work in
  another tab can cause dropouts. When the sound starts to fall behind (a
  slower laptop), Auracle protects it for as long as that lasts: B stays
  silent at BLEND’s home, and what the instrument does on its own (filling
  the bank, a generation’s walks, Wander, measuring in the background) waits
  while notes sound and for a second after, going on a step at a time after
  eight seconds of playing.
- **At a refit:** seconds of work, off the audio thread. You can keep playing
  through it.
- **Storage:** your session, in IndexedDB. Tens of megabytes at most, mostly
  the log of what you taught it.

## Overrides

Added to the address, these change how it runs on your machine, or what it
deals:

| | |
|---|---|
| `?farm=k` | Use exactly `k` render workers. `0` boots without them |
| `localStorage["auracle-renderers"]` | The same, kept |
| `?seed=n` | Deal the session from the random seed `n`, a whole number |

Without `?seed`, every new session starts from a random seed of its own. With
it, a fresh session (nothing saved in this browser yet) deals the same pool of
sounds, under the same names, on any machine running the same version, at any
worker count, so you can send the address to someone and they start where you
did. (A sound you haven't named takes its name from the bank as it stood when
the sound arrived, the first eight from each other, so how fast the bank filled
can't change it.) The pairs, refits and offers after that draw from the same
random seed, and repeat when the same things happen in the same order. A pair
dealt before the pool has finished filling is dealt from the sounds that arrived
first and waits for any not there yet, so the machine's speed can't change it
either. (Without `?seed`, a pair is dealt at once from the sounds that have
arrived, and never waits for more.) A saved session comes back as it was.
Which side of the table a sound stands on, and the warm start's nine cards,
are shuffled either way, so no side or card is favored. **Reset your taste…**
and a booth's next visitor take `?seed` off the address as they start over,
so a reset deals a new pool.

```admonish info collapsible=true title="How it works: the same pool at any worker count"
The pool is identical at every worker count, including zero: the draws are
numbered, and folded in by number. If a worker dies mid-boot, the engine takes
over the same draws. The one exception is a render that times out twice: that
draw is dropped and skipped, and the note goes to `window.__aurLog` rather
than the console.
```
