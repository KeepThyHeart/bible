import { hasBidiControls, stripBidiControls } from '@bible/core/browser';

/**
 * Document-level `copy` handler: when the selected text contains bidi control
 * characters (isolation marks added for display), put a stripped plain-text
 * copy on the clipboard instead. Does nothing otherwise, and never overrides a
 * handler that already took over the copy.
 */
export function handleCopyStripBidi(e: ClipboardEvent): void {
  if (e.defaultPrevented || !e.clipboardData) return;
  const text = (typeof window !== 'undefined' ? window.getSelection()?.toString() : '') ?? '';
  if (!text || !hasBidiControls(text)) return;
  e.preventDefault();
  e.clipboardData.setData('text/plain', stripBidiControls(text));
}

/** Install once from the renderer entry. Returns an uninstaller. */
export function installStripBidiOnCopy(doc: Document = document): () => void {
  doc.addEventListener('copy', handleCopyStripBidi);
  return () => doc.removeEventListener('copy', handleCopyStripBidi);
}
