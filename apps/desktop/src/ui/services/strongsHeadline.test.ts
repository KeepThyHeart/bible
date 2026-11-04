import { describe, it, expect } from 'vitest';
import { parseStrongsHeadline, stripStrongsHeadline } from './strongsHeadline';

const RAW = "25 ἀγαπάω ajgapavw agapao {ag-ap-ah'-o} \n perhaps from agan (much); to love:--(be-)love(-ed).";
describe('strongsHeadline (B-018)', () => {
  it('prefers the readable transliteration and the pronunciation', () => {
    expect(parseStrongsHeadline(RAW)).toEqual({ word: 'ἀγαπάω', transliteration: 'agapao', pronunciation: "ag-ap-ah'-o" });
  });
  it('strips the raw opening line from the body', () => {
    expect(stripStrongsHeadline(RAW).startsWith('perhaps from agan')).toBe(true);
  });
});
