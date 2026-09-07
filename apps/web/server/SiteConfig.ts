/**
 * Unified configuration loader.
 *
 * Loads `site-config.json` when present; falls back to the legacy separate
 * config files (`server-config.json`, `settings.json`, `search-pipeline.json`)
 * for backward compatibility.
 */

import { resolve } from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { loadSiteSettings, type SiteSettings } from './siteSettings.js';
import { logger } from './utils/logger.js';
import type { SearchPipelineConfig, ScoringConfig } from '@bible/core';

// ─── Raw config shape (matches site-config.schema.json) ────────────────

interface AuthConfig {
  enabled?: boolean;
  passwordHash?: string;
  password?: string;
}

interface FeaturesConfig {
  tagGraph?: boolean;
  semanticSearch?: boolean;
  /** Enable PWA (manifest + service worker). Default true. */
  pwa?: boolean;
  /** Allow users to manually mark modules for offline use. Default false. */
  offlineDownloads?: boolean;
  /**
   * Automatically cache a lite copy of a translation in the browser the first
   * time it is read. Default true. Turning it off keeps every visitor from
   * pulling several MB per translation — worth it for a deployment on metered
   * bandwidth, and for tests, which would otherwise repeat the download and the
   * OPFS import in every fresh browser context.
   */
  offlineAutoDownload?: boolean;
}

interface OfflineConfig {
  staleDays?: number;
}

interface SearchConfig {
  pipelineConfigPath?: string;
  hybrid?: boolean;
  minScore?: number;
  /**
   * Where semantic ("Ideas") search runs:
   *  - 'server'  → server builds the embedding pipeline (uses significant RAM)
   *  - 'browser' → clients run search locally (Web Worker + downloaded model/index); server stays lean
   *  - 'off'     → semantic search disabled
   * Defaults to 'browser'. The server pipeline is only built when mode === 'server'.
   */
  mode?: 'server' | 'browser' | 'off';
}

interface PrivacyConfig {
  /**
   * Privacy posture.
   *  - "strict" (default): session-only auth cookies, in-memory rate limiting,
   *    logger refuses to write IPs/user-agents/client-identifying data to disk.
   *  - "relaxed": persistent auth cookies, request-level details may be logged.
   *    Opt-in for operators who want convenience over minimizing data footprint.
   */
  mode?: 'strict' | 'relaxed';
}

interface UiConfig {
  defaultTheme?: string;
  visibleThemes?: string[];
  visibleFonts?: string[];
  /** Default Bible module abbreviation (e.g., "KJV"). */
  defaultModule?: string;
  /** Default display mode: 'standard', 'reading', or 'study'. */
  defaultDisplayMode?: string;
  /** Panes to disable (e.g., ['dictionary', 'interlinear']). */
  disabledPanes?: string[];
}

interface RawSiteConfig {
  $schema?: string;
  auth?: AuthConfig;
  features?: FeaturesConfig;
  modules?: SiteSettings;
  commentaryPopularity?: Record<string, number>;
  offline?: OfflineConfig;
  search?: SearchConfig;
  ui?: UiConfig;
  privacy?: PrivacyConfig;
  desktopReports?: DesktopReportsConfig;
  repoUrl?: string;
  docsUrl?: string;
}

export type PrivacyMode = 'strict' | 'relaxed';

/**
 * Settings for `/api/desktop-report`, where the desktop app's queued reports
 * land. There is no `enabled` flag: the route is always mounted, because the
 * desktop uploader has no way to discover that a deployment has turned it off
 * and would simply retry a 404 forever. Leaving `token` empty accepts reports
 * from any build; setting it accepts only builds compiled with the matching
 * `BIBLE_DIAGNOSTICS_TOKEN`.
 */
interface DesktopReportsConfig {
  token?: string;
}

// ─── Defaults ───────────────────────────────────────────────────────────

const DEFAULT_STALE_DAYS = 15;
const DEFAULT_MIN_SCORE = 0.15;

// ─── SiteConfig ─────────────────────────────────────────────────────────

export class SiteConfig {
  private readonly raw: RawSiteConfig;
  private readonly dataDir: string;
  private readonly configSource: 'unified' | 'legacy';
  private readonly configPath: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.configPath = resolve(dataDir, 'site-config.json');

    if (existsSync(this.configPath)) {
      this.raw = this.loadJson(this.configPath) ?? {};
      this.configSource = 'unified';
      logger.info('Loaded unified site-config.json');
      // A partial unified config (e.g. one holding only `auth`) must not blank out
      // the whole module list. Fall back to legacy settings.json for the modules
      // section when the unified file doesn't define one.
      if (!this.raw.modules) {
        const legacyModules = loadSiteSettings(this.dataDir);
        if (legacyModules) {
          this.raw.modules = legacyModules;
          logger.info('site-config.json has no "modules" section; using settings.json for module visibility.');
        }
      }
    } else {
      this.raw = this.buildFromLegacy();
      this.configSource = 'legacy';
    }
  }

  // ── Typed getters ───────────────────────────────────────────────────

  get auth(): { enabled: boolean; passwordHash?: string; password?: string } {
    return {
      enabled: this.raw.auth?.enabled !== false,
      passwordHash: this.raw.auth?.passwordHash,
      password: this.raw.auth?.password,
    };
  }

  get features(): { tagGraph: boolean; semanticSearch: boolean; pwa: boolean; offlineDownloads: boolean; offlineAutoDownload: boolean } {
    return {
      tagGraph: this.raw.features?.tagGraph === true,
      semanticSearch: this.raw.features?.semanticSearch === true,
      pwa: this.raw.features?.pwa !== false, // default true
      offlineDownloads: this.raw.features?.offlineDownloads === true, // default false
      offlineAutoDownload: this.raw.features?.offlineAutoDownload !== false, // default true
    };
  }

  get modules(): SiteSettings | null {
    return this.raw.modules ?? null;
  }

  get commentaryPopularity(): Record<string, number> | undefined {
    return this.raw.commentaryPopularity;
  }

  get offline(): { staleDays: number } {
    return {
      staleDays: typeof this.raw.offline?.staleDays === 'number'
        ? this.raw.offline.staleDays
        : DEFAULT_STALE_DAYS,
    };
  }

  get search(): { pipelineConfigPath: string; hybrid: boolean; minScore: number; mode: 'server' | 'browser' | 'off' } {
    return {
      pipelineConfigPath: this.raw.search?.pipelineConfigPath ?? 'search-pipeline.json',
      hybrid: this.raw.search?.hybrid === true,
      minScore: typeof this.raw.search?.minScore === 'number'
        ? this.raw.search.minScore
        : DEFAULT_MIN_SCORE,
      // Default to browser-side search so the server stays lean unless explicitly opted into 'server'.
      mode: this.raw.search?.mode === 'server' || this.raw.search?.mode === 'off'
        ? this.raw.search.mode
        : 'browser',
    };
  }

  get ui(): UiConfig {
    return this.raw.ui ?? {};
  }

  get privacy(): { mode: PrivacyMode } {
    return {
      mode: this.raw.privacy?.mode === 'relaxed' ? 'relaxed' : 'strict',
    };
  }

  /**
   * Note there is deliberately no privacy switch here. Unlike `/api/feedback`,
   * the desktop report route never records a client address in either privacy
   * mode -- see the header of `server/routes/desktopReportRoutes.ts`.
   */
  get desktopReports(): { token: string } {
    return { token: this.raw.desktopReports?.token ?? '' };
  }

  get repoUrl(): string {
    return this.raw.repoUrl ?? '';
  }

  /**
   * URL of the external documentation website, surfaced from the Help dialog.
   * Empty means "no docs site configured" — the client renders nothing rather
   * than a dead link.
   */
  get docsUrl(): string {
    return this.raw.docsUrl ?? '';
  }

  // ── Client-safe config (no secrets) ─────────────────────────────────

  getClientConfig(): Record<string, unknown> {
    const cfg: Record<string, unknown> = {
      showTagGraph: this.features.tagGraph,
    };

    if (this.repoUrl) cfg.repoUrl = this.repoUrl;
    if (this.docsUrl) cfg.docsUrl = this.docsUrl;

    // Semantic search mode — tells the client whether to run Ideas Search locally
    // (browser Web Worker) or hit the server pipeline.
    cfg.search = { semantic: this.search.mode };

    // PWA feature flag
    if (!this.features.pwa) cfg.pwaEnabled = false;

    // Offline downloads feature flag
    if (this.features.offlineDownloads) cfg.offlineDownloads = true;

    // Only sent when off, so the default stays an absent key.
    if (!this.features.offlineAutoDownload) cfg.offlineAutoDownload = false;

    const staleDays = this.offline.staleDays;
    if (staleDays !== DEFAULT_STALE_DAYS) cfg.staleDays = staleDays;

    if (this.raw.commentaryPopularity) {
      cfg.commentaryPopularity = this.raw.commentaryPopularity;
    }

    const ui = this.raw.ui;
    if (ui) {
      cfg.ui = {
        ...(ui.defaultTheme ? { defaultTheme: ui.defaultTheme } : {}),
        ...(ui.visibleThemes ? { visibleThemes: ui.visibleThemes } : {}),
        ...(ui.visibleFonts ? { visibleFonts: ui.visibleFonts } : {}),
        ...(ui.defaultModule ? { defaultModule: ui.defaultModule } : {}),
        ...(ui.defaultDisplayMode ? { defaultDisplayMode: ui.defaultDisplayMode } : {}),
        ...(ui.disabledPanes ? { disabledPanes: ui.disabledPanes } : {}),
      };
      // Only include ui key if there's actual content
      if (Object.keys(cfg.ui as object).length === 0) delete cfg.ui;
    }

    return cfg;
  }

  // ── Password hash write-back ────────────────────────────────────────

  persistAuth(hash: string): void {
    if (this.configSource === 'unified') {
      // Write back to site-config.json
      try {
        const current = this.loadJson(this.configPath) ?? {};
        current.auth = { ...current.auth, passwordHash: hash };
        delete current.auth.password;
        writeFileSync(this.configPath, JSON.stringify(current, null, 2), 'utf-8');
        // Update in-memory state
        this.raw.auth = current.auth;
        logger.info('Password hashed and saved to site-config.json');
      } catch {
        logger.warn('Could not persist password hash to site-config.json');
      }
    } else {
      // Write back to legacy server-config.json
      const legacyPath = resolve(this.dataDir, 'server-config.json');
      try {
        const current = this.loadJson(legacyPath) ?? {};
        delete current.sitePassword;
        current.sitePasswordHash = hash;
        writeFileSync(legacyPath, JSON.stringify(current, null, 2), 'utf-8');
        logger.info('Password hashed and saved to server-config.json');
      } catch {
        logger.warn('Could not persist password hash to server-config.json');
      }
    }
  }

  // ── Search pipeline loader ──────────────────────────────────────────

  getSearchPipelineConfig(): (SearchPipelineConfig & { hybrid?: boolean; minScore?: number; scoring?: ScoringConfig }) | null {
    // Only the 'server' mode builds the in-process embedding pipeline. In 'browser'/'off'
    // mode the server does no semantic heavy lifting (clients search locally), keeping RAM low.
    if (this.search.mode !== 'server') {
      logger.info(`Semantic search mode is '${this.search.mode}'; server-side pipeline not built.`);
      return null;
    }

    const configPath = process.env.SEARCH_CONFIG
      || resolve(this.dataDir, this.search.pipelineConfigPath);

    if (!existsSync(configPath)) {
      logger.info('No search pipeline config found; semantic search disabled.');
      return null;
    }

    try {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      return config;
    } catch (err: any) {
      logger.error(`Failed to load search config from ${configPath}:`, err.message);
      return null;
    }
  }

  // ── Legacy fallback ─────────────────────────────────────────────────

  private buildFromLegacy(): RawSiteConfig {
    const raw: RawSiteConfig = {};

    // server-config.json → auth, features, offline, repoUrl
    const serverConfigPath = resolve(this.dataDir, 'server-config.json');
    const sc = this.loadJson(serverConfigPath);
    if (sc) {
      raw.auth = {
        enabled: sc.noAuth !== true,
        passwordHash: sc.sitePasswordHash,
        password: sc.sitePassword,
      };
      raw.features = { tagGraph: sc.showTagGraph === true };
      raw.repoUrl = sc.repoUrl ?? '';
      raw.docsUrl = sc.docsUrl ?? '';
      if (typeof sc.staleDays === 'number') {
        raw.offline = { staleDays: sc.staleDays };
      }
      // Semantic search mode (server | browser | off) — lets legacy configs opt
      // back into server-side search; otherwise the getter defaults to 'browser'.
      if (sc.searchMode === 'server' || sc.searchMode === 'browser' || sc.searchMode === 'off') {
        raw.search = { mode: sc.searchMode };
      }
    }

    // settings.json → modules
    const siteSettings = loadSiteSettings(this.dataDir);
    if (siteSettings) {
      raw.modules = siteSettings;
    }

    // search-pipeline.json knobs are read on demand via getSearchPipelineConfig()
    // but extract hybrid/minScore if the pipeline config exists
    const searchConfigPath = process.env.SEARCH_CONFIG
      || resolve(this.dataDir, 'search-pipeline.json');
    if (existsSync(searchConfigPath)) {
      try {
        const pipelineCfg = JSON.parse(readFileSync(searchConfigPath, 'utf-8'));
        raw.search = raw.search ?? {};
        if (typeof pipelineCfg.hybrid === 'boolean') raw.search.hybrid = pipelineCfg.hybrid;
        if (typeof pipelineCfg.minScore === 'number') raw.search.minScore = pipelineCfg.minScore;
      } catch {
        // Non-fatal — search config may just be malformed
      }
    }

    return raw;
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  private loadJson(filePath: string): any {
    if (!existsSync(filePath)) return null;
    try {
      return JSON.parse(readFileSync(filePath, 'utf-8'));
    } catch (err: any) {
      logger.error(`Failed to parse ${filePath}: ${err.message}`);
      return null;
    }
  }
}
