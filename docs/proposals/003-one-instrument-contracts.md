---
title: "One instrument: shared words, colours, states, undo, messages and keys"
number: 3
status: accepted
author: Claude Code
created: 2026-09-28
updated: 2026-09-28
supersedes: null
superseded_by: null
---

# RFC-003: One instrument: shared words, colours, states, undo, messages and keys

## Audience

Anyone changing what a player reads, sees or presses in `apps/web`, and
anyone writing the guide. This is Wave 2 of the interaction review
([`../notes/interaction-2026-09/`](../notes/interaction-2026-09/README.md));
the decision to accept, and the open choices below, are the maintainer's.

## Context

The review found 119 findings; a quarter of them come from one cause: one idea
wears many names, colours and keys, differently in each view.

- The act that teaches the model is a *pick*, *vote*, *choice*, *preference*
  and *keep*. PICKS counts stars and cuts; EVOLVE's meter does not (CO1).
- Amber, "the model's colour" (`style.css`), also means on, active tab,
  renamed, alarm, locked, destructive and "went up" (CO3, PA-08, TA6).
- Undo had four labels and three windows. Wave 0 made ⌘Z safe (it never
  changes an unseen patch) but stars, PERFORM's pass and saves still differ
  (CO2).
- Fourteen channels carry messages, with no rule for which says what; long
  work shows progress only on its own button (CO9, SH3, RT9).
- ▶ has seven forms and two of them do something else (CO4); keys conflict
  and PERFORM's pads have none (CO11, PF-09).
- The bank re-sorts under the pointer and a row click leaves the view (SH1,
  SH6, EV-06).

## Proposal

Six contracts, each written into the code and the guide once, with a check
that keeps it.

### 1. Words

| Say | Means | Retire |
| --- | --- | --- |
| **pick** | Any choice between two sounds: an EVOLVE pair, the PATCH strip, the warm start, a PERFORM Take or Next, the keep-as-new comparison | vote, choose, preference, "keep the one" |
| **TAUGHT n** | The menu-bar counter: everything learned from; tooltip splits it ("52 picks · 4 stars · 2 cuts"). EVOLVE's meter counts picks | PICKS for a count that includes stars |
| **fair-test picks** | Pairs dealt at random, the ones TRUST grades | check duels, check picks |
| **save / saved** | In MY PATCHES, safe from replacement | "saved" for a download |
| **download / open** | Files | save/export/load for files |
| **keep** | PERFORM's Keep pad only | every other "keep" |
| **keep as new** | PATCH: the edit becomes a new saved patch named after its parent | commit |
| **pool** / **bank** | The patches the model weighs / the rail with its three tabs | "evolution" for the tab, "IN BANK" |
| **replaced** | What happens to the pool's lowest unsaved patches; always named | retired, evicted, made room |
| **the patch you're playing** | In help and tooltips; toasts use its name | bench, workbench, #ids |
| **another pair** | Deal a new pair without picking; *skip* stays for onboarding | skip ↻ in a duel |
| **listening…** | PERFORM learning a patch (done in Wave 0) | measuring… |
| **ideas** | Wander's middle zone | "offer" as a zone name |
| **style** | A cluster of taste, named from settled pulls or "like Warm Wash" | lens, "1st style" |
| **set aside** | Modules unplugged or deleted, waiting to go back | HELD |
| **59%** | A prediction, everywhere | "MODEL'S GUESS 0.59" |

Kept by `www/checknames.py` gaining a banned-words list for UI copy and the
guide.

### 2. Colour

- **Green is sound** and the patch you are playing: traces, pressed keys, the
  live row, a playing ▶, dock toggles that change the sound (a lit LED), and
  the focus ring, drawn outside the element.
- **Amber is the model**: predictions, belief, forecasts, styles, the picked
  state, search controls, and each view's one breed act (⚡, EVOLVE POOL).
- **Red is danger and failure**: destructive on approach, alarms, recording,
  below-par.
- **Silk is you and neutral**: saved, your names, your locks, the cursor,
  every active tab.
- Up, down, hit and miss are words or glyphs, never colour alone.

Written as the header of `style.css`, with a comment on every exception
removed.

### 3. States

- **Work:** acknowledged on the thing touched within 100 ms; progress where
  the player looks after 1 s; the job slot after 3 s; "done" said when true;
  a failure says what to do. A gesture waiting behind engine work says what it
  waits for.
- **Claims:** settled (solid), a guess (hollow, "?", "a hunch"), no idea yet
  (counts down). Your own verdicts sit beside its guesses.

### 4. Undo

One ⌘Z for teaching acts: pick, take, pass, star, cut, save, newest first,
each 7 s from when its receipt shows; edit undo belongs to PATCH. One label,
UNDO; structural edits keep their specific verbs. (Wave 0 did picks and cuts;
this adds stars, PERFORM's Take and pass, and saves.)

### 5. Messages

| Channel | Carries |
| --- | --- |
| The thing touched | Acknowledgement: pending, the verb, a count |
| Toast | The result of the player's own gesture, with UNDO if it taught; refusals |
| Status line | What this view is doing now, one per view |
| Job slot (menu bar) | Long work, with time left and stop (built with RFC-001's web half) |
| Alarm | A condition that persists until handled, in red |
| Onboarding | One surface per view at a time |

### 6. Keys and stability

- **One keymap**, printed on the controls it presses. Note letters, z/x and m
  stay global; **N** means "next" everywhere (Offer/Next, another pair, next
  maybe); ⌥1–4 switch views; PERFORM's pads get Space (hold: Peek), Enter
  (Take), ⇧Enter (Keep), B (Back), ⇧Space (Freeze); EVOLVE gets ↑ (flip at the
  playhead) and ↓ (another pair). MIDI learn gains the pads and EVOLVE's
  picks.
- **Nothing moves under the hands**: a bank row click plays the patch in the
  view you are in ("↗ patch" opens PATCH); the bank's order freezes while the
  pointer is in it and animates when it leaves; the live row stays in view.

## Alternatives considered

- **Per-view fixes as they come up.** That is how the drift happened: each
  view chose its own words and colours, reasonably, in isolation.
- **ANSWERS instead of TAUGHT** for the counter (the EVOLVE review's choice).
  TAUGHT says whom the count is about.

## Consequences

- Every film and screenshot changes; the films get re-recorded once after
  this wave.
- Guide pages that quote the old words change with it (the truth-pass skill).
- New specs: the banned-words check, one per keymap row, bank stability.

## Decisions (maintainer, 2026-09-28)

1. The counter is **TAUGHT**, with the breakdown in its tooltip.
2. The keymap is approved as proposed, ⌥1–4 included.
3. Dock toggles that change the sound light a **green** LED with a silk
   label when on.
4. A bank row click puts the patch under your hands in the view you are in;
   "↗ patch" on the hovered row, or a double-click, opens it in PATCH.

Accepted as [ADR-009](../decisions/009-one-instrument-contracts.md). Built as
Wave 2, in its own change after Wave 1, with its own film pass.
