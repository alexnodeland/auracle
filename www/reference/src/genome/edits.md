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

- Anything you can build by hand, the search can reach. Anything the search
  produces, you can edit.
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
pub const MAX_SIZE: usize = 24;       // modules
pub const MAX_DEPTH: usize = 9;       // audio tree depth
pub const MAX_MOD_DEPTH: usize = 4;   // modulation term nesting
```

These protect the realtime voice and the feature pipeline rather than shaping
the search. The prior's own ceilings are lower (`max_mod_depth` of 2), on the
reasoning that a person stacking shapers by hand knows what they are building.

`MAX_MOD_DEPTH` stops well short of the audio ceiling for a concrete reason: a
`Pair` branches, so depth 4 is up to **sixteen leaves on one cable**, and each
is another level of the compiler's by-value recursion stacked on top of the
audio tree's. That is a stack-depth argument rather than an aesthetic one; see
[the wasm stack note](../runtime.md#the-stack-size).

## The gate test

The structural-edit suite is a **gate** rather than a set of unit assertions:

> Apply every operation at every node of randomly generated trees, and require the
> result to stay compilable.

This catches the class of bug that unit tests miss: an operation that is
individually correct but produces an invalid term in combination with a
particular tree shape. The codebase leans on gates like this generally; the
preference is stated in
[`DEVELOPMENT.md`](https://github.com/alexnodeland/auracle/blob/main/DEVELOPMENT.md):
*prefer extending a gate over asserting implementation details.*

## Naming stability

`NodeKind` serializes as `snake_case`, and that string is also what
`describe::RackModule::kind` reports and what the frontend keys its palette
off.

`RingMod` is renamed by hand, because the derived spelling would be `ring_mod`
while the module is `ringmod` everywhere else, and one module with two
spellings is a defect waiting for a caller.

## Node identity

Nodes carry a `Uid` assigned on the way into the pool. This is what makes the
rack's hand positions and locks survive a structural edit. Without them a node
**is** its position, so any structural change wipes the locks and destroys the
hand-build → pin → breed loop the editor exists to serve.

A node is a thing with an identity that has a position, not a position that has
contents.
