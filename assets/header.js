/**
 * @layer L3
 * Header behaviour:
 *   <header-component>  sticky modes + publishes --header-height
 *   <header-menu>       desktop dropdowns built on <details>
 *   <header-drawer>     mobile navigation drawer (native <dialog>)
 */
import { Component, defineElement } from '@theme/component';
import { DialogComponent } from '@theme/dialog';

class HeaderComponent extends Component {
  /** @type {ResizeObserver | null} */
  #resizeObserver = null;
  #lastScroll = 0;

  mount() {
    this.#resizeObserver = new ResizeObserver(() => this.#publishHeight());
    this.#resizeObserver.observe(this);
    this.#publishHeight();

    const mode = this.dataset.sticky;
    if (mode === 'scroll-up' || mode === 'always') {
      this.listen(window, 'scroll', () => this.#onScroll(mode), { passive: true });
    }
  }

  unmount() {
    this.#resizeObserver?.disconnect();
  }

  #publishHeight() {
    document.documentElement.style.setProperty('--header-height', `${Math.round(this.offsetHeight)}px`);
  }

  /** @param {string} mode */
  #onScroll(mode) {
    const current = window.scrollY;
    const scrolled = current > this.offsetHeight;
    this.toggleAttribute('data-scrolled', scrolled);

    if (mode === 'scroll-up') {
      const hidden = scrolled && current > this.#lastScroll && !this.contains(document.activeElement);
      this.toggleAttribute('data-hidden', hidden);
    }
    this.#lastScroll = current;
  }
}

class HeaderMenu extends Component {
  mount() {
    const items = /** @type {HTMLDetailsElement[]} */ ([...this.querySelectorAll('details')]);

    for (const details of items) {
      this.listen(details, 'toggle', () => {
        if (!details.open) return;
        for (const other of items) if (other !== details && !other.contains(details)) other.open = false;
      });

      if (this.dataset.openOn === 'hover') {
        this.listen(details, 'pointerenter', (event) => {
          if (event.pointerType === 'mouse') details.open = true;
        });
        this.listen(details, 'pointerleave', (event) => {
          if (event.pointerType === 'mouse') details.open = false;
        });
      }
    }

    this.listen(document, 'click', (event) => {
      if (!this.contains(/** @type {Node} */ (event.target))) this.closeAll();
    });
    this.listen(this, 'keydown', (event) => {
      if (event.key !== 'Escape') return;
      const open = items.findLast((details) => details.open);
      if (!open) return;
      open.open = false;
      open.querySelector('summary')?.focus();
    });
    this.listen(this, 'focusout', (event) => {
      if (!this.contains(/** @type {Node | null} */ (event.relatedTarget))) this.closeAll();
    });
  }

  closeAll() {
    for (const details of this.querySelectorAll('details[open]')) details.removeAttribute('open');
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
