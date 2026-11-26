/**
 * @layer L3
 * Scroll-reveal for sections, blocks, headings and images.
 *
 * Markup (written by Liquid, see snippets/animation-attributes.liquid):
 *   data-animate="rise"          entrance preset (fade, fade-up, rise, zoom, zoom-out,
 *                                slide-start, slide-end, blur, clip-up, flip-up)
 *   data-animate-text="words"    split text: words, chars, mask or blur
 *   data-animate-delay="150"     extra delay in ms
 *   data-animate-stagger         on a parent: children animate one after another
 *
 * Everything animates as it enters the viewport, including what is already on
 * screen at load or reload (after the restored scroll position settles). CSS hides armed elements before this runs and shows them
 * anyway if it never does. Under prefers-reduced-motion nothing is hidden.
 *
 * Theme editor: a section the editor re-renders (any setting change) replays
 * its animations, so a changed animation setting is previewed straight away.
 */
import { playEntrance, whenInView } from '@theme/motion-engine';
import { ContentUpdateEvent } from '@theme/events';
import { prefersReducedMotion } from '@theme/utilities';

const STAGGER_STEP = 0.15;

/** Max stagger steps in one batch, so long grids never wait seconds to show. */
const MAX_STAGGER = 6;

/**
 * How each text mode plays on its split pieces.
 * @type {Record<string, { preset: string, duration: number, staggerBy: number }>}
 */
const TEXT_MODES = {
  words: { preset: 'rise', duration: 0.6, staggerBy: 0.04 },
  chars: { preset: 'fade-up', duration: 0.5, staggerBy: 0.025 },
  mask: { preset: 'text-mask', duration: 0.8, staggerBy: 0.05 },
  blur: { preset: 'text-blur', duration: 0.8, staggerBy: 0.05 },
};

/** Longest a split text may take to finish staggering, in seconds. */
const MAX_TEXT_STAGGER = 1.2;

/**
 * @param {string} className
 * @param {string} text
 */
function span(className, text = '') {
  const element = document.createElement('span');
  element.className = className;
  element.textContent = text;
  return element;
}

/**
 * Builds the pieces for one word. Letters stay inside a word span so lines
 * still wrap between words only.
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
 * (links, <em>, <strong>) intact. Runs once per element.
 * @param {Element} element
 * @param {string} mode
 */
function splitText(element, mode) {
  if (!element.hasAttribute('data-split')) {
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
    element.setAttribute('data-split', mode);
  }
  return [...element.querySelectorAll('.animate-piece')];
}

/** @type {WeakMap<Element, number>} stagger parent → cards revealed this frame */
const staggerBatches = new WeakMap();

/**
 * Stagger order among the siblings entering view together, not the element's
 * index in the whole list: a card deep in a long (or infinitely growing) grid
 * would otherwise wait index × step seconds and leave empty rows.
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

/** Elements whose own gradient is clipped to their text. */
const GRADIENT_TEXT = '.text-gradient, .highlight-gradient em';

/**
 * Gradient text: a parent's background-clip: text can't follow pieces that
 * move on their own layer (Chrome paints the fill at the old place, apart from
 * the stroke). While they animate, each piece paints its own slice of the
 * parent's gradient, so the text still reads as one continuous gradient.
 * Returns a function that hands the gradient back to the parent.
 * @param {Element} element
 * @param {Element[]} pieces
 */
function sliceGradient(element, pieces) {
  const owners = new Map();
  for (const piece of pieces) {
    const owner = piece.parentElement?.closest(GRADIENT_TEXT);
    if (!owner || !element.contains(owner)) continue;
    if (!owners.has(owner)) {
      owners.set(owner, { rect: owner.getBoundingClientRect(), image: getComputedStyle(owner).backgroundImage });
    }
    const { rect, image } = owners.get(owner);
    const box = piece.getBoundingClientRect();
    Object.assign(/** @type {HTMLElement} */ (piece).style, {
      backgroundImage: image,
      backgroundSize: `${rect.width}px ${rect.height}px`,
      backgroundPosition: `${rect.left - box.left}px ${rect.top - box.top}px`,
    });
    piece.setAttribute('data-slice', '');
  }
  for (const owner of owners.keys()) owner.setAttribute('data-sliced', '');

  return () => {
    for (const owner of owners.keys()) owner.removeAttribute('data-sliced');
    for (const piece of pieces) {
      if (!piece.hasAttribute('data-slice')) continue;
      piece.removeAttribute('data-slice');
      Object.assign(/** @type {HTMLElement} */ (piece).style, { backgroundImage: '', backgroundSize: '', backgroundPosition: '' });
    }
  };
}

/** @param {Element} element */
function reveal(element) {
  const preset = element.getAttribute('data-animate') || 'fade';
  const delay = Number(element.getAttribute('data-animate-delay') || 0) / 1000 + staggerOrder(element) * STAGGER_STEP;
  const mode = TEXT_MODES[element.getAttribute('data-animate-text') ?? ''];

  element.removeAttribute('data-animate-pending');
  element.setAttribute('data-animated', '');

  if (mode) {
    const pieces = splitText(element, /** @type {string} */ (element.getAttribute('data-animate-text')));
    const staggerBy = Math.min(mode.staggerBy, MAX_TEXT_STAGGER / Math.max(pieces.length, 1));
    const restoreGradient = sliceGradient(element, pieces);
    playEntrance(pieces, mode.preset, { delay, duration: mode.duration, staggerBy }).then(restoreGradient);
    return;
  }
  playEntrance(element, preset, { delay });
}

/** Resolves once a reload's scroll restore (snippets/scroll-restore.liquid) has put the page in place. */
async function pageSettled() {
  if (!document.documentElement.classList.contains('is-restoring-scroll')) return;
  await new Promise((resolve) => document.addEventListener('theme:scroll-restored', resolve, { once: true }));
}

/**
 * Hides every not-yet-animated element under root (text is split first, so
 * only its pieces are hidden) and returns them.
 * @param {ParentNode} root
 */
function arm(root) {
  const selector = '[data-animate]:not([data-animated]):not([data-animate="none"])';
  const elements = [...root.querySelectorAll(selector)];
  if (root instanceof Element && root.matches(selector)) elements.unshift(root);

  for (const element of elements) {
    const mode = element.getAttribute('data-animate-text');
    if (mode && mode in TEXT_MODES) splitText(element, mode);
    element.setAttribute('data-animate-pending', '');
  }
  document.documentElement.classList.add('animations-ready');
  return elements;
}

/** @param {ParentNode} [root] */
export function initAnimations(root = document) {
  if (prefersReducedMotion()) return;
  const elements = arm(root);
  if (elements.length) whenInView(elements, reveal);
}

/** First run: arm everything now, reveal once the page has settled. */
export async function startAnimations() {
  if (prefersReducedMotion()) return;
  const elements = arm(document);
  await pageSettled();
  if (elements.length) whenInView(elements, reveal);
}

document.addEventListener(ContentUpdateEvent.eventName, (event) => initAnimations(event.detail.root));
document.addEventListener('shopify:section:load', (event) => initAnimations(/** @type {Element} */ (event.target)));
