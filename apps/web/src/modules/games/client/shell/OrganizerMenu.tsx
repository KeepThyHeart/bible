/**
 * The organizer's "..." menu: scores, the roster, time per question, a restart
 * and the end of the game (the results come next; the room stays open). Everything that changes the game rather than the
 * round in front of it, behind one deliberate tap.
 *
 * It owns its own dialogs, so any device that runs a room draws it the same
 * way and the keyboard model stays in one place: opening puts focus on the
 * first item, the arrows, Home and End move between items, Escape closes the
 * menu and returns focus to the button that opened it.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import type {
  HostCommand,
  PublicPlayer,
  RevealPayload,
  RoomSettings,
  Standing,
} from '../../shared/protocol.js';
import { PlayerManager } from './PlayerManager.js';
import { gt } from './t.js';

/** The choices for time per question, in seconds. */
export const ANSWER_WINDOW_SECONDS = [10, 15, 20, 30, 45, 60, 90] as const;

const MENU_ITEMS = '[role^="menuitem"]:not([disabled])';

export function menuItems(menu: ParentNode | null): HTMLElement[] {
  return menu ? Array.from(menu.querySelectorAll<HTMLElement>(MENU_ITEMS)) : [];
}

/** Arrow, Home, End and Escape handling shared by every menu panel. */
export function menuKeyDown(onEscape: () => void): (event: KeyboardEvent) => void {
  return (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onEscape();
      return;
    }
    const items = menuItems(event.currentTarget as ParentNode | null);
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    let target = -1;
    if (event.key === 'ArrowDown') target = at < 0 ? 0 : (at + 1) % items.length;
    else if (event.key === 'ArrowUp') target = at < 0 ? items.length - 1 : (at - 1 + items.length) % items.length;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = items.length - 1;
    if (target < 0) return;
    event.preventDefault();
    items[target]?.focus();
  };
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1.5em" height="1.5em" aria-hidden="true" focusable="false">
      <circle cx="5" cy="12" r="2" fill="currentColor" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
      <circle cx="19" cy="12" r="2" fill="currentColor" />
    </svg>
  );
}

/**
 * The complete ordering, last place included. Requested fresh every time this
 * opens, so it reads the room as it stands right now.
 */
export function FullStandings({
  standings,
  onClose,
}: {
  standings: readonly Standing[] | null;
  onClose(): void;
}) {
  const title = gt('games.organizer.scores', 'Scores');
  return (
    <div class="overlay" role="dialog" aria-label={title}>
      <div class="overlay-card">
        <h2 class="overlay-title">{title}</h2>
        {standings === null ? (
          <p class="muted" role="status">
            {gt('games.organizer.loadingScores', 'Loading the scores…')}
          </p>
        ) : standings.length === 0 ? (
          <p class="muted">{gt('games.organizer.nobodyScored', 'Nobody has scored yet.')}</p>
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
 * A read-only glance at an earlier question's answer. Nothing here can change
 * the room.
 */
export function LookBack({ reveal, onClose }: { reveal: RevealPayload; onClose(): void }) {
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
        <p class="muted small">{gt('games.bar.referenceOnly', 'For reference only — nothing here changes the game.')}</p>
        <button type="button" class="btn-primary" onClick={onClose}>
          {gt('games.common.close', 'Close')}
        </button>
      </div>
    </div>
  );
}

type MenuView = 'main' | 'time';
type Confirming = 'restart' | 'finish' | null;

export interface OrganizerMenuProps {
  players: readonly PublicPlayer[];
  settings: RoomSettings;
  /** The complete ordering once asked for, from the stream; null until it arrives. */
  fullStandings: readonly Standing[] | null;
  onCommand(command: HostCommand): void;
  /** False in the lobby and on the results, where there is nothing to finish. */
  canFinish?: boolean;
}

export function OrganizerMenu({ players, settings, fullStandings, onCommand, canFinish = true }: OrganizerMenuProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<MenuView>('main');
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [showScores, setShowScores] = useState(false);
  const [showPlayers, setShowPlayers] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Opening the menu, or moving to another list inside it, puts focus on the
  // first item.
  useEffect(() => {
    if (open) menuItems(panelRef.current)[0]?.focus();
  }, [open, view]);

  const close = (): void => {
    setOpen(false);
    setView('main');
    setConfirming(null);
  };
  const escape = (): void => {
    close();
    buttonRef.current?.focus();
  };

  const secondsNow = Math.round(settings.answerWindowMs / 1000);

  return (
    <div class="host-menu">
      <button
        type="button"
        class="icon-button host-menu-toggle"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={gt('games.organizer.more', 'More')}
        ref={buttonRef}
        onKeyDown={(event: KeyboardEvent) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <MenuIcon />
      </button>

      {open && (
        <div
          class="host-menu-panel"
          role="menu"
          aria-label={gt('games.organizer.menu', 'Game menu')}
          ref={panelRef}
          onKeyDown={menuKeyDown(escape)}
        >
          {view === 'time' ? (
            <>
              {ANSWER_WINDOW_SECONDS.map((seconds) => (
                <button
                  key={seconds}
                  type="button"
                  role="menuitemradio"
                  aria-checked={seconds === secondsNow}
                  onClick={() => {
                    onCommand({ cmd: 'setSettings', settings: { answerWindowMs: seconds * 1000 } });
                    close();
                  }}
                >
                  {gt('games.organizer.seconds', '{count} seconds', { count: seconds })}
                </button>
              ))}
              <button type="button" role="menuitem" onClick={() => setView('main')}>
                {gt('games.organizer.backToMenu', 'Back')}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setShowScores(true);
                  onCommand({ cmd: 'requestFullStandings' });
                  close();
                }}
              >
                {gt('games.organizer.scores', 'Scores')}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setShowPlayers(true);
                  close();
                }}
              >
                {gt('games.organizer.playersAndTeams', 'Players and teams')}
              </button>
              <button type="button" role="menuitem" onClick={() => setView('time')}>
                {gt('games.organizer.timePerQuestion', 'Time per question')}
              </button>
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={settings.openEnded}
                onClick={() => {
                  onCommand({ cmd: 'setSettings', settings: { openEnded: !settings.openEnded } });
                  close();
                }}
              >
                {gt('games.organizer.noSetLength', 'No set length')}
              </button>

              <div class="host-menu-divider" role="separator" />

              {confirming === 'restart' ? (
                <div class="confirm host-menu-confirm">
                  <p class="host-menu-warning" role="alert">
                    {gt('games.organizer.restartWarning', 'The scores for this game are cleared.')}
                  </p>
                  <button
                    type="button"
                    class="danger"
                    onClick={() => {
                      onCommand({ cmd: 'newGame' });
                      // Back to the lobby, where Change picks the options again.
                      close();
                    }}
                  >
                    {gt('games.organizer.restartConfirm', 'Restart')}
                  </button>
                  <button type="button" onClick={() => setConfirming(null)}>
                    {gt('games.organizer.keepPlaying', 'Keep playing')}
                  </button>
                </div>
              ) : (
                <button type="button" role="menuitem" onClick={() => setConfirming('restart')}>
                  {gt('games.organizer.restart', 'Restart with different options')}
                </button>
              )}

              {!canFinish ? null : confirming === 'finish' ? (
                <div class="confirm host-menu-confirm">
                  <button
                    type="button"
                    class="danger"
                    onClick={() => {
                      onCommand({ cmd: 'finish' });
                      close();
                    }}
                  >
                    {gt('games.organizer.finishConfirm', 'Finish')}
                  </button>
                  <button type="button" onClick={() => setConfirming(null)}>
                    {gt('games.organizer.keepPlaying', 'Keep playing')}
                  </button>
                </div>
              ) : (
                <button type="button" role="menuitem" onClick={() => setConfirming('finish')}>
                  {gt('games.organizer.finishGame', 'Finish this game')}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {showScores && <FullStandings standings={fullStandings} onClose={() => setShowScores(false)} />}
      {showPlayers && (
        <PlayerManager players={players} onCommand={onCommand} onClose={() => setShowPlayers(false)} />
      )}
    </div>
  );
}
