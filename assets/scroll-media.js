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
 *
 * Also defines <image-sequence> (below), the scroll-scrubbed frame sequence.
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

/**
 * <image-sequence>: scroll-scrubbed image sequence, as on hydroflowdrink.com.
 * Pre-rendered frames (e.g. cans turning on a diagonal) are drawn on a canvas,
 * one per scroll position, from the moment the element enters the viewport
 * until it leaves. Or, with data-source="video", a muted video's current
 * time follows the scroll instead.
 *
 * Frames: data-url holds the frame URL with {n} where the number goes,
 * data-count the number of frames, data-start the first number (0 or 1) and
 * data-digits the zero padding (3 → 001). The first frame loads at once, the
 * rest once the element is near the viewport; until a frame is ready the
 * nearest loaded one is drawn. The poster image underneath stays visible
 * (and keeps the alt text) until the first frame is drawn.
 *
 * Under prefers-reduced-motion only the first frame shows.
 */
class ImageSequence extends Component {
  /** @type {HTMLImageElement[]} */
  #frames = [];
  /** @type {CanvasRenderingContext2D | null} */
  #context = null;
  /** @type {HTMLVideoElement | null} */
  #video = null;
  /** @type {IntersectionObserver | null} */
  #observer = null;
  #frame = 0;
  #current = -1;
  #visible = false;
  #loadedAll = false;

  mount() {
    this.#video = this.querySelector('video');
    if (this.dataset.source === 'video' && this.#video) {
      this.#mountVideo(this.#video);
    } else if (this.dataset.url && Number(this.dataset.count) > 1) {
      this.#mountFrames();
    } else {
      return;
    }

    if (prefersReducedMotion()) return;

    const schedule = () => {
      if (!this.#visible || this.#frame) return;
      this.#frame = requestAnimationFrame(() => {
        this.#frame = 0;
        this.#render(this.#progress());
      });
    };

    this.#observer = new IntersectionObserver(([entry]) => {
      this.#visible = Boolean(entry?.isIntersecting);
      if (this.#visible) {
        this.#loadAll();
        schedule();
      }
    }, { rootMargin: '50% 0px' });
    this.#observer.observe(this);

    this.listen(window, 'scroll', schedule, { passive: true });
    this.listen(window, 'resize', () => {
      this.#current = -1;
      schedule();
    }, { passive: true });
  }

  unmount() {
    this.#observer?.disconnect();
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
  }

  /** 0 as the element enters at the bottom of the viewport, 1 as it leaves at the top. */
  #progress() {
    const box = this.getBoundingClientRect();
    const viewport = window.innerHeight || 1;
    return Math.min(1, Math.max(0, (viewport - box.top) / (viewport + box.height)));
  }

  /** @param {number} progress */
  #render(progress) {
    if (this.#video) {
      const duration = this.#video.duration;
      if (Number.isFinite(duration) && duration > 0) this.#video.currentTime = progress * (duration - 0.05);
      return;
    }
    const index = Math.round(progress * (this.#frames.length - 1));
    this.#draw(index);
  }

  #mountFrames() {
    const canvas = /** @type {HTMLCanvasElement | null} */ (this.querySelector('canvas'));
    this.#context = canvas?.getContext('2d') ?? null;
    if (!this.#context) return;

    const pattern = this.dataset.url ?? '';
    const count = Math.min(Number(this.dataset.count), 600);
    const start = Number(this.dataset.start ?? 1);
    const digits = Number(this.dataset.digits ?? 0);
    for (let i = 0; i < count; i++) {
      const image = new Image();
      image.decoding = 'async';
      image.dataset.src = pattern.replaceAll('{n}', String(start + i).padStart(digits, '0'));
      this.#frames.push(image);
    }

    // The first frame at once: it replaces the poster.
    const first = this.#frames[0];
    first.addEventListener('load', () => {
      if (this.#current < 0) this.#draw(prefersReducedMotion() ? 0 : Math.round(this.#progress() * (count - 1)));
    }, { once: true });
    first.src = first.dataset.src ?? '';
  }

  /** Loads the remaining frames a few at a time, in order. */
  #loadAll() {
    if (this.#loadedAll || !this.#frames.length) return;
    this.#loadedAll = true;
    let next = 1;
    const loadNext = () => {
      const image = this.#frames[next++];
      if (!image) return;
      image.addEventListener('load', () => {
        if (Math.abs(this.#frames.indexOf(image) - this.#target()) <= 1) this.#current = -1;
        loadNext();
      }, { once: true });
      image.addEventListener('error', loadNext, { once: true });
      image.src = image.dataset.src ?? '';
    };
    for (let i = 0; i < 6; i++) loadNext();
  }

  #target() {
    return Math.round(this.#progress() * (this.#frames.length - 1));
  }

  /** @param {number} index */
  #draw(index) {
    const context = this.#context;
    if (!context) return;
    // The nearest frame that has loaded.
    let image = null;
    for (let offset = 0; offset < this.#frames.length && !image; offset++) {
      for (const candidate of [this.#frames[index - offset], this.#frames[index + offset]]) {
        if (candidate?.complete && candidate.naturalWidth) {
          image = candidate;
          break;
        }
      }
    }
    if (!image) return;
    const drawn = this.#frames.indexOf(image);
    if (drawn === this.#current) return;
    this.#current = drawn;

    const canvas = context.canvas;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(canvas.clientWidth * ratio);
    const height = Math.round(canvas.clientHeight * ratio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    // object-fit: cover
    const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const w = image.naturalWidth * scale;
    const h = image.naturalHeight * scale;
    context.clearRect(0, 0, width, height);
    context.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
    this.setAttribute('data-ready', '');
  }

  /** @param {HTMLVideoElement} video */
  #mountVideo(video) {
    video.muted = true;
    video.pause();
    video.removeAttribute('autoplay');
    const ready = () => {
      this.setAttribute('data-ready', '');
      this.#render(prefersReducedMotion() ? 0 : this.#progress());
    };
    if (video.readyState >= 1) ready();
    else video.addEventListener('loadedmetadata', ready, { once: true });
  }
}

defineElement('image-sequence', ImageSequence);
