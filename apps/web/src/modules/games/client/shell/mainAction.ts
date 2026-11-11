/**
 * The organizer's one main button: what it says and what it sends, for
 * whatever the room is doing now. Always the next thing, in the same place,
 * on every device that runs a room — the remote, a playing organizer's phone
 * and the bar a screen-only organizer brings up with the mouse.
 *
 * Pure, so the whole rhythm of a game is one table to test.
 */

import type { HostCommand, SnapshotCommon } from '../../shared/protocol.js';
import { gt } from './t.js';

export interface MainAction {
  label: string;
  command: HostCommand;
}

/**
 * Null when there is nothing to press: the summary, whose choices (play again,
 * pick another game) are drawn by the summary itself.
 */
export function mainActionFor(snapshot: SnapshotCommon): MainAction | null {
  const { phase, paused, round, totalRounds, players, chrome } = snapshot;
  if (paused) return { label: gt('games.organizer.resume', 'Resume'), command: { cmd: 'resume' } };
  switch (phase) {
    case 'lobby':
      return {
        label:
          players.length === 0
            ? gt('games.organizer.startWithNobody', 'Start')
            : gt('games.organizer.startWith', 'Start with {count} players', { count: players.length }),
        command: { cmd: 'start' },
      };
    case 'intro':
      return { label: gt('games.organizer.startNow', 'Start now'), command: { cmd: 'nextRound' } };
    case 'question':
    case 'answering':
      return {
        label: chrome?.revealLabel ?? gt('games.organizer.showAnswer', 'Show the answer'),
        command: { cmd: 'revealNow' },
      };
    case 'reveal':
      return {
        label:
          !snapshot.settings.openEnded && round + 1 >= totalRounds
            ? gt('games.organizer.seeResults', 'See the results')
            : (chrome?.nextLabel ?? gt('games.organizer.nextQuestion', 'Next question')),
        command: { cmd: 'nextRound' },
      };
    case 'summary':
      return null;
  }
}
