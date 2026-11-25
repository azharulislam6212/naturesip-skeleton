/**
 * @layer L3
 * <page-transition>: a full-screen curtain between pages.
 *
 * snippets/page-transition.liquid renders it covering the page (data-state="covered").
 *   covered → out    : on load, the curtain animates away (fade / slide / reveal).
 *   out     → ready  : parked off-screen without animating.
 *   ready   → covered: on a same-site link click it animates back in, then navigates.
 * The style of each state lives in the snippet's CSS; this only switches states.
 */
import { Component, defineElement } from '@theme/component';
import { prefersReducedMotion } from '@theme/utilities';

class PageTransition extends Component {
  mount() {
    this.setAttribute('data-armed', '');

    if (prefersReducedMotion()) {
      this.#setState('ready');
      return;
    }

    // Let the first frame paint covered, then animate away. On a reload that
    // restores the scroll position (snippets/scroll-restore.liquid), wait until
    // the page is in place so the content never moves while it shows.
    const leaveAfterPaint = () => requestAnimationFrame(() => requestAnimationFrame(() => this.#leave()));
    if (document.documentElement.classList.contains('is-restoring-scroll')) {
      this.listen(document, 'theme:scroll-restored', leaveAfterPaint, { once: true });
    } else {
      leaveAfterPaint();
    }

    this.listen(document, 'click', (event) => this.#onClick(event));

    // Back/forward cache restores the page as it was left: covered.
    this.listen(window, 'pageshow', (event) => {
      if (event.persisted) this.#leave();
    });
  }

  #setState(state) {
    this.dataset.state = state;
  }

  #afterTransition(callback) {
    const ms = parseFloat(getComputedStyle(this).getPropertyValue('--page-transition-duration')) || 700;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      this.removeEventListener('transitionend', onEnd);
      callback();
    };
    const onEnd = (event) => {
      if (event.target === this) finish();
    };
    this.addEventListener('transitionend', onEnd);
    setTimeout(finish, ms + 100);
  }

  #leave() {
    this.#setState('out');
    this.#afterTransition(() => {
      if (this.dataset.state === 'out') this.#setState('ready');
    });
  }

  /** @param {MouseEvent} event */
  #onClick(event) {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (window.Shopify?.designMode) return;

    const link = /** @type {HTMLElement} */ (event.target)?.closest?.('a[href]');
    if (!(link instanceof HTMLAnchorElement)) return;
    if (link.target && link.target !== '_self') return;
    if (link.hasAttribute('download') || link.hasAttribute('data-no-transition')) return;

    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin) return;
    if (!/^https?:$/.test(url.protocol)) return;
    // Same page, different hash: let it scroll.
    if (url.pathname === location.pathname && url.search === location.search && url.hash) return;

    event.preventDefault();
    this.#setState('ready');
    // Commit the parked position before animating in.
    void this.offsetWidth;
    this.#setState('covered');
    this.#afterTransition(() => {
      location.href = url.href;
    });
  }
}

defineElement('page-transition', PageTransition);
