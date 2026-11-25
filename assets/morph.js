/**
 * @layer L2
 * Minimal DOM morphing: updates `from` in place so it matches `to`, keeping
 * element identity (and therefore focus, open <details>, scroll position and
 * custom-element state) wherever the structure allows.
 *
 * Matching rules for children: same tag and same `id` (when either has one),
 * otherwise same tag in the same position. Mismatches are replaced.
 * Opt-outs: `data-morph-skip` keeps an element untouched; the value of a focused
 * form field is never overwritten while the visitor is typing; the `open`
 * state of <dialog> and <details> always stays as the visitor left it.
 */

/**
 * @param {Element} from
 * @param {Element} to
 * @param { { childrenOnly?: boolean } } [options]
 */
export function morph(from, to, { childrenOnly = false } = {}) {
  if (childrenOnly) {
    morphChildren(from, to);
  } else {
    morphNode(from, to);
  }
}

/** @param {Node} from @param {Node} to @returns {Node} the node now in the DOM */
function morphNode(from, to) {
  if (!isSameKind(from, to)) {
    const clone = document.importNode(to, true);
    from.parentNode?.replaceChild(clone, from);
    return clone;
  }

  if (from.nodeType === Node.TEXT_NODE || from.nodeType === Node.COMMENT_NODE) {
    if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue;
    return from;
  }

  const fromEl = /** @type {Element} */ (from);
  const toEl = /** @type {Element} */ (to);
  if (fromEl.hasAttribute('data-morph-skip')) return from;

  syncAttributes(fromEl, toEl);
  syncFormState(fromEl, toEl);
  if (fromEl.localName !== 'template') morphChildren(fromEl, toEl);
  return from;
}

/** @param {Element} from @param {Element} to */
function morphChildren(from, to) {
  const target = [...to.childNodes];
  let current = from.firstChild;

  for (const next of target) {
    const match = findMatch(current, next);
    if (match && match !== current) from.insertBefore(match, current);
    if (match) {
      current = morphNode(match, next).nextSibling;
    } else {
      from.insertBefore(document.importNode(next, true), current);
    }
  }

  while (current) {
    const stale = current;
    current = current.nextSibling;
    stale.remove();
  }
}

/** @param {ChildNode | null} start @param {Node} wanted */
function findMatch(start, wanted) {
  const wantedId = wanted instanceof Element ? wanted.id : '';
  if (wantedId) {
    for (let node = start; node; node = node.nextSibling) {
      if (node instanceof Element && node.id === wantedId) return node;
    }
    return null;
  }
  if (start && isSameKind(start, wanted) && !(start instanceof Element && start.id)) return start;
  return null;
}

/** @param {Node} a @param {Node} b */
function isSameKind(a, b) {
  if (a.nodeType !== b.nodeType) return false;
  if (a instanceof Element && b instanceof Element) {
    return a.localName === b.localName && (a.id || '') === (b.id || '');
  }
  return true;
}

const PRESERVED = new Set(['open', 'data-closing', 'aria-expanded', 'data-animated', 'data-split', 'data-loaded']);

/** @param {Element} from @param {Element} to */
function syncAttributes(from, to) {
  for (const { name } of [...from.attributes]) {
    if (!to.hasAttribute(name) && !PRESERVED.has(name)) from.removeAttribute(name);
  }
  for (const { name, value } of [...to.attributes]) {
    if (PRESERVED.has(name)) continue;
    if (from.getAttribute(name) !== value) from.setAttribute(name, value);
  }
}

/** @param {Element} from @param {Element} to */
function syncFormState(from, to) {
  if (from instanceof HTMLInputElement && to instanceof HTMLInputElement) {
    if (from.type === 'checkbox' || from.type === 'radio') {
      from.checked = to.hasAttribute('checked');
    } else if (document.activeElement !== from) {
      from.value = to.getAttribute('value') ?? '';
    }
  } else if (from instanceof HTMLSelectElement && to instanceof HTMLSelectElement) {
    const selected = to.querySelector('option[selected]');
    if (selected && document.activeElement !== from) from.value = selected.getAttribute('value') ?? '';
  } else if (from instanceof HTMLTextAreaElement && document.activeElement !== from) {
    from.value = to.textContent ?? '';
  }
}
