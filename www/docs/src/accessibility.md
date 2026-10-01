# Accessibility

<p class="lede">What works from the keyboard, with a screen reader, by touch,
and with reduced motion, and where Auracle still falls short. Coverage is
uneven, and this page says where.</p>

## Keyboard

**Everything about the patch can be reached from the keyboard,** wiring
included.

Each region is one tab stop, and the arrows move inside it. Tabbing through
several hundred rack controls would be unusable, so the bank is one stop, the
rack is one stop, and the module rail is one stop per group.

To place a module without a mouse:

1. Press <kbd>Tab</kbd> until you reach the module rail.
2. Press <kbd>↑</kbd> and <kbd>↓</kbd> to choose a module.
3. Press <kbd>Enter</kbd> to pick it up.
4. Press <kbd>↑</kbd> and <kbd>↓</kbd> to walk the sockets it can go into.
   Each one is announced.
5. Press <kbd>Enter</kbd> to place it.

Focus is always visible, and a dialog returns focus to whatever opened it.
[Keyboard and MIDI](./keyboard.md) has the full map.

## Screen readers

- **The bank announces its cursor.** The list follows it with
  `aria-activedescendant`.
- **A bank row says its whole state:** its name, whether it’s saved, its
  rating, and the model’s guess. The row’s buttons sit outside the tab order,
  so the label carries what they show.
- **A socket says what will happen** when you arrow onto it: whether placing
  the module there inserts it, replaces what’s there, or shapes it.
- **Toasts** are read from a live region.
- **A lasting condition,** such as a sound muted because it failed its check,
  or an engine that has stopped, goes to a pinned alert that stays until it’s
  resolved, rather than a toast that might vanish before it’s read.

## Touch

Every rack gesture works under a finger on a tablet: knob drags, cable pulls,
locks, and the ⋯ menus.

Two rules make that work. Controls that own a drag claim the gesture before
the browser can, which leaves the rack’s frame its own panning. And whatever a
mouse finds by hovering (knob lock dots, a bank row’s stars and cut) is shown
outright on a touch screen, because on a tablet, hover-to-reveal means never.
Small glyphs get an invisible pad for a finger, only on touch screens, so the
desktop is unchanged.

## Hit targets

Hit areas are measured, not eyeballed. A knob’s whole face is grabbable,
including under its ticks, track, and value arc, and a jack answers across its
whole ring rather than only where its outline is drawn.

## Color and contrast

Text meets **4.5:1** against its background. The palette has two tiers for
this: a text tier that clears the ratio, and a stroke tier for cable glow and
jack rings, where contrast rules don’t apply.

**Color is never the only signal.** Green and amber tell audio from
modulation, but every modulation cable also ends in a named destination, and
each jack is labeled as well as colored. The styles are colored on the taste
map, and named in words everywhere they appear.

## Type size

**No text in the panels is smaller than 11 px,** and none drawn on a canvas
(the scopes, and TASTE’s map and tabs) is smaller than 12 px.

The rack is the exception, because it’s drawn to its zoom. Its labels are 9 to
13 px at 1×, and grow as you zoom in. A label that would print under 8 px is
left off, unless detail is set to full. A glyph on a button (▶, ✓) is sized to
its button.

## Motion

The rack pulses modulation cables at their modulator’s rate. That pulse is
information, not decoration.

Auracle follows your system’s reduced-motion setting, and follows it live if
you change it with the app open. With it on, the cable pulses, glows, and
transitions stop; the rack jumps to a new layout or view instead of gliding;
and a card waiting for its sound stops sweeping. The scope still moves,
because what it shows is the sound, but it redraws ten times a second rather
than every frame. The guide and the reference follow the setting too.

## Known gaps

- **No phone layout.** A touch screen under 620 px on its shorter side gets a
  stand-in screen instead of the instrument. That is deliberate for now: a
  phone would pay for about 40 renders at boot and have nowhere to show them.
  It does mean Auracle can’t be played on a phone.
- **The taste map is visual only.** STYLES and DIRECTIONS carry the same
  information as named qualities, and are the accessible way to it, but the
  map’s spatial reading has no other form.
- **Screen-reader support is deepest where it was tested.** The bank and the
  wiring path were built and checked with a screen reader. The scope’s
  settings and the picture download were not.
- **No high-contrast theme.** The palette clears AA, but there is no AAA mode
  and no way to raise contrast beyond it.

If you find something not listed here, [an
issue](https://github.com/alexnodeland/auracle/issues) helps.
