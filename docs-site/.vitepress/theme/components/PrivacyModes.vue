<script setup lang="ts">
import { ref } from 'vue';
import { kt, useStill, windowed } from './still';

/**
 * What the relay sees, mode by mode, in an eight-second loop: a prompt goes from your app through
 * the relay to the model in its TEE, and the reply comes back. In standard mode it is readable
 * text in transit; in private mode it is ciphertext the relay cannot open.
 */
const D = 8;
const root = ref<HTMLElement | null>(null);
useStill(root, 1.2);

const out = windowed(D, 0.4, 2.2);
const back = windowed(D, 3.2, 5.0);
const atRelay = (a: number, b: number) => ({ times: kt(D, 0, a, a + 0.15, b - 0.15, b, D), values: '0;0;1;1;0;0' });
const relayLit = { out: atRelay(1.0, 1.6), back: atRelay(3.8, 4.4) };
const opened = atRelay(2.1, 3.1);

type Box = { x: number; y: number; w: number; h: number };
const layouts = [
  {
    cls: 'wide', vb: '0 0 600 156',
    app: { x: 10, y: 40, w: 130, h: 70 }, relay: { x: 235, y: 22, w: 130, h: 106 }, model: { x: 460, y: 40, w: 130, h: 70 },
    out: 'M140 66 H460', back: 'M460 92 H140', eye: [300, 80], meta: 150,
  },
  {
    cls: 'tall', vb: '0 0 360 176',
    app: { x: 4, y: 52, w: 90, h: 68 }, relay: { x: 123, y: 40, w: 114, h: 92 }, model: { x: 266, y: 52, w: 90, h: 68 },
    out: 'M94 74 H266', back: 'M266 98 H94', eye: [180, 88], meta: 162,
  },
];
const mid = (b: Box) => b.x + b.w / 2;

const modes = [
  {
    key: 'standard', title: 'Standard mode', client: 'Any OpenAI client',
    ask: 'Summarize…', reply: 'Here is…', relay: 'reads in transit',
    note: 'The relay can read the prompt and reply while forwarding them. It stores neither.',
  },
  {
    key: 'private', title: 'Private mode', client: "NEAR AI's inference SDK",
    ask: '9f3a…c2e1', reply: 'b71d…04af', relay: 'ciphertext only',
    note: 'The relay sees ciphertext only. Still visible to it: which key, which model, request size, timing and token counts.',
  },
] as const;
</script>

<template>
  <figure ref="root" class="dg dg-privacy" aria-label="Standard mode: the relay can read the prompt and reply in transit and stores neither. Private mode: the prompt is encrypted on your machine to the model's TEE, and the relay sees only ciphertext.">
    <div class="lanes">
      <div v-for="m in modes" :key="m.key" class="lane" :class="m.key">
        <p class="lane-h"><b>{{ m.title }}</b><span>{{ m.client }}</span></p>
        <svg v-for="l in layouts" :key="l.cls" :class="l.cls" :viewBox="l.vb" aria-hidden="true">
          <path class="edge" :d="l.out" />
          <path class="edge" :d="l.back" />

          <rect class="n-box" :x="l.app.x" :y="l.app.y" :width="l.app.w" :height="l.app.h" rx="10" />
          <text class="n-title sm" :x="mid(l.app)" :y="l.app.y + l.app.h / 2 - 2" text-anchor="middle">Your app</text>
          <text class="n-sub" :x="mid(l.app)" :y="l.app.y + l.app.h / 2 + 14" text-anchor="middle">{{ m.key === 'private' ? 'encrypts' : 'sends text' }}</text>

          <rect class="n-box" :x="l.relay.x" :y="l.relay.y" :width="l.relay.w" :height="l.relay.h" rx="10" />
          <rect v-for="lit in [relayLit.out, relayLit.back]" :key="lit.times" class="n-box hot" :x="l.relay.x" :y="l.relay.y" :width="l.relay.w" :height="l.relay.h" rx="10" opacity="0">
            <animate attributeName="opacity" :dur="`${D}s`" repeatCount="indefinite" :keyTimes="lit.times" :values="lit.values" />
          </rect>
          <text class="n-title sm" :x="mid(l.relay)" :y="l.relay.y + 22" text-anchor="middle">Relay</text>
          <!-- an eye: open where the relay can read, struck through where it cannot -->
          <g :transform="`translate(${l.eye[0]} ${l.eye[1]})`">
            <path class="ink-stroke" d="M-15 0 C-9 -9 9 -9 15 0 C9 9 -9 9 -15 0 Z" stroke-width="1.8" />
            <circle :class="m.key === 'standard' ? 'ink-fill' : 'line-stroke'" r="4.5" stroke-width="1.6" />
            <path v-if="m.key === 'private'" class="slash" d="M-14 11 L14 -11" />
          </g>
          <text class="n-sub" :x="mid(l.relay)" :y="l.relay.y + l.relay.h - 10" text-anchor="middle">{{ m.relay }}</text>

          <rect class="n-box" :x="l.model.x" :y="l.model.y" :width="l.model.w" :height="l.model.h" rx="10" />
          <rect class="n-box hot" :x="l.model.x" :y="l.model.y" :width="l.model.w" :height="l.model.h" rx="10" opacity="0">
            <animate attributeName="opacity" :dur="`${D}s`" repeatCount="indefinite" :keyTimes="opened.times" :values="opened.values" />
          </rect>
          <text class="n-title sm" :x="mid(l.model)" :y="l.model.y + l.model.h / 2 - 2" text-anchor="middle">TEE model</text>
          <text class="n-sub" :x="mid(l.model)" :y="l.model.y + l.model.h / 2 + 14" text-anchor="middle">{{ m.key === 'private' ? 'opens it here' : 'NEAR AI' }}</text>

          <text v-if="m.key === 'private'" class="meta" :x="mid(l.relay)" :y="l.meta" text-anchor="middle">still visible: key · model · size · timing · tokens</text>

          <g class="pk">
            <g v-for="c in [{ t: m.ask, p: l.out, w: out }, { t: m.reply, p: l.back, w: back }]" :key="c.p" class="chip" :class="{ cipher: m.key === 'private' }" opacity="0">
              <rect x="-38" y="-10" width="76" height="20" rx="6" />
              <text x="0" y="3.4" text-anchor="middle">{{ c.t }}</text>
              <animateMotion :dur="`${D}s`" repeatCount="indefinite" :path="c.p" :keyTimes="c.w.keyTimes" :keyPoints="c.w.keyPoints" calcMode="linear" />
              <animate attributeName="opacity" :dur="`${D}s`" repeatCount="indefinite" :keyTimes="c.w.opTimes" :values="c.w.opValues" />
            </g>
          </g>
        </svg>
        <p class="note">{{ m.note }}</p>
      </div>
    </div>
  </figure>
</template>

<style scoped>
.lanes {
  display: grid;
  gap: 14px;
}

.lane {
  padding: 14px 14px 12px;
  border: 1px solid var(--vp-c-border);
  border-radius: 12px;
  background: var(--vp-c-bg-elv);
}

.lane.private {
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 45%, var(--vp-c-border));
}

.lane-h {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 4px 10px;
  margin: 0 0 6px !important;
  line-height: 1.4 !important;
}

.lane-h b {
  font-size: 15px;
  color: var(--vp-c-text-1);
}

.lane-h span {
  font-family: var(--vp-font-family-mono);
  font-stretch: 87.5%;
  font-size: 10.5px;
  font-weight: 600;
  color: var(--vp-c-text-3);
}

.note {
  margin: 8px 0 0 !important;
  font-size: 12.5px;
  line-height: 1.5 !important;
  color: var(--vp-c-text-2);
}

.sm {
  font-size: 14px;
}

.tall .sm {
  font-size: 13px;
}

.slash {
  stroke: var(--vp-c-brand-1);
  stroke-width: 2.4;
  stroke-linecap: round;
}

.meta {
  fill: var(--vp-c-text-3);
  font-family: var(--vp-font-family-mono);
  font-stretch: 87.5%;
  font-size: 9px;
}

.chip.cipher rect {
  fill: var(--vp-c-brand-1);
}

.chip.cipher text {
  fill: var(--vp-c-bg);
}

</style>
