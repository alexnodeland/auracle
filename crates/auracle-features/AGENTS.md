# auracle-features: what the model can hear

Every candidate is rendered on one fixed phrase and measured. The measurement,
φ, is all the taste model ever sees. Rules shared by all crates are in
[`../AGENTS.md`](../AGENTS.md).

## Where things are

| File | Holds |
| --- | --- |
| `phrase.rs` | `PhraseSpec`: the standard audition phrase and its seed |
| `render.rs` | Headless render of a compiled voice under the phrase |
| `vet.rs` | The vetting gate: silence, DC, blow-ups and other unplayable renders are refused |
| `loudness.rs` | BS.1770-style loudness, normalization to `TARGET_LUFS` (−18) |
| `pipeline.rs` | compile → render → vet → normalize → φ, and `phi_names()` |
| `audio.rs` | φ_audio: perceptual descriptors of the normalized render |
| `structural.rs` | φ_struct: render-free descriptors of the term |
| `cache.rs` | Content-addressed memo of `featurize`, keyed with `QUIVER_DSP_VERSION` |

## Rules

- **φ is a contract.** The phrase, the feature list, their order, the
  normalization and the vetting thresholds decide what every saved profile and
  every fitted posterior mean. A change to any of them:
  1. runs `make revalidate` before and after, and diffs the tables;
  2. bumps the stimulus tag or migrates (`auracle-session/src/migrate.rs`),
     because old logs hold raw φ from the old definition;
  3. updates the reference pages that quote the feature list.
- **Normalization is for φ; playback has its own level.** What the player
  hears is `auracle-wasm/src/level.rs`. Do not fix a loud patch by touching φ's
  normalization.
- **Bump `QUIVER_DSP_VERSION`** when the quiver dependency changes. Otherwise
  the memo serves renders from the old DSP.
- **Examples are instruments.** `pipeline_stats`, `norm_peak`,
  `preset_audit`, `phi_of_render` and the probes are how φ questions get
  answered. Prefer running one over reasoning about DSP.

## Tests

`cargo test -p auracle-features --profile test-fast`.
