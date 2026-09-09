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
  pwaEnabled?: boolean;
  offlineDownloads?: boolean;
  offlineAutoDownload?: boolean;
  search?: { semantic?: 'server' | 'browser' | 'off' };
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
