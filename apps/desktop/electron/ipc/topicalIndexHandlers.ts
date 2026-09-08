import { IpcMain } from 'electron';
import { TopicalIndexRepository } from '@bible/core';
import { getSharedModuleMetadataRepo } from '../services/sharedMainDb';
import { ModuleLoader } from '../services/ModuleLoader';
import { ipcHandler, IpcKnownError } from './handler-helper';
import { validateAbbreviation, validateVerseId, validatePositiveInt, validateString } from '../utils/validation';

const loader = new ModuleLoader('topical_index', (db) => new TopicalIndexRepository(db));

function getTopicalRepository(abbreviation: string): TopicalIndexRepository | null {
  return loader.get(abbreviation);
}

/**
 * Load all topical index modules and return them as an array
 */
function getAllTopicalRepos(): Array<{ abbreviation: string; repo: TopicalIndexRepository }> {
  const moduleMetadataRepo = getSharedModuleMetadataRepo();
  const modules = moduleMetadataRepo.getByType('topical_index');

  const result: Array<{ abbreviation: string; repo: TopicalIndexRepository }> = [];
  for (const mod of modules) {
    const abbr = mod.abbreviation || mod.getAbbreviation();
    const repo = loader.get(abbr);
    if (repo) {
      result.push({ abbreviation: abbr, repo });
    }
  }
  return result;
}

export function registerTopicalIndexHandlers(_ipcMain: IpcMain): void {

  // Get available topical index modules
  ipcHandler<[], Array<{
    module_id: number | undefined;
    abbreviation: string;
    name: string;
    language_code: string | undefined;
    version: string | undefined;
    database_path: string;
  }>>('topical:getAvailable', () => {
    const moduleMetadataRepo = getSharedModuleMetadataRepo();
    const modules = moduleMetadataRepo.getByType('topical_index');
    return modules.map(mod => ({
      module_id: mod.moduleId,
      abbreviation: mod.abbreviation || mod.getAbbreviation(),
      name: mod.moduleName,
      language_code: mod.languageCode,
      version: mod.version,
      database_path: mod.databasePath
    }));
  });

  // Get topics for a verse from ALL loaded modules (merged)
  ipcHandler<[number], unknown[]>('topical:getTopicsForVerse', (verseId) => {
    validateVerseId(verseId);
    const allRepos = getAllTopicalRepos();
    const results: unknown[] = [];

    for (const { abbreviation, repo } of allRepos) {
      const topics = repo.getTopicsByVerse(verseId);
      const info = repo.getModuleInfo();
      const sourceName = info?.fullName ?? abbreviation;

      for (const topic of topics) {
        // Build full ancestor chain with verse counts
        let ancestors: { topic_id: number; name: string; verse_count: number }[] = [];
        if (topic.parentTopicId) {
          const chain = repo.getParentChain(topic.topicId!);
          ancestors = chain.map(t => ({
            topic_id: t.topicId!,
            name: t.name,
            verse_count: repo.getRecursiveVerseCount(t.topicId!)
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
          verse_count: repo.getRecursiveVerseCount(topic.topicId!)
        });
      }
    }

    return results;
  });

  // Get a single topic with children, parent chain, and verse count
  ipcHandler<[string, number], unknown | null>('topical:getTopic', (abbreviation, topicId) => {
    validateAbbreviation(abbreviation);
    validatePositiveInt(topicId, 'topicId');
    const repo = getTopicalRepository(abbreviation);
    if (!repo) {
      throw new IpcKnownError('not_found', `Topical index not found: ${abbreviation}`);
    }

    const topic = repo.getTopic(topicId);
    if (!topic) return null;

    // Which index this topic came from. "Jericho" reads identically in Nave's
    // and in Torrey's, and the detail view had no way of saying which one the
    // reader was looking at.
    const info = repo.getModuleInfo();
    const sourceName = info?.fullName ?? abbreviation;

    const children = repo.getChildren(topicId);
    const parentChain = repo.getParentChain(topicId);
    const verseCount = repo.getRecursiveVerseCount(topicId);
    // Two different counts, both needed. `verseCount` expands ranges (John
    // 3:16-18 counts three); `referenceCount` counts the stored links, which
    // is exactly how many rows `getVersesForTopic` can ever return. Only the
    // second can answer "is there more to load?" - comparing a returned row
    // count against the expanded total leaves a Load More button that never
    // goes away. See ITopicalIndexRepository's note on the distinction.
    const referenceCount = repo.getRecursiveReferenceCount(topicId);

    return {
      topic: {
        topic_id: topic.topicId,
        parent_topic_id: topic.parentTopicId,
        name: topic.name,
        description: topic.description,
        sort_order: topic.sortOrder,
        metadata: topic.metadata
      },
      children: children.map(c => ({
        topic_id: c.topicId,
        name: c.name,
        description: c.description,
        verse_count: repo.getRecursiveVerseCount(c.topicId!),
        child_count: repo.getChildren(c.topicId!).length
      })),
      parent_chain: parentChain.map(p => ({
        topic_id: p.topicId,
        name: p.name
      })),
      verse_count: verseCount,
      reference_count: referenceCount,
      source_abbreviation: abbreviation,
      source_name: sourceName
    };
  });

  // Get children of a topic
  ipcHandler<[string, number], unknown[]>('topical:getChildren', (abbreviation, parentTopicId) => {
    validateAbbreviation(abbreviation);
    validatePositiveInt(parentTopicId, 'parentTopicId');
    const repo = getTopicalRepository(abbreviation);
    if (!repo) {
      throw new IpcKnownError('not_found', `Topical index not found: ${abbreviation}`);
    }

    const children = repo.getChildren(parentTopicId);
    return children.map(c => ({
      topic_id: c.topicId,
      name: c.name,
      description: c.description,
      verse_count: repo.getRecursiveVerseCount(c.topicId!)
    }));
  });

  // Get parent chain (breadcrumb)
  ipcHandler<[string, number], unknown[]>('topical:getParentChain', (abbreviation, topicId) => {
    validateAbbreviation(abbreviation);
    validatePositiveInt(topicId, 'topicId');
    const repo = getTopicalRepository(abbreviation);
    if (!repo) {
      throw new IpcKnownError('not_found', `Topical index not found: ${abbreviation}`);
    }

    const chain = repo.getParentChain(topicId);
    return chain.map(p => ({
      topic_id: p.topicId,
      name: p.name
    }));
  });

  // Get verses for a topic (with pagination)
  ipcHandler<[string, number, number | undefined, number | undefined], unknown[]>(
    'topical:getVersesForTopic',
    (abbreviation, topicId, limit, offset) => {
      validateAbbreviation(abbreviation);
      validatePositiveInt(topicId, 'topicId');
      const repo = getTopicalRepository(abbreviation);
      if (!repo) {
        throw new IpcKnownError('not_found', `Topical index not found: ${abbreviation}`);
      }

      const verses = repo.getRecursiveVersesForTopic(topicId, { limit, offset });
      return verses.map(v => ({
        topic_id: v.topicId,
        start_verse_id: v.startVerseId,
        end_verse_id: v.endVerseId,
        context: v.context,
        sort_order: v.sortOrder
      }));
    }
  );

  // Search topics across selected modules.
  //
  // Paginated, because the Topics pane's browse view renders these results
  // inline as its main list rather than as a short dropdown: a fixed cap there
  // would silently truncate the only list on screen.
  ipcHandler<[string, string[] | undefined, number | undefined, number | undefined], unknown[]>(
    'topical:searchTopics',
    (query, sources, limit, offset) => {
      validateString(query, 'search query', 500);
      if (sources) {
        for (const s of sources) { validateAbbreviation(s); }
      }
      const allRepos = getAllTopicalRepos();
      const results: unknown[] = [];

      for (const { abbreviation, repo } of allRepos) {
        if (sources && !sources.includes(abbreviation)) continue;

        const info = repo.getModuleInfo();
        const sourceName = info?.fullName ?? abbreviation;

        const topics = repo.searchTopics(query, { limit: limit ?? 50, offset });
        const childCounts = repo.getChildCounts(topics.map(t => t.topicId!));
        for (const topic of topics) {
          // Build parent path for context (e.g. "Worship > Instruments")
          let parent_path: string | undefined;
          if (topic.parentTopicId) {
            const chain = repo.getParentChain(topic.topicId!);
            if (chain.length > 0) {
              parent_path = chain.map(p => p.name).join(' > ');
            }
          }
          results.push({
            topic_id: topic.topicId,
            parent_topic_id: topic.parentTopicId,
            name: topic.name,
            description: topic.description,
            parent_path,
            source_abbreviation: abbreviation,
            source_name: sourceName,
            verse_count: repo.getRecursiveVerseCount(topic.topicId!),
            child_count: childCounts.get(topic.topicId!) ?? 0
          });
        }
      }

      return results;
    }
  );

  // Browse topics (paginated, optionally filtered, optionally roots-only)
  ipcHandler<[string[] | undefined, number | undefined, number | undefined, string | undefined, boolean | undefined], unknown[]>(
    'topical:browseTopics',
    (sources, limit, offset, filter, rootsOnly) => {
      const allRepos = getAllTopicalRepos();
      const results: unknown[] = [];

      for (const { abbreviation, repo } of allRepos) {
        if (sources && !sources.includes(abbreviation)) continue;

        const info = repo.getModuleInfo();
        const sourceName = info?.fullName ?? abbreviation;

        const topics = repo.getAllTopicsPaginated({ limit, offset, filter, rootsOnly: rootsOnly === true });
        // One grouped query per page rather than a `getChildren` call per row.
        // With the top level of Nave's alone at 5,320 topics, the browse list
        // has to say which rows are worth drilling into.
        const childCounts = repo.getChildCounts(topics.map(t => t.topicId!));
        for (const topic of topics) {
          results.push({
            topic_id: topic.topicId,
            parent_topic_id: topic.parentTopicId,
            name: topic.name,
            description: topic.description,
            source_abbreviation: abbreviation,
            source_name: sourceName,
            verse_count: repo.getRecursiveVerseCount(topic.topicId!),
            child_count: childCounts.get(topic.topicId!) ?? 0
          });
        }
      }

      return results;
    }
  );

  // "Also in" cross-links: find the same topic name in other modules
  ipcHandler<[string, string], unknown[]>('topical:getAlsoIn', (topicName, excludeAbbreviation) => {
    validateString(topicName, 'topicName', 500);
    validateAbbreviation(excludeAbbreviation);
    const allRepos = getAllTopicalRepos();
    const results: unknown[] = [];

    for (const { abbreviation, repo } of allRepos) {
      if (abbreviation === excludeAbbreviation) continue;

      const info = repo.getModuleInfo();
      const sourceName = info?.fullName ?? abbreviation;

      const matches = repo.getTopicsByName(topicName);
      for (const topic of matches) {
        results.push({
          topic_id: topic.topicId,
          name: topic.name,
          source_abbreviation: abbreviation,
          source_name: sourceName,
          verse_count: repo.getRecursiveVerseCount(topic.topicId!)
        });
      }
    }

    return results;
  });
}

/**
 * Clean up topical index database connections
 */
export function closeTopicalDbs(): void {
  loader.closeAll();
}
