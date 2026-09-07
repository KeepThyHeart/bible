import DOMPurify from 'dompurify';

/**
 * Strip scripts and event handlers from HTML that is about to be handed to
 * `dangerouslySetInnerHTML`.
 *
 * Module content is not our HTML. Commentaries, dictionaries, and Bible
 * translations are third-party `.db` files a user installs, and their entries
 * are stored as markup so they can carry emphasis, links and headings. That is
 * the whole point of the format, and it also means a module is an HTML
 * injection vector: whatever the module says goes straight into the page.
 * Desktop has sanitized these sinks since it grew them (see
 * the desktop app's `src/ui/utils/sanitize.ts`, which this mirrors); web renders
 * the same content and did not, so a module that was harmless in the desktop
 * app could run script in the browser one.
 *
 * The default DOMPurify profile is deliberate rather than a placeholder. It
 * keeps ordinary formatting markup — including the `<mark>` that FTS snippets
 * use for match highlighting — and it keeps `data-*` attributes, which is what
 * lets `processCommentaryLinks` annotate verse references *before* the content
 * is sanitized. Narrowing to an explicit allow-list would have to enumerate
 * every tag 25 modules happen to use, and getting that list wrong shows up as
 * silently missing content rather than as an error.
 *
 * Apply this to module content only. Interpolated locale strings and the inline
 * SVG icon constants are our own source, and running them through a sanitizer
 * would suggest they are not.
 */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html);
}
