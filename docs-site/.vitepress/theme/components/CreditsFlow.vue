<script setup lang="ts">
import { ref } from 'vue';
import { kt, useStill, windowed } from './still';

/**
 * Where credits come from and how a call spends them, in a twelve-second loop: vault yield and a
 * purchase are posted (credited grows), then three calls are charged (spent grows). Spent runs up
 * to the line that marks credited and never past it; then the picture fades and starts again.
 */
const D = 12;
const root = ref<HTMLElement | null>(null);
useStill(root, 10.2);

type Box = { x: number; y: number; w: number; h: number };
const layouts = [
  {
    cls: 'wide', vb: '0 0 640 290',
    yieldBox: { x: 10, y: 34, w: 160, h: 62 }, buyBox: { x: 10, y: 190, w: 160, h: 62 },
    ledger: { x: 236, y: 46, w: 240, h: 196 }, call: { x: 530, y: 113, w: 100, h: 62 },
    paths: { yield: 'M170 65 H200 V110 H236', buy: 'M170 221 H200 V178 H236', charge: 'M530 144 H476' },
  },
  {
    cls: 'tall', vb: '0 0 360 500',
    yieldBox: { x: 10, y: 14, w: 160, h: 62 }, buyBox: { x: 190, y: 14, w: 160, h: 62 },
    ledger: { x: 40, y: 136, w: 280, h: 196 }, call: { x: 120, y: 414, w: 120, h: 62 },
    paths: { yield: 'M90 76 V106 H140 V136', buy: 'M270 76 V106 H220 V136', charge: 'M180 414 V332' },
  },
];

const posts = { yield: windowed(D, 0.4, 1.6), buy: windowed(D, 2.4, 3.6) };
const charges = [4.8, 6.6, 8.4].map((s) => windowed(D, s, s + 1.0));

// Bar lengths as a share of the track: credited steps up twice, spent three times, never past credited.
const cr = { times: kt(D, 0, 1.6, 2.0, 3.6, 4.0, 10.8, 11.4, D), v: [0.12, 0.12, 0.45, 0.45, 0.78, 0.78, 0.12, 0.12] };
const sp = { times: kt(D, 0, 5.8, 6.2, 7.6, 8.0, 9.4, 9.8, 10.8, 11.4, D), v: [0, 0, 0.25, 0.25, 0.5, 0.5, 0.74, 0.74, 0, 0] };
const track = (l: Box) => ({ x: l.x + 18, w: l.w - 36 });
const rb = (b: Box) => ({ x: b.x, y: b.y, width: b.w, height: b.h });
const widths = (l: Box, v: number[]) => v.map((f) => (f * track(l).w).toFixed(1)).join(';');
const lineX = (l: Box) => cr.v.map((f) => (track(l).x + f * track(l).w).toFixed(1)).join(';');
</script>

<template>
  <figure ref="root" class="dg dg-credits" aria-label="Vault yield and USDC purchases are posted to the credit ledger as credited; each API call is charged as spent; spent never passes credited, and the difference is your available balance.">
    <svg v-for="l in layouts" :key="l.cls" :class="l.cls" :viewBox="l.vb" aria-hidden="true">
      <path v-for="(d, k) in l.paths" :key="k" class="edge" :class="{ mint: k !== 'charge' }" :d="d" />

      <g>
        <rect class="n-box" v-bind="rb(l.yieldBox)" rx="10" />
        <text class="n-title" :x="l.yieldBox.x + 14" :y="l.yieldBox.y + 26">Vault yield</text>
        <text class="n-sub" :x="l.yieldBox.x + 14" :y="l.yieldBox.y + 42">at its USD value</text>
        <rect class="n-box" v-bind="rb(l.buyBox)" rx="10" />
        <text class="n-title" :x="l.buyBox.x + 14" :y="l.buyBox.y + 26">A purchase</text>
        <text class="n-sub" :x="l.buyBox.x + 14" :y="l.buyBox.y + 42">1 USDC = $1</text>
        <rect class="n-box" v-bind="rb(l.call)" rx="10" />
        <text class="n-title" :x="l.call.x + 14" :y="l.call.y + 26">API call</text>
        <text class="n-sub" :x="l.call.x + 14" :y="l.call.y + 42">charged</text>
      </g>

      <!-- the ledger: credited and spent, on the same scale -->
      <g>
        <rect class="n-box" v-bind="rb(l.ledger)" rx="12" />
        <text class="n-title" :x="l.ledger.x + 18" :y="l.ledger.y + 28">Credit ledger</text>
        <text class="n-sub" :x="l.ledger.x + 18" :y="l.ledger.y + 44">on NEAR, per user</text>

        <text class="e-label" :x="track(l.ledger).x" :y="l.ledger.y + 74">credited</text>
        <rect class="soft-fill" :x="track(l.ledger).x" :y="l.ledger.y + 80" :width="track(l.ledger).w" height="12" rx="4" />
        <rect class="mint-fill" :x="track(l.ledger).x" :y="l.ledger.y + 80" :width="cr.v[6] * track(l.ledger).w" height="12" rx="4">
          <animate attributeName="width" :dur="`${D}s`" repeatCount="indefinite" :keyTimes="cr.times" :values="widths(l.ledger, cr.v)" />
        </rect>

        <text class="e-label" :x="track(l.ledger).x" :y="l.ledger.y + 118">spent</text>
        <rect class="soft-fill" :x="track(l.ledger).x" :y="l.ledger.y + 124" :width="track(l.ledger).w" height="12" rx="4" />
        <rect class="ink-fill" :x="track(l.ledger).x" :y="l.ledger.y + 124" width="0" height="12" rx="4">
          <animate attributeName="width" :dur="`${D}s`" repeatCount="indefinite" :keyTimes="sp.times" :values="widths(l.ledger, sp.v)" />
        </rect>

        <!-- the limit: wherever credited is, spent stops before it -->
        <line class="limit" :x1="track(l.ledger).x + cr.v[6] * track(l.ledger).w" :x2="track(l.ledger).x + cr.v[6] * track(l.ledger).w" :y1="l.ledger.y + 76" :y2="l.ledger.y + 142">
          <animate attributeName="x1" :dur="`${D}s`" repeatCount="indefinite" :keyTimes="cr.times" :values="lineX(l.ledger)" />
          <animate attributeName="x2" :dur="`${D}s`" repeatCount="indefinite" :keyTimes="cr.times" :values="lineX(l.ledger)" />
        </line>
        <text class="rule" :x="track(l.ledger).x" :y="l.ledger.y + 164">spent ≤ credited</text>
        <text class="e-label" :x="track(l.ledger).x" :y="l.ledger.y + 182">available = credited − spent</text>
      </g>

      <g class="pk">
        <circle v-for="k in (['yield', 'buy'] as const)" :key="k" class="mint-fill" r="6" opacity="0">
          <animateMotion :dur="`${D}s`" repeatCount="indefinite" :path="l.paths[k]" :keyTimes="posts[k].keyTimes" :keyPoints="posts[k].keyPoints" calcMode="linear" />
          <animate attributeName="opacity" :dur="`${D}s`" repeatCount="indefinite" :keyTimes="posts[k].opTimes" :values="posts[k].opValues" />
        </circle>
        <g v-for="(c, i) in charges" :key="i" class="chip" opacity="0">
          <rect x="-22" y="-9" width="44" height="18" rx="5" />
          <text x="0" y="3.3" text-anchor="middle">charge</text>
          <animateMotion :dur="`${D}s`" repeatCount="indefinite" :path="l.paths.charge" :keyTimes="c.keyTimes" :keyPoints="c.keyPoints" calcMode="linear" />
          <animate attributeName="opacity" :dur="`${D}s`" repeatCount="indefinite" :keyTimes="c.opTimes" :values="c.opValues" />
        </g>
      </g>
    </svg>
  </figure>
</template>

<style scoped>
.limit {
  stroke: var(--vp-c-text-1);
  stroke-width: 1.4;
  stroke-dasharray: 3 3;
}

.rule {
  fill: var(--vp-c-brand-1);
  font-family: var(--vp-font-family-mono);
  font-stretch: 87.5%;
  font-size: 11px;
  font-weight: 700;
}
</style>
