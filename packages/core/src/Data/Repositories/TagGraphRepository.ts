import { ISql } from '../Core/ISql';
import { VerseId } from '../Core/Types';
import { ITagGraphRepository, VerseEntityResult, EntityVerseRangeResult } from './ITagGraphRepository';
import { TagGraphEntity, PersonEntity, PlaceEntity, ObjectEntity, ThemeEntity, PeopleRelationship, EntityCategory } from '../Models/TagGraph/TagGraphEntity';
import { TagAssociation, AssociationPassage } from '../Models/TagGraph/TagAssociation';
import { EntityTopicLink } from '../Models/TagGraph/EntityTopicLink';
import { EntityFacet, EntityFacetMember } from '../Models/TagGraph/EntityFacet';
import { EntityVerse } from '../Models/TagGraph/EntityVerse';
import type {
  GenealogyDatasetDto, GenealogyPersonDto, GenealogyEdgeDto, LineageDto, LineageStepDto,
  DataSourceDto, InterpretiveCaseDto, VerseRangeDto, Sex, PersonKind, EdgeQualifier,
} from '../../Genealogy/types';

/**
 * Fixed category -> table-name lookup. Table/column names cannot be
 * parameterized in SQLite, so any interpolation of a category into SQL MUST go
 * through this whitelist. Keys are exhaustively typed to `EntityCategory`, so a
 * caller-supplied string that is not a real category resolves to `undefined`
 * and is rejected before it can reach a query. Do NOT interpolate a raw
 * category string into SQL anywhere in this file.
 */
const ENTITY_TABLES: Record<EntityCategory, { table: string; aliasTable: string; aliasFK: string }> = {
  people: { table: 'person', aliasTable: 'person_alias', aliasFK: 'person_id' },
  places: { table: 'place', aliasTable: 'place_alias', aliasFK: 'place_id' },
  objects: { table: 'object', aliasTable: 'object_alias', aliasFK: 'object_id' },
  themes: { table: 'theme', aliasTable: 'theme_alias', aliasFK: 'theme_id' },
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
          'SELECT id, name, notes FROM person WHERE id = ?', [entityId]
        );
        return row ? { id: row.id, name: row.name, category: 'people', notes: row.notes ?? undefined } : undefined;
      }
      case 'places': {
        const row = this.sql.queryOne<{ id: string; name: string; notes: string | null }>(
          'SELECT id, name, notes FROM place WHERE id = ?', [entityId]
        );
        return row ? { id: row.id, name: row.name, category: 'places', notes: row.notes ?? undefined } : undefined;
      }
      case 'objects': {
        const row = this.sql.queryOne<{ id: string; name: string; notes: string | null }>(
          'SELECT id, name, notes FROM object WHERE id = ?', [entityId]
        );
        return row ? { id: row.id, name: row.name, category: 'objects', notes: row.notes ?? undefined } : undefined;
      }
      case 'themes': {
        const row = this.sql.queryOne<{ id: string; name: string; notes: string | null }>(
          'SELECT id, name, notes FROM theme WHERE id = ?', [entityId]
        );
        return row ? { id: row.id, name: row.name, category: 'themes', notes: row.notes ?? undefined } : undefined;
      }
      default:
        return undefined;
    }
  }

  getPerson(personId: string): PersonEntity | undefined {
    const row = this.sql.queryOne<{ id: string; name: string; tribe: string | null; nation: string | null; notes: string | null }>(
      'SELECT id, name, tribe, nation, notes FROM person WHERE id = ?', [personId]
    );
    if (!row) return undefined;

    const roles = this.sql.queryAll<{ name: string }>(
      `SELECT pr.name FROM person_role_map prl
       JOIN person_role pr ON prl.role_id = pr.id
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
      'SELECT id, name, parent_id, modern_name, notes FROM place WHERE id = ?', [placeId]
    );
    if (!row) return undefined;

    const attributes = this.sql.queryAll<{ name: string }>(
      `SELECT pa.name FROM place_attribute_map pam
       JOIN place_attribute pa ON pam.attribute_id = pa.id
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
      'SELECT id, name, parent_id, significance, notes FROM object WHERE id = ?', [objectId]
    );
    if (!row) return undefined;

    const attributes = this.sql.queryAll<{ name: string }>(
      `SELECT oa.name FROM object_attribute_map oam
       JOIN object_attribute oa ON oam.attribute_id = oa.id
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
      'SELECT id, name, parent_id, notes FROM theme WHERE id = ?', [themeId]
    );
    if (!row) return undefined;

    const traditions = this.sql.queryAll<{ tradition: string }>(
      'SELECT tradition FROM theme_tradition WHERE theme_id = ?', [themeId]
    ).map(t => t.tradition);

    const attributes = this.sql.queryAll<{ name: string }>(
      `SELECT ta.name FROM theme_attribute_map tam
       JOIN theme_attribute ta ON tam.attribute_id = ta.id
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
       FROM tag_association ta
       JOIN association_type at ON ta.association_type_id = at.id
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
       FROM tag_association ta
       JOIN association_type at ON ta.association_type_id = at.id
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
       FROM person_relationship
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
      source_id: string; verse_id_start: number; verse_id_end: number;
      provenance: string | null; sort_order: number;
    }>(
      `SELECT source_id, verse_id_start, verse_id_end, provenance, sort_order
       FROM entity_verse_link
       WHERE source_type = 'tag_association' AND source_id = ?
       ORDER BY sort_order, verse_id_start`,
      [associationId]
    );
    return rows.map(r => ({
      associationId: r.source_id,
      startVerseId: r.verse_id_start,
      endVerseId: r.verse_id_end,
      sourceModule: r.provenance ?? undefined,
      sortOrder: r.sort_order,
    }));
  }

  getTopicLinksForEntity(entityId: string, category: EntityCategory, sourceModule?: string): EntityTopicLink[] {
    // Check if the entity_topic_links table exists (older DBs may only have topic_index_mapping)
    const tableCheck = this.sql.queryOne<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name='entity_topic_link'`
    );
    if (!tableCheck || tableCheck.cnt === 0) return [];

    let rows;
    if (sourceModule) {
      rows = this.sql.queryAll<{
        entity_id: string; entity_category: string; source_module: string;
        topic_id: number; match_type: string;
      }>(
        `SELECT entity_id, entity_category, source_module, topic_id, match_type
         FROM entity_topic_link
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
         FROM entity_topic_link
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
       FROM entity_topic_link
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
       FROM entity_facet
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
         FROM entity_facet_member WHERE facet_id = ? ORDER BY sort_order`,
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
      { table: 'person', category: 'people', aliasTable: 'person_alias', aliasFK: 'person_id' },
      { table: 'place', category: 'places', aliasTable: 'place_alias', aliasFK: 'place_id' },
      { table: 'object', category: 'objects', aliasTable: 'object_alias', aliasFK: 'object_id' },
      { table: 'theme', category: 'themes', aliasTable: 'theme_alias', aliasFK: 'theme_id' },
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
      source_id: string; source_type: string;
      verse_id_start: number; verse_id_end: number;
      source: string | null;
    }>(
      `SELECT source_id, source_type, verse_id_start, verse_id_end,
              COALESCE(provenance, link_type) AS source
       FROM entity_verse_link
       WHERE source_id = ? AND source_type = ?
       ORDER BY verse_id_start, sort_order`,
      [entityId, category]
    );

    return rows.map(r => ({
      entityId: r.source_id,
      entityCategory: r.source_type as EntityCategory,
      startVerseId: r.verse_id_start,
      endVerseId: r.verse_id_end,
      source: r.source ?? '',
    }));
  }

  getEntitiesForVerse(verseId: VerseId): VerseEntityResult[] {
    // Only the four entity categories; tag_association / person_relationship /
    // interpretive_case rows share entity_verse_link but are not entities.
    const rows = this.sql.queryAll<{
      source_id: string;
      source_type: string;
      source: string | null;
    }>(
      `SELECT DISTINCT source_id, source_type, COALESCE(provenance, link_type) AS source
       FROM entity_verse_link
       WHERE source_type IN ('people','places','objects','themes')
         AND verse_id_start <= ? AND verse_id_end >= ?`,
      [verseId, verseId]
    );

    return rows.map(row => {
      const tables = ENTITY_TABLES[row.source_type as EntityCategory];
      const entity = tables
        ? this.sql.queryOne<{ name: string; notes: string | null }>(
            `SELECT name, notes FROM ${tables.table} WHERE id = ?`,
            [row.source_id]
          )
        : undefined;
      return {
        entityId: row.source_id,
        category: row.source_type as EntityCategory,
        name: entity?.name ?? 'Unknown',
        notes: entity?.notes ?? undefined,
        source: row.source ?? '',
      };
    });
  }

  getEntityRangesForVerseRange(
    startVerseId: VerseId,
    endVerseId: VerseId
  ): EntityVerseRangeResult[] {
    // Mirrors scripts/generate-study-cache.js buildEntitiesData(): same WHERE
    // shape, same COALESCE join across person/place/object/theme, same
    // iteration order from sqlite (no ORDER BY). v2 ranges always have an end.
    const rows = this.sql.queryAll<{
      source_id: string;
      source_type: string;
      verse_id_start: number;
      verse_id_end: number | null;
      source: string | null;
      entity_name: string | null;
    }>(
      `SELECT ev.source_id, ev.source_type, ev.verse_id_start, ev.verse_id_end,
              COALESCE(ev.provenance, ev.link_type) AS source,
              COALESCE(p.name, pl.name, o.name, th.name) AS entity_name
       FROM entity_verse_link ev
       LEFT JOIN person p ON ev.source_id = p.id AND ev.source_type = 'people'
       LEFT JOIN place pl ON ev.source_id = pl.id AND ev.source_type = 'places'
       LEFT JOIN object o ON ev.source_id = o.id AND ev.source_type = 'objects'
       LEFT JOIN theme th ON ev.source_id = th.id AND ev.source_type = 'themes'
       WHERE ev.source_type IN ('people','places','objects','themes')
         AND ((ev.verse_id_start BETWEEN ? AND ?)
          OR (ev.verse_id_end BETWEEN ? AND ?)
          OR (ev.verse_id_start <= ? AND ev.verse_id_end >= ?))`,
      [startVerseId, endVerseId, startVerseId, endVerseId, startVerseId, endVerseId]
    );

    return rows.map(r => ({
      entityId: r.source_id,
      entityCategory: r.source_type,
      startVerseId: r.verse_id_start,
      endVerseId: r.verse_id_end,
      source: r.source,
      entityName: r.entity_name,
    }));
  }

  // ========== Genealogy ==========

  getGenealogyDataset(moduleId: string): GenealogyDatasetDto {
    const empty = (): GenealogyDatasetDto => ({
      module: moduleId, persons: [], edges: [], lineages: [], sources: [], cases: [], externalIds: {},
    });
    // Older (v0.1) databases lack the genealogy columns/tables: return an empty dataset.
    if (!this.tableHasColumns('person', ['sex', 'kind'])
      || !this.tableHasColumns('person_relationship', ['qualifier', 'reading_group'])) {
      return empty();
    }

    // Persons + aliases + roles + first appearance -------------------------
    const personRows = this.sql.queryAll<{
      id: string; name: string; sex: string | null; kind: string;
      tribe: string | null; nation: string | null; notes: string | null;
    }>('SELECT id, name, sex, kind, tribe, nation, notes FROM person ORDER BY id');
    if (personRows.length === 0) return empty();

    const aliasesBy = this.groupBy(
      this.sql.queryAll<{ person_id: string; alias: string }>(
        'SELECT person_id, alias FROM person_alias ORDER BY person_id, alias'),
      r => r.person_id, r => r.alias);
    const rolesBy = this.groupBy(
      this.sql.queryAll<{ person_id: string; name: string }>(
        `SELECT m.person_id, r.name FROM person_role_map m
         JOIN person_role r ON r.id = m.role_id ORDER BY m.person_id, r.name`),
      r => r.person_id, r => r.name);
    const firstRef = new Map<string, number>();
    if (this.tableExists('entity_verse_link')) {
      for (const r of this.sql.queryAll<{ source_id: string; first: number }>(
        `SELECT source_id, MIN(verse_id_start) AS first FROM entity_verse_link
         WHERE source_type = 'people' GROUP BY source_id`)) {
        firstRef.set(r.source_id, r.first);
      }
    }

    const persons: GenealogyPersonDto[] = personRows.map(r => {
      const p: GenealogyPersonDto = { id: r.id, name: r.name, kind: (r.kind as PersonKind) ?? 'individual' };
      if (r.sex) p.sex = r.sex as Sex;
      if (r.tribe) p.tribe = r.tribe;
      if (r.nation) p.nation = r.nation;
      const roles = rolesBy.get(r.id);
      if (roles?.length) p.roles = roles;
      const aliases = aliasesBy.get(r.id);
      if (aliases?.length) p.aliases = aliases;
      const fr = firstRef.get(r.id);
      if (fr !== undefined) p.firstRef = fr;
      if (r.notes) p.notes = r.notes;
      return p;
    });

    // Edges + evidence verses ---------------------------------------------
    const versesFor = this.verseRangesBySource('person_relationship');
    const edges: GenealogyEdgeDto[] = this.sql.queryAll<{
      id: string; person_1_id: string; person_2_id: string; relationship_type: string;
      qualifier: string | null; confidence: string | null; reading_group: string | null;
      reading: string | null; sort_order: number | null; source: string | null; notes: string | null;
    }>(
      `SELECT id, person_1_id, person_2_id, relationship_type, qualifier, confidence,
              reading_group, reading, sort_order, source, notes
       FROM person_relationship ORDER BY id`
    ).map(r => {
      const e: GenealogyEdgeDto = {
        id: r.id, from: r.person_1_id, to: r.person_2_id, type: r.relationship_type,
        verses: versesFor.get(r.id) ?? [],
      };
      if (r.qualifier) e.qualifier = r.qualifier as EdgeQualifier;
      if (r.confidence) e.confidence = r.confidence;
      if (r.reading_group) e.readingGroup = r.reading_group;
      if (r.reading) e.reading = r.reading;
      if (r.sort_order !== null && r.sort_order !== undefined) e.sortOrder = r.sort_order;
      if (r.source) e.source = r.source;
      if (r.notes) e.notes = r.notes;
      return e;
    });

    // Lineages -------------------------------------------------------------
    const lineages = this.readLineages();

    // Sources, cases, external ids ----------------------------------------
    const sources: DataSourceDto[] = !this.tableExists('data_source') ? [] : this.sql.queryAll<{
      id: string; name: string; licence: string; url: string | null;
      attribution: string | null; notes: string | null;
    }>('SELECT id, name, licence, url, attribution, notes FROM data_source ORDER BY id').map(r => {
      const d: DataSourceDto = { id: r.id, name: r.name, licence: r.licence };
      if (r.url) d.url = r.url;
      if (r.attribution) d.attribution = r.attribution;
      if (r.notes) d.notes = r.notes;
      return d;
    });

    const cases = this.readCases();

    const externalIds: Record<string, Record<string, string>> = {};
    if (this.tableExists('person_external_id')) {
      for (const r of this.sql.queryAll<{ person_id: string; scheme: string; external_id: string }>(
        'SELECT person_id, scheme, external_id FROM person_external_id ORDER BY person_id, scheme')) {
        (externalIds[r.person_id] ??= {})[r.scheme] = r.external_id;
      }
    }

    return { module: moduleId, persons, edges, lineages, sources, cases, externalIds };
  }

  getLineage(id: string): LineageDto | undefined {
    if (!this.tableExists('lineage') || !this.tableExists('lineage_step')) return undefined;
    return this.readLineages(id)[0];
  }

  private readLineages(onlyId?: string): LineageDto[] {
    if (!this.tableExists('lineage') || !this.tableExists('lineage_step')) return [];
    const where = onlyId === undefined ? '' : ' WHERE id = ?';
    const params = onlyId === undefined ? [] : [onlyId];
    const rows = this.sql.queryAll<{
      id: string; name: string; kind: string; direction: string;
      verse_id_start: number; verse_id_end: number; notes: string | null;
    }>(
      `SELECT id, name, kind, direction, verse_id_start, verse_id_end, notes FROM lineage${where} ORDER BY id`,
      params
    );
    if (rows.length === 0) return [];
    const stepRows = this.sql.queryAll<{
      lineage_id: string; person_id: string; verse_id: number; gap_before: string | null; note: string | null;
    }>(
      `SELECT lineage_id, person_id, verse_id, gap_before, note FROM lineage_step
       ${onlyId === undefined ? '' : 'WHERE lineage_id = ?'} ORDER BY lineage_id, seq`,
      params
    );
    const stepsBy = this.groupBy(stepRows, r => r.lineage_id, r => {
      const step: LineageStepDto = { personId: r.person_id, verseId: r.verse_id };
      const gap = this.parseStringArray(r.gap_before);
      if (gap.length > 0) step.gapBefore = gap;
      if (r.note) step.note = r.note;
      return step;
    });
    return rows.map(r => {
      const l: LineageDto = {
        id: r.id, name: r.name, kind: r.kind,
        direction: r.direction as LineageDto['direction'],
        range: { start: r.verse_id_start, end: r.verse_id_end },
        steps: stepsBy.get(r.id) ?? [],
      };
      if (r.notes) l.notes = r.notes;
      return l;
    });
  }

  private readCases(): InterpretiveCaseDto[] {
    if (!this.tableExists('interpretive_case')) return [];
    const versesFor = this.verseRangesBySource('interpretive_case');
    return this.sql.queryAll<{
      id: string; title: string; text: string; person_ids: string | null; readings: string | null;
    }>('SELECT id, title, text, person_ids, readings FROM interpretive_case ORDER BY id').map(r => ({
      id: r.id,
      title: r.title,
      verses: versesFor.get(r.id) ?? [],
      personIds: this.parseStringArray(r.person_ids),
      text: r.text,
      readings: this.parseReadings(r.readings),
    }));
  }

  // ========== Private helpers ==========

  private tableExists(name: string): boolean {
    const row = this.sql.queryOne<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM sqlite_master WHERE type = 'table' AND name = ?`, [name]);
    return !!row && row.cnt > 0;
  }

  private tableHasColumns(table: string, columns: string[]): boolean {
    if (!this.tableExists(table)) return false;
    // `table` is always a literal from this file, never caller input.
    const have = new Set(this.sql.queryAll<{ name: string }>(`PRAGMA table_info(${table})`).map(r => r.name));
    return columns.every(c => have.has(c));
  }

  private groupBy<T, V>(rows: T[], key: (r: T) => string, val: (r: T) => V): Map<string, V[]> {
    const m = new Map<string, V[]>();
    for (const r of rows) {
      const k = key(r);
      const list = m.get(k);
      if (list) list.push(val(r)); else m.set(k, [val(r)]);
    }
    return m;
  }

  /** All entity_verse_link ranges of one source_type, grouped by source_id, in display order. */
  private verseRangesBySource(sourceType: string): Map<string, VerseRangeDto[]> {
    if (!this.tableExists('entity_verse_link')) return new Map();
    return this.groupBy(
      this.sql.queryAll<{ source_id: string; verse_id_start: number; verse_id_end: number }>(
        `SELECT source_id, verse_id_start, verse_id_end FROM entity_verse_link
         WHERE source_type = ? ORDER BY source_id, sort_order, verse_id_start`, [sourceType]),
      r => r.source_id,
      r => ({ start: r.verse_id_start, end: r.verse_id_end }));
  }

  private parseStringArray(json: string | null): string[] {
    if (!json) return [];
    try {
      const v: unknown = JSON.parse(json);
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  private parseReadings(json: string | null): InterpretiveCaseDto['readings'] {
    if (!json) return [];
    try {
      const v: unknown = JSON.parse(json);
      if (!Array.isArray(v)) return [];
      return v.flatMap(x => {
        if (!x || typeof x !== 'object') return [];
        const o = x as Record<string, unknown>;
        if (typeof o.label !== 'string' || typeof o.summary !== 'string') return [];
        const reading: InterpretiveCaseDto['readings'][number] = { label: o.label, summary: o.summary };
        if (typeof o.heldBy === 'string') reading.heldBy = o.heldBy;
        return [reading];
      });
    } catch {
      return [];
    }
  }


  private getEntityName(entityId: string, category: EntityCategory): string {
    const tables = ENTITY_TABLES[category];
    if (!tables) return entityId;
    const row = this.sql.queryOne<{ name: string }>(
      `SELECT name FROM ${tables.table} WHERE id = ?`, [entityId]
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
