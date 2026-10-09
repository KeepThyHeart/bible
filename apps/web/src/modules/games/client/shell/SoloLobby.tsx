/**
 * Solo's own settings screen.
 *
 * Solo used to be permanently fill-in-the-blank at the room's bare defaults
 * — ten rounds, twenty seconds, whatever the last room's familiarity
 * happened to be — with nothing to change before Start, even though the
 * catalog already says which games support solo at all. This is the same
 * `setSettings` path the group lobby uses, narrowed to what solo actually
 * has: no teams, no group vote, no other players to show, and only games
 * that `supportsSolo`.
 */

import type { Catalog, Familiarity, GameId, PlayerSnapshot, RoomSettings } from '../../shared/protocol.js';
import { FAMILIARITIES, FAMILIARITY_LABELS } from '../../shared/protocol.js';
import { Brand } from './Brand.js';
import { gt } from './t.js';

const ROUND_CHOICES = [5, 8, 10, 12, 15, 20];
const SECOND_CHOICES = [10, 15, 20, 30, 45, 60, 90];

/** `fill-in-the-blank` -> `Fill in the blank`, for a game the catalog has not named yet. */
function nameFromId(id: GameId): string {
  const words = id.split('-');
  return words
    .map((word, index) => (index === 0 ? `${word.charAt(0).toUpperCase()}${word.slice(1)}` : word))
    .join(' ');
}

export interface SoloLobbyProps {
  snapshot: PlayerSnapshot;
  catalog: Catalog;
  /** False until the catalog has answered — see the same flag on HostLobby. */
  catalogLoaded: boolean;
  onSettings(settings: Partial<RoomSettings>): void;
  onStart(): void;
  onLeaveSolo(): void;
}

export function SoloLobby({
  snapshot,
  catalog,
  catalogLoaded,
  onSettings,
  onStart,
  onLeaveSolo,
}: SoloLobbyProps) {
  const { settings } = snapshot;
  const noBibleModule = catalogLoaded && catalog.translations.length === 0;
  const soloGames = catalog.games.filter((game) => game.supportsSolo);
  // The catalog is authoritative, but it may not have answered yet, or (in
  // principle) may not offer whatever the room's current game happens to be
  // — either way, the picker always has an entry for what is actually set.
  const games: { id: GameId; name: string }[] = soloGames.some(
    (game) => game.id === settings.gameId
  )
    ? soloGames
    : [...soloGames, { id: settings.gameId, name: nameFromId(settings.gameId) }];
  const currentGame = catalog.games.find((game) => game.id === settings.gameId);
  const showFamiliarity = currentGame?.usesFamiliarity ?? true;
  const showTranslation = currentGame?.usesTranslation ?? true;
  const showSet = currentGame?.usesSet ?? true;
  const sets = catalog.sets.filter((set) => set.gameId === null || set.gameId === settings.gameId);
  const translations = catalog.translations.includes(settings.translation)
    ? catalog.translations
    : [settings.translation, ...catalog.translations];
  const seconds = Math.round(settings.answerWindowMs / 1000);

  return (
    <main class="screen screen-lobby screen-solo-lobby centre">
      <Brand />
      <p class="lobby-name">{gt('games.solo.onYourOwn', 'On your own — nobody else can see this room.')}</p>

      {noBibleModule && (
        <p class="alert" role="alert">
          {gt('games.lobby.noBibleBefore', 'No Bible module is installed on this server — verse-based games will run their full round showing nothing. See')}{' '}
          <code>docs/deploy.md</code>{' '}
          {gt('games.lobby.noBibleAfter', 'to install one, or pick a game that does not need one.')}
        </p>
      )}

      <div class="settings-grid">
        <label class="field">
          <span class="field-label">{gt('games.lobby.game', 'Game')}</span>
          <select
            value={settings.gameId}
            onChange={(event) => onSettings({ gameId: event.currentTarget.value })}
          >
            {games.map((game) => (
              <option key={game.id} value={game.id}>
                {game.name}
              </option>
            ))}
          </select>
          {currentGame?.scopeLabel !== undefined && (
            <span class="field-hint">{currentGame.scopeLabel}</span>
          )}
        </label>

        {showSet && (
          <label class="field">
            <span class="field-label">{gt('games.lobby.set', 'Set')}</span>
            <select
              value={settings.setId ?? ''}
              onChange={(event) =>
                onSettings({ setId: event.currentTarget.value === '' ? null : event.currentTarget.value })
              }
            >
              <option value="">{gt('games.lobby.pickForMe', 'Pick for me')}</option>
              {sets.map((set) => (
                <option key={set.id} value={set.id}>
                  {set.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {showTranslation && (
          <label class="field">
            <span class="field-label">{gt('games.lobby.translation', 'Translation')}</span>
            <select
              value={settings.translation}
              onChange={(event) => onSettings({ translation: event.currentTarget.value })}
            >
              {translations.map((translation) => (
                <option key={translation} value={translation}>
                  {translation}
                </option>
              ))}
            </select>
          </label>
        )}

        {showFamiliarity && (
          <label class="field">
            <span class="field-label">{gt('games.lobby.howWellKnown', 'How well known')}</span>
            <select
              value={settings.familiarity}
              onChange={(event) => onSettings({ familiarity: event.currentTarget.value as Familiarity })}
            >
              {FAMILIARITIES.map((familiarity) => (
                <option key={familiarity} value={familiarity}>
                  {FAMILIARITY_LABELS[familiarity]}
                </option>
              ))}
            </select>
          </label>
        )}

        <label class="field">
          <span class="field-label">{gt('games.lobby.rounds', 'Rounds')}</span>
          <select
            value={String(settings.rounds)}
            onChange={(event) => onSettings({ rounds: Number(event.currentTarget.value) })}
          >
            {ROUND_CHOICES.map((count) => (
              <option key={count} value={String(count)}>
                {count}
              </option>
            ))}
          </select>
        </label>

        <label class="field">
          <span class="field-label">{gt('games.lobby.timePerQuestion', 'Time per question')}</span>
          <select
            value={String(seconds)}
            onChange={(event) => onSettings({ answerWindowMs: Number(event.currentTarget.value) * 1000 })}
          >
            {SECOND_CHOICES.map((value) => (
              <option key={value} value={String(value)}>
                {gt('games.lobby.secondsShort', '{value}s', { value })}
              </option>
            ))}
          </select>
        </label>
      </div>

      <button type="button" class="btn-primary" onClick={onStart}>
        {gt('games.solo.start', 'Start')}
      </button>
      <button type="button" class="btn-quiet" onClick={onLeaveSolo}>
        {gt('games.solo.joinInstead', 'Join a room instead')}
      </button>
    </main>
  );
}
