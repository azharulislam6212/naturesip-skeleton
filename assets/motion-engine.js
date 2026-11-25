/**
 * @layer L2
 * Thin wrapper around the vendored Motion build. The library is fetched only
 * the first time something animates, and every helper becomes a no-op when the
 * visitor prefers reduced motion.
 */
import { prefersReducedMotion } from '@theme/utilities';

/** @type {Promise<typeof import('./motion.js')> | null} */
let loading = null;

export function loadMotion() {
  loading ??= import('@theme/motion');
  return loading;
}

const EASE_OUT = [0.22, 1, 0.36, 1];

/**
 * 'slide-start' / 'slide-end' follow the reading direction: in RTL the start
 * side is the right, so the two presets swap.
 * @param {string} name
 */
function logicalPreset(name) {
  if (document.documentElement.dir !== 'rtl') return name;
  if (name === 'slide-start') return 'slide-end';
  if (name === 'slide-end') return 'slide-start';
  return name;
}

/**
 * Entrance presets. Only transform and opacity are animated so nothing ever
 * triggers layout.
 * @type {Record<string, { from: Record<string, any>, to: Record<string, any> }>}
 */
export const PRESETS = {
  fade: { from: { opacity: 0 }, to: { opacity: 1 } },
  rise: { from: { opacity: 0, transform: 'translateY(32px)' }, to: { opacity: 1, transform: 'none' } },
  zoom: { from: { opacity: 0, transform: 'scale(0.94)' }, to: { opacity: 1, transform: 'none' } },
  'slide-start': { from: { opacity: 0, transform: 'translateX(-40px)' }, to: { opacity: 1, transform: 'none' } },
  'slide-end': { from: { opacity: 0, transform: 'translateX(40px)' }, to: { opacity: 1, transform: 'none' } },
  'zoom-out': { from: { opacity: 0, transform: 'scale(1.12)' }, to: { opacity: 1, transform: 'none' } },
};

/**
 * Plays an entrance preset on one or more elements.
 * @param {Element | Element[]} targets
 * @param {string} presetName
 * @param { { delay?: number, duration?: number, staggerBy?: number } } [options] seconds
 */
export async function playEntrance(targets, presetName, { delay = 0, duration = 0.7, staggerBy = 0 } = {}) {
  const list = Array.isArray(targets) ? targets : [targets];
  const preset = PRESETS[logicalPreset(presetName)] ?? PRESETS.fade;

  if (prefersReducedMotion()) {
    for (const element of list) Object.assign(/** @type {HTMLElement} */ (element).style, { opacity: '', transform: '' });
    return;
  }

  const { animate } = await loadMotion();
  const keyframes = Object.fromEntries(Object.keys(preset.to).map((key) => [key, [preset.from[key], preset.to[key]]]));
  const animations = list.map((element, index) =>
    animate(element, keyframes, { duration, delay: delay + index * staggerBy, ease: EASE_OUT })
  );
  await Promise.allSettled(animations.map((animation) => animation.finished));
  for (const element of list) Object.assign(/** @type {HTMLElement} */ (element).style, { opacity: '', transform: '' });
}

/**
 * Observes elements entering the viewport.
 * @param {Element | Element[]} targets
 * @param {(element: Element) => void} onEnter
 * @param { { amount?: number } } [options]
 */
export async function whenInView(targets, onEnter, { amount = 0.15 } = {}) {
  const { inView } = await loadMotion();
  return inView(targets, (element) => {
    onEnter(element);
  }, { amount });
}
