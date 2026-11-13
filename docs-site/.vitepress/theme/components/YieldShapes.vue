<script setup lang="ts">
import { ref } from 'vue';
import { kt, useStill } from './still';

// Each shape draws its line in six seconds, a dot riding the tip; the cards start a little
// apart so the four do not move in step. Names and examples are the Vision page's table.
const D = 6;
const root = ref<HTMLElement | null>(null);
useStill(root, 4.6);

const draw = { times: kt(D, 0, 3.6, 5.3, 5.9, D), offset: '1;0;0;0;1', opacity: '1;1;1;0;0' };
const ride = { times: kt(D, 0, 3.6, D), points: '0;1;1' };
const dotOpacity = { times: kt(D, 0, 0.1, 5.3, 5.9, D), values: '0;1;1;0;0' };
const arrow = { times: kt(D, 0, 3.4, 3.7, 5.3, 5.9, D) };

const shapes = [
  { name: 'A growing balance', example: 'Lending USDC on Aave', path: 'M16 92 H50 V85 H84 V77 H118 V68 H152 V57 H186 V45 H224', begin: '0s' },
  { name: 'Appreciation with a cap', example: 'A Pendle principal token rising to face value', path: 'M16 94 C 66 80, 112 52, 160 38 S 206 31, 224 31', begin: '0.6s', cap: true },
  { name: 'Appreciation with no cap', example: 'A liquid staking token such as cbETH', path: 'M16 96 C 90 92, 160 70, 222 20', begin: '1.2s', open: true },
];

// The fourth shape: rewards accrue on a stake and wait to be claimed. Built, not deployed.
const S = 8;
const drops = [0.4, 2.0, 3.6].map((s) => ({
  times: kt(S, 0, s, s + 0.9, S),
  y: '60;60;91;91',
  op: { times: kt(S, 0, s, s + 0.15, s + 0.8, s + 0.9, S), values: '0;0;1;1;0;0' },
}));
const pot = { times: kt(S, 0, 1.3, 1.5, 2.9, 3.1, 4.5, 4.7, 6.2, 6.6, S), w: '0;0;16;16;33;33;50;50;0;0' };
const claim = { times: kt(S, 0, 6.1, 6.3, 6.8, 7.0, S), values: '0;0;1;1;0;0' };
</script>

<template>
  <figure ref="root" class="dg dg-shapes" aria-label="The four yield shapes: a growing balance, appreciation with a cap, appreciation with no cap, and staking with claimable rewards, which is built and tested but not yet deployed.">
    <div class="grid">
      <div v-for="s in shapes" :key="s.name" class="card">
        <svg viewBox="0 0 240 112" aria-hidden="true">
          <line class="axis" x1="16" y1="104" x2="224" y2="104" />
          <template v-if="s.cap">
            <line class="cap" x1="16" y1="28" x2="224" y2="28" />
            <text class="e-label" x="224" y="20" text-anchor="end">face value</text>
          </template>
          <template v-if="s.open">
            <text class="e-label" x="160" y="20" text-anchor="end">no ceiling</text>
            <path class="accent-stroke" d="M213 22 L222 20 L220 29" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <animate attributeName="opacity" :dur="`${D}s`" :begin="s.begin" repeatCount="indefinite" :keyTimes="arrow.times" values="0;0;1;1;0;0" />
            </path>
          </template>
          <path class="trace" :d="s.path" pathLength="1">
            <animate attributeName="stroke-dashoffset" :dur="`${D}s`" :begin="s.begin" repeatCount="indefinite" :keyTimes="draw.times" :values="draw.offset" />
            <animate attributeName="opacity" :dur="`${D}s`" :begin="s.begin" repeatCount="indefinite" :keyTimes="draw.times" :values="draw.opacity" />
          </path>
          <circle class="mint-fill pk" r="5" opacity="0">
            <animateMotion :dur="`${D}s`" :begin="s.begin" repeatCount="indefinite" :path="s.path" :keyTimes="ride.times" :keyPoints="ride.points" calcMode="linear" />
            <animate attributeName="opacity" :dur="`${D}s`" :begin="s.begin" repeatCount="indefinite" :keyTimes="dotOpacity.times" :values="dotOpacity.values" />
          </circle>
        </svg>
        <p class="name">{{ s.name }}</p>
        <p class="ex">{{ s.example }}</p>
      </div>

      <div class="card next">
        <svg viewBox="0 0 240 112" aria-hidden="true">
          <line class="axis" x1="16" y1="104" x2="224" y2="104" />
          <line class="stake" x1="16" y1="56" x2="200" y2="56" />
          <text class="e-label" x="16" y="46">staked</text>
          <rect class="pot" x="126" y="84" width="58" height="14" rx="7" />
          <rect class="pot-fill" x="130" y="88" width="0" height="6" rx="3">
            <animate attributeName="width" :dur="`${S}s`" repeatCount="indefinite" :keyTimes="pot.times" :values="pot.w" />
          </rect>
          <text class="e-label" x="120" y="95" text-anchor="end">claimable
            <animate attributeName="opacity" :dur="`${S}s`" repeatCount="indefinite" :keyTimes="claim.times" values="1;1;0;0;1;1" />
          </text>
          <text class="e-label claimed" x="120" y="95" text-anchor="end" opacity="0">claimed
            <animate attributeName="opacity" :dur="`${S}s`" repeatCount="indefinite" :keyTimes="claim.times" :values="claim.values" />
          </text>
          <g class="pk">
            <circle v-for="(d, i) in drops" :key="i" class="drop" :cx="142 + i * 13" cy="60" r="3.5" opacity="0">
              <animate attributeName="cy" :dur="`${S}s`" repeatCount="indefinite" :keyTimes="d.times" :values="d.y" />
              <animate attributeName="opacity" :dur="`${S}s`" repeatCount="indefinite" :keyTimes="d.op.times" :values="d.op.values" />
            </circle>
          </g>
        </svg>
        <p class="name">Staking with claimable rewards</p>
        <p class="ex"><span class="dg-pill built">Built and tested, not yet deployed</span></p>
      </div>
    </div>
  </figure>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.card {
  padding: 14px 16px 12px;
  border: 1px solid var(--vp-c-border);
  border-radius: 12px;
  background: var(--vp-c-bg-elv);
}

.card.next {
  border-style: dashed;
  background: transparent;
}

.name {
  margin: 10px 0 2px !important;
  font-size: 14.5px;
  font-weight: 700;
  line-height: 1.35 !important;
  color: var(--vp-c-text-1);
}

.ex {
  margin: 0 !important;
  font-size: 12.5px;
  line-height: 1.45 !important;
  color: var(--vp-c-text-2);
}

.axis {
  stroke: var(--vp-c-border);
  stroke-width: 1.2;
}

.cap {
  stroke: var(--vp-c-text-3);
  stroke-width: 1.2;
  stroke-dasharray: 4 5;
}

.trace {
  fill: none;
  stroke: var(--vp-c-brand-1);
  stroke-width: 2.6;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 1;
  stroke-dashoffset: 0;
}

.stake {
  stroke: var(--vp-c-text-3);
  stroke-width: 2.6;
  stroke-linecap: round;
}

.pot {
  fill: none;
  stroke: var(--vp-c-text-3);
  stroke-width: 1.2;
  stroke-dasharray: 3 3;
}

.pot-fill,
.drop {
  fill: var(--vp-c-text-3);
}

.claimed {
  fill: var(--vp-c-text-1);
}

@container (max-width: 420px) {
  .grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
