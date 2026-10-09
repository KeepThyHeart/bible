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
import type {
  Catalog,
  HostCommand,
  RoomCode,
  RoomSettings,
  ScreenSnapshot,
} from '../../shared/protocol.js';
import { EMPTY_CATALOG, createRoom, fetchCatalog, joinRoom, sendIntent } from './api.js';
import { Brand } from './Brand.js';
import { HostFrame } from './HostFrame.js';
import { HostLobby } from './HostLobby.js';
import { HostSummary } from './Summary.js';
import { useClock } from './clockPort.js';
import { useRoomTheme } from './theme.js';
import { hostViewFor, isGamePhase } from './gameViews.js';
import { PATHS, joinUrl } from './routes.js';
import type { OwnerSession } from './session.js';
import {
  clearOwnerSession,
  lastOwnedRoom,
  loadOwnerSession,
  rememberName,
  rememberedName,
  saveOwnerSession,
  saveSession,
  touchOwnerSession,
} from './session.js';
import { useRoomStream } from './useRoomStream.js';
import { gt } from './t.js';

/** How often an open owner screen refreshes its own session's touch time. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

/** Nobody prompts for a name before this; a good-enough default beats a blank roster row. */
const PLAY_TOO_FALLBACK_NAME = 'Leader';

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
  const [catalog, setCatalog] = useState<Catalog>(EMPTY_CATALOG);
  // An empty catalog is ambiguous on its own: it is either "still loading" or
  // "the server truly has nothing installed", and only the second is worth a
  // warning. This is what tells the two apart.
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const clock = useClock();

  useEffect(() => {
    let live = true;
    void fetchCatalog().then((value) => {
      if (!live) return;
      setCatalog(value);
      setCatalogLoaded(true);
    });
    return () => {
      live = false;
    };
  }, []);

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

  // The projector shows the room's theme with no private override: everyone
  // is looking at the same screen.
  useRoomTheme(stream.snapshot?.settings.theme ?? null);

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

  const onSettings = useCallback(
    (settings: Partial<RoomSettings>) => onCommand({ cmd: 'setSettings', settings }),
    [onCommand]
  );

  /**
   * "Play too, and run it from here" (§8.1 of the design): the three
   * ordinary calls that make phone-led play what it is — join, grant, switch
   * route — with no mode flag anywhere. Only offered when this device holds
   * the owner session, since only the owner token may grant control.
   */
  const onPlayToo = useCallback((): void => {
    if (!session) return;
    const { code, ownerToken } = session;
    void (async () => {
      const name = rememberedName() || gt('games.host.leaderName', PLAY_TOO_FALLBACK_NAME);
      const joined = await joinRoom(code, name, null);
      if (!joined.ok) {
        setError(joined.error);
        return;
      }
      saveSession({ code, playerId: joined.value.playerId, token: joined.value.sessionToken, name });
      rememberName(name);
      await sendIntent(code, ownerToken, {
        kind: 'host',
        command: { cmd: 'grantControl', playerId: joined.value.playerId },
      });
      location.assign(`${PATHS.play}?room=${encodeURIComponent(code)}`);
    })();
  }, [session]);

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
          {gt('games.host.newRoom', 'Start a new room')}
        </button>
      </main>
    );
  }

  const snapshot = stream.snapshot;
  if (!snapshot || snapshot.viewer !== 'screen') {
    return (
      <main class="screen centre">
        <Brand />
        <p role="status">{gt('games.host.opening', 'Opening the room…')}</p>
      </main>
    );
  }

  const host: ScreenSnapshot = snapshot;

  if (host.phase === 'lobby') {
    return (
      <HostLobby
        snapshot={host}
        catalog={catalog}
        catalogLoaded={catalogLoaded}
        joinUrl={joinUrl(location.origin, host.code)}
        isOwner={isOwner}
        onSettings={onSettings}
        onStart={() => onCommand({ cmd: 'start' })}
        onReclaim={() => onCommand({ cmd: 'reclaimControl' })}
        {...(isOwner ? { onPlayToo } : {})}
      />
    );
  }

  const body = isGamePhase(host.phase) ? (
    (() => {
      const View = hostViewFor(host.settings.gameId, host.phase);
      return (
        <View
          snapshot={host}
          view={host.view}
          reveal={stream.reveal}
          clock={clock}
          send={onCommand}
        />
      );
    })()
  ) : (
    <HostSummary snapshot={host} />
  );

  return (
    <HostFrame
      snapshot={host}
      status={stream.status}
      reveal={stream.reveal}
      fullStandings={stream.fullStandings}
      isOwner={isOwner}
      onCommand={onCommand}
      onReconnectNow={stream.reconnectNow}
    >
      {body}
    </HostFrame>
  );
}
