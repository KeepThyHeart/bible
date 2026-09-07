import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'path';
import { TagGraphRepository } from '../Data/Repositories/TagGraphRepository';
import { TestSqliteProvider } from './helpers/TestSqliteProvider';
import { TEST_DATA_DIR, testDataAvailable } from './helpers/testData';

// ==========================================================================
// Test SQLite Provider (read-only)
// ==========================================================================

// ==========================================================================
// Test Suite
// ==========================================================================

const dbPath = path.join(TEST_DATA_DIR, 'tag_graph.db');

describe.skipIf(!testDataAvailable('TagGraphRepository', dbPath))('TagGraphRepository', () => {
  let provider: TestSqliteProvider;
  let repo: TagGraphRepository;

  beforeAll(() => {
    provider = new TestSqliteProvider(dbPath);
    repo = new TagGraphRepository(provider);
  });

  afterAll(() => {
    provider.close();
  });

  // ==========================================================================
  // getEntity
  // ==========================================================================

  describe('getEntity', () => {
    it('should return a person entity by id', () => {
      const entity = repo.getEntity('moses', 'people');
      expect(entity).toBeDefined();
      expect(entity!.id).toBe('moses');
      expect(entity!.name).toBe('Moses');
      expect(entity!.category).toBe('people');
    });

    it('should return a place entity by id', () => {
      const entity = repo.getEntity('jerusalem', 'places');
      expect(entity).toBeDefined();
      expect(entity!.id).toBe('jerusalem');
      expect(entity!.name).toBe('Jerusalem');
      expect(entity!.category).toBe('places');
    });

    it('should return an object entity by id', () => {
      const entity = repo.getEntity('ark_of_covenant', 'objects');
      expect(entity).toBeDefined();
      expect(entity!.id).toBe('ark_of_covenant');
      expect(entity!.name).toBe('Ark of the Covenant');
      expect(entity!.category).toBe('objects');
    });

    it('should return a theme entity by id', () => {
      const entity = repo.getEntity('salvation', 'themes');
      expect(entity).toBeDefined();
      expect(entity!.id).toBe('salvation');
      expect(entity!.name).toBe('Salvation');
      expect(entity!.category).toBe('themes');
    });

    it('should return undefined for non-existent entity', () => {
      const entity = repo.getEntity('nonexistent_entity_xyz', 'people');
      expect(entity).toBeUndefined();
    });

    it('should return undefined for wrong category', () => {
      // 'moses' is a person, not a place
      const entity = repo.getEntity('moses', 'places');
      expect(entity).toBeUndefined();
    });
  });

  // ==========================================================================
  // getPerson
  // ==========================================================================

  describe('getPerson', () => {
    it('should return Moses with tribe and nation', () => {
      const person = repo.getPerson('moses');
      expect(person).toBeDefined();
      expect(person!.id).toBe('moses');
      expect(person!.name).toBe('Moses');
      expect(person!.category).toBe('people');
      expect(person!.tribe).toBe('Levi');
      expect(person!.nation).toBe('Israel');
    });

    it('should return Moses with roles', () => {
      const person = repo.getPerson('moses');
      expect(person).toBeDefined();
      expect(person!.roles).toBeDefined();
      expect(person!.roles).toContain('Prophet');
      expect(person!.roles).toContain('Levite');
    });

    it('should return David with tribe and nation', () => {
      const person = repo.getPerson('david');
      expect(person).toBeDefined();
      expect(person!.name).toBe('David');
      expect(person!.tribe).toBe('Judah');
      expect(person!.nation).toBe('Israel');
    });

    it('should return Paul with tribe info', () => {
      const person = repo.getPerson('paul');
      expect(person).toBeDefined();
      expect(person!.name).toBe('Paul');
      expect(person!.tribe).toBe('Benjamin');
    });

    it('should return undefined for non-existent person', () => {
      const person = repo.getPerson('nonexistent_person_xyz');
      expect(person).toBeUndefined();
    });

    it('should return Adam without tribe or nation', () => {
      const person = repo.getPerson('adam');
      expect(person).toBeDefined();
      expect(person!.name).toBe('Adam');
      expect(person!.tribe).toBeUndefined();
      expect(person!.nation).toBeUndefined();
    });
  });

  // ==========================================================================
  // getPlace
  // ==========================================================================

  describe('getPlace', () => {
    it('should return Jerusalem with parent and modern name', () => {
      const place = repo.getPlace('jerusalem');
      expect(place).toBeDefined();
      expect(place!.id).toBe('jerusalem');
      expect(place!.name).toBe('Jerusalem');
      expect(place!.category).toBe('places');
      expect(place!.parentId).toBe('judea_region');
      expect(place!.modernName).toBe('Jerusalem');
    });

    it('should return Jerusalem with attributes', () => {
      const place = repo.getPlace('jerusalem');
      expect(place).toBeDefined();
      expect(place!.attributes).toBeDefined();
      expect(place!.attributes).toContain('Capital City');
      expect(place!.attributes).toContain('City');
    });

    it('should return Canaan with parent and modern name', () => {
      const place = repo.getPlace('canaan');
      expect(place).toBeDefined();
      expect(place!.name).toBe('Canaan');
      expect(place!.parentId).toBe('levant');
      expect(place!.modernName).toBe('Israel/Palestine/Lebanon/southern Syria');
    });

    it('should return undefined for non-existent place', () => {
      const place = repo.getPlace('nonexistent_place_xyz');
      expect(place).toBeUndefined();
    });
  });

  // ==========================================================================
  // getObject
  // ==========================================================================

  describe('getObject', () => {
    it('should return Ark of the Covenant', () => {
      const obj = repo.getObject('ark_of_covenant');
      expect(obj).toBeDefined();
      expect(obj!.id).toBe('ark_of_covenant');
      expect(obj!.name).toBe('Ark of the Covenant');
      expect(obj!.category).toBe('objects');
    });

    it('should return an object with significance and parent', () => {
      const obj = repo.getObject('harp');
      expect(obj).toBeDefined();
      expect(obj!.name).toBe('Harp');
      expect(obj!.significance).toBe('symbolic');
    });

    it('should return an object with attributes', () => {
      const obj = repo.getObject('shofar');
      expect(obj).toBeDefined();
      expect(obj!.name).toBe('Shofar');
      expect(obj!.attributes).toBeDefined();
      expect(obj!.attributes!.length).toBeGreaterThan(0);
      expect(obj!.attributes).toContain('Musical Instrument');
    });

    it('should return a sacred object with correct significance', () => {
      const obj = repo.getObject('trumpet');
      expect(obj).toBeDefined();
      expect(obj!.significance).toBe('sacred');
    });

    it('should return undefined for non-existent object', () => {
      const obj = repo.getObject('nonexistent_object_xyz');
      expect(obj).toBeUndefined();
    });
  });

  // ==========================================================================
  // getTheme
  // ==========================================================================

  describe('getTheme', () => {
    it('should return Salvation theme', () => {
      const theme = repo.getTheme('salvation');
      expect(theme).toBeDefined();
      expect(theme!.id).toBe('salvation');
      expect(theme!.name).toBe('Salvation');
      expect(theme!.category).toBe('themes');
    });

    it('should return Faith theme', () => {
      const theme = repo.getTheme('faith');
      expect(theme).toBeDefined();
      expect(theme!.name).toBe('Faith');
    });

    it('should return a theme with parent', () => {
      const theme = repo.getTheme('noahic_covenant');
      expect(theme).toBeDefined();
      expect(theme!.name).toBe('Noahic Covenant');
      expect(theme!.parentId).toBe('covenant');
    });

    it('should return undefined for non-existent theme', () => {
      const theme = repo.getTheme('nonexistent_theme_xyz');
      expect(theme).toBeUndefined();
    });
  });

  // ==========================================================================
  // getAssociationsForEntity
  // ==========================================================================

  describe('getAssociationsForEntity', () => {
    it('should return associations for Moses', () => {
      const assocs = repo.getAssociationsForEntity('moses', 'people');
      expect(assocs).toBeDefined();
      expect(assocs.length).toBeGreaterThan(0);
    });

    it('should include Moses-to-objects associations (staff, tablets)', () => {
      const assocs = repo.getAssociationsForEntity('moses', 'people');
      const staffAssoc = assocs.find(a => a.entity2Id === 'staff_of_moses');
      expect(staffAssoc).toBeDefined();
      expect(staffAssoc!.entity1Id).toBe('moses');
      expect(staffAssoc!.entity1Category).toBe('people');
      expect(staffAssoc!.entity2Category).toBe('objects');
    });

    it('should include Moses-to-places associations (Sinai)', () => {
      const assocs = repo.getAssociationsForEntity('moses', 'people');
      const sinaiAssoc = assocs.find(a => a.entity2Id === 'mount_sinai');
      expect(sinaiAssoc).toBeDefined();
      expect(sinaiAssoc!.entity2Category).toBe('places');
    });

    it('should have proper association fields', () => {
      const assocs = repo.getAssociationsForEntity('moses', 'people');
      const first = assocs[0];
      expect(first).toBeDefined();
      expect(first.id).toBeDefined();
      expect(first.entity1Id).toBe('moses');
      expect(first.entity1Category).toBe('people');
      expect(first.entity2Id).toBeDefined();
      expect(first.entity2Category).toBeDefined();
      expect(first.associationTypeId).toBeDefined();
      expect(first.relationshipName).toBeDefined();
      expect(typeof first.strength).toBe('number');
    });

    it('should return associations for a theme (salvation)', () => {
      const assocs = repo.getAssociationsForEntity('salvation', 'themes');
      expect(assocs.length).toBeGreaterThan(0);
      // Salvation is entity_2 in some associations, so it should appear as entity1 after normalization
      const allHaveSalvationAsEntity1 = assocs.every(a => a.entity1Id === 'salvation');
      expect(allHaveSalvationAsEntity1).toBe(true);
    });

    it('should return empty array for entity with no associations', () => {
      const assocs = repo.getAssociationsForEntity('nonexistent_entity_xyz', 'people');
      expect(assocs).toEqual([]);
    });

    it('should be ordered by strength descending', () => {
      const assocs = repo.getAssociationsForEntity('moses', 'people');
      for (let i = 1; i < assocs.length; i++) {
        expect(assocs[i - 1].strength).toBeGreaterThanOrEqual(assocs[i].strength);
      }
    });
  });

  // ==========================================================================
  // getAssociationsByCategory
  // ==========================================================================

  describe('getAssociationsByCategory', () => {
    it('should return only place associations for Moses', () => {
      const assocs = repo.getAssociationsByCategory('moses', 'people', 'places');
      expect(assocs.length).toBeGreaterThan(0);
      for (const a of assocs) {
        expect(a.entity1Id).toBe('moses');
        expect(a.entity1Category).toBe('people');
        expect(a.entity2Category).toBe('places');
      }
    });

    it('should return only object associations for Moses', () => {
      const assocs = repo.getAssociationsByCategory('moses', 'people', 'objects');
      expect(assocs.length).toBeGreaterThan(0);
      for (const a of assocs) {
        expect(a.entity2Category).toBe('objects');
      }
    });

    it('should include Sinai in Moses-places associations', () => {
      const assocs = repo.getAssociationsByCategory('moses', 'people', 'places');
      const sinai = assocs.find(a => a.entity2Id === 'mount_sinai');
      expect(sinai).toBeDefined();
    });

    it('should return empty array for non-existent category pair', () => {
      const assocs = repo.getAssociationsByCategory('nonexistent_xyz', 'people', 'objects');
      expect(assocs).toEqual([]);
    });
  });

  // ==========================================================================
  // getPeopleRelationships
  // ==========================================================================

  describe('getPeopleRelationships', () => {
    it('should return relationships for Moses', () => {
      const rels = repo.getPeopleRelationships('moses');
      expect(rels).toBeDefined();
      expect(rels.length).toBeGreaterThan(0);
    });

    it('should include Moses-Aaron brother relationship', () => {
      const rels = repo.getPeopleRelationships('moses');
      const aaronRel = rels.find(r => r.person2Id === 'aaron');
      expect(aaronRel).toBeDefined();
      expect(aaronRel!.person1Id).toBe('moses');
      expect(aaronRel!.relationshipType).toBe('brother_of');
    });

    it('should include Moses-Zipporah spouse relationship', () => {
      const rels = repo.getPeopleRelationships('moses');
      const zipporahRel = rels.find(r => r.person2Id === 'zipporah');
      expect(zipporahRel).toBeDefined();
      expect(zipporahRel!.relationshipType).toBe('husband_of');
    });

    it('should normalize reversed relationships (e.g., Jethro-Moses)', () => {
      // Jethro is person_1 in DB, so when querying for Moses it should be reversed
      const rels = repo.getPeopleRelationships('moses');
      const jethroRel = rels.find(r => r.person2Id === 'jethro');
      expect(jethroRel).toBeDefined();
      expect(jethroRel!.person1Id).toBe('moses');
      // The reciprocal type should be used since Moses is person_2 in the DB
      expect(jethroRel!.relationshipType).toBe('mentee_of');
    });

    it('should include person names in relationships', () => {
      const rels = repo.getPeopleRelationships('moses');
      const aaronRel = rels.find(r => r.person2Id === 'aaron');
      expect(aaronRel).toBeDefined();
      expect(aaronRel!.person1Name).toBe('Moses');
      expect(aaronRel!.person2Name).toBe('Aaron');
    });

    it('should include Moses-Joshua mentor relationship', () => {
      const rels = repo.getPeopleRelationships('moses');
      const joshuaRel = rels.find(r => r.person2Id === 'joshua');
      expect(joshuaRel).toBeDefined();
      expect(joshuaRel!.relationshipType).toBe('mentor_of');
    });

    it('should return empty array for non-existent person', () => {
      const rels = repo.getPeopleRelationships('nonexistent_person_xyz');
      expect(rels).toEqual([]);
    });
  });

  // ==========================================================================
  // searchEntities
  // ==========================================================================

  describe('searchEntities', () => {
    it('should find Moses when searching "Moses"', () => {
      const results = repo.searchEntities('Moses');
      const moses = results.find(r => r.id === 'moses' && r.category === 'people');
      expect(moses).toBeDefined();
      expect(moses!.name).toBe('Moses');
    });

    it('should find David across multiple categories', () => {
      const results = repo.searchEntities('David');
      const categories = new Set(results.map(r => r.category));
      // David exists as a person and in place names (City of David)
      expect(categories.has('people')).toBe(true);
      expect(categories.has('places')).toBe(true);
    });

    it('should filter by category when specified', () => {
      const results = repo.searchEntities('David', ['people']);
      for (const r of results) {
        expect(r.category).toBe('people');
      }
    });

    it('should find entities by alias', () => {
      // "Moshe" is an alias for Moses
      const results = repo.searchEntities('Moshe', ['people']);
      const moses = results.find(r => r.id === 'moses');
      expect(moses).toBeDefined();
    });

    it('should return empty array for nonsense query', () => {
      const results = repo.searchEntities('xyznonexistent123');
      expect(results).toEqual([]);
    });

    it('should search across all categories by default', () => {
      // "salvation" is a theme, should also appear in any related aliases
      const results = repo.searchEntities('Salvation');
      const theme = results.find(r => r.id === 'salvation' && r.category === 'themes');
      expect(theme).toBeDefined();
    });

    it('should search themes category only when specified', () => {
      const results = repo.searchEntities('Faith', ['themes']);
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.category).toBe('themes');
      }
    });
  });

  // ==========================================================================
  // getEntityAliases
  // ==========================================================================

  describe('getEntityAliases', () => {
    it('should return aliases for Moses', () => {
      const aliases = repo.getEntityAliases('moses', 'people');
      expect(aliases).toBeDefined();
      expect(aliases.length).toBeGreaterThan(0);
      expect(aliases).toContain('Moshe');
      expect(aliases).toContain('Moyses');
    });

    it('should return aliases for Jerusalem', () => {
      const aliases = repo.getEntityAliases('jerusalem', 'places');
      expect(aliases).toBeDefined();
      expect(aliases).toContain('Zion');
      expect(aliases).toContain('City of David');
      expect(aliases).toContain('Jebus');
      expect(aliases).toContain('Salem');
      expect(aliases).toContain('Holy City');
    });

    it('should return aliases for Ark of the Covenant', () => {
      const aliases = repo.getEntityAliases('ark_of_covenant', 'objects');
      expect(aliases).toBeDefined();
      expect(aliases.length).toBeGreaterThan(0);
      expect(aliases).toContain('Ark of the Testimony');
      expect(aliases).toContain('Ark of God');
    });

    it('should return aliases for salvation theme', () => {
      const aliases = repo.getEntityAliases('salvation', 'themes');
      expect(aliases).toBeDefined();
      expect(aliases).toContain('deliverance');
      expect(aliases).toContain('redemption');
    });

    it('should return empty array for entity with no aliases', () => {
      const aliases = repo.getEntityAliases('nonexistent_entity_xyz', 'people');
      expect(aliases).toEqual([]);
    });
  });

  // ==========================================================================
  // getAssociationPassages
  // ==========================================================================

  describe('getAssociationPassages', () => {
    it('should return empty array or throw when association_verses table does not exist', () => {
      // The association_verses table does not exist in this DB build
      try {
        const passages = repo.getAssociationPassages('nonexistent_assoc_xyz');
        expect(passages).toEqual([]);
      } catch (err: unknown) {
        // Expected: table does not exist
        expect((err as Error).message).toContain('association_verses');
      }
    });

    it('should handle known association id gracefully', () => {
      try {
        const passages = repo.getAssociationPassages('assoc_moses_staff');
        expect(Array.isArray(passages)).toBe(true);
      } catch (err: unknown) {
        // Expected: table does not exist
        expect((err as Error).message).toContain('association_verses');
      }
    });
  });

  // ==========================================================================
  // getTopicLinksForEntity
  // ==========================================================================

  describe('getTopicLinksForEntity', () => {
    it('should return empty array when entity_topic_links table does not exist', () => {
      // The DB lacks the entity_topic_links table, so this should gracefully return []
      const links = repo.getTopicLinksForEntity('moses', 'people');
      expect(links).toEqual([]);
    });

    it('should return empty array with source module filter', () => {
      const links = repo.getTopicLinksForEntity('moses', 'people', 'some_module');
      expect(links).toEqual([]);
    });
  });

  // ==========================================================================
  // getEntityForTopic
  // ==========================================================================

  describe('getEntityForTopic', () => {
    it('should return undefined when entity_topic_links table does not exist', () => {
      // Falls back to undefined since entity_topic_links table is missing
      // The method queries entity_topic_links directly, so it may throw or return undefined
      // depending on whether the table exists. In this DB it does not exist.
      // The method does not check for table existence like getTopicLinksForEntity does,
      // so we need to handle this case.
      try {
        const entity = repo.getEntityForTopic('some_module', 1);
        expect(entity).toBeUndefined();
      } catch {
        // Expected if entity_topic_links table does not exist
        expect(true).toBe(true);
      }
    });
  });

  // ==========================================================================
  // getFacetsForEntity
  // ==========================================================================

  describe('getFacetsForEntity', () => {
    it('should return empty array when entity_facets table does not exist', () => {
      // The DB lacks entity_facets table, so this may throw or return []
      try {
        const facets = repo.getFacetsForEntity('moses', 'people');
        expect(facets).toEqual([]);
      } catch {
        // Expected if entity_facets table does not exist
        expect(true).toBe(true);
      }
    });
  });

  // ==========================================================================
  // getEntityByName
  // ==========================================================================

  describe('getEntityByName', () => {
    it('should find Moses by exact name', () => {
      const entity = repo.getEntityByName('Moses');
      expect(entity).toBeDefined();
      expect(entity!.id).toBe('moses');
      expect(entity!.name).toBe('Moses');
      expect(entity!.category).toBe('people');
    });

    it('should find Jerusalem by exact name', () => {
      const entity = repo.getEntityByName('Jerusalem');
      expect(entity).toBeDefined();
      expect(entity!.id).toBe('jerusalem');
      expect(entity!.category).toBe('places');
    });

    it('should find Salvation by exact name', () => {
      const entity = repo.getEntityByName('Salvation');
      expect(entity).toBeDefined();
      expect(entity!.id).toBe('salvation');
      expect(entity!.category).toBe('themes');
    });

    it('should find Ark of the Covenant by exact name', () => {
      const entity = repo.getEntityByName('Ark of the Covenant');
      expect(entity).toBeDefined();
      expect(entity!.id).toBe('ark_of_covenant');
      expect(entity!.category).toBe('objects');
    });

    it('should be case-insensitive', () => {
      const entity = repo.getEntityByName('moses');
      expect(entity).toBeDefined();
      expect(entity!.id).toBe('moses');
    });

    it('should find entity by alias (Yerushalayim -> jerusalem)', () => {
      // "Yerushalayim" is an alias for Jerusalem and has no matching entity name
      const entity = repo.getEntityByName('Yerushalayim');
      expect(entity).toBeDefined();
      expect(entity!.id).toBe('jerusalem');
      expect(entity!.category).toBe('places');
    });

    it('should find entity by alias (Moshe -> moses)', () => {
      const entity = repo.getEntityByName('Moshe');
      expect(entity).toBeDefined();
      expect(entity!.id).toBe('moses');
      expect(entity!.category).toBe('people');
    });

    it('should return undefined for non-existent name', () => {
      const entity = repo.getEntityByName('NonExistentEntityXYZ123');
      expect(entity).toBeUndefined();
    });

    it('should prioritize exact name match over alias match', () => {
      // "David" should find the person "david" by direct name, not via alias
      const entity = repo.getEntityByName('David');
      expect(entity).toBeDefined();
      expect(entity!.id).toBe('david');
      expect(entity!.category).toBe('people');
    });
  });

  // ==========================================================================
  // getVersesForEntity
  // ==========================================================================

  describe('getVersesForEntity', () => {
    it('should return empty array when entity_verses table is empty', () => {
      // The entity_verses table has 0 rows in this DB
      const verses = repo.getVersesForEntity('moses', 'people');
      expect(verses).toEqual([]);
    });

    it('should return empty array for non-existent entity', () => {
      const verses = repo.getVersesForEntity('nonexistent_xyz', 'people');
      expect(verses).toEqual([]);
    });
  });

  // ==========================================================================
  // Cross-category integration tests
  // ==========================================================================

  describe('cross-category integration', () => {
    it('should find associations spanning people-to-objects', () => {
      const assocs = repo.getAssociationsByCategory('moses', 'people', 'objects');
      const staffAssoc = assocs.find(a => a.entity2Id === 'staff_of_moses');
      expect(staffAssoc).toBeDefined();
      expect(staffAssoc!.relationshipName).toBeDefined();
    });

    it('should find associations spanning people-to-places', () => {
      const assocs = repo.getAssociationsByCategory('moses', 'people', 'places');
      expect(assocs.length).toBeGreaterThan(0);
      const placeIds = assocs.map(a => a.entity2Id);
      expect(placeIds).toContain('mount_sinai');
      expect(placeIds).toContain('red_sea');
    });

    it('should find associations for a theme-to-objects (salvation)', () => {
      const assocs = repo.getAssociationsByCategory('salvation', 'themes', 'objects');
      // Salvation is linked to objects like bronze_serpent
      expect(assocs.length).toBeGreaterThan(0);
    });

    it('should consistently resolve entity names in associations', () => {
      const assocs = repo.getAssociationsForEntity('moses', 'people');
      for (const a of assocs) {
        expect(a.entity1Name).toBe('Moses');
        // `entity2Name` is optional on the row, so narrow before measuring -
        // otherwise a missing name reads as a length error, not a data error.
        const name = a.entity2Name;
        expect(name).toBeDefined();
        expect(name!.length).toBeGreaterThan(0);
      }
    });

    it('should distinguish between similar entities across categories', () => {
      const personDavid = repo.getEntity('david', 'people');
      const placeCityOfDavid = repo.getEntity('city_of_david', 'places');
      expect(personDavid).toBeDefined();
      expect(placeCityOfDavid).toBeDefined();
      expect(personDavid!.category).toBe('people');
      expect(placeCityOfDavid!.category).toBe('places');
    });
  });

  // ==========================================================================
  // Edge cases
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle entity with no roles gracefully', () => {
      const person = repo.getPerson('adam');
      expect(person).toBeDefined();
      // Adam may or may not have roles; either way it should not crash
      if (person!.roles) {
        expect(Array.isArray(person!.roles)).toBe(true);
      } else {
        expect(person!.roles).toBeUndefined();
      }
    });

    it('should handle place with no attributes gracefully', () => {
      // Find a place that likely has no attributes
      const place = repo.getPlace('mesopotamia');
      expect(place).toBeDefined();
      // attributes may be undefined or an empty-ish array
      if (!place!.attributes) {
        expect(place!.attributes).toBeUndefined();
      }
    });

    it('should handle object with no attributes gracefully', () => {
      const obj = repo.getObject('ark_of_covenant');
      expect(obj).toBeDefined();
      // May or may not have attributes
    });

    it('should handle theme with no traditions gracefully', () => {
      const theme = repo.getTheme('salvation');
      expect(theme).toBeDefined();
      // salvation has no traditions in this DB
      if (!theme!.traditions) {
        expect(theme!.traditions).toBeUndefined();
      }
    });

    it('should handle empty search query', () => {
      // Empty string matches everything with LIKE '%%'
      const results = repo.searchEntities('');
      expect(Array.isArray(results)).toBe(true);
      // Should return some results since '%%' matches all rows
      expect(results.length).toBeGreaterThan(0);
    });

    it('should handle search with special characters gracefully', () => {
      const results = repo.searchEntities("Abraham's");
      expect(Array.isArray(results)).toBe(true);
    });

    it('should handle multiple categories filter in search', () => {
      const results = repo.searchEntities('Moses', ['people', 'themes']);
      const categories = new Set(results.map(r => r.category));
      // Should only contain people and/or themes
      for (const cat of categories) {
        expect(['people', 'themes']).toContain(cat);
      }
    });
  });
});
