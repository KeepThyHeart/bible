import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import type { AnswerValue, PlayerId, RoomSettings } from '../../../../../src/modules/games/shared/protocol.js';
import { DEFAULT_THEME } from '../../../../../src/modules/games/shared/theme.js';
import type { Round, RoundBuildContext, ScoredAnswer } from '../../../../../src/modules/games/shared/games.js';
import { toVerseId } from '../../../../../src/modules/games/shared/verseId.js';
import { ContentLibrary, importContent, useContent } from '../../content/index.js';
import { makeTempDir, removeTempDir, writeFixtureModule } from '../../content/fixtures.js';
import { BLANK, POINTS, fillInTheBlank } from './index.js';
import type { BlankPrompt, BlankReveal, BlankSecret } from './index.js';

/**
 * A generator that is a fixed sequence rather than a real stream: a round built
 * from a known sequence is a round that can be asserted on, and the module's
 * only promise about randomness is that it uses the one it is handed.
 */
function sequence(values: readonly number[]): () => number {
  let index = 0;
  return () => values[index++ % values.length] ?? 0;
}

function settings(overrides: Partial<RoomSettings> = {}): RoomSettings {
  return {
    gameId: 'fill-in-the-blank',
    setId: null,
    translation: 'FIX',
    teamsEnabled: false,
    rounds: 5,
    answerWindowMs: 20_000,
    showIndividualScores: false,
    solo: false,
    groupVote: false,
    familiarity: 'broad',
    gameOptions: {},
    theme: DEFAULT_THEME,
    ...overrides,
  };
}

function context(
  random: () => number,
  overrides: Partial<RoomSettings> = {},
  previous: readonly Round<BlankSecret | null>[] = []
): RoundBuildContext<BlankSecret | null> {
  return { settings: settings(overrides), random, previous, choice: null };
}

function promptOf(round: Round<BlankSecret | null>): BlankPrompt {
  return round.playerView as BlankPrompt;
}

function answer(playerId: PlayerId, text: string, at = 1_000): ScoredAnswer {
  return { playerId, value: { type: 'text', text }, at, openedAt: 0 };
}

/** A round assembled by hand, so scoring can be asserted without drawing a verse. */
function roundFor(word: string, accept: string[] = []): Round<BlankSecret | null> {
  const secret: BlankSecret = {
    verseId: toVerseId(43, 3, 16),
    reference: 'John 3:16',
    word,
    accept,
    before: 'For God so loved the ',
    after: ', that he gave his only begotten Son.',
  };
  return {
    index: 0,
    secret,
    hostView: { text: `${secret.before}${BLANK}${secret.after}`, blank: BLANK },
    playerView: { text: `${secret.before}${BLANK}${secret.after}`, blank: BLANK },
  };
}

let directory: string;
let library: ContentLibrary;
let previous: ContentLibrary | null;

beforeEach(() => {
  directory = makeTempDir('fill-in-the-blank-');
  writeFixtureModule(join(directory, 'modules', 'fixture.db'), { abbreviation: 'FIX' });
  library = ContentLibrary.open({
    moduleDir: join(directory, 'modules'),
    contentPath: ':memory:',
    defaultTranslation: 'FIX',
  });
  previous = useContent(library);
});

afterEach(() => {
  useContent(previous);
  library.close();
  removeTempDir(directory);
});

describe('building a round', () => {
  it('shows a verse with one word missing', () => {
    const round = fillInTheBlank.buildRound(context(sequence([0.5, 0])), 0);
    const prompt = promptOf(round);

    expect(prompt.blank).toBe(BLANK);
    expect(prompt.text).toContain(BLANK);
    expect(round.secret?.word).not.toBe('');
  });

  it('shows the reference from the start of the round, on both screens', () => {
    // A deliberate reversal of this game's earlier design, which withheld it
    // until the reveal — see the module's own doc comment.
    const round = fillInTheBlank.buildRound(context(sequence([0.5, 0])), 0);
    const secret = round.secret;

    expect(secret).not.toBeNull();
    expect(promptOf(round).reference).toBe(secret?.reference);
    expect(promptOf(round).reference).toMatch(/\d/);
    expect(round.hostView).toEqual(round.playerView);
  });

  it('withholds the missing word from both screens', () => {
    const round = fillInTheBlank.buildRound(context(sequence([0.5, 0])), 0);
    const word = round.secret?.word ?? 'unreachable';

    expect(promptOf(round).text).not.toContain(word);
    expect((round.hostView as BlankPrompt).text).not.toContain(word);
  });

  it('gives the projector and the phone the same question', () => {
    const round = fillInTheBlank.buildRound(context(sequence([0.3, 0.7])), 2);

    expect(round.hostView).toEqual(round.playerView);
    expect(round.index).toBe(2);
  });

  it('draws the same verse and the same word from the same generator', () => {
    const first = fillInTheBlank.buildRound(context(sequence([0.12, 0.87, 0.4])), 0);
    const second = fillInTheBlank.buildRound(context(sequence([0.12, 0.87, 0.4])), 0);

    expect(first).toEqual(second);
  });

  it('draws different verses as the generator moves on', () => {
    const drawn = new Set<number>();
    for (let step = 0; step < 20; step += 1) {
      const round = fillInTheBlank.buildRound(context(sequence([step / 20, 0])), 0);
      if (round.secret) drawn.add(round.secret.verseId);
    }

    expect(drawn.size).toBeGreaterThan(1);
  });

  it('never draws a verse too short to hold a question', () => {
    const shortVerse = toVerseId(43, 11, 35);
    for (let step = 0; step < 40; step += 1) {
      const round = fillInTheBlank.buildRound(context(sequence([step / 40, 0.5])), 0);

      expect(round.secret?.verseId).not.toBe(shortVerse);
    }
  });

  it('reassembles the verse it drew', () => {
    const round = fillInTheBlank.buildRound(context(sequence([0.5, 0])), 0);
    const secret = round.secret;
    const verse = secret ? library.verseText(secret.verseId, 'FIX') : null;

    expect(verse).toBe(`${secret?.before}${secret?.word}${secret?.after}`);
  });

  it('falls back to an installed module when the room names one that is not', () => {
    const round = fillInTheBlank.buildRound(context(sequence([0.5, 0]), { translation: 'KJV' }), 0);

    // Refusing to play because the configuration names a module nobody dropped
    // in would leave a host staring at a blank projector.
    expect(round.secret).not.toBeNull();
  });
});

describe('a server with no Bible module installed', () => {
  let empty: ContentLibrary;

  beforeEach(() => {
    empty = ContentLibrary.open({
      moduleDir: join(directory, 'nothing-here'),
      contentPath: ':memory:',
      defaultTranslation: 'FIX',
    });
    useContent(empty);
  });

  afterEach(() => {
    empty.close();
  });

  it('builds an empty round rather than crashing in front of a group', () => {
    const round = fillInTheBlank.buildRound(context(sequence([0.5])), 0);

    expect(round.secret).toBeNull();
    expect(promptOf(round).text).toBe('');
  });

  it('marks nobody wrong for having guessed at an empty screen', () => {
    const round = fillInTheBlank.buildRound(context(sequence([0.5])), 0);
    const outcome = fillInTheBlank.scoreRound(round, [answer('p-1', 'world')], { seats: [], log: [] });

    expect(outcome.perPlayer.get('p-1')?.correct).toBe(false);
    expect(outcome.perPlayer.get('p-1')?.pointsAwarded).toBe(0);
    expect(outcome.correctLabel).toBe('');
    expect(outcome.detail).toBeNull();
  });
});

describe('scoring what was typed', () => {
  it('pays everyone who is right the same, however late they were', () => {
    const outcome = fillInTheBlank.scoreRound(roundFor('world'), [
      answer('quick', 'world', 1_100),
      answer('slow', 'world', 19_900),
    ], { seats: [], log: [] });

    expect(outcome.perPlayer.get('quick')?.pointsAwarded).toBe(POINTS);
    expect(outcome.perPlayer.get('slow')?.pointsAwarded).toBe(POINTS);
  });

  it('pays nothing for the wrong word', () => {
    const outcome = fillInTheBlank.scoreRound(roundFor('world'), [answer('p-1', 'nations')], { seats: [], log: [] });

    expect(outcome.perPlayer.get('p-1')).toEqual({
      correct: false,
      pointsAwarded: 0,
      submitted: { type: 'text', text: 'nations' },
      note: null,
    });
  });

  it('credits the modern word for the King James one', () => {
    const outcome = fillInTheBlank.scoreRound(roundFor('brethren'), [answer('p-1', 'brothers')], { seats: [], log: [] });

    // A vocabulary test is not what anybody signed up for.
    expect(outcome.perPlayer.get('p-1')?.correct).toBe(true);
    expect(outcome.perPlayer.get('p-1')?.note).toBeNull();
  });

  it('credits a near miss and says so', () => {
    const outcome = fillInTheBlank.scoreRound(roundFor('begotten'), [answer('p-1', 'begoten')], { seats: [], log: [] });

    expect(outcome.perPlayer.get('p-1')?.correct).toBe(true);
    expect(outcome.perPlayer.get('p-1')?.note).toBe('Close enough!');
  });

  it('credits the bare noun where the verse printed a possessive', () => {
    const outcome = fillInTheBlank.scoreRound(roundFor('God’s', ['God']), [
      answer('p-1', 'god'),
      answer('p-2', "God's"),
    ], { seats: [], log: [] });

    expect(outcome.perPlayer.get('p-1')?.correct).toBe(true);
    expect(outcome.perPlayer.get('p-2')?.correct).toBe(true);
  });

  it('pays nothing for an empty box', () => {
    const outcome = fillInTheBlank.scoreRound(roundFor('world'), [answer('p-1', '   ')], { seats: [], log: [] });

    expect(outcome.perPlayer.get('p-1')?.correct).toBe(false);
  });

  it('pays nothing for an answer of the wrong shape', () => {
    const chosen: AnswerValue = { type: 'choice', index: 2 };
    const outcome = fillInTheBlank.scoreRound(roundFor('world'), [
      { playerId: 'p-1', value: chosen, at: 1_000, openedAt: 0 },
    ], { seats: [], log: [] });

    expect(outcome.perPlayer.get('p-1')?.correct).toBe(false);
    expect(outcome.perPlayer.get('p-1')?.submitted).toEqual(chosen);
  });

  it('says nothing about a player who never answered', () => {
    const outcome = fillInTheBlank.scoreRound(roundFor('world'), [answer('p-1', 'world')], { seats: [], log: [] });

    expect(outcome.perPlayer.has('p-2')).toBe(false);
  });
});

describe('what the big screen is told', () => {
  it('leads with the word and how many found it', () => {
    const outcome = fillInTheBlank.scoreRound(roundFor('world'), [
      answer('p-1', 'world'),
      answer('p-2', 'World'),
      answer('p-3', 'nations'),
    ], { seats: [], log: [] });

    expect(outcome.correctLabel).toBe('world');
    expect(outcome.aggregates[0]).toEqual({ label: 'world', count: 2 });
  });

  it('groups the other answers by spelling and names nobody', () => {
    const outcome = fillInTheBlank.scoreRound(roundFor('world'), [
      answer('p-1', 'Nations'),
      answer('p-2', 'nations'),
      answer('p-3', 'people'),
    ], { seats: [], log: [] });

    expect(outcome.aggregates).toEqual([
      { label: 'world', count: 0 },
      { label: 'Nations', count: 2 },
      { label: 'people', count: 1 },
    ]);
    expect(JSON.stringify(outcome.aggregates)).not.toContain('p-1');
  });

  it('leaves an empty box out of the other answers', () => {
    const outcome = fillInTheBlank.scoreRound(roundFor('world'), [
      answer('p-1', ''),
      answer('p-2', 'nations'),
    ], { seats: [], log: [] });

    expect(outcome.aggregates).toHaveLength(2);
    expect(outcome.aggregates[1]).toEqual({ label: 'nations', count: 1 });
  });

  it('shows only a handful of wrong answers', () => {
    const outcome = fillInTheBlank.scoreRound(
      roundFor('world'),
      ['one', 'two', 'three', 'four', 'five'].map((text, index) => answer(`p-${index}`, text)),
      { seats: [], log: [] }
    );

    expect(outcome.aggregates).toHaveLength(4);
  });

  it('hands the reveal the reference and the verse around the word', () => {
    const outcome = fillInTheBlank.scoreRound(roundFor('world'), [], { seats: [], log: [] });
    const detail = outcome.detail as BlankReveal;

    expect(detail.reference).toBe('John 3:16');
    expect(detail.word).toBe('world');
    expect(`${detail.before}${detail.word}${detail.after}`).toBe(
      'For God so loved the world, that he gave his only begotten Son.'
    );
  });
});

describe('what the module tells the catalog', () => {
  it('names itself descriptively and plays alone', () => {
    expect(fillInTheBlank.id).toBe('fill-in-the-blank');
    expect(fillInTheBlank.supportsSolo).toBe(true);
    expect(fillInTheBlank.usesBuzz).toBeUndefined();
  });
});

describe('drawing from the curated pool', () => {
  /**
   * The pool is the difference between a game about John 3:16 and a game about
   * the back half of Judges, so what is being checked here is not that a verse
   * arrives but that it is one somebody chose.
   */
  function curate(...references: readonly string[]): void {
    importContent(library.db, {
      verses: references.map((reference) => ({ reference, difficulty: 1 })),
    });
  }

  it('asks about a curated verse rather than whatever the module happens to hold', () => {
    curate('Genesis 1:1');

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const round = fillInTheBlank.buildRound(
        context(sequence([0.5, 0.2, 0.7]), { familiarity: 'core' }),
        0
      );
      expect(round.secret?.verseId).toBe(toVerseId(1, 1, 1));
    }
  });

  it('does not ask about the same verse twice in one game', () => {
    curate('Genesis 1:1', 'Genesis 1:2', 'John 3:16');
    const random = sequence([0.13, 0.51, 0.77, 0.29, 0.94, 0.36]);
    const built: Round<BlankSecret | null>[] = [];

    for (let index = 0; index < 3; index += 1) {
      built.push(
        fillInTheBlank.buildRound(context(random, { familiarity: 'core' }, built), index)
      );
    }

    const asked = built.map((round) => round.secret?.verseId);
    expect(new Set(asked).size).toBe(3);
  });

  it('still plays from the whole canon when the host asked for the whole canon', () => {
    curate('Genesis 1:1');
    const seen = new Set<number | undefined>();

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const round = fillInTheBlank.buildRound(
        context(sequence([attempt / 20, 0.3, 0.6]), { familiarity: 'any' }),
        0
      );
      seen.add(round.secret?.verseId);
    }

    expect(seen.size).toBeGreaterThan(1);
  });
});
