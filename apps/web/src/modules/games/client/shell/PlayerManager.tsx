/**
 * The organizer's private roster.
 *
 * Two layouts of the same rows. The dialog (the default) is the overlay opened
 * from the in-game menu, with score steps. The list sits inline in the lobby.
 * Either way each row's "..." menu can move a player to a team, rename them
 * and, in the list, remove them behind a confirm.
 */

import { useState } from 'preact/hooks';
import type { HostCommand, PublicPlayer, TeamId } from '../../shared/protocol.js';
import { MAX_NAME_LENGTH, normaliseName } from './JoinScreen.js';
import { teamLabel } from './teams.js';
import { gt } from './t.js';

/** Common increments rather than free text: a tap the host can make without looking away from the room. */
const ADJUST_STEPS = [-10, -1, 1, 10] as const;

export interface PlayerManagerProps {
  players: readonly PublicPlayer[];
  onCommand(command: HostCommand): void;
  /** The dialog layout's way out; the list has none. */
  onClose?(): void;
  /** `dialog` is an overlay with score steps; `list` sits inline. */
  layout?: 'dialog' | 'list';
  /** The teams in play, which a player can be moved to. Absent with teams off. */
  teams?: readonly TeamId[];
}

export function PlayerManager({ players, onCommand, onClose, layout = 'dialog', teams }: PlayerManagerProps) {
  // One row confirming at a time, keyed by id — starting a second kick
  // clears whichever row was already asking, rather than stacking prompts.
  const [confirmKick, setConfirmKick] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; draft: string } | null>(null);
  const inDialog = layout === 'dialog';

  const closeMenu = (): void => setMenuFor(null);

  const rows = players.map((player) => {
    const moveTargets = (teams ?? []).filter((team) => team !== player.teamId);
    return (
      <li
        key={player.id}
        class={inDialog ? 'player-manager-row' : 'player-manager-row org-player-row'}
        data-connected={player.connected ? 'true' : 'false'}
      >
        {renaming?.id === player.id ? (
          <form
            class="org-rename"
            onSubmit={(event) => {
              event.preventDefault();
              const name = normaliseName(renaming.draft);
              if (name.length > 0 && name !== player.name) {
                onCommand({ cmd: 'rename', playerId: player.id, name });
              }
              setRenaming(null);
            }}
          >
            <input
              type="text"
              name="player-name"
              aria-label={gt('games.organize.players.renameLabel', 'New name for {name}', { name: player.name })}
              maxLength={MAX_NAME_LENGTH}
              value={renaming.draft}
              onInput={(event) => setRenaming({ id: player.id, draft: event.currentTarget.value })}
            />
            <button type="submit">{gt('games.organize.players.save', 'Save')}</button>
            <button type="button" onClick={() => setRenaming(null)}>
              {gt('games.organize.players.cancel', 'Cancel')}
            </button>
          </form>
        ) : (
          <>
            <span class="name-text" title={player.name}>
              {player.name}
            </span>
            {!player.connected && <span class="away-marker">{gt('games.common.away', '(away)')}</span>}
            {player.teamId !== null && teams !== undefined && (
              <span class="team-chip small" data-team={player.teamId}>
                {teamLabel(player.teamId)}
              </span>
            )}

            {inDialog && (
              <div
                class="player-manager-adjust"
                role="group"
                aria-label={gt('games.organize.players.adjustLabel', 'Adjust {name}’s score', { name: player.name })}
              >
                {ADJUST_STEPS.map((delta) => (
                  <button
                    key={delta}
                    type="button"
                    class="player-manager-step"
                    onClick={() => onCommand({ cmd: 'adjust', playerId: player.id, delta })}
                  >
                    {delta > 0 ? `+${delta}` : delta}
                  </button>
                ))}
              </div>
            )}

            {confirmKick === player.id ? (
              <span class="confirm player-manager-confirm">
                <button
                  type="button"
                  class="danger"
                  onClick={() => {
                    onCommand({ cmd: 'kick', playerId: player.id });
                    setConfirmKick(null);
                  }}
                >
                  {gt('games.organize.players.remove', 'Remove')}
                </button>
                <button type="button" onClick={() => setConfirmKick(null)}>
                  {gt('games.organize.players.keep', 'Keep')}
                </button>
              </span>
            ) : (
              <>
                {inDialog && (
                  <button
                    type="button"
                    class="btn-quiet player-manager-kick"
                    onClick={() => setConfirmKick(player.id)}
                  >
                    {gt('games.organize.players.kick', 'Kick')}
                  </button>
                )}
                <span class="org-menu-anchor">
                  <button
                    type="button"
                    class="org-menu-button"
                    aria-haspopup="menu"
                    aria-expanded={menuFor === player.id}
                    aria-label={gt('games.organize.players.optionsFor', 'Options for {name}', { name: player.name })}
                    onClick={() => setMenuFor(menuFor === player.id ? null : player.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') closeMenu();
                    }}
                  >
                    ...
                  </button>
                  {menuFor === player.id && (
                    <div
                      class="org-menu"
                      role="menu"
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') closeMenu();
                      }}
                    >
                      {moveTargets.map((team) => (
                        <button
                          key={team}
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            onCommand({ cmd: 'moveToTeam', playerId: player.id, teamId: team });
                            closeMenu();
                          }}
                        >
                          {gt('games.organize.players.moveTo', 'Move to {team}', { team: teamLabel(team) })}
                        </button>
                      ))}
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setRenaming({ id: player.id, draft: player.name });
                          closeMenu();
                        }}
                      >
                        {gt('games.organize.players.rename', 'Rename')}
                      </button>
                      {!inDialog && (
                        <button
                          type="button"
                          role="menuitem"
                          class="danger"
                          onClick={() => {
                            setConfirmKick(player.id);
                            closeMenu();
                          }}
                        >
                          {gt('games.organize.players.remove', 'Remove')}
                        </button>
                      )}
                    </div>
                  )}
                </span>
              </>
            )}
          </>
        )}
      </li>
    );
  });

  const list =
    players.length === 0 ? (
      <p class="muted">{gt('games.organize.players.none', 'Nobody has joined yet.')}</p>
    ) : (
      <ul class="player-manager-list">{rows}</ul>
    );

  if (!inDialog) return list;

  return (
    <div class="overlay" role="dialog" aria-label={gt('games.organize.players.title', 'Manage players')}>
      <div class="overlay-card">
        <h2 class="overlay-title">{gt('games.organize.players.title', 'Manage players')}</h2>
        {list}
        <button type="button" class="btn-primary" onClick={onClose}>
          {gt('games.organize.players.close', 'Close')}
        </button>
      </div>
    </div>
  );
}
