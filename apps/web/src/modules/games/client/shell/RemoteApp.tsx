/**
 * The organizer's own device, running the room without playing in it.
 *
 * It holds the owner credential and no seat, so it is the one stream that is
 * sent the private answer. The shared screen shows the game; this shows only
 * what is needed to run it.
 */

import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Catalog, HostCommand, RoomCode } from '../../shared/protocol.js';
import { Brand } from './Brand.js';
import { OrganizerControls } from './OrganizerControls.js';
import { OrganizerLobby } from './OrganizerLobby.js';
import { OrganizerSummary } from './OrganizerSummary.js';
import { EMPTY_CATALOG, fetchCatalog, sendIntent } from './api.js';
import { PATHS } from './routes.js';
import { lastOwnedRoom, loadOwnerSession } from './session.js';
import { serialSender } from './serialSender.js';
import { gt } from './t.js';
import { useTheme } from './theme.js';
import type { StreamFactory } from './useRoomStream.js';
import { useRoomStream } from './useRoomStream.js';

export interface RemoteAppProps {
  code: RoomCode | null;
  onNavigate(to: string): void;
  /** Replaces the browser's event stream; tests drive the stream by hand. */
  streamFactory?: StreamFactory;
}

export function RemoteApp({ code, onNavigate, streamFactory }: RemoteAppProps) {
  const target = code ?? lastOwnedRoom();
  const owner = target === null ? null : loadOwnerSession(target);
  const [catalog, setCatalog] = useState<Catalog>(EMPTY_CATALOG);
  // Set by "Pick another game": the next lobby opens on the picker.
  const [pickNext, setPickNext] = useState(false);

  useEffect(() => {
    let live = true;
    void fetchCatalog().then((value) => {
      if (live) setCatalog(value);
    });
    return () => {
      live = false;
    };
  }, []);

  const stream = useRoomStream({
    code: owner?.code ?? null,
    token: owner?.ownerToken ?? null,
    as: 'remote',
    ...(streamFactory ? { factory: streamFactory } : {}),
  });

  useTheme(stream.snapshot?.settings.theme ?? null);

  const ownerCode = owner?.code ?? null;
  const ownerToken = owner?.ownerToken ?? null;
  const onCommand = useMemo(
    () =>
      serialSender((command: HostCommand) =>
        ownerCode === null || ownerToken === null
          ? Promise.resolve()
          : sendIntent(ownerCode, ownerToken, { kind: 'host', command })
      ),
    [ownerCode, ownerToken]
  );

  if (owner === null) {
    return (
      <main class="screen centre">
        <Brand />
        <p role="status">{gt('games.organizer.noRemote', 'This device is not running a game.')}</p>
        <button type="button" class="btn-primary" onClick={() => onNavigate(PATHS.base)}>
          {gt('games.organizer.goHome', 'Back to the start')}
        </button>
      </main>
    );
  }

  if (stream.ended !== null) {
    return (
      <main class="screen centre">
        <Brand />
        <p role="status">{stream.ended}</p>
        <button type="button" class="btn-primary" onClick={() => onNavigate(PATHS.base)}>
          {gt('games.organizer.goHome', 'Back to the start')}
        </button>
      </main>
    );
  }

  const snapshot = stream.snapshot;
  if (!snapshot || snapshot.viewer !== 'remote') {
    return (
      <main class="screen centre">
        <Brand />
        <p role="status">
          {stream.status === 'reconnecting'
            ? gt('games.common.reconnecting', 'Reconnecting…')
            : gt('games.organizer.opening', 'Opening the game…')}
        </p>
      </main>
    );
  }

  if (snapshot.phase === 'lobby') {
    return (
      <OrganizerLobby
        snapshot={snapshot}
        catalog={catalog}
        startPicking={pickNext}
        onCommand={(command) => {
          if (command.cmd === 'start') setPickNext(false);
          onCommand(command);
        }}
        onNavigate={onNavigate}
      />
    );
  }

  const control = snapshot.control;
  if (control === undefined) {
    const runner = snapshot.players.find(
      (player) => snapshot.controller.kind === 'player' && player.id === snapshot.controller.playerId
    );
    return (
      <main class="screen centre">
        <Brand />
        <p role="status">
          {runner
            ? gt('games.host.runningBy', '{name} is the organizer.', { name: runner.name })
            : gt('games.host.runningByOwner', "The organizer is running it.")}
        </p>
        <button type="button" class="btn-primary" onClick={() => onCommand({ cmd: 'reclaimControl' })}>
          {gt('games.common.takeBackControl', 'Take back control')}
        </button>
      </main>
    );
  }

  if (snapshot.phase === 'summary') {
    return (
      <OrganizerSummary
        panel={control}
        onCommand={onCommand}
        onPickAnother={() => {
          // Same room, same people: back to the lobby, opened on the picker.
          setPickNext(true);
          onCommand({ cmd: 'newGame' });
        }}
      />
    );
  }

  return (
    <main class="screen">
      <OrganizerControls
        snapshot={snapshot}
        panel={control}
        reveal={stream.reveal}
        fullStandings={stream.fullStandings}
        onCommand={onCommand}
      />
    </main>
  );
}
