import { IpcMain } from 'electron';
import log from 'electron-log';
import {
  TagGraphRepository,
  EntityCategory,
  TagGraphEntity,
  PersonEntity,
  PlaceEntity,
  ObjectEntity,
  ThemeEntity,
  PeopleRelationship,
  TagAssociation,
  EntityTopicLink,
  EntityFacet,
  EntityVerse,
} from '@bible/core';
import { getDataPath } from '../utils/appPaths';
import { join } from 'path';
import { ipcHandler, IpcKnownError } from './handler-helper';
import { validateString, validatePositiveInt } from '../utils/validation';
import { getModuleDatabaseRegistry } from '../services/ModuleDatabaseRegistry';

let tagGraphRepo: TagGraphRepository | null = null;

function getTagGraphRepository(): TagGraphRepository | null {
  if (tagGraphRepo) return tagGraphRepo;

  const dbPath = join(getDataPath(), 'tag_graph.db');
  const db = getModuleDatabaseRegistry().openByPath(dbPath);
  if (!db) {
    // Tag graph not built yet - graceful degradation
    return null;
  }
  tagGraphRepo = new TagGraphRepository(db);
  log.info('Tag graph database loaded:', dbPath);
  return tagGraphRepo;
}

/**
 * Narrow an arbitrary string to a valid `EntityCategory` or throw a classified
 * `invalid_input` error. Keeps the renderer-facing surface honest without
 * forcing every handler to repeat the check.
 */
function toEntityCategory(value: string, fieldName: string): EntityCategory {
  const allowed: EntityCategory[] = ['people', 'places', 'objects', 'themes'];
  if (!allowed.includes(value as EntityCategory)) {
    throw new IpcKnownError(
      'invalid_input',
      `Invalid ${fieldName}: must be one of ${allowed.join(', ')}`
    );
  }
  return value as EntityCategory;
}

export function registerTagGraphHandlers(_ipcMain: IpcMain): void {
  // Get a single entity with full details (category-specific shape when known).
  ipcHandler<
    [string, string],
    TagGraphEntity | PersonEntity | PlaceEntity | ObjectEntity | ThemeEntity | null
  >('tagGraph:getEntity', (entityId, category) => {
    validateString(entityId, 'entityId', 200);
    validateString(category, 'category', 50);
    const cat = toEntityCategory(category, 'category');
    const repo = getTagGraphRepository();
    if (!repo) return null;

    switch (cat) {
      case 'people':
        return repo.getPerson(entityId) ?? null;
      case 'places':
        return repo.getPlace(entityId) ?? null;
      case 'objects':
        return repo.getObject(entityId) ?? null;
      case 'themes':
        return repo.getTheme(entityId) ?? null;
      default:
        return repo.getEntity(entityId, cat) ?? null;
    }
  });

  // Get associations for an entity
  ipcHandler<[string, string], TagAssociation[]>(
    'tagGraph:getAssociationsForEntity',
    (entityId, category) => {
      validateString(entityId, 'entityId', 200);
      validateString(category, 'category', 50);
      const cat = toEntityCategory(category, 'category');
      const repo = getTagGraphRepository();
      if (!repo) return [];
      return repo.getAssociationsForEntity(entityId, cat);
    }
  );

  // Get people relationships (family tree)
  ipcHandler<[string], PeopleRelationship[]>(
    'tagGraph:getPeopleRelationships',
    (personId) => {
      validateString(personId, 'personId', 200);
      const repo = getTagGraphRepository();
      if (!repo) return [];
      return repo.getPeopleRelationships(personId);
    }
  );

  // Search entities (typeahead)
  ipcHandler<[string, string[] | undefined], TagGraphEntity[]>(
    'tagGraph:searchEntities',
    (query, categories) => {
      validateString(query, 'search query', 500);
      const cats = categories?.map((c) => toEntityCategory(c, 'category'));
      const repo = getTagGraphRepository();
      if (!repo) return [];
      return repo.searchEntities(query, cats);
    }
  );

  // Get aliases for an entity
  ipcHandler<[string, string], string[]>(
    'tagGraph:getEntityAliases',
    (entityId, category) => {
      validateString(entityId, 'entityId', 200);
      validateString(category, 'category', 50);
      const cat = toEntityCategory(category, 'category');
      const repo = getTagGraphRepository();
      if (!repo) return [];
      return repo.getEntityAliases(entityId, cat);
    }
  );

  // Get topic links for an entity (bridges to Nave's/Torrey's topic_ids)
  ipcHandler<[string, string, string | undefined], EntityTopicLink[]>(
    'tagGraph:getTopicLinksForEntity',
    (entityId, category, sourceModule) => {
      validateString(entityId, 'entityId', 200);
      validateString(category, 'category', 50);
      if (sourceModule !== undefined) {
        validateString(sourceModule, 'sourceModule', 200);
      }
      const cat = toEntityCategory(category, 'category');
      const repo = getTagGraphRepository();
      if (!repo) return [];
      return repo.getTopicLinksForEntity(entityId, cat, sourceModule);
    }
  );

  // Reverse lookup: topic_id -> entity
  ipcHandler<[string, number], TagGraphEntity | null>(
    'tagGraph:getEntityForTopic',
    (sourceModule, topicId) => {
      validateString(sourceModule, 'sourceModule', 200);
      validatePositiveInt(topicId, 'topicId');
      const repo = getTagGraphRepository();
      if (!repo) return null;
      return repo.getEntityForTopic(sourceModule, topicId) ?? null;
    }
  );

  // Find entity by exact name/alias match (fallback for non-Nave/Torrey sources)
  ipcHandler<[string], TagGraphEntity | null>(
    'tagGraph:getEntityByName',
    (name) => {
      validateString(name, 'name', 500);
      const repo = getTagGraphRepository();
      if (!repo) return null;
      return repo.getEntityByName(name) ?? null;
    }
  );

  // Get verses for an entity
  ipcHandler<[string, string], EntityVerse[]>(
    'tagGraph:getVersesForEntity',
    (entityId, category) => {
      validateString(entityId, 'entityId', 200);
      validateString(category, 'category', 50);
      const cat = toEntityCategory(category, 'category');
      const repo = getTagGraphRepository();
      if (!repo) return [];
      return repo.getVersesForEntity(entityId, cat);
    }
  );

  // Get facets for an entity (structural subtopic groups)
  ipcHandler<[string, string], EntityFacet[]>(
    'tagGraph:getFacetsForEntity',
    (entityId, category) => {
      validateString(entityId, 'entityId', 200);
      validateString(category, 'category', 50);
      const cat = toEntityCategory(category, 'category');
      const repo = getTagGraphRepository();
      if (!repo) return [];
      return repo.getFacetsForEntity(entityId, cat);
    }
  );
}

export function closeTagGraphDb(): void {
  // The DB handle is owned by ModuleDatabaseRegistry; its `closeAll()` runs
  // on `will-quit` in main.ts. We only drop our repo reference here.
  tagGraphRepo = null;
}
