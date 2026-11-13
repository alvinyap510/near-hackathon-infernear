<script setup lang="ts">
import { ref } from 'vue';
import { kt, useStill, windowed } from './still';

// One loop, ten seconds: three drops of yield travel round to credits, the gauge fills, then a
// private call is paid and the gauge falls back to where it started.
const D = 10;
const root = ref<HTMLElement | null>(null);
useStill(root, 5.4);

const yieldPath = 'M300 70 A150 150 0 0 1 450 220 A150 150 0 0 1 300 370';
const callPath = 'M300 370 A150 150 0 0 1 150 220';
const drops = [0.5, 1.5, 2.5].map((s) => windowed(D, s, s + 2.6));
const call = windowed(D, 5.8, 7.2);

// The credits gauge (max 34 units tall, base at y 386): up a step as each drop lands, down when the call is paid.
const levels: [number, number][] = [[0, 0.3], [3.1, 0.3], [3.3, 0.45], [4.1, 0.45], [4.3, 0.6], [5.1, 0.6], [5.3, 0.75], [7.2, 0.75], [7.8, 0.3], [D, 0.3]];
const gaugeTimes = kt(D, ...levels.map(([t]) => t));
const gaugeH = levels.map(([, l]) => (l * 34).toFixed(1)).join(';');
const gaugeY = levels.map(([, l]) => (386 - l * 34).toFixed(1)).join(';');
const glow = { times: kt(D, 0, 7.1, 7.3, 8.4, 8.8, D), values: '0;0;1;1;0;0' };

const steps = [
  { n: 1, t: 'Deposit', s: 'Your principal stays in the vault' },
  { n: 2, t: 'Yield', s: 'Goes to InferNear and comes back as credits' },
  { n: 3, t: 'Credits on NEAR', s: 'Fill up as yield is posted' },
  { n: 4, t: 'Private model call', s: 'Paid from credits' },
];
</script>

<template>
  <figure ref="root" class="dg dg-loop" aria-label="The InferNear loop: your deposit stays, its yield becomes credits on NEAR, and credits pay for private model calls.">
    <svg viewBox="0 -16 600 456" role="img" aria-hidden="true">
      <!-- the ring -->
      <path class="edge mint" d="M300 70 A150 150 0 0 1 450 220" />
      <path class="edge mint" d="M450 220 A150 150 0 0 1 300 370" />
      <path class="edge" d="M300 370 A150 150 0 0 1 150 220" />
      <path class="edge dash" d="M150 220 A150 150 0 0 1 300 70" />

      <!-- centre: the mark -->
      <g transform="translate(276 196) scale(1.5)" opacity="0.9">
        <path class="mark-br" d="M0 1.5A1.5 1.5 0 0 1 1.5 0H8v4H4v16h4v4H1.5A1.5 1.5 0 0 1 0 22.5zM16 0h6.5A1.5 1.5 0 0 1 24 1.5v21a1.5 1.5 0 0 1-1.5 1.5H16v-4h4V4h-4z" />
        <rect class="mark-core" x="8" y="8" width="8" height="8" rx="1" />
      </g>

      <!-- 1 deposit: a vault with a lock; the principal never leaves it -->
      <g>
        <circle class="n-box" cx="300" cy="70" r="36" />
        <rect class="ink-stroke" x="284" y="58" width="32" height="26" rx="4" stroke-width="2" />
        <path class="ink-stroke" d="M293 58v-5a7 7 0 0 1 14 0v5" stroke-width="2" />
        <circle class="ink-fill" cx="300" cy="71" r="3" />
        <text class="n-title lbl" x="300" y="2" text-anchor="middle">Deposit</text>
        <text class="n-sub lbl" x="300" y="16" text-anchor="middle">principal stays</text>
      </g>

      <!-- 2 yield -->
      <g>
        <circle class="n-box" cx="450" cy="220" r="36" />
        <path class="mint-fill" d="M450 202c-6 9-10 14-10 20a10 10 0 0 0 20 0c0-6-4-11-10-20z" />
        <text class="n-title lbl" x="500" y="216">Yield</text>
        <text class="n-sub lbl" x="500" y="230">becomes credits</text>
      </g>

      <!-- 3 credits on NEAR: a gauge -->
      <g>
        <circle class="n-box" cx="300" cy="370" r="36" />
        <rect class="soft-fill line-stroke" x="288" y="352" width="24" height="34" rx="3" />
        <rect class="mint-fill" x="288" width="24" rx="2" :y="386 - 0.3 * 34" :height="0.3 * 34">
          <animate attributeName="height" :dur="`${D}s`" repeatCount="indefinite" :keyTimes="gaugeTimes" :values="gaugeH" />
          <animate attributeName="y" :dur="`${D}s`" repeatCount="indefinite" :keyTimes="gaugeTimes" :values="gaugeY" />
        </rect>
        <text class="n-title lbl" x="300" y="430" text-anchor="middle">Credits on NEAR</text>
      </g>

      <!-- 4 a private model call, answered in a TEE -->
      <g>
        <circle class="n-box" cx="150" cy="220" r="36" />
        <circle class="mint-fill" cx="150" cy="220" r="34" opacity="0">
          <animate attributeName="opacity" :dur="`${D}s`" repeatCount="indefinite" :keyTimes="glow.times" values="0;0;0.22;0.22;0;0" />
        </circle>
        <!-- the model's TEE: a chip with a lock -->
        <g transform="translate(135 205) scale(1.5)">
          <path class="ink-stroke" d="M4 0v3M10 0v3M16 0v3M4 17v3M10 17v3M16 17v3M0 4h3M0 10h3M0 16h3M17 4h3M17 10h3M17 16h3" stroke-width="1.2" />
          <rect class="ink-stroke" x="3" y="3" width="14" height="14" rx="2" stroke-width="1.3" />
          <rect class="mint-fill" x="7" y="9" width="6" height="5" rx="1" />
          <path class="ink-stroke" d="M8.2 9V7.8a1.8 1.8 0 0 1 3.6 0V9" stroke-width="1" />
        </g>
        <text class="n-title lbl" x="100" y="216" text-anchor="end">Private call</text>
        <text class="n-sub lbl" x="100" y="230" text-anchor="end">paid from credits</text>
      </g>

      <!-- step numbers -->
      <g v-for="(p, i) in [[326, 44], [476, 194], [326, 344], [176, 194]]" :key="i">
        <circle class="accent-fill" :cx="p[0]" :cy="p[1]" r="9" />
        <text :x="p[0]" :y="p[1] + 3.5" text-anchor="middle" class="num">{{ i + 1 }}</text>
      </g>

      <!-- moving: yield drops, then the call -->
      <g class="pk">
        <circle v-for="(d, i) in drops" :key="i" class="mint-fill" r="6" opacity="0">
          <animateMotion :dur="`${D}s`" repeatCount="indefinite" :path="yieldPath" :keyTimes="d.keyTimes" :keyPoints="d.keyPoints" calcMode="linear" />
          <animate attributeName="opacity" :dur="`${D}s`" repeatCount="indefinite" :keyTimes="d.opTimes" :values="d.opValues" />
        </circle>
        <g class="chip" opacity="0">
          <rect x="-17" y="-10" width="34" height="20" rx="6" />
          <text x="0" y="3.5" text-anchor="middle">call</text>
          <animateMotion :dur="`${D}s`" repeatCount="indefinite" :path="callPath" :keyTimes="call.keyTimes" :keyPoints="call.keyPoints" calcMode="linear" />
          <animate attributeName="opacity" :dur="`${D}s`" repeatCount="indefinite" :keyTimes="call.opTimes" :values="call.opValues" />
        </g>
      </g>
    </svg>
    <ol class="dg-steps">
      <li v-for="s in steps" :key="s.n"><span>{{ s.n }}</span><b>{{ s.t }}</b> {{ s.s }}</li>
    </ol>
  </figure>
</template>

<style scoped>
.dg-loop svg {
  max-width: 560px;
  margin: 0 auto;
}

.num {
  fill: var(--vp-c-bg);
  font-family: var(--vp-font-family-mono);
  font-size: 10px;
  font-weight: 700;
}

.dg-steps {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px 14px;
  margin: 18px 0 2px !important;
  padding: 14px 0 0 !important;
  border-top: 1px solid var(--vp-c-divider);
  list-style: none;
}

.dg-steps li {
  margin: 0 !important;
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--vp-c-text-2);
}

.dg-steps span {
  display: inline-grid;
  place-items: center;
  width: 17px;
  height: 17px;
  margin-right: 6px;
  border-radius: 50%;
  background: var(--vp-c-brand-1);
  color: var(--vp-c-bg);
  font-family: var(--vp-font-family-mono);
  font-size: 9.5px;
  font-weight: 700;
  vertical-align: 1px;
}

.dg-steps b {
  color: var(--vp-c-text-1);
}

.dg-steps b::after {
  content: '';
  display: block;
}

@container (max-width: 560px) {
  .lbl {
    display: none;
  }

  .dg-steps {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
