# Troubleshooting

<p class="lede">What to check when Auracle makes no sound, boots slowly, won’t
breed, or seems not to learn, in the order the causes are most likely.</p>

## No sound

Check in this order:

1. **The pool is still filling.** Boot renders 40 sounds, and the first pair
   is dealt at eight; the rest arrive while you play.
2. **No sound is open.** The menu bar says *no sound*, and PATCH *no sound open*. Click a row in the bank.
3. **The browser hasn’t allowed audio yet.** Browsers need a gesture before
   they start audio. Click anywhere, or press a key.
4. **The sound is muted because it failed its check.** A pinned strip says so,
   and stays until it’s resolved. A render that came back broken, silent, or
   mostly DC offset is never played. Open another sound.
5. **Voices are stuck.** Press **◼ SILENCE** in **KEYS ⋯**, at the right of the keys bar.
6. **The level is down.** Check **VOL** at the right of the keys bar.
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
- **Coming back to a session** brings your sounds back one at a time, and the
  bar counts them: *recalling 12 of 40 sounds…*. A sound the render workers
  measured as the app loaded, or that an earlier return measured, is read
  back rather than rendered, so a return is usually quick. The rest is
  rendered again, across the render workers where there are some:
  - the sounds of a first visit that had no render workers;
  - a sound that joined while you played: a generation’s, ⚡’s, an edit you
    kept, a patch file you opened, a preset you picked or opened;
  - every sound, after an update that changes how sounds are measured, or
    once the stored measurements pass their limit and are cleared.

  With the render workers, the first eight sounds are always rendered, with
  their audio, so they play at once. On a slow machine with no workers, a
  return that renders everything can take a minute, with the bar moving all
  the way.
- **Render workers slow to start** hold the boot up for five seconds at
  most: the engine waits that long for the first to be ready, then starts on
  its own, and each worker joins the work once it’s ready.
- **Safari limits the render workers**, and boots more slowly than Chrome.
  That’s expected.
- **A worker that fails** hands its work to the engine, over the same draws,
  so it costs time and not sounds.
- **A render that times out twice is dropped.** That draw is skipped, which
  is the one way a boot can end with different sounds from a clean run. It is
  noted in `window.__aurLog` (`[auracle] draw 12 retired after 2 attempts`),
  not the console, because it is a sign of a busy machine rather than a fault.

Add `?farm=0` to the address to boot without the render workers.

## Showing someone a problem

A bug that needs a particular pool or offer is easier to report when it can be
dealt again. Open the instrument in a fresh profile (or a private window) with
`?seed=` and any whole number in the address, for example `?seed=42`, and
reproduce it there. The same address deals the same pool of sounds for
whoever opens it, though a sound you haven't named can be named
differently; the warm start's cards and which side of the table a sound
stands on still shuffle, and what you do after that is yours to repeat
([Overrides](getting-started/running-locally.md#overrides)).

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
- **A refit is running.** A second or two of work, off the audio thread; it
  shouldn’t cause dropouts, and if it does, that’s worth reporting.
- **A click when a sound changes** shouldn’t happen. If you hear one, it’s a
  bug.
- **UNI with the arpeggiator at a fast rate** is the heaviest setting there
  is, and the first place to look.

## A MIDI controller doesn’t play

The right of the keys bar reads *midi ●* when a device is connected. *midi ?*
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

## AUDIO IN is silent

Its input line says why:

- ***no input yet***: the browser hasn’t been asked. Press **ALLOW INPUT**.
- ***input refused***: you refused it earlier. Allow the microphone for the
  site in the browser’s site settings (the icon left of the address), then
  press **ASK AGAIN**.
- ***no input found*** or ***input didn’t open***: plug in a microphone or an
  interface, close any other app holding it, then press **ASK AGAIN**.
- ***unplugged***: the input went away. Plug it back in; it opens by itself.
- ***nothing plugged in***: no microphone or interface has that number yet.
  Click the input line and pick one.
- The square shows a level but you hear nothing: **MONITOR** is off. It starts
  off every time. Put on headphones, then press it.
- *meter only*: the keys hear the first AUDIO IN’s input. See [your
  inputs](./playing-through.md#your-inputs).

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
  replace.* A child joins only if the model rates it above the lowest-rated
  sound it could replace (not saved, nor kept as new and still waiting for
  its first pick).
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

If it has learned something you don’t mean, *Reset your taste…* in [⌘K](./levels.md#k-find-anything)
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
