/**
 * @layer L2
 * Lightbox zoom for product images, powered by PhotoSwipe. Everything (the
 * lightbox, the core and its stylesheet) loads on the first request to zoom.
 * The stylesheet URL comes from the product media gallery that uses zoom
 * (`data-zoom-stylesheet`), so no other page ever references it.
 *
 * Items come from Liquid: `<a href="large.jpg" data-zoom-item data-width data-height>`
 * with the image alt text used as caption. Video and 3D media are never zoomable.
 */
import { t } from '@theme/utilities';

/** @type {Promise<any> | null} */
let lightboxModule = null;

/** @param {string | undefined} href */
function loadStylesheet(href) {
  if (!href || document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.append(link);
}

/**
 * Warm the modules on hover/focus intent so the first open is instant.
 * @param {string} [stylesheet] URL of photoswipe.css
 */
export function preloadZoom(stylesheet) {
  lightboxModule ??= import('@theme/photoswipe-lightbox');
  loadStylesheet(stylesheet);
  return lightboxModule;
}

/**
 * @param {HTMLAnchorElement[]} items
 * @param {number} index
 * @param { { stylesheet?: string, onChange?: (index: number) => void } } [options]
 */
export async function openZoom(items, index, { stylesheet, onChange } = {}) {
  const { default: PhotoSwipeLightbox } = await preloadZoom(stylesheet);

  const dataSource = items.map((item) => {
    const image = item.querySelector('img');
    return {
      src: item.href,
      width: Number(item.dataset.width),
      height: Number(item.dataset.height),
      alt: image?.alt ?? '',
      msrc: image?.currentSrc,
      element: item,
    };
  });

  const lightbox = new PhotoSwipeLightbox({
    dataSource,
    pswpModule: () => import('@theme/photoswipe'),
    bgOpacity: 0.95,
    showHideAnimationType: 'zoom',
    closeTitle: t('close'),
    zoomTitle: t('zoom'),
    arrowPrevTitle: t('previous'),
    arrowNextTitle: t('next'),
    errorMsg: t('imageError'),
    returnFocus: true,
  });

  lightbox.addFilter('thumbEl', (/** @type {any} */ thumb, /** @type {any} */ data) => data.element?.querySelector('img') ?? thumb);
  lightbox.on('change', () => onChange?.(lightbox.pswp.currIndex));
  lightbox.init();
  lightbox.loadAndOpen(index);
  return lightbox;
}
