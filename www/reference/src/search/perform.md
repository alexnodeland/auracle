# Performance: named controls and the drift walk

<p class="lede">A control called <em>Bright</em> is a fixed direction in
standardized φ. Which knobs it turns is measured per patch, checked on real
renders, and refused when the knobs cannot honestly produce it.</p>

PERFORM, the instrument’s first view, needs two things from the machinery. It
needs **controls whose names mean the same thing on every patch**, which a knob
address cannot give: `node/0#cut` is a brightness control in one patch and a
wavefolder’s drive in another. And it needs **motion that stays inside the
sound**: a patch that changes on its own without changing what it is made of.

The first is a least-squares problem on the patch’s own Jacobian. The second is
the [locked walk](./locks.md) with every structural site locked. Both live in
`auracle_session::perform`, and reach the browser as `perform_wire`,
`perform_apply`, `perform_drift`, and `perform_offer` on `WasmEngine`.

## Symbols on this page

The [notation](../notation.md) fixes $d$ as the feature dimension and $x$ as a
term, so this page uses different letters for the two things the code calls
`d` and `x`.

| Symbol | Is | In the code |
|---|---|---|
| $v \in [0,1)^n$ | The patch’s $n$ continuous knob values, normalized | `Jacobian::values` |
| $z(v) \in \R^{18}$ | The **audio** block of standardized $\varphi$ at those values | `audio_z` |
| $\hat e \in \R^{18}$ | A named control’s unit direction | `direction(...)`, `d` |
| $J \in \R^{18 \times n}$ | $\partial z / \partial v$ at the current values $v_0$ | `Jacobian::cols` |
| $\delta \in \R^{n}$ | The knob move the wiring solves for | `x` |
| $S$ | The knobs a control is allowed to move, $\lvert S \rvert \le 4$ | `support` |
| $c \in [-1, 1]$ | A control’s setting; $0$ is the sound as it is | `c` |

Distances along $\hat e$ are in **$z$ units**: one unit is one standard
deviation $s_j$ of the session’s own spread, from the
[standardizer](../features/standardization.md). The instrument’s tooltips and
the code’s comments write this unit as σ.

The constants on this page live in `auracle-session`’s `perform.rs` unless the
text names another file.

## A named control is a direction

Six controls on the panel, each a fixed weighting of named
[φ_audio](../features/audio.md) coordinates, normalized to unit length. They
are the first six of [the palette's eighteen](#the-palette-eighteen-directions),
which the engine defines and measures the same way:

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
`held_centroid_std`. A unit test requires each of the eighteen directions to
have unit norm over φ’s real coordinate names, and every coordinate it weights
to be one of them, so a control that lost any coordinate to a rename fails the
build instead of quietly narrowing to the rest.

The direction is defined in $z$, not raw $\varphi$, because only a standardized
coordinate has a scale that means the same thing across axes. The patch’s
current **position** on a control is $\hat e^\top z(v_0)$; the instrument draws
it as a dot on the control’s ring, at $\tanh(\hat e^\top z / 2)$ of the way to
the stop.

The standardizer is the session’s, refit at every posterior fit. A control’s
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

`JACOBIAN_STEP` $= 0.08$ of the knob’s normalized range: large enough to move φ
past the numerical floor of a five-second render, small enough to stay local.
Stepping **toward the interior** keeps every nudge inside the knob’s domain,
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
both with large, canceling moves.

The support $S$ is the four knobs with the largest **effect**
$\lvert \delta^\star_k \rvert \, \lVert J_{\cdot k} \rVert$ (`MAX_KNOBS`), and
the move is **re-solved** on it:

$$
\delta_S \;=\; \big(J_S^\top J_S + \lambda I\big)^{-1} J_S^\top \hat e .
$$

Truncating $\delta^\star$ would throw away the other knobs’ contribution
without letting the four that remain compensate; the re-solve is the best move
on those four. Choosing the four by effect is a heuristic, not a best-subset
search. It is effect and not $\lvert\delta^\star\rvert$ because a knob that barely
moves the sound needs a large coefficient to contribute anything. Ranked by
coefficient, that knob headed the support, and the scale below then gave the
knob doing the work a sliver of a turn. On Iron Bass, Bright wired to the
drive ($\lVert J_{\cdot k}\rVert = 0.15$) at $+0.5$, and the cutoff
($\lVert J_{\cdot k}\rVert = 5.2$, $+4\sigma$ of centroid per unit) barely
moved: $0.03\sigma$ of reach.

**The control’s own knobs first.** The solve runs twice at most. First it is
restricted to the knobs a musician would name for the control
(`NamedControl::sites`: cutoff, tone, … for Bright; mod depth and rate for
Motion). If that wiring clears the gate below, it is used. Only if it does not
does the solve range over every live knob, with those sites as a soft prior
(`SEMANTIC_RIDGE`). A player who turns Bright and watches the cutoff move has
learned something true about the patch. One who watches the amp release move,
which is what the unrestricted solve chose on Acid Line, has learned nothing.

Four, because a control is heard as one gesture, and because four is where
most of a patch’s audible leverage already is: over the preset library, a
patch’s four most audible knobs carry a median 68% of its φ movement
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
range. The knob with the largest effect gets all of it, and the rest follow in
proportion, clamped at the same limit:

$$
\alpha \;=\; \frac{0.5}{\lvert \delta_{S,k^\ast} \rvert},\quad
k^\ast = \arg\max_{k\in S} \lvert\delta_{S,k}\rvert\,\lVert J_{\cdot k}\rVert,
\qquad
t_k \;=\; \operatorname{clip}(\alpha\,\delta_{S,k},\, \pm 0.5),
$$

$$
v(c) \;=\; \operatorname{clip}\!\big(v_0 + c\,t,\; 0,\; 1 - 10^{-6}\big).
$$

Purity and reach below are computed from the clamped travel $t$, so they
describe the move the control actually makes.

The upper clip is `KNOB_MAX`. Every continuous site is $\mathrm{Uniform}(0,1)$
on the half-open interval, so a knob at exactly $1$ has log-prior $-\infty$ and
would make the patch un-evolvable. A performance gesture must never do that.

**Reach** is the predicted movement along $\hat e$ at a full turn, in $z$
units:

$$
R \;=\; \hat e^\top J_S\, t .
$$

A control is a **search control** on this patch when the knobs cannot honestly
produce it:

$$
\text{search} \iff \rho < 0.35 \;\lor\; R < 0.15
$$

(`PURITY_FLOOR`, `REACH_FLOOR`), or when there is no support or the predicted
movement points the wrong way. The reach floor was first set at $0.25$ against
the preset library’s spread. The session pool is spread wider than a curated
library, which shrinks every $z$ distance, and $0.25$ hid controls that are
plainly audible on a live patch.

Several controls turned at once add: each contributes $c_i \alpha_i \delta_{S_i}$
to the knobs it wires, and the sum is clipped. The composition is linear by
assumption and is not verified.

### Purity measures cross-talk, not correlates

Purity asks whether a move is *this* control. Measured against the whole of
φ, it cannot tell a brightening that also raises the zero-crossing rate and the
high band (which every real brightening does) from one that also slows the
attack. Over a fresh session pool, Bright’s median cosine with its own axis
was 0.26 for that reason. What a player hears as “this control does something
else” is movement along *another control’s* axis, so purity is the cosine with
$\hat e$ inside the subspace the six named axes span:

$$
\rho \;=\; \frac{\hat e^\top m}{\sqrt{(\hat e^\top m)^2 + \sum_{k \ne \text{self}} (\hat a_k^\top m)^2}},
\qquad m = J_S \delta_S ,
$$

with $\hat a_k$ the other controls’ axes. Reach and position stay on $\hat e$.
And two controls whose predicted movements are within $\lvert\cos\rvert > 0.8$
of each other are one gesture with two names: the later one in the order they
were wired (for the panel, Bright, Snap, Motion, Body, Grit, Space) becomes a
search control (`separate`, `COLLINEAR`).

A palette control is not one of the six axes, so the same idea is written for
any direction (`purity_basis`). Take an orthonormal basis $b_0, \dots, b_q$ of
the span of $\hat e$ and the six axes, with $b_0 = \hat e$ and the rest from
Gram–Schmidt over the six in order, and, for the predicted movement $m$ as
above,

$$
\rho \;=\; \frac{\hat e^\top m}{\sqrt{\sum_{i=0}^{q} (b_i^\top m)^2}} .
$$

For one of the six this is the formula above, bit for bit: the other five axes
share no coordinate with it, so they enter the basis unchanged (a unit test
holds the two equal). A control that leans on some of the six (Thump on Body,
and on Snap through `crest`) takes up what it shares with them, and the
remainder of each, the part orthogonal to $\hat e$, counts against it in full:
a move of $\hat e$ plus an equal part of that remainder has
$\rho = 1/\sqrt2$ (the unit test checks this for every such pair). One with a
coordinate of its own (Air’s `zcr_mean`) widens the span by that much. A move
along the control’s own direction has $\rho = 1$.

Measured over the first 24 patches of a fresh session pool (`reach_census`,
seed 7), with verification on real renders:

| Reachable | Bright | Snap | Motion | Body | Grit | Space |
|---|---|---|---|---|---|---|
| Purity against the whole of φ | 25% | 58% | 58% | 17% | 4% | 38% |
| Purity against the named axes | 29% | 71% | 62% | 21% | 4% | 38% |

Patches on which no control reaches fell from 4 of 24 to 2. The gain is
modest because purity was not Bright’s real limit: its median predicted reach
is about 0.1σ, since many pool patches have no filter for a named control to
turn. That is the honest reading, and a search control’s offer is the answer
to it.

The same 24 patches, after the effect ranking, the control’s-own-knobs pass,
and a half-travel retry in `verify` (all three above and below). Both rows
are measured on the same build, since the pink-noise fix and the re-voiced
presets moved the pool standardizer:

| Reachable | Bright | Snap | Motion | Body | Grit | Space | mean per patch |
|---|---|---|---|---|---|---|---|
| Ranked by coefficient | 29% | 67% | 62% | 21% | 4% | 38% | 2.21 |
| Ranked by effect | **50%** | **79%** | 46% | **29%** | 4% | **46%** | **2.54** |

The median verified reach of a reachable control grew three- to four-fold
(Bright 0.09σ → 0.33σ, Snap 0.54σ → 0.95σ). **Motion lost**: 62% → 46%.
Motion leans on several small knobs together, and giving the strongest one its
whole turn is where a Motion wiring most often turns back on itself. The
half-travel retry did not win those patches back. Dropping the weak knobs was
tried first and cost Motion more.

**Tried and not shipped.** Aiming the solve at each control’s population
*pattern* $\Sigma \hat e$ (the correlation-weighted direction, Haufe et al.
2014) first looked like a large improvement, but only because purity was then
measured against the pattern instead of the axis. Measured against the axis,
with the pool correlation shrunk toward the identity (Schäfer & Strimmer 2005)
and collinear controls separated, it reached fewer patches than the bare axis
(Bright 21%, Motion 42%), and on 2 of 12 patches it put Bright and Body onto
the same knobs with opposite signs. It was removed.

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
half open becomes a search control. The instrument draws a half-closed
control’s ring solid on the side it can turn toward and dotted on the other,
with a stop at the center, and says which way it turns: *turns toward restless
only*, for Motion on First Bass.

A control that would close at full travel gets **one retry at half**: the same
two-point test over $c \in \{\pm\tfrac14, \pm\tfrac12\}$ (the $\pm\tfrac12$ renders
are already in the memo). If a half opens, the wiring keeps half its travel
rather than closing.

Total cost for a patch with $n$ knobs and $r$ reachable controls is $n + 1 + 4r$
renders, plus two for each retry, all through the memo. In the browser that is
around 20–30 renders, and the page caches each measurement by tree, stamped
with the vote count and the render namespace (`cache_namespace`: the
featurizer's `RENDER_EPOCH` and the quiver version), so returning to a patch
costs none. A stamp that no longer matches is played at once and re-measured
in the background. Every preset’s measurement also
ships with the app (`apps/web/perform-wirings.json`, made natively through the
same `WasmEngine` calls by `make perform-wirings`), so a preset is playable the
moment it lands; the page re-measures it in the background, because the file
was measured under a standardizer fitted to a standard pool, not the session’s.
The view re-wires after every patch change, and after a glide or a Keep that
carries the knobs out of the neighborhood the wiring was measured in (see
below), so the claims are always about the neighborhood the sound is in. A
background re-measurement that wires each control to the same knobs is taken
in place, without re-centering the controls.

### The gate, and why it samples somewhere else

`named_controls_move_the_sound_they_name` wires and verifies four presets
(*First Bass*, *Ceiling*, *Detune Dream*, *Long Way Down*) and then checks every
open half at $c = \pm\tfrac34$, a point verification never rendered:

$$
s\,\big(\hat e^\top z(v(\tfrac{3s}{4})) - \hat e^\top z(v_0)\big) \;>\; -0.05
\qquad (\texttt{MONO\_TOL}).
$$

It requires at least eight open halves, so a wiring change that closed most of
them would fail the gate rather than pass it vacuously. The palette’s twelve
are held to the same check on the same four presets, each wired alone, and
must show at least 16 open halves over at least 8 of the twelve.

It samples somewhere else because **no finite set of samples proves a response
monotone**. A smooth function can agree with any finite set of points and
reverse between them. Checking an unsampled point is the measurable form of the
promise, and a check at the points verification already used would be the same
test twice.

The tolerance is stated rather than zero because a five-second render has
numerical noise. $0.05$ $z$ units is two orders of magnitude below an audible
difference and above that noise. A check with no tolerance failed on *Detune
Dream*’s Snap, which reversed by $0.018$: real, measurable, and far below
anything a listener would hear. That is the case the tolerance exists for.
Verification itself has no tolerance: a half that reverses at a sampled point
is closed however small the reversal.

## The measurements, and what reproduces them

**Per patch, not per knob kind.** The obvious alternative to measuring a
Jacobian per patch is a table: what a cutoff knob, or an attack knob, usually
does. Both were measured over 61 presets. The table was built
leave-one-out, from per-site-kind averages over the other 60, so no preset was
wired by a table that had seen it.

| Median purity | Bright | Snap | Motion |
|---|---|---|---|
| Wired from the patch’s own Jacobian | 0.61 | 0.77 | 0.75 |
| Wired from the best leave-one-out per-site table | 0.23 | 0.16 | 0.09 |

The same knob does different things in different patches. That is the reason
the grammar exists, and it is the reason the table is not used.

**Grit and Space** measure a median purity of about zero by knobs alone on most
presets, because most patches contain no drive or reverb to turn. They are the
controls most often drawn as search controls.

**Grafts.** Turning a search control first tries to give it something to turn
(`graft_for`). Bright and Body get a flat EQ, placed below any stereo module
that ends the chain, because above one it folds the patch to mono (Ghost Bell
moved 0.27σ that way). Space, turned up, gets its amp release raised to 0.6
(≈250 ms). A reverb was tried first, and every effect here sits before the amp
envelope: on First Bass with a reverb grafted, ∂Space/∂mix measured −0.04 and
∂Space/∂release +3.65. Grit gets nothing (see the
[open question](../design/open-questions.md)). `perform_inserts` measures each
graft. Over the preset bank, the EQ is transparent (median |Δz| 0.000; the
unit test bounds it at 0.05σ). It opens Bright on 7 of the 10 presets where
Bright was a search control, and Body on 15 of 48. The release graft opens
Space on 41 of 46, at 1–2σ of reach. It is not transparent, and is not meant
to be: it is what “farther” asked for.

**Leverage.** Nudging every knob of every preset by $\pm 0.15$ and measuring how
far $\varphi_{\text{audio}}$ moves, in units of the library’s own
per-coordinate spread: over 61 presets and 821 knobs, a patch’s four most
audible knobs carry a median **68%** of its total movement and its top eight
**94%**. 172 of the 821 knobs barely move it at all. That is what makes
`MAX_KNOBS` $= 4$ a real operation rather than a random pick with a story
attached.

| Example | Produces |
|---|---|
| `cargo run -p auracle-features --example jacobian_probe --release > jac.csv` | $\partial\varphi_{\text{audio}}/\partial\text{knob}$ for every preset: the raw material for both purity rows |
| `cargo run -p auracle-features --example leverage_probe --release > leverage.csv` | Per-knob leverage for every preset |
| `cargo run -p auracle-session --example perform_wiring --release -- "First Bass"` | The shipped wiring on named presets: knobs, purity, reach, position, search |
| `cargo run -p auracle-session --example perform_inserts --release` | For each preset’s search controls, whether PERFORM’s graft is transparent and whether it makes the control reachable |
| `cargo run -p auracle-session --example reach_census --release -- 24 7` | How many controls reach the patches of a fresh session pool, with verification, and how the gate would read with purity against the whole of φ |
| `cargo run -p auracle-wasm --example palette_census --release -- 3 --prototype` | The [palette](#the-palette-eighteen-directions): the eighteen directions, their cosines, how often each reaches the presets, and what measuring them costs natively |
| `node crates/auracle-wasm/examples/palette_cost.mjs 4` | The same measurement’s cost in wasm, the six against the eighteen (`make wasm` first) |

The two probes print CSV and the medians are computed from it. `jacobian_probe`
uses central differences on raw φ at the same $h = 0.08$, so it measures the
same response as the shipped code without being bit-identical to it.
`perform_wiring` runs the shipped `jacobian` and the bare-axis `wire` under a
preset-library standardizer, and does not run verification; `reach_census`
runs the shipped path (`Engine::wire_controls`) with verification.

## The palette: eighteen directions

[RFC-006](https://github.com/alexnodeland/auracle/blob/main/docs/proposals/006-the-sound-at-the-centre.md)
turns PERFORM’s controls into a palette of eighteen in six families, of which
the player places up to eight. The engine defines all eighteen (`PALETTE` in
`perform.rs`) and measures any of them exactly as it measures the six: one
Jacobian, the ridge solve onto at most four knobs, the purity and reach gate,
separation, and verification on real renders (`Engine::wire_named`; the
arithmetic alone, unverified and without a render, is `wire_set`). The first
six entries are `CONTROLS`, at the same indices, so an index names the same
control in either list. The app wires the controls the player has placed on
PERFORM’s panel, at most eight (`PANEL_MAX` in `perform.js`): for the six it
sends no `controls`, so the request is the one it always was, and for any
other panel it sends the panel’s set.

**The set is asked for in palette order,** whatever order the panel shows.
`separate` makes the later of two collinear controls the search control, so
the order asked is part of the answer; asking in palette order makes the
answer a function of the set alone, so reordering the panel costs no renders,
and the six keep the precedence the census above measured them with (“beside
the six”). The page keys its cache of wirings (`wireKey`) by the patch and the
set: the patch’s own key for the six, which is the key every kept and shipped
wiring already had, and that key with `#controls=` and the set for any other.
A set not measured on a patch yet borrows, control by control, from any set
that was (`borrowWiring`), and is measured behind it.

**How a control is named across the boundary.** `perform_wire`’s `controls` is
a JSON array of palette indices, read entry by entry: a non-negative whole
number is an index, and an index out of range, a repeat, or anything else in
the array (a negative, a fraction, a string) is dropped on its own. What is
not an array at all means the six. An array with nothing valid in it wires
nothing and renders only the patch itself. The reply’s `wiring` follows the
order asked, and each entry carries its palette `index` (`Wiring::index`)
beside its `name`. The page names a control back to the engine by that
`index` (`perform_offer`’s `control`, `perform_graft`’s `k`), never by the
entry’s position: asked for `[16, 6]`, the first entry is Bite with `index`
16, and a position of 0 would aim along Bright. Only for the six asked in
order are position and index the same.

### The directions

Each of the twelve is a direction of its own over φ’s coordinates, normalized
like the six:

| Family | Control | Low · high | Weights before normalizing | What it means in φ |
|---|---|---|---|---|
| Tone | Bright | dark · bright | `centroid_mean` $+1$, `rolloff_mean` $+1$ | The six, above |
| Tone | Warmth | cold · warm | `bass_fraction` $+1$, `high_ratio` $-1$ | Weight low down and a soft upper register: the highest note comes through quieter than the held one, as under a low-pass that does not follow the keys |
| Tone | Air | closed · airy | `zcr_mean` $+1$, `rolloff_mean` $+\tfrac12$, `centroid_mean` $-\tfrac12$ | The very top, above the notes: the highest partials and any breath, and the rolloff, measured against the centroid, so the top opens while the body of the sound stays |
| Weight | Body | thin · full | `bass_fraction` $+1$ | The six |
| Weight | Thump | light · thumping | `bass_fraction` $+1$, `crest` $+1$ | Weight low down that hits |
| Weight | Heft | slight · heavy | `rms_mean` $+1$, `bass_fraction` $+1$ | Dense, held weight: frames full of level (which loudness normalization gives a sustained, low sound, since K-weighting counts the lows for less) and weight low down |
| Dynamics | Snap | bloom · snap | `attack_s` $-1$, `crest` $+1$ | The six |
| Dynamics | Punch | gentle · punchy | `crest` $+1$, `rms_std` $+1$ | The size of the hit against the rest: peaks, and a level that moves over the phrase |
| Dynamics | Round | hard · round | `attack_s` $+1$, `rolloff_mean` $-1$ | A soft attack and few harmonics, the voice’s *round* |
| Movement | Motion | still · restless | `held_centroid_std`, `motion_slow`, `motion_mid`, `motion_fast`, each $+1$ | The six |
| Movement | Throb | steady · throbbing | `motion_mid` $+1$ | Pulsing and tremolo: the held note’s motion at 2–8 Hz alone |
| Movement | Sway | fixed · swaying | `motion_slow` $+1$ | Sweeps and breathing: the held note’s motion at 0.5–2 Hz alone |
| Space | Space | close · far | `tail_ratio` $+1$ | The six |
| Space | Distance | near · distant | `tail_ratio` $+1$, `attack_s` $+\tfrac12$, `crest` $-\tfrac12$, `rolloff_mean` $-\tfrac12$ | What distance does to a sound: a longer tail, a softer attack, smaller peaks and a duller top |
| Space | Haze | clear · hazy | `tail_ratio` $+1$, `motion_fast` $+1$, `crest` $-1$ | A wash: a tail, a shimmer (the 8–30 Hz beating that detune and chorus give) and peaks smoothed away |
| Character | Grit | smooth · rough | `flatness_mean` $+1$ | The six |
| Character | Bite | mild · biting | `flux_mean` $+1$, `zcr_mean` $+1$ | An edge: the spectrum changing fast, and high partials (a filter that snaps open, a resonance that rings) |
| Character | Lo-fi | clean · worn | `flatness_mean` $+1$, `rolloff_mean` $-1$, `motion_fast` $+1$ | Worn like tape: hiss, a dull top and flutter |

Three things φ lacks shaped these. It has no low-mid band, so Warmth is not
quite the voice’s *warm*, “weight in the low middle, a soft top”. It measures
weight low down (`bass_fraction`, below about 250 Hz) against a soft top of
the keyboard (−`high_ratio`: the highest note quieter than the held one).
That is close to the word, and not exactly it: a sound can gain low-middle
warmth that this does not see, and lose some that it does not count.
Defined with the spectrum’s top instead (`rolloff_mean` down with
`bass_fraction` up), it moved with Body across the sounds ($r = 0.92$), and
on 28 of the 40 presets where both it and Bright reached it was Bright’s
gesture, which is why it reads the keyboard’s top and not the spectrum’s.
φ has no bit-depth or bandwidth feature, so a crusher reaches Lo-fi only
through the flatness it adds. And its only space coordinate is `tail_ratio`,
which the amp release sets (a reverb’s tail is cut at note-off), so Distance
and Haze lean on what else distance and a wash do to a sound.

### Two names for one control

The approved prototype (`docs/notes/vision-2026-09/prototype/perform.js`)
defined the twelve as blends of the six. Five pairs of those blends were one
direction, $\lvert\cos\rvert \ge 0.9$: Air and Bright ($+0.94$), Softness and
Snap ($-0.94$, Snap turned down), Wobble and Motion ($+0.99$), Distance and
Space ($+0.92$), and Warmth and Air ($-0.94$). Punch was $+0.89$ to Snap. That is
why each of the twelve above is its own direction. Redundancy was then measured
three ways over the eighteen, on the presets and the shipped engine’s pool:

- **The directions themselves**, $\hat e_i^\top \hat e_j$: no pair reaches
  $0.9$. The largest are Space and Distance ($+0.76$) and Body with each of
  Warmth, Thump and Heft ($+0.71$).
- **The sounds’ positions** along them, correlated over the 62 presets and the
  pool of 40: no pair reaches $0.9$. The closest are Motion and Throb ($+0.88$),
  Snap and Distance ($-0.87$), Motion and Sway ($+0.85$) and Throb and Sway
  ($+0.83$): a sound that moves tends to move in every band, and a distant one
  tends to have a slow attack.
- **The wirings**: over the presets where both reach alone, how often their
  predicted movements are one gesture ($\lvert\cos\rvert > 0.8$, what
  `separate` checks). Only Space and Distance do on more than half (9 of 14):
  where a patch can reach Space at all, it is through the release, and Distance
  turns it too. A first Heft that also carried $-$`crest` was Thump turned down
  on two presets in three (both turned the amp envelope, opposite ways), and was
  changed to the definition above.

### How often each reaches

Each control wired on each of the 62 presets, on the engine the shipped
wirings are measured under. **Alone** is the control wired by itself: whether
this patch has knobs that move it, purely and verifiably. **Beside the six** is
the control wired after the six, so a control whose gesture on a patch is one
of theirs ($\lvert\cos\rvert > 0.8$) is a search control there: whether it
adds a gesture the panel does not have. **Both halves** is both directions
open after verification.

| Family | Control | Alone | Beside the six | Both halves | Median purity | Median reach (σ) |
|---|---|---|---|---|---|---|
| Tone | Bright | 79% | 79% | 74% | 0.81 | 1.64 |
| Tone | Warmth | 73% | 52% | 26% | 0.70 | 0.57 |
| Tone | Air | 66% | 48% | 35% | 0.60 | 0.47 |
| Weight | Body | 53% | 32% | 21% | 0.54 | 0.68 |
| Weight | Thump | 81% | 40% | 27% | 0.70 | 1.55 |
| Weight | Heft | 76% | 52% | 19% | 0.65 | 0.77 |
| Dynamics | Snap | 82% | 82% | 32% | 0.99 | 1.56 |
| Dynamics | Punch | 73% | 60% | 15% | 0.89 | 0.92 |
| Dynamics | Round | 82% | 44% | 34% | 0.74 | 1.18 |
| Movement | Motion | 77% | 74% | 26% | 0.98 | 1.91 |
| Movement | Throb | 47% | 29% | 6% | 0.75 | 1.80 |
| Movement | Sway | 55% | 34% | 5% | 0.94 | 2.67 |
| Space | Space | 23% | 23% | 3% | 0.98 | 2.18 |
| Space | Distance | 94% | 39% | 32% | 0.55 | 1.16 |
| Space | Haze | 90% | 63% | 35% | 0.69 | 1.49 |
| Character | Grit | 11% | 6% | 11% | 0.58 | 0.29 |
| Character | Bite | 81% | 58% | 37% | 0.73 | 0.72 |
| Character | Lo-fi | 56% | 34% | 23% | 0.56 | 0.91 |

Purity and reach are medians over the presets the control reaches alone. For
the six, “beside the six” is the panel as it is today: Body and Grit lose
patches to the gestures of the controls wired before them. Alone, a median
preset is reached by 12 of the eighteen (5 at least, 16 at most), against 3 of
the six.

Read the table with one caution. Purity measures cross-talk against the named
axes, not whether a control moved every coordinate it names, so a direction is
reached through whichever of its coordinates the knobs move. On a patch where
nothing moves the flatness, Lo-fi is reached by a duller top and flutter, and
Distance (94%) by a softer attack and a duller top, since few patches can move
their tail (Space reaches 23%). Throb and Sway rarely open both halves: a sound
that is still cannot be made stiller.

### What it costs

A measurement is $n + 1$ renders for the Jacobian, shared by every control,
then four per reachable control and two more for each retry. Wiring eighteen
instead of six multiplies only the arithmetic (the solve per control takes
microseconds) and the verification renders.

| Per preset | Renders, median | Mean | Most | Native s, mean | wasm s, mean |
|---|---|---|---|---|---|
| The Jacobian alone | 12 | 12.1 | 23 | | |
| The six, today | 25 | 26.2 | 42 | 5.9 | 7.5 |
| All eighteen | 49 | 49.8 | 84 | 11.2 | 14.2 |

The render counts are over all 62 presets (`palette_census`). The native times
are from the same run, three presets at a time on an Apple M3 Max shared with
other work, at 224 ms a render (173 ms in a quieter run). The wasm times are
`palette_cost.mjs` under node, on one thread as the engine worker has, over
every fourth preset (16), at 265 ms a render. That run boots its own pool from
the same seed, and in wasm the pool comes out differently from the native one,
so its counts differ a little per preset (median 28 renders for the six, 60 for
the eighteen).

A control that reaches costs about five verification renders: 4.7 for the six,
and 5.0 for the eighteen wired in palette order, where 7.5 controls reach a
preset on average. So the eighteen double today’s measurement. The panel never
needs all eighteen. To keep within today’s budget:

1. **Wire all eighteen by prediction** from the one Jacobian the six already
   pay for. That is arithmetic, and enough for each palette entry to preview
   what it would do, drawn as a guess
   ([ADR-012](https://github.com/alexnodeland/auracle/blob/main/docs/decisions/012-motion-shows-what-the-engine-does.md)):
   verification closes some predicted reaches (Throb predicted on 71% of
   presets alone, verified on 47%).
2. **Verify only the placed controls**, at most eight. A panel of the six and
   two of the twelve adds one or two controls that reach (the twelve reach a
   mean 46% of presets beside the six, 73% alone), so five to seven renders,
   a fifth to a quarter more than today’s measurement.
3. **Verify a control placed later from the memo:** the Jacobian is already
   there, so it costs only its own four renders, and two more if it is
   retried at half travel.

The app does the second and the third: it measures the panel’s set and
nothing off the panel, on the sound in hand, when PERFORM is in sight
(`measurePanel` in `perform.js`), and the engine’s memo holds the Jacobian
from the six’s measurement. The first, a preview of every palette entry by
prediction, is not built (below).

The shipped preset wirings stay the six’s. With the twelve’s wirings beside
them, `apps/web/perform-wirings.json` would weigh 391,740 bytes instead of
173,171 (2.3 times), fetched by every visitor for controls the panel does not
show yet.

### Names

Three of the prototype’s names are changed, and the maintainer approved them
with Heft and the end words below on 2026-10-01
([voice](https://github.com/alexnodeland/auracle/blob/main/www/brand/voice.md)):

- **Round** (hard · round) for Softness (hard · soft): the voice’s word table
  already defines *round* as “a soft attack, few harmonics”, which is this
  direction.
- **Throb** (steady · throbbing) for Wobble: Wobble Board is a preset, and a
  control of the same name reads as that sound. *Throb* is the tremolo module’s
  own tag. Pulse was the other candidate, and it is a wave shape.
- **Sway** (fixed · swaying) for Drift: *drift* is already WANDER’s zone and
  the walk behind it (`Engine::drift`). Breath would read as Air’s breathiness,
  and Sweep Machine is a preset.

Heft (slight · heavy), the twelfth, is new. The four have their rows in the
voice’s word table.

## Drift: a local walk on the live knobs

`Engine::drift` samples the same [target](./target.md)

$$\pi_\beta(x) \;\propto\; p_{\text{grammar}}(x)\,\exp\!\big(\beta\,\E[u_\theta(\varphi(x))]\big),$$

restricted to this patch’s shape: every structural and categorical address,
every continuous site without a live handle, and the player’s own locks are
held fixed; the walk moves only `live_knobs`. Holding sites fixed in a Metropolis–Hastings walk is
exact conditioning ([Locks as conditional refinement](./locks.md)), so the walk
targets $\pi_\beta(v \mid x_{\mathcal{L}})$ over the knobs the voices can take
live. Structure cannot change under the player’s hands, and nothing the walk
moves needs a recompile to be heard.

The kernel is **not** refinement’s. Each step picks one free knob uniformly and
proposes

$$
v' \;=\; \operatorname{reflect}_{[0,1)}\!\big(v + \sigma\,\xi\big), \qquad \xi \sim \mathcal N(0, 1),
$$

accepted with probability $\min\!\big(1,\ \pi_\beta(x')/\pi_\beta(x)\big)$. The
reflected Gaussian is symmetric, so there is no Hastings correction
(`Engine::local_walk`). Refinement’s kernel, fugue’s adaptive single-site MH,
starts every fresh chain with a wide proposal on a unit-interval knob: measured
over 12 presets, an 8-step “drift” moved some knob by 0.3–0.85 of its range. A
drift should wander, and how far is the Wander dial’s to say.

| Wander | Steps | $\sigma$ | Farthest knob moved (12 presets) |
|---|---|---|---|
| drift, at its start | 8 | 0.05 | 0.06–0.14 |
| drift, at its top | 18 | 0.08 | 0.15–0.33 |
| roam, at its top | 40 | 0.15 | 0.25–0.61 |

(`cargo run -p auracle-session --example drift_distance --release`.) Within
each zone the pace rises linearly with the dial (`wanderPace`, in
`perform.js`); roam starts at 24 steps and $\sigma = 0.10$. The walk
returns its end state, or nothing if it ends where it started. Like
refinement, a short walk’s end state is local movement *on* $\pi_\beta$, not a
draw *from* it ([What is not sampled](./target.md#what-is-not-sampled-from-this)).
Nothing enters the pool: a performance gesture is not a candidate until the
player keeps it.

**The wiring survives a small drift.** The named controls are a linear model
measured with 0.08 knob steps, so the instrument re-measures them only when
some knob has left a 0.12 neighborhood of where they were measured (`TRUST`,
in `perform.js`). A gentle
drift usually stays inside and costs nothing; before, every glide was followed
by a full re-measure of about 46 renders, which in *drift* kept the worker busy
much of the time and queued offers behind it.

The instrument then glides the knobs from where they are to the returned values
along a smoothstep, $v(t) = v_0 + (v_1 - v_0)(3u^2 - 2u^3)$, over 2 to 6
seconds. The intermediate states are interpolations, not states of the walk.
They are all valid patches, since the structure is fixed and the knob box is
convex. A touch stops the glide where it is.

## Offers

`Engine::offer` is the same walk with only the player’s locks, so structural
moves are allowed: it may add, remove, or replace a module. It is also
non-inserting. The instrument asks for 20 steps (40 in *roam*) and plays the
result in the B slot, never as a jump. The Offer pad and Wander ask for this
walk. A [search control](#wiring-ridge-support-re-solve) released more than
$0.3$ from its center (`ASK_AT`, in `perform.js`) asks for an aimed one
(below), and springs back without moving a knob.

### A search control’s offer is aimed

`Engine::offer_toward` walks the same kernel on the target tilted along the
control’s direction $\hat e$, turned up ($s = +1$) or down ($s = -1$):

$$
\pi_{\gamma}(x) \;\propto\; p_{\text{grammar}}(x)\,
\exp\!\Big(\beta\,\big(f(x) + \gamma\, s\, \hat e^\top z(x)\big)\Big),
$$

where $f$ is the taste surrogate $\E[u_\theta(\varphi(x))]$, or
`VetOnlyFitness` before any fit, and $\gamma$ is `AIM_GAMMA` $= 1$. At
$\beta = 2$, a proposal one σ further the asked way gains as much log-weight as
one unit more of expected utility. `TiltedFitness` reads $z$ from the memo
entry the inner fitness has just written, so the tilt costs no render, and a
proposal that does not vet keeps its quarantine score untilted.

Twenty single-site steps rarely propose the one module that makes a patch
rough (a noise source, a crusher), and the tilt cannot make a proposal the
kernel never draws. So a walk that has not moved at least `REACH_FLOOR` the
asked way,

$$
s\,\hat e^\top\big(z(x_{\text{end}}) - z(x_0)\big) \;<\; 0.15,
$$

keeps walking from the state it stopped in, up to `AIM_WALKS` $= 3$ walks of
the asked steps. It is one longer chain that stops as soon as it has arrived,
not a filter: nothing grown is thrown away, which is what the rejected
alternative (grow several undirected offers and keep the one that moved most)
would have done.

The reply carries `moved` $= \hat e^\top\big(z(\text{offer}) - z(\text{home})\big)$
(`Engine::moved_along`), and B’s strip prints $s \cdot$ `moved` in amber:
*grittier by 1.8σ*. Below half of `REACH_FLOOR` (`AIM_SAID`, in `perform.js`:
the line a verified half must clear to be said to turn that way), it says the
walk did not get there, *not grittier: this walk found no way there*, and
invites another turn.

**The census.** $\gamma$ and the walk count were chosen by
`make offer-census` (`offer_census`): 16 presets (every third in the bank),
every control PERFORM draws as a search control on each (verified, as the app
wires them: Grit on 14, Body on 14, Space on 12, and a few of the rest), turned
both ways, two seeded offers of 20 steps a walk per arm, the same seeds in
every arm so the arms are paired and $0{\times}1$ is the Offer pad’s walk
itself. The session is a filled pool (its standardizer) with a taste taught by
the synthetic listener `search_health` climbs toward, which dislikes noise; the
prior rows are the same session before any fit. A move counts when it is at
least `REACH_FLOOR` the asked way; $R^\ast = 0.95$σ is the median verified
reach of a control that does reach, on the same presets.

| $\gamma \times$ walks | ≥ floor, taught | ≥ $R^\ast$, taught | median $\Delta\E[u]$, taught | ≥ floor, prior | Grit up ≥ floor, taught / prior |
|---|---|---|---|---|---|
| $0 \times 1$ (Offer pad) | 22% | 13% | +0.92 | 23% | 7% / 14% |
| $0.5 \times 1$ | 26% | 16% | +0.84 | 31% | 14% / 35% |
| $1 \times 1$ | 34% | 23% | +0.74 | 35% | 17% / 35% |
| $2 \times 1$ | 39% | 22% | +0.63 | 36% | 25% / 32% |
| $4 \times 1$ | 40% | 23% | +0.62 | 38% | 32% / 32% |
| $0 \times 3$ | 32% | 18% | +1.72 | 41% | 17% / 32% |
| **$1 \times 3$ (shipped)** | **46%** | **28%** | **+1.33** | **53%** | **46% / 64%** |
| $2 \times 3$ | 48% | 28% | +1.18 | 54% | 50% / 71% |

(192 offers per arm. $\Delta\E[u]$ is the offer’s expected utility less the
patch it grew from; the pool’s spread of $\E[u]$ is 0.72.)

Reading it: the tilt buys most of what it can by $\gamma = 1$. Past that,
more aim buys a few points of the floor, none of $R^\ast$, and a lower
$\E[u]$, so 1 is the smallest $\gamma$ at which the curve has flattened. The walks do more than the tilt for
the control that needs them most. Grit turned up went from 7% (Offer pad) to
17% with the tilt alone and 46% with three walks, after a taste that dislikes
noise, and from 14% to 64% before any fit. Continuing without the tilt
($0 \times 3$) does less than continuing with it (32% and 41% of all asks,
against 46% and 53%). The taste cost is bounded: every arm’s median offer
still climbs $\E[u]$.

Some asks have nowhere to go, and no $\gamma$ changes that: **Grit down** and
**Space down** moved in none of 28 and 24 trials, because a patch with no
noise sits at the floor of flatness and one with no tail at the floor of
`tail_ratio`. B says *not smoother* then, which is the truth. **Space up**
reaches 29–45%; the instrument asks for it only when the release graft did
not reach.

**What it costs in time.** The tilt costs no render; the extra walks do.
Timed natively on a shared four-core machine (`offer_census --timed`, each
offer from a fresh memo holding only the patch it grew from, as in the app),
one tilted walk took 5.1 s on average against 5.1 s for the untilted one, and
the shipped offer, which walks again only when it has not arrived, 15.6 s
against 6.0 s for the Offer pad’s. The instrument counts the seconds in B
while it grows. Growing it on the render farm, and starting both ways at
pointer-down, would take the wait off the player’s hands; that belongs to
the farm’s walk path and is not built here.

**Whether it holds the engine.** It does not. A walk is a chain of steps, and
a step costs at most one phrase render (about 0.15 s natively, 0.3 s in wasm
under node on the machine this was timed on, `offer_cost`), so the engine
worker runs an offer or a drift one step at a time and answers the player’s
picks, Keeps and plays between steps. An offer you did not ask for (the spare
grown while you play) gives way to one you did. Cutting a walk up does not
change what it finds: for a seed, the offer is the same tree whatever the step
sizes (the walk is the same code, run in pieces), and what you do between
steps does not move it, because it keeps the target it began on and draws
from a generator of its own.

## Before any evidence: `VetOnlyFitness`

With no posterior there is no utility to climb, and the first version of
PERFORM returned nothing for drift and offers until the player had made picks.
But the posterior before any evidence is not undefined. It is the prior.

With a zero-mean prior on $\theta$ and a single style, the prior expectation of
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
(`Engine::has_taste`), and the instrument says which: the line under Wander
reads *drift · gliding · no taste yet* while a grammar-drawn drift glides, and
*drift · gliding* once there is a taste to walk toward. Wiring the named
controls needs no taste at all, only a standardizer.

## The B slot

An offer is heard through a second `LivePoly` in the same AudioWorklet. It
receives every note-on, note-off, bend, glide, unison, and arpeggiator message
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

B is **loudness-matched**. Its makeup gain is the one
[loudness normalization](../audition/loudness.md) computes for the offer,
`TARGET_LUFS` minus the phrase’s measured `lufs_before`, so the offer’s standard
phrase plays at −18 LUFS. The gain is clamped only to the range the voice
accepts (`MAKEUP_MIN_DB` to
`MAKEUP_MAX_DB`, −24 to +60 dB, in `auracle-wasm`’s `live.rs`). It is the same
makeup every live patch gets (`live_makeup`, in `level.rs`). It used to be
clamped to ±12 dB, which left 43% of a fresh pool outside the clamp; a leveler
on the summed polyphony now catches a held note that grows louder than the
phrase predicted. Without the match a crossfade would mostly compare levels,
and the louder side reliably wins. The match is made on the standard phrase at each patch’s own
settings; a named control turned on A afterward changes A’s level without
re-normalizing it.

## What is not done

- **An aimed offer is aimed at a direction, not at a sound.** A search
  control’s offer tilts the target along $\hat e$ (above); it does not aim at a
  reference sound. Breeding a generation toward a recording is
  [a sound of your own](../features/own-sound.md#breeding-toward-it), which
  the engine has and PERFORM's offers do not use. Nor is the aim itself tuned per patch or per player:
  repeated turns the same way do not ask harder, and Wander’s offers are not
  aimed at the last control turned (RFC-002’s open questions).
- **The palette doesn’t preview.** A palette entry not on the panel is not
  measured, so the palette shows nothing of what it would do to this sound.
  The preview by prediction from the Jacobian (the first of the budget’s three
  points, above) needs the unverified wiring (`wire_set`) exposed to the page,
  and is not built. The twelve have no
  [grafts](#the-measurements-and-what-reproduces-them) yet, so a search control
  among them asks for an aimed offer only. The shipped preset wirings are the
  six’s, so a preset opened with a palette control on the panel plays the six
  at once and measures the rest.
- **The directions are fixed, not personal.** The eighteen are the same for
  every player. A control along a fitted style $\theta_k$ is [a different and
  more interesting
  object](../design/audition-limits.md#8-six-fixed-controls-when-the-personal-axis-is-already-fitted),
  and not this one.
- **Most of what the player does here is logged, not fitted.** Keep, Back,
  Take, each offer asked for, and each control turn are recorded as
  `ImplicitEvent`s (`perform_keep`, `perform_back`, `perform_take`,
  `perform_offer`, `perform_turn`), and none of those events enters the
  likelihood. A Keep can mean *I love this* or *stop drifting for a moment*,
  and [implicit
  signals](../taste/likelihoods.md#implicit-signals-are-logged-not-modeled)
  stay out of the model until a fit using them can be validated against the
  explicit ones. The exception is an offer’s answer: once B has been heard for
  a second (`HEARD_MS`, in `perform.js`), Take, or asking for another offer, is
  recorded as a duel with the `PerformOffer`
  [provenance](../taste/likelihoods.md#edit-beats-original), and it counts as a
  pick.
- **Combinations are not verified.** Each control is verified alone, at $v_0$.
- **Motion hears one note.** Its axis is built from the held note’s span, with
  the [limits](../features/audio.md#what-it-cannot-say) that implies.
