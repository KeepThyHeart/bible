import { ISql } from '../Core/ISql';
import { VerseId } from '../Core/Types';
import { ITagGraphRepository, VerseEntityResult, EntityVerseRangeResult } from './ITagGraphRepository';
import { TagGraphEntity, PersonEntity, PlaceEntity, ObjectEntity, ThemeEntity, PeopleRelationship, EntityCategory } from '../Models/TagGraph/TagGraphEntity';
import { TagAssociation, AssociationPassage } from '../Models/TagGraph/TagAssociation';
import { EntityTopicLink } from '../Models/TagGraph/EntityTopicLink';
import { EntityFacet, EntityFacetMember } from '../Models/TagGraph/EntityFacet';
import { EntityVerse } from '../Models/TagGraph/EntityVerse';

/**
 * Fixed category -> table-name lookup. Table/column names cannot be
 * parameterized in SQLite, so any interpolation of a category into SQL MUST go
 * through this whitelist. Keys are exhaustively typed to `EntityCategory`, so a
 * caller-supplied string that is not a real category resolves to `undefined`
 * and is rejected before it can reach a query. Do NOT interpolate a raw
 * category string into SQL anywhere in this file.
 */
const ENTITY_TABLES: Record<EntityCategory, { table: string; aliasTable: string; aliasFK: string }> = {
  people: { table: 'people', aliasTable: 'people_aliases', aliasFK: 'person_id' },
  places: { table: 'places', aliasTable: 'place_aliases', aliasFK: 'place_id' },
  objects: { table: 'objects', aliasTable: 'object_aliases', aliasFK: 'object_id' },
  themes: { table: 'themes', aliasTable: 'theme_aliases', aliasFK: 'theme_id' },
};

/**
 * Repository implementation for the tag graph database (tag_graph.db).
 * Provides read-only access to the biblical entity relationship graph.
 */
export class TagGraphRepository implements ITagGraphRepository {
  constructor(private sql: ISql) {}

  getEntity(entityId: string, category: EntityCategory): TagGraphEntity | undefined {
    switch (category) {
      case 'people': {
        const row = this.sql.queryOne<{ id: string; name: string; notes: string | null }>(
          'SELECT id, name, notes FROM people WHERE id = ?', [entityId]
        );
        return row ? { id: row.id, name: row.name, category: 'people', notes: row.notes ?? undefined } : undefined;
      }
      case 'places': {
        const row = this.sql.queryOne<{ id: string; name: string; notes: string | null }>(
          'SELECT id, name, notes FROM places WHERE id = ?', [entityId]
        );
        return row ? { id: row.id, name: row.name, category: 'places', notes: row.notes ?? undefined } : undefined;
      }
      case 'objects': {
        const row = this.sql.queryOne<{ id: string; name: string; notes: string | null }>(
          'SELECT id, name, notes FROM objects WHERE id = ?', [entityId]
        );
        return row ? { id: row.id, name: row.name, category: 'objects', notes: row.notes ?? undefined } : undefined;
      }
      case 'themes': {
        const row = this.sql.queryOne<{ id: string; name: string; notes: string | null }>(
          'SELECT id, name, notes FROM themes WHERE id = ?', [entityId]
        );
        return row ? { id: row.id, name: row.name, category: 'themes', notes: row.notes ?? undefined } : undefined;
      }
      default:
        return undefined;
    }
  }

  getPerson(personId: string): PersonEntity | undefined {
    const row = this.sql.queryOne<{ id: string; name: string; tribe: string | null; nation: string | null; notes: string | null }>(
      'SELECT id, name, tribe, nation, notes FROM people WHERE id = ?', [personId]
    );
    if (!row) return undefined;

    const roles = this.sql.queryAll<{ name: string }>(
      `SELECT pr.name FROM people_roles prl
       JOIN person_roles pr ON prl.role_id = pr.id
       WHERE prl.person_id = ?`, [personId]
    ).map(r => r.name);

    return {
      id: row.id,
      name: row.name,
      category: 'people',
      tribe: row.tribe ?? undefined,
      nation: row.nation ?? undefined,
      notes: row.notes ?? undefined,
      roles: roles.length > 0 ? roles : undefined,
    };
  }

  getPlace(placeId: string): PlaceEntity | undefined {
    const row = this.sql.queryOne<{ id: string; name: string; parent_id: string | null; modern_name: string | null; notes: string | null }>(
      'SELECT id, name, parent_id, modern_name, notes FROM places WHERE id = ?', [placeId]
    );
    if (!row) return undefined;

    const attributes = this.sql.queryAll<{ name: string }>(
      `SELECT pa.name FROM place_attribute_map pam
       JOIN place_attributes pa ON pam.attribute_id = pa.id
       WHERE pam.place_id = ?`, [placeId]
    ).map(a => a.name);

    return {
      id: row.id,
      name: row.name,
      category: 'places',
      parentId: row.parent_id ?? undefined,
      modernName: row.modern_name ?? undefined,
      notes: row.notes ?? undefined,
      attributes: attributes.length > 0 ? attributes : undefined,
    };
  }

  getObject(objectId: string): ObjectEntity | undefined {
    const row = this.sql.queryOne<{ id: string; name: string; parent_id: string | null; significance: string | null; notes: string | null }>(
      'SELECT id, name, parent_id, significance, notes FROM objects WHERE id = ?', [objectId]
    );
    if (!row) return undefined;

    const attributes = this.sql.queryAll<{ name: string }>(
      `SELECT oa.name FROM object_attribute_map oam
       JOIN object_attributes oa ON oam.attribute_id = oa.id
       WHERE oam.object_id = ?`, [objectId]
    ).map(a => a.name);

    return {
      id: row.id,
      name: row.name,
      category: 'objects',
      parentId: row.parent_id ?? undefined,
      significance: row.significance as ObjectEntity['significance'] ?? undefined,
      notes: row.notes ?? undefined,
      attributes: attributes.length > 0 ? attributes : undefined,
    };
  }

  getTheme(themeId: string): ThemeEntity | undefined {
    const row = this.sql.queryOne<{ id: string; name: string; parent_id: string | null; notes: string | null }>(
      'SELECT id, name, parent_id, notes FROM themes WHERE id = ?', [themeId]
    );
    if (!row) return undefined;

    const traditions = this.sql.queryAll<{ tradition: string }>(
      'SELECT tradition FROM theme_traditions WHERE theme_id = ?', [themeId]
    ).map(t => t.tradition);

    const attributes = this.sql.queryAll<{ name: string }>(
      `SELECT ta.name FROM theme_attribute_map tam
       JOIN theme_attributes ta ON tam.attribute_id = ta.id
       WHERE tam.theme_id = ?`, [themeId]
    ).map(a => a.name);

    return {
      id: row.id,
      name: row.name,
      category: 'themes',
      parentId: row.parent_id ?? undefined,
      notes: row.notes ?? undefined,
      traditions: traditions.length > 0 ? traditions : undefined,
      attributes: attributes.length > 0 ? attributes : undefined,
    };
  }

  getAssociationsForEntity(entityId: string, category: EntityCategory): TagAssociation[] {
    const rows = this.sql.queryAll<{
      id: string; entity_1_id: string; entity_1_category: string;
      entity_2_id: string; entity_2_category: string;
      association_type_id: string; name: string; reciprocal_name: string | null;
      strength: number; confidence: string | null; notes: string | null;
    }>(
      `SELECT ta.id, ta.entity_1_id, ta.entity_1_category,
              ta.entity_2_id, ta.entity_2_category,
              ta.association_type_id, at.name, at.reciprocal_name,
              ta.strength, ta.confidence, ta.notes
       FROM tag_associations ta
       JOIN association_types at ON ta.association_type_id = at.id
       WHERE (ta.entity_1_id = ? AND ta.entity_1_category = ?)
          OR (ta.entity_2_id = ? AND ta.entity_2_category = ?)
       ORDER BY ta.strength DESC`,
      [entityId, category, entityId, category]
    );

    return rows.map(row => this.mapAssociationRow(row, entityId, category));
  }

  getAssociationsByCategory(entityId: string, category: EntityCategory, targetCategory: EntityCategory): TagAssociation[] {
    const rows = this.sql.queryAll<{
      id: string; entity_1_id: string; entity_1_category: string;
      entity_2_id: string; entity_2_category: string;
      association_type_id: string; name: string; reciprocal_name: string | null;
      strength: number; confidence: string | null; notes: string | null;
    }>(
      `SELECT ta.id, ta.entity_1_id, ta.entity_1_category,
              ta.entity_2_id, ta.entity_2_category,
              ta.association_type_id, at.name, at.reciprocal_name,
              ta.strength, ta.confidence, ta.notes
       FROM tag_associations ta
       JOIN association_types at ON ta.association_type_id = at.id
       WHERE ((ta.entity_1_id = ? AND ta.entity_1_category = ? AND ta.entity_2_category = ?)
           OR (ta.entity_2_id = ? AND ta.entity_2_category = ? AND ta.entity_1_category = ?))
       ORDER BY ta.strength DESC`,
      [entityId, category, targetCategory, entityId, category, targetCategory]
    );

    return rows.map(row => this.mapAssociationRow(row, entityId, category));
  }

  getPeopleRelationships(personId: string): PeopleRelationship[] {
    const rows = this.sql.queryAll<{
      id: string; person_1_id: string; person_2_id: string;
      relationship_type: string; relationship_type_reciprocal: string | null;
      confidence: string | null; notes: string | null;
    }>(
      `SELECT id, person_1_id, person_2_id, relationship_type,
              relationship_type_reciprocal, confidence, notes
       FROM people_relationships
       WHERE person_1_id = ? OR person_2_id = ?`,
      [personId, personId]
    );

    return rows.map(row => {
      const name1 = this.getEntityName(row.person_1_id, 'people');
      const name2 = this.getEntityName(row.person_2_id, 'people');

      if (row.person_2_id === personId) {
        return {
          id: row.id,
          person1Id: row.person_2_id,
          person2Id: row.person_1_id,
          person1Name: name2,
          person2Name: name1,
          relationshipType: row.relationship_type_reciprocal ?? row.relationship_type,
          relationshipTypeReciprocal: row.relationship_type,
          confidence: row.confidence ?? undefined,
          notes: row.notes ?? undefined,
        };
      }

      return {
        id: row.id,
        person1Id: row.person_1_id,
        person2Id: row.person_2_id,
        person1Name: name1,
        person2Name: name2,
        relationshipType: row.relationship_type,
        relationshipTypeReciprocal: row.relationship_type_reciprocal ?? undefined,
        confidence: row.confidence ?? undefined,
        notes: row.notes ?? undefined,
      };
    });
  }

  searchEntities(query: string, categories?: EntityCategory[]): TagGraphEntity[] {
    const cats = categories ?? ['people', 'places', 'objects', 'themes'];
    const results: TagGraphEntity[] = [];
    const likeQuery = `%${query}%`;

    for (const cat of cats) {
      // Resolve table/column names via the fixed whitelist. An unknown category
      // (e.g. an injection payload that slipped past the route) has no entry and
      // is skipped rather than interpolated into SQL.
      const tables = ENTITY_TABLES[cat];
      if (!tables) continue;
      const { table, aliasTable, aliasFK } = tables;

      const nameRows = this.sql.queryAll<{ id: string; name: string; notes: string | null }>(
        `SELECT id, name, notes FROM ${table} WHERE name LIKE ? COLLATE NOCASE LIMIT 20`,
        [likeQuery]
      );
      for (const row of nameRows) {
        results.push({ id: row.id, name: row.name, category: cat, notes: row.notes ?? undefined });
      }

      const aliasRows = this.sql.queryAll<{ id: string; name: string; notes: string | null }>(
        `SELECT DISTINCT t.id, t.name, t.notes FROM ${table} t
         JOIN ${aliasTable} a ON a.${aliasFK} = t.id
         WHERE a.alias LIKE ? COLLATE NOCASE
         AND t.id NOT IN (SELECT id FROM ${table} WHERE name LIKE ? COLLATE NOCASE)
         LIMIT 20`,
        [likeQuery, likeQuery]
      );
      for (const row of aliasRows) {
        results.push({ id: row.id, name: row.name, category: cat, notes: row.notes ?? undefined });
      }
    }

    return results;
  }

  getEntityAliases(entityId: string, category: EntityCategory): string[] {
    // Resolve table/column names via the fixed whitelist so an out-of-contract
    // category string can never be interpolated into SQL.
    const tables = ENTITY_TABLES[category];
    if (!tables) return [];
    const { aliasTable, aliasFK } = tables;

    const rows = this.sql.queryAll<{ alias: string }>(
      `SELECT alias FROM ${aliasTable} WHERE ${aliasFK} = ?`,
      [entityId]
    );
    return rows.map(r => r.alias);
  }

  getAssociationPassages(associationId: string): AssociationPassage[] {
    const rows = this.sql.queryAll<{
      association_id: string; start_verse_id: number; end_verse_id: number;
      source_module: string | null; sort_order: number;
    }>(
      `SELECT association_id, start_verse_id, end_verse_id, source_module, sort_order
       FROM association_verses WHERE association_id = ? ORDER BY sort_order`,
      [associationId]
    );
    return rows.map(r => ({
      associationId: r.association_id,
      startVerseId: r.start_verse_id,
      endVerseId: r.end_verse_id,
      sourceModule: r.source_module ?? undefined,
      sortOrder: r.sort_order,
    }));
  }

  getTopicLinksForEntity(entityId: string, category: EntityCategory, sourceModule?: string): EntityTopicLink[] {
    // Check if the entity_topic_links table exists (older DBs may only have topic_index_mapping)
    const tableCheck = this.sql.queryOne<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name='entity_topic_links'`
    );
    if (!tableCheck || tableCheck.cnt === 0) return [];

    let rows;
    if (sourceModule) {
      rows = this.sql.queryAll<{
        entity_id: string; entity_category: string; source_module: string;
        topic_id: number; match_type: string;
      }>(
        `SELECT entity_id, entity_category, source_module, topic_id, match_type
         FROM entity_topic_links
         WHERE entity_id = ? AND entity_category = ? AND source_module = ?
         ORDER BY match_type, topic_id`,
        [entityId, category, sourceModule]
      );
    } else {
      rows = this.sql.queryAll<{
        entity_id: string; entity_category: string; source_module: string;
        topic_id: number; match_type: string;
      }>(
        `SELECT entity_id, entity_category, source_module, topic_id, match_type
         FROM entity_topic_links
         WHERE entity_id = ? AND entity_category = ?
         ORDER BY source_module, match_type, topic_id`,
        [entityId, category]
      );
    }

    return rows.map(r => ({
      entityId: r.entity_id,
      entityCategory: r.entity_category as EntityCategory,
      sourceModule: r.source_module,
      topicId: r.topic_id,
      matchType: r.match_type as EntityTopicLink['matchType'],
    }));
  }

  getEntityForTopic(sourceModule: string, topicId: number): TagGraphEntity | undefined {
    const row = this.sql.queryOne<{
      entity_id: string; entity_category: string; match_type: string;
    }>(
      `SELECT entity_id, entity_category, match_type
       FROM entity_topic_links
       WHERE source_module = ? AND topic_id = ?
       ORDER BY CASE match_type WHEN 'exact' THEN 1 WHEN 'alias' THEN 2 WHEN 'stem' THEN 3 END
       LIMIT 1`,
      [sourceModule, topicId]
    );
    if (!row) return undefined;

    return this.getEntity(row.entity_id, row.entity_category as EntityCategory);
  }

  getFacetsForEntity(entityId: string, category: EntityCategory): EntityFacet[] {
    const facetRows = this.sql.queryAll<{
      facet_id: number; parent_entity_id: string; parent_entity_category: string;
      facet_label: string; facet_display_label: string;
      source_module: string; source_topic_id: number;
    }>(
      `SELECT facet_id, parent_entity_id, parent_entity_category,
              facet_label, facet_display_label, source_module, source_topic_id
       FROM entity_facets
       WHERE parent_entity_id = ? AND parent_entity_category = ?
       ORDER BY facet_label`,
      [entityId, category]
    );

    return facetRows.map(f => {
      const memberRows = this.sql.queryAll<{
        facet_id: number; member_entity_id: string; member_entity_category: string;
        source_topic_id: number | null; sort_order: number;
      }>(
        `SELECT facet_id, member_entity_id, member_entity_category, source_topic_id, sort_order
         FROM entity_facet_members WHERE facet_id = ? ORDER BY sort_order`,
        [f.facet_id]
      );

      const members: EntityFacetMember[] = memberRows.map(m => ({
        facetId: m.facet_id,
        memberEntityId: m.member_entity_id,
        memberEntityCategory: m.member_entity_category as EntityCategory,
        sourceTopicId: m.source_topic_id ?? undefined,
        sortOrder: m.sort_order,
        memberName: this.getEntityName(m.member_entity_id, m.member_entity_category as EntityCategory),
      }));

      return {
        facetId: f.facet_id,
        parentEntityId: f.parent_entity_id,
        parentEntityCategory: f.parent_entity_category as EntityCategory,
        facetLabel: f.facet_label,
        facetDisplayLabel: f.facet_display_label,
        sourceModule: f.source_module,
        sourceTopicId: f.source_topic_id,
        members,
      };
    });
  }

  getEntityByName(name: string): TagGraphEntity | undefined {
    const categories: Array<{ table: string; category: EntityCategory; aliasTable: string; aliasFK: string }> = [
      { table: 'people', category: 'people', aliasTable: 'people_aliases', aliasFK: 'person_id' },
      { table: 'places', category: 'places', aliasTable: 'place_aliases', aliasFK: 'place_id' },
      { table: 'objects', category: 'objects', aliasTable: 'object_aliases', aliasFK: 'object_id' },
      { table: 'themes', category: 'themes', aliasTable: 'theme_aliases', aliasFK: 'theme_id' },
    ];

    // Exact name match first (across all categories)
    for (const cat of categories) {
      const row = this.sql.queryOne<{ id: string; name: string; notes: string | null }>(
        `SELECT id, name, notes FROM ${cat.table} WHERE name = ? COLLATE NOCASE`,
        [name]
      );
      if (row) return { id: row.id, name: row.name, category: cat.category, notes: row.notes ?? undefined };
    }

    // Alias match
    for (const cat of categories) {
      const row = this.sql.queryOne<{ id: string; name: string; notes: string | null }>(
        `SELECT t.id, t.name, t.notes FROM ${cat.table} t
         JOIN ${cat.aliasTable} a ON a.${cat.aliasFK} = t.id
         WHERE a.alias = ? COLLATE NOCASE`,
        [name]
      );
      if (row) return { id: row.id, name: row.name, category: cat.category, notes: row.notes ?? undefined };
    }

    return undefined;
  }

  getVersesForEntity(entityId: string, category: EntityCategory): EntityVerse[] {
    const rows = this.sql.queryAll<{
      entity_id: string; entity_category: string;
      start_verse_id: number; end_verse_id: number;
      source: string;
    }>(
      `SELECT entity_id, entity_category, start_verse_id, end_verse_id, source
       FROM entity_verses
       WHERE entity_id = ? AND entity_category = ?
       ORDER BY start_verse_id`,
      [entityId, category]
    );

    return rows.map(r => ({
      entityId: r.entity_id,
      entityCategory: r.entity_category as EntityCategory,
      startVerseId: r.start_verse_id,
      endVerseId: r.end_verse_id,
      source: r.source,
    }));
  }

  getEntitiesForVerse(verseId: VerseId): VerseEntityResult[] {
    // Whitelist valid table names to prevent SQL injection via entity_category
    const validTables: Record<string, string> = {
      people: 'people',
      places: 'places',
      objects: 'objects',
      themes: 'themes',
      events: 'events',
    };

    const rows = this.sql.queryAll<{
      entity_id: string;
      entity_category: string;
      source: string;
    }>(
      `SELECT DISTINCT entity_id, entity_category, source
       FROM entity_verses
       WHERE start_verse_id <= ? AND end_verse_id >= ?`,
      [verseId, verseId]
    );

    return rows.map(row => {
      const table = validTables[row.entity_category];
      if (!table) {
        return {
          entityId: row.entity_id,
          category: row.entity_category as EntityCategory,
          name: 'Unknown',
          notes: undefined,
          source: row.source,
        };
      }
      const entity = this.sql.queryOne<{ name: string; notes: string | null }>(
        `SELECT name, notes FROM ${table} WHERE id = ?`,
        [row.entity_id]
      );
      return {
        entityId: row.entity_id,
        category: row.entity_category as EntityCategory,
        name: entity?.name ?? 'Unknown',
        notes: entity?.notes ?? undefined,
        source: row.source,
      };
    });
  }

  getEntityRangesForVerseRange(
    startVerseId: VerseId,
    endVerseId: VerseId
  ): EntityVerseRangeResult[] {
    // entity_verses uses start_verse_id (and optionally end_verse_id for ranges).
    // Mirrors scripts/generate-study-cache.js buildEntitiesData() byte-for-byte:
    // same WHERE shape, same COALESCE join across people/places/objects/themes,
    // same iteration order from sqlite (no ORDER BY).
    const rows = this.sql.queryAll<{
      entity_id: string;
      entity_category: string;
      start_verse_id: number;
      end_verse_id: number | null;
      source: string | null;
      entity_name: string | null;
    }>(
      `SELECT ev.entity_id, ev.entity_category, ev.start_verse_id, ev.end_verse_id, ev.source,
              COALESCE(p.name, pl.name, o.name, th.name) AS entity_name
       FROM entity_verses ev
       LEFT JOIN people p ON ev.entity_id = p.id AND ev.entity_category = 'people'
       LEFT JOIN places pl ON ev.entity_id = pl.id AND ev.entity_category = 'places'
       LEFT JOIN objects o ON ev.entity_id = o.id AND ev.entity_category = 'objects'
       LEFT JOIN themes th ON ev.entity_id = th.id AND ev.entity_category = 'themes'
       WHERE (ev.start_verse_id BETWEEN ? AND ?)
          OR (ev.end_verse_id BETWEEN ? AND ?)
          OR (ev.start_verse_id <= ? AND ev.end_verse_id >= ?)`,
      [startVerseId, endVerseId, startVerseId, endVerseId, startVerseId, endVerseId]
    );

    return rows.map(r => ({
      entityId: r.entity_id,
      entityCategory: r.entity_category,
      startVerseId: r.start_verse_id,
      endVerseId: r.end_verse_id,
      source: r.source,
      entityName: r.entity_name,
    }));
  }

  // ========== Private helpers ==========

  private getEntityName(entityId: string, category: EntityCategory): string {
    const table = category === 'people' ? 'people' : category;
    const row = this.sql.queryOne<{ name: string }>(
      `SELECT name FROM ${table} WHERE id = ?`, [entityId]
    );
    return row?.name ?? entityId;
  }

  private mapAssociationRow(row: {
    id: string; entity_1_id: string; entity_1_category: string;
    entity_2_id: string; entity_2_category: string;
    association_type_id: string; name: string; reciprocal_name: string | null;
    strength: number; confidence: string | null; notes: string | null;
  }, queryEntityId: string, queryCategory: EntityCategory): TagAssociation {
    const isReversed = row.entity_2_id === queryEntityId && row.entity_2_category === queryCategory
      && !(row.entity_1_id === queryEntityId && row.entity_1_category === queryCategory);

    const otherEntityId = isReversed ? row.entity_1_id : row.entity_2_id;
    const otherCategory = (isReversed ? row.entity_1_category : row.entity_2_category) as EntityCategory;
    const otherName = this.getEntityName(otherEntityId, otherCategory);

    return {
      id: row.id,
      entity1Id: queryEntityId,
      entity1Category: queryCategory,
      entity1Name: this.getEntityName(queryEntityId, queryCategory),
      entity2Id: otherEntityId,
      entity2Category: otherCategory,
      entity2Name: otherName,
      associationTypeId: row.association_type_id,
      relationshipName: isReversed ? (row.reciprocal_name ?? row.name) : row.name,
      reciprocalName: isReversed ? row.name : (row.reciprocal_name ?? undefined),
      strength: row.strength,
      confidence: row.confidence ?? undefined,
      notes: row.notes ?? undefined,
    };
  }
}
