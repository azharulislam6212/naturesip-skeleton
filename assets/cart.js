/**
 * @layer L3
 * Cart handling for the cart page and the cart drawer alike.
 *
 *   <cart-items>          line items: quantity changes and removals
 *   <cart-note>           the order note, saved as it changes
 *   <cart-gift-wrap>      adds or removes the gift wrap product
 *   <shipping-estimator>  shipping rates for an address
 *
 * Every cart change asks the Cart API to re-render all cart sections, then
 * applies them in one go, so the drawer, the cart page and the header count
 * always stay in sync. (<cart-drawer> in cart-drawer.js only opens and closes.)
 */
import { Component, defineElement } from '@theme/component';
import { CartErrorEvent, CartUpdateEvent } from '@theme/events';
import { applySections, cartSectionIds } from '@theme/section-renderer';
import { announce, debounce, jsonRequest, t } from '@theme/utilities';

class CartItems extends Component {
  mount() {
    const updateQuantity = debounce((/** @type {HTMLInputElement} */ input) => {
      this.#change(Number(input.dataset.line), Number(input.value));
    }, 350);

    this.listen(this, 'change', (event) => {
      const target = /** @type {HTMLInputElement} */ (event.target);
      if (target.matches('[data-line-quantity]')) updateQuantity(target);
    });

    this.listen(this, 'click', (event) => {
      const remove = /** @type {Element} */ (event.target).closest('[data-line-remove]');
      if (!remove) return;
      event.preventDefault();
      this.#change(Number(remove.getAttribute('data-line-remove')), 0);
    });
  }

  /**
   * @param {number} line 1-based line index
   * @param {number} quantity
   */
  async #change(line, quantity) {
    this.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch(`${window.Theme.routes.cartChange}.js`, jsonRequest({
        line,
        quantity,
        sections: cartSectionIds(),
        sections_url: window.location.pathname,
      }));
      const cart = await response.json();

      if (!response.ok || cart.status) {
        const message = cart.description || cart.message || t('cartError');
        this.#showError(message);
        this.dispatchEvent(new CartErrorEvent({ message, source: 'cart-items' }));
        return;
      }

      applySections(cart.sections);
      announce(quantity === 0 ? t('itemRemoved') : t('cartUpdated'));
      this.dispatchEvent(new CartUpdateEvent({ cart, source: 'cart-items', itemCount: cart.item_count }));
    } catch {
      this.#showError(t('cartError'));
    } finally {
      this.removeAttribute('aria-busy');
    }
  }

  /** @param {string} message */
  #showError(message) {
    const error = this.querySelector('[data-cart-error]');
    if (!error) return;
    error.textContent = message;
    error.removeAttribute('hidden');
  }
}

/**
 * Sends a cart request that re-renders every cart section, and applies them.
 * @param {string} route Cart API route, without .js
 * @param {object} body
 * @param {string} source CartUpdateEvent source
 * @param {Element} from Element dispatching the events
 */
async function updateCart(route, body, source, from) {
  const response = await fetch(`${route}.js`, jsonRequest({
    ...body,
    sections: cartSectionIds(),
    sections_url: window.location.pathname,
  }));
  const cart = await response.json();
  if (!response.ok || cart.status) {
    const message = cart.description || cart.message || t('cartError');
    from.dispatchEvent(new CartErrorEvent({ message, source }));
    announce(message);
    return;
  }
  applySections(cart.sections);
  // /cart/add.js answers with the added items, not the cart.
  const itemCount = cart.item_count ?? undefined;
  from.dispatchEvent(new CartUpdateEvent({ cart, source, itemCount }));
  announce(t('cartUpdated'));
}

class CartNote extends Component {
  mount() {
    const save = debounce((/** @type {string} */ note) => this.#save(note), 500);
    this.listen(this, 'input', (event) => save(/** @type {HTMLTextAreaElement} */ (event.target).value));
  }

  /** @param {string} note */
  async #save(note) {
    await fetch(`${window.Theme.routes.cartUpdate}.js`, jsonRequest({ note }));
    announce(t('noteSaved'));
  }
}

class CartGiftWrap extends Component {
  mount() {
    const { input } = this.refs;
    if (!input) return;
    this.listen(input, 'change', () => this.#toggle(/** @type {HTMLInputElement} */ (input).checked));
  }

  /** @param {boolean} add */
  async #toggle(add) {
    const { variantId, lineKey } = this.dataset;
    this.setAttribute('aria-busy', 'true');
    try {
      if (add) {
        await updateCart(window.Theme.routes.cartAdd, { items: [{ id: Number(variantId), quantity: 1 }] }, 'gift-wrap', this);
      } else if (lineKey) {
        await updateCart(window.Theme.routes.cartChange, { id: lineKey, quantity: 0 }, 'gift-wrap', this);
      }
    } catch {
      announce(t('cartError'));
    } finally {
      this.removeAttribute('aria-busy');
    }
  }
}

/** How long to wait between asks while Shopify works the rates out. */
const RATES_POLL_DELAY = 500;
const RATES_POLL_TRIES = 20;

class ShippingEstimator extends Component {
  mount() {
    const { form } = this.refs;
    if (!form) return;
    this.listen(form, 'submit', (event) => {
      event.preventDefault();
      this.#estimate(new FormData(/** @type {HTMLFormElement} */ (form)));
    });
  }

  /** @param {FormData} data */
  async #estimate(data) {
    const params = new URLSearchParams();
    for (const key of ['country', 'province', 'zip']) {
      params.set(`shipping_address[${key}]`, String(data.get(key) ?? ''));
    }

    this.setAttribute('aria-busy', 'true');
    const cartUrl = window.Theme.routes.cart;
    try {
      const prepare = await fetch(`${cartUrl}/prepare_shipping_rates.json?${params}`, { method: 'POST' });
      if (!prepare.ok) {
        this.#showErrors(await prepare.json());
        return;
      }
      for (let attempt = 0; attempt < RATES_POLL_TRIES; attempt += 1) {
        const response = await fetch(`${cartUrl}/async_shipping_rates.json?${params}`);
        const result = await response.json();
        if (!response.ok) {
          this.#showErrors(result);
          return;
        }
        if (result?.shipping_rates) {
          this.#showRates(result.shipping_rates);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, RATES_POLL_DELAY));
      }
      this.#showErrors({});
    } catch {
      this.#showErrors({});
    } finally {
      this.removeAttribute('aria-busy');
    }
  }

  /** @param {{ name: string, price: string, currency: string }[]} rates */
  #showRates(rates) {
    const { results } = this.refs;
    if (!rates.length) {
      results.replaceChildren(Object.assign(document.createElement('p'), { textContent: t('shippingRatesNone') }));
      return;
    }
    const heading = document.createElement('p');
    heading.textContent = rates.length === 1 ? t('shippingRatesOne') : t('shippingRatesOther', { count: rates.length });
    const list = document.createElement('ul');
    list.className = 'cart-estimator__rates';
    for (const rate of rates) {
      const item = document.createElement('li');
      const price = new Intl.NumberFormat(document.documentElement.lang || undefined, {
        style: 'currency',
        currency: rate.currency,
      }).format(Number(rate.price));
      item.append(Object.assign(document.createElement('span'), { textContent: rate.name }));
      item.append(Object.assign(document.createElement('strong'), { textContent: price }));
      list.append(item);
    }
    results.replaceChildren(heading, list);
  }

  /** @param {Record<string, string[] | string>} errors Shopify's errors, per field */
  #showErrors(errors) {
    const messages = Object.entries(errors).flatMap(([field, value]) =>
      (Array.isArray(value) ? value : [value]).map((message) => `${field} ${message}`)
    );
    const error = document.createElement('p');
    error.className = 'cart-estimator__error';
    error.textContent = messages.length ? messages.join('. ') : t('cartError');
    this.refs.results.replaceChildren(error);
  }
}

defineElement('cart-items', CartItems);
defineElement('cart-note', CartNote);
defineElement('cart-gift-wrap', CartGiftWrap);
defineElement('shipping-estimator', ShippingEstimator);
