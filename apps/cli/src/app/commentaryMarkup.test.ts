/**
 * Commentary markup → terminal rows.
 *
 * Extracted from `screens/Commentary.test.ts` when the old rail-based
 * `Commentary` screen was removed (task 0001-bible-cli, "delete the old
 * screens") — only {@link layoutCommentary}'s own markup group and its
 * Markdown counterpart carry over; the screen's `describe.skipIf(!hasLibrary)`
 * groups tested the rail, `<`/`>` by unit and the find box, none of which
 * exist any more (`screens/Main.ts`'s `c`/`m` study views replace them).
 *
 * {@link layoutCommentary} is pure, so it is tested against markup written
 * out in the test — including the shapes that were *found* in the real
 * modules (`<!P>`, `<sup>`, a style boundary flush against a comma) rather
 * than the shapes HTML tutorials use. Those cases are the ones with an
 * obvious wrong implementation that still looks right on `<b>bold</b>`.
 */
import { describe, expect, test } from 'bun:test';

import { createTheme, renderStyledLine, stripAnsi } from '../term/style';
import { layoutCommentary } from './commentaryMarkup';

const theme = createTheme('ansi256');

/** Plain text of laid-out markup, one string per row. */
function laid(html: string, width = 60): string[] {
  return layoutCommentary(html, { width, theme }).map((line) =>
    stripAnsi(renderStyledLine(line, theme.depth)),
  );
}

describe('markup', () => {
  test('a tag is removed and its text kept', () => {
    expect(laid('<a href="x">John 3:16</a> is the verse').join('\n')).toBe(
      'John 3:16 is the verse',
    );
  });

  test('a style change in the middle of a word does not insert a space', () => {
    // Gill's opening line is `<strong>…world</strong>,....`. Wrapping the runs
    // separately — the obvious implementation — renders `world ,` and puts a
    // space the module never wrote in front of every closing punctuation mark.
    expect(laid('<strong>For God so loved the world</strong>,.... The Persic').join('\n')).toBe(
      'For God so loved the world,.... The Persic',
    );
  });

  test('block tags become paragraph breaks, which is the only structure a terminal has', () => {
    expect(laid('<p>one</p><p>two</p>')).toEqual(['one', '', 'two']);
    expect(laid('one<br />two')).toEqual(['one', '', 'two']);
    // SWORD's own markers, 7,071 of them across the first 60 entries of the
    // installed commentaries. A stripper that only knows HTML runs a whole
    // exposition together into one block.
    expect(laid('<!P>one<!/P><!P>two<!/P>')).toEqual(['one', '', 'two']);
  });

  test('a list item gets a bullet and hangs under it', () => {
    const rows = laid('<ul><li>the privilege that is proposed everlasting life</li></ul>', 24);
    expect(rows[0]).toBe('  • the privilege that');
    expect(rows[1]).toBe('    is proposed');
  });

  test('italic, bold and underline are attributes, so they survive NO_COLOR', () => {
    const plain = createTheme('none');
    const lines = layoutCommentary('<i>a</i> <b>b</b> <u>c</u>', { width: 40, theme: plain });
    const styles = lines[0]!.map((segment) => segment.style ?? {});
    expect(styles[0]?.italic).toBe(true);
    expect(styles.some((style) => style.bold === true)).toBe(true);
    expect(styles.some((style) => style.underline === true)).toBe(true);
  });

  test('a superscript number becomes one, as it is in the reader', () => {
    expect(laid('<sup>16</sup>For God').join('')).toContain('¹⁶');
    // Anything that is not a bare number is left alone rather than mangled.
    expect(laid('<sup>note a</sup>').join('')).toContain('note a');
  });

  test('small caps become capitals, for the reason the divine name does', () => {
    expect(laid('<sc>lord</sc> of hosts').join('')).toBe('LORD of hosts');
  });

  test('entities are decoded and a bare angle bracket is not eaten', () => {
    expect(laid('Q&amp;A').join('')).toBe('Q&A');
    // `/<[^>]*>/` would swallow "< b >" and silently delete "b".
    expect(laid('a < b > c').join(' ')).toContain('< b > c');
  });

  test('whitespace in the source does not become whitespace on screen', () => {
    expect(laid('one   \n\n  two').join('\n')).toBe('one two');
    expect(laid('<p>  </p><p>real</p>')).toEqual(['real']);
  });
});

describe('the Markdown minority', () => {
  test('a Markdown entry gets structure rather than its own punctuation', () => {
    const rows = laid('## Verse 16\n\n- the privilege\n- the people');
    // The heading is its own block and the hashes are gone; without the branch
    // the whole entry arrives as one paragraph reading `## Verse 16 - the …`.
    expect(rows[0]).toBe('Verse 16');
    expect(rows.join('\n')).not.toContain('#');
    expect(rows.filter((row) => row.includes('•'))).toHaveLength(2);
    expect(rows).toContain('  • the privilege');
  });

  test('a bold run is bold, not a pair of asterisks', () => {
    expect(laid('The word is **monogenes**, only-begotten.').join(' ')).toBe(
      'The word is monogenes, only-begotten.',
    );

    const plain = createTheme('none');
    const lines = layoutCommentary('The word is **monogenes**, only-begotten.', {
      width: 60,
      theme: plain,
    });
    const bold = lines[0]!.filter((segment) => segment.style?.bold === true);
    expect(bold.map((segment) => segment.text).join('')).toBe('monogenes');
  });

  test('an HTML entry keeps the HTML parser, markers and all', () => {
    // A converter that left tags behind *and* asterisks: the tags win, and the
    // asterisks are text the module wrote rather than a list it meant.
    const rows = laid('<p>See:</p>\n* the first sense\n* the second');
    expect(rows.join('\n')).toContain('* the first sense * the second');
    expect(rows.join('\n')).not.toContain('•');

    // And the shapes the modules really use are untouched by the branch.
    expect(laid('<!P>one<!/P><!P>two<!/P>')).toEqual(['one', '', 'two']);
    expect(laid('<i>a</i> <b>b</b>').join('')).toBe('a b');
  });

  test('the parser is chosen per entry, because one module holds both', () => {
    // Nothing is remembered between calls, so a Markdown entry and an HTML one
    // laid out one after the other each get their own parser. A per-module
    // answer cached anywhere would give the second one the first one's.
    expect(laid('## Verse 16')[0]).toBe('Verse 16');
    expect(laid('<h2>Verse 17</h2>')[0]).toBe('Verse 17');
    expect(laid('## Verse 18')[0]).toBe('Verse 18');
  });
});
