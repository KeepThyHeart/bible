/**
 * The host's private roster panel.
 *
 * `kick` and `adjust` have existed on the wire since the room state machine
 * was first written — a host had no way to remove a duplicate or joke name,
 * or correct a score the group agreed was mis-ruled, from any screen. This
 * is that screen: nothing here is new to the reducer, only newly reachable.
 */

import { useState } from 'preact/hooks';
import type { HostCommand, PublicPlayer } from '../../shared/protocol.js';

/** Common increments rather than free text: a tap the host can make without looking away from the room. */
const ADJUST_STEPS = [-10, -1, 1, 10] as const;

export interface PlayerManagerProps {
  players: readonly PublicPlayer[];
  onCommand(command: HostCommand): void;
  onClose(): void;
}

export function PlayerManager({ players, onCommand, onClose }: PlayerManagerProps) {
  // One row confirming at a time, keyed by id — starting a second kick
  // clears whichever row was already asking, rather than stacking prompts.
  const [confirmKick, setConfirmKick] = useState<string | null>(null);

  return (
    <div class="overlay" role="dialog" aria-label="Manage players">
      <div class="overlay-card">
        <h2 class="overlay-title">Manage players</h2>
        {players.length === 0 ? (
          <p class="muted">Nobody has joined yet.</p>
        ) : (
          <ul class="player-manager-list">
            {players.map((player) => (
              <li
                key={player.id}
                class="player-manager-row"
                data-connected={player.connected ? 'true' : 'false'}
              >
                <span class="name-text" title={player.name}>
                  {player.name}
                </span>
                {!player.connected && <span class="away-marker">(away)</span>}

                <div
                  class="player-manager-adjust"
                  role="group"
                  aria-label={`Adjust ${player.name}'s score`}
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
                      Remove
                    </button>
                    <button type="button" onClick={() => setConfirmKick(null)}>
                      Keep
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    class="btn-quiet player-manager-kick"
                    onClick={() => setConfirmKick(player.id)}
                  >
                    Kick
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <button type="button" class="btn-primary" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
