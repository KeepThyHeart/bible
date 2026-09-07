import { Router } from 'express';
import type { EntityCategory } from '@bible/core';
import type { DatabaseManager } from '../DatabaseManager.js';
import { validateVerseId, MAX_PAGE_SIZE } from '../utils/validation.js';
import { sendError, ErrorCodes } from '../utils/errorResponse.js';
import { registerRoute } from './routeRegistry.js';

/**
 * Allowlist of valid entity categories. Mirrors the desktop's `toEntityCategory`
 * guard (electron/ipc/tagGraphHandlers.ts). Category values become SQLite table
 * names inside the repository, so any value that is not on this list MUST be
 * rejected before it reaches the repo — never interpolated into SQL.
 */
const VALID_ENTITY_CATEGORIES: readonly EntityCategory[] = ['people', 'places', 'objects', 'themes'];

/**
 * Parse the `categories` query param into a validated `EntityCategory[]`.
 * Returns `undefined` when no categories were supplied (repo defaults to all),
 * or `null` when any supplied value is not a recognized category — the caller
 * translates `null` into a 400 validation error.
 */
function parseCategories(raw: unknown): EntityCategory[] | null | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw !== 'string') return null;
  const parts = raw.split(',').map(p => p.trim()).filter(p => p.length > 0);
  if (parts.length === 0) return undefined;
  const result: EntityCategory[] = [];
  for (const part of parts) {
    if (!VALID_ENTITY_CATEGORIES.includes(part as EntityCategory)) return null;
    result.push(part as EntityCategory);
  }
  return result;
}

export function createTagGraphRoutes(db: DatabaseManager, options?: { enabled?: boolean }): Router {
  const router = Router();
  const enabled = options?.enabled ?? false;

  // When tag graph is disabled via server config, all endpoints return empty results
  router.use((_req, res, next) => {
    if (!enabled) {
      res.json([]);
      return;
    }
    next();
  });

  // Get entities associated with a verse (reverse lookup: verse → entities)
  router.get('/verse/:verseId', (req, res): void => {
    try {
      const verseId = validateVerseId(req.params.verseId);
      if (verseId === null) { sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Invalid verse ID'); return; }

      const repo = db.getTagGraphRepo();
      if (!repo) {
        res.json([]);
        return;
      }

      const entities = repo.getEntitiesForVerse(verseId);
      const results = entities.map(e => ({
        entity_id: e.entityId,
        category: e.category,
        name: e.name,
        notes: e.notes,
        source: e.source,
      }));

      res.json(results);
    } catch (error) {
      console.error('Error getting entities for verse:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to get entities for verse');
    }
  });

  // Get a single entity with full details
  router.get('/entity/:category/:entityId', (req, res): void => {
    try {
      const repo = db.getTagGraphRepo();
      if (!repo) {
        sendError(res, 404, ErrorCodes.NOT_FOUND, 'Tag graph not available');
        return;
      }

      const { category, entityId } = req.params;
      let entity;
      switch (category) {
        case 'people': entity = repo.getPerson(entityId); break;
        case 'places': entity = repo.getPlace(entityId); break;
        case 'objects': entity = repo.getObject(entityId); break;
        case 'themes': entity = repo.getTheme(entityId); break;
        default: entity = repo.getEntity(entityId, category as any); break;
      }

      if (!entity) {
        sendError(res, 404, ErrorCodes.NOT_FOUND, 'Entity not found');
        return;
      }

      res.json(entity);
    } catch (error) {
      console.error('Error getting entity:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to get entity');
    }
  });

  // Get associations for an entity
  router.get('/entity/:category/:entityId/associations', (req, res): void => {
    try {
      const repo = db.getTagGraphRepo();
      if (!repo) {
        res.json([]);
        return;
      }

      const { category, entityId } = req.params;
      const associations = repo.getAssociationsForEntity(entityId, category as any);
      res.json(associations);
    } catch (error) {
      console.error('Error getting entity associations:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to get entity associations');
    }
  });

  // Get verses for an entity
  router.get('/entity/:category/:entityId/verses', (req, res): void => {
    try {
      const repo = db.getTagGraphRepo();
      if (!repo) {
        res.json([]);
        return;
      }

      const { category, entityId } = req.params;
      const verses = repo.getVersesForEntity(entityId, category as any);
      // Item #7: Cap entity verses to MAX_PAGE_SIZE
      const capped = Array.isArray(verses) ? verses.slice(0, MAX_PAGE_SIZE) : verses;
      res.json(capped);
    } catch (error) {
      console.error('Error getting entity verses:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to get entity verses');
    }
  });

  // Get facets for an entity
  router.get('/entity/:category/:entityId/facets', (req, res): void => {
    try {
      const repo = db.getTagGraphRepo();
      if (!repo) {
        res.json([]);
        return;
      }

      const { category, entityId } = req.params;
      const facets = repo.getFacetsForEntity(entityId, category as any);
      res.json(facets);
    } catch (error) {
      console.error('Error getting entity facets:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to get entity facets');
    }
  });

  // Get topic links for an entity (bridges to Nave's/Torrey's)
  router.get('/entity/:category/:entityId/topic-links', (req, res): void => {
    try {
      const repo = db.getTagGraphRepo();
      if (!repo) {
        res.json([]);
        return;
      }

      const { category, entityId } = req.params;
      const links = repo.getTopicLinksForEntity(entityId, category as any);

      // Enrich with topic names and verse counts from topical index repos
      const enriched = links.map(link => {
        const topicalRepo = db.getTopicalIndexRepo(link.sourceModule);
        let topicName: string | undefined;
        let sourceName: string | undefined;
        let verseCount: number | undefined;

        if (topicalRepo) {
          const topic = topicalRepo.getTopic(link.topicId);
          topicName = topic?.name;
          verseCount = topicalRepo.getRecursiveVerseCount(link.topicId);
          const info = topicalRepo.getModuleInfo();
          sourceName = info?.fullName ?? link.sourceModule;
        }

        return {
          entity_id: link.entityId,
          entity_category: link.entityCategory,
          source_module: link.sourceModule,
          topic_id: link.topicId,
          match_type: link.matchType,
          topic_name: topicName,
          source_name: sourceName,
          verse_count: verseCount,
        };
      });

      res.json(enriched);
    } catch (error) {
      console.error('Error getting topic links for entity:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to get topic links');
    }
  });

  // Search entities (typeahead)
  router.get('/search', (req, res): void => {
    try {
      // Validate untrusted input against a fixed allowlist FIRST — before any DB
      // access — because the category values become SQLite table names inside
      // the repository. Reject unknown or malicious values (e.g.
      // "x UNION SELECT ...") with a 400 rather than interpolating them into a
      // query. Doing this ahead of the repo-null check means a rejected payload
      // never depends on whether the tag graph happens to be built.
      const categories = parseCategories(req.query.categories);
      if (categories === null) {
        sendError(
          res,
          400,
          ErrorCodes.INVALID_PARAM,
          `Invalid categories: must be a comma-separated list of ${VALID_ENTITY_CATEGORIES.join(', ')}`
        );
        return;
      }

      const repo = db.getTagGraphRepo();
      if (!repo) {
        res.json([]);
        return;
      }

      const query = (req.query.q as string) || '';
      if (!query) {
        res.json([]);
        return;
      }

      // Item #7: Cap tag graph search results
      const results = repo.searchEntities(query, categories);
      const capped = Array.isArray(results) ? results.slice(0, MAX_PAGE_SIZE) : results;
      res.json(capped);
    } catch (error) {
      console.error('Error searching entities:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to search entities');
    }
  });

  // Reverse lookup: topic_id → entity
  router.get('/topic-link/:sourceModule/:topicId', (req, res): void => {
    try {
      const repo = db.getTagGraphRepo();
      if (!repo) {
        res.json(null);
        return;
      }

      const entity = repo.getEntityForTopic(req.params.sourceModule, Number(req.params.topicId));
      res.json(entity);
    } catch (error) {
      console.error('Error getting entity for topic:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to get entity for topic');
    }
  });

  return router;
}

registerRoute({
  path: '/api/taggraph',
  createRoutes: (deps) => createTagGraphRoutes(deps.db, { enabled: deps.extra.showTagGraph as boolean ?? false }),
});
