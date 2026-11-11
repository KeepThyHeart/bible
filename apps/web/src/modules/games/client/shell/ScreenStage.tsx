/**
 * Everything the shared screen draws for a room, whoever opened it.
 *
 * The owner's screen route and the code-entry TV both end here, so a screen
 * looks the same whichever way it was opened. It holds no controls. The one
 * exception is the organizer bar, drawn only on the owner's screen when the
 * snapshot says it holds control (a laptop on a projector that is also running
 * the room).
 */

import { useCallback, useEffect, useState } from 'preact/hooks';
import type { Catalog, HostCommand, RevealPayload, ScreenSnapshot } from '../../shared/protocol.js';
import { EMPTY_CATALOG, fetchCatalog } from './api.js';
import { useClock } from './clockPort.js';
import { gameName } from './gameLabels.js';
import { hostViewFor, isGamePhase } from './gameViews.js';
import { HostFrame } from './HostFrame.js';
import { HostLobby } from './HostLobby.js';
import { HowToPlay } from './HowToPlay.js';
import { OrganizerBar } from './OrganizerBar.js';
import { Podium } from './Podium.js';
import { joinUrl } from './routes.js';
import type { StreamStatus } from './useRoomStream.js';
import { useRoomTheme } from './theme.js';

export interface ScreenStageProps {
  snapshot: ScreenSnapshot;
  status: StreamStatus;
  reveal: RevealPayload | null;
  /**
   * Whether this screen opened with the room's owner token, rather than a
   * display token or just the code. Only the owner credential may take
   * control back.
   */
  isOwner: boolean;
  /** Reaches the room only from an owner screen that holds control, or to reclaim it. */
  onCommand(command: HostCommand): void;
  onReconnectNow(): void;
}

export function ScreenStage({ snapshot, status, reveal, isOwner, onCommand, onReconnectNow }: ScreenStageProps) {
  const clock = useClock();
  const [catalog, setCatalog] = useState<Catalog>(EMPTY_CATALOG);
  // An empty catalog is either "still loading" or "nothing installed", and only
  // the second is worth a warning.
  const [catalogLoaded, setCatalogLoaded] = useState(false);

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

  // The projector shows the room's theme with no private override: everyone
  // is looking at the same screen.
  useRoomTheme(snapshot.settings.theme);

  const reclaim = useCallback(() => onCommand({ cmd: 'reclaimControl' }), [onCommand]);

  const { gameId } = snapshot.settings;
  const label = gameName(gameId, catalog.games.find((game) => game.id === gameId)?.name ?? gameId);
  const { phase } = snapshot;

  let body;
  if (phase === 'lobby') {
    body = (
      <HostLobby
        snapshot={snapshot}
        catalog={catalog}
        catalogLoaded={catalogLoaded}
        gameLabel={label}
        joinUrl={joinUrl(location.origin, snapshot.code)}
        isOwner={isOwner}
        onReclaim={reclaim}
      />
    );
  } else {
    let game;
    if (isGamePhase(phase)) {
      const View = hostViewFor(gameId, phase);
      game = <View snapshot={snapshot} view={snapshot.view} reveal={reveal} clock={clock} send={onCommand} />;
    } else if (phase === 'intro') {
      game = <HowToPlay gameId={gameId} name={label} endsAt={snapshot.phaseEndsAt} paused={snapshot.paused} />;
    } else {
      game = (
        <Podium
          gameLabel={label}
          standings={snapshot.standings}
          teamStandings={snapshot.teamStandings}
          teamsEnabled={snapshot.settings.teamsEnabled}
        />
      );
    }
    body = (
      <HostFrame
        snapshot={snapshot}
        status={status}
        reveal={reveal}
        isOwner={isOwner}
        onReclaim={reclaim}
        onReconnectNow={onReconnectNow}
      >
        {game}
      </HostFrame>
    );
  }

  return (
    <>
      {body}
      {isOwner && <OrganizerBar snapshot={snapshot} onCommand={onCommand} />}
    </>
  );
}
