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

## Round 10: the language, written down (2026-09-30)
- "the last form, or maybe the last two forms that we need to do is to have written
  documentation of the language style that is used in marketing and instructional videos
  on the website and in user guides and technical documentation. It should all be defined
  well and consistent and well thought out."
  → www/brand/voice.md (Plan-004 task 2), covering every medium: the landing page and the
  launch film (marketing), the view and illustrated films (instruction), the site, the
  guide, the reference, the app. Evidence first (an inventory of every rule and of each
  surface's real voice), then a draft for approval (Claude drafts, the maintainer
  approves). With the sound proposal (RFC-007), the last two parts of one brand.

## Round 11: the sound audition, round 1 (2026-09-30)
- Transitions: "A1, A2, and A3 are all terrible. They start off with a blaring white noise.
  That is not a sound brand that anyone should want. Out of those, I would just go with A5."
  → No cues: no whoosh, no blip, nothing in their place. Never white noise. (The noise at
  the start of A1–A3 is tour's cold-open app sound: a casting problem as well.)
- The mark: "Out of the B's, B1 is the worst, but none of them are good." → New candidates.
- The bed: "I like C2 best… I like soft, textural, not dinging bells, like conference music.
  It shouldn't be like conference music. I think more nature ambient, like Mort Garson."
  → Direction: soft, textural, warm, nature-ambient in Mort Garson's vein (Plantasia: round
  analogue tones, gentle melody, pastoral). Not corporate, no bell or tine timbres.
- The demos: "the instrument should be able to sit over the underlying music. It should be in
  the same key and maintain a similar register for the demos to have the consistent Mort
  Garson feel." → One key, one register: the bed and the on-camera playing share both; the
  instrument sits on top of the bed, which stays.
- Structure: "when the voice is going, we shouldn't just play directly under the voice. The
  voice should first explain, have a short pause, and then the music should play the demo in
  the app, and then the voice can continue." → Explain, pause, demo, continue. No demo under
  speech.
- The mix: "The voice can be mixed better with the music too. In terms of levels and things
  like that. EQ." → Voice EQ and the voice/bed balance are auditioned next.

## Round 12: the voice (2026-09-30)
Evidence: an inventory of every rule and surface (every rule, each surface's real voice, measured).
- Patch or sound: "Sound, patch for its build". A sound is what you hear, pick, save and
  breed, on every player-facing surface; a patch is how a sound is built (modules, knobs,
  cables, the PATCH view, the reference). A bank row is a sound.
- Spelling: American (supersedes ADR-011's British): color, center, toward, math,
  synthesizer.
- Dashes: no em dashes anywhere; colons, commas, full stops or parentheses instead,
  headings included ("PERFORM: the sound under your hands").
- The line: asked to "Be creative. This is a creative music product. It's elegant as math.
  Make this better. Give me the exact taglines to pick from." Chose:
    Tagline: "A synthesizer that grows toward you."
    Descriptor: "Pick the sound you'd reach for. It learns your ear, and every generation
    grows a little closer."
  (Supersedes RFC-004 decision 1, "A synthesizer that searches for your sound". The image
  ties Mort Garson's Plantasia, the faces growing, and breeding toward your taste.)

## Round 13: the sound audition, round 2 (2026-09-30)
- "B7 c7 d4 e make the bed more prominent. The voice brought forward was decent but the bed
  is hard to hear"
  → The mark: B7, the motif (A C G F on a soft round lead over a pad swell, resolving to F).
  → The bed: C7, C2's pad with a sparse melody and a soft low arpeggio, in F at 66.
  → The grammar: D4, explain, pause, demo, continue.
  → The mix: E2's voice treatment (high-pass, presence, de-ess), the bed more prominent
    than E2. A level to confirm by ear.

## Round 14: the reel, the level, the composition (2026-09-30)
- "E4. improve the harmonic and melodic composition of the motif and the underlying drones."
  → The level: E4 (bed −3 LU relative to the voice; duck 2 dB + 3 dB carve in 1–4 kHz).
  → The reel's direction stands; the composition is rewritten: a root-fifth drone that only
    breathes; slow, voice-led harmony over an F pedal (Fmaj9 → G6/F → Bbmaj7/F → Bbm6/F, two
    bars each, chromatic inner lines B–Bb–A and D–Db–C, the borrowed iv the Garson warmth);
    a three-note burble in dotted eighths against 4/4, under the vowels; one motif the bed
    develops, a step changed at each return. Three motif candidates: Reach (F G C A over
    I–IV–iv–I), Bloom (C B A E, Lydian, ends on the major 7th), B7 reharmonized (A C G F over
    I–vi–iv6–I).
- "After the sound example, the sound abruptly cuts off, and then the sound or the voice
  starts almost immediately. It starts too quickly. It should have a small pause there."
  → A demo never cuts off: its tail rings out, the bed carries a pause of about 0.8 s, then
    the voice. (Round 3 had the voice 0.4 s after note-off, over the tail.) In voice.md and
    the sound spec.

## Round 15: the marks and the bed (2026-09-30)
- "I think that we can use M1 and M2 in different contexts. M1 for exit and M1 for entrance
  makes sense. Make sure that the mix between the voices is also optimized. N3"
  → The bed: N3 (the drone, the voice-led harmony, the burble, the motif-quoting melody).
  → Two marks: read as M2 "Bloom" for the entrance (it ends open, on the major 7th) and M1
    "Reach" for the exit (it resolves, I–IV–iv–I). The message says M1 twice; this reading
    is stated to the maintainer, to swap if wrong.
  → The mix between the musical voices (drone, pad, burble, melody, the marks' lead) is
    optimized next: each its own register and place, less low-mid build-up, no unisons.

## Round 16: final mix (2026-09-30)
- "let's go with N3 and also slightly increase the sustain and release on the motif."
  → N3 (the pad dips 2 dB in 300–600 Hz under the voice, not N3v's 5 dB).
  → The motif's lead (Wobble Board, both marks and the bed melody that quotes them): a
    little more sustain and a longer release. Then the final render and spec, and RFC-007.
- "the tail at the end of the bass sound under the voice repeats the motif, but then we also
  put the motif on the end. You should remove the repetition from the part that's under the
  voice so that we can explicitly time it and not have it repeated. Also, make sure that the
  time between the motif and the beginning of the voice and the beginning of the video isn't
  too long."
  → The motif plays only as the two marks; the bed's melody has its own fragments, never the
    motif. The first word about 1.5–2 s after the entrance mark; the exit mark about 1.5–2 s
    after the last word, wherever the bed is in its cycle (REEL3 had 21.5 s and ~14 s).

## Round 17: the voice in use; then the sweep (2026-09-30)
- "send me writing samples for the written and audio language style guidelines… The
  guidelines that I'm talking about are more about the prose that will exist in the content
  in each of these formats, not only the taglines and headers… we should iterate on that
  next. Then once we have all of this pinned down, you can run through the changes for the
  UI, the videos, and the websites to bring it all consistent with this updated brand that
  we have meticulously defined."
  → Samples page: (private audition page) (full prose per format,
    set in its register, annotated, plus rewrites of today's copy). Iterate on it first.
  → Then the sweep: UI, films, site, to the brand (voice.md, the sound spec, RFC-006).
- Voice round on the samples: imagery "Restrained"; mechanism "Layered" (what first, then
  a "How it works" in place, then the reference); narrator "Beside you"; whimsy "None: quiet
  and exact". Final sound page: (private audition page)
