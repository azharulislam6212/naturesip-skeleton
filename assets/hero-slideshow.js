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
 * 3D models are <model-viewer> elements (Google's build, loaded with the
 * page by snippets/hero-can.liquid). Their camera is fitted to the model's
 * bounding sphere so no turn ever clips it.
 */
import { Component, defineElement } from '@theme/component';
import { isDesignMode, prefersReducedMotion } from '@theme/utilities';

/** How long the outgoing slide stays shown: its gradient sits under the
 * incoming one while that fades in (1s in the CSS). */
const LEAVE = 1000;
/** The can's extra turn on a slide change (hydroflow's "Rotate": y + 2π in 1s). */
const SPIN = 1000;
/** Half the camera's vertical field of view (field-of-view="35deg", as hydroflow). */
const HALF_FOV = (17.5 * Math.PI) / 180;
/** Drag: radians of turn per pixel, the fastest a flung can turns (radians
 * per frame) and how fast it slows (per frame). */
const DRAG_SPEED = 0.006;
const DRAG_MAX_SPIN = 0.05;
const DRAG_FRICTION = 0.86;
/** Hydroflow's camera sits at [2, 0, 10] looking at the can: 11.31° to its right. */
const CAMERA_THETA = (Math.atan2(2, 10) * 180) / Math.PI;

/** Google's model-viewer; snippets/hero-can.liquid loads it with the page. */
const MODEL_VIEWER = 'https://ajax.googleapis.com/ajax/libs/model-viewer/3.5.0/model-viewer.min.js';

/**
 * Resolves once <model-viewer> is defined. The snippet already loads the
 * script with the page; a slide added in the theme editor may not have.
 */
function loadModelViewer() {
  if (!customElements.get('model-viewer') && !document.querySelector(`script[src="${MODEL_VIEWER}"]`)) {
    const script = document.createElement('script');
    script.type = 'module';
    script.src = MODEL_VIEWER;
    document.head.append(script);
  }
  return customElements.whenDefined('model-viewer').then((ModelViewer) => {
    // model-viewer lowers its resolution (to half) when frames run long; the
    // can is redrawn every frame while it floats, so keep it sharp.
    /** @type {any} */ (ModelViewer).minimumRenderScale = 1;
  });
}

/* ---------- Rotation: three.js on hydroflow, model-viewer here ----------
   Matrices are row-major arrays of 9. */

/** @param {number} t */
const rotX = (t) => [1, 0, 0, 0, Math.cos(t), -Math.sin(t), 0, Math.sin(t), Math.cos(t)];
/** @param {number} t */
const rotY = (t) => [Math.cos(t), 0, Math.sin(t), 0, 1, 0, -Math.sin(t), 0, Math.cos(t)];
/** @param {number} t */
const rotZ = (t) => [Math.cos(t), -Math.sin(t), 0, Math.sin(t), Math.cos(t), 0, 0, 0, 1];

/**
 * @param {number[]} a
 * @param {number[]} b
 */
function multiply(a, b) {
  const out = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      out.push(a[row * 3] * b[col] + a[row * 3 + 1] * b[3 + col] + a[row * 3 + 2] * b[6 + col]);
    }
  }
  return out;
}

/** A three.js Euler rotation in its default XYZ order. @param {number} x @param {number} y @param {number} z */
const eulerXYZ = (x, y, z) => multiply(multiply(rotX(x), rotY(y)), rotZ(z));

/**
 * The same rotation as model-viewer's `orientation` ("roll pitch yaw", an
 * Euler in YXZ order), decomposed as three.js does.
 * @param {number[]} m
 */
function toOrientation(m) {
  const pitch = Math.asin(-Math.min(1, Math.max(-1, m[5])));
  const upright = Math.abs(m[5]) < 0.9999999;
  const yaw = upright ? Math.atan2(m[2], m[8]) : Math.atan2(-m[6], m[0]);
  const roll = upright ? Math.atan2(m[3], m[4]) : 0;
  return `${roll.toFixed(5)}rad ${pitch.toFixed(5)}rad ${yaw.toFixed(5)}rad`;
}

/**
 * @param {number[]} m
 * @param {{ x: number, y: number, z: number }} v
 * @param {boolean} [inverse] apply the transpose (the inverse of a rotation)
 */
function apply(m, { x, y, z }, inverse = false) {
  const t = inverse ? [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]] : m;
  return { x: t[0] * x + t[1] * y + t[2] * z, y: t[3] * x + t[4] * y + t[5] * z, z: t[6] * x + t[7] * y + t[8] * z };
}

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/**
 * Per model: its centre in its own space and the rotation last applied.
 * model-viewer turns a model about its origin (often its base), so the
 * camera follows the centre and the model turns in place, like the
 * centred can on hydroflow.
 * @type {WeakMap<Element, { centre?: { x: number, y: number, z: number }, distance?: number, matrix: number[] }>}
 */
const models = new WeakMap();

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
  /** The visitor's own turn of the can (drag), on top of everything else. */
  #drag = { matrix: IDENTITY, vx: 0, vy: 0, active: false };
  /** When the float started: it bobs from rest, not from mid-swing. */
  #floatStart = performance.now();
  /** The can's size at this point of the scroll (end_scale). */
  #scale = 1;
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
    this.#bindDrag();

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
    if (count > 1) this.go((this.#index + direction + count) % count, byUser);
  }

  /**
   * @param {number} index
   * @param {boolean} [announce] tell screen readers (not on autoplay, which would talk over the page)
   */
  go(index, announce = false) {
    const from = this.#index;
    if (index === from || !this.#slides[index]) return;
    this.#index = index;

    clearTimeout(this.#leaveTimer);
    for (const slide of this.#slides) slide.removeAttribute('data-leaving');

    const old = this.#slides[from];
    old.removeAttribute('data-active');
    old.setAttribute('data-leaving', '');
    // Hidden from screen readers and the keyboard while it plays its exit.
    old.inert = true;
    this.#leaveTimer = window.setTimeout(() => old.removeAttribute('data-leaving'), LEAVE);

    // From now on slides cross-fade, and the new one waits for the old
    // one's letters to clear.
    this.setAttribute('data-changed', '');
    this.style.setProperty('--enter-delay', '0.35s');
    const current = this.#slides[index];
    current.setAttribute('data-active', '');
    current.inert = false;

    if (!this.#reduced) {
      this.#spinStart = performance.now();
      this.#queue();
    }
    if (announce) this.#announce();
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
    this.style.setProperty('--stage-y', `${Math.round(offset)}px`);
    this.setAttribute('data-staged', '');
    this.toggleAttribute('data-can-away', away);
    // The can takes drags only over the hero; further down it lets clicks
    // through to the sections it travels over.
    this.toggleAttribute('data-can-drag', !away && scroll < start + height * 0.6);

    this.style.setProperty('--hero-scroll', clamp((scroll - start) / height).toFixed(4));

    // Spin of a slide change, on top of the scroll turn.
    let spinning = false;
    if (this.#spinStart) {
      const t = clamp((performance.now() - this.#spinStart) / SPIN);
      this.#spin = power1Out(t) * 2 * Math.PI;
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
      this.#scale = 1 + (endScale - 1) * travel;
      this.style.setProperty('--can-x', `${Math.round((endX / 100) * travel * window.innerWidth)}px`);
      this.style.setProperty('--can-scale', this.#scale.toFixed(4));
      this.#turn(turn);
    }

    // 3D cans float all the time (as drei's <Float>), so keep drawing while in view.
    // A flung can keeps turning and slows down.
    const drag = this.#drag;
    if (!drag.active && (Math.abs(drag.vx) > 1e-4 || Math.abs(drag.vy) > 1e-4)) {
      this.#turnBy(drag.vx, drag.vy);
      drag.vx *= DRAG_FRICTION;
      drag.vy *= DRAG_FRICTION;
    }

    const floating = !away && !this.#reduced && this.querySelector('model-viewer');
    if (spinning || floating) this.#queue();
  }

  /**
   * Turns the shown cans (the current slide's and the outgoing one's)
   * exactly as hydroflowdrink.com does:
   *   - the scroll turns the can x 0 → 2π (a vertical flip, top coming
   *     forward) and y +2π, scrubbed with power1.out (`progress`), unless
   *     its slide's "Rotate on scroll" is off;
   *   - a slide change adds y +2π over a second (power1.out);
   *   - drei's <Float speed={2} rotationIntensity={0.5} floatIntensity={2}
   *     floatingRange={[-0.05, 0.05]}> tilts and bobs it around that;
   *   - the visitor can turn it further by dragging (#bindDrag).
   * Both rotations are three.js XYZ Eulers, combined and handed to
   * model-viewer as its YXZ `orientation`; the camera follows the model's
   * centre so it turns in place.
   * @param {number} progress 0–1
   */
  #turn(progress) {
    const time = (performance.now() - this.#floatStart) / 1000;
    const wave = (time / 4) * 2;
    const float = eulerXYZ((Math.cos(wave) / 8) * 0.5, (Math.sin(wave) / 8) * 0.5, (Math.sin(wave) / 20) * 0.5);
    /** The whole turn, with or without the scroll's part. @param {number} amount */
    const turned = (amount) => {
      const spin = amount * 2 * Math.PI;
      return multiply(float, multiply(this.#drag.matrix, eulerXYZ(spin, spin + this.#spin, 0)));
    };
    const scrolled = turned(progress);
    const still = turned(0);

    // Bob: ±0.1 units of hydroflow's 6.43-unit-high view, in whole pixels so
    // the canvas never sits between pixels (and blurs).
    this.style.setProperty('--float-y', `${Math.round(-Math.sin(wave) * 0.01555 * window.innerHeight)}px`);
    this.style.setProperty('--can-turn', `${((progress * 360) % 360).toFixed(2)}deg`);

    const viewers = this.querySelectorAll(':is(.hero-slide[data-active], .hero-slide[data-leaving]) model-viewer');
    for (const viewer of /** @type {NodeListOf<any>} */ (viewers)) {
      // Each slide chooses whether its can turns with the scroll.
      const matrix = viewer.closest('.hero-slide')?.dataset.scrollTurn === 'false' ? still : scrolled;
      const state = models.get(viewer) ?? { matrix: IDENTITY };
      state.matrix = matrix;
      models.set(viewer, state);
      viewer.orientation = toOrientation(matrix);
      if (!state.centre || !state.distance) continue;
      const { x, y, z } = apply(matrix, state.centre);
      viewer.cameraTarget = `${x}m ${y}m ${z}m`;
      // Sized by the camera, not CSS (a scaled canvas blurs).
      viewer.cameraOrbit = `${CAMERA_THETA.toFixed(2)}deg 90deg ${state.distance / this.#scale}m`;
      viewer.jumpCameraToGoal?.();
    }
  }

  /* ---------- 3D ---------- */

  #loadModels() {
    for (const viewer of /** @type {NodeListOf<any>} */ (this.querySelectorAll('model-viewer'))) {
      const model = viewer.closest('.hero-slideshow__model');
      // The loading bar's real progress (#fitCamera ends it).
      viewer.addEventListener(
        'progress',
        (/** @type {CustomEvent} */ event) => model?.style.setProperty('--progress', String(event.detail?.totalProgress ?? 0)),
        { signal: this.signal }
      );
    }

    loadModelViewer().then(() => {
      for (const viewer of /** @type {NodeListOf<any>} */ (this.querySelectorAll('model-viewer'))) {
        if (viewer.loaded) {
          this.#fitCamera(viewer);
        } else {
          viewer.addEventListener('load', () => this.#fitCamera(viewer), { once: true, signal: this.signal });
        }
      }
    });
  }

  /**
   * Camera far enough to hold the model's bounding sphere, so any
   * orientation stays whole and the same size; #turn aims it at the centre.
   * @param {any} viewer
   */
  #fitCamera(viewer) {
    const size = viewer.getDimensions?.();
    const center = viewer.getBoundingBoxCenter?.();
    if (!size || !center) return;
    // Measured as the model stands now; keep it in the model's own space.
    const state = models.get(viewer) ?? { matrix: IDENTITY };
    state.centre = apply(state.matrix, center, true);
    models.set(viewer, state);
    state.distance = Math.hypot(size.x, size.y, size.z) / 2 / Math.sin(HALF_FOV);

    // Frame it as #turn will, then reveal it (reveal="manual"): it fades in
    // already in place instead of showing first at model-viewer's own framing.
    const { x, y, z } = apply(state.matrix, state.centre);
    viewer.orientation = toOrientation(state.matrix);
    viewer.cameraTarget = `${x}m ${y}m ${z}m`;
    viewer.cameraOrbit = `${CAMERA_THETA.toFixed(2)}deg 90deg ${state.distance / this.#scale}m`;
    viewer.jumpCameraToGoal?.();
    requestAnimationFrame(() => {
      viewer.dismissPoster?.();
      viewer.closest('.hero-slideshow__model')?.setAttribute('data-loaded', '');
    });
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
        slide.inert = i !== this.#index;
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
    let onCan = false;
    this.listen(this, 'pointerdown', (event) => {
      if (event.pointerType === 'mouse') return;
      onCan = Boolean(/** @type {Element} */ (event.target).closest('.hero-slideshow__can'));
      startX = event.clientX;
      startY = event.clientY;
    });
    this.listen(this, 'pointerup', (event) => {
      // A drag on the can turns it; it doesn't change the slide.
      if (event.pointerType === 'mouse' || onCan) return;
      const dx = event.clientX - startX;
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(event.clientY - startY)) this.step(dx < 0 ? 1 : -1, true);
    });
  }

  /**
   * Drag the 3D can to turn it: it follows the pointer on the screen's own
   * axes (sideways spins it, up and down tips it; on touch only sideways,
   * so up and down still scroll the page), however far it has turned.
   * Let go mid-drag and it spins on briefly, slowing down; held still first,
   * it stays put.
   */
  #bindDrag() {
    if (!this.querySelector('model-viewer')) return;
    const drag = this.#drag;
    let lastX = 0;
    let lastY = 0;
    let lastMove = 0;

    this.listen(this, 'pointerdown', (event) => {
      const can = /** @type {Element} */ (event.target).closest('.hero-slideshow__can');
      if (!can?.querySelector('model-viewer') || event.button > 0) return;
      if (event.pointerType === 'mouse') event.preventDefault();
      can.setPointerCapture(event.pointerId);
      drag.active = true;
      drag.vx = 0;
      drag.vy = 0;
      lastX = event.clientX;
      lastY = event.clientY;
      lastMove = performance.now();
      this.setAttribute('data-dragging', '');
    });

    this.listen(this, 'pointermove', (event) => {
      if (!drag.active) return;
      const x = (event.clientX - lastX) * DRAG_SPEED;
      const y = event.pointerType === 'mouse' ? (event.clientY - lastY) * DRAG_SPEED : 0;
      lastX = event.clientX;
      lastY = event.clientY;
      lastMove = performance.now();
      this.#turnBy(x, y);
      // Smoothed, so one jerk of the mouse doesn't fling it away.
      drag.vx = drag.vx * 0.6 + x * 0.4;
      drag.vy = drag.vy * 0.6 + y * 0.4;
      this.#queue();
    });

    const release = () => {
      if (!drag.active) return;
      drag.active = false;
      // Held still before letting go: no fling.
      if (performance.now() - lastMove > 60) drag.vx = drag.vy = 0;
      const cap = (/** @type {number} */ v) => Math.max(-DRAG_MAX_SPIN, Math.min(DRAG_MAX_SPIN, v));
      drag.vx = cap(drag.vx);
      drag.vy = cap(drag.vy);
      this.removeAttribute('data-dragging');
      this.#queue();
    };
    this.listen(this, 'pointerup', release);
    this.listen(this, 'pointercancel', release);
    this.listen(this, 'lostpointercapture', release);
  }

  /**
   * Turns the dragged can by x (about the screen's vertical) and y (about
   * its horizontal), on top of where it already is.
   * @param {number} x radians
   * @param {number} y radians
   */
  #turnBy(x, y) {
    this.#drag.matrix = multiply(multiply(rotY(x), rotX(y)), this.#drag.matrix);
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
