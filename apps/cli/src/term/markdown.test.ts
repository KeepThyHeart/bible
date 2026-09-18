/**
 * The Markdown commentary path.
 *
 * Two things are under test and they pull in opposite directions: the detector
 * must not claim prose that merely contains an asterisk or a hyphen, and the
 * parser must not swallow a marker whose partner never arrived. Both are
 * asserted on the text a reader would actually see, not on the internals.
 */
import { describe, expect, test } from 'bun:test';

import { looksLikeMarkdown, parseMarkdownBlocks, type Block } from './markdown';
import { createTheme, type Style } from './style';

const theme = createTheme('ansi256');

/** What one block reads as, with the separators `wrapTokens` will put back. */
function blockText(block: Block): string {
  return block.tokens.map((token) => token.segments.map((s) => s.text).join('')).join(' ');
}

/** Every styled segment whose text contains `needle`, across every block. */
function stylesFor(blocks: readonly Block[], needle: string): (Style | undefined)[] {
  const styles: (Style | undefined)[] = [];
  for (const block of blocks) {
    for (const token of block.tokens) {
      for (const segment of token.segments) {
        if (segment.text.includes(needle)) styles.push(segment.style);
      }
    }
  }
  return styles;
}

describe('detecting a Markdown entry', () => {
  test('a heading, a bullet, a number and a bold run each say Markdown', () => {
    expect(looksLikeMarkdown('## Verse 16\n\nGod so loved.')).toBe(true);
    expect(looksLikeMarkdown('###### The sixth level')).toBe(true);
    expect(looksLikeMarkdown('- the first sense\n- the second')).toBe(true);
    expect(looksLikeMarkdown('* the first sense\n* the second')).toBe(true);
    expect(looksLikeMarkdown('1. the first sense\n2. the second')).toBe(true);
    expect(looksLikeMarkdown('The word is **monogenes**, only-begotten.')).toBe(true);
  });

  test('an HTML entry never says Markdown, even carrying Markdown-shaped lines', () => {
    expect(looksLikeMarkdown('<p>God so loved the world.</p>')).toBe(false);
    expect(looksLikeMarkdown('<li>the first sense</li>')).toBe(false);
    // The tags a converter left behind still win over the markers beside them.
    expect(looksLikeMarkdown('<p>See:</p>\n* the first sense\n* the second')).toBe(false);
    expect(looksLikeMarkdown('Compare <i>agape</i> with **eros**.')).toBe(false);
  });

  test('the SWORD-era markers count as HTML', () => {
    expect(looksLikeMarkdown('<!P>Verse 16.<!/P>\n* the first sense')).toBe(false);
    expect(looksLikeMarkdown('The <sc>lord</sc> said.\n## A heading')).toBe(false);
  });

  test('prose with an asterisk in it is not a list', () => {
    expect(looksLikeMarkdown('The reading is doubtful*, as the margin shows.')).toBe(false);
    expect(looksLikeMarkdown('Multiply 2 * 3 * 4 for the total.')).toBe(false);
    expect(looksLikeMarkdown('A lone ** in the text means nothing.')).toBe(false);
  });

  test('a hyphen inside or beginning a word is not a bullet', () => {
    expect(looksLikeMarkdown('This is self-evident to the well-known school.')).toBe(false);
    expect(looksLikeMarkdown('-not a bullet, having no space after the hyphen')).toBe(false);
    expect(looksLikeMarkdown('A rule of dashes:\n---\nand then more prose.')).toBe(false);
  });

  test('an underscore inside a word is not emphasis', () => {
    expect(looksLikeMarkdown('The field is named verse_id in the schema.')).toBe(false);
  });

  test('plain prose and empty text say nothing', () => {
    expect(looksLikeMarkdown('')).toBe(false);
    expect(looksLikeMarkdown('   \n  \n')).toBe(false);
    expect(looksLikeMarkdown('For God so loved the world, that he gave his only Son.')).toBe(false);
  });
});

describe('headings', () => {
  test('the text loses its hashes and takes the heading role', () => {
    const blocks = parseMarkdownBlocks('## Verse 16 ##\n\nGod so loved.', theme);
    expect(blocks).toHaveLength(2);
    expect(blockText(blocks[0]!)).toBe('Verse 16');
    expect(blockText(blocks[1]!)).toBe('God so loved.');
    for (const style of stylesFor([blocks[0]!], 'Verse')) {
      expect(style).toEqual({ ...theme.heading, bold: true });
    }
  });

  test('the top two levels are bold and the rest are not', () => {
    const top = parseMarkdownBlocks('# Title', theme);
    const deep = parseMarkdownBlocks('### Subheading', theme);
    expect(stylesFor(top, 'Title')[0]).toEqual({ ...theme.heading, bold: true });
    expect(stylesFor(deep, 'Subheading')[0]).toEqual(theme.heading);
  });

  test('a heading never absorbs the text under it', () => {
    const blocks = parseMarkdownBlocks('# Title\nThe body follows immediately.', theme);
    expect(blocks.map(blockText)).toEqual(['Title', 'The body follows immediately.']);
    expect(stylesFor(blocks, 'body')[0]).toBeUndefined();
  });

  test('seven hashes are not a heading', () => {
    const blocks = parseMarkdownBlocks('####### Too many', theme);
    expect(blockText(blocks[0]!)).toBe('####### Too many');
  });
});

describe('emphasis', () => {
  test('a bold run is bold and loses its markers', () => {
    const blocks = parseMarkdownBlocks('The word is **monogenes** here.', theme);
    expect(blockText(blocks[0]!)).toBe('The word is monogenes here.');
    expect(stylesFor(blocks, 'monogenes')[0]).toEqual({ bold: true });
  });

  test('both italic markers give the style a supplied word has', () => {
    for (const source of ['Compare *agape* with love.', 'Compare _agape_ with love.']) {
      const blocks = parseMarkdownBlocks(source, theme);
      expect(blockText(blocks[0]!)).toBe('Compare agape with love.');
      expect(stylesFor(blocks, 'agape')[0]).toEqual(theme.supplied);
    }
  });

  test('bold inside italic keeps both', () => {
    const blocks = parseMarkdownBlocks('*the **whole** point*', theme);
    expect(blockText(blocks[0]!)).toBe('the whole point');
    expect(stylesFor(blocks, 'whole')[0]).toEqual({ ...theme.supplied, bold: true });
    expect(stylesFor(blocks, 'the')[0]).toEqual(theme.supplied);
  });

  test('punctuation against a styled word stays in the same token', () => {
    // One token, so nothing inserts a space before the comma.
    const blocks = parseMarkdownBlocks('**Faith**, then, is the ground.', theme);
    expect(blocks[0]!.tokens[0]!.segments.map((s) => s.text).join('')).toBe('Faith,');
  });

  test('inline code is underlined and loses its backticks', () => {
    const blocks = parseMarkdownBlocks('The key is `agapao` in the Greek.', theme);
    expect(blockText(blocks[0]!)).toBe('The key is agapao in the Greek.');
    expect(stylesFor(blocks, 'agapao')[0]).toEqual({ underline: true });
  });

  test('a marker inside code is left alone', () => {
    const blocks = parseMarkdownBlocks('Write `a * b` for the product.', theme);
    expect(blockText(blocks[0]!)).toBe('Write a * b for the product.');
  });

  test('emphasis survives a line break inside the paragraph', () => {
    const blocks = parseMarkdownBlocks('the **whole\ncounsel** of God', theme);
    expect(blockText(blocks[0]!)).toBe('the whole counsel of God');
    expect(stylesFor(blocks, 'whole')[0]).toEqual({ bold: true });
    expect(stylesFor(blocks, 'counsel')[0]).toEqual({ bold: true });
  });
});

describe('markers with no partner degrade to text', () => {
  test('an unclosed bold or italic marker is written as it stands', () => {
    expect(blockText(parseMarkdownBlocks('A lone **marker here.', theme)[0]!)).toBe(
      'A lone **marker here.',
    );
    expect(blockText(parseMarkdownBlocks('A lone *marker here.', theme)[0]!)).toBe(
      'A lone *marker here.',
    );
  });

  test('an asterisk with space around it is arithmetic, not emphasis', () => {
    expect(blockText(parseMarkdownBlocks('Multiply 2 * 3 * 4 now.', theme)[0]!)).toBe(
      'Multiply 2 * 3 * 4 now.',
    );
  });

  test('underscores inside a word are kept', () => {
    const blocks = parseMarkdownBlocks('The column verse_id holds it.', theme);
    expect(blockText(blocks[0]!)).toBe('The column verse_id holds it.');
    expect(stylesFor(blocks, 'verse_id')[0]).toBeUndefined();
  });

  test('a single backtick is kept', () => {
    expect(blockText(parseMarkdownBlocks('The ` is a stray.', theme)[0]!)).toBe(
      'The ` is a stray.',
    );
  });

  test('an escaped marker shows the marker', () => {
    const blocks = parseMarkdownBlocks('A literal \\*star\\* stays.', theme);
    expect(blockText(blocks[0]!)).toBe('A literal *star* stays.');
    expect(stylesFor(blocks, 'star')[0]).toBeUndefined();
  });

  test('nothing styled means nothing costs an escape sequence', () => {
    const blocks = parseMarkdownBlocks('Plain prose throughout.', theme);
    for (const token of blocks[0]!.tokens) {
      for (const segment of token.segments) expect(segment.style).toBeUndefined();
    }
  });
});

describe('lists', () => {
  test('an unordered item gets the bullet and indent the HTML path gives it', () => {
    const blocks = parseMarkdownBlocks('- the first sense\n- the second sense', theme);
    expect(blocks).toHaveLength(2);
    for (const block of blocks) {
      expect(block.indent).toBe(2);
      expect(block.bullet).toBe(true);
      expect(block.tokens[0]!.segments[0]!.text).toBe('•');
    }
    expect(blockText(blocks[0]!)).toBe('• the first sense');
  });

  test('an asterisk bullet is the same bullet', () => {
    const blocks = parseMarkdownBlocks('* one\n* two', theme);
    expect(blocks.map(blockText)).toEqual(['• one', '• two']);
  });

  test("an ordered item keeps the author's own number", () => {
    const blocks = parseMarkdownBlocks('3. the third sense\n4) the fourth', theme);
    expect(blocks.map(blockText)).toEqual(['3. the third sense', '4) the fourth']);
    expect(blocks[0]!.bullet).toBe(true);
    expect(blocks[0]!.indent).toBe(2);
  });

  test('a nested item is indented further', () => {
    const blocks = parseMarkdownBlocks('- the sense\n  - the qualification', theme);
    expect(blocks[0]!.indent).toBe(2);
    expect(blocks[1]!.indent).toBe(4);
  });

  test('a continuation line stays part of its item', () => {
    const blocks = parseMarkdownBlocks('- the sense, at length\n  and still the same item', theme);
    expect(blocks).toHaveLength(1);
    expect(blockText(blocks[0]!)).toBe('• the sense, at length and still the same item');
  });

  test('emphasis works inside an item', () => {
    const blocks = parseMarkdownBlocks('- the **first** sense', theme);
    expect(blockText(blocks[0]!)).toBe('• the first sense');
    expect(stylesFor(blocks, 'first')[0]).toEqual({ bold: true });
  });
});

describe('paragraphs', () => {
  test('a blank line ends a paragraph and a single break does not', () => {
    const blocks = parseMarkdownBlocks('First line\nsame paragraph.\n\nSecond paragraph.', theme);
    expect(blocks.map(blockText)).toEqual(['First line same paragraph.', 'Second paragraph.']);
  });

  test('runs of blank lines and trailing whitespace produce no empty blocks', () => {
    const blocks = parseMarkdownBlocks('\n\n  One.  \n\n\n\nTwo.\n\n', theme);
    expect(blocks.map(blockText)).toEqual(['One.', 'Two.']);
  });

  test('entities are decoded as they are on the HTML path', () => {
    const blocks = parseMarkdownBlocks('Faith &amp; works, 2 &lt; 3.', theme);
    expect(blockText(blocks[0]!)).toBe('Faith & works, 2 < 3.');
  });

  test('an entity cannot become a marker', () => {
    const blocks = parseMarkdownBlocks('A star &#42;here&#42; stays a star.', theme);
    expect(blockText(blocks[0]!)).toBe('A star *here* stays a star.');
    expect(stylesFor(blocks, 'here')[0]).toBeUndefined();
  });

  test('empty text yields no blocks', () => {
    expect(parseMarkdownBlocks('', theme)).toEqual([]);
    expect(parseMarkdownBlocks('   \n \n', theme)).toEqual([]);
  });
});

describe('a whole entry', () => {
  const ENTRY = [
    '## John 3:16',
    '',
    'The **love** of God is the spring of the gift, not its consequence.',
    '',
    'Three things are said:',
    '',
    '1. that God *loved*,',
    '2. that he gave,',
    '3. that whoever believes has life.',
    '',
    '### The word rendered *only-begotten*',
    '',
    'It is `monogenes`, used of Isaac in Hebrews 11:17.',
  ].join('\n');

  test('the entry is detected and every part comes through in order', () => {
    expect(looksLikeMarkdown(ENTRY)).toBe(true);

    const blocks = parseMarkdownBlocks(ENTRY, theme);
    expect(blocks.map(blockText)).toEqual([
      'John 3:16',
      'The love of God is the spring of the gift, not its consequence.',
      'Three things are said:',
      '1. that God loved,',
      '2. that he gave,',
      '3. that whoever believes has life.',
      'The word rendered only-begotten',
      'It is monogenes, used of Isaac in Hebrews 11:17.',
    ]);
  });

  test('only the list items are indented', () => {
    const blocks = parseMarkdownBlocks(ENTRY, theme);
    expect(blocks.filter((b) => b.bullet).map((b) => b.indent)).toEqual([2, 2, 2]);
    expect(blocks.filter((b) => !b.bullet).every((b) => b.indent === 0)).toBe(true);
  });

  test('emphasis inside a heading merges with the heading style', () => {
    const blocks = parseMarkdownBlocks(ENTRY, theme);
    expect(stylesFor(blocks, 'only-begotten')[0]).toEqual({
      ...theme.heading,
      ...theme.supplied,
    });
  });
});
