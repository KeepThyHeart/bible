// @vitest-environment jsdom
/**
 * Several of these assertions are about DOMPurify itself rather than about our
 * code, and they are here on purpose.
 *
 * The `@vitest-environment jsdom` above is load-bearing. DOMPurify parses into
 * a real DOM, and under the happy-dom 15 the rest of this suite runs on it
 * mangles its own output — it drops the first element of a fragment and that
 * element's attributes, and returned `''` for `<p>Grace</p><script>…</script>`.
 * Nothing about that is visible at a call site: the sanitizer still returns a
 * string, so the content merely renders slightly wrong. Browsers have a real
 * DOM and are unaffected, so this is a test-environment defect rather than a
 * product one, and pinning the environment per file was cheaper than moving
 * every other web test onto jsdom to fix it.
 *
 * If a future happy-dom upgrade fixes this, delete the docblock and see whether
 * these still pass — the escape cases below are what would notice.
 *
 * The keep cases pin the two attributes the call sites depend on: `<mark>`,
 * which FTS search snippets use for match highlighting, and `data-*`, which
 * `processCommentaryLinks` writes onto verse references before the content
 * reaches the sanitizer. Losing either is silent — the content still renders,
 * just stripped of the thing that made it useful.
 */
import { describe, it, expect } from 'vitest';
import { sanitizeHtml } from './sanitize';

describe('sanitizeHtml', () => {
  it('removes script elements', () => {
    expect(sanitizeHtml('<p>Grace</p><script>alert(1)</script>')).toBe('<p>Grace</p>');
  });

  it('removes inline event handlers', () => {
    const clean = sanitizeHtml('<img src="x" onerror="alert(1)">');
    expect(clean).not.toContain('onerror');
  });

  it('removes javascript: URLs', () => {
    const clean = sanitizeHtml('<a href="javascript:alert(1)">click</a>');
    expect(clean).not.toContain('javascript:');
  });

  it('keeps the formatting markup module content is written in', () => {
    const html = '<p><b>Faith</b> <i>and</i> <em>hope</em><br><a href="#x">see</a></p>';
    expect(sanitizeHtml(html)).toBe(html);
  });

  it('keeps <mark>, which search snippets highlight matches with', () => {
    expect(sanitizeHtml('For God so <mark>loved</mark> the world')).toContain('<mark>loved</mark>');
  });

  it('keeps data attributes, which commentary verse links are annotated with', () => {
    const clean = sanitizeHtml('<a class="verse-link" data-verse-id="43003016">John 3:16</a>');
    expect(clean).toContain('data-verse-id="43003016"');
  });

  it('keeps the styled spans formatted verse HTML is built from', () => {
    const html = '<span class="christ-words">Verily</span> <span class="divine-name">LORD</span>';
    expect(sanitizeHtml(html)).toBe(html);
  });

  it('passes plain text through unchanged', () => {
    expect(sanitizeHtml('In the beginning God created')).toBe('In the beginning God created');
  });
});
