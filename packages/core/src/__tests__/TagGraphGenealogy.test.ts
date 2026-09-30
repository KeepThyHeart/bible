import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'node:path';
import { TagGraphRepository } from '../Data/Repositories/TagGraphRepository';
import { loadSchemaSql } from '../Data/Schema';
import { TestSqliteProvider } from './helpers/TestSqliteProvider';

/**
 * TagGraphRepository against a fixture built from the real v2 schema
 * (`sql/schemas/initial/TagGraph.sql`): the legacy entity reads and the
 * genealogy dataset. Sample data follows Genesis 5 / Matthew 1 / Luke 3.
 */

const SCHEMA = join(__dirname, '..', '..', 'sql', 'schemas', 'initial', 'TagGraph.sql');

const GEN_5_3 = 1005003;
const GEN_5_4 = 1005004;
const MT_1_1 = 40001001;
const MT_1_12 = 40001012;
const LK_3_23 = 42003023;
const LK_3_27 = 42003027;

function seed(p: TestSqliteProvider): void {
  p.exec(`
    INSERT INTO person_role (id, name) VALUES ('patriarch', 'Patriarch'), ('king', 'King');
    INSERT INTO person (id, name, sex, kind, tribe, nation, notes) VALUES
      ('adam', 'Adam', 'male', 'individual', NULL, NULL, 'First man'),
      ('seth', 'Seth', 'male', 'individual', NULL, NULL, NULL),
      ('jechoniah', 'Jechoniah', 'male', 'individual', 'Judah', 'israel', NULL),
      ('shealtiel_mt', 'Shealtiel', 'male', 'individual', 'Judah', NULL, NULL),
      ('shealtiel_lk', 'Shealtiel', 'male', 'individual', 'Judah', NULL, NULL),
      ('jacob_mt', 'Jacob', 'male', 'individual', NULL, NULL, NULL),
      ('heli', 'Heli', 'male', 'individual', NULL, NULL, NULL),
      ('joseph', 'Joseph', 'male', 'individual', NULL, NULL, NULL),
      ('mary', 'Mary', 'female', 'individual', NULL, NULL, NULL),
      ('jesus', 'Jesus', 'male', 'individual', NULL, NULL, NULL),
      ('joash', 'Joash', 'male', 'individual', NULL, NULL, NULL),
      ('judah_tribe', 'Judah', NULL, 'group', 'Judah', NULL, NULL),
      ('unknown_sex', 'Ada', NULL, 'individual', NULL, NULL, NULL);
    INSERT INTO person_alias (person_id, alias) VALUES
      ('jesus', 'Christ'), ('jesus', 'Emmanuel'), ('heli', 'Eli');
    INSERT INTO person_role_map (person_id, role_id) VALUES ('adam', 'patriarch'), ('jechoniah', 'king');

    INSERT INTO person_relationship
      (id, person_1_id, person_2_id, relationship_type, relationship_type_reciprocal,
       confidence, notes, qualifier, reading_group, reading, sort_order, source) VALUES
      ('adam_father_seth', 'adam', 'seth', 'father_of', 'son_of', 'certain', 'Gen 5:3', NULL, NULL, NULL, 3, 'bibledata'),
      ('jacob_father_joseph', 'jacob_mt', 'joseph', 'father_of', NULL, 'certain', NULL, NULL, 'joseph_father', 'mt', NULL, 'curated'),
      ('heli_father_joseph', 'heli', 'joseph', 'father_of', NULL, 'possible', NULL, 'legal', 'joseph_father', 'heli_is_father_in_law', NULL, 'curated'),
      ('heli_father_mary', 'heli', 'mary', 'father_of', NULL, 'possible', NULL, NULL, 'mary_line', 'heli_is_father_in_law', NULL, 'curated'),
      ('mary_mother_jesus', 'mary', 'jesus', 'mother_of', NULL, 'certain', NULL, NULL, NULL, NULL, NULL, NULL),
      ('shealtiel_same', 'shealtiel_mt', 'shealtiel_lk', 'possibly_same_as', NULL, 'disputed', 'Identity debated', NULL, NULL, NULL, NULL, 'tipnr'),
      ('jechoniah_father_shealtiel', 'jechoniah', 'shealtiel_mt', 'father_of', NULL, 'certain', NULL, NULL, NULL, NULL, 1, 'tipnr');

    INSERT INTO entity_verse_link (source_type, source_id, verse_id_start, verse_id_end, sort_order, provenance) VALUES
      ('person_relationship', 'adam_father_seth', ${GEN_5_3}, ${GEN_5_3}, 0, 'curated'),
      ('person_relationship', 'heli_father_joseph', ${LK_3_23}, ${LK_3_23}, 0, 'curated'),
      ('person_relationship', 'jacob_father_joseph', ${MT_1_12}, ${MT_1_12}, 1, 'curated'),
      ('person_relationship', 'jacob_father_joseph', ${MT_1_12 + 4}, ${MT_1_12 + 5}, 0, 'curated'),
      ('people', 'adam', ${GEN_5_3}, ${GEN_5_3}, 0, 'text_search'),
      ('people', 'adam', ${GEN_5_4}, ${GEN_5_4 + 1}, 1, 'topical'),
      ('places', 'nowhere', ${GEN_5_3}, ${GEN_5_3}, 0, 'topical'),
      ('interpretive_case', 'heli_case', ${LK_3_23}, ${LK_3_23}, 0, 'curated');

    INSERT INTO lineage (id, name, kind, direction, verse_id_start, verse_id_end, notes) VALUES
      ('genesis_5', 'Genesis 5: Adam to Noah', 'genealogy', 'descending', ${GEN_5_3}, ${GEN_5_4}, NULL),
      ('matthew_1', 'Matthew 1: Abraham to Jesus', 'genealogy', 'descending', ${MT_1_1}, ${MT_1_12}, 'Royal line'),
      ('luke_3', 'Luke 3: Jesus to Adam', 'genealogy', 'ascending', ${LK_3_23}, ${LK_3_27}, NULL);
    INSERT INTO lineage_step (lineage_id, seq, person_id, verse_id, gap_before, note) VALUES
      ('genesis_5', 1, 'adam', ${GEN_5_3}, NULL, NULL),
      ('genesis_5', 2, 'seth', ${GEN_5_3}, NULL, NULL),
      ('matthew_1', 1, 'joash', ${MT_1_1}, NULL, NULL),
      ('matthew_1', 2, 'jechoniah', ${MT_1_12}, '["ahaziah","joash","amaziah"]', 'Skips three kings'),
      ('matthew_1', 3, 'shealtiel_mt', ${MT_1_12}, '[]', NULL),
      ('luke_3', 1, 'jesus', ${LK_3_23}, NULL, NULL),
      ('luke_3', 2, 'joseph', ${LK_3_23}, NULL, NULL),
      ('luke_3', 3, 'heli', ${LK_3_23}, NULL, 'Reading group: Heli'),
      ('luke_3', 4, 'shealtiel_lk', ${LK_3_27}, NULL, NULL);

    INSERT INTO data_source (id, name, licence, url, attribution, notes) VALUES
      ('tipnr', 'STEPBible TIPNR', 'CC BY 4.0', 'https://stepbible.org', 'Tyndale House', 'Modified'),
      ('curated', 'Curated', 'CC0', NULL, NULL, NULL);
    INSERT INTO interpretive_case (id, title, text, person_ids, readings) VALUES
      ('heli_case', 'Who is Heli?', 'Joseph, which was the son of Heli',
       '["heli","joseph"]',
       '[{"label":"Mary''s father","summary":"Luke gives Mary''s line","heldBy":"Many"},{"label":"Levirate","summary":"Heli died childless"}]');
    INSERT INTO person_external_id (person_id, scheme, external_id) VALUES
      ('shealtiel_lk', 'tipnr', 'Shealtiel@Luk.3.27'),
      ('shealtiel_lk', 'wikidata', 'Q123'),
      ('shealtiel_mt', 'tipnr', 'Shealtiel@Mat.1.12');

    INSERT INTO place (id, name, parent_id, modern_name) VALUES ('nowhere', 'Nowhere', NULL, NULL);
    INSERT INTO place_alias (place_id, alias) VALUES ('nowhere', 'Nowhereland');
    INSERT INTO theme (id, name) VALUES ('covenant', 'Covenant');
    INSERT INTO theme_tradition (theme_id, tradition) VALUES ('covenant', 'reformed');
    INSERT INTO association_type (id, name, reciprocal_name) VALUES ('born_in', 'born in', 'birthplace of');
    INSERT INTO tag_association (id, entity_1_id, entity_1_category, entity_2_id, entity_2_category, association_type_id, strength)
      VALUES ('adam_nowhere', 'adam', 'people', 'nowhere', 'places', 'born_in', 0.9);
    INSERT INTO entity_verse_link (source_type, source_id, verse_id_start, verse_id_end, sort_order, provenance) VALUES
      ('tag_association', 'adam_nowhere', ${GEN_5_3}, ${GEN_5_3}, 0, 'curated');
    INSERT INTO entity_topic_link (entity_id, entity_category, source_module, topic_id, match_type)
      VALUES ('adam', 'people', 'topical_nave', 7, 'exact');
    INSERT INTO entity_facet (facet_id, parent_entity_id, parent_entity_category, facet_label, facet_display_label, source_module, source_topic_id)
      VALUES (1, 'adam', 'people', 'sons', 'Sons', 'topical_nave', 8);
    INSERT INTO entity_facet_member (facet_id, member_entity_id, member_entity_category, sort_order)
      VALUES (1, 'seth', 'people', 0);
  `);
}

describe('TagGraphRepository on the v2 schema', () => {
  let provider: TestSqliteProvider;
  let repo: TagGraphRepository;

  beforeAll(() => {
    provider = new TestSqliteProvider(':memory:');
    provider.exec(loadSchemaSql(SCHEMA));
    seed(provider);
    repo = new TagGraphRepository(provider);
  });
  afterAll(() => provider.close());

  describe('entity reads', () => {
    it('reads people, places, objects-less and themes by id', () => {
      expect(repo.getEntity('adam', 'people')?.name).toBe('Adam');
      expect(repo.getEntity('nowhere', 'places')?.name).toBe('Nowhere');
      expect(repo.getEntity('covenant', 'themes')?.name).toBe('Covenant');
      expect(repo.getEntity('adam', 'places')).toBeUndefined();
      expect(repo.getEntity('nope', 'objects')).toBeUndefined();
    });

    it('getPerson returns role names', () => {
      const p = repo.getPerson('jechoniah');
      expect(p?.tribe).toBe('Judah');
      expect(p?.roles).toEqual(['King']);
      expect(repo.getPerson('seth')?.roles).toBeUndefined();
    });

    it('getTheme returns traditions', () => {
      expect(repo.getTheme('covenant')?.traditions).toEqual(['reformed']);
    });

    it('searches names and aliases, and resolves by name', () => {
      expect(repo.searchEntities('adam', ['people']).map(e => e.id)).toEqual(['adam']);
      expect(repo.searchEntities('Christ', ['people']).map(e => e.id)).toEqual(['jesus']);
      expect(repo.searchEntities('nowhereland', ['places']).map(e => e.id)).toEqual(['nowhere']);
      expect(repo.getEntityByName('eli')?.id).toBe('heli');
      expect(repo.getEntityAliases('jesus', 'people').sort()).toEqual(['Christ', 'Emmanuel']);
    });

    it('associations resolve type names and both directions', () => {
      const fwd = repo.getAssociationsForEntity('adam', 'people');
      expect(fwd).toHaveLength(1);
      expect(fwd[0]!.relationshipName).toBe('born in');
      expect(fwd[0]!.entity2Name).toBe('Nowhere');
      const rev = repo.getAssociationsForEntity('nowhere', 'places');
      expect(rev[0]!.relationshipName).toBe('birthplace of');
      expect(repo.getAssociationsByCategory('adam', 'people', 'places')).toHaveLength(1);
      expect(repo.getAssociationsByCategory('adam', 'people', 'themes')).toHaveLength(0);
    });

    it('people relationships flip for person 2', () => {
      const rels = repo.getPeopleRelationships('seth');
      expect(rels).toHaveLength(1);
      expect(rels[0]!.relationshipType).toBe('son_of');
      expect(rels[0]!.person2Name).toBe('Adam');
    });

    it('association passages come from entity_verse_link', () => {
      expect(repo.getAssociationPassages('adam_nowhere')).toEqual([
        { associationId: 'adam_nowhere', startVerseId: GEN_5_3, endVerseId: GEN_5_3, sourceModule: 'curated', sortOrder: 0 },
      ]);
    });

    it('topic links and facets', () => {
      expect(repo.getTopicLinksForEntity('adam', 'people')).toHaveLength(1);
      expect(repo.getEntityForTopic('topical_nave', 7)?.id).toBe('adam');
      const facets = repo.getFacetsForEntity('adam', 'people');
      expect(facets[0]?.members?.map(m => m.memberName)).toEqual(['Seth']);
    });

    it('verse lookups only see entity categories, and honour ranges', () => {
      const verses = repo.getVersesForEntity('adam', 'people');
      expect(verses.map(v => [v.startVerseId, v.endVerseId, v.source])).toEqual([
        [GEN_5_3, GEN_5_3, 'text_search'],
        [GEN_5_4, GEN_5_4 + 1, 'topical'],
      ]);
      const at = repo.getEntitiesForVerse(GEN_5_4 + 1);
      expect(at.map(e => e.entityId)).toEqual(['adam']);
      const g3 = repo.getEntitiesForVerse(GEN_5_3).map(e => `${e.category}:${e.entityId}:${e.name}`).sort();
      expect(g3).toEqual(['people:adam:Adam', 'places:nowhere:Nowhere']);
      const ranges = repo.getEntityRangesForVerseRange(GEN_5_3, GEN_5_4);
      expect(ranges.map(r => r.entityName).sort()).toEqual(['Adam', 'Adam', 'Nowhere']);
      expect(ranges.some(r => r.entityId === 'adam_father_seth')).toBe(false);
    });
  });

  describe('getGenealogyDataset', () => {
    it('returns persons with kind, sex, aliases, roles and first reference', () => {
      const ds = repo.getGenealogyDataset('tag_graph');
      expect(ds.module).toBe('tag_graph');
      const byId = new Map(ds.persons.map(p => [p.id, p]));
      expect(ds.persons).toHaveLength(13);
      expect(byId.get('adam')).toMatchObject({ sex: 'male', kind: 'individual', roles: ['Patriarch'], firstRef: GEN_5_3, notes: 'First man' });
      expect(byId.get('jesus')!.aliases).toEqual(['Christ', 'Emmanuel']);
      expect(byId.get('judah_tribe')).toMatchObject({ kind: 'group', tribe: 'Judah' });
      expect(byId.get('judah_tribe')!.sex).toBeUndefined();
      expect(byId.get('unknown_sex')!.sex).toBeUndefined();
      expect(byId.get('seth')!.aliases).toBeUndefined();
    });

    it('maps edges, qualifier, reading groups and ordered evidence verses', () => {
      const ds = repo.getGenealogyDataset('m');
      const byId = new Map(ds.edges.map(e => [e.id, e]));
      expect(ds.edges).toHaveLength(7);
      expect(byId.get('adam_father_seth')).toEqual({
        id: 'adam_father_seth', from: 'adam', to: 'seth', type: 'father_of',
        confidence: 'certain', sortOrder: 3, source: 'bibledata', notes: 'Gen 5:3',
        verses: [{ start: GEN_5_3, end: GEN_5_3 }],
      });
      const heli = byId.get('heli_father_joseph')!;
      expect(heli).toMatchObject({ qualifier: 'legal', readingGroup: 'joseph_father', reading: 'heli_is_father_in_law', confidence: 'possible' });
      const jacob = byId.get('jacob_father_joseph')!;
      expect(jacob.readingGroup).toBe(heli.readingGroup);
      expect(jacob.verses).toEqual([{ start: MT_1_12 + 4, end: MT_1_12 + 5 }, { start: MT_1_12, end: MT_1_12 }]);
      expect(byId.get('mary_mother_jesus')!.verses).toEqual([]);
      expect(byId.get('mary_mother_jesus')!.qualifier).toBeUndefined();
    });

    it('links the two Shealtiels with possibly_same_as', () => {
      const ds = repo.getGenealogyDataset('m');
      const e = ds.edges.find(x => x.type === 'possibly_same_as')!;
      expect(e).toMatchObject({ from: 'shealtiel_mt', to: 'shealtiel_lk', confidence: 'disputed' });
      expect(ds.persons.filter(p => p.name === 'Shealtiel')).toHaveLength(2);
    });

    it('returns lineages with ordered steps and gap_before parsed', () => {
      const ds = repo.getGenealogyDataset('m');
      expect(ds.lineages.map(l => l.id)).toEqual(['genesis_5', 'luke_3', 'matthew_1']);
      const mt = ds.lineages.find(l => l.id === 'matthew_1')!;
      expect(mt).toMatchObject({ direction: 'descending', range: { start: MT_1_1, end: MT_1_12 }, notes: 'Royal line' });
      expect(mt.steps.map(s => s.personId)).toEqual(['joash', 'jechoniah', 'shealtiel_mt']);
      expect(mt.steps[1]).toEqual({
        personId: 'jechoniah', verseId: MT_1_12, gapBefore: ['ahaziah', 'joash', 'amaziah'], note: 'Skips three kings',
      });
      expect(mt.steps[0]!.gapBefore).toBeUndefined();
      expect(mt.steps[2]!.gapBefore).toBeUndefined(); // empty array
      const lk = ds.lineages.find(l => l.id === 'luke_3')!;
      expect(lk.direction).toBe('ascending');
      expect(lk.steps.map(s => s.personId)).toEqual(['jesus', 'joseph', 'heli', 'shealtiel_lk']);
    });

    it('returns sources, interpretive cases and external ids', () => {
      const ds = repo.getGenealogyDataset('m');
      expect(ds.sources).toEqual([
        { id: 'curated', name: 'Curated', licence: 'CC0' },
        { id: 'tipnr', name: 'STEPBible TIPNR', licence: 'CC BY 4.0', url: 'https://stepbible.org', attribution: 'Tyndale House', notes: 'Modified' },
      ]);
      expect(ds.cases).toEqual([{
        id: 'heli_case', title: 'Who is Heli?', text: 'Joseph, which was the son of Heli',
        verses: [{ start: LK_3_23, end: LK_3_23 }], personIds: ['heli', 'joseph'],
        readings: [
          { label: "Mary's father", summary: "Luke gives Mary's line", heldBy: 'Many' },
          { label: 'Levirate', summary: 'Heli died childless' },
        ],
      }]);
      expect(ds.externalIds).toEqual({
        shealtiel_lk: { tipnr: 'Shealtiel@Luk.3.27', wikidata: 'Q123' },
        shealtiel_mt: { tipnr: 'Shealtiel@Mat.1.12' },
      });
    });

    it('getLineage returns one lineage or undefined', () => {
      const l = repo.getLineage('luke_3');
      expect(l?.name).toBe('Luke 3: Jesus to Adam');
      expect(l?.steps).toHaveLength(4);
      expect(repo.getLineage('nope')).toBeUndefined();
    });
  });

  describe('empty and legacy databases', () => {
    it('returns an empty valid dataset for a schema with no rows', () => {
      const p = new TestSqliteProvider(':memory:');
      p.exec(loadSchemaSql(SCHEMA));
      const r = new TagGraphRepository(p);
      expect(r.getGenealogyDataset('x')).toEqual({
        module: 'x', persons: [], edges: [], lineages: [], sources: [], cases: [], externalIds: {},
      });
      expect(r.getLineage('genesis_5')).toBeUndefined();
      expect(r.getEntitiesForVerse(GEN_5_3)).toEqual([]);
      p.close();
    });

    it('returns an empty dataset (no throw) when genealogy tables are missing', () => {
      const p = new TestSqliteProvider(':memory:');
      p.exec('CREATE TABLE person (id TEXT PRIMARY KEY, name TEXT NOT NULL, tribe TEXT, nation TEXT, notes TEXT);');
      const r = new TagGraphRepository(p);
      expect(r.getGenealogyDataset('old').persons).toEqual([]);
      const bare = new TestSqliteProvider(':memory:');
      const r2 = new TagGraphRepository(bare);
      expect(r2.getGenealogyDataset('none')).toMatchObject({ module: 'none', persons: [], edges: [] });
      expect(r2.getLineage('x')).toBeUndefined();
      p.close();
      bare.close();
    });

    it('tolerates malformed JSON in gap_before and interpretive_case', () => {
      const p = new TestSqliteProvider(':memory:');
      p.exec(loadSchemaSql(SCHEMA));
      p.exec(`
        INSERT INTO person (id, name) VALUES ('a', 'A');
        INSERT INTO lineage (id, name, kind, direction, verse_id_start, verse_id_end) VALUES ('l', 'L', 'genealogy', 'descending', 1, 2);
        INSERT INTO lineage_step (lineage_id, seq, person_id, verse_id, gap_before) VALUES ('l', 1, 'a', 1, '{not json');
        INSERT INTO interpretive_case (id, title, text, person_ids, readings) VALUES ('c', 'C', 't', 'oops', '{"x":1}');
      `);
      const ds = new TagGraphRepository(p).getGenealogyDataset('m');
      expect(ds.lineages[0]!.steps[0]!.gapBefore).toBeUndefined();
      expect(ds.cases?.[0]).toMatchObject({ personIds: [], readings: [] });
      p.close();
    });
  });
});
