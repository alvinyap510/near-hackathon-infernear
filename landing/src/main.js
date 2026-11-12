import '@fontsource-variable/hanken-grotesk';
import '@fontsource-variable/martian-mono/standard.css';
import '@fontsource-variable/archivo/standard.css';
import './styles.css';
import { placeIcons } from './icons.js';

const root = document.documentElement;
const motion = root.classList.contains('motion');
const pin = root.classList.contains('pin');
const fine = root.classList.contains('fine');
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const seg = (p, a, b) => clamp((p - a) / (b - a));
const utc = (d = new Date()) => d.toISOString().slice(11, 19);
const ease = (x) => 1 - Math.pow(1 - clamp(x), 3);
const HEX = '0123456789abcdef';
const hex = (n = 8) => Array.from({ length: n }, () => HEX[(Math.random() * 16) | 0]).join('');

placeIcons();

/* ---------- Headlines: words and characters, so they can rise ---------- */

for (const h of $$('[data-chars]')) {
  const text = h.textContent.trim().replace(/\s+/g, ' ');
  h.setAttribute('aria-label', text);
  const chars = text.replace(/ /g, '').length;
  let k = 0;
  h.innerHTML = text
    .split(' ')
    .map((w) => `<span class="wd" aria-hidden="true">${[...w].map((c) => `<span class="ch" style="--i:${((k++ / Math.max(1, chars - 1)) * 0.7).toFixed(3)}">${c}</span>`).join('')}</span>`)
    .join(' ');
}

/* ---------- Preloader: once per session, skippable ---------- */

const pre = $('.preloader');
function endIntro() {
  if (!root.classList.contains('intro') || pre.classList.contains('out')) return;
  pre.classList.add('out');
  try {
    sessionStorage.setItem('in-intro', '1');
  } catch {}
  setTimeout(() => {
    root.classList.remove('intro');
    root.classList.add('ready');
  }, 900);
}
if (root.classList.contains('intro')) {
  const n = $('#pre-n');
  const t0 = performance.now();
  const step = (now) => {
    const k = ease((now - t0) / 1500);
    n.textContent = String(Math.round(k * 100)).padStart(3, '0');
    if (k < 1) requestAnimationFrame(step);
    else setTimeout(endIntro, 250);
  };
  requestAnimationFrame(step);
  setTimeout(endIntro, 2300); // a timer, not asset readiness, ends the intro
  for (const ev of ['click', 'keydown', 'wheel', 'touchstart']) addEventListener(ev, endIntro, { once: true, passive: true });
} else {
  root.classList.add('ready');
}

/* ---------- HUD ---------- */

const clock = $('#clock');
const tickClock = () => (clock.textContent = utc());
tickClock();
setInterval(tickClock, 1000);

const scenes = $$('.scene');
const navLinks = $$('[data-nav]');
const rail = $('.rail-mark');
const prog = $('#prog');
const idxN = $('#idx-n');
const idxName = $('#idx-name');

let gl = null;
const glParams = {};

/* ---------- 001 Enclave ---------- */

const mech = $('.mech');
const packet = $('#packet');
const packetLabel = $('span', packet);
const relay = $('.node-relay');
const steps = $$('#mech-steps li');
let lastHex = 0;
function enclave(p, el, now) {
  const s = pin ? p * 5 : ((now / 1000) * 0.6) % 5;
  const step = Math.min(4, Math.floor(s));
  const t = s - step;
  steps.forEach((li, i) => li.classList.toggle('on', pin ? i === step : true));
  const st = el.style;
  st.setProperty('--s1', (step > 0 ? 1 : ease(t)).toFixed(3));
  st.setProperty('--t1', step > 0 || t > 0.6 ? '1' : '0');
  st.setProperty('--t2', step === 4 && t > 0.75 ? '1' : '0');
  st.setProperty('--wire', (step >= 2 ? 1 : step === 1 ? ease(t) : 0).toFixed(3));
  st.setProperty('--back', (step >= 4 ? 1 : step === 3 ? seg(t, 0.4, 1) : 0).toFixed(3));
  const locked = step >= 2 && !(step === 2 && t < 0.45);
  relay.classList.toggle('locked', locked);
  st.setProperty('--lock', locked ? '1' : '0');

  const W = mech.clientWidth;
  const H = mech.clientHeight;
  const xA = W * 0.16;
  const xR = W * 0.455;
  const xT = W * 0.72;
  const yF = H * 0.545;
  const yB = H * 0.588;
  let x = xA;
  let y = yF;
  let vis = 0;
  let label = 'prompt';
  let cipher = false;
  if (step === 1) {
    vis = ease(t * 3);
    cipher = t > 0.45;
  } else if (step === 2) {
    vis = 1;
    cipher = true;
    x = xA + (xT - xA) * ease(t);
  } else if (step === 3) {
    if (t < 0.18) {
      x = xT;
      vis = 1 - t / 0.18;
      cipher = true;
    } else if (t > 0.5) {
      x = xT - (xT - xR) * ease((t - 0.5) / 0.5);
      y = yB;
      vis = 1;
      cipher = true;
    }
  } else if (step === 4) {
    x = xR - (xR - xA) * ease(t);
    y = yB;
    vis = 1;
    cipher = t < 0.85;
    if (!cipher) label = 'ok';
  }
  if (cipher) {
    if (now - lastHex > 90 || !/^[0-9a-f]{8}$/.test(packetLabel.textContent)) {
      label = hex(8);
      lastHex = now;
    } else label = packetLabel.textContent;
  }
  if (packetLabel.textContent !== label) packetLabel.textContent = label;
  packet.classList.toggle('cipher', cipher);
  st.setProperty('--px', `${x.toFixed(1)}px`);
  st.setProperty('--py', `${y.toFixed(1)}px`);
  st.setProperty('--pk', vis.toFixed(3));
  st.setProperty('--relayflash', Math.abs(x - xR) < W * 0.04 && vis > 0.5 ? '1' : '0');

  const r = mech.getBoundingClientRect();
  const size = clamp((r.height * 0.95) / innerHeight, 0.16, 0.42);
  return {
    x: ((r.left + r.width * 0.84) / innerWidth - 0.5) * 2,
    y: (0.5 - (r.top + r.height * 0.4) / innerHeight) * 2,
    size,
    spread: step < 3 || (step === 3 && t < 0.12) ? 1.8 : 0,
    core: 1,
    scan: step === 0 ? 1 : 0.1,
    flash: step === 3 ? clamp(1 - Math.abs(t - 0.22) * 4) : 0,
    rotY: -0.35,
    intensity: 0.5,
    full: 1,
    stream: 0,
    rings: 1,
  };
}

/* ---------- 002 Intents ---------- */

const railBox = $('.rail');
const railPaths = $$('.r-path');
const tokensBox = $('#tokens');
const hub = $('.hub');
const sink = $('.sink');
const tokens = railPaths.map(() => {
  const i = document.createElement('i');
  i.dataset.icon = 'usdc';
  tokensBox.append(i);
  return i;
});
placeIcons(tokensBox);
const pathLens = railPaths.map((pth) => pth.getTotalLength());
function intents(p, el, now) {
  const st = el.style;
  st.setProperty('--draw', (pin ? ease(seg(p, 0, 0.3)) : 1).toFixed(3));
  const main = pin ? ease(seg(p, 0.55, 0.85)) : 1;
  st.setProperty('--main', main.toFixed(3));
  const W = railBox.clientWidth;
  const H = railBox.clientHeight;
  let pulse = 0;
  tokens.forEach((tk, k) => {
    let u = pin ? seg(p, 0.22 + k * 0.05, 0.6 + k * 0.05) : 1;
    if ((p > 0.75 || !pin) && motion) u = ((now / 1000) * 0.32 + k * 0.25) % 1;
    const pt = railPaths[k].getPointAtLength(u * pathLens[k]);
    tk.style.transform = `translate(${((pt.x / 1000) * W - 11).toFixed(1)}px, ${((pt.y / 400) * H - 11).toFixed(1)}px)`;
    tk.style.opacity = u > 0.02 && u < 0.98 ? '1' : '0';
    if (u > 0.85) pulse = Math.max(pulse, (u - 0.85) / 0.15);
  });
  hub.style.setProperty('--pulse', pulse.toFixed(3));

  const sr = sink.getBoundingClientRect();
  const hr = $('.icon', hub).getBoundingClientRect();
  const size = clamp((sr.height * 0.62) / innerHeight, 0.12, 0.3);
  const bx = (sr.left + sr.width / 2) / innerWidth;
  const by = (sr.top + sr.height * 0.38) / innerHeight;
  return {
    x: (bx - 0.5) * 2,
    y: (0.5 - by) * 2,
    size,
    spread: 0,
    core: 1,
    scan: 0,
    flash: main > 0.95 ? 0.35 : 0,
    rotY: -0.3,
    intensity: 0.55,
    full: 1,
    stream: main,
    sx: (hr.left + hr.width / 2) / innerWidth,
    sy: (hr.top + hr.height / 2) / innerHeight,
    ex: bx,
    ey: by,
    spreadIn: 0.035,
    rings: 0.6,
  };
}

/* ---------- 003 Yield ---------- */

const principal = $('#principal');
const counter = $('#counter');
const credits = $('#credits');
const log = $('#ledger-log');
const stepsLine = $$('#steps-line li');
let value = 0.00421;
let acc = 0;
let nLog = 0;
let lastT = performance.now();
const addLog = (text, sign) => {
  const li = document.createElement('li');
  li.className = sign > 0 ? 'up' : 'down';
  li.innerHTML = `<span>${utc()}</span><b>${sign > 0 ? '+' : '−'}</b>${text}`;
  log.prepend(li);
  while (log.children.length > 3) log.lastChild.remove();
};
addLog('call debited · per inference ID', -1);
addLog('yield posted · keeper', 1);
function yieldScene(p, el, now) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  if (motion) {
    value += dt * 0.0000137;
    acc += dt;
    if (acc > 2.6) {
      acc = 0;
      nLog++;
      if (nLog % 2) {
        value += 0.0004;
        addLog('yield posted · keeper', 1);
        credits.classList.remove('bump');
        void credits.offsetWidth;
        credits.classList.add('bump');
      } else {
        value = Math.max(0, value - 0.00018);
        addLog('call debited · per inference ID', -1);
      }
    }
  }
  const shown = `$${(value + (pin ? p : 1) * 0.0012).toFixed(6)}`;
  if (credits.textContent !== shown) credits.textContent = shown;
  stepsLine.forEach((li, i) => li.classList.toggle('on', !pin || p * 4.2 > i + 0.2));
  const pr = principal.getBoundingClientRect();
  const cr = $('.v', counter).getBoundingClientRect();
  return {
    x: 0,
    y: 0,
    size: 1.4,
    spread: 30,
    core: 0,
    scan: 0,
    flash: 0,
    intensity: 0.5,
    full: 1,
    stream: 1,
    sx: pr.right / innerWidth,
    sy: (pr.top + pr.height / 2) / innerHeight,
    ex: (cr.left - 8) / innerWidth,
    ey: (cr.top + cr.height / 2) / innerHeight,
    spreadIn: 0.09,
    rings: 0,
  };
}

/* ---------- 004 Vaults ---------- */

const curves = $$('.curve');
const vaultStage = $('.vaults');
function vaults(p) {
  curves.forEach((c, i) => c.style.setProperty('--d', (pin ? ease(seg(p, 0.12 + i * 0.15, 0.36 + i * 0.15)) : 1).toFixed(3)));
  if (pin) vaultStage.style.opacity = (seg(p, 0.05, 0.13) * (1 - seg(p, 0.9, 0.96))).toFixed(3);
  return { spread: 30, core: 0, size: 1.4, intensity: 0.5, full: 1, stream: 0, paperIn: pin ? seg(p, 0, 0.1) : 1, paperOut: pin ? seg(p, 0.9, 1) : 0, rings: 0 };
}

/* ---------- 005 API ---------- */

const consoleBox = $('#console');
let typedOnce = false;
function api(p) {
  if (pin && !typedOnce && p > 0.02) {
    typedOnce = true;
    typePane($('#pane-curl'));
  }
  return { x: 0.95, y: 0.3, size: 0.95, spread: 0.6, core: 1, scan: 0, flash: 0, rotY: -0.7, intensity: 0.35, full: 1, stream: 0, rings: 0.5 };
}

/* ---------- 006 Proof (normal flow) ---------- */

function proof(p, el) {
  const r = el.getBoundingClientRect();
  return {
    spread: 30,
    core: 0,
    size: 1.4,
    intensity: 0.5,
    full: 1,
    stream: 0,
    paperIn: clamp((innerHeight - r.top) / (innerHeight * 0.7)),
    paperOut: clamp((innerHeight - r.bottom) / (innerHeight * 0.7)),
    rings: 0,
  };
}

/* ---------- 007 Launch: the brackets stamp shut ---------- */

function launch(p) {
  const k = pin ? ease(seg(p, 0, 0.55)) : 1;
  const narrow = innerWidth < 900;
  return {
    x: narrow ? 0 : 0.52,
    y: narrow ? 0.45 : 0.1,
    size: narrow ? 0.26 : 0.6,
    spread: 6 * (1 - k),
    core: 1,
    scan: 0,
    flash: pin ? clamp(1 - Math.abs(p - 0.58) * 6) : 0,
    rotY: -0.3,
    intensity: 1,
    full: 1,
    stream: 0.35,
    sx: -0.05,
    sy: 0.62,
    ex: narrow ? 0.5 : 0.76,
    ey: narrow ? 0.27 : 0.45,
    spreadIn: 0.12,
    rings: 1,
  };
}

/* ---------- 000 Intro: the brackets open like a vault door ---------- */

function intro(p, el) {
  const hp2 = pin ? ease(seg(p, 0.05, 0.75)) : 0;
  el.style.setProperty('--hp2', hp2.toFixed(3));
  const k = pin ? ease(seg(p, 0.08, 0.9)) : 0;
  const narrow = innerWidth < 900;
  const x0 = narrow ? 0 : 0.5;
  const y0 = narrow ? 0.46 : 0.15;
  return {
    x: x0 * (1 - k),
    y: y0 * (1 - k),
    size: (narrow ? 0.28 : 0.5) + k,
    spread: k * 9,
    core: 1 - k * 0.6,
    scan: 0,
    flash: 0,
    rotY: -0.25 * (1 - k),
    intensity: 1,
    full: pin ? seg(p, 0.55, 0.85) : 0,
    stream: 0.25 + k * 0.5,
    sx: -0.05,
    sy: narrow ? 0.27 : 0.42,
    ex: 1.05,
    ey: narrow ? 0.27 : 0.36,
    spreadIn: 0.12,
    rings: 1 - k,
  };
}

const UPDATE = { intro, enclave, intents, yield: yieldScene, vaults, api, proof, launch };

/* ---------- Frame loop: scene progress, HUD and scene parameters ---------- */

let active = null;
function toneAt(y) {
  for (const s of scenes) {
    const r = s.getBoundingClientRect();
    if (r.top <= y && r.bottom > y) {
      if (s.dataset.scene === 'vaults' && pin) {
        const p = s.__p ?? 0;
        return p > 0.06 && p < 0.94 ? 'light' : 'dark';
      }
      return s.dataset.tone;
    }
  }
  return 'dark';
}
function frame(now = performance.now()) {
  const vh = innerHeight;
  const max = root.scrollHeight - vh;
  rail?.style.setProperty('--p', (max > 0 ? clamp(scrollY / max) : 0).toFixed(4));

  let current = scenes[0];
  let params = null;
  for (const s of scenes) {
    const r = s.getBoundingClientRect();
    if (r.top <= vh * 0.5 && r.bottom > vh * 0.5) current = s;
  }
  for (const s of scenes) {
    const r = s.getBoundingClientRect();
    const pinned = pin && !s.classList.contains('flow');
    const p = pinned ? clamp(-r.top / Math.max(1, r.height - vh)) : clamp((vh - r.top) / (r.height + vh));
    s.__p = p;
    s.style.setProperty('--hp', (pinned ? seg(p, 0, 0.16) : 1).toFixed(3));
    if (r.bottom > -vh * 0.2 && r.top < vh * 1.2) {
      const outp = UPDATE[s.dataset.scene]?.(p, s, now);
      if (s === current) params = outp;
    }
  }
  if (current !== active) {
    active = current;
    idxN.textContent = current.dataset.index;
    idxName.textContent = current.dataset.name;
    for (const a of navLinks) a.toggleAttribute('aria-current', a.dataset.nav === current.id);
    scrambleIn(current);
  }
  prog?.style.setProperty('--sp', (current.__p ?? 0).toFixed(3));
  root.dataset.top = toneAt(40);
  root.dataset.bottom = toneAt(vh - 30);

  if (gl && params) {
    Object.assign(glParams, { paperIn: 0, paperOut: 0, flash: 0, scan: 0 }, params);
    gl.set(glParams);
  }
}

/* ---------- Text scramble on labels ---------- */

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/';
function scramble(el) {
  if (!motion || el.__busy) return;
  const final = el.dataset.text || (el.dataset.text = el.textContent);
  el.__busy = true;
  const t0 = performance.now();
  const run = (now) => {
    const k = (now - t0) / 520;
    el.textContent = [...final].map((c, i) => (c === ' ' || c === '·' || i / final.length < k ? c : GLYPHS[(Math.random() * GLYPHS.length) | 0])).join('');
    if (k < 1) requestAnimationFrame(run);
    else {
      el.textContent = final;
      el.__busy = false;
    }
  };
  requestAnimationFrame(run);
}
function scrambleIn(scene) {
  for (const el of $$('[data-scramble]', scene)) scramble(el);
}
for (const a of navLinks) a.addEventListener('pointerenter', () => scramble($('b', a)));

/* ---------- Cursor and magnetic buttons (fine pointers only) ---------- */

if (fine) {
  const cur = $('.cursor');
  let cx = innerWidth / 2;
  let cy = innerHeight / 2;
  let tx = cx;
  let ty = cy;
  addEventListener(
    'pointermove',
    (e) => {
      tx = e.clientX;
      ty = e.clientY;
      cur.classList.add('live');
      cur.classList.toggle('on', !!e.target.closest?.('a, button, summary, [role="tab"]'));
    },
    { passive: true },
  );
  const follow = () => {
    cx += (tx - cx) * 0.28;
    cy += (ty - cy) * 0.28;
    cur.style.transform = `translate3d(${cx.toFixed(1)}px, ${cy.toFixed(1)}px, 0)`;
    requestAnimationFrame(follow);
  };
  requestAnimationFrame(follow);
  for (const m of $$('.magnetic')) {
    m.addEventListener('pointermove', (e) => {
      const r = m.getBoundingClientRect();
      m.style.transform = `translate(${((e.clientX - r.left - r.width / 2) * 0.18).toFixed(1)}px, ${((e.clientY - r.top - r.height / 2) * 0.3).toFixed(1)}px)`;
    });
    m.addEventListener('pointerleave', () => {
      m.style.transition = 'transform 0.5s cubic-bezier(0.2, 0.75, 0.15, 1)';
      m.style.transform = '';
      setTimeout(() => (m.style.transition = ''), 500);
    });
  }
}

/* ---------- 005: terminal that types the call and shows a simulated reply ---------- */

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
    ['ok', '✓ enclave attestation checked · prompt encrypted on this machine'],
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
  const full = $('code', pane).textContent;
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
  const body = $('.t-body', consoleBox);
  body.scrollTop = 0;
  const perFrame = full.length > 900 ? 10 : 3;
  let i = 0;
  const step = () => {
    i = Math.min(full.length, i + perFrame);
    overlay.textContent = full.slice(0, i);
    const lines = full.slice(0, i).split('\n').length;
    const lh = parseFloat(getComputedStyle(pane).lineHeight) || 22;
    if (lines * lh > body.scrollTop + body.clientHeight - 40) body.scrollTop = lines * lh - body.clientHeight + 60;
    if (i < full.length) typing = requestAnimationFrame(step);
    else {
      overlay.remove();
      pane.classList.remove('typing');
      showOutput(id, false);
      setTimeout(() => (body.scrollTop = body.scrollHeight), 1600);
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
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    selectTab(tabs[(i + d + tabs.length) % tabs.length], true);
  });
});
if (!motion) showOutput('curl', true);

/* ---------- Reveals in flow layout ---------- */

const revealer = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('in');
      revealer.unobserve(e.target);
      if (e.target === consoleBox && !typedOnce) {
        typedOnce = true;
        typePane($('#pane-curl'));
      }
    }
  },
  { rootMargin: '0px 0px -10% 0px', threshold: 0.1 },
);
for (const el of $$('[data-chars], #console')) revealer.observe(el);

/* ---------- Copy buttons (hidden without JavaScript) ---------- */

const status = $('#copy-status');
for (const button of $$('button[data-copy], button[data-copy-active]')) {
  button.hidden = false;
  const label = button.textContent;
  button.addEventListener('click', async () => {
    const pane = button.hasAttribute('data-copy-active') ? $$('[role="tabpanel"]', consoleBox).find((p) => !p.hidden) : null;
    const text = pane ? $('code', pane).textContent : button.dataset.copy;
    let ok = true;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      ok = false;
    }
    button.textContent = ok ? 'Copied' : 'Select it';
    if (status) status.textContent = ok ? 'Copied to the clipboard.' : 'Copying is blocked here; select the text instead.';
    setTimeout(() => (button.textContent = label), 1500);
  });
}

/* ---------- Start: frame loop, then the scene layer ---------- */

if (motion) {
  const tick = (now) => {
    frame(now);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
} else {
  frame();
  addEventListener('scroll', () => frame(), { passive: true });
  addEventListener('resize', () => frame(), { passive: true });
}

function webgl() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}
if (motion && webgl()) {
  import('./scene.js')
    .then(({ mount }) => {
      gl = mount($('#gl'), { small: !pin });
      requestAnimationFrame(() => root.classList.add('gl-on'));
    })
    .catch(() => root.classList.remove('gl-on'));
}
