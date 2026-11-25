/**
 * @layer L0
 * Typed events: the only way features (L3) talk to each other.
 * Every event bubbles from `document`, so listeners can live anywhere:
 *
 *   document.addEventListener(CartUpdateEvent.eventName, (event) => event.detail.cart);
 */

/** @template T @extends {CustomEvent<T>} */
export class ThemeEvent extends CustomEvent {
  /**
   * @param {string} type
   * @param {T} detail
   */
  constructor(type, detail) {
    super(type, { bubbles: true, composed: true, detail });
  }
}

/** Cart contents changed. `source` says who changed it ('product-form', 'cart-items', …). */
export class CartUpdateEvent extends ThemeEvent {
  static eventName = 'cart:update';
  /** @param { { cart: any, source: string, itemCount: number } } detail */
  constructor(detail) {
    super(CartUpdateEvent.eventName, detail);
  }
}

/** A cart request failed. */
export class CartErrorEvent extends ThemeEvent {
  static eventName = 'cart:error';
  /** @param { { message: string, source: string } } detail */
  constructor(detail) {
    super(CartErrorEvent.eventName, detail);
  }
}

/** The selected variant of a product section changed. */
export class VariantChangeEvent extends ThemeEvent {
  static eventName = 'variant:change';
  /** @param { { variant: any | null, sectionId: string, productUrl: string } } detail */
  constructor(detail) {
    super(VariantChangeEvent.eventName, detail);
  }
}

/** Collection or search filters were applied. */
export class FilterUpdateEvent extends ThemeEvent {
  static eventName = 'filter:update';
  /** @param { { url: string, sectionId: string } } detail */
  constructor(detail) {
    super(FilterUpdateEvent.eventName, detail);
  }
}

/** A modal dialog or drawer opened or closed (smooth scroll pauses meanwhile). */
export class DialogToggleEvent extends ThemeEvent {
  static eventName = 'dialog:toggle';
  /** @param { { open: boolean, id: string } } detail */
  constructor(detail) {
    super(DialogToggleEvent.eventName, detail);
  }
}

/** New server-rendered markup was inserted; enhancements should scan `root`. */
export class ContentUpdateEvent extends ThemeEvent {
  static eventName = 'content:update';
  /** @param { { root: Element } } detail */
  constructor(detail) {
    super(ContentUpdateEvent.eventName, detail);
  }
}
