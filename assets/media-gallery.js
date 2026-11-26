/**
 * @layer L3
 * <media-gallery>: product media carousel (or grid) with thumbnails,
 * previous/next arrows, a mobile counter, a hover magnifier and the
 * PhotoSwipe lightbox. Follows the selected variant's featured media.
 *
 * Optional refs: thumbnails[], previous, next, counter.
 * data-zoom: 'hover' (magnifier on fine pointers, click opens the lightbox),
 * 'click' (lightbox only) or 'none'.
 */
import { Component, defineElement } from '@theme/component';
import { VariantChangeEvent } from '@theme/events';
import { openZoom, preloadZoom } from '@theme/media-zoom';

const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');

class MediaGallery extends Component {
  /** @type {IntersectionObserver | null} */
  #observer = null;

  /** Media id of the slide currently shown. */
  #currentId = '';

  mount() {
    const { track, thumbnails = [], previous, next } = this.refs;
    if (!track) return;

    for (const thumbnail of thumbnails) {
      this.listen(thumbnail, 'click', () => this.select(thumbnail.dataset.mediaId));
    }
    if (previous) this.listen(previous, 'click', () => this.#step(-1));
    if (next) this.listen(next, 'click', () => this.#step(1));

    this.#setUpZoom();

    this.listen(document, VariantChangeEvent.eventName, (event) => {
      const { variant, sectionId } = event.detail;
      if (sectionId !== this.dataset.sectionId || !variant?.featured_media) return;
      const mediaId = String(variant.featured_media.id);
      if (this.#isGrid()) this.#markFeatured(mediaId);
      this.select(mediaId);
    });

    this.#observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) this.#markCurrent(/** @type {HTMLElement} */ (entry.target).dataset.mediaId);
      }
    }, { root: track, threshold: 0.6 });
    for (const slide of track.children) this.#observer.observe(slide);

    // Open on the selected variant's media without animating the page load.
    const current = thumbnails.find((thumbnail) => thumbnail.getAttribute('aria-current') === 'true');
    if (current && current !== thumbnails[0]) {
      this.select(current.dataset.mediaId, 'instant');
    } else {
      this.#markCurrent(/** @type {HTMLElement | undefined} */ (track.children[0])?.dataset.mediaId);
    }

    if (this.querySelector('model-viewer')) this.#loadModelViewer();
  }

  unmount() {
    this.#observer?.disconnect();
  }

  /** @returns {HTMLElement[]} */
  get slides() {
    return /** @type {HTMLElement[]} */ ([...this.refs.track.children]);
  }

  /**
   * Shows one media item.
   * @param {string | undefined} mediaId
   * @param {ScrollBehavior} [behavior]
   */
  select(mediaId, behavior = 'smooth') {
    const track = this.refs.track;
    const slide = this.slides.find((item) => item.dataset.mediaId === mediaId);
    if (!slide) return;

    const scrollsSideways = track.scrollWidth > track.clientWidth + 1;
    if (scrollsSideways) {
      track.scrollTo({ left: slide.offsetLeft - track.offsetLeft, behavior });
    } else if (this.#isGrid()) {
      // Grid on desktop: bring the image into view only when it isn't.
      const box = slide.getBoundingClientRect();
      if (box.top < 0 || box.bottom > window.innerHeight) slide.scrollIntoView({ block: 'nearest', behavior });
    }
    this.#markCurrent(mediaId);
  }

  /** @param {number} direction - -1 previous, 1 next. */
  #step(direction) {
    const slides = this.slides;
    const index = slides.findIndex((slide) => slide.dataset.mediaId === this.#currentId);
    const target = slides[Math.min(Math.max(index + direction, 0), slides.length - 1)];
    if (target) this.select(target.dataset.mediaId);
  }

  #isGrid() {
    return this.classList.contains('media-gallery--grid');
  }

  /**
   * Grid layout puts the selected variant's media first (CSS order).
   * @param {string} mediaId
   */
  #markFeatured(mediaId) {
    for (const slide of this.slides) slide.toggleAttribute('data-featured', slide.dataset.mediaId === mediaId);
  }

  /** @param {string | undefined} mediaId */
  #markCurrent(mediaId) {
    if (!mediaId || mediaId === this.#currentId) return;
    this.#currentId = mediaId;

    const { thumbnails = [], previous, next, counter } = this.refs;
    for (const thumbnail of thumbnails) {
      const current = thumbnail.dataset.mediaId === mediaId;
      thumbnail.setAttribute('aria-current', String(current));
      if (current) this.#revealThumbnail(thumbnail);
    }

    const slides = this.slides;
    const index = slides.findIndex((slide) => slide.dataset.mediaId === mediaId);
    if (previous) previous.disabled = index <= 0;
    if (next) next.disabled = index >= slides.length - 1;
    if (counter) counter.textContent = String(index + 1);
  }

  /**
   * Scrolls the thumbnail strip, never the page.
   * @param {HTMLElement} thumbnail
   */
  #revealThumbnail(thumbnail) {
    const list = thumbnail.closest('ul');
    if (!list) return;
    const item = /** @type {HTMLElement} */ (thumbnail.parentElement);
    if (list.scrollWidth > list.clientWidth + 1) {
      const start = item.offsetLeft - list.offsetLeft;
      if (start < list.scrollLeft || start + item.offsetWidth > list.scrollLeft + list.clientWidth) {
        list.scrollTo({ left: start - (list.clientWidth - item.offsetWidth) / 2, behavior: 'smooth' });
      }
    } else if (list.scrollHeight > list.clientHeight + 1) {
      const start = item.offsetTop - list.offsetTop;
      if (start < list.scrollTop || start + item.offsetHeight > list.scrollTop + list.clientHeight) {
        list.scrollTo({ top: start - (list.clientHeight - item.offsetHeight) / 2, behavior: 'smooth' });
      }
    }
  }

  #setUpZoom() {
    const mode = this.dataset.zoom ?? 'click';
    const stylesheet = this.dataset.zoomStylesheet;
    if (mode === 'none' || !stylesheet) return;

    this.listen(this, 'click', (event) => {
      const link = /** @type {Element} */ (event.target).closest('[data-zoom-item]');
      if (!link) return;
      event.preventDefault();
      this.#zoom(/** @type {HTMLAnchorElement} */ (link));
    });
    this.listen(this, 'pointerenter', () => preloadZoom(stylesheet), { once: true });
    this.listen(this, 'focusin', () => preloadZoom(stylesheet), { once: true });

    if (mode !== 'hover') return;

    // Magnifier: the image scales from the pointer position.
    this.listen(this.refs.track, 'pointermove', (event) => {
      if (!finePointer.matches || event.pointerType !== 'mouse') return;
      const link = /** @type {HTMLElement | null} */ (/** @type {Element} */ (event.target).closest('[data-zoom-item]'));
      if (!link) return;
      const box = link.getBoundingClientRect();
      link.style.setProperty('--zoom-x', `${((event.clientX - box.left) / box.width) * 100}%`);
      link.style.setProperty('--zoom-y', `${((event.clientY - box.top) / box.height) * 100}%`);
      link.toggleAttribute('data-magnified', true);
    });
    this.listen(this.refs.track, 'pointerout', (event) => {
      const link = /** @type {Element} */ (event.target).closest('[data-zoom-item]');
      const into = /** @type {Node | null} */ (event.relatedTarget);
      if (link && !(into && link.contains(into))) link.removeAttribute('data-magnified');
    });
  }

  /** @param {HTMLAnchorElement} link */
  #zoom(link) {
    link.removeAttribute('data-magnified');
    const items = /** @type {HTMLAnchorElement[]} */ ([...this.querySelectorAll('[data-zoom-item]')]);
    openZoom(items, items.indexOf(link), {
      stylesheet: this.dataset.zoomStylesheet,
      onChange: (index) => this.select(items[index]?.closest('[data-media-id]')?.getAttribute('data-media-id') ?? undefined),
    });
  }

  #loadModelViewer() {
    const shopify = /** @type {any} */ (window).Shopify;
    shopify?.loadFeatures?.([{ name: 'model-viewer-ui', version: '1.0' }, { name: 'shopify-xr', version: '1.0' }], (/** @type {Error|undefined} */ error) => {
      if (error) return;
      for (const model of this.querySelectorAll('model-viewer')) {
        if (!model.hasAttribute('data-ui')) {
          model.setAttribute('data-ui', '');
          new shopify.ModelViewerUI(model);
        }
      }
    });
  }
}

defineElement('media-gallery', MediaGallery);
