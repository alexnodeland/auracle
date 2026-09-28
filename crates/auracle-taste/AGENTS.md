# auracle-taste: the model of what you like

A latent utility over φ, fitted from picks, stars and edits. Rules shared by
all crates are in [`../AGENTS.md`](../AGENTS.md).

## Where things are

| File | Holds |
| --- | --- |
| `model.rs` | The taste model (a fugue program), its MCMC posterior `TastePosterior`, lens alignment (`aligned_to`) |
| `observe.rs` | Observations (duels, stars, keeps, edits) and the persisted log |
| `standardize.rs` | Feature standardization, refitted at fit time from raw φ |
| `synthetic.rs` | The synthetic user the gate tests teach |

## Rules

- **Utility is a max over lenses (styles).** `u(x) = max_k θ_k · φ(x)`. A
  sound only has to please one style.
- **Lenses are label-switching symmetric.** Every per-style summary needs an
  aligned posterior, and a refit is aligned to the *previous* fit's lenses
  (`aligned_to`), so a style keeps its index and the name the player gave it.
- **Summaries are importance-weighted.** Between fits, votes reweight the
  draws. Every mean or std must use `weight(i)`; an unweighted one describes a
  posterior nobody holds.
- **The closed-loop gate scores the best lens**, not lens 0. With K lenses and
  a unimodal synthetic user, lens 0 is not the one that learned.
- **The MCMC budget is measured.** `make fit-bench` draws the
  recovery-vs-budget curve that set `SessionConfig::mcmc_samples`. Change the
  budget only with that curve.

## Tests

`cargo test -p auracle-taste --profile test-fast`; `make closed-loop` for the
noisy end-to-end gate over seeds.
