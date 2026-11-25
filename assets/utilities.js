/**
 * @layer L0
 * Small, pure helpers shared by every module. No DOM side effects on import.
 */

/** @returns {boolean} true when the visitor asked the OS to reduce motion. */
export function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** @returns {boolean} true inside the theme editor preview. */
export function isDesignMode() {
  return Boolean(window.Shopify?.designMode);
}

/** @returns {boolean} true on touch-first devices (no fine pointer). */
export function isTouchDevice() {
  return window.matchMedia('(pointer: coarse)').matches;
}

/**
 * Runs a callback once the main thread is idle.
 * @param {() => void} callback
 * @param {number} [timeout]
 */
export function onIdle(callback, timeout = 2000) {
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(callback, { timeout });
  } else {
    window.setTimeout(callback, 200);
  }
}

/**
 * @template {(...args: any[]) => void} T
 * @param {T} fn
 * @param {number} wait
 * @returns {T & { cancel(): void } }
 */
export function debounce(fn, wait) {
  let timer = 0;
  const debounced = /** @type {T & { cancel(): void } } */ (
    (...args) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => fn(...args), wait);
    }
  );
  debounced.cancel = () => window.clearTimeout(timer);
  return debounced;
}

/**
 * Options for a JSON fetch to the Ajax API.
 * @param {object} [body]
 * @returns {RequestInit}
 */
export function jsonRequest(body) {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body ?? {}),
  };
}

/**
 * Reads a JSON payload rendered by Liquid inside <script type="application/json">.
 * @template T
 * @param {ParentNode} root
 * @param {string} selector
 * @param {T} fallback
 * @returns {T}
 */
export function readJson(root, selector, fallback) {
  const node = root.querySelector(selector);
  if (!node?.textContent) return fallback;
  try {
    return JSON.parse(node.textContent);
  } catch {
    return fallback;
  }
}

/**
 * Translated string from window.Theme.strings with [token] replacement.
 * @param {string} key
 * @param {Record<string, string | number>} [values]
 */
export function t(key, values = {}) {
  let text = window.Theme?.strings?.[key] ?? key;
  for (const [name, value] of Object.entries(values)) {
    text = text.replaceAll(`[${name}]`, String(value));
  }
  return text;
}

/**
 * Announces a message to screen readers through the shared live region.
 * @param {string} message
 */
export function announce(message) {
  const region = document.getElementById('LiveRegion');
  if (!region) return;
  region.textContent = '';
  window.setTimeout(() => {
    region.textContent = message;
  }, 50);
}
