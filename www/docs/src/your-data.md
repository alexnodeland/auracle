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
| Your taste | What the model learned (its fitted guesses, at most 500), with its standardizer |
| Layout and settings | Rack positions, the keybed’s size and width, the scope, and which of the catalog's groups are open |
| **SET ASIDE** | What you unplugged, across reloads |
| The clip | The seconds of your input AUDIO IN captured for the model, with the session |
| Takes | Each CAPTURE’s take, with the sound that holds it. A take you record is an edit, kept once you keep the edit as new. A sound kept safe keeps its unreadable take as it was |
| Your inputs | Which microphone or interface each AUDIO IN input number means: the browser’s id for it and its name |
| Taste over time | What the model posted at each of your last 200 moments (picks, stars, cuts, redraws): TASTE’s track and LEARNING’s **REPLAY**. A reset clears it, and a taste file doesn’t carry it |

AUDIO IN’s input is played and measured in the tab, and only the clip is kept.
Monitoring is never kept: it starts off every time.

A session comes back one sound at a time, with the bar counting them. A sound
the render workers measured as the app loaded, or that an earlier return
measured, is read back rather than rendered again, so a return is usually
quick. Your taste comes back as it was, so nothing is fitted while it loads. A
session saved by an earlier version is fitted again once, just after it
loads, while you play. A sound that joined while you played (a generation’s, an edit you
kept, a patch file you opened) is rendered again on the next return; see
[Boot is slow, or stalls](./troubleshooting.md#boot-is-slow-or-stalls).

## Download and open

Everything here is a command in [⌘K](./levels.md#k-find-anything): type a word of it (*download*,
*open*) and press <kbd>↵</kbd>.

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
picks, 4 stars, and 2 cuts. Redrawing your taste map…* Until that fit lands
there is no guess yet, and [TASTE](./views/taste.md) draws every glow as a
dashed ring.

### A patch

**Download this patch** writes the sound you’re playing as a patch file.
**Open a patch file…** opens one, and accepts `.json`, `.png`, and `.svg`.
You can also drop a file on the window. The sound it opens joins the pool the
way a sound you keep as new does, and is just as safe until it has been in a
pick ([the bank](./bank.md#a-sound-you-keep-as-new-is-safe-until-its-been-in-a-pick)).

### A patch as a picture

**Download as a picture…** draws the rack as a PNG or SVG, at a size and
background you choose, or the sound’s card: its [face](./faces.md#share-a-sound-as-a-card),
name and where it came from. **The picture carries the patch:** open an
Auracle PNG and you get the same sound back, so a picture of a rack, or a
card, posted in a chat is a patch someone else can play.

```admonish warning title="Opened files are content, not code"
A patch file names things: its own name, and its modules’ labels. Those names
are escaped everywhere they’re shown, including when they come from an opened
file, so opening a patch someone sent you can’t run anything in your session.
```

### Recordings

**● REC** on the keybed records your playing to a WAV: an ordinary audio file,
with nothing Auracle’s in it.

## Start over

1. Choose *Reset your taste…* in [⌘K](./levels.md#k-find-anything).
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
runs again. An address with `?seed=` in it loses it on the reset, so the
fresh pool is a new one
([Overrides](getting-started/running-locally.md#overrides)).

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
