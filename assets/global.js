/**
 * @layer L4
 * Entry point. Owns no features: it lazy-loads the module that defines each
 * custom element the first time that element needs to work, and starts the
 * optional enhancements (animations, smooth scroll) after the page is idle.
 *
 * Loading strategies:
 *   eager        import as soon as the element is in the DOM
 *   visible      import when an instance comes near the viewport
 *   interaction  import on the first pointer, focus or touch on an instance
 *
 * A MutationObserver covers markup inserted later (Section Rendering API,
 * quick view, the theme editor), so sections never need inline <script>s.
 */
import { isDesignMode, onIdle } from '@theme/utilities';

/** @type {Record<string, { module: string, load: 'eager' | 'visible' | 'interaction' }>} */
const REGISTRY = {
  'header-component': { module: '@theme/header', load: 'eager' },
  'header-menu': { module: '@theme/header', load: 'interaction' },
  'header-drawer': { module: '@theme/header', load: 'interaction' },
  'search-modal': { module: '@theme/predictive-search', load: 'interaction' },
  'predictive-search': { module: '@theme/predictive-search', load: 'interaction' },
  'dialog-component': { module: '@theme/dialog', load: 'interaction' },
  'custom-select': { module: '@theme/custom-select', load: 'visible' },
  'slider-component': { module: '@theme/carousel', load: 'visible' },
  'cart-drawer': { module: '@theme/cart-drawer', load: 'eager' },
  'scroll-to-top': { module: '@theme/scroll-to-top', load: 'eager' },
  'cart-items': { module: '@theme/cart', load: 'interaction' },
  'product-form': { module: '@theme/product-form', load: 'interaction' },
  'variant-picker': { module: '@theme/variant-picker', load: 'interaction' },
  'media-gallery': { module: '@theme/media-gallery', load: 'visible' },
  'quantity-selector': { module: '@theme/quantity-selector', load: 'interaction' },
  'facets-form': { module: '@theme/facets', load: 'interaction' },
  'price-range': { module: '@theme/facets', load: 'interaction' },
  'pagination-component': { module: '@theme/pagination', load: 'eager' },
  'product-recommendations': { module: '@theme/product-recommendations', load: 'visible' },
  'quick-view-button': { module: '@theme/quick-view', load: 'interaction' },
  'quick-view-dialog': { module: '@theme/quick-view', load: 'interaction' },
  'localization-form': { module: '@theme/store-utilities', load: 'interaction' },
  'pickup-availability': { module: '@theme/store-utilities', load: 'visible' },
  'address-form': { module: '@theme/store-utilities', load: 'visible' },
  'deferred-media': { module: '@theme/store-utilities', load: 'interaction' },
  'marquee-banner': { module: '@theme/store-utilities', load: 'interaction' },
  'share-copy': { module: '@theme/store-utilities', load: 'visible' },
};

/** @type {Map<string, Promise<unknown>>} */
const modules = new Map();
/** @type {WeakSet<Element>} */
const seen = new WeakSet();
const debug = isDesignMode();

/** @param {string} tag */
function load(tag) {
  const entry = REGISTRY[tag];
  if (!entry) return;
  if (!modules.has(entry.module)) {
    const promise = import(entry.module).catch((error) => {
      modules.delete(entry.module);
      console.error(`[theme] could not load ${entry.module}`, error);
    });
    modules.set(entry.module, promise);
  }
}

const visibility = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    visibility.unobserve(entry.target);
    load(entry.target.localName);
  }
}, { rootMargin: '300px 0px' });

/** @param {Element} element */
function onFirstInteraction(element) {
  const controller = new AbortController();
  const trigger = () => {
    controller.abort();
    load(element.localName);
  };
  for (const type of ['pointerenter', 'focusin', 'touchstart']) {
    element.addEventListener(type, trigger, { passive: true, signal: controller.signal });
  }
}

/** @param {Element} element */
function register(element) {
  if (seen.has(element)) return;
  seen.add(element);

  const entry = REGISTRY[element.localName];
  if (!entry) {
    if (debug && !customElements.get(element.localName)) {
      queueMicrotask(() => {
        if (!customElements.get(element.localName)) console.warn(`[theme] <${element.localName}> has no loader entry`);
      });
    }
    return;
  }
  if (modules.has(entry.module)) return;
  if (entry.load === 'eager') load(element.localName);
  else if (entry.load === 'visible') visibility.observe(element);
  else onFirstInteraction(element);
}

/** @param {ParentNode} root */
function scan(root) {
  if (root instanceof Element && root.localName.includes('-')) register(root);
  for (const element of root.querySelectorAll('*')) {
    if (element.localName.includes('-')) register(element);
  }
}

scan(document.body);
new MutationObserver((records) => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (node instanceof Element) scan(node);
    }
  }
}).observe(document.body, { childList: true, subtree: true });

document.addEventListener('shopify:section:load', (event) => {
  if (event.target instanceof Element) scan(event.target);
});

// Dialog openers: `data-dialog-open="<dialog id>"` works even before the
// owning element's module has loaded (the first click loads it).
document.addEventListener('click', async (event) => {
  const opener = /** @type {Element} */ (event.target).closest('[data-dialog-open]');
  if (!(opener instanceof HTMLElement)) return;
  const dialog = document.getElementById(opener.dataset.dialogOpen ?? '');
  const owner = dialog?.closest('dialog-component, cart-drawer, header-drawer, search-modal, quick-view-dialog');
  if (!owner) return;
  event.preventDefault();
  load(owner.localName);
  await customElements.whenDefined(owner.localName);
  /** @type {any} */ (owner).open(opener);
});

// Entrance animations start right away: above-the-fold content is hidden until they run.
if (window.Theme?.settings?.animations) {
  import('@theme/animations').then(({ startAnimations }) => startAnimations());
}

// Optional enhancements, after the page has settled.
onIdle(() => {
  const settings = window.Theme?.settings ?? {};
  if (settings.smoothScroll) import('@theme/smooth-scroll').then(({ initSmoothScroll }) => initSmoothScroll());
});
