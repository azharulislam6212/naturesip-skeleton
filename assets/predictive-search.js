/**
 * @layer L3
 * <search-modal>       full-width search dialog opened from the header
 * <predictive-search>  combobox with results from the Predictive Search API,
 *                      rendered by sections/predictive-search.liquid
 */
import { Component, defineElement } from '@theme/component';
import { DialogComponent } from '@theme/dialog';
import { fetchSection } from '@theme/section-renderer';
import { debounce, t, announce } from '@theme/utilities';

/** Pause between rotating placeholder texts. */
const PLACEHOLDER_DELAY = 3000;

class SearchModal extends DialogComponent {
  #placeholderTimer = 0;

  afterOpen() {
    const input = /** @type {HTMLInputElement | null} */ (this.dialog.querySelector('input[type="search"]'));
    input?.focus();
    if (input) this.#rotatePlaceholders(input);
  }

  async close() {
    clearInterval(this.#placeholderTimer);
    await super.close();
  }

  unmount() {
    clearInterval(this.#placeholderTimer);
    super.unmount();
  }

  /**
   * Theme settings > Search > Placeholder texts: the empty field cycles
   * through them while the search is open.
   * @param {HTMLInputElement} input
   */
  #rotatePlaceholders(input) {
    const texts = (input.dataset.placeholders ?? '').split(',').map((text) => text.trim()).filter(Boolean);
    if (texts.length < 2) return;
    let index = 0;
    clearInterval(this.#placeholderTimer);
    this.#placeholderTimer = window.setInterval(() => {
      if (input.value) return;
      index = (index + 1) % texts.length;
      input.placeholder = texts[index];
    }, PLACEHOLDER_DELAY);
  }
}

class PredictiveSearch extends Component {
  /** @type {AbortController | null} */
  #request = null;
  #activeIndex = -1;

  mount() {
    const { input, results } = this.refs;
    if (!input || !results || window.Theme?.settings?.predictiveSearch === false) return;

    const search = debounce(() => this.#search(input.value.trim()), 250);
    this.listen(input, 'input', search);
    this.listen(input, 'keydown', (event) => this.#onKeydown(event));
    this.listen(input, 'focus', () => {
      if (input.value.trim()) this.#setExpanded(true);
    });
  }

  /** @param {string} query */
  async #search(query) {
    const { input, results } = this.refs;
    this.#request?.abort();

    if (query.length === 0) {
      results.replaceChildren();
      this.#setExpanded(false);
      return;
    }

    this.#request = new AbortController();
    const url = new URL(window.Theme.routes.predictiveSearch, window.location.origin);
    url.searchParams.set('q', query);
    const settings = window.Theme.settings;
    url.searchParams.set('resources[limit]', String(settings.predictiveSearchLimit ?? 6));
    url.searchParams.set('resources[limit_scope]', 'each');
    url.searchParams.set('resources[type]', settings.predictiveSearchTypes ?? 'product,collection,page,article');
    if (settings.predictiveSearchFields) url.searchParams.set('resources[options][fields]', settings.predictiveSearchFields);

    this.setAttribute('aria-busy', 'true');
    try {
      const html = await fetchSection('predictive-search', url.toString(), { signal: this.#request.signal, useCache: true });
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const content = doc.querySelector('[data-predictive-results]');
      results.replaceChildren(...(content ? [document.importNode(content, true)] : []));
      this.#activeIndex = -1;
      this.#setExpanded(true);
      const count = results.querySelectorAll('[role="option"]').length;
      announce(count ? t('searchResults', { count }) : t('searchNoResults'));
    } catch (error) {
      if (/** @type {Error} */ (error).name !== 'AbortError') results.replaceChildren();
    } finally {
      this.removeAttribute('aria-busy');
    }
    input.setAttribute('aria-activedescendant', '');
  }

  /** @param {boolean} expanded */
  #setExpanded(expanded) {
    this.refs.input.setAttribute('aria-expanded', String(expanded));
    this.toggleAttribute('data-open', expanded);
    // Suggestions show before typing and step aside for results.
    this.toggleAttribute('data-has-query', Boolean(this.refs.input.value.trim()));
  }

  /** @param {KeyboardEvent} event */
  #onKeydown(event) {
    const options = /** @type {HTMLElement[]} */ ([...this.refs.results.querySelectorAll('[role="option"]')]);
    if (event.key === 'Escape' && this.hasAttribute('data-open')) {
      event.stopPropagation();
      this.#setExpanded(false);
      return;
    }
    if (!options.length || !['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;

    if (event.key === 'Enter') {
      const active = options[this.#activeIndex];
      if (active) {
        event.preventDefault();
        active.querySelector('a')?.click();
      }
      return;
    }

    event.preventDefault();
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    this.#activeIndex = (this.#activeIndex + delta + options.length) % options.length;
    options.forEach((option, index) => option.setAttribute('aria-selected', String(index === this.#activeIndex)));
    const active = options[this.#activeIndex];
    this.refs.input.setAttribute('aria-activedescendant', active.id);
    active.scrollIntoView({ block: 'nearest' });
  }
}

defineElement('search-modal', SearchModal);
defineElement('predictive-search', PredictiveSearch);
