import express from 'express';
import { resolve, join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import timeout from 'connect-timeout';
import { DatabaseManager } from './DatabaseManager.js';
import { createPasswordGate, hashPassword } from './middleware/passwordGate.js';
import { createCompression } from './middleware/compression.js';
import { createRateLimiter, tierForApiPath } from './middleware/rateLimiter.js';
// Side-effect imports: each route file self-registers with the route registry
import './routes/moduleRoutes.js';
import './routes/bibleRoutes.js';
import './routes/commentaryRoutes.js';
import './routes/interlinearRoutes.js';
import './routes/searchRoutes.js';
import './routes/strongsRoutes.js';
import './routes/crossRefRoutes.js';
import './routes/topicalRoutes.js';
import './routes/tagGraphRoutes.js';
import './routes/dictionaryRoutes.js';
import './routes/studyOverviewRoutes.js';
import './routes/feedbackRoutes.js';
import './routes/desktopReportRoutes.js';
import { getRegisteredRoutes } from './routes/routeRegistry.js';
import type { ISearchPipeline, IVectorSearch } from '@bible/core';
import { createSearchPipelineWithComponents } from './search/SearchPipelineFactory.js';
import type { SqliteVectorSearch } from './search/SqliteVectorSearch.js';
import { logger } from './utils/logger.js';
import { ServerPluginManager } from './plugins/pluginManager.js';
import { SiteConfig } from './SiteConfig.js';

const PORT = parseInt(process.env.PORT || '3100', 10);

const currentDir = typeof import.meta.dirname === 'string'
  ? import.meta.dirname
  : resolve(fileURLToPath(import.meta.url), '..');

// Determine package root: in dev (server/) go up 1, in prod (dist/server/) go up 2
const packageRoot = existsSync(resolve(currentDir, '../package.json'))
  ? resolve(currentDir, '..')
  : resolve(currentDir, '../..');

const dataDir = process.env.BIBLE_DATA_DIR || resolve(packageRoot, 'data');
const modulesDir = process.env.BIBLE_MODULES_DIR || resolve(packageRoot, '../../data');

// Initialize file logging before any other output
logger.init(dataDir);
logger.info(`Data directory: ${dataDir}`);
logger.info(`Modules directory: ${modulesDir}`);

const db = new DatabaseManager(dataDir, modulesDir);

const app = express();

// Trust reverse proxies (nginx, Caddy, etc.) for correct req.ip, req.protocol, etc.
// Without this, Express misidentifies protocol/IP when behind SSL-terminating proxies.
app.set('trust proxy', true);

// Compress text responses (API JSON, the SPA shell, and the hashed assets).
// See `middleware/compression.ts` for what it declines and why.
app.use(createCompression());

/**
 * Reference content that is keyed entirely by module + book + chapter. No user
 * identity goes into these responses and they never change between requests, so
 * the browser's own HTTP cache can hold them.
 *
 * This is the plain-HTTP replacement for the service worker's `commentary-text`
 * and `study-overview` runtime caches. With the PWA off (the default — see
 * ENABLE_PWA in vite.config.ts) there is no worker to hold them, and these are
 * the bulk of repeat traffic while reading a chapter.
 *
 * Paths are relative to the `/api` mount point.
 */
const CACHEABLE_API_PATHS = [
  /^\/commentary\/[^/]+\/\d+\/\d+$/,          // /api/commentary/:module/:book/:chapter
  /^\/commentary\/all\/\d+\/\d+$/,            // /api/commentary/all/:book/:chapter
  /^\/commentary\/chapter-overview\/\d+\/\d+$/, // word counts; drives the prefetch budget
  /^\/study\/overview\/\d+\/\d+$/,            // /api/study/overview/:book/:chapter
  // Interlinear is chapter-keyed and immutable, but was being refetched on
  // every chapter navigation at ~155 KB and ~290 ms a time because no-store
  // made its ETag useless.
  /^\/interlinear\/\d+\/\d+$/,                // /api/interlinear/:book/:chapter
  // Immutable for the life of a deploy, previously refetched on every boot
  // and on every Strong's popup.
  /^\/books$/,
  /^\/strongs\/[^/]+$/,
];

// `private` keeps these out of shared proxies — the response still travelled
// through the password gate, even though its body is not user-specific.
const CACHEABLE_API_HEADER = 'private, max-age=3600, stale-while-revalidate=86400';

const NO_STORE = 'no-cache, no-store, must-revalidate';

// Everything under /api is no-store by default: responses are auth-gated and
// user-specific, and a cached 200 outlives a logout.
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', NO_STORE);
  if (req.method !== 'GET' || !CACHEABLE_API_PATHS.some(re => re.test(req.path))) return next();

  // Upgrade to a cacheable header at write time rather than here, so only a 2xx
  // gets it. Pinning a 404 or a 503 for an hour would outlive the fix for
  // whatever produced it — and a missing module answers 404 on a valid-looking
  // path, so this is the common case, not the edge case.
  const writeHead = res.writeHead.bind(res);
  res.writeHead = function patchedWriteHead(this: express.Response, ...args: unknown[]) {
    // Only upgrade the default. A route that set its own Cache-Control meant
    // it — overwriting unconditionally silently discarded route-level policy
    // (several routes ask for `public, max-age=86400` and were being quietly
    // downgraded to `private, max-age=3600`).
    const current = res.getHeader('Cache-Control');
    if (res.statusCode >= 200 && res.statusCode < 300 && current === NO_STORE) {
      res.setHeader('Cache-Control', CACHEABLE_API_HEADER);
    }
    return (writeHead as (...a: unknown[]) => express.Response)(...args);
  } as typeof res.writeHead;
  next();
});

// Unified configuration (site-config.json or legacy fallback)
const siteConfig = new SiteConfig(dataDir);

// Apply privacy mode to the logger as early as possible, so any subsequent
// startup logging honors the configured posture.
const privacyMode = siteConfig.privacy.mode;
logger.setPrivacyMode(privacyMode);
logger.info(`Privacy mode: ${privacyMode}`);

const authConfig = siteConfig.auth;
const NO_AUTH = !authConfig.enabled || process.env.NO_AUTH === '1';

// Resolve the password hash: prefer pre-hashed, otherwise hash the plain-text
// password and persist the hash back so the plain-text doesn't stay in config.
//
// There is deliberately no fallback password. A built-in default is a password
// every deployment shares until someone remembers to change it, so an enabled
// gate with nothing configured is a startup error rather than a warning. Run
// with "auth.enabled": false if you genuinely want no gate.
let sitePasswordHash = '';
if (authConfig.passwordHash) {
  sitePasswordHash = authConfig.passwordHash;
} else if (!NO_AUTH) {
  const plainPassword = authConfig.password || process.env.SITE_PASSWORD || '';
  if (!plainPassword) {
    console.error(
      '[Server] FATAL: the password gate is enabled but no password is set. Set "auth.password" ' +
        'in site-config.json, set the SITE_PASSWORD environment variable, or set "auth.enabled": false.'
    );
    process.exit(1);
  }
  sitePasswordHash = hashPassword(plainPassword);
  siteConfig.persistAuth(sitePasswordHash);
}

// Security headers via Helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // 'unsafe-inline' is required for the error-fallback inline script in index.html.
      // The hash alternative would require rebuilding the client on every change.
      // 'wasm-unsafe-eval' lets WebAssembly compile. Without it the browser
      // refuses to instantiate any wasm module, which kills the wa-sqlite
      // worker behind offline module storage and the in-browser search index
      // ("Refused to compile or instantiate WebAssembly module"). It is the
      // narrow directive for exactly this — it does NOT re-enable eval() for
      // JavaScript, unlike 'unsafe-eval'.
      scriptSrc: ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'"],
      // No external origins: reading fonts are self-hosted under /fonts (see
      // scripts/fetch-fonts.mjs) and Font Awesome is bundled from node_modules
      // (see the comment in src/main.tsx). The Google Fonts and cdnjs
      // allowances these directives used to carry are both dead.
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      // Do NOT include upgrade-insecure-requests: it causes browsers to upgrade HTTP
      // requests to HTTPS, breaking local dev servers that serve over plain HTTP.
      upgradeInsecureRequests: null,
    }
  },
  // HSTS is only meaningful for production HTTPS deployments. In local/test
  // environments the server runs over HTTP, so HSTS would cause browsers to
  // upgrade future requests to HTTPS and break subsequent page loads.
  hsts: false,
  crossOriginEmbedderPolicy: false,  // keep false — enabling it can break WASM
}));

// Body size limits (item #5)
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '50kb' }));

// Request timeouts on expensive endpoints (item #1).
//
// connect-timeout only marks the request and sends a 503 — it cannot stop work
// that is already running, and by itself it lets a handler carry on and then
// write to an already-finished response. haltOnTimedout stops a timed-out
// request from entering the handler at all; the route handlers additionally
// re-check `req.timedout` after their own async boundaries.
function haltOnTimedout(req: express.Request, _res: express.Response, next: express.NextFunction): void {
  if (!req.timedout) next();
}

app.use('/api/search', timeout('15s'), haltOnTimedout);
app.use('/api/commentary/all', timeout('20s'), haltOnTimedout);

// Rate limiter — in-memory counters (IPs never persisted). Global ceiling
// runs first so a flood can't exhaust downstream handlers before per-tier
// limits kick in. Tier-specific middleware is mounted below on the API
// route prefixes.
if (process.env.DISABLE_RATE_LIMIT === '1') {
  logger.warn('[security] DISABLE_RATE_LIMIT is set — all rate limiting is OFF');
  logger.info('Rate limiting disabled (DISABLE_RATE_LIMIT=1)');
} else {
  const rateLimiter = createRateLimiter();

  // Scoped to /api so static assets, /data, the SPA shell and the login page
  // don't consume the ceiling — a reader loading the page should not be able
  // to 429 someone else's API calls.
  app.use('/api', rateLimiter.global());

  // ONE tier per request. Mounting `app.use('/api', default)` alongside the
  // prefix mounts did not replace them, it ran in addition to them: Express
  // runs every matching `app.use`, so each request incremented its own tier
  // *and* `default`. `default` was the lower cap, so it always tripped first
  // and `content` was unreachable — the whole API was effectively capped at
  // the default tier. Selecting the tier here keeps that impossible.
  app.use('/api', (req, res, next) =>
    rateLimiter.middleware(tierForApiPath(req.path))(req, res, next));
}

if (!NO_AUTH) {
  app.use(createPasswordGate({ passwordHash: sitePasswordHash, privacyMode }));
} else {
  logger.info('Auth disabled (NO_AUTH=1)');
}

// Load search pipeline config if available
let searchPipeline: ISearchPipeline | undefined;
let searchVectorSearch: IVectorSearch | undefined;
const searchHybridDefault = siteConfig.search.hybrid;
const searchMinScore = siteConfig.search.minScore;
let searchScoringConfig: import('@bible/core').ScoringConfig | undefined;

const pipelineConfig = siteConfig.getSearchPipelineConfig();
if (pipelineConfig) {
  searchScoringConfig = pipelineConfig.scoring;
  createSearchPipelineWithComponents(pipelineConfig)
    .then(({ pipeline, vectorSearch }) => {
      searchPipeline = pipeline;
      searchVectorSearch = vectorSearch;
      return searchPipeline.initialize();
    })
    .then(() => logger.info('Search pipeline initialized.'))
    .catch(err => logger.error('Search pipeline init failed:', err.message));
}

// Read package version once at startup
const packageVersion = JSON.parse(
  readFileSync(resolve(packageRoot, 'package.json'), 'utf-8')
).version as string;

/**
 * Build identifier for the client bundle currently on disk.
 *
 * Written by vite.config.ts during the client build, so this value and the one
 * compiled into the bundle always come from the same build. The client compares
 * the two on boot and updates itself when they differ, which is what stops a
 * stale cached client from talking to a newer server.
 *
 * Read per request rather than cached at startup. A server outlives a client
 * rebuild in every dev and test workflow, and a cached id then answers with a
 * build that is no longer on disk: the browser is served the new bundle, told
 * the server is on the old one, and reloads to fix a mismatch that reloading
 * cannot fix. The file is a few bytes and this endpoint is hit once per boot.
 */
const buildIdPath = resolve(packageRoot, 'dist/client/build-id.json');

function readBuildId(): string | undefined {
  if (!existsSync(buildIdPath)) return undefined;
  try {
    return JSON.parse(readFileSync(buildIdPath, 'utf-8')).buildId as string;
  } catch (err) {
    logger.warn('[Server] Could not read build-id.json:', err);
    return undefined;
  }
}

const startupBuildId = readBuildId();
if (startupBuildId) logger.info(`Client build: ${startupBuildId}`);

// Health and version endpoints
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/version', (_req, res) => {
  // Never cached anywhere: this is the answer the client uses to decide whether
  // everything else it holds is stale.
  res.set('Cache-Control', 'no-store');
  res.json({ version: packageVersion, buildId: readBuildId() });
});

app.get('/api/config', (_req, res) => {
  res.json(siteConfig.getClientConfig());
});

// Plugin system — discover and activate server-side plugins
const pluginsDir = resolve(dataDir, 'plugins');
const pluginsDataDir = resolve(dataDir, 'plugin-data');
const pluginManager = new ServerPluginManager(db, pluginsDir, pluginsDataDir);
pluginManager.discover();
await pluginManager.activate();

// Plugin API — list active plugins for client-side loading
app.get('/api/plugins', (_req, res) => {
  res.json({ plugins: pluginManager.getActivePlugins() });
});

// Mount plugin middleware (runs before core routes)
pluginManager.mountRoutes(app);

// API routes — mounted via route registry (each route file self-registers)
const searchRouteOptions = {
  get topicEntries() {
    return (searchVectorSearch as SqliteVectorSearch)?.topicEntries;
  },
  get pipeline() {
    return searchPipeline;
  },
  get scoringConfig() {
    return searchScoringConfig;
  },
};
const routeDeps = {
  db,
  siteSettings: siteConfig.modules,
  extra: {
    searchRouteOptions,
    hybridDefault: searchHybridDefault,
    minScoreDefault: searchMinScore,
    showTagGraph: siteConfig.features.tagGraph,
    hooks: pluginManager.hooks,
    // Route factories that need to write to disk (feedback) take the data
    // directory from here rather than reaching into DatabaseManager's private
    // field, and the privacy posture so they can honor 'strict'.
    dataDir,
    privacyMode,
    // Shared token the desktop uploader must present. Empty accepts any build.
    desktopReportToken: siteConfig.desktopReports.token,
  } as Record<string, unknown>,
};
for (const reg of getRegisteredRoutes()) {
  app.use(reg.path, reg.createRoutes(routeDeps));
}

// Serve semantic search data files for browser-side Ideas Search
// These are large binary files — set long cache headers since they're versioned by filename
app.use('/data', express.static(dataDir, {
  // fallthrough:false → a missing /data file returns a real 404 instead of falling
  // through to the SPA catch-all below (which would return index.html and make the
  // search worker choke trying to JSON.parse HTML).
  fallthrough: false,
  maxAge: '7d',
  setHeaders(res, filePath) {
    if (filePath.endsWith('.bin')) {
      res.set('Content-Type', 'application/octet-stream');
    }
  },
}));

// Serve static client files in production
const clientDir = resolve(packageRoot, 'dist/client');
if (existsSync(clientDir)) {
  app.use(express.static(clientDir, {
    // Let the catch-all below own the SPA shell so it can set no-store on it.
    // With the default (`index: 'index.html'`) a request for `/` is answered
    // here instead, and the shell picks up ordinary revalidation headers.
    index: false,
    setHeaders(res, filePath) {
      // The shell, the build stamp, and the worker script must never be served
      // stale. `sw.js` matters even with the PWA off: in a non-PWA build it is
      // the self-destroying worker whose whole job is to reach browsers that
      // still have an old one installed.
      if (filePath.endsWith('index.html') || filePath.endsWith('build-id.json')
          || filePath.endsWith('sw.js')) {
        res.set('Cache-Control', 'no-store');
        return;
      }
      // Vite content-hashes everything under assets/, so a given URL's bytes can
      // never change. Pinning them is what makes repeat visits cheap now that no
      // service worker precaches the bundle.
      if (/[\\/]assets[\\/]/.test(filePath)) {
        res.set('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  }));
  app.get('*', (req, res) => {
    // The SPA shell is ONLY a valid answer for genuine browser navigations.
    // Anything else — /api/*, /data/*, or any fetch/XHR that expects JSON/binary —
    // must 404 loudly instead of silently receiving index.html. Serving HTML where
    // JSON is expected is how a routing/auth bug masquerades as "working" while the
    // client chokes on JSON.parse(<!DOCTYPE html>...).
    const isApiOrData = req.path.startsWith('/api/') || req.path.startsWith('/data/');
    const wantsHtml = req.accepts(['html', 'json']) === 'html';
    if (isApiOrData || !wantsHtml) {
      res.status(404).json({ error: 'Not found', path: req.path });
      return;
    }
    // no-store on the shell: it names the hashed asset files, so a stale copy
    // pins the browser to a stale build. The assets it points at are immutable
    // and stay cacheable.
    res.set('Cache-Control', 'no-store');
    res.sendFile(join(clientDir, 'index.html'));
  });
}

// Global error handler — catches unhandled errors in route handlers.
// Logs full details to the server log file; returns a generic message to the client.
app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error(`${req.method} ${req.path}:`, err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An internal server error occurred' } });
});

const server = app.listen(PORT, () => {
  logger.info(`Bible web app running on http://localhost:${PORT}`);
});

// HTTP server timeouts (item #1)
server.headersTimeout = 10_000;   // 10s to receive full request headers
server.requestTimeout = 30_000;   // 30s total per request

// Graceful shutdown
function shutdown() {
  logger.info('Shutting down...');
  pluginManager.shutdown().catch(err => logger.error('Plugin shutdown error:', err));
  searchPipeline?.dispose().catch(() => {});
  db.closeAll();
  server.close();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', () => {
  shutdown();
  process.exit(0);
});

export { app, db };
