# A rehearsal shot errors or runs late

## Read the sidecar first

`www/video/out/<film>/dry/<shot>.json` holds `errors`, the `late` table (each
action's scheduled and actual time), logged values and marks' rectangles.
Screenshots are beside it.

## Common causes

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| "nothing visible matches <selector>" | The app redrew the element, or the view is not the one expected | Wait for a state first; if the element vanishes under a redraw, that is an app bug |
| An action 10+ s late, reported on time | A hold keyed to a stamp waited before pressing (fixed in `footage.mjs`: holds press at `at`) | Update `footage.mjs`; use `until`/`"end"` normally |
| Every action a little late | Another browser job was running | Use `one_browser.sh`; record on a quiet machine |
| Numbers or names differ between runs | The session is not reproducible: first duel dealt during the fill | Press skip once after the fill in the set-up |
| A claim on screen is false | The app does not do what the narration says | Fix the app (ADR-004), or change the line if the app is right |
| The engine takes seconds to settle | Work queued behind a long job | Check the worker's lanes; add a cut (`clips`) only for genuine waits |

## Then

Re-rehearse only the failing shots (`rehearse.sh <film> --shot a,b`), then
the whole film once before recording.
