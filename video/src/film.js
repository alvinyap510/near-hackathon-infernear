// InferNear film. Every frame is a pure function of music time t (120 BPM: a beat is 0.5 s,
// a bar is 2 s), so cuts land on the beat and the page renders frame by frame (render.mjs).
import '@fontsource-variable/hanken-grotesk';
import '@fontsource-variable/martian-mono/standard.css';
import './film.css';
import logoRaw from './logo.svg?raw';
import base from '@web3icons/core/svgs/networks/branded/base.svg.js';
import nearMono from '@web3icons/core/svgs/networks/mono/near-protocol.svg.js';
import ethereum from '@web3icons/core/svgs/networks/branded/ethereum.svg.js';
import arbitrum from '@web3icons/core/svgs/networks/branded/arbitrum-one.svg.js';
import solana from '@web3icons/core/svgs/networks/branded/solana.svg.js';
import bnb from '@web3icons/core/svgs/networks/branded/binance-smart-chain.svg.js';
import robinhood from '@web3icons/core/svgs/networks/branded/robinhood.svg.js';
import sui from '@web3icons/core/svgs/networks/branded/sui.svg.js';
import usdc from '@web3icons/core/svgs/tokens/branded/USDC.svg.js';
import { createGL } from './gl.js';
import { renderSoundtrack, wavBytes } from './audio.js';

export const DURATION = 84;

// ---------- maths ----------
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const prog = (t, a, d) => clamp((t - a) / d);
const lerp = (a, b, k) => a + (b - a) * k;
const easeIn = x => x * x * x;
const easeOut = x => 1 - Math.pow(1 - x, 3);
const easeInOut = x => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const expoOut = x => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
const expoInOut = x => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2);
const backOut = x => 1 + 2.70158 * Math.pow(x - 1, 3) + 1.70158 * Math.pow(x - 1, 2);
const money = (n, d = 2) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const hash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const stage = $('#stage');

// ---------- marks ----------
const ICONS = { base, near: nearMono.replace('fill="#fff"', 'fill="currentColor"'), ethereum, arbitrum, solana, bnb, robinhood, sui, usdc };
const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const LOCK = '<svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2.2" fill="currentColor"/><path d="M8.2 10.5V8a3.8 3.8 0 0 1 7.6 0v2.5" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>';
const LB = 'M4 5.5A1.5 1.5 0 0 1 5.5 4H12v4H8v16h4v4H5.5A1.5 1.5 0 0 1 4 26.5z';
const RB = 'M20 4h6.5A1.5 1.5 0 0 1 28 5.5v21a1.5 1.5 0 0 1-1.5 1.5H20v-4h4V8h-4z';
const WORDMARK = logoRaw.match(/<\/g><path d="([^"]+)"/)[1];

let uid = 0;
function placeIcons() {
  for (const el of $$('[data-icon]')) {
    const n = ++uid;
    el.innerHTML = ICONS[el.dataset.icon].replace(/\s(width|height)="24"/g, '').replace(/id="([^"]+)"/g, `id="$1-${n}"`).replace(/url\(#([^)]+)\)/g, `url(#$1-${n})`);
  }
  for (const el of $$('.ck')) el.innerHTML = CHECK;
  for (const el of $$('.lock')) el.innerHTML = LOCK;
}

// ---------- words ----------
// data-mask text: '|' breaks a line, *words* are accented. Each line masks its words as they rise.
function splitWords() {
  for (const el of $$('[data-mask]')) {
    const lines = el.textContent.trim().split('|');
    let acc = false;
    el.innerHTML = lines.map(line => `<span class="ln">${line.trim().split(/\s+/).map(w => {
      if (w.startsWith('*')) acc = true;
      const cls = acc ? 'w acc' : 'w';
      if (w.replace(/[.,!?]$/, '').endsWith('*')) acc = false;
      return `<span class="${cls}">${w.replace(/\*/g, '')}</span>`;
    }).join(' ')}</span>`).join('');
    el._w = $$('.w', el);
  }
}
function mask(el, t, a, b = 1e9, stagger = 0.05, dur = 0.65) {
  const out = easeIn(prog(t, b - 0.3, 0.3));
  el._w.forEach((w, i) => {
    const k = expoOut(prog(t, a + i * stagger, dur));
    w.style.transform = `translate3d(0, ${((1 - k) * 108 - out * 108).toFixed(2)}%, 0)`;
    w.style.opacity = t < a + i * stagger ? 0 : 1;
  });
}
function show(el, o) { el.style.opacity = o; }
function rise(el, t, a, dy = 30, d = 0.6) {
  const k = expoOut(prog(t, a, d));
  el.style.opacity = prog(t, a, 0.2);
  el.style.transform = `translate3d(0, ${(1 - k) * dy}px, 0)`;
}
function slide(el, t, a, dx = 60, d = 0.6) {
  const k = expoOut(prog(t, a, d));
  el.style.opacity = prog(t, a, 0.2);
  el.style.transform = `translate3d(${(1 - k) * dx}px, 0, 0)`;
}
function pop(el, t, a, d = 0.5, from = 0.6, extra = '') {
  const k = backOut(prog(t, a, d));
  el.style.opacity = prog(t, a, 0.12);
  el.style.transform = `${extra} scale(${lerp(from, 1, k)})`;
}
// Bracket frames close in around their content.
function frame(el, t, a, spread = 40) {
  const k = expoOut(prog(t, a, 0.55));
  el.style.opacity = prog(t, a, 0.15);
  $('.bl', el).style.transform = `translateX(${-(1 - k) * spread}px)`;
  $('.br', el).style.transform = `translateX(${(1 - k) * spread}px)`;
}
// A cut that punches in: the scene settles from slightly too close and slightly soft.
function punch(s, t, k0 = 1.07, d = 0.45) {
  const k = expoOut(prog(t, s.a, d));
  s.el.style.transform = `scale(${lerp(k0, 1, k)})`;
  const blur = (1 - k) * 10;
  s.el.style.filter = blur > 0.3 ? `blur(${blur.toFixed(2)}px)` : 'none';
}
function shake(t, a, amount = 8, d = 0.25) {
  const k = 1 - prog(t, a, d);
  if (k <= 0 || t < a) return '';
  return `translate(${((hash(Math.floor(t * 60)) - 0.5) * amount * k).toFixed(1)}px, ${((hash(Math.floor(t * 60) + 7) - 0.5) * amount * k).toFixed(1)}px)`;
}
function typedSegments(el, segs, t, a, cps) {
  let n = Math.floor(Math.max(0, (t - a) * cps)), html = '', total = 0;
  for (const [text] of segs) total += text.length;
  for (const [text, cls] of segs) {
    if (n <= 0) break;
    const part = text.slice(0, n); n -= part.length;
    html += cls ? `<span class="${cls}">${part}</span>` : part;
  }
  el.innerHTML = html + (t >= a - 0.4 && t < a + total / cps + 0.6 && Math.floor(t * 4) % 2 === 0 ? '<span class="caret"></span>' : '');
  return a + total / cps;
}
const HEX = '0123456789abcdef';
const hexAt = (i, t) => HEX[Math.floor(hash(i * 13.7 + Math.floor(t * 24)) * 16)];

// ---------- logo SVGs ----------
function wordmarkSvg(host) {
  host.innerHTML = `<svg viewBox="54 2 190 36"><defs><clipPath id="wm${++uid}"><rect x="54" y="-10" width="0" height="60"/></clipPath></defs>
    <g clip-path="url(#wm${uid})"><path fill="currentColor" d="${WORDMARK}"/></g><rect class="scanbar" x="54" y="2" width="1.4" height="36" fill="#00ec97"/></svg>`;
  return { clip: $('clipPath rect', host), bar: $('.scanbar', host) };
}
function lockupSvg(host) {
  host.innerHTML = `<svg viewBox="0 0 242.6 40"><defs><clipPath id="wm${++uid}"><rect x="48" y="-10" width="0" height="60"/></clipPath></defs>
    <g transform="scale(1.66667) translate(-4 -4)"><path fill="currentColor" d="${LB}"/><path fill="currentColor" d="${RB}"/><rect x="12" y="12" width="8" height="8" rx="1" fill="#00ec97"/></g>
    <g clip-path="url(#wm${uid})"><path fill="currentColor" d="${WORDMARK}"/></g><rect class="scanbar" x="48" y="0" width="1.2" height="40" fill="#00ec97"/></svg>`;
  return { clip: $('clipPath rect', host), bar: $('.scanbar', host) };
}
function revealWordmark(L, t, a, x0, width, d = 0.9) {
  const k = expoOut(prog(t, a, d));
  L.clip.setAttribute('width', String(width * k));
  L.bar.setAttribute('x', String(x0 + width * k));
  L.bar.style.opacity = t < a ? 0 : 1 - prog(t, a + d * 0.7, 0.3);
}

// ---------- GL ----------
const gl = createGL($('#gl'));
const W2S = 117.7; // pixels per world unit at the default camera distance

function glState(t) {
  if (t < 10.05) {
    const assemble = easeIn(prog(t, 2.0, 2.0));
    const move = expoOut(prog(t, 4.5, 1.2));
    const dive = easeIn(prog(t, 8.8, 1.25));
    const x = 0, y = lerp(0.3, 1.45, move), scale = lerp(1.1, 0.78, move);
    return {
      time: t + 3, assemble, core: t < 3.95 ? 0 : backOut(prog(t, 3.95, 0.55)),
      x, y, scale, rotY: 0.32 * Math.sin(t * 0.45) - 0.2 + (1 - assemble) * 0.7, rotX: 0.1 * Math.sin(t * 0.33),
      camX: lerp(0, x, dive), camY: lerp(0, y, dive), camZ: lerp(lerp(24, 16, easeOut(prog(t, 0, 4))), 0.55, dive),
      lookX: lerp(0, x, dive), lookY: lerp(0, y, dive), streams: Math.max(0.3 * prog(t, 0.3, 1.6), prog(t, 4, 0.8)), rings: prog(t, 4, 1.0),
      glowScale: 1 + dive * 2, spread: 2.0,
    };
  }
  if (t >= 56 && t < 62) {
    const k = expoOut(prog(t, 56.0, 0.7)), ko = easeIn(prog(t, 61.5, 0.5));
    return {
      time: t, assemble: 1, bracketGap: (1 - k) * 1.6, core: 1, x: 3.7, y: -0.1, scale: 1.05 * (1 - ko * 0.6),
      rotY: -0.62 + 0.12 * Math.sin(t * 0.7) + ko * 2.4, rotX: 0.08 * Math.sin(t * 0.5),
      camZ: 16, streams: prog(t, 56.1, 0.5) * (1 - ko), rings: 1 - ko, left: 1.9, right: 14, spread: 1.6, opacity: 1 - prog(t, 61.8, 0.2),
    };
  }
  if (t >= 72 && t < 78.05) {
    const k = expoOut(prog(t, 72.0, 0.55));
    const land = easeInOut(prog(t, 77.2, 0.8));
    const spin = (t - 72) * 0.55;
    const target = Math.round(((77.2 - 72) * 0.55) / (Math.PI * 2)) * Math.PI * 2;
    return {
      time: t, assemble: k, core: backOut(prog(t, 72.15, 0.55)),
      x: lerp(0, (584 - 960) / W2S, land), y: lerp(0.6, (540 - 404) / W2S, land), scale: lerp(1.0, 0.314, land),
      rotY: lerp(spin, target, land), rotX: lerp(0.12 * Math.sin(t * 0.6), 0, land),
      camZ: 16, streams: 1 - land, rings: 1 - land, glow: 1 - land * 0.6,
    };
  }
  return null;
}

// ---------- scenes ----------
const scenes = [];
const scene = (id, a, b, update, hud = 'dark') => scenes.push({ id, a, b, el: $(`#s-${id}`), update, hud });
const SECTIONS = [[0, '[00] InferNear'], [10, '[01] NEAR AI Cloud'], [16, '[02] The gap'], [24, '[03] The turn'], [28, '[04] Every chain → NEAR AI Cloud'],
  [36, '[05] NEAR Intents'], [42, '[06] No NEAR account'], [48, '[07] NEAR AI Cloud → everyone'], [56, '[08] NEAR TEE'], [62, '[09] Models'],
  [66, '[10] Proof'], [72, '[11] Every chain'], [78, '[12] InferNear']];

let heroWord, lockup;
scene('hero', 0, 10.05, (t, s) => {
  const flash = $('#heroflash'), shock = $('#heroshock');
  flash.style.opacity = t < 4 ? 0 : 0.85 * (1 - prog(t, 4.0, 0.6));
  const ks = easeOut(prog(t, 4.0, 0.9));
  shock.style.opacity = t < 4 ? 0 : 0.9 * (1 - ks);
  shock.style.transform = `scale(${0.4 + ks * 4})`;
  const fade = 1 - prog(t, 8.7, 0.3);
  revealWordmark(heroWord, t, 4.55, 54, 190, 0.9);
  $('#heroword').style.opacity = fade;
  $('#heroword').style.transform = `translateY(${(1 - expoOut(prog(t, 4.5, 0.8))) * 24}px)`;
  $$('.hero-tags .fr', s.el).forEach((f, i) => { frame(f, t, 5.6 + i * 0.5, 50); f.style.opacity = Math.min(Number(f.style.opacity), fade); });
  $$('.hero-stack span', s.el).forEach((sp, i) => { sp.style.color = t >= 7.5 + i * 0.25 ? '#00ec97' : ''; });
  const stack = $('.hero-stack', s.el);
  stack.style.opacity = prog(t, 7.3, 0.3) * fade;
  stack.style.letterSpacing = `${lerp(0.4, 0.05, expoOut(prog(t, 7.3, 0.9)))}em`;
  $('#dive').style.opacity = prog(t, 9.55, 0.45);
});

scene('cloud', 10, 16, (t, s) => {
  const panel = $('#cloudpanel');
  const up = easeInOut(prog(t, 11.75, 0.5));
  panel.style.transform = `translate3d(0, ${-up * 100}%, 0)`;
  const g = $('.giant', panel);
  mask(g, t, 10.02, 1e9, 0.06, 0.6);
  g.style.transform = `scale(${1 + 0.03 * prog(t, 10, 2)})`;
  mask($('.cloud-left .big', s.el), t, 12.05, 1e9, 0.06);
  rise($('.cloud-left .kicker', s.el), t, 12.0, 14);
  mask($('.cloud-left .sub', s.el), t, 12.8, 1e9, 0.03);
  const chip = $('.chip', s.el);
  const kc = expoOut(prog(t, 12.15, 0.8));
  chip.style.transform = `scale(${lerp(0.8, 1, kc)}) rotate(${lerp(-8, 0, kc)}deg)`;
  chip.style.opacity = prog(t, 12.15, 0.25);
  const scan = $('.scan', s.el);
  scan.setAttribute('y', String(60 + (((t - 12.3) * 280) % 280 + 280) % 280));
  scan.style.opacity = t > 12.3 ? 0.75 : 0;
  $('.die', s.el).style.opacity = 0.75 + 0.25 * Math.sin(t * 6);
  const stamp = $('.stamp', s.el);
  const ks = expoOut(prog(t, 13.3, 0.35));
  stamp.style.opacity = prog(t, 13.3, 0.08);
  stamp.style.transform = `rotate(-9deg) scale(${lerp(1.8, 1, ks)})`;
  const models = ['deepseek-ai/DeepSeek-V4.1-Flash-1017', 'Qwen/Qwen3.6-35B-A3B-FP8', 'Qwen/Qwen3.8-27B', 'Qwen/Qwen3-VL-30B-A3B-Instruct', 'z-ai/glm-5.3-flash', 'Qwen/Qwen3.8-27B-abliterated', 'DeepSeek-V4.1-Flash-1017-abliterated'];
  const slot = $('#modelslot');
  const i = Math.floor((t - 12.6) / 0.4);
  slot.innerHTML = t < 12.6 ? '' : i < 7 ? `<span class="dim2">attesting</span>${models[i]}` : '<span class="dim2">attested</span>7 models · all inside NEAR TEEs';
  slot.style.opacity = t < 12.6 ? 0 : 1;
}, 'dark');

const BURST_AT = 17.0;
scene('gap', 16, 20, (t, s) => {
  punch(s, t);
  const [l1, l2] = $$('.gap-title .ml', s.el);
  mask(l1, t, 16.02, 1e9, 0.07);
  mask(l2, t, 16.3, 1e9);
  frame($('#nearframe'), t, 16.45, 80);
  const bs = $$('.b', s.el);
  bs.forEach((b, i) => {
    const at = BURST_AT + i * 0.07, k = backOut(prog(t, at, 0.7));
    const x = Number(b.dataset.x) * k, y = Number(b.dataset.y) * k + Math.sin(t * 1.4 + i) * 6 * k;
    b.style.transform = `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${lerp(0.3, 1, Math.min(1, k)).toFixed(3)})`;
    b.style.opacity = prog(t, at, 0.12);
    b._x = 960 + x; b._y = 520 + y;
  });
  const lines = $('#gaplines');
  bs.forEach((b, i) => {
    const line = lines.children[i * 2], x = lines.children[i * 2 + 1];
    const k = expoOut(prog(t, 17.7 + i * 0.05, 0.6));
    const ex = lerp(b._x, 960, 0.42 * k), ey = lerp(b._y, 520, 0.42 * k);
    line.setAttribute('x1', b._x); line.setAttribute('y1', b._y); line.setAttribute('x2', ex); line.setAttribute('y2', ey);
    line.style.opacity = t < 17.7 ? 0 : 0.6;
    const kx = backOut(prog(t, 18.45 + i * 0.05, 0.45));
    x.setAttribute('transform', `translate(${ex} ${ey}) scale(${Math.max(0, kx)})`);
  });
  mask($('.cap', s.el), t, 18.35, 1e9, 0.05);
}, 'light');

const BILLS = [64.2, 91.1, 57.3, 102.15, 72.85];
scene('bills', 20, 24, (t, s) => {
  punch(s, t);
  rise($('.kicker', s.el), t, 20.02, 12);
  let spent = 0, changing = 0;
  $$('.tk', s.el).forEach((tk, i) => {
    const at = 20.55 + i * 0.6;
    const kin = expoOut(prog(t, at, 0.32)), kout = easeIn(prog(t, at + 0.45, 0.32));
    tk.style.opacity = t < at ? 0 : 1 - kout;
    tk.style.transform = `translate(calc(-50% + ${((1 - kin) * 760 - kout * 760).toFixed(1)}px), ${(-kout * 40).toFixed(1)}px)`;
    const k = easeOut(prog(t, at + 0.15, 0.4));
    spent += BILLS[i] * k;
    if (k > 0 && k < 1) changing = 1;
  });
  const c = $('#counter');
  c.textContent = money(1000 - spent);
  c.style.color = changing ? '#f2b705' : '';
  const tense = prog(t, 23.2, 0.8);
  const lastBill = 20.55 + Math.max(0, Math.min(4, Math.floor((t - 20.55) / 0.6))) * 0.6 + 0.15;
  c.style.transform = `${shake(t, lastBill, 6, 0.2)} scale(${1 + 0.06 * tense})`;
  c.style.filter = tense > 0.05 ? `blur(${tense * 3}px)` : 'none';
  mask($('.cap', s.el), t, 20.8, 1e9, 0.045);
});

let sparks = [];
scene('turn', 24, 28.02, (t, s) => {
  const blk = $('#block');
  const k = backOut(prog(t, 24.0, 0.4));
  const conv = easeIn(prog(t, 27.2, 0.8));
  blk.style.transform = `${shake(t, 24.0, 14, 0.3)} translateY(${(1 - k) * -80}px) scale(${lerp(1.18, 1, k) * (1 - conv * 0.5)})`;
  blk.style.opacity = prog(t, 24.0, 0.06) * (1 - conv);
  const kb = expoOut(prog(t, 24.1, 0.4));
  $('#tbl').style.transform = `translateX(${-(1 - kb) * 420}px)`; $('#tbr').style.transform = `translateX(${(1 - kb) * 420}px)`;
  $('#tbl').style.opacity = $('#tbr').style.opacity = prog(t, 24.1, 0.1) * (1 - conv);
  $('.lock', blk).style.transform = `scale(${1 + 0.25 * Math.sin(clamp((t - 24.35) / 0.3) * Math.PI)})`;
  mask($('.turn-a', s.el), t, 24.2, 25.9, 0.06);
  mask($('.turn-b', s.el), t, 26.05, 27.6, 0.06);
  // Yield sparks leave the principal block, then gather into one point.
  sparks.forEach((p, i) => {
    const born = 26.0 + (i % 40) * 0.035 + Math.floor(i / 40) * 0.55;
    const life = t - born;
    if (life < 0) { p.setAttribute('opacity', 0); return; }
    const a = lerp(-2.7, -0.45, hash(i * 3.1)), v = lerp(260, 620, hash(i * 7.7));
    const L = Math.min(life, 1.4);
    let x = 960 + Math.cos(a) * v * L * 0.9, y = 250 + Math.sin(a) * v * L * 0.6 + 120 * L * L;
    x = lerp(x, 960, conv); y = lerp(y, 540, conv);
    p.setAttribute('cx', x.toFixed(1)); p.setAttribute('cy', y.toFixed(1));
    p.setAttribute('opacity', (Math.min(life * 6, 1) * (1 - 0.4 * prog(life, 1.2, 0.6))).toFixed(2));
  });
  $('#turnflash').style.opacity = prog(t, 27.7, 0.3);
});

function chapter(id, a) {
  scene(id, a, a + 2, (t, s) => {
    const k = expoOut(prog(t, a, 0.45));
    $('.cbl', s.el).style.transform = `translateX(${-(1 - k) * 400}px)`;
    $('.cbr', s.el).style.transform = `translateX(${(1 - k) * 400}px)`;
    pop($('.ch-num', s.el), t, a + 0.08, 0.45, 0.5);
    mask($('.chh', s.el), t, a + 0.12, 1e9, 0.07, 0.6);
    const ks = easeIn(prog(t, a + 1.55, 0.42));
    $('.shut.l', s.el).style.transform = `scaleX(${ks})`;
    $('.shut.r', s.el).style.transform = `scaleX(${ks})`;
    $('.ch-in', s.el).style.transform = `scale(${1 + 0.04 * prog(t, a, 2)})`;
  }, 'light');
}
chapter('ch1', 28);

let yieldDots = [];
const COIN_FROM = { x: 209, y: 612 };
scene('yield', 30, 36, (t, s) => {
  mask($('.top', s.el), t, 30.05, 1e9, 0.05);
  slide($('.wallet', s.el), t, 30.25, -70);
  slide($('.credits', s.el), t, 30.45, 70);
  const kv = expoOut(prog(t, 30.35, 0.6));
  $$('.vb', s.el).forEach(v => { v.style.transform = `scaleY(${kv})`; v.style.opacity = prog(t, 30.35, 0.1); });
  const names = ['Aave USDC vault · Base', 'cbETH vault · Base', 'Pendle PT vault · Base', 'Rhea USDC vault · NEAR', '4 vaults live on mainnet'];
  const ni = t < 34.2 ? 0 : Math.min(4, 1 + Math.floor((t - 34.2) / 0.4));
  $('#vname').textContent = names[ni];
  $('#vname').style.opacity = prog(t, 30.55, 0.2);
  let left = 1000;
  $$('.coins .ic', s.el).forEach((c, i) => {
    const at = 30.85 + i * 0.22, k = easeInOut(prog(t, at, 0.55));
    if (k >= 1) left -= 200;
    const endX = 970, endY = 678 - i * 40;
    const x = lerp(COIN_FROM.x, endX, k), y = lerp(COIN_FROM.y, endY, k) - Math.sin(k * Math.PI) * 220;
    c.style.transform = `translate(${(x - endX).toFixed(1)}px, ${(y - endY - i * 40).toFixed(1)}px) rotate(${((1 - k) * -40).toFixed(1)}deg)`;
    c.style.opacity = t < at ? 0 : 1;
  });
  $('#wbal').textContent = left.toLocaleString('en-US', { minimumFractionDigits: 2 });
  pop($('.v-principal', s.el), t, 32.1, 0.5, 0.7);
  const period = yieldDots.length * 0.07;
  yieldDots.forEach((d, i) => {
    const born = 32.35 + i * 0.07;
    if (t < born || t > 35.9) { d.setAttribute('opacity', 0); return; }
    const p = ((t - born) % period) / 1.05;
    if (p > 1) { d.setAttribute('opacity', 0); return; }
    const jx = (hash(i) - 0.5) * 40, e = easeInOut(p);
    const x0 = 970 + jx, y0 = 380, x2 = 1545, y2 = 560, cx = 1250, cy = 140 + (hash(i * 3) - 0.5) * 80;
    const x = (1 - e) ** 2 * x0 + 2 * (1 - e) * e * cx + e * e * x2, y = (1 - e) ** 2 * y0 + 2 * (1 - e) * e * cy + e * e * y2;
    d.setAttribute('cx', x.toFixed(1)); d.setAttribute('cy', y.toFixed(1));
    d.setAttribute('opacity', Math.min(p * 8, (1 - p) * 8, 1).toFixed(2));
  });
  $('#cnum').textContent = money(1.274 * easeOut(prog(t, 32.9, 2.7)), 3);
  mask($('.cap', s.el), t, 33.3, 1e9, 0.04);
});

let routes = [];
scene('intents', 36, 42, (t, s) => {
  const zoom = easeIn(prog(t, 41.55, 0.45));
  s.el.style.transformOrigin = '1560px 600px';
  s.el.style.transform = `scale(${1 + zoom * 0.6})`;
  s.el.style.filter = zoom > 0.05 ? `blur(${zoom * 8}px)` : 'none';
  const title = $('#intitle');
  const kin = expoOut(prog(t, 36.0, 0.5));
  const up = expoInOut(prog(t, 37.7, 0.65));
  title.style.transform = `translateY(${-up * 238}px) scale(${lerp(1.08, 1, kin) * lerp(1, 0.42, up)})`;
  title.style.filter = kin < 0.95 ? `blur(${(1 - kin) * 10}px)` : 'none';
  $('#infill').style.clipPath = `inset(0 ${(1 - easeInOut(prog(t, 36.2, 0.85))) * 100}% 0 0)`;
  mask($('.intents-sub', s.el), t, 36.6, 37.75, 0.05);
  $$('.nd', s.el).forEach((n, i) => { const k = expoOut(prog(t, 37.95 + i * 0.07, 0.6)); n.style.opacity = prog(t, 37.95 + i * 0.07, 0.2); n.style.transform = `translate(${(1 - k) * -80}px, -50%)`; });
  pop($('#nearnode'), t, 38.05, 0.6, 0.5);
  routes.forEach((r, i) => {
    const k = easeInOut(prog(t, 38.2 + i * 0.07, 0.7));
    r.path.style.strokeDashoffset = String(r.len * (1 - k));
    r.path.style.opacity = t < 38.2 ? 0 : 1;
    r.dots.forEach((d, j) => {
      const start = 38.85 + i * 0.13 + j * 0.42;
      const p = ((t - start) % 1.26) / 1.1;
      if (t < start || p > 1) { d.setAttribute('opacity', 0); return; }
      const pt = r.path.getPointAtLength(easeInOut(p) * r.len);
      d.setAttribute('cx', pt.x.toFixed(1)); d.setAttribute('cy', pt.y.toFixed(1));
      d.setAttribute('opacity', Math.min(p * 8, (1 - p) * 8, 1).toFixed(2));
    });
  });
  rise($('#quote'), t, 39.2, 40);
  const qi = prog(t, 39.35, 0.5), qo = prog(t, 39.6, 0.8);
  $('#qin').textContent = qi >= 1 ? '2.000000' : (2 * qi).toFixed(6);
  $('#qout').textContent = qo >= 1 ? '1.999763' : (1.999763 * easeOut(qo)).toFixed(6);
});

scene('nonear', 42, 48, (t, s) => {
  punch(s, t, 1.05);
  rise($('.kicker', s.el), t, 42.02, 12);
  $$('.no', s.el).forEach((n, i) => mask(n, t, 42.25 + i * 0.5, 1e9, 0.06));
  slide($('.sig', s.el), t, 42.6, 70);
  pop($('.sig-ok', s.el), t, 43.6, 0.45, 0.7);
  mask($('.cap', s.el), t, 44.15, 1e9, 0.05);
  const ov = $('#turnaround');
  ov.style.opacity = prog(t, 45.85, 0.25);
  const txt = $('.giant3', ov);
  mask(txt, t, 46.1, 47.95, 0.07);
  txt.style.transform = `scale(${1 + 0.05 * prog(t, 46.1, 1.9)})`;
});

chapter('ch2', 48);

const TERM = [
  ['$ ', 'p'], ['curl ', ''], ['https://api.infernear.dev/v1/chat/completions', 's'], [' \\\n', ''],
  ['    -H ', 'd'], ['"Authorization: Bearer $INFERNEAR_API_KEY"', 's'], [' \\\n', ''],
  ['    -d ', 'd'], [`'{"model": "Qwen/Qwen3.8-27B",`, 's'], ['\n', ''],
  [`        "messages": [{"role": "user", "content": "Hello"}]}'`, 's'], ['\n', ''],
];
const RESP = ['', '<span class="ok">HTTP/2 200</span>  <span class="d">x-infernear-billing: free</span>',
  '<span class="d">"content":</span> <span class="p">"Hello! How can I help?"</span>'];
let epW = 0;
scene('endpoint', 50, 56, (t, s) => {
  const ti = $('#eptitle');
  const kin = expoOut(prog(t, 50.0, 0.5)), mv = expoInOut(prog(t, 50.85, 0.6));
  const dx0 = (1920 - epW) / 2 - 140;
  ti.style.transform = `translate(${lerp(dx0, 0, mv).toFixed(1)}px, ${lerp(300, 0, mv).toFixed(1)}px) scale(${(lerp(1.12, 1, kin) * lerp(1, 0.42, mv)).toFixed(4)})`;
  ti.style.filter = kin < 0.95 ? `blur(${(1 - kin) * 10}px)` : 'none';
  ti.style.opacity = prog(t, 50.0, 0.12);
  const term = $('#term');
  const kt = expoOut(prog(t, 51.05, 0.55));
  term.style.opacity = prog(t, 51.05, 0.2);
  term.style.transform = `translateY(${(1 - kt) * 40}px) scale(${lerp(0.97, 1, kt)})`;
  const end = typedSegments($('#termtext'), TERM, t, 51.35, 92);
  if (t >= end + 0.2) $('#termtext').innerHTML += RESP.slice(0, 1 + Math.min(2, Math.floor((t - end - 0.2) / 0.18) + 1)).join('\n');
  $$('.tags .fr', s.el).forEach((f, i) => frame(f, t, 54.0 + i * 0.25, 40));
  mask($('.cap', s.el), t, 54.55, 1e9, 0.04);
});

scene('tee', 56, 62, (t, s) => {
  const ghost = $('#teeghost');
  ghost.style.opacity = prog(t, 56.1, 0.5) * (1 - prog(t, 61.6, 0.4));
  ghost.style.transform = `translateX(${-(t - 56) * 30}px)`;
  const left = $('.tee-left', s.el);
  left.style.opacity = 1 - prog(t, 61.6, 0.4);
  rise($('.kicker', left), t, 56.1, 12);
  const lines = $$('.tl', left);
  lines.forEach((l, i) => {
    const at = 56.35 + i * 1.0;
    mask(l, t, at, 1e9, 0.05);
    l.style.opacity = t < at + 1.0 || i === lines.length - 1 ? 1 : lerp(1, 0.32, prog(t, at + 1.0, 0.3));
  });
  const hb = $('#hexband');
  const n = 64, on = prog(t, 57.55, 0.4);
  let txt = '';
  for (let i = 0; i < n; i++) txt += (i % 5 === 4 ? ' ' : hexAt(i + Math.floor(t * 18), t));
  hb.textContent = txt.slice(0, Math.floor(n * on));
  hb.style.opacity = t < 57.55 ? 0 : 1 - 0.65 * prog(t, 58.4, 0.3);
}, 'dark');

scene('models', 62, 66, (t, s) => {
  punch(s, t, 1.05);
  const rows = $$('.mi', s.el);
  let shown = 0;
  rows.forEach((r, i) => { const at = 62.3 + i * 0.3; slide(r, t, at, 90, 0.5); if (t >= at) shown++; });
  const seven = $('#seven');
  seven.textContent = String(Math.max(1, shown));
  const last = 62.3 + (Math.max(1, shown) - 1) * 0.3;
  seven.style.transform = `scale(${1 + 0.06 * (1 - prog(t, last, 0.25))})`;
  seven.style.opacity = prog(t, 62.05, 0.15);
  rise($('.seven-l', s.el), t, 62.4, 16);
  show($('.mprice', s.el), prog(t, 64.5, 0.3));
}, 'light');

function proof(id, a, hud) {
  scene(id, a, a + 2, (t, s) => {
    const k = expoOut(prog(t, a, 0.45));
    s.el.style.transform = `${shake(t, a, 12, 0.25)} scale(${lerp(1.12, 1, k)})`;
    mask($('.pw', s.el), t, a + 0.02, 1e9, 0.06, 0.5);
    const ps = $('.ps', s.el);
    if (!ps._full) ps._full = ps.textContent;
    ps.textContent = ps._full.slice(0, Math.floor(clamp((t - a - 0.45) * 70, 0, ps._full.length)));
  }, hud);
}
proof('p1', 66, 'light');
proof('p2', 68, 'light');
proof('p3', 70, 'dark');

scene('finale', 72, 78.05, (t, s) => {
  const land = easeInOut(prog(t, 77.2, 0.8));
  const r = expoOut(prog(t, 72.3, 0.8)) * (1 - land);
  $$('.ob', s.el).forEach((ob, i) => {
    const a = (i / 8) * Math.PI * 2 + (t - 72) * 0.5;
    const depth = (Math.sin(a) + 1) / 2;
    const x = Math.cos(a) * 640 * r, y = Math.sin(a) * 170 * r;
    ob.style.transform = `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${lerp(0.62, 1.05, depth).toFixed(3)})`;
    ob.style.opacity = (prog(t, 72.3 + i * 0.05, 0.2) * lerp(0.35, 1, depth) * (1 - land)).toFixed(3);
    ob.style.zIndex = String(Math.round(depth * 10));
  });
  $$('.fw', s.el).forEach((w, i) => mask(w, t, 73.0 + i * 0.5, 77.3, 0.05));
  show($('.fin-sub', s.el), prog(t, 74.8, 0.4) * (1 - prog(t, 77.1, 0.3)));
}, 'dark');

scene('end', 78, DURATION + 1, (t, s) => {
  revealWordmark(lockup, t, 78.15, 48, 196, 0.95);
  mask($('.end-tag', s.el), t, 79.0, 1e9, 0.045);
  rise($('#endurl'), t, 79.6, 16);
  rise($('#endlinks'), t, 79.9, 12);
  rise($('#endfoot'), t, 80.4, 12);
  show($('#blackout'), prog(t, 82.6, 1.4));
});

// ---------- HUD ----------
function hud(t) {
  const sec = [...SECTIONS].reverse().find(([at]) => t >= at);
  const label = sec ? sec[1] : '';
  const since = t - (sec ? sec[0] : 0);
  let shown = '';
  for (let i = 0; i < label.length; i++) shown += i < since * 40 ? label[i] : (label[i] === ' ' ? ' ' : hexAt(i, t));
  $('#hsec').textContent = shown;
  const frames = Math.floor(t * 60);
  const ss = Math.floor(t) % 60, mm = Math.floor(t / 60), ff = frames % 60;
  $('#htc').textContent = `00:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}:${String(ff).padStart(2, '0')}`;
  const beat = Math.floor(t / 0.5) % 4;
  $$('#hbeats i').forEach((b, i) => b.classList.toggle('on', i === beat));
  $$('#hbars i').forEach((b, i) => b.classList.toggle('on', i <= Math.floor(t / 2)));
  const top = [...scenes].reverse().find(s => t >= s.a && t < s.b);
  $('#hud').style.setProperty('--hud', top && top.hud === 'light' ? '#141519' : '#f4f4f0');
  $('#hud').style.opacity = prog(t, 0.2, 1.2) * (1 - prog(t, 82.6, 1.0));
}

export function render(t) {
  for (const s of scenes) {
    const on = t >= s.a && t < s.b;
    s.el.classList.toggle('on', on);
    if (on) s.update(t, s);
  }
  const g = glState(t);
  if (g) gl.render(g); else gl.clear();
  hud(t);
}

// ---------- sound effects, from the picture ----------
export function soundEffects() {
  const fx = [];
  const add = (t, type, v) => fx.push({ t, type, v });
  for (const t of [12.0, 16.0, 20.0, 30.0, 36.0, 37.7, 41.7, 50.0, 50.85, 56.0, 62.0, 72.0, 77.3]) add(t, 'whoosh');
  for (let i = 0; i < 3; i++) add(5.6 + i * 0.5, 'pop', 0.8);
  for (let i = 0; i < 3; i++) add(7.5 + i * 0.25, 'tick');
  for (let i = 0; i < 8; i++) add(12.6 + i * 0.4, 'tick');
  add(13.3, 'stamp');
  for (let i = 0; i < 7; i++) add(BURST_AT + i * 0.07, 'pop', 0.6);
  for (let i = 0; i < 7; i++) add(18.45 + i * 0.05, 'tick');
  for (let i = 0; i < 5; i++) add(20.7 + i * 0.6, 'stamp', 0.6);
  for (let i = 0; i < 5; i++) add(30.85 + i * 0.22 + 0.55, 'pop', 0.7);
  add(32.1, 'chime');
  for (let i = 0; i < 4; i++) add(34.2 + i * 0.4, 'tick');
  for (let i = 0; i < 6; i++) add(38.2 + i * 0.07, 'tick');
  add(40.4, 'chime');
  add(43.6, 'chime');
  for (let k = 0; k < 2.0 * 92; k += 3) add(51.35 + k / 92, 'tick');
  add(53.6, 'chime');
  for (let i = 0; i < 3; i++) add(54.0 + i * 0.25, 'pop', 0.7);
  add(59.35, 'chime');
  for (let i = 0; i < 7; i++) add(62.3 + i * 0.3, 'tick');
  add(4.15, 'shimmer'); add(78.2, 'shimmer');
  return fx;
}

// ---------- setup ----------
function setup() {
  placeIcons();
  splitWords();
  heroWord = wordmarkSvg($('#heroword'));
  lockup = lockupSvg($('#lockup'));
  const pins = $('.chip .pins');
  for (let i = 0; i < 6; i++) {
    const p = 95 + i * 42;
    pins.insertAdjacentHTML('beforeend', `<line x1="${p}" y1="22" x2="${p}" y2="60"/><line x1="${p}" y1="340" x2="${p}" y2="378"/><line x1="22" y1="${p}" x2="60" y2="${p}"/><line x1="340" y1="${p}" x2="378" y2="${p}"/>`);
  }
  const gapLines = $('#gaplines');
  for (let i = 0; i < 7; i++) gapLines.insertAdjacentHTML('beforeend', '<line stroke="#686b73" stroke-width="3" stroke-dasharray="2 12" stroke-linecap="round"/><g><circle r="17" fill="#f2b705"/><path d="M-6 -6L6 6M6 -6L-6 6" stroke="#141519" stroke-width="3.2" stroke-linecap="round"/></g>');
  const sp = $('#sparks');
  for (let i = 0; i < 120; i++) sp.insertAdjacentHTML('beforeend', `<circle r="${(3 + hash(i * 9.1) * 5).toFixed(1)}" fill="#00ec97" opacity="0"/>`);
  sparks = $$('circle', sp);
  const yf = $('#yieldflow');
  for (let i = 0; i < 16; i++) yf.insertAdjacentHTML('beforeend', `<circle r="${(5 + hash(i * 2.3) * 4).toFixed(1)}" fill="#00ec97" opacity="0" style="filter: drop-shadow(0 0 8px rgba(0,236,151,0.8))"/>`);
  yieldDots = $$('circle', yf);
  const rs = $('#routes');
  for (const nd of $$('.nd')) {
    const y = Number(nd.dataset.y);
    nd.style.top = `${y}px`;
    const x0 = 480, x1 = 1462, y1 = 600;
    rs.insertAdjacentHTML('beforeend', `<path d="M${x0} ${y} C ${x0 + 430} ${y}, ${x1 - 430} ${y1}, ${x1} ${y1}" fill="none" stroke="rgba(244,244,240,0.28)" stroke-width="2.5"/>`);
  }
  routes = $$('path', rs).map(path => {
    const len = path.getTotalLength();
    path.style.strokeDasharray = `${len}`;
    const dots = [0, 1, 2].map(() => { rs.insertAdjacentHTML('beforeend', '<circle r="7" fill="#00ec97" opacity="0" style="filter: drop-shadow(0 0 6px rgba(0,236,151,0.9))"/>'); return rs.lastElementChild; });
    return { path, len, dots };
  });
  $('#hbars').innerHTML = '<i></i>'.repeat(42);
}

// ---------- player ----------
const params = new URLSearchParams(location.search);
const capture = params.has('capture');
document.documentElement.classList.toggle('capture', capture);
function fit() {
  const k = Math.min(innerWidth / 1920, innerHeight / 1080);
  stage.style.transform = `translate(-50%, -50%) scale(${k})`;
}

setup();
fit();
await document.fonts.ready;
await Promise.all(['800 120px "Hanken Grotesk Variable"', '400 20px "Martian Mono Variable"'].map(f => document.fonts.load(f)));
epW = $('#eptitle').offsetWidth;

let t = Number(params.get('t') ?? 0);
render(t);
window.__duration = DURATION;
window.__seek = time => { t = time; render(time); };
// The soundtrack as WAV bytes, base64 in chunks (render.mjs muxes it with the frames).
let wav = null;
window.__soundtrack = async () => { wav = wavBytes(await renderSoundtrack(DURATION, soundEffects())); return Math.ceil(wav.length / 2_000_000); };
window.__soundtrackChunk = i => {
  const part = wav.subarray(i * 2_000_000, (i + 1) * 2_000_000);
  let s = '';
  for (let k = 0; k < part.length; k += 0x8000) s += String.fromCharCode.apply(null, part.subarray(k, k + 0x8000));
  return btoa(s);
};
window.__ready = true;

if (!capture) {
  let playing = false, idle = 0, last = performance.now();
  let ctx = null, buffer = null, source = null, startedAt = 0, offset = t;
  const player = $('#player'), btn = $('#playbtn');
  const stopAudio = () => { if (source) { source.stop(); source = null; } };
  const startAudio = () => {
    stopAudio();
    if (!ctx || !buffer) return;
    source = ctx.createBufferSource(); source.buffer = buffer; source.connect(ctx.destination);
    source.start(0, t); startedAt = ctx.currentTime; offset = t;
  };
  const play = async () => {
    if (!ctx) {
      btn.textContent = 'Rendering sound…';
      ctx = new AudioContext();
      buffer = await renderSoundtrack(DURATION, soundEffects(), ctx.sampleRate);
    }
    if (t >= DURATION) t = 0;
    playing = true; btn.textContent = '❚❚ Pause'; startAudio();
  };
  const pause = () => { playing = false; btn.textContent = '▶ Play with sound'; stopAudio(); };
  btn.addEventListener('click', () => (playing ? pause() : play()));
  const loop = now => {
    const dt = (now - last) / 1000; last = now;
    if (playing) {
      t = source ? offset + (ctx.currentTime - startedAt) : t + dt;
      if (t >= DURATION) { t = DURATION; pause(); }
    }
    render(t);
    $('#pbar i').style.width = `${(t / DURATION) * 100}%`;
    $('#ptime').textContent = `${t.toFixed(1)}s / ${DURATION}s`;
    idle += dt; player.classList.toggle('show', !playing || idle < 1.5);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  addEventListener('resize', fit);
  addEventListener('mousemove', () => { idle = 0; });
  const seek = to => { t = clamp(to, 0, DURATION); if (playing) startAudio(); render(t); };
  addEventListener('keydown', e => {
    if (e.code === 'Space') { e.preventDefault(); playing ? pause() : play(); }
    if (e.code === 'ArrowRight') seek(t + 2);
    if (e.code === 'ArrowLeft') seek(t - 2);
    if (e.code === 'Home') seek(0);
  });
  $('#pbar').addEventListener('click', e => { const r = e.currentTarget.getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * DURATION); });
}
