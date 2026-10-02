# Troubleshooting

<p class="lede">What to check when Auracle makes no sound, boots slowly, won’t
breed, or seems not to learn, in the order the causes are most likely.</p>

## No sound

Check in this order:

1. **The pool is still filling.** Boot renders 40 sounds, and the first pair
   is dealt at eight; the rest arrive while you play.
2. **No sound is open.** PATCH says *no sound open*. Click a row in the bank.
3. **The browser hasn’t allowed audio yet.** Browsers need a gesture before
   they start audio. Click anywhere, or press a key.
4. **The sound is muted because it failed its check.** A pinned strip says so,
   and stays until it’s resolved. A render that came back broken, silent, or
   mostly DC offset is never played. Open another sound.
5. **Voices are stuck.** Press **◼** on the keybed.
6. **The level is down.** Check **VOL** at the far right of the keybed.
7. **The tab is muted**, or your computer is sending sound somewhere else.
   Check both.

## It asks for a desktop

A touch screen whose window is under 620 px on its shorter side doesn’t start
the engine. That is deliberate; see [handheld
devices](./getting-started/running-locally.md#handheld-devices). *look around
anyway →* reloads past the screen for this tab, but there is no phone
layout behind it.

Turning the device sideways doesn’t help: the shorter side stays the same. A
tablet whose shorter side is 620 px or more starts in either orientation.

## Boot is slow, or stalls

- **The first load compiles the engine.** Once; later loads are much faster.
- **Restoring a large session** renders your saved sounds again. This runs
  across workers and the bar moves, but a big session can take tens of
  seconds.
- **Safari limits the render workers**, and boots more slowly than Chrome.
  That’s expected.
- **A worker that fails** hands its work to the engine, over the same draws,
  so it costs time and not sounds.
- **A render that times out twice is dropped.** That draw is skipped, which
  is the one way a boot can end with different sounds from a clean run. It is
  noted in `window.__aurLog` (`[auracle] draw 12 retired after 2 attempts`),
  not the console, because it is a sign of a busy machine rather than a fault.

Add `?farm=0` to the address to boot without the render workers.

## A rebuild changed nothing

You are almost certainly serving with a cache. Use `make serve`, which tells
the browser not to cache, rather than `python3 -m http.server`. A browser’s
cache will keep serving an old `worker.js` or `.wasm`, and changing the
headers later doesn’t dislodge a module worker it has already cached.

Worse than “nothing changed”: you can end up with an engine and a page from two
different builds.

## Dropouts and clicks

The instrument runs on a real-time audio thread.

- **Another tab doing heavy work** can starve it. Close that tab.
- **A refit is running.** A few seconds of work, off the audio thread; it
  shouldn’t cause dropouts, and if it does, that’s worth reporting.
- **A click when a sound changes** shouldn’t happen. If you hear one, it’s a
  bug.
- **UNI with the arpeggiator at a fast rate** is the heaviest setting there
  is, and the first place to look.

## A MIDI controller doesn’t play

The right of the keybed reads *midi ●* when a device is connected. *midi ?*
means the page can’t reach MIDI at all; click it, and the panel says why:

- **Safari** has no Web MIDI. Use Chrome, Edge, or Firefox.
- **Firefox** asks whether to add a site permission for MIDI. Answer it; if it
  never appeared, press **CONNECT MIDI** in the panel.
- **You refused access** earlier. Allow MIDI for the site in the browser’s site
  settings (the icon left of the address), then press **CONNECT MIDI**.

*midi ○* means another Auracle tab is playing MIDI. Close it, or click
anywhere in this one to play MIDI here.

*midi ·* means MIDI works and the browser sees no device: plug it in again,
and it appears without a reload. On Windows, a device another program has open
can’t be opened by the browser too; close that program and plug it in again.

## Evolution does nothing

While a generation breeds, **EVOLVE POOL** is its own progress bar, saying
what each walk came back as (**WALK 3 OF 10** *rated below the pool*), and
when it ends, a toast says what happened.

**Before the model has anything to aim at,** the toast says *Nothing to breed
toward yet. Make a few picks first, then evolve.* Make a few picks in EVOLVE,
then press it again.

**A generation can put no new sound in the pool,** and its toast says why,
from each walk’s outcome:

- *Generation 4: every walk came back unchanged.*
- *Generation 4: 3 were bred, but none rated above the sounds they would
  replace.* A child joins only if the model rates it above the lowest unsaved
  sound.
- A count of each, when the walks differ.

That happens now and then. When it keeps happening:

- **The patch is at its ceilings** (*24/24 modules*), with no room to grow.
  Check the budget beside the guess in PATCH.
- **Everything is locked.** Locks are exact, and locking every place in the
  patch leaves breeding nothing to change.
- **The pool is nearly all saved.** Saves are capped at a quarter of the pool,
  but it’s worth checking if you have been saving a lot.

When every sound the model chose to breed from is out of breeding’s reach, the
toast is different:

> *Generation 4: nothing could be bred, because every seed it picked has a
> knob on its stop or is deeper than the model scores. Nudge those knobs off
> their stops.*

More picks won’t fix that one; moving those knobs will.

## An edit didn’t take

- **KEEP AS NEW is disabled** until you have changed something. Its tooltip
  says *Nothing to keep yet: turn a knob first*.
- **The edit was refused,** and the toast says why: *That edit to Glass Pad
  didn’t happen*, then the reason.
- **The rack still shows the sound before.** Reload, and report it.

## The model isn’t learning

First check [its forecasts](./views/learning.md#its-forecasts), rather
than your impression. Then:

- **Fewer than about 20 picks.** It is too early.
- **Your taste may not show in what it measures.** The clearest case is
  stereo width, which it can’t hear at all. Read the **heard** line on the
  modules involved; it will tell you. See [what it cannot
  learn](./teaching.md#what-it-cannot-learn).
- **You have been saving instead of starring.** Saving teaches nothing.
- **Watch the fair-test number.** The line that ends *the number to trust* is
  the skill on the pairs dealt at random, which is every pair EVOLVE and PATCH
  deal. The overall number also counts comparisons you chose (edits, PERFORM
  offers).

If it has learned something you don’t mean, **⋯** › **Reset your taste…**
downloads a copy of your taste, clears what it learned, and leaves your saved
sounds alone.

## The engine stopped

An engine that has stopped shows a pinned alert rather than a toast, and the
alert stays until it’s resolved. Reload the page; your session is kept, and it
comes back.

If it stops again on the same session, that is worth [an
issue](https://github.com/alexnodeland/auracle/issues). Include the console
output.

## I lost work

Your session is in your browser’s storage, and it’s kept as you play. It is
gone if:

- the site’s data was cleared, by you or by a browser cleanup;
- it was a private window;
- you’re on a different browser, machine, or address. The hosted app and a
  copy you serve yourself don’t share storage.

There is no copy on a server, and nothing to recover from. The only backup is
one you downloaded: see [your data](./your-data.md#download-and-open).

## Reporting something

[github.com/alexnodeland/auracle/issues](https://github.com/alexnodeland/auracle/issues).

Include your browser and its version, what you did, the console output, and
the patch file if it’s about one sound. `window.__aur` and `window.__aurLog`
hold what the app logs for debugging.
