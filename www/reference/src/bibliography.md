# Bibliography

The literature Auracle's methods come from, grouped by where they appear. These
are the specific results the implementation relies on, not a survey.

## Preference learning

**Bradley, R. A. and Terry, M. E. (1952).** *Rank Analysis of Incomplete Block
Designs: I. The Method of Paired Comparisons.* Biometrika 39(3–4), 324–345. →
The duel likelihood, $P(A \succ B) = \sigma(u_A - u_B)$.
[Used in](./taste/likelihoods.md#pairwise-duels--bradleyterry)

**Chu, W. and Ghahramani, Z. (2005).** *Preference Learning with Gaussian
Processes.* ICML. → The framing of preference data as observations of a latent
utility. Auracle's utility is linear in a fixed feature map rather than a GP,
which is a deliberate trade of flexibility for interpretability and a tractable
cold start.

**McCullagh, P. (1980).** *Regression Models for Ordinal Data.* JRSS B 42(2),
109–142. → The cumulative-logit model with learned cutpoints, which is how star
ratings are treated as ordinal rather than as numbers.
[Used in](./taste/likelihoods.md#star-ratings--a-cumulative-logit)

**Brochu, E., de Freitas, N. and Ghosh, A. (2007).** *Active Preference
Learning with Discrete Choice Data.* NIPS. → Preferential Bayesian
optimization: the loop of latent utility + expensive human oracle + cheap
surrogate that Auracle's two loops implement.

## Active learning and acquisition

**Houlsby, N., Huszár, F., Ghahramani, Z. and Lengyel, M. (2011).** *Bayesian
Active Learning for Classification and Preference Learning.* arXiv:1112.5745. →
BALD: expected information gain about the parameters. Implemented and
selectable; it
[ties uniform pairing](./search/acquisition.md) on this problem at session horizon.

**Yue, Y., Broder, J., Kleinberg, R. and Joachims, T. (2012).** *The K-armed
Dueling Bandits Problem.* JCSS 78(5), 1538–1556. → The dueling-bandit framing,
and by extension the Thompson rule that measurably loses here because it
optimizes best-arm identification rather than parameter recovery.

## Calibration and scoring

**Brier, G. W. (1950).** *Verification of Forecasts Expressed in Terms of
Probability.* Monthly Weather Review 78(1), 1–3. → The proper scoring rule that
replaced accuracy.
[Why that mattered](./taste/calibration.md#why-not-accuracy)

**Gneiting, T. and Raftery, A. E. (2007).** *Strictly Proper Scoring Rules,
Prediction, and Estimation.* JASA 102(477), 359–378. → What "proper" means, and
why a rule that is not proper can be gamed by a model that hedges.

**Dawid, A. P. (1984).** *Present Position and Potential Developments: Some
Personal Views. Statistical Theory: The Prequential Approach.* JRSS A 147(2),
278–292. → Prequential evaluation: score each forecast before seeing its
outcome. This is exactly what `record_duel` does, and it is what makes the
reliability diagram out-of-sample.

**DeGroot, M. H. and Fienberg, S. E. (1983).** *The Comparison and Evaluation
of Forecasters.* The Statistician 32, 12–22. → Reliability diagrams, and the
calibration/refinement decomposition that explains why the *shape* of the
failure is more informative than the scalar.

## Monte Carlo

**Metropolis, N. et al. (1953).** *Equation of State Calculations by Fast
Computing Machines.* J. Chem. Phys. 21(6), 1087–1092. **Hastings, W. K.
(1970).** *Monte Carlo Sampling Methods Using Markov Chains and Their
Applications.* Biometrika 57(1), 97–109. → The sampler.

**Green, P. J. (1995).** *Reversible Jump Markov Chain Monte Carlo Computation
and Bayesian Model Determination.* Biometrika 82(4), 711–732. →
Trans-dimensional moves: what a structural proposal is, since it changes the
*set* of sites. Handled by fugue rather than by Auracle.

**Del Moral, P., Doucet, A. and Jasra, A. (2006).** *Sequential Monte Carlo
Samplers.* JRSS B 68(3), 411–436. → Tempered SMC: the *designed* generation
mechanism, and
[not what currently ships](./search/refinement.md).

**Kong, A., Liu, J. S. and Wong, W. H. (1994).** *Sequential Imputations and
Bayesian Missing Data Problems.* JASA 89(425), 278–288. → Effective sample size
$1/\sum w_s^2$, the degeneracy diagnostic that
[triggers a refit](./taste/posterior.md#effective-sample-size).

**Douc, R. and Cappé, O. (2005).** *Comparison of Resampling Schemes for
Particle Filtering.* ISPA. → Systematic resampling, chosen over multinomial for
determinism.

**Stephens, M. (2000).** *Dealing with Label Switching in Mixture Models.* JRSS
B 62(4), 795–809. → Why per-component summaries of a mixture posterior need
[post-hoc alignment](./taste/posterior.md#label-alignment).

## Probabilistic programming

**Goodman, N. D. and Stuhlmüller, A. (2014).** *The Design and Implementation
of Probabilistic Programming Languages.* dippl.org. → The model-as-program
framing that fugue implements and that makes the grammar a *prior* rather than
a generator function.

**Ritchie, D., Horsfall, P. and Goodman, N. D. (2016).** *Deep Amortized
Inference for Probabilistic Generative Models.* arXiv:1610.05735. → Context for
what trace-based inference over structured programs makes possible.

## Grammar-based genetic programming

**Whigham, P. A. (1995).** *Grammatically-based Genetic Programming.* Workshop
on Genetic Programming. → Using a grammar to constrain the search space so
every individual is valid: Auracle's representation decision, with types in
place of production rules.

**Koza, J. R. (1992).** *Genetic Programming: On the Programming of Computers
by Means of Natural Selection.* MIT Press. → Tree-based GP, subtree crossover,
and the bloat problem that
[a prior rather than a penalty](./search/target.md#what-each-factor-does) addresses.

**Takagi, H. (2001).** *Interactive Evolutionary Computation: Fusion of the
Capabilities of EC Optimization and Human Evaluation.* Proc. IEEE 89(9),
1275–1296. → The canonical statement of interactive evolution's **user-fatigue
bottleneck**, which is the problem the two-loop architecture and the learned
surrogate exist to solve.

## Audio features and loudness

**ITU-R BS.1770-4 (2015).** *Algorithms to measure audio programme loudness and
true-peak audio level.* → K-weighting, 400 ms gated blocks, the two gates.
[Implemented here](./audition/loudness.md)

**EBU R 128 (2020).** *Loudness normalisation and permitted maximum level of
audio signals.* → The practice around BS.1770 that makes −18 LUFS a sensible
target.

**Peeters, G. (2004).** *A large set of audio features for sound description.*
CUIDADO project report, IRCAM. → Spectral centroid, spread, flatness, rolloff
and flux, in the definitions
[φ_audio uses](./features/audio.md#spectral-definitions).

**Bregman, A. S. (1990).** *Auditory Scene Analysis.* MIT Press. → Background
for why octave-based frequency axes and segment-local measurements are the
right coordinates for a *perceptual* feature vector.

## Statistics of the feature space

**Belsley, D. A., Kuh, E. and Welsch, R. E. (1980).** *Regression Diagnostics:
Identifying Influential Data and Sources of Collinearity.* Wiley. → Variance
inflation factors, the diagnostic that found
[two exact dependencies in φ_struct](./features/structural.md#what-is-deliberately-not-in-φ).

**Huber, P. J. (1981).** *Robust Statistics.* Wiley. → Winsorizing, and the
reasoning behind
[using it as a fault detector rather than routinely](./features/standardization.md#why-not-just-winsorize-always).

## The libraries

- **quiver** —
  [github.com/alexnodeland/quiver](https://github.com/alexnodeland/quiver) ·
  [docs.rs](https://docs.rs/quiver-dsp)
- **fugue-evo** —
  [github.com/alexnodeland/fugue-evo](https://github.com/alexnodeland/fugue-evo)
  · [docs.rs](https://docs.rs/fugue-evo)
- **fugue-ppl** — [docs.rs](https://docs.rs/fugue-ppl)

## Lineage

Auracle is the third iteration of one idea, and the two before it are worth
knowing about because what each lacked is what this one is for:

| Iteration | Year | Proved | Lacked |
|---|---|---|---|
| **neuralCompressor** (C++/Arduino pedal) | 2020 | The interaction model: human-driven GA, fit/unfit footswitch, mutate/crossover knobs | The engine — neither the EA nor the DSP was ever implemented |
| **evosynth v1** (Next.js/Tone.js + FastAPI/DEAP) | 2025 | A working interactive GA over a fixed ~30-parameter subtractive synth; parameter locking; lineage tracking | Preference **persistence** (ratings died each generation), topology evolution, principled inference |
| **Auracle** | 2026– | — | — |

v0 had the interaction but no engine. v1 had an engine, but a naive one with no
memory of the user.
