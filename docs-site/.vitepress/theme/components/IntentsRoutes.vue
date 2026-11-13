<script setup lang="ts">
import { ref } from 'vue';
import { kt, useStill } from './still';

/**
 * The four NEAR Intents routes and their status as the page's table gives it. Only a dry-run quote
 * ever moves: no route is drawn carrying funds, because none has carried funds on mainnet yet.
 */
const D = 6;
const root = ref<HTMLElement | null>(null);
useStill(root, 1.6);

const ping = (begin: number) => ({
  begin: `${begin}s`,
  times: kt(D, 0, 0.3, 1.8, 2.4, 3.9, D),
  points: '0;0;1;1;0;0',
  op: { times: kt(D, 0, 0.3, 0.45, 3.75, 3.9, D), values: '0;0;1;1;0;0' },
});

const routes = [
  {
    n: 1, from: 'Another chain', to: 'Your Base address', what: 'USDC from another chain to your own Base address',
    pills: [['live', 'Real quotes in the console'], ['off', 'Sending switched off']], kind: 'quote', ping: ping(0),
  },
  {
    n: 2, from: 'Base USDC', to: 'Rhea vault on NEAR', what: 'Base USDC into the Rhea USDC vault on NEAR',
    pills: [['live', 'Live route returns quotes'], ['built', 'No funded deposit yet']], kind: 'quote', ping: ping(1.5),
  },
  {
    n: 3, from: 'Principal on NEAR', to: 'Your Base address', what: 'Your principal from NEAR back to your own Base address',
    pills: [['built', 'Built and tested on fixtures'], ['built', 'Not yet run with funds']], kind: 'built',
  },
  {
    n: 4, from: 'Yield on Base', to: 'Treasury on NEAR', what: "InferNear's collected yield from Base to its treasury on NEAR",
    pills: [['built', 'Built and tested'], ['off', 'Switched off in this deployment']], kind: 'off',
  },
] as const;
</script>

<template>
  <figure ref="root" class="dg dg-intents" aria-label="The four NEAR Intents routes: quotes are live for the first two, the third is built and tested but not yet run with funds, and the fourth is built and tested but switched off. None has carried funds on mainnet yet.">
    <ol class="routes">
      <li v-for="r in routes" :key="r.n" :class="r.kind">
        <p class="head"><span class="n">{{ r.n }}</span><span class="what">{{ r.what }}</span></p>
        <div class="rail">
          <span class="end">{{ r.from }}</span>
          <svg viewBox="0 0 200 28" preserveAspectRatio="none" aria-hidden="true">
            <line class="track" x1="4" y1="14" x2="196" y2="14" />
          </svg>
          <svg class="over" viewBox="0 0 200 28" aria-hidden="true">
            <g v-if="r.kind === 'off'" transform="translate(100 14)">
              <rect class="sw" x="-14" y="-8" width="28" height="16" rx="8" />
              <circle class="sw-knob" cx="-6" cy="0" r="5" />
            </g>
            <g v-if="r.kind === 'quote'" class="pk">
              <g class="q" opacity="0">
                <rect x="-20" y="-8" width="40" height="16" rx="5" />
                <text x="0" y="3" text-anchor="middle">quote</text>
                <animateMotion :dur="`${D}s`" :begin="r.ping.begin" repeatCount="indefinite" path="M26 14 H174" :keyTimes="r.ping.times" :keyPoints="r.ping.points" calcMode="linear" />
                <animate attributeName="opacity" :dur="`${D}s`" :begin="r.ping.begin" repeatCount="indefinite" :keyTimes="r.ping.op.times" :values="r.ping.op.values" />
              </g>
            </g>
          </svg>
          <span class="end">{{ r.to }}</span>
        </div>
        <p class="pills"><span v-for="p in r.pills" :key="p[1]" class="dg-pill" :class="p[0]">{{ p[1] }}</span></p>
      </li>
    </ol>
    <p class="dg-cap"><b>Key</b> a dashed line has not carried funds on mainnet <b>quote</b> a dry-run quote from NEAR Intents, nothing is sent</p>
  </figure>
</template>

<style scoped>
.routes {
  display: grid;
  gap: 10px;
  margin: 0 !important;
  padding: 0 !important;
  list-style: none;
}

.routes li {
  margin: 0 !important;
  padding: 12px 14px 12px;
  border: 1px solid var(--vp-c-border);
  border-radius: 12px;
  background: var(--vp-c-bg-elv);
}

.routes li.off {
  background: transparent;
  border-style: dashed;
}

.head {
  display: flex;
  gap: 10px;
  align-items: baseline;
  margin: 0 0 8px !important;
  line-height: 1.4 !important;
}

.n {
  display: inline-grid;
  flex: none;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  background: var(--vp-c-text-1);
  color: var(--vp-c-bg);
  font-family: var(--vp-font-family-mono);
  font-size: 10.5px;
  font-weight: 700;
}

.off .n {
  background: var(--vp-c-text-3);
}

.what {
  font-size: 14px;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.rail {
  position: relative;
  display: grid;
  grid-template-columns: auto minmax(60px, 1fr) auto;
  align-items: center;
  gap: 8px;
}

.rail svg {
  grid-column: 2;
  grid-row: 1;
  width: 100%;
  height: 28px;
}

.end {
  padding: 4px 10px 3px;
  border: 1px solid var(--vp-c-border);
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
  font-family: var(--vp-font-family-mono);
  font-stretch: 87.5%;
  font-size: 11px;
  font-weight: 600;
  color: var(--vp-c-text-2);
  white-space: nowrap;
}

.track {
  stroke: var(--vp-c-text-3);
  stroke-width: 1.6;
  stroke-dasharray: 4 6;
  vector-effect: non-scaling-stroke;
}

.off .track {
  opacity: 0.45;
}

.sw {
  fill: var(--vp-c-bg-soft);
  stroke: var(--vp-c-text-3);
  stroke-width: 1.4;
}

.sw-knob {
  fill: var(--vp-c-text-3);
}

.q rect {
  fill: var(--vp-c-bg-elv);
  stroke: var(--vp-c-brand-1);
  stroke-width: 1.4;
}

.q text {
  fill: var(--vp-c-brand-1);
  font-family: var(--vp-font-family-mono);
  font-stretch: 87.5%;
  font-size: 9px;
  font-weight: 700;
}

.pills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 10px 0 0 !important;
}

@container (max-width: 520px) {
  .rail {
    grid-template-columns: minmax(0, 1fr) minmax(40px, 0.6fr) minmax(0, 1fr);
  }

  .end {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: normal;
    line-height: 1.3;
  }
}
</style>
