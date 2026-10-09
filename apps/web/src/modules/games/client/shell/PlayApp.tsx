/**
 * The player route: one phone, from the join form to the last question.
 *
 * The whole route is arranged around a phone that will not stay still. It
 * locks, it changes towers, someone swipes back out of the page and comes
 * again from the QR code. So the token is stored the moment the join succeeds
 * and the code is put in the URL, and every one of those returns is a reload
 * that lands back in the same seat rather than a second player with the same
 * name and a score of zero.
 *
 * There is no local state about the game here at all. What the phone shows is
 * whatever snapshot arrived last, which is what makes a reconnect look like
 * nothing happened.
 */

import { useCallback, useEffect, useState } from 'preact/hooks';
import type { HostCommand, Intent, PlayerSnapshot, RoomCode, TeamId } from '../../shared/protocol.js';
import { Brand } from './Brand.js';
import { ControlBar } from './ControlBar.js';
import { ControlPanel } from './ControlPanel.js';
import { JoinScreen } from './JoinScreen.js';
import { PhoneFrame } from './PhoneFrame.js';
import { PhoneLobby } from './PhoneLobby.js';
import { QrCode } from './QrCode.js';
import { PhoneSummary } from './Summary.js';
import { joinRoom, sendIntent } from './api.js';
import { clockReportFor, useClock } from './clockPort.js';
import { isGamePhase, playerViewFor } from './gameViews.js';
import { PATHS, joinUrl, screenUrl } from './routes.js';
import type { RoomSession } from './session.js';
import {
  clearSession,
  lastRoom,
  loadOwnerSession,
  loadSession,
  rememberName,
  rememberedName,
  saveSession,
} from './session.js';
import { useTheme } from './theme.js';
import { useRoomStream } from './useRoomStream.js';
import { gt } from './t.js';

/**
 * "Show on a TV" (§8.1 of the design): offered only when this device is the
 * one that created the room, proved by the owner session it still holds
 * locally — the display token never travels any other way, and never reaches
 * the room itself. Displayed to one person, not broadcast to anyone.
 */
function ShowOnTV({ code }: { code: RoomCode }) {
  const [open, setOpen] = useState(false);
  const owner = loadOwnerSession(code);
  if (!owner) return null;

  if (!open) {
    return (
      <button type="button" class="btn-quiet" onClick={() => setOpen(true)}>
        {gt('games.play.showOnTv', 'Show on a TV')}
      </button>
    );
  }

  const url = screenUrl(location.origin, code, owner.displayToken);
  return (
    <div class="overlay" role="dialog" aria-label={gt('games.play.showOnTv', 'Show on a TV')}>
      <div class="overlay-card">
        <h2 class="overlay-title">{gt('games.play.scanOnTv', 'Scan on the TV')}</h2>
        <QrCode url={url} label={gt('games.play.tvQr', 'QR code to add this room to a TV or a second screen')} />
        <button type="button" class="btn-primary" onClick={() => setOpen(false)}>
          {gt('games.common.close', 'Close')}
        </button>
      </div>
    </div>
  );
}

export interface PlayAppProps {
  /** A code from the link — a scanned QR, or a reload of a room already joined. */
  code: RoomCode | null;
  onNavigate(to: string, replace?: boolean): void;
}

/**
 * A link's code wins over the last room this device was in: scanning a new QR
 * is someone saying which room they mean.
 */
function resume(code: RoomCode | null): RoomSession | null {
  const target = code ?? lastRoom();
  return target === null ? null : loadSession(target);
}

export function PlayApp({ code, onNavigate }: PlayAppProps) {
  const [session, setSession] = useState<RoomSession | null>(() => resume(code));
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clock = useClock();

  // The code can arrive after first paint, when the link is followed rather
  // than typed.
  useEffect(() => {
    const found = resume(code);
    if (found) setSession(found);
  }, [code]);

  const stream = useRoomStream({
    code: session?.code ?? null,
    token: session?.token ?? null,
  });

  // This phone's own theme: the room's, unless this device has overridden it
  // — a per-viewer convenience that never reaches anyone else.
  const themeControl = useTheme(stream.snapshot?.settings.theme ?? null);

  const join = useCallback(
    async (target: RoomCode, name: string): Promise<void> => {
      setJoining(true);
      setError(null);
      const result = await joinRoom(target, name, null);
      setJoining(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const next: RoomSession = {
        code: target,
        playerId: result.value.playerId,
        token: result.value.sessionToken,
        name,
      };
      saveSession(next);
      rememberName(name);
      setSession(next);
      // The code goes in the URL so that a reload, or a phone offering to
      // reopen the tab tomorrow, comes straight back to this room.
      onNavigate(`${PATHS.play}?room=${encodeURIComponent(target)}`, true);
    },
    [onNavigate]
  );

  const send = useCallback(
    (intent: Intent) => {
      if (!session) return;
      void sendIntent(session.code, session.token, intent, clockReportFor(intent, clock));
    },
    [session, clock]
  );

  /**
   * A session token is a legitimate way to send a host command now (§5.1 of
   * the design): the reducer decides whether this player actually controls
   * the room. Refused silently, like any other command, when they do not.
   */
  const onCommand = useCallback(
    (command: HostCommand) => {
      if (!session) return;
      void sendIntent(session.code, session.token, { kind: 'host', command });
    },
    [session]
  );

  const forget = useCallback(() => {
    if (session) clearSession(session.code);
    setSession(null);
    setError(null);
    onNavigate(PATHS.play, true);
  }, [session, onNavigate]);

  const leave = useCallback(() => {
    send({ kind: 'leave' });
    forget();
  }, [send, forget]);

  if (!session) {
    return (
      <JoinScreen
        initialCode={code ?? ''}
        initialName={rememberedName()}
        busy={joining}
        error={error}
        onJoin={(target, name) => {
          void join(target, name);
        }}
        onSolo={() => onNavigate(PATHS.solo)}
      />
    );
  }

  if (stream.ended !== null) {
    return (
      <main class="screen centre">
        <Brand />
        <p role="status">{stream.ended}</p>
        <button type="button" class="btn-primary" onClick={forget}>
          {gt('games.play.joinAnother', 'Join another room')}
        </button>
      </main>
    );
  }

  const snapshot = stream.snapshot;
  if (!snapshot || snapshot.viewer !== 'player') {
    return (
      <main class="screen centre">
        <Brand />
        <p role="status">
          {stream.status === 'reconnecting'
            ? gt('games.common.reconnecting', 'Reconnecting…')
            : gt('games.play.joining', 'Joining the room…')}
        </p>
        <p class="muted">
          {gt('games.play.room', 'Room')} <strong>{session.code}</strong>
        </p>
        <button type="button" class="btn-quiet" onClick={forget}>
          {gt('games.play.startAgain', 'Start again')}
        </button>
      </main>
    );
  }

  const player: PlayerSnapshot = snapshot;

  if (player.phase === 'lobby') {
    return (
      <PhoneLobby
        snapshot={player}
        onPickTeam={(teamId: TeamId) => send({ kind: 'setTeam', teamId })}
        onLeave={leave}
        themeControl={themeControl}
        joinUrl={joinUrl(location.origin, player.code)}
        onRequestControl={() => send({ kind: 'requestControl' })}
        onWithdrawControlRequest={() => send({ kind: 'withdrawControlRequest' })}
        onStart={() => onCommand({ cmd: 'start' })}
      />
    );
  }

  const body = isGamePhase(player.phase) ? (
    (() => {
      const View = playerViewFor(player.settings.gameId, player.phase);
      return (
        <View
          snapshot={player}
          view={player.view}
          reveal={stream.reveal}
          yourResult={stream.yourResult}
          clock={clock}
          send={send}
        />
      );
    })()
  ) : (
    <PhoneSummary snapshot={player} />
  );

  return (
    <PhoneFrame
      snapshot={player}
      yourResult={stream.yourResult}
      status={stream.status}
      onReconnectNow={stream.reconnectNow}
      actions={{ joinUrl: joinUrl(location.origin, player.code), themeControl, onLeave: leave }}
    >
      {player.control !== undefined && (
        <>
          <ControlPanel pendingJudge={player.control.pendingJudge} onCommand={onCommand} />
          <ControlBar
            common={player}
            panel={player.control}
            reveal={stream.reveal}
            fullStandings={stream.fullStandings}
            onCommand={onCommand}
          />
          <ShowOnTV code={player.code} />
        </>
      )}
      {body}
    </PhoneFrame>
  );
}
