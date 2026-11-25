/**
 * @layer L3
 * <cart-items>: line item quantity changes, removals and the cart note, used
 * by both the cart page and the cart drawer. Every request asks the Cart API
 * to re-render all cart sections, then applies them in one go.
 */
import { Component, defineElement } from '@theme/component';
import { CartErrorEvent, CartUpdateEvent } from '@theme/events';
import { applySections, cartSectionIds } from '@theme/section-renderer';
import { announce, debounce, jsonRequest, t } from '@theme/utilities';

class CartItems extends Component {
  mount() {
    const updateQuantity = debounce((/** @type {HTMLInputElement} */ input) => {
      this.#change(Number(input.dataset.line), Number(input.value));
    }, 350);

    this.listen(this, 'change', (event) => {
      const target = /** @type {HTMLInputElement} */ (event.target);
      if (target.matches('[data-line-quantity]')) updateQuantity(target);
      if (target.matches('[name="note"]')) this.#saveNote(target.value);
    });

    this.listen(this, 'click', (event) => {
      const remove = /** @type {Element} */ (event.target).closest('[data-line-remove]');
      if (!remove) return;
      event.preventDefault();
      this.#change(Number(remove.getAttribute('data-line-remove')), 0);
    });
  }

  /**
   * @param {number} line 1-based line index
   * @param {number} quantity
   */
  async #change(line, quantity) {
    this.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch(`${window.Theme.routes.cartChange}.js`, jsonRequest({
        line,
        quantity,
        sections: cartSectionIds(),
        sections_url: window.location.pathname,
      }));
      const cart = await response.json();

      if (!response.ok || cart.status) {
        const message = cart.description || cart.message || t('cartError');
        this.#showError(message);
        this.dispatchEvent(new CartErrorEvent({ message, source: 'cart-items' }));
        return;
      }

      applySections(cart.sections);
      announce(quantity === 0 ? t('itemRemoved') : t('cartUpdated'));
      this.dispatchEvent(new CartUpdateEvent({ cart, source: 'cart-items', itemCount: cart.item_count }));
    } catch {
      this.#showError(t('cartError'));
    } finally {
      this.removeAttribute('aria-busy');
    }
  }

  /** @param {string} note */
  async #saveNote(note) {
    await fetch(`${window.Theme.routes.cartUpdate}.js`, jsonRequest({ note }));
    announce(t('noteSaved'));
  }

  /** @param {string} message */
  #showError(message) {
    const error = this.querySelector('[data-cart-error]');
    if (!error) return;
    error.textContent = message;
    error.removeAttribute('hidden');
  }
}

defineElement('cart-items', CartItems);
