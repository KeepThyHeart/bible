/**
 * The chrome every screen sits inside: the game code, the round counter, the
 * answered count, the timer bar and a reconnecting banner. All of it is
 * public and unconditional.
 *
 * Nothing in here can be pressed, apart from the reconnect retry and, on the
 * owner credential while someone else runs the room, a way to take control
 * back. The organizer's controls live on their own device; a screen that holds
 * control draws them as a separate bar (`OrganizerBar`) over this frame.
 */

import { getGameViews } from './gameViews.js';
import { GroupReveal } from './GroupReveal.js';
import { ScoreStrip } from './ScoreStrip.js';
import { TimerBar } from './TimerBar.js';
import type { ComponentChildren } from 'preact';
import type { HostChrome, RevealPayload, ScreenSnapshot } from '../../shared/protocol.js';
import type { StreamStatus } from './useRoomStream.js';
import { gt } from './t.js';
import { useHeadingFocus } from './useHeadingFocus.js';

export interface HostFrameProps {
  snapshot: ScreenSnapshot;
  status: StreamStatus;
  /** The latest reveal, for the parts of it the shell draws itself. */
  reveal: RevealPayload | null;
  /**
   * Whether this screen opened with the room's owner token, rather than a
   * display token. Only the owner credential may reclaim control: see
   * `HostToken`'s own doc comment in the protocol.
   */
  isOwner: boolean;
  onReclaim(): void;
  /**
   * Short-circuits the backoff wait and tries the stream again right away:
   * `useRoomStream`'s own `reconnectNow`, wired to a button rather than left
   * for a phone to wake the tab into eventually.
   */
  onReconnectNow(): void;
  children: ComponentChildren;
}

/**
 * Shown to the owner's screen when someone else is running the room: who is,
 * by name when it is a player, and a way to take control back. Other screens
 * have nothing to do about it and show nothing.
 */
function NotControlling({ controllerLine, onReclaim }: { controllerLine: string; onReclaim(): void }) {
  return (
    <div class="not-controlling">
      <p class="muted">{controllerLine}</p>
      <button type="button" class="btn-quiet" onClick={onReclaim}>
        {gt('games.common.takeBackControl', 'Take back control')}
      </button>
    </div>
  );
}

export function HostFrame({ snapshot, status, reveal, isOwner, onReclaim, onReconnectNow, children }: HostFrameProps) {
  const { code, round, totalRounds, paused, phase, phaseEndsAt, settings, players, controller } = snapshot;
  // The lobby (with the focused Start button) is gone once this frame mounts.
  const bodyRef = useHeadingFocus<HTMLElement>();
  // A game whose rounds are not questions words the chrome its own way; every
  // word it leaves out is the shell's.
  const chrome: HostChrome = snapshot.chrome ?? {};
  const playing = phase === 'question' || phase === 'answering';
  // `round` is the index intents carry, counted from zero. People count from
  // one, and neither a lobby nor the rules are question zero of ten.
  const inRound = phase === 'question' || phase === 'answering' || phase === 'reveal';
  const roundWord = chrome.roundWord ?? gt('games.screen.roundWordShort', 'Q');
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
      ? gt('games.host.runningBy', '{name} is the organizer.', {
          name: players.find((player) => player.id === controller.playerId)?.name ?? gt('games.host.someone', 'Someone'),
        })
      : gt('games.host.runningByOwner', "The organizer is running it.");

  return (
    <div class="host">
      <header class="host-chrome">
        <div class="chrome-row">
          <span class="chrome-code" aria-label={gt('games.screen.codeAria', 'Game code {code}', { code: code.split('').join(' ') })}>
            #{code}
          </span>
          {inRound && (
            <span class="chrome-round">
              {settings.openEnded
                ? gt('games.screen.roundOpen', '{word} {number}', { word: roundWord, number: round + 1 })
                : gt('games.screen.roundOf', '{word} {number} / {total}', { word: roundWord, number: round + 1, total: totalRounds })}
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
        {phase !== 'intro' && phase !== 'summary' && (
          <TimerBar endsAt={phaseEndsAt} durationMs={snapshot.phaseDurationMs} paused={paused} />
        )}
      </header>

      <main class="host-body" tabIndex={-1} ref={bodyRef}>
        {children}
        {groups.length > 0 && <GroupReveal groups={groups} />}
        {phase === 'reveal' && (
          <ScoreStrip
            standings={snapshot.standings}
            teamStandings={snapshot.teamStandings}
            teamsEnabled={settings.teamsEnabled}
          />
        )}
      </main>

      {snapshot.control === undefined && isOwner && (
        <NotControlling controllerLine={controllerLine} onReclaim={onReclaim} />
      )}
    </div>
  );
}
