/**
 * @layer L3
 * <cart-drawer>: the slide-out cart. Its markup is re-rendered by whoever
 * changes the cart (applySections); this element only opens and closes.
 */
import { defineElement } from '@theme/component';
import { DialogComponent } from '@theme/dialog';
import { CartUpdateEvent } from '@theme/events';

class CartDrawer extends DialogComponent {
  mount() {
    super.mount();
    this.listen(document, CartUpdateEvent.eventName, (event) => {
      if (event.detail.source === 'product-form' || event.detail.source === 'quick-add') this.open();
    });
  }

  afterOpen() {
    this.dialog.querySelector('[ref="close"]')?.focus();
  }
}

defineElement('cart-drawer', CartDrawer);
