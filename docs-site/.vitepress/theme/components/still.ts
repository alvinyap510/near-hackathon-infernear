import { onMounted, type Ref } from 'vue';

/**
 * With reduced motion, freezes every SMIL timeline in the diagram on one complete frame (`at`, in
 * seconds). CSS already hides the moving packets from the first paint; this only stops the work
 * and picks the frame. Runs after mount, so nothing touches `window` during server rendering.
 */
export function useStill(root: Ref<HTMLElement | null>, at: number) {
  onMounted(() => {
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    root.value?.querySelectorAll('svg').forEach((svg) => {
      svg.pauseAnimations();
      svg.setCurrentTime(at);
    });
  });
}

/** keyTimes for a SMIL timeline of `dur` seconds, from times in seconds. */
export const kt = (dur: number, ...times: number[]) => times.map((t) => +(t / dur).toFixed(4)).join(';');

/**
 * A packet that is visible and moves only between `from` and `to` seconds of a `dur` loop:
 * keyTimes and keyPoints for animateMotion, and an opacity track for animate.
 */
export function windowed(dur: number, from: number, to: number) {
  const fade = Math.min(0.15, (to - from) / 6);
  return {
    keyTimes: kt(dur, 0, from, to, dur),
    keyPoints: '0;0;1;1',
    opTimes: kt(dur, 0, from, from + fade, to - fade, to, dur),
    opValues: '0;0;1;1;0;0',
  };
}
