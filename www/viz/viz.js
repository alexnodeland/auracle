/* AURACLE — live figures for the documentation site.
 *
 * Declarative: markdown writes
 *
 *     <figure class="viz" data-viz="log-axis">
 *     <figcaption>…</figcaption>
 *     </figure>
 *
 * and this file fills it in. Unknown names are left alone, so a figure can be
 * referenced before it is written without breaking the page.
 *
 * ## Four rules these figures keep
 *
 * **They compute, they do not illustrate.** The K-weighting curve is evaluated
 * from the same biquad constants `auracle-features::loudness` uses; the
 * reliability diagram runs real forecasts through a real Brier score; the tilt
 * bars apply the actual clamp. A drawing of a result is a claim about it, and
 * this project's whole argument is that it does not make claims it cannot show.
 *
 * **They re-theme without rebuilding.** Every paint attribute is a
 * `var(--phos-…)`, so switching between the rack and paper themes is a repaint.
 * No JavaScript knows which theme is on.
 *
 * **They are usable without a mouse.** Every draggable handle is a focusable
 * element with arrow-key support; every slider is a real `<input type=range>`;
 * every figure has a `role="status"` readout so a screen reader hears what
 * changed. A figure whose only affordance is a drag is a figure half the
 * readers cannot use.
 *
 * **They respect reduced motion.** Animated figures render a static end-state
 * rather than a stopped animation — a paused diagram and a finished one are
 * different pictures, and only one of them teaches anything.
 *
 * No dependencies, no build step, no network. Same rules as apps/web.
 */

(() => {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── tiny DOM helpers ─────────────────────────────────────────────────── */

  function el(tag, attrs, kids) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs || {}) {
      if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    }
    for (const c of kids || []) n.appendChild(c);
    return n;
  }

  function html(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function svg(w, h, label) {
    const s = el('svg', {
      viewBox: `0 0 ${w} ${h}`,
      role: 'img',
      'aria-label': label || '',
      preserveAspectRatio: 'xMidYMid meet',
    });
    return s;
  }

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const fmt = (v, d) => v.toFixed(d == null ? 2 : d);

  /** A labelled range control. Returns the input so callers can read `.value`. */
  function slider(parent, label, { min, max, step, value, unit, format }) {
    const wrap = html('label', 'viz-ctl');
    wrap.appendChild(html('span', null, label));
    const input = document.createElement('input');
    input.type = 'range';
    input.min = min; input.max = max; input.step = step; input.value = value;
    const out = document.createElement('output');
    const show = () => {
      const v = parseFloat(input.value);
      out.textContent = (format ? format(v) : fmt(v)) + (unit || '');
    };
    input.addEventListener('input', show);
    show();
    wrap.appendChild(input);
    wrap.appendChild(out);
    parent.appendChild(wrap);
    return input;
  }

  function button(parent, label, onClick) {
    const b = html('button', 'viz-btn', label);
    b.type = 'button';
    b.addEventListener('click', () => onClick(b));
    parent.appendChild(b);
    return b;
  }

  /** Stage + controls + readout scaffolding, shared by every figure. */
  function scaffold(root) {
    const stage = html('div', 'viz-stage');
    const controls = html('div', 'viz-controls');
    const readout = html('p', 'viz-readout');
    readout.setAttribute('role', 'status');
    root.insertBefore(stage, root.firstChild);
    const cap = root.querySelector('figcaption');
    root.insertBefore(controls, cap);
    root.insertBefore(readout, cap);
    return { stage, controls, readout };
  }

  /**
   * A handle the reader can drag or arrow. `onMove(fraction)` receives a value
   * in [0,1] along the figure's own axis; the caller decides what that means.
   */
  function handle(parent, { x, y, r = 7, label, onDelta }) {
    const g = el('g', {
      class: 'v-handle',
      tabindex: '0',
      role: 'slider',
      'aria-label': label,
      transform: `translate(${x} ${y})`,
    });
    g.appendChild(el('circle', { class: 'v-handle-ring', r: r + 3, fill: 'none', stroke: 'var(--phos-b-deep)', 'stroke-width': 1.5 }));
    g.appendChild(el('circle', { r, fill: 'var(--phos-b)' }));
    parent.appendChild(g);

    let dragging = false;
    const svgEl = () => g.ownerSVGElement;
    const toLocal = (evt) => {
      const s = svgEl();
      const pt = s.createSVGPoint();
      pt.x = evt.clientX; pt.y = evt.clientY;
      return pt.matrixTransform(s.getScreenCTM().inverse());
    };
    g.addEventListener('pointerdown', (e) => {
      dragging = true;
      g.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    g.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      onDelta(toLocal(e));
    });
    g.addEventListener('pointerup', (e) => {
      dragging = false;
      try { g.releasePointerCapture(e.pointerId); } catch (_) { /* already gone */ }
    });
    g.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 1 : 6;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (!d) return;
      e.preventDefault();
      const m = g.transform.baseVal.consolidate().matrix;
      onDelta({ x: m.e + d[0], y: m.f + d[1] });
    });
    return g;
  }

  const moveTo = (g, x, y) => g.setAttribute('transform', `translate(${x} ${y})`);

  /* ── the registry ─────────────────────────────────────────────────────── */

  const VIZ = {};

  /* =======================================================================
   * log-axis — why frequency features are logarithmic
   *
   * The page's claim is a pair of numbers: on a linear-Hz axis 200→400 Hz moves
   * the coordinate by 0.009 while 8k→16k moves it by 0.36, so a linear model
   * cannot express "a shade brighter" about a bass. Both numbers are computed
   * here rather than quoted, and the reader can drag an octave anywhere on the
   * spectrum and watch the two axes disagree.
   * ===================================================================== */
  VIZ['log-axis'] = (root) => {
    const { stage, controls, readout } = scaffold(root);
    const W = 720, H = 190, L = 58, R = 22;
    const NYQ = 22050, F0 = 20;
    const s = svg(W, H, 'Two frequency axes compared: linear in hertz, and octaves above 20 hertz');
    stage.appendChild(s);

    const span = Math.log2(NYQ / F0);
    const logAxis = (f) => Math.log2(Math.max(f, F0) / F0) / span;   // the code's log_axis
    const linAxis = (f) => f / NYQ;                                   // the rejected alternative
    const px = (frac) => L + frac * (W - L - R);

    /* Each row is drawn on ITS OWN axis. That is the whole figure: on the linear
       row an octave down in the bass collapses to a sliver you can barely see,
       while the same octave up top is a third of the width — so one weight
       cannot mean "brighter" in both places. Drawing both rows log-positioned
       (the first attempt) made the two bands identical and left only the numbers
       to carry the argument, which is exactly the argument being too quiet. */
    const rows = [
      { y: 62, label: 'linear in Hz  (rejected)', axis: linAxis, colour: 'var(--led-red)', cls: 'v-num',
        ticks: [0, 5000, 10000, 15000, 20000] },
      { y: 132, label: 'octaves above 20 Hz  (shipped)', axis: logAxis, colour: 'var(--phos-a)', cls: 'v-num-a',
        ticks: [20, 100, 1000, 10000, 20000] },
    ];
    // The handle rides the log row, where a bass octave is actually grabbable.
    const xOf = (f) => px(logAxis(f));
    const fOf = (x) => F0 * Math.pow(2, ((x - L) / (W - L - R)) * span);

    for (const row of rows) {
      s.appendChild(el('line', { class: 'v-rule', x1: L, y1: row.y, x2: W - R, y2: row.y }));
      const t = el('text', { x: 4, y: row.y - 12, class: 'v-axis' });
      t.textContent = row.label;
      s.appendChild(t);
      for (const f of row.ticks) {
        const x = px(row.axis(f));
        s.appendChild(el('line', { class: 'v-grid', x1: x, y1: row.y - 5, x2: x, y2: row.y + 5 }));
        const lab = el('text', { x, y: row.y + 18, 'text-anchor': 'middle', class: 'v-axis' });
        lab.textContent = f >= 1000 ? `${f / 1000}k` : `${f}`;
        s.appendChild(lab);
      }
    }

    // The dragged octave: a low anchor and the note an octave above it.
    let fLow = 200;
    const bandG = el('g', {});
    s.appendChild(bandG);

    const readouts = rows.map((row) => {
      const g = el('g', {});
      const num = el('text', { x: W - R, y: row.y - 12, 'text-anchor': 'end', class: row.cls });
      g.appendChild(num);
      s.appendChild(g);
      return num;
    });

    const h = handle(s, {
      x: xOf(fLow), y: 132, label: 'Low note of the octave, in hertz',
      onDelta: (p) => { fLow = clamp(fOf(clamp(p.x, L, W - R)), 25, NYQ / 2.2); draw(); },
    });

    function draw() {
      const fHigh = fLow * 2;
      bandG.textContent = '';
      for (const row of rows) {
        const x1 = px(row.axis(fLow)), x2 = px(row.axis(fHigh));
        const w = x2 - x1;
        bandG.appendChild(el('rect', {
          x: x1, y: row.y - 9, width: Math.max(1, w), height: 18,
          fill: row.colour, opacity: 0.2,
        }));
        for (const x of [x1, x2]) {
          bandG.appendChild(el('line', { x1: x, y1: row.y - 9, x2: x, y2: row.y + 9, stroke: row.colour, 'stroke-width': 2 }));
        }
        // A band under about four pixels is not a shape any more, so say in
        // words what the picture can no longer show.
        if (w < 4) {
          const t = el('text', { x: x1 + 7, y: row.y + 4, class: 'v-axis', fill: row.colour });
          t.textContent = '← one octave, here';
          bandG.appendChild(t);
        }
      }
      moveTo(h, xOf(fLow), 132);
      h.setAttribute('aria-valuenow', Math.round(fLow));
      h.setAttribute('aria-valuetext', `${Math.round(fLow)} hertz`);

      const dLin = linAxis(fHigh) - linAxis(fLow);
      const dLog = logAxis(fHigh) - logAxis(fLow);
      readouts[0].textContent = `Δ ${dLin.toFixed(3)}`;
      readouts[1].textContent = `Δ ${dLog.toFixed(3)}`;

      readout.innerHTML =
        `One octave, <b>${Math.round(fLow)} → ${Math.round(fHigh)} Hz</b>. ` +
        `On the linear axis it moves the coordinate by <b>${dLin.toFixed(3)}</b>; ` +
        `on the log axis, by <i>${dLog.toFixed(3)}</i> — the same, everywhere, ` +
        `which is what makes the coordinate mean something a model can weight.`;
    }

    const sl = slider(controls, 'low note', {
      min: 25, max: 8000, step: 1, value: 200, unit: ' Hz', format: (v) => Math.round(v),
    });
    sl.addEventListener('input', () => { fLow = parseFloat(sl.value); draw(); });
    button(controls, 'bass: 200 → 400', () => { fLow = 200; sl.value = 200; draw(); });
    button(controls, 'treble: 8k → 16k', () => { fLow = 8000; sl.value = 8000; draw(); });
    draw();
  };

  /* =======================================================================
   * max-experts — why utility is a maximum, not a mixture
   *
   * Two lens vectors over a 2-D slice of feature space. The field is coloured by
   * which lens claims each point, and the reader can drag the lenses apart until
   * two islands appear. The K=1 toggle is the argument: one lens has to average
   * the islands, and averages a preference for neither.
   * ===================================================================== */
  VIZ['max-experts'] = (root) => {
    const { stage, controls, readout } = scaffold(root);
    const W = 520, H = 300, PAD = 26;
    const s = svg(W, H, 'A two-dimensional feature space with two taste lenses and the candidates each one claims');
    stage.appendChild(s);

    const cx = W / 2, cy = H / 2, S = (Math.min(W, H) - PAD * 2) / 2;
    const toPx = (p) => [cx + p[0] * S, cy - p[1] * S];
    const toUnit = (x, y) => [(x - cx) / S, (cy - y) / S];

    let thetas = [[0.75, 0.45], [-0.55, 0.7]];
    let single = false;

    // A fixed candidate cloud, so the picture is about the lenses moving rather
    // than about new random points arriving.
    const pts = [];
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let i = 0; i < 90; i++) pts.push([rnd() * 2 - 1, rnd() * 2 - 1]);

    s.appendChild(el('rect', { x: PAD, y: PAD, width: W - PAD * 2, height: H - PAD * 2, fill: 'none', class: 'v-grid' }));
    s.appendChild(el('line', { class: 'v-grid', x1: PAD, y1: cy, x2: W - PAD, y2: cy }));
    s.appendChild(el('line', { class: 'v-grid', x1: cx, y1: PAD, x2: cx, y2: H - PAD }));
    const ax1 = el('text', { x: W - PAD, y: cy - 6, 'text-anchor': 'end', class: 'v-axis' });
    ax1.textContent = 'φ₁  (brightness)';
    s.appendChild(ax1);
    const ax2 = el('text', { x: cx + 6, y: PAD + 10, class: 'v-axis' });
    ax2.textContent = 'φ₂  (weight)';
    s.appendChild(ax2);

    const dotsG = el('g', {}); s.appendChild(dotsG);
    const lensG = el('g', {}); s.appendChild(lensG);

    const LENS = ['var(--phos-b)', 'var(--phos-a)'];

    const handles = thetas.map((t, k) => {
      const [hx, hy] = toPx(t);
      return handle(s, {
        x: hx, y: hy, r: 6, label: `Lens ${k + 1} direction`,
        onDelta: (p) => {
          const u = toUnit(clamp(p.x, PAD, W - PAD), clamp(p.y, PAD, H - PAD));
          thetas[k] = u; draw();
        },
      });
    });

    function draw() {
      const active = single ? [thetas[0]] : thetas;
      dotsG.textContent = '';
      lensG.textContent = '';

      let claimed = [0, 0];
      for (const p of pts) {
        // u(x) = max_k θ_k · φ(x) — exactly the shipped form.
        let best = -Infinity, bestK = 0;
        active.forEach((t, k) => {
          const u = t[0] * p[0] + t[1] * p[1];
          if (u > best) { best = u; bestK = k; }
        });
        claimed[bestK]++;
        const [x, y] = toPx(p);
        // Glow is utility, exactly as the taste map encodes it.
        const lit = clamp((best + 1) / 2, 0, 1);
        dotsG.appendChild(el('circle', {
          cx: x, cy: y, r: 2.6 + lit * 2.6,
          fill: single ? 'var(--phos-b)' : LENS[bestK],
          opacity: 0.2 + lit * 0.75,
        }));
      }

      active.forEach((t, k) => {
        const [x, y] = toPx(t);
        lensG.appendChild(el('line', {
          x1: cx, y1: cy, x2: x, y2: y,
          stroke: single ? 'var(--phos-b)' : LENS[k], 'stroke-width': 2, opacity: 0.85,
        }));
      });
      handles.forEach((g, k) => {
        g.style.display = (single && k > 0) ? 'none' : '';
        const [x, y] = toPx(thetas[k]);
        moveTo(g, x, y);
        g.querySelector('circle:last-child').setAttribute('fill', single ? 'var(--phos-b)' : LENS[k]);
      });

      const angle = Math.round(Math.acos(clamp(
        (thetas[0][0] * thetas[1][0] + thetas[0][1] * thetas[1][1]) /
        (Math.hypot(...thetas[0]) * Math.hypot(...thetas[1]) + 1e-9), -1, 1)) * 180 / Math.PI);

      readout.innerHTML = single
        ? `<b>K = 1.</b> One direction has to explain every answer. With two islands of ` +
          `taste in the data it lands between them and scores both mediocre — which is ` +
          `a preference the listener never had.`
        : `Two lenses, <b>${angle}°</b> apart. Lens 1 claims <b>${claimed[0]}</b> candidates, ` +
          `lens 2 claims <i>${claimed[1]}</i>. Every candidate is scored by whichever lens ` +
          `likes it most, so a duel <em>across</em> the two is still a well-formed question.`;
    }

    button(controls, 'compare K = 1', (b) => {
      single = !single;
      b.setAttribute('aria-pressed', String(single));
      b.textContent = single ? 'back to K = 2' : 'compare K = 1';
      draw();
    });
    button(controls, 'pull the lenses apart', () => {
      thetas = [[0.85, -0.3], [-0.5, 0.85]];
      single = false;
      draw();
    });
    draw();
  };

  /* =======================================================================
   * likelihoods — one utility, three ways of observing it
   *
   * The page's point is that all three modes condition the same latent u. So
   * they share one u slider here, and each panel shows what that u implies under
   * its own likelihood. The star cutpoints are draggable because "★★★ means
   * *between two cutpoints*, not the number 3" is the thing readers get wrong.
   * ===================================================================== */
  VIZ['likelihoods'] = (root) => {
    const { stage, controls, readout } = scaffold(root);
    const W = 720, H = 268, L = 96, R = 92;
    const s = svg(W, H, 'The same latent utility observed three ways: a duel, a keep or kill, and a star rating');
    stage.appendChild(s);

    const sig = (v) => 1 / (1 + Math.exp(-v));
    const U_MIN = -4, U_MAX = 4;
    const xOf = (u) => L + ((u - U_MIN) / (U_MAX - U_MIN)) * (W - L - R);
    const uOf = (x) => U_MIN + ((x - L) / (W - L - R)) * (U_MAX - U_MIN);

    let u = 1.1, uB = -0.4, tau = 0.2;
    let cuts = [-2.0, -0.9, 0.1, 1.0, 2.1];   // n_stars − 1 = 5

    const ROWS = { duel: 46, keep: 112, star: 214 };
    for (const [name, y] of Object.entries(ROWS)) {
      s.appendChild(el('line', { class: 'v-rule', x1: L, y1: y, x2: W - R, y2: y }));
      const t = el('text', { x: 4, y: y + 4, class: 'v-axis' });
      t.textContent = { duel: 'duel  σ(uA−uB)', keep: 'keep  σ(u−τ)', star: 'stars  cutpoints' }[name];
      s.appendChild(t);
    }
    for (const g of [-4, -2, 0, 2, 4]) {
      const x = xOf(g);
      s.appendChild(el('line', { class: 'v-grid', x1: x, y1: 28, x2: x, y2: 232 }));
      const lab = el('text', { x, y: 248, 'text-anchor': 'middle', class: 'v-axis' });
      lab.textContent = g;
      s.appendChild(lab);
    }
    const uLab = el('text', { x: (L + W - R) / 2, y: 262, 'text-anchor': 'middle', class: 'v-axis' });
    uLab.textContent = 'latent utility  u';
    s.appendChild(uLab);

    const dyn = el('g', {}); s.appendChild(dyn);

    const hTau = handle(s, { x: xOf(tau), y: ROWS.keep, r: 6, label: 'Session threshold τ',
      onDelta: (p) => { tau = clamp(uOf(clamp(p.x, L, W - R)), U_MIN, U_MAX); draw(); } });
    const hCuts = cuts.map((c, j) => handle(s, { x: xOf(c), y: ROWS.star, r: 5, label: `Star cutpoint ${j + 1}`,
      onDelta: (p) => {
        const v = clamp(uOf(clamp(p.x, L, W - R)), U_MIN, U_MAX);
        // Cutpoints are ordered by construction in the model (each is the
        // previous plus a positive increment), so the figure enforces it too.
        cuts[j] = v;
        cuts.sort((a, b) => a - b);
        draw();
      } }));

    function draw() {
      dyn.textContent = '';

      // Duel: two candidates on the u line, and the probability A wins.
      const p = sig(u - uB);
      for (const [val, colour, tag] of [[u, 'var(--phos-a)', 'A'], [uB, 'var(--silk-dim)', 'B']]) {
        const x = xOf(val);
        dyn.appendChild(el('circle', { cx: x, cy: ROWS.duel, r: 6, fill: colour }));
        const t = el('text', { x, y: ROWS.duel - 13, 'text-anchor': 'middle', class: 'v-num' });
        t.textContent = tag;
        dyn.appendChild(t);
      }
      const pt = el('text', { x: W - R + 8, y: ROWS.duel + 4, class: 'v-num-a' });
      pt.textContent = `P(A) ${(p * 100).toFixed(0)}%`;
      dyn.appendChild(pt);

      // Keep/kill: the same u against a per-session bar.
      const pk = sig(u - tau);
      dyn.appendChild(el('circle', { cx: xOf(u), cy: ROWS.keep, r: 6, fill: 'var(--phos-a)' }));
      const kt = el('text', { x: W - R + 8, y: ROWS.keep + 4, class: 'v-num-a' });
      kt.textContent = `keep ${(pk * 100).toFixed(0)}%`;
      dyn.appendChild(kt);

      // Stars: the cumulative logit exactly as `obs_loglik` computes it —
      // P(y=k) = σ(c_k − u) − σ(c_{k−1} − u), 0-indexed, with c_{−1} = −∞
      // (so the first term is 0) and c_{n−1} = +∞ (so the last is 1). Note the
      // bands are *between* cutpoints: that is the whole reason a rating is
      // ordinal here rather than the number 3.
      const edges = [-Infinity, ...cuts, Infinity];
      const probs = [];
      for (let k = 0; k < edges.length - 1; k++) {
        const hi = edges[k + 1] === Infinity ? 1 : sig(edges[k + 1] - u);
        const lo = edges[k] === -Infinity ? 0 : sig(edges[k] - u);
        probs.push(Math.max(0, hi - lo));
      }
      /* Each band is drawn BETWEEN ITS OWN CUTPOINTS on the u axis, with its
         height showing P(y=k). Stacking them left-to-right as a probability bar
         — the first attempt — put the bands somewhere the cutpoint handles were
         not, so the picture and the model disagreed about where a rating lives.
         Here the geometry *is* the model: a rating occupies an interval of u,
         and how likely it is depends on where u falls relative to it. */
      /* Heights are normalised to the tallest band, not to 1.0. Six categories
         share the mass, so the peak is rarely above ~0.3 and an absolute scale
         renders every band as the same flat sliver — the height channel stops
         carrying anything. The printed percentage keeps the absolute value
         honest; the height is there to show the *shape* of the distribution. */
      const MAXH = 46;
      const peak = Math.max(...probs, 1e-6);
      probs.forEach((pr, k) => {
        const lo = k === 0 ? U_MIN : cuts[k - 1];
        const hi = k === probs.length - 1 ? U_MAX : cuts[k];
        const x1 = xOf(clamp(lo, U_MIN, U_MAX));
        const x2 = xOf(clamp(hi, U_MIN, U_MAX));
        const w = Math.max(0, x2 - x1);
        const h = (pr / peak) * MAXH;
        dyn.appendChild(el('rect', {
          x: x1, y: ROWS.star - h, width: w, height: h,
          fill: 'var(--phos-b)', opacity: 0.3 + 0.55 * pr,
        }));
        if (w > 18) {
          const t = el('text', {
            x: x1 + w / 2, y: ROWS.star - h - 5, 'text-anchor': 'middle',
            class: pr > 0.18 ? 'v-num-b' : 'v-axis',
          });
          t.textContent = `${'★'.repeat(k) || '0'} ${(pr * 100).toFixed(0)}%`;
          dyn.appendChild(t);
        }
      });
      // Where u actually is, so "which band am I in" is answerable by looking.
      dyn.appendChild(el('line', {
        x1: xOf(u), y1: ROWS.star - MAXH - 16, x2: xOf(u), y2: ROWS.star + 9,
        stroke: 'var(--phos-a)', 'stroke-width': 1.5, 'stroke-dasharray': '3 3',
      }));
      dyn.appendChild(el('circle', { cx: xOf(u), cy: ROWS.star, r: 6, fill: 'var(--phos-a)' }));

      moveTo(hTau, xOf(tau), ROWS.keep);
      hCuts.forEach((g, j) => moveTo(g, xOf(cuts[j]), ROWS.star));

      const best = probs.indexOf(Math.max(...probs));
      readout.innerHTML =
        `At <i>u = ${fmt(u)}</i>: the duel says A wins <b>${(p * 100).toFixed(0)}%</b> of the time, ` +
        `keep/kill says keep with probability <b>${(pk * 100).toFixed(0)}%</b> against τ = ${fmt(tau)}, ` +
        `and the most likely rating is <b>${best}★</b> at <b>${(probs[best] * 100).toFixed(0)}%</b>. ` +
        `One latent quantity, three ways of asking about it.`;
    }

    const su = slider(controls, 'u (candidate A)', { min: -4, max: 4, step: 0.05, value: u });
    su.addEventListener('input', () => { u = parseFloat(su.value); draw(); });
    const sb = slider(controls, 'u (candidate B)', { min: -4, max: 4, step: 0.05, value: uB });
    sb.addEventListener('input', () => { uB = parseFloat(sb.value); draw(); });
    draw();
  };

  /* =======================================================================
   * k-weighting — the BS.1770 filter, evaluated
   *
   * Computed from the exact constants in `auracle_features::loudness`, by the
   * same RBJ bilinear transform, so this curve is the filter the pipeline runs
   * rather than a picture of one. Evaluate |H(e^{jω})| for each biquad and sum
   * the dB.
   * ===================================================================== */
  VIZ['k-weighting'] = (root) => {
    const { stage, controls, readout } = scaffold(root);
    const W = 720, H = 250, L = 52, R = 24, T = 18, B = 40;
    const s = svg(W, H, 'Frequency response of the two BS.1770 K-weighting biquads and their sum');
    stage.appendChild(s);

    let fs = 44100;

    // Verbatim from crates/auracle-features/src/loudness.rs.
    function kShelf(fsHz) {
      const gDb = 3.999843853973347, q = 0.7071752369554196, fc = 1681.974450955533;
      const k = Math.tan(Math.PI * fc / fsHz);
      const vh = Math.pow(10, gDb / 20), vb = Math.pow(vh, 0.499666774155);
      const a0 = 1 + k / q + k * k;
      return {
        b0: (vh + vb * k / q + k * k) / a0, b1: 2 * (k * k - vh) / a0,
        b2: (vh - vb * k / q + k * k) / a0, a1: 2 * (k * k - 1) / a0,
        a2: (1 - k / q + k * k) / a0,
      };
    }
    function kHighpass(fsHz) {
      const q = 0.5003270373238773, fc = 38.13547087602444;
      const k = Math.tan(Math.PI * fc / fsHz);
      const a0 = 1 + k / q + k * k;
      return { b0: 1 / a0, b1: -2 / a0, b2: 1 / a0, a1: 2 * (k * k - 1) / a0, a2: (1 - k / q + k * k) / a0 };
    }
    /** |H(e^{jω})| in dB for a direct-form biquad. */
    function magDb(c, f, fsHz) {
      const w = 2 * Math.PI * f / fsHz, cw = Math.cos(w), sw = Math.sin(w);
      const c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
      const nr = c.b0 + c.b1 * cw + c.b2 * c2, ni = -(c.b1 * sw + c.b2 * s2);
      const dr = 1 + c.a1 * cw + c.a2 * c2, di = -(c.a1 * sw + c.a2 * s2);
      return 20 * Math.log10(Math.hypot(nr, ni) / Math.hypot(dr, di) + 1e-12);
    }

    const F_LO = 10, F_HI = 20000, DB_LO = -30, DB_HI = 8;
    const xOf = (f) => L + (Math.log10(f / F_LO) / Math.log10(F_HI / F_LO)) * (W - L - R);
    const yOf = (db) => T + (1 - (db - DB_LO) / (DB_HI - DB_LO)) * (H - T - B);

    const grid = el('g', {}); s.appendChild(grid);
    for (const f of [10, 100, 1000, 10000]) {
      const x = xOf(f);
      grid.appendChild(el('line', { class: 'v-grid', x1: x, y1: T, x2: x, y2: H - B }));
      const t = el('text', { x, y: H - B + 15, 'text-anchor': 'middle', class: 'v-axis' });
      t.textContent = f >= 1000 ? `${f / 1000}k` : `${f}`;
      grid.appendChild(t);
    }
    for (const db of [5, 0, -10, -20, -30]) {
      const y = yOf(db);
      grid.appendChild(el('line', { class: 'v-grid', x1: L, y1: y, x2: W - R, y2: y }));
      const t = el('text', { x: L - 7, y: y + 3, 'text-anchor': 'end', class: 'v-axis' });
      t.textContent = `${db}`;
      grid.appendChild(t);
    }
    const yl = el('text', { x: 4, y: T + 8, class: 'v-axis' });
    yl.textContent = 'dB';
    s.appendChild(yl);
    const xl = el('text', { x: (L + W - R) / 2, y: H - 6, 'text-anchor': 'middle', class: 'v-axis' });
    xl.textContent = 'frequency (Hz)';
    s.appendChild(xl);

    const curves = el('g', {}); s.appendChild(curves);

    function draw() {
      curves.textContent = '';
      const shelf = kShelf(fs), hp = kHighpass(fs);
      const series = [
        { c: (f) => magDb(shelf, f, fs), stroke: 'var(--phos-a-deep)', dash: '3 3', name: 'high shelf' },
        { c: (f) => magDb(hp, f, fs), stroke: 'var(--phos-b-deep)', dash: '3 3', name: 'highpass' },
        { c: (f) => magDb(shelf, f, fs) + magDb(hp, f, fs), stroke: 'var(--phos-a)', dash: null, name: 'K-weighted' },
      ];
      for (const sr of series) {
        let d = '';
        for (let i = 0; i <= 260; i++) {
          const f = F_LO * Math.pow(F_HI / F_LO, i / 260);
          if (f >= fs / 2) break;
          const y = clamp(yOf(sr.c(f)), T - 4, H - B + 4);
          d += `${i === 0 ? 'M' : 'L'}${xOf(f).toFixed(1)} ${y.toFixed(1)}`;
        }
        curves.appendChild(el('path', {
          d, fill: 'none', stroke: sr.stroke, 'stroke-width': sr.dash ? 1.4 : 2.2,
          'stroke-dasharray': sr.dash, 'stroke-linejoin': 'round',
        }));
      }
      // Mark the two corner frequencies the constants name.
      for (const [f, label] of [[1681.97, '1682 Hz shelf'], [38.14, '38 Hz HP']]) {
        const x = xOf(f);
        curves.appendChild(el('line', { x1: x, y1: T, x2: x, y2: H - B, stroke: 'var(--silk-mute)', 'stroke-width': 1, 'stroke-dasharray': '2 4' }));
        const t = el('text', { x: x + 4, y: T + 10, class: 'v-axis' });
        t.textContent = label;
        curves.appendChild(t);
      }

      const at1k = magDb(shelf, 1000, fs) + magDb(hp, 1000, fs);
      const at10k = magDb(shelf, 10000, fs) + magDb(hp, 10000, fs);
      const at30 = magDb(shelf, 30, fs) + magDb(hp, 30, fs);
      readout.innerHTML =
        `At ${(fs / 1000).toFixed(1)} kHz: <i>${fmt(at1k, 1)} dB</i> at 1 kHz, ` +
        `<i>+${fmt(at10k, 1)} dB</i> at 10 kHz, <i>${fmt(at30, 1)} dB</i> at 30 Hz. ` +
        `The ear is more sensitive up high and less down low, and matching candidates on ` +
        `<b>this</b> curve rather than on raw RMS is what stops the model learning ` +
        `"I like loud" and calling it timbre.`;
    }

    const sr = slider(controls, 'sample rate', { min: 0, max: 2, step: 1, value: 0, format: (v) => [44.1, 48, 96][v] + ' kHz' });
    sr.addEventListener('input', () => { fs = [44100, 48000, 96000][parseInt(sr.value, 10)]; draw(); });
    draw();
  };

  /* =======================================================================
   * phrase — the standard audition stimulus
   *
   * Every candidate is rendered under this and nothing else, which is what makes
   * audio features comparable at all. Each segment exists to reveal one thing,
   * so the figure labels which feature each one feeds.
   * ===================================================================== */
  VIZ['phrase'] = (root) => {
    const { stage, controls, readout } = scaffold(root);
    const W = 720, H = 210, L = 46, R = 16, TOP = 34;
    const s = svg(W, H, 'Timeline of the four-note standard audition phrase and what each segment measures');
    stage.appendChild(s);

    // PhraseSpec::default(), verbatim.
    const NOTES = [
      { voct: 0, on: 1.80, off: 0.20, chord: [], name: 'C4 held', reveals: 'slow attacks · sub-Hz modulation', feat: 'held_centroid_std' },
      { voct: 1, on: 0.30, off: 0.15, chord: [], name: 'C5 stab', reveals: 'does it speak up high', feat: 'high_ratio' },
      { voct: 0, on: 0.50, off: 0.20, chord: [4 / 12], name: 'C4+E4 dyad', reveals: 'intermodulation when stacked', feat: 'chord_flatness_delta' },
      { voct: -1, on: 0.80, off: 1.10, chord: [], name: 'C3 + release', reveals: 'bass register · the tail', feat: 'tail_ratio' },
    ];
    const total = NOTES.reduce((a, n) => a + n.on + n.off, 0);
    const xOf = (t) => L + (t / total) * (W - L - R);

    let sel = -1;

    s.appendChild(el('line', { class: 'v-rule', x1: L, y1: H - 40, x2: W - R, y2: H - 40 }));
    for (let t = 0; t <= Math.ceil(total); t++) {
      const x = xOf(t);
      s.appendChild(el('line', { class: 'v-grid', x1: x, y1: TOP, x2: x, y2: H - 40 }));
      const lab = el('text', { x, y: H - 26, 'text-anchor': 'middle', class: 'v-axis' });
      lab.textContent = `${t}s`;
      s.appendChild(lab);
    }
    const lanes = ['voice 1', 'voice 2'];
    lanes.forEach((n, i) => {
      const t = el('text', { x: 4, y: TOP + 16 + i * 30, class: 'v-axis' });
      t.textContent = n;
      s.appendChild(t);
    });

    const blocks = el('g', {}); s.appendChild(blocks);
    const tailG = el('g', {}); s.appendChild(tailG);

    function draw() {
      blocks.textContent = '';
      let t = 0;
      NOTES.forEach((n, i) => {
        const x1 = xOf(t), x2 = xOf(t + n.on), x3 = xOf(t + n.on + n.off);
        const on = i === sel;
        // Gate-on solid, gate-off as an outline: the release window is part of
        // the stimulus and the tail feature is measured inside it.
        blocks.appendChild(el('rect', {
          x: x1, y: TOP + 4, width: x2 - x1, height: 22, rx: 2,
          fill: 'var(--phos-a)', opacity: on ? 0.85 : 0.5,
          style: 'cursor:pointer', 'data-i': i,
        }));
        blocks.appendChild(el('rect', {
          x: x2, y: TOP + 4, width: Math.max(0, x3 - x2), height: 22, rx: 2,
          fill: 'none', stroke: 'var(--phos-a-deep)', 'stroke-width': 1, 'stroke-dasharray': '2 3',
        }));
        if (n.chord.length) {
          blocks.appendChild(el('rect', {
            x: x1, y: TOP + 34, width: x2 - x1, height: 22, rx: 2,
            fill: 'var(--phos-a)', opacity: on ? 0.7 : 0.32,
          }));
        }
        const lab = el('text', { x: (x1 + x2) / 2, y: TOP - 6, 'text-anchor': 'middle', class: on ? 'v-num-a' : 'v-axis' });
        lab.textContent = n.name;
        blocks.appendChild(lab);
        t += n.on + n.off;
      });

      // The tail window: the final 300 ms, which is why the low note is last.
      const tx = xOf(total - 0.3);
      tailG.textContent = '';
      tailG.appendChild(el('rect', {
        x: tx, y: TOP, width: xOf(total) - tx, height: 62,
        fill: 'var(--phos-b)', opacity: 0.14,
      }));
      const tl = el('text', { x: tx - 4, y: TOP + 74, 'text-anchor': 'end', class: 'v-num-b' });
      tl.textContent = 'final 300 ms → tail_ratio';
      tailG.appendChild(tl);

      const n = sel >= 0 ? NOTES[sel] : null;
      readout.innerHTML = n
        ? `<b>${n.name}</b> — ${n.on.toFixed(2)} s gate-on, ${n.off.toFixed(2)} s after. ` +
          `Reveals ${n.reveals}, and feeds <i>${n.feat}</i>.`
        : `Four notes, ${total.toFixed(2)} s, one fixed RNG seed. Every candidate is measured ` +
          `under exactly this, because an audio feature is only comparable across patches ` +
          `under an identical stimulus. <b>Click a segment</b> to see what it is for.`;
    }

    blocks.addEventListener('click', (e) => {
      const i = e.target.getAttribute && e.target.getAttribute('data-i');
      if (i == null) return;
      sel = sel === +i ? -1 : +i;
      draw();
    });
    NOTES.forEach((n, i) => button(controls, n.name, () => { sel = sel === i ? -1 : i; draw(); }));
    draw();
  };

  /* =======================================================================
   * boltzmann — β is the one dial between browsing and optimizing
   *
   * π_β(x) ∝ p_grammar(x) · e^{β·u(x)}, evaluated over a toy 1-D "patch space"
   * so the two factors are visible separately. The point the page makes is that
   * parsimony is the *prior*, not a penalty: at β = 0 the target is the prior
   * exactly, and nothing about the search has to be told to prefer small terms.
   * ===================================================================== */
  VIZ['boltzmann'] = (root) => {
    const { stage, controls, readout } = scaffold(root);
    const W = 720, H = 240, L = 46, R = 18, T = 20, B = 42;
    const s = svg(W, H, 'The grammar prior, a learned utility, and the Boltzmann target they combine into');
    stage.appendChild(s);

    let beta = 2.0;   // SessionConfig::beta
    const N = 240;

    // A stand-in for "patch space" ordered by complexity: the prior decays with
    // it (deeper terms pay more prior mass by construction) and the utility is
    // bumpy, with its best region NOT at the simplest end — which is the whole
    // tension the target has to resolve.
    const prior = (t) => Math.exp(-2.6 * t);
    const util = (t) => 1.15 * Math.exp(-Math.pow((t - 0.62) / 0.13, 2))
                      + 0.72 * Math.exp(-Math.pow((t - 0.24) / 0.10, 2))
                      + 0.30 * Math.exp(-Math.pow((t - 0.86) / 0.09, 2));

    const xOf = (t) => L + t * (W - L - R);
    const plotH = H - T - B;

    s.appendChild(el('line', { class: 'v-rule', x1: L, y1: H - B, x2: W - R, y2: H - B }));
    const xl = el('text', { x: (L + W - R) / 2, y: H - 8, 'text-anchor': 'middle', class: 'v-axis' });
    xl.textContent = 'patch space, ordered by complexity  →';
    s.appendChild(xl);

    const curves = el('g', {}); s.appendChild(curves);

    function series(fn, opts) {
      // Each curve is normalised to its own peak: they are three different
      // quantities (a probability, a utility, an unnormalised density) and
      // sharing one y scale would be a category error dressed as a comparison.
      const vals = [];
      for (let i = 0; i <= N; i++) vals.push(fn(i / N));
      const peak = Math.max(...vals.map(Math.abs), 1e-9);
      let d = '';
      vals.forEach((v, i) => {
        const x = xOf(i / N), y = H - B - (v / peak) * plotH * 0.92;
        d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
      });
      const path = el('path', {
        d, fill: opts.fill || 'none', stroke: opts.stroke,
        'stroke-width': opts.w || 1.6, 'stroke-dasharray': opts.dash,
        opacity: opts.opacity || 1,
      });
      curves.appendChild(path);
      return { vals, peak };
    }

    function draw() {
      curves.textContent = '';
      series(prior, { stroke: 'var(--silk-mute)', dash: '4 3' });
      series(util, { stroke: 'var(--phos-b-dim)', dash: '4 3' });
      const target = (t) => prior(t) * Math.exp(beta * util(t));
      const { vals, peak } = series(target, { stroke: 'var(--phos-a)', w: 2.4 });

      // Where the target actually puts its mass, as a filled area.
      let d = `M${xOf(0)} ${H - B}`;
      vals.forEach((v, i) => { d += `L${xOf(i / N).toFixed(1)} ${(H - B - (v / peak) * plotH * 0.92).toFixed(1)}`; });
      d += `L${xOf(1)} ${H - B}Z`;
      curves.insertBefore(el('path', { d, fill: 'var(--phos-a)', opacity: 0.1 }), curves.firstChild);

      for (const [txt, colour, y] of [
        ['p_grammar  (parsimony)', 'var(--silk-mute)', T + 10],
        ['E[u]  (learned taste)', 'var(--phos-b-dim)', T + 24],
        ['π_β  (the target)', 'var(--phos-a)', T + 38],
      ]) {
        const t = el('text', { x: W - R, y, 'text-anchor': 'end', class: 'v-axis', fill: colour });
        t.textContent = txt;
        curves.appendChild(t);
      }

      // Where the mode sits tells the story better than any adjective.
      let bi = 0;
      vals.forEach((v, i) => { if (v > vals[bi]) bi = i; });
      const mode = bi / N;
      curves.appendChild(el('line', {
        x1: xOf(mode), y1: T, x2: xOf(mode), y2: H - B,
        stroke: 'var(--phos-a)', 'stroke-width': 1, 'stroke-dasharray': '2 4',
      }));

      readout.innerHTML = beta < 0.15
        ? `<b>β = ${fmt(beta, 1)}.</b> The target <i>is</i> the grammar prior. The search browses, ` +
          `and simple terms dominate — not because anything penalises size, but because that is ` +
          `what the prior says.`
        : `<b>β = ${fmt(beta, 1)}.</b> The target's mode has moved to <i>${fmt(mode, 2)}</i> — ` +
          `${mode > 0.5 ? 'out into the complex region the taste model likes' : 'still near the simple end'}. ` +
          `Parsimony and taste are pulling against each other, and β is the only dial between them.`;
    }

    const sb = slider(controls, 'β', { min: 0, max: 8, step: 0.1, value: beta, format: (v) => fmt(v, 1) });
    sb.addEventListener('input', () => { beta = parseFloat(sb.value); draw(); });
    button(controls, 'β = 0  browse', () => { beta = 0; sb.value = 0; sb.dispatchEvent(new Event('input')); });
    button(controls, 'β = 2  shipped', () => { beta = 2; sb.value = 2; sb.dispatchEvent(new Event('input')); });
    button(controls, 'β = 8  optimize', () => { beta = 8; sb.value = 8; sb.dispatchEvent(new Event('input')); });
    draw();
  };

  /* =======================================================================
   * tilt — the taste→grammar proposal tilt, and the clamp doing its job
   *
   * w'_i ∝ w_i · clamp(e^{η·t_i}, ¼, 4). The clamp is the part worth seeing:
   * without it a confident coefficient drives a kind's proposal weight to
   * effectively zero, and a prior that can no longer *generate* an option can
   * never be argued back into it by evidence.
   * ===================================================================== */
  VIZ['tilt'] = (root) => {
    const { stage, controls, readout } = scaffold(root);
    const W = 720, H = 250, L = 92, R = 74, T = 22;
    const s = svg(W, H, 'Base proposal weights and the same weights tilted by the taste model');
    stage.appendChild(s);

    // Prevalences in the shape the prior actually draws them.
    const KINDS = [
      { name: 'filter', w: 0.20, t: 0.9 },
      { name: 'drive', w: 0.15, t: 1.8 },
      { name: 'time', w: 0.13, t: -0.4 },
      { name: 'mod fx', w: 0.13, t: 1.2 },
      { name: 'reverb', w: 0.09, t: 0.2 },
      { name: 'dynamics', w: 0.10, t: -1.6 },
      { name: 'ring mod', w: 0.035, t: -2.4 },
      { name: 'granular', w: 0.015, t: 0.6 },
    ];
    let eta = 0.6;          // SessionConfig::proposal_tilt
    let clampOn = true;

    const rowH = (H - T - 20) / KINDS.length;
    const bars = el('g', {}); s.appendChild(bars);

    function draw() {
      bars.textContent = '';
      const mult = KINDS.map((k) => {
        const raw = Math.exp(eta * k.t);
        return clampOn ? clamp(raw, 0.25, 4) : raw;
      });
      const tilted = KINDS.map((k, i) => k.w * mult[i]);
      const sum = tilted.reduce((a, b) => a + b, 0);
      const norm = tilted.map((v) => v / sum);
      const scale = (W - L - R) / Math.max(...norm, ...KINDS.map((k) => k.w));

      let clampedCount = 0;
      KINDS.forEach((k, i) => {
        const y = T + i * rowH;
        const lab = el('text', { x: L - 8, y: y + rowH / 2 + 3, 'text-anchor': 'end', class: 'v-axis' });
        lab.textContent = k.name;
        bars.appendChild(lab);

        // base (hollow) then tilted (filled), so the move is the visible thing.
        bars.appendChild(el('rect', {
          x: L, y: y + 3, width: k.w * scale, height: rowH - 10,
          fill: 'none', stroke: 'var(--silk-mute)', 'stroke-width': 1,
        }));
        const raw = Math.exp(eta * k.t);
        const bound = clampOn && (raw > 4.0001 || raw < 0.2499);
        if (bound) clampedCount++;
        bars.appendChild(el('rect', {
          x: L, y: y + 3, width: Math.max(0.5, norm[i] * scale), height: rowH - 10,
          fill: bound ? 'var(--led-red)' : 'var(--phos-b)', opacity: bound ? 0.55 : 0.7,
        }));
        const val = el('text', { x: W - R + 6, y: y + rowH / 2 + 3, class: bound ? 'v-num' : 'v-num-b' });
        val.textContent = `×${fmt(mult[i], 2)}${bound ? '  clamped' : ''}`;
        bars.appendChild(val);
      });

      const lo = Math.min(...KINDS.map((k) => Math.exp(eta * k.t)));
      const hi = Math.max(...KINDS.map((k) => Math.exp(eta * k.t)));
      readout.innerHTML = !clampOn
        ? `<b>Clamp off</b>, η = ${fmt(eta, 2)}. Multipliers run from ×${fmt(lo, 3)} to ×${fmt(hi, 2)}. ` +
          (lo < 0.25 || hi > 4
            ? `A kind the model currently dislikes is now barely proposed at all — and a prior that ` +
              `cannot <i>generate</i> an option can never be argued back into it by evidence, because ` +
              `the evidence would have to come from proposing it.`
            : `Still a mild tilt at this η — <b>raise it</b> and watch the extremes run away.`)
        : `<b>η = ${fmt(eta, 2)}</b>, every multiplier clamped to [¼, 4]. ` +
          (clampedCount
            ? `<b>${clampedCount}</b> ${clampedCount === 1
                ? 'kind is at a bound right now — its coefficient is'
                : 'kinds are at a bound right now — their coefficients are'} strong enough that, ` +
              `unclamped, the search would stop exploring ${clampedCount === 1 ? 'it' : 'them'}.`
            : `Nothing is at a bound yet; raise η and watch the strongest opinions hit one.`);
    }

    const se = slider(controls, 'η  tilt strength', { min: 0, max: 2, step: 0.05, value: eta });
    se.addEventListener('input', () => { eta = parseFloat(se.value); draw(); });
    button(controls, 'turn the clamp off', (b) => {
      clampOn = !clampOn;
      b.setAttribute('aria-pressed', String(!clampOn));
      b.textContent = clampOn ? 'turn the clamp off' : 'put the clamp back';
      draw();
    });
    draw();
  };

  /* =======================================================================
   * reliability — why the hit rate lies and Brier skill does not
   *
   * Runs real forecasts. A synthetic forecaster with an adjustable confidence
   * exponent predicts duels whose true probability is known; the diagram, the
   * Brier skill and the accuracy are all scored from those draws. The lesson
   * the page states — that an information-seeking rule pins accuracy near 50%
   * by construction — is reproduced by choosing near-tie questions.
   * ===================================================================== */
  VIZ['reliability'] = (root) => {
    const { stage, controls, readout } = scaffold(root);
    const W = 460, H = 300, PAD = 44;
    const s = svg(W, H, 'A reliability diagram: forecast probability against observed frequency');
    stage.appendChild(s);

    let sharpness = 1.0;     // 1 = calibrated, >1 overconfident, <1 under
    let nearTies = false;    // an information-seeking acquisition rule
    const N = 400, BINS = 5;

    const px = (p) => PAD + p * (W - PAD - 18);
    const py = (p) => H - PAD - p * (H - PAD - 18);

    s.appendChild(el('line', { class: 'v-rule', x1: PAD, y1: H - PAD, x2: W - 18, y2: H - PAD }));
    s.appendChild(el('line', { class: 'v-rule', x1: PAD, y1: 18, x2: PAD, y2: H - PAD }));
    s.appendChild(el('line', {
      x1: px(0), y1: py(0), x2: px(1), y2: py(1),
      stroke: 'var(--silk-mute)', 'stroke-width': 1, 'stroke-dasharray': '3 3',
    }));
    const dl = el('text', { x: px(0.56), y: py(0.83), class: 'v-axis' });
    dl.textContent = 'perfectly honest';
    s.appendChild(dl);
    for (const v of [0, 0.5, 1]) {
      const xt = el('text', { x: px(v), y: H - PAD + 14, 'text-anchor': 'middle', class: 'v-axis' });
      xt.textContent = v;
      s.appendChild(xt);
      const yt = el('text', { x: PAD - 7, y: py(v) + 3, 'text-anchor': 'end', class: 'v-axis' });
      yt.textContent = v;
      s.appendChild(yt);
    }
    const xlab = el('text', { x: (PAD + W) / 2 - 9, y: H - 10, 'text-anchor': 'middle', class: 'v-axis' });
    xlab.textContent = 'it said A would win this often';
    s.appendChild(xlab);

    const dots = el('g', {}); s.appendChild(dots);

    // Deterministic, so the figure does not reshuffle under the reader.
    let seed = 12345;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

    function draw() {
      seed = 12345;
      dots.textContent = '';
      const bins = Array.from({ length: BINS }, () => ({ n: 0, p: 0, o: 0 }));
      let brier = 0, hits = 0;

      for (let i = 0; i < N; i++) {
        // The true probability of this duel. A near-tie rule asks questions
        // clustered around 0.5 on purpose — they are the informative ones.
        const trueP = nearTies ? 0.5 + (rnd() - 0.5) * 0.34 : rnd();
        // The forecast: calibrated at sharpness 1, over/underconfident otherwise.
        const lo = Math.log(trueP / (1 - trueP)) * sharpness;
        const p = 1 / (1 + Math.exp(-lo));
        const won = rnd() < trueP;
        const pChosen = won ? p : 1 - p;
        brier += (pChosen - 1) ** 2;
        if (pChosen > 0.5) hits++;
        const b = Math.min(BINS - 1, Math.floor(p * BINS));
        bins[b].n++; bins[b].p += p; bins[b].o += won ? 1 : 0;
      }
      brier /= N;
      const skill = 1 - brier / 0.25;
      const acc = hits / N;

      for (const b of bins) {
        if (!b.n) continue;
        const p = b.p / b.n, o = b.o / b.n;
        // A whisker for how much a bin this size could wobble by chance.
        const se = Math.sqrt(Math.max(o * (1 - o), 0.02) / b.n);
        dots.appendChild(el('line', {
          x1: px(p), y1: py(clamp(o - 2 * se, 0, 1)), x2: px(p), y2: py(clamp(o + 2 * se, 0, 1)),
          stroke: 'var(--phos-b-deep)', 'stroke-width': 1.5,
        }));
        dots.appendChild(el('circle', {
          cx: px(p), cy: py(o), r: 3 + Math.sqrt(b.n) * 0.42, fill: 'var(--phos-b)', opacity: 0.9,
        }));
      }

      readout.innerHTML =
        `Brier skill <b>${skill >= 0 ? '+' : ''}${fmt(skill, 3)}</b> · hit rate <b>${(acc * 100).toFixed(0)}%</b>` +
        (nearTies
          ? ` — and there it is: asking only near-ties pins the hit rate near 50% <i>however good the model is</i>. ` +
            `The skill score still moves, because it scores sharpness rather than a coin-flip tally.`
          : sharpness > 1.4
            ? ` — overconfident. The dots sit below the line on the right: when it says 80% it is right less often than that.`
            : sharpness < 0.7
              ? ` — underconfident. It knows more than it is willing to claim.`
              : ` — honest. The dots sit on the diagonal, which is the only thing that makes the number above worth reading.`);
    }

    const ss = slider(controls, 'confidence', { min: 0.3, max: 2.6, step: 0.05, value: 1,
      format: (v) => v < 0.75 ? 'under' : v > 1.35 ? 'over' : 'honest' });
    ss.addEventListener('input', () => { sharpness = parseFloat(ss.value); draw(); });
    button(controls, 'ask only near-ties', (b) => {
      nearTies = !nearTies;
      b.setAttribute('aria-pressed', String(nearTies));
      draw();
    });
    draw();
  };

  /* =======================================================================
   * ess — importance weights degenerate, and ESS is what says so
   *
   * Fold observations into a set of posterior draws by SIS and watch the weights
   * concentrate. ESS = 1/Σw² collapses toward 1; resampling trades the spike for
   * duplicates, which is the honest cost. This is the mechanism behind
   * `needs_refit`, and it is hard to picture from the formula alone.
   * ===================================================================== */
  VIZ['ess'] = (root) => {
    const { stage, controls, readout } = scaffold(root);
    const W = 720, H = 170, L = 44, R = 96, T = 16, B = 26;
    const s = svg(W, H, 'Importance weights over posterior draws, and their effective sample size');
    stage.appendChild(s);

    const S = 48;
    let w = new Array(S).fill(1 / S);
    let folded = 0;
    let seed = 99;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    // Each draw's "opinion" — how well it predicts a typical observation.
    const quality = Array.from({ length: S }, () => 0.25 + rnd() * 0.7);

    const bars = el('g', {}); s.appendChild(bars);
    const meter = el('g', {}); s.appendChild(meter);

    const ess = () => 1 / w.reduce((a, x) => a + x * x, 0);

    function draw() {
      bars.textContent = '';
      meter.textContent = '';
      const bw = (W - L - R) / S;
      const peak = Math.max(...w);
      w.forEach((wi, i) => {
        const h = (wi / peak) * (H - T - B);
        bars.appendChild(el('rect', {
          x: L + i * bw, y: H - B - h, width: Math.max(1, bw - 1.4), height: h,
          fill: 'var(--phos-b)', opacity: 0.35 + 0.6 * (wi / peak),
        }));
      });
      s.appendChild(el('line', { class: 'v-rule', x1: L, y1: H - B, x2: W - R, y2: H - B }));
      const lab = el('text', { x: 4, y: T + 8, class: 'v-axis' });
      lab.textContent = 'weight';
      meter.appendChild(lab);

      const e = ess();
      const frac = e / S;
      meter.appendChild(el('rect', { x: W - R + 8, y: T + 22, width: 70, height: 9, fill: 'none', stroke: 'var(--hairline)' }));
      meter.appendChild(el('rect', {
        x: W - R + 8, y: T + 22, width: 70 * frac, height: 9,
        fill: frac < 0.25 ? 'var(--led-red)' : 'var(--phos-a)',
      }));
      const et = el('text', { x: W - R + 8, y: T + 16, class: 'v-num-b' });
      et.textContent = `ESS ${e.toFixed(1)} / ${S}`;
      meter.appendChild(et);

      readout.innerHTML = folded === 0
        ? `A fresh fit: <b>${S}</b> draws, uniform weights, <i>ESS ${e.toFixed(1)}</i>. ` +
          `Every draw is still contributing.`
        : frac < 0.25
          ? `<b>${folded}</b> observations folded in. <b>ESS ${e.toFixed(1)}</b> — the weights have ` +
            `collapsed onto a handful of draws, and a "posterior" of a few points would tell the ` +
            `acquisition rule it is <i>certain</i> when it is merely exhausted. This is the state ` +
            `<code>needs_refit</code> is watching for.`
          : `<b>${folded}</b> observations folded in by reweighting — exact, and O(S). ` +
            `<i>ESS ${e.toFixed(1)}</i> and falling.`;
    }

    button(controls, 'fold in an observation', () => {
      // w_s ← w_s · p(y | θ_s), renormalised. Exactly the shipped update.
      const lucky = rnd();
      w = w.map((wi, i) => wi * Math.pow(quality[i], 1) * (0.4 + lucky));
      const sum = w.reduce((a, b) => a + b, 0);
      w = w.map((x) => x / sum);
      folded++;
      draw();
    });
    button(controls, 'fold in ten', () => {
      for (let k = 0; k < 10; k++) {
        const lucky = rnd();
        w = w.map((wi, i) => wi * quality[i] * (0.4 + lucky));
        const sum = w.reduce((a, b) => a + b, 0);
        w = w.map((x) => x / sum);
        folded++;
      }
      draw();
    });
    button(controls, 'resample', () => {
      // Systematic resampling, offset ½N — deterministic, as the engine's is.
      const out = [];
      const step = 1 / S;
      let u = 0.5 * step, cum = 0, src = 0;
      for (let i = 0; i < S; i++) {
        while (src + 1 < S && cum + w[src] < u) { cum += w[src]; src++; }
        out.push(src);
        u += step;
      }
      w = new Array(S).fill(1 / S);
      // The impoverishment is the honest cost: distinct draws, not distinct info.
      const distinct = new Set(out).size;
      draw();
      readout.innerHTML =
        `Resampled. Weights are uniform again and <b>ESS ${S}.0</b> — but only ` +
        `<b>${distinct}</b> of the ${S} draws are distinct. The sample is impoverished ` +
        `rather than informative, which is why this is a stopgap between real fits ` +
        `and not a substitute for one.`;
    });
    button(controls, 'reset', () => { w = new Array(S).fill(1 / S); folded = 0; seed = 99; draw(); });
    draw();
  };

  /* =======================================================================
   * two-loops — the architecture, with the traffic moving
   *
   * The ASCII version of this diagram says what connects to what. What it
   * cannot say is that the two loops run at *different speeds*, which is the
   * entire reason the design works. So the particles move at different rates,
   * and under reduced motion the figure states the rates in words instead.
   * ===================================================================== */
  VIZ['two-loops'] = (root) => {
    const { stage, controls, readout } = scaffold(root);
    const W = 720, H = 300;
    const s = svg(W, H, 'Two loops sharing one observation stream: a fast machine-paced patch loop and a slow human-paced taste loop');
    stage.appendChild(s);

    const boxes = [
      { x: 40, y: 30, w: 250, h: 78, title: 'patch loop', sub: 'machine-paced', lines: ['grammar prior → vet → pool', 'local MH toward π_β'], colour: 'var(--phos-a)' },
      { x: 430, y: 30, w: 250, h: 78, title: 'taste loop', sub: 'human-paced', lines: ['observe → posterior', 'persisted across sessions'], colour: 'var(--phos-b)' },
      { x: 235, y: 196, w: 250, h: 66, title: 'acquisition', sub: 'uniform by default', lines: ['choose what to play'], colour: 'var(--silk-dim)' },
    ];

    for (const b of boxes) {
      s.appendChild(el('rect', {
        x: b.x, y: b.y, width: b.w, height: b.h, rx: 4,
        fill: 'var(--panel, rgba(255,255,255,.03))', stroke: b.colour, 'stroke-width': 1.2, opacity: 0.95,
      }));
      const t = el('text', { x: b.x + 12, y: b.y + 20, class: 'v-num', fill: b.colour });
      t.textContent = b.title;
      s.appendChild(t);
      const st = el('text', { x: b.x + b.w - 12, y: b.y + 20, 'text-anchor': 'end', class: 'v-axis' });
      st.textContent = b.sub;
      s.appendChild(st);
      b.lines.forEach((ln, i) => {
        const l = el('text', { x: b.x + 12, y: b.y + 40 + i * 15, class: 'v-axis' });
        l.textContent = ln;
        s.appendChild(l);
      });
    }

    // The three edges, as paths particles can ride.
    const EDGES = [
      { d: 'M290 69 L430 69', colour: 'var(--phos-a)', label: 'candidates', lx: 360, ly: 60, speed: 1.0 },
      { d: 'M555 108 L555 160 Q555 196 485 214', colour: 'var(--phos-b)', label: 'what to ask', lx: 600, ly: 150, speed: 0.32 },
      { d: 'M235 214 Q165 196 165 160 L165 108', colour: 'var(--phos-b)', label: 'your answers', lx: 96, ly: 150, speed: 0.32 },
      { d: 'M430 92 Q360 130 290 92', colour: 'var(--phos-b-deep)', label: 'θ tilts the proposals', lx: 360, ly: 140, speed: 0.32 },
    ];

    /* Arrowheads, so direction survives without motion. Under reduced motion the
       particles are frozen at two points on each edge, and a stationary dot says
       nothing about which way the traffic goes. */
    const defs = el('defs', {});
    for (const [id, colour] of [['a', 'var(--phos-a)'], ['b', 'var(--phos-b)'], ['c', 'var(--phos-b-deep)']]) {
      const m = el('marker', {
        id: `viz-arrow-${id}`, viewBox: '0 0 8 8', refX: 7, refY: 4,
        markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse',
      });
      m.appendChild(el('path', { d: 'M0 0 L8 4 L0 8 z', fill: colour, opacity: 0.75 }));
      defs.appendChild(m);
    }
    s.appendChild(defs);
    const ARROW = { 'var(--phos-a)': 'a', 'var(--phos-b)': 'b', 'var(--phos-b-deep)': 'c' };

    const edgeG = el('g', {}); s.appendChild(edgeG);
    const paths = EDGES.map((e) => {
      const p = el('path', {
        d: e.d, fill: 'none', stroke: e.colour, 'stroke-width': 1.3, opacity: 0.55,
        'marker-end': `url(#viz-arrow-${ARROW[e.colour] || 'b'})`,
      });
      edgeG.appendChild(p);
      const t = el('text', { x: e.lx, y: e.ly, 'text-anchor': 'middle', class: 'v-axis' });
      t.textContent = e.label;
      edgeG.appendChild(t);
      return p;
    });

    if (REDUCED) {
      // A stopped animation is not a picture of a slow loop, it is a picture of
      // a broken one. Say the rates instead.
      EDGES.forEach((e, i) => {
        const len = paths[i].getTotalLength();
        for (const f of [0.3, 0.65]) {
          const pt = paths[i].getPointAtLength(len * f);
          edgeG.appendChild(el('circle', { cx: pt.x, cy: pt.y, r: 3.4, fill: e.colour }));
        }
      });
      readout.innerHTML =
        `The patch loop runs continuously and silently; the taste loop runs at the pace you answer ` +
        `questions, and its posterior re-fits at most every six duels. That asymmetry is the design: ` +
        `the machine evaluates thousands of candidates against a learned surrogate and surfaces a ` +
        `curated few, which is the answer to interactive evolution's user-fatigue problem.`;
      return;
    }

    const dots = EDGES.map((e, i) => {
      const g = el('g', {});
      const n = i === 0 ? 4 : 2;
      const cs = [];
      for (let k = 0; k < n; k++) {
        const c = el('circle', { r: i === 0 ? 3 : 3.6, fill: e.colour });
        g.appendChild(c);
        cs.push({ node: c, phase: k / n });
      }
      s.appendChild(g);
      return cs;
    });

    let raf = null, t0 = null;
    function tick(ts) {
      if (t0 == null) t0 = ts;
      const t = (ts - t0) / 1000;
      EDGES.forEach((e, i) => {
        const len = paths[i].getTotalLength();
        for (const d of dots[i]) {
          const f = ((t * e.speed * 0.42) + d.phase) % 1;
          const pt = paths[i].getPointAtLength(len * f);
          d.node.setAttribute('cx', pt.x);
          d.node.setAttribute('cy', pt.y);
          // Fade in and out at the ends so particles arrive rather than appear.
          d.node.setAttribute('opacity', String(Math.sin(Math.PI * f) * 0.9 + 0.1));
        }
      });
      raf = requestAnimationFrame(tick);
    }

    // Only animate while on screen — an off-screen rAF loop is a battery bug.
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (en.isIntersecting && raf == null) { t0 = null; raf = requestAnimationFrame(tick); }
        else if (!en.isIntersecting && raf != null) { cancelAnimationFrame(raf); raf = null; }
      }
    });
    io.observe(stage);

    readout.innerHTML =
      `<i>Green</i> is the fast loop — candidates generated, vetted and scored continuously, with no ` +
      `human in it. <b>Amber</b> is the slow one, moving at the pace you answer questions. The machine ` +
      `evaluates thousands of candidates against the learned surrogate and surfaces a curated few, ` +
      `which is the answer to interactive evolution's user-fatigue problem.`;
  };

  /* =======================================================================
   * interval — read the whisker, not the bar
   *
   * The single most useful habit when reading DIRECTIONS, and the one the guide
   * spends a section on. Evidence accumulates, the interval narrows, and a
   * coefficient only becomes a claim once its interval clears zero.
   * ===================================================================== */
  VIZ['interval'] = (root) => {
    const { stage, controls, readout } = scaffold(root);
    const W = 660, H = 168, L = 128, R = 78, T = 22;
    const s = svg(W, H, 'Three coefficients with credible intervals that narrow as evidence accumulates');
    stage.appendChild(s);

    let n = 8;   // observations
    const COEF = [
      { name: 'chorus & sweeps', truth: 0.62 },
      { name: 'bass weight', truth: -0.30 },
      { name: 'drive & fold', truth: 0.05 },
    ];

    const mid = (L + W - R) / 2;
    const scale = (W - L - R) / 2 / 1.25;
    const rowH = 40;

    s.appendChild(el('line', { x1: mid, y1: T - 6, x2: mid, y2: T + COEF.length * rowH, stroke: 'var(--silk-mute)', 'stroke-width': 1 }));
    const zl = el('text', { x: mid, y: T + COEF.length * rowH + 14, 'text-anchor': 'middle', class: 'v-axis' });
    zl.textContent = '0';
    s.appendChild(zl);

    const g = el('g', {}); s.appendChild(g);

    function draw() {
      g.textContent = '';
      let claims = 0;
      COEF.forEach((c, i) => {
        // A posterior SD that shrinks like 1/√n — the shape, not a simulation.
        const sd = 0.95 / Math.sqrt(n);
        // The estimate wanders toward the truth as evidence arrives.
        const est = c.truth + (c.truth === 0.05 ? 0.34 : 0.5) * Math.exp(-n / 22) * (i % 2 ? 1 : -1);
        const y = T + i * rowH + rowH / 2;

        const lab = el('text', { x: L - 10, y: y + 3, 'text-anchor': 'end', class: 'v-axis' });
        lab.textContent = c.name;
        g.appendChild(lab);

        const clears = Math.abs(est) > sd;
        if (clears) claims++;

        // The bar.
        g.appendChild(el('rect', {
          x: est >= 0 ? mid : mid + est * scale, y: y - 6,
          width: Math.abs(est) * scale, height: 12,
          fill: clears ? 'var(--phos-b)' : 'var(--silk-mute)', opacity: clears ? 0.85 : 0.45,
        }));
        // The whisker — the thing to actually read.
        g.appendChild(el('line', {
          x1: mid + (est - sd) * scale, y1: y, x2: mid + (est + sd) * scale, y2: y,
          stroke: clears ? 'var(--phos-b-deep)' : 'var(--led-red)', 'stroke-width': 2,
        }));
        for (const e of [est - sd, est + sd]) {
          g.appendChild(el('line', {
            x1: mid + e * scale, y1: y - 5, x2: mid + e * scale, y2: y + 5,
            stroke: clears ? 'var(--phos-b-deep)' : 'var(--led-red)', 'stroke-width': 2,
          }));
        }
        const val = el('text', { x: W - R + 8, y: y + 3, class: clears ? 'v-num-b' : 'v-axis' });
        val.textContent = `${est >= 0 ? '+' : ''}${fmt(est, 2)} ±${fmt(sd, 2)}`;
        g.appendChild(val);
      });

      readout.innerHTML =
        `After <b>${n}</b> observations, <b>${claims}</b> of ${COEF.length} coefficients have an interval ` +
        `that clears zero. The others have a bar — they are pointing somewhere — but the bar is a guess. ` +
        `<i>A short bar with a tight whisker is worth more than a long bar with a wide one.</i>`;
    }

    const sn = slider(controls, 'observations', { min: 3, max: 300, step: 1, value: 8, format: (v) => Math.round(v) });
    sn.addEventListener('input', () => { n = parseFloat(sn.value); draw(); });
    draw();
  };

  /* =======================================================================
   * recency — old votes fade
   *
   * w_h = 0.5^(h / 150). One curve, but it answers the question readers actually
   * have, which is "how long until what I told it stops mattering".
   * ===================================================================== */
  VIZ['recency'] = (root) => {
    const { stage, controls, readout } = scaffold(root);
    const W = 660, H = 190, L = 46, R = 22, T = 18, B = 36;
    const s = svg(W, H, 'The recency weight of an observation against how far back in the log it sits');
    stage.appendChild(s);

    let hl = 150;   // TasteConfig::recency_half_life default
    const MAX = 600;
    const xOf = (h) => L + (h / MAX) * (W - L - R);
    const yOf = (w) => H - B - w * (H - T - B);

    for (const w of [0, 0.5, 1]) {
      const y = yOf(w);
      s.appendChild(el('line', { class: 'v-grid', x1: L, y1: y, x2: W - R, y2: y }));
      const t = el('text', { x: L - 7, y: y + 3, 'text-anchor': 'end', class: 'v-axis' });
      t.textContent = w;
      s.appendChild(t);
    }
    for (const h of [0, 150, 300, 450, 600]) {
      const t = el('text', { x: xOf(h), y: H - B + 15, 'text-anchor': 'middle', class: 'v-axis' });
      t.textContent = h;
      s.appendChild(t);
    }
    const xl = el('text', { x: (L + W - R) / 2, y: H - 6, 'text-anchor': 'middle', class: 'v-axis' });
    xl.textContent = 'observations ago';
    s.appendChild(xl);
    const yl = el('text', { x: 4, y: T + 8, class: 'v-axis' });
    yl.textContent = 'weight';
    s.appendChild(yl);

    const g = el('g', {}); s.appendChild(g);

    function draw() {
      g.textContent = '';
      let d = '';
      for (let i = 0; i <= 220; i++) {
        const h = (i / 220) * MAX;
        const w = Math.pow(0.5, h / hl);
        d += `${i === 0 ? 'M' : 'L'}${xOf(h).toFixed(1)} ${yOf(w).toFixed(1)}`;
      }
      g.appendChild(el('path', { d: d + `L${xOf(MAX)} ${yOf(0)}L${xOf(0)} ${yOf(0)}Z`, fill: 'var(--phos-b)', opacity: 0.1 }));
      g.appendChild(el('path', { d, fill: 'none', stroke: 'var(--phos-b)', 'stroke-width': 2.2 }));

      // The half-life itself, marked.
      g.appendChild(el('line', { x1: xOf(hl), y1: yOf(0.5), x2: xOf(hl), y2: yOf(0), stroke: 'var(--phos-b-deep)', 'stroke-dasharray': '3 3' }));
      g.appendChild(el('line', { x1: L, y1: yOf(0.5), x2: xOf(hl), y2: yOf(0.5), stroke: 'var(--phos-b-deep)', 'stroke-dasharray': '3 3' }));
      const t = el('text', { x: xOf(hl) + 6, y: yOf(0.5) - 6, class: 'v-num-b' });
      t.textContent = `half-life ${Math.round(hl)}`;
      g.appendChild(t);

      const at300 = Math.pow(0.5, 300 / hl);
      readout.innerHTML =
        `At a half-life of <b>${Math.round(hl)}</b>, a vote from <b>300</b> observations ago still ` +
        `carries <b>${(at300 * 100).toFixed(0)}%</b> of a fresh one's weight. Your taste is allowed to ` +
        `change, and a model that weighted a vote from three sessions ago equally with one from a ` +
        `minute ago would fight you when it did.`;
    }

    const sh = slider(controls, 'half-life', { min: 25, max: 400, step: 5, value: 150, format: (v) => Math.round(v) });
    sh.addEventListener('input', () => { hl = parseFloat(sh.value); draw(); });
    button(controls, 'the shipped 150', () => { hl = 150; sh.value = 150; sh.dispatchEvent(new Event('input')); });
    draw();
  };

  /* ── bootstrap ────────────────────────────────────────────────────────── */

  /* Figures build when they first scroll into view. A reference page can carry
     three of them, and computing all of them at load would be work for content
     the reader may never reach. */
  /* Keys a figure's own controls own, kept away from the page.
   *
   * mdBook binds ArrowLeft/ArrowRight on `document` to move between chapters and
   * exempts only its search box — so arrowing a slider, or a draggable handle,
   * navigated away from the page mid-interaction. `preventDefault` does not help:
   * the document listener runs regardless. This stops the event at the figure,
   * and it is scoped to keys a control would actually consume, so Tab, Escape
   * and typing still reach the page. */
  const OWNED_KEYS = new Set([
    'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
    'Home', 'End', 'PageUp', 'PageDown',
  ]);

  function guardKeys(root) {
    root.addEventListener('keydown', (e) => {
      if (!OWNED_KEYS.has(e.key)) return;
      const t = e.target;
      if (!t || typeof t.closest !== 'function') return;
      if (t.closest('.v-handle') || t.matches('input, button, [role="slider"]')) {
        e.stopPropagation();
      }
    });
  }

  function init(root) {
    const name = root.getAttribute('data-viz');
    const build = VIZ[name];
    if (!build || root.dataset.vizReady) return;
    root.dataset.vizReady = '1';
    guardKeys(root);
    try {
      build(root);
    } catch (err) {
      // A broken figure must not take the page's prose with it.
      root.dataset.vizFailed = '1';
      if (window.console) console.error(`[viz] ${name} failed to build`, err);
    }
  }

  function boot() {
    const nodes = [...document.querySelectorAll('[data-viz]')];
    if (!nodes.length) return;
    if (!('IntersectionObserver' in window)) { nodes.forEach(init); return; }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) { init(e.target); io.unobserve(e.target); }
      }
    }, { rootMargin: '240px 0px' });
    nodes.forEach((n) => io.observe(n));
  }

  // Exposed so figures added later — or a book page loaded by mdBook's own
  // navigation — can be picked up without a reload.
  window.__auracleViz = { register: (n, f) => { VIZ[n] = f; }, boot, REDUCED };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
