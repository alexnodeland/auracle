# How to read this

<p class="lede">What Auracle computes, in enough detail to disagree with.</p>

This book is the technical companion to the [User Guide](../docs/). The guide
tells you what the instrument does; this tells you how, with the math written
out and pointers into the code that implements it.

It is organised as a pipeline, because that is what it is:

$$
\text{term} \;\xrightarrow{\text{compile}}\; \text{patch}
\;\xrightarrow{\text{render}}\; \text{audio} \;\xrightarrow{\text{vet}}\;
\text{audio} \;\xrightarrow{\varphi}\; \R^{40} \;\xrightarrow{\;u_\theta\;}\;
\R
$$

and a loop that closes over it: your answers condition $\theta$, and $\theta$
reshapes how the next term is proposed.

## Three commitments

**Every number is sourced.** Thresholds, dimensions, defaults and step counts
are quoted from the code, with the constant named so you can check. Where a
figure came out of a measurement, the measurement is named too.

**Design and implementation are distinguished.** Several things in Auracle are
*intended* as one algorithm and currently *implemented* as a simpler one. The
clearest case is refinement: the design is tempered sequential Monte Carlo, and
what ships is a short local Metropolis–Hastings walk. Those pages say so in
their first paragraph. See [Refinement](./search/refinement.md).

**Known weaknesses are stated.** Where a coefficient is unidentified, a
variance inflation factor is uncomfortably high, or a memory spike is unfixable
without forking a dependency, it is written down.

## If you read four pages

1. **[A typed PCFG over patch terms](./genome/grammar.md)** is the
   representation decision everything else follows from. Because the genome is
   a *typed term* rather than a parameter vector or a raw graph, all three
   levels of evolution (settings, connectivity, module set) live in one object,
   and every sample is valid by construction.
2. **[Trace addresses](./architecture/addresses.md)** are the naming scheme
   shared by panel knobs, hand edits, locks, live parameter handles and search
   proposals. Nothing else stays coherent without it.
3. **[Utility as a max of experts](./taste/utility.md)** explains why taste is
   a *maximum* over lenses rather than a mixture, and what that buys.
4. **[The vetting gate](./audition/vetting.md)** explains why randomly composed
   DSP graphs are safe to put in front of a person.

## Conventions

- **Code references** name the crate and the item:
  `auracle_features::vet::VetConfig`. The [API documentation](./api.md) has the
  generated rustdoc for all of them.
- **Math** follows [Notation](./notation.md). $x$ is a patch term, $\varphi(x)$
  its feature vector, $\theta$ the taste parameters, $u$ the latent utility.
- **Measured claims** cite the harness that produced them, usually an example
  binary such as `auracle-session/examples/search_health.rs`, runnable from a
  checkout.

## What lives elsewhere

- The generated API documentation is the [rustdoc](./api.md).
- Using the instrument is the [User Guide](../docs/).
- Working *on* Auracle — layout, the quality bar, the sharp edges, cutting a
  release — is
  [`CONTRIBUTING.md`](https://github.com/alexnodeland/auracle/blob/main/CONTRIBUTING.md).
- What changed when is
  [`CHANGELOG.md`](https://github.com/alexnodeland/auracle/blob/main/CHANGELOG.md).

Design decisions, rejected alternatives, the milestones and the open questions
are **in this book**, under [Design](./design/decisions.md). They used to be a
`DESIGN.md` at the repo root, which made the reasoning and the maths it
justifies two documents that could disagree.

## The two libraries underneath

Auracle is thin on top of two in-house libraries:

- **[fugue-evo](https://github.com/alexnodeland/fugue-evo)** does evolution as
  Bayesian inference. Priors as probabilistic programs, typed
  Metropolis–Hastings with automatic reversible jump, grammar-based genetic
  programming, tempered SMC in trace space. Auracle's grammar is a
  `GenomePrior`; its search is fugue-evo's inference machinery with a learned
  fitness plugged in.
- **[quiver](https://github.com/alexnodeland/quiver)** does modular synthesis.
  Arrow-style combinators, typed ports (Audio / V-Oct / Gate / CV), patch
  graphs, headless rendering, first-class WebAssembly. Auracle's genome is a
  term in quiver's combinator algebra; its "compiler" targets a quiver patch
  graph.

Where a guarantee comes from one of them, this book says so.
