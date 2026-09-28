# The wasm engine is poisoned

## Symptoms

- Every engine call fails with **"recursive use of an object detected which
  would lead to unsafe aliasing in rust"**.
- Or: **"memory access out of bounds"** from the worker, often on opening a
  large patch or inserting a heavy module.

## Cause

A panic inside a `WasmEngine` method unwinds out of a `&mut self` binding and
leaves the object borrowed forever; every later call reports the borrow, not
the original fault. "Memory access out of bounds" is usually a **stack
overflow**: the compiler recurses with large modules by value, and a wasm
built without the 8 MB stack overflows.

## What to do

1. Find the **first** error in the worker's console output; everything after
   it is the poison.
2. If it is out-of-bounds: check the build went through `make wasm` (which sets
   `WASM_STACK`), not `wasm-pack` directly. Rebuild with `make wasm`.
3. If it is a real panic: reproduce natively with the same tree
   (`cargo test -p auracle-wasm --profile test-fast`, or an example), fix the
   panic, and add the tree as a test case.
4. Reload the page; the engine does not recover in place.
