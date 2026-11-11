/**
 * The end of a game on the organizer's own device: the running totals for the
 * session and the three ways to go on. The same component serves the remote
 * and a playing organizer's phone, so the group stays together between games.
 *
 * "Play again" is two commands in order: `newGame` returns the room to its
 * lobby with the settings and the session totals kept, and `start` then opens
 * the next game from that lobby.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import type { ControlPanel, HostCommand } from '../../shared/protocol.js';
import { gt } from './t.js';
import '../styles/phone.css';

/** How many of the session's standings the summary names. */
export const TONIGHT_SHOWN = 3;

export interface OrganizerSummaryProps {
  panel: ControlPanel;
  onCommand(command: HostCommand): void;
  onPickAnother(): void;
}

export function OrganizerSummary({ panel, onCommand, onPickAnother }: OrganizerSummaryProps) {
  const [confirmEnd, setConfirmEnd] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const top = panel.overallStandings.slice(0, TONIGHT_SHOWN);

  useEffect(() => {
    if (confirmEnd) cancelRef.current?.focus();
  }, [confirmEnd]);

  const playAgain = (): void => {
    onCommand({ cmd: 'newGame' });
    onCommand({ cmd: 'start' });
  };

  return (
    <section class="organizer-summary">
      <h2>{gt('games.summary.gameOver', 'Game over')}</h2>

      {top.length > 0 && (
        <div class="tonight">
          <p class="muted small">{gt('games.summary.tonight', 'Tonight so far:')}</p>
          <ol class="tonight-list">
            {top.map((standing) => (
              <li key={standing.playerId}>
                <span class="tonight-name">{standing.name}</span> <strong>{standing.score}</strong>
              </li>
            ))}
          </ol>
        </div>
      )}

      <button type="button" class="btn-primary" onClick={() => onCommand({ cmd: 'continueGame' })}>
        {gt('games.summary.keepGoing', 'Keep going')}
      </button>
      <p class="field-hint">{gt('games.summary.keepGoingHint', 'Same game, same scores.')}</p>
      <button type="button" class="btn-quiet" onClick={playAgain}>
        {gt('games.summary.playAgain', 'Play again')}
      </button>
      <button type="button" class="btn-quiet" onClick={onPickAnother}>
        {gt('games.summary.pickAnother', 'Pick another game')}
      </button>

      {confirmEnd ? (
        <div class="confirm" role="group" aria-label={gt('games.summary.endConfirmLabel', 'End the game for everyone')}>
          <p role="alert">{gt('games.summary.endConfirm', 'End the game for everyone?')}</p>
          <button type="button" class="danger" onClick={() => onCommand({ cmd: 'end' })}>
            {gt('games.summary.endForEveryone', 'End for everyone')}
          </button>
          <button type="button" class="btn-quiet" ref={cancelRef} onClick={() => setConfirmEnd(false)}>
            {gt('games.summary.keepPlaying', 'Cancel')}
          </button>
        </div>
      ) : (
        <button type="button" class="btn-quiet" onClick={() => setConfirmEnd(true)}>
          {gt('games.summary.endForEveryone', 'End for everyone')}
        </button>
      )}
    </section>
  );
}
