# Shell and consistency: interaction design review

Area: everything a player meets in every view (first run, menu bar, bank, dock,
toasts, help, ⋯, booth, the gates), then a cross-app consistency audit. IDs:
**SH** for the shell, **CO** for consistency. Evidence paths are relative to
`/home/user/auracle/` unless absolute. Frames I pulled from the finished tour
film are in `(review scratch, not kept) shframes/`.

A note on the evidence: the tour's dry stills (`www/video/out/tour/dry/`) were
taken at 02:19. `tour.mp4` was recorded at 04:34, after the fixes of 02:34–03:40.
Where the two differ I cite the film. The TASTE rehearsal stills are from the
day before and show an older menu bar ("GEN"), so I do not use them for the shell.

---

## 1. Summary

1. **One act, five words.** The thing the player does to teach the model is a *pick*, a *vote*, a *choice*, a *preference* and a *keep*. PICKS counts stars and cuts, but the meter beside it does not. The act has three different undos, and ⌘Z undoes the pick in one view and an unrelated knob edit in the next (CO1, CO2).
2. **The shell moves the player without being asked.** Clicking a bank row from PERFORM, EVOLVE or TASTE jumps to PATCH. Clicking a view tab leaves focus on the tab, so EVOLVE's ←/→ changes the view instead of voting. PATCH's "Breed a generation ▸" chip switches view and starts a job that took 165–191 s in rehearsal. That job's only progress readout is on a button in another view (SH1, SH2, SH3).
3. **The colours don't hold their meaning.** The stylesheet's law is "green = sound, amber = the model". In the app, amber also means *on*, *active tab*, *primary*, *renamed*, *alarm*, *forecast missed* and *went up*. Green also means *focus*, *selected*, *cursor* and *forecast hit* (CO3, CO10).
4. **First run is close to right, but its seams show.** A newcomer sees PATCH for half a second before the warm start opens. The same "play a key" instruction appears four ways, two of them on screen at once. The result toast is still followed by "Acid Line on the bench" in the published film. PERFORM then says "measuring…" for about 9–12 s after *teach it* (SH4, SH5).
5. **What to keep:** the toast lane's rules (replace, urgent, windows that start when a toast becomes visible, reserved rects), undo instead of confirm, the dock working the same in every view, keys that keep playing after a click, the MIDI indicator's four states, and a non-destructive narrow gate. Build the fixes on these.

---

## 2. Flows walked

### F1. First run (boot → warm start → first sound)
1. **Boot veil.** "listening to forty patches — you start as soon as the first eight land" (`index.html:879`), a meter, and "heard N of 40 · K renderers". The copy is honest and ambitious. There is no boot timing in the evidence, because every film starts from a seeded save.
2. **The veil drops at *playable*** (`main.js:1057–1101`) onto **PATCH**, the tab marked `active` in the HTML (`index.html:73`). 500 ms later the warm start opens over it (`setTimeout(openWarmStart, 500)`). In `to-first-00-start.jpg` the PATCH tab glows green behind the dialog. *Friction:* for half a second the first screen is the densest view. The coach pill ("Press A–L or tap a key…") is already up behind the modal (bottom centre of `to-first-00-start.jpg`), and note keys play the bench patch behind an `aria-modal` dialog.
3. **Warm start.** Nine cards, each with its own ▶ (focus lands on the first ▶), SKIP, and a button that counts down: "pick any three" → "2 more" → "1 more" → "teach it". *Measured:* the first ▶ sounds 0.83–1.0 s after the click (`to-first.json`: `until .wi-play.playing took 0.83`, stamp `heard` 3.73 s after a click at 2.7 s). *Friction:* the copy says "eighteen A/B votes" (`index.html:725`). The result toast says "18 preferences learned", the counter says PICKS, and the film calls them "18 picks". A picked card lights **amber** (`style.css:3805`), while a pick in EVOLVE flashes **green** (`style.css:3627`).
4. **teach it.** The app switches straight to PERFORM and a toast says "Loading those in…". The result replaces it 1.5–2.3 s later (stamps `taught` 6.83 → `learned` 9.11). *Friction:* in the recorded film the result toast carries "+1", and "Acid Line on the bench" follows it (`shframes/tour-108.jpg`, then `tour-112.jpg`). See SH5 for the cause.
5. **PERFORM, first minute.** The title reads "measuring how this patch moves…" and all six knobs read "measuring…" at 15.3 s, 8.5 s after *teach it* (`to-first.json` log `perform`). The controls come alive between 15 and 21 s ("3 of 6 controls reach this patch", `to-first-04-end.jpg`). Meanwhile the first-steps strip says "1 Play a key: A to L, or tap the keybed" while the coach pill says "Press A–L or tap a key — you're already holding a synth." (both visible in `to-first-01-toast.jpg`).
6. **The bank after the fit.** Before the fit the list is unsorted with "–" in place of percentages. After it the list re-sorts by prediction and **Acid Line, the patch under the player's hands, scrolls out of view** (`to-first-01-picks.jpg` vs `to-first-04-end.jpg`). The tab stays on EVOLUTION although the toast says "Your three are saved" and the film's callout points at MY PATCHES.

### F2. Find and try a sound in the bank
1. Three tabs: EVOLUTION 40 / MY PATCHES 3 / PRESETS 62. The active one is **amber** (`style.css:473`), while the active view tab is **green** (`style.css:261`). A one-line note sits under them ("Every patch the model is weighing.") with a WHAT'S THIS? link. The head also has "3/10 saved" and a "?", and both open the same tour.
2. A row carries: an origin glyph (◇ ⚡ ✎ ▤), the name, a %, and a 3 px bar; ▶, one outlined ☆ (five on approach), a 12 px floppy, and CUT on approach. *Measured:* row ▶ to playing ≈0.3 s (`to-bank.json` `bank5:play` 14.13 → mark 14.38).
3. **Click the row → PATCH.** This happens from every view (`main.js:5395–5400`, presets `:5558`). *Measured:* click to open ≈0.34 s (`to-bank.json` click ≈15.44 → stamp `opened` 15.78). A toast then says "Sea Change on the bench" (`to-bank-04-padrow.jpg`), and PATCH shows "MODEL'S GUESS 0.59" beside the bank's "59%" for the same patch (CO6).
4. Rate: the star toast says "X rated 4★" with no undo, and PICKS goes up while EVOLVE's meter does not (CO1). Save: the toast says "Saved Noisy Pad — it won't be replaced. 4/10 slots used." while the head says "4/10 saved" (`ve-keep-04-budget.jpg`). Cut: the toast says "Cut Soft Wash #9." with UNDO, and exposes an id the bank hides (`ve-keep-07-toast3.jpg`).

### F3. Play the dock
Keys on screen, computer keys and MIDI all work in every view. z/x shift the octave and the label reads `a = C4`. HOLD / UNI / ARP / SYNC light **amber** when on (`style.css:377`). ARP opens a drawer that floats over the bank's bottom rows (`to-dock-01-drawer.jpg`). gld reads "off"/"370 ms". ● REC turns into a red "◼ STOP", and its toast says "recording — play something; stop to download the take" and then "saved 3.1s take" (`to-dock-04-saved.jpg`). The toast says *saved* for a WAV download. *Friction:* starting REC and moving glide widen the right cluster, and the keybed narrows about 8 px under the hand (C6 label at x = 1632 in `to-dock-01-drawer.jpg`, 1625 in `to-dock-03-toast.jpg`).

### F4. Read the menu bar, ?, ⋯
PICKS 18 · GENERATIONS 0 · skill line ("calibrating · 2/20", `ve-keep-04-budget.jpg`) · ? · ⋯. The film chip is hidden in `?film`, so no still shows it; this part is from code only (`main.js:18966`). **?** opens a card titled "HOW TO PLAY" (`to-header-01-card.jpg`). The ⋯ menu and the tooltip call the same card "Keyboard map & gestures", and the film calls it "the keyboard map". **⋯** holds 12 items that mix files, modes, destructive actions and help (`to-header-02-menu.jpg`).

### F5. Start a long job from the shell and keep playing
In PATCH, press "It's learned something. Breed a generation ▸": the app switches to EVOLVE and presses EVOLVE POOL (`main.js:2384`). *Measured:* the button stays disabled for 165–191 s (`ve-rhythm.json` `until #evolve-btn:not([disabled]) took 165.25`; `ve-breed.json` 191 s). Progress shows only as the button's own text, "breeding 3/10…" (`main.js:1371`). Go back to PERFORM and the only sign of the job is the pulsing amber E of the wordmark. There is no cancel. ⚡ evolve from this took 22.85 s (`vp-lock.json`), and its only signal was a 4.2 s toast.

### F6. Booth
Attract starts after 60 s idle. Any key, touch, wheel or MIDI note hands the instrument over. ⇧Esc or ⋯ › New visitor reloads the page (`main.js:3465`): a full boot, then the warm start. During all of this the visitor can still reach ⋯ (Reset taste profile…, Load taste profile, Booth mode on/off, Watch the films ↗), every tab, and help's "watch PERFORM in depth".

### F7. Narrow windows
With a fine pointer at ≤999 px, a CSS veil says "A little wider" (`style.css:4862`). This is good: nothing resets. With a coarse pointer and a shorter side under 620 px, the handheld gate never boots the engine. Neither gate covers a coarse-pointer window whose shorter side is 620 px or more and that is under 1000 px wide, such as a tablet in portrait at 768×1024. That window gets the layout the narrow gate's own comment calls broken.

---

## 3. Findings (ranked)

### CO1 — "pick" has five names, and PICKS counts things the meter doesn't — **P1**, consistency/understandability
- **Evidence.** The words for one act: warm start "eighteen A/B votes" (`index.html:725`); result toast "18 preferences learned" (`main.js:18833`); menubar "PICKS", tooltip "A/B picks you've made" (`index.html:87`); PATCH strip "pick a", tooltip "Vote: A wins" (`:543`); EVOLVE "choose a" (`:586`); help "←/→ vote · ⌘Z take back a vote" (`:792`); EVOLVE's empty state and the handheld gate "Keep the one you'd reach for" / "keep one" (`main.js:2323`, `index.html:843`); commit duel "this one" (`:758`); PERFORM "counts as a pick" (`perform.js:763–769`). The counter: `rateRow` and `cutRow` call `aheadAdd` (`main.js:5718`, `:5455`), so PICKS rises on a star or a cut, but the EVOLVE meter counts only `duelsSinceFit`. In `ve-keep-04-budget.jpg` PICKS reads 21 and the meter "4 more picks and it redraws your taste map". After a cut (`ve-keep-07-toast3.jpg`) PICKS reads 22 and the meter still says "4 more picks". The meter's own copy uses PICKS's number (`renderTeach`, `main.js:2318`: "`<b>${n}</b> picks in`"), so the sentence and the pips disagree in one line. PERFORM's offer answers go the other way: they are not counted ahead (no `aheadAdd`). PICKS moves only when the engine replies, 8 s after a Take (`perform.js:737`, `:767`), which breaks the rule the changelog just shipped ("PICKS counts a pick the moment you make it").
- **What the player experiences.** They rate a patch and PICKS goes up, but "4 more picks" doesn't move. They take an offer in PERFORM and PICKS stays put for eight seconds. They cannot tell whether a star is a pick.
- **Principle.** One concept, one word, one count.
- **Recommendation.** Two words, each defined once. *Pick* is any choice between two sounds: an EVOLVE pair, the PATCH strip, the warm start (3 picks = 18), a PERFORM offer taken or passed, and the commit duel. *Taught* is everything the model learns from, including stars and cuts. Rename the menubar counter to **TAUGHT 22**, with the tooltip "picks, ratings and cuts the model has learned from. Every 6 picks it refits." Keep the meter in picks, and make its first number the pick count, not PICKS's. Copy changes:
  - "eighteen A/B votes" → "eighteen picks"
  - "18 preferences learned" → "18 picks learned from your three"
  - "choose a / choose b" → "pick A / pick B"
  - "Vote: A wins" → "Pick A"
  - help "vote" → "pick", "take back a vote" → "take back a pick"
  - "Keep the one you'd reach for" → "Pick the one you'd reach for"
  - the handheld gate's "keep one" → "pick one"

  Call `aheadAdd` on a PERFORM take or pass at the moment of the gesture, and `aheadDrop` on "don't count it".
- **Effort** M (copy plus about 20 lines). **Confidence** high.

### SH1 — Clicking a bank row always switches to PATCH — **P1**, understandability/consistency
- **Evidence.** `bankRow` click handler: `openOnBench(r.id); showView("play");` (`main.js:5395–5400`). A preset row that is already in the bank does the same (`:5558`). EVOLVE's "⌖ bench" also switches (`:11414`, `:11420`). By contrast `[`/`]` (`stepBank`, `:3120`) and a TASTE map click (`:17319`) open the patch *in place*, and so does the warm start. PERFORM is the default home (docs/notes/ui-hierarchy.md: "PERFORM is the default view"). The tour narrates "Click it, and it's yours to play" over a jump into PATCH (`to-bank-04-padrow.jpg`).
- **What the player experiences.** Browsing sounds in PERFORM, the player clicks a row to try it and loses the named controls, the pads and the XY pad. They are now in the densest view, and PERFORM's state (offer in B, Wander) is out of sight. The same patch opened with `]` leaves them where they were. The click's behaviour depends on the view.
- **Principle.** A selection must not navigate. The same gesture should do the same thing everywhere.
- **Recommendation.** A row click opens the patch **in the current view**: under the hands in PERFORM, on the bench in PATCH, and in EVOLVE and TASTE it loads the live voice without switching. Keep the jump to PATCH as an explicit act: a double-click on the row, or a small "↗ patch" on the hovered row with the tooltip "Open in PATCH". Do the same for EVOLVE's "⌖ bench", relabelled "↗ patch". Drop the "X on the bench" toast (SH5).
- **Effort** S. **Confidence** high.

### CO2 — ⌘Z does a different thing in every view, and sometimes something invisible — **P1**, consistency/quality
- **Evidence.** In `main.js:3818–3829`, ⌘Z calls `retractVote()` only when `currentView === "evolve"` and a vote is still inside its 7 s window. Otherwise it calls `doUndo()`, the PATCH edit undo, in every view. The PATCH strip's pick buttons call the same `choose()` (`main.js:4477–4478`) and show the same "NOT WHAT I MEANT" toast, but ⌘Z in PATCH undoes the last knob edit instead of the pick. In EVOLVE, ⌘Z pressed 8 s after a pick undoes a PATCH edit the player can't see. PERFORM's Take has its own "DON'T COUNT IT" window of 8 s (`perform.js:737`), not the 7 s `UNDO_WINDOW_MS`, and ⌘Z can't reach it. A pass has no undo at all. A star has no undo. A cut has UNDO. A save is undone by clicking again. A retired undo reads "IN THE LOG", a disabled button that still looks like one (`main.js:2709`, and the older still `view-taste/dry/vt-open-02-best.jpg`).
- **What the player experiences.** ⌘Z after a pick in PATCH silently reverts a filter sweep they made a minute ago. ⌘Z in EVOLVE a moment too late changes a patch they aren't looking at. "Undo" appears under four labels with three different time windows.
- **Principle.** One undo model. An undo must say what it undid, and must not act on what the player can't see.
- **Recommendation.**
  - (a) ⌘Z first retracts the newest still-pending *teaching act* in any view: a pick from any surface, a cut, a take, a star. That act is the one whose toast is on screen. Only after that does ⌘Z reach edit undo.
  - (b) Outside PATCH, edit undo still works but always announces itself: "Undid cutoff 13 kHz → 1.78 kHz on Glass Pad (PATCH)", with `replace: "undo"`.
  - (c) One window for every teaching act: 7 s (or make PERFORM's 8 s the shared constant).
  - (d) One button label shape: **UNDO** for every teaching act; keep the specific verbs ("PUT IT BACK", "PLUG IT BACK IN") for structural edits, where they say something UNDO doesn't.
  - (e) When a window closes, remove the button instead of showing a dead "IN THE LOG".
  - (f) Give stars an undo too: "Noisy Pad rated 4★ · UNDO" restores the previous rating.
- **Effort** M. **Confidence** high.

### SH2 — After clicking a view tab, EVOLVE's ←/→ changes the view instead of voting — **P1**, quality/keyboard
- **Evidence.** `wireArrowNav(".viewtabs", …, {activate: true})` handles ←/→ on the tablist and calls `e.stopPropagation()` (`main.js:3022`), so the document-level handler that votes (`main.js:3930–3935`) never sees the key. Clicking the EVOLVE tab leaves focus on that tab (`t.onclick` at `:2986` does not blur). The comment at `:3899–3905` says a focused control "keeps only the keys it uses", and a tab does use the arrows. So the first → after arriving in EVOLVE by mouse opens TASTE. The same holds for TASTE's sub-tabs and for PERFORM's pads if they are ever given arrows.
- **What the player experiences.** They click EVOLVE, listen with 1 and 2, press → to pick B, and land on the TASTE map. The pick is not made.
- **Principle.** A view's primary keys must work on arrival, however the player arrived.
- **Recommendation.** On a pointer click (`e.detail > 0`), a view tab activates and then moves focus to the view's own landmark (`#view-evolve`, `tabindex=-1`, focused with `preventScroll`). Arrow navigation stays for keyboard users who reach the tab with Tab. Also register EVOLVE's ←/→ and 1/2 in the capture phase when focus is on `.viewtab`.
- **Effort** S. **Confidence** high (code path). Not reproduced in a browser (brief constraint).

### SH3 — Long jobs have no home in the shell, and the one lamp means three things — **P1**, responsiveness/understandability
- **Evidence.** Only the job's own button shows its progress: "breeding 3/10…" / "placing in the pool…" (`main.js:1371–1374`), 165–191 s in rehearsal (`ve-rhythm.json`, `ve-breed.json`). The start toast "breeding a generation toward your taste…" lasts 4.2 s (`:5165`). ⚡ evolve from this (22.9 s, `vp-lock.json`) gets a 4.2 s toast and nothing else. Neither job can be cancelled. The wordmark's E (`wm-lamp`) is lit for a fit (`:18827`, `:5164`, `:12040`) and for "● it just learned" (`:2341`). `teachLearned()` runs when the fit is **sent** (`settleFit`, `:5127`), so "it just learned — see what changed ▸" and a link to TASTE appear about 2.7 s before the new map exists (fit time from the comment at `:5093`). The first `fitted`/`refined` reply to arrive clears the lamp for every job (`:1358`, `:1377`), even if another is still running. PATCH's next-step chip "It's learned something. Breed a generation ▸" switches view *and* starts the three-minute job (`:2384`). PERFORM's measuring (9–12 s after a first open) never lights the lamp.
- **What the player experiences.** They start a generation, go back to playing, and have no way to know how far it has got, how long is left, or whether it's still running. A chip in PATCH moves them to another view and commits them to a job they can't stop. They are told the model "just learned" before it has.
- **Principle.** Long work shows progress where the player is, can be cancelled, and never blocks. Status says what is true.
- **Recommendation.**
  - A **job slot in the menu bar**, to the right of GENERATIONS: "⚡ breeding 3/10 · 0:41 ✕" (✕ cancels after the current child; the worker already breathes between steps). The same slot serves ⚡ evolve from this ("⚡ evolving Glass Pad · 0:12 ✕") and the refit ("refitting…"). The E lamp is lit exactly while the slot is non-empty, and its tooltip names the job.
  - Show "● it just learned" when `fitted` arrives, and say "refitting your taste map…" until then.
  - The next-step chip starts the breed **without switching view** and says "breeding — keep playing".
  - Make the lamp a reference count: set it per job, clear it per job.
- **Effort** M. **Confidence** high.

### CO3 — Amber and green carry more meanings than the colour law allows — **P1**, consistency
- **Evidence.** The law is stated in `style.css:1–14`: "green = audio, amber = the model's mind … NO OFF-SYSTEM COLOUR". The audit in §4.1 lists about 20 uses. The contradictions a player can see:
  - The forecast line uses **green for hit, amber for miss** (`style.css:3058–3059`), but bank ▲ and belief "toward" are **amber for up/good**, with **red** for down/away (`:2504–2505`, belief tooltip `main.js:9308`). So amber means "the model was wrong" in EVOLVE and "better" in PATCH.
  - The **alarm** (engine crashed, save failed) is a filled amber bar (`style.css:3753–3769`), visually the same family as the one filled amber CTA, ⚡ evolve from this (`:795`). A failure looks like an invitation.
  - **Renamed/preset names are amber** (`.bi-name.custom`, `style.css:1659`). After the warm start, all nine warm presets have amber names, so the three saved ones can't be told from the six passed over except by a 2 px silk rail (`shframes/tour-108.jpg`, bank: Acid Line, Sea Change, Glass Rain, Gated Snare all amber). In `ve-keep-04-budget.jpg` the saved Pump Room, Glass Rain and Sea Change are amber, and the just-saved Noisy Pad is white.
  - **On/lit dock toggles are amber** (HOLD, UNI, ARP, SYNC, TALL, `style.css:377`), though none of them is the model's.
  - **Active tab:** green for the views (`:261`), amber for the bank tabs (`:473`) and TASTE's sub-tabs (`:1404`).
- **What the player experiences.** They can't learn the colours. Amber on HOLD, on a name, on a failed save and on a bad forecast can't all mean "the model".
- **Principle.** A colour contract is only useful if it has no exceptions.
- **Recommendation.** Adopt the contract in §4.1 (Recommended contract):
  - Forecast hit/miss becomes an icon, not a colour: "✓ expected 68%" / "✗ surprise 42%", both amber (it is the model speaking).
  - Belief and ▲/▼ stay amber/red.
  - The alarm gets a red rail and red ⚠ on the dark toast surface: condition = red.
  - Custom names go silk. Saved rows get a clearer silk marker: a filled floppy plus the rail.
  - Dock toggles that are "on" use a lit **green** LED dot plus a silk label, since they change the sound.
  - Every active tab uses one treatment. Recommendation: silk text on a raised plate, no phosphor. Or at least make the bank and TASTE sub-tabs match the view tabs.
- **Effort** M. **Confidence** high.

### SH4 — First run: PATCH flashes first, the keys play behind the modal, and PERFORM measures for ~10 s — **P2**, understandability/responsiveness
- **Evidence.**
  - The HTML marks PATCH active (`index.html:73`). The warm start opens 500 ms after the veil drops (`main.js:1095`). `to-first-00-start.jpg` shows PATCH behind the dialog, with the coach pill behind the veil.
  - The note handler doesn't check for an open modal (`main.js:3817ff`), so pressing A while the warm start is open plays whatever pool patch is on the bench, not a card.
  - After *teach it*, PERFORM still reads "measuring…" 8.5 s later and has "3 of 6 controls" by about 14 s (`to-first.json` log `perform` at 15.32; `to-first-04-end.jpg`). The first pick was already loaded and heard during the warm start, so there were 10–25 s in which it could have been measured.
  - The returning-view memory restores only PERFORM (`main.js:3336–3337`). A player who left in EVOLVE or TASTE comes back to PATCH.
- **What the player experiences.** A dense rack for a moment, then a dialog. Pressing a key to hear a card plays an unrelated sound. Then the controls they were told to turn are dead for about ten seconds.
- **Principle.** The first minute should have no dead controls and no surprises.
- **Recommendation.**
  - Make PERFORM the HTML default tab. Restore any saved view, not only PERFORM.
  - While the warm start is up, route note keys to the focused card's preset (or swallow them, and show "press ▶ on a card to hear it" once).
  - Start PERFORM's measurement of every card the player has ▶'d, in the background, during the warm start (reuse the booth `prewarm` path, `main.js:3443`). The pick they open on is then usually measured already. Target: controls live within 1 s of *teach it*.
- **Effort** M. **Confidence** high.

### CO4 — "Hear this patch" has seven forms, and two of them do something else — **P2**, consistency
- **Evidence.** Bank ▶: a bare glyph that plays the audition phrase. Warm ▶: a square outlined button. PATCH ▶: a round "xport" button (`index.html:298`). EVOLVE: "▶ SAMPLE 1", an hw-btn. Commit duel: "▶ play", a util-btn. The PATCH strip's "▶ A · Soft Stab" **loads A into the live voice** instead of playing the phrase (`index.html:541` tooltip). A preset ▶ **also inserts the preset into the pool**, which can retire a patch ("Hand-made. ▶ loads one into the pool.", `to-dock-01-drawer.jpg`; toast "Loaded to play it. The patch it liked least was retired…", `main.js:18723`). Space plays the phrase of the bench patch, except in EVOLVE, where it doesn't play A or B.
- **What the player experiences.** The same triangle means "play the phrase", "put it under my keys" or "add it to the pool (and delete something)", depending on where it is.
- **Principle.** Same symbol, same behaviour.
- **Recommendation.**
  - ▶ always means "play its phrase; press again to stop", in one style: the bank's bare glyph plus the lit "playing" state, in green. EVOLVE keeps its large button with the label "▶ PHRASE 1".
  - The PATCH strip's side buttons become "A · Soft Stab ⌨" with the tooltip "play A on the keys".
  - A preset ▶ should render without inserting. If the engine can't do that, label it "▶ adds to pool" and never retire a patch for a preview: preview into a scratch slot.
  - In EVOLVE, Space plays whichever side is live-selected.
- **Effort** M (the preset part is L if it needs the engine). **Confidence** high.

### CO5 — *Save*, *keep*, *commit*, *take* and *export* overlap — **P2**, consistency
- **Evidence.**
  - Bank save is a 12 px floppy icon (`main.js:5199`), but every text says "press **save**" (empty state `:5298`; tour `:5874`; help `index.html:816`).
  - "Save taste profile" in ⋯ is a file download (`index.html:92`). "saved 3.1s take" is a WAV download (`main.js:4327`, `to-dock-04-saved.jpg`).
  - "Your three are saved" means pinned. "Everything autosaves" means persistence.
  - *Keep* is PERFORM's pad (write the performed state to the bench). In EVOLVE copy and the handheld gate, *keep* means pick. In help, "save tells the bank to keep it".
  - *Commit* (PATCH) makes a new pool patch: "committed as patch #51" (`vp-keep.json`).
  - "Save/Load taste profile" sits next to "Export/Import a patch" in the same menu.
- **What the player experiences.** "Saved" appears after a download, a pin and an autosave. The bank's instruction names a button that has no such word on it.
- **Principle.** One verb per operation.
- **Recommendation.**
  - **save** = pin to My patches only. Give the button its word on approach: "SAVE"/"SAVED" beside the floppy, as CUT already appears.
  - Files are **download**/**open**. In ⋯: "Download taste profile", "Open a taste profile…", "Download this patch", "Download as image…", "Open a patch…". The REC toast becomes "Downloaded auracle-Acid_Line.wav · 3.1 s".
  - **keep** stays PERFORM's alone; replace every other "keep" with *pick* or *save*.
- **Effort** S. **Confidence** high.

### SH5 — "X on the bench" toasts on every open, including right after the warm start's result — **P2**, quality
- **Evidence.**
  - The bench reply toasts `${name} on the bench` unless the id is in `quietBench` (`main.js:1487`). *teach it* opens an already-heard first pick through `openOnBench(known)` without adding it to `quietBench` (`:18767`; the adds are at `:18800` and `:18819`). So the case the screen asks for ("Play them") produces the toast. It is visible in the recorded film: `shframes/tour-108.jpg` shows the result toast with "+1", and `tour-112.jpg` shows "Acid Line on the bench".
  - A TASTE map click toasts "X selected — it's on the workbench and under your fingers" (`:17320`), then the bench reply toasts again.
  - The toast has no `replace` key, so stepping with `]` queues one toast per step (up to `MAX_TOASTS`).
  - *bench* is not a word used anywhere a player looks. The views are PERFORM and PATCH.
- **What the player experiences.** A redundant, jargon toast after every open. It often arrives after the fact, in PERFORM, where nothing is called a bench.
- **Principle.** A toast is news; the header already says the name. Use the view's own words.
- **Recommendation.** Delete the generic "on the bench" toast. The header, dock label and live row already name the patch. Keep a toast only when the open was asynchronous and took more than 1 s: "Opened Acid Line" with `replace: "open"`. Remove "bench" and "workbench" from user copy (see CO6).
- **Effort** S. **Confidence** high.

### SH6 — The bank re-sorts under the player, and the live row scrolls away — **P2**, quality
- **Evidence.** Before the first fit the rows are in pool order with "–". After `fitted` the list re-sorts by prediction, and Acid Line, the live patch that was the top row, is no longer on screen (`to-first-01-picks.jpg` → `to-first-04-end.jpg`). `renderBank` scrolls only on an explicit `bankScrollTo` (`main.js:5306–5316`). The same happens after every refit and generation. Auto-names are "relative to the pool, so a patch can be renamed as the pool fills" (`main.js:2911–2914`), so a row can change both its place and its name.
- **What the player experiences.** They look for the sound they are playing and it has moved, possibly renamed.
- **Principle.** Don't move what the player is holding.
- **Recommendation.**
  - After any re-sort, keep the live row at the same screen y (anchor scroll by id), or scroll it into view with `block: "nearest"`.
  - Animate reordering (FLIP, 200 ms; `prefers-reduced-motion` → none).
  - Freeze a patch's auto-name once it has been shown on the bench, heard, starred or saved.
- **Effort** S (scroll anchoring), M (names). **Confidence** high (scroll), medium (renaming frequency).

### CO6 — "The patch in your hands" has many names, ids leak, and one prediction has two formats — **P2**, consistency
- **Evidence.**
  - Names for the current patch: "bench", "workbench", "live", "the current patch" (help), "the patch you're on" (help), "under your fingers" (toasts), "no patch loaded", "unsaved patch" (`main.js:2898`), and in tooltips "⌖ bench", "← bench".
  - Ids are hidden in the bank unless ⋯ › Show measurements is on (`style.css:1666`), yet they appear in "Cut Soft Wash #9." (`main.js:5456`), "committed as patch #51", "#N isn't in the bank any more" (`:1194`) and the lineage ("#9 → #59").
  - Prediction: bank "59%", PATCH header "MODEL'S GUESS 0.59" for Sea Change (`to-bank-04-padrow.jpg`), TASTE "glow".
- **Recommendation.**
  - Call the current patch "**the patch you're playing**" in help and tooltips, and use only the name in toasts.
  - Retire "bench" from all UI copy: "⌖ bench" → "↗ patch", "← bench" → "← back to Glass Pad".
  - No "#id" in any toast, the lineage or the header unless engineer mode is on; use names.
  - One format for the prediction, **59%**, everywhere (PATCH: "model's guess 59%").
- **Effort** S. **Confidence** high.

### CO7 — Bank, pool and evolution are one concept with three names, and eviction has five verbs — **P2**, understandability
- **Evidence.**
  - A preset tag reads "IN BANK" when it means in the evolution pool (`main.js:5545`), although the whole rail is "BANK".
  - "Gen 1: 10 new patches in the bank." (`ve-breed.json` toast), "▶ loads one into the pool", "evolution — the living bank" (tour), and "Every patch the model is weighing".
  - Eviction verbs: *retired* ("…were retired to make room", `main.js:2881`), *replaced* (tour, save tooltip), *evicted* (guide), *made room*, and *gone* ("that patch is gone").
  - The bank head has two doors to the same tour, "?" beside "3/10 saved" and "WHAT'S THIS?" under the note. The "?" sits beside the save budget but opens at *presets*.
- **Recommendation.**
  - **Bank** = the rail. **Pool** = the EVOLUTION tab's contents: tab label "pool 40", with the note "Every patch the model is weighing — it breeds from these."
  - Preset tag "in pool". Generation toast "Gen 1: 10 new patches in the pool — 10 it liked least were replaced."
  - One eviction verb, **replaced**.
  - One door: keep WHAT'S THIS? and make the head "?" open the save-budget step ("my patches — how you keep one").
- **Effort** S. **Confidence** high.

### CO8 — Button families and toggles don't follow a rule — **P2**, consistency/quality
- **Evidence.**
  - PATCH's BELIEF and MAP set `aria-pressed` but **no CSS draws an on-state**. The only `[aria-pressed]` rule is the z-index lift (`style.css:3704`), and only dock toggles get `.lit` (`main.js:4021–4242`). CHAIN and DETAIL change their label instead.
  - "got it" is an hw-btn in help and the bank tour, but a util-btn in PATCH's bench tour (`index.html:386`).
  - *skip* means "deal another pair" (EVOLVE "skip ↻", PATCH "↻" with no word) and also "dismiss onboarding" (warm start SKIP, tour skip).
  - EVOLVE POOL is an outlined hw-btn small in amber text, and looks like "got it". ⚡ evolve from this is the only filled amber button, though both breed.
  - Toolbar case is mixed: "gld", "vol", "midi" in lowercase mono next to "HOLD UNI ARP SYNC" in caps.
- **Recommendation.** Write the family rule (§4.2) into `style.css` next to the tokens:
  - hw-btn = the view's primary acts.
  - util-btn = tools and settings.
  - `.util-btn[aria-pressed="true"]` = one shared "on" style (green LED dot plus silk text).
  - pads are PERFORM only.
  - chips are status that can be clicked.

  Rename the deal verb "another pair ↻" everywhere and keep *skip* for onboarding. Make EVOLVE POOL the same filled primary as ⚡ (both are the view's one breed act). Spell "glide" and "volume" as full words, or make all dock labels mono lowercase.
- **Effort** S. **Confidence** high.

### CO9 — Fourteen message channels, with no rule for which carries what — **P2**, consistency/understandability
- **Evidence** (full list in §4.3). Long-job progress lives in three places: the EVOLVE button text, a 4.2 s toast, and PERFORM's status line. The first-note instruction appears four ways: first steps "Play a key: A to L, or tap the keybed" (`perform.js:1562`), coach "Press A–L or tap a key — you're already holding a synth." (`main.js:2408`), next-step "Play it first — press A, or tap a key below ▸" (`:2367`), and the warm-skip toast "Press a key to hear it…" (`:18752`). The first two are on screen together in `to-first-01-toast.jpg`. Toasts mix lowercase starts ("saved 3.1s take", "no patch on the bench", "profile loaded — …") with sentence case ("Saved Noisy Pad — …").
- **Recommendation.** A channel contract (§4.3): toast = the result of the player's own gesture (with undo if it taught); alarm = a condition that persists until fixed; the view's status line = what that view is doing now; the menu bar job slot = long work (SH3); the coach and first steps = onboarding, only one at a time. Suppress the coach while PERFORM's first steps are showing. Sentence case for every toast.
- **Effort** M. **Confidence** high.

### CO10 — Focus, cursor, live and picked share one green, and the picked state has two colours — **P2**, quality/accessibility
- **Evidence.**
  - The focus ring is a 2 px green outline on everything (`style.css:3212–3260`).
  - The live row has a green border plus rail (`:507`). The keyboard cursor row is *also* green (`.bank-item.kbd` at `:3941` overrides the silk-dim at `:512`).
  - The EVOLVE live-selected card, the PATCH strip's live side and PERFORM's focused control are all green.
  - Two rows with identical green outlines, one the cursor and one live: `ve-keep-04-budget.jpg` (Noisy Pad and Sea Change).
  - A picked warm card is amber (`:3805`); a picked EVOLVE name flashes green (`:3627`).
- **Recommendation.**
  - **live (sounding)** = green left rail plus a green ▶ glyph.
  - **cursor/selected** = silk 1 px border.
  - **focus** = a 2 px ring offset 2 px, green but always *outside* the element, never a border recolour.
  - **picked** = amber everywhere, since it is what the model hears: EVOLVE's chosen flash turns amber.
- **Effort** S. **Confidence** high.

### CO11 — Keyboard: conflicts, dead keys and gaps, discoverable only in help — **P2**, keyboard parity/understandability
- **Evidence.** Table in §4.4. In EVOLVE, 1/2 audition while 3/4/5 do nothing silently (elsewhere 1–5 rate) (`main.js:3930–3945`). `[`/`]` in EVOLVE and TASTE open patches on an off-screen bench and toast each one. There are no keys for PERFORM's six pads, the PATCH strip's picks, EVOLVE's skip, or switching views. On-screen hints exist only on EVOLVE's buttons (kbd 1/2/←/→) and the octave buttons. Help lists 1–5 as global and then overrides it for EVOLVE (`index.html:791–792`).
- **Recommendation.**
  - Add view keys **F1–F4**, or **⌥1–4** (1–5 are taken), with the tooltip on each tab.
  - In EVOLVE, **↓** = another pair. In PATCH the strip gets **⇧←** / **⇧→** for pick A/B and **⇧↓** for another pair (plain arrows belong to the rack, and **.** is already fit-selection).
  - PERFORM pads get keys from outside the note rows: **Space** = Peek while held (in PERFORM it replaces the phrase audition), **Enter** = Take, **\\** = Offer, **,** = Back, **.** = Keep, **Tab** stays focus. Freeze stays on the pad. Decide these in one keymap table for the whole app, not per view.
  - Print the key in each pad's corner, as EVOLVE does. In EVOLVE, show "1–5 rate" as disabled in help.
  - `[`/`]` in EVOLVE step the *pair*, not the bench.
- **Effort** M. **Confidence** high (code). Key choices need a keymap decision.

### SH7 — Booth mode leaves the visitor every exit it hides elsewhere — **P2**, quality
- **Evidence.** In booth mode the film chip is hidden because "a link out of the instrument is a visitor walking away from it" (`main.js:18913`). But ⋯ › Watch the films ↗ (`index.html:116`) and help's "watch PERFORM in depth" stay live, and so do ⋯ › Reset taste profile…, Load taste profile, Booth mode (a visitor can turn it off) and the tabs into PATCH. New visitor reloads the page (`main.js:3465–3470`): a full boot, then a modal warm start for each person.
- **Recommendation.** With `html.booth`, hide film links, file items, Reset and the Booth toggle behind a staff gesture: long-press ⋯ for 2 s, or ⇧⋯. Show only New visitor and Keyboard map. Make New visitor an in-place reset (the engine can clear the profile without a reload), and skip the warm start in booth mode or turn it into a timed, non-modal card that attract can cover.
- **Effort** M. **Confidence** high.

### SH8 — A bank row doesn't say "saved" at a glance, and "?" means two things — **P2**, understandability
- **Evidence.** Saved differs from unsaved only by a 2 px silk left rail (`style.css:517`) and the floppy going from silk-dim to silk (`:641`). Amber names (CO3) are read as the marker instead (`ve-keep-04-budget.jpg`: the just-saved Noisy Pad is white, and the unsaved pool rows from presets are amber in `tour-108.jpg`). The head's "?" sits beside the save count. The origin glyph ▤ renders as a small green square, which is also the only mark on the warm-start picks.
- **Recommendation.** For a saved row: a filled floppy in silk, the word SAVED on approach, and the rail. For "?" see CO7. Make ▤ the preset glyph only in the presets tab; in the pool use "from preset" in the tooltip and a hollow ▢.
- **Effort** S. **Confidence** high.

### SH9 — Tablets in portrait slip between the two gates — **P2**, quality
- **Evidence.** The handheld gate needs `pointer: coarse` and a shorter side under 620 px (`index.html:34–36`). The narrow gate needs `pointer: fine` and a width of 999 px or less (`style.css:4862`). A coarse-pointer window whose shorter side is 620 px or more and that is under 1000 px wide gets neither. That includes a tablet in portrait at 768×1024, the case the menubar comment names (`style.css:328–336`). The narrow gate's own comment describes the layout it gets: "PERFORM's pads were half under the keybar with XY off the bottom". CHANGELOG [Unreleased] says "under ~860 px"; the CSS says 999.
- **Recommendation.** Make the narrow gate pointer-agnostic (`@media (max-width: 999px)` for any pointer that is not `html.handheld`), with the copy "Turn your tablet sideways, or widen the window." Fix the changelog number.
- **Effort** S. **Confidence** medium (no tablet evidence).

### SH10 — The ⋯ menu mixes four kinds of item and hides state in its labels — **P3**, understandability
- **Evidence.** `to-header-02-menu.jpg` has 12 items: files (5), a tool (Scope & analyser…), onboarding (Re-run the three-pick warm start), a destructive action (Reset taste profile…), modes (Show measurements, Booth mode) and help (2). Mode state is shown by rewriting the label ("Show measurements: on", `main.js:3352`), with no check glyph. The ellipsis use is inconsistent: "Load taste profile" opens a picker without "…". "warm start" is internal jargon.
- **Recommendation.** Group with headers: **Files** (Download taste profile · Open a taste profile… · Download this patch · Download as image… · Open a patch…), **Tools** (Scope & analyser…), **Modes** (✓ Show measurements · ✓ Booth mode), **Start over** (Pick three favourites again… · Reset taste profile…), **Help** (Keyboard map ? · Watch the films ↗). Give modes a ✓ column.
- **Effort** S. **Confidence** high.

### SH11 — The help card is one long PATCH-heavy page under three names — **P3**, understandability
- **Evidence.** Titled "HOW TO PLAY" (`index.html:782`); "Keyboard map & gestures" in ⋯ and the tooltip; "keyboard map" in the tour. Four of its eight sections are about the rack, canvas and node bank (`to-header-01-card.jpg`). EVOLVE and TASTE get one paragraph ("teaching it"). It says "Commit edits with 'my edit is better'", but COMMIT now opens the which-is-better duel and the checkbox is only the express path. Only its film link knows which view it was opened from (`pointHelpFilm`).
- **Recommendation.** One name, "Keys & gestures". Open it on a tab per view (PERFORM · PATCH · EVOLVE · TASTE · Keys), preselecting the current view. Fix the commit sentence: "COMMIT plays your edit against the original and asks which is better; tick 'my edit is better' to skip that."
- **Effort** M. **Confidence** high.

### SH12 — Dock details that move or mislead — **P3**, quality
- **Evidence.** The keybed narrows about 8 px when REC becomes STOP and gld shows a value (`to-dock-01-drawer.jpg` vs `to-dock-03-toast.jpg`, C6 at x = 1632 → 1625). "saved 3.1s take" (CO5). The arp drawer covers the bank's last rows (`to-dock-01-drawer.jpg`). The toast lane doesn't step around the drawer because `#arp-ctl` is a column (`main.js:2649`), but the bank isn't reserved at all.
- **Recommendation.** Give `#glide-val` and `#rec-btn` fixed widths in `ch` ("370 ms" and "◼ STOP" fit 6ch/7ch). Consider the arp drawer anchored over the keybed's left third rather than over the bank.
- **Effort** S. **Confidence** high.

---

## 4. Consistency audit

### 4.0 Concept table (every concept seen in more than one place)

| Concept | PERFORM | PATCH | EVOLVE | TASTE | Shell (menu bar, bank, dock, dialogs, help) | Inconsistency |
|---|---|---|---|---|---|---|
| **Patch** (the one playing) | title; "(taken offer)" suffix | header name; "no patch loaded" | — (duel cards are candidates) | map ring; toast "…on the workbench and under your fingers" | dock `live-label`; bank `.live` row; toast "X on the bench"; help "the current patch", "the patch you're on" | 7 names (CO6); `#id` shown in toasts only (CO6) |
| **Bank** | — | — | "Gen N: … in the bank" | "Click a dot to open it" | rail "BANK"; tabs evolution/my patches/presets; preset tag "IN BANK" (= in pool) | bank = rail = pool (CO7) |
| **Pool / evolution** | — | nextstep "Breed a generation" | EVOLVE POOL; "EVOLUTION — what each generation actually did" | "40 patches" | tab "EVOLUTION 40"; note "Every patch the model is weighing"; boot "forty patches" | three names (CO7) |
| **Offer** | Offer pad; B strip "no offer — press Offer…"; "Took B" | — | — | TRUST "offers you took or passed" | help "Offer grows a new version…into B" | consistent; keep |
| **Pick** | Take/pass "counts as a pick"; "don't count it" | strip "pick a"/"pick b", tooltip "Vote: A wins" | "choose a/b", "N picks in", "not what I meant" | — | PICKS counter (also counts stars and cuts); warm "A/B votes", "18 preferences"; commit duel "this one"; help "vote"; handheld "keep one" | five words, two counts (CO1) |
| **Save** | Keep (different) | commit (different) | — | — | floppy icon (no word); "3/10 saved" vs toast "4/10 slots used"; ⋯ "Save taste profile" (download); "saved 3.1s take" (download) | verb overloaded (CO5) |
| **Keep** | pad Keep = write the performed state | — | "Keep the one you'd reach for" (= pick) | — | help "save tells the bank to keep it"; handheld "keep one" | three meanings (CO5) |
| **Cut** | — | knob addr `#cut` (cutoff) in engineer text | bank row CUT | — | row "CUT" on approach, red on hover; tour "cutting with ✕"; toast "Cut X #9. UNDO" | ✕ vs CUT (still open from musical-instrument-review §4.4) |
| **Lock** | — | knob dot, module ▢, LOCK KNOBS / LOCK WIRING / CLEAR LOCKS | — | — | help "▢ locks it so evolution can't touch it" | consistent within PATCH |
| **Evolve / generation / ⚡** | — | "⚡ evolve from this" (filled amber); nextstep "Breed a generation ▸" | "evolve pool" (outlined); "breeding 3/10…"; lineage "gen 1⚡"; **"⚡ Surprise — it had this backwards"** | — | GENERATIONS counter; bank ⚡ glyph + "new"; help "a generation of ⚡" | ⚡ also used for a forecast surprise; evolve/breed/generation used interchangeably; two button styles (CO8, SH3) |
| **Style** | — | "in your 1st style" | style badge on cards ("● slow-blooming sweeps") | STYLES tab, chips, rename | — | "1st style" (ordinal) vs named style: use the name |
| **Forecast / trust** | — | "MODEL'S GUESS 0.59" | "Expected — it's getting you. 68%" (green) / "⚡ Surprise…" (amber) / "Toss-up…"; "◇ random pair — a fair test" | TRUST tab; "% sharper than chance" | skill line "calibrating · 2/20"; bank "59%" + bar | 0.59 vs 59% (CO6); hit/miss colours invert the belief colours (CO3) |
| **"measuring"** | "measuring how this patch moves…", knob "measuring…", "re-checking" | belief row "re-measuring…" (the model's guess for an edit) | — | — | — | one word for two different computations: PERFORM's control wiring and PATCH's utility recompute. PATCH should say "re-guessing…" or "updating the guess…" |
| **Undo** | Back (pad); "don't count it" (8 s) | ⌘Z edit undo; "PUT IT BACK", "TAKE IT OUT", "PLUG IT BACK IN", "SWITCH IT BACK IN" | ⌘Z retracts a pick; "NOT WHAT I MEANT" (7 s) | — | cut "UNDO" (7 s); star: none; retired button "IN THE LOG" | CO2 |
| **Hear it (▶)** | long-press a control = sweep ("Enter hears it") | round ▶ (phrase); strip "▶ A · name" (live load); preview "hear it here" | "▶ SAMPLE 1" | style chip ▶; map click opens | bank ▶; preset ▶ (inserts into pool); warm ▶; commit duel "▶ play"; Space | CO4 |
| **Hold / freeze** | Freeze pad | — | — | — | dock HOLD (latch) | resolved in [Unreleased]; keep |
| **Skip** | — | strip "↻" (no word) | "skip ↻" | — | warm "SKIP", tour "skip", commit duel "commit without teaching" | two meanings (CO8) |
| **Help entry** | "HOW THIS WORKS" button | node bank "?" | — | — | "?" (HOW TO PLAY), ⋯ "Keyboard map & gestures", bank "?" + "WHAT'S THIS?" | four doors, three names (SH11, CO7) |

### 4.1 Colour semantics (as built)

| Colour | Used for (evidence) |
|---|---|
| **Green `--phos-a`** | sound traces, scopes, keys pressed; active **view** tab (`style.css:261`); live bank row (`:507`); keyboard cursor row (`:3941`); preset cursor (`:713`); focus ring everywhere (`:3212ff`); EVOLVE live-selected card (`:1244`); PATCH strip live side (`:4097`); EVOLVE chosen-name flash (`:3627`); **forecast hit** (`:3058`); OFFER pad (`:4617`); first-steps current step; film chip open; toast left rule (`:3719`); "edited ✎" origin; narrow-gate title |
| **Amber `--phos-b`** | the model: bank % and bar, TASTE map, belief row, lineage; **active bank tab** (`:473`) and **TASTE sub-tab** (`:1404`); **dock toggles on** (`:377`); stars lit; warm card picked (`:3805`); EVOLVE CHOOSE text; hw-btn small text (`:1359`: EVOLVE POOL, teach it, got it, next); the one filled CTA ⚡ (`:795`); **alarm bar** (`:3753`); **custom/preset names** (`:1659`); toast undo buttons (`:3743`); "my edit is better" check; nextstep chip; coach pill; **forecast miss** (`:3059`); **▲ up / belief toward** (`:2504`); PERFORM search controls ("can't reach, ask for it") |
| **Red `--led-red`** | ● REC on (`:3036`); cut, ✕ and delete on hover (`:665`, `:1848`, `:2681`, `:2855`); belief away (`:983`); ▼ down (`:2505`); budget full (`:4011`); LED |
| **Silk** | saved rail (`:517`); save glyph; everything neutral |

**Recommended contract** (one line each, to go in the `style.css` header):
- **green = sound and the patch you're playing** (traces, keys, live row, playing ▶, dock toggles that change the sound).
- **amber = the model** (predictions, belief, forecasts, anything a pick teaches, the model's primary act ⚡).
- **red = danger and failure** (destructive on approach, alarms, recording, below-par).
- **silk = you and neutral state** (saved, cursor, active tabs, names).
- **focus = a green ring outside the element, never a border recolour.**

Hit/miss and up/down are words or icons, never colour alone (also a colour-blind requirement).

### 4.2 Button families

| Family | Look | Used for today | Rule to adopt |
|---|---|---|---|
| **hw-btn** | 3D, 700 caps, 3 px cast | EVOLVE SAMPLE/⌖ BENCH/CHOOSE; `small` (amber text): EVOLVE POOL, ⚡ evolve from this (filled), teach it, help GOT IT, tour NEXT, commit duel THIS ONE | A view's primary acts and a dialog's confirm. One filled-amber primary per view (⚡ in PATCH, EVOLVE POOL in EVOLVE, Offer's equivalent in PERFORM). |
| **util-btn** | flat, micro caps | dock (HOLD UNI ARP SYNC TALL ◼ −/+ REC), ? and ⋯, PATCH toolbar segments, PATCH strip pick a/b/↻, warm SKIP, tour skip/back, bench-tour GOT IT, commit duel ▶ play, fit-hint reset | Tools, toggles and settings. Toggles need an on-state: `[aria-pressed=true]` gets the same lit style as `.lit`. Today BELIEF and MAP have none (CO8). |
| **pads (`.pf-pad`)** | large square | PERFORM only | Keep PERFORM-only. |
| **chips/pills** | 999 px radius | bank tabs, nextstep, style chips, arp chip, film chip, pick chip, `.inspect-btn` (⇄ circuit, skip ↻) | Clickable status. Bank tabs should become a segmented control like TASTE's tabs, since they switch content, not status. |
| **bare glyphs** | no chrome | bank ▶ ★ floppy CUT, warm ▶ (outlined), fc × | Row-level actions only, at a 24 px target minimum (already done). |

### 4.3 Message channels (who says what)

| Channel | Where | Lifetime | Carries today | Should carry |
|---|---|---|---|---|
| Toast `note()` | bottom right above the keybar, one at a time with +N | 4.2 s, or 7 s with an action | results, refusals (urgent), undo receipts, **also** job starts, "on the bench", onboarding nudges ("Want the fast lane?…", "Press a key to hear it…") | only the result of a gesture the player made, with undo if it taught; refusals |
| Alarm | top centre, filled amber | until resolved | crashes, save failures, unvetted patch | same, but red (CO3) |
| Menu bar | counters, skill, lamp E | persistent | counts; lamp = fit / evolve / "just learned" | counts plus the **job slot** (SH3) |
| Status line (per view) | PERFORM under the title; PATCH belief row; EVOLVE teach copy + forecast; TASTE caption | persistent | what the view is doing ("measuring…", "re-measuring…", "4 more picks…") | same; one per view |
| Button text as status | EVOLVE POOL "breeding 3/10…", warm "2 more" | while running | progress | move job progress to the job slot; keep the countdowns |
| Onboarding | coach pill, PERFORM first steps, PATCH bench tour and next-step chip, bank tour, node-bank tour, film chip, warm start | until done or dismissed | overlapping first-note instructions (4 variants) | one onboarding surface per view at a time; the coach hides while first steps show |
| Inline notes | bank note, B strip, spec dock, nb-status, pick chip, lineage | contextual | explanations | same |

### 4.4 Keyboard map across views

| Key | PERFORM | PATCH | EVOLVE | TASTE | Notes |
|---|---|---|---|---|---|
| a…' (notes), z/x | play / octave | same | same | same | global; good |
| Space | phrase of the current patch | phrase; held over the rack = pan | phrase of the **current patch** (not A/B) | phrase of the current patch | in EVOLVE it should play the live-selected side |
| 1–5 | rate the current patch | rate | **1/2 = hear A/B; 3–5 dead** | rate | conflict (CO11) |
| ←/→ | turn a focused control | move between rack controls (focused) | **pick A/B**, but eaten by the tablist after a tab click (SH2) | map cursor (focused) | |
| [ / ] | step the bank (opens in place) | step the bank | step the bank (off-screen open) | step the bank | EVOLVE: step the pair |
| m | save the cursor or current patch | same | same | same | no confirmation difference; fine |
| ⌘Z / ⇧⌘Z | edit undo (PATCH's) | edit undo | retract pick, else **invisible edit undo** | edit undo | CO2 |
| / | — | node-bank search | — | — | |
| Home . ⌘0 ⌘± ⇧1–9 | — | rack camera | — | — | |
| ? / Esc | help / close | same | same | same | Esc doesn't close the warm start |
| ⇧Esc | booth: new visitor | same | same | same | hidden chord; fine for staff |
| **Missing** | Offer, Take, Peek, Keep, Back, Freeze | strip pick A/B, another pair | another pair | tab switch | view switching has no key anywhere |

**Discoverability.** Key hints are printed only on EVOLVE's buttons and the octave −/+. Nothing on PERFORM's pads, the bank or the tabs shows a key. The help card is the only map (SH11).

### 4.5 Focus, selection and cursor states

| State | Current look | Where it collides |
|---|---|---|
| Keyboard focus | 2 px green outline, offset 2 | same colour as live and cursor |
| Live (sounding) patch | green border + 2 px green rail (bank); green border (EVOLVE card, PATCH strip) | cursor row is also green-bordered (`style.css:3941`) → two identical rows in `ve-keep-04-budget.jpg` |
| Bank keyboard cursor | green border (pool, `:3941`) / green border (presets, `:713`) | see above |
| Picked | amber card (warm start), green flash (EVOLVE name) | one act, two colours |
| Saved | 2 px silk rail | reads weaker than amber names |
| Hover | silk-dim border (bank), filled face (hw-btn) | fine |
| Active tab | green (views), amber (bank, TASTE) | CO3 |
| Toggle on | amber `.lit` (dock), **nothing** (PATCH BELIEF, MAP) | CO8 |
| Disabled with reason | Take/Peek "needs an offer" subtitle; PATCH `.tt` tooltips | good pattern; use it everywhere |

---

## 5. Keep (do not lose these in the fixes)

- **The toast lane's rules** (`main.js:2429–2477`): one lane, rects reserved and measured, one visible toast with a +N counter, a window that starts when the toast becomes visible, `replace` for later news, and `urgent` refusals that jump the queue and are never trimmed. This is the right base for CO9. Extend it; don't replace it.
- **Undo instead of confirm, with the observation held back** (cut, pick): nothing reaches the log until the window closes.
- **The dock is the same in every view**, and **note keys survive a click on a control** (buttons keep only Space and Enter). SH2 is the one exception to fix, not a reason to change the rule.
- **Velocity from where a key is struck**; z/x octave with the letters printed on the keys; `a = C4` always visible.
- **The MIDI indicator's four states** (`midi —`, `●N`, `○` elsewhere, `?` unavailable) and one-tab ownership.
- **The warm start's structure**: ▶ separate from the pick, focus on the first ▶, stratified nine, one worker turn, *teach it* opens PERFORM at once, and a result that replaces the loading toast.
- **PICKS counts at the click**. Keep that, and extend it to PERFORM (CO1).
- **The bank as one tab stop** with rows whose aria-labels carry their state, 24 px targets, CUT that appears on approach, and stars muted until touched.
- **Gates that don't destroy anything**: the narrow veil is CSS-only; the handheld gate never boots the engine.
- **The boot veil drops at 8 patches**, and "+N arriving" in the bank head.
- **Honest skill-line gates** (no % under 20 forecasts, never negative).
- **The film chip's once-per-view rule**, hidden in `?film` and in booth mode.
- **Disabled controls that say why** ("TAKE needs an offer", the `.tt` tooltips in PATCH).

---

## 6. Response-time budget (shell gestures)

Targets: ≤100 ms to visible acknowledgement, ≤1 s to a local result, and progress plus cancel for anything longer.

| Gesture | Target | Measured now | Source | Verdict |
|---|---|---|---|---|
| Key / screen key → sound | ≤10 ms audio, key lights ≤16 ms | not measured (worklet) | — | n/a |
| Warm-start ▶ → sound | ack ≤100 ms, sound ≤1 s | ack immediate (`.loading`); sound 0.83–1.0 s | `to-first.json` `until .wi-play.playing took 0.83`; stamp `heard` 3.73 after a click at 2.70 | **pass** (at the edge) |
| *teach it* → result toast | ack ≤100 ms, result ≤1 s | ack immediate (view switch + "Loading those in…"); result 1.5–2.3 s | `dry.log` stamps (taught → learned: 9.72→11.22, 6.83→9.11) | **acceptable** (it says it's working) |
| *teach it* → PERFORM controls usable | ≤1 s | ~9–14 s ("measuring…" at +8.5 s; "3 of 6 controls" by +14 s) | `to-first.json` log `perform` 15.32; `to-first-04-end.jpg` | **fail** → SH4 prewarm |
| Bank row ▶ → phrase | ≤300 ms | ≈0.3 s | `to-bank.json` click 14.13 → mark 14.38 | **pass** |
| Bank row click → patch open | ≤300 ms ack, ≤1 s open | ≈0.34 s (idle engine), but it switches view (SH1) | `to-bank.json` click ≈15.44 → stamp `opened` 15.78 | **pass** (time), **fail** (behaviour) |
| Preset click while the engine is busy | ack ≤100 ms | ack immediate (`.loading`, "opening…"); result depends on the queue | `main.js:5560–5566` | **pass** (ack) |
| Pick → PICKS updates | ≤100 ms | immediate (EVOLVE, PATCH strip, cut, star); **PERFORM take +8 s, pass on reply** | `main.js:5084`, `perform.js:767` | **fail** for PERFORM (CO1) |
| Pick → next pair dealt | ≤1 s | 410–434 ms | `view-evolve/dry/*.json` "deal ms" | **pass** |
| 6th pick → "it just learned" | say it when true | shown when the fit is *sent*, ~2.7 s before it lands | `main.js:5127`, fit time from the comment at `:5093` | **fail** (says it too early) |
| EVOLVE POOL → generation | progress + cancel; never block | 165–191 s, progress only on the button in EVOLVE, no cancel | `ve-rhythm.json` 165.25 s, `ve-breed.json` 191 s | **fail** (SH3) |
| ⚡ evolve from this → child on the bench | progress + cancel | 22.9 s, a 4.2 s toast, then silence | `view-patch/dry/vp-lock.json` `until took 22.85` | **fail** (SH3) |
| Drop a patch file → open | ≤1 s | 2.1 s | `vp-take.json` `until took 2.11` | marginal: add "opening First_Bass.svg…" at drop |
| ● REC → state | ≤100 ms | immediate (label, red, toast) | `to-dock-03-toast.jpg` | **pass** |
| ? → help open | ≤100 ms | immediate (DOM toggle) | `to-header-01-card.jpg` | **pass** |
| ⋯ → menu | ≤100 ms | immediate | `to-header-02-menu.jpg` | **pass** |
| Booth: key → hand over | ≤100 ms | immediate (capture listener) | `booth.js:124–134` | **pass** |
| Booth: New visitor → playable | ≤5 s | full reload, boot and warm start (not measured) | `main.js:3465–3470` | **likely fail** (SH7) |
| Toast visible time | long enough to read | 4.2 s plain, 7 s with undo; stale queued remarks dropped after 9 s | `main.js:2596`, `:2477` | good; keep |
