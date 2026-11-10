/**
 * Makes everything outside `dialog` inert while a modal dialog is open, so
 * `aria-modal` is backed by behaviour. A tiny local copy of the desktop app's
 * `inertBackground` (this package cannot import app code). Walks from the
 * dialog up to <body>, marking each ancestor's other children `inert`;
 * live regions (and branches that merely contain one) are not inerted whole.
 * Returns a release function that restores only what this call marked.
 */
export function inertBackground(dialog: HTMLElement): () => void {
  const marked: HTMLElement[] = [];
  const body = dialog.ownerDocument.body;
  const markOut = (node: HTMLElement): void => {
    if (node.hasAttribute('inert')) return;
    if (['SCRIPT', 'STYLE', 'LINK'].includes(node.tagName)) return;
    if (node.hasAttribute('aria-live')) return;
    if (node.querySelector('[aria-live]')) {
      for (const child of Array.from(node.children)) {
        if (child instanceof HTMLElement) markOut(child);
      }
      return;
    }
    node.setAttribute('inert', '');
    marked.push(node);
  };
  let node: HTMLElement | null = dialog;
  while (node && node !== body) {
    const parent: HTMLElement | null = node.parentElement;
    if (!parent) break;
    for (const sibling of Array.from(parent.children)) {
      if (sibling === node || !(sibling instanceof HTMLElement)) continue;
      markOut(sibling);
    }
    node = parent;
  }
  return () => {
    for (const m of marked) m.removeAttribute('inert');
  };
}
