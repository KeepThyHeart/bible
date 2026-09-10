/**
 * Presentation sessions: the HTTP surface for driving a screen from a phone.
 *
 * A session has one writer and many readers, and the two capabilities are
 * carried by two different values on two different kinds of request:
 *
 *  - Readers hold the **join code** and open an SSE stream at
 *    `/api/present/j/:joinCode/stream`. The code is in the path because
 *    `EventSource` cannot set request headers -- there is no way to
 *    authenticate a stream except through its URL.
 *  - The writer holds the **control token** and sends it as `X-Present-Token`
 *    on POSTs under `/api/present/s/:sessionId/`. Never in a path, never in a
 *    query string, so it stays out of access logs and `Referer` headers.
 *
 * That split is the security model, not an accident of the transport: the two
 * capabilities travel by different routes and cannot be confused for one
 * another. The `j/` and `s/` prefixes keep it visible in the URL which kind of
 * identifier a given route expects.
 */

import { Router, type Request, type Response } from 'express';
import type { DatabaseManager } from '../DatabaseManager.js';
import { sendError, ErrorCodes } from '../utils/errorResponse.js';
import { registerRoute } from './routeRegistry.js';
import { logger } from '../utils/logger.js';
import { PresentHub } from '../present/PresentHub.js';
import { PresentStore } from '../present/PresentStore.js';
import { qrSvg } from '../../src/present/qr.js';
import { applyIntent, validateIntent, validatePlan, LIMITS } from '../present/reducer.js';
import type { IntentContext } from '../present/reducer.js';
import { isValidSessionId, normalizeJoinCode, verifyControlToken } from '../present/tokens.js';
import { HymnLibrary } from '../present/hymns/HymnLibrary.js';
import { sharedHymnLibrary } from './hymnRoutes.js';
import type { PresentSessionRow } from '../present/PresentStore.js';
import type { PresentClosedPayload, PresentState } from '../../src/present/protocol.js';

/** Failed join attempts tolerated from one address before it is shut out. */
const JOIN_ATTEMPT_LIMIT = 10;
const JOIN_ATTEMPT_WINDOW_MS = 15 * 60_000;

/** How often expired sessions are swept. Cheap enough to run on a small box. */
const SWEEP_INTERVAL_MS = 10 * 60_000;

interface Attempts {
  count: number;
  first: number;
}

export interface PresentRouteOptions {
  db: DatabaseManager;
  /** Where `present.db` lives -- the instance's own state directory. */
  appStateDir: string;
  /**
   * Where the hymn library is read from. The reducer needs it to know how many
   * slides a hymn has, which is what `next` runs out of.
   */
  hymnDirs?: string[];
  /** Overridable for tests. */
  store?: PresentStore;
  hub?: PresentHub;
  library?: HymnLibrary;
}

export function createPresentRoutes(options: PresentRouteOptions): Router {
  const router = Router();
  const store = options.store ?? new PresentStore(`${options.appStateDir}/present.db`);
  const hub = options.hub ?? new PresentHub();
  // An empty library rather than none: a deployment with no hymns installed is
  // ordinary, and every hymn lookup then simply answers "not in the library".
  const library = options.library ?? sharedHymnLibrary(options.hymnDirs ?? []);

  // ---------------------------------------------------------------------------
  // Chapter lengths
  // ---------------------------------------------------------------------------

  /**
   * Memoized because `next` at the end of a chapter would otherwise re-read the
   * whole chapter on every keypress, and a presenter holding the arrow key is
   * exactly when that happens.
   */
  const chapterLengths = new Map<string, number | null>();
  const intentContext: IntentContext = {
    chapterLength(module, book, chapter) {
      const key = `${module}/${book}/${chapter}`;
      const cached = chapterLengths.get(key);
      if (cached !== undefined) return cached;

      let length: number | null = null;
      try {
        const repo = options.db.getBibleRepo(module);
        const verses = repo?.getChapter(book, chapter);
        length = verses && verses.length > 0 ? verses.length : null;
      } catch (error) {
        logger.warn(`[present] chapter length lookup failed for ${key}:`, error);
      }
      chapterLengths.set(key, length);
      return length;
    },

    slideCount(hymnId, verseOrder) {
      // Not memoized: packing a hymn is a pass over a few dozen short strings,
      // and the order can differ per call, so a cache key would cost more than
      // the work it saved.
      return library.slideCount(hymnId, verseOrder);
    },
  };

  // ---------------------------------------------------------------------------
  // Join throttling
  // ---------------------------------------------------------------------------

  const joinAttempts = new Map<string, Attempts>();

  function clientIp(req: Request): string {
    return req.ip || req.socket.remoteAddress || 'unknown';
  }

  function joinThrottled(req: Request): boolean {
    const record = joinAttempts.get(clientIp(req));
    if (!record) return false;
    if (Date.now() - record.first > JOIN_ATTEMPT_WINDOW_MS) {
      joinAttempts.delete(clientIp(req));
      return false;
    }
    return record.count >= JOIN_ATTEMPT_LIMIT;
  }

  function recordFailedJoin(req: Request): void {
    const ip = clientIp(req);
    const record = joinAttempts.get(ip);
    if (!record || Date.now() - record.first > JOIN_ATTEMPT_WINDOW_MS) {
      joinAttempts.set(ip, { count: 1, first: Date.now() });
    } else {
      record.count++;
    }
  }

  // ---------------------------------------------------------------------------
  // Shared helpers
  // ---------------------------------------------------------------------------

  /** Merge the persisted state with the facts only the live layer knows. */
  function toWireState(row: PresentSessionRow): PresentState {
    return {
      ...row.state,
      version: row.version,
      session: {
        ...row.state.session,
        id: row.sessionId,
        joinCode: row.joinCode,
        viewerCount: hub.viewerCount(row.sessionId),
      },
    };
  }

  function isExpired(row: PresentSessionRow, now = Date.now()): boolean {
    return Date.parse(row.expiresAt) <= now;
  }

  /**
   * Open a stream only to say why it is not going to carry anything.
   *
   * A refusal has to arrive as a 200 with a `closed` event rather than an error
   * status, because `EventSource` retries any failed connection indefinitely --
   * a projector left running would reconnect all night. A `closed` event is the
   * one thing that tells the client to stop.
   */
  function refuseStream(res: Response, reason: PresentClosedPayload['reason']): void {
    res.write(`event: closed\ndata: ${JSON.stringify({ reason })}\n\n`);
    res.end();
  }

  /**
   * Resolve a join code to a live session.
   *
   * Unknown, expired and malformed codes are one indistinguishable 404: telling
   * a caller which of those it hit turns the endpoint into an oracle for
   * checking whether a code exists.
   *
   * Locked and full sessions are reported distinctly -- but over the stream, as
   * a `closed` event, not as a status code. They are states an operator
   * deliberately caused and needs to see reported accurately, and with 40 bits
   * of code space behind a ten-attempt window nobody is enumerating their way
   * to one anyway.
   */
  function resolveJoin(req: Request, res: Response): PresentSessionRow | null {
    if (joinThrottled(req)) {
      res.setHeader('Retry-After', String(Math.ceil(JOIN_ATTEMPT_WINDOW_MS / 1000)));
      sendError(res, 429, ErrorCodes.INVALID_PARAM, 'Too many join attempts');
      return null;
    }

    const joinCode = normalizeJoinCode(req.params.joinCode);
    const row = joinCode ? store.getByJoinCode(joinCode) : null;
    if (!row || (isExpired(row) && !row.endedAt)) {
      recordFailedJoin(req);
      sendError(res, 404, ErrorCodes.NOT_FOUND, 'Session not found');
      return null;
    }
    return row;
  }

  /**
   * Resolve a session id and check the control token.
   *
   * A bad token and an unknown session both answer 404 rather than 401: a 401
   * would confirm that the session exists to someone who cannot drive it.
   */
  function resolveControl(req: Request, res: Response): PresentSessionRow | null {
    const sessionId = req.params.sessionId;
    if (!isValidSessionId(sessionId)) {
      sendError(res, 404, ErrorCodes.NOT_FOUND, 'Session not found');
      return null;
    }

    const row = store.getBySessionId(sessionId);
    const presented = req.get('X-Present-Token');
    if (!row || !verifyControlToken(presented, row.controlTokenHash)) {
      sendError(res, 404, ErrorCodes.NOT_FOUND, 'Session not found');
      return null;
    }
    if (row.endedAt) {
      sendError(res, 410, ErrorCodes.NOT_FOUND, 'Session has ended');
      return null;
    }
    if (isExpired(row)) {
      sendError(res, 410, ErrorCodes.NOT_FOUND, 'Session has expired');
      return null;
    }
    return row;
  }

  // ---------------------------------------------------------------------------
  // Creation
  // ---------------------------------------------------------------------------

  router.post('/sessions', (req, res): void => {
    const name = typeof req.body?.name === 'string' ? req.body.name.slice(0, 100) : undefined;

    const created = store.createSession({ name });
    if (!created) {
      sendError(res, 503, ErrorCodes.INTERNAL_ERROR, 'Too many active sessions');
      return;
    }

    logger.info(`[present] session created: ${created.sessionId}`);
    // The token is in this response and nowhere else, ever again.
    res.status(201).json(created);
  });

  // ---------------------------------------------------------------------------
  // Reading: join code required
  // ---------------------------------------------------------------------------

  router.get('/j/:joinCode/state', (req, res): void => {
    const row = resolveJoin(req, res);
    if (!row) return;
    if (row.endedAt) {
      sendError(res, 410, ErrorCodes.NOT_FOUND, 'Session has ended');
      return;
    }
    res.json({ state: toWireState(row) });
  });

  /**
   * The join URL as a scannable code.
   *
   * This is the affordance that decides whether people in a room actually join:
   * pointing a camera at the screen versus typing an eight-character code into
   * a phone browser. It is rendered on the viewer's own lobby screen, which is
   * the right place for it -- everyone is already looking at that screen, and
   * nobody has to pass a phone around.
   *
   * It encodes the *viewer* URL and nothing else, so it conveys no privilege
   * beyond what its holder already has. Sharing it onward is harmless by
   * construction, which is what the "viewers can share the QR" requirement
   * actually needs.
   */
  router.get('/j/:joinCode/qr.svg', (req, res): void => {
    const row = resolveJoin(req, res);
    if (!row) return;

    const origin = `${req.protocol}://${req.get('host')}`;
    let svg: string;
    try {
      svg = qrSvg(`${origin}/present/v/${row.joinCode}`, { title: `Join code ${row.joinCode}` });
    } catch (error) {
      // Only reachable with an absurdly long host name, but a thrown encoder
      // must not become a 500 on the screen at the front of a room.
      logger.warn('[present] QR generation failed:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Could not render a join code');
      return;
    }

    res.type('image/svg+xml');
    // The code for a given session never changes, but it is not shared content
    // either: `private` keeps it out of any intermediary cache.
    res.set('Cache-Control', 'private, max-age=3600');
    res.send(svg);
  });

  router.get('/j/:joinCode/stream', (req, res): void => {
    const row = resolveJoin(req, res);
    if (!row) return;

    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      // `no-transform` is the half that matters here: it asks intermediaries not
      // to buffer or re-encode the body. See also the `text/event-stream` entry
      // in `middleware/compression.ts`.
      'Cache-Control': 'no-cache, no-store, no-transform',
      Connection: 'keep-alive',
      // nginx buffers proxied responses by default, which holds every event
      // until the buffer fills -- a stream that works locally and appears dead
      // behind a reverse proxy.
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    // The socket must not be reaped for being quiet; the heartbeat is what
    // keeps it honest. (Express's `server.requestTimeout` bounds *receiving* a
    // request, so it does not apply to a long-lived response.)
    res.setTimeout(0);

    // An ended session gets a stream that says so and hangs up, rather than a
    // 404: `EventSource` retries any failed connection forever, so a projector
    // left running after a service would reconnect all night. A `closed` event
    // tells the client to stop.
    if (row.endedAt) {
      refuseStream(res, 'ended');
      return;
    }
    if (row.state.session.joinsLocked) {
      refuseStream(res, 'locked');
      return;
    }

    // `?preview=1` says "this is a mirror, not an audience". The controller's
    // preview pane is the real viewer in an iframe -- one rendering path, so
    // the preview cannot drift from the wall -- and without this it would count
    // itself as a viewer, breaking the number a presenter uses to check the
    // television is plugged in. It is not a privilege: anyone may decline to be
    // counted, and a count is not a security control.
    const counted = req.query.preview !== '1';
    const result = hub.subscribe(row.sessionId, res, toWireState(row), { counted });
    if (!result.ok) {
      refuseStream(res, 'full');
      return;
    }

    // Registered immediately after subscribing and before anything else can
    // throw. A leaked SSE response is how this kind of endpoint survives
    // testing and then falls over after a few hours.
    req.on('close', () => result.subscription.close());

    // A projector attached to a session is proof it is in use, even if nobody
    // has touched the controller for an hour.
    store.touch(row.sessionId);
  });

  // ---------------------------------------------------------------------------
  // Writing: control token required
  // ---------------------------------------------------------------------------

  router.post('/s/:sessionId/intent', (req, res): void => {
    const row = resolveControl(req, res);
    if (!row) return;

    const intent = validateIntent(req.body?.intent);
    if (!intent) {
      sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Unrecognized intent');
      return;
    }

    if (intent.type === 'end') {
      store.endSession(row.sessionId);
      hub.closeSession(row.sessionId, 'ended');
      logger.info(`[present] session ended: ${row.sessionId}`);
      res.json({ state: { ...toWireState(row) }, ended: true });
      return;
    }

    const next = applyIntent(row.state, intent, intentContext);
    if (!next) {
      // A no-op -- an arrow key at the end of a chapter, or a font step already
      // at its limit. Answering with current state and *not* bumping the
      // version is what stops a held-down key from broadcasting to every viewer
      // several times a second.
      res.json({ state: toWireState(row) });
      return;
    }

    const committed = store.commitState(row.sessionId, next);
    if (!committed) {
      sendError(res, 404, ErrorCodes.NOT_FOUND, 'Session not found');
      return;
    }

    const wire = toWireState({ ...row, state: committed, version: committed.version });
    hub.broadcast(row.sessionId, wire);

    // Answering with the new state means the controller does not have to wait
    // for its own broadcast to round-trip before its UI catches up.
    res.json({ state: wire });
  });

  router.get('/s/:sessionId/plan', (req, res): void => {
    const row = resolveControl(req, res);
    if (!row) return;
    res.json({ plan: row.plan });
  });

  /**
   * Replace the running order.
   *
   * Wholesale replacement rather than per-entry CRUD: the array is small, it is
   * always edited as a whole on the controller, and reordering by sending the
   * new order is both less code here and immune to the renumbering bugs that
   * come with position columns.
   */
  router.put('/s/:sessionId/plan', (req, res): void => {
    const row = resolveControl(req, res);
    if (!row) return;

    const plan = validatePlan(req.body?.plan, PresentStore.newEntryId);
    if (!plan) {
      sendError(
        res, 400, ErrorCodes.INVALID_PARAM,
        `Invalid plan (at most ${LIMITS.planEntries} entries, each a supported item)`,
      );
      return;
    }

    if (!store.setPlan(row.sessionId, plan)) {
      sendError(res, 404, ErrorCodes.NOT_FOUND, 'Session not found');
      return;
    }
    res.json({ plan });
  });

  // ---------------------------------------------------------------------------
  // Housekeeping
  // ---------------------------------------------------------------------------

  // A plain interval rather than a cron dependency: this has to work for
  // someone self-hosting on a small box with nothing else installed.
  const sweeper = setInterval(() => {
    try {
      const removed = store.sweep();
      if (removed > 0) logger.info(`[present] swept ${removed} expired session(s)`);
    } catch (error) {
      logger.error('[present] sweep failed:', error);
    }
  }, SWEEP_INTERVAL_MS);
  sweeper.unref?.();

  return router;
}

registerRoute({
  path: '/api/present',
  createRoutes: (deps) => createPresentRoutes({
    db: deps.db,
    appStateDir: deps.extra.appStateDir as string,
    hymnDirs: deps.extra.hymnDirs as string[],
  }),
});
