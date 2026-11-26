/**
 * @layer L3
 * Header behaviour:
 *   <header-component>  sticky modes, transparent-to-solid, publishes --header-height
 *   <header-menu>       desktop dropdowns and mega menus (snippets/header-menu.liquid)
 *                       and the "More" item for whatever doesn't fit on one line
 *   <header-drawer>     mobile navigation drawer (native <dialog>)
 */
import { Component, defineElement } from '@theme/component';
import { DialogComponent } from '@theme/dialog';

class HeaderComponent extends Component {
  /** @type {ResizeObserver | null} */
  #resizeObserver = null;
  #lastScroll = 0;
  #height = 0;

  mount() {
    this.#resizeObserver = new ResizeObserver(() => this.#publishHeight());
    this.#resizeObserver.observe(this);
    this.#publishHeight();

    const mode = this.dataset.sticky ?? 'none';
    if (mode !== 'none' || this.hasAttribute('data-transparent')) {
      this.listen(window, 'scroll', () => this.#onScroll(mode), { passive: true });
      this.#onScroll(mode);
    }
  }

  unmount() {
    this.#resizeObserver?.disconnect();
  }

  // Cached so the scroll handler never forces a layout read.
  #publishHeight() {
    this.#height = Math.round(this.offsetHeight);
    document.documentElement.style.setProperty('--header-height', `${this.#height}px`);
  }

  /** @param {string} mode */
  #onScroll(mode) {
    const current = window.scrollY;
    const scrolled = current > this.#height;
    if (scrolled !== this.hasAttribute('data-scrolled')) {
      this.toggleAttribute('data-scrolled', scrolled);
      this.#swapScheme(scrolled);
    }

    if (mode === 'scroll-up') {
      const hidden = scrolled && current > this.#lastScroll && !this.contains(document.activeElement);
      this.toggleAttribute('data-hidden', hidden);
    }
    this.#lastScroll = current;
  }

  /**
   * A transparent header wears its own colour scheme over the first section
   * and the header's scheme once it is solid.
   * @param {boolean} solid
   */
  #swapScheme(solid) {
    const { scheme, transparentScheme } = this.dataset;
    if (!scheme || !transparentScheme) return;
    this.classList.replace(solid ? transparentScheme : scheme, solid ? scheme : transparentScheme);
  }
}

/** Pause before a hovered menu closes, so the pointer can cross the gap to its panel. */
const CLOSE_DELAY = 150;

class HeaderMenu extends Component {
  /** @type {ResizeObserver | null} */
  #resizeObserver = null;
  #closeTimer = 0;

  /** Items that open a panel: dropdowns, mega menus and "More". */
  get #items() {
    return /** @type {HTMLElement[]} */ ([...this.querySelectorAll('[data-menu-item]')]);
  }

  get #openItem() {
    return /** @type {HTMLElement | null} */ (this.querySelector('[data-menu-item][data-open]'));
  }

  mount() {
    // From here on the script decides what is open (base.css opens on hover
    // and focus without it).
    this.setAttribute('data-ready', '');
    const hover = this.dataset.openOn !== 'click';

    for (const item of this.#items) {
      const button = this.#button(item);
      if (!button) continue;
      this.listen(button, 'click', () => (item.hasAttribute('data-open') ? this.close(item) : this.open(item)));
      if (!hover) continue;
      this.listen(item, 'pointerenter', (event) => event.pointerType === 'mouse' && this.open(item));
      this.listen(item, 'pointerleave', (event) => event.pointerType === 'mouse' && this.#closeLater(item));
    }

    this.listen(this, 'keydown', (event) => {
      const item = this.#openItem;
      if (event.key !== 'Escape' || !item) return;
      this.close(item);
      this.#button(item)?.focus();
    });
    this.listen(this, 'focusout', (event) => {
      const item = this.#openItem;
      if (item && !item.contains(/** @type {Node | null} */ (event.relatedTarget))) this.close(item);
    });
    this.listen(document, 'click', (event) => {
      if (!this.contains(/** @type {Node} */ (event.target))) this.closeAll();
    });

    // Theme editor: selecting a mega menu block shows it.
    this.listen(document, 'shopify:block:select', (event) => {
      const item = /** @type {Element} */ (event.target).closest?.('[data-menu-item]');
      if (item instanceof HTMLElement && this.contains(item)) this.open(item);
    });
    this.listen(document, 'shopify:block:deselect', () => this.closeAll());

    // Refit when the header resizes, when the menu's own room changes (the
    // logo image loading) and once the web fonts change the item widths.
    this.#resizeObserver = new ResizeObserver(() => this.#fit());
    this.#resizeObserver.observe(this.closest('header') ?? this);
    this.#resizeObserver.observe(this);
    this.#fit();
    document.fonts?.ready.then(() => this.#fit());
  }

  unmount() {
    this.#resizeObserver?.disconnect();
    clearTimeout(this.#closeTimer);
  }

  /** @param {HTMLElement} item */
  open(item) {
    clearTimeout(this.#closeTimer);
    for (const other of this.#items) if (other !== item) this.close(other);
    item.setAttribute('data-open', '');
    this.#button(item)?.setAttribute('aria-expanded', 'true');
  }

  /** @param {HTMLElement} item */
  close(item) {
    item.removeAttribute('data-open');
    this.#button(item)?.setAttribute('aria-expanded', 'false');
  }

  closeAll() {
    for (const item of this.#items) this.close(item);
  }

  /** @param {HTMLElement} item */
  #closeLater(item) {
    clearTimeout(this.#closeTimer);
    this.#closeTimer = window.setTimeout(() => this.close(item), CLOSE_DELAY);
  }

  /** @param {HTMLElement} item */
  #button(item) {
    return /** @type {HTMLButtonElement | null} */ (item.querySelector(':scope > [aria-expanded]'));
  }

  /** Keeps the menu on one line (the fit itself is inline in sections/header.liquid). */
  #fit() {
    const list = /** @type {HTMLElement | undefined} */ (this.refs.list);
    if (!list) return;
    window.Theme?.fitHeaderMenu?.(list);
    const more = /** @type {HTMLElement | null} */ (list.querySelector(':scope > [data-more]'));
    if (more?.hidden) this.close(more);
  }
}

class HeaderDrawer extends DialogComponent {
  afterOpen() {
    this.dialog.querySelector('a, summary, button:not([ref="close"])')?.focus();
  }
}

defineElement('header-component', HeaderComponent);
defineElement('header-menu', HeaderMenu);
defineElement('header-drawer', HeaderDrawer);
