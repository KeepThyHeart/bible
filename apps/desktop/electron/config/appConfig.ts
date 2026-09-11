/**
 * Build-time application configuration - the single source of truth for the
 * handful of values the maintainer has not finalised yet (product name, issue
 * reporting target, module catalog URL).
 *
 * Values are resolved in this order:
 *  1. A build-time `define` injected by electron-vite (see
 *     `electron.vite.config.ts`), which reads the environment variable at
 *     build time and bakes the literal into the bundle.
 *  2. `process.env` at runtime - only reachable in the main process (and in
 *     Node-hosted tests); the sandboxed renderer has no `process`.
 *  3. A hard-coded fallback.
 *
 * This module is deliberately dependency-free (no `electron` import) so it can
 * be pulled into the main process, the preload bundle, the renderer bundle and
 * plain Vitest runs alike. Renderer code should go through
 * `src/ui/config/appConfig.ts`, which prefers the values handed across the
 * preload bridge.
 *
 * Environment variables:
 *   BIBLE_PRODUCT_NAME - user-visible product name. Default "Keep Thy Heart Bible Reader".
 *   BIBLE_ISSUE_REPORT_URL - `https://` issue tracker URL or `mailto:` address.
 *                              Default EMPTY (the Report an Issue command is
 *                              then not registered at all).
 *   BIBLE_MODULE_CATALOG_URL - default module repository/catalog URL.
 *                              Default EMPTY (no repository is seeded).
 *   BIBLE_COPYRIGHT_YEAR - year shown in the About dialog. Defaults to the
 *                              year the bundle was built.
 *   BIBLE_DOCS_URL - `https://` documentation site. Defaults to the
 *                              published docs site; `none` drops the Help panel
 *                              row entirely, for a build that has no docs site
 *                              and must not offer a dead link.
 *   BIBLE_ABOUT_TEXT - a short paragraph about the app, shown at the
 *                              top of the Help panel. Default EMPTY.
 */

/** Fallback used whenever `BIBLE_PRODUCT_NAME` is not supplied. */
export const DEFAULT_PRODUCT_NAME = 'Keep Thy Heart Bible Reader';

/**
 * Fallback used whenever `BIBLE_DOCS_URL` is not supplied. The `desktop/`
 * section of the docs site, not its root: a reader who opens Help from this
 * app wants the desktop guide, not the landing page that asks which app they
 * are using.
 */
export const DEFAULT_DOCS_URL = 'https://docs.bible.keepthyheart.com/desktop/';

export interface AppConfig {
  /** User-visible product name (window titles, About dialog, header). */
  readonly productName: string;
  /** Application version, baked in from `package.json` at build time. */
  readonly appVersion: string;
  /**
   * Short git SHA of the source revision this build came from, shown in the
   * About dialog and attached to diagnostics reports. Empty string when git
   * was not available at build time (a source-zip build) or when the module
   * is loaded without a bundler, in which case every consumer must omit it
   * rather than display a blank.
   *
   * A version alone cannot identify a build - two builds of `0.1.0` are the
   * same string and different code - which is what makes this the value a
   * bug report actually needs.
   */
  readonly buildId: string;
  /** Copyright year rendered in the About dialog. */
  readonly copyrightYear: string;
  /**
   * Where "Report an Issue" should send the user. Either an `https://` URL or
   * a `mailto:` address. Empty string means issue reporting is not configured
   * and the command must not be offered.
   */
  readonly issueReportTarget: string;
  /**
   * Default module catalog / repository URL. Empty string means no repository
   * ships with the app and the UI must say so rather than showing a fake
   * example URL.
   */
  readonly moduleCatalogUrl: string;
  /**
   * Documentation site. Empty string means none was configured, and the Help
   * panel must omit the link rather than offering one that goes nowhere.
   */
  readonly docsUrl: string;
  /**
   * A sentence or two about the app for the Help panel. Empty string means the
   * panel shows only its links.
   */
  readonly aboutText: string;
}

// Injected by electron-vite's `define`. Declared as possibly-undefined so the
// `typeof` guards below stay honest when this module is loaded without any
// bundler (Vitest, `tsx`, plain `node`).
declare const __BIBLE_PRODUCT_NAME__: string | undefined;
declare const __BIBLE_ISSUE_REPORT_URL__: string | undefined;
declare const __BIBLE_MODULE_CATALOG_URL__: string | undefined;
declare const __BIBLE_COPYRIGHT_YEAR__: string | undefined;
declare const __BIBLE_APP_VERSION__: string | undefined;
declare const __BIBLE_BUILD_ID__: string | undefined;
declare const __BIBLE_DOCS_URL__: string | undefined;
declare const __BIBLE_ABOUT_TEXT__: string | undefined;

/** Treat missing / blank / whitespace-only values as "not configured". */
function normalize(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** Read an environment variable where a `process` object exists. */
function fromEnv(key: string): string | undefined {
  if (typeof process === 'undefined' || typeof process.env !== 'object' || process.env === null) {
    return undefined;
  }
  return normalize(process.env[key]);
}

// Each `typeof` check must reference the global directly so esbuild's `define`
// substitution kicks in; extracting it into a helper would defeat the replace.
const definedProductName = typeof __BIBLE_PRODUCT_NAME__ === 'string' ? __BIBLE_PRODUCT_NAME__ : undefined;
const definedIssueTarget = typeof __BIBLE_ISSUE_REPORT_URL__ === 'string' ? __BIBLE_ISSUE_REPORT_URL__ : undefined;
const definedCatalogUrl = typeof __BIBLE_MODULE_CATALOG_URL__ === 'string' ? __BIBLE_MODULE_CATALOG_URL__ : undefined;
const definedCopyrightYear = typeof __BIBLE_COPYRIGHT_YEAR__ === 'string' ? __BIBLE_COPYRIGHT_YEAR__ : undefined;
const definedAppVersion = typeof __BIBLE_APP_VERSION__ === 'string' ? __BIBLE_APP_VERSION__ : undefined;
const definedBuildId = typeof __BIBLE_BUILD_ID__ === 'string' ? __BIBLE_BUILD_ID__ : undefined;
const definedDocsUrl = typeof __BIBLE_DOCS_URL__ === 'string' ? __BIBLE_DOCS_URL__ : undefined;
const definedAboutText = typeof __BIBLE_ABOUT_TEXT__ === 'string' ? __BIBLE_ABOUT_TEXT__ : undefined;

/**
 * The docs site, or '' for a build that has none.
 *
 * `BIBLE_DOCS_URL=none` is how a build opts out. A blank value cannot mean
 * that any more: `normalize` reads blank as "not supplied", so it falls
 * through to the default like every other unset variable.
 */
function resolveDocsUrl(): string {
  const configured = normalize(definedDocsUrl) ?? fromEnv('BIBLE_DOCS_URL') ?? DEFAULT_DOCS_URL;
  return configured.toLowerCase() === 'none' ? '' : configured;
}

/**
 * Resolve the configuration. Exported (rather than only the frozen constant)
 * so tests can re-evaluate it after mutating `process.env`.
 */
export function resolveAppConfig(): AppConfig {
  return {
    productName:
      normalize(definedProductName) ?? fromEnv('BIBLE_PRODUCT_NAME') ?? DEFAULT_PRODUCT_NAME,
    appVersion: normalize(definedAppVersion) ?? fromEnv('BIBLE_APP_VERSION') ?? '',
    // No `fromEnv` fallback, deliberately. `BIBLE_BUILD_ID` is a BUILD-time
    // variable, read by `electron.vite.config.ts` when it resolves the define;
    // honouring it again at runtime would let the environment of whoever
    // launched the app relabel a binary it did not build, and would make the
    // "omits build_id on dev builds" diagnostics test depend on the ambient
    // environment. Absent define means absent build id, full stop.
    buildId: normalize(definedBuildId) ?? '',
    copyrightYear:
      normalize(definedCopyrightYear) ??
      fromEnv('BIBLE_COPYRIGHT_YEAR') ??
      String(new Date().getFullYear()),
    issueReportTarget:
      normalize(definedIssueTarget) ?? fromEnv('BIBLE_ISSUE_REPORT_URL') ?? '',
    moduleCatalogUrl:
      normalize(definedCatalogUrl) ?? fromEnv('BIBLE_MODULE_CATALOG_URL') ?? '',
    docsUrl: resolveDocsUrl(),
    aboutText: normalize(definedAboutText) ?? fromEnv('BIBLE_ABOUT_TEXT') ?? '',
  };
}

/** The resolved configuration for this process. */
export const APP_CONFIG: AppConfig = resolveAppConfig();

/**
 * True when the maintainer has configured somewhere for issue reports to go.
 * Callers must not surface the "Report an Issue" command when this is false -
 * a dead link is worse than no menu entry.
 */
export function isIssueReportingConfigured(config: AppConfig = APP_CONFIG): boolean {
  return config.issueReportTarget !== '';
}

/**
 * Build the URL to hand to `shell.openExternal`. For `mailto:` targets a
 * subject line is pre-filled with the product name and version so reports
 * arrive pre-triaged. Returns `undefined` when nothing is configured.
 */
export function buildIssueReportUrl(config: AppConfig = APP_CONFIG): string | undefined {
  const target = config.issueReportTarget;
  if (target === '') return undefined;
  if (!target.toLowerCase().startsWith('mailto:')) return target;

  // Don't clobber a subject the maintainer already spelled out in the value.
  if (target.includes('?')) return target;

  const subject = config.appVersion === ''
    ? `${config.productName}: Issue report`
    : `${config.productName} ${config.appVersion}: Issue report`;
  return `${target}?subject=${encodeURIComponent(subject)}`;
}

/** True when a documentation site was baked into this build. */
export function isDocsSiteConfigured(config: AppConfig = APP_CONFIG): boolean {
  return config.docsUrl !== '';
}

/** True when a default module catalog URL was baked into this build. */
export function isModuleCatalogConfigured(config: AppConfig = APP_CONFIG): boolean {
  return config.moduleCatalogUrl !== '';
}
