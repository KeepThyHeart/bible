/**
 * Reading the wire.
 *
 * A payload from an older or newer server, or from another game, must read as
 * nothing rather than as a half-formed turn: a guesser view with no describer
 * would draw "Someone is describing" over a card that belongs to somebody.
 */

import { describe, expect, it } from 'vitest';
import { readHostTurn, readPhoneTurn, readReveal, teamOf } from './payload.js';

const CARD = { concept: 'Burning bush', category: 'event', forbidden: ['Moses', 'flames', 'sandals', 'holy'] };

describe('the big screen’s payload', () => {
  it('reads a turn', () => {
    expect(
      readHostTurn({ role: 'host', teamId: 'blue', describer: 'p-1', got: ['Noah’s ark'], deckOut: false, deckSize: 40 })
    ).toEqual({ role: 'host', teamId: 'blue', describer: 'p-1', got: ['Noah’s ark'], deckOut: false, deckSize: 40 });
  });

  it('reads a phone’s payload, or anything else, as nothing', () => {
    expect(readHostTurn({ role: 'describer', card: CARD })).toBeNull();
    expect(readHostTurn(null)).toBeNull();
    expect(readHostTurn('host')).toBeNull();
  });

  it('drops anything in the list of cards got that is not a card', () => {
    expect(readHostTurn({ role: 'host', got: ['Noah’s ark', 3, null] })?.got).toEqual(['Noah’s ark']);
  });
});

describe('a phone’s payload', () => {
  it('reads the describer’s card and the index a tap must carry', () => {
    expect(
      readPhoneTurn({ role: 'describer', teamId: 'red', card: CARD, cardIndex: 3, deckOut: false, called: true })
    ).toEqual({ role: 'describer', teamId: 'red', card: CARD, cardIndex: 3, deckOut: false, called: true });
  });

  it('reads a card with no concept as no card', () => {
    const view = readPhoneTurn({ role: 'watcher', describer: 'p-1', card: { concept: '' }, cardIndex: 2 });
    expect(view).toMatchObject({ role: 'watcher', card: null });
  });

  it('refuses a guesser or watcher who is not told whom to listen to', () => {
    expect(readPhoneTurn({ role: 'guesser', gotCount: 2 })).toBeNull();
    expect(readPhoneTurn({ role: 'watcher', card: CARD })).toBeNull();
  });

  it('reads a card index that is not a count as the first card', () => {
    expect(readPhoneTurn({ role: 'describer', card: CARD, cardIndex: -4 })).toMatchObject({ cardIndex: 0 });
    expect(readPhoneTurn({ role: 'describer', card: CARD, cardIndex: '2' })).toMatchObject({ cardIndex: 0 });
  });

  it('reads an unknown role as nothing', () => {
    expect(readPhoneTurn({ role: 'judge' })).toBeNull();
  });
});

describe('the reveal', () => {
  it('reads what was got and who is next', () => {
    expect(
      readReveal({ teamId: 'blue', describer: 'p-1', got: ['a', 'b'], deckOut: false, next: { teamId: 'gold', describer: 'p-2' } })
    ).toEqual({ teamId: 'blue', describer: 'p-1', got: ['a', 'b'], deckOut: false, next: { teamId: 'gold', describer: 'p-2' } });
  });

  it('reads a next turn with nobody to describe it as no next turn', () => {
    expect(readReveal({ got: [], next: { teamId: 'gold' } })?.next).toBeNull();
  });
});

describe('a team', () => {
  it('is one the shell knows, or none', () => {
    expect(teamOf('green')).toBe('green');
    expect(teamOf('purple')).toBeNull();
    expect(teamOf(null)).toBeNull();
  });
});
