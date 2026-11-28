/**
 * @layer L3
 * <scroll-media>: writes the element's scroll progress to `--progress`
 * (0 → 1) so CSS can scrub an animation with the page scroll. Used by the
 * Image with text section (blocks/_image-with-text-media.liquid, the image's
 * entrance) and its floating images (blocks/_floating-image.liquid, parallax).
 *
 * data-range="enter" (default): 0 while the element's top is at the bottom of
 *   the viewport, 1 once the element is centred in it. Eased (power2.out),
 *   like a scrubbed GSAP tween.
 * data-range="through": 0 as the element enters at the bottom, 1 as it leaves
 *   at the top. Linear, for parallax.
 *
 * Under prefers-reduced-motion the progress stays at 1 (the final state).
 * Without JavaScript `--progress` is unset and the CSS falls back to 1 too.
 */
import { Component, defineElement } from '@theme/component';
import { prefersReducedMotion } from '@theme/utilities';

/** @param {number} value */
const clamp = (value) => Math.min(1, Math.max(0, value));

class ScrollMedia extends Component {
  /** @type {IntersectionObserver | null} */
  #observer = null;
  #frame = 0;
  #visible = false;

  mount() {
    if (prefersReducedMotion()) {
      this.style.setProperty('--progress', '1');
      return;
    }

    const schedule = () => {
      if (!this.#visible || this.#frame) return;
      this.#frame = requestAnimationFrame(() => {
        this.#frame = 0;
        this.#update();
      });
    };

    this.#observer = new IntersectionObserver(([entry]) => {
      this.#visible = Boolean(entry?.isIntersecting);
      if (this.#visible) schedule();
    }, { rootMargin: '10% 0px' });
    this.#observer.observe(this);

    this.listen(window, 'scroll', schedule, { passive: true });
    this.listen(window, 'resize', schedule, { passive: true });
    this.#update();
  }

  unmount() {
    this.#observer?.disconnect();
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
  }

  #update() {
    const box = this.getBoundingClientRect();
    const viewport = window.innerHeight || 1;
    let progress;

    if (this.dataset.range === 'through') {
      progress = clamp((viewport - box.top) / (viewport + box.height));
    } else {
      const start = viewport;
      const end = Math.min((viewport - box.height) / 2, viewport * 0.6);
      progress = clamp((start - box.top) / (start - end || 1));
      progress = 1 - (1 - progress) ** 2;
    }

    this.style.setProperty('--progress', progress.toFixed(4));
  }
}

defineElement('scroll-media', ScrollMedia);
