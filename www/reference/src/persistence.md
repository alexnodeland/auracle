# Persistence and migration

<p class="lede">The observation log is the source of truth. Everything else is a cache, and
saying so is what makes migration tractable.</p>

## What is stored

| Object | Contains |
|---|---|
| `SessionState` | The whole session: pool, bank, names, log, posterior, generation, forecasts |
| `BankEntry` | A patch's **tree**, id, origin, name, pinned flag. Renders and features are **re-derived** on import |
| `ObservationLog` | Every `Feedback` with its session index and raw $\varphi$ **by name** |
| `Profile` | The log **plus the standardizer** — the portable unit |
| `TastePosterior` | A snapshot. Recomputable from the log |

Two of these choices carry the design.

**`BankEntry` stores the tree, not the features.** Trees are the source of
truth; renders and $\varphi$ are re-derived on import. That is what lets the
feature extractor change without invalidating a saved bank, and it is why
restoring a large session costs real work rather than being instant.

**The log stores raw $\varphi$ by name.** Not standardized, and not by index.
Both halves of that matter, below.

## A profile is the log plus its standardizer

```rust
pub struct Profile {
    pub log: ObservationLog,
    pub standardizer: Option<Standardizer>,
}
```

$\theta$ is only meaningful relative to the standardization that produced it,
so the two persist **together or not at all**. A log without its standardizer
is a set of numbers whose units have been lost.

The posterior itself is not in a profile. It does not need to be: it is
recomputable from these two, and shipping a fitted model would mean shipping
something that could disagree with the evidence it was fitted from.

## Names, not indices

`FitSet::build` projects a stored log onto the **current** feature names,
matching on the name. The rule is *same name ⇒ same coordinate*, and anything
unmatched is left at the new standardizer's mean, which standardizes to zero
and means **"this vote says nothing about that axis"**.

That is the honest imputation, and it is why by-name storage is worth the
bytes. By index, a feature-set change would silently re-interpret every
historical vote: coordinate 12 was `held_centroid_std` yesterday and is
`mod_density` today, and every vote ever cast would now be a claim about a
different thing.

## Three kinds of change, and the one that fails silently

**Dropped coordinate.** `size` and `n_mix` were removed to break exact linear
dependencies. Drop them from the migration too; nothing is lost that was ever
usable.

**Changed units.** These have to be *converted*, because a value silently
carried across a unit change is worse than a dropped one: it is evidence
pointing the wrong way. The conversions applied when the audio features moved
to the log axis:

| Coordinate | Conversion |
|---|---|
| `centroid_mean`, `rolloff_mean`, `zcr_mean` | Recover the frequency from the linear-Hz fraction, re-map onto the octave axis. **Exact** |
| `centroid_std` | The spread of a linear quantity becoming the spread of a log one. No exact inverse for a spread, so the **delta method** — the local derivative of the axis map at that observation's own centroid. First-order, and honest about it |
| `crest`, `tail_ratio`, `attack_s` | Now logged. **Exact** |

**Renamed coordinate, the silent failure.** When `n_delay` became `n_time`,
by-name matching would have found no `n_time` in any historical row and imputed
it at the mean for every vote ever cast. That reads as *"this user has no
opinion about delays"* rather than as a rename, and nothing anywhere would have
reported a problem.

`RENAMES` carries the value across, and in this case it is **exact rather than
a convenience**: `n_time` counts delays *and* granulators, and no observation
predating that wave can contain a granulator — so the old `n_delay` count
**is** the new coordinate's value for every row being migrated.

That reasoning is worth copying for the next rename. A rename table entry is
only exact if the new coordinate's extra contributors could not have been
present in the old data.

## Schema 1 → raw φ

The oldest logs stored *standardized* $\varphi$ over a 30-coordinate feature
set with no names.

Recoverable, because the profile persisted the standardizer alongside it:

$$\varphi_{\text{raw}} = z \cdot s + \mu$$

inverts the transform **exactly**, and the schema-1 coordinate order is known
and fixed (`SCHEMA1_NAMES`). Then the unit conversions above apply.

This is the concrete payoff of persisting the standardizer with the log: a
legacy log **plus the standardizer it was written under** *is* the raw data,
just encoded. Without the standardizer those votes would be unrecoverable.

## Forward compatibility in the small

Individual fields use `#[serde(default)]` where a default is honest:

| Field | Default | Reads as |
|---|---|---|
| `BankEntry::pinned` | `false` | Sessions saved before pinning existed had no pins |
| `TastePosterior::weights` | empty | Uniform — posteriors written before reweighting existed were uniform |
| `Forecast::provenance` | `Duel` | Every forecast already on disk was a dealt duel, which is what `Duel` means |
| `TasteConfig::recency_half_life` | `None` | No forgetting |

Each of those is a case where the default is *correct history*, not merely a
value that parses. That is the bar for adding one: if the default would
misrepresent what an old file meant, it needs a migration instead.

## Where the browser keeps it

IndexedDB, under the page's origin. No account, no server, nothing transmitted.

Consequences worth stating in a reference: the hosted build and a
locally-served copy are **different origins** and do not share storage;
clearing site data destroys the session; and there is no server-side copy to
recover from. The only backup is an exported profile.

## Restore is farmed

Restoring re-renders the saved bank, which is the single most expensive thing
the app does on load. It runs through the same parallel path as the initial
fill — `import_session_deferred` → `bank_absorb` → `restore_finish` — rather
than serially. See [The web runtime](./runtime.md#the-render-farm).

## The persistent render cache

$\varphi$ is a pure function of $(\text{term}, \text{spec})$ — that is the
[determinism contract](./runtime.md) — so a featurization this browser has
already performed can be replayed instead of re-rendered. Without that, every
reload re-renders the whole bank from nothing: ~48 candidates at ~0.5 s each,
for numbers the machine computed yesterday.

Farm workers consult an IndexedDB store (`auracle-renders`) before rendering and
write back on a miss. The engine reports the hit rate per wave into the app's own
log.

### The key is not enough

`render_key` addresses $(\text{term}, \text{spec})$, which is everything
$\varphi$ depends on *given a fixed featurizer*. It hashes the **inputs**, and a
change to the normalizer or to a descriptor's formula is a change to the
**function** — the same key would then name a different measurement.

`RENDER_EPOCH` is that missing coordinate and `cache_namespace` combines the two.
A namespace mismatch orphans **every** stored row at once, which is the only
correct granularity: a cache whose invalidation is anything less than total will
one day serve a number from a featurizer that no longer exists. Bump the epoch on
any change to a $\varphi$ coordinate, to loudness normalization (including
`PEAK_CEILING` and `TARGET_LUFS`), to the vetting thresholds, or to the compiler's
term → module mapping. When in doubt, bump: the cost is one cold boot.

A hit is **checked rather than trusted** — `pre_featurized` re-derives the key
from the tree the engine holds at that index and drops the row if it disagrees.

### Two deliberate limits

Cached rows carry $\varphi$ **without samples**, so a job that asked for audio
still renders. Serving it a row would move the saving onto the first patches the
player actually auditions, which is exactly where `wantAudio` exists to avoid it.

Eviction is "clear everything" past a row cap, which is crude on purpose: an LRU
needs an access-time write on every *hit*, turning the cheap path into a write,
and what is being protected is a disk quota rather than a working set.

It lives in the farm worker rather than in the engine's `runFarm` loop, whose
absorb cursor, re-issue watchdog and speculative-work handling must not acquire
asynchrony. A cache hit is simply a job that returns fast.

## Pins live engine-side

`Candidate::pinned` and `BankEntry::pinned`, not a UI-side set.

The engine is what evicts, so the engine must be what knows about exemptions.
Holding pins in the UI beside the stars would rebuild exactly the split that
made
[the stars-are-saves bug](../docs/bank.html#stars-are-not-saves) possible.

Capped at `pool_size / 4` so the pool can never be pinned solid. That state has
no honest report, because it surfaces as `insert_candidate` returning `None`,
which callers already render as "no proposal beat its parent".
