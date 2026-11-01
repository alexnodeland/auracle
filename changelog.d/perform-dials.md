### Fixed: PERFORM's controls name their knobs in words, and a drag draws no focus ring

- **The line under each PERFORM control names the knobs it turns as PATCH
  does, from the moment a sound opens.** For about a render after you opened
  a sound, and often until it had been measured again seconds later, the
  line read the knobs' short codes, sometimes twice (*cut · cut +1*,
  *attack · dec +2*), and the same sound later said *filter cutoff +2* and
  *attack +3*. It now says the knobs' names (*cutoff*, *mod depth · lfo rate
  +2*) straight away, with the module beside a name two knobs share, and
  never says a word twice: two filters' cutoffs read *filter cutoff +1*. The
  tooltips and the hood use the same names (`perform_dials.spec.js`, #532).
- **Dragging a control or the XY pad with the mouse no longer draws a green
  focus ring around it.** Once you had pressed any key (in Chrome; Tab in
  Firefox), every drag showed the ring for as long as you held the control,
  and the XY pad kept it after you let go. A control you reach with Tab still
  shows the ring, and its arrows and Enter work as before
  (`perform_dials.spec.js`, #532).

### Fixed: PEEK and TAKE say an offer is on its way while it grows

- **Holding B (PEEK) or pressing ⇧↵ (TAKE) while B is growing an offer now
  says so.** It said *Nothing offered yet. Press Offer first.*, though you
  had just pressed Offer. Now it says *Still growing an offer.*, and what to
  do: keep holding PEEK and you hear the offer as it lands, all of it at
  once; press TAKE once it's in B (`perform_dials.spec.js`, #523).
