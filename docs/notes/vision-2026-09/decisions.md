# The vision: what the maintainer decided, 2026-09-30

Recorded as each round was answered, and the source for
[RFC-006](../../proposals/006-the-sound-at-the-centre.md). Quotes are the
maintainer's words. RFC-004's decisions came first and stand (the tagline,
light mode for the docs only, no UI sounds, `af_heart` at 0.81, Claude drafts
and the maintainer approves, the sonic floor on first deals and the films'
casting, Wave 2 split); see ADR-011. The artifact links are private.

## Round 0 (prototype v1 reaction)
"A good start… be more expressive and bold… world class UI, impeccable semantics, clear
navigation, nuanced interactions, great visual hierarchy, great component linking,
stunningly beautiful visuals." v1: https://claude.ai/artifact/Uw4FSmR6pFVyZdke41sDXi

## Round 1: vision
- Audience: everyone gets the musician/producer experience up front. Each profile dives
  deeper in its own direction: sound designers into the patch, newcomers into learning,
  researchers/curious into the model. Progressive disclosure, good layout and a clear
  division of responsibility, so it never gets hairy.
- Feel: a precision instrument (today's DNA at its peak: machined, phosphor, exact).
- Structure: the sound at the centre.
- The face (vessel): identity everywhere; shareable sound cards; a live visual
  instrument. (Not: draw-to-search.)

## Round 2: navigation and depth
- Moving: zoom. Zoom out = TASTE (the sound among all sounds); at rest = PERFORM;
  zoom in = PATCH (what it's made of); EVOLVE sideways (its alternatives).
- Depth: the same gestures for everyone, always starting at the top (approach = hint,
  ask = figure, dive = full detail). No remembered depth, no chosen profile.
- Keep from v1: hold ⌥ for the model; ⌘K as the one list (replaces ⋯ and the ? prose);
  dashed amber = a guess; controls name their modules.
- Draft 1's five choices: decide after prototype v2, in context.

## Round 3: expansion
- New capabilities, all: bring your own sound; taste over time; explain anything;
  stage mode; plus audio input into the graph; plus comprehensive mobile friendliness.
- Platform beyond the browser: a DAW plugin (AU/VST3).
- Learning: figures first, then short lessons that use the sound in hand.
- The model, all: the lens and the map; a model room; export the data; watch it think.

## Round 4: specifics
- Audio in, all: be processed (Auracle as an effect); drive modulation; play the patch
  (pitch/dynamics tracking); be resampled (new sample source the model can breed).
  "Make sure that any extra implementation falls in the right place and update quiver if
  you need to." (quiver-dsp 0.3.3 from crates.io; local checkout ../quiver; path override
  commented in Cargo.toml.) Layering: DSP in quiver; node kinds in auracle-grammar;
  features/φ in auracle-features; bindings in auracle-wasm; capture in apps/web (and the
  host input in the plugin).
- Audio inputs, plural (added mid-build): Auracle handles multiple audio inputs. An
  audio input node detects the available input devices and lets you select one; the same
  input can feed several audio input nodes at once.
- Mobile: everything, designed for touch (pinch to zoom, swipe to pick), not squeezed.
- Patch depth: everything editable; modulation you can see (live cables, moving knobs,
  measured levels); start from nothing (empty patch, the model suggests the next module).
  (Not: patch as text.)
- Next: prototype v2 (sound at the centre with zoom, touch layouts, first passes at stage
  mode and explain-anything, and the other capabilities), then RFC-006 and a plan.

## Round 5: the principle (during prototype v2)
- On PERFORM: "when an offer is generated, that offer's face is also displayed in its
  corresponding color. And then taking the offer has some nice transition to move that
  over to the face of the active sound." Built: the offer grows out of the sound in hand
  as its own amber face, carrying its parent's outline; taking it fills it with green from
  the base as the old sound returns to the bank; passing folds it back.
- Then, the principle: "it looks like you're actually growing the offer face out of the
  main sound face… I like this type of visualization because it elucidates what's actually
  happening under the hood without using any words in a very intuitive way… I want this
  sort of visualization to be used across the application. So propose more of these."
  → SHOW THE MECHANISM: what happens under the hood is shown as faces moving, not words.
- Built in v2: offer growth/take/pass; the kept sound flying to the map with a ripple;
  children budding from parents when the pool breeds, the least-liked fading from the pool;
  zoom carrying the sound's own vessel between levels; notes lighting their pitch on the
  vessel (stage); a dropped sound's nearest presets leaning in; evidence flowing into the
  weights (model room); light along the cables and a module's effect as a ghost (patch);
  animated figures for "ask".
- Proposed next: a face that develops as it renders; the warm start's eighteen answers as
  threads; save drops the face onto the Saved shelf, cut crumbles it, undo re-forms it;
  Wander's trail of ghosts on the map; refits re-growing the halos from the picks; a named
  control turning its module's knob in a patch inset; faces below the sonic floor drawn
  hollow; guesses blurred by uncertainty; a live input's face forming at its AUDIO IN plate.

## Round 6: a palette of controls (during the audit pass)
- "The Perform tab has a set of knobs that are higher order than those that exist in a patch
  view. Bright and Motion map down to different knobs. But there are other higher order
  concepts… different people like to express themselves in terms of different higher order
  concepts. So it would make sense for us to provide a palette of knobs that can be placed or
  hidden from the perform view… people can select their high level control of the underlying
  circuits. It's almost like people can build guitar pedal like interfaces over underlying
  modular circuits."
  → PERFORM's named controls become a palette: many higher-order controls (tone, weight,
  dynamics, space, movement, character), each a measured mapping onto the patch's own
  knobs; the player places, hides and orders them, building their own "pedal" over the
  circuit. (Later: make your own, by bundling knobs with directions.)
- Also from this round: on a phone, tapping a PATCH module opens it in a sheet to fine-tune
  (sliders with steps); "How it works" explains whichever control you last touched, with all
  of them a tap away; a new patch can be cleared, its modules removed, its suggestion
  skipped, and the add-module sheet closed.

## Round 7: true to the engine; the sound of the brand (2026-09-30)
- On the lineage work: "Make sure that all of this is sound and maps well to the actual
  evolution underneath. Don't have animations or interactions just for the sake of it. We
  want to elucidate the true functionality here."
  → SHOW THE MECHANISM is bounded by the engine: an animation may only show a fact the
  engine produces (a child's real seed, a real retirement, a real offer's origin). Where the
  engine doesn't record it, don't draw it, or mark it as a guess (dashed amber).
- Audio branding, equal to the visual: "this is an aesthetic audio project after all. So
  the sample sounds and all of our sound marks or any transition sounds or background music
  shouldn't be too launch video-ish. It should also carry a consistent voice across all of
  these different settings and be in line with our visual direction."
  → Scope: films (beds, cues, the sound mark, the cast of sample sounds, the narration);
  "no UI sounds" in the app stands. Evidence first (audit), then an audition page, then
  questions, then an RFC. Hypotheses to test: the instrument scores its own films (already
  true); no generic SFX (a transition is the real sound changing, or silence); the sound
  mark enacts a mechanism (the mark reads inward as a posterior contracting onto one
  taste); one sound source of truth like tokens.json (key, tempo, one room, a loudness
  ladder, a house cast) generated into the scores and the mix.

- On the bank's "not heard yet" dot: "Put that on the left side of the text and make the
  text unaffected by whether the dot is there or not. It shouldn't re-indent." → A mark on
  a row sits in space the row already has; the name never moves.

## Round 8: approval (2026-09-30)
- On prototype v2, after the engine pass: "I think that this mock is pretty good… this is
  fine for an RFC, and I'm happy to approve all the visuals." → The prototype's visuals
  are approved, including Draft 1's five choices as the prototype sets them (the type
  ratio, the label size, the primary action, depth, where hints go). The audio branding
  goes to its own proposal, after an audition.

## Round 9: accepted (2026-09-30)
- "Yeah you can accept it." → RFC-006 accepted, as ADR-012 (motion shows what the
  engine does) and Plan-005.
