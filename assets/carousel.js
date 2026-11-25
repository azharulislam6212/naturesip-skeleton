/**
 * @layer L2
 * <slider-component>: a native scroll-snap track with optional previous/next
 * buttons, a progress bar and a "1 / 5" counter. Scrolling, touch and keyboard
 * all stay native; JavaScript only drives the controls.
 *
 *   <slider-component>
 *     <ul ref="track" class="slider__track">…<li class="slider__slide">…</li></ul>
 *     <button ref="previous">…</button> <button ref="next">…</button>
 *     <span ref="progress"></span> <span ref="counter"></span>
 *   </slider-component>
 */
import { Component, defineElement } from '@theme/component';
import { t } from '@theme/utilities';

export class SliderComponent extends Component {
  /** @type {ResizeObserver | null} */
  #resizeObserver = null;

  get slides() {
    return /** @type {HTMLElement[]} */ ([...(this.refs.track?.children ?? [])]);
  }

  /** True when the track lays slides out right to left (RTL languages). */
  get #rtl() {
    return getComputedStyle(this.refs.track).direction === 'rtl';
  }

  /**
   * Inline-start edge of an element: left in LTR, right in RTL.
   * @param {Element} element
   */
  #startEdge(element) {
    const rect = element.getBoundingClientRect();
    return this.#rtl ? rect.right : rect.left;
  }

  get currentIndex() {
    const start = this.#startEdge(this.refs.track);
    let best = 0;
    let bestDistance = Infinity;
    this.slides.forEach((slide, index) => {
      const distance = Math.abs(this.#startEdge(slide) - start);
      if (distance < bestDistance) {
        best = index;
        bestDistance = distance;
      }
    });
    return best;
  }

  mount() {
    const { track, previous, next } = this.refs;
    if (!track) return;

    if (previous) this.listen(previous, 'click', () => this.step(-1));
    if (next) this.listen(next, 'click', () => this.step(1));
    this.listen(track, 'scroll', () => this.update(), { passive: true });

    this.#resizeObserver = new ResizeObserver(() => this.update());
    this.#resizeObserver.observe(track);
    this.update();
  }

  unmount() {
    this.#resizeObserver?.disconnect();
  }

  /** @param {number} direction -1 or 1 */
  step(direction) {
    const track = this.refs.track;
    const page = track.clientWidth;
    track.scrollBy({ left: direction * page * (this.#rtl ? -1 : 1), behavior: 'smooth' });
  }

  /** @param {number} index */
  goTo(index, behavior = /** @type {ScrollBehavior} */ ('smooth')) {
    const slide = this.slides[index];
    if (!slide) return;
    // Scroll by the gap between the slide's start edge and the track's, which
    // is correct in both directions (RTL scrollLeft runs negative).
    const track = this.refs.track;
    track.scrollBy({ left: this.#startEdge(slide) - this.#startEdge(track), behavior });
  }

  update() {
    const { track, previous, next, progress, counter } = this.refs;
    const max = track.scrollWidth - track.clientWidth;
    const position = Math.abs(track.scrollLeft);
    const scrollable = max > 1;

    this.toggleAttribute('data-scrollable', scrollable);
    if (previous) previous.disabled = !scrollable || position <= 1;
    if (next) next.disabled = !scrollable || position >= max - 1;
    if (progress) {
      const visible = track.clientWidth / track.scrollWidth;
      progress.style.setProperty('--progress-size', String(Math.min(1, visible)));
      progress.style.setProperty('--progress-offset', String(max > 0 ? (position / max) * (1 - visible) : 0));
    }
    if (counter) {
      counter.textContent = t('slidePosition', { index: this.currentIndex + 1, count: this.slides.length });
    }
  }
}

defineElement('slider-component', SliderComponent);
