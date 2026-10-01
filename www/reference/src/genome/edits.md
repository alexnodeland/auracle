# Structural edits

<p class="lede">Hand edits and search proposals walk the same lattice, which is
what makes the workbench trustworthy.</p>

## The vocabulary

Because the genome is a typed tree, rewiring is a small closed set of
operations that are **type-safe by construction**: an LFO can never end up in
an audio slot, and a filter always has exactly one audio input.

| Op | Does |
|---|---|
| `Replace { key, kind }` | Swap the node's kind. Subtrees are preserved where the sorts allow; replacing a source with a processor **wraps** the source |
| `Insert { key, kind }` | Insert a processor into the wire between this node and its parent |
| `Delete { key }` | Remove the node, splicing its primary input up to take its place |
| `SetMod { key, kind }` | Set the modulation slot on an audio module. A source kind replaces the slot's term; a shaper **wraps** it |
| `SwapMix { key }` | Swap the two audio inputs of a binary node |
| `ReplaceTree { key, node }` | Install an explicit fragment, discarding what was there |
| `InsertTree { key, node }` | Graft an explicit fragment into the wire; the old subtree becomes its primary input |
| `SetModTree { key, m }` | Install an explicit modulation term wholesale |

Nodes are addressed by [trace key](../architecture/addresses.md): `node`,
`node/0`, `node/0/1`, `node/0/m`.

The `*Tree` variants exist for the wiring gestures: "plug this staged chain in
here". Callers park the displaced subtree client-side, which is what the HELD
tray is.

## Wrap versus replace

The distinction shows up twice and is the same idea both times:

- **`Replace` on a source with a processor kind** wraps the source rather than
  deleting it, because a processor needs an input and the obvious one is what
  was already there.
- **`SetMod` with a shaper kind** wraps the existing modulation term rather
  than evicting it, which is what makes `s&h rand → quantize → slew` a
  three-click build.

The socket in the UI says which of **fill / replace / wrap** it is about to do,
so the choice is never implicit.

## Hand edits and MH proposals are the same moves

**These are the operations evolution's structural proposals make.** There is no
separate mutation vocabulary.

Consequences:

- Anything a player can build by hand, the search can reach. Anything the
  search produces, a player can edit.
- A structural edit cannot produce a term the search would consider invalid,
  because validity is one predicate.
- `⚡ evolve from this` on a hand-built patch is not a special case.

## Parameter edits

Separately, `edit::set_param(tree, addr, value)` writes one continuous or
discrete site by address. This is what a knob drag is: a one-site write, then a
re-render and re-vet before the result can be auditioned.

## The validity gate

`validate_tree` is the predicate every edit result must satisfy, and it is what
the
[structural-edit gate test](#the-gate-test) exercises.

Hard ceilings on hand-built patches:

```rust
pub const MAX_SIZE: usize = 24;                            // modules
pub const MAX_DEPTH: usize = PRIOR_MAX_DEPTH + 1;          // audio tree depth: 6
pub const MAX_MOD_DEPTH: usize = PRIOR_MAX_MOD_DEPTH + 1;  // modulation nesting: 3
```

`MAX_SIZE` protects the realtime voice and the feature pipeline. The two depth
ceilings are **derived from the prior's support**, and that is a correction: they
used to be 9 and 4 against a prior whose `max_depth` is 5 and `max_mod_depth` is
2, on the reasoning that a person stacking modules by hand knows what they are
building and the ceiling only protects the voice. What that reasoning missed is
that the prior forces `#leaf` at `max_depth` and zeroes `Op`/`Pair` at
`max_mod_depth`, so the deepest term it can *score* has depth `max_depth + 1`.
A hand edit past that had $\log p = -\infty$, `EvolutionChain::init_from`
returned `None`, and ⚡ evolve on the patch did nothing and said nothing: the
very failure the grammar gives `Silence` non-zero weight to prevent. Now the
ceiling *is* the support, stated once in `prior.rs` and read from there.

A session saved under the old ceilings may hold a deeper tree. It still loads
and plays (no load path re-checks the ceilings, because corruption must not be
load-bearing), but refinement reports it as `outside_support` rather than
pretending to walk, and a structural edit that leaves it over the ceiling is
refused until one brings it under.

`MAX_MOD_DEPTH` stops well short of the audio ceiling for a concrete reason: a
`Pair` branches, so depth 3 is up to **eight leaves on one cable**, and each is
another level of the compiler's by-value recursion stacked on top of the audio
tree's. That is a stack-depth argument rather than an aesthetic one; see
[the wasm stack note](../runtime.md#the-stack-size).

## The gate test

The structural-edit suite is a **gate** rather than a set of unit assertions:

> Apply every operation at every node of randomly generated trees, and require the
> result to stay compilable.

This catches the class of bug that unit tests miss: an operation that is
individually correct but produces an invalid term in combination with a
particular tree shape. The codebase leans on gates like this generally; the
preference is stated in
[`CONTRIBUTING.md`](https://github.com/alexnodeland/auracle/blob/main/CONTRIBUTING.md):
*prefer extending a gate over asserting implementation details.*

## Naming stability

`NodeKind` serializes as `snake_case`, and that string is also what
`describe::RackModule::kind` reports and what the frontend keys its module
list off.

`RingMod` is renamed by hand, because the derived spelling would be `ring_mod`
while the module is `ringmod` everywhere else, and one module with two
spellings is a defect waiting for a caller.

`Silence` is `silence` on both sides, and it is the one kind in the vocabulary
nobody shops for: `Replace { kind: silence }` is how an edit unplugs a socket.
The app's unplug, extract and cable-move gestures leave the same leaf (as
`{"Silence":{}}` in the tree they post), the rack describes it as kind
`silence` titled *empty*, and it renders nothing. It used to be unreachable by
hand, so the app stood a saw VCO in an unplugged socket and drew the EMPTY
plate over it; the plate said "nothing here" while the saw played, and φ
measured the saw. As a source kind it can be neither inserted into a wire nor
wrap anything.

## Node identity

Nodes carry a `Uid` assigned on the way into the pool. This is what makes the
rack's hand positions and locks survive a structural edit. Without them a node
**is** its position, so any structural change wipes the locks and destroys the
hand-build → pin → breed loop the editor exists to serve.

A node is a thing with an identity that has a position, not a position that has
contents.
