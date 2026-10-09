/**
 * Pause/back/next, the room menu, and their confirm dialogs — the part of
 * running a room that changes moment to moment, extracted so it renders
 * identically whether it sits on the screen at the front of the room or on
 * the phone that has been handed control of it (see `ScreenApp` and
 * `PlayApp`). One component, so the two scenarios cannot drift apart.
 *
 * Deliberately small: whoever is holding this has one hand near a device and
 * their eyes on the group, not on a row of buttons. Everything that changes
 * the *room* rather than the round — New game, Close room, the
 * individual-scores switch, the whole session's Overall winners, managing
 * players and the full standings — lives
 * behind the hamburger menu instead: rare enough, and consequential enough,
 * that it should take a deliberate second tap to even find, let alone press.
 *
 * Also carries the one thing every controller needs that neither a screen
 * nor a phone's own snapshot already has a place for: a phone asking to run
 * the room, approved or declined right here.
 */

import { useEffect, useState } from 'preact/hooks';
import type {
  ControlPanel as ControlPanelData,
  HostCommand,
  RevealPayload,
  SnapshotCommon,
  Standing,
} from '../../shared/protocol.js';
import { PlayerManager } from './PlayerManager.js';
import { gt } from './t.js';

export interface ControlBarProps {
  common: SnapshotCommon;
  panel: ControlPanelData;
  /** The latest reveal, for the parts of it this bar draws itself (Back). */
  reveal: RevealPayload | null;
  /**
   * The complete ordering, last place included — `null` until this
   * controller has asked for it, via the `requestFullStandings` command sent
   * from `onCommand`. A one-off reply (`standingsFull`), not part of the
   * snapshot: `useRoomStream` holds the latest one it has seen.
   */
  fullStandings: readonly Standing[] | null;
  onCommand(command: HostCommand): void;
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1.5em" height="1.5em" aria-hidden="true" focusable="false">
      <rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" />
      <rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1.5em" height="1.5em" aria-hidden="true" focusable="false">
      <path d="M7 4l14 8-14 8V4z" fill="currentColor" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1.5em" height="1.5em" aria-hidden="true" focusable="false">
      <path d="M6 5h2v14H6V5zm3.5 7L20 5v14L9.5 12z" fill="currentColor" />
    </svg>
  );
}

function NextIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1.5em" height="1.5em" aria-hidden="true" focusable="false">
      <path d="M16 5h2v14h-2V5zM4 5l10.5 7L4 19V5z" fill="currentColor" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1.5em" height="1.5em" aria-hidden="true" focusable="false">
      <rect x="4" y="6" width="16" height="2" fill="currentColor" />
      <rect x="4" y="11" width="16" height="2" fill="currentColor" />
      <rect x="4" y="16" width="16" height="2" fill="currentColor" />
    </svg>
  );
}

/**
 * The hamburger menu: New game, Close room, the individual-scores switch,
 * and the doors into Overall winners, Manage players and Full standings. Everything here changes the room
 * itself rather than the round in front of it, which is exactly why it is
 * not in the main control bar.
 */
function RoomMenu({
  open,
  playing,
  showIndividualScores,
  onToggleScores,
  onOpenOverall,
  onOpenPlayers,
  onOpenFullStandings,
  onCommand,
  onClose,
}: {
  open: boolean;
  playing: boolean;
  showIndividualScores: boolean;
  onToggleScores(): void;
  onOpenOverall(): void;
  onOpenPlayers(): void;
  onOpenFullStandings(): void;
  onCommand(command: HostCommand): void;
  onClose(): void;
}) {
  const [confirmNewGame, setConfirmNewGame] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);

  if (!open) return null;

  return (
    <div class="host-menu-panel" role="menu" aria-label={gt('games.bar.roomMenu', 'Room menu')}>
      <button type="button" role="menuitem" aria-pressed={showIndividualScores} onClick={onToggleScores}>
        {showIndividualScores
          ? gt('games.bar.scoresEveryone', 'Scores: everyone')
          : gt('games.bar.scoresTopThree', 'Scores: top three')}
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onOpenOverall();
          onClose();
        }}
      >
        {gt('games.bar.overallWinners', 'Overall winners')}
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onOpenPlayers();
          onClose();
        }}
      >
        {gt('games.bar.managePlayers', 'Manage players')}
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onOpenFullStandings();
          onClose();
        }}
      >
        {gt('games.bar.fullStandings', 'Full standings')}
      </button>

      <div class="host-menu-divider" role="separator" />

      {confirmNewGame ? (
        <div class="confirm host-menu-confirm">
          {playing && (
            <p class="host-menu-warning" role="alert">
              {gt('games.bar.notFinished', 'This game is not finished yet.')}
            </p>
          )}
          <button
            type="button"
            class="danger"
            onClick={() => {
              onCommand({ cmd: 'newGame' });
              setConfirmNewGame(false);
              onClose();
            }}
          >
            {gt('games.bar.startNewGame', 'Start a new game')}
          </button>
          <button type="button" onClick={() => setConfirmNewGame(false)}>
            {gt('games.bar.keepPlaying', 'Keep playing')}
          </button>
        </div>
      ) : (
        <button type="button" role="menuitem" onClick={() => setConfirmNewGame(true)}>
          {gt('games.bar.newGame', 'New game')}
        </button>
      )}

      {confirmEnd ? (
        <div class="confirm host-menu-confirm">
          <button
            type="button"
            class="danger"
            onClick={() => {
              onCommand({ cmd: 'end' });
              setConfirmEnd(false);
              onClose();
            }}
          >
            {gt('games.bar.endIt', 'End it')}
          </button>
          <button type="button" onClick={() => setConfirmEnd(false)}>
            {gt('games.bar.keepPlaying', 'Keep playing')}
          </button>
        </div>
      ) : (
        <button type="button" role="menuitem" onClick={() => setConfirmEnd(true)}>
          {gt('games.bar.closeRoom', 'Close room')}
        </button>
      )}
    </div>
  );
}

/** The whole session's top three, folded across every `newGame` this room has played. */
function OverallWinners({
  standings,
  onClose,
}: {
  standings: ControlPanelData['overallStandings'];
  onClose(): void;
}) {
  return (
    <div class="overlay" role="dialog" aria-label={gt('games.bar.overallWinners', 'Overall winners')}>
      <div class="overlay-card">
        <h2 class="overlay-title">{gt('games.bar.overallWinners', 'Overall winners')}</h2>
        {standings.length === 0 ? (
          <p class="muted">{gt('games.bar.nobodyScored', 'Nobody has scored yet.')}</p>
        ) : (
          <ol class="overall-list">
            {standings.map((standing, index) => (
              <li key={standing.playerId} class="overall-row">
                <span class="overall-rank">{index + 1}</span>
                <span class="overall-name">{standing.name}</span>
                <span class="overall-score">{standing.score}</span>
              </li>
            ))}
          </ol>
        )}
        <button type="button" class="btn-primary" onClick={onClose}>
          {gt('games.common.close', 'Close')}
        </button>
      </div>
    </div>
  );
}

/**
 * The complete ordering, last place included — `requestFullStandings` and
 * `standingsFull` were fully plumbed with nothing on any screen that ever
 * asked for one. Requested fresh every time this opens, so it reads the
 * room as it stands right now rather than whatever was last asked for.
 */
function FullStandings({
  standings,
  onClose,
}: {
  standings: readonly Standing[] | null;
  onClose(): void;
}) {
  return (
    <div class="overlay" role="dialog" aria-label={gt('games.bar.fullStandings', 'Full standings')}>
      <div class="overlay-card">
        <h2 class="overlay-title">{gt('games.bar.fullStandings', 'Full standings')}</h2>
        {standings === null ? (
          <p class="muted" role="status">
            {gt('games.bar.askingRoom', 'Asking the room…')}
          </p>
        ) : standings.length === 0 ? (
          <p class="muted">{gt('games.bar.nobodyScored', 'Nobody has scored yet.')}</p>
        ) : (
          <ol class="overall-list">
            {standings.map((standing, index) => (
              <li key={standing.playerId} class="overall-row">
                <span class="overall-rank">{index + 1}</span>
                <span class="overall-name">{standing.name}</span>
                <span class="overall-score">{standing.score}</span>
              </li>
            ))}
          </ol>
        )}
        <button type="button" class="btn-primary" onClick={onClose}>
          {gt('games.common.close', 'Close')}
        </button>
      </div>
    </div>
  );
}

/**
 * A read-only glance at the last question's answer. It is a local memory of
 * the last reveal this bar actually saw, not a request to the room: the
 * room clears its own notion of the last reveal the moment the next round's
 * snapshot arrives (a reveal belongs to one round), so a "Back" built from
 * that would go blank the instant it might be useful. Nothing here can
 * change the room; it only ever reads what already happened.
 */
function LookBack({ reveal, onClose }: { reveal: RevealPayload; onClose(): void }) {
  return (
    <div class="overlay" role="dialog" aria-label={gt('games.bar.previousQuestion', 'Previous question')}>
      <div class="overlay-card">
        <h2 class="overlay-title">{gt('games.bar.lastTime', 'Last time')}</h2>
        <p class="overall-answer">{reveal.correctLabel}</p>
        {reveal.aggregates.length > 0 && (
          <ul class="overall-aggregates">
            {reveal.aggregates.map((row) => (
              <li key={row.label}>
                <span>{row.label}</span>
                <span>{row.count}</span>
              </li>
            ))}
          </ul>
        )}
        <p class="muted small">{gt('games.bar.referenceOnly', 'For reference only — nothing here changes the room.')}</p>
        <button type="button" class="btn-primary" onClick={onClose}>
          {gt('games.common.close', 'Close')}
        </button>
      </div>
    </div>
  );
}

/**
 * A phone asking to run the room, approved or declined with one tap each.
 * More than one can be waiting at once; each is its own line.
 */
function ControlRequests({
  requests,
  onCommand,
}: {
  requests: ControlPanelData['requests'];
  onCommand(command: HostCommand): void;
}) {
  if (requests.length === 0) return null;
  return (
    <div class="control-requests" role="group" aria-label={gt('games.bar.requestsLabel', 'Requests to run the room')}>
      {requests.map((request) => (
        <p key={request.playerId} class="control-request">
          <span>{gt('games.bar.wantsToRun', 'Wants to run the game')}</span>
          <button
            type="button"
            class="btn-primary"
            onClick={() => onCommand({ cmd: 'grantControl', playerId: request.playerId })}
          >
            {gt('games.bar.letThem', 'Let them')}
          </button>
          <button
            type="button"
            onClick={() => onCommand({ cmd: 'denyControl', playerId: request.playerId })}
          >
            {gt('games.bar.no', 'No')}
          </button>
        </p>
      ))}
    </div>
  );
}

export function ControlBar({ common, panel, reveal, fullStandings, onCommand }: ControlBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [showOverall, setShowOverall] = useState(false);
  const [showPlayers, setShowPlayers] = useState(false);
  const [showFullStandings, setShowFullStandings] = useState(false);
  const [showBack, setShowBack] = useState(false);
  const [confirmSkip, setConfirmSkip] = useState(false);
  // The room retires `reveal` the instant the next round's snapshot lands,
  // so a "Back" reading it directly would only ever show the round already
  // on screen. Holding the last one seen here is what makes it survive past
  // that — see `LookBack`'s own doc comment.
  const [lastReveal, setLastReveal] = useState<RevealPayload | null>(null);
  useEffect(() => {
    if (reveal !== null) setLastReveal(reveal);
  }, [reveal]);

  const { paused, phase, settings } = common;
  const playing = phase === 'question' || phase === 'answering';
  const canLookBack = lastReveal !== null && phase !== 'reveal';

  const openFullStandings = (): void => {
    setShowFullStandings(true);
    onCommand({ cmd: 'requestFullStandings' });
  };

  const next = (): void => {
    if (playing) {
      setConfirmSkip(true);
      return;
    }
    onCommand({ cmd: 'nextRound' });
  };

  return (
    <div class="control-bar">
      <ControlRequests requests={panel.requests} onCommand={onCommand} />

      {phase === 'summary' ? (
        // Pause and Next both lose their meaning once the game itself has
        // ended — there is no round left to pause, and "next" has nowhere
        // left to go. Back still does: it is the only way left to recall the
        // final question's answer. New game and Close room, the two things
        // actually worth doing here, stay reachable from the menu.
        <nav class="host-controls" aria-label={gt('games.bar.roomControls', 'Room controls')}>
          <button type="button" class="icon-button" disabled={!canLookBack} onClick={() => setShowBack(true)}>
            <BackIcon />
            <span class="icon-caption">{gt('games.bar.back', 'Back')}</span>
          </button>
          <div class="host-menu">
            <button
              type="button"
              class="icon-button host-menu-toggle"
              aria-haspopup="true"
              aria-expanded={menuOpen}
              aria-label={gt('games.bar.roomMenu', 'Room menu')}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <MenuIcon />
            </button>
            <RoomMenu
              open={menuOpen}
              playing={playing}
              showIndividualScores={settings.showIndividualScores}
              onToggleScores={() =>
                onCommand({
                  cmd: 'setSettings',
                  settings: { showIndividualScores: !settings.showIndividualScores },
                })
              }
              onOpenOverall={() => setShowOverall(true)}
              onOpenPlayers={() => setShowPlayers(true)}
              onOpenFullStandings={openFullStandings}
              onCommand={onCommand}
              onClose={() => setMenuOpen(false)}
            />
          </div>
        </nav>
      ) : (
        <nav class="host-controls" aria-label={gt('games.bar.roomControls', 'Room controls')}>
          <button
            type="button"
            class="icon-button"
            onClick={() => onCommand({ cmd: paused ? 'resume' : 'pause' })}
          >
            {paused ? <PlayIcon /> : <PauseIcon />}
            <span class="icon-caption">{paused ? gt('games.bar.resume', 'Resume') : gt('games.bar.pause', 'Pause')}</span>
          </button>

          <button type="button" class="icon-button" disabled={!canLookBack} onClick={() => setShowBack(true)}>
            <BackIcon />
            <span class="icon-caption">{gt('games.bar.back', 'Back')}</span>
          </button>

          {confirmSkip ? (
            <span class="confirm">
              <button
                type="button"
                class="danger"
                onClick={() => {
                  onCommand({ cmd: 'skip' });
                  setConfirmSkip(false);
                }}
              >
                {gt('games.bar.skipIt', 'Skip it')}
              </button>
              <button type="button" onClick={() => setConfirmSkip(false)}>
                {gt('games.bar.keepGoing', 'Keep going')}
              </button>
            </span>
          ) : (
            <button type="button" class="icon-button" onClick={next}>
              <NextIcon />
              <span class="icon-caption">
                {playing
                  ? gt('games.bar.skip', 'Skip')
                  : (common.chrome?.nextLabel ?? gt('games.bar.nextQuestion', 'Next question'))}
              </span>
            </button>
          )}

          <div class="host-menu">
            <button
              type="button"
              class="icon-button host-menu-toggle"
              aria-haspopup="true"
              aria-expanded={menuOpen}
              aria-label={gt('games.bar.roomMenu', 'Room menu')}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <MenuIcon />
            </button>
            <RoomMenu
              open={menuOpen}
              playing={playing}
              showIndividualScores={settings.showIndividualScores}
              onToggleScores={() =>
                onCommand({
                  cmd: 'setSettings',
                  settings: { showIndividualScores: !settings.showIndividualScores },
                })
              }
              onOpenOverall={() => setShowOverall(true)}
              onOpenPlayers={() => setShowPlayers(true)}
              onOpenFullStandings={openFullStandings}
              onCommand={onCommand}
              onClose={() => setMenuOpen(false)}
            />
          </div>
        </nav>
      )}

      {showOverall && (
        <OverallWinners standings={panel.overallStandings} onClose={() => setShowOverall(false)} />
      )}
      {showPlayers && (
        <PlayerManager
          players={common.players}
          onCommand={onCommand}
          onClose={() => setShowPlayers(false)}
        />
      )}
      {showFullStandings && (
        <FullStandings standings={fullStandings} onClose={() => setShowFullStandings(false)} />
      )}
      {showBack && lastReveal !== null && (
        <LookBack reveal={lastReveal} onClose={() => setShowBack(false)} />
      )}
    </div>
  );
}
