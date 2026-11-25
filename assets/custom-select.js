/**
 * @layer L2
 * <custom-select>: an animated listbox (ul/li) that stands in for a native
 * <select>. Markup comes from snippets/custom-select.liquid.
 *
 * The native select remains the source of truth: choosing an option sets its
 * value and dispatches `input` + `change` from it, so forms submit it and
 * existing listeners (variant picker, facets, localization, address form)
 * work unchanged. Options are read from the select each time the panel
 * opens, so options replaced later (morph, provinces) are always current.
 *
 * Searchable variant (`searchable: true`): a text field above the list
 * filters the options as you type; focus stays in the field and the arrow
 * keys move through the matches.
 *
 * Keyboard: Enter / Space / Arrow keys open; Arrow keys, Home, End and
 * type-ahead move; Enter (and Space without search) chooses; Escape closes;
 * Tab closes and moves on.
 */
import { Component, defineElement } from '@theme/component';

const LIST_MAX_HEIGHT = 288;

export class CustomSelect extends Component {
  #active = -1;
  #typed = '';
  /** @type {number | undefined} */
  #typedTimer;
  /** @type {MutationObserver | null} */
  #observer = null;

  /** @returns {HTMLSelectElement | null} */
  get select() {
    return this.querySelector(':scope > select');
  }

  get isOpen() {
    return this.hasAttribute('data-open');
  }

  /** @returns {HTMLElement[]} */
  get #items() {
    return [...this.refs.list.children];
  }

  /** Element that holds focus while open: the search field, or the list. */
  get #focusTarget() {
    return /** @type {HTMLElement} */ (this.refs.search ?? this.refs.list);
  }

  mount() {
    const { button, panel, list, search } = this.refs;
    const select = this.select;
    if (!select || !button || !panel || !list) return;

    this.sync();

    this.listen(button, 'click', () => (this.isOpen ? this.close() : this.open()));
    this.listen(button, 'keydown', (event) => this.#onButtonKey(event));
    this.listen(panel, 'keydown', (event) => this.#onPanelKey(event));
    this.listen(list, 'click', (event) => {
      const item = /** @type {Element} */ (event.target).closest('[role="option"]');
      if (item instanceof HTMLElement && item.getAttribute('aria-disabled') !== 'true') this.#choose(Number(item.dataset.index));
    });
    this.listen(list, 'pointermove', (event) => {
      const item = /** @type {Element} */ (event.target).closest('[role="option"]');
      if (item instanceof HTMLElement) this.#setActive(Number(item.dataset.index), false);
    });

    if (search) {
      this.listen(search, 'input', (event) => {
        // The field is not a form value: keep its events away from form listeners (facets, localization).
        event.stopPropagation();
        this.#filter();
      });
      this.listen(search, 'change', (event) => event.stopPropagation());
    }

    this.listen(select, 'change', () => this.sync());
    this.listen(document, 'pointerdown', (event) => {
      if (this.isOpen && !this.contains(/** @type {Node} */ (event.target))) this.close(false);
    });
    this.listen(this, 'focusout', (event) => {
      if (this.isOpen && !this.contains(/** @type {Node | null} */ (event.relatedTarget))) this.close(false);
    });

    // The label points at the hidden native select; send its clicks to the button.
    const label = select.id ? document.querySelector(`label[for="${CSS.escape(select.id)}"]`) : null;
    if (label) {
      this.listen(label, 'click', (event) => {
        event.preventDefault();
        button.focus();
      });
    }

    // Options or selection changed from elsewhere (morph, address provinces).
    this.#observer = new MutationObserver(() => {
      this.sync();
      if (this.isOpen) {
        this.#render();
        this.#filter();
      }
    });
    this.#observer.observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['selected', 'disabled'] });
  }

  unmount() {
    this.#observer?.disconnect();
    window.clearTimeout(this.#typedTimer);
  }

  /** Shows the selected option's text on the button. */
  sync() {
    const option = this.select?.selectedOptions[0];
    if (this.refs.value) this.refs.value.textContent = option?.text.trim() ?? '';
  }

  open() {
    const { button, panel, search } = this.refs;
    const select = this.select;
    if (!select || this.isOpen) return;
    this.#render();
    if (search) {
      search.value = '';
      this.#filter(false);
    }

    // Open upwards when there is no room below but there is above.
    const rect = button.getBoundingClientRect();
    const needed = Math.min(panel.scrollHeight, LIST_MAX_HEIGHT + (search?.offsetHeight ?? 0)) + 8;
    const below = window.innerHeight - rect.bottom;
    this.toggleAttribute('data-upward', below < needed && rect.top > below);

    this.setAttribute('data-open', '');
    button.setAttribute('aria-expanded', 'true');
    this.#setActive(Math.max(0, select.selectedIndex));
    this.#focusTarget.focus({ preventScroll: true });
  }

  /** @param {boolean} [returnFocus] */
  close(returnFocus = true) {
    if (!this.isOpen) return;
    this.removeAttribute('data-open');
    this.refs.button.setAttribute('aria-expanded', 'false');
    this.#focusTarget.removeAttribute('aria-activedescendant');
    if (returnFocus) this.refs.button.focus();
  }

  #render() {
    const select = /** @type {HTMLSelectElement} */ (this.select);
    const base = select.id || 'CustomSelect';
    this.#active = -1;
    this.refs.list.replaceChildren(
      ...[...select.options].map((option, index) => {
        const item = document.createElement('li');
        item.className = 'custom-select__option';
        item.id = `${base}-Option-${index}`;
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', String(option.selected));
        if (option.disabled) item.setAttribute('aria-disabled', 'true');
        item.dataset.index = String(index);
        item.textContent = option.text.trim();
        return item;
      })
    );
  }

  /**
   * Hides options that don't match the search field.
   * @param {boolean} [moveActive] Move the highlight to the first match.
   */
  #filter(moveActive = true) {
    const { search, empty } = this.refs;
    if (!search) return;
    const query = search.value.trim().toLowerCase();
    let first = -1;
    for (const item of this.#items) {
      const match = !query || (item.textContent ?? '').toLowerCase().includes(query);
      item.hidden = !match;
      if (match && first < 0 && item.getAttribute('aria-disabled') !== 'true') first = Number(item.dataset.index);
    }
    if (empty) empty.hidden = first >= 0;
    if (!moveActive) return;
    if (first >= 0) {
      this.#setActive(first);
    } else {
      this.#items[this.#active]?.removeAttribute('data-active');
      this.#active = -1;
      search.removeAttribute('aria-activedescendant');
    }
  }

  /** @param {HTMLElement} item */
  #usable(item) {
    return !item.hidden && item.getAttribute('aria-disabled') !== 'true';
  }

  /**
   * @param {number} index
   * @param {boolean} [scroll]
   */
  #setActive(index, scroll = true) {
    const items = this.#items;
    const item = items[index];
    if (!item || item.hidden) return;
    items[this.#active]?.removeAttribute('data-active');
    item.setAttribute('data-active', '');
    this.#active = index;
    this.#focusTarget.setAttribute('aria-activedescendant', item.id);
    if (scroll) this.#scrollIntoList(item);
  }

  /** @param {HTMLElement} item */
  #scrollIntoList(item) {
    const list = this.refs.list;
    if (item.offsetTop < list.scrollTop) list.scrollTop = item.offsetTop;
    else if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight;
    }
  }

  /**
   * Next usable (visible, enabled) option from `from` in `step` direction.
   * @param {number} from
   * @param {number} step
   */
  #usableFrom(from, step) {
    const items = this.#items;
    for (let index = from; index >= 0 && index < items.length; index += step) {
      if (this.#usable(items[index])) return index;
    }
    return this.#active;
  }

  /** @param {number} index */
  #choose(index) {
    const select = this.select;
    if (!select || index < 0) return;
    if (select.selectedIndex !== index) {
      select.selectedIndex = index;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    this.close();
  }

  /** @param {KeyboardEvent} event */
  #onButtonKey(event) {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      this.open();
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      this.open();
      if (this.refs.search) return; // the key goes on to the focused search field
      this.#typeAhead(event.key);
    }
  }

  /** @param {KeyboardEvent} event */
  #onPanelKey(event) {
    const inSearch = event.target === this.refs.search;
    const last = this.#items.length - 1;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.#setActive(this.#usableFrom(this.#active + 1, 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.#setActive(this.#usableFrom(this.#active - 1, -1));
        break;
      case 'Home':
      case 'End':
        if (inSearch) return; // move the caret in the field
        event.preventDefault();
        this.#setActive(event.key === 'Home' ? this.#usableFrom(0, 1) : this.#usableFrom(last, -1));
        break;
      case 'Enter':
        event.preventDefault(); // never submit the surrounding form from the field
        if (this.#active >= 0 && this.#usable(this.#items[this.#active])) this.#choose(this.#active);
        break;
      case ' ':
        if (inSearch) return; // a space is part of the search text
        event.preventDefault();
        if (this.#active >= 0 && this.#usable(this.#items[this.#active])) this.#choose(this.#active);
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation(); // keep a surrounding drawer open
        this.close();
        break;
      case 'Tab':
        this.close(false);
        break;
      default:
        if (!inSearch && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) this.#typeAhead(event.key);
    }
  }

  /** @param {string} character */
  #typeAhead(character) {
    window.clearTimeout(this.#typedTimer);
    this.#typed += character.toLowerCase();
    this.#typedTimer = window.setTimeout(() => (this.#typed = ''), 500);
    const match = this.#items.findIndex(
      (item) => this.#usable(item) && (item.textContent ?? '').trim().toLowerCase().startsWith(this.#typed)
    );
    if (match >= 0) this.#setActive(match);
  }
}

defineElement('custom-select', CustomSelect);
