import '@fontsource-variable/hanken-grotesk';
import '@fontsource-variable/martian-mono/standard.css';
import './styles.css';
import { placeIcons } from './icons.js';

placeIcons();

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

// A headline written as .line spans keeps those line breaks; its words still count on across lines.
for (const h of $$('[data-split]')) {
  let i = 0;
  const words = (text) =>
    text
      .trim()
      .split(/\s+/)
      .map((w) => `<span class="w" aria-hidden="true"><span class="wi" style="--i:${i++}">${w}</span></span>`)
      .join(' ');
  const lines = [...h.querySelectorAll('.line')];
  h.setAttribute('aria-label', h.textContent.replace(/\s+/g, ' ').trim());
  h.innerHTML = lines.length
    ? lines.map((l) => `<span class="line">${words(l.textContent)}</span>`).join(' ')
    : words(h.textContent);
}
for (const group of $$('.yt-list, .rules, .facts, .flow, .i-steps')) {
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
  { rootMargin: '0px 0px -4% 0px', threshold: 0.01 },
);
for (const el of $$('[data-reveal], [data-split], .vault, .outro')) revealer.observe(el);

/* ---------- 001: the position card ---------- */

const credits = $('#credits');
const log = $('#ledger-log');
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
  // Every 4.8 s a drop of yield forms under the principal and lands in credits at 1.45 s
  // (the CSS drip timeline); a call is debited 2.4 s after that.
  const CYCLE = 4.8;
  const LAND = 1.45;
  let t = CYCLE;
  let landed = true;
  let debited = true;
  const restart = (cls) => {
    ledger.classList.remove(cls);
    void ledger.offsetWidth;
    ledger.classList.add(cls);
  };
  animate(ledger, (dt) => {
    value += dt * 0.0000137;
    t += dt;
    if (t >= CYCLE) {
      t = 0;
      landed = debited = false;
      restart('drip');
    }
    if (!landed && t >= LAND) {
      landed = true;
      value += 0.0004;
      addLog('yield posted · keeper', 1);
      restart('bump');
    }
    if (!debited && t >= LAND + 2.4) {
      debited = true;
      value = Math.max(0, value - 0.00018);
      addLog('call debited · per inference ID', -1);
    }
    credits.textContent = fmt(value);
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

/* ---------- 003: the TEE flow ---------- */

const HEX = '0123456789abcdef';
const hex = (n = 8) => Array.from({ length: n }, () => HEX[(Math.random() * 16) | 0]).join('');
const ease = (x) => 1 - Math.pow(1 - clamp(x), 3);
const seg = (p, a, b) => clamp((p - a) / (b - a));
const tee = $('#tee');
const packet = $('#packet');
const packetLabel = $('span', packet);
const wires = $$('.tee-wire', tee);
const proofAtt = $('.te-att', tee);
const proofSig = $('.te-sig', tee);
let lastHex = 0;

/**
 * The flow at phase c (0..1): attestation lights, the prompt is encrypted at your app, passes
 * through InferNear's relay as ciphertext, opens in the enclave, and the signed reply returns.
 */
function teeAt(c, now) {
  const st = tee.style;
  const box = tee.getBoundingClientRect();
  const [w1, w2] = wires.map((w) => w.getBoundingClientRect());
  const yF = w1.top - box.top + w1.height * 0.35;
  const yB = w1.top - box.top + w1.height * 0.65;
  // Packets stay half their width clear of the boxes at either end of a wire.
  const pad = packet.offsetWidth / 2 + 8;
  const x1a = w1.left - box.left + pad;
  const x1b = w1.right - box.left - pad;
  const x2a = w2.left - box.left + pad;
  const x2b = w2.right - box.left - pad;
  const lerp = (a, b, k) => a + (b - a) * ease(k);
  let x = x1a;
  let y = yF;
  let vis = 0;
  let cipher = true;
  let label = 'prompt';
  if (c < 0.12) {
    vis = seg(c, 0.04, 0.08);
    cipher = c > 0.09;
  } else if (c < 0.27) x = lerp(x1a, x1b, seg(c, 0.12, 0.27)), (vis = 1);
  else if (c < 0.31) x = x1b;
  else if (c < 0.46) x = lerp(x2a, x2b, seg(c, 0.31, 0.46)), (vis = 1);
  else if (c < 0.5) (x = x2b), (vis = 1 - seg(c, 0.46, 0.5));
  else if (c < 0.62) x = x2b;
  else if (c < 0.77) (y = yB), (x = lerp(x2b, x2a, seg(c, 0.62, 0.77))), (vis = 1);
  else if (c < 0.81) (y = yB), (x = x1b);
  else if (c < 0.96) {
    y = yB;
    x = lerp(x1b, x1a, seg(c, 0.81, 0.96));
    vis = 1;
    cipher = c < 0.93;
    if (!cipher) label = 'ok';
  } else (y = yB), (x = x1a), (vis = 1 - seg(c, 0.96, 1)), (cipher = false), (label = 'ok');
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
  const inside = c >= 0.5 && c < 0.62;
  st.setProperty('--glow', inside ? '1' : '0');
  st.setProperty('--pass', (c >= 0.26 && c < 0.33) || (c >= 0.76 && c < 0.83) ? '1' : '0');
  st.setProperty('--ok-att', c >= 0.06 ? '1' : '0');
  st.setProperty('--ok-sig', c > 0.94 ? '1' : '0');
  proofAtt.classList.toggle('lit', c < 0.12);
  proofSig.classList.toggle('lit', c >= 0.56 && c < 0.8);
}

if (motion) {
  let c = 0;
  animate(tee, (dt, t) => {
    if (!tee.classList.contains('in')) return;
    c = (c + dt / 7) % 1;
    teeAt(c, t * 1000);
  });
}

/* ---------- 005: NEAR Intents, lines measured from the boxes they join ---------- */

const railBox = $('#rail');
const railSvg = $('#rail-lines');
const coinsBox = $('#coins');
let railPaths = [];
function railLines() {
  if (!railBox || getComputedStyle(railSvg).display === 'none') return;
  const box = railBox.getBoundingClientRect();
  const W = box.width;
  const H = box.height;
  railSvg.setAttribute('viewBox', `0 0 ${W.toFixed(1)} ${H.toFixed(1)}`);
  const at = (el, side) => {
    const r = el.getBoundingClientRect();
    return [(side === 'r' ? r.right : r.left) - box.left, r.top + r.height / 2 - box.top];
  };
  const curve = ([x1, y1], [x2, y2]) => {
    const dx = (x2 - x1) * 0.5;
    return `M${x1.toFixed(1)} ${y1.toFixed(1)}C${(x1 + dx).toFixed(1)} ${y1.toFixed(1)} ${(x2 - dx).toFixed(1)} ${y2.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
  };
  const hub = $('.hub-mark', railBox);
  const ai = $('.r-ai', railBox);
  const base = $('.r-group-base', railBox);
  const rhea = $('.r-group-near', railBox);
  const down = (from, to) => {
    const f = from.getBoundingClientRect();
    const t = to.getBoundingClientRect();
    const x = Math.min(f.left + f.width / 2, t.left + t.width / 2) - box.left;
    return `M${x.toFixed(1)} ${(f.bottom - box.top).toFixed(1)}V${(t.top - box.top).toFixed(1)}`;
  };
  // Base vault yield goes through NEAR Intents to NEAR AI; the Rhea vault is already on NEAR.
  const lines = [
    { d: curve(at(base, 'r'), at(hub, 'l')), cls: 'l-yield', coin: 'yield' },
    { d: curve(at(hub, 'r'), at(ai, 'l')), cls: 'l-yield', coin: 'yield' },
    { d: down(rhea, ai), cls: 'l-yield', coin: 'yield' },
  ];
  railSvg.innerHTML = lines.map((l, i) => `<path class="${l.cls}" d="${l.d}" pathLength="1" style="--i:${i}"/>`).join('');
  railPaths = [...railSvg.querySelectorAll('path')].map((p, i) => ({ p, len: p.getTotalLength(), coin: lines[i].coin }));
  if (!coinsBox.children.length) {
    coinsBox.innerHTML = railPaths.map((r) => (r.coin === 'usdc' ? '<i data-icon="usdc"></i>' : '<span class="yd"></span>')).join('');
    placeIcons(coinsBox);
  }
}
railLines();
addEventListener('resize', railLines, { passive: true });
document.fonts?.ready.then(railLines);
if (motion && railBox) {
  let t = 0;
  animate(railBox, (dt) => {
    if (!railBox.classList.contains('in') || !railPaths.length) return;
    t += dt;
    let lit = 0;
    let pulse = 0;
    [...coinsBox.children].forEach((c, i) => {
      const r = railPaths[i];
      if (!r) return;
      // 0: Base vaults to Intents, 1: Intents to NEAR AI, 2: Rhea vault to NEAR AI.
      const u = (t * 0.32 + (i === 1 ? -0.5 : i === 2 ? -0.25 : 0) + 10) % 1;
      const pt = r.p.getPointAtLength(u * r.len);
      c.style.transform = `translate(${(pt.x - 4.5).toFixed(1)}px, ${(pt.y - 4.5).toFixed(1)}px)`;
      c.style.opacity = t < 1.6 ? '0' : u < 0.04 || u > 0.96 ? '0' : '1';
      if (i === 0 && u > 0.88) pulse = Math.max(pulse, (u - 0.88) / 0.12);
      if (i !== 0 && u > 0.9) lit = 1;
    });
    $('.hub-mark', railBox).style.setProperty('--pulse', pulse.toFixed(3));
    $('.r-ai', railBox).style.setProperty('--lit', String(lit));
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

/* ---------- Slide deck: one gesture, one slide (desktop with a fine pointer) ---------- */

const root = document.documentElement;
const slides = $$('main > section');
const deckOn =
  matchMedia('(pointer: fine)').matches && matchMedia('(min-width: 900px) and (min-height: 700px)').matches;
if (deckOn) {
  root.classList.add('deck');
  const reduce = !motion;
  const DURATION = 750;
  const QUIET = 160; // ms of wheel silence that ends a gesture; trackpad inertia keeps firing until then
  let animating = false;
  let lastWheel = 0;
  let gestureUsed = false;
  let lastDir = 0;
  const recent = []; // the last few |deltaY| values, to tell a decaying tail from a fresh swipe
  let tween = 0;

  const topOf = (el) => el.getBoundingClientRect().top + scrollY;
  const current = () => {
    let idx = 0;
    slides.forEach((el, i) => {
      if (topOf(el) <= scrollY + 4) idx = i;
    });
    return idx;
  };
  const settle = (i) => {
    const id = slides[i].id;
    history.replaceState(null, '', id === 'top' ? location.pathname + location.search : `#${id}`);
    onScroll();
  };
  const scrollToY = (y, i) => {
    cancelAnimationFrame(tween);
    const max = root.scrollHeight - innerHeight;
    const to = Math.max(0, Math.min(max, Math.round(y)));
    const from = scrollY;
    if (reduce || Math.abs(to - from) < 2) {
      scrollTo(0, to);
      animating = false;
      settle(i);
      return;
    }
    animating = true;
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / DURATION);
      const e = 1 - Math.pow(1 - k, 3);
      scrollTo(0, from + (to - from) * e);
      if (k < 1) tween = requestAnimationFrame(step);
      else {
        animating = false;
        settle(i);
      }
    };
    tween = requestAnimationFrame(step);
  };
  const goTo = (i, landAtEnd = false) => {
    i = Math.max(0, Math.min(slides.length - 1, i));
    const el = slides[i];
    const h = el.offsetHeight;
    scrollToY(landAtEnd && h > innerHeight + 4 ? topOf(el) + h - innerHeight : topOf(el), i);
  };
  // One step: through a tall slide first, then on to the next slide.
  const advance = (dir) => {
    const i = current();
    const el = slides[i];
    const t = topOf(el);
    const bottom = t + el.offsetHeight;
    if (dir > 0 && bottom > scrollY + innerHeight + 4) return scrollToY(Math.min(bottom - innerHeight, scrollY + innerHeight * 0.85), i);
    if (dir < 0 && scrollY > t + 4) return scrollToY(Math.max(t, scrollY - innerHeight * 0.85), i);
    goTo(i + dir, dir < 0);
  };

  addEventListener(
    'wheel',
    (e) => {
      if (e.ctrlKey || e.target.closest?.('.console-body')) return;
      e.preventDefault();
      // Gesture gaps use the input's own timestamps, so a busy main thread cannot split one fling.
      const now = e.timeStamp;
      const d = Math.abs(e.deltaY);
      const dir = Math.sign(e.deltaY);
      if (now - lastWheel > QUIET) {
        gestureUsed = false;
        recent.length = 0;
      }
      lastWheel = now;
      // A fresh swipe during the last one's inertia tail: the delta jumps well above the decaying
      // tail's recent average, or the direction reverses. Small jitter never qualifies.
      const avg = recent.length >= 4 ? recent.reduce((a, b) => a + b, 0) / recent.length : Infinity;
      const fresh = (d > avg * 2 + 8 && d > 16) || (lastDir !== 0 && dir !== 0 && dir !== lastDir && d > 8);
      recent.push(d);
      if (recent.length > 5) recent.shift();
      if (dir) lastDir = dir;
      if (animating || d < 2) return;
      if (gestureUsed && !fresh) return;
      gestureUsed = true;
      recent.length = 0;
      recent.push(d);
      advance(dir);
    },
    { passive: false },
  );

  addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target;
    if (t.closest?.('input, textarea, select, [contenteditable], .console-body, [role="tablist"]')) return;
    const next = e.key === 'PageDown' || e.key === 'ArrowDown' || (e.key === ' ' && !e.shiftKey);
    const prev = e.key === 'PageUp' || e.key === 'ArrowUp' || (e.key === ' ' && e.shiftKey);
    if (!next && !prev && e.key !== 'Home' && e.key !== 'End') return;
    if (e.key === ' ' && t.closest?.('a, button, summary')) return;
    e.preventDefault();
    if (animating) return;
    if (e.key === 'Home') goTo(0);
    else if (e.key === 'End') goTo(slides.length - 1);
    else advance(next ? 1 : -1);
  });

  // In-page links (nav, logo) animate to their slide.
  addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href^="#"]');
    if (!a) return;
    const id = a.getAttribute('href').slice(1);
    const i = slides.findIndex((el) => el.id === id);
    if (i < 0) return;
    e.preventDefault();
    goTo(i);
  });

  // Keyboard focus moving out of view brings its slide into view.
  addEventListener('focusin', (e) => {
    const slide = e.target.closest?.('main > section');
    if (!slide) return;
    const r = e.target.getBoundingClientRect();
    if (r.top >= 0 && r.bottom <= innerHeight) return;
    const i = slides.indexOf(slide);
    const h = slide.offsetHeight;
    const t = topOf(slide);
    scrollToY(h > innerHeight ? Math.min(t + h - innerHeight, Math.max(t, r.top + scrollY - innerHeight / 3)) : t, i);
  });

  let resizeT = 0;
  addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => {
      if (!animating) goTo(current());
    }, 150);
  });

  // A slide link, or a reload on a slide, lands exactly on that slide. Repeated once the page has
  // finished loading, because the browser's own anchor jump and late layout can both move it.
  const landOnHash = () => {
    const i = slides.findIndex((el) => `#${el.id}` === location.hash);
    if (i > 0 && !animating) scrollTo(0, topOf(slides[i]));
  };
  if (location.hash) {
    requestAnimationFrame(landOnHash);
    if (document.readyState !== 'complete') addEventListener('load', () => requestAnimationFrame(landOnHash), { once: true });
  }
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
