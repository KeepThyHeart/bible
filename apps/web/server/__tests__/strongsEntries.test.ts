import { describe, it, expect } from 'vitest';
import { parseStrongsKeyInput, parseStrongsHead, strongsLanguageOf, looseStrongsMatches } from '../utils/strongsEntries';

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

describe('Strong\'s Hebrew body (B-165 remainder)', () => {
  it('drops the raw "N translit pron" opening line from the body', () => {
    const h = parseStrongsHead("430 'elohiym el-o-heem' plural of 433; gods", 'H');
    expect(h?.body).toBe('plural of 433; gods');
    expect(parseStrongsHead("7225 re'shiyth ray-sheeth' from the same as 7218; first", 'H')?.body).toBe('from the same as 7218; first');
  });
});

describe('tolerant transliteration search of a Strong\'s lexicon (B-178)', () => {
  const entry = (entryKey: string, definition: string) => ({ entryKey, definition, word: entryKey });
  const heb = { getAllEntries: () => [
    entry('00430', "430 'elohiym el-o-heem' plural of 433; gods in the ordinary sense:--God, gods."),
    entry('03068', "3068 Yehovah yeh-ho-vaw' from 1961; self-Existent or Eternal:--Jehovah, the Lord."),
  ] } as never;
  const grk = { getAllEntries: () => [
    entry('00026', "26 ἀγάπη ajgavph agape {ag-ah'-pay} \n from 25; love:--charity, love."),
  ] } as never;

  it('finds elohiym from elohim, and Yehovah from Iehovah', () => {
    expect(looseStrongsMatches(heb, 'H', 'elohim').map(e => e.entryKey)).toEqual(['00430']);
    expect(looseStrongsMatches(heb, 'H', 'iehovah').map(e => e.entryKey)).toEqual(['03068']);
  });
  it('finds Greek by loose transliteration and ignores non-Latin or unrelated queries', () => {
    expect(looseStrongsMatches(grk, 'G', 'agaape').map(e => e.entryKey)).toEqual(['00026']);
    expect(looseStrongsMatches(grk, 'G', 'ἀγάπη')).toEqual([]);
    expect(looseStrongsMatches(heb, 'H', 'zzz')).toEqual([]);
  });
});
