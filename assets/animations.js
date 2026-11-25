/**
 * @layer L3
 * Scroll-reveal for sections, blocks, headings and images.
 *
 * Markup (written by Liquid, see snippets/animation-attributes.liquid):
 *   data-animate="rise"          entrance preset (fade, rise, zoom, slide-start, slide-end, zoom-out)
 *   data-animate-text="words"    reveal a heading word by word
 *   data-animate-delay="150"     extra delay in ms
 *   data-animate-stagger         on a parent: children animate one after another
 *
 * Content is always visible without JavaScript. Elements that are already on
 * screen when the page loads are never hidden (protects LCP and avoids a
 * flash). Under prefers-reduced-motion nothing is hidden or moved.
 */
import { playEntrance, whenInView } from '@theme/motion-engine';
import { ContentUpdateEvent } from '@theme/events';
import { isDesignMode, prefersReducedMotion } from '@theme/utilities';

const STAGGER_STEP = 0.08;

/** @param {Element} element */
function isOnScreen(element) {
  const rect = element.getBoundingClientRect();
  return rect.top < window.innerHeight && rect.bottom > 0;
}

/**
 * Wraps each word of every text node in a span, keeping nested markup
 * (links, <em>, <strong>) intact. Screen readers still read whole words.
 * @param {Element} element
 */
function splitWords(element) {
  if (element.hasAttribute('data-split')) return [...element.querySelectorAll('.word')];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  /** @type {Text[]} */
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(/** @type {Text} */ (walker.currentNode));

  for (const node of textNodes) {
    const parts = (node.nodeValue ?? '').split(/(\s+)/);
    const fragment = document.createDocumentFragment();
    for (const part of parts) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        fragment.append(part);
      } else {
        const word = document.createElement('span');
        word.className = 'word';
        word.textContent = part;
        fragment.append(word);
      }
    }
    node.replaceWith(fragment);
  }
  element.setAttribute('data-split', '');
  return [...element.querySelectorAll('.word')];
}

/** @param {Element} element */
function reveal(element) {
  const preset = element.getAttribute('data-animate') || 'fade';
  const delay = Number(element.getAttribute('data-animate-delay') || 0) / 1000;
  const parent = element.parentElement?.closest('[data-animate-stagger]');
  const siblings = parent ? [...parent.querySelectorAll(':scope > [data-animate], :scope > * > [data-animate]')] : [];
  const order = Math.max(0, siblings.indexOf(element));

  element.removeAttribute('data-animate-pending');
  element.setAttribute('data-animated', '');

  if (element.getAttribute('data-animate-text') === 'words') {
    const words = splitWords(element);
    playEntrance(words, 'rise', { delay: delay + order * STAGGER_STEP, duration: 0.6, staggerBy: 0.04 });
    return;
  }
  playEntrance(element, preset, { delay: delay + order * STAGGER_STEP });
}

/** @param {ParentNode} root */
export function initAnimations(root = document) {
  if (prefersReducedMotion() || isDesignMode()) return;

  const elements = [...root.querySelectorAll('[data-animate]:not([data-animated]):not([data-animate="none"])')];
  /** @type {Element[]} */
  const pending = [];

  for (const element of elements) {
    if (isOnScreen(element)) {
      element.setAttribute('data-animated', '');
    } else {
      element.setAttribute('data-animate-pending', '');
      if (element.getAttribute('data-animate-text') === 'words') splitWords(element);
      pending.push(element);
    }
  }

  document.documentElement.classList.add('animations-ready');
  if (pending.length) whenInView(pending, reveal);
}

document.addEventListener(ContentUpdateEvent.eventName, (event) => initAnimations(event.detail.root));
document.addEventListener('shopify:section:load', (event) => initAnimations(/** @type {Element} */ (event.target)));
