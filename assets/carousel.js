/**
 * @layer L2
 * <slider-component>: a Swiper-style carousel on a native scroll-snap track.
 * Touch and trackpad scrolling stay native; JavaScript adds mouse dragging,
 * one-slide stepping, infinite loop, autoplay, pagination and arrows.
 *
 *   <slider-component data-loop data-autoplay="5000" data-mobile-only>
 *     <ul ref="track" class="slider__track">…<li class="slider__slide">…</li></ul>
 *     <button ref="previous">…</button> <button ref="next">…</button>
 *     <div ref="pagination" data-type="dots|numbers|progress|scrollbar">…</div>
 *     <span ref="counter"></span>
 *   </slider-component>
 *
 * Arrows and pagination are rendered in Liquid (snippets/carousel-controls.liquid)
 * in their first-slide state, so nothing shifts when this script loads; it
 * only updates their state. `data-scrollable="false"` hides them when every
 * slide already fits.
 *
 *   data-loop         infinite loop: a copy of the slides sits on each side and
 *                     the track jumps back to the real ones once it settles
 *   data-autoplay     delay in ms; pauses on hover, focus, drag, off screen
 *   data-mobile-only  carousel below 750px only (a plain grid above)
 *
 * Arrows can also live outside, in the section heading
 * (blocks/section-heading.liquid): `[data-slider-controls]` holding buttons
 * with `data-slider-step="-1|1"`. The first slider in the section claims them,
 * reveals them and hides its own arrows.
 */
import { Component, defineElement } from '@theme/component';
import { t } from '@theme/utilities';

const MOBILE_QUERY = '(max-width: 749px)';
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
/** Pixels a mouse has to move before a press becomes a drag. */
const DRAG_START = 6;
/** Pixels a drag has to travel to move on by a slide even when it snaps back. */
const DRAG_SWIPE = 40;
/** Attributes stripped from loop copies so they never animate, submit or select in the editor. */
const CLONE_ATTRIBUTES = ['id', 'data-animate', 'data-animate-pending', 'data-animate-text', 'data-animate-stagger', 'data-shopify-editor-block'];
const FOCUSABLE = 'a, button, input, select, textarea, [tabindex]';

export class SliderComponent extends Component {
  /** @type {ResizeObserver | null} */
  #resizeObserver = null;
  /** @type {IntersectionObserver | null} */
  #intersectionObserver = null;
  /** @type {MediaQueryList | null} */
  #mobileQuery = null;

  /** @type {HTMLButtonElement[]} Previous/next buttons from the section heading. */
  #externalButtons = [];

  /** Carousel behaviour is on (always, or below 750px with data-mobile-only). */
  #active = false;
  /** Loop copies are in the track. */
  #looping = false;
  /** Slide the last arrow press or dot is heading for, so quick presses add up. */
  #target = -1;

  /** @type {Set<string>} Reasons autoplay is on hold. */
  #holds = new Set();
  #autoplayTimer = 0;
  #settleTimer = 0;

  /** @type {{ x: number, left: number, index: number, moved: boolean, controller: AbortController } | null} */
  #drag = null;
  #suppressClick = false;

  /** Real slides, without loop copies. */
  get slides() {
    return /** @type {HTMLElement[]} */ ([...(this.refs.track?.children ?? [])].filter((slide) => !slide.hasAttribute('data-clone')));
  }

  get #items() {
    return /** @type {HTMLElement[]} */ ([...this.refs.track.children]);
  }

  /** Index of the first real slide among all items. */
  get #offset() {
    return this.#looping ? this.slides.length : 0;
  }

  get #rtl() {
    return getComputedStyle(this.refs.track).direction === 'rtl';
  }

  /** Distance between two neighbouring slide starts (slide width + gap). */
  get #stride() {
    const [first, second] = this.#items;
    if (!first) return 1;
    if (!second) return first.offsetWidth || 1;
    return Math.abs(second.getBoundingClientRect().left - first.getBoundingClientRect().left) || 1;
  }

  get #position() {
    return Math.abs(this.refs.track.scrollLeft);
  }

  get #maxPosition() {
    const track = this.refs.track;
    return track.scrollWidth - track.clientWidth;
  }

  /** Slides that fit in view at once. */
  get #perView() {
    return Math.max(1, Math.round(this.refs.track.clientWidth / this.#stride));
  }

  /** Item index (loop copies included) of the slide at the start edge. */
  get #index() {
    return Math.round(this.#position / this.#stride);
  }

  /** Index of the real slide at the start edge. */
  get currentIndex() {
    const count = this.slides.length;
    if (!count) return 0;
    return (((this.#index - this.#offset) % count) + count) % count;
  }

  /** Snap stops before the end; the last few slides share the final stop. */
  get #stopCount() {
    const count = this.slides.length;
    return this.#looping ? count : Math.max(1, count - this.#perView + 1);
  }

  /** Pagination page: one per slide, like the dots rendered in Liquid. */
  get #page() {
    if (this.#looping) return this.currentIndex;
    if (this.#position >= this.#maxPosition - 1) return this.slides.length - 1;
    return Math.min(this.#index, this.slides.length - 1);
  }

  get #scrollable() {
    return this.dataset.scrollable === 'true';
  }

  get #autoplayDelay() {
    return Number(this.dataset.autoplay) || 0;
  }

  mount() {
    const { track, previous, next } = this.refs;
    if (!track) return;

    if (previous) this.listen(previous, 'click', () => this.step(-1));
    if (next) this.listen(next, 'click', () => this.step(1));
    this.#claimExternalControls();
    this.#bindPagination();

    this.listen(track, 'scroll', () => this.#onScroll(), { passive: true });
    if ('onscrollend' in window) this.listen(track, 'scrollend', () => this.#settle());
    this.listen(track, 'pointerdown', (event) => this.#dragStart(event));
    this.listen(track, 'dragstart', (event) => event.preventDefault());
    this.listen(track, 'click', (event) => this.#blockClickAfterDrag(event), { capture: true });

    this.listen(this, 'pointerenter', (event) => event.pointerType === 'mouse' && this.#hold('hover'));
    this.listen(this, 'pointerleave', () => this.#release('hover'));
    this.listen(this, 'focusin', () => this.#hold('focus'));
    this.listen(this, 'focusout', (event) => !this.contains(/** @type {Node} */ (event.relatedTarget)) && this.#release('focus'));
    this.listen(document, 'visibilitychange', () => (document.hidden ? this.#hold('hidden') : this.#release('hidden')));
    this.listen(document, 'shopify:block:select', (event) => this.#onEditorSelect(event));
    this.listen(document, 'shopify:block:deselect', () => this.#release('editor'));

    this.#intersectionObserver = new IntersectionObserver(([entry]) =>
      entry.isIntersecting ? this.#release('offscreen') : this.#hold('offscreen')
    );
    this.#intersectionObserver.observe(this);

    if (this.hasAttribute('data-mobile-only')) {
      this.#mobileQuery = matchMedia(MOBILE_QUERY);
      this.listen(this.#mobileQuery, 'change', () => this.#setup());
    }

    this.#resizeObserver = new ResizeObserver(() => this.#onResize());
    this.#resizeObserver.observe(track);
    this.#setup();
  }

  unmount() {
    this.#resizeObserver?.disconnect();
    this.#intersectionObserver?.disconnect();
    this.#drag?.controller.abort();
    clearTimeout(this.#autoplayTimer);
    clearTimeout(this.#settleTimer);
    this.#externalButtons[0]?.closest('[data-slider-controls]')?.removeAttribute('data-claimed');
    this.#externalButtons = [];
  }

  /** @param {number} direction -1 or 1 */
  step(direction) {
    const from = this.#target >= 0 ? this.#target : this.#index;
    this.#goToItem(from + direction);
  }

  /**
   * Scrolls a real slide to the start edge.
   * @param {number} index
   * @param {ScrollBehavior} [behavior]
   */
  goTo(index, behavior = 'smooth') {
    this.#goToItem(this.#offset + index, behavior);
  }

  update() {
    const { previous, next, pagination } = this.refs;
    const scrollable = this.#active && this.#maxPosition > 1;
    const atStart = this.#position <= 1;
    const atEnd = this.#position >= this.#maxPosition - 1;

    this.dataset.scrollable = String(scrollable);
    const disable = (/** @type {number} */ direction) => !scrollable || (!this.#looping && (direction < 0 ? atStart : atEnd));
    if (previous) previous.disabled = disable(-1);
    if (next) next.disabled = disable(1);
    for (const button of this.#externalButtons) button.disabled = disable(Number(button.dataset.sliderStep));

    if (!pagination || !scrollable) return;
    this.#renderPagination(pagination);
  }

  // ---------- Setup ----------

  #setup() {
    this.#active = !this.#mobileQuery || this.#mobileQuery.matches;
    this.#syncLoop();
    this.#target = -1;
    this.update();
    this.#schedule();
  }

  #onResize() {
    // A resize can change how many slides fit, which decides whether the loop has room.
    this.#syncLoop();
    this.update();
  }

  /** Adds or removes the loop copies to match the current state. */
  #syncLoop() {
    const count = this.slides.length;
    const wanted = this.#active && this.hasAttribute('data-loop') && count > 1 && count > this.#perView;
    if (wanted === this.#looping) return;

    const realIndex = this.currentIndex;
    const track = this.refs.track;
    for (const clone of track.querySelectorAll(':scope > [data-clone]')) clone.remove();
    this.#looping = wanted;

    if (wanted) {
      const real = this.slides;
      track.prepend(...real.map((slide) => this.#clone(slide)));
      track.append(...real.map((slide) => this.#clone(slide)));
    }
    this.#goToItem(this.#offset + realIndex, 'instant');
  }

  /** @param {HTMLElement} slide */
  #clone(slide) {
    const copy = /** @type {HTMLElement} */ (slide.cloneNode(true));
    copy.setAttribute('data-clone', '');
    copy.setAttribute('aria-hidden', 'true');
    for (const node of [copy, ...copy.querySelectorAll('*')]) {
      for (const name of CLONE_ATTRIBUTES) node.removeAttribute(name);
      if (node.matches(FOCUSABLE)) node.setAttribute('tabindex', '-1');
    }
    return copy;
  }

  #claimExternalControls() {
    const controls = this.closest('.shopify-section')?.querySelector('[data-slider-controls]');
    if (!(controls instanceof HTMLElement) || controls.hasAttribute('data-claimed')) return;

    controls.setAttribute('data-claimed', '');
    controls.hidden = false;
    this.setAttribute('data-external-controls', '');
    this.#externalButtons = /** @type {HTMLButtonElement[]} */ ([...controls.querySelectorAll('[data-slider-step]')]);
    for (const button of this.#externalButtons) {
      this.listen(button, 'click', () => this.step(Number(button.dataset.sliderStep)));
    }
  }

  // ---------- Movement ----------

  /**
   * @param {number} index item index, loop copies included
   * @param {ScrollBehavior} [behavior]
   */
  #goToItem(index, behavior = 'smooth') {
    const track = this.refs.track;
    if (!track || !this.#items.length) return;

    const last = this.#looping ? this.#items.length - this.#perView : this.#stopCount - 1;
    const target = Math.max(0, Math.min(index, Math.max(0, last)));
    const left = Math.min(target * this.#stride, this.#maxPosition);
    this.#target = behavior === 'smooth' ? target : -1;

    if (Math.abs(left - this.#position) < 1) {
      this.#settle();
      return;
    }
    if (behavior === 'smooth' && matchMedia(REDUCED_MOTION).matches) behavior = 'instant';
    track.scrollTo({ left: left * (this.#rtl ? -1 : 1), behavior });
    // An instant jump is already over: settle now rather than wait for scrollend.
    if (behavior !== 'smooth') this.#settle();
  }

  #onScroll() {
    this.update();
    if ('onscrollend' in window) return;
    clearTimeout(this.#settleTimer);
    this.#settleTimer = window.setTimeout(() => this.#settle(), 120);
  }

  /** Runs once the track stops moving: wraps the loop and restarts autoplay. */
  #settle() {
    if (this.#drag) return;
    this.#target = -1;
    this.removeAttribute('data-dragging');

    if (this.#looping) {
      const count = this.slides.length;
      const index = this.#index;
      const shift = index < count ? count : index >= count * 2 ? -count : 0;
      if (shift) {
        const track = this.refs.track;
        track.scrollTo({ left: (index + shift) * this.#stride * (this.#rtl ? -1 : 1), behavior: 'instant' });
      }
    }

    this.update();
    const counter = this.refs.counter;
    if (counter) counter.textContent = t('slidePosition', { index: this.currentIndex + 1, count: this.slides.length });
    this.#schedule();
  }

  // ---------- Mouse drag ----------

  /** @param {PointerEvent} event */
  #dragStart(event) {
    if (event.pointerType !== 'mouse' || event.button !== 0 || !this.#scrollable) return;

    const controller = new AbortController();
    this.#drag = { x: event.clientX, left: this.refs.track.scrollLeft, index: this.#index, moved: false, controller };
    const options = { signal: controller.signal };
    window.addEventListener('pointermove', (move) => this.#dragMove(move), options);
    window.addEventListener('pointerup', (up) => this.#dragEnd(up), options);
    window.addEventListener('pointercancel', (up) => this.#dragEnd(up), options);
  }

  /** @param {PointerEvent} event */
  #dragMove(event) {
    const drag = this.#drag;
    if (!drag) return;
    const delta = event.clientX - drag.x;
    if (!drag.moved) {
      if (Math.abs(delta) < DRAG_START) return;
      drag.moved = true;
      this.setAttribute('data-dragging', '');
      this.#hold('drag');
    }
    this.refs.track.scrollLeft = drag.left - delta;
  }

  /** @param {PointerEvent} event */
  #dragEnd(event) {
    const drag = this.#drag;
    if (!drag) return;
    drag.controller.abort();
    this.#drag = null;
    if (!drag.moved) return;

    this.#suppressClick = true;
    setTimeout(() => (this.#suppressClick = false));
    this.#release('drag');

    // Like Swiper: a short flick still moves on by one slide.
    const delta = event.clientX - drag.x;
    let index = this.#index;
    if (index === drag.index && Math.abs(delta) > DRAG_SWIPE) {
      index += (delta < 0 ? 1 : -1) * (this.#rtl ? -1 : 1);
    }
    this.#goToItem(index);
  }

  /** @param {MouseEvent} event */
  #blockClickAfterDrag(event) {
    if (!this.#suppressClick) return;
    event.preventDefault();
    event.stopPropagation();
  }

  // ---------- Pagination ----------

  #bindPagination() {
    const pagination = this.refs.pagination;
    if (!pagination) return;

    this.listen(pagination, 'click', (event) => {
      const dot = /** @type {HTMLElement} */ (event.target).closest('[data-page]');
      if (dot instanceof HTMLElement) this.#goToPage(Number(dot.dataset.page));
    });

    if (pagination.dataset.type !== 'scrollbar') return;
    // The scrollbar is draggable and clickable, like Swiper's.
    this.listen(pagination, 'pointerdown', (event) => {
      const controller = new AbortController();
      const seek = (/** @type {PointerEvent} */ pointer) => {
        const rect = pagination.getBoundingClientRect();
        let ratio = Math.min(1, Math.max(0, (pointer.clientX - rect.left) / rect.width));
        if (this.#rtl) ratio = 1 - ratio;
        this.#goToPage(Math.round(ratio * (this.#stopCount - 1)), 'instant');
      };
      const stop = () => {
        controller.abort();
        this.#settle();
      };
      seek(event);
      window.addEventListener('pointermove', seek, { signal: controller.signal });
      window.addEventListener('pointerup', stop, { signal: controller.signal });
    });
  }

  /**
   * @param {number} page
   * @param {ScrollBehavior} [behavior]
   */
  #goToPage(page, behavior = 'smooth') {
    this.#goToItem(this.#offset + page, behavior);
  }

  /** @param {HTMLElement} pagination */
  #renderPagination(pagination) {
    const count = this.slides.length;
    const page = this.#page;

    switch (pagination.dataset.type) {
      case 'dots':
        pagination.querySelectorAll('[data-page]').forEach((dot, index) => {
          dot.toggleAttribute('aria-current', index === page);
        });
        break;
      case 'numbers': {
        const current = pagination.querySelector('[data-current]');
        if (current) current.textContent = String(page + 1);
        break;
      }
      case 'progress':
        pagination.style.setProperty('--progress-size', String((page + 1) / count));
        break;
      default: {
        // Scrollbar: thumb sized to what is in view, moving with the scroll.
        const size = Math.min(1, this.#perView / count);
        const stops = this.#stopCount;
        const travelled = this.#looping
          ? (stops > 1 ? this.currentIndex / (stops - 1) : 0)
          : (this.#maxPosition > 0 ? this.#position / this.#maxPosition : 0);
        pagination.style.setProperty('--progress-size', String(size));
        pagination.style.setProperty('--progress-offset', String(travelled * (1 - size)));
      }
    }
  }

  // ---------- Autoplay ----------

  /** @param {string} reason */
  #hold(reason) {
    this.#holds.add(reason);
    clearTimeout(this.#autoplayTimer);
  }

  /** @param {string} reason */
  #release(reason) {
    if (!this.#holds.delete(reason)) return;
    this.#schedule();
  }

  #schedule() {
    clearTimeout(this.#autoplayTimer);
    const delay = this.#autoplayDelay;
    if (!delay || !this.#active || this.#holds.size || matchMedia(REDUCED_MOTION).matches) return;
    this.#autoplayTimer = window.setTimeout(() => this.#advance(), delay);
  }

  #advance() {
    if (!this.#scrollable) return;
    // Without a loop, rewind to the first slide after the last one.
    if (!this.#looping && this.#position >= this.#maxPosition - 1) this.#goToItem(0);
    else this.step(1);
  }

  // ---------- Theme editor ----------

  /** @param {Event} event */
  #onEditorSelect(event) {
    const block = /** @type {HTMLElement} */ (event.target);
    const slide = this.slides.findIndex((item) => item.contains(block));
    if (slide < 0) return;
    this.#hold('editor');
    this.goTo(slide, 'instant');
  }
}

defineElement('slider-component', SliderComponent);
