/* AURACLE — the landing page's interactive hero.
 *
 * A working duel: two synthesized patches, you pick one, and a taste model
 * updates in front of you with its uncertainty visible.
 *
 * ## What is real here, and what is a miniature
 *
 * Real:
 *   - The audio. Two oscillators, a sub, a filter, an LFO, a waveshaper and a
 *     noise mix, rendered by Web Audio. Nothing is a recording.
 *   - The waveform traces. Each is an offline render of the patch you are about
 *     to hear, drawn as a min/max envelope per pixel column — the same encoding
 *     the instrument's own duel cards use.
 *   - The update. `theta += lr * (1 - sigma(theta . dz)) * dz` is the exact
 *     gradient of the Bradley-Terry log-likelihood, which is the same likelihood
 *     `auracle-taste` fits by MCMC.
 *   - The uncertainty. A diagonal Laplace approximation: precision accumulates
 *     `dz^2 * p * (1 - p)` per observation, and the whisker is 1/sqrt(precision).
 *     It narrows because evidence arrived, not because a timer ran.
 *
 * A miniature:
 *   - Four coordinates instead of forty, chosen to be audible in two seconds.
 *   - One lens instead of a max over five, so this cannot represent a listener
 *     who likes two unrelated things — which is the whole reason the real model
 *     is a max of experts.
 *   - Online point estimation instead of a posterior over theta. The whisker is
 *     an approximation of a spread, not a sampled one.
 *   - No grammar, no search, no vetting. The candidates here are random points
 *     in a 4-cube; in the instrument they are terms in a typed grammar.
 *
 * The page says all of this in the copy under the panel. A demo that overstates
 * what it is doing is worse than no demo, and this product's entire argument is
 * that it reports its own uncertainty honestly.
 *
 * No dependencies, no build step, no network. Same rules as apps/web.
 */

(() => {
  'use strict';

  /* ── the four coordinates ─────────────────────────────────────────────
   * Named for what they sound like, not for what they control, because the
   * label is what the visitor reads off the bar chart. Each maps to one
   * audible axis and they are as close to independent as four knobs get.
   */
  const AXES = [
    { key: 'bright', label: 'brightness' },
    { key: 'motion', label: 'movement' },
    { key: 'grit',   label: 'grit' },
    { key: 'weight', label: 'weight' },
  ];
  const D = AXES.length;

  const TARGET_PICKS = 5;   // when the verdict is offered
  const LR = 0.9;           // BT step size — large, because there are only ~5 of them
  const PRIOR_PRECISION = 1.6;

  /* ── state ─────────────────────────────────────────────────────────── */
  const theta = new Float64Array(D);
  const precision = new Float64Array(D).fill(PRIOR_PRECISION);
  let picks = 0;
  let pair = null;
  let made = null;   // the patch it built, while that patch is on the screen
  let ctx = null;
  let master = null;
  let playing = null;

  /* ── dom ───────────────────────────────────────────────────────────── */
  const panel = document.getElementById('hero-duel');
  if (!panel) return;

  const crtEl = panel.querySelector('.crt');
  const duelEl = panel.querySelector('.duel');
  const pickrowEl = panel.querySelector('[data-pickrow]');
  const madeEl = panel.querySelector('[data-made]');
  const cards = {
    a: panel.querySelector('.card[data-side="a"]'),
    b: panel.querySelector('.card[data-side="b"]'),
    // Keyed like the duel cards so `stop()` and `play()` treat the built patch
    // as one more thing that can be lit, rather than as a special case.
    made: madeEl,
  };
  const madeName = panel.querySelector('[data-made-name]');
  const madeFrom = panel.querySelector('[data-made-from]');
  const madeTrace = panel.querySelector('[data-made-trace]');
  const madePlayBtn = panel.querySelector('[data-made-play]');
  const madeBackBtn = panel.querySelector('[data-made-back]');
  const barsEl = panel.querySelector('[data-bars]');
  const pipsEl = panel.querySelector('[data-pips]');
  const verdictEl = panel.querySelector('[data-verdict]');
  const makeBtn = panel.querySelector('[data-make]');
  const pickBtns = [...panel.querySelectorAll('[data-pick]')];

  /* ── a patch is a point in [-1, 1]^4 ──────────────────────────────── */

  const rand = (lo, hi) => lo + Math.random() * (hi - lo);

  /** A candidate. Coordinates are spread so a duel is usually audible. */
  function drawPatch() {
    const z = {};
    for (const a of AXES) z[a.key] = rand(-1, 1);
    return z;
  }

  /** Two candidates that differ enough to be worth asking about. */
  function drawPair() {
    for (let tries = 0; tries < 24; tries++) {
      const a = drawPatch();
      const b = drawPatch();
      // Ask about pairs the listener can actually distinguish. A duel between
      // two near-identical patches teaches nothing and reads as broken.
      let d2 = 0;
      for (const ax of AXES) d2 += (a[ax.key] - b[ax.key]) ** 2;
      if (Math.sqrt(d2) > 1.4) return { a, b };
    }
    return { a: drawPatch(), b: drawPatch() };
  }

  /** Names in the instrument's register: descriptive, generated, never clever. */
  function nameOf(z) {
    const parts = [];
    if (z.weight > 0.35) parts.push('sub');
    if (z.grit > 0.4) parts.push('gritty');
    else if (z.grit < -0.5) parts.push('clean');
    if (z.motion > 0.4) parts.push('drifting');
    if (z.bright > 0.45) parts.push('bright');
    else if (z.bright < -0.4) parts.push('dark');
    if (!parts.length) parts.push('plain');
    const noun = z.motion > 0.3 ? 'wash' : z.weight > 0.2 ? 'pad' : 'tone';
    return `${parts.slice(0, 2).join(' ')} ${noun}`;
  }

  /* ── the synth ─────────────────────────────────────────────────────── */

  /* One graph builder, used for both the offline render that draws the trace
   * and the live playback. The instrument makes the same choice for a much
   * better reason (one compiler serves the search and the audio thread), and it
   * has the same payoff here: the trace cannot disagree with the sound. */
  function build(ac, z, when) {
    const out = ac.createGain();
    out.gain.value = 0;

    // Two notes: a root and a fifth above, so the filter's effect is audible
    // across an interval rather than on one pitch.
    const f0 = 138.6; // C#3
    const notes = [
      { f: f0, t: when, dur: 0.95 },
      { f: f0 * 1.5, t: when + 0.78, dur: 0.95 },
    ];

    // brightness → cutoff, on a log axis, for the same reason the real feature
    // extractor uses one: an octave has to be an octave at every register.
    const cutoff = Math.min(9000, 180 * Math.pow(2, 3.2 * (z.bright + 1)));

    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    filter.Q.value = 3.4 + 4.5 * Math.max(0, z.grit);

    // grit → waveshaper drive plus a noise bed.
    const shaper = ac.createWaveShaper();
    shaper.curve = tanhCurve(1 + 9 * Math.max(0, z.grit + 0.35));
    shaper.oversample = '2x';

    // movement → LFO depth on the cutoff, in cents so it is musical.
    const lfo = ac.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.35 + 2.6 * (z.motion + 1);
    const lfoDepth = ac.createGain();
    lfoDepth.gain.value = 1400 * Math.max(0, z.motion + 0.25);
    lfo.connect(lfoDepth).connect(filter.detune);
    lfo.start(when);
    lfo.stop(when + 2.1);

    filter.connect(shaper).connect(out);

    for (const n of notes) {
      const env = ac.createGain();
      env.gain.setValueAtTime(0.0001, n.t);
      env.gain.linearRampToValueAtTime(0.9, n.t + 0.02);
      env.gain.exponentialRampToValueAtTime(0.34, n.t + 0.3);
      env.gain.exponentialRampToValueAtTime(0.0001, n.t + n.dur);
      env.connect(filter);

      const saw = ac.createOscillator();
      saw.type = 'sawtooth';
      saw.frequency.value = n.f;
      saw.detune.value = -6;
      const sawG = ac.createGain();
      sawG.gain.value = 0.5;
      saw.connect(sawG).connect(env);
      saw.start(n.t);
      saw.stop(n.t + n.dur + 0.05);

      const saw2 = ac.createOscillator();
      saw2.type = 'sawtooth';
      saw2.frequency.value = n.f;
      saw2.detune.value = 7;
      const saw2G = ac.createGain();
      saw2G.gain.value = 0.34;
      saw2.connect(saw2G).connect(env);
      saw2.start(n.t);
      saw2.stop(n.t + n.dur + 0.05);

      // weight → a sine an octave down.
      const sub = ac.createOscillator();
      sub.type = 'sine';
      sub.frequency.value = n.f / 2;
      const subG = ac.createGain();
      subG.gain.value = 0.62 * Math.max(0, z.weight + 0.3);
      sub.connect(subG).connect(env);
      sub.start(n.t);
      sub.stop(n.t + n.dur + 0.05);

      const nAmt = 0.09 * Math.max(0, z.grit);
      if (nAmt > 0.001) {
        const noise = ac.createBufferSource();
        noise.buffer = noiseBuffer(ac);
        noise.loop = true;
        const nG = ac.createGain();
        nG.gain.value = nAmt;
        noise.connect(nG).connect(env);
        noise.start(n.t);
        noise.stop(n.t + n.dur + 0.05);
      }
    }

    // A fixed output gain rather than a per-patch one. The instrument
    // loudness-normalizes every render for a real reason — louder reliably wins
    // A/B tests, and an unnormalized demo would teach this model "I like loud"
    // and present it as a preference about timbre. Four bounded coordinates
    // cannot move perceived level much, so a constant is honest enough here;
    // the real pipeline measures LUFS and applies a gain per patch.
    out.gain.value = 0.5;
    return { out, endsAt: when + 2.0 };
  }

  function tanhCurve(k) {
    const n = 1024;
    const c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.tanh(k * x) / Math.tanh(k);
    }
    return c;
  }

  let _noise = null;
  function noiseBuffer(ac) {
    // Cached per context. Deterministic, so two renders of one patch match.
    if (_noise && _noise.sampleRate === ac.sampleRate) return _noise.buf;
    const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.5), ac.sampleRate);
    const d = buf.getChannelData(0);
    let s = 22222;
    for (let i = 0; i < d.length; i++) {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s |= 0;
      d[i] = (s / 2147483648) * 0.5;
    }
    _noise = { sampleRate: ac.sampleRate, buf };
    return buf;
  }

  /* ── traces: render offline, draw the envelope ─────────────────────── */

  /* Two inks, per the page's colour law: green is sound, amber is the model's
   * mind. A candidate the page drew at random is green; the patch the model
   * built out of theta is amber, and that is the only cue that has to survive
   * being glanced at. */
  const INK_A = { wave: '#8ef0b1', base: 'rgba(61, 106, 77, 0.55)' };
  const INK_B = { wave: '#ffb454', base: 'rgba(122, 85, 38, 0.6)' };

  async function renderTrace(canvas, z, ink = INK_A) {
    /* 44100, not a cheap 8000. An envelope does not need the bandwidth, but the
     * *filter* does: at 8 kHz Nyquist is 4 kHz, so Web Audio clamped every
     * cutoff above it and the offline render of a bright patch was a different
     * sound from the one playback produced. A trace that disagrees with its
     * audio is precisely the dishonesty this panel is arguing against, and it
     * announced itself as a console warning rather than as anything audible.
     * One channel × 2.1 s is ~93k samples — still nothing. */
    const sr = 44100;
    let data;
    try {
      const off = new OfflineAudioContext(1, Math.ceil(sr * 2.1), sr);
      const { out } = build(off, z, 0);
      out.connect(off.destination);
      const rendered = await off.startRendering();
      data = rendered.getChannelData(0);
    } catch (e) {
      // OfflineAudioContext is unavailable or refused. Draw nothing rather than
      // draw something invented — a fake trace beside a real one is the exact
      // dishonesty this page is arguing against.
      return;
    }
    drawEnvelope(canvas, data, ink);
  }

  function drawEnvelope(canvas, data, ink) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || 520;
    const h = canvas.clientHeight || 86;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const g = canvas.getContext('2d');
    g.scale(dpr, dpr);
    g.clearRect(0, 0, w, h);

    const mid = h / 2;
    const per = data.length / w;
    let peak = 0;
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
    const norm = peak > 0 ? 0.94 / peak : 0;

    g.fillStyle = ink.wave;
    for (let x = 0; x < w; x++) {
      const from = Math.floor(x * per);
      const to = Math.min(data.length, Math.floor((x + 1) * per));
      let lo = 0, hi = 0;
      for (let i = from; i < to; i++) {
        const v = data[i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      const y1 = mid - hi * mid * norm;
      const y2 = mid - lo * mid * norm;
      g.fillRect(x, y1, 1, Math.max(1, y2 - y1));
    }

    // The 0 dBFS baseline, as the instrument's cards draw it.
    g.fillStyle = ink.base;
    g.fillRect(0, mid, w, 1);
  }

  /* ── playback ──────────────────────────────────────────────────────── */

  function audio() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function stop() {
    if (playing) {
      try { playing.out.disconnect(); } catch (e) { /* already gone */ }
      playing = null;
    }
    for (const c of Object.values(cards)) c.removeAttribute('data-armed');
  }

  function play(side, z) {
    const ac = audio();
    if (!ac) {
      say('This browser will not start an audio context. The instrument itself needs one too.');
      return;
    }
    stop();
    const { out } = build(ac, z, ac.currentTime + 0.02);
    out.connect(master);
    playing = { out };
    if (side && cards[side]) cards[side].setAttribute('data-armed', '');
    window.setTimeout(() => {
      if (playing && playing.out === out) stop();
    }, 2200);
  }

  /* ── the model ─────────────────────────────────────────────────────── */

  const sigmoid = (v) => 1 / (1 + Math.exp(-v));

  /** The Bradley-Terry gradient step, plus a diagonal Laplace precision update. */
  function observe(winner, loser) {
    const dz = AXES.map((a) => winner[a.key] - loser[a.key]);
    let dot = 0;
    for (let i = 0; i < D; i++) dot += theta[i] * dz[i];
    const p = sigmoid(dot);            // what the model predicted, before the answer
    const g = 1 - p;                   // dL/d(dot) for "winner won"
    for (let i = 0; i < D; i++) {
      theta[i] += LR * g * dz[i];
      // Observed information for a logistic likelihood: dz^2 * p * (1 - p).
      precision[i] += dz[i] * dz[i] * p * (1 - p);
    }
    picks++;
  }

  const sd = (i) => 1 / Math.sqrt(precision[i]);

  /* ── rendering the mind ────────────────────────────────────────────── */

  function buildBars() {
    barsEl.innerHTML = '';
    for (const a of AXES) {
      const li = document.createElement('li');
      li.className = 'bar-row';
      li.innerHTML =
        `<span class="bar-label">${a.label}</span>` +
        `<span class="bar-track"><i class="bar-whisk" data-whisk></i>` +
        `<i class="bar-fill" data-fill></i></span>` +
        `<span class="bar-val" data-val>—</span>`;
      barsEl.appendChild(li);
    }
  }

  function renderMind() {
    // One shared scale across the four bars, so their lengths are comparable to
    // each other. Floored so an early, tiny theta is still visible.
    let scale = 1.2;
    for (let i = 0; i < D; i++) scale = Math.max(scale, Math.abs(theta[i]) + sd(i));

    const rows = barsEl.querySelectorAll('.bar-row');
    rows.forEach((row, i) => {
      const t = theta[i];
      const s = sd(i);
      const half = 50 / scale;                       // % of track per unit
      const fill = row.querySelector('[data-fill]');
      const whisk = row.querySelector('[data-whisk]');
      const val = row.querySelector('[data-val]');

      const w = Math.min(50, Math.abs(t) * half);
      fill.style.width = `${w}%`;
      fill.style.left = t >= 0 ? '50%' : `${50 - w}%`;

      const lo = Math.max(0, 50 + (t - s) * half);
      const hi = Math.min(100, 50 + (t + s) * half);
      whisk.style.left = `${lo}%`;
      whisk.style.width = `${Math.max(0, hi - lo)}%`;

      val.textContent = picks === 0 ? '—' : `±${s.toFixed(2)}`;
    });

    pipsEl.textContent =
      '●'.repeat(Math.min(picks, TARGET_PICKS)) +
      '○'.repeat(Math.max(0, TARGET_PICKS - picks));
  }

  function say(html) { verdictEl.innerHTML = html; }

  /** The verdict, with the same four silences the instrument distinguishes. */
  function renderVerdict() {
    if (picks === 0) {
      say('Press <kbd>1</kbd> and <kbd>2</kbd>, then pick the one you prefer.');
      return;
    }
    if (picks < TARGET_PICKS) {
      const left = TARGET_PICKS - picks;
      say(`Listening. ${left} more ${left === 1 ? 'pick' : 'picks'} and it will say what it thinks.`);
      return;
    }

    // Only claim a coordinate whose interval clears zero. Below that the model
    // has looked and found nothing, and saying so is the point.
    let best = -1, bestZ = 0;
    for (let i = 0; i < D; i++) {
      const z = Math.abs(theta[i]) / sd(i);
      if (z > bestZ) { bestZ = z; best = i; }
    }

    if (best < 0 || bestZ < 1.0) {
      say('It has listened and has <strong>no clear lean</strong> — every interval still ' +
          'straddles zero. Five picks is not much evidence, and a model that claimed one ' +
          'anyway would be lying to you.');
    } else {
      const dir = theta[best] > 0 ? 'more' : 'less';
      say(`It thinks you want <strong>${dir} ${AXES[best].label}</strong>` +
          (bestZ < 1.6 ? ' — tentatively; that interval is still wide.' : '.'));
    }
    makeBtn.hidden = false;
  }

  /* ── the duel ──────────────────────────────────────────────────────── */

  async function deal() {
    stop();
    pair = drawPair();
    for (const side of ['a', 'b']) {
      const card = cards[side];
      card.querySelector('[data-name]').textContent = nameOf(pair[side]);
      await renderTrace(card.querySelector('[data-trace]'), pair[side]);
    }
    pickBtns.forEach((b) => { b.disabled = false; });
  }

  async function choose(side) {
    if (!pair) return;
    const winner = pair[side];
    const loser = pair[side === 'a' ? 'b' : 'a'];
    observe(winner, loser);
    renderMind();
    renderVerdict();
    pickBtns.forEach((b) => { b.disabled = true; });
    await deal();
  }

  /** What the model would build, given what it currently believes. */
  async function makeOne() {
    let scale = 0;
    for (let i = 0; i < D; i++) scale = Math.max(scale, Math.abs(theta[i]));
    if (scale === 0) return;
    const z = {};
    AXES.forEach((a, i) => {
      // Full extent along the believed direction, damped by how sure it is —
      // so an unconfident coordinate stays near neutral rather than being
      // pushed to a bound on thin evidence.
      const conf = Math.abs(theta[i]) / (Math.abs(theta[i]) + sd(i));
      z[a.key] = Math.max(-1, Math.min(1, (theta[i] / scale) * conf));
    });
    made = z;
    showMade(z);
    // Sound first, picture second: the render is a few tens of milliseconds and
    // the click should not wait on it.
    play('made', z);
    await renderTrace(madeTrace, z, INK_B);
  }

  /* The built patch takes the whole screen. It used to play under the duel with
   * only a line of text to say what had happened, and the most common reaction
   * was that the button had done nothing — the sound arrived but the thing that
   * made it was nowhere on the page. A new patch has to *appear*. */
  function showMade(z) {
    stop();
    madeName.textContent = nameOf(z);
    // Non-breaking inside a pair and a middot between them, so a narrow column
    // wraps between coordinates rather than between a name and its number.
    madeFrom.innerHTML =
      `<span class="made-from-lead">from your ${picks} ${picks === 1 ? 'pick' : 'picks'}</span>` +
      AXES.map((a) => `${a.label}&nbsp;${signed(z[a.key])}`).join(' · ');
    // Pin the screen at the height it has right now. One card is shorter than
    // two, and letting the screen collapse would drag the button the visitor
    // just pressed — and everything they were looking at — a few hundred pixels
    // up the page, which is a good way to make a new patch arrive off-screen.
    crtEl.style.minHeight = `${crtEl.offsetHeight}px`;
    crtEl.setAttribute('data-made-on', '');
    duelEl.hidden = true;
    pickrowEl.hidden = true;
    makeBtn.hidden = true;
    madeEl.hidden = false;
    say(`Built you <strong>${nameOf(z)}</strong> — a new patch, from the direction ` +
        `your ${picks} picks point in. Nothing on the page had played it before. ` +
        `The real instrument builds these by evolving a patch grammar; ` +
        `<a href="play/">that version is here</a>.`);
    madePlayBtn.focus();
  }

  /** Back to the duel that was on screen, with the model exactly as it was. */
  function backToTraining() {
    stop();
    made = null;
    madeEl.hidden = true;
    crtEl.style.minHeight = '';
    crtEl.removeAttribute('data-made-on');
    duelEl.hidden = false;
    pickrowEl.hidden = false;
    // The canvases kept their bitmaps while hidden, but a resize while they were
    // hidden measured them at zero — redraw rather than trust that.
    if (pair) {
      for (const side of ['a', 'b']) {
        renderTrace(cards[side].querySelector('[data-trace]'), pair[side]);
      }
    }
    renderVerdict();
    makeBtn.innerHTML = 'Make me another&nbsp;▸';
    pickBtns[0].focus();
  }

  /** A coordinate as the reader should check it against the bars: +0.72, −0.31. */
  function signed(v) {
    return (v < 0 ? '−' : '+') + Math.abs(v).toFixed(2);
  }

  /* ── wiring ────────────────────────────────────────────────────────── */

  panel.querySelectorAll('[data-play]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const side = btn.closest('.card').dataset.side;
      if (pair) play(side, pair[side]);
    });
  });

  pickBtns.forEach((btn) => {
    btn.addEventListener('click', () => choose(btn.dataset.pick));
  });

  makeBtn.addEventListener('click', makeOne);
  madePlayBtn.addEventListener('click', () => { if (made) play('made', made); });
  madeBackBtn.addEventListener('click', backToTraining);

  // Keys, but only when the visitor is not typing into something and not
  // holding a modifier — the same rule the instrument uses for its note keys.
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (!isNearPanel()) return;
    // While the built patch is up, the duel's keys would act on two cards
    // nobody can see. Escape is the way back, and it is on the button too.
    if (!madeEl.hidden) {
      if (e.key === 'Escape') { e.preventDefault(); backToTraining(); }
      else if (e.key === '1' && made) play('made', made);
      return;
    }
    switch (e.key) {
      case '1': if (pair) play('a', pair.a); break;
      case '2': if (pair) play('b', pair.b); break;
      case 'ArrowLeft': e.preventDefault(); choose('a'); break;
      case 'ArrowRight': e.preventDefault(); choose('b'); break;
      default: return;
    }
  });

  /** Only claim the number and arrow keys while the panel is actually on screen. */
  function isNearPanel() {
    const r = panel.getBoundingClientRect();
    return r.bottom > 0 && r.top < window.innerHeight;
  }

  // Stop the audio if the visitor leaves the tab — a page that keeps playing
  // into a backgrounded tab is a page nobody trusts twice.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      // Only whatever is actually on screen: a hidden canvas measures zero wide
      // and would be redrawn at the fallback size, which is a wrong picture.
      if (made && !madeEl.hidden) {
        // The pinned height was measured for the old width. It exists to stop a
        // jump at the moment of the click, and that moment has passed.
        crtEl.style.minHeight = '';
        renderTrace(madeTrace, made, INK_B);
      }
      if (!pair || duelEl.hidden) return;
      for (const side of ['a', 'b']) {
        renderTrace(cards[side].querySelector('[data-trace]'), pair[side]);
      }
    }, 180);
  });

  buildBars();
  renderMind();
  deal();

  /* ── the screenshot tabs ───────────────────────────────────────────── */

  const tablist = document.querySelector('.shot-tabs');
  if (tablist) {
    const tabs = [...tablist.querySelectorAll('.shot-tab')];

    function select(tab) {
      for (const t of tabs) {
        const on = t === tab;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
      }
    }

    tabs.forEach((tab) => tab.addEventListener('click', () => select(tab)));

    tablist.addEventListener('keydown', (e) => {
      const i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      let next = null;
      if (e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
      else if (e.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length];
      else if (e.key === 'Home') next = tabs[0];
      else if (e.key === 'End') next = tabs[tabs.length - 1];
      if (!next) return;
      e.preventDefault();
      next.focus();
      select(next);
    });
  }
})();
