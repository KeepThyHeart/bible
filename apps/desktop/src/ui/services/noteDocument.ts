import { sanitizeHtml } from '../utils/sanitize';
import { escapeHtmlText } from '../components/notes/UserNotesPane/utils';

/**
 * The note as a standalone HTML document: sanitized body, print stylesheet,
 * restrictive CSP.
 *
 * Printing and PDF export are the same page through two different exits, so
 * they build it once here. (The main process injects the CSP again on its own
 * side - this copy is not load-bearing, it just means the document is already
 * correct if anything else ever renders it.)
 */
export function buildNoteDocumentHtml(title: string, bodyHtml: string): string {
  const safeTitle = escapeHtmlText(title);
  const safeBody = sanitizeHtml(bodyHtml);
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'none'">`;
  return `<!DOCTYPE html><html><head>${csp}<title>${safeTitle}</title><style>
      body { font-family: Georgia, serif; font-size: 16px; line-height: 1.7; max-width: 700px; margin: 40px auto; padding: 0 20px; color: #111; }
      h1 { font-size: 24px; margin-bottom: 8px; }
      h2 { font-size: 20px; } h3 { font-size: 18px; }
      table { border-collapse: collapse; width: 100%; margin: 1em 0; }
      td, th { border: 1px solid #ccc; padding: 6px 10px; }
      blockquote { border-inline-start: 3px solid #ccc; margin-inline-start: 0; padding-inline-start: 16px; color: #555; }
      ul { list-style: disc; padding-inline-start: 2em; } ol { list-style: decimal; padding-inline-start: 2em; }
    </style></head><body><h1>${safeTitle}</h1>${safeBody}</body></html>`;
}

/**
 * File-name-safe version of a note title, for the export dialogs' default and a compiled note's
 * file. A colon becomes "." so verse references stay readable ("Romans 7.24-8.4"); other unsafe
 * characters become "_".
 */
export function exportFileName(title: string): string {
  return (title || 'note').replace(/:/g, '.').replace(/[<>"/\\|?*]/g, '_');
}
