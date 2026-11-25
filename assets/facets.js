/**
 * @layer L3
 * <facets-form>: collection and search filtering, sorting and pagination
 * without page reloads. Builds the URL from the form, renders the section for
 * that URL, morphs the results, and keeps browser history in sync.
 *
 * <price-range>: two range thumbs over one track, kept in step with the
 * From / To number inputs (which carry the form values). Moving either one
 * fires `input`, so the facets form applies the filter as usual.
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

    // Swatch tooltips float above everything, so the clipping filter
    // accordion and drawer never cut them off.
    const place = (/** @type {Event} */ event) => placeSwatchTooltip(/** @type {Element} */ (event.target));
    this.listen(this.section, 'pointerover', place);
    this.listen(this.section, 'focusin', place);
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

/**
 * Positions a swatch's tooltip under the swatch with `position: fixed`,
 * kept inside the viewport. Measures its own containing block first, so it
 * is also right inside a transformed ancestor (an animating drawer).
 * @param {Element} target
 */
function placeSwatchTooltip(target) {
  const swatch = target.closest?.('.facets__swatch');
  const tip = /** @type {HTMLElement | null} */ (swatch?.querySelector('.facets__swatch-tooltip'));
  if (!swatch || !tip) return;

  tip.classList.add('is-floating');
  tip.style.left = '0px';
  tip.style.top = '0px';
  const origin = tip.getBoundingClientRect();
  const box = swatch.getBoundingClientRect();
  const width = tip.offsetWidth;
  const gutter = 8;

  const centre = box.left + box.width / 2;
  const x = Math.min(Math.max(centre - width / 2, gutter), window.innerWidth - width - gutter);
  const y = box.bottom + 6;

  tip.style.left = `${x - origin.left}px`;
  tip.style.top = `${y - origin.top}px`;
  tip.style.setProperty('--arrow-x', `${centre - x}px`);
}

class PriceRange extends Component {
  mount() {
    const { minRange, maxRange, minInput, maxInput } = this.refs;
    if (!minRange || !maxRange || !minInput || !maxInput) return;
    this.listen(minRange, 'input', () => this.#fromRange(minRange));
    this.listen(maxRange, 'input', () => this.#fromRange(maxRange));
    this.listen(minInput, 'input', () => this.#fromInputs());
    this.listen(maxInput, 'input', () => this.#fromInputs());
  }

  /** @param {HTMLInputElement} moved */
  #fromRange(moved) {
    const { minRange, maxRange, minInput, maxInput } = this.refs;
    let min = Number(minRange.value);
    let max = Number(maxRange.value);
    // Thumbs never cross: the one being dragged stops at the other.
    if (min > max) {
      if (moved === minRange) minRange.value = String((min = max));
      else maxRange.value = String((max = min));
    }
    const top = Number(maxRange.max);
    // Ends of the track mean "no limit", so the filter is left out of the URL.
    minInput.value = min > 0 ? String(min) : '';
    maxInput.value = max < top ? String(max) : '';
    this.#paint(min, max);
  }

  #fromInputs() {
    const { minRange, maxRange, minInput, maxInput } = this.refs;
    const top = Number(maxRange.max);
    const min = Math.min(Math.max(Number(minInput.value) || 0, 0), top);
    const max = Math.max(Math.min(maxInput.value === '' ? top : Number(maxInput.value), top), min);
    minRange.value = String(min);
    maxRange.value = String(max);
    this.#paint(min, max);
  }

  /**
   * @param {number} min
   * @param {number} max
   */
  #paint(min, max) {
    const top = Number(this.refs.maxRange.max) || 1;
    this.style.setProperty('--range-start', `${(min / top) * 100}%`);
    this.style.setProperty('--range-end', `${(max / top) * 100}%`);
  }
}

defineElement('facets-form', FacetsForm);
defineElement('price-range', PriceRange);
