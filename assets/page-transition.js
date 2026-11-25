/**
 * @layer L3
 * <page-transition>: fades the page in on load.
 *
 * snippets/page-transition.liquid marks <html data-page-entering> before the
 * first frame, which keeps <body> hidden:
 *   - browsers without cross-document View Transitions: on every load;
 *   - browsers with them: on loads that are not a link navigation (first
 *     visit, reload, theme editor refresh). Link navigations use the native
 *     transition instead, so the two never run together.
 * This element plays the fade and clears the mark. Without the mark it does nothing.
 */
import { Component, defineElement } from '@theme/component';
import { prefersReducedMotion } from '@theme/utilities';

const ENTERING = 'data-page-entering';
const REVEALED = 'data-page-revealed';

class PageTransition extends Component {
  mount() {
    const root = document.documentElement;
    if (root.hasAttribute(ENTERING)) {
      this.#fadeIn();
      return;
    }

    // The module can run before `pagereveal` has fired; wait for it.
    // The snippet's listener was registered first, so it has already run
    // (and possibly set the mark) by the time this one does.
    if ('onpagereveal' in window && !root.hasAttribute(REVEALED)) {
      this.listen(window, 'pagereveal', () => {
        if (root.hasAttribute(ENTERING)) this.#fadeIn();
      }, { once: true });
    }
  }

  #fadeIn() {
    const root = document.documentElement;
    if (!prefersReducedMotion()) {
      const styles = getComputedStyle(root);
      const duration = parseFloat(styles.getPropertyValue('--duration-slow')) || 600;
      const easing = styles.getPropertyValue('--ease-out').trim() || 'ease-out';
      // Start before clearing the mark so the body never flashes at full opacity.
      document.body.animate([{ opacity: 0 }, { opacity: 1 }], { duration, easing, fill: 'backwards' });
    }
    root.removeAttribute(ENTERING);
  }
}

defineElement('page-transition', PageTransition);
