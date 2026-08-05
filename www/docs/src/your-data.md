# Your data

<p class="lede">It is in your browser, it is yours, and it never leaves unless you
export it.</p>

## Where it lives

Everything is in your browser's **IndexedDB**, under the origin you loaded the
app from. There is no account, no server and nothing to sign into. The engine
is WebAssembly running in your tab; no audio, no patch and no vote is
transmitted anywhere.

Practical consequences:

- A different browser, or a different machine, is a **different session**.
- The hosted build and a locally-served copy are **different origins**, so they
  do not share a session.
- Clearing site data clears your session. So does a browser "clear browsing
  data" sweep that includes site storage.
- Private / incognito windows get a session that dies with the window.

## What is saved

Autosaved continuously as you work:

| | |
|---|---|
| The evolution pool | Every candidate, with its features and lineage |
| **my patches** | Everything you saved |
| Names | Patch names and style names you set |
| The observation log | Every duel, star, keep/kill and edit claim |
| The posterior | The fitted model, plus its standardizer |
| Layout and settings | Rack positions, dock size, keybed width, scope config, node-bank state |
| The HELD tray | What you unplugged, across reloads |

Restore runs across background workers, so a large session comes back without a
long stall.

## Exporting and importing

All from the **⋯** menu.

### Taste profile

**Save taste profile** writes a JSON file containing the observation log **and
the standardizer it was recorded under**.

Both, always, together. The model's coefficients are only meaningful relative
to the scaling that produced them, so a log without its standardizer has lost
its units. The log is the source of truth; the fitted posterior can be
recomputed from it.

**Load taste profile** brings one back. This is how you move a taught model to
another machine or another browser.

### Individual patches

**Export this patch** writes JSON. **Import a patch** accepts `.json`, and also
`.png` and `.svg`.

### Patches as images

**Export as image…** renders the rack to PNG or SVG at a scale and background
you choose. **The image contains the patch**: an exported Auracle PNG can be
imported back and will produce the same patch, so a screenshot of a rack posted
in a chat is a shareable patch.

```admonish warning title="Imported files are content, not code"
A patch file names things: its own name, its module labels. Those names are
escaped everywhere they are displayed, including when they arrive from an
imported file, so opening a patch someone sent you cannot run anything in your
session.
```

### Recordings

**● REC** in the dock bounces your playing to a WAV. That is a normal audio
file and nothing about it is Auracle-specific.

## Resetting

**⋯** → *Reset taste profile…* clears the observation log and the fitted model.
It asks first.

This is the right move when you have been teaching it something it cannot see,
or when you want to start a different taste from the same pool. It does **not**
clear **my patches**; saved patches are storage, not evidence, and they survive
a taste reset.

To clear everything, clear the site's data in your browser.

## Version changes

Auracle is pre-1.0 and the save format **may change between versions**. There
is a migration path: sessions written by older builds are upgraded on load, and
observations recorded under an older audition phrase keep their structural
coordinates while their old-stimulus audio coordinates are marked "no evidence"
instead of being mixed into a scale they were never comparable with.

That said: migrations are code, and code has bugs.

```admonish tip title="Before updating, export"
**Save taste profile** and export any patch you would be annoyed to lose. It takes
ten seconds, and it is the only backup that exists.
```
