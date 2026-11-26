/**
 * @layer L3
 * Scroll-reveal for sections, blocks, headings and images.
 *
 * The entrances themselves are CSS animations (assets/base.css, "Animations"),
 * as in Dawn: whatever is on screen when the page paints animates straight
 * away, before any script runs, so content never shows first and then jumps.
 *
 * Split text is split in Liquid too (snippets/split-text.liquid), so it
 * plays from the first paint with everything else.
 *
 * This module:
 *   - holds what is below the fold in its start state (data-animate-pending),
 *   - releases it as it scrolls into view, which restarts its CSS animation,
 *     with the stagger order of the batch entering view together,
 *   - lets split gradient text keep its gradient while its pieces move.
 *
 * Markup (snippets/animation-attributes.liquid):
 *   data-animate="reveal"        entrance preset
 *   data-animate-text="mask"     split text mode (data-split once split)
 *   data-animate-delay="150"     extra delay in ms
 *   data-animate-stagger         on a parent: children play one after another
 *
 * Theme editor: a re-rendered section replays the animations on screen, as
 * its new markup gets the CSS animation again.
 */
import { ContentUpdateEvent } from '@theme/events';
import { prefersReducedMotion } from '@theme/utilities';

const SELECTOR = '[data-animate]:not([data-animated]):not([data-animate="none"])';

/** Max stagger steps in one batch (75ms each), so long grids never wait to show. */
const MAX_STAGGER = 7;

/** Elements whose own gradient is clipped to their text. */
const GRADIENT_TEXT = '.text-gradient, .highlight-gradient em';

/**
 * Gradient text: a parent's background-clip: text can't follow pieces that
 * move on their own layer (the fill would paint apart from the stroke).
 * While they animate, each piece paints its own slice of the parent's
 * gradient, so the text still reads as one gradient; afterwards the parent
 * takes it back.
 * @param {Element} element
 */
function sliceGradient(element) {
  const pieces = /** @type {HTMLElement[]} */ ([...element.querySelectorAll('.animate-piece')]);
  /** @type {Map<HTMLElement, string>} */
  const owners = new Map();
  for (const piece of pieces) {
    const owner = /** @type {HTMLElement | null} */ (piece.parentElement?.closest(GRADIENT_TEXT) ?? null);
    if (!owner || !element.contains(owner)) continue;
    if (!owners.has(owner)) owners.set(owner, getComputedStyle(owner).backgroundImage);

    // Offsets ignore transforms, so this holds while pieces sit in their start state.
    const x = piece.offsetParent === owner ? piece.offsetLeft : piece.offsetLeft - owner.offsetLeft;
    const y = piece.offsetParent === owner ? piece.offsetTop : piece.offsetTop - owner.offsetTop;
    Object.assign(piece.style, {
      backgroundImage: owners.get(owner),
      backgroundSize: `${owner.offsetWidth}px ${owner.offsetHeight}px`,
      backgroundPosition: `${-x}px ${-y}px`,
    });
    piece.setAttribute('data-slice', '');
  }
  if (!owners.size) return;
  for (const owner of owners.keys()) owner.setAttribute('data-sliced', '');

  pieces.at(-1)?.addEventListener(
    'animationend',
    () => {
      for (const owner of owners.keys()) owner.removeAttribute('data-sliced');
      for (const piece of pieces) {
        piece.removeAttribute('data-slice');
        Object.assign(/** @type {HTMLElement} */ (piece).style, { backgroundImage: '', backgroundSize: '', backgroundPosition: '' });
      }
    },
    { once: true }
  );
}

/** @type {WeakMap<Element, number>} stagger parent → elements released this frame */
const staggerBatches = new WeakMap();

/**
 * Order among the siblings entering view together, not the index in the
 * whole list: a card deep in a long grid would otherwise wait for nothing.
 * @param {Element} element
 */
function staggerOrder(element) {
  const parent = element.parentElement?.closest('[data-animate-stagger]');
  if (!parent) return 0;
  const order = staggerBatches.get(parent) ?? 0;
  if (order === 0) requestAnimationFrame(() => staggerBatches.delete(parent));
  staggerBatches.set(parent, order + 1);
  return Math.min(order, MAX_STAGGER);
}

/** @param {Element} element */
function release(element) {
  /** @type {HTMLElement} */ (element).style.setProperty('--stagger-index', String(staggerOrder(element)));
  if (element.hasAttribute('data-split')) sliceGradient(element);

  // Dropping the attribute starts the element's (or its pieces') CSS animation.
  element.removeAttribute('data-animate-pending');
  element.setAttribute('data-animated', '');
}

const observer =
  'IntersectionObserver' in window
    ? new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            observer?.unobserve(entry.target);
            release(entry.target);
          }
        },
        // Plays once any part is 50px above the viewport's bottom edge.
        { rootMargin: '0px 0px -50px 0px', threshold: 0 }
      )
    : null;

/**
 * On screen by its layout position. getBoundingClientRect() would include the
 * entrance transform it is playing (a mask reveal starts a full height lower).
 * Hidden elements (closed drawers) count as off screen.
 * @param {Element} element
 */
function isOnScreen(element) {
  if (!(element instanceof HTMLElement) || !element.offsetParent) return false;
  let top = 0;
  for (let node = /** @type {HTMLElement | null} */ (element); node; node = /** @type {HTMLElement | null} */ (node.offsetParent)) {
    top += node.offsetTop;
  }
  top -= window.scrollY;
  return top < window.innerHeight && top + element.offsetHeight > 0;
}

/**
 * What is on screen keeps the CSS animation it already started; everything
 * else is held back until it scrolls in.
 * @param {ParentNode} [root]
 */
export function initAnimations(root = document) {
  if (prefersReducedMotion() || !observer) return;

  const elements = [...root.querySelectorAll(SELECTOR)];
  if (root instanceof Element && root.matches(SELECTOR)) elements.unshift(root);

  for (const element of elements) {
    if (isOnScreen(element)) {
      // Playing its CSS animation since the first paint: keep it.
      if (element.hasAttribute('data-split')) sliceGradient(element);
      element.setAttribute('data-animated', '');
      continue;
    }
    element.setAttribute('data-animate-pending', '');
    observer.observe(element);
  }
}

/** First run, once the page is in place (after a reload's scroll restore, snippets/scroll-restore.liquid). */
export async function startAnimations() {
  if (document.documentElement.classList.contains('is-restoring-scroll')) {
    await new Promise((resolve) => document.addEventListener('theme:scroll-restored', resolve, { once: true }));
  }
  initAnimations(document);
}

document.addEventListener(ContentUpdateEvent.eventName, (event) => initAnimations(event.detail.root));
document.addEventListener('shopify:section:load', (event) => initAnimations(/** @type {Element} */ (event.target)));
