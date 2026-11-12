import '@fontsource-variable/hanken-grotesk';
import '@fontsource-variable/martian-mono/standard.css';
import './styles.css';

const motion = document.documentElement.classList.contains('motion');
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const utc = (d = new Date()) => d.toISOString().slice(11, 19);

/* ---------- One animation loop; each task runs only while its element is on screen ---------- */

const tasks = new Set();
let rafId = 0;
let lastT = performance.now();
const loop = (now) => {
  const dt = Math.min((now - lastT) / 1000, 0.05);
  lastT = now;
  for (const task of tasks) if (task.on) task.fn(dt, now / 1000);
  rafId = tasks.size ? requestAnimationFrame(loop) : 0;
};
const seen = new IntersectionObserver((entries) => {
  for (const e of entries) for (const task of e.target.__tasks || []) task.on = e.isIntersecting;
});
function animate(el, fn) {
  if (!motion) return;
  const task = { fn, on: false };
  (el.__tasks ||= []).push(task);
  tasks.add(task);
  seen.observe(el);
  if (!rafId) {
    lastT = performance.now();
    rafId = requestAnimationFrame(loop);
  }
}

/* ---------- HUD: clock, section index, rail, tone ---------- */

const clock = $('#clock');
const tickClock = () => (clock.textContent = utc());
tickClock();
setInterval(tickClock, 1000);

const sections = $$('[data-index]');
const navLinks = $$('[data-nav]');
const rail = $('.rail-mark');
const idxN = $('#idx-n');
const idxName = $('#idx-name');
const hero = $('.hero');
const drifts = $$('[data-drift]');
let hero3d = null;
let queued = false;

function toneAt(y) {
  for (const s of sections) {
    const r = s.getBoundingClientRect();
    if (r.top <= y && r.bottom > y) return s.dataset.tone;
  }
  return 'dark';
}

function onScroll() {
  queued = false;
  const max = document.documentElement.scrollHeight - innerHeight;
  const p = max > 0 ? clamp(scrollY / max) : 0;
  rail?.style.setProperty('--p', p.toFixed(4));

  let current = sections[0];
  for (const s of sections) if (s.getBoundingClientRect().top <= innerHeight * 0.45) current = s;
  if (idxN.textContent !== current.dataset.index) {
    idxN.textContent = current.dataset.index;
    idxName.textContent = current.dataset.name;
    for (const a of navLinks) a.toggleAttribute('aria-current', a.dataset.nav === current.id);
  }
  const root = document.documentElement;
  root.dataset.top = toneAt(32);
  root.dataset.bottom = toneAt(innerHeight - 20);

  const hp = clamp(scrollY / (hero.offsetHeight || 1));
  hero.style.setProperty('--hp', hp.toFixed(4));
  hero3d?.setScroll(hp);

  if (motion) {
    for (const d of drifts) {
      const r = d.getBoundingClientRect();
      if (r.bottom > 0 && r.top < innerHeight) d.style.transform = `translate3d(${((r.top - innerHeight) * 0.4).toFixed(1)}px,0,0)`;
    }
  }
}
const requestScroll = () => {
  if (!queued) {
    queued = true;
    requestAnimationFrame(onScroll);
  }
};
addEventListener('scroll', requestScroll, { passive: true });
addEventListener('resize', requestScroll, { passive: true });
onScroll();

/* ---------- Reveals: split headlines into words, then reveal on entry ---------- */

for (const h of $$('[data-split]')) {
  const words = h.textContent.trim().split(/\s+/);
  h.setAttribute('aria-label', h.textContent.trim());
  h.innerHTML = words
    .map((w, i) => `<span class="w" aria-hidden="true"><span class="wi" style="--i:${i}">${w}</span></span>`)
    .join(' ');
}
for (const group of $$('.vaults, .stack, .rules, .facts, .flow')) {
  [...group.children].forEach((el, i) => el.style.setProperty('--d', `${i * 90}ms`));
}
const revealer = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('in');
      e.target.dispatchEvent(new CustomEvent('reveal'));
      revealer.unobserve(e.target);
    }
  },
  { rootMargin: '0px 0px -12% 0px', threshold: 0.12 },
);
for (const el of $$('[data-reveal], [data-split], .vault, .stack li, .outro')) revealer.observe(el);

/* ---------- 001: illustrative ledger ---------- */

const credits = $('#credits');
const log = $('#ledger-log');
const flowPath = $('#flow-path');
const ledger = $('.ledger');
let value = 0.00421;
const fmt = (v) => `$${v.toFixed(6)}`;
const addLog = (text, sign) => {
  const li = document.createElement('li');
  li.className = sign > 0 ? 'up' : 'down';
  li.innerHTML = `<span>${utc()}</span><b>${sign > 0 ? '+' : '−'}</b>${text}`;
  log.prepend(li);
  while (log.children.length > 4) log.lastChild.remove();
};
addLog('yield posted · keeper', 1);
addLog('call debited · per inference ID', -1);
if (motion) {
  let acc = 0;
  let n = 0;
  const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  dot.setAttribute('r', '4');
  dot.setAttribute('class', 'flow-dot');
  flowPath.parentNode.append(dot);
  const len = flowPath.getTotalLength();
  let ft = 0;
  animate(ledger, (dt) => {
    value += dt * 0.0000137;
    acc += dt;
    if (acc > 2.4) {
      acc = 0;
      n++;
      if (n % 2) {
        value += 0.0004;
        addLog('yield posted · keeper', 1);
        ledger.classList.remove('bump');
        void ledger.offsetWidth;
        ledger.classList.add('bump');
      } else {
        value = Math.max(0, value - 0.00018);
        addLog('call debited · per inference ID', -1);
      }
    }
    credits.textContent = fmt(value);
    ft = (ft + dt / 1.6) % 1;
    const pt = flowPath.getPointAtLength(ft * len);
    dot.setAttribute('cx', pt.x.toFixed(1));
    dot.setAttribute('cy', pt.y.toFixed(1));
  });
}

/* ---------- 002: a dot runs along each yield shape ---------- */

$$('.vault').forEach((card, i) => {
  const line = $('.line', card);
  const dot = $('.dot', card);
  const len = line.getTotalLength();
  let t = i * 0.23;
  animate(card, (dt) => {
    if (!card.classList.contains('in')) return;
    t = (t + dt / 3.4) % 1.25;
    const k = Math.min(t, 1);
    const pt = line.getPointAtLength(k * len);
    dot.setAttribute('cx', pt.x.toFixed(1));
    dot.setAttribute('cy', pt.y.toFixed(1));
    dot.style.opacity = t > 1 ? String(1 - (t - 1) * 4) : '1';
  });
});

/* ---------- 003: the two request paths, drawn in SVG ---------- */

const SVGNS = 'http://www.w3.org/2000/svg';
const el = (name, attrs = {}, parent) => {
  const n = document.createElementNS(SVGNS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  parent?.append(n);
  return n;
};
const text = (parent, x, y, str, cls) => {
  const t = el('text', { x, y, class: cls }, parent);
  t.textContent = str;
  return t;
};
const HEX = '0123456789abcdef';
const hex = (n = 8) => Array.from({ length: n }, () => HEX[(Math.random() * 16) | 0]).join('');
const MARK_FRAME = 'M4 5.5A1.5 1.5 0 0 1 5.5 4H12v4H8v16h4v4H5.5A1.5 1.5 0 0 1 4 26.5zM20 4h6.5A1.5 1.5 0 0 1 28 5.5v21a1.5 1.5 0 0 1-1.5 1.5H20v-4h4V8h-4z';

const LANES = [
  {
    id: 'standard',
    title: 'Standard',
    sub: 'any OpenAI client',
    nodes: [
      { k: 'Your machine', t: 'Your app', note: 'reads', reads: true },
      { k: 'InferNear', t: 'Relay', note: 'reads in transit', reads: true, icon: 'eye' },
      { k: 'NEAR AI Cloud', t: 'TEE model', note: 'attested', reads: true },
    ],
  },
  {
    id: 'private',
    title: 'Private',
    sub: "NEAR AI's SDK",
    nodes: [
      { k: 'Your machine', t: 'App + SDK', note: 'encrypts', reads: true },
      { k: 'InferNear', t: 'Relay', note: 'ciphertext only', reads: false, icon: 'lock' },
      { k: 'NEAR AI Cloud', t: 'TEE model', note: 'decrypts inside', reads: true },
    ],
  },
];

function icon(kind, g, x, y) {
  const i = el('g', { class: `ico ico-${kind}`, transform: `translate(${x} ${y})` }, g);
  if (kind === 'eye') {
    el('path', { d: 'M1 8C3.5 3.5 12.5 3.5 15 8 12.5 12.5 3.5 12.5 1 8Z' }, i);
    el('circle', { cx: 8, cy: 8, r: 2.4 }, i);
  } else {
    el('rect', { x: 3, y: 7, width: 10, height: 7.5, rx: 1.6 }, i);
    el('path', { class: 'shackle', d: 'M5.5 7V5a2.5 2.5 0 015 0v2' }, i);
  }
  return i;
}

function marker(g, x, y, reads) {
  const m = el('g', { class: `mk${reads ? ' on' : ''}`, transform: `translate(${x} ${y}) scale(0.62) translate(-4 -4)` }, g);
  el('path', { d: MARK_FRAME }, m);
  el('rect', { x: 12, y: 12, width: 8, height: 8, rx: 1 }, m);
}

/** Builds one orientation: 'h' stacks the lanes, nodes left to right; 'v' sets lanes side by side. */
function buildDiagram(orient) {
  const H = orient === 'h';
  const W = H ? 1200 : 360;
  const nodeW = H ? 236 : 168;
  const nodeH = H ? 108 : 96;
  const laneH = H ? 168 : 0;
  const svg = el('svg', { class: `paths paths-${orient}`, viewBox: H ? `0 0 ${W} ${2 * laneH + 30}` : `0 0 ${W} 560`, 'aria-hidden': 'true' });
  const lanes = LANES.map((lane, li) => {
    const g = el('g', { class: `lane lane-${lane.id}` }, svg);
    const ox = H ? 0 : li * 192;
    const oy = H ? li * (laneH + 30) : 0;
    // Lane title
    if (H) {
      text(g, ox, oy + 50, lane.title, 'lane-t');
      text(g, ox, oy + 74, lane.sub, 'lane-s');
    } else {
      text(g, ox, oy + 22, lane.title, 'lane-t');
      text(g, ox, oy + 42, lane.sub, 'lane-s');
    }
    const pos = lane.nodes.map((_, ni) =>
      H ? { x: 196 + ni * 362, y: oy + 6 } : { x: ox, y: 62 + ni * 172 },
    );
    // Wires first, so nodes and packets sit on top.
    let fwd, back;
    if (H) {
      const y1 = oy + 6 + nodeH * 0.38;
      const y2 = oy + 6 + nodeH * 0.66;
      const xa = pos[0].x + nodeW;
      const xb = pos[2].x;
      fwd = el('path', { class: 'wire', d: `M${xa} ${y1}H${xb}`, pathLength: 1 }, g);
      back = el('path', { class: 'wire wire-back', d: `M${xb} ${y2}H${xa}`, pathLength: 1 }, g);
    } else {
      const x1 = ox + nodeW * 0.36;
      const x2 = ox + nodeW * 0.64;
      const ya = pos[0].y + nodeH;
      const yb = pos[2].y;
      fwd = el('path', { class: 'wire', d: `M${x1} ${ya}V${yb}`, pathLength: 1 }, g);
      back = el('path', { class: 'wire wire-back', d: `M${x2} ${yb}V${ya}`, pathLength: 1 }, g);
    }
    const nodes = lane.nodes.map((n, ni) => {
      const { x, y } = pos[ni];
      const ng = el('g', { class: `node${ni === 2 ? ' tee' : ''}${n.reads ? ' reads' : ''}`, style: `--n:${ni}` }, g);
      el('rect', { x, y, width: nodeW, height: nodeH, rx: 12 }, ng);
      marker(ng, x + 22, y + 24, n.reads);
      text(ng, x + 40, y + 28, n.k.toUpperCase(), 'node-k');
      text(ng, x + 18, y + (H ? 64 : 58), n.t, 'node-t');
      text(ng, x + 18, y + (H ? 88 : 80), n.note, 'node-n');
      if (n.icon) icon(n.icon, ng, x + nodeW - 32, y + 14);
      return ng;
    });
    // Packets
    const packets = [0, 0.5].map((phase) => {
      const pg = el('g', { class: 'packet' }, g);
      el('rect', { x: H ? -40 : -34, y: -12, width: H ? 80 : 68, height: 24, rx: 6 }, pg);
      const label = text(pg, 0, 4, '', 'packet-t');
      return { g: pg, label, phase, mode: '' };
    });
    return { lane, g, fwd, back, nodes, packets, relay: nodes[1], tee: nodes[2], H };
  });
  return { svg, lanes };
}

const lanesBox = $('#lanes');
if (lanesBox) {
  const dh = buildDiagram('h');
  const dv = buildDiagram('v');
  lanesBox.append(dh.svg, dv.svg);
  lanesBox.classList.add('built');
  $('.lane-text', lanesBox).classList.add('sr-only');
  const legend = document.createElement('p');
  legend.className = 'lane-legend';
  legend.setAttribute('aria-hidden', 'true');
  legend.innerHTML = '<span class="lg on"></span>reads the prompt <span class="lg"></span>cannot';
  lanesBox.append(legend);
  revealer.observe(lanesBox);

  const place = (p, path, f) => {
    const pt = path.getPointAtLength(f * path.getTotalLength());
    p.g.setAttribute('transform', `translate(${pt.x.toFixed(1)} ${pt.y.toFixed(1)})`);
  };
  const setLabel = (p, s) => {
    if (p.label.textContent !== s) p.label.textContent = s;
  };
  const staticPose = (d) => {
    for (const L of d.lanes) {
      const priv = L.lane.id === 'private';
      place(L.packets[0], L.fwd, 0.5);
      setLabel(L.packets[0], priv ? 'x9f1c4e0' : 'prompt');
      L.packets[0].g.classList.toggle('cipher', priv);
      place(L.packets[1], L.back, 0.8);
      setLabel(L.packets[1], priv ? '7ab2d18e' : 'reply');
      L.packets[1].g.classList.toggle('cipher', priv);
    }
  };
  staticPose(dh);
  staticPose(dv);

  let t = 0;
  let scramble = 0;
  const D = 4.2;
  animate(lanesBox, (dt) => {
    if (!lanesBox.classList.contains('in')) return;
    t += dt;
    scramble += dt;
    const flip = scramble > 0.09;
    if (flip) scramble = 0;
    const d = getComputedStyle(dh.svg).display !== 'none' ? dh : dv;
    for (const L of d.lanes) {
      const priv = L.lane.id === 'private';
      let overRelay = false;
      let hit = false;
      for (const p of L.packets) {
        const c = ((t / D + p.phase) % 1 + 1) % 1;
        const forward = c < 0.5;
        const f = forward ? c / 0.5 : (c - 0.5) / 0.5;
        place(p, forward ? L.fwd : L.back, f);
        // The relay node spans the middle half of each path.
        if (f > 0.27 && f < 0.73) overRelay = true;
        let label;
        if (!priv) label = forward ? 'prompt' : 'reply';
        else if (forward && f < 0.1) label = 'prompt';
        else if (!forward && f > 0.92) label = 'reply';
        else label = flip || p.mode !== 'hex' ? hex(8) : p.label.textContent;
        p.mode = /^[0-9a-f]{8}$/.test(label) ? 'hex' : 'text';
        p.g.classList.toggle('cipher', p.mode === 'hex');
        setLabel(p, label);
        if (forward && f > 0.9) hit = true;
      }
      L.relay.classList.toggle('active', overRelay);
      L.tee.classList.toggle('hit', hit);
    }
  });
}

/* ---------- 004: console that types the call and shows a simulated reply ---------- */

const consoleBox = $('#console');
const out = $('#console-out');
const tabs = $$('[role="tab"]', consoleBox);
const OUT = {
  curl: [
    ['dim', '← 200 OK · application/json'],
    ['', '{"choices": [{"message": {"role": "assistant", "content": "ok"}}]}'],
    ['ok', '✓ debited per call on NEAR'],
  ],
  js: [
    ['dim', '$ node index.mjs'],
    ['', 'ok'],
    ['ok', '✓ debited per call on NEAR'],
  ],
  sdk: [
    ['dim', '$ node private.mjs'],
    ['ok', '✓ TEE attestation checked · prompt encrypted on this machine'],
    ['', 'Verified provider_tee reply: ok'],
    ['ok', '✓ debited per call on NEAR'],
  ],
};
let typing = 0;
function showOutput(id, instant) {
  out.innerHTML = '';
  OUT[id].forEach(([cls, line], i) => {
    const p = document.createElement('p');
    p.className = cls;
    p.textContent = line;
    if (!instant) p.style.animationDelay = `${0.25 + i * 0.45}s`;
    out.append(p);
  });
}
function typePane(pane) {
  const id = pane.id.replace('pane-', '');
  const code = $('code', pane);
  const full = code.textContent;
  cancelAnimationFrame(typing);
  pane.querySelector('.typed')?.remove();
  out.innerHTML = '';
  if (!motion) {
    showOutput(id, true);
    return;
  }
  const overlay = document.createElement('code');
  overlay.className = 'typed';
  overlay.setAttribute('aria-hidden', 'true');
  pane.append(overlay);
  pane.classList.add('typing');
  const body = $('.console-body', consoleBox);
  body.scrollTop = 0;
  const perFrame = full.length > 900 ? 9 : 3;
  let i = 0;
  const step = () => {
    i = Math.min(full.length, i + perFrame);
    overlay.textContent = full.slice(0, i);
    const caretLine = full.slice(0, i).split('\n').length;
    const lh = parseFloat(getComputedStyle(pane).lineHeight) || 20;
    if (caretLine * lh > body.scrollTop + body.clientHeight - 40) body.scrollTop = caretLine * lh - body.clientHeight + 60;
    if (i < full.length) typing = requestAnimationFrame(step);
    else {
      overlay.remove();
      pane.classList.remove('typing');
      showOutput(id, false);
      body.scrollTop = body.scrollHeight;
    }
  };
  typing = requestAnimationFrame(step);
}
function selectTab(tab, focus) {
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    $(`#${t.getAttribute('aria-controls')}`).hidden = !on;
  }
  if (focus) tab.focus();
  typePane($(`#${tab.getAttribute('aria-controls')}`));
}
tabs.forEach((tab, i) => {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    selectTab(tabs[(i + step + tabs.length) % tabs.length], true);
  });
});
consoleBox.addEventListener('reveal', () => typePane($('#pane-curl')), { once: true });
if (!motion) showOutput('curl', true);

/* ---------- Copy buttons (hidden without JavaScript) ---------- */

const status = $('#copy-status');
for (const button of $$('button[data-copy], button[data-copy-active]')) {
  button.hidden = false;
  const label = button.textContent;
  button.addEventListener('click', async () => {
    const pane = button.hasAttribute('data-copy-active') ? $$('[role="tabpanel"]', consoleBox).find((p) => !p.hidden) : null;
    const value = pane ? $('code', pane).textContent : button.dataset.copy;
    let ok = true;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      ok = false;
    }
    button.textContent = ok ? 'Copied' : 'Select it';
    if (status) status.textContent = ok ? 'Copied to the clipboard.' : 'Copying is blocked here; select the text instead.';
    setTimeout(() => (button.textContent = label), 1500);
  });
}

/* ---------- Hero: three.js, loaded lazily, only with motion and WebGL ---------- */

function webgl() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}
if (motion && webgl()) {
  const boot = () =>
    import('./hero3d.js')
      .then(({ mount }) => {
        hero3d = mount($('#hero-canvas'), { onReady: () => hero.classList.add('gl-on') });
        onScroll();
      })
      .catch(() => hero.classList.remove('gl-on'));
  if ('requestIdleCallback' in window) requestIdleCallback(boot, { timeout: 900 });
  else setTimeout(boot, 300);
}
