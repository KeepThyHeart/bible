import { describe, expect, it } from 'vitest';
import { matchAnswer } from '../../../../../src/modules/games/shared/answers/match.js';
import { BLANK, blankCandidates, chooseBlank, maskedText } from './blank.js';
import type { Blank } from './blank.js';

/** A generator that hands out a fixed sequence, so a choice can be pinned. */
function sequence(values: readonly number[]): () => number {
  let index = 0;
  return () => values[index++ % values.length] ?? 0;
}

const IN_THE_BEGINNING = 'In the beginning God created the heaven and the earth.';
const WITHOUT_FORM =
  'And the earth was without form, and void; and darkness was upon the face of the deep.';
const PRAISE_HIM = 'O praise the LORD, all ye nations: praise him, all ye people.';
const THE_REVELATION = 'The Revelation of Jesus Christ, which God gave unto him.';
const FOR_GOD_SO_LOVED = 'For God so loved the world, that he gave his only begotten Son.';
const GENEALOGY = 'And Cainan lived seventy years, and begat Mahalaleel.';
const CENSUS = 'Of the children of Reuben, were forty and six thousand and five hundred.';
const TOWN_LIST = 'And these are the cities, Kirjatharba, and Zioph, and Anab, and Eshtemoh.';

function wordsOffered(text: string): string[] {
  return blankCandidates(text).map((candidate) => candidate.word);
}

function scoreOf(text: string, word: string): number {
  return blankCandidates(text).find((candidate) => candidate.word === word)?.score ?? -1;
}

/** Fails loudly rather than letting a null blank turn into a confusing assertion. */
function blankOf(text: string, random: () => number = sequence([0])): Blank {
  const blank = chooseBlank(text, random);
  if (blank === null) throw new Error(`no word worth blanking in: ${text}`);
  return blank;
}

describe('which words may be taken out', () => {
  it('never offers an article or a function word', () => {
    const offered = wordsOffered(IN_THE_BEGINNING);

    expect(offered).not.toContain('the');
    expect(offered).not.toContain('In');
    expect(offered).not.toContain('and');
    expect(offered).toEqual(expect.arrayContaining(['beginning', 'God', 'created', 'heaven']));
  });

  it('never offers a King James auxiliary or a speech verb', () => {
    const offered = wordsOffered('And God said, Let there be light: and there was fire.');

    expect(offered).not.toContain('said');
    expect(offered).not.toContain('Let');
    expect(offered).not.toContain('was');
  });

  it('never offers a word of fewer than three letters', () => {
    const offered = wordsOffered('And he saw the ox go by the river of Egypt this day.');

    expect(offered).not.toContain('ox');
    expect(offered).not.toContain('go');
    expect(offered).toContain('river');
  });

  it('never offers a word the verse prints twice, because the answer would be on screen', () => {
    const offered = wordsOffered(PRAISE_HIM);

    expect(offered).not.toContain('praise');
    expect(offered).toEqual(expect.arrayContaining(['LORD', 'nations', 'people']));
  });

  it('offers nothing at all when the verse is function words end to end', () => {
    const nothing = 'And they were with him, and he was with them.';

    expect(blankCandidates(nothing)).toEqual([]);
    expect(chooseBlank(nothing, sequence([0]))).toBeNull();
  });
});

describe('avoiding a genealogy, a census or a list', () => {
  it('draws nothing from a genealogy, dominated by names and an age', () => {
    expect(chooseBlank(GENEALOGY, sequence([0]))).toBeNull();
  });

  it('draws nothing from a census line, dominated by a name and a tally', () => {
    expect(chooseBlank(CENSUS, sequence([0]))).toBeNull();
  });

  it('draws nothing from a list of towns', () => {
    expect(chooseBlank(TOWN_LIST, sequence([0]))).toBeNull();
  });

  it('still ranks candidates for a rejected verse — blankCandidates is not the gate', () => {
    // The rejection is chooseBlank's call, ahead of ranking; blankCandidates
    // stays a pure ranking function whether or not the verse gets that far.
    expect(blankCandidates(GENEALOGY).length).toBeGreaterThan(0);
  });

  it('does not reject an ordinary verse just for naming God, Jesus, Christ or the LORD repeatedly', () => {
    // Four capitalised words in eleven, none of them a memory test — the
    // names common enough to cost no Bible knowledge at all are not counted
    // against a verse, only names and numbers that are.
    expect(chooseBlank(THE_REVELATION, sequence([0]))).not.toBeNull();
    expect(chooseBlank(PRAISE_HIM, sequence([0]))).not.toBeNull();
  });
});

describe('which word is the better question', () => {
  it('puts a proper noun first', () => {
    expect(blankCandidates(IN_THE_BEGINNING)[0]?.word).toBe('God');
    expect(scoreOf(IN_THE_BEGINNING, 'God')).toBeGreaterThan(scoreOf(IN_THE_BEGINNING, 'created'));
  });

  it('is the name being known, not merely being a proper noun, that earns the bonus', () => {
    // "Ahaz" is a real but obscure name, structurally a proper noun exactly
    // like "Moses" — same length, same context either side — so a ranking
    // that rewarded capitalisation alone would tie or even prefer it. Only
    // "Moses" is in `KNOWN_NAMES`, so it wins outright.
    const text = 'The prophet Moses stood before Ahaz that day.';
    expect(blankCandidates(text)[0]?.word).toBe('Moses');
    expect(scoreOf(text, 'Moses')).toBeGreaterThan(scoreOf(text, 'Ahaz'));
  });

  it('still blanks an obscure name when it is honestly the best word on offer', () => {
    // Being obscure does not exclude a name from the ranking — only from the
    // bonus. Long, centrally-placed and with nothing better around it,
    // "Elzaphan" still wins on length and context alone.
    const text = 'Moses spoke quietly with Elzaphan beside the ancient well.';
    expect(blankCandidates(text)[0]?.word).toBe('Elzaphan');
  });

  it('counts a capital after a colon as a new sentence rather than a name', () => {
    const text = 'And God said unto him: Arise and go forth into the land.';

    // `Arise` opens a sentence; the capital is typesetting and buys nothing.
    expect(scoreOf(text, 'Arise')).toBe(scoreOf(text, 'forth'));
    expect(scoreOf(text, 'God')).toBeGreaterThan(scoreOf(text, 'Arise'));
  });

  it('counts the capital that opens a verse as nothing at all', () => {
    const text = 'Blessed is the man that walketh not in the counsel of the ungodly.';

    expect(scoreOf(text, 'Blessed')).toBeLessThan(scoreOf(text, 'walketh'));
  });

  it('prefers a long, distinctive word to a short common one', () => {
    expect(scoreOf(WITHOUT_FORM, 'darkness')).toBeGreaterThan(scoreOf(WITHOUT_FORM, 'form'));
    expect(blankCandidates(WITHOUT_FORM)[0]?.word).toBe('darkness');
  });

  it('prefers a word with sentence either side of it to one on the end', () => {
    expect(scoreOf(WITHOUT_FORM, 'face')).toBeGreaterThan(scoreOf(WITHOUT_FORM, 'deep'));
    expect(scoreOf(IN_THE_BEGINNING, 'heaven')).toBeGreaterThan(scoreOf(IN_THE_BEGINNING, 'earth'));
  });

  it('ranks best first', () => {
    const scores = blankCandidates(FOR_GOD_SO_LOVED).map((candidate) => candidate.score);

    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });
});

describe('the same verse asked twice', () => {
  it('gives the same question to the same generator', () => {
    expect(chooseBlank(THE_REVELATION, sequence([0.42]))).toEqual(
      chooseBlank(THE_REVELATION, sequence([0.42]))
    );
  });

  it('gives a different one when the tie falls the other way', () => {
    // Two well-known names score alike here — same length, symmetric context
    // either side — and which of them goes is the generator's business
    // rather than the document order's.
    const TWO_KNOWN_NAMES = 'In the days Moses then Aaron and spoke too.';
    expect(blankOf(TWO_KNOWN_NAMES, sequence([0])).word).toBe('Moses');
    expect(blankOf(TWO_KNOWN_NAMES, sequence([0.99])).word).toBe('Aaron');
  });

  it('stays inside the candidate list for a generator that returns one', () => {
    expect(blankOf(THE_REVELATION, sequence([1])).word).toBe('Christ');
  });
});

describe('the text either side of the blank', () => {
  it('leaves the verse punctuation where the verse put it', () => {
    const blank = blankOf(WITHOUT_FORM);

    expect(`${blank.before}${blank.word}${blank.after}`).toBe(WITHOUT_FORM);
    expect(maskedText(blank)).toBe(
      `And the earth was without form, and void; and ${BLANK} was upon the face of the deep.`
    );
  });

  it('keeps a comma that sat against the missing word', () => {
    const blank = blankOf(
      'He maketh me to lie down in green pastures, and leadeth me beside still waters.'
    );

    expect(blank.word).toBe('pastures');
    expect(blank.after.startsWith(',')).toBe(true);
  });

  it('marks the blank at a fixed width, whatever the word was', () => {
    const short = blankOf(IN_THE_BEGINNING);
    const long = blankOf(WITHOUT_FORM);

    expect(short.word).toBe('God');
    expect(long.word).toBe('darkness');
    // A blank sized to its word would hand out the letter count.
    expect(maskedText(short)).toContain(BLANK);
    expect(maskedText(long)).toContain(BLANK);
    expect(maskedText(short)).not.toContain(`${BLANK}_`);
    expect(maskedText(long)).not.toContain(`${BLANK}_`);
  });
});

describe('a possessive standing where the blank is', () => {
  const text = 'And Moses hid his face, for he was afraid to look upon God’s countenance today.';

  it('takes the whole word, apostrophe and all', () => {
    expect(blankOf(text).word).toBe('God’s');
  });

  it('credits the bare noun, which is what a player types at a blank', () => {
    const blank = blankOf(text);

    expect(blank.accept).toEqual(['God']);
    expect(matchAnswer('god', blank.word, blank.accept).matched).toBe(true);
    expect(matchAnswer("God's", blank.word, blank.accept).matched).toBe(true);
  });

  it('credits a name whose possessive is a bare apostrophe', () => {
    const blank = blankOf('They laid it at the feet of Jesus’ disciples in the city.');

    expect(blank.word).toBe('Jesus’');
    expect(matchAnswer('jesus', blank.word, blank.accept).matched).toBe(true);
  });
});
