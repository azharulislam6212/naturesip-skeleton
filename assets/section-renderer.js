/**
 * @layer L2
 * Section Rendering API client.
 *
 *   const html = await fetchSection('template--123__main', url);
 *   applySections(response.sections);   // from /cart/*.js `sections` responses
 */
import { morph } from '@theme/morph';
import { ContentUpdateEvent } from '@theme/events';

/** @type {Map<string, Promise<string>>} */
const cache = new Map();
const parser = new DOMParser();

/**
 * Fetches one section rendered for `url` (defaults to the current page).
 * Identical in-flight requests are shared; pass `cache: false` for cart data.
 * @param {string} sectionId
 * @param {string} [url]
 * @param { { signal?: AbortSignal, useCache?: boolean } } [options]
 */
export function fetchSection(sectionId, url = window.location.href, { signal, useCache = true } = {}) {
  const requestUrl = new URL(url, window.location.origin);
  requestUrl.searchParams.set('section_id', sectionId);
  const key = requestUrl.toString();

  if (useCache && cache.has(key)) return /** @type {Promise<string>} */ (cache.get(key));

  const request = fetch(key, { signal }).then((response) => {
    if (!response.ok) throw new Error(`Section ${sectionId} failed with ${response.status}`);
    return response.text();
  });
  if (useCache) {
    cache.set(key, request);
    request.catch(() => cache.delete(key));
  }
  return request;
}

/** @param {string} html */
export function parseHTML(html) {
  return parser.parseFromString(html, 'text/html');
}

/**
 * Morphs the parts of `target` matched by `selectors` with the same parts of
 * freshly rendered `html`. With no selectors the whole section is morphed.
 * @param {Element} target
 * @param {string} html
 * @param {string[]} [selectors]
 */
export function updateFromHTML(target, html, selectors = []) {
  const doc = parseHTML(html);
  const source = doc.querySelector('.shopify-section') ?? doc.body.firstElementChild;
  if (!source) return;

  if (selectors.length === 0) {
    morph(target, source, { childrenOnly: true });
  } else {
    for (const selector of selectors) {
      const from = target.querySelector(selector);
      const to = source.querySelector(selector);
      if (from && to) morph(from, to);
    }
  }
  target.dispatchEvent(new ContentUpdateEvent({ root: target }));
}

/**
 * Applies the `sections` object returned by the Cart Ajax API. A section is
 * applied to `#shopify-section-<id>` and to any `[data-section-target="<id>"]`.
 * @param {Record<string, string | null> | undefined} sections
 */
export function applySections(sections) {
  if (!sections) return;
  for (const [id, html] of Object.entries(sections)) {
    if (!html) continue;
    const targets = [
      document.getElementById(`shopify-section-${id}`),
      ...document.querySelectorAll(`[data-section-target="${id}"]`),
    ].filter(Boolean);
    for (const target of targets) updateFromHTML(/** @type {Element} */ (target), html);
  }
}

/** Section ids that must re-render whenever the cart changes. */
export function cartSectionIds() {
  const ids = new Set(['cart-count']);
  for (const node of document.querySelectorAll('[data-cart-section]')) {
    const id = node.getAttribute('data-cart-section');
    if (id) ids.add(id);
  }
  return [...ids];
}
