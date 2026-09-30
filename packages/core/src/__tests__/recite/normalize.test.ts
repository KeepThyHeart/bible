import { foldTarget, tokenizeHeard } from '../../recite/normalize';
import { englishKit, kitFor } from '../../recite/lang/en';

describe('foldTarget', () => {
  it.each([
    ['Lord,', 'lord'],
    ['“The', 'the'],
    ['Lord’s', 'lords'],
    ["Lord's", 'lords'],
    ['ever-lasting;', 'everlasting'],
    ['Thou—', 'thou'],
    ['(hath)', 'hath'],
    ['LOVE.', 'love'],
    ['‘Ah', 'ah'],
    ['', ''],
  ])('%s -> %s', (input, out) => {
    expect(foldTarget(input)).toBe(out);
  });
});

describe('englishKit.spokenTokens / tokenizeHeard', () => {
  it('folds case and punctuation, splits hyphens', () => {
    expect(englishKit.spokenTokens('Long-suffering, Lord’s!')).toEqual(['long', 'suffering', 'lords']);
  });

  it('expands digits and flags them', () => {
    const toks = tokenizeHeard(
      [{ text: 'in' }, { text: '21', confidence: 0.9 }, { text: 'days' }],
      englishKit,
    );
    expect(toks.map((t) => t.norm)).toEqual(['in', 'twenty', 'one', 'days']);
    expect(toks.map((t) => t.heardIndex)).toEqual([0, 1, 1, 2]);
    expect(toks.map((t) => !!t.fromNumber)).toEqual([false, true, true, false]);
    expect(toks[1].confidence).toBe(0.9);
    expect(toks[1].text).toBe('21');
  });

  it('reads ordinals and comma numbers', () => {
    expect(englishKit.spokenTokens('1st')).toEqual(['first']);
    expect(englishKit.spokenTokens('1,000')).toEqual(['one', 'thousand']);
  });

  it('drops empty tokens', () => {
    expect(tokenizeHeard([{ text: '...' }, { text: 'lord' }], englishKit).map((t) => t.heardIndex)).toEqual([1]);
  });
});

describe('targetTokens and kitFor', () => {
  it('keeps one token per verse word', () => {
    expect(englishKit.targetTokens(['The', 'LORD’s', 'ever-lasting,'])).toEqual(['the', 'lords', 'everlasting']);
  });
  it('kitFor maps English tags only', () => {
    expect(kitFor('en')).toBe(englishKit);
    expect(kitFor('en-US')).toBe(englishKit);
    expect(kitFor('EN-gb')).toBe(englishKit);
    expect(kitFor('fr')).toBeNull();
    expect(kitFor('ens')).toBeNull();
  });
});

import { stripEdgePunctuation } from '../../recite';

describe('stripEdgePunctuation', () => {
  it('strips edges and keeps inner apostrophes', () => {
    expect(stripEdgePunctuation('“Lord’s,”')).toBe('Lord’s');
    expect(stripEdgePunctuation("...don't!")).toBe("don't");
    expect(stripEdgePunctuation('  (hello) ')).toBe('hello');
    expect(stripEdgePunctuation('—')).toBe('');
    expect(stripEdgePunctuation('café;')).toBe('café');
    expect(stripEdgePunctuation('')).toBe('');
  });
});
