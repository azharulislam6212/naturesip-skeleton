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
import { DialogToggleEvent, ScrollToEvent } from '@theme/events';
import { isDesignMode, isTouchDevice, prefersReducedMotion } from '@theme/utilities';

/** @type {any} */
let lenis = null;
let openDialogs = 0;

export async function initSmoothScroll() {
  if (lenis || prefersReducedMotion() || isDesignMode() || isTouchDevice()) return;

  const { default: Lenis } = await import('@theme/lenis');
  const lerp = Number(window.Theme?.settings?.smoothScrollLerp ?? 0.1);

  lenis = new Lenis({
    lerp,
    smoothWheel: true,
    syncTouch: false,
    anchors: { offset: -headerOffset() },
    // Read the scroll height live instead of caching it. The page keeps
    // growing after load (lazy images, fonts, recommendations, reveal
    // animations) and a cached height stopped the scroll before the footer end.
    naiveDimensions: true,
    // Open drawers / modals, the lightbox and marked scroll areas scroll on
    // their own. A closed <dialog> (the desktop filter sidebar shown in place)
    // must not, or the page stops scrolling while the cursor is over it.
    prevent: (/** @type {HTMLElement} */ node) =>
      node.closest('dialog[open], .pswp, [data-lenis-prevent]:not(dialog)') !== null,
    // Sideways gestures (trackpad swipes on sliders) stay native; Lenis only
    // takes up/down. So slider tracks need no data-lenis-prevent, and the page
    // keeps scrolling when the cursor passes over a slider.
    virtualScroll: (/** @type {{ deltaX: number, deltaY: number }} */ { deltaX, deltaY }) =>
      Math.abs(deltaY) >= Math.abs(deltaX),
  });

  const frame = (/** @type {number} */ time) => {
    lenis?.raf(time);
    window.requestAnimationFrame(frame);
  };
  window.requestAnimationFrame(frame);

  document.addEventListener(ScrollToEvent.eventName, (event) => {
    if (!lenis) return;
    lenis.scrollTo(event.detail.top);
    event.detail.handled = true;
  });

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
