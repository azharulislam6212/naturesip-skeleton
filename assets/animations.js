/**
 * @layer L3
 * Scroll-reveal for sections, blocks, headings and images.
 *
 * The entrances themselves are CSS animations (assets/base.css, "Animations"),
 * as in Dawn: whatever is on screen when the page paints animates straight
 * away, before any script runs, so content never shows first and then jumps.
 *
 * This module:
 *   - splits text for data-animate-text (words, chars, mask, blur); that text
 *     waits transparent until then, so it never shows whole first,
 *   - holds what is below the fold in its start state (data-animate-pending),
 *   - releases it as it scrolls into view, which restarts its CSS animation,
 *     with the stagger order of the batch entering view together.
 *
 * Markup (snippets/animation-attributes.liquid):
 *   data-animate="reveal"        entrance preset
 *   data-animate-text="mask"     split text mode
 *   data-animate-delay="150"     extra delay in ms
 *   data-animate-stagger         on a parent: children play one after another
 *
 * Theme editor: a re-rendered section replays the animations on screen, as
 * its new markup gets the CSS animation again.
 */
import { ContentUpdateEvent } from '@theme/events';
import { prefersReducedMotion } from '@theme/utilities';

const SELECTOR = '[data-animate]:not([data-animated]):not([data-animate="none"])';

/** Max stagger steps in one batch, so long grids never wait seconds to show. */
const MAX_STAGGER = 6;

/** Most stagger steps a split text takes, however long it is. */
const MAX_PIECE_STEPS = 40;

/**
 * @param {string} className
 * @param {string} [text]
 */
function span(className, text = '') {
  const element = document.createElement('span');
  element.className = className;
  element.textContent = text;
  return element;
}

/**
 * One word's markup. Letters stay inside a word span so lines still wrap
 * between words only.
 * @param {string} word
 * @param {string} mode
 */
function buildWord(word, mode) {
  if (mode === 'chars') {
    const wrapper = span('word');
    for (const char of word) wrapper.append(span('char animate-piece', char));
    return wrapper;
  }
  const piece = span('word animate-piece', word);
  if (mode !== 'mask') return piece;
  const mask = span('word-mask');
  mask.append(piece);
  return mask;
}

/**
 * Splits every text node into words (or letters), keeping nested markup
 * (links, <em>, <strong>) intact, and numbers the pieces. Runs once.
 * @param {Element} element
 * @param {string} mode
 */
function splitText(element, mode) {
  if (element.hasAttribute('data-split')) return;

  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  /** @type {Text[]} */
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(/** @type {Text} */ (walker.currentNode));

  // Screen readers would spell out split letters: give them the whole text.
  if (mode === 'chars' && !element.querySelector('a, button')) {
    element.setAttribute('aria-label', element.textContent?.trim() ?? '');
  }

  for (const node of textNodes) {
    const fragment = document.createDocumentFragment();
    for (const part of (node.nodeValue ?? '').split(/(\s+)/)) {
      if (!part) continue;
      fragment.append(/^\s+$/.test(part) ? part : buildWord(part, mode));
    }
    node.replaceWith(fragment);
  }

  const pieces = [...element.querySelectorAll('.animate-piece')];
  const perStep = Math.max(1, pieces.length / MAX_PIECE_STEPS);
  pieces.forEach((piece, index) => {
    /** @type {HTMLElement} */ (piece).style.setProperty('--piece-index', String(Math.floor(index / perStep)));
  });
  element.setAttribute('data-split', mode);
}

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

/**
 * Resolves once the element's images have loaded (or failed, or after a
 * moment), so an entrance never plays on an empty box. Null when ready now.
 * @param {Element} element
 */
function imagesReady(element) {
  const images = [...element.querySelectorAll('img')].filter((image) => !image.complete);
  if (!images.length) return null;
  const loaded = images.map(
    (image) =>
      new Promise((resolve) => {
        image.addEventListener('load', resolve, { once: true });
        image.addEventListener('error', resolve, { once: true });
      })
  );
  return Promise.race([Promise.all(loaded), new Promise((resolve) => setTimeout(resolve, 1500))]);
}

/** @param {Element} element */
function releaseWhenReady(element) {
  const ready = imagesReady(element);
  if (ready) ready.then(() => release(element));
  else release(element);
}

const observer =
  'IntersectionObserver' in window
    ? new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            observer?.unobserve(entry.target);
            releaseWhenReady(entry.target);
          }
        },
        // Any part of the element 10% above the viewport's bottom edge: tall
        // elements still trigger, and the motion is seen, not finished below.
        { rootMargin: '0px 0px -10% 0px', threshold: 0 }
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
    const mode = element.getAttribute('data-animate-text');
    const onScreen = isOnScreen(element);

    // Split text waits transparent for this script (base.css). If the
    // failsafe already showed it, the visitor has seen it: leave it.
    if (mode && onScreen && getComputedStyle(element).opacity !== '0') {
      element.setAttribute('data-animated', '');
      continue;
    }

    if (!onScreen) {
      element.setAttribute('data-animate-pending', '');
      if (mode) splitText(element, mode);
      observer.observe(element);
      continue;
    }

    // On screen: split text plays now; anything else has been playing its
    // CSS animation since the first paint, unless it still waits for an
    // image, then it plays again once that is in.
    const ready = mode ? null : imagesReady(element);
    if (!mode && !ready) {
      element.setAttribute('data-animated', '');
      continue;
    }
    element.setAttribute('data-animate-pending', '');
    if (mode) splitText(element, mode);
    if (ready) ready.then(() => release(element));
    else release(element);
  }
}

/**
 * First run, once the page is in place: after a reload's scroll restore
 * (snippets/scroll-restore.liquid) and once the web fonts are in (briefly),
 * so split text never animates in a fallback font and then reflows.
 */
export async function startAnimations() {
  if (document.documentElement.classList.contains('is-restoring-scroll')) {
    await new Promise((resolve) => document.addEventListener('theme:scroll-restored', resolve, { once: true }));
  }
  await Promise.race([document.fonts?.ready, new Promise((resolve) => setTimeout(resolve, 1500))]);
  initAnimations(document);
}

document.addEventListener(ContentUpdateEvent.eventName, (event) => initAnimations(event.detail.root));
document.addEventListener('shopify:section:load', (event) => initAnimations(/** @type {Element} */ (event.target)));
