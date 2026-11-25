/**
 * @layer L3
 * <product-recommendations>: lazily replaces its content with Shopify's
 * related/complementary products when it scrolls into view.
 */
import { Component, defineElement } from '@theme/component';
import { ContentUpdateEvent } from '@theme/events';

class ProductRecommendations extends Component {
  /** @type {IntersectionObserver | null} */
  #observer = null;

  mount() {
    this.#observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      this.#observer?.disconnect();
      this.#load();
    }, { rootMargin: '0px 0px 400px 0px' });
    this.#observer.observe(this);
  }

  unmount() {
    this.#observer?.disconnect();
  }

  async #load() {
    const url = this.dataset.url;
    if (!url) return;
    try {
      const response = await fetch(url);
      const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
      const fresh = doc.querySelector('product-recommendations');
      if (fresh?.querySelector('[data-has-products]')) {
        this.replaceChildren(...[...fresh.childNodes].map((node) => document.importNode(node, true)));
        this.dispatchEvent(new ContentUpdateEvent({ root: this }));
      } else {
        this.closest('.shopify-section')?.setAttribute('hidden', '');
      }
    } catch {
      this.closest('.shopify-section')?.setAttribute('hidden', '');
    }
  }
}

defineElement('product-recommendations', ProductRecommendations);
