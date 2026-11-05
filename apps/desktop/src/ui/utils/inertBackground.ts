/**
 * Makes everything outside `dialog` inert while a modal dialog is open, so
 * `aria-modal` is backed by behaviour: assistive tech and Tab cannot reach the
 * app behind it. Walks from the dialog up to <body> and marks each ancestor's
 * other children `inert`. Live regions are left alone so announcements still
 * work, and so is every ancestor of one (a subtree that merely *contains* a
 * live region is walked, not skipped, so its other content is still inerted
 * rather than leaving the whole branch reachable). Only elements this call
 * made inert are restored on release.
 */
export function inertBackground(dialog: HTMLElement): () => void {
  const marked: HTMLElement[] = [];
  const isLive = (el: Element): boolean => el.hasAttribute('aria-live');
  const markOut = (el: HTMLElement): void => {
    if (el.hasAttribute('inert')) return;
    if (['SCRIPT', 'STYLE', 'LINK'].includes(el.tagName)) return;
    if (isLive(el)) return;
    if (el.querySelector('[aria-live]')) {
      // Holds a live region somewhere below: inert the rest, keep that branch.
      for (const child of Array.from(el.children)) {
        if (child instanceof HTMLElement) markOut(child);
      }
      return;
    }
    el.setAttribute('inert', '');
    marked.push(el);
  };
  let node: HTMLElement | null = dialog;
  while (node && node !== document.body) {
    const parent: HTMLElement | null = node.parentElement;
    if (!parent) break;
    for (const sibling of Array.from(parent.children)) {
      if (sibling === node || !(sibling instanceof HTMLElement)) continue;
      markOut(sibling);
    }
    node = parent;
  }
  return () => {
    for (const el of marked) el.removeAttribute('inert');
  };
}
