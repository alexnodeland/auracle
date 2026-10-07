# Accessibility

<p class="lede">What works from the keyboard, with a screen reader, by touch,
and with reduced motion, and where Auracle still falls short. Coverage is
uneven, and this page says where.</p>

## Keyboard

**Everything about the patch can be reached from the keyboard,** wiring
included.

Each region is one tab stop, and the arrows move inside it. Tabbing through
several hundred rack controls would be unusable, so the bank’s list is one
stop, the patch is one stop (its modules walked with <kbd>←</kbd> and
<kbd>→</kbd> in signal order, <kbd>Enter</kbd> into one, <kbd>Esc</kbd> out),
and the catalog is one stop per group. The
bank’s three tabs are a tab list, one stop, whose <kbd>←</kbd> and
<kbd>→</kbd> show the next bank as they move; **Find a sound** and the
walkthrough’s **?** are a stop each between the tabs and the list.

**The levels.** <kbd>⌥↑</kbd> and <kbd>⌥↓</kbd> zoom out and in,
<kbd>⌥←</kbd> and <kbd>⌥→</kbd> go to EVOLVE and back, and <kbd>⌥1</kbd>–
<kbd>⌥5</kbd> go straight to a level, from anywhere but a text field or a
modal dialog (Alt off Apple platforms; in a text field there, Alt ← is the
browser’s Back). The levels at the stage’s right edge are a
navigation landmark named *Where you are*: each stop is a button named for its
level and what it is (*Taste: the sound among all sounds*), with its key in
`aria-keyshortcuts`, and the one you’re at is `aria-current="location"`.
Reached with <kbd>Tab</kbd>, the arrow keys walk them as they are drawn.
Clicking a stop moves focus into its level, so EVOLVE’s <kbd>←</kbd> and
<kbd>→</kbd> work at once. The menu bar names the level you’re at in a polite
live region, so a level key is announced where it went.

**The model view.** Holding <kbd>⌥</kbd> (Alt) shows it, under the same
rules; **MODEL** in the menu bar is a button whose <kbd>Enter</kbd> or
<kbd>Space</kbd> keeps it up (`aria-pressed`, and remembered across a reload),
and <kbd>Esc</kbd> ends it once nothing nearer takes the press. Its
tag, saying what the model believes and from how many picks, is a status, read
once as the view comes up. In PATCH, the belief line in the subtitle is a
status too, and the readout at the well's foot (a polite live region) reads
what the model makes of the selection; each worth chip names its family and
figure in its text, and each of the guess's runners-up is an image named for
its rank, its module and its lower bound. In PERFORM, each control's lean is
its description while the view is up, read with the control (*it leans
brighter*, with a **?** while it is a guess).

**PERFORM.** Its pads have keys, printed on each and given in
`aria-keyshortcuts`: <kbd>n</kbd> OFFER (NEXT), hold <kbd>b</kbd> PEEK,
<kbd>⇧↵</kbd> TAKE, and, once the sound has moved, <kbd>↵</kbd> KEEP with
nothing focused (a dial or BLEND turned with the mouse or a finger lets go of
the focus; one reached with <kbd>Tab</kbd> keeps it, and its Enter) and
<kbd>⇧⌫</kbd> BACK. They yield to a text field and a
modal dialog. Each named control and WANDER is a slider (arrows turn it,
<kbd>Home</kbd> centers it, <kbd>Enter</kbd> on a named control plays its
sweep and on WANDER freezes it); WANDER’s value reads *frozen* while it is,
since a slider cannot also be a toggle. BLEND is a native slider under the
faces while B holds an offer. **XY** in the well’s corner is a toggle button
(`aria-pressed`), and **HOW IT WORKS** a disclosure (`aria-expanded`); each
fills the well, and <kbd>Esc</kbd> inside it hands focus back to the button.
The moved bar’s KEEP and BACK leave the tab order while the sound is home.
The first-steps pill’s step is a status, read once as each new step comes up, and
its **×** is a button named *Stop showing these* (that level's steps). In PATCH,
<kbd>Home</kbd> and <kbd>End</kbd> walk to the first and last module only from
the canvas or with nothing in focus: on **VOL**, in a menu, in the catalog's
rows or under a dialog they keep their own meaning. **UNDO TO AS OPENED**
stays in the tab order when it can't go (`aria-disabled`), and pressing it
says why. The dashed face at OUT for the selected module's absence is
said in the readout (*Dashed at OUT: the sound without it, measured*, or
*silent without it*). Closing the catalog or TEACH with the keyboard puts the focus back
on the button that opened it; with the pointer, it lets the focus go, so
<kbd>Space</kbd> plays.

To place a module without a mouse:

1. Press <kbd>/</kbd> (or **ADD MODULE**) to open the catalog, and
   <kbd>Tab</kbd> to its groups.
2. Press <kbd>↑</kbd> and <kbd>↓</kbd> to choose a module.
3. Press <kbd>Enter</kbd> to pick it up.
4. Press <kbd>↑</kbd> and <kbd>↓</kbd> to walk the sockets it can go into.
   Each one is announced.
5. Press <kbd>Enter</kbd> to place it.

A setting on the rack (a wave, a filter mode) is a button: reached with the
keyboard, <kbd>Space</kbd> or <kbd>Enter</kbd> cycles it, and with
<kbd>Shift</kbd> it goes back. A click leaves no focus on it, so Space after a
click plays the sound you’re playing, as it does with a knob focused. Its name
says what it is set to (*VCO wave, sin*), and each change is read out.

PATCH's modules are announced as you walk them (*filter, module 3 of 5*);
the selected one's name and what it does are in the readout at the well's
foot, a live region. Every control in PATCH is a button or a knob a keyboard
reaches, the face at OUT included (it plays the sound), and on a touch screen
each is 40 px or more: the head's acts, the camera's corner, the menus, and a
module's sheet with its lane's buttons.

Focus is always visible, and a dialog returns focus to whatever opened it.
[Keyboard and MIDI](./keyboard.md) has the full map.

## Screen readers

- **The bank announces its cursor.** The list follows it with
  `aria-activedescendant`.
- **A bank row says its whole state:** its name, whether it’s saved, its
  rating, and the model’s guess (at rest too, though the guess is drawn only
  under the model view). The row’s buttons sit outside the tab order, so the
  label carries what they show, and <kbd>1</kbd>–<kbd>5</kbd>, <kbd>m</kbd> and
  <kbd>c</kbd> reach what they do.
- **The bank’s list is named by its tab** (*Pool*, *Saved*, *Presets*), and
  the tabs control it.
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
mouse finds by hovering (knob lock dots, a bank row’s actions) is shown
outright on a touch screen, because on a tablet, hover-to-reveal means never:
every bank row shows its actions (and every preset its **▶**) at rest, on a
line under its name, so a sound can be heard, rated, saved or cut without
opening it. **MODEL**’s press and hold is the model view under a finger.
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
transitions stop; the rack jumps to a new layout or view instead of gliding,
and the bank’s rows jump to the model view’s order rather than glide; and a
card waiting for its sound stops sweeping. The scope still moves,
because what it shows is the sound, but it redraws ten times a second rather
than every frame. The guide and the reference follow the setting too.

## Known gaps

- **No phone layout.** A touch screen under 620 px on its shorter side gets a
  stand-in screen instead of the instrument. That is deliberate for now: a
  phone would pay for about 40 renders at boot and have nowhere to show them.
  It does mean Auracle can’t be played on a phone.
- **The taste map is mostly visual.** Its sounds can be walked with the arrow
  keys, each card says the sound’s name and the model’s guess, and a pick is
  announced (*You picked Glass Pad over Soft Wash. Every rating moved.*).
  LEARNING’s weights carry the model’s leans as named qualities, each row
  read with its weight and whether it is still a guess. The map’s spatial
  reading has no other form.
- **Screen-reader support is deepest where it was tested.** The bank and the
  wiring path were built and checked with a screen reader. The scope’s
  settings and the picture download were not.
- **No high-contrast theme.** The palette clears AA, but there is no AAA mode
  and no way to raise contrast beyond it.

If you find something not listed here, [an
issue](https://github.com/alexnodeland/auracle/issues) helps.
