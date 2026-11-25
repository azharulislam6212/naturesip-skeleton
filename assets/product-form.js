/**
 * @layer L3
 * <product-form>: progressive enhancement of the native add-to-cart form.
 * Without JavaScript the form still posts to /cart/add.
 */
import { Component, defineElement } from '@theme/component';
import { CartErrorEvent, CartUpdateEvent, VariantChangeEvent } from '@theme/events';
import { applySections, cartSectionIds } from '@theme/section-renderer';
import { announce, t } from '@theme/utilities';

class ProductForm extends Component {
  mount() {
    const form = this.querySelector('form');
    if (!form) return;

    this.listen(form, 'submit', (event) => {
      event.preventDefault();
      this.#submit(form);
    });

    // Keep the hidden variant id in sync when the picker in this section changes.
    this.listen(document, VariantChangeEvent.eventName, (event) => {
      if (event.detail.sectionId !== this.dataset.sectionId) return;
      const idInput = /** @type {HTMLInputElement | null} */ (form.querySelector('input[name="id"]'));
      if (idInput && event.detail.variant) idInput.value = String(event.detail.variant.id);
    });
  }

  /** @param {HTMLFormElement} form */
  async #submit(form) {
    const submit = /** @type {HTMLButtonElement | null} */ (form.querySelector('[type="submit"]'));
    if (submit?.getAttribute('aria-disabled') === 'true') return;

    this.#setError('');
    submit?.setAttribute('aria-busy', 'true');
    submit?.setAttribute('aria-disabled', 'true');

    const body = new FormData(form);
    const isDrawer = window.Theme.settings.cartType === 'drawer';
    if (isDrawer) {
      body.append('sections', cartSectionIds().join(','));
      body.append('sections_url', window.location.pathname);
    }

    try {
      const response = await fetch(`${window.Theme.routes.cartAdd}.js`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body,
      });
      const result = await response.json();

      if (!response.ok || result.status) {
        const message = result.description || result.message || t('cartError');
        this.#setError(message);
        this.dispatchEvent(new CartErrorEvent({ message, source: 'product-form' }));
        return;
      }

      if (!isDrawer) {
        window.location.href = window.Theme.routes.cart;
        return;
      }

      applySections(result.sections);
      announce(t('addedToCart'));
      const source = this.closest('[data-quick-view]') ? 'quick-add' : 'product-form';
      this.dispatchEvent(new CartUpdateEvent({ cart: result, source, itemCount: -1 }));
    } catch {
      this.#setError(t('cartError'));
    } finally {
      submit?.removeAttribute('aria-busy');
      submit?.setAttribute('aria-disabled', submit.hasAttribute('data-unavailable') ? 'true' : 'false');
    }
  }

  /** @param {string} message */
  #setError(message) {
    const error = this.refs.error;
    if (!error) return;
    error.textContent = message;
    error.toggleAttribute('hidden', !message);
  }
}

defineElement('product-form', ProductForm);
