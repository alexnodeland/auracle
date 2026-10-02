# A sound of your own

<p class="lede">A recording you bring is measured the way a patch is, on the part of
φ a recording can measure. It takes a place among the sounds, its nearest are
named, and a generation can be bred toward it.</p>

This is the engine and the worker's side of Plan-005 task 11. The app does not
offer it yet: the card that takes a dropped file is still to be built.

## A recording is not the phrase

Every patch is measured on the [standard phrase](../audition/phrase.md): a held
C4, a C5 stab, a dyad and a low C3 with a release window, with rests between
them. Each coordinate of [φ](./audio.md) is a statistic of that render. A
recording is one sound of something else entirely, with no notes the engine
knows of. So a coordinate means the same thing on a file only if it does not
depend on what the phrase plays.

That was measured, not argued. `examples/file_phi.rs` (in `auracle-features`)
renders every preset on three stimuli that are not the phrase (a legato melody
with no rests, a drone, short stabs over two octaves), measures each render as
a file, and compares the result with the same preset's φ on the phrase. The
preset is the truth: a file of that patch should land where the patch does. A
coordinate counts as measured by a file when, on every stimulus, its
correlation with the phrase value across the presets is at least `SURVIVES_R`
$= 0.9$ and its root-mean-square difference is at most `SURVIVES_RMSE` $= 0.5$σ
of the presets' spread on the phrase (two presets drawn at random differ by
about 1.4σ). Every σ in this table is that one: the presets' spread, not a
session's. Run it with `cargo run -p auracle-features --example file_phi
--release`; it also prints each coordinate's bias.

| Coordinate | melody r / rmse | drone r / rmse | stabs r / rmse | Measured |
| --- | --- | --- | --- | --- |
| `centroid_mean` | 1.00 / 0.17 | 0.98 / 0.23 | 0.98 / 0.22 | yes |
| `rolloff_mean` | 0.99 / 0.18 | 0.98 / 0.25 | 0.99 / 0.19 | yes |
| `flatness_mean` | 1.00 / 0.03 | 1.00 / 0.04 | 1.00 / 0.05 | yes |
| `zcr_mean` | 0.98 / 0.41 | 0.99 / 0.33 | 0.95 / 0.33 | yes |
| `bass_fraction` | 0.98 / 0.20 | 0.96 / 0.43 | 0.93 / 0.39 | yes |
| `centroid_std` | 0.94 / 0.43 | 0.84 / 0.93 | 0.90 / 0.49 | no |
| `flux_mean` | 0.93 / 0.42 | 0.60 / 0.73 | 0.72 / 1.61 | no |
| `rms_mean` | 0.88 / 0.93 | 0.79 / 0.93 | 0.81 / 0.58 | no |
| `rms_std` | 0.13 / 1.82 | 0.31 / 2.08 | 0.67 / 1.78 | no |
| `crest` | 0.90 / 0.92 | 0.83 / 0.96 | 0.84 / 0.64 | no |
| `attack_s` | 0.64 / 0.95 | 0.99 / 0.14 | 0.47 / 1.21 | no |
| `tail_ratio` | 0.11 / 2.99 | 0.19 / 2.98 | 0.12 / 3.34 | no |

62 presets on the phrase; 62, 56 and 62 measured as files (six presets fade
below the trim before half a second of drone has passed).

The measured coordinates are not unbiased. A file reads a little brighter than
its preset does on the phrase: `zcr_mean` by +0.35σ on the melody and +0.30σ
on the drone, `centroid_mean` and `rolloff_mean` by +0.09 to +0.17σ. Within the
bar, so they are measured; but a recording sits a shade brighter among the
sounds than the patch that made it would, and its nearest sounds lean that way.

A one-shot shorter than the half second a file must hold does not measure them
all: with a single G4 of 0.25 s added to the stimuli, `zcr_mean` (0.55σ) and
`bass_fraction` (0.62σ) miss the bar, and they still miss at 0.5 s (0.54σ,
0.61σ). One short note at one pitch says too little about weight and
brightness, which is why `FILE_MIN_SECONDS` stays at 0.5 s.

What a file measures is its **spectral balance**: how bright it is
(`centroid_mean`, `rolloff_mean`, `zcr_mean`), how noisy (`flatness_mean`) and
how much weight it has below 250 Hz (`bass_fraction`). Those depend on what the
sound is. The rest depend as well on what was played:

- **Level and dynamics** (`rms_mean`, `rms_std`, `crest`) carry the phrase's
  four rests and its release window, and a recording has neither.
- **Movement** (`centroid_std`, `flux_mean`) over the whole phrase is mostly
  its jumps between registers, and a file's is whatever it plays.
- **The attack** is the phrase's held C4 arriving, and a file's first event is
  something else.
- **The tail** is the phrase's release window; a trimmed file's last 300 ms are
  wherever the sound stopped.
- **The six role coordinates** (`held_centroid_std`, `high_ratio`,
  `chord_flatness_delta` and the three motion bands) each read one note of the
  phrase by its role, and a file has no such note.
- **Every structural coordinate** describes a patch, and a recording has none.

So a file is placed by 5 of φ's 44 coordinates. The other 39 are **masked**
(`FILE_MASKED` and the structural half; `file_observed()` is the whole mask).
A gate test re-measures half the presets on every build and fails when the
mask and the measurement disagree.

## How a file is measured

`featurize_file` takes what the page decoded, mixed to mono, at its own rate,
and measures it as [`featurize`](../audition/loudness.md) measures a render:

1. **Bounds.** A rate from 8 to 192 kHz, at most `FILE_INPUT_MAX_SECONDS`
   $= 120$ s in, every sample finite. A refusal is a flag the app words
   (`bad_rate`, `too_long`, `too_short`, `non_finite`, `silent`), never text.
2. **Trim.** The sound runs from the first 10 ms window within `TRIM_DB`
   $= 60$ dB of the loudest to the end of the last one. Silence inside the
   recording is kept; it is part of the sound.
3. **Cut.** At most `FILE_MAX_SECONDS` $= 30$ s of sound, from where it starts,
   and at least `FILE_MIN_SECONDS` $= 0.5$ s.
4. **Resample** to the phrase's 44.1 kHz with a windowed sinc (16 zero
   crossings, Blackman window, cut at 0.97 of the lower Nyquist). Every
   frequency coordinate is normalized at Nyquist, so this is what puts a 48 kHz
   file's brightness on the same axis as a render's. A file already at
   44.1 kHz is not touched.
5. **Normalize** to `TARGET_LUFS` $= -18$ under the same peak ceiling, as
   [loudness normalization](../audition/loudness.md) does for every render.
6. **Measure** with the same `audio_features` a render goes through. Nothing in
   it changes for a file. Its first-note window is the phrase's own (onset to
   the second onset, 2.0 s), and its role coordinates find no note and read
   their "no evidence" values, which the mask then ignores.

Measuring a render's φ is unchanged by any of this: no coordinate, constant or
step of `featurize` moved.

### What the page sends

The page decodes the file, mixes it to mono, cuts it to 120 s and resamples
anything above 48 kHz down to 48 kHz before it posts it. The engine measures at
most the first 30 s of sound, and the samples are copied into the engine's
memory, which wasm never gives back: two minutes grow it by about 42 MB at
48 kHz and 108 MB at 192 kHz. The analysis is one call the worker cannot
interrupt; for 30 s of sound it takes 0.16 s at 44.1 kHz, 0.31 s at 48, 0.52 s
at 96 and 0.94 s at 192 (`auracle-wasm`'s `examples/own_cost.mjs`, wasm under
node on an M3 Max), most of it resampling.

What each refusal asks of the card:

- `too_long`: more than 120 s reached the engine. Cut it and send it again.
- `too_short`: under half a second of sound once trimmed. Nothing to retry; the
  card says the sound is too short to place.
- `silent`, `non_finite`, `bad_rate`: nothing in it can be measured.
- After any refusal the sound brought before is still the session's: the card
  asks `own_sound` to redraw it.

## Missing coordinates

What a masked coordinate becomes depends on what reads the sound, and none of
it claims to know the coordinate's value:

- **Distances leave them out.** The nearest sounds are ranked by Euclidean
  distance in standardized φ over the five measured coordinates. Filling a
  masked coordinate with the pool's mean would pull every distance toward the
  center of the pool and call the most ordinary patch the nearest.
- **The tilt has no factor for them**, which is the same as integrating them
  out (below).
- **Anything linear reads them at the mean**, where they add exactly nothing.
  The map's projection is one such reading (below). A utility $\theta^\top z$
  would be another, and the observation log already puts a coordinate an old
  vote lacks at the standardizer's mean for the same reason: zero
  contribution, exactly "no evidence". Nothing reads the sound's utility
  today.

## Its place among the sounds

The sound's $z$ is its raw φ standardized by the session's
[standardizer](./standardization.md), the same scale every pool member's is on,
over the five coordinates it has.

**Its nearest sounds** (`Engine::own_nearest`, `Engine::own_nearest_presets`)
are ranked by

$$d(x) \;=\; \Big(\sum_{j \in O} \big(z_j(x) - z^*_j\big)^2\Big)^{1/2},$$

where $O$ is the set of measured coordinates and $z^*$ the file's. TASTE's map
is a projection of this same Euclidean space (PCA over standardized φ), so near
means what the map draws as near, without the projection's loss. The app had no
nearest sounds before this, so there was no other metric to match. The presets
are ranked from the measurements the app already ships
(`perform-wirings.json`, regenerated by `make perform-wirings`), back to raw φ
and standardized by this session's scale: no preset is rendered.

**Its place on the map** (`TasteMap::own`) is the map's own projection of the
five measured coordinates, on the map's axes $a_1, a_2$ about its center $\mu$:

$$x \;=\; \sum_{j \in O} a_{1j}\,(z^*_j - \mu_j), \qquad
y \;=\; \sum_{j \in O} a_{2j}\,(z^*_j - \mu_j),$$

which is every other point's projection with each masked coordinate at the
map's mean. The sound is placed on the map; it is not one of the points the
axes are fitted to, so bringing a sound does not move the map.

That was chosen by measurement, in `examples/own_census.rs` (in
`auracle-session`). Each target preset is put into a taught pool, so the map
draws it, and its recording is placed. Error is the distance to the preset's
own point, as a share of the map's spread (the RMS distance of its points from
the center), over 18 placements (3 sessions × 6 presets):

| Placed by | Error |
| --- | --- |
| The projection above (`Placement::Imputed`, used) | 0.37 ± 0.05 |
| Probabilistic PCA's posterior mean for a partly observed point (`Placement::Fit`) | 0.41 ± 0.04 |
| The centroid of its three nearest pool members (the prototype's way) | 0.53 ± 0.07 |
| The projection, from the preset's phrase φ on the same five coordinates | 0.36 ± 0.05 |

The posterior mean, $\big(A_O^\top A_O + \sigma^2 \Lambda^{-1}\big)^{-1}
A_O^\top (z^*_O - \mu_O)$ with $A = [a_1\ a_2]$, the axes' variances
$\Lambda$ and the variance $\sigma^2$ they leave unexplained, shrinks a point
measured on few coordinates toward the center; here that cost more than it
saved. The last row says where the error comes from: a recording costs almost
nothing over the phrase on the same coordinates, and the mask is what costs.
Five coordinates put a sound within about a third of the map's spread of where
its whole φ would, which is what the prototype's card means by "placed by its
spectrum".

## Breeding toward it

`Engine::refine_toward_jobs` opens a generation exactly as
[EVOLVE POOL](../search/refinement.md) does, with two differences. Its parents
are the `refine_seeds` pool members nearest the sound, not the best ranked:
breeding toward a sound starts from what is already near it. And every walk
samples a target tilted toward the sound (`TowardFitness`):

$$
\pi(x) \;\propto\; p_{\text{grammar}}(x)\,
\exp\!\Big(\beta\,\big(f(x) - \min\big(\tfrac{\gamma}{2}\,d(x)^2,\; F\big)\big)\Big),
\qquad d(x)^2 = \sum_{j\in O}\big(z_j(x) - z^*_j\big)^2,
$$

where $f$ is the taste surrogate $\E[u_\theta(\varphi(x))]$, $\beta = 2$,
$\gamma$ is `OWN_GAMMA` $= 4$ and $F$ is `OWN_FLOOR` $= 25$.

Read as Bayes, this is the taste's own target times a Gaussian likelihood
$\mathcal N\big(z^*_O;\, z_O(x),\, \tau^2 I\big)$ with $\tau^2 = 1/(\beta\gamma)$:
the patches you would like, weighted by how well each explains the recording as
a measurement of its sound. A masked coordinate has no factor, which is that
likelihood integrated over it. At $\gamma = 4$, $\tau \approx 0.35$σ of the
session's spread. That is the same size as the error a recording makes on the
coordinates it measures (0.03 to 0.43σ in the table above), but those are σ of
the presets' spread, a different scale, so it is a choice of size made with
the census below, not a calibration of the file's error.

The floor is the likelihood of a contaminated measurement: the recording is the
patch's sound with noise $\tau$, or a sound this grammar does not make, and then
distance says nothing more. It is also what keeps the walk out of patches that
do not vet. A proposal that does not vet has no φ to measure, so it keeps its
quarantine score ($-50$) untilted; an unbounded pull would rank it above every
patch more than $\sqrt{100/\gamma} = 5$σ from the target, and a first census
without the floor saw strongly pulled walks end on one; with it, none did. Half the
quarantine's depth keeps every listenable patch above quarantine for any taste
above $-25$, and still pulls out to $\sqrt{2F/\gamma} \approx 3.5$σ.

The walk stays exact Metropolis–Hastings, as an
[aimed offer](../search/perform.md#a-search-controls-offer-is-aimed) does: the
kernel is untouched and the tilt is a deterministic function of the patch, so
every acceptance is the ratio of this target, and the state a walk ends on is a
draw from it. The tilt costs no render: the taste
surrogate has just featurized the proposal through the same memo. A proposal
that does not vet keeps its quarantine score. The target rides in the
generation's context (`WalkContext::toward`), so the render farm walks the same
tilted target the engine would. A generation without a target walks exactly as
before; at $\gamma = 0$ the tilted walk is the untilted one, bit for bit.

Children are admitted by the bar every generation's are: a child must please
the taste more than the member it would displace. So the engine breeds toward a
sound only after the first fit, as EVOLVE POOL does; before it, Breed toward it
adds the nearest presets (below).

### Measured

`examples/own_census.rs`: three sessions (a pool of 48 and a taste taught by a
synthetic listener over 60 duels), six target presets recorded on the melody,
five walks of 40 steps a target, every arm from the same job seeds, so the arms
are paired walk by walk. `cargo run -p auracle-session --example own_census
--release` reproduces these tables (its defaults are `3 6 1,2,4,8 5`), and its
`placement error` lines the placement table above. Distances are in σ of the
session's spread over the five measured coordinates, mean ±
standard error over 90 walks: to the recording's $z^*$ at the walk's start and
end, and at the end to the preset itself (its phrase φ on the same
coordinates), which is the truth the recording stands in for. $\Delta\E[u]$ is
the child's expected utility minus its parent's.

From the parents nearest the sound, which is what a breed toward it does:

| Arm | Start | End | Change | Ends nearer | $\Delta\E[u]$ | End to the preset |
| --- | --- | --- | --- | --- | --- | --- |
| untilted | 0.61 ± 0.04 | 2.55 ± 0.16 | +1.94 ± 0.16 | 7% | +0.86 ± 0.17 | 2.60 ± 0.16 |
| γ = 1 | 0.61 ± 0.04 | 0.88 ± 0.05 | +0.27 ± 0.05 | 33% | +0.55 ± 0.12 | 0.94 ± 0.05 |
| γ = 2 | 0.61 ± 0.04 | 0.67 ± 0.04 | +0.06 ± 0.04 | 48% | +0.32 ± 0.08 | 0.71 ± 0.03 |
| **γ = 4** | 0.61 ± 0.04 | **0.52 ± 0.03** | **−0.09 ± 0.03** | 59% | +0.36 ± 0.07 | 0.61 ± 0.03 |
| γ = 8 | 0.61 ± 0.04 | 0.43 ± 0.02 | −0.18 ± 0.03 | 71% | +0.25 ± 0.08 | 0.53 ± 0.02 |

From the taste's own parents (the best ranked, as EVOLVE POOL breeds from),
which says whether the pull works from farther away:

| Arm | Start | End | Change | Ends nearer | $\Delta\E[u]$ | End to the preset |
| --- | --- | --- | --- | --- | --- | --- |
| untilted | 2.18 ± 0.15 | 2.29 ± 0.14 | +0.12 ± 0.17 | 50% | +0.73 ± 0.41 | 2.38 ± 0.15 |
| γ = 1 | 2.18 ± 0.15 | 1.06 ± 0.07 | −1.12 ± 0.15 | 78% | +0.03 ± 0.17 | 1.16 ± 0.06 |
| γ = 2 | 2.18 ± 0.15 | 0.93 ± 0.06 | −1.25 ± 0.15 | 81% | −0.10 ± 0.17 | 1.01 ± 0.06 |
| **γ = 4** | 2.18 ± 0.15 | **0.79 ± 0.05** | **−1.38 ± 0.15** | 88% | −0.56 ± 0.10 | **0.84 ± 0.05** |
| γ = 8 | 2.18 ± 0.15 | 0.86 ± 0.09 | −1.32 ± 0.16 | 89% | −0.30 ± 0.25 | 0.94 ± 0.09 |

Tilted walks end nearer than untilted ones from the same jobs by 2.03 ± 0.16σ
from the nearest parents and 1.50 ± 0.15σ from the taste's (paired by walk,
γ = 4).
Untilted, a walk from the nearest parents wanders off the sound as it climbs the
taste; tilted, it stays near and still pleases the taste more than its parent.
From farther away the pull costs taste (−0.56 at γ = 4), which is the trade the
target states. γ = 4 is the smallest pull whose walks from the nearest parents
end nearer than they began, and from the taste's parents it ends nearest both
the recording and the preset: at 8 the floor leaves the farther walks unguided.
Of the 90 γ = 4 children from the nearest parents, absorbed into their
generations as the app would, 86 were admitted and 4 were not.

## What is not done, and what the card will do

The card is the app's half, still to be built: the worker answers
`own_sound_set`, `own_sound`, `own_sound_clear` and `refine` with
`toward: true`, and nothing sends them yet. Where the prototype shows what the
engine does not do, the maintainer decided the card's behavior (Plan-005 task
11):

- **In the bank, never in a pair.** The prototype lists the recording among
  the presets and plays it from there, and so will the card: the page keeps the
  decoded audio in IndexedDB, so it plays after a reload too. In the engine the
  sound has no tree, so it is never dealt in a pair, held as a patch or bred
  from; the session keeps only its measured coordinates, by name, because an
  autosave holding half a minute of samples would be megabytes the engine
  never reads.
- **Before the first fit, Breed toward it adds the nearest presets**, as the
  prototype does: `own_nearest_presets` names them and `load_preset` adds them,
  with no taste needed. After the first fit it breeds the tilted generation
  above.
- **The children grow from their parents**, the pool members nearest the
  sound, leaning toward the recording; the prototype's buds from the dropped
  face would show a fact the engine does not record
  ([ADR-012](https://github.com/alexnodeland/auracle/blob/main/docs/decisions/012-motion-shows-what-the-engine-does.md)).
- **Hold it** plays the recording through the named controls once audio in is
  live (Plan-007), the UI stream's work.
- **Nearest, and the map, are of other sounds.** The prototype ranks presets
  by its 40-band face and places the recording on a map of the 62 presets.
  The engine ranks pool members and presets, separately, over the five
  coordinates, and places it on TASTE's map of the pool and what you have
  heard. The face itself is the page's to draw from the decoded file, as for
  any render.

Not done in the engine:

- **More of φ.** Five coordinates are what a recording measures under today's
  φ. A recording's movement, attack and tail would need coordinates defined
  without the phrase's notes, which is a change to φ and owes a revalidation.
  A change to φ also owes a re-measure of the mask: the gate test fails until
  `FILE_MASKED` agrees with `file_phi` again.
