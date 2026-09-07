import { Router } from 'express';
import type { DatabaseManager } from '../DatabaseManager.js';
import { validateModuleName, validateVerseId } from '../utils/validation.js';
import { sendError, ErrorCodes } from '../utils/errorResponse.js';
import { registerRoute } from './routeRegistry.js';

export function createCrossRefRoutes(db: DatabaseManager): Router {
  const router = Router();

  // Get phrase-grouped cross-references with entries for a verse
  router.get('/:module/:verseId/groups', (req, res): void => {
    try {
      const moduleName = validateModuleName(req.params.module);
      if (!moduleName) { sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Invalid module name'); return; }
      const verseId = validateVerseId(req.params.verseId);
      if (verseId === null) { sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Invalid verse ID'); return; }

      const repo = db.getCrossRefRepo(moduleName);
      if (!repo) {
        res.json([]);
        return;
      }
      const groupsWithEntries = repo.getGroupsWithEntries(verseId);
      res.json(groupsWithEntries.map(({ group, entries }) => ({
        group: {
          group_id: group.groupId,
          verse_id: group.verseId,
          // Additive: end of the group's source passage (inclusive), = verse_id for a single verse.
          verse_id_end: group.verseIdEnd,
          phrase: group.phrase,
          sort_order: group.sortOrder,
        },
        entries: entries.map(e => ({
          entry_id: e.entryId,
          group_id: e.groupId,
          target_verse_id: e.targetVerseId,
          target_verse_end_id: e.targetVerseEndId,
          note: e.note,
          sort_order: e.sortOrder,
        })),
      })));
    } catch (error) {
      console.error('Error getting cross-references:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to get cross-references');
    }
  });

  // Entry count for a verse (for badge display)
  router.get('/:module/:verseId/count', (req, res): void => {
    try {
      const moduleName = validateModuleName(req.params.module);
      if (!moduleName) { sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Invalid module name'); return; }
      const verseId = validateVerseId(req.params.verseId);
      if (verseId === null) { sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Invalid verse ID'); return; }

      const repo = db.getCrossRefRepo(moduleName);
      if (!repo) {
        res.json({ count: 0 });
        return;
      }

      const count = repo.getEntryCount(verseId);
      res.json({ count });
    } catch (error) {
      console.error('Error getting cross-reference count:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to get cross-reference count');
    }
  });

  return router;
}

registerRoute({
  path: '/api/xref',
  createRoutes: (deps) => createCrossRefRoutes(deps.db),
});
