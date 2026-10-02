import { hasBidiControls, stripBidiControls } from '@bible/core/browser';

/**
 * Copy handler: when the selected text contains invisible bidi control
 * characters (isolates/marks added for display), put a clean version on the
 * clipboard. No-op otherwise, and when an app copy handler already set the data.
 */
export function handleBidiCopy(e: ClipboardEvent, getSelection: () => string = () => globalThis.getSelection?.()?.toString() ?? ''): void {
  if (e.defaultPrevented || !e.clipboardData) return;
  const text = getSelection();
  if (!text || !hasBidiControls(text)) return;
  e.preventDefault();
  e.clipboardData.setData('text/plain', stripBidiControls(text));
}

let installed = false;

/** Install the document-level copy listener once. */
export function installBidiCopy(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener('copy', (e) => handleBidiCopy(e));
}
