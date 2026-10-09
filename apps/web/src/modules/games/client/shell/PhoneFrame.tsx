/**
 * The chrome every phone screen sits inside.
 *
 * Rank is deliberately conditional. A player is told they are third; a player
 * who is ninth of twelve is told their points and their total and nothing else,
 * because a number that only says "you are near the bottom" is the sort of
 * thing that stops someone joining in next week. The server already withholds
 * a rank outside the top three — the check here is belt and braces, not the
 * enforcement.
 */

import type { ComponentChildren } from 'preact';
import type { PersonalResult, PlayerSnapshot } from '../../shared/protocol.js';
import { PhoneHeaderActions } from './PhoneHeaderActions.js';
import { TimerBar } from './TimerBar.js';
import { ordinal, teamColour, teamLabel } from './teams.js';
import type { ThemeControl } from './theme.js';
import type { StreamStatus } from './useRoomStream.js';
import { gt } from './t.js';

/** The top three is the whole of what a phone may be told about its position. */
export const RANK_SHOWN_THROUGH = 3;

export function rankToShow(rank: number | null): number | null {
  return rank !== null && rank >= 1 && rank <= RANK_SHOWN_THROUGH ? rank : null;
}

/**
 * The theme/settings/leave icons, shared with the lobby — only where there is
 * a room to leave and a room theme to override. Solo has neither: no other
 * viewer to hand the room to, and its own dedicated controls already cover
 * "done", so it renders `PhoneFrame` without this and keeps its chrome as it
 * was.
 */
export interface PhoneChromeActions {
  joinUrl: string;
  themeControl: ThemeControl;
  onLeave(): void;
}

export interface PhoneFrameProps {
  snapshot: PlayerSnapshot;
  yourResult: PersonalResult | null;
  status: StreamStatus;
  /** Short-circuits the backoff wait — `useRoomStream`'s own `reconnectNow`. */
  onReconnectNow(): void;
  actions?: PhoneChromeActions;
  children: ComponentChildren;
}

export function PhoneFrame({
  snapshot,
  yourResult,
  status,
  onReconnectNow,
  actions,
  children,
}: PhoneFrameProps) {
  const { code, round, totalRounds, paused, phase, phaseEndsAt, settings, you } = snapshot;
  // `round` is the index intents carry, counted from zero. People count from
  // one, and a lobby is not question zero of ten — it is not a question yet.
  const inRound = phase !== 'lobby' && phase !== 'summary';
  const rank = rankToShow(snapshot.yourRank);

  return (
    <div
      class="phone"
      // A hook for the compact layout a game may adopt when it can leave the
      // question to a screen (see `SnapshotCommon.questionOnScreen`) — the
      // frame itself renders identically either way; only a game that reads
      // this changes what it draws below it.
      data-question-on-screen={snapshot.questionOnScreen}
      style={{ '--team': teamColour(you.teamId) }}
    >
      <header class="phone-chrome">
        <div class="chrome-row">
          <span class="chrome-code" aria-label={gt('games.frame.roomAria', 'Room {code}', { code: code.split('').join(' ') })}>
            #{code}
          </span>
          {inRound && (
            <span class="chrome-round">
              {snapshot.chrome?.roundWord ?? 'Q'} {round + 1} / {totalRounds}
            </span>
          )}
          {settings.teamsEnabled && (
            <span class="team-chip" data-team={you.teamId ?? 'none'}>
              {teamLabel(you.teamId)}
            </span>
          )}
          {actions && (
            <PhoneHeaderActions
              code={code}
              joinUrl={actions.joinUrl}
              themeControl={actions.themeControl}
              onLeave={actions.onLeave}
            />
          )}
        </div>
        <TimerBar endsAt={phaseEndsAt} durationMs={snapshot.phaseDurationMs} paused={paused} />
      </header>

      {status === 'reconnecting' && (
        <p class="banner" role="status">
          {gt('games.common.reconnecting', 'Reconnecting…')}
          <button type="button" class="btn-quiet banner-retry" onClick={onReconnectNow}>
            {gt('games.common.retryNow', 'Retry now')}
          </button>
        </p>
      )}

      <main class="phone-body">{children}</main>

      <footer class="phone-score">
        <span class="score-total">
          {gt('games.frame.total', 'Total')} <strong>{snapshot.yourScore}</strong>
        </span>
        {yourResult !== null && (
          <span class="score-delta" data-correct={yourResult.correct ? 'true' : 'false'}>
            {yourResult.pointsAwarded >= 0 ? '+' : ''}
            {yourResult.pointsAwarded}
          </span>
        )}
        {rank !== null && <span class="score-rank">{ordinal(rank)}</span>}
      </footer>
    </div>
  );
}
