/**
 * The waiting room on a phone.
 *
 * Everything here answers a question someone is about to ask out loud: am I in?
 * did my name go through? whose team am I on? who else is here? A lobby that
 * answers those silently saves the host from answering them one at a time.
 *
 * The header is deliberately small — a room code, how many are here, and the
 * three icon buttons shared with every in-game screen (`PhoneHeaderActions`)
 * — because this screen's job is the roster below it, not its own chrome.
 */

import { useState } from 'preact/hooks';
import type { PlayerSnapshot, TeamId } from '../../shared/protocol.js';
import { TEAM_IDS } from '../../shared/protocol.js';
import { PhoneHeaderActions } from './PhoneHeaderActions.js';
import { TEAM_LABELS, teamColour } from './teams.js';
import type { ThemeControl } from './theme.js';
import { gt } from './t.js';

export interface PhoneLobbyProps {
  snapshot: PlayerSnapshot;
  onPickTeam(teamId: TeamId): void;
  onLeave(): void;
  themeControl: ThemeControl;
  /** For the QR code in Settings, so someone here can hand the room to someone else. */
  joinUrl: string;
  onRequestControl(): void;
  onWithdrawControlRequest(): void;
  /** Sent once this phone holds control (`snapshot.control` is present). */
  onStart(): void;
}

function UsersIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1.3em" height="1.3em" aria-hidden="true" focusable="false">
      <circle cx="9" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="2" />
      <path
        d="M3.5 20c0-3.6 2.5-6 5.5-6s5.5 2.4 5.5 6"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
      />
      <circle cx="17" cy="9" r="2.3" fill="none" stroke="currentColor" stroke-width="1.8" />
      <path
        d="M15.5 20c0-2.6 1-4.6 2.8-5.4"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
      />
    </svg>
  );
}

/**
 * "Run the game" and its status (§8.1 of the design): a phone asking to be
 * handed control of the room, reachable here in the lobby before the game
 * starts and out of the way once it has. Once this phone actually holds
 * control (`snapshot.control` present), the same spot offers Start instead —
 * there is otherwise no way for a phone-led room to ever begin.
 */
function RunTheGame({
  controlling,
  request,
  canStart,
  onRequestControl,
  onWithdrawControlRequest,
  onStart,
}: {
  controlling: boolean;
  request: PlayerSnapshot['yourControlRequest'];
  canStart: boolean;
  onRequestControl(): void;
  onWithdrawControlRequest(): void;
  onStart(): void;
}) {
  if (controlling) {
    return (
      <button type="button" class="btn-primary btn-start" disabled={!canStart} onClick={onStart}>
        {gt('games.common.startGame', 'Start game')}
      </button>
    );
  }

  if (request === 'pending') {
    return (
      <p class="waiting" role="status">
        {gt('games.phone.waitingYes', 'Waiting for the room to say yes')}
        <button type="button" class="btn-quiet" onClick={onWithdrawControlRequest}>
          {gt('games.phone.neverMind', 'Never mind')}
        </button>
      </p>
    );
  }

  return (
    <div class="run-the-game">
      <p class="waiting" role="status">
        {gt('games.phone.waitingStart', 'Waiting for the room to start')}<span class="dots" aria-hidden="true" />
      </p>
      {request === 'denied' && <p class="muted small">{gt('games.phone.denied', 'Not this time — try again?')}</p>}
      <RunTheGameButton onRequestControl={onRequestControl} />
    </div>
  );
}

/**
 * Its own component so the tap-and-wait state resets whenever the room
 * actually changes `request` (see `RunTheGame`'s key on it below) rather
 * than carrying a stale "already asked" across an unrelated remount.
 * Disabled the instant it is pressed, before the network even answers —
 * one tap sends one `requestControl`, never a flurry from someone who
 * double-tapped or is not sure it registered.
 */
function RunTheGameButton({ onRequestControl }: { onRequestControl(): void }) {
  const [sent, setSent] = useState(false);
  return (
    <button
      type="button"
      class="btn-quiet"
      disabled={sent}
      onClick={() => {
        setSent(true);
        onRequestControl();
      }}
    >
      {gt('games.phone.runTheGame', 'Run the game')}
    </button>
  );
}

export function PhoneLobby({
  snapshot,
  onPickTeam,
  onLeave,
  themeControl,
  joinUrl,
  onRequestControl,
  onWithdrawControlRequest,
  onStart,
}: PhoneLobbyProps) {
  const { code, players, settings, you } = snapshot;
  const others = players.filter((player) => player.id !== you.id);
  const controlling = snapshot.control !== undefined;
  const canStart = players.length > 0;

  return (
    <main class="screen screen-lobby" style={{ '--team': teamColour(you.teamId) }}>
      <header class="chrome-row lobby-header">
        <span class="chrome-code">#{code}</span>
        <span class="lobby-count" aria-label={
            players.length === 1
              ? gt('games.phone.inRoomOne', '{total} person in the room', { total: players.length })
              : gt('games.phone.inRoom', '{total} people in the room', { total: players.length })
          }>
          <UsersIcon />
          {players.length}
        </span>
        <PhoneHeaderActions code={code} joinUrl={joinUrl} themeControl={themeControl} onLeave={onLeave} />
      </header>

      <p class="lobby-name">
        {gt('games.phone.yourName', 'Your name:')} <strong>{you.name}</strong>
      </p>

      {settings.teamsEnabled && (
        <fieldset class="team-picker">
          <legend>{gt('games.phone.team', 'Team')}</legend>
          <div class="team-buttons">
            {TEAM_IDS.map((teamId) => (
              <button
                key={teamId}
                type="button"
                class="team-button"
                data-team={teamId}
                aria-pressed={you.teamId === teamId}
                onClick={() => onPickTeam(teamId)}
              >
                <span class="team-swatch" aria-hidden="true" />
                {TEAM_LABELS[teamId]}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      <RunTheGame
        controlling={controlling}
        request={snapshot.yourControlRequest}
        canStart={canStart}
        onRequestControl={onRequestControl}
        onWithdrawControlRequest={onWithdrawControlRequest}
        onStart={onStart}
      />

      <section class="others">
        <h2 class="small-heading">{gt('games.phone.othersHere', 'Others here')}</h2>
        {others.length === 0 ? (
          <p class="muted">{gt('games.phone.firstHere', 'Nobody else yet. You are first.')}</p>
        ) : (
          <ul class="name-list">
            {others.map((player) => (
              <li key={player.id} data-connected={player.connected ? 'true' : 'false'}>
                <span class="name-text" title={player.name}>
                  {player.name}
                </span>
                {!player.connected && <span class="away-marker">{gt('games.common.away', '(away)')}</span>}
                {settings.teamsEnabled && player.teamId !== null && (
                  <span class="team-chip small" data-team={player.teamId}>
                    {TEAM_LABELS[player.teamId]}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
