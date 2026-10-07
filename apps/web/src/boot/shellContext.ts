import type { createServerProviders } from '../providers/ServerDataProvider';

export type ShellProviders = ReturnType<typeof createServerProviders>;

/**
 * What the shell learned while booting, handed to every app's boot. Type-only
 * module: importing it costs nothing at runtime.
 */
export interface ShellContext {
  baseUrl: string;
  providers: ShellProviders;
  serverOnline: boolean;
  serverStaleDays: number | undefined;
  offlineAutoDownload: boolean;
  semanticMode: 'server' | 'browser' | 'off';
  /** Presenter session adopted from a control (handoff) link, if any. */
  adoptedSession: ReturnType<typeof import('../present/controlLink').takeControlLinkFromUrl>;
  /** Join code of a `/present/f/<code>` load, if any. */
  followCode: ReturnType<typeof import('../present/controlLink').takeFollowLinkFromUrl>;
  /** Resolves once the detected locale's catalogs are loaded; await before first render. */
  localeReady: Promise<void>;
}
