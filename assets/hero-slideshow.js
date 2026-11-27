/**
 * @layer L3
 * Slideshow (hero), sections/hero-slideshow.liquid.
 *
 * Each slide draws its own gradient and can (a section can't read its theme
 * blocks' settings); the cans sit on stages fixed to the viewport, all moved
 * by the custom properties set here on the hero. While the page scrolls from
 * the hero through the next `data-travel` sections, the stage stays put (the
 * can seems to travel down the page) and the can turns, as on
 * hydroflowdrink.com: a full turn forward and one and a half around, eased
 * like a scrubbed power1.out tween. When the last of those sections is
 * centred on the can, the stage scrolls away with it.
 *
 * Slides change with the arrows, a swipe, the arrow keys or autoplay: the
 * old one plays its exit (CSS, `data-leaving`), the new one its entrance
 * (CSS, `data-active`), the gradients cross-fade and the can spins once
 * while it cross-fades to the next one (CSS, once `data-changed` is set).
 *
 * 3D models are <model-viewer> elements, loaded through Shopify's own
 * model-viewer feature; their camera is fitted to the model's bounding sphere
 * so no turn ever clips it.
 */
import { Component, defineElement } from '@theme/component';
import { isDesignMode, prefersReducedMotion } from '@theme/utilities';

/** How long the outgoing slide stays shown: its gradient sits under the
 * incoming one while that fades in (1s in the CSS). */
const LEAVE = 1000;
/** The can's full spin on a slide change. */
const SPIN = 1000;
/** Half the camera's vertical field of view, in radians (field-of-view="30deg"). */
const HALF_FOV = (15 * Math.PI) / 180;

/** @param {number} value */
const clamp = (value) => Math.min(1, Math.max(0, value));
/** GSAP's power1.out. @param {number} t */
const power1Out = (t) => 1 - (1 - t) * (1 - t);
/** @param {number} t */
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

class HeroSlideshow extends Component {
  #index = 0;
  #frame = 0;
  #leaveTimer = 0;
  #autoplayTimer = 0;
  #spinStart = 0;
  #spin = 0;
  #reduced = false;
  /** Document offsets, refreshed on resize. */
  #metrics = { start: 0, pinEnd: 0, turnEnd: 1, height: 1 };
  /** @type {ResizeObserver | null} */
  #resizeObserver = null;
  /** @type {MutationObserver | null} */
  #mutationObserver = null;

  /** @type {HTMLElement[]} */
  #slides = [];

  mount() {
    this.#slides = [...this.querySelectorAll('.hero-slide')];
    this.#reduced = prefersReducedMotion();

    const { previous, next } = this.refs;
    if (previous) this.listen(previous, 'click', () => this.step(-1, true));
    if (next) this.listen(next, 'click', () => this.step(1, true));
    this.listen(this, 'keydown', (event) => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') this.step(event.key === 'ArrowLeft' ? -1 : 1, true);
    });
    this.#bindSwipe();
    this.#bindPointer();

    if (this.querySelector('model-viewer')) this.#loadModels();

    this.#resizeObserver = new ResizeObserver(() => this.#measure());
    this.#resizeObserver.observe(document.body);
    this.listen(window, 'resize', () => this.#measure());
    this.listen(window, 'scroll', () => this.#queue(), { passive: true });
    this.#measure();

    this.#startAutoplay();

    if (isDesignMode()) this.#syncEditor();

    // Theme editor: selecting a slide (or anything in it) shows it.
    this.listen(document, 'shopify:block:select', (event) => {
      const slide = /** @type {Element} */ (event.target).closest?.('.hero-slide');
      const index = slide ? this.#slides.indexOf(/** @type {HTMLElement} */ (slide)) : -1;
      if (index < 0) return;
      this.#stopAutoplay();
      this.go(index);
    });
  }

  unmount() {
    cancelAnimationFrame(this.#frame);
    clearTimeout(this.#leaveTimer);
    clearInterval(this.#autoplayTimer);
    this.#resizeObserver?.disconnect();
    this.#mutationObserver?.disconnect();
  }

  /**
   * @param {number} direction 1 or -1
   * @param {boolean} [byUser]
   */
  step(direction, byUser = false) {
    if (byUser) this.#stopAutoplay();
    const count = this.#slides.length;
    if (count > 1) this.go((this.#index + direction + count) % count);
  }

  /** @param {number} index */
  go(index) {
    const from = this.#index;
    if (index === from || !this.#slides[index]) return;
    this.#index = index;

    clearTimeout(this.#leaveTimer);
    for (const slide of this.#slides) slide.removeAttribute('data-leaving');

    const old = this.#slides[from];
    old.removeAttribute('data-active');
    old.setAttribute('data-leaving', '');
    old.setAttribute('aria-hidden', 'true');
    this.#leaveTimer = window.setTimeout(() => old.removeAttribute('data-leaving'), LEAVE);

    // From now on slides cross-fade, and the new one waits for the old
    // one's letters to clear.
    this.setAttribute('data-changed', '');
    this.style.setProperty('--enter-delay', '0.35s');
    const current = this.#slides[index];
    current.setAttribute('data-active', '');
    current.removeAttribute('aria-hidden');

    if (!this.#reduced) {
      this.#spinStart = performance.now();
      this.#queue();
    }
    this.#announce();
  }

  /* ---------- Scroll ---------- */

  #measure() {
    const viewport = window.innerHeight;
    const rect = this.getBoundingClientRect();
    const start = rect.top + window.scrollY;
    const height = rect.height || viewport;

    // The section `data-travel` places on: its centre meets the can's.
    let target = /** @type {Element} */ (this.closest('.shopify-section') ?? this);
    for (let i = Number(this.dataset.travel ?? 0); i > 0 && target.nextElementSibling; i--) {
      target = target.nextElementSibling;
    }
    let pinEnd = start;
    if (!this.#reduced && !target.contains(this)) {
      const box = target.getBoundingClientRect();
      pinEnd = Math.max(start, box.top + window.scrollY + box.height / 2 - height * 0.518);
    }

    this.#metrics = { start, pinEnd, turnEnd: Math.max(pinEnd, start + height), height };
    this.#queue();
  }

  #queue() {
    if (!this.#frame) this.#frame = requestAnimationFrame(() => this.#render());
  }

  #render() {
    this.#frame = 0;
    const scroll = window.scrollY;
    const { start, pinEnd, turnEnd, height } = this.#metrics;

    // Pinned between start and pinEnd; before and after, it rides the page.
    const offset = scroll < start ? start - scroll : scroll > pinEnd ? pinEnd - scroll : 0;
    const away = Math.abs(offset) > window.innerHeight * 1.5;
    this.style.setProperty('--stage-y', `${offset.toFixed(1)}px`);
    this.toggleAttribute('data-can-away', away);

    this.style.setProperty('--hero-scroll', clamp((scroll - start) / height).toFixed(4));

    // Spin of a slide change, on top of the scroll turn.
    let spinning = false;
    if (this.#spinStart) {
      const t = clamp((performance.now() - this.#spinStart) / SPIN);
      this.#spin = easeInOut(t) * 360;
      spinning = t < 1;
      if (!spinning) {
        this.#spinStart = 0;
        this.#spin = 0;
      }
    }

    if (!away) {
      const turn = this.#reduced ? 0 : power1Out(clamp((scroll - start) / (turnEnd - start || 1)));
      const travel = this.#reduced ? 0 : easeInOut(clamp((scroll - start) / (pinEnd - start || 1)));
      const endX = Number(this.dataset.endX ?? 0);
      const endScale = Number(this.dataset.endScale ?? 1);
      this.style.setProperty('--can-x', `${(endX * travel).toFixed(2)}vw`);
      this.style.setProperty('--can-scale', (1 + (endScale - 1) * travel).toFixed(4));
      this.#turn(this.dataset.spin === 'false' ? 0 : turn);
    }

    if (spinning) this.#queue();
  }

  /**
   * Turns the shown cans (the current slide's and the outgoing one's):
   * pitch 360° and yaw 540° over the scroll.
   * @param {number} progress 0–1
   */
  #turn(progress) {
    const pitch = progress * 360;
    const yaw = progress * 540 + this.#spin;
    const orientation = `0deg ${pitch.toFixed(2)}deg ${yaw.toFixed(2)}deg`;
    this.style.setProperty('--can-turn', `${pitch.toFixed(2)}deg`);
    const viewers = this.querySelectorAll(':is(.hero-slide[data-active], .hero-slide[data-leaving]) model-viewer');
    for (const viewer of /** @type {NodeListOf<any>} */ (viewers)) {
      if (viewer.orientation !== orientation) viewer.orientation = orientation;
    }
  }

  /* ---------- 3D ---------- */

  #loadModels() {
    const shopify = /** @type {any} */ (window).Shopify;
    const fit = () => {
      for (const viewer of /** @type {NodeListOf<any>} */ (this.querySelectorAll('model-viewer'))) {
        if (viewer.loaded) this.#fitCamera(viewer);
        else viewer.addEventListener('load', () => this.#fitCamera(viewer), { once: true, signal: this.signal });
      }
    };
    if (customElements.get('model-viewer')) {
      fit();
      return;
    }
    shopify?.loadFeatures?.([{ name: 'model-viewer-ui', version: '1.0' }], (/** @type {Error|undefined} */ error) => {
      if (error) return;
      customElements.whenDefined('model-viewer').then(fit);
    });
  }

  /**
   * Camera far enough to hold the model's bounding sphere, aimed at its
   * centre, so any orientation stays whole and the same size.
   * @param {any} viewer
   */
  #fitCamera(viewer) {
    const size = viewer.getDimensions?.();
    const center = viewer.getBoundingBoxCenter?.();
    if (!size || !center) return;
    const radius = Math.hypot(size.x, size.y, size.z) / 2;
    const distance = radius / Math.sin(HALF_FOV);
    viewer.cameraTarget = `${center.x}m ${center.y}m ${center.z}m`;
    viewer.cameraOrbit = `0deg 90deg ${distance}m`;
    viewer.jumpCameraToGoal?.();
    this.#queue();
  }

  /* ---------- Theme editor ---------- */

  /**
   * A slide whose settings change is re-rendered on its own, back in its
   * first-render state: keep the one shown shown, and fit its new can.
   */
  #syncEditor() {
    const list = this.querySelector('.hero-slideshow__slides');
    if (!list) return;
    this.#mutationObserver = new MutationObserver((records) => {
      const changed = records.some((record) =>
        [...record.addedNodes].some((node) => node instanceof HTMLElement && node.matches('.hero-slide, .hero-slide *'))
      );
      if (!changed) return;

      this.#slides = [...this.querySelectorAll('.hero-slide')];
      this.#slides.forEach((slide, i) => {
        slide.toggleAttribute('data-active', i === this.#index);
        if (i === this.#index) slide.removeAttribute('aria-hidden');
        else slide.setAttribute('aria-hidden', 'true');
      });
      if (this.querySelector('model-viewer')) this.#loadModels();
      this.#queue();
    });
    this.#mutationObserver.observe(list, { childList: true, subtree: true });
  }

  /* ---------- Input ---------- */

  #bindSwipe() {
    let startX = 0;
    let startY = 0;
    this.listen(this, 'pointerdown', (event) => {
      if (event.pointerType === 'mouse') return;
      startX = event.clientX;
      startY = event.clientY;
    });
    this.listen(this, 'pointerup', (event) => {
      if (event.pointerType === 'mouse') return;
      const dx = event.clientX - startX;
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(event.clientY - startY)) this.step(dx < 0 ? 1 : -1, true);
    });
  }

  /** Floating images drift with a mouse pointer, by their depth. */
  #bindPointer() {
    if (this.#reduced) return;
    this.listen(this, 'pointermove', (event) => {
      if (event.pointerType !== 'mouse') return;
      this.style.setProperty('--mx', ((event.clientX / window.innerWidth - 0.5) * 2).toFixed(3));
      this.style.setProperty('--my', ((event.clientY / window.innerHeight - 0.5) * 2).toFixed(3));
    });
    this.listen(this, 'pointerleave', () => {
      this.style.setProperty('--mx', '0');
      this.style.setProperty('--my', '0');
    });
  }

  #startAutoplay() {
    const delay = Number(this.dataset.autoplay ?? 0);
    if (!delay || this.#slides.length < 2 || this.#reduced || isDesignMode()) return;
    let paused = false;
    this.listen(this, 'pointerenter', () => (paused = true));
    this.listen(this, 'pointerleave', () => (paused = false));
    this.listen(this, 'focusin', () => (paused = true));
    this.listen(this, 'focusout', () => (paused = false));
    this.#autoplayTimer = window.setInterval(() => paused || document.hidden || this.step(1), delay);
  }

  #stopAutoplay() {
    clearInterval(this.#autoplayTimer);
  }

  #announce() {
    const { status } = this.refs;
    const template = /** @type {any} */ (window).Theme?.strings?.slidePosition;
    if (!status || !template) return;
    status.textContent = template.replace('[index]', String(this.#index + 1)).replace('[count]', String(this.#slides.length));
  }
}

defineElement('hero-slideshow', HeroSlideshow);
