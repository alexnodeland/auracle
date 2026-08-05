# Milestones and the gates that closed them

<p class="lede">Each milestone had a demo that either worked or did not. None of
them closed on "the code is written".</p>

| # | Deliverable | Demo / gate | Status |
|---|---|---|---|
| M0 | Workspace scaffold, CI | `cargo check` green | ✅ |
| M1 | `auracle-grammar`: PCFG, palette, term→Patch compiler | Play random grammar samples (already fun) | ✅ |
| M2 | `auracle-features`: phrase renderer, LUFS, feature vector | Feature vectors stable & reproducible for fixed seeds | ✅ |
| M3 | `auracle-taste`: mixture-BLR (K=1), 3 likelihoods, **synthetic user** | Posterior recovers ground-truth θ*; regret shrinks | ✅ |
| M4 | `auracle-session`: two-loop engine + acquisition | Headless closed loop vs synthetic user | ✅ |
| M5 | WASM + web app: duel mode + bench | A human can teach it their taste | ✅ |
| M6 | Grid & radio modes; K>1 style discovery; named profiles | Styles discovered & pinnable | ◑ |

**Status (2026-08-05).** M0–M5 complete. Of M6, K>1 style discovery has shipped
([dynamic K, max-of-experts, post-hoc label alignment](../taste/utility.md)),
styles are nameable and persist, and profiles
[export and import](../persistence.md) as a portable observation log plus its
standardizer. **Grid and radio modes remain open**, and with them keep/kill's
only intended UI surface.

The pass-by-pass record is
[`CHANGELOG.md`](https://github.com/alexnodeland/auracle/blob/main/CHANGELOG.md).

## The synthetic user, and why M3 was a gate

Before any UI existed, the taste crate was validated against a simulated user:
ground-truth θ\* (and ground-truth styles for K>1), synthetic
duels/stars/keep-kills with realistic noise, asserting

1. posterior concentration on θ\*, and
2. shrinking regret of the acquisition loop.

That makes the core falsifiable headlessly, and it later doubled as a demo mode
— watch it learn a fake user in fast-forward.

It has since become the harness the engine's own tuning is settled on.
`search_health --budget-ab` chose the [40 × 10 refinement
split](../search/refinement.md), and `learn_synthetic --compare` produced the
[acquisition measurement](../search/acquisition.md). The closed-loop test runs
the *real* grammar → render → vet → feature pipeline, and it is the only test in
the workspace that can fail when the loop is broken while every component is
individually correct.

## Session UX: three modes, one observation stream

All modes are emitters into the same
[observation log](../taste/likelihoods.md). The build order was duels → grid →
radio, sequenced by signal quality rather than by effort.

1. **Duel stream + workbench — shipped.** The core loop is A/B duels in
   **EVOLVE**; candidates land on the **PLAY** workbench where stars,
   free-play, hand edits, locks and export happen. **TASTE** is the model
   reporting on itself: the map, the style lenses, their coefficients with
   credible intervals, and the calibration diagram.
2. **Population grid — open.** See a generation at once, rate/cull/breed; keeps
   evosynth v1's "generations" mental model for users who want to steer. This
   is where keep/kill triage would get its surface.
3. **Radio mode — open.** Lean-back continuous stream with keep/kill/skip; the
   payoff once generation quality is high.

The app grew a long way beyond the original duel-mode scope on the way there:
four-voice AudioWorklet polyphony, MIDI, an arpeggiator, an interactive lockable
rack with typed rewiring and a node bank, three separate banks, session
persistence in IndexedDB, and a 61-patch preset library across seven families.
