/**
 * Reading the wire defensively, and working out where a phone stands.
 *
 * `placeOf` is the one function every screen of this game is decided by, so
 * each of its answers is pinned here, including a confirmation recorded while
 * the round is still open.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BuzzEntry, BuzzState, PublicPlayer } from '../../../shared/protocol.js';
import {
  buzzModeOf,
  confirmedIn,
  namesOf,
  placeOf,
  pressedAt,
  readDrill,
  readReveal,
  tappedCount,
} from './payload.js';

function entry(playerId: string): BuzzEntry {
  return { playerId, correctedAt: 0, arrivedAt: 0, charsSeen: 0, clamped: false };
}

function buzz(queue: string[], spent: string[] = []): BuzzState {
  return {
    queue: queue.map(entry),
    frozenAtChars: null,
    answerDeadline: null,
    spent,
    secondChanceFor: null,
  };
}

/** Buzz state as the room sends it once it has confirmed someone mid-round. */
function withConfirmed(state: BuzzState, confirmed: string[]): BuzzState {
  return { ...state, confirmed };
}

describe('reading the question', () => {
  it('reads a reference and its translation', () => {
    expect(readDrill({ reference: 'Romans 8:28', translation: 'KJV' })).toEqual({
      reference: 'Romans 8:28',
      translation: 'KJV',
    });
  });

  it('reads the verse text too, when the payload carries one — the host, never a player', () => {
    expect(
      readDrill({ reference: 'Romans 8:28', translation: 'KJV', text: 'And we know' })
    ).toEqual({
      reference: 'Romans 8:28',
      translation: 'KJV',
      text: 'And we know',
    });
  });

  it('treats a round with no reference as nothing to find', () => {
    expect(readDrill(null)).toBeNull();
    expect(readDrill({ reference: '' })).toBeNull();
    expect(readDrill({ text: 'For God so loved' })).toBeNull();
  });

  it('does without a translation rather than refusing the round', () => {
    expect(readDrill({ reference: 'Jude 24' })).toEqual({ reference: 'Jude 24', translation: '' });
  });
});

describe('reading the reveal', () => {
  it('keeps the confirmed ids and drops anything that is not one', () => {
    const detail = readReveal({
      reference: 'Romans 8:28',
      text: 'And we know',
      translation: 'KJV',
      confirmed: ['p-1', 7, null, 'p-2'],
    });

    expect(detail?.confirmed).toEqual(['p-1', 'p-2']);
  });

  it('reads nothing from a payload with no reference', () => {
    expect(readReveal({ text: 'And we know', confirmed: [] })).toBeNull();
    expect(readReveal('Romans 8:28')).toBeNull();
  });
});

describe('where a phone stands', () => {
  it('is free to tap before the round has a queue', () => {
    expect(placeOf(null, 'p-1', [])).toEqual({ kind: 'free' });
    expect(placeOf(buzz([]), 'p-1', [])).toEqual({ kind: 'free' });
  });

  it('is reading at the head of the queue and waiting behind it', () => {
    const state = buzz(['p-2', 'p-3', 'p-1']);

    expect(placeOf(state, 'p-2', [])).toEqual({ kind: 'reading' });
    expect(placeOf(state, 'p-1', [])).toEqual({ kind: 'waiting', ahead: 2 });
  });

  it('has been passed on once the host moved past their reading', () => {
    // `spent` is no longer carried on the buzz state itself (see
    // `PublicBuzzState`'s own doc comment) — it arrives separately, as
    // `youAreSpent` for a player's own phone or `ControlPanel.spent` for a
    // controller deciding who to call on.
    expect(placeOf(buzz(['p-2'], ['p-1']), 'p-1', ['p-1'])).toEqual({ kind: 'passed' });
  });

  it('is confirmed when the room says so, even if it also counts them as having had a turn', () => {
    const state = withConfirmed(buzz(['p-2'], ['p-1']), ['p-1']);

    expect(placeOf(state, 'p-1', ['p-1'])).toEqual({ kind: 'confirmed' });
  });

  it('finds no confirmations in buzz state that does not carry them', () => {
    expect(confirmedIn(buzz(['p-1']))).toEqual([]);
    expect(confirmedIn(null)).toEqual([]);
  });
});

describe('what the big screen may count', () => {
  it('counts each phone that tapped once, however its turn went', () => {
    const state = withConfirmed(buzz(['p-3', 'p-4'], ['p-1', 'p-2']), ['p-2']);

    expect(tappedCount(state, ['p-1', 'p-2'])).toBe(4);
    expect(tappedCount(null, [])).toBe(0);
  });

  it('names only players still in the room', () => {
    const players: PublicPlayer[] = [
      { id: 'p-1', name: 'Miriam', teamId: null, connected: true },
      { id: 'p-3', name: 'Ruth', teamId: null, connected: false },
    ];

    expect(namesOf(players, ['p-3', 'p-2', 'p-1'])).toEqual(['Ruth', 'Miriam']);
  });
});

describe('stamping a tap', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the phone's own clock, leaving the correction to the offset posted beside it", () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_700_000_004_321);

    expect(pressedAt()).toBe(1_700_000_004_321);
  });
});

describe('how a room finds out who found it', () => {
  it('defaults to the host calling readers on, when nothing is set', () => {
    expect(buzzModeOf({})).toBe('hostCalls');
  });

  it('switches to buttons only when the room asked for it explicitly', () => {
    expect(buzzModeOf({ buzzMode: 'buttons' })).toBe('buttons');
  });

  it('falls back to host-calls for anything else it does not recognise', () => {
    expect(buzzModeOf({ buzzMode: 'somethingElse' })).toBe('hostCalls');
  });
});
