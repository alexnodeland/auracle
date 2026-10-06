# Persistence and migration

<p class="lede">The observation log is the source of truth. Everything else is a cache, and
saying so is what makes migration tractable.</p>

## What is stored

| Object | Contains |
|---|---|
| `SessionState` | The whole session: pool, bank, names, log, posterior, generation, forecasts, and the [audition clip](./audition/clips.md#stored-with-the-session) |
| `BankEntry` | A patch’s **tree** (with any [CAPTURE take](./genome/grammar.md#capture-a-recorded-take-as-a-source) in it), id, origin, name, pinned flag, and `unjudged` when it was kept as new and has not been in a pick yet (left out when false). Renders and features are **re-derived** on import. A sound kept aside because its only take couldn’t be read is a bank entry too, written back JSON-equal to what was loaded |
| `ObservationLog` | Every `Feedback` with its session index and raw $\varphi$ **by name** |
| `Profile` | The log **plus the standardizer**: the portable unit |
| `TastePosterior` | A snapshot. Recomputable from the log |
| `OwnSound` | [A sound of your own](./features/own-sound.md): its name and the raw $\varphi$ of the coordinates its file measures, **by name**. Never the audio |

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
unmatched is left at the new standardizer’s mean, which standardizes to zero
and means **“this vote says nothing about that axis”**.

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
| `centroid_std` | The spread of a linear quantity becoming the spread of a log one. No exact inverse for a spread, so the **delta method**: the local derivative of the axis map at that observation’s own centroid. First-order, and honest about it |
| `crest`, `tail_ratio`, `attack_s` | Now logged. **Exact** |

**Renamed coordinate, the silent failure.** When `n_delay` became `n_time`,
by-name matching would have found no `n_time` in any historical row and imputed
it at the mean for every vote ever cast. That reads as *“this player has no
opinion about delays”* rather than as a rename, and nothing anywhere would have
reported a problem.

`RENAMES` carries the value across, and in this case it is **exact rather than
a convenience**: `n_time` counts delays *and* granulators, and no observation
predating that wave can contain a granulator, so the old `n_delay` count
**is** the new coordinate’s value for every row being migrated.

That reasoning is worth copying for the next rename. A rename table entry is
only exact if the new coordinate’s extra contributors could not have been
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
| `BankEntry::unjudged` | `false` | Sessions saved before it existed held no sound protected until its first pick; every sound in them competes, as it did. Written only when `true`, so a session with no such sound saves byte for byte as before |
| `TastePosterior::weights` | empty | Uniform: posteriors written before reweighting existed were uniform |
| `Forecast::provenance` | `Duel` | Every forecast already on disk was a dealt duel, which is what `Duel` means |
| `TasteConfig::recency_half_life` | `None` | No forgetting |

Each of those is a case where the default is *correct history*, not merely a
value that parses. That is the bar for adding one: if the default would
misrepresent what an old file meant, it needs a migration instead.

## Where the browser keeps it

IndexedDB, under the page’s origin. No account, no server, nothing transmitted.

Consequences worth stating in a reference: the hosted build and a
locally-served copy are **different origins** and do not share storage;
clearing site data destroys the session; and there is no server-side copy to
recover from. The only backup of the taste is a downloaded profile (the menu’s
Download your taste item).

## Restore is farmed

Restoring re-renders the saved bank, which is the single most expensive thing
the app does on load. It runs through the same parallel path as the initial
fill (`import_session_deferred` → `bank_absorb` → `restore_finish`) rather
than serially. See [The web runtime](./runtime.md#the-render-farm).

## The persistent render cache

$\varphi$ is a pure function of $(\text{term}, \text{spec})$, which is the
[determinism contract](./runtime.md), so a featurization this browser has
already performed can be replayed instead of re-rendered. Without that, every
reload re-renders the whole bank from nothing: the app’s 40 sounds at ~0.5 s
each, for numbers the machine computed yesterday.

Farm workers consult an IndexedDB store (`auracle-renders`) before rendering and
write back on a miss. The engine reports the hit rate per wave into the app’s own
log.

The engine worker opens the store once at boot, before any farm worker is handed
the phrase: it creates the store on a first visit and stamps it with the
namespace (below), so the farm workers’ own opens only read it. When each farm
worker created and stamped it, their writes queued behind one another, and a
first visit at six workers waited about 1.5 s longer for its first sounds. The
farm waits two seconds at most for the stamp, which takes about 50 ms; past
that, its workers open the store themselves, as they did before.

### The key is not enough

`render_key` addresses $(\text{term}, \text{spec})$, which is everything
$\varphi$ depends on *given a fixed featurizer*. It hashes the **inputs**, and a
change to the normalizer or to a descriptor’s formula is a change to the
**function**: the same key would then name a different measurement.

`RENDER_EPOCH` (3, in `auracle-features`’ `cache.rs`) is that missing
coordinate for the featurizer. `QUIVER_DSP_VERSION` (0.4.0, beside it) is the
same coordinate for the DSP library every render calls into: a quiver release
can change a sample with no line of Auracle changing, as 0.4.0 did for Pluck and
Delay. `cache_namespace` combines the three: the epoch, the quiver version, and a
hash of the phrase spec without its audition clip. The clip is in the
`render_key` of a patch that listens instead ([audition
clips](./audition/clips.md#cache-keys)), so a new clip never clears the store.
A namespace mismatch orphans **every** stored row at once, which is the only
correct granularity: a cache whose invalidation is anything less than total will
one day serve a number from a featurizer that no longer exists. Bump the epoch on
any change to a $\varphi$ coordinate, to loudness normalization (including
`PEAK_CEILING` and `TARGET_LUFS`), to the vetting thresholds, or to the compiler’s
term → module mapping. Move `QUIVER_DSP_VERSION` with the quiver dependency: a
test reads `Cargo.lock` and fails while they disagree. When in doubt, bump: the
cost is one cold boot.

Every row is stored under a key that begins with its namespace (`farm_key`: the
namespace, then `render_key`), so a row written under another namespace is never
a hit. The store’s own stamp is not enough for that: it is checked only when the
store is opened, and a tab still running an older build goes on writing its rows
after a newer tab has cleared and re-stamped it.

A hit is **checked rather than trusted**: `pre_featurized` re-derives the content
address from the tree the engine holds at that index and drops the row if it
disagrees.

### Two deliberate limits

Cached rows carry $\varphi$ **without samples**, so a job that asked for audio
still renders. Serving it a row would move the saving onto the first patches the
player actually auditions, which is exactly where `wantAudio` exists to avoid it.

Eviction is “clear everything” past a row cap, which is crude on purpose: an LRU
needs an access-time write on every *hit*, turning the cheap path into a write,
and what is being protected is a disk quota rather than a working set.

It lives in the farm worker rather than in the engine’s `runFarm` loop, whose
absorb cursor, re-issue watchdog, and speculative-work handling must not acquire
asynchrony. A cache hit is simply a job that returns fast.

## Pins live engine-side

`Candidate::pinned` and `BankEntry::pinned`, not a UI-side set.

The engine is what evicts, so the engine must be what knows about exemptions.
Holding pins in the UI beside the stars would rebuild exactly the split that
made
[the stars-are-saves bug](../docs/bank.html#stars-are-not-saves) possible.

Capped at `pool_size / 4` (`Engine::pin_cap`) so the pool can never be pinned
solid. That state has
no honest report, because it surfaces as `insert_candidate` returning `None`,
which the app reports as children that did not rate above the sounds they
would replace (*3 were bred, but none rated above the sounds they would
replace*).

## Kept as new, protected until a pick

`Candidate::unjudged` and `BankEntry::unjudged`: the other engine-side
exemption, and not a pin. `commit_edit` (keep as new, and a shared patch
imported through it) sets it on the sound it admits, *after* recording the
comparison that kept it, which judges the original: the pick that keeps a
sound is not a judgment of it. It clears the first time the sound is one of
the two in a recorded pick: `record_duel_as` (every dealt pair, the warm
start's, and a later kept edit's comparison with it as the original) clears
both sides, and `record_tree_duel` (a PERFORM offer heard and answered)
clears any member whose tree is either side; the app's `perform_record` also
clears the sound in hand as it is in the bank, since PERFORM plays it with its
controls moved (`Engine::mark_judged`). A cut (`record_keep(false)`) is an
answer about the sound and clears it too; stars leave it set.

A PERFORM answer is recorded a window after it is given (eight seconds for a
Take, so DON'T COUNT IT can drop it), and in that window the player can take
the offer onto the bench and keep it as new. So the answer carries `asOf`,
the newest pool id the page had shown when it was given, and
`record_tree_duel_as_of` and `mark_judged` clear only members with an id at
most `asOf` (ids are issued in order). A sound kept after the answer was
given is not judged by it. The page's knowledge can only lag the engine's,
which errs toward keeping a protection a little longer.

The rule is `Candidate::kept()` (`pinned || unjudged`), and it is the one
`insert_candidate` and `eviction_order_by` both apply, so `retiring()`,
`may_replace()`, `refine_finish`, a ⚡ child's trim and a preset's insert all
pass over it alike. It is not charged to `pin_cap` and the app shows no mark
for it.

Bounded at `pool_size / 4` (`Engine::unjudged_cap`) on the flags of unsaved
members: a keep that would put one more past the cap clears the oldest (lowest
id; ids are issued in order), which stays in the pool as an ordinary member. A
saved member is protected by its pin and is not counted; unsaving it bounds
the flags again. With pins capped the same, at least half of a pool of four or
more is always evictable, less any ⚡ seed in flight, so an insert always lands
and a generation's end always brings the pool back to size (below four, the
caps' floor of one each can protect more than half). A restore applies the cap
again, for a file written under a larger one.
