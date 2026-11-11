/**
 * Setting up a game for a group: pick a game, choose its options, then say
 * where the big screen is. Ends with a room this device owns.
 *
 * The steps are state, not addresses: a reload starts again at the picker,
 * which is harmless because nothing exists until "Open the game".
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import type { GameId, PlayerId, RoomCode, RoomSettings } from '../../shared/protocol.js';
import { EMPTY_CATALOG, createRoom, fetchCatalog, joinRoom, sendIntent } from './api.js';
import { GamePicker } from './GamePicker.js';
import { GameSetup } from './GameSetup.js';
import { ScreenStep } from './ScreenStep.js';
import { PATHS, remoteUrl, tvUrl } from './routes.js';
import type { OwnerSession } from './session.js';
import { rememberName, saveOwnerSession, saveSession } from './session.js';

export interface OrganizeAppProps {
  onNavigate(to: string): void;
}

type Step =
  | { name: 'pick' }
  | { name: 'setup'; gameId: GameId }
  | { name: 'screen'; gameId: GameId; code: RoomCode; playingToo: boolean };

function playPath(code: RoomCode): string {
  return `${PATHS.play}?room=${encodeURIComponent(code)}`;
}

export function OrganizeApp({ onNavigate }: OrganizeAppProps) {
  const [step, setStep] = useState<Step>({ name: 'pick' });
  const [catalog, setCatalog] = useState(EMPTY_CATALOG);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What an attempt that failed part-way already made, so trying again carries
  // on rather than opening a second room or adding a second player.
  const created = useRef<OwnerSession | null>(null);
  const joined = useRef<PlayerId | null>(null);

  useEffect(() => {
    let live = true;
    void fetchCatalog().then((loaded) => {
      if (live) setCatalog(loaded);
    });
    return () => {
      live = false;
    };
  }, []);

  const open = async (gameId: GameId, settings: Partial<RoomSettings>, player: { name: string } | null): Promise<void> => {
    setBusy(true);
    setError(null);

    let owner = created.current;
    if (owner === null) {
      const room = await createRoom(settings);
      if (!room.ok) {
        setError(room.error);
        setBusy(false);
        return;
      }
      owner = { code: room.value.code, ownerToken: room.value.ownerToken, displayToken: room.value.displayToken };
      saveOwnerSession(owner);
      created.current = owner;
    } else {
      const changed = await sendIntent(owner.code, owner.ownerToken, {
        kind: 'host',
        command: { cmd: 'setSettings', settings },
      });
      if (!changed.ok) {
        setError(changed.error);
        setBusy(false);
        return;
      }
    }

    if (player !== null) {
      if (joined.current === null) {
        const seat = await joinRoom(owner.code, player.name, null);
        if (!seat.ok) {
          setError(seat.error);
          setBusy(false);
          return;
        }
        saveSession({ code: owner.code, playerId: seat.value.playerId, token: seat.value.sessionToken, name: player.name });
        rememberName(player.name);
        joined.current = seat.value.playerId;
      }
      const granted = await sendIntent(owner.code, owner.ownerToken, {
        kind: 'host',
        command: { cmd: 'grantControl', playerId: joined.current },
      });
      if (!granted.ok) {
        setError(granted.error);
        setBusy(false);
        return;
      }
    }

    setBusy(false);
    setStep({ name: 'screen', gameId, code: owner.code, playingToo: player !== null });
  };

  if (step.name === 'pick') {
    return (
      <GamePicker
        catalog={catalog}
        onPick={(gameId) => setStep({ name: 'setup', gameId })}
        onBack={() => onNavigate(PATHS.base)}
      />
    );
  }

  if (step.name === 'setup') {
    const { gameId } = step;
    return (
      <GameSetup
        gameId={gameId}
        catalog={catalog}
        mode="create"
        busy={busy}
        error={error}
        onSubmit={(settings, player) => void open(gameId, settings, player)}
        onBack={() => {
          setError(null);
          setStep({ name: 'pick' });
        }}
      />
    );
  }

  const { code, gameId, playingToo } = step;
  const next = playingToo ? playPath(code) : remoteUrl(code);
  return (
    <ScreenStep
      code={code}
      tvAddress={tvUrl(location.origin).replace(/^https?:\/\//, '')}
      usesBuzz={catalog.games.find((game) => game.id === gameId)?.usesBuzz ?? false}
      playingToo={playingToo}
      onUseThisDevice={() => onNavigate(`${PATHS.screen}?room=${encodeURIComponent(code)}`)}
      onNoScreen={() => onNavigate(next)}
      onContinue={() => onNavigate(next)}
    />
  );
}
