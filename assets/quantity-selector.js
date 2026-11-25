/**
 * @layer L3
 * <quantity-selector>: minus/plus buttons around a number input that respect
 * min, max and step, then fire a native `change` event.
 */
import { Component, defineElement } from '@theme/component';

class QuantitySelector extends Component {
  mount() {
    const { input, minus, plus } = this.refs;
    if (!input) return;
    if (minus) this.listen(minus, 'click', () => this.#step(-1));
    if (plus) this.listen(plus, 'click', () => this.#step(1));
    this.listen(input, 'change', () => this.#syncButtons());
    this.#syncButtons();
  }

  /** @param {number} direction */
  #step(direction) {
    const input = /** @type {HTMLInputElement} */ (this.refs.input);
    const before = input.value;
    if (direction > 0) input.stepUp();
    else input.stepDown();
    if (input.value !== before) input.dispatchEvent(new Event('change', { bubbles: true }));
    this.#syncButtons();
  }

  #syncButtons() {
    const { input, minus, plus } = this.refs;
    const value = Number(input.value);
    const min = Number(input.min || 0);
    const max = input.max ? Number(input.max) : Infinity;
    if (minus) minus.disabled = value <= min;
    if (plus) plus.disabled = value >= max;
  }
}

defineElement('quantity-selector', QuantitySelector);
