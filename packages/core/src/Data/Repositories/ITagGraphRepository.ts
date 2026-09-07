import { TagGraphEntity, PersonEntity, PlaceEntity, ObjectEntity, ThemeEntity, PeopleRelationship, EntityCategory } from '../Models/TagGraph/TagGraphEntity';
import { TagAssociation, AssociationPassage } from '../Models/TagGraph/TagAssociation';
import { EntityTopicLink } from '../Models/TagGraph/EntityTopicLink';
import { EntityFacet } from '../Models/TagGraph/EntityFacet';
import { EntityVerse } from '../Models/TagGraph/EntityVerse';
import { VerseId } from '../Core/Types';

/**
 * Result of a verse-to-entity reverse lookup.
 */
export interface VerseEntityResult {
  entityId: string;
  category: EntityCategory;
  name: string;
  notes?: string;
  source: string;
}

/**
 * Repository interface for the tag graph database.
 * Provides access to the biblical entity relationship graph
 * (people, places, objects, themes and their associations).
 */
export interface ITagGraphRepository {
  /**
   * Get a single entity by ID and category
   */
  getEntity(entityId: string, category: EntityCategory): TagGraphEntity | undefined;

  /**
   * Get detailed person entity with roles
   */
  getPerson(personId: string): PersonEntity | undefined;

  /**
   * Get detailed place entity with attributes
   */
  getPlace(placeId: string): PlaceEntity | undefined;

  /**
   * Get detailed object entity with attributes
   */
  getObject(objectId: string): ObjectEntity | undefined;

  /**
   * Get detailed theme entity with traditions and attributes
   */
  getTheme(themeId: string): ThemeEntity | undefined;

  /**
   * Get all associations for an entity, sorted by strength descending
   */
  getAssociationsForEntity(entityId: string, category: EntityCategory): TagAssociation[];

  /**
   * Get associations filtered by target category
   */
  getAssociationsByCategory(entityId: string, category: EntityCategory, targetCategory: EntityCategory): TagAssociation[];

  /**
   * Get people relationships (family tree) for a person
   */
  getPeopleRelationships(personId: string): PeopleRelationship[];

  /**
   * Search entities by name or alias across categories
   */
  searchEntities(query: string, categories?: EntityCategory[]): TagGraphEntity[];

  /**
   * Get all aliases for an entity
   */
  getEntityAliases(entityId: string, category: EntityCategory): string[];

  /**
   * Get supporting verse references for an association.
   */
  getAssociationPassages(associationId: string): AssociationPassage[];

  /**
   * Get topic links for an entity - direct bridges to Nave's/Torrey's topic_ids.
   * Optionally filter by source module.
   */
  getTopicLinksForEntity(entityId: string, category: EntityCategory, sourceModule?: string): EntityTopicLink[];

  /**
   * Reverse lookup: given a source module topic_id, find the entity it maps to.
   */
  getEntityForTopic(sourceModule: string, topicId: number): TagGraphEntity | undefined;

  /**
   * Get facets for an entity - structural subtopic groups with members populated.
   */
  getFacetsForEntity(entityId: string, category: EntityCategory): EntityFacet[];

  /**
   * Find an entity by exact name or alias match (case-insensitive).
   * Searches across all categories. Returns the first match prioritizing
   * exact name matches over alias matches.
   */
  getEntityByName(name: string): TagGraphEntity | undefined;

  /**
   * Get verse references for an entity (from topical indexes and text search).
   * Returns verses sorted by verse ID (canonical order).
   */
  getVersesForEntity(entityId: string, category: EntityCategory): EntityVerse[];

  /**
   * Reverse lookup: get all entities associated with a given verse.
   * Queries entity_verses and enriches with entity names from their category tables.
   */
  getEntitiesForVerse(verseId: VerseId): VerseEntityResult[];

  /**
   * Bulk variant: every entity reference whose verse range overlaps the
   * inclusive [startVerseId, endVerseId] window. Used for chapter aggregation
   * to avoid the N+1 pattern of calling `getEntitiesForVerse` per verse.
   *
   * Each row carries the original `start_verse_id` so callers can index by
   * the start of the range.
   */
  getEntityRangesForVerseRange(
    startVerseId: VerseId,
    endVerseId: VerseId
  ): EntityVerseRangeResult[];
}

/**
 * One row from {@link ITagGraphRepository.getEntityRangesForVerseRange}.
 * Mirrors the join used by the legacy generation script.
 */
export interface EntityVerseRangeResult {
  entityId: string;
  entityCategory: string;
  startVerseId: VerseId;
  endVerseId: VerseId | null;
  source: string | null;
  entityName: string | null;
}
