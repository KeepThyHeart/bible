import { describe, expect, it } from 'vitest';
import {
  findTitlesInLine, LOOSE_MIN_SCORE, matchHymnTitle, matchTitleLine, parseHymnLine, parseVerseList, resolveHymn, verseOrderFor,
} from '../hymnMatch';
import { LIBRARY, TH } from './fixtures';

describe('parseHymnLine', () => {
  it.each([
    ['Hymn 23', { number: '23' }],
    ['Hymn #460', { number: '460' }],
    ['  hymn: 23: Amazing Grace', { number: '23', title: 'Amazing Grace' }],
    ['Hymn: Amazing Grace (verses 1, 2, 5)', { title: 'Amazing Grace', verses: ['1', '2', '5'] }],
    ['Hymn – It Is Well v1-3', { title: 'It Is Well', verses: ['1', '2', '3'] }],
    ['Song: "Rock of Ages" vv. 1–2', { title: 'Rock of Ages', verses: ['1', '2'] }],
    ['Hymn: It Is Well (1, R, 4, R)', { title: 'It Is Well', verses: ['1', 'R', '4', 'R'] }],
    ['Hymn: Amazing Grace verses 1, 2 and 5', { title: 'Amazing Grace', verses: ['1', '2', '5'] }],
    ['Song: 10,000 Reasons', { title: '10,000 Reasons' }],
  ])('%s', (line, expected) => {
    expect(parseHymnLine(line)).toMatchObject(expected);
  });

  it.each(['Hymnal notes for Sunday', 'The hymn we sing', 'Hymn', 'Songs of praise'])('is not a hymn line: %s', line => {
    expect(parseHymnLine(line)).toBeNull();
  });

  it('flags a verse list that runs backwards', () => {
    expect(parseHymnLine('Hymn: Amazing Grace (3–1)')).toMatchObject({ title: 'Amazing Grace', versesInvalid: true });
  });

  it('reports the trimmed span of the line', () => {
    expect(parseHymnLine('  Hymn 23  ')).toMatchObject({ from: 2, to: 9 });
  });
});

describe('parseVerseList', () => {
  it.each([
    ['1, 2, 5', ['1', '2', '5']],
    ['1–3', ['1', '2', '3']],
    ['1-2, r, 4', ['1', '2', 'R', '4']],
    ['1 & 3', ['1', '3']],
  ])('%s', (list, expected) => {
    expect(parseVerseList(list)).toEqual(expected);
  });

  it('rejects a range involving the refrain', () => {
    expect(parseVerseList('1-R')).toBeNull();
  });
});

describe('matchHymnTitle', () => {
  it.each([
    ['Amazing Grace', 'amazing-grace'],
    ['amazing grace!', 'amazing-grace'],
    ['Amazin Grace', 'amazing-grace'],
    ['It Is Well', 'it-is-well'],
    ['When peace like a river', 'it-is-well'],
    ['Holy Holy Holy', 'holy-holy-holy'],
    ['Rock of Ages, Cleft for Me', 'rock-of-ages'],
  ])('%s -> %s', (query, id) => {
    expect(matchHymnTitle(query, LIBRARY)[0]?.hymn.id).toBe(id);
  });

  it('finds nothing for an unrelated title', () => {
    expect(matchHymnTitle('Zebra Crossing Blues', LIBRARY)).toEqual([]);
  });
});

describe('verseOrderFor', () => {
  const well = LIBRARY[1];
  const amazing = LIBRARY[0];

  it.each([
    ['refrain after each listed verse', ['1', '2', '4'], well, ['1', 'R', '2', 'R', '4', 'R'], []],
    ['no refrain in the hymn', ['1', '2', '5'], amazing, ['1', '2', '5'], []],
    ['explicit R keeps the written order', ['1', 'R', '4'], well, ['1', 'R', '4'], []],
    ['a verse the hymn lacks', ['1', '7'], well, ['1', 'R'], ['7']],
    ['R in a hymn without a refrain', ['1', 'R'], amazing, ['1'], ['R']],
  ])('%s', (_name, verses, hymn, order, missing) => {
    expect(verseOrderFor(verses, hymn)).toEqual({ verseOrder: order, missing });
  });

  it('leaves the hymn’s own order when there is no list', () => {
    expect(verseOrderFor(undefined, well)).toEqual({ missing: [] });
  });
});

describe('resolveHymn', () => {
  const resolve = (line: string, hymnal?: string) => resolveHymn(parseHymnLine(line)!, LIBRARY, { hymnal });

  it('resolves a number', () => {
    expect(resolve('Hymn 460')).toEqual({ status: 'ok', item: { kind: 'hymn', hymnId: 'amazing-grace' } });
  });

  it('asks when a number is in several hymnals', () => {
    expect(resolve('Hymn 23')).toMatchObject({
      status: 'choose', item: null,
      reason: { key: 'present.notes.reason.hymnNumberAmbiguous', params: { number: '23' } },
      candidates: ['grace-greater', 'holy-holy-holy'],
    });
  });

  it('prefers the service hymnal on a number collision', () => {
    expect(resolve('Hymn 23', TH)).toMatchObject({ status: 'ok', item: { hymnId: 'grace-greater' } });
  });

  it('lets a title settle a number collision', () => {
    expect(resolve('Hymn 23: Holy Holy Holy')).toMatchObject({ status: 'ok', item: { hymnId: 'holy-holy-holy' } });
  });

  it('asks for an unknown number', () => {
    expect(resolve('Hymn 999')).toMatchObject({ status: 'choose', item: null, reason: { key: 'present.notes.reason.hymnNumberNotFound' } });
  });

  it('inserts the refrain after each listed verse', () => {
    expect(resolve('Hymn: It Is Well (verses 1, 2, 4)')).toEqual({
      status: 'ok', item: { kind: 'hymn', hymnId: 'it-is-well', verseOrder: ['1', 'R', '2', 'R', '4', 'R'] },
    });
  });

  it('uses an explicit R order as written', () => {
    expect(resolve('Hymn: It Is Well (1, 2, R, 4)')).toMatchObject({ item: { verseOrder: ['1', '2', 'R', '4'] } });
  });

  it('asks when several titles match', () => {
    expect(resolve('Hymn: Grace')).toMatchObject({
      status: 'choose', item: null,
      reason: { key: 'present.notes.reason.hymnAmbiguous', params: { title: 'Grace' } },
    });
    expect(resolve('Hymn: Grace').candidates).toEqual(expect.arrayContaining(['grace-greater', 'amazing-grace']));
  });

  it('asks for an unknown title', () => {
    expect(resolve('Hymn: Zebra Crossing Blues')).toMatchObject({
      status: 'choose', item: null, reason: { key: 'present.notes.reason.hymnNotFound', params: { title: 'Zebra Crossing Blues' } },
    });
  });

  it('asks, but keeps the hymn, when a listed verse is missing', () => {
    expect(resolve('Hymn: Rock of Ages (1, 5)')).toMatchObject({
      status: 'choose', item: { hymnId: 'rock-of-ages', verseOrder: ['1'] },
      reason: { key: 'present.notes.reason.hymnVerseMissing', params: { verses: '5' } },
    });
  });

  it('asks when the library is not loaded', () => {
    expect(resolveHymn(parseHymnLine('Hymn 460')!, undefined)).toMatchObject({
      status: 'choose', item: null, reason: { key: 'present.notes.reason.hymnLibraryUnavailable' },
    });
  });
});

describe('hymn line cues', () => {
  it.each([
    ['Opening hymn: Amazing Grace (verses 1, 2, 4)', { title: 'Amazing Grace', verses: ['1', '2', '4'] }],
    ['Closing hymn 460', { number: '460' }],
    ['closing song – It Is Well', { title: 'It Is Well' }],
  ])('a strong cue: %s', (line, expected) => {
    const parsed = parseHymnLine(line);
    expect(parsed).toMatchObject(expected);
    expect(parsed).not.toHaveProperty('loose');
  });

  it.each([
    ['Opening: Amazing Grace', { title: 'Amazing Grace' }],
    ['Closing: It Is Well With My Soul', { title: 'It Is Well With My Soul' }],
    ['Closing – Rock of Ages (1, 3)', { title: 'Rock of Ages', verses: ['1', '3'] }],
    ["Sing 'Tis So Sweet to Trust in Jesus", { title: 'Tis So Sweet to Trust in Jesus' }],
    ['Sing 460', { number: '460' }],
  ])('a loose cue: %s', (line, expected) => {
    expect(parseHymnLine(line)).toMatchObject({ ...expected, loose: true });
  });

  it.each(['Opening prayer', 'Singing together', 'Sing', 'Closing:', 'Sing 2 verses, then pray'])('is not a hymn line: %s', line => {
    expect(parseHymnLine(line)).toBeNull();
  });

  it('a loose title needs a strong library match', () => {
    const loose = (line: string) => resolveHymn(parseHymnLine(line)!, LIBRARY, { minScore: LOOSE_MIN_SCORE });
    expect(loose('Closing: It Is Well With My Soul')).toMatchObject({ status: 'ok', item: { hymnId: 'it-is-well' } });
    expect(loose('Sing to the Lord a new song')).toMatchObject({ item: null, reason: { key: 'present.notes.reason.hymnNotFound' } });
    expect(loose('Closing: prayer and blessing')).toMatchObject({ item: null });
  });
});

describe('matchTitleLine', () => {
  it.each([
    ['It Is Well with My Soul', { from: 0, to: 23, title: 'It Is Well with My Soul' }],
    ['  amazing grace!  ', { from: 2, to: 16, title: 'amazing grace!' }],
    ['Amazing Grace (verses 1, 2, 4)', { title: 'Amazing Grace', verses: ['1', '2', '4'] }],
    ['Rock of Ages, Cleft for Me', { title: 'Rock of Ages, Cleft for Me' }],
    ['“Rock of Ages”', { title: 'Rock of Ages' }],
  ])('%s', (line, expected) => {
    expect(matchTitleLine(line, LIBRARY)).toMatchObject(expected);
  });

  it.each(['Amazing Grace is our theme', 'Grace', 'Amazing', 'It is well', 'Amazing grace! how sweet the sound'])('is not a title line: %s', line => {
    expect(matchTitleLine(line, LIBRARY)).toBeNull();
  });

  it('needs the library', () => {
    expect(matchTitleLine('Amazing Grace', undefined)).toBeNull();
    expect(matchTitleLine('Amazing Grace', [])).toBeNull();
  });

  it('ignores one-word titles', () => {
    const library = [{ id: 'amen', title: 'Amen', hymnals: [], verseCount: 1, hasRefrain: false }];
    expect(matchTitleLine('Amen', library)).toBeNull();
    expect(findTitlesInLine('We all say Amen', library)).toEqual([]);
  });
});

describe('findTitlesInLine', () => {
  it('finds a title inside other words, with its span', () => {
    const text = 'Then the choir sings It Is Well with My Soul, softly';
    const [found] = findTitlesInLine(text, LIBRARY);
    expect(found.hymn.id).toBe('it-is-well');
    expect(text.slice(found.from, found.to)).toBe('It Is Well with My Soul');
  });

  it('prefers the longer title starting at the same word', () => {
    const text = 'we close with Rock of Ages, Cleft for Me tonight';
    const found = findTitlesInLine(text, LIBRARY);
    expect(found).toHaveLength(1);
    expect(text.slice(found[0].from, found[0].to)).toBe('Rock of Ages, Cleft for Me');
  });

  it('matches across apostrophes and case', () => {
    const text = "after that, 'tis so sweet to trust in jesus";
    expect(findTitlesInLine(text, LIBRARY).map(f => f.hymn.id)).toEqual(['tis-so-sweet']);
  });

  it('needs every word of the title', () => {
    expect(findTitlesInLine('it is well with me', LIBRARY)).toEqual([]);
    expect(findTitlesInLine('amazing graceful dancers', LIBRARY)).toEqual([]);
  });

  it('skips a title shared by two hymns', () => {
    const library = [
      { id: 'a', title: 'Be Still My Soul', hymnals: [], verseCount: 3, hasRefrain: false },
      { id: 'b', title: 'Be Still, My Soul', hymnals: [], verseCount: 3, hasRefrain: false },
    ];
    expect(findTitlesInLine('we sang Be Still My Soul', library)).toEqual([]);
  });
});
