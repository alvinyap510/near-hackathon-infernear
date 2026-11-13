<script setup lang="ts">
import { ref } from 'vue';
import { kt, useStill, windowed } from './still';

/**
 * The whole flow, one fourteen-second loop. Funding: a deposit reaches the vault (the principal
 * stays there), its yield goes to the keeper, the keeper posts credits to the ledger on NEAR.
 * A call: your app calls the gateway, the gateway checks credits on the ledger, forwards to the
 * NEAR AI model in its TEE, passes the reply back, and records the charge on the ledger.
 */
const D = 14;
const root = ref<HTMLElement | null>(null);
useStill(root, 13.5);

type Box = { x: number; y: number; w: number; h: number };
type Layout = {
  cls: string;
  vb: string;
  nodes: Record<'wallet' | 'vault' | 'keeper' | 'ledger' | 'app' | 'gateway' | 'model', Box>;
  paths: Record<'deposit' | 'yield' | 'credits' | 'call' | 'forward' | 'reply' | 'ledgerLink', string>;
  labels: { x: number; y: number; t: string; a?: 'start' | 'middle' | 'end' }[];
  rows: { x: number; y: number; t: string }[];
};

const wide: Layout = {
  cls: 'wide',
  vb: '0 0 640 360',
  nodes: {
    wallet: { x: 0, y: 30, w: 150, h: 70 },
    vault: { x: 245, y: 30, w: 150, h: 70 },
    keeper: { x: 490, y: 30, w: 150, h: 70 },
    ledger: { x: 490, y: 150, w: 150, h: 70 },
    app: { x: 0, y: 280, w: 162, h: 70 },
    gateway: { x: 245, y: 280, w: 150, h: 70 },
    model: { x: 490, y: 280, w: 150, h: 70 },
  },
  paths: {
    deposit: 'M150 65 H245',
    yield: 'M395 65 H490',
    credits: 'M565 100 V150',
    call: 'M162 306 H245',
    forward: 'M395 306 H490',
    reply: 'M490 324 H162',
    ledgerLink: 'M320 280 V185 H490',
  },
  labels: [
    { x: 197, y: 57, t: 'deposit', a: 'middle' },
    { x: 442, y: 57, t: 'yield', a: 'middle' },
    { x: 573, y: 129, t: 'credits' },
    { x: 203, y: 298, t: 'call', a: 'middle' },
    { x: 203, y: 340, t: 'reply', a: 'middle' },
    { x: 442, y: 298, t: 'forward', a: 'middle' },
    { x: 442, y: 340, t: 'reply', a: 'middle' },
    { x: 405, y: 177, t: 'check credits', a: 'middle' },
    { x: 405, y: 199, t: 'record the charge', a: 'middle' },
  ],
  rows: [
    { x: 0, y: 18, t: 'Funding' },
    { x: 0, y: 268, t: 'A call' },
  ],
};

const tall: Layout = {
  cls: 'tall',
  vb: '0 0 360 620',
  nodes: {
    wallet: { x: 70, y: 30, w: 220, h: 58 },
    vault: { x: 70, y: 120, w: 220, h: 58 },
    keeper: { x: 70, y: 210, w: 220, h: 58 },
    ledger: { x: 70, y: 300, w: 220, h: 58 },
    app: { x: 10, y: 420, w: 140, h: 66 },
    gateway: { x: 210, y: 420, w: 140, h: 66 },
    model: { x: 210, y: 540, w: 140, h: 66 },
  },
  paths: {
    deposit: 'M180 88 V120',
    yield: 'M180 178 V210',
    credits: 'M180 268 V300',
    call: 'M150 445 H210',
    forward: 'M272 486 V540',
    reply: 'M288 540 V470 H150',
    ledgerLink: 'M280 420 V358',
  },
  labels: [
    { x: 190, y: 108, t: 'deposit' },
    { x: 190, y: 198, t: 'yield' },
    { x: 190, y: 288, t: 'credits' },
    { x: 180, y: 438, t: 'call', a: 'middle' },
    { x: 180, y: 480, t: 'reply', a: 'middle' },
    { x: 262, y: 518, t: 'forward', a: 'end' },
    { x: 272, y: 394, t: 'check, charge', a: 'end' },
  ],
  rows: [
    { x: 70, y: 20, t: 'Funding' },
    { x: 10, y: 410, t: 'A call' },
  ],
};

const layouts = [wide, tall];
const titles = {
  wallet: ['Your wallet', 'on your own chain'],
  vault: ['Vault', 'principal stays'],
  keeper: ['Keeper', 'finalized blocks'],
  ledger: ['Credit ledger', 'on NEAR'],
  app: ['Your app', 'OpenAI client or SDK'],
  gateway: ['Gateway', 'api.infernear.dev'],
  model: ['NEAR AI model', 'attested TEE'],
} as const;

const w = {
  deposit: windowed(D, 0.4, 1.6),
  yield: windowed(D, 2.0, 3.2),
  credits: windowed(D, 3.6, 4.8),
  call: windowed(D, 5.6, 6.8),
  check: windowed(D, 7.0, 8.0),
  forward: windowed(D, 8.2, 9.2),
  reply: windowed(D, 10.0, 11.8),
  charge: windowed(D, 11.9, 12.9),
};
const flash = (from: number, to: number) => ({ times: kt(D, 0, from, from + 0.2, to - 0.3, to, D), values: '0;0;1;1;0;0' });
const glow = { vault: flash(1.5, 2.6), ledger: flash(4.7, 5.8), model: flash(9.1, 10.2), receipt: flash(12.8, 13.9) };
// The ledger's available credit: up when credits are posted, back down when the call is charged.
const bar = { times: kt(D, 0, 4.8, 5.2, 12.9, 13.3, D), values: '0.4;0.4;0.75;0.75;0.4;0.4' };
const barW = (b: Box) => bar.values.split(';').map((v) => (+v * (b.w - 28)).toFixed(1)).join(';');
</script>

<template>
  <figure ref="root" class="dg dg-flow" aria-label="How InferNear works: a deposit stays in a vault, a keeper posts its yield as credits to a ledger on NEAR, and the gateway checks those credits, forwards your call to a NEAR AI model in a TEE, passes the reply back and records the charge on the ledger.">
    <svg v-for="l in layouts" :key="l.cls" :class="l.cls" :viewBox="l.vb" aria-hidden="true">
      <text v-for="r in l.rows" :key="r.t" class="n-sub row" :x="r.x" :y="r.y">{{ r.t }}</text>

      <path v-for="(d, k) in l.paths" :key="k" class="edge" :class="{ mint: k === 'yield' || k === 'credits' }" :d="d" />
      <text v-for="(t, i) in l.labels" :key="i" class="e-label" :x="t.x" :y="t.y" :text-anchor="t.a ?? 'start'">{{ t.t }}</text>

      <g v-for="(b, k) in l.nodes" :key="k">
        <rect class="n-box" :x="b.x" :y="b.y" :width="b.w" :height="b.h" rx="10" />
        <rect v-if="k === 'vault' || k === 'ledger' || k === 'model'" class="n-box hot" :x="b.x" :y="b.y" :width="b.w" :height="b.h" rx="10" opacity="0">
          <animate attributeName="opacity" :dur="`${D}s`" repeatCount="indefinite" :keyTimes="glow[k].times" :values="glow[k].values" />
        </rect>
        <text class="n-title" :x="b.x + 14" :y="b.y + (b.h > 64 ? 28 : 25)">{{ titles[k][0] }}</text>
        <text class="n-sub" :x="b.x + 14" :y="b.y + (b.h > 64 ? 47 : 42)">{{ titles[k][1] }}</text>
        <!-- the vault's principal, locked in place -->
        <g v-if="k === 'vault'" :transform="`translate(${b.x + b.w - 30} ${b.y + 14})`">
          <rect class="ink-stroke" x="0" y="8" width="16" height="12" rx="2" stroke-width="1.6" />
          <path class="ink-stroke" d="M4 8V5a4 4 0 0 1 8 0v3" stroke-width="1.6" />
        </g>
        <!-- the ledger's available credit, and a receipt for each charge -->
        <g v-if="k === 'ledger'">
          <rect class="soft-fill" :x="b.x + 14" :y="b.y + b.h - 13" :width="b.w - 28" height="5" rx="2.5" />
          <rect class="mint-fill" :x="b.x + 14" :y="b.y + b.h - 13" :width="0.4 * (b.w - 28)" height="5" rx="2.5">
            <animate attributeName="width" :dur="`${D}s`" repeatCount="indefinite" :keyTimes="bar.times" :values="barW(b)" />
          </rect>
          <g :transform="`translate(${b.x + b.w - 30} ${b.y + 12})`" opacity="0">
            <rect class="card-fill accent-stroke" x="0" y="0" width="16" height="20" rx="2" stroke-width="1.4" />
            <path class="accent-stroke" d="M4 7h8M4 11h8M4 15h5" stroke-width="1.4" />
            <animate attributeName="opacity" :dur="`${D}s`" repeatCount="indefinite" :keyTimes="glow.receipt.times" :values="glow.receipt.values" />
          </g>
        </g>
      </g>

      <g class="pk">
        <circle class="ink-fill" r="6" opacity="0">
          <animateMotion :dur="`${D}s`" repeatCount="indefinite" :path="l.paths.deposit" :keyTimes="w.deposit.keyTimes" :keyPoints="w.deposit.keyPoints" calcMode="linear" />
          <animate attributeName="opacity" :dur="`${D}s`" repeatCount="indefinite" :keyTimes="w.deposit.opTimes" :values="w.deposit.opValues" />
        </circle>
        <circle v-for="k in (['yield', 'credits'] as const)" :key="k" class="mint-fill" r="6" opacity="0">
          <animateMotion :dur="`${D}s`" repeatCount="indefinite" :path="l.paths[k]" :keyTimes="w[k].keyTimes" :keyPoints="w[k].keyPoints" calcMode="linear" />
          <animate attributeName="opacity" :dur="`${D}s`" repeatCount="indefinite" :keyTimes="w[k].opTimes" :values="w[k].opValues" />
        </circle>
        <g v-for="c in ([['call', 'call', 'call'], ['forward', 'forward', 'call'], ['reply', 'reply', 'reply']] as const)" :key="c[0]" class="chip" opacity="0">
          <rect x="-19" y="-9" width="38" height="18" rx="5" />
          <text x="0" y="3.3" text-anchor="middle">{{ c[2] }}</text>
          <animateMotion :dur="`${D}s`" repeatCount="indefinite" :path="l.paths[c[1]]" :keyTimes="w[c[0]].keyTimes" :keyPoints="w[c[0]].keyPoints" calcMode="linear" />
          <animate attributeName="opacity" :dur="`${D}s`" repeatCount="indefinite" :keyTimes="w[c[0]].opTimes" :values="w[c[0]].opValues" />
        </g>
        <g v-for="c in ([['check', 'check'], ['charge', 'charge']] as const)" :key="c[0]" class="chip mint" opacity="0">
          <rect x="-22" y="-9" width="44" height="18" rx="5" />
          <text x="0" y="3.3" text-anchor="middle">{{ c[1] }}</text>
          <animateMotion :dur="`${D}s`" repeatCount="indefinite" :path="l.paths.ledgerLink" :keyTimes="w[c[0]].keyTimes" :keyPoints="w[c[0]].keyPoints" calcMode="linear" />
          <animate attributeName="opacity" :dur="`${D}s`" repeatCount="indefinite" :keyTimes="w[c[0]].opTimes" :values="w[c[0]].opValues" />
        </g>
      </g>
    </svg>
    <p class="dg-cap"><b>Funding</b> deposit, yield, credits on NEAR <b>A call</b> checked against the ledger, answered in a TEE, charged on NEAR</p>
  </figure>
</template>

<style scoped>
.row {
  font-size: 10px;
  fill: var(--vp-c-brand-1);
}
</style>
