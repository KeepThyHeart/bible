/**
 * The one copy of `/api/config` this app holds.
 *
 * `main.tsx` fetches it during boot (through the inline prefetch) and every
 * later reader gets that same object from here. Nothing else may request it:
 * `DesktopApp` used to fetch it a second time on mount purely to learn whether
 * the tag graph is enabled, which is a whole extra round trip on the boot path
 * for one boolean that was already in hand.
 *
 * Read it synchronously. It is set before `render()`, so any component or store
 * asking is asking after it has been filled in; a build or a test that never
 * calls `setClientConfig` sees the documented defaults instead.
 */

export interface ClientConfig {
  /** Whether the tag-graph (entities) feature is turned on for this deployment. */
  showTagGraph?: boolean;
  staleDays?: number;
  commentaryPopularity?: Record<string, number>;
  ui?: Record<string, unknown>;
  /** Every feature flag, resolved by the server (see `utils/featureFlags.ts`). */
  features?: Record<string, boolean>;
  /** `features.pwa`: true only when the server has the PWA on. Absent (offline) means unknown. */
  pwaEnabled?: boolean;
  /** `features.pwaUpdate`: how a newer build reaches an open page. Default `silent`. */
  pwaUpdate?: 'silent' | 'prompt';
  offlineDownloads?: boolean;
  offlineAutoDownload?: boolean;
  search?: { semantic?: 'server' | 'browser' | 'off' };
  /** Audio Bible settings; absent unless the operator turned the feature on. */
  audio?: unknown;
  repoUrl?: string;
  docsUrl?: string;
  [key: string]: unknown;
}

let config: ClientConfig = {};

/** Record the config `main.tsx` fetched. A null answer (offline) leaves defaults. */
export function setClientConfig(cfg: ClientConfig | null): void {
  if (cfg) config = cfg;
}

export function getClientConfig(): ClientConfig {
  return config;
}

/**
 * Whether the tag graph is enabled for this deployment.
 *
 * Off unless the server says otherwise — matching `SiteConfig.features.tagGraph`,
 * which also defaults to false. This gates the *request*, not just the render:
 * with the feature off there is no pane that can show entities, so asking
 * `/api/taggraph/verse/:id` for every verse selection is a round trip whose
 * answer is thrown away.
 */
export function isTagGraphEnabled(): boolean {
  return config.showTagGraph === true;
}

/**
 * Whether the PWA (service worker, manifest, install) is on for this deployment.
 *
 * Tri-state on purpose: `true`/`false` when the server answered, `undefined`
 * when it did not (offline boot). Callers must not treat "unknown" as "off":
 * unregistering the worker because the network is down would delete the very
 * thing that lets the app boot offline. This is the one place that reads the
 * flag, so a settings/feature-flag registry can replace it later.
 */
export function pwaFlag(): boolean | undefined {
  return typeof config.pwaEnabled === 'boolean' ? config.pwaEnabled : undefined;
}

/** Update mode for an open page; see `UpdateMode` in `appUpdate.ts`. */
export function pwaUpdateMode(): 'silent' | 'prompt' {
  return config.pwaUpdate === 'prompt' ? 'prompt' : 'silent';
}
