import { describe, it, expect } from 'vitest';
import { parseStrongsKeyInput, parseStrongsHead, strongsLanguageOf } from '../utils/strongsEntries';

describe('Strong\'s dictionary keys (B-165)', () => {
  it.each(['G26', 'g26', 'G0026', 'g 26', '26', '00026'])('reads %s as 00026', (text) => {
    expect(parseStrongsKeyInput(text)?.key).toBe('00026');
  });
  it('keeps the testament hint and letter suffix', () => {
    expect(parseStrongsKeyInput('H430')).toEqual({ prefix: 'H', key: '00430' });
    expect(parseStrongsKeyInput('31a')?.key).toBe('00031A');
  });
  it('rejects words', () => {
    expect(parseStrongsKeyInput('love')).toBeNull();
    expect(parseStrongsKeyInput('')).toBeNull();
  });
  it('knows the lexicon language from the module name', () => {
    expect(strongsLanguageOf('StrongsGreek')).toBe('G');
    expect(strongsLanguageOf('strongshebrew')).toBe('H');
    expect(strongsLanguageOf('Easton')).toBeNull();
  });
  it('parses the Greek head, including the multi-form article', () => {
    const g = parseStrongsHead("26 ἀγάπη ajgavph agape {ag-ah'-pay} from 25; love", 'G');
    expect(g).toMatchObject({ word: 'ἀγάπη', transliteration: 'agape', pronunciation: "ag-ah'-pay", body: 'from 25; love' });
    const art = parseStrongsHead('3588 ὁ ἡ τό oJ hJ tov ho {ho} 包括 he {hay}, the article', 'G');
    expect(art).toMatchObject({ word: 'ὁ ἡ τό', transliteration: 'ho' });
  });
  it('gives Hebrew its transliteration', () => {
    expect(parseStrongsHead("430 'elohiym el-o-heem' plural of 433; gods", 'H')).toMatchObject({ transliteration: 'elohiym' });
  });
});
