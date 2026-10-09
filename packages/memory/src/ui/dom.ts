/**
 * A hundred lines of DOM helpers instead of a framework.
 *
 * There is no framework available here and no way to fetch one: the panel's
 * CSP is `default-src 'none'` with `connect-src 'self'`, so nothing loads from
 * a CDN, and adding a bundled UI library would mean shipping it inside the
 * extension package for four screens. What that actually costs is a tolerable
 * amount of `createElement` boilerplate, and this file is the whole answer to
 * it - a builder that takes attributes and children so the view modules read
 * as a tree rather than as a hundred imperative statements.
 *
 * Nothing here is clever on purpose. The one thing it does insist on is
 * `textContent` over `innerHTML`: verse text, passage references and worker
 * error strings all end up on screen, and `innerHTML` on any of them would
 * turn a translation quirk or a bad reference into markup injection inside a
 * privileged-adjacent origin. There is no HTML-string path in this module at
 * all, which makes that a property of the panel rather than a rule someone has
 * to remember.
 */

/** Attributes and properties `el()` understands. */
export interface ElOptions {
  class?: string;
  text?: string;
  title?: string;
  id?: string;
  type?: string;
  value?: string;
  placeholder?: string;
  disabled?: boolean;
  hidden?: boolean;
  /** Applied verbatim; use for `aria-*`, `role`, `data-*`, `tabindex`. */
  attrs?: Record<string, string>;
  /** Inline styles. Permitted by the panel CSP - only scripts are restricted. */
  style?: Partial<CSSStyleDeclaration>;
  on?: Partial<{
    [K in keyof HTMLElementEventMap]: (ev: HTMLElementEventMap[K]) => void;
  }>;
}

export type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts: ElOptions = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  if (opts.class !== undefined) node.className = opts.class;
  if (opts.text !== undefined) node.textContent = opts.text;
  if (opts.title !== undefined) node.title = opts.title;
  if (opts.id !== undefined) node.id = opts.id;
  if (opts.hidden !== undefined) node.hidden = opts.hidden;

  // `type`, `value`, `placeholder` and `disabled` only exist on some elements.
  // Setting them as properties where they exist and as attributes otherwise
  // keeps the call sites uniform without a per-tag overload explosion.
  if (opts.type !== undefined) node.setAttribute('type', opts.type);
  if (opts.value !== undefined) node.setAttribute('value', opts.value);
  if (opts.placeholder !== undefined) node.setAttribute('placeholder', opts.placeholder);
  if (opts.disabled) node.setAttribute('disabled', '');

  if (opts.attrs) {
    for (const [name, value] of Object.entries(opts.attrs)) node.setAttribute(name, value);
  }
  if (opts.style) Object.assign(node.style, opts.style);
  if (opts.on) {
    for (const [name, handler] of Object.entries(opts.on)) {
      node.addEventListener(name, handler as EventListener);
    }
  }

  append(node, children);
  return node;
}

/** Appends children, skipping the `false`/`null` holes that conditionals leave. */
export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

/** A real `<button type="button">`, never a clickable div. */
export function button(
  label: string,
  onClick: () => void,
  opts: ElOptions = {},
): HTMLButtonElement {
  const b = el('button', { ...opts, text: opts.text ?? label });
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

/** Removes every child. Faster and safer than `innerHTML = ''`. */
export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Replaces a node's contents in one step. */
export function replace(node: Element, children: Child[]): void {
  clear(node);
  append(node, children);
}

/** A plain text node. Used for the spaces between words, which matter. */
export function textNode(value: string): Text {
  return document.createTextNode(value);
}

/**
 * Moves focus without scrolling the passage.
 *
 * `focus()` scrolls its target into view by default. In the blanks exercise
 * that means pressing Enter on a blank near the bottom of a long passage jumps
 * the whole page, which is precisely the "no repagination" problem the width
 * measurement exists to avoid, arriving by a different route. `preventScroll`
 * is advisory - browsers that ignore it simply behave as they did before.
 */
export function focusQuietly(node: HTMLElement | null): void {
  if (!node) return;
  node.focus({ preventScroll: true });
}
