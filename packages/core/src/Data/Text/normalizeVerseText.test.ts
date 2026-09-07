import { describe, it, expect } from 'vitest';
import { normalizeVerseText, mergeSpans } from './normalizeVerseText';
import {
  parseVerseFormatting,
  splitVerseWords,
  stringifyVerseFormatting,
  VERSE_FORMATTING_VERSION,
  type VerseSpan,
} from './VerseFormatting';

/**
 * Every `raw` / `legacy` string below was extracted verbatim (read-only) from a
 * shipped module database in `apps/desktop/data/modules/`, so the tests
 * exercise the data that actually exists rather than invented markup.
 */
interface Fixture {
  readonly name: string;
  readonly module: string;
  readonly verseId: number;
  readonly raw: string;
  readonly legacy: string;
}

const FIXTURES: readonly Fixture[] = [
  {
    name: 'Psalm 23:1 — divine name + supplied word',
    module: 'bible_kjv.db',
    verseId: 19023001,
    raw: 'The L<font size="-1">ORD</font> <i>is</i> my shepherd; I shall not want.',
    legacy: '{"paragraph_start":false,"added_words":[{"start":3,"end":3}]}',
  },
  {
    name: 'John 3:16 — red letter + pilcrow',
    module: 'bible_kjv.db',
    verseId: 43003016,
    raw:
      '<font color="red"> ¶For God so loved the world, that he gave his only begotten Son, ' +
      'that whosoever believeth in him should not perish, but have everlasting life.</font> ',
    legacy: '{"paragraph_start":false,"words_of_christ":[{"start":0,"end":24}]}',
  },
  {
    name: 'Matthew 6:9 — red letter, no pilcrow',
    module: 'bible_kjv.db',
    verseId: 40006009,
    raw:
      '<font color="red"> After this manner therefore pray ye: Our Father which art in heaven, ' +
      'Hallowed be thy name.</font> ',
    legacy: '{"paragraph_start":false,"words_of_christ":[{"start":0,"end":15}]}',
  },
  {
    name: 'Psalm 22:1 — two disjoint supplied runs',
    module: 'bible_kjv.db',
    verseId: 19022001,
    raw:
      'My God, my God, why hast thou forsaken me? <i>why art thou so</i> far from helping me, ' +
      '<i>and from</i> the words of my roaring?',
    legacy: '{"paragraph_start":false,"added_words":[{"start":9,"end":12},{"start":17,"end":18}]}',
  },
  {
    name: 'Matthew 22:44 — divine name nested inside red letter',
    module: 'bible_kjv.db',
    verseId: 40022044,
    raw:
      '<font color="red"> The L<font size="-1">ORD</font> said unto my Lord, Sit thou on my ' +
      'right hand, till I make thine enemies thy footstool?</font> ',
    legacy: '{"paragraph_start":false,"words_of_christ":[{"start":0,"end":2}]}',
  },
  {
    name: 'Genesis 1:6 — leading pilcrow, no tags',
    module: 'bible_kjv.db',
    verseId: 1001006,
    raw:
      '¶And God said, Let there be a firmament in the midst of the waters, and let it divide ' +
      'the waters from the waters.',
    legacy: '{"paragraph_start":false}',
  },
  {
    name: 'Genesis 1:9 (PCE) — detached pilcrow token shifts legacy offsets',
    module: 'bible_kjvpce.db',
    verseId: 1001009,
    raw:
      '¶ And God said, Let the waters under the heaven be gathered together unto one place, ' +
      'and let the dry <i>land</i> appear: and it was so.',
    legacy: '{"paragraph_start":false,"added_words":[{"start":20,"end":20}]}',
  },
  {
    name: 'Revelation 22:21 — trailing whitespace',
    module: 'bible_kjv.db',
    verseId: 66022021,
    raw: 'The grace of our Lord Jesus Christ <i>be</i> with you all. Amen.   ',
    legacy: '{"paragraph_start":false,"added_words":[{"start":7,"end":7}]}',
  },
  {
    name: 'Psalm 6:1 (NET) — italics nested inside italics',
    module: 'bible_netfree.db',
    verseId: 19006001,
    raw:
      '<i>For the music director, to be accompanied by stringed instruments, according to the ' +
      '<i>sheminith</i> style; a psalm of David.</i><br />L<font size="-1">ORD</font>, do not ' +
      'rebuke me in your anger! <br />Do not discipline me in your raging fury! <br />',
    legacy: '{"paragraph_start":false,"added_words":[{"start":13,"end":13},{"start":0,"end":18}]}',
  },
  {
    name: 'Matthew 5:3 (Twentieth Century) — red letter split by a line break',
    module: 'bible_twenty.db',
    verseId: 40005003,
    raw:
      '<font color="red"> “Blessed are the poor in spirit, </font>  <br /> <font color="red"> ' +
      'for theirs is the Kingdom of Heaven.</font>  <br /> ',
    legacy: '{"paragraph_start":false,"words_of_christ":[{"start":0,"end":5},{"start":6,"end":12}]}',
  },
  {
    name: 'Genesis 2:14 (BSB) — unbalanced list tags',
    module: 'bible_bsb.db',
    verseId: 1002014,
    raw:
      'The name of the third river is Hiddekel; it runs along the east side of Assyria.</li> ' +
      '</ul> <ul> <li>And the fourth river is the Euphrates. </li> </ul>',
    legacy: '{"paragraph_start":false}',
  },
  {
    name: 'Genesis 1:5 (BSB) — SWORD paragraph pseudo-tags mid-verse',
    module: 'bible_bsb.db',
    verseId: 1001005,
    raw:
      'God called the light “day,” and the darkness He called “night.”<!/P><br /><!P><br /> ' +
      'And there was evening, and there was morning—the first day. <!/P><br />',
    legacy: '{"paragraph_start":false}',
  },
  {
    name: 'Matthew 1:23 (Weymouth) — <cite> quotation',
    module: 'bible_weymouth.db',
    verseId: 40001023,
    raw:
      '<cite>"Mark! The maiden will be with child and will give birth to a son, and they will ' +
      'call His name Immanuel"</cite> --a word which signifies <cite>`God with us\'</cite>.',
    legacy: '{"paragraph_start":false}',
  },
  {
    name: 'Genesis 16:13 (RNKJV) — Hebrew divine name + dropped footnote marker',
    module: 'bible_rnkjv.db',
    verseId: 1016013,
    raw:
      'And she called the name of י<font size="-1">הוה</font> that spake unto her, Thou Elroi' +
      '<a href="passagestudy.jsp?action=showNote&type=n&value=&module=RNKJV&passage=Genesis+16%3A13">' +
      '<small><sup class="n">*n</sup></small></a>: for she said, Have I also here looked after ' +
      'him that seeth me?',
    legacy: '{"paragraph_start":false}',
  },
  {
    name: 'Matthew 12:50 (RNKJV) — stray &gt; entity',
    module: 'bible_rnkjv.db',
    verseId: 40012050,
    raw:
      'For whosoever shall do the will of my Father which is in heaven, the same is my brother, ' +
      'and sister, and mother. face="Times New Roman"&gt;  ',
    legacy: '{"paragraph_start":false}',
  },
  {
    name: 'Revelation 19:16 (ISV) — <small> small caps, deliberately unmapped',
    module: 'bible_isv.db',
    verseId: 66019016,
    raw:
      'On his robe and his thigh he has a name written:<br />K<small>ING OF</small> ' +
      'K<small>INGS AND</small> L<small>ORD OF</small> L<small>ORDS</small>.<br />',
    legacy: '{"paragraph_start":false}',
  },
  {
    name: 'Genesis 1:8 (ABP) — <sup> word-order numerals kept',
    module: 'bible_abp.db',
    verseId: 1001008,
    raw:
      'And God called the firmament, Heaven. And God beheld that <i>it was</i> good; and there ' +
      'was evening and there was morning, [<sup>2</sup>day <sup>1</sup><i>the</i> second].',
    legacy: '{"paragraph_start":false,"added_words":[{"start":10,"end":11},{"start":25,"end":25}]}',
  },
  {
    name: 'Psalm 92:1 (LITV) — adjacent italic runs',
    module: 'bible_litv.db',
    verseId: 19092001,
    raw:
      '<i> A Psalm, A Song for the Sabbath Day.</i> <i>It is</i> good to give thanks to Jehovah, ' +
      'and to sing praises to Your name, O Most High;',
    legacy: '{"paragraph_start":false,"added_words":[{"start":0,"end":7},{"start":8,"end":9}]}',
  },
  {
    name: 'Genesis 48:22 (Darby) — <b> emphasis',
    module: 'bible_darby.db',
    verseId: 1048022,
    raw:
      'And <b>I</b> have given to thee one tract [of land] above thy brethren, which I took out ' +
      'of the hand of the Amorite with my sword and with my bow.   <!/P><br />',
    legacy: '{"paragraph_start":false}',
  },
  {
    name: 'John 11:35 — no markup at all',
    module: 'bible_kjv.db',
    verseId: 43011035,
    raw: 'Jesus wept.',
    legacy: '{"paragraph_start":false}',
  },
];

function fixture(name: string): Fixture {
  const found = FIXTURES.find((f) => f.name === name);
  if (found === undefined) {
    throw new Error(`Unknown fixture: ${name}`);
  }
  return found;
}

function spanWords(text: string, span: VerseSpan): string {
  return splitVerseWords(text).slice(span.start, span.end + 1).join(' ');
}

function spansOfType(spans: readonly VerseSpan[] | undefined, type: string): VerseSpan[] {
  return (spans ?? []).filter((s) => s.type === type);
}

// ---------------------------------------------------------------------------

describe('normalizeVerseText — the worked Psalm 23:1 example', () => {
  const f = fixture('Psalm 23:1 — divine name + supplied word');

  it('produces the clean text from the spec', () => {
    expect(normalizeVerseText(f.raw, f.legacy).text).toBe(
      'The LORD is my shepherd; I shall not want.'
    );
  });

  it('produces exactly the spans from the spec (0-based, inclusive)', () => {
    const { formatting } = normalizeVerseText(f.raw, f.legacy);
    expect(formatting.v).toBe(VERSE_FORMATTING_VERSION);
    expect(formatting.spans).toEqual([
      { type: 'divine_name', start: 1, end: 1 },
      { type: 'supplied', start: 2, end: 2 },
    ]);
  });

  it('lands the spans on the words they claim', () => {
    const { text, formatting } = normalizeVerseText(f.raw, f.legacy);
    const spans = formatting.spans ?? [];
    expect(spanWords(text, spans[0] as VerseSpan)).toBe('LORD');
    expect(spanWords(text, spans[1] as VerseSpan)).toBe('is');
  });

  it('converts the legacy offset 3 to 2 rather than shifting by a constant', () => {
    // The legacy value is 0-based over tags-replaced-by-space tokens
    // (The | L | ORD | is), not 1-based over rendered words.
    const withLegacy = normalizeVerseText(f.raw, f.legacy);
    const withoutLegacy = normalizeVerseText(f.raw);
    expect(withLegacy.formatting).toEqual(withoutLegacy.formatting);
  });

  it('emits no block when the verse does not start a paragraph', () => {
    expect(normalizeVerseText(f.raw, f.legacy).formatting.block).toBeUndefined();
  });
});

describe('normalizeVerseText — the John 3:16 red-letter case', () => {
  const f = fixture('John 3:16 — red letter + pilcrow');

  it('strips the pilcrow and the leading whitespace from the text', () => {
    const { text } = normalizeVerseText(f.raw, f.legacy);
    expect(text.startsWith('For God so loved the world')).toBe(true);
    expect(text).not.toContain('¶');
    expect(text.endsWith('everlasting life.')).toBe(true);
  });

  it('records the pilcrow as block.paragraph_start', () => {
    const { formatting } = normalizeVerseText(f.raw, f.legacy);
    expect(formatting.block).toEqual({ paragraph_start: true });
  });

  it('covers all 25 words with a single words_of_christ span', () => {
    const { text, formatting } = normalizeVerseText(f.raw, f.legacy);
    expect(splitVerseWords(text).length).toBe(25);
    expect(formatting.spans).toEqual([{ type: 'words_of_christ', start: 0, end: 24 }]);
  });

  it('agrees with the legacy 0..24 offsets', () => {
    expect(normalizeVerseText(f.raw, f.legacy).formatting).toEqual(
      normalizeVerseText(f.raw).formatting
    );
  });
});

describe('normalizeVerseText — paragraph detection', () => {
  it('sets paragraph_start for a verse-initial pilcrow', () => {
    const f = fixture('Genesis 1:6 — leading pilcrow, no tags');
    const { text, formatting } = normalizeVerseText(f.raw, f.legacy);
    expect(text.startsWith('And God said,')).toBe(true);
    expect(formatting.block).toEqual({ paragraph_start: true });
  });

  it('sets paragraph_start for a detached pilcrow token (KJV PCE spelling)', () => {
    const f = fixture('Genesis 1:9 (PCE) — detached pilcrow token shifts legacy offsets');
    const { text, formatting } = normalizeVerseText(f.raw, f.legacy);
    expect(text.startsWith('And God said,')).toBe(true);
    expect(formatting.block).toEqual({ paragraph_start: true });
  });

  it('maps the PCE legacy offset 20 onto the word "land"', () => {
    const f = fixture('Genesis 1:9 (PCE) — detached pilcrow token shifts legacy offsets');
    const { text, formatting } = normalizeVerseText(f.raw, f.legacy);
    const supplied = spansOfType(formatting.spans, 'supplied');
    expect(supplied).toHaveLength(1);
    expect(spanWords(text, supplied[0] as VerseSpan)).toBe('land');
  });

  it('ignores a mid-verse SWORD paragraph pseudo-tag', () => {
    const f = fixture('Genesis 1:5 (BSB) — SWORD paragraph pseudo-tags mid-verse');
    const { text, formatting } = normalizeVerseText(f.raw, f.legacy);
    expect(formatting.block).toBeUndefined();
    expect(text).toBe(
      'God called the light “day,” and the darkness He called “night.” ' +
        'And there was evening, and there was morning—the first day.'
    );
  });
});

describe('normalizeVerseText — multiple and disjoint runs', () => {
  it('keeps two disjoint supplied runs separate (Psalm 22:1)', () => {
    const f = fixture('Psalm 22:1 — two disjoint supplied runs');
    const { text, formatting } = normalizeVerseText(f.raw, f.legacy);
    expect(formatting.spans).toEqual([
      { type: 'supplied', start: 9, end: 12 },
      { type: 'supplied', start: 17, end: 18 },
    ]);
    const spans = formatting.spans ?? [];
    expect(spanWords(text, spans[0] as VerseSpan)).toBe('why art thou so');
    expect(spanWords(text, spans[1] as VerseSpan)).toBe('and from');
  });

  it('merges adjacent red-letter runs split by a line break (Matthew 5:3)', () => {
    const f = fixture('Matthew 5:3 (Twentieth Century) — red letter split by a line break');
    const { text, formatting } = normalizeVerseText(f.raw, f.legacy);
    expect(splitVerseWords(text).length).toBe(13);
    expect(formatting.spans).toEqual([{ type: 'words_of_christ', start: 0, end: 12 }]);
  });

  it('merges adjacent italic runs (Psalm 92:1)', () => {
    const f = fixture('Psalm 92:1 (LITV) — adjacent italic runs');
    const { formatting } = normalizeVerseText(f.raw, f.legacy);
    expect(spansOfType(formatting.spans, 'supplied')).toEqual([
      { type: 'supplied', start: 0, end: 9 },
    ]);
  });
});

describe('normalizeVerseText — nesting and overlap', () => {
  it('flattens italics nested inside italics into the outer range (Psalm 6:1 NET)', () => {
    const f = fixture('Psalm 6:1 (NET) — italics nested inside italics');
    const { text, formatting } = normalizeVerseText(f.raw, f.legacy);
    const supplied = spansOfType(formatting.spans, 'supplied');
    expect(supplied).toEqual([{ type: 'supplied', start: 0, end: 18 }]);
    expect(spanWords(text, supplied[0] as VerseSpan).endsWith('psalm of David.')).toBe(true);

    const divine = spansOfType(formatting.spans, 'divine_name');
    expect(divine).toHaveLength(1);
    expect(spanWords(text, divine[0] as VerseSpan)).toBe('LORD,');
  });

  it('closes the inner <font> correctly when nested in a red-letter run (Matthew 22:44)', () => {
    const f = fixture('Matthew 22:44 — divine name nested inside red letter');
    const { text, formatting } = normalizeVerseText(f.raw, f.legacy);
    const words = splitVerseWords(text);
    expect(words.length).toBe(19);

    // The legacy converter mis-closed the outer <font> on the inner </font> and
    // recorded only words 0..2. The HTML is authoritative, so the whole verse is red.
    expect(spansOfType(formatting.spans, 'words_of_christ')).toEqual([
      { type: 'words_of_christ', start: 0, end: 18 },
    ]);
    const divine = spansOfType(formatting.spans, 'divine_name');
    expect(spanWords(text, divine[0] as VerseSpan)).toBe('LORD');
  });

  it('keeps overlapping spans of different types independent', () => {
    const { formatting } = normalizeVerseText(
      '<font color="red">Go <i>ye</i> therefore</font>'
    );
    expect(formatting.spans).toEqual([
      { type: 'words_of_christ', start: 0, end: 2 },
      { type: 'supplied', start: 1, end: 1 },
    ]);
  });
});

describe('normalizeVerseText — malformed markup', () => {
  it('extends an unclosed tag to the end of the verse', () => {
    const { text, formatting } = normalizeVerseText('The <i>LORD is my shepherd');
    expect(text).toBe('The LORD is my shepherd');
    expect(formatting.spans).toEqual([{ type: 'supplied', start: 1, end: 4 }]);
  });

  it('ignores close tags with no matching open tag', () => {
    const f = fixture('Genesis 2:14 (BSB) — unbalanced list tags');
    const { text, formatting } = normalizeVerseText(f.raw, f.legacy);
    expect(text).toBe(
      'The name of the third river is Hiddekel; it runs along the east side of Assyria. ' +
        'And the fourth river is the Euphrates.'
    );
    expect(formatting.spans).toBeUndefined();
  });

  it('drops an empty tag pair rather than emitting a zero-width span', () => {
    const { text, formatting } = normalizeVerseText('Jesus <i></i>wept.');
    expect(text).toBe('Jesus wept.');
    expect(formatting.spans).toBeUndefined();
  });

  it('survives a tag-only input', () => {
    const { text, formatting } = normalizeVerseText('<i></i><br /><!P>');
    expect(text).toBe('');
    expect(formatting).toEqual({ v: VERSE_FORMATTING_VERSION, block: { paragraph_start: true } });
  });

  it('survives an empty string', () => {
    expect(normalizeVerseText('')).toEqual({
      text: '',
      formatting: { v: VERSE_FORMATTING_VERSION },
    });
  });
});

describe('normalizeVerseText — entities', () => {
  it('decodes the stray &gt; found in RNKJV Matthew 12:50', () => {
    const f = fixture('Matthew 12:50 (RNKJV) — stray &gt; entity');
    const { text } = normalizeVerseText(f.raw, f.legacy);
    expect(text.endsWith('face="Times New Roman">')).toBe(true);
    expect(text).not.toContain('&gt;');
  });

  it('decodes named, decimal and hex entities', () => {
    const { text } = normalizeVerseText('Jacob &amp; Esau &#8212; &lt;brothers&gt; &#x2019;s');
    expect(text).toBe('Jacob & Esau — <brothers> ’s');
  });

  it('does not double-decode', () => {
    expect(normalizeVerseText('&amp;lt;').text).toBe('&lt;');
  });

  it('leaves an unknown entity alone', () => {
    expect(normalizeVerseText('a &notarealentity; b').text).toBe('a &notarealentity; b');
  });
});

describe('normalizeVerseText — tag inventory coverage', () => {
  it('maps <cite> to quotation (Weymouth Matthew 1:23)', () => {
    const f = fixture('Matthew 1:23 (Weymouth) — <cite> quotation');
    const { text, formatting } = normalizeVerseText(f.raw, f.legacy);
    const quotes = spansOfType(formatting.spans, 'quotation');
    expect(quotes).toHaveLength(2);
    expect(spanWords(text, quotes[0] as VerseSpan).startsWith('"Mark!')).toBe(true);
    // The trailing full stop is glued to the last word, so the span covers it.
    expect(spanWords(text, quotes[1] as VerseSpan)).toBe("`God with us'.");
  });

  it('maps <b> to emphasis (Darby Genesis 48:22)', () => {
    const f = fixture('Genesis 48:22 (Darby) — <b> emphasis');
    const { text, formatting } = normalizeVerseText(f.raw, f.legacy);
    expect(spansOfType(formatting.spans, 'emphasis')).toEqual([
      { type: 'emphasis', start: 1, end: 1 },
    ]);
    expect(spanWords(text, (formatting.spans ?? [])[0] as VerseSpan)).toBe('I');
  });

  it('recognises a Hebrew divine name and drops the footnote marker (RNKJV Genesis 16:13)', () => {
    const f = fixture('Genesis 16:13 (RNKJV) — Hebrew divine name + dropped footnote marker');
    const { text, formatting } = normalizeVerseText(f.raw, f.legacy);
    expect(text).toContain('Thou Elroi: for she said');
    expect(text).not.toContain('*n');
    const divine = spansOfType(formatting.spans, 'divine_name');
    expect(divine).toHaveLength(1);
    expect(spanWords(text, divine[0] as VerseSpan)).toBe('יהוה');
  });

  it('leaves <small> unmapped but keeps its text (ISV Revelation 19:16)', () => {
    const f = fixture('Revelation 19:16 (ISV) — <small> small caps, deliberately unmapped');
    const { text, formatting } = normalizeVerseText(f.raw, f.legacy);
    expect(text).toBe(
      'On his robe and his thigh he has a name written: KING OF KINGS AND LORD OF LORDS.'
    );
    expect(formatting.spans).toBeUndefined();
  });

  it('keeps <sup> word-order numerals as text (ABP Genesis 1:8)', () => {
    const f = fixture('Genesis 1:8 (ABP) — <sup> word-order numerals kept');
    const { text, formatting } = normalizeVerseText(f.raw, f.legacy);
    expect(text).toContain('[2day 1the second].');
    expect(spansOfType(formatting.spans, 'supplied').length).toBeGreaterThan(0);
  });

  it('treats <br /> as whitespace, never as a word', () => {
    const { text } = normalizeVerseText('line one<br />line two<br /> line three');
    expect(text).toBe('line one line two line three');
  });
});

describe('normalizeVerseText — legacy formatting_data input handling', () => {
  const f = fixture('Psalm 23:1 — divine name + supplied word');

  it('accepts an already-parsed object', () => {
    const asObject = normalizeVerseText(f.raw, {
      paragraph_start: false,
      added_words: [{ start: 3, end: 3 }],
    });
    expect(asObject).toEqual(normalizeVerseText(f.raw, f.legacy));
  });

  it('honours legacy paragraph_start: true', () => {
    const { formatting } = normalizeVerseText('And God said.', '{"paragraph_start":true}');
    expect(formatting.block).toEqual({ paragraph_start: true });
  });

  it('ignores undefined, null, empty and malformed input', () => {
    const baseline = normalizeVerseText(f.raw);
    expect(normalizeVerseText(f.raw, undefined)).toEqual(baseline);
    expect(normalizeVerseText(f.raw, null)).toEqual(baseline);
    expect(normalizeVerseText(f.raw, '')).toEqual(baseline);
    expect(normalizeVerseText(f.raw, 'not json at all')).toEqual(baseline);
    expect(normalizeVerseText(f.raw, '{"added_words":"nope"}')).toEqual(baseline);
    expect(normalizeVerseText(f.raw, '{"added_words":[{"start":-1,"end":2}]}')).toEqual(baseline);
    expect(normalizeVerseText(f.raw, '{"added_words":[{"start":5,"end":1}]}')).toEqual(baseline);
  });

  it('discards a legacy range that points past the end of the verse', () => {
    const { formatting } = normalizeVerseText(
      'Jesus wept.',
      '{"added_words":[{"start":40,"end":41}]}'
    );
    expect(formatting.spans).toBeUndefined();
  });

  it('recovers a span the HTML no longer carries', () => {
    const { text, formatting } = normalizeVerseText(
      'The LORD is my shepherd',
      '{"added_words":[{"start":2,"end":2}]}'
    );
    expect(formatting.spans).toEqual([{ type: 'supplied', start: 2, end: 2 }]);
    expect(spanWords(text, (formatting.spans ?? [])[0] as VerseSpan)).toBe('is');
  });
});

describe('normalizeVerseText — idempotency', () => {
  it('is a no-op on already-clean text', () => {
    const clean = 'The LORD is my shepherd; I shall not want.';
    const result = normalizeVerseText(clean);
    expect(result.text).toBe(clean);
    expect(result.formatting).toEqual({ v: VERSE_FORMATTING_VERSION });
  });

  it('re-normalizing the output changes nothing, for every fixture', () => {
    for (const f of FIXTURES) {
      const once = normalizeVerseText(f.raw, f.legacy);
      const twice = normalizeVerseText(once.text);
      expect(twice.text, f.name).toBe(once.text);
    }
  });

  it('is stable when the same input is normalized repeatedly', () => {
    for (const f of FIXTURES) {
      expect(normalizeVerseText(f.raw, f.legacy), f.name).toEqual(
        normalizeVerseText(f.raw, f.legacy)
      );
    }
  });
});

describe('normalizeVerseText — invariants across every fixture', () => {
  it('produces clean text: no markup, no pilcrow, no stray whitespace', () => {
    for (const f of FIXTURES) {
      const { text } = normalizeVerseText(f.raw, f.legacy);
      expect(text, f.name).not.toMatch(/<[^<>]*>/);
      expect(text, f.name).not.toContain('¶');
      expect(text, f.name).not.toMatch(/\s\s/);
      expect(text, f.name).toBe(text.trim());
      // No stray control characters (U+000F occurs in shipped modules).
      const hasControlChar = text.split('').some((c) => c.charCodeAt(0) < 32);
      expect(hasControlChar, f.name).toBe(false);
    }
  });

  it('produces in-range, well-ordered, non-overlapping-per-type spans', () => {
    for (const f of FIXTURES) {
      const { text, formatting } = normalizeVerseText(f.raw, f.legacy);
      const wordCount = splitVerseWords(text).length;
      const spans = formatting.spans ?? [];
      const lastEndByType = new Map<string, number>();
      for (const span of spans) {
        expect(span.start, `${f.name} / ${span.type}`).toBeGreaterThanOrEqual(0);
        expect(span.end, `${f.name} / ${span.type}`).toBeLessThan(wordCount);
        expect(span.end, `${f.name} / ${span.type}`).toBeGreaterThanOrEqual(span.start);
        const previousEnd = lastEndByType.get(span.type);
        if (previousEnd !== undefined) {
          expect(span.start, `${f.name} / ${span.type}`).toBeGreaterThan(previousEnd + 1);
        }
        lastEndByType.set(span.type, span.end);
      }
      // sorted by start
      for (let i = 1; i < spans.length; i++) {
        expect((spans[i] as VerseSpan).start, f.name).toBeGreaterThanOrEqual(
          (spans[i - 1] as VerseSpan).start
        );
      }
    }
  });

  it('lands every span on real, non-empty words (round trip)', () => {
    for (const f of FIXTURES) {
      const { text, formatting } = normalizeVerseText(f.raw, f.legacy);
      for (const span of formatting.spans ?? []) {
        const covered = spanWords(text, span);
        expect(covered.length, `${f.name} / ${span.type}`).toBeGreaterThan(0);
        expect(text, `${f.name} / ${span.type}`).toContain(covered);
      }
    }
  });

  it('never invents or loses visible words relative to the stripped raw text', () => {
    for (const f of FIXTURES) {
      const { text } = normalizeVerseText(f.raw, f.legacy);
      const stripped = f.raw
        // footnote markers are dropped content
        .replace(/<sup class="n">[\s\S]*?<\/sup>/gi, '')
        // line/block separators become whitespace
        .replace(/<\/?(?:br|hr|p|div|ul|ol|li)\b[^<>]*>/gi, ' ')
        .replace(/<!\/?\s*p\s*>/gi, ' ')
        // inline tags vanish without separating words
        .replace(/<[^<>]*>/g, '')
        .replace(/&gt;/g, '>')
        .replace(/¶/g, ' ');
      const expected = splitVerseWords(stripped).join(' ');
      expect(text, f.name).toBe(expected);
    }
  });
});

describe('mergeSpans', () => {
  it('merges overlapping spans of the same type', () => {
    expect(
      mergeSpans([
        { type: 'supplied', start: 0, end: 4 },
        { type: 'supplied', start: 2, end: 7 },
      ])
    ).toEqual([{ type: 'supplied', start: 0, end: 7 }]);
  });

  it('merges touching spans of the same type', () => {
    expect(
      mergeSpans([
        { type: 'supplied', start: 0, end: 2 },
        { type: 'supplied', start: 3, end: 5 },
      ])
    ).toEqual([{ type: 'supplied', start: 0, end: 5 }]);
  });

  it('leaves a one-word gap unmerged', () => {
    expect(
      mergeSpans([
        { type: 'supplied', start: 0, end: 2 },
        { type: 'supplied', start: 4, end: 5 },
      ])
    ).toEqual([
      { type: 'supplied', start: 0, end: 2 },
      { type: 'supplied', start: 4, end: 5 },
    ]);
  });

  it('never merges across types', () => {
    expect(
      mergeSpans([
        { type: 'supplied', start: 0, end: 2 },
        { type: 'emphasis', start: 1, end: 3 },
      ])
    ).toEqual([
      { type: 'supplied', start: 0, end: 2 },
      { type: 'emphasis', start: 1, end: 3 },
    ]);
  });

  it('never merges quotations with different refs', () => {
    expect(
      mergeSpans([
        { type: 'quotation', start: 0, end: 2, ref_start: 23007014, ref_end: 23007014 },
        { type: 'quotation', start: 3, end: 5, ref_start: 19110001, ref_end: 19110001 },
      ])
    ).toEqual([
      { type: 'quotation', start: 0, end: 2, ref_start: 23007014, ref_end: 23007014 },
      { type: 'quotation', start: 3, end: 5, ref_start: 19110001, ref_end: 19110001 },
    ]);
  });

  it('never merges adjacent quotations that share a start but not an end ref', () => {
    expect(
      mergeSpans([
        { type: 'quotation', start: 0, end: 2, ref_start: 24031031, ref_end: 24031034 },
        { type: 'quotation', start: 3, end: 5, ref_start: 24031031, ref_end: 24031031 },
      ])
    ).toHaveLength(2);
  });

  it('sorts the result by start, then end, then type', () => {
    expect(
      mergeSpans([
        { type: 'supplied', start: 5, end: 6 },
        { type: 'words_of_christ', start: 0, end: 9 },
        { type: 'divine_name', start: 0, end: 0 },
      ])
    ).toEqual([
      { type: 'divine_name', start: 0, end: 0 },
      { type: 'words_of_christ', start: 0, end: 9 },
      { type: 'supplied', start: 5, end: 6 },
    ]);
  });
});

describe('VerseFormatting helpers', () => {
  it('round-trips a payload through stringify and parse', () => {
    const f = fixture('Psalm 23:1 — divine name + supplied word');
    const { formatting } = normalizeVerseText(f.raw, f.legacy);
    const json = stringifyVerseFormatting(formatting);
    expect(json).not.toBeNull();
    expect(parseVerseFormatting(json)).toEqual(formatting);
  });

  it('stores NULL rather than an empty payload', () => {
    const { formatting } = normalizeVerseText('Jesus wept.');
    expect(stringifyVerseFormatting(formatting)).toBeNull();
  });

  it('parses defensively', () => {
    const empty = { v: VERSE_FORMATTING_VERSION };
    expect(parseVerseFormatting(null)).toEqual(empty);
    expect(parseVerseFormatting('')).toEqual(empty);
    expect(parseVerseFormatting('{oops')).toEqual(empty);
    expect(parseVerseFormatting('[]')).toEqual(empty);
    expect(parseVerseFormatting('{"v":1,"spans":[{"type":"bogus","start":0,"end":1}]}')).toEqual(
      empty
    );
    expect(parseVerseFormatting('{"v":1,"spans":[{"type":"supplied","start":3,"end":1}]}')).toEqual(
      empty
    );
    expect(parseVerseFormatting('{"v":1,"block":{"lines":[{"start":0,"end":2,"level":9}]}}')).toEqual(empty);
    expect(parseVerseFormatting('{"v":1,"block":{"lines":[{"start":3,"end":1,"level":1}]}}')).toEqual(empty);
    expect(parseVerseFormatting('{"v":1,"block":{"lines":"nope"}}')).toEqual(empty);
  });

  it('preserves block fields it recognises', () => {
    expect(
      parseVerseFormatting(
        '{"v":1,"block":{"paragraph_start":true,"lines":[{"start":0,"end":4,"level":1},' +
          '{"start":5,"end":8,"level":2}],"heading":"A Psalm of David"}}'
      )
    ).toEqual({
      v: 1,
      block: {
        paragraph_start: true,
        lines: [
          { start: 0, end: 4, level: 1 },
          { start: 5, end: 8, level: 2 },
        ],
        heading: 'A Psalm of David',
      },
    });
  });

  it('drops only the malformed lines, keeping the rest', () => {
    expect(
      parseVerseFormatting(
        '{"v":1,"block":{"lines":[{"start":0,"end":2,"level":1},{"start":3,"end":5,"level":7}]}}'
      )
    ).toEqual({
      v: 1,
      block: { lines: [{ start: 0, end: 2, level: 1 }] },
    });
  });

  it('preserves a quotation ref range', () => {
    expect(
      parseVerseFormatting(
        '{"v":1,"spans":[{"type":"quotation","start":3,"end":9,"ref_start":24031031,"ref_end":24031034}]}'
      )
    ).toEqual({
      v: 1,
      spans: [{ type: 'quotation', start: 3, end: 9, ref_start: 24031031, ref_end: 24031034 }],
    });
  });

  it('completes a lone ref_start to a single-verse range rather than dropping it', () => {
    expect(
      parseVerseFormatting('{"v":1,"spans":[{"type":"quotation","start":3,"end":9,"ref_start":23007014}]}')
    ).toEqual({
      v: 1,
      spans: [{ type: 'quotation', start: 3, end: 9, ref_start: 23007014, ref_end: 23007014 }],
    });
  });

  it('reads a musical_direction span', () => {
    expect(
      parseVerseFormatting('{"v":1,"spans":[{"type":"musical_direction","start":4,"end":4}]}')
    ).toEqual({
      v: 1,
      spans: [{ type: 'musical_direction', start: 4, end: 4 }],
    });
  });
});

describe('splitVerseWords', () => {
  it('is the canonical 0-based word space', () => {
    const words = splitVerseWords('The LORD is my shepherd; I shall not want.');
    expect(words).toHaveLength(9);
    expect(words[0]).toBe('The');
    expect(words[1]).toBe('LORD');
    expect(words[2]).toBe('is');
    expect(words[8]).toBe('want.');
  });

  it('returns an empty array for blank input', () => {
    expect(splitVerseWords('')).toEqual([]);
    expect(splitVerseWords('   ')).toEqual([]);
  });
});

describe('heading_kind round trip', () => {
  it('preserves psalm_title through parse and stringify', () => {
    const stored = JSON.stringify({
      v: 1,
      block: { heading: 'A Psalm of David', heading_kind: 'psalm_title' },
    });
    const parsed = parseVerseFormatting(stored);
    expect(parsed.block?.heading).toBe('A Psalm of David');
    expect(parsed.block?.heading_kind).toBe('psalm_title');
    // Must survive a second hop, or the exporter cannot tell \d from \s.
    expect(parseVerseFormatting(stringifyVerseFormatting(parsed))).toEqual(parsed);
  });

  it('omits heading_kind when unknown, so consumers can default to section', () => {
    const parsed = parseVerseFormatting(JSON.stringify({ v: 1, block: { heading: 'The Beatitudes' } }));
    expect(parsed.block?.heading).toBe('The Beatitudes');
    expect(parsed.block?.heading_kind).toBeUndefined();
  });

  it('discards an invalid kind but keeps the heading text', () => {
    const parsed = parseVerseFormatting(
      JSON.stringify({ v: 1, block: { heading: 'Title', heading_kind: 'nonsense' } })
    );
    expect(parsed.block?.heading).toBe('Title');
    expect(parsed.block?.heading_kind).toBeUndefined();
  });

  it('drops a bare heading_kind with no heading text', () => {
    const parsed = parseVerseFormatting(JSON.stringify({ v: 1, block: { heading_kind: 'section' } }));
    expect(parsed.block).toBeUndefined();
  });
});

describe('source_verses (variant verse provenance)', () => {
  // NHEB Rev 12:18 has no KJV address and is merged into Rev 13:1 at conversion.
  // If this payload is lost, the merge becomes invisible and unrecoverable.
  const merged = JSON.stringify({
    v: 1,
    source_verses: [{ verse: 18, chapter: 12, position: 'prefix', start: 0, end: 7 }],
  });

  it('survives parse when it is the ONLY content', () => {
    const parsed = parseVerseFormatting(merged);
    expect(parsed.source_verses).toHaveLength(1);
    expect(parsed.source_verses?.[0]).toEqual({
      verse: 18,
      chapter: 12,
      position: 'prefix',
      start: 0,
      end: 7,
    });
  });

  it('is NOT serialized away as empty when it is the only content', () => {
    const parsed = parseVerseFormatting(merged);
    const stored = stringifyVerseFormatting(parsed);
    expect(stored).not.toBeNull();
    expect(parseVerseFormatting(stored)).toEqual(parsed);
  });

  it('coexists with spans and block', () => {
    const parsed = parseVerseFormatting(
      JSON.stringify({
        v: VERSE_FORMATTING_VERSION,
        block: { paragraph_start: true },
        spans: [{ type: 'words_of_christ', start: 0, end: 4 }],
        source_verses: [{ verse: 15 }],
      })
    );
    expect(parsed.block?.paragraph_start).toBe(true);
    expect(parsed.spans).toHaveLength(1);
    expect(parsed.source_verses).toEqual([{ verse: 15 }]);
  });

  it('drops malformed entries individually rather than the whole list', () => {
    const parsed = parseVerseFormatting(
      JSON.stringify({
        v: 1,
        source_verses: [{ verse: 0 }, { verse: 'x' }, null, { verse: 15 }, { chapter: 3 }],
      })
    );
    expect(parsed.source_verses).toEqual([{ verse: 15 }]);
  });

  it('leaves genuinely empty formatting empty', () => {
    const parsed = parseVerseFormatting(JSON.stringify({ v: 1, source_verses: [] }));
    expect(stringifyVerseFormatting(parsed)).toBeNull();
  });
});
