/**
 * @layer L2
 * Modal dialogs and drawers built on the native <dialog> element, which gives
 * us the focus trap, inert background and Escape handling for free.
 *
 * Markup:
 *   <dialog-component>
 *     <button ref="trigger" aria-haspopup="dialog">Open</button>
 *     <dialog ref="dialog" class="drawer" aria-labelledby="…">
 *       <button ref="close">Close</button> …
 *     </dialog>
 *   </dialog-component>
 *
 * Any element with `data-dialog-open="<dialog id>"` anywhere on the page opens
 * the dialog with that id (wired in global.js so it works before this module
 * has loaded).
 */
import { Component, defineElement } from '@theme/component';
import { DialogToggleEvent } from '@theme/events';

export class DialogComponent extends Component {
  /** @type {HTMLElement | null} */
  #returnFocus = null;

  /** @returns {HTMLDialogElement} */
  get dialog() {
    return this.refs.dialog;
  }

  get isOpen() {
    return Boolean(this.dialog?.open);
  }

  mount() {
    const { dialog, trigger } = this.refs;
    if (!dialog) return;

    if (trigger) this.listen(trigger, 'click', (event) => this.open(event.currentTarget));
    this.listen(dialog, 'click', (event) => {
      const target = /** @type {Element} */ (event.target);
      if (target === dialog || target.closest('[ref="close"], [data-dialog-close]')) this.close();
    });
    this.listen(dialog, 'cancel', (event) => {
      event.preventDefault();
      this.close();
    });
  }

  unmount() {
    if (this.isOpen) document.documentElement.classList.remove('scroll-lock');
  }

  /** @param {EventTarget | null} [opener] */
  open(opener = document.activeElement) {
    if (this.isOpen) return;
    this.#returnFocus = opener instanceof HTMLElement ? opener : null;
    this.dialog.showModal();
    this.dialog.removeAttribute('data-closing');
    document.documentElement.classList.add('scroll-lock');
    this.#returnFocus?.setAttribute('aria-expanded', 'true');
    this.dispatchEvent(new DialogToggleEvent({ open: true, id: this.dialog.id }));
    this.afterOpen();
  }

  async close() {
    if (!this.isOpen) return;
    this.dialog.setAttribute('data-closing', '');
    await this.#finishAnimations();
    this.dialog.close();
    this.dialog.removeAttribute('data-closing');
    document.documentElement.classList.remove('scroll-lock');
    this.#returnFocus?.setAttribute('aria-expanded', 'false');
    this.#returnFocus?.focus({ preventScroll: true });
    this.dispatchEvent(new DialogToggleEvent({ open: false, id: this.dialog.id }));
  }

  /** Override for work after the dialog is shown. */
  afterOpen() {}

  #finishAnimations() {
    const animations = this.dialog.getAnimations({ subtree: true });
    return Promise.allSettled(animations.map((animation) => animation.finished));
  }
}

defineElement('dialog-component', DialogComponent);
