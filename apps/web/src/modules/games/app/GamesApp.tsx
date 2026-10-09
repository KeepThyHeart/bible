/**
 * The Games app (`#/@games`): the host screen. Lazy: this file and everything
 * under `../client` form one chunk, fetched when the app is opened.
 *
 * The games' own client is Preact like the rest of the web app, so it mounts
 * directly (no iframe, no second framework). Its styles are scoped under
 * `.games-root`, and its room theme is written on that element only; until a
 * room sets one, the colour tokens resolve to the reader's `--kth-*` tokens.
 */
import { useCallback, useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { EmbeddedApp } from '../client/App';
import { configureThemeHost } from '../client/shell/theme';
import { reportGamesLive } from '../runtime';
import '../client/registerGames';
import '../client/styles/app.css';

export function GamesApp() {
  const rootRef = useRef<HTMLDivElement>(null);

  // Layout effect: before the children's effects, so a themed first render lands on this element, not <html>.
  useLayoutEffect(() => {
    configureThemeHost(rootRef.current, true);
    return () => {
      configureThemeHost(null, false);
      reportGamesLive(false);
    };
  }, []);

  const onLiveChange = useCallback((live: boolean) => reportGamesLive(live), []);

  return (
    <div ref={rootRef} class="games-root games-root--embedded" data-testid="games-app">
      <EmbeddedApp onLiveChange={onLiveChange} />
    </div>
  );
}
