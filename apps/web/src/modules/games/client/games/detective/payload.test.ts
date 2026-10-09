/**
 * Reading a payload the phone cannot vouch for.
 *
 * Every one of these ends as a screen in front of a group, so the reader must
 * turn anything it does not recognise into null rather than into a half-shape
 * a view would trip over.
 */

import { describe, expect, it } from 'vitest';
import type { GroupResult } from '../../../shared/protocol.js';
import {
  DEFAULT_QUESTION,
  WHERE_CAPTIONS,
  groupOf,
  letterFor,
  readHostCase,
  readPhoneCase,
  readReveal,
} from './payload.js';

const OPTIONS = [
  { index: 0, label: 'Aaron' },
  { index: 1, label: 'Moses' },
];

describe('the big screen’s case', () => {
  it('reads the public clue and the names', () => {
    expect(readHostCase({ question: 'Who?', opening: 'I kept a flock', options: OPTIONS })).toEqual({
      question: 'Who?',
      opening: 'I kept a flock',
      options: OPTIONS,
    });
  });

  it('asks the usual question when the payload does not say', () => {
    expect(readHostCase({ opening: 'I kept a flock', options: OPTIONS })?.question).toBe(DEFAULT_QUESTION);
  });

  it('is nothing without a clue or without a name to vote for', () => {
    expect(readHostCase(null)).toBeNull();
    expect(readHostCase({ opening: '', options: OPTIONS })).toBeNull();
    expect(readHostCase({ opening: 'I kept a flock', options: [] })).toBeNull();
    expect(readHostCase({ opening: 'I kept a flock', options: [{ index: 'one', label: 7 }] })).toBeNull();
  });
});

describe('a phone’s case', () => {
  it('reads its clue, whether it is shared, and the names', () => {
    expect(readPhoneCase({ clue: 'I struck the rock', shared: true, options: OPTIONS })).toEqual({
      kind: 'clue',
      clue: 'I struck the rock',
      shared: true,
      options: OPTIONS,
    });
    expect(readPhoneCase({ clue: 'I struck the rock', options: OPTIONS })).toMatchObject({ shared: false });
  });

  it('reads a phone that was not dealt in', () => {
    expect(readPhoneCase({ waiting: true })).toEqual({ kind: 'waiting' });
  });

  it('is nothing for a payload it cannot read', () => {
    expect(readPhoneCase(null)).toBeNull();
    expect(readPhoneCase('clue')).toBeNull();
    expect(readPhoneCase({ clue: 'I struck the rock', options: [] })).toBeNull();
  });
});

describe('the reveal', () => {
  it('reads the person, the names and every clue with where it was', () => {
    expect(
      readReveal({
        person: 'Moses',
        options: ['Aaron', 'Moses', 3],
        correctIndex: 1,
        clues: [
          { text: 'I kept a flock', reference: 'Exodus 3:1', where: 'screen' },
          { text: 'I struck the rock', reference: null, where: 'undealt' },
          { text: 'I was drawn out', reference: 'Exodus 2:10', where: 'somewhere new' },
          { reference: 'Exodus 1:1' },
        ],
      })
    ).toEqual({
      person: 'Moses',
      options: ['Aaron', 'Moses'],
      correctIndex: 1,
      clues: [
        { text: 'I kept a flock', reference: 'Exodus 3:1', where: 'screen' },
        { text: 'I struck the rock', reference: null, where: 'undealt' },
        { text: 'I was drawn out', reference: 'Exodus 2:10', where: 'phones' },
      ],
    });
  });

  it('is nothing without a person', () => {
    expect(readReveal(null)).toBeNull();
    expect(readReveal({ person: '' })).toBeNull();
  });

  it('says where every kind of clue was, in words', () => {
    expect(WHERE_CAPTIONS).toEqual({
      screen: 'on the big screen',
      phones: 'dealt to phones',
      undealt: 'not dealt this time',
    });
  });
});

describe('finding a phone’s own group', () => {
  const red: GroupResult = { teamId: 'red', split: [], decided: null, correct: null };
  const blue: GroupResult = { teamId: 'blue', split: [], decided: 'Moses', correct: true };
  const room: GroupResult = { teamId: null, split: [], decided: 'Moses', correct: true };

  it('is the phone’s own team with teams on', () => {
    expect(groupOf([red, blue], true, 'blue')).toBe(blue);
  });

  it('is the whole room with teams off, whatever team the phone once picked', () => {
    expect(groupOf([room], false, 'red')).toBe(room);
  });

  it('is nothing when the reveal carries no groups', () => {
    expect(groupOf(undefined, false, null)).toBeNull();
    expect(groupOf([], true, 'red')).toBeNull();
  });
});

describe('letters', () => {
  it('names the names A to D, and counts on past the alphabet it has', () => {
    expect([0, 1, 2, 3].map(letterFor)).toEqual(['A', 'B', 'C', 'D']);
    expect(letterFor(9)).toBe('10');
  });
});
