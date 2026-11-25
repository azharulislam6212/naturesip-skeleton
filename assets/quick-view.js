/**
 * @layer L3
 * Quick view from product cards.
 *   <quick-view-button data-product-url="…"><button>…</button></quick-view-button>
 *   <quick-view-dialog> lives once per page (sections/quick-view-dialog.liquid)
 * Content is sections/quick-view.liquid rendered in the product's context.
 */
import { Component, defineElement } from '@theme/component';
import { DialogComponent } from '@theme/dialog';
import { fetchSection } from '@theme/section-renderer';
import { CartUpdateEvent, ContentUpdateEvent } from '@theme/events';
import { t } from '@theme/utilities';

class QuickViewDialog extends DialogComponent {
  /** @type {AbortController | null} */
  #request = null;

  mount() {
    super.mount();
    this.listen(document, CartUpdateEvent.eventName, (event) => {
      if (event.detail.source === 'quick-add') this.close();
    });
  }

  /**
   * @param {string} productUrl
   * @param {HTMLElement} opener
   */
  async show(productUrl, opener) {
    const content = this.refs.content;
    this.#request?.abort();
    this.#request = new AbortController();

    content.replaceChildren();
    content.setAttribute('aria-busy', 'true');
    this.open(opener);
    try {
      const html = await fetchSection('quick-view', productUrl, { signal: this.#request.signal });
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const view = doc.querySelector('[data-quick-view-content]');
      if (view) content.replaceChildren(document.importNode(view, true));
      this.dispatchEvent(new ContentUpdateEvent({ root: content }));
      content.querySelector('h2, [tabindex="-1"]')?.focus();
    } catch (error) {
      if (/** @type {Error} */ (error).name !== 'AbortError') content.textContent = t('networkError');
    } finally {
      content.removeAttribute('aria-busy');
    }
  }
}

class QuickViewButton extends Component {
  mount() {
    const button = this.querySelector('button');
    if (!button) return;
    this.listen(button, 'click', () => {
      const dialog = /** @type {QuickViewDialog | null} */ (document.querySelector('quick-view-dialog'));
      if (dialog && this.dataset.productUrl) dialog.show(this.dataset.productUrl, button);
    });
  }
}

defineElement('quick-view-dialog', QuickViewDialog);
defineElement('quick-view-button', QuickViewButton);
