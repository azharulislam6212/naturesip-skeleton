/**
 * @layer L3
 * <facets-form>: collection and search filtering, sorting and pagination
 * without page reloads. Builds the URL from the form, renders the section for
 * that URL, morphs the results, and keeps browser history in sync.
 */
import { Component, defineElement } from '@theme/component';
import { FilterUpdateEvent } from '@theme/events';
import { fetchSection, updateFromHTML } from '@theme/section-renderer';
import { debounce } from '@theme/utilities';

const RESULT_PARTS = ['[data-facets-results]', '[data-facets-active]', '[data-facets-count]', '[data-facets-filters]'];

class FacetsForm extends Component {
  /** @type {AbortController | null} */
  #request = null;

  get section() {
    return /** @type {HTMLElement} */ (this.closest('.shopify-section'));
  }

  mount() {
    const apply = debounce(() => this.#apply(this.#urlFromForms()), 400);

    this.listen(this.section, 'input', (event) => {
      const target = /** @type {HTMLElement} */ (event.target);
      if (target.closest('form[data-facets]')) apply();
    });
    this.listen(this.section, 'submit', (event) => {
      if (!/** @type {Element} */ (event.target).matches('form[data-facets]')) return;
      event.preventDefault();
      apply.cancel();
      this.#apply(this.#urlFromForms());
    });
    this.listen(this.section, 'click', (event) => {
      const link = /** @type {Element} */ (event.target).closest('a[data-facets-link]');
      if (!link) return;
      event.preventDefault();
      this.#apply(/** @type {HTMLAnchorElement} */ (link).href);
    });
    this.listen(window, 'popstate', () => this.#apply(window.location.href, false));
  }

  #urlFromForms() {
    const params = new URLSearchParams();
    for (const form of this.section.querySelectorAll('form[data-facets]')) {
      for (const [key, value] of new FormData(/** @type {HTMLFormElement} */ (form))) {
        if (value !== '' && !(key === 'page')) params.append(key, String(value));
      }
    }
    return `${window.location.pathname}?${params.toString()}`;
  }

  /**
   * @param {string} url
   * @param {boolean} [push]
   */
  async #apply(url, push = true) {
    this.#request?.abort();
    this.#request = new AbortController();
    const section = this.section;
    const sectionId = section.id.replace('shopify-section-', '');
    const results = section.querySelector('[data-facets-results]');

    results?.setAttribute('aria-busy', 'true');
    try {
      const html = await fetchSection(sectionId, url, { signal: this.#request.signal });
      updateFromHTML(section, html, RESULT_PARTS);
      if (push) window.history.pushState({}, '', url);
      this.dispatchEvent(new FilterUpdateEvent({ url, sectionId }));
      if (push && results && results.getBoundingClientRect().top < 0) {
        results.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }
    } catch (error) {
      if (/** @type {Error} */ (error).name !== 'AbortError') window.location.href = url;
    } finally {
      results?.removeAttribute('aria-busy');
    }
  }
}

defineElement('facets-form', FacetsForm);
