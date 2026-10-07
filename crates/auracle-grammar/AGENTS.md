# auracle-grammar: the genome

What a patch can be, and how it becomes sound. Rules shared by all crates are
in [`../AGENTS.md`](../AGENTS.md).

## Where things are

| File | Holds |
| --- | --- |
| `term.rs` | `PatchTree`: the typed term over the module palette. Audio/Mod sorts are separate types, so ill-sorted patches cannot be written. |
| `prior.rs` | The PCFG prior (a fugue program) that draws terms and scores them |
| `compile.rs` | Term → quiver `Patch`, including the limiter and output stage |
| `edit.rs` | Knob writes by trace address (`node/0#cut`) |
| `mutate.rs` | Structural edits a player makes: insert, delete, replace, rewire, and module defaults; `normalize_tree`, the normal form every tree is put in once on its way in (a structural edit, an import, a restore, a whole-tree replace), and `validate_tree`, the ceilings |
| `describe.rs` | The rack view the app draws: modules, knobs, **knob labels**, cables |
| `diff.rs` | What changed between two trees, in address terms (the lineage log and offer strips read it) |
| `presets.rs` | The hand-made library. The warm start deals from it. |
| `steps.rs` | The timbral step sequencer (`ModNode::Steps`) |
| `take.rs` | `Take`: a CAPTURE's recording, saved in the term as quiver's `Capture` state and bounded like an audition clip; an unreadable one loads empty |
| `rng.rs` | `gen_index`: an index drawn as a `u64` on every target. Use it for any index drawn from an RNG that reaches a seeded result, never `gen_range(0..len)` over a `usize` (wasm32 reads it through `next_u32`) |
| `genome.rs` | `PatchTree` as a fugue-evo genome |

## Rules

- **A knob's label is user-facing copy.** `describe.rs` labels appear on the
  rack, in PERFORM's hood, in the guide and in films. Rename one and grep the
  app (`SITE_NAMES` in `apps/web/main.js`), `www/docs` and `www/video/films`
  for the old word. Labels must say what turning the knob up does (the
  wavefolder's knob is "threshold", because up folds *less*).
- **So are a preset's name and description, and a `StructError`'s text.**
  The bank and the warm start show the first two, and PATCH's toast quotes the
  third ("That edit to Glass Pad didn’t happen: …"). `make dev-check` reads
  the strings in `presets.rs`, `describe.rs`, `term.rs`, `prior.rs`,
  `diff.rs` and `mutate.rs` against `www/brand/voice.md`
  ([`../AGENTS.md`](../AGENTS.md)). A preset's name is fingerprinted by
  `apps/web/perform-wirings.json` and `apps/web/preset-faces.json`; its
  description is not.
- **Every structural op must leave a compilable tree.** The edit gate applies
  every op at every node of random trees. A new module or op is not done until
  it passes that gate.
- **The trace codec is the addressing.** The `TraceGenome` round-trip property
  test keeps them one thing; extend it for a new node kind.
- **quiver is wired in `Warn` mode on purpose.** `Strict` rejects
  warning-class pairs the compiler uses deliberately (a constant bipolar Offset
  into a unipolar knob). An allowlist test pins those classes; a new warning
  class is a decision, not a fix.
- **Adding a module touches many layers.** Term, prior, compile, describe,
  mutate defaults, φ_struct (in `auracle-features`), the node bank in
  `apps/web/main.js`, the guide's node pages. See
  [`docs/architecture/system.md`](../../docs/architecture/system.md#adding-a-module).

## Tests

`cargo test -p auracle-grammar --profile test-fast`. Never in debug: the
compiler recurses with large modules on the stack and overflows.

Each module's tests sit beside it, in a file of their own: `compile.rs`'s in
`compile/tests.rs`, and so on (`crates/AGENTS.md` § Coverage says why).
`src/tests.rs` holds the gates that cross modules (the edit gate, the
finite-prior gate, the identity gates, the two samplers) and the fixtures
several modules' tests share.
