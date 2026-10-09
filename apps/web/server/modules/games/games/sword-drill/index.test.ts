/**
 * The round and what it is worth.
 *
 * What is worth pinning down here is less the arithmetic than the promises it
 * keeps: the verse never reaches a screen before the reveal, every confirmed
 * find is worth the same however late the tap, and a player the host never
 * ruled on leaves no trace at all — no points, and no mark.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import type { AnswerValue, PlayerId, RoomSettings } from '../../../../../src/modules/games/shared/protocol.js';
import { DEFAULT_THEME } from '../../../../../src/modules/games/shared/theme.js';
import type { Round, RoundBuildContext, ScoredAnswer } from '../../../../../src/modules/games/shared/games.js';
import { formatRef, toVerseId } from '../../../../../src/modules/games/shared/verseId.js';
import { ContentLibrary, importContent, useContent } from '../../content/index.js';
import { makeTempDir, removeTempDir, writeFixtureModule } from '../../content/fixtures.js';
import {
  CONFIRMED_LABEL,
  GAME_ID,
  MIN_SEARCH_MS,
  PASSED_NOTE,
  POINTS,
  scoreSwordDrill,
  swordDrill,
  verdictOf,
} from './index.js';
import type { SwordDrillReveal, SwordDrillSecret, SwordDrillView, Verdict } from './index.js';

/** A fixed sequence, so a round built from it is a round that can be asserted on. */
function sequence(values: readonly number[]): () => number {
  let index = 0;
  return () => values[index++ % values.length] ?? 0;
}

function settings(overrides: Partial<RoomSettings> = {}): RoomSettings {
  return {
    gameId: GAME_ID,
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
  previous: readonly Round<SwordDrillSecret | null>[] = []
): RoundBuildContext<SwordDrillSecret | null> {
  return { settings: settings(overrides), random, previous, choice: null };
}

function viewOf(round: Round<SwordDrillSecret | null>): SwordDrillView {
  return round.playerView as SwordDrillView;
}

const FOUND: AnswerValue = { type: 'found' };

/** A phone's "found it", as the room hands it over when it attaches no ruling. */
function unruled(playerId: PlayerId, at = 1_000): ScoredAnswer {
  return { playerId, value: FOUND, at, openedAt: 0 };
}

/** The same, with the host's ruling carried alongside. */
function ruled(playerId: PlayerId, verdict: Verdict, at = 1_000): ScoredAnswer {
  return { playerId, value: FOUND, at, openedAt: 0, verdict };
}

const ROMANS: SwordDrillSecret = {
  verseId: toVerseId(45, 8, 28),
  reference: 'Romans 8:28',
  text: 'And we know that all things work together for good to them that love God.',
  translation: 'KJV',
};

let directory: string;
let library: ContentLibrary;
let previous: ContentLibrary | null;

beforeEach(() => {
  directory = makeTempDir('sword-drill-');
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
  it('puts the reference on both screens', () => {
    const round = swordDrill.buildRound(context(sequence([0.5])), 0);
    const secret = round.secret;

    expect(secret).not.toBeNull();
    expect(viewOf(round).reference).toBe(formatRef(secret?.verseId ?? 0));
    expect((round.hostView as { reference: string } | null)?.reference).toBe(
      viewOf(round).reference
    );
  });

  it('keeps the verse itself off the player, but gives it to the host from the start', () => {
    const round = swordDrill.buildRound(context(sequence([0.5])), 0);
    const text = round.secret?.text ?? 'unreachable';

    // On a phone, the verse would let everybody read it aloud without opening
    // a Bible; the host is the deliberate exception (see the module doc
    // comment), so they can confirm a reader's citation the moment it is
    // spoken.
    expect(Object.keys(viewOf(round)).sort()).toEqual(['reference', 'translation']);
    expect(JSON.stringify(round.playerView)).not.toContain(text);
    expect(JSON.stringify(round.hostView)).toContain(text);
  });

  it('gives the host a genuinely different view object, carrying the verse text alongside the reference', () => {
    const round = swordDrill.buildRound(context(sequence([0.5])), 0);
    const secret = round.secret;

    expect(Object.keys(round.hostView as object).sort()).toEqual([
      'reference',
      'text',
      'translation',
    ]);
    expect((round.hostView as { text: string }).text).toBe(secret?.text);
    expect((round.hostView as { reference: string }).reference).toBe(secret?.reference);
    expect((round.hostView as { translation: string }).translation).toBe(secret?.translation);
  });

  it('keeps the verse the module actually holds, for the reveal', () => {
    const round = swordDrill.buildRound(context(sequence([0.5])), 0);
    const secret = round.secret;

    expect(secret?.text).toBe(library.verseText(secret?.verseId ?? 0, 'FIX'));
  });

  it('names the translation the room is reading from', () => {
    const round = swordDrill.buildRound(context(sequence([0.5])), 0);

    expect(viewOf(round).translation).toBe('FIX');
  });

  it('gives the room longer to search than it would to type a word', () => {
    const round = swordDrill.buildRound(context(sequence([0.5]), { answerWindowMs: 20_000 }), 0);

    expect(round.questionPhaseMs).toBe(MIN_SEARCH_MS);
  });

  it('gives a host who asked for a longer window the window they asked for', () => {
    const round = swordDrill.buildRound(context(sequence([0.5]), { answerWindowMs: 90_000 }), 0);

    expect(round.questionPhaseMs).toBe(90_000);
  });

  it('draws the same verse from the same generator', () => {
    const first = swordDrill.buildRound(context(sequence([0.12, 0.87])), 3);
    const second = swordDrill.buildRound(context(sequence([0.12, 0.87])), 3);

    expect(first).toEqual(second);
    expect(first.index).toBe(3);
  });
});

describe('drawing from the curated pool', () => {
  function curate(...references: readonly string[]): void {
    importContent(library.db, {
      verses: references.map((reference) => ({ reference, difficulty: 1 })),
    });
  }

  it('sends the room to a curated verse rather than whatever the module happens to hold', () => {
    curate('John 3:16');

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const round = swordDrill.buildRound(
        context(sequence([attempt / 10, 0.4]), { familiarity: 'core' }),
        0
      );
      expect(round.secret?.verseId).toBe(toVerseId(43, 3, 16));
    }
  });

  it('does not send the room to the same verse twice in one game', () => {
    curate('Genesis 1:1', 'Genesis 1:3', 'John 3:16');
    const random = sequence([0.13, 0.51, 0.77, 0.29, 0.94, 0.36]);
    const built: Round<SwordDrillSecret | null>[] = [];

    for (let index = 0; index < 3; index += 1) {
      built.push(swordDrill.buildRound(context(random, { familiarity: 'core' }, built), index));
    }

    expect(new Set(built.map((round) => round.secret?.verseId)).size).toBe(3);
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

  it('builds a round with nothing to find rather than crashing in front of a group', () => {
    const round = swordDrill.buildRound(context(sequence([0.5])), 0);

    expect(round.secret).toBeNull();
    expect(round.hostView).toBeNull();
    expect(round.playerView).toBeNull();
  });

  it('pays and passes over nobody for having looked at an empty screen', () => {
    const round = swordDrill.buildRound(context(sequence([0.5])), 0);
    const outcome = swordDrill.scoreRound(round, [ruled('p-1', 'correct')], { seats: [], log: [] });

    expect(outcome.perPlayer.size).toBe(0);
    expect(outcome.aggregates).toEqual([]);
    expect(outcome.correctLabel).toBe('');
    expect(outcome.detail).toBeNull();
  });
});

describe('scoring what the host heard', () => {
  it('pays every confirmed reader the same, however late they tapped', () => {
    const outcome = scoreSwordDrill(ROMANS, [
      ruled('quick', 'correct', 1_100),
      ruled('slow', 'correct', 40_000),
    ]);

    expect(outcome.perPlayer.get('quick')).toEqual({
      correct: true,
      pointsAwarded: POINTS,
      submitted: FOUND,
      note: null,
    });
    expect(outcome.perPlayer.get('slow')?.pointsAwarded).toBe(POINTS);
  });

  it('tells a reader the host passed on, privately, and pays them nothing', () => {
    const outcome = scoreSwordDrill(ROMANS, [ruled('p-1', 'incorrect')]);

    expect(outcome.perPlayer.get('p-1')).toEqual({
      correct: false,
      pointsAwarded: 0,
      submitted: FOUND,
      note: PASSED_NOTE,
    });
  });

  it('gives no result at all to a reader nobody ruled on', () => {
    const outcome = scoreSwordDrill(ROMANS, [ruled('p-1', 'correct'), unruled('p-2', 2_000)]);

    // Tapping proves nothing, so an unheard tap earns nothing — and marks
    // nothing either, which is what takes away the reason to mash the button.
    expect(outcome.perPlayer.has('p-2')).toBe(false);
  });

  it('confirms nobody while the room hands over no rulings', () => {
    const outcome = scoreSwordDrill(ROMANS, [unruled('p-1', 1_000), unruled('p-2', 2_000)]);

    // Guessing the confirmed reader from arrival order would pay whoever was
    // mid-sentence when the host pressed reveal. Paying nobody is the lesser
    // wrong, and it is loud enough in a playtest to be fixed at the seam.
    expect(outcome.perPlayer.size).toBe(0);
    expect(outcome.aggregates).toEqual([{ label: CONFIRMED_LABEL, count: 0 }]);
  });

  it('keeps a confirmation that a later ruling for the same player would overwrite', () => {
    const outcome = scoreSwordDrill(ROMANS, [
      ruled('p-1', 'correct', 1_000),
      ruled('p-1', 'incorrect', 2_000),
    ]);

    expect(outcome.perPlayer.get('p-1')?.correct).toBe(true);
  });

  it('credits a ruling whatever shape of answer it was given on', () => {
    const typed: ScoredAnswer = {
      playerId: 'p-1',
      value: { type: 'text', text: 'here' },
      at: 1_000,
      openedAt: 0,
      verdict: 'correct',
    };

    // The evidence was spoken aloud; what the phone happened to send is not
    // what the host ruled on.
    expect(scoreSwordDrill(ROMANS, [typed]).perPlayer.get('p-1')?.correct).toBe(true);
  });

  it('reads only the two verdicts a host can give', () => {
    // A ruling the type does not allow, as a room from a newer build might send.
    const odd = { ...ruled('p-1', 'correct'), verdict: 'askToBeSpecific' } as unknown as ScoredAnswer;

    expect(verdictOf(odd)).toBeNull();
    expect(verdictOf(ruled('p-1', 'incorrect'))).toBe('incorrect');
  });
});

describe('what the big screen is told', () => {
  it('leads with the reference and how many were confirmed', () => {
    const outcome = scoreSwordDrill(ROMANS, [
      ruled('p-1', 'correct'),
      ruled('p-2', 'incorrect'),
      ruled('p-3', 'correct'),
    ]);

    expect(outcome.correctLabel).toBe('Romans 8:28');
    expect(outcome.aggregates).toEqual([{ label: CONFIRMED_LABEL, count: 2 }]);
  });

  it('names the confirmed readers in the order they read, and nobody else', () => {
    const outcome = scoreSwordDrill(ROMANS, [
      ruled('second', 'correct', 9_000),
      ruled('passed', 'incorrect', 3_000),
      ruled('first', 'correct', 5_000),
      unruled('unheard', 12_000),
    ]);
    const detail = outcome.detail as SwordDrillReveal;

    expect(detail.confirmed).toEqual(['first', 'second']);
    const published = JSON.stringify({ aggregates: outcome.aggregates, detail });
    expect(published).not.toContain('passed');
    expect(published).not.toContain('unheard');
  });

  it('hands the reveal the verse, the reference and the translation', () => {
    const detail = scoreSwordDrill(ROMANS, []).detail as SwordDrillReveal;

    expect(detail).toEqual({
      reference: 'Romans 8:28',
      text: ROMANS.text,
      translation: 'KJV',
      confirmed: [],
    });
  });
});

describe('what the module tells the catalog', () => {
  it('names itself descriptively and plays through the buzz queue', () => {
    expect(swordDrill.id).toBe('sword-drill');
    expect(swordDrill.usesBuzz).toBe(true);
  });

  it('does not offer solo play, because nobody would be there to hear the reading', () => {
    expect(swordDrill.supportsSolo).toBe(false);
  });
});
