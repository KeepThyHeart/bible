/**
 * Playing alone.
 *
 * Solo is not a second application. It is an ordinary room with one player who
 * happens to also be the host: the same server, the same reducer, the same
 * snapshots, the same game views. What changes is only that the two tokens end
 * up in one pair of hands, so the phone renders the player's screens and grows
 * a small control that sends the host commands nobody else is there to send.
 *
 * Keeping it that way is what stops solo from quietly becoming a fork of the
 * game with its own scoring and its own bugs.
 */

import { useCallback, useEffect, useState } from 'preact/hooks';
import type {
  Catalog,
  HostCommand,
  Intent,
  PhaseName,
  PlayerSnapshot,
  RoomSettings,
} from '../../shared/protocol.js';
import { Brand } from './Brand.js';
import { PhoneFrame } from './PhoneFrame.js';
import { SoloSummary } from './Summary.js';
import { SoloLobby } from './SoloLobby.js';
import { EMPTY_CATALOG, createRoom, fetchCatalog, joinRoom, sendIntent } from './api.js';
import { clockReportFor, useClock } from './clockPort.js';
import { isGamePhase, playerViewFor } from './gameViews.js';
import type { SoloSession } from './session.js';
import {
  clearSoloSession,
  loadSoloSession,
  rememberedName,
  saveSoloSession,
} from './session.js';
import { useTheme } from './theme.js';
import { useRoomStream } from './useRoomStream.js';

/** Nobody else is going to read it, but the roster still wants a name. */
const FALLBACK_NAME = 'You';

export interface SoloAppProps {
  onLeaveSolo(): void;
}

/**
 * The controls a solo player needs, which is a strict subset of a host's: no
 * kicking, no adjusting, no judging queue, and no scores toggle — there is
 * only one score and it is already on the screen.
 */
function SoloControls({
  phase,
  paused,
  onCommand,
}: {
  phase: PhaseName;
  paused: boolean;
  onCommand(command: HostCommand): void;
}) {
  return (
    <nav class="host-controls solo-controls" aria-label="Game controls">
      {(phase === 'question' || phase === 'answering') && (
        <button type="button" onClick={() => onCommand({ cmd: paused ? 'resume' : 'pause' })}>
          {paused ? 'Resume' : 'Pause'}
        </button>
      )}
      {(phase === 'question' || phase === 'answering') && (
        <button type="button" onClick={() => onCommand({ cmd: 'skip' })}>
          Skip
        </button>
      )}
      {phase === 'reveal' ? (
        <button type="button" class="btn-primary" onClick={() => onCommand({ cmd: 'nextRound' })}>
          Next question
        </button>
      ) : (
        (phase === 'question' || phase === 'answering') && (
          <button type="button" onClick={() => onCommand({ cmd: 'revealNow' })}>
            Reveal now
          </button>
        )
      )}
    </nav>
  );
}

export function SoloApp({ onLeaveSolo }: SoloAppProps) {
  const [session, setSession] = useState<SoloSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped to ask for a fresh room. A finished room cannot be replayed, so
  // "play again" is a new one, and this is what re-runs the setup below.
  const [attempt, setAttempt] = useState(0);
  const [catalog, setCatalog] = useState<Catalog>(EMPTY_CATALOG);
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
    let live = true;

    const resumed = loadSoloSession();
    if (resumed) {
      setSession(resumed);
      return;
    }

    const open = async (): Promise<void> => {
      setError(null);
      const created = await createRoom({ solo: true });
      if (!live) return;
      if (!created.ok) {
        setError(created.error);
        return;
      }
      const name = rememberedName() || FALLBACK_NAME;
      const joined = await joinRoom(created.value.code, name, null);
      if (!live) return;
      if (!joined.ok) {
        setError(joined.error);
        return;
      }
      const next: SoloSession = {
        code: created.value.code,
        hostToken: created.value.ownerToken,
        playerId: joined.value.playerId,
        token: joined.value.sessionToken,
        name,
      };
      saveSoloSession(next);
      setSession(next);
    };

    void open();

    return () => {
      live = false;
    };
  }, [attempt]);

  // The player token, not the host one: what this phone renders is the player's
  // view of the room, with its private score and its own result.
  const stream = useRoomStream({
    code: session?.code ?? null,
    token: session?.token ?? null,
  });

  // A solo player is the only viewer of their own screen, so this device's
  // stored override — set the last time they played with others — applies
  // here too, with no editor of its own: nobody to run one for.
  useTheme(stream.snapshot?.settings.theme ?? null);

  const send = useCallback(
    (intent: Intent) => {
      if (!session) return;
      void sendIntent(session.code, session.token, intent, clockReportFor(intent, clock));
    },
    [session, clock]
  );

  const command = useCallback(
    (cmd: HostCommand) => {
      if (!session) return;
      void sendIntent(session.code, session.hostToken, { kind: 'host', command: cmd });
    },
    [session]
  );

  const onSettings = useCallback(
    (settings: Partial<RoomSettings>) => command({ cmd: 'setSettings', settings }),
    [command]
  );

  const startFresh = useCallback(() => {
    clearSoloSession();
    setSession(null);
    setAttempt((value) => value + 1);
  }, []);

  if (error !== null) {
    return (
      <main class="screen centre">
        <Brand />
        <p class="alert" role="alert">
          {error}
        </p>
        <button type="button" class="btn-primary" onClick={startFresh}>
          Try again
        </button>
        <button type="button" class="btn-quiet" onClick={onLeaveSolo}>
          Join a room instead
        </button>
      </main>
    );
  }

  if (stream.ended !== null) {
    return (
      <main class="screen centre">
        <Brand />
        <p role="status">{stream.ended}</p>
        <button type="button" class="btn-primary" onClick={startFresh}>
          Play again
        </button>
        <button type="button" class="btn-quiet" onClick={onLeaveSolo}>
          Join a room instead
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
          {stream.status === 'reconnecting' ? 'Reconnecting…' : 'Setting up your game…'}
        </p>
      </main>
    );
  }

  const player: PlayerSnapshot = snapshot;

  if (player.phase === 'lobby') {
    return (
      <SoloLobby
        snapshot={player}
        catalog={catalog}
        catalogLoaded={catalogLoaded}
        onSettings={onSettings}
        onStart={() => command({ cmd: 'start' })}
        onLeaveSolo={onLeaveSolo}
      />
    );
  }

  if (player.phase === 'summary') {
    return (
      <PhoneFrame
        snapshot={player}
        yourResult={stream.yourResult}
        status={stream.status}
        onReconnectNow={stream.reconnectNow}
      >
        <SoloSummary snapshot={player} />
        <nav class="host-controls solo-controls" aria-label="Game controls">
          <button type="button" class="btn-primary" onClick={startFresh}>
            Play again
          </button>
          <button type="button" onClick={onLeaveSolo}>
            Done
          </button>
        </nav>
      </PhoneFrame>
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
  ) : null;

  return (
    <PhoneFrame
      snapshot={player}
      yourResult={stream.yourResult}
      status={stream.status}
      onReconnectNow={stream.reconnectNow}
    >
      {body}
      <SoloControls phase={player.phase} paused={player.paused} onCommand={command} />
    </PhoneFrame>
  );
}
