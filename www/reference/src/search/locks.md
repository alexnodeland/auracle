# Locks as conditional refinement

<p class="lede">Locking is exact rather than heuristic: Metropolis-within-Gibbs on
the conditional posterior. The argument depends on one detail that is easy to
omit.</p>

## The claim

Let $\mathcal{L}$ be a set of [trace addresses](../architecture/addresses.md).
Refinement with $\mathcal{L}$ locked samples from

$$\pi_\beta\big(x_{\neg\mathcal{L}} \;\big|\; x_{\mathcal{L}}\big)$$

That is the target distribution **conditioned** on the locked sites holding
their current values. Not "mostly avoids changing them"; conditioned on them.

That is exactly Metropolis-within-Gibbs: a valid MCMC scheme in which a subset
of coordinates is held fixed and the remainder is updated by MH steps that
respect the constraint.

## The implementation

```rust
pub fn violates_locks(prev: &Trace, next: &Trace, locked: &HashSet<String>) -> bool
```

A proposal $x \to x'$ is rejected if it **changes, deletes, or creates** any
address in $\mathcal{L}$. Rejection happens outside the kernel: the move is
simply not taken.

## Why all three, and why both directions

The third, *creates*, is the one that gets omitted, and omitting it breaks the
proof.

Scanning only `prev` catches changes and deletions. But a **birth** at a locked
address would be allowed through, while the death that would undo it is
rejected. The constraint region is then **asymmetric**:

$$x \to x' \text{ allowed}, \qquad x' \to x \text{ rejected}$$

which violates detailed balance. Concretely, the chain drifts into locked
structure it can never leave, so a user who locked a module would watch the
search grow new sites *inside* it and then be unable to remove them.

Checking both traces makes the constraint region symmetric, and symmetry is
what the Metropolis-within-Gibbs argument needs.

## The honest limit

A lock is a set of **exact address strings**, typically snapshotted from the
UI. Every address in it is frozen, in both directions, and *that* is exact.

It is **not** the same as freezing a *module*. A structural move can grow a
brand-new address inside a locked module — one that was in neither trace when
the set was taken, so it cannot be in the set. That case is not caught.

It costs nothing in correctness: the case is symmetric by construction
(unmatched in both directions), so detailed balance holds. It just means
"locked" is a guarantee about **addresses**, not about subtrees.

In practice the UI's **lock module (▢)** control snapshots every address
currently inside the module, which covers everything that exists at lock time.
A subsequent structural move that adds a genuinely new site inside it is the
uncovered case.

## The granularity available

| Control | Locks |
|---|---|
| A knob's lock dot | One parameter address |
| A module's **▢** | Every address currently in that module |
| **lock knobs** | Every parameter address in the patch |
| **lock wiring** | Every structural address |
| **clear locks** | Nothing |

`refine_from(seed_id, locked)` takes the set explicitly, so a frontend can
construct any subset.

## What this enables

The workflow the rack exists for:

> Find a patch whose character you like but whose envelope is wrong. Lock every knob
> except the envelope. Evolve. You get variations that differ **only** where you allowed
> them to.

Because the guarantee is exact rather than best-effort, that is a statement
about what the search *will* do rather than what it will probably do. A
heuristic version (penalize changes to locked sites, or revert them afterwards)
would be a search that mostly respects your intent, and "mostly" is not a
useful promise about the one thing you explicitly protected.

## Everything locked

If $\mathcal{L}$ covers every address, the search has nothing to do and every
proposal is rejected. The engine reports this the same way it reports any
unsuccessful generation, as "no proposal beat its parent", which is honest but
not very informative. It is listed in
[Troubleshooting](../../docs/troubleshooting.html#evolution-does-nothing) as a thing to
check.

## Relation to the design's exactness claim

`DESIGN.md`'s decision log states this as:

> **Locks / partial evolution** — Freeze any set of trace addresses; MH
> proposals touching them are rejected outside the kernel, in **both**
> directions. *Exactly Metropolis-within-Gibbs on the conditional posterior, so
> locking is exact rather than heuristic.*

This page is that claim spelled out: why both directions are needed, and where
the address-level guarantee stops.
