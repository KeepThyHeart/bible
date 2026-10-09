/**
 * One process, several rooms, different games.
 *
 * The port used to be handed a single module at construction, which quietly
 * made the game a property of the server rather than of the room. Nothing
 * caught it while only one game existed. These tests pin the behaviour that
 * replaced it, because the failure it prevents is silent: a room would play the
 * wrong game rather than refuse to start.
 */

import { describe, expect, it } from 'vitest';
import { createRoomPort } from './port.js';
import type { GameModule, Round, RoundOutcome } from '../../../../src/modules/games/shared/games.js';
import type { AddressedIntent, RoomSettings } from '../../../../src/modules/games/shared/protocol.js';

function namedGame(id: string): GameModule {
  return {
    id,
    name: id,
    supportsSolo: true,
    buildRound(_context, index: number): Round {
      return { index, secret: id, hostView: id, playerView: id };
    },
    scoreRound(): RoundOutcome {
      return { perPlayer: new Map(), aggregates: [], correctLabel: id, detail: null };
    },
  };
}

/** A do-nothing intent: this file is about which module is chosen, not about what it does. */
function tick(at: number): AddressedIntent {
  return { actor: { role: 'system' }, intent: { kind: 'timer', round: 0, tag: 'unused' }, receivedAt: at };
}

describe('game resolution', () => {
  it('gives each room the game its own settings name', () => {
    const seen: string[] = [];
    const port = createRoomPort((settings: RoomSettings) => {
      seen.push(settings.gameId);
      return namedGame(settings.gameId);
    });

    const first = port.createState({ code: 'AAAA', settings: { gameId: 'alpha' }, createdAt: 1 });
    const second = port.createState({ code: 'BBBB', settings: { gameId: 'beta' }, createdAt: 1 });

    port.reduce(first, tick(2));
    port.reduce(second, tick(3));

    expect(seen).toEqual(['alpha', 'beta']);
  });

  it('resolves again on every intent, so a game chosen in the lobby takes effect', () => {
    const seen: string[] = [];
    const port = createRoomPort((settings: RoomSettings) => {
      seen.push(settings.gameId);
      return namedGame(settings.gameId);
    });

    const created = port.createState({ code: 'AAAA', settings: { gameId: 'alpha' }, createdAt: 1 });
    const changed = port.reduce(created, {
      actor: { role: 'owner' },
      intent: { kind: 'host', command: { cmd: 'setSettings', settings: { gameId: 'beta' } } },
      receivedAt: 2,
    });
    port.reduce(changed.state, tick(3));

    // The settings change itself is handled by the game that was in effect when
    // it arrived; the new one takes over from the next intent on.
    expect(seen).toEqual(['alpha', 'beta']);
  });
});
