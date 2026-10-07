# Faces

<p class="lede">A face is a picture of a render: its spectrum in bands and
slices of time, compared with the bank. It is not a feature. Nothing in
$\varphi$, the taste model or the vetting gate reads it.</p>

The app draws every sound as its face (the guide’s
[a sound’s face](../../docs/faces.html)). The measurement is
`auracle_features::face`; the comparison with the bank is `apps/web/faces.js`,
and one renderer draws a face at every size, from a bank row’s icon to a full
screen, `apps/web/vessel.js`.

## Where it is taken

Inside every featurization (`featurize_memo`), from the same normalized render
$\varphi$ is measured on, and carried beside $\varphi$ on the memo row
(`CachedFeatures::face`). Every render already passes through there (the
serial fill, the farm’s `farm_render`, a generation’s walks, an offer, an
edit), so a face costs no render of its own: 1.66 ms natively against a
146 ms featurization (1.1%, `examples/face_cost.rs` over the 62 presets), and
2.5 ms in wasm against 201 ms (`auracle-wasm/examples/face_cost.mjs`).

Samples are read as the `f32` the audition buffer holds, so the face of the
featurization’s render and the face of the stored audition are the same bytes.
A row stored before faces existed has none and is still current $\varphi$
(the `RENDER_EPOCH` does not move for it); its face is completed by a render
when the app asks for it.

## The measurement

Hann-windowed frames of 2048 samples, hop 1024, of the mono render $x$.

**Bands.** `FACE_BANDS` = 40 bands with edges evenly spaced in log frequency
from `FACE_LO_HZ` = 35 Hz to `FACE_HI_HZ` = 14 kHz (about a fifth of an
octave each):

$$e_k = 35 \cdot 400^{k/40}, \quad k = 0, \dots, 40.$$

A band’s value is the mean power **density** over its edges. With $P_j$ the
power in FFT bin $j$ (covering $[j - \tfrac12, j + \tfrac12)$ in bins) and
$o_{bj}$ the length of band $b$’s overlap with bin $j$,

$$B_b = \frac{\sum_j o_{bj}\, P_j}{\sum_j o_{bj}}.$$

A band narrower than one bin (every band below about 150 Hz at 44.1 kHz)
reads the bin it sits in rather than nothing, and white noise reads the same
in every band. (Prototype v2’s data summed whole bins, and its two narrowest
bands read empty.)

**Slices.** The render is cut into `FACE_SLICES` = 12 equal spans of time, and
a frame belongs to the slice its center falls in. On the standard phrase
(5.05 s) a slice is 0.42 s: five slices of the held C4, one of the C5 stab,
two of the dyad, four of the low C3 and its release. Each slice’s spectrum is
the mean of its frames’ power; the long-term spectrum is the mean over every
frame.

**Levels.** Each spectrum is in dB relative to its own loudest band, so a face
shows shape and not level (the render is loudness-normalized already), floored
at `FACE_FLOOR_DB` = −60 dB. Each slice’s loudness is its mean power in dB
relative to the loudest slice, with the same floor. A slice under about
−170 dBFS is silence: all floor.

**Encoding.** `FACE_LEN` = 532 bytes, each a level in `FACE_STEP_DB` = 0.5 dB
steps above the floor: the long-term spectrum (40), the slices (12 × 40),
their loudness (12). It serializes as one base64 string, about 700 bytes
beside a memo row of about 1 KB.

## Against the bank

The app knows which sounds the bank shows, so the comparison is made there,
over the long-term spectra $L_s$ of the bank’s sounds $s \in \mathcal B$ (the
pool, less what was cut):

$$\mu_b = \frac{1}{|\mathcal B|}\sum_{s} L_{s,b}, \qquad
\sigma = \max\!\Big(3,\ \sqrt{\tfrac{1}{40|\mathcal B|}\textstyle\sum_{s,b}(L_{s,b} - \mu_b)^2}\Big).$$

The spread $\sigma$ is one number pooled over every band of every sound, as
prototype v2 took it, floored at 3 dB (`FACE_SPREAD_FLOOR_DB`) so a bank of
near copies does not blow a fraction of a dB up to full width. A spectrum
$S$ is drawn as

$$v_b = \frac{S_b - \mu_b}{\sigma}.$$

Below `FACE_MIN_BANK` = 4 faces in the bank there is nothing to compare
with, and no face is drawn.

**When it is taken again.** The bank’s $\mu$ and $\sigma$ are recomputed when
the set of the bank’s faces changes (a sound added, replaced or cut; at most
once a frame), and the faces are drawn against them only when they have moved
since the faces were last drawn by more than `FACE_RESTAT_DB` = 0.25 dB in a
band or `FACE_RESTAT_SPREAD` = 1% of $\sigma$. A smaller change moves a row's 24 px face by under a tenth of a pixel at the bank's usual spread (about 13 dB), and by about a third of one at the 3 dB floor; the 150 px card's by under half a pixel, and about two at the floor (a band’s
half-width moves by $R \cdot 0.35\,\Delta v$ at the mean). The recomputation is $O(40|\mathcal B|)$;
redrawing is the cost, so the bank’s rows in view are redrawn the next frame
and the rest when the page is idle (2–3 ms in the next frame for a pool
of 40, against 17–22 ms when all forty were redrawn at once).

## The drawing

As prototype v2 draws it (`A.face`): the vessel is mirrored about its center,
low bands at the base, with half-width

$$w_b = R\,\sigma(1.4\, v_b)\cdot k$$

for a box of half-width $R$ ($\sigma$ here the logistic function), so a band
at the bank’s mean is half the box wide. The 40 values are smoothed over 2 bands
either side (1 on a face 36 px tall or more) and joined with quadratic curves
through their midpoints. The outline is the long-term spectrum ($k = 1$);
under it each slice draws a faint layer with $k = 0.35 + 0.65\,\ell$ and
opacity $0.05 + 0.11\,\ell$, where
$\ell = \operatorname{clamp}(1 + \text{loudness}/30\ \text{dB}, 0, 1)$, and a
slice with $\ell < 0.25$ draws none (`FACE_LAYER_RANGE_DB`).

Large faces (the share card, a full screen) add the specimen’s glow, a blur
of 14 to 30 px on the outline, and the floor’s reflection: a line of light
under the vessel and its outline mirrored in it, faint and fading over a
third of its height. A slot shows its face drawn once per bank, at the
screen’s density, as an image.

## Keys and caching

A face is filed under its render namespace and render key,
`"<cache_namespace>/<render_key>"`, as a farm row is
([persistence](../persistence.md), [the web runtime](../runtime.md)). The
engine worker copies a face out of the memo (a least-recently-used map a
generation’s walks churn) the first time it is asked for, and keeps it in
memory and in an IndexedDB store stamped with the namespace: a build whose
renders differ cannot read another’s faces. What the worker holds in memory,
what the memo holds and what a resident audition gives are answered at once;
the store is looked up in its background lane, and a face none of them has
is rendered in a lane of its own below that, after the bank has finished
arriving, behind a refit, a guess or a cable probe, and dropped if the row
asking for it has left the view. Such a render is not kept, so it pushes no
audition out of the cache. A face’s render already running (about half a
second) is the most it can hold anything up by.

**The presets’ faces ship with the app.** A preset’s render is fixed, so
every preset’s face is rendered ahead of time, natively, through the same
engine surface the worker uses, into `apps/web/preset-faces.json`
(`make preset-faces`), with the render namespace and the reference clip it
was rendered under and each preset’s render key. The page draws a preset’s
face from it, filed under the same key, without asking the engine, where the
namespace is the session’s and, for a preset with an AUDIO IN, while the
session hears the reference clip; anywhere else the engine renders it as
above. A test renders every preset again and fails while the file differs by
a byte (`crates/auracle-wasm/tests/shipped_faces.rs`), and the built wasm
renders the same bytes as the native build.

**The stage’s live outline** (PERFORM’s stage mode) is measured as a face
is: the output’s latest 2048 samples, through the same Hann frame and FFT,
read as each band’s mean power density over the same fractional bins
(`faces.js` `createLiveMeter`, `bandWeights`), into buffers made once. Not
the analyzer node’s own spectrum, which is Blackman-windowed: on a C3
sawtooth it read a low band 16.5 dB away from the face. A test feeds the
meter the engine’s own fixture (one frame of that sawtooth and the face the
engine takes of it) and holds every band to the face within 1 dB (it agrees
to 0.24 dB); the same frame through Blackman fails it.
