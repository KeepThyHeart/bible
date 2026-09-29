import DOMPurify from 'dompurify';

// The policy is DOMPurify's default profile in both apps (web's copy documents
// why: it keeps `<mark>` and `data-*`). There is no allow-list to share through
// `@bible/core`, and core must not depend on DOMPurify, so each app keeps this
// one-line library call. If either app ever narrows the profile, put the
// tag/attribute lists in core and pass them to `DOMPurify.sanitize` from both.

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html);
}
