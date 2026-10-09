/**
 * The chrome every screen sits inside: the room code, the round counter, the
 * answered count, the timer bar and a reconnecting banner. All of it is
 * public and unconditional — shown to a screen whether or not it currently
 * holds control, because it is what makes this device useful as a *display*
 * even when it is not running the room.
 *
 * Control itself — pause/back/next, the room menu, the judge card — lives in
 * `ControlBar` and `ControlPanel`, rendered here only while `snapshot.control`
 * is present. When it is not, this shows who is running the room instead, and,
 * on the owner credential only, a way to take control back.
 */

import { getGameViews } from './gameViews.js';
import { GroupReveal } from './GroupReveal.js';
import { ControlBar } from './ControlBar.js';
import { ControlPanel } from './ControlPanel.js';
import { TimerBar } from './TimerBar.js';
import type { ComponentChildren } from 'preact';
import type {
  HostChrome,
  HostCommand,
  RevealPayload,
  ScreenSnapshot,
  Standing,
} from '../../shared/protocol.js';
import type { StreamStatus } from './useRoomStream.js';
import { gt } from './t.js';

export interface HostFrameProps {
  snapshot: ScreenSnapshot;
  status: StreamStatus;
  /** The latest reveal, for the parts of it the shell draws itself. */
  reveal: RevealPayload | null;
  /**
   * The complete ordering, last place included — `null` until the controller
   * has asked for it this session, via the `requestFullStandings` command
   * sent from `onCommand`. A one-off reply (`standingsFull`), not part of the
   * snapshot: `useRoomStream` holds the latest one it has seen. Only ever
   * filled in while this screen holds control.
   */
  fullStandings: readonly Standing[] | null;
  /**
   * Whether this screen opened with the room's owner token, rather than a
   * display token. Only the owner credential may reclaim control — see
   * `HostToken`'s own doc comment in the protocol.
   */
  isOwner: boolean;
  onCommand(command: HostCommand): void;
  /**
   * Short-circuits the backoff wait and tries the stream again right away —
   * `useRoomStream`'s own `reconnectNow`, wired to a button rather than left
   * for a phone to wake the tab into eventually.
   */
  onReconnectNow(): void;
  children: ComponentChildren;
}

/**
 * Shown in place of the control bar when this device is not the controller:
 * who is, by name when it is a player, and — on the owner credential only —
 * a way to take control back.
 */
function NotControlling({
  controllerLine,
  isOwner,
  onCommand,
}: {
  controllerLine: string;
  isOwner: boolean;
  onCommand(command: HostCommand): void;
}) {
  return (
    <div class="not-controlling">
      <p class="muted">{controllerLine}</p>
      {isOwner && (
        <button type="button" class="btn-quiet" onClick={() => onCommand({ cmd: 'reclaimControl' })}>
          {gt('games.common.takeBackControl', 'Take back control')}
        </button>
      )}
    </div>
  );
}

export function HostFrame({
  snapshot,
  status,
  reveal,
  fullStandings,
  isOwner,
  onCommand,
  onReconnectNow,
  children,
}: HostFrameProps) {
  const { code, round, totalRounds, paused, phase, phaseEndsAt, settings, players, controller } = snapshot;
  // A game whose rounds are not questions words the chrome its own way; every
  // word it leaves out is the shell's.
  const chrome: HostChrome = snapshot.chrome ?? {};
  const playing = phase === 'question' || phase === 'answering';
  // `round` is the index intents carry, counted from zero. People count from
  // one, and a lobby is not question zero of ten — it is not a question yet.
  const inRound = phase !== 'lobby' && phase !== 'summary';
  // Only a reveal of the round on screen: a payload that arrived for the last
  // round must not be drawn under the next one.
  const voted = phase === 'reveal' && reveal?.round === round ? (reveal.groups ?? []) : [];
  // A vote's split is drawn once. A room of one group split exactly as the
  // room did, so a game whose reveal already draws the room's vote keeps it
  // there, and the shell draws team cards only when there are teams to compare.
  const gameDrawsRoomVote = getGameViews(settings.gameId)?.revealDrawsRoomVote === true;
  const groups = gameDrawsRoomVote && voted.length === 1 ? [] : voted;

  const controllerLine =
    controller.kind === 'player'
      ? gt('games.host.runningBy', '{name} is running the room.', {
          name: players.find((player) => player.id === controller.playerId)?.name ?? gt('games.host.someone', 'Someone'),
        })
      : gt('games.host.runningByOwner', "The room's owner is running it.");

  return (
    <div class="host">
      <header class="host-chrome">
        <div class="chrome-row">
          <span class="chrome-code" aria-label={gt('games.host.roomCodeAria', 'Room code {code}', { code: code.split('').join(' ') })}>
            #{code}
          </span>
          {inRound && (
            <span class="chrome-round">
              {chrome.roundWord ?? 'Q'} {round + 1} / {totalRounds}
            </span>
          )}
          {playing && chrome.hideAnswered !== true && (
            <span class="chrome-answered">
              {gt('games.frame.answered', 'Answered {answered} / {total}', { answered: snapshot.answeredCount, total: players.length })}
            </span>
          )}
        </div>
        {status === 'reconnecting' && (
          // Its own row rather than a child of `.chrome-row`: sharing that
          // row with the code and the round and answered counters let a long
          // reconnect banner push them around on a narrow projector.
          <p class="banner banner-row" role="status">
            {gt('games.common.reconnecting', 'Reconnecting…')}
            <button type="button" class="btn-quiet banner-retry" onClick={onReconnectNow}>
              {gt('games.common.retryNow', 'Retry now')}
            </button>
          </p>
        )}
        <TimerBar endsAt={phaseEndsAt} durationMs={snapshot.phaseDurationMs} paused={paused} />
      </header>

      <main class="host-body">
        {children}
        {snapshot.control !== undefined && playing && (
          <button type="button" class="btn-reveal-now" onClick={() => onCommand({ cmd: 'revealNow' })}>
            {chrome.revealLabel ?? gt('games.frame.revealNow', 'Reveal now')}
          </button>
        )}
        {groups.length > 0 && <GroupReveal groups={groups} />}
      </main>

      {snapshot.control !== undefined ? (
        <>
          <ControlPanel pendingJudge={snapshot.control.pendingJudge} onCommand={onCommand} />
          <ControlBar
            common={snapshot}
            panel={snapshot.control}
            reveal={reveal}
            fullStandings={fullStandings}
            onCommand={onCommand}
          />
        </>
      ) : (
        <NotControlling controllerLine={controllerLine} isOwner={isOwner} onCommand={onCommand} />
      )}
    </div>
  );
}
