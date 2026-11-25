/**
 * @layer L3
 * Small storefront helpers that each need only a few lines:
 *   <localization-form>    submits the country/language form on change
 *   <pickup-availability>  local pickup info for the selected variant
 *   <address-form>         country → province select for customer addresses
 *   <deferred-media>       loads a video/iframe only when the visitor asks
 *   <marquee-banner>       pause/play button for the scrolling text ribbon
 *   <share-copy>           copy-link button in the share buttons
 */
import { Component, defineElement } from '@theme/component';
import { VariantChangeEvent } from '@theme/events';
import { fetchSection } from '@theme/section-renderer';
import { announce, t } from '@theme/utilities';

class LocalizationForm extends Component {
  mount() {
    this.listen(this, 'change', (event) => {
      const target = /** @type {Element} */ (event.target);
      if (target.matches('select')) target.closest('form')?.requestSubmit();
    });
  }
}

class PickupAvailability extends Component {
  mount() {
    this.#render(this.dataset.variantId);
    this.listen(document, VariantChangeEvent.eventName, (event) => {
      if (event.detail.sectionId === this.dataset.sectionId) this.#render(event.detail.variant?.id);
    });
  }

  /** @param {string | number | undefined} variantId */
  async #render(variantId) {
    if (!variantId) {
      this.replaceChildren();
      return;
    }
    const url = `${window.Theme.routes.root.replace(/\/$/, '')}/variants/${variantId}/`;
    try {
      const html = await fetchSection('pickup-availability', url);
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const content = doc.querySelector('[data-pickup-content]');
      this.replaceChildren(...(content ? [document.importNode(content, true)] : []));
    } catch {
      this.replaceChildren();
    }
  }
}

class AddressForm extends Component {
  /** @returns {HTMLSelectElement | null} */
  get #country() {
    return this.querySelector('select[data-address-country]');
  }

  /** @returns {HTMLSelectElement | null} */
  get #province() {
    return this.querySelector('select[data-address-province]');
  }

  mount() {
    const country = this.#country;
    const province = this.#province;
    if (!country || !province) return;
    if (country.dataset.default) {
      country.value = country.dataset.default;
      // Let <custom-select> show the restored country.
      country.dispatchEvent(new Event('change', { bubbles: true }));
    }
    this.#fillProvinces(province.dataset.default);
    this.listen(country, 'change', () => this.#fillProvinces());
  }

  /** @param {string} [selected] */
  #fillProvinces(selected) {
    const country = /** @type {HTMLSelectElement} */ (this.#country);
    const province = /** @type {HTMLSelectElement} */ (this.#province);
    const { provinceWrapper } = this.refs;
    const option = country.selectedOptions[0];
    /** @type {[string, string][]} */
    const provinces = JSON.parse(option?.dataset.provinces || '[]');
    province.replaceChildren(...provinces.map(([value, label]) => new Option(label, value, false, value === selected)));
    provinceWrapper?.toggleAttribute('hidden', provinces.length === 0);
  }
}

class DeferredMedia extends Component {
  mount() {
    const button = this.querySelector('button[data-load]');
    if (!button) return;
    this.listen(button, 'click', () => this.load(), { once: true });
  }

  load() {
    const template = this.querySelector('template');
    if (!template || this.hasAttribute('data-loaded')) return;
    const content = document.importNode(template.content, true);
    this.setAttribute('data-loaded', '');
    this.append(content);
    const media = this.querySelector('video, iframe');
    if (media instanceof HTMLVideoElement) media.play().catch(() => {});
    /** @type {HTMLElement | null} */ (media)?.focus();
  }
}

/** <share-copy data-url>: copies the share URL and confirms it. */
class ShareCopy extends Component {
  /** @type {number | undefined} */
  #timer;

  mount() {
    this.listen(this.refs.button, 'click', () => this.#copy());
  }

  unmount() {
    window.clearTimeout(this.#timer);
  }

  async #copy() {
    try {
      await navigator.clipboard.writeText(this.dataset.url || window.location.href);
    } catch {
      return;
    }
    announce(t('linkCopied'));
    this.setAttribute('data-copied', '');
    window.clearTimeout(this.#timer);
    this.#timer = window.setTimeout(() => this.removeAttribute('data-copied'), 2000);
  }
}

class MarqueeBanner extends Component {
  mount() {
    const { toggle } = this.refs;
    if (!toggle) return;
    this.listen(toggle, 'click', () => {
      const paused = toggle.getAttribute('aria-pressed') !== 'true';
      toggle.setAttribute('aria-pressed', String(paused));
      this.toggleAttribute('data-paused', paused);
    });
  }
}

defineElement('localization-form', LocalizationForm);
defineElement('pickup-availability', PickupAvailability);
defineElement('address-form', AddressForm);
defineElement('deferred-media', DeferredMedia);
defineElement('marquee-banner', MarqueeBanner);
defineElement('share-copy', ShareCopy);
