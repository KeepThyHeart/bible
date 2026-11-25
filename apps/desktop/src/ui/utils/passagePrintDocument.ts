/**
 * The standalone HTML page a printed passage is: sanitized body, a print stylesheet, a restrictive CSP.
 * Built like the note document (`useNoteFileActions`) and sent through the same hardened hidden window
 * (`document:print` in main.ts), which injects the CSP again on its side.
 *
 * Red letters are not used: the passage is rendered with `wordsOfChristInRed` off, and the stylesheet sets
 * every colour to black, so the page is legible on a black-and-white printer.
 */
import { sanitizeHtml } from './sanitize';

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function buildPassagePrintDocument(title: string, bodyHtml: string, dir: 'ltr' | 'rtl' = 'ltr'): string {
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'none'">`;
  return `<!DOCTYPE html><html dir="${dir}"><head>${csp}<title>${escapeText(title)}</title><style>
      body { font-family: Georgia, "Times New Roman", serif; font-size: 14pt; line-height: 1.6; max-width: 38em; margin: 2em auto; padding: 0 1em; color: #000; background: #fff; }
      h1 { font-size: 18pt; margin: 0 0 0.6em; }
      h2, h3, h4 { color: #000; }
      blockquote { border-inline-start: 2px solid #000; margin-inline: 0; padding-inline-start: 1em; }
      * { color: #000 !important; background: transparent !important; }
      sup { font-size: 0.7em; }
      @page { margin: 2cm; }
    </style></head><body><h1>${escapeText(title)}</h1>${sanitizeHtml(bodyHtml)}</body></html>`;
}

/** Plain text (newlines) as the body of a print document. */
export function textToPrintBody(text: string): string {
  return `<p>${escapeText(text).split(/\n{2,}/).map(p => p.replace(/\n/g, '<br>')).join('</p><p>')}</p>`;
}
