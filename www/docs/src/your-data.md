# Your data

<p class="lede">Your sounds and your taste stay in your browser, and they are
yours. This page says where they live, how to download them, and how to start
over.</p>

## Where it lives

Everything is in your browser’s storage (IndexedDB), under the address you
opened the app from. There is no account, no server, and nothing to sign in
to. The engine is WebAssembly running in your tab: no sound, patch, or pick is
sent anywhere.

So:

- A different browser, or a different machine, is a different session.
- The hosted app and a copy you serve yourself are different addresses, so
  they don’t share a session.
- Clearing the site’s data clears your session. So does a browser cleanup that
  includes site storage.
- A private window gets a session that ends with the window.

## What is kept

It is kept as you play:

| | |
|---|---|
| The pool | Every sound in it, with its measurements and where it came from |
| **SAVED** | Everything you saved |
| Names | The names you gave sounds and styles |
| The log | Every pick, star, cut, and kept edit |
| Your taste | What the model learned, with its standardizer |
| Layout and settings | Rack positions, the keybed’s size and width, the scope, and the module rail |
| **SET ASIDE** | What you unplugged, across reloads |
| The clip | The seconds of your input AUDIO IN captured for the model, with the session |
| Your inputs | Which microphone or interface each AUDIO IN input number means: the browser’s id for it and its name |

AUDIO IN’s input is played and measured in the tab, and only the clip is kept.
Monitoring is never kept: it starts off every time.

A large session comes back without a long stall: restoring it runs across the
background workers.

## Download and open

Everything here is in the **⋯** menu.

### Your taste

1. Choose **Download your taste**.
2. Keep the file somewhere safe.

The file holds the log of everything you taught it, and the standardizer it
was recorded under: both, always, together. What the model learned only means
something relative to the scaling that produced it, so a log without its
standardizer has lost its units. The log is the source; the model can be
fitted again from it.

The toast counts what the file holds: *Downloaded your taste
(auracle-profile.json): 52 picks, 4 stars, and 2 cuts.*

To bring it back, or to move a taught model to another machine:

1. Choose **Open a taste file…**, and pick the file.
2. If you have taught it anything yourself, it asks first: *Replace your taste
   with auracle-profile.json? Your 52 picks, 4 stars, and 2 cuts are replaced
   by the file’s. Your taste now downloads first, so nothing is lost.* Press
   **REPLACE IT**.

Once it’s open, the model fits from the file: *Opened that taste file: 52
picks, 4 stars, and 2 cuts. Redrawing your taste map…*

### A patch

**Download this patch** writes the sound you’re playing as a patch file.
**Open a patch file…** opens one, and accepts `.json`, `.png`, and `.svg`.
You can also drop a file on the window.

### A patch as a picture

**Download as a picture…** draws the rack as a PNG or SVG, at a size and
background you choose. **The picture carries the patch:** open an Auracle PNG
and you get the same patch back, so a picture of a rack posted in a chat is a
patch someone else can play.

```admonish warning title="Opened files are content, not code"
A patch file names things: its own name, and its modules’ labels. Those names
are escaped everywhere they’re shown, including when they come from an opened
file, so opening a patch someone sent you can’t run anything in your session.
```

### Recordings

**● REC** on the keybed records your playing to a WAV: an ordinary audio file,
with nothing Auracle’s in it.

## Start over

1. Choose **Reset your taste…** from the **⋯** menu.
2. Read the question, which has your counts: *Reset your taste? Your 52 picks,
   4 stars, 2 cuts, and 4 generations are forgotten, with every sound you
   haven’t saved. Your 3 saved sounds stay. A copy of your taste downloads
   first.*
3. Press **DOWNLOAD & RESET** to download `auracle-profile-before-reset.json`
   and reset, or **KEEP IT** to leave everything as it was.

A reset is the right move when you have been teaching it something it can’t
hear, or want to start a different taste from your saved sounds. It doesn’t
clear **SAVED**: saved sounds are storage, not evidence, and they stay, with
their layouts. So do the modules you set aside and the keybed’s settings.
Everything else in the pool is replaced by a fresh one, and the warm start
runs again.

To clear everything, clear the site’s data in your browser.

## When the app updates

Auracle is pre-1.0, and the format it saves in may change between versions.
Sessions saved by older builds are upgraded when they load. Picks recorded
under an older audition phrase keep what they say about how the patch is
built. Their old sound measurements are marked as no evidence, rather than
mixed with ones they were never comparable with.

Upgrades are code, and code has bugs.

```admonish tip title="Before updating, download"
Choose **Download your taste**, and download any patch you’d hate to lose. It
takes ten seconds, and it’s the only backup there is.
```
