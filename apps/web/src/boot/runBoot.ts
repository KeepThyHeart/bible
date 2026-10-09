import { h } from 'preact';
import type { VNode } from 'preact';
import { appLinkSegment, formatAppLink, isAppHash, parseAppLink, STUDY_APP_ID } from '@bible/core/browser';
import type { AppId } from '@bible/core/browser';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { releaseBootPrefetch } from '../utils/bootPrefetch';
import { AppShell } from '../host/AppShell';
import {
  activateWithRecovery, appHost, appRegistry, isReloadingForUpdate, loadPersistedAppHost, prefetchApp,
  setShellContext, startPersistingAppHost,
} from '../host/appHost';
import { registerBuiltinApps } from '../host/builtinApps';
import { registerBuiltinModules, takeModuleUrlHandoffs } from '../modules/builtinModules';
import { activateProbedModules, runBootProbes } from '../modules/moduleHost';
import type { BootIntents } from '../modules/moduleHost';
import { startModuleNamespaceLoading } from '../modules/host/i18nNamespaces';
import { setStudyOwnsHash } from '../host/hashGate';
import '../host/webRoute';
import { bootShell } from './shellBoot';

export interface RunBootOptions {
  /** Injected so the boot can be tested without a DOM root. */
  render: (vnode: VNode) => void;
}

/**
 * Which app to open first. A module's boot probe wins (the Presenter's follow
 * link opens Study, its control link the Presenter); then a registered
 * `#/@app` hash; a plain hash means Study; with no hash at all, the persisted
 * active app under its restore policy (probes may mark apps busy first).
 */
export function resolveInitialApp(intents: Pick<BootIntents, 'initialApp' | 'busyApps'>, hash: string): AppId {
  if (intents.initialApp && (intents.initialApp === STUDY_APP_ID || appRegistry.has(intents.initialApp))) return intents.initialApp;
  const link = parseAppLink(hash);
  if (link) {
    const desc = appRegistry.list().find((d) => appLinkSegment(d) === link.segment);
    return desc ? desc.id : STUDY_APP_ID;
  }
  if (hash && hash !== '#') return STUDY_APP_ID;
  // Apps with restore policy 'while-busy' (the Presenter with a saved session) are marked busy first.
  for (const id of intents.busyApps) appRegistry.setBusy(id, true);
  const saved = appHost.restore(loadPersistedAppHost());
  return appRegistry.has(saved) ? saved : STUDY_APP_ID;
}

function whenIdle(fn: () => void): void {
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
  if (ric) ric(fn);
  else setTimeout(fn, 2000);
}

export async function runBoot({ render }: RunBootOptions): Promise<void> {
  // Handoff secrets (the Presenter's control token) leave the URL before anything else.
  takeModuleUrlHandoffs();
  const ctx = await bootShell();
  if (!ctx) return; // update in flight or unauthorized: render nothing
  setShellContext(ctx);
  registerBuiltinApps();
  // Feature modules (task 0113): manifests only; after the client config so flags resolve.
  registerBuiltinModules();
  // Boot probes (task 0123): cheap URL/storage checks of enabled modules, e.g.
  // the Presenter's handoff links, which must leave the URL before the hash is read.
  const intents = runBootProbes();

  const initial = resolveInitialApp(intents, window.location.hash);
  if (initial !== STUDY_APP_ID) {
    setStudyOwnsHash(false);
    const desc = appRegistry.get(initial);
    const link = formatAppLink(desc ? appLinkSegment(desc) : initial);
    if (parseAppLink(window.location.hash)?.segment !== (desc ? appLinkSegment(desc) : initial)) {
      history.replaceState(null, '', link);
    }
  } else if (isAppHash(window.location.hash)) {
    // `#/@study` or an unknown app: the reader starts clean.
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  await ctx.localeReady;
  render(h(ErrorBoundary, null, h(AppShell, { ctx })) as VNode);

  const result = await activateWithRecovery(initial, { source: 'boot' });
  if (result.status === 'failed') {
    if (isReloadingForUpdate()) return;
    throw result.error instanceof Error ? result.error : new Error('The app failed to start.');
  }
  startPersistingAppHost();

  // Drop the boot splash once the first app's first frame has painted.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    (window as unknown as { hideAppLoading?: () => void }).hideAppLoading?.();
  }));

  // Modules with state to resume (a session this device is driving, a follow link), after first paint.
  activateProbedModules(intents.activate);
  // Module catalogs (labels of their contributions) load when idle, off the boot path;
  // a module's own code awaits its namespace when it activates.
  whenIdle(() => startModuleNamespaceLoading());

  releaseBootPrefetch();
  if (initial !== STUDY_APP_ID) whenIdle(() => prefetchApp(STUDY_APP_ID));
}
