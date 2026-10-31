### Fixed: UNDER THE HOOD's values

- **UNDER THE HOOD shows each knob's whole value.** A value eight characters
  long, such as *1.78 kHz* or *−24.1 dB*, was a pixel wider than its column
  and read *1.78 k…*, its unit cut off. The column now holds nine; on a
  phone or a tablet, where a row has the width, it holds the balance's
  longest too (*a +12.3 dB*) (`phone_fits.spec.js`).
