import { describe, it, expect } from 'vitest';
import { resolve } from 'path';
import { parseHymn, parseTimestamp } from '../present/hymns/parseHymn';
import { packSlides, DEFAULT_MAX_CHARS } from '../present/hymns/slides';
import { HymnLibrary } from '../present/hymns/HymnLibrary';
import { attributionFor, type Hymn } from '../../src/present/hymns';

/**
 * The format, the packing, and the real library.
 *
 * The licensing rules are tested as hard as the parsing, because they are the
 * ones with a consequence outside this program: a library that admits a hymn it
 * should not is a legal problem, not a bug.
 */

const AMAZING = `===
id: amazing-grace
title: Amazing Grace
first-line: Amazing grace! how sweet the sound
author: John Newton
text-year: 1779
tune: NEW BRITAIN
composer: trad. American melody
tune-year: 1831
topics: grace, salvation
hymnal: Trinity Hymnal 1990: 460; Baptist Hymnal 1991: 330
copyright: public-domain
===

[verse 1]
Amazing grace! how sweet the sound
That saved a wretch like me!

[verse 2]
'Twas grace that taught my heart to fear,
And grace my fears relieved;
`;

function parsed(source: string): Hymn {
  const result = parseHymn(source);
  if (!result.ok) throw new Error(result.errors.map(e => `line ${e.line}: ${e.message}`).join('; '));
  return result.hymn;
}

/**
 * Put a directive on the first line of verse 1.
 *
 * Targeted at the verse body specifically: the same words appear in the
 * `first-line:` metadata field above it, and a naive replace patches that
 * instead -- which is a test that proves nothing while appearing to pass.
 */
function withDirective(directive: string): string {
  return AMAZING.replace(
    '[verse 1]\nAmazing grace!',
    `[verse 1]\n${directive} Amazing grace!`,
  );
}

function failures(source: string): string[] {
  const result = parseHymn(source);
  expect(result.ok, 'expected a parse failure').toBe(false);
  return result.ok ? [] : result.errors.map(e => e.message);
}

// ---------------------------------------------------------------------------
// The format
// ---------------------------------------------------------------------------

describe('parsing a hymn', () => {
  it('reads the metadata block and the sections', () => {
    const hymn = parsed(AMAZING);
    expect(hymn.id).toBe('amazing-grace');
    expect(hymn.title).toBe('Amazing Grace');
    expect(hymn.author).toBe('John Newton');
    expect(hymn.sections.map(s => s.token)).toEqual(['1', '2']);
    expect(hymn.sections[0].lines.map(l => l.text)).toEqual([
      'Amazing grace! how sweet the sound',
      'That saved a wretch like me!',
    ]);
  });

  it('splits the fields that are lists and leaves the rest alone', () => {
    const hymn = parsed(AMAZING);
    expect(hymn.topics).toEqual(['grace', 'salvation']);
    // A comma in a field nothing knows about is a comma, not a separator.
    expect(hymn.composer).toBe('trad. American melody');
  });

  it('reads hymnal numbers, which is how a congregation asks for a hymn', () => {
    expect(parsed(AMAZING).hymnals).toEqual([
      { hymnal: 'Trinity Hymnal 1990', number: '460' },
      { hymnal: 'Baptist Hymnal 1991', number: '330' },
    ]);
  });

  it('defaults verse-order to every section once, in file order', () => {
    expect(parsed(AMAZING).verseOrder).toEqual(['1', '2']);
  });

  it('keeps a field it does not recognise, and warns', () => {
    // The field set is open on purpose: a parser that drops what it does not
    // know silently destroys a contributor's work.
    const result = parseHymn(AMAZING.replace('topics: grace, salvation', 'mood: reflective'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hymn.fields.mood).toBe('reflective');
    expect(result.warnings[0].message).toContain('mood');
  });

  it('treats a chorus as a refrain', () => {
    const hymn = parsed(AMAZING.replace('[verse 2]', '[chorus]'));
    expect(hymn.sections[1].kind).toBe('refrain');
    expect(hymn.sections[1].token).toBe('R');
  });

  it('blank lines inside the metadata block are cosmetic', () => {
    expect(parsed(AMAZING.replace('author:', '\n\nauthor:')).author).toBe('John Newton');
  });
});

describe('what the parser refuses', () => {
  it('refuses anything not declared public domain', () => {
    // The field exists so this can be refused rather than assumed. It is the
    // whole licensing posture of the library in one check.
    expect(failures(AMAZING.replace('public-domain', '1939 E. M. Bartlett')).join())
      .toContain('public-domain');
    expect(failures(AMAZING.replace('copyright: public-domain\n', '')).join())
      .toContain("Missing required field 'copyright'");
  });

  it('refuses a translation with no translation date', () => {
    // A 1650 German text with a 1963 English translation is not public domain
    // in that translation.
    expect(failures(AMAZING.replace('author:', 'translator: Someone Modern\nauthor:')).join())
      .toContain('translator-year');
  });

  it('refuses an arrangement with no arrangement date', () => {
    expect(failures(AMAZING.replace('author:', 'arranger: Someone Modern\nauthor:')).join())
      .toContain('arrangement-year');
  });

  it('refuses a bracketed directive it does not understand', () => {
    // The old format stripped these, so a file whose timestamps used the wrong
    // syntax silently parsed as having none at all and nobody found out.
    expect(failures(withDirective('[10.3]')).join()).toContain('Unrecognised directive');
  });

  it('refuses a section it does not understand', () => {
    expect(failures(AMAZING.replace('[verse 2]', '[prelude]')).join()).toContain('Unknown section');
  });

  it('refuses a verse-order naming a section that is not there', () => {
    expect(failures(AMAZING.replace('copyright:', 'verse-order: 1 R 2\ncopyright:')).join())
      .toContain("'R'");
  });

  it('refuses timestamps that go backwards', () => {
    const source = withDirective('[T:20.0]')
      .replace('That saved a wretch like me!', '[T:10.0] That saved a wretch like me!');
    expect(failures(source).join()).toContain('backwards');
  });

  it('refuses an id that is not a slug', () => {
    expect(failures(AMAZING.replace('id: amazing-grace', 'id: Amazing Grace')).join())
      .toContain('slug');
  });

  it('refuses a file with no metadata fence', () => {
    expect(failures('[verse 1]\nsome words').join()).toContain('metadata fence');
  });

  it('refuses text before the first section', () => {
    expect(failures(AMAZING.replace('[verse 1]\n', '')).join()).toContain('before the first section');
  });
});

describe('timestamps', () => {
  it('reads seconds and clock time alike', () => {
    expect(parseTimestamp('10.3')).toBeCloseTo(10.3);
    expect(parseTimestamp('1:01.4')).toBeCloseTo(61.4);
    expect(parseTimestamp('0')).toBe(0);
  });

  it('rejects anything else rather than guessing', () => {
    expect(parseTimestamp('soon')).toBeNull();
    expect(parseTimestamp('1:99')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Slides
// ---------------------------------------------------------------------------

function hymnWith(sections: string): Hymn {
  return parsed(`===
id: test-hymn
title: Test
first-line: Test
copyright: public-domain
===
${sections}`);
}

describe('packing slides', () => {
  it('keeps a short stanza whole', () => {
    // A common-metre stanza is about 120 characters, so the expectation a
    // congregation has -- one stanza, one screen -- has to be the default.
    const slides = packSlides(parsed(AMAZING));
    expect(slides).toHaveLength(2);
    expect(slides[0].lines).toHaveLength(2);
    expect(slides[0].label).toBe('Verse 1');
  });

  it('never puts two sections on one slide', () => {
    // A refrain sharing a screen with the end of a verse is wrong however well
    // it fits.
    const hymn = hymnWith(`
[verse 1]
short
[refrain]
also short
`);
    const slides = packSlides(hymn);
    expect(slides).toHaveLength(2);
    expect(slides.map(s => s.kind)).toEqual(['verse', 'refrain']);
  });

  it('expands verse-order, so a refrain is written once and sung between verses', () => {
    const hymn = hymnWith(`
[verse 1]
first verse
[refrain]
the refrain
[verse 2]
second verse
`);
    const slides = packSlides(hymn, ['1', 'R', '2', 'R']);
    expect(slides.map(s => s.token)).toEqual(['1', 'R', '2', 'R']);
  });

  it('splits a long stanza rather than overflowing one slide', () => {
    const long = Array.from({ length: 12 }, (_, i) => `Line ${i} ${'x'.repeat(40)}`).join('\n');
    const slides = packSlides(hymnWith(`\n[verse 1]\n${long}\n`));
    expect(slides.length).toBeGreaterThan(1);
    for (const slide of slides) {
      expect(slide.lines.join('').length).toBeLessThanOrEqual(DEFAULT_MAX_CHARS);
    }
  });

  it('never strands a single line on the last slide', () => {
    // The rule that only exists because someone watched it look wrong in a real
    // service. It gives a line back from the previous slide instead.
    const lines = Array.from({ length: 7 }, () => 'x'.repeat(45)).join('\n');
    const slides = packSlides(hymnWith(`\n[verse 1]\n${lines}\n`));
    expect(slides.length).toBeGreaterThan(1);
    expect(slides[slides.length - 1].lines.length).toBeGreaterThan(1);
  });

  it('never leaves a slide with a single line to avoid one elsewhere', () => {
    // The original could do exactly that: it moved the orphan rather than
    // removing it.
    const lines = Array.from({ length: 9 }, () => 'x'.repeat(50)).join('\n');
    const slides = packSlides(hymnWith(`\n[verse 1]\n${lines}\n`));
    const singles = slides.filter(s => s.lines.length === 1);
    expect(singles).toHaveLength(0);
  });

  it('loses no lines and reorders none', () => {
    const hymn = parsed(AMAZING);
    const flat = packSlides(hymn).flatMap(s => s.lines);
    expect(flat).toEqual(hymn.sections.flatMap(s => s.lines.map(l => l.text)));
  });

  it('brings the audio cue forward, so words arrive before they are sung', () => {
    const slides = packSlides(parsed(withDirective('[T:10.0]')));
    expect(slides[0].at).toBe(8);
  });

  it('never gives a slide a negative cue', () => {
    expect(packSlides(parsed(withDirective('[T:0.5]')))[0].at).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

describe('attribution', () => {
  it('credits the text and the tune separately', () => {
    // They are separate works with separate authors, dates and copyright
    // status; collapsing them is how a modern arrangement of an old tune gets
    // mistaken for public domain.
    expect(attributionFor(parsed(AMAZING)))
      .toBe('John Newton, 1779 · NEW BRITAIN, trad. American melody, 1831');
  });

  it('names a translator when there is one', () => {
    const hymn = parsed(AMAZING.replace(
      'author:', 'translator: Frederick H. Hedge\ntranslator-year: 1853\nauthor:',
    ));
    expect(attributionFor(hymn)).toContain('tr. Frederick H. Hedge, 1853');
  });
});

// ---------------------------------------------------------------------------
// The real library
// ---------------------------------------------------------------------------

describe('the seed library', () => {
  const library = new HymnLibrary();
  const report = library.load(resolve(__dirname, '../../../../hymns'));

  it('parses every hymn in the repository', () => {
    // These are real files, not fixtures. If one of them stops parsing, a
    // presenter finds out on a Sunday.
    expect(report.failed).toEqual([]);
    expect(report.loaded).toBeGreaterThan(0);
  });

  it('parses every hymn without a warning', () => {
    expect(report.warnings).toEqual([]);
  });

  it('finds a hymn by title, first line, and hymnal number alike', () => {
    // The four ways a person actually asks for a hymn.
    expect(library.search('amazing grace').hymns[0]?.id).toBe('amazing-grace');
    expect(library.search('how sweet the sound').hymns[0]?.id).toBe('amazing-grace');
    expect(library.search('460').hymns[0]?.id).toBe('amazing-grace');
  });

  it('ranks an exact title above a passing mention', () => {
    const results = library.search('jesus').hymns;
    expect(results.length).toBeGreaterThan(1);
  });

  it('browses the whole library when nothing is typed', () => {
    expect(library.all().total).toBe(report.loaded);
  });

  it('packs a refrain between every verse where the file says so', () => {
    const detail = library.detail('it-is-well-with-my-soul');
    expect(detail).not.toBeNull();
    expect(detail!.slides.filter(s => s.kind === 'refrain')).toHaveLength(4);
    expect(detail!.attribution).toContain('Horatio G. Spafford');
  });

  it('knows how many slides a hymn makes, which is what `next` runs out of', () => {
    const detail = library.detail('amazing-grace')!;
    expect(library.slideCount('amazing-grace')).toBe(detail.slides.length);
    expect(library.slideCount('not-a-hymn')).toBeNull();
  });

  it('honours a verse order the presenter chose', () => {
    // Singing only verses one and four is entirely ordinary.
    const detail = library.detail('amazing-grace', ['1', '4'])!;
    expect(detail.slides.map(s => s.token)).toEqual(['1', '4']);
  });
});
