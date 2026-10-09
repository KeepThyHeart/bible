/**
 * Reading a payload that might be from a different day, and the numbers the
 * phone shares with the server.
 *
 * None of the payload cases may throw, and none may quietly draw a question
 * with nothing to tap as though it were a real one. The folded answer code is
 * pinned to the same digits the server's suite pins, because the two copies
 * disagreeing would score every answer at the wrong clue.
 */

import { describe, expect, it } from 'vitest';
import { OPTION_SLOTS, decodeChoice, encodeChoice } from './answerCode.js';
import { letterFor, readReveal, readRound, worthAt } from './payload.js';

const ROUND = {
  pacing: 'server',
  clues: ['I lived nine hundred and thirty years', 'I gave names to the cattle'],
  options: [
    { index: 0, label: 'Cain' },
    { index: 1, label: 'Adam' },
  ],
  clueIntervalMs: 7_000,
  answerWindowMs: 17_000,
};

const DETAIL = {
  person: 'Adam',
  clues: [
    { text: 'I lived nine hundred and thirty years', reference: 'Genesis 5:5', gotIt: 2, points: 100 },
    { text: 'I gave names to the cattle', reference: null, gotIt: 1, points: 80 },
  ],
  options: ['Cain', 'Adam'],
  correctIndex: 1,
  gotIt: 3,
};

describe('reading a question', () => {
  it('reads one the server sent', () => {
    const round = readRound(ROUND);

    expect(round?.pacing).toBe('server');
    expect(round?.clues).toHaveLength(2);
    expect(round?.options[1]?.label).toBe('Adam');
    expect(round?.answerWindowMs).toBe(17_000);
  });

  it('refuses anything it cannot draw', () => {
    expect(readRound(null)).toBeNull();
    expect(readRound('a question')).toBeNull();
    expect(readRound({ ...ROUND, clues: [] })).toBeNull();
    expect(readRound({ ...ROUND, options: [] })).toBeNull();
    expect(readRound({ ...ROUND, clueIntervalMs: 0 })).toBeNull();
    expect(readRound({ ...ROUND, answerWindowMs: undefined })).toBeNull();
  });

  it('drops an option or a clue it cannot read rather than the whole question', () => {
    const round = readRound({ ...ROUND, clues: ['A clue', 7, ''], options: [{ index: 0 }, ...ROUND.options] });

    expect(round?.clues).toEqual(['A clue']);
    expect(round?.options).toHaveLength(2);
  });

  it('reads an unfamiliar pace as the room clock', () => {
    expect(readRound({ ...ROUND, pacing: 'whenever' })?.pacing).toBe('server');
    expect(readRound({ ...ROUND, pacing: 'player' })?.pacing).toBe('player');
  });
});

describe('reading a reveal', () => {
  it('reads one the server sent', () => {
    const detail = readReveal(DETAIL);

    expect(detail?.person).toBe('Adam');
    expect(detail?.clues[0]?.reference).toBe('Genesis 5:5');
    expect(detail?.clues[1]?.reference).toBeNull();
    expect(detail?.gotIt).toBe(3);
  });

  it('refuses one with nobody in it', () => {
    expect(readReveal(null)).toBeNull();
    expect(readReveal({ ...DETAIL, person: '' })).toBeNull();
  });

  it('fills in what an older server did not send', () => {
    const detail = readReveal({ person: 'Adam', clues: [{ text: 'A clue', gotIt: 4 }] });

    expect(detail?.options).toEqual([]);
    expect(detail?.correctIndex).toBe(-1);
    expect(detail?.clues[0]?.points).toBe(0);
    expect(detail?.gotIt).toBe(4);
  });
});

describe('captions', () => {
  it('letters the options so a host can say them aloud', () => {
    expect(letterFor(0)).toBe('A');
    expect(letterFor(3)).toBe('D');
    expect(letterFor(9)).toBe('10');
  });

  it('says what a clue is worth on the server scale', () => {
    expect([1, 2, 3, 4, 5].map(worthAt)).toEqual([100, 80, 60, 40, 20]);
    expect(worthAt(8)).toBe(20);
  });
});

describe('folding the clue count into a choice', () => {
  it('pins the arithmetic the server relies on', () => {
    expect(OPTION_SLOTS).toBe(8);
    expect(encodeChoice(3, 2)).toBe(11);
    expect(encodeChoice(0, 5)).toBe(32);
  });

  it('round-trips every option at every clue', () => {
    for (let option = 0; option < 4; option += 1) {
      for (let seen = 1; seen <= 5; seen += 1) {
        expect(decodeChoice(encodeChoice(option, seen))).toEqual({ option, cluesSeen: seen });
      }
    }
  });

  it('never produces a negative index, which the transport would refuse', () => {
    expect(encodeChoice(-2, 0)).toBe(0);
  });
});
