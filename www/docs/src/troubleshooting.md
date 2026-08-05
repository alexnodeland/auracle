# Troubleshooting

## No sound

**Check in this order.**

1. **The pool is still filling.** The boot bar is real work — about forty audio
   renders. The first duel is dealt at 8 patches; the rest arrive behind you.
2. **No patch is loaded.** The subject block will say *no patch loaded*. Click a
   row in the bank.
3. **The browser has not granted audio.** Browsers require a user gesture before
   an audio context can start. Click anywhere or press a key.
4. **The patch is muted as unvetted.** A pinned strip says so and stays until
   resolved. This is the safety gate doing its job — a render that came back
   non-finite, silent or DC-dominated is never played. Load a different patch.
5. **Voices are stuck.** Press **◼** in the dock.
6. **The output level is down.** The **vol** slider at the far right of the dock.
7. **The tab is muted**, or the OS is sending audio somewhere else. Check both.

## It asks for a desktop

A coarse pointer with a viewport narrower than 620px does not boot the engine.
That is deliberate — see
[browser support](./getting-started/running-locally.md#handheld-devices). The
*look around anyway* link sets a session flag and reloads past the gate, but there
is no handheld layout behind it.

On a tablet, rotating to landscape is usually enough.

## Boot is very slow, or stalls

- **First load compiles WebAssembly.** Once. Subsequent loads are much faster.
- **Restoring a large session** re-renders your saved bank. This is farmed across
  workers and the bar moves; a big session is genuinely tens of seconds.
- **Safari caps the render workers** and boots more slowly than Chromium. Expected.
- **A worker that fails** falls back to the serial path over the *same* draws, so
  it costs time and never content. A job retired after two attempts logs a console
  warning — that is the one degradation that is meant to be loud.

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
- **A refit is running** — a few seconds of inference. It is deliberately off the
  audio thread and should not cause dropouts; if it does, that is worth
  reporting.
- **Clicks on patch change** should not happen: patch swaps are click-free and keep
  held chords alive. If you hear one, that is a bug.
- **Unison ×4 with the arpeggiator at a fast division** is the heaviest
  configuration available. It is meant to work; it is also the first place to look.

## Evolution does nothing

**EVOLVE POOL does nothing at all** when there is no fitted posterior — there is no
direction to climb in yet. Answer some duels first.

**A generation produces no new patch** when the walk was rejected, or landed on a
patch the pool already holds. This is reported as "no proposal beat its parent". It
is normal occasionally, and persistent when:

- The patch is at its **budget ceilings** (`24/24 modules`) — there is no room to
  grow. Check the budget line in PLAY.
- **Everything is locked.** Locks are exact, and locking every address leaves the
  search nothing to do.
- **The pool is pinned solid** — capped at a quarter of the pool for exactly this
  reason, but worth checking if you have been saving a lot.

## An edit did not take

- **Nothing to commit** — the commit button is disabled until you have changed
  something.
- **The edit was refused** as out of domain. Every knob is normalized 0–1 under the
  hood, and a value outside its range is refused rather than recorded, because its
  measurements would be meaningless.
- **The bench shows the previous patch.** This used to be able to happen silently;
  it now reports. If you see it, reload — and it is worth reporting.

## The model is not learning

First, check [TRUST](./views/taste.md#trust--is-its-confidence-honest) rather than
your impression. Then:

- **Fewer than ~20 picks.** It is genuinely too early.
- **Your preference may not be in the feature space.** The clearest case is stereo
  width, which has no coordinate at all. Read the **heard as** line on the modules
  involved — it will tell you outright. See
  [what it cannot learn](./teaching.md#what-it-cannot-learn).
- **You have been saving instead of starring.** Saving teaches nothing by design.
- **Check-duel skill is the honest number.** Overall skill is measured on questions
  the model helped choose.

If it has genuinely learned something wrong, **⋯** → *Reset taste profile…* clears
the log and the model, and leaves your saved patches alone.

## Everything is broken / the engine crashed

A crashed engine shows a **pinned alert strip** rather than a toast, and it stays
until resolved. Reload the page — your session is autosaved and will restore.

If it crashes again on the same session, that is worth
[an issue](https://github.com/alexnodeland/auracle/issues). Include the console
output; the app logs its own failures deliberately.

## I lost work

Your session is in your browser's IndexedDB and autosaves continuously. It is gone
if:

- Site data was cleared, by you or by a browser cleanup.
- It was a private / incognito window.
- You are on a different browser, machine, or origin — the hosted build and a local
  copy do not share storage.

There is no server-side copy; there is nothing to recover from. The only backup is
the one you exported. See [Your data](./your-data.md#exporting-and-importing).

## Reporting something

[github.com/alexnodeland/auracle/issues](https://github.com/alexnodeland/auracle/issues).

Useful to include: browser and version, what you did, the console output, and —
if it is about a specific patch — that patch exported. Debug hooks live at
`window.__aur` and `window.__aurLog`.
