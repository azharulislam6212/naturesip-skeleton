/**
 * @layer L3
 * <variant-picker>: when an option changes, asks Shopify for the section
 * rendered with the chosen option values (`?option_values=`) and morphs only
 * the parts marked with `data-variant-update`. The media gallery listens to
 * the resulting VariantChangeEvent instead of being re-rendered.
 */
import { Component, defineElement } from '@theme/component';
import { VariantChangeEvent } from '@theme/events';
import { fetchSection, parseHTML } from '@theme/section-renderer';
import { morph } from '@theme/morph';
import { announce, readJson, t } from '@theme/utilities';

class VariantPicker extends Component {
  /** @type {AbortController | null} */
  #request = null;

  mount() {
    this.listen(this, 'change', () => this.#update());
  }

  get section() {
    return /** @type {HTMLElement} */ (this.closest('[data-product-section]'));
  }

  #selectedValueIds() {
    const ids = [];
    for (const field of this.querySelectorAll('fieldset, select')) {
      const value = field instanceof HTMLSelectElement
        ? field.selectedOptions[0]
        : field.querySelector('input:checked');
      const id = value?.getAttribute('data-option-value-id');
      if (id) ids.push(id);
    }
    return ids;
  }

  async #update() {
    const section = this.section;
    if (!section) return;
    const sectionId = section.dataset.sectionId ?? '';
    const productUrl = this.dataset.productUrl ?? '';

    this.#request?.abort();
    this.#request = new AbortController();

    const url = new URL(productUrl, window.location.origin);
    url.searchParams.set('option_values', this.#selectedValueIds().join(','));

    section.setAttribute('aria-busy', 'true');
    try {
      const html = await fetchSection(section.dataset.renderId ?? sectionId, url.toString(), {
        signal: this.#request.signal,
      });
      const doc = parseHTML(html);
      const fresh = doc.querySelector('[data-product-section]');
      if (!fresh) return;

      const freshProductUrl = fresh.querySelector('variant-picker')?.getAttribute('data-product-url');
      if (freshProductUrl && freshProductUrl !== productUrl) {
        // Combined listing: a different product, so swap the whole section.
        morph(section, fresh);
      } else {
        for (const target of section.querySelectorAll('[data-variant-update]')) {
          const key = target.getAttribute('data-variant-update');
          const replacement = fresh.querySelector(`[data-variant-update="${key}"]`);
          if (replacement) morph(target, replacement);
        }
      }

      const variant = readJson(fresh, '[data-selected-variant]', null);
      if (variant && !section.closest('[data-quick-view]') && section.dataset.updateUrl !== 'false') {
        const pageUrl = new URL(freshProductUrl ?? productUrl, window.location.origin);
        pageUrl.searchParams.set('variant', variant.id);
        window.history.replaceState({}, '', pageUrl);
      }
      announce(variant ? t('variantSelected', { variant: variant.title }) : t('unavailable'));
      this.dispatchEvent(new VariantChangeEvent({ variant, sectionId, productUrl: freshProductUrl ?? productUrl }));
    } catch (error) {
      if (/** @type {Error} */ (error).name !== 'AbortError') throw error;
    } finally {
      section.removeAttribute('aria-busy');
    }
  }
}

defineElement('variant-picker', VariantPicker);
