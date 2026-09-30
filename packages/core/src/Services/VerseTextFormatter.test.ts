/**
 * Tests for the pure verse-formatting engine, `formatVerseFields`, in its
 * raw-text + snake_case-payload form: the shape the web client's offline
 * (OPFS/wa-sqlite) read path feeds it. Moved here from
 * `apps/web/src/offline/verseFormatting.test.ts` when that hand-copy of core's
 * formatter was deleted; `VerseFormatter.test.ts` covers the `BibleVerse`
 * adapter. Both copies of the formatter pinned the same behaviour, so a
 * regression on either read path fails here.
 */
import { describe, it, expect } from 'vitest';
import { formatVerseFields, hasWordsOfChrist, getFootnotes } from './VerseTextFormatter';

describe('formatVerseFields — section headings', () => {
  const heading = (raw: string) => formatVerseFields('body text', { sectionHeading: raw }).sectionHeading;

  it('strips SWORD word tags, keeping the words and their spacing', () => {
    expect(
      heading(
        '<w lemma="strong:H05329" morph="strongMorph:TH8764">To the chief Musician</w> ' +
          '<w lemma="strong:H05058">on Neginoth</w>, <w lemma="strong:H04210">A Psalm</w> ' +
          '<w lemma="strong:H01732">of David</w>.',
      ),
    ).toBe('To the chief Musician on Neginoth, A Psalm of David.');
  });

  it('strips SWORD markup from the Psalm 3 heading', () => {
    expect(
      heading(
        '<w lemma="strong:H04210">A Psalm</w> <w lemma="strong:H01732">of David</w>, ' +
          '<w lemma="strong:H01272" morph="strongMorph:TH8800">when he fled</w> ' +
          '<w lemma="strong:H06440">from</w> <w lemma="strong:H053">Absalom</w> ' +
          '<w lemma="strong:H01121">his son</w>.',
      ),
    ).toBe('A Psalm of David, when he fled from Absalom his son.');
  });

  it('leaves an already-plain heading alone', () => {
    expect(heading('A Psalm of David.')).toBe('A Psalm of David.');
  });

  it('reports no heading rather than an empty one', () => {
    // A heading of '' or pure markup would render an empty heading row above
    // the verse, so both collapse to undefined.
    expect(heading('')).toBeUndefined();
    expect(heading('<w lemma="strong:H1"></w>')).toBeUndefined();
    expect(formatVerseFields('body text', undefined).sectionHeading).toBeUndefined();
  });

  it('accepts the snake_case spelling the module DBs actually store', () => {
    expect(formatVerseFields('body', { section_heading: 'A Psalm' }).sectionHeading).toBe('A Psalm');
  });
});

describe('formatVerseFields — paragraph starts', () => {
  it('treats a pilcrow as a paragraph start and removes it from the text', () => {
    const { textHtml, isParagraphStart } = formatVerseFields('¶ In the beginning', undefined);
    expect(isParagraphStart).toBe(true);
    expect(textHtml).not.toContain('¶');
  });

  it('reads the flag from formatting data in either spelling', () => {
    expect(formatVerseFields('text', { paragraphStart: true }).isParagraphStart).toBe(true);
    expect(formatVerseFields('text', { paragraph_start: true }).isParagraphStart).toBe(true);
  });

  it('is not a paragraph start by default', () => {
    expect(formatVerseFields('text', undefined).isParagraphStart).toBe(false);
  });
});

describe('formatVerseFields — OSIS markup', () => {
  it('strips OSIS tags that have no HTML equivalent', () => {
    const { textHtml } = formatVerseFields('the <transChange type="added">word</transChange> of God', undefined);
    expect(textHtml).toBe('the word of God');
  });

  it('strips legacy <font> wrappers left by older module conversions', () => {
    const { textHtml } = formatVerseFields('<font color="red">Jesus wept</font>', undefined);
    expect(textHtml).toBe('Jesus wept');
  });

  // The heading path stripped <w> from the start; the verse-body path did not,
  // because this file's OSIS alternation had drifted from core's by exactly
  // that one tag. <w> is the most common tag in a SWORD module, so offline
  // readers saw raw markup on ordinary verses while online readers did not —
  // the precise "looks different offline" failure this file exists to prevent.
  it('strips SWORD word tags from the verse body, not just from headings', () => {
    const { textHtml } = formatVerseFields(
      '<w lemma="strong:G2424">Jesus</w> <w lemma="strong:G1145">wept</w>.',
      undefined,
    );
    expect(textHtml).toBe('Jesus wept.');
  });
});

describe('formatVerseFields — words of Christ', () => {
  it('wraps the indexed word range and nothing else', () => {
    const { textHtml } = formatVerseFields('He said I am the way', {
      wordsOfChrist: [{ start: 2, end: 5 }],
    });
    expect(textHtml).toBe('He said <span class="christ-words">I am the way</span>');
  });

  it('accepts the snake_case spelling', () => {
    const { textHtml } = formatVerseFields('He said peace', { words_of_christ: [{ start: 2, end: 2 }] });
    expect(textHtml).toContain('<span class="christ-words">peace</span>');
  });

  it('ignores ranges that run past the end of the verse', () => {
    // Word indices come from the module DB and can outlive a text correction.
    const { textHtml } = formatVerseFields('two words', { wordsOfChrist: [{ start: 0, end: 99 }] });
    expect(textHtml).toBe('<span class="christ-words">two words</span>');
  });

  it('leaves the text untouched when the range list is empty', () => {
    expect(formatVerseFields('plain text', { wordsOfChrist: [] }).textHtml).toBe('plain text');
  });
});

describe('formatVerseFields — divine name', () => {
  it('renders a v2 divine_name span in initial-capital form', () => {
    // Module format v2 carries the Tetragrammaton as a word-index span, not a
    // <divineName> tag — this is the path that actually runs for current
    // modules. Capitalization is baked in because the small-caps CSS cannot do
    // it (see toDivineNameCase).
    const { textHtml } = formatVerseFields('the LORD is my shepherd', {
      divineName: [{ start: 1, end: 1 }],
    });
    expect(textHtml).toBe('the <span class="divine-name">Lord</span> is my shepherd');
  });

  it('still handles the legacy <divineName> tag', () => {
    const { textHtml } = formatVerseFields('the <divineName>LORD</divineName> is good', undefined);
    expect(textHtml).toBe('the <span class="divine-name">Lord</span> is good');
  });

  it('nests inside words of Christ rather than producing crossed tags', () => {
    // Both span types index the same word sequence, so an overlap has to nest
    // legally or the browser silently repairs it into something else.
    const { textHtml } = formatVerseFields('I am the LORD your God', {
      wordsOfChrist: [{ start: 0, end: 5 }],
      divineName: [{ start: 3, end: 3 }],
    });
    expect(textHtml).toBe(
      '<span class="christ-words">I am the <span class="divine-name">Lord</span> your God</span>',
    );
  });
});

describe('formatVerseFields - punctuation and heading override', () => {
  // Core's formatter collapsed the gap a stripped tag leaves before trailing
  // punctuation; the web copy never had this. Adopting core's version fixes the
  // offline path: `them .` no longer lets the period wrap onto its own line.
  it('collapses the space left before trailing punctuation after a span rebuild', () => {
    const { textHtml } = formatVerseFields('Bless them<i></i>.', { wordsOfChrist: [{ start: 0, end: 5 }] });
    expect(textHtml).toBe('<span class="christ-words">Bless them.</span>');
  });

  it('lets an explicit heading override the payload heading', () => {
    expect(formatVerseFields('text', { sectionHeading: 'old' }, 'new').sectionHeading).toBe('new');
    expect(formatVerseFields('text', { sectionHeading: 'kept' }, undefined).sectionHeading).toBe('kept');
  });
});

describe('formatting-data accessors', () => {
  it('reports words of Christ from either spelling, and their absence', () => {
    expect(hasWordsOfChrist({ wordsOfChrist: [{ start: 0, end: 1 }] })).toBe(true);
    expect(hasWordsOfChrist({ words_of_christ: [{ start: 0, end: 1 }] })).toBe(true);
    expect(hasWordsOfChrist({ wordsOfChrist: [] })).toBe(false);
    expect(hasWordsOfChrist(undefined)).toBe(false);
  });

  it('returns an empty footnote list rather than undefined', () => {
    expect(getFootnotes(undefined)).toEqual([]);
    const notes = [{ position: 3, marker: 'a', text: 'Or: kindness' }];
    expect(getFootnotes({ footnotes: notes })).toEqual(notes);
  });
});
