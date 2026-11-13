<script setup lang="ts">
// The gateway's request lifecycle, the seven steps of the Gateway spec, lit one after another.
const steps = [
  ['Authenticate', 'key signature, expiry, key epoch'],
  ['Validate', 'model, max_tokens, n, body size'],
  ['Pick the mode', 'standard or private'],
  ['Admit', 'a free call, or reserve credit'],
  ['Forward', "with InferNear's upstream key"],
  ['Meter', 'usage from a copy of the response'],
  ['Settle', 'charge on the ledger'],
];
</script>

<template>
  <figure class="dg dg-steps7" aria-label="The gateway's request lifecycle: authenticate, validate, pick the mode, admit, forward, meter, settle.">
    <ol class="track">
      <li v-for="(s, i) in steps" :key="s[0]" :style="{ '--i': i }">
        <span class="dot"><span>{{ i + 1 }}</span></span>
        <b>{{ s[0] }}</b>
        <small>{{ s[1] }}</small>
      </li>
    </ol>
  </figure>
</template>

<style scoped>
.track {
  position: relative;
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 8px;
  margin: 0 !important;
  padding: 0 !important;
  list-style: none;
}

.track::before {
  content: '';
  position: absolute;
  top: 15px;
  left: 7%;
  right: 7%;
  height: 2px;
  background: var(--vp-c-border);
}

.track li {
  position: relative;
  display: grid;
  align-content: start;
  justify-items: center;
  gap: 4px;
  margin: 0 !important;
  text-align: center;
}

.dot {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 1.5px solid var(--vp-c-border);
  border-radius: 50%;
  background: var(--vp-c-bg-elv);
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  font-weight: 700;
  color: var(--vp-c-text-2);
  animation: lit 9.8s infinite;
  animation-delay: calc(var(--i) * 1.4s);
}

b {
  font-size: 13px;
  line-height: 1.3;
  color: var(--vp-c-text-1);
}

small {
  font-size: 11.5px;
  line-height: 1.4;
  color: var(--vp-c-text-3);
}

@keyframes lit {
  0% {
    border-color: var(--vp-c-border);
    background: var(--vp-c-bg-elv);
    color: var(--vp-c-text-2);
  }

  4%,
  12% {
    border-color: var(--vp-c-brand-1);
    background: var(--vp-c-brand-1);
    color: var(--vp-c-bg);
    box-shadow: 0 0 0 5px rgba(0, 236, 151, 0.18);
  }

  18%,
  100% {
    border-color: var(--vp-c-brand-1);
    background: var(--vp-c-bg-elv);
    color: var(--vp-c-brand-1);
    box-shadow: none;
  }
}

@container (max-width: 640px) {
  .track {
    grid-template-columns: minmax(0, 1fr);
    gap: 10px;
  }

  .track::before {
    top: 16px;
    bottom: 16px;
    left: 15px;
    right: auto;
    width: 2px;
    height: auto;
  }

  .track li {
    grid-template-columns: 32px minmax(0, 1fr);
    justify-items: start;
    align-items: center;
    column-gap: 12px;
    row-gap: 0;
    text-align: left;
  }

  .dot {
    grid-row: span 2;
  }
}
</style>
