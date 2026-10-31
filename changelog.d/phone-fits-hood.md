### Fixed: UNDER THE HOOD's values

- **More of UNDER THE HOOD's values keep their units.** Its value column was
  a little narrower than the longer values: a mix's balance such as
  *a +2.7 dB* lost its unit to an ellipsis, and in Chromium on Linux so did
  *1.78 kHz* and *−12.0 dB*. The column now holds nine characters, and ten
  where a row has the panel's whole width (on a phone, a tablet or a window
  under about 1180 px), enough for the balance's far ends (*a +12.3 dB*).
  Two values are still cut: those far ends where the rows stand side by
  side, in Chromium on Linux, and a sequencer's rate with SYNC on
  (*4.00 Hz · sync*), at any width (`phone_fits.spec.js`,
  `perform_layout.spec.js`).
