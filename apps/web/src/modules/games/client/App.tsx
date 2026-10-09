/**
 * The root of the client.
 *
 * Two jobs, and deliberately no others. It picks one of the three screens a
 * device can be — the projector, a phone in the room, or someone playing alone
 * — and it starts the clock measurement that everything timed hangs off.
 *
 * The clock is started here rather than inside whichever screen needs it first
 * because the offset is a property of the device, not of a screen: measuring it
 * once and sharing it is what makes two phones in the same room agree about
 * when a question ends.
 */

import { useEffect, useState } from 'preact/hooks';
import { HomeScreen } from './shell/HomeScreen.js';
import { PlayApp } from './shell/PlayApp.js';
import { ScreenApp } from './shell/ScreenApp.js';
import { SoloApp } from './shell/SoloApp.js';
import { ClockContext, measuredClock, startMeasuring } from './shell/clockPort.js';
import { PATHS, useMemoryRoute, useRoute } from './shell/routes.js';
import type { RouteState } from './shell/routes.js';

interface AppViewProps {
  routeState: RouteState;
  /** Inside the reader: hosting again is a re-render, not a page load. */
  embedded?: boolean;
  /** Embedded: a room is open on the host screen (drives the app's "live" badge). */
  onLiveChange?(live: boolean): void;
}

function AppView({ routeState, embedded = false, onLiveChange }: AppViewProps) {
  const { route, navigate } = routeState;
  // Bumped to throw the screen away and ask for a fresh room.
  const [screenKey, setScreenKey] = useState(0);

  useEffect(() => startMeasuring(), []);

  return (
    <ClockContext.Provider value={measuredClock}>
      {route.name === 'home' ? (
        <HomeScreen onJoin={() => navigate(PATHS.play)} onHost={() => navigate(PATHS.screen)} />
      ) : route.name === 'screen' ? (
        // Hosting again is a fresh load rather than a re-render: the room was
        // created by an effect that has already run, and a full load is the
        // honest way to ask for a new one. (Embedded, remounting does the same.)
        <ScreenApp
          key={screenKey}
          onLiveChange={onLiveChange}
          code={route.code}
          displayToken={route.displayToken}
          onLeaveHosting={() => {
            if (embedded) {
              navigate(PATHS.screen);
              setScreenKey((key) => key + 1);
            } else {
              location.assign(PATHS.screen);
            }
          }}
        />
      ) : route.name === 'solo' ? (
        <SoloApp onLeaveSolo={() => navigate(PATHS.play)} />
      ) : (
        <PlayApp code={route.code} onNavigate={navigate} />
      )}
    </ClockContext.Provider>
  );
}

/** The standalone client (`games/play.html`): the address bar is the router. */
export function App() {
  return <AppView routeState={useRoute()} />;
}

/** The client inside the reader's `#/@games`: routed in memory. */
export function EmbeddedApp({ initial, onLiveChange }: { initial?: string; onLiveChange?(live: boolean): void }) {
  return <AppView routeState={useMemoryRoute(initial)} embedded onLiveChange={onLiveChange} />;
}
