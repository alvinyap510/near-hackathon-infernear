<script setup lang="ts">
// Five free trial calls, used one per call; after the fifth, calls are charged to credits.
// Each step shows the billing header the response carries, as the Free trial calls page lists it.
</script>

<template>
  <figure class="dg dg-pips" aria-label="Five free trial calls per wallet, used first. Each free response says X-InferNear-Billing: free with the calls remaining; after the fifth, responses say X-InferNear-Billing: credits.">
    <div class="row">
      <span v-for="i in 5" :key="i" class="pip" :style="{ '--i': i - 1 }" />
      <span class="then">then credits</span>
    </div>
    <div class="headers">
      <code v-for="i in 5" :key="i" class="h free" :style="{ '--i': i - 1 }">X-InferNear-Billing: free · X-InferNear-Free-Remaining: {{ 5 - i }}</code>
      <code class="h credits">X-InferNear-Billing: credits</code>
      <code class="h still">X-InferNear-Billing: free · X-InferNear-Free-Remaining: 3</code>
    </div>
  </figure>
</template>

<style scoped>
/* One call every 1.6 s: five free ones, a charged one, then a rest; 12 s in all. */
.row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.pip {
  width: 26px;
  height: 26px;
  border: 2px solid var(--vp-c-brand-1);
  border-radius: 50%;
  background: var(--vp-c-brand-1);
  animation: 12s infinite;
}

.pip:nth-child(1) { animation-name: use1; }
.pip:nth-child(2) { animation-name: use2; }
.pip:nth-child(3) { animation-name: use3; }
.pip:nth-child(4) { animation-name: use4; }
.pip:nth-child(5) { animation-name: use5; }

.then {
  margin-left: 6px;
  font-family: var(--vp-font-family-mono);
  font-stretch: 87.5%;
  font-size: 11px;
  font-weight: 600;
  color: var(--vp-c-text-3);
}

.headers {
  position: relative;
  height: 34px;
  margin-top: 14px;
}

.h {
  position: absolute;
  inset: 0 auto auto 0;
  padding: 6px 10px !important;
  border-radius: 8px !important;
  background: var(--vp-code-block-bg) !important;
  color: var(--in-snow, #f4f4f0) !important;
  font-size: 12px !important;
  white-space: nowrap;
  opacity: 0;
}

.h.free {
  animation: show 12s infinite;
  animation-delay: calc(var(--i) * 1.6s);
}

.h.credits {
  animation: show 12s infinite;
  animation-delay: 8s;
  color: var(--in-mint, #00ec97) !important;
}

.h.still {
  display: none;
}

/* Pip n is used with call n; all five refill together after the charged call. */
@keyframes use1 {
  0%, 1.7% { background: var(--vp-c-brand-1); }
  3.2%, 86% { background: transparent; }
  90%, 100% { background: var(--vp-c-brand-1); }
}

@keyframes use2 {
  0%, 15.0% { background: var(--vp-c-brand-1); }
  16.5%, 86% { background: transparent; }
  90%, 100% { background: var(--vp-c-brand-1); }
}

@keyframes use3 {
  0%, 28.3% { background: var(--vp-c-brand-1); }
  29.8%, 86% { background: transparent; }
  90%, 100% { background: var(--vp-c-brand-1); }
}

@keyframes use4 {
  0%, 41.7% { background: var(--vp-c-brand-1); }
  43.2%, 86% { background: transparent; }
  90%, 100% { background: var(--vp-c-brand-1); }
}

@keyframes use5 {
  0%, 55.0% { background: var(--vp-c-brand-1); }
  56.5%, 86% { background: transparent; }
  90%, 100% { background: var(--vp-c-brand-1); }
}

@keyframes show {
  0% { opacity: 0; }
  1.5%, 12% { opacity: 1; }
  13.5%, 100% { opacity: 0; }
}

/* Still picture: two calls used, three left, as the page's example shows. */
@media (prefers-reduced-motion: reduce) {
  .pip:nth-child(-n + 2) {
    background: transparent;
  }

  .h.still {
    display: block;
    opacity: 1;
  }
}

@container (max-width: 520px) {
  .h {
    white-space: normal;
    line-height: 1.5;
  }

  .headers {
    height: 60px;
  }
}
</style>
