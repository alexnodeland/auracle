---
title: "Patch trees serialize from their types, in declaration order"
number: 2
status: accepted
author: Claude Code
created: 2026-09-28
originating_proposal: null
superseded_by: null
---

# ADR-002: Patch trees serialize from their types, in declaration order

## Status

Accepted

## Context

PERFORM's graft, drift and offer replies built their tree through
`serde_json::json!`, which goes through `serde_json::Value`. This workspace's
serde_json has no `preserve_order`, so every object's keys came out sorted,
while every other path writes a `PatchTree` in struct declaration order.
PERFORM tells a new structure from new knob values by comparing trees' text
with the numbers masked. After any drift the same structure read as
different: Back took the slow commit path behind a re-measure and, when it
landed, treated home as a new patch (B cleared, dials reset, no glide). The
wiring cache split its keys the same way.

## Decision

A tree that crosses the wasm boundary, or is written anywhere, is serialized
from its type (`serde_json::to_string` on the struct, or a `#[derive(Serialize)]`
reply struct such as `TreeReply`), never assembled with `json!`.

## Options Considered

### Option 1: Enable serde_json `preserve_order`

Changes every `Value` in the workspace and its performance, to paper over a
construction choice at three call sites.

### Option 2: Compare trees structurally on the JS side

Correct, but slower on every comparison, and it leaves two text forms of one
patch in caches and saved state.

### Option 3: Serialize from the type (chosen)

One text per patch everywhere; the comparison and the cache work as written.

## Consequences

### Positive

- Back after a drift glides; Keep after a drift and the wiring cache work.

### Negative

- Reply shapes are declared as structs, which is more code than `json!`.
  `perform_replies_write_trees_in_their_own_key_order` pins the property.

## References

- Commit 0de1702; `TreeReply` in `crates/auracle-wasm/src/lib.rs`
- [`../architecture/web-runtime.md`](../architecture/web-runtime.md#perform-on-the-main-thread)
