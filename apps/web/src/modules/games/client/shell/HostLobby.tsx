/**
 * The lobby as it appears on the projector.
 *
 * The code is the largest thing on the screen because it is read from the back
 * row, and the QR sits beside it rather than instead of it — a phone camera
 * pointed at a bright projector is unreliable in exactly the rooms this runs
 * in. Settings live on this screen and nowhere else: once a game starts the
 * host has a room to run and no attention left for a settings panel.
 */

import type {
  Catalog,
  Familiarity,
  GameId,
  RoomSettings,
  ScreenSnapshot,
} from '../../shared/protocol.js';
import { FAMILIARITIES, FAMILIARITY_LABELS, TEAM_IDS } from '../../shared/protocol.js';
import { Brand } from './Brand.js';
import { QrCode } from './QrCode.js';
import { ThemeEditor } from './ThemeEditor.js';
import { listGameViews } from './gameViews.js';
import { TEAM_LABELS } from './teams.js';
import { gt } from './t.js';

const ROUND_CHOICES = [5, 8, 10, 12, 15, 20];
const SECOND_CHOICES = [10, 15, 20, 30, 45, 60, 90];

export interface HostLobbyProps {
  snapshot: ScreenSnapshot;
  catalog: Catalog;
  /**
   * False until the catalog request has answered — an empty catalog before
   * then just means "still loading", not "nothing is installed", and only
   * the second is worth a warning.
   */
  catalogLoaded: boolean;
  joinUrl: string;
  /** Whether this screen opened with the room's owner token, rather than a display token. */
  isOwner: boolean;
  onSettings(settings: Partial<RoomSettings>): void;
  onStart(): void;
  onReclaim(): void;
  /**
   * "Play too, and run it from here" (§8.1 of the design): joins this device
   * as a player, hands it control, and switches to the player route. Present
   * only on the owner credential — nobody else can grant control away.
   */
  onPlayToo?(): void;
}

interface GameChoice {
  id: GameId;
  name: string;
}

/** `fill-in-the-blank` -> `Fill in the blank`, a readable stand-in for the catalog's own name. */
function nameFromId(id: GameId): string {
  const words = id.split('-');
  return words.map((word, index) => (index === 0 ? `${word.charAt(0).toUpperCase()}${word.slice(1)}` : word)).join(' ');
}

/**
 * The catalog is authoritative, but the room has to be configurable before the
 * server has answered — and a client that has views for a game can at least
 * name it, rather than showing its raw kebab-case id.
 */
function gameChoices(catalog: Catalog, current: GameId): GameChoice[] {
  const byId = new Map<GameId, GameChoice>();
  for (const views of listGameViews()) byId.set(views.id, { id: views.id, name: nameFromId(views.id) });
  for (const game of catalog.games) byId.set(game.id, { id: game.id, name: game.name });
  if (!byId.has(current)) byId.set(current, { id: current, name: nameFromId(current) });
  return [...byId.values()];
}

export function HostLobby({
  snapshot,
  catalog,
  catalogLoaded,
  joinUrl,
  isOwner,
  onSettings,
  onStart,
  onReclaim,
  onPlayToo,
}: HostLobbyProps) {
  const { code, players, settings, controller } = snapshot;
  const noBibleModule = catalogLoaded && catalog.translations.length === 0;
  const games = gameChoices(catalog, settings.gameId);
  const sets = catalog.sets.filter((set) => set.gameId === null || set.gameId === settings.gameId);
  const translations = catalog.translations.includes(settings.translation)
    ? catalog.translations
    : [settings.translation, ...catalog.translations];
  const seconds = Math.round(settings.answerWindowMs / 1000);
  // Present only while this credential holds control (see `ScreenSnapshot.control`).
  // A display screen, or an owner who has handed control to a phone, reads
  // this lobby but cannot act on it.
  const controlling = snapshot.control !== undefined;
  const canStart = controlling && (players.length > 0 || settings.solo);
  const currentGame = catalog.games.find((game) => game.id === settings.gameId);
  // Unknown until the catalog answers, and then only a game that offers a vote
  // gets a switch for one: a toggle that did nothing would be a small lie.
  const voteMode = currentGame?.groupVote ?? 'none';
    // Before the catalog answers, show every field rather than guess one away;
  // once it has, hide whichever this game does not read at all — Translation
  // stays put for who-said-it but not who-am-i, say, and Set is gone for
  // every game here, since none of them have per-set content to choose.
  const showFamiliarity = currentGame?.usesFamiliarity ?? true;
  const showTranslation = currentGame?.usesTranslation ?? true;
  const showSet = currentGame?.usesSet ?? true;
  const controllerName =
    controller.kind === 'player'
      ? (players.find((player) => player.id === controller.playerId)?.name ?? gt('games.host.someone', 'Someone'))
      : null;

  return (
    <main class="screen screen-host-lobby">
      <header class="host-join">
        <div class="host-join-text">
          <Brand />
          <p class="join-at">
            {gt('games.host.joinAt', 'Join at')} <strong>{joinUrl.replace(/^https?:\/\//, '')}</strong>
          </p>
          <p class="code-label">{gt('games.host.code', 'Code')}</p>
          <p class="big-code" aria-label={gt('games.host.roomCodeAria', 'Room code {code}', { code: code.split('').join(' ') })}>
            {code}
          </p>
        </div>
        <QrCode url={joinUrl} label={gt('games.host.qrLabel', 'QR code to join room {code}', { code })} />
      </header>

      {noBibleModule && (
        <p class="alert" role="alert">
          {gt('games.lobby.noBibleBefore', 'No Bible module is installed on this server — verse-based games will run their full round showing nothing. See')}{' '}
          <code>docs/deploy.md</code>{' '}
          {gt('games.lobby.noBibleAfter', 'to install one, or pick a game that does not need one.')}
        </p>
      )}

      {!controlling && (
        <p class="not-controlling muted">
          {controllerName !== null
            ? gt('games.host.runningBy', '{name} is running the room.', { name: controllerName })
            : gt('games.host.runningByOwner', "The room's owner is running it.")}
          {isOwner && (
            <button type="button" class="btn-quiet" onClick={onReclaim}>
              {gt('games.common.takeBackControl', 'Take back control')}
            </button>
          )}
        </p>
      )}

      {isOwner && onPlayToo !== undefined && controlling && (
        <button type="button" class="btn-quiet" onClick={onPlayToo}>
          {gt('games.host.playToo', 'Play too, and run it from here')}
        </button>
      )}

      <section class="host-settings">
        <h2 class="small-heading">{gt('games.lobby.settings', 'Settings')}</h2>
        <fieldset class="settings-grid" disabled={!controlling}>
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
            {/* Published and, until now, never shown anywhere a host would see it. */}
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
              {/*
                Labelled for the verses, not for the room: a host choosing this in
                front of a group must never look like they are grading it.
              */}
              <span class="field-label">{gt('games.lobby.howWellKnown', 'How well known')}</span>
              <select
                value={settings.familiarity}
                onChange={(event) =>
                  onSettings({ familiarity: event.currentTarget.value as Familiarity })
                }
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
              onChange={(event) =>
                onSettings({ answerWindowMs: Number(event.currentTarget.value) * 1000 })
              }
            >
              {SECOND_CHOICES.map((value) => (
                <option key={value} value={String(value)}>
                  {gt('games.lobby.secondsShort', '{value}s', { value })}
                </option>
              ))}
            </select>
          </label>

          <div class="field">
            <span class="field-label">{gt('games.lobby.teams', 'Teams')}</span>
            <button
              type="button"
              aria-pressed={settings.teamsEnabled}
              onClick={() => onSettings({ teamsEnabled: !settings.teamsEnabled })}
            >
              {settings.teamsEnabled
                ? gt('games.lobby.teamsOn', 'On — {teams}', { teams: TEAM_IDS.map((id) => TEAM_LABELS[id]).join(', ') })
                : gt('games.common.off', 'Off')}
            </button>
          </div>

          {voteMode === 'optional' && (
            <div class="field">
              <span class="field-label">{gt('games.lobby.voteTogether', 'Vote together')}</span>
              <button
                type="button"
                aria-pressed={settings.groupVote}
                onClick={() => onSettings({ groupVote: !settings.groupVote })}
              >
                {settings.groupVote
                  ? settings.teamsEnabled
                    ? gt('games.lobby.voteOnTeam', 'On — each team agrees one answer')
                    : gt('games.lobby.voteOnRoom', 'On — the room agrees one answer')
                  : gt('games.common.off', 'Off')}
              </button>
            </div>
          )}
          {voteMode === 'always' && (
            <p class="field vote-notice" role="note">
              {settings.teamsEnabled
                ? gt('games.lobby.voteNoticeTeam', "Each team votes together: the majority answer is everyone's.")
                : gt('games.lobby.voteNoticeRoom', "The room votes together: the majority answer is everyone's.")}
            </p>
          )}

          {settings.gameId === 'sword-drill' && (
            <div class="field">
              {/*
                Sword drill's own setting (`gameOptions.buzzMode`), read the
                same way its own client reads it (`buzzModeOf` in
                games/sword-drill/payload.ts) — duplicated rather than
                imported, since the shell does not reach into a game's own
                directory. Defaults to the host calling readers on: a tap
                race is a poor proxy for who actually found it first, and the
                button mechanic is offered as a fallback, not the assumed
                experience.
              */}
              <span class="field-label">{gt('games.lobby.buzzLabel', 'How players buzz in')}</span>
              <button
                type="button"
                aria-pressed={settings.gameOptions['buzzMode'] === 'buttons'}
                onClick={() =>
                  onSettings({
                    gameOptions: {
                      ...settings.gameOptions,
                      buzzMode: settings.gameOptions['buzzMode'] === 'buttons' ? 'hostCalls' : 'buttons',
                    },
                  })
                }
              >
                {settings.gameOptions['buzzMode'] === 'buttons'
                  ? gt('games.lobby.buzzButtons', 'Phone buttons — everyone races to tap Found it')
                  : gt('games.lobby.buzzHostCalls', 'Host calls — no phone button, you call on whoever found it')}
              </button>
            </div>
          )}

          <div class="field field-wide">
            <ThemeEditor
              theme={settings.theme}
              onChange={(theme) => onSettings({ theme })}
              label={gt('games.lobby.roomTheme', 'Room theme')}
            />
          </div>
        </fieldset>
      </section>

      <section class="host-players">
        <h2 class="small-heading">{gt('games.host.players', 'Players ({total})', { total: players.length })}</h2>
        {players.length === 0 ? (
          <p class="muted">{gt('games.host.nobodyYet', 'Nobody has joined yet.')}</p>
        ) : (
          <ul class="name-grid">
            {players.map((player) => (
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

      <button class="btn-primary btn-start" type="button" disabled={!canStart} onClick={onStart}>
        {gt('games.common.startGame', 'Start game')}
      </button>
      {controlling && !canStart && <p class="muted centre">{gt('games.host.waitingFirst', 'Waiting for the first player.')}</p>}
    </main>
  );
}
