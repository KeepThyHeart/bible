/**
 * The screen route: the projector, the TV, or a laptop at the front of the
 * room.
 *
 * An owner token is created once and kept, so that closing the laptop lid,
 * or reloading after a projector cable is unplugged and replugged, resumes
 * the same room rather than stranding twelve phones in a room that no
 * longer has a screen watching it.
 *
 * A display token in the link (`?t=…`) is a different device entirely:
 * someone scanned a QR to add a second screen to a room somebody else
 * already owns. That credential is never stored — the link itself is the
 * credential, each time — and it opens a screen stream and nothing else: no
 * control block ever reaches it, whatever else is happening in the room.
 */

import { useCallback, useEffect, useState } from 'preact/hooks';
import type { HostCommand, RoomCode } from '../../shared/protocol.js';
import { createRoom, sendIntent } from './api.js';
import { Brand } from './Brand.js';
import { ScreenStage } from './ScreenStage.js';
import type { OwnerSession } from './session.js';
import {
  clearOwnerSession,
  lastOwnedRoom,
  loadOwnerSession,
  saveOwnerSession,
  touchOwnerSession,
} from './session.js';
import { useRoomStream } from './useRoomStream.js';
import { gt } from './t.js';

/** How often an open owner screen refreshes its own session's touch time. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export interface ScreenAppProps {
  /** A code in the link means "resume that room", not "make a new one". */
  code: RoomCode | null;
  /** A display token in the link: this device is a second screen, not the owner. */
  displayToken: string | null;
  onLeaveHosting(): void;
  /** Embedded in the reader: told whether a room is open on this screen (the app's "live" badge). */
  onLiveChange?(live: boolean): void;
}

export function ScreenApp({ code, displayToken, onLeaveHosting, onLiveChange }: ScreenAppProps) {
  const [session, setSession] = useState<OwnerSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    // A display token in the link opens a screen stream on its own; there is
    // no owner session to create, resume or remember for this device.
    if (displayToken !== null) return;

    let live = true;
    const remembered = loadOwnerSession(code ?? lastOwnedRoom() ?? '');
    if (remembered) {
      // Resuming counts as a touch too, so a host reopening the tab the
      // next morning of the same event does not lose the room between one
      // visit and the next.
      touchOwnerSession(remembered.code);
      setSession(remembered);
      return;
    }
    void createRoom({}).then((result) => {
      if (!live) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const created: OwnerSession = {
        code: result.value.code,
        ownerToken: result.value.ownerToken,
        displayToken: result.value.displayToken,
      };
      saveOwnerSession(created);
      setSession(created);
    });
    return () => {
      live = false;
    };
  }, [code, displayToken]);

  // Keeps a genuinely open owner screen from ever going stale on its own: see
  // `OWNER_SESSION_CUTOFF_MS`. A tab actually left open outlasts any cutoff;
  // only a tab that was closed, and stayed closed, goes quiet.
  useEffect(() => {
    if (!session) return undefined;
    const id = setInterval(() => touchOwnerSession(session.code), TOUCH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [session]);

  // A display credential is never the owner; the owner credential is the
  // owner exactly when it exists, whether just created or resumed.
  const isOwner = displayToken === null;
  const streamCode = displayToken !== null ? code : (session?.code ?? null);
  const streamToken = displayToken !== null ? displayToken : (session?.ownerToken ?? null);

  const stream = useRoomStream({ code: streamCode, token: streamToken });

  const roomOpen = stream.snapshot !== null && stream.ended === null;
  useEffect(() => {
    onLiveChange?.(roomOpen);
    return () => onLiveChange?.(false);
  }, [roomOpen, onLiveChange]);

  const onCommand = useCallback(
    (command: HostCommand) => {
      // A display credential can never send a command — see this file's own
      // doc comment — so there is nothing to do without an owner session.
      if (!session) return;
      void sendIntent(session.code, session.ownerToken, { kind: 'host', command });
    },
    [session]
  );

  if (error !== null) {
    return (
      <main class="screen centre">
        <Brand />
        <p class="alert" role="alert">
          {error}
        </p>
        <button type="button" onClick={() => location.reload()}>
          {gt('games.common.tryAgain', 'Try again')}
        </button>
      </main>
    );
  }

  if (stream.ended !== null) {
    return (
      <main class="screen centre">
        <Brand />
        <p role="status">{stream.ended}</p>
        <button
          type="button"
          class="btn-primary"
          onClick={() => {
            if (session) clearOwnerSession(session.code);
            onLeaveHosting();
          }}
        >
          {gt('games.host.newRoom', 'Run a game for a group')}
        </button>
      </main>
    );
  }

  const snapshot = stream.snapshot;
  if (!snapshot || snapshot.viewer !== 'screen') {
    return (
      <main class="screen centre">
        <Brand />
        <p role="status">{gt('games.host.opening', 'Opening the game…')}</p>
      </main>
    );
  }

  return (
    <ScreenStage
      snapshot={snapshot}
      status={stream.status}
      reveal={stream.reveal}
      isOwner={isOwner}
      onCommand={onCommand}
      onReconnectNow={stream.reconnectNow}
    />
  );
}
