/* Interactions and charts for the ORNL research site. Plain JS, no libraries.
   Charts read window.SITE_DATA (assets/data/*.js, written by tools/build_data.py). */
(() => {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const DATA = () => window.SITE_DATA || {};
  const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const METALS = {
    li: { name: 'Lithium', sym: 'Li', color: () => cssVar('--li') },
    na: { name: 'Sodium', sym: 'Na', color: () => cssVar('--na') },
    k: { name: 'Potassium', sym: 'K', color: () => cssVar('--k') },
  };
  const ROUTE_LABEL = {
    ch4: ['Methane', 'C–CN cleavage'],
    h2: ['Hydrogen (H₂)', 'H to the metal'],
    chain: ['8-mer chain', 'C–C chain growth'],
    triazine: ['Triazine', 'N-linked chain'],
    ap_ch2cn: ['Aminopyrimidine', 'through CH₂CN'],
    ap_nl: ['Aminopyrimidine', 'through the N-linked trimer'],
  };

  /* ---------------- helpers ---------------- */
  function el(tag, attrs = {}, parent) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null) continue;
      if (k === 'text') e.textContent = v; else e.setAttribute(k, v);
    }
    if (parent) parent.appendChild(e);
    return e;
  }
  function sv(tag, attrs = {}, parent) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) e.setAttribute(k, v);
    if (parent) parent.appendChild(e);
    return e;
  }
  function label(parent, x, y, str, cls, extra = {}) {
    const t = sv('text', { x, y, class: cls, ...extra }, parent);
    t.textContent = str;
    return t;
  }
  const minus = s => String(s).replace(/-/g, '−');
  const f1 = v => minus((Math.abs(v) < 0.05 ? 0 : v).toFixed(1));
  const f2 = v => minus(v.toFixed(2));
  const lin = (d0, d1, r0, r1) => v => r0 + (v - d0) / (d1 - d0) * (r1 - r0);
  const logs = (d0, d1, r0, r1) => { const a = Math.log10(d0), b = Math.log10(d1); return v => r0 + (Math.log10(v) - a) / (b - a) * (r1 - r0); };
  function niceTicks(lo, hi, count = 5) {
    const raw = (hi - lo) / count, p = 10 ** Math.floor(Math.log10(raw)), m = raw / p;
    const step = (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(8));
    return out;
  }
  const ease = (x0, y0, x1, y1) => { const xm = (x0 + x1) / 2; return `C ${xm} ${y0} ${xm} ${y1} ${x1} ${y1}`; };

  /* one tooltip per chart; content is built from DOM nodes (textContent only) */
  function tooltip(box) {
    const tip = el('div', { class: 'tooltip', role: 'status', 'aria-live': 'polite' }, box);
    return {
      show(rows, cx, cy) {
        tip.replaceChildren();
        for (const r of rows) {
          if (r.value) el('div', { class: 'tv', text: r.value }, tip);
          else if (r.key) el('div', { class: 'tk', text: r.key }, tip);
          else if (r.row) {
            const d = el('div', { class: 'row' }, tip);
            if (r.color) el('i', { style: `background:${r.color}` }, d);
            el('span', { text: r.row }, d);
          }
        }
        tip.classList.add('on');
        const bw = box.clientWidth, tw = tip.offsetWidth, th = tip.offsetHeight;
        let x = cx + 16, y = cy - th - 12;
        if (x + tw > bw - 6) x = cx - tw - 16;
        if (x < 6) x = 6;
        if (y < 4) y = cy + 18;
        tip.style.left = `${x}px`;
        tip.style.top = `${y}px`;
      },
      hide() { tip.classList.remove('on'); },
    };
  }
  function pointer(box, evt) {
    const r = box.getBoundingClientRect();
    return [evt.clientX - r.left, evt.clientY - r.top];
  }
  function centerOf(box, node) {
    const r = box.getBoundingClientRect(), n = node.getBoundingClientRect();
    return [n.left - r.left + n.width / 2, n.top - r.top + Math.min(n.height / 2, 40)];
  }
  /* wire hover, focus and touch on a hit target */
  function hover(box, tip, node, rows, onEnter, onLeave) {
    node.setAttribute('tabindex', '0');
    node.addEventListener('pointerenter', e => { onEnter && onEnter(); tip.show(rows(), ...pointer(box, e)); });
    node.addEventListener('pointermove', e => tip.show(rows(), ...pointer(box, e)));
    node.addEventListener('pointerleave', () => { onLeave && onLeave(); tip.hide(); });
    node.addEventListener('focus', () => { onEnter && onEnter(); tip.show(rows(), ...centerOf(box, node)); });
    node.addEventListener('blur', () => { onLeave && onLeave(); tip.hide(); });
  }
  /* render at the plot's real width, again whenever it changes (tabs, resizing) */
  function responsive(plot, render) {
    let w = 0;
    const go = () => {
      const nw = Math.round(plot.clientWidth);
      if (nw > 60 && Math.abs(nw - w) > 3) { w = nw; plot.replaceChildren(); render(nw); }
    };
    new ResizeObserver(go).observe(plot);
    go();
  }
  function frame(box, title, subtitle) {
    box.replaceChildren();
    if (title) el('div', { class: 'title', text: title }, box);
    if (subtitle) el('p', { class: 'subtitle', text: subtitle }, box);
    const legend = el('div', { class: 'legend' }, box);
    const plot = el('div', { class: 'plot' }, box);
    return { legend, plot, tip: tooltip(box) };
  }
  function legendItem(legend, color, text, kind = 'line') {
    const s = el('span', {}, legend);
    el('i', { class: kind, style: kind === 'dotted' ? '' : `background:${color}` }, s);
    el('span', { text }, s);
  }

  /* ---------------- energy profile ----------------
     cfg.states: [{E, name?}]  cfg.steps[i] joins states[i] and states[i+1]:
     {TS, R, determined, rows(): tooltip rows}. One series in cfg.color; cfg.context: faint series behind. */
  function drawProfile(box, plot, tip, cfg, W) {
    const H = cfg.height || 380;
    const fmt = cfg.fmt || f1, unit = cfg.unit || 'kcal/mol';
    const narrow = W < 600;
    const m = { l: 54, r: narrow ? 18 : (cfg.endRoom ?? 128), t: cfg.bands ? 58 : 40, b: 34 };
    const series = [cfg, ...(cfg.context || [])];
    const vals = [0];
    for (const s of series) {
      for (const st of s.states) vals.push(st.E);
      for (const p of s.steps) { if (p.TS != null) vals.push(p.TS); if (p.R != null) vals.push(p.R); }
    }
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const span = Math.max(hi - lo, 10);
    lo -= span * 0.08; hi += span * 0.1;
    const n = Math.max(...series.map(s => s.states.length));
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    if (iw < 80) return;  // not laid out yet
    const slot = iw / (n - 1 + 0.7);
    const X = i => m.l + slot * 0.35 + i * slot;
    const Y = lin(lo, hi, m.t + ih, m.t);
    const hw = Math.max(5, Math.min(slot * 0.21, 20));
    const svg = sv('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': cfg.aria || 'Energy profile' }, plot);

    if (cfg.bands) {  // stage bands behind everything
      const g = sv('g', {}, svg);
      cfg.bands.forEach((b, k) => {
        const x0 = k === 0 ? m.l : X(b.from) - slot / 2, x1 = k === cfg.bands.length - 1 ? W - m.r : X(b.to) + slot / 2;
        if (k % 2 === 0) sv('rect', { x: x0, y: m.t - 24, width: Math.max(0, x1 - x0), height: ih + 24, fill: '#f4f5f2', rx: 0 }, g);
        const t = label(g, (x0 + x1) / 2, m.t - 30, b.name, 'lbl-muted', { 'text-anchor': 'middle' });
        if (x1 - x0 < 92) t.textContent = b.short || b.name;
      });
    }
    const grid = sv('g', { class: 'grid' }, svg);
    const ticks = niceTicks(lo, hi, narrow ? 4 : 5);
    for (const t of ticks) {
      sv('line', { x1: m.l, x2: W - m.r + (narrow ? 0 : 10), y1: Y(t), y2: Y(t) }, grid);
      const g = sv('g', { class: 'tick' }, svg);
      label(g, m.l - 10, Y(t) + 4, minus(t), '', { 'text-anchor': 'end' });
    }
    if (ticks.includes(0)) sv('line', { x1: m.l, x2: W - m.r + (narrow ? 0 : 10), y1: Y(0), y2: Y(0), stroke: '#cfd1cb', 'stroke-width': 1, 'shape-rendering': 'crispEdges' }, svg);
    label(svg, 14, m.t + ih / 2, cfg.yTitle || 'kcal/mol', 'axis-title', { transform: `rotate(-90 14 ${m.t + ih / 2})`, 'text-anchor': 'middle' });
    if (cfg.xTitle) label(svg, m.l + iw / 2, H - 8, cfg.xTitle, 'axis-title', { 'text-anchor': 'middle' });

    function paths(s, g, color, width, faint) {
      const peaks = [];
      s.steps.forEach((p, i) => {
        if (i + 1 >= s.states.length) return;
        let xa = X(i) + hw, ya = Y(s.states[i].E);
        const xb = X(i + 1) - hw, yb = Y(s.states[i + 1].E);
        const base = { fill: 'none', stroke: color, 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
        if (!p.determined) {
          sv('path', { ...base, d: `M ${xa} ${ya} ${ease(xa, ya, xb, yb)}`, 'stroke-dasharray': '0.5 4.5', 'stroke-width': width + 0.4 }, g);
          peaks.push({ x: (xa + xb) / 2, y: Math.min(ya, yb), i });
          return;
        }
        if (p.R != null && Math.abs(p.R - s.states[i].E) >= 1) {  // the film falls to a lower reactant side first
          const xr = xa + (xb - xa) * 0.22, yr = Y(p.R);
          sv('path', { ...base, d: `M ${xa} ${ya} ${ease(xa, ya, xr, yr)}`, 'stroke-dasharray': '0.5 4.5', 'stroke-width': width + 0.4 }, g);
          xa = xr; ya = yr;
        }
        const top = p.TS != null ? Y(p.TS) : null;
        if (top != null && top < Math.min(ya, yb) - 0.5) {
          const xm = (xa + xb) / 2;
          sv('path', { ...base, d: `M ${xa} ${ya} ${ease(xa, ya, xm, top)} ${ease(xm, top, xb, yb)}` }, g);
          peaks.push({ x: xm, y: top, i });
        } else {
          sv('path', { ...base, d: `M ${xa} ${ya} ${ease(xa, ya, xb, yb)}` }, g);
          peaks.push({ x: (xa + xb) / 2, y: Math.min(ya, yb), i });
        }
      });
      s.states.forEach((st, i) => {
        const last = i === s.states.length - 1 && !faint;
        sv('line', { x1: X(i) - hw, x2: X(i) + hw, y1: Y(st.E), y2: Y(st.E), stroke: color, 'stroke-width': faint ? width : (last || st.key ? 4.5 : 3), 'stroke-linecap': 'round' }, g);
      });
      return peaks;
    }
    for (const c of (cfg.context || [])) paths(c, sv('g', { opacity: 1 }, svg), '#cfd3d6', 1.6, true);
    const main = sv('g', {}, svg);
    const peaks = paths(cfg, main, cfg.color, 2.2, false);

    // labels: key states, the end state, the largest step
    const L = sv('g', {}, svg);
    cfg.states.forEach((st, i) => {
      if (!st.key || i === cfg.states.length - 1) return;
      label(L, X(i), Y(st.E) + 20, st.key, 'lbl-strong', { 'text-anchor': 'middle' });
      label(L, X(i), Y(st.E) + 37, fmt(st.E), 'lbl', { 'text-anchor': 'middle' });
    });
    const end = cfg.states.length - 1, ex = X(end), ey = Y(cfg.states[end].E);
    if (cfg.endName) {
      if (narrow) {  // no room beside the end state on a phone: name the product in the top corner
        label(L, W - m.r, m.t - 16, `→ ${cfg.endName}, ${fmt(cfg.states[end].E)} ${unit}`, 'lbl-strong', { 'text-anchor': 'end' });
      } else {
        label(L, ex + hw + 10, ey - 3, cfg.endName, 'lbl-strong');
        label(L, ex + hw + 10, ey + 15, `${fmt(cfg.states[end].E)} ${unit}`, 'lbl');
      }
    }
    if (cfg.stopNote) label(L, ex + hw + 10, ey + 4, cfg.stopNote, 'lbl-muted', { 'font-style': 'italic' });
    label(L, X(0), Y(cfg.states[0].E) + 20, cfg.startName || 'start', 'lbl-muted', { 'text-anchor': 'middle' });
    if (cfg.labelStep != null) {
      const pk = peaks.find(q => q.i === cfg.labelStep);
      if (pk) {
        sv('circle', { cx: pk.x, cy: pk.y, r: 4.5, fill: cfg.color, stroke: '#fff', 'stroke-width': 2 }, L);
        const [a, b] = cfg.stepLabel;
        label(L, pk.x, pk.y - (b ? 27 : 12), a, 'lbl-strong', { 'text-anchor': 'middle' });
        if (b) label(L, pk.x, pk.y - 11, b, 'lbl-muted', { 'text-anchor': 'middle' });
      }
    }
    if (cfg.overlay) cfg.overlay(svg, X, Y, peaks);
    // selected step (charts linked to a 3D viewer)
    if (cfg.selected != null) {
      const pk = peaks.find(q => q.i === cfg.selected);
      if (pk) {
        sv('line', { x1: pk.x, x2: pk.x, y1: m.t - 6, y2: m.t + ih, stroke: cfg.color, 'stroke-width': 1, opacity: 0.35, 'pointer-events': 'none' }, svg);
        sv('circle', { cx: pk.x, cy: pk.y, r: 7, fill: 'none', stroke: cfg.color, 'stroke-width': 2, 'pointer-events': 'none' }, svg);
      }
    }
    if (cfg.selectedState != null && cfg.states[cfg.selectedState]) {
      const i = cfg.selectedState;
      sv('rect', { x: X(i) - hw - 5, y: Y(cfg.states[i].E) - 8, width: 2 * hw + 10, height: 16, rx: 8, fill: 'none', stroke: cfg.color, 'stroke-width': 1.8, 'pointer-events': 'none' }, svg);
    }
    // hover: one band per step
    const hl = sv('circle', { r: 5, fill: cfg.color, stroke: '#fff', 'stroke-width': 2, opacity: 0, 'pointer-events': 'none' }, svg);
    cfg.steps.forEach((p, i) => {
      if (i + 1 >= cfg.states.length) return;
      const pk = peaks.find(q => q.i === i);
      const hit = sv('rect', { class: 'hit', x: X(i), y: m.t - 10, width: slot, height: ih + 20, 'aria-label': `step ${i + 1}` }, svg);
      hover(box, tip, hit, p.rows,
        () => { if (pk) { hl.setAttribute('cx', pk.x); hl.setAttribute('cy', pk.y); hl.setAttribute('opacity', 1); } },
        () => hl.setAttribute('opacity', 0));
      if (cfg.onSelect) {
        hit.addEventListener('click', () => cfg.onSelect(i));
        hit.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cfg.onSelect(i); } });
      }
    });
    // states (plateaus) sit above the step bands, so a click on a plateau opens the state itself
    if (cfg.onSelectState) {
      cfg.states.forEach((st, i) => {
        const hit = sv('rect', { class: 'hit', x: X(i) - hw - 5, y: Y(st.E) - 12, width: 2 * hw + 10, height: 24, rx: 6, 'aria-label': `state ${i}` }, svg);
        if (cfg.stateRows) hover(box, tip, hit, () => cfg.stateRows(i));
        hit.addEventListener('click', () => cfg.onSelectState(i));
        hit.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cfg.onSelectState(i); } });
      });
    }
    // reveal the route left to right the first time it is drawn
    if (cfg.animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const id = `clip${Math.random().toString(36).slice(2, 8)}`;
      const clip = sv('rect', { x: 0, y: 0, width: 0, height: H }, sv('clipPath', { id }, sv('defs', {}, svg)));
      main.setAttribute('clip-path', `url(#${id})`);
      L.style.opacity = 0; L.style.transition = 'opacity .35s ease';
      const t0 = performance.now(), dur = 900;
      const step = now => {
        const k = Math.min(1, Math.max(0, (now - t0) / dur)), e = 1 - (1 - k) ** 3;  // a frame time can precede t0
        clip.setAttribute('width', W * e);
        if (k < 1) requestAnimationFrame(step); else { main.removeAttribute('clip-path'); L.style.opacity = 1; }
      };
      requestAnimationFrame(step);
    }
  }

  /* ---------------- 3D structures (3Dmol.js, loaded on demand) ---------------- */
  const EL = { C: '#3a444f', N: '#3157bb', H: '#dae0e8', O: '#d6402e', S: '#d9b43a', P: '#e08a2c', F: '#79c23f', Cl: '#3fae4a', Br: '#9c3a2c', I: '#7d3ab8', Na: '#b1a4c8', K: '#a122f7', Li: '#86e074' };
  const RAD = { H: 0.17, C: 0.3, N: 0.3, O: 0.3, S: 0.36, P: 0.36, F: 0.26, Cl: 0.34, Br: 0.38, I: 0.42 };
  const METAL_R = { Li: 1.0, Na: 1.2, K: 1.5 };
  const CTX = { C: '#a9b0b8', N: '#a2b4e2', H: '#e2e6eb', O: '#e7a9a2' };  // pale neighbours, as on the approved map site
  const TIER = {
    core: { C: 0.3, N: 0.3, O: 0.3, H: 0.17, stick: 0.13 },
    oth: { C: 0.24, N: 0.24, O: 0.24, H: 0.13, stick: 0.1 },
    ctx: { C: 0.19, N: 0.19, O: 0.19, H: 0.1, stick: 0.075 },
  };
  const CUT = { 'C-C': 1.75, 'C-N': 1.7, 'N-N': 1.65, 'C-H': 1.25, 'H-N': 1.25, 'H-H': 0.95, 'C-O': 1.7, 'H-O': 1.25, 'N-O': 1.7, 'O-O': 1.6 };
  let mol3d = null;
  function load3Dmol() {
    if (window.$3Dmol) return Promise.resolve(window.$3Dmol);
    if (!mol3d) mol3d = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/3Dmol/2.4.0/3Dmol-min.js';
      s.onload = () => (window.$3Dmol ? res(window.$3Dmol) : rej(new Error('3Dmol missing')));
      s.onerror = rej;
      document.head.appendChild(s);
    });
    return mol3d;
  }
  const isMetal = e => e in METAL_R;
  function bondsOf(atoms) {
    const out = [];
    for (let i = 0; i < atoms.length; i++) for (let j = i + 1; j < atoms.length; j++) {
      const a = atoms[i], b = atoms[j];
      if (isMetal(a[0]) || isMetal(b[0])) continue;
      const cut = CUT[[a[0], b[0]].sort().join('-')] ?? 1.9;
      const d = Math.hypot(a[1] - b[1], a[2] - b[2], a[3] - b[3]);
      if (d < cut) out.push([i, j]);
    }
    return out;
  }
  function molBlock(atoms, bonds) {
    const p = (v, n) => String(v).padStart(n);
    const lines = ['', '  site', '', `${p(atoms.length, 3)}${p(bonds.length, 3)}  0  0  0  0  0  0  0  0999 V2000`];
    for (const [e, x, y, z] of atoms) lines.push(`${p(x.toFixed(4), 10)}${p(y.toFixed(4), 10)}${p(z.toFixed(4), 10)} ${e.padEnd(3)} 0  0  0  0  0  0  0  0  0  0  0  0`);
    for (const [i, j] of bonds) lines.push(`${p(i + 1, 3)}${p(j + 1, 3)}  1  0  0  0  0`);
    lines.push('M  END');
    return lines.join('\n');
  }
  /* a viewer inside host; frames: [{atoms, bonds?}] */
  function makeViewer(host, { tilt = 0, rock = false } = {}) {
    const api = { ready: null, v: null, playing: false };
    api.ready = load3Dmol().then($3D => {
      host.classList.add('live');
      const v = $3D.createViewer(host, { backgroundColor: '#ffffff', antialias: true, orthographic: true });
      if (v.enableFog) v.enableFog(false);
      api.v = v; host._viewer = v;
      host.addEventListener('wheel', e => { if (!e.ctrlKey && !e.metaKey) e.stopPropagation(); }, { capture: true });
      new ResizeObserver(() => { v.resize(); v.render(); }).observe(host);
      if (rock && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        let on = true, last = performance.now(), t = 0, prev = 0;
        const stop = () => { on = false; };
        ['pointerdown', 'touchstart', 'wheel'].forEach(ev => host.addEventListener(ev, stop, { passive: true }));
        const tick = now => {
          if (!on) return;
          t += (now - last) / 1000; last = now;
          const a = 28 * Math.sin(t * 0.45);
          v.rotate(a - prev, 'y'); prev = a; v.render();
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }
      return api;
    }).catch(() => { host.classList.add('failed'); return null; });
    api.show = (frames, opts = {}) => api.ready.then(a => {
      if (!a) return;
      const v = api.v;
      v.stopAnimate(); v.removeAllModels(); v.removeAllShapes();
      const text = frames.map(f => molBlock(f.atoms, f.bonds || bondsOf(f.atoms))).join('\n$$$$\n');
      if (frames.length > 1) v.addModelsAsFrames(text, 'sdf'); else v.addModel(text, 'sdf');
      const els = new Set(frames[0].atoms.map(a => a[0]));
      for (const e of els) {
        const c = EL[e] || '#888888';
        v.setStyle({ elem: e }, isMetal(e) ? { sphere: { radius: METAL_R[e], color: c } } : { sphere: { radius: RAD[e] || 0.32, color: c }, stick: { radius: 0.13, color: c } });
      }
      for (const [i, j] of (opts.dashed || [])) {
        const a = frames[0].atoms[i], b = frames[0].atoms[j];
        v.addCylinder({ start: { x: a[1], y: a[2], z: a[3] }, end: { x: b[1], y: b[2], z: b[3] }, radius: 0.06, color: '#b08d57', dashed: true, dashLength: 0.14, gapLength: 0.12 });
      }
      if (opts.keepView && api.view) v.setView(api.view);
      else { v.zoomTo(opts.focus ? { not: { elem: Object.keys(METAL_R) } } : {}); if (tilt) v.rotate(tilt, 'x'); v.zoom(opts.zoom || 1.05); }
      v.render();
      if (opts.frame != null) { v.setFrame(opts.frame); v.render(); }
      api.playing = false;
      if (frames.length > 1 && opts.play) api.play(opts.loop, opts.interval);
    });
    /* layered scene: metal patch, reacting molecules, neighbours (pale), changing bonds (dashed) */
    api.showScene = (scene, opts = {}) => api.ready.then(a => {
      if (!a) return;
      const v = api.v;
      v.stopAnimate(); v.removeAllModels(); v.removeAllShapes();
      let focus = null;
      for (const g of scene.groups) {
        if (!g.atoms.length) continue;
        const mdl = v.addModel(molBlock(g.atoms, g.tier === 'metal' ? [] : bondsOf(g.atoms)), 'sdf');
        const T = TIER[g.tier] || TIER.core, pal = g.tier === 'ctx' ? CTX : EL;
        for (const e of new Set(g.atoms.map(x => x[0]))) {
          const c = pal[e] || EL[e] || '#888888';
          mdl.setStyle({ elem: e }, isMetal(e) ? { sphere: { radius: METAL_R[e], color: c } } : { sphere: { radius: T[e] ?? T.C, color: c }, stick: { radius: T.stick, color: c } });
        }
        if (g.tier === 'core') focus = mdl;
      }
      for (const d of scene.dashed || []) {
        v.addCylinder({ start: { x: d.a[0], y: d.a[1], z: d.a[2] }, end: { x: d.b[0], y: d.b[1], z: d.b[2] }, radius: 0.08, color: d.h ? '#189b7e' : '#dd7b28', dashed: true, dashLength: 0.16, gapLength: 0.12, fromCap: 1, toCap: 1 });
      }
      if (opts.keepView && api.view) v.setView(api.view);
      else { v.zoomTo(opts.frameAll || !focus ? {} : { model: focus }); v.zoom(opts.zoom || 0.9); }
      v.render();
    });
    api.play = (loop = 'forward', interval = 45) => { if (!api.v) return; api.v.animate({ loop, interval, reps: 0 }); api.playing = true; };
    api.pause = () => { if (!api.v) return; api.v.stopAnimate(); api.playing = false; };
    api.frame = n => { if (!api.v) return; api.v.stopAnimate(); api.playing = false; api.v.setFrame(n); api.v.render(); };
    api.save = () => { if (api.v) api.view = api.v.getView(); };
    return api;
  }
  /* oscillate a structure along a normal mode (largest atom moves amp Å); bonds follow the distances */
  function modeFrames(atoms, mode, amp = 0.38, n = 26) {
    const big = Math.max(...mode.map(d => Math.hypot(...d))) || 1;
    const out = [];
    for (let k = 0; k < n; k++) {
      const s = Math.sin(2 * Math.PI * k / n) * amp / big;
      out.push({ atoms: atoms.map(([e, x, y, z], i) => [e, x + s * mode[i][0], y + s * mode[i][1], z + s * mode[i][2]]) });
    }
    return out;
  }
  /* straight-line path reactant -> TS -> product, with each anchor's own bonds */
  function pathFrames(fr, n = 14) {
    const out = [];
    const seg = (A, B, bondsA, bondsB, last) => {
      for (let k = 0; k < (last ? n + 1 : n); k++) {
        const t = k / n;
        out.push({ atoms: A.map((a, i) => [a[0], a[1] + t * (B[i][1] - a[1]), a[2] + t * (B[i][2] - a[2]), a[3] + t * (B[i][3] - a[3])]), bonds: t < 0.5 ? bondsA : bondsB });
      }
    };
    seg(fr.R, fr.TS, fr.bR, fr.bTS, false);
    seg(fr.TS, fr.P, fr.bTS, fr.bP, true);
    return out;
  }
  /* surface models: turn the slab so its normal points up, the molecule's long axis runs across the
     screen, and the camera looks down on the surface at tilt degrees */
  function eig3(A) {
    const a = A.map(r => r.slice()), V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    for (let sweep = 0; sweep < 40; sweep++) {
      if (Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]) < 1e-12) break;
      for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
        if (Math.abs(a[p][q]) < 1e-14) continue;
        const th = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]), c = Math.cos(th), s = Math.sin(th);
        for (let k = 0; k < 3; k++) { const x = a[k][p], y = a[k][q]; a[k][p] = c * x - s * y; a[k][q] = s * x + c * y; }
        for (let k = 0; k < 3; k++) { const x = a[p][k], y = a[q][k]; a[p][k] = c * x - s * y; a[q][k] = s * x + c * y; }
        for (let k = 0; k < 3; k++) { const x = V[k][p], y = V[k][q]; V[k][p] = c * x - s * y; V[k][q] = s * x + c * y; }
      }
    }
    return { vals: [a[0][0], a[1][1], a[2][2]], vecs: [0, 1, 2].map(j => [V[0][j], V[1][j], V[2][j]]) };
  }
  function orientSlab(atoms, tilt = 16) {
    const metal = atoms.filter(a => isMetal(a[0])), org = atoms.filter(a => !isMetal(a[0]));
    if (metal.length < 3 || org.length < 2) return atoms;
    const mean = P => [1, 2, 3].map(k => P.reduce((s, p) => s + p[k], 0) / P.length);
    const cov = (P, c) => {
      const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      for (const p of P) { const d = [p[1] - c[0], p[2] - c[1], p[3] - c[2]]; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += d[i] * d[j]; }
      return C;
    };
    const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    const cm = mean(metal), co = mean(org);
    const E = eig3(cov(metal, cm));
    let n = E.vecs[E.vals.indexOf(Math.min(...E.vals))];
    if (dot(n, [co[0] - cm[0], co[1] - cm[1], co[2] - cm[2]]) < 0) n = n.map(v => -v);
    const F = eig3(cov(org, co));
    let e1 = F.vecs[F.vals.indexOf(Math.max(...F.vals))];
    const k = dot(e1, n);
    e1 = e1.map((v, i) => v - k * n[i]);
    const len = Math.hypot(...e1) || 1;
    e1 = e1.map(v => v / len);
    const e3 = [e1[1] * n[2] - e1[2] * n[1], e1[2] * n[0] - e1[0] * n[2], e1[0] * n[1] - e1[1] * n[0]];
    const t = tilt * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
    return atoms.map(([e, x, y, z]) => {
      const d = [x - co[0], y - co[1], z - co[2]];
      const X = dot(d, e1), Y = dot(d, n), Z = dot(d, e3);
      return [e, X, Y * c - Z * s, Y * s + Z * c];
    });
  }

  /* landing hero: aminopyrimidine on Na(100), rocking */
  function heroMol(host) {
    const st = DATA().structures;
    if (!st) return;
    const vw = makeViewer(host, { rock: true });
    vw.show([{ atoms: orientSlab(st.products.na.AP.atoms) }], { focus: true, zoom: 1.45 });
  }

  /* metal tabs: product on the bare surface, aminopyrimidine or triazine */
  function productMol(card) {
    const st = DATA().structures;
    const metal = card.dataset.metal;
    if (!st || !st.products[metal]) return;
    const host = card.querySelector('.mol');
    const chips = el('div', { class: 'chips mini', role: 'group', 'aria-label': 'Product' });
    card.insertBefore(chips, host);
    const prods = Object.entries(st.products[metal]);
    let vw = null;
    const open = k => {
      chipEls.forEach((c, j) => c.setAttribute('aria-pressed', String(j === k)));
      if (!vw) vw = makeViewer(host);
      vw.show([{ atoms: orientSlab(prods[k][1].atoms) }], { focus: true, zoom: 1.3 });
      cap.textContent = `${prods[k][1].name} on ${METALS[metal].sym}(100), alone on the bare surface. Drag to rotate.`;
    };
    const chipEls = prods.map(([, p], k) => {
      const c = el('button', { class: 'chip', type: 'button', 'aria-pressed': 'false', text: p.name }, chips);
      c.addEventListener('click', () => open(k));
      return c;
    });
    const cap = el('p', { class: 'mol-cap' }, card);
    whenVisible(card, () => open(0));
  }

  /* benchmark: six large-error reactions, reactant -> TS -> product */
  function reactionMol(root) {
    const st = DATA().structures;
    if (!st) return;
    const rx = st.reactions;
    const top = el('div', { class: 'chips', role: 'group', 'aria-label': 'Reaction' }, root);
    const body = el('div', { class: 'mol-split' }, root);
    const stage = el('div', { class: 'mol-stage' }, body);
    const host = el('div', { class: 'mol tall' }, stage);
    const ctrl = el('div', { class: 'mol-ctrl' }, stage);
    const side = el('div', { class: 'mol-side' }, body);
    const vw = makeViewer(host);
    let cur = 0, anchor = 1, playing = false;
    const states = [['Reactant', 0], ['Transition state', 14], ['Product', 28]];
    const stateBtns = states.map(([name], k) => {
      const b = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(k === 1), text: name }, ctrl);
      b.addEventListener('click', () => { anchor = k; playing = false; playBtn.textContent = '▶ Play R → TS → P'; draw(true); });
      return b;
    });
    const playBtn = el('button', { class: 'chip play', type: 'button', text: '▶ Play R → TS → P' }, ctrl);
    playBtn.addEventListener('click', () => {
      playing = !playing;
      playBtn.textContent = playing ? '❚❚ Pause' : '▶ Play R → TS → P';
      if (playing) { stateBtns.forEach(b => b.setAttribute('aria-pressed', 'false')); vw.save(); draw(true); } else { vw.pause(); }
    });
    const chipEls = rx.map((r, k) => {
      const c = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(k === 0) }, top);
      el('span', { text: `${r.panel}` , class: 'val' }, c);
      el('span', { text: `${r.cls} · ${r.formula.replace(/(\d+)/g, m => String.fromCharCode(...[...m].map(d => 0x2080 + +d)))}` }, c);
      c.addEventListener('click', () => { cur = k; chipEls.forEach((x, j) => x.setAttribute('aria-pressed', String(j === k))); draw(false); });
      return c;
    });
    function frames(r) {
      const sym = r.symbols, toAtoms = xyz => xyz.map((p, i) => [sym[i], ...p]);
      const R = toAtoms(r.frames.reactant.xyz), TS = toAtoms(r.frames.ts.xyz), P = toAtoms(r.frames.product.xyz);
      return { R, TS, P, bR: bondsOf(R), bTS: bondsOf(TS), bP: bondsOf(P) };
    }
    function draw(keepView) {
      const r = rx[cur], fr = frames(r);
      stateBtns.forEach((b, k) => b.setAttribute('aria-pressed', String(!playing && k === anchor)));
      if (keepView) vw.save();
      const key = ['reactant', 'ts', 'product'][anchor];
      if (playing) vw.show(pathFrames(fr), { play: true, loop: 'backAndForth', interval: 70, keepView });
      else vw.show([{ atoms: [fr.R, fr.TS, fr.P][anchor] }], { dashed: r.frames[key].dashed, keepView });
      side.replaceChildren();
      el('p', { class: 'eyebrow', text: `${r.cls} · panel ${r.panel}` }, side);
      el('p', { class: 'mol-big', text: `${r.barrier.toFixed(1)} kcal/mol` }, side);
      el('p', { class: 'note', text: 'DFT barrier (ωB97M-V/def2-TZVP)' }, side);
      const t = el('table', { class: 'mini-table' }, side);
      const h = el('tr', {}, el('thead', {}, t));
      ['', 'TS force RMSE', 'Barrier error'].forEach(x => el('th', { text: x, class: x ? 'num' : '' }, h));
      const tb = el('tbody', {}, t);
      [['UMA-M OMol', r.errors.uma_m_omol], ['AIMNet2-RXN', r.errors.aimnet2_rxn]].forEach(([n, e]) => {
        const tr = el('tr', {}, tb);
        el('td', { text: n, class: 'name' }, tr);
        el('td', { text: `${e.force.toFixed(3)} eV/Å`, class: 'num' }, tr);
        el('td', { text: `${e.barrier > 0 ? '+' : ''}${minus(e.barrier.toFixed(1))}`, class: 'num' }, tr);
      });
      el('p', { class: 'note', text: 'Barrier errors are given in kcal/mol as model minus DFT. Dashed lines mark the contacts that change.' }, side);
    }
    whenVisible(root, () => draw(false));
  }

  /* alcohols: the transition state picked on the chart, oscillating along its imaginary mode */
  function alcoholMol(root) {
    const st = DATA().structures;
    if (!st) return;
    const stage = el('div', { class: 'mol-stage' }, root);
    const host = el('div', { class: 'mol tall' }, stage);
    const ctrl = el('div', { class: 'mol-ctrl' }, stage);
    const side = el('div', { class: 'mol-side' }, root);
    root.classList.add('mol-split');
    const vw = makeViewer(host);
    let state = { alcohol: 'meoh', id: 'TS11' }, playing = true;
    const playBtn = el('button', { class: 'chip play', type: 'button', text: '❚❚ Pause the mode' }, ctrl);
    playBtn.addEventListener('click', () => {
      playing = !playing;
      playBtn.textContent = playing ? '❚❚ Pause the mode' : '▶ Play the mode';
      if (playing) vw.play('forward', 40); else vw.pause();
    });
    function draw() {
      const list = st.alcohol_ts[state.alcohol];
      const ts = list.find(t => t.id === state.id) || list[0];
      const isTS = ts.id.startsWith('TS');
      const fr = ts.mode ? modeFrames(ts.atoms, ts.mode) : [{ atoms: ts.atoms }];
      vw.show(fr, { play: playing && fr.length > 1, loop: 'forward', interval: 40 });
      playBtn.hidden = !(fr.length > 1);
      side.replaceChildren();
      const pts = DATA().alcohols.find(a => a.id === state.alcohol).points;
      const p = pts.find(q => q.id === ts.id);
      el('p', { class: 'eyebrow', text: isTS ? `${p.stage} · ${ts.id.replace('TS', 'step ')} of 15` : `${p.stage} · intermediate` }, side);
      el('p', { class: 'mol-title', text: ts.label }, side);
      el('p', { class: 'mol-big', text: `${(isTS ? p.barrier : p.E).toFixed(1)} kcal/mol` }, side);
      el('p', { class: 'note', text: isTS ? 'PM7 barrier of this step' : 'PM7 energy on the chart scale (ACN + alcohol = 0)' }, side);
      if (ts.freq) el('p', { class: 'note', text: `The animation follows the imaginary mode at ${Math.abs(ts.freq).toFixed(0)}i cm⁻¹, which carries the atoms along the reaction coordinate.` }, side);
      el('p', { class: 'note', text: 'Click a peak on the chart for its transition state or a plateau for the intermediate. Drag to rotate, and use ⌘/Ctrl-scroll to zoom.' }, side);
    }
    document.addEventListener('alcohol:select', e => { state = e.detail; draw(); });
    whenVisible(root, draw);
  }

  function whenVisible(node, fn) {
    let done = false;
    const io = new IntersectionObserver(es => {
      if (!done && es.some(x => x.isIntersecting && x.boundingClientRect.width > 0)) { done = true; io.disconnect(); fn(); }
    }, { rootMargin: '200px' });
    io.observe(node);
  }

  /* ---------------- metals: one route at a time ---------------- */
  const largest = route => {
    let best = null;
    route.steps.forEach((s, i) => {
      const v = s.dft ?? s.barrier;
      if (v != null && (best == null || v > best.v)) best = { v, i, s };
    });
    return best;
  };
  /* ---------------- data loaded on demand (the 3D structures) ---------------- */
  const pending = {};
  function loadData(name) {
    if (DATA()[name]) return Promise.resolve(DATA()[name]);
    if (!pending[name]) pending[name] = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = `assets/data/${name}.js`;
      s.onload = () => res(DATA()[name]);
      s.onerror = rej;
      document.head.appendChild(s);
    });
    return pending[name];
  }
  const expandRuns = e => e.split(' ').flatMap(r => { const x = r.replace(/\d+$/, ''); return Array(+(r.slice(x.length) || 1)).fill(x); });

  /* ---------------- the structure panel, shared by every clickable chart ----------------
     spec: {eyebrow, title, info: [{text, cls}], viewKey, groups: [{tier, atoms}], dashed: [{a, b, h}],
            frames: [{label, groups, dashed}] (optional), empty: 'message'} */
  const Drawer = (() => {
    let root, vw, host, nav = null, cur = null, showCtx = true, renderedKey = null;
    function build() {
      root = el('aside', { class: 'drawer', role: 'dialog', 'aria-label': 'Structure viewer', 'aria-hidden': 'true' }, document.body);
      const head = el('div', { class: 'dr-head' }, root);
      const t = el('div', {}, head);
      root.eyebrow = el('p', { class: 'eyebrow' }, t);
      root.titleEl = el('h3', { class: 'dr-title' }, t);
      const x = el('button', { class: 'dr-close', type: 'button', 'aria-label': 'Close the structure viewer', text: '✕' }, head);
      x.addEventListener('click', close);
      root.seg = el('div', { class: 'chips mini dr-seg', role: 'group', 'aria-label': 'Structure along the step' }, root);
      const stage = el('div', { class: 'dr-stage' }, root);
      host = el('div', { class: 'mol dr-mol' }, stage);
      root.empty = el('div', { class: 'dr-empty', hidden: '' }, stage);
      vw = makeViewer(host);
      const tools = el('div', { class: 'dr-tools' }, root);
      [['−', 'Zoom out', () => zoom(0.8)], ['+', 'Zoom in', () => zoom(1.25)], ['Reset view', 'Reset the view', () => render(false)]].forEach(([txt, lab, fn]) => {
        el('button', { class: 'chip', type: 'button', 'aria-label': lab, text: txt }, tools).addEventListener('click', fn);
      });
      root.ctxBtn = el('button', { class: 'chip', type: 'button', 'aria-pressed': 'true', text: 'Neighbouring molecules' }, tools);
      root.ctxBtn.addEventListener('click', () => { showCtx = !showCtx; root.ctxBtn.setAttribute('aria-pressed', String(showCtx)); render(true); });
      root.info = el('div', { class: 'dr-info' }, root);
      const n = el('div', { class: 'dr-nav' }, root);
      root.prev = el('button', { class: 'btn', type: 'button' }, n);
      root.next = el('button', { class: 'btn', type: 'button' }, n);
      root.prev.addEventListener('click', () => nav && nav.go(-1));
      root.next.addEventListener('click', () => nav && nav.go(1));
      el('p', { class: 'dr-hint', text: 'Drag to rotate · pinch or ⌘/Ctrl-scroll to zoom · ← → to step along the route · Esc to close' }, root);
      document.addEventListener('keydown', e => {
        if (!root.classList.contains('on') || e.target.closest('input, textarea')) return;
        if (e.key === 'Escape') close();
        else if (e.key === 'ArrowRight' && nav && nav.hasNext) { e.preventDefault(); nav.go(1); }
        else if (e.key === 'ArrowLeft' && nav && nav.hasPrev) { e.preventDefault(); nav.go(-1); }
      });
    }
    function zoom(f) { if (vw.v) { vw.v.zoom(f, 160); } }
    function render(keep) {
      const fr = cur.frames ? cur.frames[cur.frameIndex] : cur;
      root.empty.hidden = !cur.empty;
      host.style.visibility = cur.empty ? 'hidden' : '';
      if (cur.empty) { root.empty.textContent = cur.empty; renderedKey = null; return; }
      if (keep) vw.save();
      const groups = fr.groups.filter(g => showCtx || g.tier !== 'ctx');
      root.ctxBtn.hidden = !fr.groups.some(g => g.tier === 'ctx' && g.atoms.length);
      const key = cur.viewKey;
      vw.showScene({ groups, dashed: fr.dashed }, { keepView: keep, frameAll: !cur.focusCore, zoom: cur.zoom || 1.9 }).then(() => { renderedKey = key; });
    }
    function open(spec, navigation) {
      if (!root) build();
      const wasOpen = root.classList.contains('on');
      const same = wasOpen && spec.viewKey && spec.viewKey === renderedKey;  // keep the camera along one route
      cur = spec; nav = navigation || null;
      root.eyebrow.textContent = spec.eyebrow || '';
      root.titleEl.textContent = spec.title || '';
      root.seg.replaceChildren();
      root.seg.hidden = !(spec.frames && spec.frames.length > 1);
      if (spec.frames) {
        if (spec.frameIndex == null) spec.frameIndex = Math.min(1, spec.frames.length - 1);
        spec.frames.forEach((fr, k) => {
          const b = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(k === spec.frameIndex), text: fr.label }, root.seg);
          b.addEventListener('click', () => {
            spec.frameIndex = k;
            [...root.seg.children].forEach((c, j) => c.setAttribute('aria-pressed', String(j === k)));
            render(true);
          });
        });
      }
      root.info.replaceChildren();
      for (const r of spec.info || []) el('p', { class: r.cls || 'note', text: r.text }, root.info);
      root.prev.hidden = !(nav && nav.hasPrev);
      root.next.hidden = !(nav && nav.hasNext);
      if (nav) { root.prev.textContent = `← ${nav.prevLabel || 'Previous'}`; root.next.textContent = `${nav.nextLabel || 'Next'} →`; }
      root.classList.add('on');
      root.setAttribute('aria-hidden', 'false');
      render(same);
    }
    function close() {
      if (!root || !root.classList.contains('on')) return;
      root.classList.remove('on');
      root.setAttribute('aria-hidden', 'true');
      document.dispatchEvent(new CustomEvent('drawer:close'));
    }
    return { open, close };
  })();

  /* ---------------- metals: every route at once, every state clickable ---------------- */
  const LANE_TITLE = {
    ch4: 'C–CN cleavage', h2: 'H to the metal', chain: 'C–C chain', rings_chain: 'Rings closed from the chain',
    triazine: 'N-linked chain, triazine', rings_nl: 'Rings of the N-linked chain',
    ap_nl: 'Aminopyrimidine via the N-linked trimer', ap_ch2cn: 'Aminopyrimidine via CH₂CN',
  };
  const MAP_ROWS = [['ch4', 'h2', 'chain', 'rings_chain'], ['triazine', 'rings_nl', 'ap_nl', 'ap_ch2cn']];
  const MAPS = {};  // metal -> { openEnd(routeId) }, so other charts can open a state
  function metalMap(root) {
    const metal = root.dataset.metalMap;
    const data = DATA().metals && DATA().metals[metal];
    if (!data) return;
    const M = METALS[metal], color = M.color(), faint = '#c7cbd0';
    const route = id => data.routes.find(r => r.id === id);
    const ringsOf = lane => data.rings.filter(r => r.lane === lane);
    const box = el('div', { class: 'chart map' }, root);
    const f = frame(box, `All routes on ${M.name}(100)`, 'Two ACN layers, with every state reached from the one before it and the starting film at 0. Each route is labelled at its largest DFT barrier. Click any state or saddle to open its structure in 3D.');
    legendItem(f.legend, color, 'Determined barrier');
    legendItem(f.legend, null, 'Barrier not determined', 'dotted');
    legendItem(f.legend, faint, 'Chain state a ring closes from');
    whenVisible(root, () => loadData(`struct_${metal}`).catch(() => null));
    let selected = null;  // {lane, key}

    /* the sequence the panel steps through, per lane: S0, T1, S1, T2, ... */
    function sequence(id) {
      if (id.startsWith('ring:')) {
        const r = data.rings.find(x => x.id === id.slice(5));
        const seq = [{ key: 'S0', kind: 'S', label: `${r.start} (start)`, E: r.startE }];
        if (r.barrier != null) seq.push({ key: 'T1', kind: 'TS', step: r, label: 'transition state' });
        if (r.status === 'complete') seq.push({ key: 'S1', kind: 'S', label: r.ring, E: r.E, end: true });
        return seq;
      }
      const r = route(id), seq = [{ key: 'S0', kind: 'S', label: 'starting film', E: 0 }];
      r.steps.forEach((s, i) => {
        if (s.barrier != null) seq.push({ key: `T${i + 1}`, kind: 'TS', step: s, n: i + 1, label: `saddle ${i + 1}` });
        const end = i === r.steps.length - 1 && r.status === 'complete';
        seq.push({ key: `S${i + 1}`, kind: 'S', E: s.E, n: i + 1, end, label: end ? r.product : `state ${i + 1}` });
      });
      return seq;
    }
    function laneName(id) {
      if (!id.startsWith('ring:')) return LANE_TITLE[id];
      const r = data.rings.find(x => x.id === id.slice(5));
      return `${r.ring || 'Ring'} from the ${r.start}`;
    }
    function spec(id, entry) {
      const S = DATA()[`struct_${metal}`];
      const lane = S && S.lanes[id];
      const it = lane && lane.items[entry.key];
      const out = { eyebrow: `${M.name}(100) · ${laneName(id)}`, viewKey: `${metal}:${id}` };
      const r = id.startsWith('ring:') ? null : route(id);
      if (entry.kind === 'TS') {
        const s = entry.step;
        out.title = id.startsWith('ring:') ? `Ring closure, transition state` : `Transition state of step ${entry.n} of ${r.steps.length}`;
        out.info = [
          { cls: 'mol-big', text: s.dft != null ? `${f1(s.dft)} kcal/mol` : `${f1(s.barrier)} kcal/mol` },
          { text: s.dft != null ? `DFT barrier, with ${f1(s.barrier)} kcal/mol from UMA. Dashed lines mark the bonds that form or break in this step.` : 'UMA barrier. Dashed lines mark the bonds that form or break in this step.' },
        ];
      } else {
        out.title = entry.key === 'S0' && !id.startsWith('ring:') ? 'Starting film' : entry.end ? (id.startsWith('ring:') ? `${entry.label} closed` : `${entry.label}, the end of this route`) : id.startsWith('ring:') ? `The ${entry.label}` : `State after step ${entry.n} of ${r.steps.length}`;
        out.info = [{ cls: 'mol-big', text: `${f1(entry.E)} kcal/mol` }, { text: 'UMA energy against the starting two-layer film.' }];
      }
      out.info.push({ text: entry.key === 'S0' && !id.startsWith('ring:') ? 'The molecules that react first are drawn bold, neighbouring acetonitrile pale, and the top metal layer as spheres.' : 'Molecules changed by this route are drawn bold, neighbouring acetonitrile pale, and the top metal layer as spheres.' });
      if (!it) { out.empty = S ? 'No structure was saved for this state.' : 'Loading the structure…'; return out; }
      const els = expandRuns(lane.el), xyz = it.xyz, core = new Set(it.core);
      const groups = { metal: [], core: [], ctx: [] };
      els.forEach((e, i) => {
        const a = [e, xyz[3 * i], xyz[3 * i + 1], xyz[3 * i + 2]];
        (isMetal(e) ? groups.metal : core.has(i) ? groups.core : groups.ctx).push(a);
      });
      out.groups = [{ tier: 'metal', atoms: groups.metal }, { tier: 'core', atoms: groups.core }, { tier: 'ctx', atoms: groups.ctx }];
      out.dashed = (it.dash || []).map(([i, j]) => ({ a: xyz.slice(3 * i, 3 * i + 3), b: xyz.slice(3 * j, 3 * j + 3), h: els[i] === 'H' || els[j] === 'H' }));
      return out;
    }
    function open(id, k) {
      const seq = sequence(id), entry = seq[k];
      selected = { lane: id, key: entry.key };
      mark();
      const go = d => open(id, k + d);
      const navi = {
        hasPrev: k > 0, hasNext: k < seq.length - 1, go,
        prevLabel: k > 0 ? seq[k - 1].label : '', nextLabel: k < seq.length - 1 ? seq[k + 1].label : '',
      };
      Drawer.open(spec(id, entry), navi);
      if (!DATA()[`struct_${metal}`]) {
        loadData(`struct_${metal}`).then(() => { if (selected && selected.lane === id && selected.key === entry.key) Drawer.open(spec(id, entry), navi); }).catch(() => {});
      }
    }
    document.addEventListener('drawer:close', () => { selected = null; mark(); });
    MAPS[metal] = { openEnd: id => { const seq = sequence(id); if (seq.length > 1) open(id, seq.length - 1); } };

    let marks = {}, ring = null;
    function mark() {
      if (!ring) return;
      const m = selected && marks[`${selected.lane}|${selected.key}`];
      ring.setAttribute('opacity', m ? 1 : 0);
      if (m) { ring.setAttribute('cx', m[0]); ring.setAttribute('cy', m[1]); }
    }

    responsive(f.plot, W => {
      marks = {};
      const narrow = W < 760;
      if (narrow) f.plot.classList.add('scroll-x'); else f.plot.classList.remove('scroll-x');
      const width = Math.max(W, 980);
      const m = { l: 50, r: 14 }, head = 34, ph = 270, gapRow = 30;
      // one energy scale for both rows
      const vals = [0];
      for (const r of data.routes) for (const s of r.steps) { vals.push(s.E); if (s.TS != null) vals.push(s.TS); if (s.R != null) vals.push(s.R); }
      for (const r of data.rings) { vals.push(r.startE); if (r.E != null) vals.push(r.E); if (r.TS != null) vals.push(r.TS); }
      let lo = Math.min(...vals), hi = Math.max(...vals);
      const span = hi - lo;
      lo -= span * 0.1; hi += span * 0.08;
      const H = 2 * (head + ph) + gapRow + 28;
      const svg = sv('svg', { width, height: H, viewBox: `0 0 ${width} ${H}`, role: 'img', 'aria-label': `All reaction routes on ${M.name}(100)` }, f.plot);
      const slotsOf = id => {
        if (id.startsWith('rings')) return Math.max(1, ringsOf(id === 'rings_chain' ? 'chain' : 'nlinked').length) * 1.9;
        const r = route(id);
        return r.steps.length + 1 + (r.status === 'complete' ? 0.35 : 0.6);
      };
      const gapLane = 20;
      MAP_ROWS.forEach((row, ri) => {
        const top = ri * (head + ph + gapRow);
        const Y = lin(lo, hi, top + head + ph, top + head);
        const grid = sv('g', { class: 'grid' }, svg);
        for (const t of niceTicks(lo, hi, 4)) {
          sv('line', { x1: m.l, x2: width - m.r, y1: Y(t), y2: Y(t) }, grid);
          label(sv('g', { class: 'tick' }, svg), m.l - 8, Y(t) + 4, minus(t), '', { 'text-anchor': 'end' });
        }
        sv('line', { x1: m.l, x2: width - m.r, y1: Y(0), y2: Y(0), stroke: '#cfd1cb', 'stroke-width': 1, 'shape-rendering': 'crispEdges' }, svg);
        if (ri === 0) label(svg, 12, top + head + ph / 2, 'kcal/mol', 'axis-title', { transform: `rotate(-90 12 ${top + head + ph / 2})`, 'text-anchor': 'middle' });
        const total = row.reduce((a, id) => a + slotsOf(id), 0);
        const slotW = (width - m.l - m.r - gapLane * (row.length - 1) - 10) / total;
        let x0 = m.l + 10;
        for (const id of row) {
          const lw = slotsOf(id) * slotW;
          sv('line', { x1: x0, x2: x0 + lw - 6, y1: top + 6, y2: top + 6, stroke: id.startsWith('rings') ? faint : color, 'stroke-width': 2.5, 'stroke-linecap': 'round' }, svg);
          label(svg, x0, top + 24, LANE_TITLE[id], 'lane-title');
          if (id.startsWith('rings')) drawRings(svg, id, x0, slotW, Y);
          else drawPath(svg, id, x0, slotW, Y, x0 + lw);
          x0 += lw + gapLane;
        }
      });
      ring = sv('circle', { r: 9, fill: 'none', stroke: '#15181c', 'stroke-width': 1.6, opacity: 0, 'pointer-events': 'none' }, svg);
      mark();

      function step(g, xa, ya, xb, yb, s, col, w, Y_) {
        const base = { fill: 'none', stroke: col, 'stroke-width': w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
        if (s.barrier == null) {
          sv('path', { ...base, d: `M ${xa} ${ya} ${ease(xa, ya, xb, yb)}`, 'stroke-dasharray': '0.5 4.5', 'stroke-width': w + 0.4 }, g);
          return null;
        }
        if (s.R != null && Math.abs(Y_(s.R) - ya) >= 1.5) {
          const xr = xa + (xb - xa) * 0.22, yr = Y_(s.R);
          sv('path', { ...base, d: `M ${xa} ${ya} ${ease(xa, ya, xr, yr)}`, 'stroke-dasharray': '0.5 4.5', 'stroke-width': w + 0.4 }, g);
          xa = xr; ya = yr;
        }
        const top = s.TS != null ? Y_(s.TS) : null;
        if (top != null && top < Math.min(ya, yb) - 0.5) {
          const xm = (xa + xb) / 2;
          sv('path', { ...base, d: `M ${xa} ${ya} ${ease(xa, ya, xm, top)} ${ease(xm, top, xb, yb)}` }, g);
          return [xm, top];
        }
        sv('path', { ...base, d: `M ${xa} ${ya} ${ease(xa, ya, xb, yb)}` }, g);
        return [(xa + xb) / 2, Math.min(ya, yb)];
      }
      function plateau(g, x, y, hw, col, w, id, k, rows) {
        sv('line', { x1: x - hw, x2: x + hw, y1: y, y2: y, stroke: col, 'stroke-width': w, 'stroke-linecap': 'round' }, g);
        marks[`${id}|${sequence(id)[k].key}`] = [x, y];
        const hit = sv('rect', { class: 'hit', x: x - hw - 5, y: y - 12, width: 2 * hw + 10, height: 24, rx: 6, 'aria-label': rows()[0].key }, g);
        hover(box, f.tip, hit, rows);
        hit.addEventListener('click', () => open(id, k));
        hit.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(id, k); } });
      }
      function saddle(g, pk, id, k, rows) {
        marks[`${id}|${sequence(id)[k].key}`] = pk;
        const hit = sv('circle', { class: 'hit', cx: pk[0], cy: pk[1], r: 11, 'aria-label': rows()[0].key }, g);
        hover(box, f.tip, hit, rows);
        hit.addEventListener('click', () => open(id, k));
        hit.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(id, k); } });
      }
      function drawPath(svg, id, x0, slotW, Y, xEnd) {
        const r = route(id), seq = sequence(id), g = sv('g', {}, svg), L = sv('g', {}, svg), H = sv('g', {}, svg);
        const X = i => x0 + (i + 0.5) * slotW, hw = Math.max(5, Math.min(slotW * 0.28, 13));
        const big = largest(r);
        let E = 0, peakOf = {};
        r.steps.forEach((s, i) => {
          const pk = step(g, X(i) + hw, Y(E), X(i + 1) - hw, Y(s.E), s, color, 2, Y);
          if (pk) peakOf[i] = pk;
          E = s.E;
        });
        const stateRows = (entry) => () => [
          { key: `${M.name} · ${LANE_TITLE[id]}` },
          { value: `${f1(entry.E)} kcal/mol` },
          { row: entry.key === 'S0' ? 'starting film' : entry.end ? `${r.product}, after step ${entry.n}` : `after step ${entry.n} of ${r.steps.length}`, color },
          { row: 'Click to view in 3D' },
        ];
        seq.forEach((entry, k) => {
          if (entry.kind === 'S') {
            const i = entry.key === 'S0' ? 0 : entry.n;
            plateau(H, X(i), Y(entry.E), hw, color, entry.end ? 4.5 : 3, id, k, stateRows(entry));
          } else {
            const pk = peakOf[entry.n - 1];
            if (!pk) return;
            const s = entry.step;
            saddle(H, pk, id, k, () => [
              { key: `${M.name} · ${LANE_TITLE[id]} · step ${entry.n}` },
              { value: s.dft != null ? `${f1(s.dft)} kcal/mol` : `${f1(s.barrier)} kcal/mol (UMA)` },
              { row: s.dft != null ? `DFT barrier; UMA ${f1(s.barrier)}` : 'UMA barrier', color },
              { row: 'Click to view the transition state' },
            ]);
          }
        });
        if (big && peakOf[big.i]) {
          const [px, py] = peakOf[big.i];
          sv('circle', { cx: px, cy: py, r: 3.6, fill: color, stroke: '#fff', 'stroke-width': 1.5, 'pointer-events': 'none' }, L);
          label(L, px, py - 9, f1(big.v), 'lbl-strong small', { 'text-anchor': 'middle' });
        }
        const n = r.steps.length;
        if (r.status === 'complete') {
          const ex = X(n), ey = Y(r.steps[n - 1].E);
          const anchor = ex + 40 > xEnd ? 'end' : 'middle';
          const ax = anchor === 'end' ? Math.min(ex + hw, xEnd - 2) : ex;
          label(L, ax, ey + 19, r.product, 'lbl-strong small', { 'text-anchor': anchor });
          label(L, ax, ey + 34, f1(r.steps[n - 1].E), 'lbl small', { 'text-anchor': anchor });
        } else {
          const ex = X(n), ey = Y(n ? r.steps[n - 1].E : 0);  // the route stops here: say so under its last state
          label(L, ex, ey + 18, 'not', 'lbl-muted tiny', { 'text-anchor': 'middle', 'font-style': 'italic' });
          label(L, ex, ey + 30, 'connected', 'lbl-muted tiny', { 'text-anchor': 'middle', 'font-style': 'italic' });
        }
      }
      function drawRings(svg, laneId, x0, slotW, Y) {
        const list = ringsOf(laneId === 'rings_chain' ? 'chain' : 'nlinked');
        const g = sv('g', {}, svg), L = sv('g', {}, svg), H = sv('g', {}, svg);
        const hw = Math.max(5, Math.min(slotW * 0.26, 11));
        list.forEach((r, j) => {
          const id = `ring:${r.id}`, seq = sequence(id);
          const xs = x0 + (j * 1.9 + 0.45) * slotW, xr = x0 + (j * 1.9 + 1.45) * slotW;
          const ys = Y(r.startE);
          plateau(H, xs, ys, hw, faint, 2.6, id, 0, () => [
            { key: `${M.name} · ${laneName(id)}` }, { value: `${f1(r.startE)} kcal/mol` },
            { row: `${r.start}, the chain state it closes from` }, { row: 'Click to view in 3D' },
          ]);
          if (r.status !== 'complete') {
            label(L, xs, ys + 17, 'not', 'lbl-muted tiny', { 'text-anchor': 'middle', 'font-style': 'italic' });
            label(L, xs, ys + 29, 'connected', 'lbl-muted tiny', { 'text-anchor': 'middle', 'font-style': 'italic' });
            return;
          }
          const yr = Y(r.E);
          const pk = step(g, xs + hw, ys, xr - hw, yr, r, color, 2, Y);
          const kTS = seq.findIndex(e => e.kind === 'TS'), kEnd = seq.length - 1;
          plateau(H, xr, yr, hw, color, 3.6, id, kEnd, () => [
            { key: `${M.name} · ${laneName(id)}` }, { value: `${f1(r.E)} kcal/mol` },
            { row: `${r.ring}, closed from the ${r.start}`, color }, { row: 'Click to view in 3D' },
          ]);
          if (pk && kTS >= 0) {
            saddle(H, pk, id, kTS, () => [
              { key: `${M.name} · ${laneName(id)}` },
              { value: r.dft != null ? `${f1(r.dft)} kcal/mol` : `${f1(r.barrier)} kcal/mol (UMA)` },
              { row: r.dft != null ? `DFT barrier; UMA ${f1(r.barrier)}` : 'UMA barrier', color },
              { row: 'Click to view the transition state' },
            ]);
            label(L, pk[0], pk[1] - 8, f1(r.dft ?? r.barrier), 'lbl tiny', { 'text-anchor': 'middle' });
          }
          label(L, xr, yr + 17, r.ring.replace(' (capped)', '*'), 'lbl-strong tiny', { 'text-anchor': 'middle' });
          label(L, xr, yr + 30, f1(r.E), 'lbl tiny', { 'text-anchor': 'middle' });
        });
      }
    });

    el('p', { class: 'caption', text: 'The 6-ring marked with an asterisk is the capped ring. Each structure shows the part of the two-layer film around the molecules that its route changes, with one camera per route, so stepping along a route keeps the same view.' }, root);
    // a compact table under the map; each row opens the end of its route
    const t = el('table', { class: 'mini-table route-table' }, el('div', { class: 'route-table-wrap' }, root));
    const hr = el('tr', {}, el('thead', {}, t));
    ['Route', 'Ends at', 'kcal/mol', 'Largest step (DFT)', ''].forEach((x, i) => el('th', { text: x, class: i >= 2 && i < 4 ? 'num' : '' }, hr));
    const tb = el('tbody', {}, t);
    for (const r of data.routes) {
      const tr = el('tr', {}, tb), big = largest(r), n = r.steps.length;
      el('td', { class: 'name', text: LANE_TITLE[r.id] }, tr);
      el('td', { text: r.status === 'complete' ? r.product : 'not connected', class: r.status === 'complete' ? '' : 'nc' }, tr);
      el('td', { class: 'num', text: r.status === 'complete' ? f1(r.steps[n - 1].E) : '–' }, tr);
      el('td', { class: 'num', text: big ? f1(big.v) : '–' }, tr);
      const td = el('td', { class: 'num' }, tr);
      if (n) {
        const b = el('button', { class: 'linkish', type: 'button', text: 'View in 3D' }, td);
        b.addEventListener('click', () => open(r.id, sequence(r.id).length - 1));
      }
    }
  }

  /* ---------------- metals: largest step per route, all three metals ---------------- */
  function metalOverview(box) {
    const data = DATA().metals;
    if (!data) return;
    const f = frame(box, 'Largest step along each route', 'DFT barrier of the hardest step on the way to each product, in kcal/mol. A lower value means that the product is easier to reach.');
    for (const k of Object.keys(METALS)) legendItem(f.legend, METALS[k].color(), METALS[k].name, 'dot');
    const ids = Object.keys(ROUTE_LABEL);
    responsive(f.plot, W => {
      const narrow = W < 620;
      const left = narrow ? 128 : 230, right = 54, top = 26, rowH = 17, groupGap = 22;
      const groupH = rowH * 3;
      const H = top + ids.length * (groupH + groupGap) + 8;
      const x = lin(0, 40, left, W - right);
      const svg = sv('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Largest barrier per route and metal' }, f.plot);
      const grid = sv('g', { class: 'grid' }, svg);
      for (const t of [0, 10, 20, 30, 40]) {
        sv('line', { x1: x(t), x2: x(t), y1: top - 6, y2: H - 8 }, grid);
        label(sv('g', { class: 'tick' }, svg), x(t), top - 12, String(t), '', { 'text-anchor': 'middle' });
      }
      ids.forEach((id, gi) => {
        const y0 = top + gi * (groupH + groupGap) + 6;
        const [name, sub] = ROUTE_LABEL[id];
        label(svg, 0, y0 + 14, name, 'lbl-strong');
        label(svg, 0, y0 + 32, sub, 'lbl-muted');
        if (gi > 0) sv('line', { x1: 0, x2: W, y1: y0 - groupGap / 2 - 2, y2: y0 - groupGap / 2 - 2, stroke: '#eeeeea' }, svg);
        Object.keys(METALS).forEach((mk, mi) => {
          const route = data[mk].routes.find(r => r.id === id);
          const y = y0 + mi * rowH + 8;
          const c = METALS[mk].color();
          label(svg, left - 12, y + 4, METALS[mk].sym, 'lbl-muted', { 'text-anchor': 'end' });
          if (route.status !== 'complete') {
            label(svg, x(0) + 8, y + 4, 'not connected', 'lbl-muted', { 'font-style': 'italic' });
            return;
          }
          const big = largest(route);
          sv('line', { x1: x(0), x2: x(big.v), y1: y, y2: y, stroke: c, 'stroke-width': 2, 'stroke-linecap': 'round', opacity: 0.55 }, svg);
          const dot = sv('circle', { cx: x(big.v), cy: y, r: 5, fill: c, stroke: '#fff', 'stroke-width': 2 }, svg);
          label(svg, x(big.v) + 10, y + 4, f1(big.v), 'lbl');
          const endE = route.steps[route.steps.length - 1].E;
          const hit = sv('rect', { class: 'hit', x: x(0), y: y - rowH / 2, width: Math.max(x(big.v) - x(0) + 40, 60), height: rowH }, svg);
          hover(box, f.tip, hit, () => [
            { key: `${METALS[mk].name} · ${name} ${sub}` },
            { value: `${f1(big.v)} kcal/mol` },
            { row: big.s.dft != null ? `largest DFT step (UMA ${f1(big.s.barrier)})` : 'largest step (UMA)', color: c },
            { row: `${route.steps.length} steps · product at ${f1(endE)} kcal/mol` },
            { row: 'Click to view the product in 3D' },
          ], () => dot.setAttribute('r', 6.5), () => dot.setAttribute('r', 5));
          const go = () => MAPS[mk] && MAPS[mk].openEnd(id);
          hit.addEventListener('click', go);
          hit.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
        });
      });
    });
  }

  /* ---------------- isotope effects ---------------- */
  function hdSpec(S, st, klass) {
    const rec = S && S[`${st.m}:${st.s}`];
    const out = { eyebrow: `${METALS[st.m].name}(100), one ACN layer · ${klass}`, title: rec && rec.desc ? rec.desc : 'Saddle', viewKey: `hd:${st.m}:${st.s}` };
    out.info = [
      { cls: 'mol-big', text: `kH/kD ${st.k298.toFixed(1)} at 298 K` },
      { text: `${st.k193.toFixed(1)} at 193 K, from the zero-point energies of the UMA Hessians at this saddle and its reactant.` },
      { text: 'The reacting molecules are drawn bold, other species nearby at medium weight, and neighbouring acetonitrile pale. At the saddle, dashed lines mark the bonds that form or break.' },
    ];
    if (!rec) { out.empty = 'No structure was saved for this step.'; return out; }
    const els = expandRuns(rec.el), n = rec.n;
    const cut = [n.met, n.met + n.core, n.met + n.core + n.oth];
    const tierOf = i => (i < cut[0] ? 'metal' : i < cut[1] ? 'core' : i < cut[2] ? 'oth' : 'ctx');
    const build = (xyz, dashed) => {
      const groups = { metal: [], core: [], oth: [], ctx: [] };
      els.forEach((e, i) => groups[tierOf(i)].push([e, xyz[3 * i], xyz[3 * i + 1], xyz[3 * i + 2]]));
      return {
        groups: ['metal', 'core', 'oth', 'ctx'].map(k => ({ tier: k, atoms: groups[k] })),
        dashed: dashed ? rec.dash.map(([i, j]) => ({ a: xyz.slice(3 * i, 3 * i + 3), b: xyz.slice(3 * j, 3 * j + 3), h: els[i] === 'H' || els[j] === 'H' })) : [],
      };
    };
    out.frames = [['R', 'Reactant'], ['TS', 'Transition state'], ['P', 'Product']]
      .filter(([k]) => rec.frames[k])
      .map(([k, labelText]) => ({ label: labelText, ...build(rec.frames[k], k === 'TS') }));
    out.frameIndex = out.frames.findIndex(fr => fr.label === 'Transition state');
    if (out.frameIndex < 0) out.frameIndex = 0;
    return out;
  }
  function isotopeChart(box) {
    const data = DATA().isotopes;
    if (!data) return;
    let temp = 298;
    const f = frame(box, 'Kinetic isotope effect by kind of step', '');
    const controls = el('div', { class: 'chips', role: 'group', 'aria-label': 'Temperature' }, box);
    box.insertBefore(controls, f.legend);
    const sub = box.querySelector('.subtitle') || el('p', { class: 'subtitle' });
    if (!sub.parentNode) box.insertBefore(sub, controls);
    const chips = [298, 193].map(t => {
      const c = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(t === temp), text: `${t} K` }, controls);
      c.addEventListener('click', () => { temp = t; chips.forEach(x => x.setAttribute('aria-pressed', String(x === c))); render(); });
      return c;
    });
    for (const k of Object.keys(METALS)) legendItem(f.legend, METALS[k].color(), METALS[k].name, 'dot');
    let lastW = 0;
    function render() {
      sub.textContent = `kH/kD at ${temp} K from the zero-point energies of the UMA Hessians, with one dot per step. Values above 1 mean that H reacts faster than D. Click a dot to open its saddle in 3D.`;
      lastW = 0; f.plot.replaceChildren(); draw(f.plot.clientWidth);
    }
    function draw(W) {
      if (W < 60) return;
      lastW = W;
      const narrow = W < 620;
      const left = narrow ? 150 : 250, right = 70, top = 34, rowH = 16, gap = 22;
      const groups = data.classes.map(c => ({ ...c, metals: Object.keys(METALS).filter(mk => data.steps.some(s => s.c === c.id && s.m === mk)) }));
      const H = top + groups.reduce((a, g) => a + g.metals.length * rowH + gap, 0) + 4;
      const x = logs(0.3, 40, left, W - right);
      const svg = sv('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `kH/kD at ${temp} K` }, f.plot);
      const grid = sv('g', { class: 'grid' }, svg);
      for (const t of [0.5, 1, 2, 5, 10, 20]) {
        sv('line', { x1: x(t), x2: x(t), y1: top - 6, y2: H - 4 }, grid);
        label(sv('g', { class: 'tick' }, svg), x(t), top - 12, String(t), '', { 'text-anchor': 'middle' });
      }
      sv('line', { x1: x(1), x2: x(1), y1: top - 6, y2: H - 4, stroke: '#9aa0a6', 'stroke-width': 1.2 }, svg);
      let y = top + 4;
      groups.forEach((g, gi) => {
        if (gi > 0) sv('line', { x1: 0, x2: W, y1: y - gap / 2, y2: y - gap / 2, stroke: '#eeeeea' }, svg);
        const words = g.label.split(': ');
        label(svg, 0, y + 10, words[0], 'lbl-strong');
        if (words[1]) label(svg, 0, y + 27, words[1], 'lbl-muted');
        g.metals.forEach(mk => {
          const steps = data.steps.filter(s => s.c === g.id && s.m === mk);
          const kie = s => (temp === 298 ? s.k298 : s.k193);
          const vals = steps.map(kie);
          const lo = Math.min(...vals), hi = Math.max(...vals), c = METALS[mk].color();
          const cy = y + rowH / 2;
          label(svg, left - 12, cy + 4, METALS[mk].sym, 'lbl-muted', { 'text-anchor': 'end' });
          if (hi > lo) sv('line', { x1: x(lo), x2: x(hi), y1: cy, y2: cy, stroke: c, 'stroke-width': 2.4, 'stroke-linecap': 'round', opacity: 0.45 }, svg);
          label(svg, x(hi) + 12, cy + 4, hi > lo ? `${lo.toFixed(1)}–${hi.toFixed(1)}` : lo.toFixed(1), 'lbl');
          // one dot per step; each opens its saddle (R, TS, P) in the structure panel
          const order = [...steps].sort((p, q) => kie(p) - kie(q));
          order.forEach((s, k) => {
            const dot = sv('circle', { cx: x(kie(s)), cy, r: 4, fill: c, stroke: '#fff', 'stroke-width': 1.6 }, svg);
            const hit = sv('circle', { class: 'hit', cx: x(kie(s)), cy, r: 9, 'aria-label': `${METALS[mk].name} ${s.s}` }, svg);
            hover(box, f.tip, hit, () => [
              { key: `${METALS[mk].name} · ${g.label}` },
              { value: kie(s).toFixed(2) },
              { row: `kH/kD at ${temp} K (${s.k298.toFixed(1)} at 298 K, ${s.k193.toFixed(1)} at 193 K)`, color: c },
              { row: 'Click to view the saddle in 3D' },
            ], () => dot.setAttribute('r', 5.5), () => dot.setAttribute('r', 4));
            const go = kk => {
              const st = order[kk];
              const navi = { hasPrev: kk > 0, hasNext: kk < order.length - 1, go: d => go(kk + d), prevLabel: 'previous step', nextLabel: 'next step' };
              loadData('struct_hd').then(S => Drawer.open(hdSpec(S, st, g.label), navi)).catch(() => Drawer.open({ title: g.label, empty: 'The structure could not be loaded.' }, navi));
            };
            hit.addEventListener('click', () => go(k));
            hit.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(k); } });
          });
          y += rowH;
        });
        y += gap;
      });
      label(svg, x(1) + 6, H - 8, 'kH = kD', 'lbl-muted');
    }
    new ResizeObserver(() => { const w = Math.round(f.plot.clientWidth); if (w > 60 && Math.abs(w - lastW) > 3) { f.plot.replaceChildren(); draw(w); } }).observe(f.plot);
    render();
  }

  /* ---------------- benchmark: barrier error ---------------- */
  function benchBarriers(box) {
    const data = DATA().benchmark;
    if (!data) return;
    const rows = [...data.barriers].sort((a, b) => a.mae - b.mae);
    const f = frame(box, 'Barrier error on 3,995 CHNO reactions', 'Mean absolute error of the reaction barrier against ωB97M-V/def2-TZVP, kcal/mol. Seventeen checkpoints.');
    const accent = cssVar('--accent');
    responsive(f.plot, W => {
      const narrow = W < 560;
      const left = narrow ? 150 : 190, right = 58, top = 24, rowH = 25, bar = 11;
      const H = top + rows.length * rowH + 8;
      const x = lin(0, 20, left, W - right);
      const svg = sv('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Barrier MAE per checkpoint' }, f.plot);
      const grid = sv('g', { class: 'grid' }, svg);
      for (const t of [0, 5, 10, 15, 20]) {
        sv('line', { x1: x(t), x2: x(t), y1: top - 4, y2: H - 4 }, grid);
        label(sv('g', { class: 'tick' }, svg), x(t), top - 10, String(t), '', { 'text-anchor': 'middle' });
      }
      sv('line', { x1: x(1), x2: x(1), y1: top - 4, y2: H - 4, stroke: '#9aa0a6', 'stroke-width': 1, 'stroke-dasharray': '' }, svg);
      rows.forEach((r, i) => {
        const cy = top + i * rowH + rowH / 2;
        const best = i === 0;
        label(svg, left - 12, cy + 4, r.model, best ? 'lbl-strong' : 'lbl', { 'text-anchor': 'end' });
        const x0 = x(0), x1 = Math.max(x(r.mae), x0 + 4), y0 = cy - bar / 2, rad = 4;
        sv('path', { d: `M ${x0} ${y0} H ${x1 - rad} Q ${x1} ${y0} ${x1} ${y0 + rad} V ${y0 + bar - rad} Q ${x1} ${y0 + bar} ${x1 - rad} ${y0 + bar} H ${x0} Z`, fill: best ? accent : '#9fb7bb' }, svg);
        label(svg, x1 + 8, cy + 4, r.mae.toFixed(2), best ? 'lbl-strong' : 'lbl');
        const hit = sv('rect', { class: 'hit', x: 0, y: cy - rowH / 2, width: W, height: rowH }, svg);
        hover(box, f.tip, hit, () => [
          { key: r.model },
          { value: `${r.mae.toFixed(2)} kcal/mol` },
          { row: `${r.pct.toFixed(1)}% of the mean barrier`, color: best ? accent : '#9fb7bb' },
          { row: `TS force RMSE ${r.tsforce.toFixed(3)} eV/Å` },
        ]);
      });
      label(svg, x(1) + 5, H - 6, '1 kcal/mol', 'lbl-muted');
    });
  }

  /* ---------------- benchmark: accuracy against cost ---------------- */
  function benchSpeed(box) {
    const data = DATA().benchmark;
    if (!data) return;
    const pts = [...data.speed].sort((a, b) => a.ms - b.ms);
    let best = Infinity;
    for (const p of pts) { p.front = p.force < best; if (p.front) best = p.force; }
    const front = pts.filter(p => p.front);
    const f = frame(box, 'Force error and evaluation time', 'Median force error on all 909,077 configurations against GPU time per configuration. The line joins the checkpoints for which no other checkpoint is both faster and more accurate.');
    const accent = cssVar('--accent');
    legendItem(f.legend, accent, 'Best trade-off (Pareto front)', 'dot');
    legendItem(f.legend, '#b3b9bf', 'Other checkpoints', 'dot');
    responsive(f.plot, W => {
      const H = Math.min(420, Math.max(300, W * 0.58));
      const m = { l: 62, r: 22, t: 16, b: 44 };
      const x = logs(0.05, 60, m.l, W - m.r), y = logs(0.01, 1.2, H - m.b, m.t);
      const svg = sv('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Force error against time' }, f.plot);
      const grid = sv('g', { class: 'grid' }, svg);
      for (const t of [0.1, 1, 10]) {
        sv('line', { x1: x(t), x2: x(t), y1: m.t, y2: H - m.b }, grid);
        label(sv('g', { class: 'tick' }, svg), x(t), H - m.b + 18, `${t} ms`, '', { 'text-anchor': 'middle' });
      }
      for (const t of [0.01, 0.03, 0.1, 0.3, 1]) {
        sv('line', { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t) }, grid);
        label(sv('g', { class: 'tick' }, svg), m.l - 10, y(t) + 4, String(t), '', { 'text-anchor': 'end' });
      }
      label(svg, 16, (m.t + H - m.b) / 2, 'Median force RMSE (eV/Å)', 'axis-title', { transform: `rotate(-90 16 ${(m.t + H - m.b) / 2})`, 'text-anchor': 'middle' });
      label(svg, (m.l + W - m.r) / 2, H - 6, 'Evaluation time per configuration', 'axis-title', { 'text-anchor': 'middle' });
      let d = '';
      front.forEach((p, i) => { d += i ? ` H ${x(p.ms)} V ${y(p.force)}` : `M ${x(p.ms)} ${y(p.force)}`; });
      sv('path', { d, fill: 'none', stroke: accent, 'stroke-width': 2, 'stroke-linejoin': 'round', opacity: 0.8 }, svg);
      for (const p of pts) {
        const c = p.front ? accent : '#b3b9bf';
        const dot = sv('circle', { cx: x(p.ms), cy: y(p.force), r: p.front ? 6 : 5, fill: c, stroke: '#fff', 'stroke-width': 2 }, svg);
        if (p.front || p.model === 'NEP89') {
          const right = x(p.ms) < W * 0.62;
          label(svg, x(p.ms) + (right ? 11 : -11), y(p.force) + (p.model === 'UMA-M OMol' ? 16 : -9), p.model, p.front ? 'lbl-strong' : 'lbl-muted', { 'text-anchor': right ? 'start' : 'end' });
        }
        const hit = sv('circle', { class: 'hit', cx: x(p.ms), cy: y(p.force), r: 13 }, svg);
        hover(box, f.tip, hit, () => [
          { key: p.model },
          { value: `${p.force.toFixed(3)} eV/Å` },
          { row: `median force RMSE, with an energy error of ${p.energy.toFixed(2)} meV/atom`, color: c },
          { row: `${p.ms < 1 ? p.ms.toFixed(2) : p.ms.toFixed(1)} ms per configuration` },
        ], () => dot.setAttribute('r', 7.5), () => dot.setAttribute('r', p.front ? 6 : 5));
      }
    });
  }

  /* ---------------- high pressure: the connected path at 35 GPa, every point clickable ---------------- */
  function hpPath(box) {
    const data = DATA().highpressure && DATA().highpressure.path;
    if (!data) return;
    const accent = cssVar('--accent'), dftCol = '#dd7b28';
    const pts = Object.fromEntries(data.points.map(p => [p.id, p]));
    const n = data.steps.length;
    const f = frame(box, 'Connected path from the crystal to a pentamer at 35 GPa', 'Enthalpy of the 288-atom cell relative to M0, eV. Bars are UMA minima and saddles, and diamonds are DFT single points at the same geometries. Click any state or saddle to open the cell in 3D.');
    legendItem(f.legend, accent, 'UMA (fine-tuned)');
    const s = el('span', {}, f.legend); el('i', { class: 'diamond', style: `background:${dftCol}` }, s); el('span', { text: 'DFT single point' }, s);
    const e2 = v => minus(v.toFixed(2));
    const seq = ['M0'];
    for (let k = 1; k <= n; k++) seq.push(`TS${k}`, `M${k}`);
    let sel = null, selState = null;
    function open(i) {
      const key = seq[i];
      sel = key.startsWith('TS') ? +key.slice(2) - 1 : null;
      selState = key.startsWith('M') ? +key.slice(1) : null;
      redraw();
      const navi = { hasPrev: i > 0, hasNext: i < seq.length - 1, go: d => open(i + d), prevLabel: i > 0 ? label3(seq[i - 1]) : '', nextLabel: i < seq.length - 1 ? label3(seq[i + 1]) : '' };
      const show = S => Drawer.open(hpSpec(S, key), navi);
      if (DATA().struct_hp) show(DATA().struct_hp);
      else { show(null); loadData('struct_hp').then(S => { if (seq[i] === key) show(S); }).catch(() => {}); }
    }
    const label3 = key => (pts[key] && pts[key].name) || key;
    function hpSpec(S, key) {
      const p = pts[key], isTS = key.startsWith('TS'), k = isTS ? +key.slice(2) : +key.slice(1);
      const st = isTS ? data.steps[k - 1] : null;
      const out = { eyebrow: isTS ? `35 GPa · ${key} · step ${k} of ${n}` : '35 GPa · 288-atom cell', viewKey: 'hp35', title: isTS ? st.mechanism : p.name ? `${p.name} (${key})` : `Intermediate ${key}` };
      out.info = isTS ? [
        { cls: 'mol-big', text: `${e2(st.barrier)} eV` },
        { text: `UMA barrier of this step. The saddle lies ${e2(p.uma)} eV from M0 with UMA and ${e2(p.dft)} eV with DFT at the same geometry. Dashed lines mark the bonds that form or break.` },
      ] : [
        { cls: 'mol-big', text: `${e2(p.uma)} eV` },
        { text: `Enthalpy relative to M0 with UMA, and ${e2(p.dft)} eV from the DFT single point at this geometry.` },
      ];
      out.info.push({ text: 'Molecules that have reacted by this point are drawn bold and the rest of the cell pale.' });
      if (!S) { out.empty = 'Loading the structure…'; return out; }
      const it = S.items[key];
      if (!it) { out.empty = 'No structure was saved for this point.'; return out; }
      const els = expandRuns(S.el), xyz = it.xyz, core = new Set(it.core);
      const groups = { core: [], ctx: [] };
      els.forEach((e, i) => (core.has(i) ? groups.core : groups.ctx).push([e, xyz[3 * i], xyz[3 * i + 1], xyz[3 * i + 2]]));
      out.groups = [{ tier: 'core', atoms: groups.core }, { tier: 'ctx', atoms: groups.ctx }];
      out.dashed = (it.dash || []).map(([i, j]) => ({ a: xyz.slice(3 * i, 3 * i + 3), b: xyz.slice(3 * j, 3 * j + 3), h: els[i] === 'H' || els[j] === 'H' }));
      out.focusCore = true;
      out.zoom = 0.95;
      return out;
    }
    document.addEventListener('drawer:close', () => { if (sel != null || selState != null) { sel = null; selState = null; redraw(); } });
    let lastW = 0, anim = true;
    function redraw() { lastW = 0; f.plot.replaceChildren(); draw(f.plot.clientWidth); }
    function draw(W) {
      if (W < 60) return;
      lastW = W;
      const states = [];
      for (let k = 0; k <= n; k++) states.push({ E: pts[`M${k}`].uma, key: k > 0 && k < n ? pts[`M${k}`].name : undefined });
      const steps = data.steps.map((st, i) => ({
        TS: pts[`TS${i + 1}`].uma, determined: true,
        rows: () => [
          { key: `TS${i + 1} · step ${i + 1} of ${n}` },
          { value: `${e2(st.barrier)} eV` },
          { row: st.mechanism, color: accent },
          { row: `TS at ${e2(pts[`TS${i + 1}`].uma)} eV with UMA, ${e2(pts[`TS${i + 1}`].dft)} eV with DFT` },
          { row: 'Click to view in 3D' },
        ],
      }));
      drawProfile(box, f.plot, f.tip, {
        states, steps, color: accent, height: 400, fmt: e2, unit: 'eV',
        endName: 'Pentamer', startName: 'M0', endRoom: 110,
        labelStep: 0, stepLabel: [`${e2(data.steps[0].barrier)} eV`, 'first dimer'],
        selected: sel, selectedState: selState, animate: anim,
        onSelect: i => open(2 * i + 1), onSelectState: i => open(2 * i),
        stateRows: i => [{ key: `M${i}${pts[`M${i}`].name ? ` · ${pts[`M${i}`].name}` : ''}` }, { value: `${e2(pts[`M${i}`].uma)} eV` }, { row: `DFT ${e2(pts[`M${i}`].dft)} eV`, color: dftCol }, { row: 'Click to view in 3D' }],
        overlay: (svg, X, Y, peaks) => {
          const g = sv('g', { 'pointer-events': 'none' }, svg);
          const diamond = (x, y) => sv('rect', { x: x - 4, y: y - 4, width: 8, height: 8, transform: `rotate(45 ${x} ${y})`, fill: '#fff', stroke: dftCol, 'stroke-width': 1.6 }, g);
          for (let k = 0; k <= n; k++) diamond(X(k), Y(pts[`M${k}`].dft));
          peaks.forEach(pk => diamond(pk.x, Y(pts[`TS${pk.i + 1}`].dft)));
        },
        xTitle: 'Reaction coordinate (state order)', yTitle: 'ΔH relative to M0 (eV)', aria: 'Connected path at 35 GPa',
      }, W);
      anim = false;
    }
    new ResizeObserver(() => { const w = Math.round(f.plot.clientWidth); if (w > 60 && Math.abs(w - lastW) > 3) { f.plot.replaceChildren(); draw(w); } }).observe(f.plot);
    redraw();
    // the strip of rendered structures under the chart opens the same views
    document.querySelectorAll('[data-hp-open]').forEach(b => b.addEventListener('click', () => open(seq.indexOf(b.dataset.hpOpen))));
    whenVisible(box, () => loadData('struct_hp').catch(() => null));
  }

  /* ---------------- alcohols: PM7 route to the pyrimidine ---------------- */
  function alcoholChart(box) {
    const data = DATA().alcohols;
    if (!data) return;
    let cur = 0;
    const accent = cssVar('--accent');
    const f = frame(box, 'Acetonitrile and alcohol to the triazine and the aminopyrimidine', 'PM7 energies of a cluster of four acetonitrile and four alcohol molecules along 15 connected steps, in kcal/mol, for the gas phase and without zero-point energy. The other two alcohols are drawn in gray.');
    const controls = el('div', { class: 'chips', role: 'group', 'aria-label': 'Alcohol' }, box);
    box.insertBefore(controls, f.legend);
    const chips = data.map((a, k) => {
      const c = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(k === cur), text: a.name }, controls);
      c.addEventListener('click', () => { cur = k; chips.forEach(x => x.setAttribute('aria-pressed', String(x === c))); go(); });
      return c;
    });
    legendItem(f.legend, accent, 'Selected alcohol');
    legendItem(f.legend, '#cfd3d6', 'Other alcohols');
    const KEY = { TMT: 'Triazine', D: 'Dimer', L: 'Open trimer' };
    function model(a) {
      const mins = a.points.filter(p => !p.ts), ts = a.points.filter(p => p.ts);
      return {
        states: mins.map(p => ({ E: p.E, key: KEY[p.id] })),
        steps: ts.map((t, i) => ({
          TS: t.E, determined: true,
          rows: () => [
            { key: `${t.stage} · step ${i + 1} of ${ts.length}` },
            { value: `${t.barrier.toFixed(1)} kcal/mol` },
            { row: t.label, color: accent },
            { row: `leads to ${mins[i + 1].label}` },
          ],
        })),
        mins, ts,
      };
    }
    let lastW = 0, sel = null, selState = null, anim = true;
    const announce = () => {
      const mdl = model(data[cur]);
      const id = selState != null ? mdl.mins[selState].id : mdl.ts[sel].id;
      document.dispatchEvent(new CustomEvent('alcohol:select', { detail: { alcohol: data[cur].id, id } }));
    };
    function go() { lastW = 0; anim = true; f.plot.replaceChildren(); draw(f.plot.clientWidth); announce(); }
    function draw(W) {
      if (W < 60) return;
      lastW = W;
      const main = model(data[cur]);
      const big = main.ts.reduce((b, t, i) => (t.barrier > main.ts[b].barrier ? i : b), 0);
      if (sel == null) sel = big;
      const bands = [];
      main.mins.forEach((p, i) => {
        const last = bands[bands.length - 1];
        if (!last || last.name !== p.stage) bands.push({ name: p.stage, short: p.stage.split(' ')[0], from: i, to: i });
        else last.to = i;
      });
      drawProfile(box, f.plot, f.tip, {
        states: main.states, steps: main.steps, color: accent, height: 420, bands,
        context: data.filter((_, k) => k !== cur).map(a => { const m = model(a); return { states: m.states, steps: m.steps }; }),
        endName: 'Aminopyrimidine', startName: 'ACN + alcohol', endRoom: 132,
        labelStep: big, stepLabel: [main.ts[big].barrier.toFixed(1), 'H transfer'],
        selected: selState == null ? sel : null, selectedState: selState, animate: anim,
        onSelect: i => { sel = i; selState = null; anim = false; f.plot.replaceChildren(); draw(f.plot.clientWidth); announce(); },
        onSelectState: i => { selState = i; anim = false; f.plot.replaceChildren(); draw(f.plot.clientWidth); announce(); },
        stateRows: i => [{ key: main.mins[i].stage }, { value: `${main.mins[i].E.toFixed(1)} kcal/mol` }, { row: main.mins[i].label, color: accent }, { row: 'Click to view in 3D' }],
        xTitle: 'Reaction coordinate', yTitle: 'PM7 energy (kcal/mol)', aria: `PM7 profile with ${data[cur].name}`,
      }, W);
      anim = false;
    }
    new ResizeObserver(() => { const w = Math.round(f.plot.clientWidth); if (w > 60 && Math.abs(w - lastW) > 3) { f.plot.replaceChildren(); draw(w); } }).observe(f.plot);
    go();
  }

  /* ---------------- tabs, lightbox ---------------- */
  function tabs(root) {
    const buttons = [...root.querySelectorAll('.tabs [data-tab]')];
    const panels = [...root.querySelectorAll('[data-panel]')];
    function show(id, push) {
      if (!buttons.some(b => b.dataset.tab === id)) id = buttons[0].dataset.tab;
      buttons.forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === id)));
      panels.forEach(p => { p.hidden = p.dataset.panel !== id; });
      if (push) history.replaceState(null, '', `#${id}`);
    }
    buttons.forEach(b => b.addEventListener('click', () => show(b.dataset.tab, true)));
    root.addEventListener('keydown', e => {
      const i = buttons.indexOf(document.activeElement);
      if (i < 0 || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      const j = (i + (e.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length;
      buttons[j].focus(); show(buttons[j].dataset.tab, true);
    });
    document.querySelectorAll('a[href^="#"]').forEach(a => a.addEventListener('click', e => {
      const id = a.getAttribute('href').slice(1);
      if (buttons.some(b => b.dataset.tab === id)) { e.preventDefault(); show(id, true); root.scrollIntoView({ behavior: 'smooth' }); }
    }));
    show(location.hash.slice(1), false);
    window.addEventListener('hashchange', () => show(location.hash.slice(1), false));
  }
  function lightbox() {
    const lb = el('div', { class: 'lightbox', role: 'dialog', 'aria-label': 'Enlarged figure' }, document.body);
    const img = el('img', { alt: '' }, lb);
    el('span', { class: 'close', text: 'Close ✕' }, lb);
    const close = () => lb.classList.remove('on');
    lb.addEventListener('click', close);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    document.querySelectorAll('img.zoomable').forEach(i => i.addEventListener('click', () => {
      img.src = i.dataset.full || i.currentSrc || i.src; img.alt = i.alt; lb.classList.add('on');
    }));
    document.querySelectorAll('[data-open]').forEach(a => a.addEventListener('click', e => {
      e.preventDefault(); img.src = a.dataset.open; img.alt = a.textContent; lb.classList.add('on');
    }));
  }

  function stepper(root) {
    const btns = [...root.querySelectorAll('[data-step]')], texts = [...root.querySelectorAll('[data-text]')];
    btns.forEach(b => b.addEventListener('click', () => {
      btns.forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      texts.forEach(t => { t.hidden = t.dataset.text !== b.dataset.step; });
    }));
  }
  function reveal() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
    document.querySelectorAll('.reveal').forEach(n => io.observe(n));
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-tabs]').forEach(tabs);
    document.querySelectorAll('[data-metal-map]').forEach(metalMap);
    const charts = { 'metal-overview': metalOverview, isotopes: isotopeChart, 'bench-barriers': benchBarriers, 'bench-speed': benchSpeed, alcohols: alcoholChart, 'hp-path': hpPath };
    const mols = { hero: heroMol, product: productMol, reactions: reactionMol, 'alcohol-ts': alcoholMol };
    document.querySelectorAll('[data-mol]').forEach(b => {
      if (!mols[b.dataset.mol]) return;
      if (b.dataset.mol === 'hero') mols.hero(b); else mols[b.dataset.mol](b);
    });
    document.querySelectorAll('[data-chart]').forEach(b => charts[b.dataset.chart] && charts[b.dataset.chart](b));
    document.querySelectorAll('[data-stepper]').forEach(stepper);
    lightbox();
    reveal();
  });
})();
