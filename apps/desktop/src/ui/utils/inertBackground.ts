/**
 * Makes everything outside `dialog` inert while a modal dialog is open, so
 * `aria-modal` is backed by behaviour: assistive tech and Tab cannot reach the
 * app behind it. Walks from the dialog up to <body> and marks each ancestor's
 * other children `inert`. Live regions are left alone so announcements still
 * work. Only elements this call made inert are restored on release.
 */
export function inertBackground(dialog: HTMLElement): () => void {
  const marked: HTMLElement[] = [];
  let node: HTMLElement | null = dialog;
  while (node && node !== document.body) {
    const parent: HTMLElement | null = node.parentElement;
    if (!parent) break;
    for (const sibling of Array.from(parent.children)) {
      if (sibling === node || !(sibling instanceof HTMLElement)) continue;
      if (sibling.hasAttribute('inert')) continue;
      if (sibling.hasAttribute('aria-live') || sibling.querySelector('[aria-live]')) continue;
      if (['SCRIPT', 'STYLE', 'LINK'].includes(sibling.tagName)) continue;
      sibling.setAttribute('inert', '');
      marked.push(sibling);
    }
    node = parent;
  }
  return () => {
    for (const el of marked) el.removeAttribute('inert');
  };
}
