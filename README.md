# ricercar

**A synthesizer that searches for your sound.**

*Ricercar* — the searching, pre-fugue form of Bach's Musical Offering;
Italian for "to seek". The name evokes the project's two foundations:
[fugue-evo](https://github.com/alexnodeland/fugue-evo) (evolution as
Bayesian inference) and [quiver](https://github.com/alexnodeland/quiver)
(patch-graph DSP). Formerly known as EvoSynth.

Ricercar generates synthesizer patches by evolutionary search, collects your
feedback on what it plays, and fits a persistent probabilistic model of your
taste. Over time it stops asking and starts knowing — generating patches in
your style, and able to say why.

- Patches are **terms in a typed combinator grammar** over
  [quiver](https://github.com/alexnodeland/quiver) modules — every random
  sample is a valid, playable patch.
- Evolution is **Bayesian inference** via
  [fugue-evo](https://github.com/alexnodeland/fugue-evo): tempered SMC over
  `π(patch) ∝ p_grammar(patch) · exp(β · taste(patch))`.
- Your taste is a **latent utility with its own posterior**, learned from A/B
  duels, star ratings, and keep/kill triage — one model, three signals.

See [DESIGN.md](./DESIGN.md) for the full design, decisions log, and roadmap.

## Workspace

| Crate | Role |
|---|---|
| `ricercar-grammar` | Typed PCFG over quiver combinator terms; term → Patch compiler |
| `ricercar-features` | Standard-phrase rendering, LUFS normalization, feature extraction |
| `ricercar-taste` | The user model: utility, likelihoods, posterior, profiles |
| `ricercar-session` | Two-loop engine + acquisition |
| `ricercar-wasm` | WASM bindings for the web app |
| `apps/web` | First frontend (duel / grid / radio modes) |

## Status

**M0 — scaffold.** Nothing plays sound yet.

## Development

```bash
cargo check --workspace
cargo test --workspace
```

Requires sibling checkouts of `quiver` (`../quiver`) and the fugue ecosystem
(`../fugue-ecosystem/{fugue,fugue-evo}`) during development.

## License

MIT
