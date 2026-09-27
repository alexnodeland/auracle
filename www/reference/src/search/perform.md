# Performance: named controls and the drift walk

<p class="lede">A control called <em>Bright</em> is a fixed direction in
standardized φ. Which knobs it turns is measured per patch, checked on real
renders, and refused when the knobs cannot honestly produce it.</p>

PERFORM, the instrument's first view, needs two things from the machinery. It
needs **controls whose names mean the same thing on every patch**, which a knob
address cannot give: `node/0#cut` is a brightness control in one patch and a
wavefolder's drive in another. And it needs **motion that stays inside the
sound**: a patch that changes on its own without changing what it is made of.

The first is a least-squares problem on the patch's own Jacobian. The second is
the [locked walk](./locks.md) with every structural site locked. Both live in
`auracle_session::perform`, and reach the browser as `perform_wire`,
`perform_apply`, `perform_drift` and `perform_offer` on `WasmEngine`.

## Symbols on this page

The [notation](../notation.md) fixes $d$ as the feature dimension and $x$ as a
term, so this page uses different letters for the two things the code calls
`d` and `x`.

| Symbol | Is | In the code |
|---|---|---|
| $v \in [0,1)^n$ | The patch's $n$ continuous knob values, normalized | `Jacobian::values` |
| $z(v) \in \R^{18}$ | The **audio** block of standardized $\varphi$ at those values | `audio_z` |
| $\hat e \in \R^{18}$ | A named control's unit direction | `direction(...)`, `d` |
| $J \in \R^{18 \times n}$ | $\partial z / \partial v$ at the current values $v_0$ | `Jacobian::cols` |
| $\delta \in \R^{n}$ | The knob move the wiring solves for | `x` |
| $S$ | The knobs a control is allowed to move, $\lvert S \rvert \le 4$ | `support` |
| $c \in [-1, 1]$ | A control's setting; $0$ is the sound as it is | `c` |

Distances along $\hat e$ are in **$z$ units**: one unit is one standard
deviation $s_j$ of the session's own spread, from the
[standardizer](../features/standardization.md). The instrument's tooltips and
the code's comments write this unit as σ.

## A named control is a direction

Six controls, each a fixed weighting of named [φ_audio](../features/audio.md)
coordinates, normalized to unit length:

| Control | Low · high | Weights before normalizing |
|---|---|---|
| Bright | dark · bright | `centroid_mean` $+1$, `rolloff_mean` $+1$ |
| Snap | bloom · snap | `attack_s` $-1$, `crest` $+1$ |
| Motion | still · restless | `held_centroid_std`, `motion_slow`, `motion_mid`, `motion_fast`, each $+1$ |
| Body | thin · full | `bass_fraction` $+1$ |
| Grit | smooth · rough | `flatness_mean` $+1$ |
| Space | close · far | `tail_ratio` $+1$ |

So $\hat e_{\text{Bright}} = (e_{\text{centroid}} + e_{\text{rolloff}})/\sqrt2$, and
Motion spreads over its four coordinates with weight $\tfrac12$ each, the
[motion bands](../features/audio.md#motion-bands) plus the older
`held_centroid_std`. A unit test requires each direction to have unit norm over
φ's real coordinate names, so a control whose every coordinate was renamed away
fails the build. A control that lost one of several coordinates would still
pass, and would quietly narrow to the rest.

The direction is defined in $z$, not raw $\varphi$, because only a standardized
coordinate has a scale that means the same thing across axes. The patch's
current **position** on a control is $\hat e^\top z(v_0)$; the instrument draws
it as a dot on the control's ring, at $\tanh(\hat e^\top z / 2)$ of the way to
the stop.

The standardizer is the session's, refit at every posterior fit. A control's
wiring and position are therefore relative to the patches this session has
seen, and can change after a refit. Before the pool has a standardizer at all,
`perform_wire` returns `null` and the view says there is nothing to measure
against yet.

The other two controls, Blend and Wander, are not directions in φ and live in
the instrument, not in this module.

## The Jacobian, by one-sided differences

For each continuous knob $k$, one render nudged by $h_k$:

$$
J_{:,k} \;=\; \frac{z(v_0 + h_k\, e_k) - z(v_0)}{h_k},
\qquad
h_k = \begin{cases} +h & v_{0,k} < \tfrac12 \\ -h & \text{otherwise} \end{cases}
\qquad h = 0.08
$$

`JACOBIAN_STEP` $= 0.08$ of the knob's normalized range: large enough to move φ
past the numerical floor of a five-second render, small enough to stay local.
Stepping **toward the interior** keeps every nudge inside the knob's domain,
and one-sided differences cost $n + 1$ renders instead of the $2n$ that central
differences would, all through the render memo. A knob whose nudge fails to vet
gets a zero column, and the wiring simply cannot use it.

The estimate is first order: its error is $O(h)$ in the curvature of the
response. That is not bounded here. It is what the verification below exists
to catch.

## Wiring: ridge, support, re-solve

The knob move that best produces $\hat e$ is the ridge solution

$$
\delta^\star \;=\; \big(J^\top J + \lambda I\big)^{-1} J^\top \hat e,
\qquad \lambda = 0.05 \;(\texttt{RIDGE}).
$$

Ridge rather than plain least squares because $J$ is badly conditioned by
construction. Two knobs can do nearly the same thing to the sound, which makes
columns nearly collinear, and many knobs are nearly inaudible, which makes
columns nearly zero. Unregularized, the solve answers
both with large, cancelling moves.

The support $S$ is the four largest $\lvert \delta^\star_k \rvert$
(`MAX_KNOBS`), and the move is **re-solved** on it:

$$
\delta_S \;=\; \big(J_S^\top J_S + \lambda I\big)^{-1} J_S^\top \hat e .
$$

Truncating $\delta^\star$ would throw away the other knobs' contribution
without letting the four that remain compensate; the re-solve is the best move
on those four. Choosing the four by $\lvert\delta^\star\rvert$ is a heuristic,
not a best-subset search.

Four, because a control is heard as one gesture, and because four is where
most of a patch's audible leverage already is: over the preset library, a
patch's four most audible knobs carry a median 68% of its φ movement
([below](#the-measurements-and-what-reproduces-them)).

The movement this predicts is $J_S \delta_S$, and three numbers follow from it.

**Purity** is the cosine between the predicted movement and the direction asked
for:

$$
\rho \;=\; \frac{\hat e^\top J_S \delta_S}{\lVert J_S \delta_S \rVert}.
$$

$\rho = 1$ is a pure move along the label. At $\rho = 0.35$ the off-axis part
of the movement is $\sqrt{1 - 0.35^2} / 0.35 \approx 2.7$ times the on-axis
part.

**Scale.** A full turn may move no knob by more than `MAX_TRAVEL` $= 0.5$ of its
range:

$$
\alpha \;=\; \frac{0.5}{\max_{k \in S} \lvert \delta_{S,k} \rvert},
\qquad
v(c) \;=\; \operatorname{clip}\!\big(v_0 + c\,\alpha\,\delta_S,\; 0,\; 1 - 10^{-6}\big).
$$

The upper clip is `KNOB_MAX`. Every continuous site is $\mathrm{Uniform}(0,1)$
on the half-open interval, so a knob at exactly $1$ has log-prior $-\infty$ and
would make the patch un-evolvable. A performance gesture must never do that.

**Reach** is the predicted movement along $\hat e$ at a full turn, in $z$
units:

$$
R \;=\; \alpha\, \hat e^\top J_S \delta_S .
$$

A control is a **search control** on this patch when the knobs cannot honestly
produce it:

$$
\text{search} \iff \rho < 0.35 \;\lor\; R < 0.15
$$

(`PURITY_FLOOR`, `REACH_FLOOR`), or when there is no support or the predicted
movement points the wrong way. The reach floor was first set at $0.25$ against
the preset library's spread. The session pool is spread wider than a curated
library, which shrinks every $z$ distance, and $0.25$ hid controls that are
plainly audible on a live patch.

Several controls turned at once add: each contributes $c_i \alpha_i \delta_{S_i}$
to the knobs it wires, and the sum is clipped. The composition is linear by
assumption and is not verified.

### Aiming at the pattern, not the axis

The axis $\hat e$ says what a control *measures*: Bright is centroid and
rolloff. It does not say how a sound that gets brighter moves everywhere else,
and it always moves elsewhere too — its zero-crossing rate and high band rise
with it. Solved against the bare axis, those correlates count as off-axis
motion, and an honest cutoff turn is scored as an impure control.

The distinction is the one between a linear model's *filter* and its
*pattern* (Haufe et al. 2014): the pattern of a direction $a$ over a population
with correlation $\Sigma$ is $\Sigma a$, the movement that typically
accompanies movement along $a$. The shipped wiring aims the solve and the
purity at the pattern,

$$
\hat p \;=\; \frac{\Sigma\,\hat e}{\lVert \Sigma\,\hat e \rVert},
\qquad
\delta^\star = \big(J^\top J + \lambda I\big)^{-1} J^\top \hat p,
\qquad
\rho = \frac{\hat p^\top J_S \delta_S}{\lVert J_S \delta_S \rVert},
$$

with $\Sigma$ the correlation of standardized audio φ over the session's own
pool (`Engine::audio_correlation`; below 8 members, `PATTERN_MIN_POOL`, the bare
axis is used). Reach, position and [verification](#verification-on-real-renders)
stay on the axis $\hat e$: the question the renders answer is still "did it
get brighter".

Measured over the first 24 patches of a fresh session pool (`reach_census`,
seed 7), with verification:

| | Bright | Snap | Motion | Body | Grit | Space |
|---|---|---|---|---|---|---|
| Reachable, bare axis | 25% | 58% | 58% | 17% | 4% | 38% |
| Reachable, pattern | 38% | 58% | 54% | 33% | 8% | 33% |
| Median purity, bare axis | 0.26 | 0.61 | 0.63 | 0.08 | 0.03 | 0.00 |
| Median purity, pattern | 0.53 | 0.66 | 0.59 | 0.52 | 0.38 | 0.25 |

Patches on which no control reaches fell from 4 of 24 to 1, and the typical
patch reaches two or three of the six. Grit and Space stay rare for the reason
they always were: most patches have no drive or reverb to turn, and those
controls ask for an offer instead. The same census under the preset library's
standardizer matches the pool's bare-axis rows closely, so the pool's wider
spread is not what held Bright back. The gate test holds both wirings to the
same promise on real renders.

## Verification on real renders

The Jacobian is a local, linear claim, and it fails exactly where a player
would notice: at a boundary. On *First Bass*, which already sits at the floor of
motion, the linear prediction said turning Motion down would make it stiller.
Rendered, it made it very slightly more restless.

So `verify` renders every non-search control alone at four settings and
measures the movement along its own axis:

$$
m(c) \;=\; \hat e^\top \big( z(v(c)) - z(v_0) \big),
\qquad c \in \{-1, -\tfrac12, +\tfrac12, +1\}.
$$

For each half, with sign $s \in \{+1, -1\}$, the measured reach is

$$
r_s \;=\; \begin{cases}
s\,m(s) & \text{if } 0 < s\,m(\tfrac{s}{2}) < s\,m(s) \\
0 & \text{otherwise.}
\end{cases}
$$

The half must move the asked way at half travel, and further at full travel. A
half that moves at the end but reverses on the way is closed. A half is
**open** when $r_s \ge 0.075$, half the reach floor. A control with neither
half open becomes a search control. The instrument draws a half-closed control
with half its ring and names the end it is stuck at: *already as still as it
gets*, for Motion on First Bass.

Total cost for a patch with $n$ knobs and $r$ reachable controls is $n + 1 + 4r$
renders, at most $n + 25$, all through the memo. The view re-wires after every
glide and every patch change, so the claims are always about the neighbourhood
the sound is in.

### The gate, and why it samples somewhere else

`named_controls_move_the_sound_they_name` wires and verifies four presets
(*First Bass*, *Ceiling*, *Detune Dream*, *Long Way Down*) and then checks every
open half at $c = \pm\tfrac34$, a point verification never rendered:

$$
s\,\big(\hat e^\top z(v(\tfrac{3s}{4})) - \hat e^\top z(v_0)\big) \;>\; -0.05
\qquad (\texttt{MONO\_TOL}).
$$

It requires at least eight open halves, so a wiring change that closed most of
them would fail the gate rather than pass it vacuously.

It samples somewhere else because **no finite set of samples proves a response
monotone**. A smooth function can agree with any finite set of points and
reverse between them. Checking an unsampled point is the measurable form of the
promise, and a check at the points verification already used would be the same
test twice.

The tolerance is stated rather than zero because a five-second render has
numerical noise. $0.05$ $z$ units is two orders of magnitude below an audible
difference and above that noise. A check with no tolerance failed on *Detune
Dream*'s Snap, which reversed by $0.018$: real, measurable, and far below
anything a listener would hear. That is the case the tolerance exists for.
Verification itself has no tolerance: a half that reverses at a sampled point
is closed however small the reversal.

## The measurements, and what reproduces them

**Per patch, not per knob kind.** The obvious alternative to measuring a
Jacobian per patch is a table: what a cutoff knob, or an attack knob, usually
does. Both were measured over the 61 presets. The table was built
leave-one-out, from per-site-kind averages over the other 60, so no preset was
wired by a table that had seen it.

| Median purity | Bright | Snap | Motion |
|---|---|---|---|
| Wired from the patch's own Jacobian | 0.61 | 0.77 | 0.75 |
| Wired from the best leave-one-out per-site table | 0.23 | 0.16 | 0.09 |

The same knob does different things in different patches. That is the reason
the grammar exists, and it is the reason the table is not used.

**Grit and Space** measure a median purity of about zero by knobs alone on most
presets, because most patches contain no drive or reverb to turn. They are the
controls most often drawn as search controls.

**Leverage.** Nudging every knob of every preset by $\pm 0.15$ and measuring how
far $\varphi_{\text{audio}}$ moves, in units of the library's own
per-coordinate spread: over 61 presets and 821 knobs, a patch's four most
audible knobs carry a median **68%** of its total movement and its top eight
**94%**. 172 of the 821 knobs barely move it at all. That is what makes
`MAX_KNOBS` $= 4$ a real operation rather than a random pick with a story
attached.

| Example | Produces |
|---|---|
| `cargo run -p auracle-features --example jacobian_probe --release > jac.csv` | $\partial\varphi_{\text{audio}}/\partial\text{knob}$ for every preset: the raw material for both purity rows |
| `cargo run -p auracle-features --example leverage_probe --release > leverage.csv` | Per-knob leverage for every preset |
| `cargo run -p auracle-session --example perform_wiring --release -- "First Bass"` | The shipped wiring on named presets: knobs, purity, reach, position, search |
| `cargo run -p auracle-session --example reach_census --release -- 24 7` | How many controls reach the patches of a fresh session pool: bare axes vs the shipped pattern, with verification |

The two probes print CSV and the medians are computed from it. `jacobian_probe`
uses central differences on raw φ at the same $h = 0.08$, so it measures the
same response as the shipped code without being bit-identical to it.
`perform_wiring` runs the shipped `jacobian` and the bare-axis `wire` under a
preset-library standardizer, and does not run verification; `reach_census`
runs the shipped path (`Engine::wire_controls`) with verification.

## Drift: a local walk on the live knobs

`Engine::drift` samples the same [target](./target.md)

$$\pi_\beta(x) \;\propto\; p_{\text{grammar}}(x)\,\exp\!\big(\beta\,\E[u_\theta(\varphi(x))]\big),$$

restricted to this patch's shape: every structural and categorical address,
every continuous site without a live handle (`frozen_addrs`), and the player's
own locks are held fixed. Holding sites fixed in a Metropolis–Hastings walk is
exact conditioning ([Locks as conditional refinement](./locks.md)), so the walk
targets $\pi_\beta(v \mid x_{\mathcal{L}})$ over the knobs the voices can take
live. Structure cannot change under the player's hands, and nothing the walk
moves needs a recompile to be heard.

The kernel is **not** refinement's. Each step picks one free knob uniformly and
proposes

$$
v' \;=\; \operatorname{reflect}_{[0,1)}\!\big(v + \sigma\,\xi\big), \qquad \xi \sim \mathcal N(0, 1),
$$

accepted with probability $\min\!\big(1,\ \pi_\beta(x')/\pi_\beta(x)\big)$. The
reflected Gaussian is symmetric, so there is no Hastings correction
(`Engine::local_walk`). Refinement's kernel, fugue's adaptive single-site MH,
starts every fresh chain with a wide proposal on a unit-interval knob: measured
over 12 presets, an 8-step "drift" moved some knob by 0.3–0.85 of its range. A
drift should wander, and how far is the Wander dial's to say.

| Wander | Steps | $\sigma$ | Farthest knob moved (12 presets) |
|---|---|---|---|
| gentle drift | 8 | 0.05 | 0.06–0.14 |
| mid drift | 18 | 0.08 | 0.15–0.33 |
| roam | 40 | 0.15 | 0.25–0.61 |

(`cargo run -p auracle-session --example drift_distance --release`.) The walk
returns its end state, or nothing if it ends where it started. Like
refinement, a short walk's end state is local movement *on* $\pi_\beta$, not a
draw *from* it ([What is not sampled](./target.md#what-is-not-sampled-from-this)).
Nothing enters the pool: a performance gesture is not a candidate until the
player keeps it.

**The wiring survives a small drift.** The named controls are a linear model
measured with 0.08 knob steps, so the instrument re-measures them only when
some knob has left a 0.12 neighbourhood of where they were measured. A gentle
drift usually stays inside and costs nothing; before, every glide was followed
by a full re-measure of about 46 renders, which in *drift* kept the worker busy
much of the time and queued offers behind it.

The instrument then glides the knobs from where they are to the returned values
along a smoothstep, $v(t) = v_0 + (v_1 - v_0)(3u^2 - 2u^3)$, over 2 to 6
seconds. The intermediate states are interpolations, not states of the walk.
They are all valid patches, since the structure is fixed and the knob box is
convex. A touch stops the glide where it is.

## Offers

`Engine::offer` is the same walk with only the player's locks, so structural
moves are allowed: it may add, remove or replace a module. It is also
non-inserting. The instrument asks for 20 steps (40 in *roam*) and plays the
result in the B slot, never as a jump. A [search
control](#wiring-ridge-support-re-solve) released more than $0.3$ from its
centre asks for one, and springs back without moving a knob.

## Before any evidence: `VetOnlyFitness`

With no posterior there is no utility to climb, and the first version of
PERFORM returned nothing for drift and offers until the player had made picks.
But the posterior before any evidence is not undefined. It is the prior.

With a zero-mean prior on $\theta$ and a single lens, the prior expectation of
utility is $\E[\theta]^\top z = 0$ for every patch, so the target is
$p_{\text{grammar}}$ itself. `VetOnlyFitness` writes that down, with the vetting
gate kept:

$$
f(x) \;=\; \begin{cases} 0 & x \text{ vets} \\ -50 & \text{otherwise } (\texttt{QUARANTINE\_FITNESS}) \end{cases}
\qquad\Longrightarrow\qquad
\pi_\beta(x) \;\propto\; p_{\text{grammar}}(x)\, e^{\beta f(x)} .
$$

At $\beta = 2$ an unvetted term is down-weighted by $e^{-100} \approx 4 \times
10^{-44}$, so $\pi_\beta$ is $p_{\text{grammar}}$ restricted to listenable
patches, to any precision that matters. The proposal distribution is the plain
grammar prior too, since the [taste tilt](./proposals.md) needs a posterior.

Every drift and offer reply carries whether it was taste-directed
(`Engine::has_taste`), and the instrument says which: *drifting through the
grammar — no taste yet*, or *drifting toward your taste*. Wiring the named
controls needs no taste at all, only a standardizer.

## The B slot

An offer is heard through a second `LivePoly` in the same AudioWorklet. It
receives every note-on, note-off, bend, glide, unison and arpeggiator message
the first one does, and notes held when it loads are replayed into it, so it
joins a chord already sounding. It renders continuously while loaded, so its
envelopes and tails are in step with A when the mix moves.

The mix is **equal-power**, with the mix position $m$ smoothed per sample:

$$
y = \cos\!\big(\tfrac{\pi}{2} m\big)\, y_A + \sin\!\big(\tfrac{\pi}{2} m\big)\, y_B,
\qquad
m \leftarrow m + 0.002\,(m^\ast - m).
$$

The one-pole has a time constant of 500 samples, about 10 ms at 48 kHz, so a
Peek is a gesture rather than a click. The gains satisfy $g_A^2 + g_B^2 = 1$,
which holds the summed power constant when A and B are uncorrelated. When they
are nearly identical the sum rises by up to 3 dB at $m = \tfrac12$, since
$\cos 45° + \sin 45° = \sqrt2$. An equal-gain law would have the opposite
error, flat for identical sources and 3 dB down for unrelated ones. An offer
is a different patch, so the equal-power error is the one taken.

B is **loudness-matched**. Its makeup gain is the offer's own [loudness
normalization](../audition/loudness.md) to −18 LUFS on the standard phrase,
$10^{g/20}$ with $g$ clamped to $\pm 12$ dB, the same makeup every live patch
gets. Without it a crossfade would mostly compare levels, and the louder side
reliably wins. The match is made on the standard phrase at each patch's own
settings; a named control turned on A afterwards changes A's level without
re-normalizing it.

## What is not done

- **Named controls are not directed search.** A search control asks for an
  untargeted offer: the walk still targets $\pi_\beta$, not $\pi_\beta$ tilted
  toward $\hat e$. Adding $\gamma\,\hat e^\top z(x)$ to the log-target would
  aim it, and is the same substitution as
  [target-directed search](../design/directions.md#2-target-directed-search-make-it-sound-like-this).
  It is not built, so the offer may not move the way the control was turned.
- **The directions are fixed, not personal.** The six are the same for every
  player. A control along a fitted style lens $\theta_k$ is [a different and
  more interesting
  object](../design/audition-limits.md#8-forty-addresses-and-no-macros-when-the-macro-axis-is-already-fitted),
  and not this one.
- **What the player does here is logged, not fitted.** Keep, Back, Take, each
  offer and each control turn are recorded as `ImplicitEvent`s
  (`perform_keep`, `perform_back`, `perform_take`, `perform_offer`,
  `perform_turn`). None enters the likelihood. A Keep can mean *I love this* or
  *stop drifting for a moment*, and [implicit
  signals](../taste/likelihoods.md#implicit-signals-are-out-of-scope) stay out
  of the model until a fit using them can be validated against the explicit
  ones.
- **Combinations are not verified.** Each control is verified alone, at $v_0$.
- **Motion hears one note.** Its axis is built from the held note's span, with
  the [limits](../features/audio.md#what-it-cannot-say) that implies.
