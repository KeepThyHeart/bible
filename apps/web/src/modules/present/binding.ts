/**
 * The Presenter's web binding: entry-chunk code, so it holds only lazy
 * loaders and the boot probe. The probe takes the handoff links out of the
 * URL (a control link's token must not stay in the address bar) and notices a
 * saved session; the module's code (`module.ts`) loads only when the
 * Presenter is opened, its verse action runs, or the probe found something to
 * resume.
 */
import type { WebFeatureModule } from '../moduleHost';
import { presentManifest } from './manifest';
import { takeControlLinkFromUrl, takeFollowLinkFromUrl } from './lib/controlLink';
import type { AdoptedSession } from './lib/controlLink';
import { ensurePresenterRuntime, hasStoredPresenterSession } from './runtime';

/** What the boot probe found; read by the module code. */
export const presentBoot: { adopted: AdoptedSession | null; followCode: string | null; taken: boolean } = {
  adopted: null,
  followCode: null,
  taken: false,
};

const HANDOFF_KEY = 'kth.present.handoff';

/** The adopted session survives a stale-build reload (bootShell) through sessionStorage. */
function readHandoff(): AdoptedSession | null {
  try {
    const raw = sessionStorage.getItem(HANDOFF_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as AdoptedSession;
    return v && typeof v === 'object' && v.sessionId && v.controlToken && v.joinCode ? v : null;
  } catch {
    return null;
  }
}

function writeHandoff(adopted: AdoptedSession): void {
  try {
    sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(adopted));
  } catch {
    /* storage unavailable: the link is lost on reload, as before */
  }
}

/** Take the control link's token (and the follow code) out of the URL, once. */
function takeLinks(): void {
  if (presentBoot.taken) return;
  presentBoot.taken = true;
  const fromUrl = takeControlLinkFromUrl();
  if (fromUrl) writeHandoff(fromUrl);
  presentBoot.adopted = fromUrl ?? readHandoff();
  presentBoot.followCode = takeFollowLinkFromUrl();
}

export const presentModule: WebFeatureModule = {
  manifest: presentManifest,
  binding: {
    id: 'present',
    load: () => import('./module'),
  },
  apps: [
    {
      id: 'present',
      load: () =>
        import('./app/PresenterApp').then((m) => ({
          View: m.PresenterApp,
          activate: () => ensurePresenterRuntime(presentBoot.adopted),
        })),
      // The PresentBar strip inside Study: its chunk loads only while a session is live.
      companion: {
        when: 'busy',
        load: () => import('./study/PresentBar').then((m) => ({ View: m.PresentBar })),
      },
    },
  ],
  verseActionHandlers: [
    { id: 'present.showVerse', load: () => import('./app/presentVerseAction').then((m) => m.presentVerseHandler) },
  ],
  // A control link's token leaves the address bar before the shell boots (a laptop on a
  // projector must not show it while the server answers), even if the module is off.
  takeUrl: takeLinks,
  probe() {
    takeLinks();
    // The handoff only needs to outlive a reload before the probe; clear it once read here.
    try {
      sessionStorage.removeItem(HANDOFF_KEY);
    } catch {
      /* ignore */
    }
    // A follow link wins (Study, following); a control link adopts the Presenter.
    if (presentBoot.followCode) return { initialApp: 'study', activate: true };
    if (presentBoot.adopted) return { initialApp: 'present', activate: true };
    // The Presenter's restore policy is 'while-busy': a saved session marks it busy first.
    if (hasStoredPresenterSession()) return { busyApps: ['present'], activate: true };
    return null;
  },
};
