/**
 * @layer L3
 * <pagination-component>: in-place pagination for every paginated section.
 *
 * Works the way Shopify's own themes do: the page URL plus `section_id`
 * (Section Rendering API) is requested with a plain fetch(), the returned
 * HTML is parsed with DOMParser, and the matching part is swapped in.
 * Filtering stays with <facets-form> (assets/facets.js); this only paginates.
 *
 *   data-type="numbered"  a page link replaces `[data-pagination-results]`
 *                         (or the whole section) and pushes the URL to history.
 *   data-type="load_more" the button appends the next page to [data-pagination-grid].
 *   data-type="infinite"  the same, when the element nears the viewport.
 *
 * Any failure falls back to a normal navigation to the same URL.
 */
import { Component, defineElement } from '@theme/component';
import { ContentUpdateEvent } from '@theme/events';

const RESULTS = '[data-pagination-results]';
const GRID = '[data-pagination-grid]';

/** @type {AbortController | null} */
let pageRequest = null;

/**
 * Fetches `pageUrl` rendered as one section and returns it as a document.
 * @param {string} pageUrl
 * @param {string} sectionId
 * @param {AbortSignal} [signal]
 */
async function fetchSectionDocument(pageUrl, sectionId, signal) {
  const url = new URL(pageUrl, window.location.origin);
  url.searchParams.set('section_id', sectionId);

  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Pagination request failed: ${response.status}`);

  const text = await response.text();
  return new DOMParser().parseFromString(text, 'text/html');
}

class PaginationComponent extends Component {
  #loading = false;
  /** @type {IntersectionObserver | null} */
  #observer = null;

  get section() {
    return /** @type {HTMLElement | null} */ (this.closest('.shopify-section'));
  }

  get sectionId() {
    return this.section?.id.replace('shopify-section-', '') ?? '';
  }

  mount() {
    this.setAttribute('data-ready', '');
    if (this.dataset.type === 'load_more' || this.dataset.type === 'infinite') {
      this.#mountAppend();
    } else {
      this.#mountNumbered();
    }
  }

  unmount() {
    this.#observer?.disconnect();
    this.#observer = null;
  }

  /* ---------------------------------------------------------- numbered */

  #mountNumbered() {
    const sectionId = this.sectionId;
    if (!sectionId) return;

    // Mark the current entry so Back to it is ours to restore.
    if (history.state?.pagination !== sectionId) {
      history.replaceState({ ...(history.state ?? {}), pagination: sectionId }, '');
    }

    this.listen(this, 'click', (event) => {
      const mouse = /** @type {MouseEvent} */ (event);
      if (mouse.button !== 0 || mouse.metaKey || mouse.ctrlKey || mouse.shiftKey || mouse.altKey) return;
      const link = /** @type {Element} */ (event.target).closest('a[data-pagination-link]');
      if (!link) return;
      event.preventDefault();
      this.#goTo(/** @type {HTMLAnchorElement} */ (link).href, true);
    });

    this.listen(window, 'popstate', (event) => {
      if (event.state?.pagination !== sectionId) return;
      // Filtered grids: <facets-form> already re-renders on Back/Forward.
      if (customElements.get('facets-form') && this.section?.querySelector('facets-form')) return;
      this.#goTo(window.location.href, false);
    });
  }

  /**
   * @param {string} url
   * @param {boolean} push
   */
  async #goTo(url, push) {
    const section = this.section;
    const sectionId = this.sectionId;
    if (!section || !sectionId) {
      window.location.href = url;
      return;
    }

    pageRequest?.abort();
    pageRequest = new AbortController();
    const current = section.querySelector(RESULTS);
    const busy = current ?? section;
    busy.setAttribute('aria-busy', 'true');

    try {
      const doc = await fetchSectionDocument(url, sectionId, pageRequest.signal);
      const source = doc.querySelector('.shopify-section') ?? doc.body;

      if (current) {
        const next = source.querySelector(RESULTS);
        if (!next) throw new Error('No results in the rendered section');
        current.replaceWith(next);
      } else {
        section.innerHTML = source.innerHTML;
      }

      if (push) history.pushState({ pagination: sectionId }, '', url);

      section.dispatchEvent(new ContentUpdateEvent({ root: section }));

      const top = section.querySelector(RESULTS) ?? section;
      if (top.getBoundingClientRect().top < 0) {
        top.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }
    } catch (error) {
      if (/** @type {Error} */ (error).name !== 'AbortError') window.location.href = url;
    } finally {
      busy.removeAttribute('aria-busy');
    }
  }

  /* ---------------------------------------------- load more / infinite */

  #mountAppend() {
    // Delegated: the button may be re-rendered when filters change.
    this.listen(this, 'click', (event) => {
      if (!(/** @type {Element} */ (event.target).closest('[data-load-more]'))) return;
      event.preventDefault();
      this.#append(true);
    });

    if (this.dataset.type === 'infinite') {
      this.#observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) this.#append(false);
        },
        { rootMargin: '0px 0px 600px 0px' }
      );
      // Watch the last item, not this element: this one floats (sticky) at
      // the bottom of the screen, so it would always look "in view".
      const watchLast = () => {
        this.#observer?.disconnect();
        const sentinel = this.section?.querySelector(GRID)?.lastElementChild ?? this;
        this.#observer?.observe(sentinel);
      };
      watchLast();
      // Filters re-render the grid: follow its new last item.
      if (this.section) this.listen(this.section, ContentUpdateEvent.eventName, watchLast);
    }
  }

  /** @param {boolean} fromClick */
  async #append(fromClick) {
    const url = this.dataset.nextUrl;
    if (!url || this.#loading) return;

    const section = this.section;
    const grid = section?.querySelector(GRID);
    if (!section || !grid) {
      window.location.href = url;
      return;
    }

    this.#loading = true;
    this.setAttribute('aria-busy', 'true');

    try {
      const doc = await fetchSectionDocument(url, this.sectionId);
      const nextGrid = doc.querySelector(GRID);
      if (!nextGrid) throw new Error('No grid in the rendered section');

      const items = [...nextGrid.children];
      grid.append(...items);

      const next = doc.querySelector('pagination-component');
      if (next) this.replaceWith(next);
      else this.remove();


      section.dispatchEvent(new ContentUpdateEvent({ root: section }));

      // Keyboard and screen reader users continue from the first new item.
      if (fromClick) {
        /** @type {HTMLElement | null | undefined} */ (items[0]?.querySelector('a[href]'))?.focus({ preventScroll: true });
      }
    } catch (error) {
      window.location.href = url;
    } finally {
      this.#loading = false;
      this.removeAttribute('aria-busy');
    }
  }
}

defineElement('pagination-component', PaginationComponent);
