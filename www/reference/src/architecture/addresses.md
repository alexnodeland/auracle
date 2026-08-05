# Trace addresses

<p class="lede">The spine. Six subsystems refer to the genome, and they all use
this one naming scheme.</p>

A **trace address** names one probabilistic choice site in the grammar program.
Every site in a term has one, and it is derived from the site's position in the
tree rather than assigned:

| Address | Names |
|---|---|
| `node` | The root audio node |
| `node/0`, `node/0/1` | Children, by index |
| `node/0/m` | The modulation slot hanging off `node/0` |
| `node/0/m/0` | A subterm of that modulation term |
| `node/0#cut` | The `cut` parameter of the node at `node/0` |
| `node/0/m#rate` | The `rate` parameter of that modulation term |
| `amp#attack` | The amplitude envelope's attack |

The pattern is `<path>#<param>` for parameters and `<path>` for structure.
Paths are `/`-separated child indices from the root; a `/m` segment enters a
modulation slot, and because every modulation key sits below a `/m`, the child
convention is reused there without ambiguity.

## What shares it

| Subsystem | Uses an address to |
|---|---|
| **Panel knobs** | Identify what a knob writes |
| **Hand edits** | Write one site: `set_param(addr, value)` |
| **Locks** | Name the frozen set $\mathcal{L}$ |
| **Live parameter handles** | Map a knob to an atomic in the running voices |
| **MH proposals** | Name the site a move touches |
| **The lineage diff** | Print what changed (`node/0#cut 0.31→0.78`) |

Six subsystems, one vocabulary. The alternative is three schemes that drift: a
UI parameter id, a genome index and a DSP handle, mapped to each other. The
drift surfaces as a knob that edits the wrong thing after a structural change.

## Why it cannot drift

Because the canonical trace codec **is** the addressing scheme, not a
translation of it. `auracle_grammar::genome` encodes a `PatchTree` to a
`fugue::Trace` by walking the tree and emitting exactly the addresses the
grammar program samples at. The same walk decodes.

A round-trip property test pins it: encode a random term, decode it, and
require the result be identical. If the codec and the grammar ever disagreed
about what a site is called, that test fails.

## Structure is encoded in its own choices

The reason a *tree* can live in a flat trace at all: the structure of an
execution is determined by the choices the execution makes. The value at
`node#leaf` decides whether `node` is a source or a processor, which decides
whether `node/0` exists at all.

That is what lets fugue's generic trace machinery work unchanged: subtree
regeneration, subtree-swap crossover, and reversible-jump Metropolis–Hastings
all operate on traces without knowing anything about synthesizers. Auracle
contributes a grammar; it does not contribute an inference algorithm.

## Live parameter handles

When a term is compiled, each continuous parameter site yields a `ParamHandle`,
an atomic the audio thread reads. Turning a knob does two things:

1. Writes the atomic, so **the running voices change without a recompile**.
2. Writes the genome at the same address, so the edit is real rather than cosmetic.

Both, always. Writing only the atomic gives you a knob whose change disappears
on the next patch swap; writing only the genome gives you a knob you have to
recompile to hear.

Not every address has a live handle. Structural sites do not, and a few
parameters feed compile-time decisions. `window.__aur.nonLiveAddrs` in the web
app is the set that requires a recompile.

## Locks, precisely

$\mathcal{L}$ is a set of exact address **strings**, typically snapshotted from
the UI. A proposal $x \to x'$ is rejected if it changes, deletes **or creates**
any address in $\mathcal{L}$.

All three, and the third is the one that is easy to omit. Scanning only the
*current* trace lets a birth at a locked address through while rejecting the
death that would undo it. That is an asymmetric constraint region: it breaks
detailed balance, makes the [exactness argument](../search/locks.md) false, and
lets the chain drift into locked structure it can never leave.

One limit: a structural move can grow a brand-new address *inside* a locked
module, present in neither trace, so it cannot be in $\mathcal{L}$. That case
is symmetric (unmatched in both directions), so it costs nothing in detailed
balance. A lock is a guarantee about **addresses**, not about subtrees.

## Persisted UI state must be JS-owned

A rule from the web app, and it belongs here because it is about this scheme.
UI state that persists must be held in JavaScript and never scraped from the
DOM at save time. A phantom DOM slider (present but not the live control) once
reset a value and poisoned an autosave with it.

The address scheme makes the genome authoritative; the rule keeps the interface
from quietly disagreeing with it.
