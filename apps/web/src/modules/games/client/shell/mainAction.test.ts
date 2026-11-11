import { describe, expect, it } from 'vitest';
import type { PublicPlayer, SnapshotCommon } from '../../shared/protocol.js';
import { mainActionFor } from './mainAction.js';

const player = (id: string): PublicPlayer => ({ id, name: id, teamId: null, connected: true });

function snapshot(overrides: Partial<SnapshotCommon>): SnapshotCommon {
  return {
    phase: 'lobby',
    paused: false,
    round: -1,
    totalRounds: 10,
    players: [player('a'), player('b')],
    settings: { openEnded: false },
    ...overrides,
  } as SnapshotCommon;
}

describe('the main button', () => {
  it.each([
    [{ phase: 'lobby' }, 'Start with 2 players', 'start'],
    [{ phase: 'lobby', players: [] }, 'Start', 'start'],
    [{ phase: 'intro', round: -1 }, 'Start now', 'nextRound'],
    [{ phase: 'question', round: 2 }, 'Show the answer', 'revealNow'],
    [{ phase: 'answering', round: 2 }, 'Show the answer', 'revealNow'],
    [{ phase: 'reveal', round: 2 }, 'Next question', 'nextRound'],
    [{ phase: 'reveal', round: 9 }, 'See the results', 'nextRound'],
    [{ phase: 'answering', paused: true, round: 2 }, 'Resume', 'resume'],
  ] as const)('%o reads %s and sends %s', (overrides, label, cmd) => {
    const action = mainActionFor(snapshot(overrides as Partial<SnapshotCommon>));
    expect(action?.label).toBe(label);
    expect(action?.command.cmd).toBe(cmd);
  });

  it('takes a game’s own words for ending and moving on', () => {
    const chrome = { revealLabel: 'End turn', nextLabel: "Start Blue's turn" };
    expect(mainActionFor(snapshot({ phase: 'answering', round: 1, chrome }))?.label).toBe('End turn');
    expect(mainActionFor(snapshot({ phase: 'reveal', round: 1, chrome }))?.label).toBe("Start Blue's turn");
  });

  it('never offers the results in a game with no set length', () => {
    const settings = { openEnded: true } as SnapshotCommon['settings'];
    expect(mainActionFor(snapshot({ phase: 'reveal', round: 9, settings }))?.label).toBe('Next question');
  });

  it('has nothing to press on the summary', () => {
    expect(mainActionFor(snapshot({ phase: 'summary', round: 9 }))).toBeNull();
  });
});
