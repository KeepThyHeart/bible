/**
 * The lobby as it appears on the projector.
 *
 * The code is the largest thing on the screen because it is read from the back
 * row, and the QR sits beside it rather than instead of it: a phone camera
 * pointed at a bright projector is unreliable in exactly the rooms this runs
 * in. The screen holds no settings and no buttons; the organizer arranges the
 * game from their own device.
 */

import type { Catalog, ScreenSnapshot } from '../../shared/protocol.js';
import { Brand } from './Brand.js';
import { QrCode } from './QrCode.js';
import { teamLabel } from './teams.js';
import { gt } from './t.js';

export interface HostLobbyProps {
  snapshot: ScreenSnapshot;
  catalog: Catalog;
  /**
   * False until the catalog request has answered: an empty catalog before
   * then just means "still loading", not "nothing is installed", and only
   * the second is worth a warning.
   */
  catalogLoaded: boolean;
  /** The game's name, as the room reads it. */
  gameLabel: string;
  joinUrl: string;
  /** Whether this screen opened with the room's owner token, rather than a display token. */
  isOwner: boolean;
  onReclaim(): void;
}

export function HostLobby({ snapshot, catalog, catalogLoaded, gameLabel, joinUrl, isOwner, onReclaim }: HostLobbyProps) {
  const { code, players, settings, controller } = snapshot;
  const noBibleModule = catalogLoaded && catalog.translations.length === 0;
  // Present only while this credential holds control (see `ScreenSnapshot.control`).
  const controlling = snapshot.control !== undefined;
  const controllerName =
    controller.kind === 'player'
      ? (players.find((player) => player.id === controller.playerId)?.name ?? gt('games.host.someone', 'Someone'))
      : null;
  // The address people type: no scheme and no query, the code is shown beside it.
  const address = joinUrl.replace(/^https?:\/\//, '').replace(/\?.*$/, '');

  return (
    <main class="screen screen-host-lobby">
      <div class="lobby-join">
        <div class="lobby-join-text">
          <Brand />
          <p class="join-at">{gt('games.screen.joinAt', 'Join at {address}', { address })}</p>
          <p class="big-code" aria-label={gt('games.screen.codeAria', 'Game code {code}', { code: code.split('').join(' ') })}>
            {code}
          </p>
        </div>
        <QrCode url={joinUrl} label={gt('games.screen.qrLabel', 'QR code to join game {code}', { code })} />
      </div>

      {noBibleModule && (
        <p class="alert" role="alert">
          {gt('games.lobby.noBibleBefore', 'No Bible module is installed on this server — verse-based games will run their full round showing nothing. See')}{' '}
          <code>docs/deploy.md</code>{' '}
          {gt('games.lobby.noBibleAfter', 'to install one, or pick a game that does not need one.')}
        </p>
      )}

      {!controlling && isOwner && (
        <p class="not-controlling muted">
          {controllerName !== null
            ? gt('games.host.runningBy', '{name} is the organizer.', { name: controllerName })
            : gt('games.host.runningByOwner', "The organizer is running it.")}
          <button type="button" class="btn-quiet" onClick={onReclaim}>
            {gt('games.common.takeBackControl', 'Take back control')}
          </button>
        </p>
      )}

      <section class="lobby-roster" aria-label={gt('games.screen.players', 'Players')}>
        <p class="lobby-next">{gt('games.screen.next', 'Next: {name}', { name: gameLabel })}</p>
        {players.length === 0 ? (
          <p class="muted">{gt('games.screen.waitingForPlayers', 'Waiting for players to join.')}</p>
        ) : (
          <ul class="name-chips">
            {players.map((player) => (
              <li
                key={player.id}
                class="name-chip"
                data-connected={player.connected ? 'true' : 'false'}
                {...(settings.teamsEnabled && player.teamId !== null ? { 'data-team': player.teamId } : {})}
              >
                <span class="name-text" title={player.name}>
                  {player.name}
                </span>
                {!player.connected && <span class="away-marker">{gt('games.common.away', '(away)')}</span>}
                {settings.teamsEnabled && player.teamId !== null && (
                  <span class="team-chip small" data-team={player.teamId}>
                    {teamLabel(player.teamId)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        <p class="lobby-count">
          {players.length === 1
            ? gt('games.screen.onePlayer', '1 player')
            : gt('games.screen.playerCount', '{count} players', { count: players.length })}
        </p>
      </section>
    </main>
  );
}
