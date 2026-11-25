/**
 * @layer L3
 * <media-gallery>: product media slider + thumbnails + PhotoSwipe zoom.
 * Follows the selected variant's featured media.
 */
import { Component, defineElement } from '@theme/component';
import { VariantChangeEvent } from '@theme/events';
import { openZoom, preloadZoom } from '@theme/media-zoom';

class MediaGallery extends Component {
  /** @type {IntersectionObserver | null} */
  #observer = null;

  mount() {
    const { track, thumbnails = [] } = this.refs;
    if (!track) return;

    for (const thumbnail of thumbnails) {
      this.listen(thumbnail, 'click', () => this.select(thumbnail.dataset.mediaId));
    }

    this.listen(this, 'click', (event) => {
      const link = /** @type {Element} */ (event.target).closest('[data-zoom-item]');
      if (!link) return;
      event.preventDefault();
      this.#zoom(/** @type {HTMLAnchorElement} */ (link));
    });
    this.listen(this, 'pointerenter', () => preloadZoom(), { once: true });
    this.listen(this, 'focusin', () => preloadZoom(), { once: true });

    this.listen(document, VariantChangeEvent.eventName, (event) => {
      const { variant, sectionId } = event.detail;
      if (sectionId !== this.dataset.sectionId || !variant?.featured_media) return;
      this.select(String(variant.featured_media.id));
    });

    this.#observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) this.#markCurrent(/** @type {HTMLElement} */ (entry.target).dataset.mediaId);
      }
    }, { root: track, threshold: 0.6 });
    for (const slide of track.children) this.#observer.observe(slide);

    if (this.querySelector('model-viewer')) this.#loadModelViewer();
  }

  unmount() {
    this.#observer?.disconnect();
  }

  /** @param {string | undefined} mediaId */
  select(mediaId) {
    const slide = /** @type {HTMLElement | null} */ (this.refs.track.querySelector(`[data-media-id="${mediaId}"]`));
    if (!slide) return;
    const track = this.refs.track;
    const vertical = track.scrollHeight > track.clientHeight + 1 && track.scrollWidth <= track.clientWidth + 1;
    if (vertical) {
      slide.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else {
      track.scrollTo({ left: slide.offsetLeft - track.offsetLeft, behavior: 'smooth' });
    }
    this.#markCurrent(mediaId);
  }

  /** @param {string | undefined} mediaId */
  #markCurrent(mediaId) {
    for (const thumbnail of this.refs.thumbnails ?? []) {
      const current = thumbnail.dataset.mediaId === mediaId;
      thumbnail.setAttribute('aria-current', String(current));
      if (current) thumbnail.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  /** @param {HTMLAnchorElement} link */
  #zoom(link) {
    const items = /** @type {HTMLAnchorElement[]} */ ([...this.querySelectorAll('[data-zoom-item]')]);
    openZoom(items, items.indexOf(link), {
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
