import { Router } from 'express';
import type { DatabaseManager } from '../DatabaseManager.js';
import { validateVerseId, validateModuleName, MAX_PAGE_SIZE } from '../utils/validation.js';
import { sendError, ErrorCodes } from '../utils/errorResponse.js';
import type { SiteSettings } from '../siteSettings.js';
import { registerRoute } from './routeRegistry.js';

export function createTopicalRoutes(db: DatabaseManager, siteSettings: SiteSettings | null): Router {
  const router = Router();

  // List available topical modules
  router.get('/modules', (_req, res): void => {
    try {
      const allRepos = db.getAllTopicalIndexRepos();
      const modules = allRepos.map(({ abbreviation, repo }) => {
        const info = repo.getModuleInfo();
        return {
          abbreviation,
          name: info?.fullName ?? abbreviation,
        };
      });
      res.json(modules);
    } catch (error) {
      console.error('Error listing topical modules:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to list topical modules');
    }
  });

  // Get topics for a verse from ALL topical index modules (merged)
  router.get('/verse/:verseId', (req, res): void => {
    try {
      const verseId = validateVerseId(req.params.verseId);
      if (verseId === null) { sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Invalid verse ID'); return; }
      const excludeParam = (req.query.exclude as string) || '';
      const excludeSet = new Set(excludeParam.split(',').map(s => s.trim()).filter(Boolean));
      // Item #8: Cap topical modules to prevent resource exhaustion
      const MAX_TOPICAL_MODULES = 5;
      const allRepos = db.getAllTopicalIndexRepos()
        .filter(r => !excludeSet.has(r.abbreviation))
        .slice(0, MAX_TOPICAL_MODULES);
      const results: any[] = [];

      for (const { abbreviation, repo } of allRepos) {
        const topics = repo.getTopicsByVerse(verseId);
        const info = repo.getModuleInfo();
        const sourceName = info?.fullName ?? abbreviation;

        for (const topic of topics) {
          let ancestors: { topic_id: number; name: string; verse_count: number; reference_count: number }[] = [];
          if (topic.parentTopicId) {
            const chain = repo.getParentChain(topic.topicId!);
            ancestors = chain.map(t => ({
              topic_id: t.topicId!,
              name: t.name,
              verse_count: repo.getRecursiveVerseCount(t.topicId!),
              reference_count: repo.getRecursiveReferenceCount(t.topicId!),
            }));
          }

          results.push({
            topic_id: topic.topicId,
            parent_topic_id: topic.parentTopicId,
            parent_name: ancestors.length > 0 ? ancestors.map(a => a.name).join(' > ') : undefined,
            ancestors,
            name: topic.name,
            description: topic.description,
            source_abbreviation: abbreviation,
            source_name: sourceName,
            verse_count: repo.getRecursiveVerseCount(topic.topicId!),
            reference_count: repo.getRecursiveReferenceCount(topic.topicId!),
          });
        }
      }

      res.json(results);
    } catch (error) {
      console.error('Error getting topics for verse:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to get topics for verse');
    }
  });

  // Get a single topic with children, parent chain, and verse count
  router.get('/:module/topic/:topicId', (req, res): void => {
    try {
      const repo = db.getTopicalIndexRepo(req.params.module);
      if (!repo) {
        sendError(res, 404, ErrorCodes.NOT_FOUND, 'Topical index module not found');
        return;
      }

      const topicId = Number(req.params.topicId);
      const topic = repo.getTopic(topicId);
      if (!topic) {
        sendError(res, 404, ErrorCodes.NOT_FOUND, 'Topic not found');
        return;
      }

      const children = repo.getChildren(topicId);
      const parentChain = repo.getParentChain(topicId);
      const verseCount = repo.getRecursiveVerseCount(topicId);
      // `verse_count` expands ranges (a Gen 1:1-5 link counts 5) but the
      // /verses endpoint returns one row per link, so the client must page
      // against `reference_count` or Load More never goes away.
      const referenceCount = repo.getRecursiveReferenceCount(topicId);

      res.json({
        topic: {
          topic_id: topic.topicId,
          parent_topic_id: topic.parentTopicId,
          name: topic.name,
          description: topic.description,
          sort_order: topic.sortOrder,
        },
        children: children.map(c => ({
          topic_id: c.topicId,
          name: c.name,
          description: c.description,
          verse_count: repo.getRecursiveVerseCount(c.topicId!),
          reference_count: repo.getRecursiveReferenceCount(c.topicId!),
          child_count: repo.getChildren(c.topicId!).length,
        })),
        parent_chain: parentChain.map(p => ({
          topic_id: p.topicId,
          name: p.name,
        })),
        verse_count: verseCount,
        reference_count: referenceCount,
      });
    } catch (error) {
      console.error('Error getting topic:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to get topic');
    }
  });

  // Get children of a topic
  router.get('/:module/topic/:topicId/children', (req, res): void => {
    try {
      const repo = db.getTopicalIndexRepo(req.params.module);
      if (!repo) {
        res.json([]);
        return;
      }

      const children = repo.getChildren(Number(req.params.topicId));
      res.json(children.map(c => ({
        topic_id: c.topicId,
        name: c.name,
        description: c.description,
        verse_count: repo.getRecursiveVerseCount(c.topicId!),
        reference_count: repo.getRecursiveReferenceCount(c.topicId!),
      })));
    } catch (error) {
      console.error('Error getting topic children:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to get topic children');
    }
  });

  // Get verses for a topic (with pagination)
  router.get('/:module/topic/:topicId/verses', (req, res): void => {
    try {
      const repo = db.getTopicalIndexRepo(req.params.module);
      if (!repo) {
        res.json([]);
        return;
      }

      const topicId = Number(req.params.topicId);
      // Item #7: Cap pagination with MAX_PAGE_SIZE
      const limit = req.query.limit ? Math.min(Number(req.query.limit), MAX_PAGE_SIZE) : undefined;
      const offset = req.query.offset ? Number(req.query.offset) : undefined;

      const verses = repo.getRecursiveVersesForTopic(topicId, { limit, offset });
      res.json(verses.map(v => ({
        topic_id: v.topicId,
        start_verse_id: v.startVerseId,
        end_verse_id: v.endVerseId,
        context: v.context,
        sort_order: v.sortOrder,
      })));
    } catch (error) {
      console.error('Error getting verses for topic:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to get verses for topic');
    }
  });

  // Search topics across all topical modules
  router.get('/search', (req, res): void => {
    try {
      const query = (req.query.q as string) || '';
      if (!query) {
        res.json([]);
        return;
      }

      const excludeParam = (req.query.exclude as string) || '';
      const excludeSet = new Set(excludeParam.split(',').map(s => s.trim()).filter(Boolean));
      // Item #7: Cap topical modules similar to verse endpoint (item #8)
      const MAX_TOPICAL_MODULES = 5;
      const allRepos = db.getAllTopicalIndexRepos()
        .filter(r => !excludeSet.has(r.abbreviation))
        .slice(0, MAX_TOPICAL_MODULES);
      const results: any[] = [];

      for (const { abbreviation, repo } of allRepos) {
        const info = repo.getModuleInfo();
        const sourceName = info?.fullName ?? abbreviation;

        // Item #7: Cap topical search results per module
        const topics = repo.searchTopics(query, { limit: Math.min(50, MAX_PAGE_SIZE) });
        for (const topic of topics) {
          let ancestors: { topic_id: number; name: string; verse_count: number; reference_count: number }[] = [];
          if (topic.parentTopicId) {
            const chain = repo.getParentChain(topic.topicId!);
            ancestors = chain.map(t => ({
              topic_id: t.topicId!,
              name: t.name,
              verse_count: repo.getRecursiveVerseCount(t.topicId!),
              reference_count: repo.getRecursiveReferenceCount(t.topicId!),
            }));
          }
          results.push({
            topic_id: topic.topicId,
            name: topic.name,
            description: topic.description,
            ancestors,
            source_abbreviation: abbreviation,
            source_name: sourceName,
            verse_count: repo.getRecursiveVerseCount(topic.topicId!),
            reference_count: repo.getRecursiveReferenceCount(topic.topicId!),
          });
        }
      }

      res.json(results);
    } catch (error) {
      console.error('Error searching topics:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to search topics');
    }
  });

  return router;
}

registerRoute({
  path: '/api/topical',
  createRoutes: (deps) => createTopicalRoutes(deps.db, deps.siteSettings),
});
