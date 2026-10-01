# Troubleshooting

## No sound

**Check in this order.**

1. **The pool is still filling.** Boot runs about forty audio renders. The
   first duel is dealt at 8 patches; the rest arrive behind you.
2. **No sound is open.** The subject block will say *no sound open*. Click
   a row in the bank.
3. **The browser has not granted audio.** Browsers require a user gesture
   before an audio context can start. Click anywhere or press a key.
4. **The patch is muted as unvetted.** A pinned strip says so and stays until
   resolved. A render that came back non-finite, silent or DC-dominated is
   never played. Load a different patch.
5. **Voices are stuck.** Press **◼** in the dock.
6. **The output level is down.** The **vol** slider at the far right of the dock.
7. **The tab is muted**, or the OS is sending audio somewhere else. Check both.

## It asks for a desktop

A touch screen whose window is under 620px on its **shorter** side does not
boot the engine. That is deliberate; see
[browser support](./getting-started/running-locally.md#handheld-devices). The
*look around anyway* link sets a session flag and reloads past the gate, but
there is no handheld layout behind it.

Rotating to landscape does not help: turning the device swaps the window's
width and height, and the shorter side stays the same. A tablet whose shorter
side is 620px or more boots in either orientation.

## Boot is very slow, or stalls

- **First load compiles WebAssembly.** Once. Subsequent loads are much faster.
- **Restoring a large session** re-renders your saved bank. This runs across
  workers and the bar moves; a big session can take tens of seconds.
- **Safari caps the render workers** and boots more slowly than Chromium. Expected.
- **A worker that fails** falls back to the serial path over the *same* draws,
  so it costs time and not content.
- **A render that times out twice is retired.** That draw is skipped, which
  is the one way a boot can end with different patches from a clean run. It
  is noted in `window.__aurLog` (*[auracle] draw 12 retired after 2
  attempts*), not in the console, because it is a sign of a busy machine
  rather than a fault.

To force the single-threaded path, add `?farm=0` to the URL.

## A rebuild changed nothing

You are almost certainly serving with a cache. Use `make serve` (which sends
`Cache-Control: no-store`) rather than `python3 -m http.server`. A browser's
heuristic cache will keep serving a stale `worker.js` or `.wasm`, and late
`no-store` headers do not dislodge an already-cached module worker.

Worse than "nothing changed": you can end up with an engine and a UI from two
different commits.

## Audio dropouts and clicks

The instrument runs on a real-time audio thread.

- **Another tab doing heavy work** can starve it. Close it.
- **A refit is running.** A few seconds of inference. It runs off the audio
  thread and should not cause dropouts; if it does, that is worth reporting.
- **Clicks on patch change** should not happen. If you hear one, that is a bug.
- **Unison ×4 with the arpeggiator at a fast division** is the heaviest
  configuration available, and the first place to look.

## A MIDI controller does not play

The dock's right side reads `midi ●` when a device is connected. `midi ?`
means the page cannot reach MIDI at all; click it, and the panel says why:

- **Safari** has no Web MIDI. Use a Chromium browser or Firefox.
- **Firefox** asks whether to add a site permission for MIDI. Answer the
  prompt; if it never appeared, press **connect midi** in the panel.
- **Access was refused** earlier. Allow MIDI for the site in the browser's
  site settings (the icon left of the address), then press **connect midi**.

`midi ○` means another Auracle tab is playing MIDI. Close it, or click
anywhere in this one to play MIDI here. (The browser sends your controller to
every tab that asks, so before this a second, older tab played every note too:
a preset or a control changed in one tab seemed not to apply.)

`midi ·` means MIDI works and the browser sees no device: replug it, and it
appears without a reload. On Windows, a device another program has open cannot
be opened by the browser too; close that program and replug.

## Evolution does nothing

While a generation breeds, **EVOLVE POOL** is its own progress bar
(*breeding 3/10*), and when it ends a toast says what happened. Before the
model has anything to aim at, that toast is *Nothing to breed toward yet.
Make a few picks first, then evolve.* Answer some duels first.

**A generation can put no new sound in the pool**, and its toast says why, from
each walk's reason: *Generation 4: every walk came back unchanged.*, *Generation
4: 3 were bred, but none rated above the sounds they would replace.* (a child
joins only if the model rates it above the lowest unsaved sound), or a count of
each when the walks differ. That is normal occasionally, and persistent when:

- The patch is at its **budget ceilings** (`24/24 modules`), leaving no room to
  grow. Check the budget line in PATCH.
- **Everything is locked.** Locks are exact, and locking every address leaves
  the search nothing to do.
- **The pool is pinned solid.** Pins are capped at a quarter of the pool, but
  it is worth checking if you have been saving a lot.

When every patch the model chose to breed from is out of evolution's reach, the
message is different: *Generation 4: nothing could be bred. Every seed it
picked has a knob on its stop, or is deeper than the model scores: nudge those
knobs off their stops.* More picks
will not fix that one; moving those knobs will.

## An edit did not take

- **Nothing to keep as new.** The **keep as new** button is disabled until you
  have changed something.
- **The edit was refused** as out of domain. A value outside a knob's range is
  refused rather than recorded.
- **The bench shows the previous patch.** Reload, and report it.

## The model is not learning

First, check [TRUST](./views/taste.md#trust--is-its-confidence-honest) rather
than your impression. Then:

- **Fewer than ~20 picks.** It is genuinely too early.
- **Your preference may not be in the feature space.** The clearest case is
  stereo width, which has no coordinate at all. Read the **heard** line on
  the modules involved; it will tell you outright. See [what it cannot
  learn](./teaching.md#what-it-cannot-learn).
- **You have been saving instead of starring.** Saving teaches nothing.
- **Check-duel skill is the honest number.** Check duels are the pairs dealt
  at random, which by default is every duel EVOLVE and PATCH deal. Overall
  skill also counts comparisons you chose (edits, PERFORM offers).

If it has learned something wrong, **⋯** → *Reset your taste…* downloads a
copy of your taste, clears the log and the model, and leaves your saved
sounds alone.

## Everything is broken / the engine crashed

A crashed engine shows a **pinned alert strip** rather than a toast, and it
stays until resolved. Reload the page; your session is autosaved and will
restore.

If it crashes again on the same session, that is worth
[an issue](https://github.com/alexnodeland/auracle/issues). Include the console
output.

## I lost work

Your session is in your browser's IndexedDB and autosaves continuously. It is
gone if:

- Site data was cleared, by you or by a browser cleanup.
- It was a private / incognito window.
- You are on a different browser, machine, or origin. The hosted build and a
  local copy do not share storage.

There is no server-side copy; there is nothing to recover from. The only backup
is the one you exported. See [Your
data](./your-data.md#exporting-and-importing).

## Reporting something

[github.com/alexnodeland/auracle/issues](https://github.com/alexnodeland/auracle/issues).

Useful to include: browser and version, what you did, the console output, and
the patch exported if it is about a specific one. Debug hooks live at
`window.__aur` and `window.__aurLog`.
