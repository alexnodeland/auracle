# Your data

<p class="lede">It is in your browser, it is yours, and it never leaves unless you
export it.</p>

## Where it lives

Everything is in your browser's **IndexedDB**, under the origin you loaded the app
from. There is no account, no server and nothing to sign into. The engine is
WebAssembly running in your tab; no audio, no patch and no vote is transmitted
anywhere.

Practical consequences:

- A different browser, or a different machine, is a **different session**.
- The hosted build and a locally-served copy are **different origins**, so they do
  not share a session.
- Clearing site data clears your session. So does a browser "clear browsing data"
  sweep that includes site storage.
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

Restore is farmed across background workers, so coming back to a large session is
a progress bar that moves rather than one pinned at zero.

## Exporting and importing

All from the **⋯** menu.

### Taste profile

**Save taste profile** writes a JSON file containing the observation log **and the
standardizer it was recorded under**.

Both, always, together — and this is not packaging convenience. The model's
coefficients are only meaningful relative to the scaling that produced them, so a
log without its standardizer is a set of numbers whose units have been lost. The
log is the source of truth; the fitted posterior can always be recomputed from it.

**Load taste profile** brings one back. This is how you move a taught model to
another machine or another browser.

### Individual patches

**Export this patch** writes JSON. **Import a patch** accepts `.json`, and also
`.png` and `.svg`.

### Patches as images

**Export as image…** renders the rack to PNG or SVG at a scale and background you
choose — and **the image contains the patch**. An exported Auracle PNG can be
imported back and will produce the same patch. A screenshot of a rack posted in a
chat is a shareable patch.

```admonish warning title="Imported files are content, not code"
A patch file names things — its patch name, its module labels — and those names are
escaped everywhere they are displayed. This matters because it was once a real
hole: renaming a patch to an HTML tag executed it, persisted into the saved bank
and re-fired on every reload, and the *same* path is fed by imported patch JSON,
so opening a shared patch was script execution in the recipient's session. It is
fixed, and named here because "just a name field" is exactly how it happened.
```

### Recordings

**● REC** in the dock bounces your playing to a WAV. That is a normal audio file
and nothing about it is Auracle-specific.

## Resetting

**⋯** → *Reset taste profile…* clears the observation log and the fitted model. It
asks first.

This is the right move when you have been teaching it something it cannot see, or
when you want to start a genuinely different taste from the same pool. It does
**not** clear **my patches** — your saved patches survive a taste reset, because
they are storage and not evidence.

To clear everything, clear the site's data in your browser.

## Version changes

Auracle is pre-1.0 and the save format **may change between versions**. There is a
migration path and it is meant to work — sessions written by older builds are
upgraded on load, and observations recorded under an older audition phrase keep
their structural coordinates while their old-stimulus audio coordinates are
honestly marked as "no evidence" rather than silently mixed into a scale they were
never comparable with.

That said: migrations are code, and code has bugs.

```admonish tip title="Before updating, export"
**Save taste profile** and export any patch you would be annoyed to lose. It takes
ten seconds and it is the only backup that exists — nothing here is stored anywhere
but your browser.
```
