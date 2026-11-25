/**
 * @layer L3
 * <scroll-to-top>: the "back to top" button (snippets/scroll-to-top.liquid).
 *
 *   data-visible     set once the page is scrolled past SHOW_AFTER
 *   data-scrolling   set while the page is moving (scroll animation)
 *   --scroll-progress 0–1, turns the tilted shape behind the button
 *
 * Clicking asks for a scroll to the top with ScrollToEvent: smooth scroll
 * (Lenis) handles it when it runs, otherwise the browser scrolls natively.
 * Scroll work is batched into one animation frame.
 */
import { Component, defineElement } from '@theme/component';
import { ScrollToEvent } from '@theme/events';
import { prefersReducedMotion } from '@theme/utilities';

/** Show the button after this share of a viewport height has been scrolled. */
const SHOW_AFTER = 0.6;
const SCROLLING_IDLE_MS = 160;

class ScrollToTop extends Component {
  #frame = 0;
  /** @type {number | undefined} */
  #idleTimer;

  mount() {
    this.listen(window, 'scroll', () => this.#schedule(), { passive: true });
    this.listen(window, 'resize', () => this.#schedule(), { passive: true });
    this.listen(this.refs.button, 'click', () => this.#toTop());
    this.#update();
  }

  unmount() {
    window.cancelAnimationFrame(this.#frame);
    window.clearTimeout(this.#idleTimer);
  }

  #schedule() {
    this.setAttribute('data-scrolling', '');
    window.clearTimeout(this.#idleTimer);
    this.#idleTimer = window.setTimeout(() => this.removeAttribute('data-scrolling'), SCROLLING_IDLE_MS);

    if (this.#frame) return;
    this.#frame = window.requestAnimationFrame(() => {
      this.#frame = 0;
      this.#update();
    });
  }

  #update() {
    const top = window.scrollY;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const visible = top > window.innerHeight * SHOW_AFTER;

    this.style.setProperty('--scroll-progress', String(max > 0 ? Math.min(top / max, 1) : 0));
    this.toggleAttribute('data-visible', visible);
    // Reachable by keyboard only while it is shown.
    this.refs.button.tabIndex = visible ? 0 : -1;
  }

  #toTop() {
    const request = new ScrollToEvent({ top: 0, handled: false });
    this.dispatchEvent(request);
    if (!request.detail.handled) {
      window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    }
    // Continue keyboard navigation from the top of the page.
    const skipTarget = document.querySelector('header a, header button');
    if (skipTarget instanceof HTMLElement) skipTarget.focus({ preventScroll: true });
  }
}

defineElement('scroll-to-top', ScrollToTop);
