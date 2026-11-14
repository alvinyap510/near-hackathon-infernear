// InferNear film: a 79-second motion piece drawn with HTML, CSS and SVG.
// Every frame is a pure function of time: render(t) sets every animated property from t alone,
// so the page can be played in a browser or stepped frame by frame by render.mjs.
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
import aave from '@web3icons/core/svgs/tokens/branded/AAVE.svg.js';

export const DURATION = 79;

// ---------- small maths ----------
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const prog = (t, a, d) => clamp((t - a) / d);
const lerp = (a, b, k) => a + (b - a) * k;
const easeIn = x => x * x * x;
const easeOut = x => 1 - Math.pow(1 - x, 3);
const easeInOut = x => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const expoOut = x => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
const backOut = x => 1 + 2.70158 * Math.pow(x - 1, 3) + 1.70158 * Math.pow(x - 1, 2);
const money = (n, d = 2) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const stage = $('#stage');

// ---------- marks ----------
const ICONS = { base, near: nearMono.replace('fill="#fff"', 'fill="currentColor"'), ethereum, arbitrum, solana, bnb, robinhood, sui, usdc, aave };
const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const LOCK = '<svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2.2" fill="currentColor"/><path d="M8.2 10.5V8a3.8 3.8 0 0 1 7.6 0v2.5" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>';
const CHIP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5" rx="1" fill="currentColor" stroke="none"/><path d="M9 3v3M12 3v3M15 3v3M9 18v3M12 18v3M15 18v3M3 9h3M3 12h3M3 15h3M18 9h3M18 12h3M18 15h3"/></svg>';
const LB = 'M4 5.5A1.5 1.5 0 0 1 5.5 4H12v4H8v16h4v4H5.5A1.5 1.5 0 0 1 4 26.5z';
const RB = 'M20 4h6.5A1.5 1.5 0 0 1 28 5.5v21a1.5 1.5 0 0 1-1.5 1.5H20v-4h4V8h-4z';
const WORDMARK = logoRaw.match(/<\/g><path d="([^"]+)"/)[1];

let uid = 0;
function placeIcons() {
  for (const el of $$('[data-icon]')) {
    const n = ++uid;
    el.innerHTML = ICONS[el.dataset.icon]
      .replace(/\s(width|height)="24"/g, '')
      .replace(/id="([^"]+)"/g, `id="$1-${n}"`)
      .replace(/url\(#([^)]+)\)/g, `url(#$1-${n})`);
  }
  for (const el of $$('.ck')) el.innerHTML = CHECK;
  for (const el of $$('.lock')) el.innerHTML = LOCK;
}

function buildLogo(host) {
  const n = ++uid;
  host.innerHTML = `<svg viewBox="0 0 242.6 40"><defs><clipPath id="wm${n}"><rect x="48" y="-10" width="0" height="60"/></clipPath></defs>
    <g transform="scale(1.66667) translate(-4 -4)"><path fill="currentColor" d="${LB}"/><path fill="currentColor" d="${RB}"/><rect x="12" y="12" width="8" height="8" rx="1" fill="#00ec97"/></g>
    <g clip-path="url(#wm${n})"><path fill="currentColor" d="${WORDMARK}"/></g></svg>`;
  const [lb, rb] = $$('path', host);
  return { host, lb, rb, sq: $('rect[fill]', host), clip: $('clipPath rect', host), wm: $$('path', host)[2] };
}
function animateLogo(L, t, a) {
  const kb = expoOut(prog(t, a, 0.8));
  L.lb.setAttribute('transform', `translate(${-(1 - kb) * 16} 0)`);
  L.rb.setAttribute('transform', `translate(${(1 - kb) * 16} 0)`);
  L.lb.style.opacity = L.rb.style.opacity = prog(t, a, 0.25);
  const ks = backOut(prog(t, a + 0.3, 0.55));
  L.sq.setAttribute('transform', `translate(16 16) scale(${Math.max(ks, 0)}) translate(-16 -16)`);
  const kw = expoOut(prog(t, a + 0.6, 1.0));
  L.clip.setAttribute('width', String(kw * 200));
  L.wm.setAttribute('transform', `translate(${(1 - kw) * -14} 0)`);
}

// ---------- words ----------
function splitWords() {
  for (const el of $$('[data-words]')) {
    const words = el.textContent.trim().split(/\s+/);
    el.innerHTML = words.map(w => {
      if (w === '|') return '<br>';
      const acc = /^\*.*\*[.,]?$/.test(w);
      const text = w.replace(/\*/g, '');
      return `<span class="w${acc ? ' acc' : ''}">${text}</span>`;
    }).join(' ');
    el._w = $$('.w', el);
  }
}
// Words rise in one after another, and leave together.
function words(el, t, a, b, stagger = 0.05) {
  const out = easeIn(prog(t, b - 0.32, 0.32));
  el._w.forEach((w, i) => {
    const k = expoOut(prog(t, a + i * stagger, 0.7));
    w.style.opacity = Math.min(prog(t, a + i * stagger, 0.25), 1) * (1 - out);
    w.style.transform = `translate3d(0, ${(1 - k) * 0.55 - out * 0.25}em, 0)`;
    const blur = (1 - k) * 10 + out * 6;
    w.style.filter = blur > 0.3 ? `blur(${blur.toFixed(2)}px)` : 'none';
  });
}
function caption(scene, t, l1, l2) {
  const [a, b] = [scene.a, scene.b];
  const c1 = $('.cap .l1', scene.el), c2 = $('.cap .l2', scene.el);
  if (c1) words(c1, t, l1, b - 0.05);
  if (c2) words(c2, t, l2, b - 0.05, 0.04);
  return a;
}

// ---------- motion blur ----------
// Each moving block gets its own horizontal Gaussian blur, scaled by its speed.
function blurFilter(el, vertical = false) {
  const n = ++uid;
  $('#filters').insertAdjacentHTML('beforeend', `<filter id="mb${n}" x="-25%" y="-25%" width="150%" height="150%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="0 0"/></filter>`);
  el._blur = { id: `mb${n}`, node: $(`#mb${n} feGaussianBlur`), vertical };
}
function setBlur(el, amount) {
  if (!el._blur) blurFilter(el);
  if (amount < 0.4) { el.style.filter = 'none'; return; }
  el._blur.node.setAttribute('stdDeviation', el._blur.vertical ? `0 ${amount.toFixed(2)}` : `${amount.toFixed(2)} 0`);
  el.style.filter = `url(#${el._blur.id})`;
}
// Enter from the right at a, leave to the left at b: the whip cut between scenes.
function whip(el, t, a, b, { dist = 380, inDur = 0.65, outDur = 0.36, blur = 30 } = {}) {
  const ki = expoOut(prog(t, a, inDur));
  const ko = easeIn(prog(t, b - outDur, outDur));
  el.style.transform = `translate3d(${(dist * (1 - ki) - dist * 1.2 * ko).toFixed(2)}px, 0, 0)`;
  el.style.opacity = prog(t, a, 0.16) * (1 - prog(t, b - 0.12, 0.12));
  setBlur(el, blur * Math.max(1 - ki, ko));
}
// Each scene's content is drawn at a readable size (data-scale) and drifts slowly closer.
function drift(scene, t, amount = 0.018) {
  const m = $('.main', scene.el);
  if (m) m.style.transform = `scale(${Number(m.dataset.scale ?? 1) * (1 + amount * prog(t, scene.a, scene.b - scene.a))})`;
}
function pop(el, t, a, d = 0.5, from = 0.6) {
  const k = backOut(prog(t, a, d));
  el.style.opacity = prog(t, a, 0.15);
  el.style.transform = `scale(${lerp(from, 1, k)})`;
}
function slideIn(el, t, a, dy = 24, d = 0.6) {
  const k = expoOut(prog(t, a, d));
  el.style.opacity = prog(t, a, 0.22);
  el.style.transform = `translate3d(0, ${(1 - k) * dy}px, 0)`;
}
// Deterministic typing with a blinking caret while the text is being edited.
function typed(el, text, t, a, cps, caretUntil = a + text.length / cps + 0.6) {
  const n = Math.floor(clamp((t - a) * cps, 0, text.length));
  el.textContent = text.slice(0, n);
  el.classList.toggle('caret', t >= a - 0.5 && t < caretUntil && (n < text.length || Math.floor(t * 2.4) % 2 === 0));
}
// Delete back to the shared prefix, then type the new text.
function retype(el, from, to, t, a, del = 34, cps = 22) {
  let p = 0;
  while (p < from.length && p < to.length && from[p] === to[p]) p++;
  const dDur = (from.length - p) / del;
  if (t < a + dDur) el.textContent = from.slice(0, from.length - Math.floor(clamp((t - a) * del, 0, from.length - p)));
  else el.textContent = to.slice(0, p + Math.floor(clamp((t - a - dDur) * cps, 0, to.length - p)));
  const end = a + dDur + (to.length - p) / cps;
  el.classList.toggle('caret', t >= a - 0.4 && t < end + 0.5 && (t < end || Math.floor(t * 2.4) % 2 === 0));
  return end;
}
// Panels wipe in from one side and leave toward another, with clip-path insets.
const OPP = { right: 'left', left: 'right', top: 'bottom', bottom: 'top' };
function wipe(el, t, a, b, from = 'right', to = 'left', d = 0.38) {
  const ki = expoOut(prog(t, a, d)), ko = easeIn(prog(t, b - d, d));
  const inset = { top: 0, right: 0, bottom: 0, left: 0 };
  inset[OPP[from]] = (1 - ki) * 100;
  inset[OPP[to]] = Math.max(inset[OPP[to]], ko * 100);
  el.style.clipPath = `inset(${inset.top}% ${inset.right}% ${inset.bottom}% ${inset.left}%)`;
}

// ---------- cursor ----------
let cursorKeys = [];
let clicks = [];
function cursor(t) {
  const c = $('#cursor'), r = $('#ripple');
  let x = 0, y = 0, o = 0;
  for (let i = 0; i < cursorKeys.length - 1; i++) {
    const A = cursorKeys[i], B = cursorKeys[i + 1];
    if (t >= A.t && t < B.t) {
      const k = easeInOut((t - A.t) / (B.t - A.t));
      x = lerp(A.x, B.x, k); y = lerp(A.y, B.y, k); o = lerp(A.o, B.o, (t - A.t) / (B.t - A.t));
    }
  }
  let press = 0, rp = null;
  for (const k of clicks) {
    if (t >= k.t - 0.08 && t < k.t + 0.14) press = Math.sin(clamp((t - k.t + 0.08) / 0.22) * Math.PI);
    if (t >= k.t && t < k.t + 0.5) rp = { k, p: (t - k.t) / 0.5 };
  }
  c.style.opacity = o;
  c.style.transform = `translate3d(${x - 9}px, ${y - 6}px, 0) scale(${1 - 0.14 * press})`;
  if (rp) {
    r.style.opacity = (1 - rp.p) * 0.55;
    r.style.transform = `translate3d(${rp.k.x}px, ${rp.k.y}px, 0) scale(${0.3 + easeOut(rp.p) * 0.9})`;
  } else r.style.opacity = 0;
}
function pt(el, fx = 0.5, fy = 0.5) {
  const s = stage.getBoundingClientRect(), r = el.getBoundingClientRect(), k = s.width / 1920;
  return { x: (r.left - s.left + r.width * fx) / k, y: (r.top - s.top + r.height * fy) / k };
}

// ---------- scenes ----------
const scenes = [];
const scene = (id, a, b, update, z = 0) => scenes.push({ id, a, b, el: $(`#s-${id}`), update, z });

scene('exists', 0, 6.4, (t, s) => {
  const card = $('.cloud', s.el);
  const k = expoOut(prog(t, 0.15, 0.9));
  const ko = easeIn(prog(t, s.b - 0.36, 0.36));
  card.style.opacity = prog(t, 0.15, 0.4) * (1 - prog(t, s.b - 0.12, 0.12));
  card.style.transform = `translate3d(${-460 * ko}px, ${(1 - k) * 60}px, 0) scale(${lerp(0.94, 1, k)})`;
  setBlur(card, 30 * ko);
  $$('.row', card).forEach((row, i) => {
    slideIn(row, t, 0.75 + i * 0.2, 22);
    pop($('.tee', row), t, 1.05 + i * 0.2, 0.45, 0.5);
  });
  drift(s, t);
  caption(s, t, 1.2, 3.0);
});

scene('elsewhere', 6.3, 12.8, (t, s) => {
  whip($('.flow', s.el), t, s.a, s.b);
  const icons = $$('.stack .ic', s.el);
  icons.forEach((ic, i) => {
    const k = backOut(prog(t, 6.75 + (icons.length - 1 - i) * 0.08, 0.5));
    ic.style.transform = `translate3d(0, ${(1 - k) * 18}px, 0)`;
    ic.style.opacity = prog(t, 6.75 + (icons.length - 1 - i) * 0.08, 0.15);
  });
  pop($('.hub .disc', s.el), t, 6.7, 0.55, 0.5);
  const [ha, hb] = $$('.broken .half', s.el);
  const draw = expoOut(prog(t, 7.0, 0.6));
  const brk = expoOut(prog(t, 9.1, 0.5));
  ha.style.transform = `scaleX(${draw * lerp(1, 0.7, brk)})`;
  hb.style.transform = `scaleX(${draw * lerp(1, 0.7, brk)})`;
  hb.style.opacity = prog(t, 7.25, 0.2);
  pop($('.broken .x', s.el), t, 9.2, 0.5, 0.2);
  $$('.link .fill', s.el)[0].style.transform = `scaleX(${expoOut(prog(t, 7.3, 0.6))})`;
  drift(s, t);
  caption(s, t, 6.85, 9.25);
});

const BILLS = [64.2, 48.75, 91.1, 57.3];
scene('capital', 12.7, 18.2, (t, s) => {
  whip($('.balance', s.el), t, s.a, s.b);
  let spent = 0;
  $$('.bill', s.el).forEach((bill, i) => {
    const at = 13.7 + i * 0.6;
    slideIn(bill, t, at, -18, 0.5);
    spent += BILLS[i] * easeOut(prog(t, at + 0.1, 0.45));
  });
  $('#bal').textContent = money(1000 - spent);
  $('#baldelta').textContent = '−' + money(spent);
  $('#baldelta').style.opacity = prog(t, 13.8, 0.3);
  $('#balbar').style.transform = `scaleX(${(1000 - spent) / 1000})`;
  drift(s, t);
  caption(s, t, 13.15, 99);
});

scene('slam', 18.1, 21.7, (t, s) => {
  const p1 = $('#slam1'), p2 = $('#slam2');
  wipe(p1, t, 18.1, 99, 'right', 'left', 0.42);
  const k1 = expoOut(prog(t, 18.3, 0.6));
  $('.slam', p1).style.transform = `scale(${lerp(0.94, 1, k1)})`;
  words($('.slam', p1), t, 18.28, 99, 0.06);
  wipe(p2, t, 19.75, 99, 'bottom', 'top', 0.42);
  const k2 = expoOut(prog(t, 19.95, 0.6));
  $('.slam', p2).style.transform = `scale(${lerp(0.94, 1, k2)})`;
  words($('.slam', p2), t, 19.95, 99, 0.07);
  // Leave upwards, uncovering the logo underneath.
  const ko = easeIn(prog(t, 21.3, 0.4));
  s.el.style.transform = `translate3d(0, ${-ko * 1080}px, 0)`;
}, 10);

let logo1, logo2;
scene('logo', 21.3, 25.9, (t, s) => {
  animateLogo(logo1, t, 21.55);
  const ko = easeIn(prog(t, 25.5, 0.4));
  const k = expoOut(prog(t, 21.4, 1.4));
  logo1.host.style.transform = `scale(${lerp(0.96, 1, k) * (1 + ko * 0.3)})`;
  logo1.host.style.opacity = 1 - ko;
  logo1.host.style.filter = ko > 0.02 ? `blur(${ko * 14}px)` : 'none';
  const tag = $('.tagline', s.el);
  words(tag, t, 22.85, 25.75, 0.06);
});

function chapter(id, a, b) {
  scene(id, a, b, (t, s) => {
    whip($('.ch', s.el), t, a, b, { dist: 300 });
    pop($('.ch-num', s.el), t, a + 0.15, 0.5, 0.4);
    words($('h1', s.el), t, a + 0.25, 99, 0.06);
    words($('p', s.el), t, a + 0.95, 99, 0.03);
  });
}
chapter('ch1', 25.7, 28.4);

scene('deposit', 28.3, 33.8, (t, s) => {
  whip($('.deposit', s.el), t, s.a, s.b);
  typed($('#amt'), '1,000.00', t, 29.1, 10, 30.6);
  const btn = $('#depbtn');
  const press = Math.sin(clamp((t - 30.8) / 0.22) * Math.PI);
  btn.style.transform = `scale(${1 - 0.05 * press})`;
  $('#deplabel').innerHTML = t < 30.9 ? 'Deposit' : t < 31.5 ? 'Depositing…' : `Deposited <i class="ck" style="width:26px;height:26px;vertical-align:-4px">${CHECK}</i>`;
  pop($('.kv .lock', s.el), t, 31.55, 0.5, 0.3);
  drift(s, t);
  caption(s, t, 28.7, 31.4);
});

scene('yield', 33.7, 40.2, (t, s) => {
  whip($('.flowcol', s.el), t, s.a, s.b);
  const [l1, l2] = [$('#yl1'), $('#yl2')];
  $('.fill', l1).style.transform = `scaleX(${expoOut(prog(t, 34.2, 0.6))})`;
  $('.fill', l2).style.transform = `scaleX(${expoOut(prog(t, 35.6, 0.6))})`;
  dots(l1, t, 34.4, 39.8, 0.55, 0.85);
  dots(l2, t, 35.8, 39.8, 0.55, 0.85);
  pop($('.hub .disc', s.el), t, 34.0, 0.55, 0.6);
  const steps = $$('.step i', s.el);
  const marks = [[34.4, 35.5], [35.9, 37.1], [37.5, 37.9]];
  steps.forEach((dot, i) => {
    const [now, done] = marks[i];
    dot.classList.toggle('now', t >= now && t < done);
    dot.classList.toggle('on', t >= done);
  });
  $$('.step .bar2', s.el).forEach((bar, i) => { bar.style.transform = `scaleX(${expoOut(prog(t, marks[i][1], 0.45))})`; });
  const c = easeOut(prog(t, 36.6, 2.4));
  $('#credits').textContent = money(1.274 * c, 3);
  drift(s, t);
  caption(s, t, 34.1, 36.5);
}, 0);
// Mint dots travel along a link: a new one every `every` seconds, each taking `dur`.
function dots(link, t, a, b, every, dur) {
  if (!link._dots) {
    link._dots = Array.from({ length: 4 }, () => { const d = document.createElement('i'); d.className = 'dot'; link.append(d); return d; });
  }
  link._dots.forEach((d, i) => {
    let shown = false;
    for (let n = i; ; n += 4) {
      const start = a + n * every;
      if (start > t || start > b) break;
      const p = (t - start) / dur;
      if (p >= 0 && p <= 1) {
        d.style.left = `${easeInOut(p) * 100}%`;
        d.style.opacity = Math.min(p * 6, (1 - p) * 6, 1);
        shown = true;
      }
    }
    if (!shown) d.style.opacity = 0;
  });
}

scene('signin', 40.1, 45.0, (t, s) => {
  whip($('.signin', s.el), t, s.a, s.b);
  const btn = $('#connect');
  const press = Math.sin(clamp((t - 41.25) / 0.22) * Math.PI);
  btn.style.transform = `scale(${1 - 0.04 * press})`;
  const ko = expoOut(prog(t, 41.4, 0.45)), ki = expoOut(prog(t, 41.55, 0.6));
  const idle = $('.c-idle', btn), done = $('.c-done', btn);
  idle.style.opacity = 1 - ko; idle.style.transform = `translate3d(0, ${-ko * 30}px, 0)`;
  done.style.opacity = ki; done.style.transform = `translate3d(0, ${(1 - ki) * 30}px, 0)`;
  $$('.no', s.el).forEach((no, i) => {
    const at = 42.15 + i * 0.22;
    const k = backOut(prog(t, at, 0.55));
    no.style.opacity = prog(t, at, 0.15);
    no.style.transform = `translate3d(0, ${(1 - k) * 26}px, 0) scale(${lerp(0.85, 1, k)})`;
  });
  drift(s, t);
  caption(s, t, 40.5, 42.8);
});

chapter('ch2', 44.9, 47.6);

scene('code', 47.5, 53.0, (t, s) => {
  whip($('.code', s.el), t, s.a, s.b);
  const e1 = retype($('#url'), 'https://api.openai.com/v1', 'https://api.infernear.dev/v1', t, 48.3);
  const e2 = retype($('#key'), 'OPENAI_API_KEY', 'INFERNEAR_API_KEY', t, e1 + 0.45);
  $('#hl1').classList.toggle('on', t >= e1);
  $('#hl2').classList.toggle('on', t >= e2);
  pop($('#tag1'), t, e1, 0.45, 0.5);
  pop($('#tag2'), t, e2, 0.45, 0.5);
  drift(s, t, 0.012);
  caption(s, t, 47.9, 49.7);
});

scene('models', 52.9, 58.4, (t, s) => {
  whip($('.pair', s.el), t, s.a, s.b);
  $$('.mrow', s.el).forEach((row, i) => slideIn(row, t, 53.2 + i * 0.07, 16, 0.5));
  $('#pick').classList.toggle('sel', t >= 54.55);
  const reply = $('.reply', s.el);
  for (const el of [$('.r-head', reply), $('.r-model', reply)]) el.style.opacity = prog(t, 54.7, 0.25);
  typed($('#rtext'), 'Hello! How can I help you today?', t, 54.9, 30, 56.6);
  pop($('#sig'), t, 56.1, 0.5, 0.7);
  $('#iid').style.opacity = prog(t, 56.35, 0.3);
  drift(s, t, 0.012);
  caption(s, t, 53.3, 56.2);
});

const CIPHER = '9f2c e81a 04d7 b3c6 51ae 7d90 c2f4 0be8 a613';
scene('private', 58.3, 63.8, (t, s) => {
  whip($('.priv', s.el), t, s.a, s.b);
  $('.fill', $('#pl1')).style.transform = `scaleX(${expoOut(prog(t, 58.7, 0.5))})`;
  $('.fill', $('#pl2')).style.transform = `scaleX(${expoOut(prog(t, 58.85, 0.5))})`;
  packet($('#pk1'), t, [{ a: 59.4, d: 0.7, label: 'encrypted' }, { a: 62.35, d: 0.6, back: true, label: 'signed' }]);
  typed($('#cipher'), CIPHER, t, 60.05, 60, 60.0);
  packet($('#pk2'), t, [{ a: 60.55, d: 0.7, label: 'encrypted' }, { a: 61.75, d: 0.6, back: true, label: 'signed' }]);
  const glow = Math.sin(clamp((t - 61.25) / 0.6) * Math.PI);
  const core = $('#core');
  core.style.transform = `scale(${1 + 0.12 * glow})`;
  core.style.boxShadow = `0 0 0 ${glow * 18}px rgba(0, 236, 151, ${0.28 * glow})`;
  drift(s, t, 0.012);
  caption(s, t, 58.7, 60.6);
});
// A labelled pill crossing a link, once per trip.
function packet(el, t, trips) {
  for (const trip of trips) {
    const p = (t - trip.a) / trip.d;
    if (p < 0 || p > 1) continue;
    el.textContent = trip.label;
    const k = easeInOut(p);
    el.style.left = `${lerp(18, 82, trip.back ? 1 - k : k)}%`;
    el.style.opacity = Math.min(p * 8, (1 - p) * 8, 1);
    return;
  }
  el.style.opacity = 0;
}

scene('proof', 63.6, 68.0, (t, s) => {
  const panel = $('#proofpanel');
  wipe(panel, t, 63.6, 68.0, 'right', 'left', 0.42);
  words($('.ph', s.el), t, 63.85, 99, 0.07);
  $$('.pl', s.el).forEach((line, i) => words(line, t, 64.6 + i * 0.5, 99, 0.04));
}, 10);

scene('vision', 67.7, 73.5, (t, s) => {
  const center = $('.center', s.el);
  pop(center, t, 67.8, 0.6, 0.5);
  const sats = $$('.sat', s.el);
  sats.forEach((sat, i) => {
    const k = backOut(prog(t, 68.0 + i * 0.09, 0.55));
    sat.style.opacity = prog(t, 68.0 + i * 0.09, 0.2);
    sat.style.transform = `translate(-50%, -50%) scale(${lerp(0.5, 1, k)})`;
    const ray = sat._ray;
    const kr = expoOut(prog(t, 68.25 + i * 0.09, 0.7));
    ray.setAttribute('x2', lerp(ray._x1, ray._x2, kr));
    ray.setAttribute('y2', lerp(ray._y1, ray._y2, kr));
    ray.style.opacity = prog(t, 68.25 + i * 0.09, 0.2);
  });
  // Value flows only on the live route.
  const live = sats[0]._ray;
  $$('.vdot', s.el).forEach((d, i) => {
    let o = 0;
    for (let n = i; n < 40; n += 3) {
      const p = (t - (68.9 + n * 0.5)) / 1.1;
      if (p >= 0 && p <= 1) {
        const k = easeInOut(p);
        d.setAttribute('cx', lerp(live._x1, live._x2, k));
        d.setAttribute('cy', lerp(live._y1, live._y2, k));
        o = Math.min(p * 6, (1 - p) * 6, 1);
      }
    }
    d.style.opacity = o;
  });
  caption(s, t, 68.4, 70.3);
}, 0);

scene('end', 73.2, DURATION + 1, (t, s) => {
  wipe(s.el, t, 73.2, 999, 'bottom', 'top', 0.45);
  animateLogo(logo2, t, 73.55);
  words($('.end-tag', s.el), t, 74.6, 999, 0.05);
  slideIn($('#endurl'), t, 75.3, 16);
  slideIn($('#endfoot'), t, 75.7, 12);
}, 20);

// ---------- vision layout ----------
function layoutOrbit() {
  const cx = 960, cy = 405, rx = 640, ry = 250;
  const rays = $('#rays');
  for (const sat of $$('.sat')) {
    const a = (Number(sat.dataset.a) * Math.PI) / 180;
    const x = Math.cos(a) * rx, y = Math.sin(a) * ry;
    sat.style.left = `${x}px`; sat.style.top = `${y}px`;
    sat.classList.toggle('up', y < -40);
    // From the icon's edge to the centre disc's edge.
    const len = Math.hypot(x, y), ux = x / len, uy = y / len;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line._x1 = cx + x - ux * 70; line._y1 = cy + y - uy * 70;
    line._x2 = cx + ux * 140; line._y2 = cy + uy * 140;
    line.setAttribute('x1', line._x1); line.setAttribute('y1', line._y1);
    const live = sat.classList.contains('live');
    line.setAttribute('stroke', live ? '#141519' : '#b9b09d');
    line.setAttribute('stroke-width', live ? '3' : '2.5');
    if (!live) line.setAttribute('stroke-dasharray', '4 10');
    line.setAttribute('stroke-linecap', 'round');
    rays.append(line);
    sat._ray = line;
  }
  for (let i = 0; i < 3; i++) rays.insertAdjacentHTML('beforeend', '<circle class="vdot" r="8" fill="#00ec97" stroke="rgba(0,236,151,0.3)" stroke-width="8" opacity="0"/>');
}

// ---------- setup ----------
function setup() {
  placeIcons();
  splitWords();
  logo1 = buildLogo($('#logo1'));
  logo2 = buildLogo($('#logo2'));
  $('#markc').innerHTML = `<svg viewBox="4 4 24 24"><path fill="currentColor" d="${LB}"/><path fill="currentColor" d="${RB}"/><rect x="12" y="12" width="8" height="8" rx="1" fill="#00ec97"/></svg>`;
  for (const step of $$('.step + .step')) step.insertAdjacentHTML('afterbegin', '<b class="bar2"></b>');
  for (const el of $$('[data-whip]')) blurFilter(el);
  for (const m of $$('.main[data-scale]')) m.style.transform = `scale(${m.dataset.scale})`;
  for (const el of $$('.chip-ic')) el.innerHTML = CHIP;
  layoutOrbit();
}
function measure() {
  // Code tags sit on their highlighted lines.
  for (const [tag, hl] of [['#tag1', '#hl1'], ['#tag2', '#hl2']]) {
    const h = $(hl), code = $('.code');
    $(tag).style.top = `${h.offsetTop + (h.offsetHeight - 30) / 2}px`;
    void code;
  }
  const dep = pt($('#depbtn')), con = pt($('#connect')), pick = pt($('#pick'), 0.35, 0.5);
  cursorKeys = [
    { t: 29.9, x: dep.x + 260, y: dep.y + 200, o: 0 },
    { t: 30.15, x: dep.x + 210, y: dep.y + 160, o: 1 },
    { t: 30.75, x: dep.x + 12, y: dep.y + 10, o: 1 },
    { t: 31.9, x: dep.x + 12, y: dep.y + 10, o: 1 },
    { t: 32.25, x: dep.x + 80, y: dep.y + 90, o: 0 },
    { t: 40.55, x: con.x + 300, y: con.y + 230, o: 0 },
    { t: 40.8, x: con.x + 250, y: con.y + 190, o: 1 },
    { t: 41.2, x: con.x + 40, y: con.y + 16, o: 1 },
    { t: 42.0, x: con.x + 40, y: con.y + 16, o: 1 },
    { t: 42.3, x: con.x + 120, y: con.y + 80, o: 0 },
    { t: 53.75, x: pick.x + 380, y: pick.y + 240, o: 0 },
    { t: 54.0, x: pick.x + 320, y: pick.y + 190, o: 1 },
    { t: 54.45, x: pick.x, y: pick.y + 4, o: 1 },
    { t: 55.3, x: pick.x, y: pick.y + 4, o: 1 },
    { t: 55.6, x: pick.x + 70, y: pick.y + 80, o: 0 },
  ];
  clicks = [
    { t: 30.85, x: dep.x + 12, y: dep.y + 10 },
    { t: 41.3, x: con.x + 40, y: con.y + 16 },
    { t: 54.55, x: pick.x, y: pick.y + 4 },
  ];
}

export function render(t) {
  for (const s of scenes) {
    const on = t >= s.a && t < s.b;
    s.el.classList.toggle('on', on);
    s.el.style.zIndex = s.z;
    if (on) s.update(t, s);
  }
  cursor(t);
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
await Promise.all(['600 56px "Hanken Grotesk Variable"', '400 20px "Martian Mono Variable"'].map(f => document.fonts.load(f)));
measure();

let t = Number(params.get('t') ?? 0);
render(t);
window.__duration = DURATION;
window.__seek = time => { t = time; render(time); };
window.__ready = true;

if (!capture) {
  let playing = true, last = performance.now(), idle = 0;
  const hud = $('#hud');
  const loop = now => {
    const dt = (now - last) / 1000; last = now;
    if (playing) { t = Math.min(t + dt, DURATION); if (t >= DURATION) playing = false; render(t); }
    $('#hudbar i').style.width = `${(t / DURATION) * 100}%`;
    $('#hudtime').textContent = `${t.toFixed(1)}s / ${DURATION}s`;
    idle += dt; hud.classList.toggle('show', !playing || idle < 1.5);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  addEventListener('resize', () => { fit(); });
  addEventListener('mousemove', () => { idle = 0; });
  addEventListener('keydown', e => {
    if (e.code === 'Space') { e.preventDefault(); if (t >= DURATION) t = 0; playing = !playing; }
    if (e.code === 'ArrowRight') t = Math.min(t + 3, DURATION);
    if (e.code === 'ArrowLeft') t = Math.max(t - 3, 0);
    if (e.code === 'Home') t = 0;
    render(t); idle = 0;
  });
  $('#hudbar').addEventListener('click', e => { const r = e.currentTarget.getBoundingClientRect(); t = ((e.clientX - r.left) / r.width) * DURATION; render(t); });
}
