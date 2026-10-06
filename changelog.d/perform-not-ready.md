### Fixed: PERFORM lets go of a question asked before the engine is ready

- **A measurement PERFORM asks for before the engine has started is let
  go.** The engine answers anything that reaches it while it is still
  starting by saying it isn't ready, and PERFORM never heard that answer:
  had it asked then, its status line would have said *listening to this
  sound…* (or *re-checking*) for good. Now it says *couldn’t measure this
  patch* (or *couldn’t re-check this patch*), as it does when the engine
  fails a measurement, and anything else PERFORM asked then is let go the
  same way. PERFORM doesn't ask that early as the app stands, so this
  guards against a later change that would (`perform_truth.spec.js`,
  `worker-protocol.test.mjs`, #138).
