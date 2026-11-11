/**
 * The lobby as the organizer sees it: the game and its length with a way to
 * change it, the roster to arrange before starting, and the one main button.
 * The game code and TV address are here too, small, to read out to the room.
 */

import { useState } from 'preact/hooks';
import type { Catalog, GameId, HostCommand, PlayerSnapshot, RemoteSnapshot } from '../../shared/protocol.js';
import { teamsInPlay } from '../../shared/protocol.js';
import '../styles/organize.css';
import { GamePicker } from './GamePicker.js';
import { GameSetup } from './GameSetup.js';
import { PlayerManager } from './PlayerManager.js';
import { gameTitle } from './gameLabels.js';
import { mainActionFor } from './mainAction.js';
import { tvUrl } from './routes.js';
import { gt } from './t.js';

export interface OrganizerLobbyProps {
  /** The remote's, or a playing organizer's own phone's. */
  snapshot: RemoteSnapshot | PlayerSnapshot;
  catalog: Catalog;
  /**
   * Opens on the game picker rather than the roster — after "Pick another
   * game" at the end of one, which keeps the room and everyone in it.
   */
  startPicking?: boolean;
  onCommand(command: HostCommand): void;
  onNavigate(to: string): void;
}

export function OrganizerLobby({ snapshot, catalog, startPicking = false, onCommand }: OrganizerLobbyProps) {
  const [picking, setPicking] = useState(startPicking);
  // The game the options screen is for: the room's own for Change, or one
  // just picked, which only becomes the room's when the options are saved.
  const [changing, setChanging] = useState<GameId | null>(null);
  const { settings, players, code, totalRounds } = snapshot;
  // Present only while this credential holds control of the room.
  const controlling = snapshot.control !== undefined;

  if (controlling && picking) {
    return (
      <GamePicker
        catalog={catalog}
        onPick={(gameId) => {
          setPicking(false);
          setChanging(gameId);
        }}
        onBack={() => setPicking(false)}
      />
    );
  }

  if (controlling && changing !== null) {
    return (
      <GameSetup
        gameId={changing}
        catalog={catalog}
        initial={{ ...settings, gameId: changing }}
        mode="change"
        onSubmit={(changed) => {
          onCommand({ cmd: 'setSettings', settings: { ...changed, gameId: changing } });
          setChanging(null);
        }}
        onBack={() => {
          setChanging(null);
          if (changing !== settings.gameId) setPicking(true);
        }}
      />
    );
  }

  const main = mainActionFor(snapshot);
  const canStart = controlling && main !== null && (players.length > 0 || settings.solo);
  const teams = settings.teamsEnabled ? teamsInPlay(settings.teamCount) : undefined;
  const tvAddress = tvUrl(location.origin).replace(/^https?:\/\//, '');

  return (
    <main class="screen org-screen">
      <header class="org-lobby-head">
        <p class="org-lobby-game">
          <strong>{gameTitle(catalog, settings.gameId)}</strong>{' '}
          <span class="muted">
            {gt('games.organize.questions', '· {count} questions', { count: totalRounds })}
          </span>
        </p>
        {controlling && (
          <span class="org-lobby-links">
            <button type="button" class="org-link" onClick={() => setChanging(settings.gameId)}>
              {gt('games.organize.change', 'Change')}
            </button>
            <button type="button" class="org-link" onClick={() => setPicking(true)}>
              {gt('games.organize.otherGame', 'Pick another game')}
            </button>
          </span>
        )}
      </header>

      <section class="org-roster">
        <h2 class="small-heading">
          {gt('games.organize.playersTitle', 'Players ({total})', { total: players.length })}
        </h2>
        <PlayerManager
          layout="list"
          players={players}
          onCommand={onCommand}
          {...(teams !== undefined ? { teams } : {})}
        />
        {controlling && settings.teamsEnabled && players.length > 0 && (
          <button type="button" onClick={() => onCommand({ cmd: 'shuffleTeams' })}>
            {gt('games.organize.shuffle', 'Shuffle into teams')}
          </button>
        )}
      </section>

      {!controlling && (
        <p class="muted" role="note">
          {gt('games.organize.notRunning', 'Another player is running this game.')}
        </p>
      )}

      {main !== null && (
        <button
          type="button"
          class="btn-primary"
          disabled={!canStart}
          onClick={() => onCommand(main.command)}
        >
          {main.label}
        </button>
      )}

      <p class="org-join-info muted">
        {gt('games.organize.gameCode', 'Game code')} <strong>{code}</strong>
        {' · '}
        {gt('games.organize.tvAt', 'TV: {address}', { address: tvAddress })}
      </p>
    </main>
  );
}
