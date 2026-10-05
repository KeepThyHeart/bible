import { render } from 'preact';
import { isBootLoopTripped, showBootError } from './utils/bootGuard';
import { runBoot } from './boot/runBoot';

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

// index.html's boot-loop detector has already stopped this page and shown the
// recovery UI -- booting again would just feed the loop it caught.
if (isBootLoopTripped()) {
  console.warn('[Boot] Boot-loop detected — app start suppressed');
} else {
  runBoot({ render: (vnode) => render(vnode, document.getElementById('app')!) }).catch(err => {
    console.error('[PWA] Bootstrap failed:', err);
    // Show the error fallback UI defined in index.html
    const message = err instanceof TypeError && err.message.includes('fetch')
      ? 'Unable to connect to the server. Check your network connection and try again.'
      : (err?.message || 'Something went wrong while starting the app.');
    showBootError(message);
  });
}
