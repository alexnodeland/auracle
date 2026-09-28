---
title: "Rust tests run in an optimized profile"
number: 5
status: accepted
author: Claude Code
created: 2026-09-28
originating_proposal: null
superseded_by: null
---

# ADR-005: Rust tests run in an optimized profile

## Status

Accepted

## Context

The grammar, features and session suites render real audio sample by sample.
In a debug build that is about 20 times slower, and the grammar compiler,
which recurses with large modules held by value, overflows the default test
thread stack.

## Decision

Tests run with `--profile test-fast` (release codegen without release's LTO
and single codegen unit), which `make test` and CI use. A Claude Code hook
refuses `cargo test` on the audio crates without an optimized profile.

## Options Considered

### Option 1: Debug tests with a larger stack

Still 20 times slower; hides nothing useful.

### Option 2: Plain `--release`

Correct but slow to build (fat LTO, one codegen unit).

### Option 3: A dedicated `test-fast` profile (chosen)

Fast code, reasonable build times.

## Consequences

### Positive

- The suite runs in minutes, and the stack overflow cannot recur.

### Negative

- Debug assertions are off in tests; overflow checks rely on explicit tests.

## References

- `Cargo.toml` `[profile.test-fast]`; `Makefile` `test`
