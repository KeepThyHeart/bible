import { render } from 'preact';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { isBootLoopTripped, showBootError } from './utils/bootGuard';
import { releaseBootPrefetch } from './utils/bootPrefetch';
import { isPresenterHash, PRESENTER_HASH, rememberReaderHash } from './apps/present/route';
import { bootShell } from './boot/shellBoot';
import { bootStudy, afterStudyFirstPaint } from './apps/study/studyBoot';
import { ensurePresenterRuntime } from './host/presenterRuntime';

// Font Awesome is self-hosted (bundled by Vite) rather than loaded from a CDN: browser
// tracking prevention blocks third-party storage for cdnjs, and a CDN dependency breaks
// icons for offline/PWA use. Only the core + solid + regular styles are imported; the
// brands font is unused and would otherwise be precached by the service worker.
import '@fortawesome/fontawesome-free/css/fontawesome.min.css';
import '@fortawesome/fontawesome-free/css/solid.min.css';
import '@fortawesome/fontawesome-free/css/regular.min.css';
import './styles/main.scss';
// KTH CSS: `--kth-*` tokens aliased to this app's theme vars, then the opt-in `.kth-*` classes. Never kth-base.css
// (the app keeps _base.scss). Both come after main.scss so the map sees the theme vars; the classes are
// single-class and opt-in, so importing them restyles nothing by itself.
import '@bible/ui/css/generated/map-web.css';
import '@bible/ui/css/kth.css';

// Wave A: shell boot, then Study boot, then today's App. The host (wave B) replaces
// the sequence below with runBoot().
async function init() {
  const ctx = await bootShell();
  if (!ctx) return;

  // A cold load at `#/@present` boots the reader as if there were no hash, so
  // Back lands on the last position rather than Home; the presenter hash is put
  // back just before the first render.
  const coldPresenter = isPresenterHash();
  if (coldPresenter) history.replaceState(null, '', window.location.pathname + window.location.search);

  await bootStudy(ctx);

  if (coldPresenter) {
    rememberReaderHash(window.location.hash);
    history.replaceState(null, '', PRESENTER_HASH);
  }

  // Render the app (ErrorBoundary catches component crashes)
  await ctx.localeReady;
  render(<ErrorBoundary><App providers={ctx.providers} /></ErrorBoundary>, document.getElementById('app')!);

  // Everything the first frame depends on is settled. Drop the boot splash once
  // the browser has actually painted that frame, so the app never appears
  // half-built. hideAppLoading is defined by the inline script in index.html.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    (window as unknown as { hideAppLoading?: () => void }).hideAppLoading?.();
  }));

  // Reconnect to a session this device is driving: one adopted from a handoff
  // link, or one it created before a reload. After the first paint, because the
  // reading app has to work whether or not a screen is attached.
  void ensurePresenterRuntime(ctx.adoptedSession);

  afterStudyFirstPaint(ctx);

  // Boot is over; anything index.html prefetched and nobody claimed is now just
  // a response held open for a navigation that may never come.
  releaseBootPrefetch();
}

// index.html's boot-loop detector has already stopped this page and shown the
// recovery UI -- booting again would just feed the loop it caught.
if (isBootLoopTripped()) {
  console.warn('[Boot] Boot-loop detected — app start suppressed');
} else {
  init().catch(err => {
    console.error('[PWA] Bootstrap failed:', err);
    // Show the error fallback UI defined in index.html
    const message = err instanceof TypeError && err.message.includes('fetch')
      ? 'Unable to connect to the server. Check your network connection and try again.'
      : (err?.message || 'Something went wrong while starting the app.');
    showBootError(message);
  });
}
