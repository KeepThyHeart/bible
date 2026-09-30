import { Router } from 'express';
import type { DatabaseManager } from '../DatabaseManager.js';
import { validateVerseId } from '../utils/validation.js';
import { sendError, ErrorCodes } from '../utils/errorResponse.js';
import { registerRoute } from './routeRegistry.js';
import { XrefGraphHost } from '../xrefGraphHost.js';
import { encodeChapterArcs } from '../core.js';

/**
 * Cross-reference graph routes (task 0068).
 *
 *   GET /api/xref-graph/sources              installed cross-reference modules
 *   GET /api/xref-graph/ego/:verseId         ?depth=1|2|3 &maxNodes= &minWeight= &sources=a,b
 *   GET /api/xref-graph/neighbours/:verseId  ?limit=
 *   GET /api/xref-graph/books                book matrix (66 x 66) + fingerprint
 *   GET /api/xref-graph/chapters             chapter-pair index as little-endian uint32 bytes; header X-Xref-Fingerprint
 */
export function createXrefGraphRoutes(db: Pick<DatabaseManager, 'getModuleMetadataRepo' | 'getCrossRefRepo'>): Router {
  const router = Router();
  const host = new XrefGraphHost(db);

  const fail = (res: Parameters<typeof sendError>[0], error: unknown, what: string): void => {
    console.error(`Error getting ${what}:`, error);
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, `Failed to get ${what}`);
  };

  router.get('/sources', (_req, res): void => {
    try {
      res.json(host.modules().map(m => ({ abbreviation: m.abbreviation, name: m.moduleName })));
    } catch (error) { fail(res, error, 'cross-reference sources'); }
  });

  router.get('/ego/:verseId', (req, res): void => {
    try {
      const verseId = validateVerseId(req.params.verseId);
      if (verseId === null) { sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Invalid verse ID'); return; }
      const depthRaw = Number(req.query.depth ?? 2);
      if (![1, 2, 3].includes(depthRaw)) { sendError(res, 400, ErrorCodes.INVALID_PARAM, 'depth must be 1, 2 or 3'); return; }
      const maxNodes = req.query.maxNodes === undefined ? undefined : Number(req.query.maxNodes);
      if (maxNodes !== undefined && !Number.isFinite(maxNodes)) { sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Invalid maxNodes'); return; }
      const minWeight = req.query.minWeight === undefined ? undefined : Number(req.query.minWeight);
      if (minWeight !== undefined && !(minWeight >= 0 && minWeight <= 1)) { sendError(res, 400, ErrorCodes.INVALID_PARAM, 'minWeight must be between 0 and 1'); return; }
      const sourceList = typeof req.query.sources === 'string' && req.query.sources ? req.query.sources.split(',') : undefined;
      if (sourceList && !sourceList.every(s => /^[a-zA-Z0-9_-]{1,100}$/.test(s))) {
        sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Invalid sources');
        return;
      }
      const sources = sourceList;
      res.set('Cache-Control', 'public, max-age=3600');
      res.json(host.service().getEgoGraph(verseId, { depth: depthRaw as 1 | 2 | 3, maxNodes, minWeight, sources }));
    } catch (error) { fail(res, error, 'cross-reference graph'); }
  });

  router.get('/neighbours/:verseId', (req, res): void => {
    try {
      const verseId = validateVerseId(req.params.verseId);
      if (verseId === null) { sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Invalid verse ID'); return; }
      const limit = req.query.limit === undefined ? undefined : Number(req.query.limit);
      if (limit !== undefined && !(Number.isInteger(limit) && limit >= 1 && limit <= 500)) {
        sendError(res, 400, ErrorCodes.INVALID_PARAM, 'limit must be between 1 and 500'); return;
      }
      res.set('Cache-Control', 'public, max-age=3600');
      res.json(host.service().getNeighbours(verseId, limit));
    } catch (error) { fail(res, error, 'cross-reference neighbours'); }
  });

  router.get('/books', (_req, res): void => {
    try {
      const index = host.index();
      res.set('Cache-Control', 'public, max-age=3600');
      res.json({ fingerprint: index.fingerprint, books: index.books });
    } catch (error) { fail(res, error, 'the book matrix'); }
  });

  router.get('/chapters', (req, res): void => {
    try {
      const index = host.index();
      const etag = `"${index.fingerprint}"`;
      res.set('ETag', etag);
      res.set('X-Xref-Fingerprint', index.fingerprint);
      res.set('Cache-Control', 'public, max-age=3600');
      if (req.headers['if-none-match'] === etag) { res.status(304).end(); return; }
      res.type('application/octet-stream');
      res.send(Buffer.from(encodeChapterArcs(index.arcs)));
    } catch (error) { fail(res, error, 'the chapter index'); }
  });

  return router;
}

registerRoute({
  path: '/api/xref-graph',
  createRoutes: (deps) => createXrefGraphRoutes(deps.db),
});
