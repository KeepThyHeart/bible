/**
 * The organizer's half of the search.
 *
 * Shown on whichever device holds control. In the room's default mode the
 * organizer listens for whoever found the verse and taps that player's name,
 * which the reducer treats exactly as that player's own buzz: it queues behind
 * whoever the room is already listening to. Once someone is reading, Confirm
 * scores them and Next in line passes the turn.
 *
 * Both rulings wait until the reader's phone has reported in. That is what puts
 * their "found it" on file for the ruling to land on, and it stops a double tap
 * from confirming the next person before they have said a word. The pending
 * judgement travels only to the device that holds control, so a device that
 * has handed control away never sees these enabled.
 */

import type { ControlViewProps } from '../../shell/gameViews.js';
import { gt } from '../../shell/t.js';
import { buzzModeOf, nameOf, placeOf } from './payload.js';

/**
 * Every connected player not already reading, waiting, spent or confirmed,
 * which is exactly who `placeOf` calls free on their own phone.
 */
function CallOn({ snapshot, send }: ControlViewProps) {
  const spent = snapshot.control?.spent ?? [];
  const candidates = snapshot.players.filter(
    (player) => player.connected && placeOf(snapshot.buzz, player.id, spent).kind === 'free'
  );
  if (candidates.length === 0) return null;

  return (
    <div class="sd-call-on">
      <p class="sd-label">{gt('games.swordDrill.control.whoFoundIt', 'Who found it?')}</p>
      <div
        class="sd-call-on-grid"
        role="group"
        aria-label={gt('games.swordDrill.control.callOn', 'Call on a reader')}
      >
        {candidates.map((player) => (
          <button
            key={player.id}
            type="button"
            class="sd-call-on-button"
            onClick={() => send({ cmd: 'callOn', playerId: player.id })}
          >
            {player.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function Ruling({ snapshot, send }: ControlViewProps) {
  const head = snapshot.buzz?.queue[0];
  if (!head) return null;

  const name = nameOf(snapshot.players, head.playerId) ?? gt('games.swordDrill.control.nextReader', 'The next reader');
  const ready = snapshot.control?.pendingJudge?.playerId === head.playerId;

  return (
    <>
      <div
        class="sd-judge"
        role="group"
        aria-label={gt('games.swordDrill.control.didFindIt', 'Did {name} find it?', { name })}
      >
        <button
          type="button"
          class="sd-confirm"
          disabled={!ready}
          onClick={() => send({ cmd: 'judge', verdict: 'correct' })}
        >
          {gt('games.swordDrill.control.confirm', 'Confirm')}
        </button>
        <button
          type="button"
          class="sd-pass"
          disabled={!ready}
          onClick={() => send({ cmd: 'judge', verdict: 'incorrect' })}
        >
          {gt('games.swordDrill.control.nextInLine', 'Next in line')}
        </button>
      </div>
      {!ready && (
        <p class="sd-hint" role="status">
          {gt('games.swordDrill.control.waitingForPhone', 'Waiting for {name}’s phone…', { name })}
        </p>
      )}
    </>
  );
}

export function ControlSearch(props: ControlViewProps) {
  const { snapshot } = props;
  if (snapshot.phase !== 'question' && snapshot.phase !== 'answering') return null;

  const hostCalls = buzzModeOf(snapshot.settings.gameOptions) === 'hostCalls';
  return (
    <section class="sd sd-control">
      <Ruling {...props} />
      {hostCalls && <CallOn {...props} />}
    </section>
  );
}
