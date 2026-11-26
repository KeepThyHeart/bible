/**
 * The standalone HTML page a printed passage is: sanitized body, a print stylesheet, a restrictive CSP.
 * Built like the note document (`useNoteFileActions`) and sent through the same hardened hidden window
 * (`document:print` in main.ts), which injects the CSP again on its side.
 *
 * Red letters are not used: the passage is rendered with `wordsOfChristInRed` off, and the stylesheet sets
 * every colour to black, so the page is legible on a black-and-white printer.
 */
import {
  DEFAULT_PRINT_PREFERENCES,
  buildPrintStylesheet,
  printNotesRuleHtml,
  printTitleHtml,
  type PrintPreferences,
} from '@bible/core';
import { sanitizeHtml } from './sanitize';

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * A file name for a printed or saved passage: "John 3-16 KJV" for John 3:16 in the KJV. Colons (not
 * allowed in Windows file names) become hyphens, other characters a file system rejects are dropped, and
 * runs of spaces collapse. No extension.
 */
export function passageFileName(reference: string, translation: string): string {
  const clean = (text: string) =>
    text.replace(/:/g, '-').replace(/[\\/*?"<>|\0]/g, '').replace(/\s+/g, ' ').trim();
  return [clean(reference), clean(translation)].filter(Boolean).join(' ') || 'Passage';
}

/**
 * `title` is the heading printed on the page ("John 3:16 (KJV)"); `docTitle`, when given, is the
 * document's `<title>`, which some print-to-PDF drivers offer as the file name, so it is the file-name
 * form ("John 3-16 KJV").
 */
export function buildPassagePrintDocument(
  title: string,
  bodyHtml: string,
  dir: 'ltr' | 'rtl' = 'ltr',
  prefs: PrintPreferences = DEFAULT_PRINT_PREFERENCES,
  docTitle?: string,
): string {
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'none'">`;
  return `<!DOCTYPE html><html dir="${dir}"><head>${csp}<title>${escapeText(docTitle ?? title)}</title><style>
      ${buildPrintStylesheet(prefs)}
    </style></head><body>${printNotesRuleHtml(prefs)}${printTitleHtml(title, prefs)}${sanitizeHtml(bodyHtml)}</body></html>`;
}

/** Plain text (newlines) as the body of a print document. */
export function textToPrintBody(text: string): string {
  return `<p>${escapeText(text).split(/\n{2,}/).map(p => p.replace(/\n/g, '<br>')).join('</p><p>')}</p>`;
}
