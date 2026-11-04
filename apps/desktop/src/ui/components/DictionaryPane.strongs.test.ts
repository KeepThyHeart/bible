import { describe, it, expect } from 'vitest';
import { parseStrongsHeadline, linkStrongsSeeRefs } from './DictionaryPane';

describe('Strong\'s dictionary entry helpers (B-018)', () => {
  it('pulls the clean headword, transliteration and pronunciation out of the raw definition', () => {
    expect(parseStrongsHeadline("25 ἀγαπάω ajgapavw agapao {ag-ap-ah'-o} \n perhaps from agan")).toEqual({
      word: 'ἀγαπάω', transliteration: 'agapao', pronunciation: "ag-ap-ah'-o",
    });
  });
  it('returns null for ordinary definitions', () => {
    expect(parseStrongsHeadline('A plain definition.')).toBeNull();
  });
  it('links "see GREEK/HEBREW for N" cross-references', () => {
    const html = linkStrongsSeeRefs('x see GREEK for 5689 y see HEBREW for 430');
    expect(html).toContain('data-strongs-ref="G5689"');
    expect(html).toContain('data-strongs-ref="H430"');
  });
});
