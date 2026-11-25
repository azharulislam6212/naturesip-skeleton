/**
 * @layer L1
 * Base class for the theme's custom elements.
 *
 * - `this.refs` maps every descendant `[ref="name"]` to its element; names that
 *   end in `[]` collect arrays (`ref="thumbnails[]"`). Refs inside a nested
 *   custom element that is itself a Component belong to that element.
 * - Listeners registered through `this.listen()` (or with `{ signal: this.signal }`)
 *   are removed automatically when the element disconnects.
 * - Subclasses implement `mount()` / `unmount()` rather than the raw callbacks.
 */
export class Component extends HTMLElement {
  /** @type {Record<string, any>} */
  refs = {};

  /** @type {AbortController | null} */
  #controller = null;

  get signal() {
    this.#controller ??= new AbortController();
    return this.#controller.signal;
  }

  connectedCallback() {
    this.#controller = new AbortController();
    this.updateRefs();
    this.mount();
  }

  disconnectedCallback() {
    this.#controller?.abort();
    this.#controller = null;
    this.unmount();
  }

  /** Override to set up the element. Runs on every connection. */
  mount() {}

  /** Override to release resources not tied to `this.signal`. */
  unmount() {}

  /** Re-collects refs; call after replacing child markup. */
  updateRefs() {
    /** @type {Record<string, any>} */
    const refs = {};
    for (const node of this.querySelectorAll('[ref]')) {
      if (this.#ownedByNestedComponent(node)) continue;
      const name = node.getAttribute('ref') ?? '';
      if (name.endsWith('[]')) {
        const key = name.slice(0, -2);
        (refs[key] ??= []).push(node);
      } else {
        refs[name] = node;
      }
    }
    this.refs = refs;
  }

  /** @param {Element} node */
  #ownedByNestedComponent(node) {
    for (let parent = node.parentElement; parent && parent !== this; parent = parent.parentElement) {
      if (parent instanceof Component) return true;
    }
    return false;
  }

  /**
   * addEventListener bound to the element lifecycle.
   * @param {EventTarget} target
   * @param {string} type
   * @param {(event: any) => void} listener
   * @param {AddEventListenerOptions} [options]
   */
  listen(target, type, listener, options = {}) {
    target.addEventListener(type, listener, { ...options, signal: this.signal });
  }
}

/**
 * customElements.define that tolerates a module being evaluated twice
 * (theme editor reloads, quick view).
 * @param {string} tag
 * @param {CustomElementConstructor} constructor
 */
export function defineElement(tag, constructor) {
  if (!customElements.get(tag)) customElements.define(tag, constructor);
}
