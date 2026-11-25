/**
 * @layer L3
 * Optional smooth scrolling with Lenis. Only started when the theme setting
 * is on, never under prefers-reduced-motion, never in the theme editor and
 * never on touch-first devices (native momentum scrolling stays).
 *
 * Lenis drives the real document scroll position, so keyboard scrolling,
 * focus-into-view and find-in-page keep working. Anything that scrolls on
 * its own (drawers, dialogs, the lightbox, sliders) carries
 * `data-lenis-prevent`, and Lenis pauses while a modal is open.
 */
import { DialogToggleEvent } from '@theme/events';
import { isDesignMode, isTouchDevice, prefersReducedMotion } from '@theme/utilities';

/** @type {any} */
let lenis = null;
let openDialogs = 0;

export async function initSmoothScroll() {
  if (lenis || prefersReducedMotion() || isDesignMode() || isTouchDevice()) return;

  const { default: Lenis } = await import('@theme/vendor-lenis');
  const lerp = Number(window.Theme?.settings?.smoothScrollLerp ?? 0.1);

  lenis = new Lenis({
    lerp,
    smoothWheel: true,
    syncTouch: false,
    anchors: { offset: -headerOffset() },
    prevent: (/** @type {HTMLElement} */ node) => node.closest('dialog, .pswp, [data-lenis-prevent]') !== null,
  });

  const frame = (/** @type {number} */ time) => {
    lenis?.raf(time);
    window.requestAnimationFrame(frame);
  };
  window.requestAnimationFrame(frame);

  document.addEventListener(DialogToggleEvent.eventName, (event) => {
    openDialogs = Math.max(0, openDialogs + (event.detail.open ? 1 : -1));
    if (openDialogs > 0) lenis?.stop();
    else lenis?.start();
  });

  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (event) => {
    if (event.matches) destroySmoothScroll();
  });
}

export function destroySmoothScroll() {
  lenis?.destroy();
  lenis = null;
}

function headerOffset() {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--header-height');
  return Number.parseFloat(value) || 0;
}
