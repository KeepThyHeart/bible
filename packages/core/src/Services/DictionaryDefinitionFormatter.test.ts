import { describe, it, expect } from 'vitest';
import {
  NEWLINE_HANDLING_KEY,
  definitionHasHtmlMarkup,
  dictionaryDefinitionToHtml,
  newlinesToLineBreaks,
  readNewlineHandling,
  resolveNewlineHandling,
} from './DictionaryDefinitionFormatter';

/**
 * A real Nave's Topical Bible entry, verbatim from `dictionary_nave.db`. The
 * "\n \n" separators are the whole point: they are the only thing marking
 * where one numbered sense ends and the next begins.
 */
const NAVE_ABDON =
  'ABDON  1. A judge of Israel, in the time of the judges Jud  12:13-15 ' +
  '2. A Levitical city Jos 21:30; 1Ch 6:74 3. A Benjamite chief 1Ch 8:23  ' +
  'See ACHBOR\n \n4. Son of Gibeon 1Ch 8:30; 9:36 5. Son of Micah 2Ch 34:20  ' +
  'Also called ACHBOR 2Ki 22:12\n \n ';

describe('definitionHasHtmlMarkup', () => {
  it('is false for prose', () => {
    expect(definitionHasHtmlMarkup(NAVE_ABDON)).toBe(false);
    expect(definitionHasHtmlMarkup('A judge of Israel.')).toBe(false);
    expect(definitionHasHtmlMarkup('')).toBe(false);
  });

  it('is true for block and inline tags alike', () => {
    expect(definitionHasHtmlMarkup('<p>A judge of Israel.</p>')).toBe(true);
    expect(definitionHasHtmlMarkup('a<br/>b')).toBe(true);
    expect(definitionHasHtmlMarkup('a <br /> b')).toBe(true);
    expect(definitionHasHtmlMarkup('see <i>supra</i>')).toBe(true);
    expect(definitionHasHtmlMarkup('<a href="#x">Gen 1:1</a>')).toBe(true);
    expect(definitionHasHtmlMarkup('<DIV>shouty</DIV>')).toBe(true);
  });

  it('does not mistake a stray angle bracket for markup', () => {
    // Webster 1913's "inequality" entry - the one `<` in ~300k stored entries.
    expect(definitionHasHtmlMarkup('the inequality 2 < 3, or 4 > 1')).toBe(false);
    expect(definitionHasHtmlMarkup('x <- y')).toBe(false);
    expect(definitionHasHtmlMarkup('<<emphasis>>')).toBe(false);
  });
});

describe('readNewlineHandling', () => {
  it('reads the declared value from a parsed metadata object', () => {
    expect(readNewlineHandling({ [NEWLINE_HANDLING_KEY]: 'significant' })).toBe('significant');
    expect(readNewlineHandling({ [NEWLINE_HANDLING_KEY]: 'insignificant' })).toBe('insignificant');
  });

  it('reads it out of a raw JSON string too', () => {
    expect(readNewlineHandling('{"newline_handling":"significant"}')).toBe('significant');
  });

  it('tolerates the camelCase spelling and surrounding noise', () => {
    expect(readNewlineHandling({ newlineHandling: ' Significant ' })).toBe('significant');
    expect(
      readNewlineHandling({ sword_module: 'Nave', [NEWLINE_HANDLING_KEY]: 'significant' })
    ).toBe('significant');
  });

  it('treats absent, unknown and malformed declarations as undeclared', () => {
    expect(readNewlineHandling(undefined)).toBeUndefined();
    expect(readNewlineHandling(null)).toBeUndefined();
    expect(readNewlineHandling('not json')).toBeUndefined();
    expect(readNewlineHandling({ sword_module: 'Nave' })).toBeUndefined();
    expect(readNewlineHandling({ [NEWLINE_HANDLING_KEY]: 'sometimes' })).toBeUndefined();
    expect(readNewlineHandling({ [NEWLINE_HANDLING_KEY]: true })).toBeUndefined();
  });
});

describe('resolveNewlineHandling', () => {
  it('lets the module declaration win over the text', () => {
    expect(resolveNewlineHandling('<p>markup</p>', 'significant')).toBe('significant');
    expect(resolveNewlineHandling('plain\ntext', 'insignificant')).toBe('insignificant');
  });

  it('falls back to the text when nothing is declared', () => {
    expect(resolveNewlineHandling(NAVE_ABDON)).toBe('significant');
    expect(resolveNewlineHandling(NAVE_ABDON, undefined)).toBe('significant');
    expect(resolveNewlineHandling('<p>one</p>\n<p>two</p>')).toBe('insignificant');
  });
});

describe('newlinesToLineBreaks', () => {
  it('inserts a break and keeps the newline for downstream line context', () => {
    expect(newlinesToLineBreaks('a\nb')).toBe('a<br />\nb');
  });

  it('normalises CRLF and CR', () => {
    expect(newlinesToLineBreaks('a\r\nb\rc')).toBe('a<br />\nb<br />\nc');
  });

  it('absorbs the spaces around a blank-line separator', () => {
    expect(newlinesToLineBreaks('a\n \nb')).toBe('a<br />\n<br />\nb');
  });

  it('trims the ends so a trailing separator adds no dangling breaks', () => {
    expect(newlinesToLineBreaks('  a\nb\n \n ')).toBe('a<br />\nb');
  });

  it('returns empty for empty input', () => {
    expect(newlinesToLineBreaks('')).toBe('');
  });
});

describe('dictionaryDefinitionToHtml', () => {
  it('breaks the sub-entry boundaries of a real Nave entry', () => {
    const html = dictionaryDefinitionToHtml(NAVE_ABDON);

    // The boundary before sense 4 is now visible.
    expect(html).toContain('See ACHBOR<br />\n<br />\n4. Son of Gibeon');
    // ...and the trailing separator does not leave dangling breaks.
    expect(html.endsWith('2Ki 22:12')).toBe(true);
    // One interior boundary ("\n \n") becomes exactly two breaks - a blank
    // line - and the trailing separator becomes none. Nothing else invented.
    expect(html.match(/<br \/>/g)).toHaveLength(2);
  });

  it('escapes prose, so a stray angle bracket survives to the screen', () => {
    expect(dictionaryDefinitionToHtml('the inequality 2 < 3, or 4 > 1')).toBe(
      'the inequality 2 &lt; 3, or 4 &gt; 1'
    );
    expect(dictionaryDefinitionToHtml(`Tom & Jerry's "book"`)).toBe(
      'Tom &amp; Jerry&#39;s &quot;book&quot;'
    );
  });

  it('escapes anything script-shaped in prose rather than passing it on', () => {
    expect(dictionaryDefinitionToHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;'
    );
  });

  it('leaves HTML content alone, newlines included', () => {
    const html = '<p>A judge of Israel.</p>\n<p>A Levitical city.</p>';
    expect(dictionaryDefinitionToHtml(html)).toBe(html);
  });

  it('handles mixed content by keeping the markup and not breaking its newlines', () => {
    const mixed = 'ABDON\n1. A judge, <i>shophet</i>.\n2. A city.';
    expect(dictionaryDefinitionToHtml(mixed)).toBe(mixed);
  });

  it('breaks mixed content when the module says its newlines are significant', () => {
    const mixed = 'ABDON\n1. A judge, <i>shophet</i>.\n2. A city.';
    expect(dictionaryDefinitionToHtml(mixed, 'significant')).toBe(
      'ABDON<br />\n1. A judge, <i>shophet</i>.<br />\n2. A city.'
    );
  });

  it('still escapes prose the module declared insignificant', () => {
    expect(dictionaryDefinitionToHtml('2 < 3\nand more', 'insignificant')).toBe(
      '2 &lt; 3\nand more'
    );
  });

  it('is empty for empty, null and undefined', () => {
    expect(dictionaryDefinitionToHtml('')).toBe('');
    expect(dictionaryDefinitionToHtml(null)).toBe('');
    expect(dictionaryDefinitionToHtml(undefined)).toBe('');
  });

  it('emits only tags DOMPurify keeps by default', () => {
    // The inserted tag has to survive the sanitiser the render sites run, or
    // the breaks would be stripped straight back out again.
    expect(dictionaryDefinitionToHtml('a\nb')).toBe('a<br />\nb');
  });
});
