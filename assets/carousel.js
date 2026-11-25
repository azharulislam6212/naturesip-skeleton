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

  get currentIndex() {
    const track = this.refs.track;
    const start = track.getBoundingClientRect().left;
    let best = 0;
    let bestDistance = Infinity;
    this.slides.forEach((slide, index) => {
      const distance = Math.abs(slide.getBoundingClientRect().left - start);
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
    track.scrollBy({ left: direction * page * (document.dir === 'rtl' ? -1 : 1), behavior: 'smooth' });
  }

  /** @param {number} index */
  goTo(index, behavior = /** @type {ScrollBehavior} */ ('smooth')) {
    const slide = this.slides[index];
    if (!slide) return;
    const track = this.refs.track;
    track.scrollTo({ left: slide.offsetLeft - track.offsetLeft, behavior });
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
