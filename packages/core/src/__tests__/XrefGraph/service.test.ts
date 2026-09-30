import { describe, it, expect } from 'vitest';
import { XrefGraphService } from '../../Services/XrefGraph/XrefGraphService';
import { XrefGraphIndexBuilder } from '../../Services/XrefGraph/XrefGraphIndexBuilder';
import { CrossReferenceRepository } from '../../Data/Repositories/CrossReferenceRepository';
import { TestSqliteProvider } from '../helpers/TestSqliteProvider';
import { unpackPairs, CHAPTER_COUNT, chapterIndex } from '../../Services/XrefGraph';
import { UserCrossReference } from '../../Data/Models/User/UserCrossReference';
import type { IUserCrossReferenceRepository } from '../../Data/Repositories/IUserCrossReferenceRepository';

const JOHN_3_16 = 43003016;
const ROM_5_8 = 45005008;
const ROM_8_32 = 45008032;
const GEN_1_1 = 1001001;
const PS_33_6 = 19033006;
const PS_33_9 = 19033009;
const JOHN_1_1 = 43001001;

/** A module with two phrase groups plus a group anchored to Rom 5:8 that points back at John 3:16. */
function makeRepo(abbr = 'TSK'): { repo: CrossReferenceRepository; close: () => void } {
  const provider = new TestSqliteProvider(':memory:');
  provider.exec(`
    CREATE TABLE module_info (info_id INTEGER PRIMARY KEY, abbreviation TEXT, full_name TEXT, version TEXT);
    INSERT INTO module_info VALUES (1, '${abbr}', 'Test', '1');
    CREATE TABLE cross_reference_group (group_id INTEGER PRIMARY KEY, verse_id_start INTEGER, verse_id_end INTEGER, phrase TEXT, sort_order INTEGER, metadata TEXT);
    CREATE TABLE verse_link (link_id INTEGER PRIMARY KEY AUTOINCREMENT, source_type TEXT, source_id INTEGER, verse_id_start INTEGER, verse_id_end INTEGER, link_type TEXT DEFAULT 'cross_reference', sort_order INTEGER DEFAULT 0, context TEXT, metadata TEXT);
    INSERT INTO cross_reference_group VALUES (1, ${JOHN_3_16}, ${JOHN_3_16}, 'God so loved', 0, NULL);
    INSERT INTO cross_reference_group VALUES (2, ${ROM_5_8}, ${ROM_5_8}, NULL, 0, NULL);
    INSERT INTO cross_reference_group VALUES (3, ${GEN_1_1}, ${GEN_1_1}, NULL, 0, NULL);
    INSERT INTO verse_link (source_type, source_id, verse_id_start, verse_id_end, sort_order) VALUES
      ('cross_reference_group', 1, ${ROM_5_8}, ${ROM_5_8}, 0),
      ('cross_reference_group', 1, ${ROM_8_32}, ${ROM_8_32}, 1),
      ('cross_reference_group', 2, ${JOHN_3_16}, ${JOHN_3_16}, 0),
      ('cross_reference_group', 3, ${PS_33_6}, ${PS_33_9}, 0),
      ('cross_reference_group', 3, ${JOHN_1_1}, ${JOHN_1_1}, 1);
  `);
  // verse_id_end is always populated in real modules (single verse: end = start).
  return { repo: new CrossReferenceRepository(provider), close: () => provider.close() };
}

describe('CrossReferenceRepository link scan', () => {
  it('counts and streams every link with its rank in the group', () => {
    const { repo, close } = makeRepo();
    expect(repo.getLinkCount()).toBe(5);
    const seen: Array<[number, number, number, number]> = [];
    repo.forEachLink(l => seen.push([l.sourceVerseIdStart, l.targetVerseIdStart, l.targetVerseIdEnd, l.rank]));
    expect(seen).toEqual([
      [JOHN_3_16, ROM_5_8, ROM_5_8, 0],
      [JOHN_3_16, ROM_8_32, ROM_8_32, 1],
      [ROM_5_8, JOHN_3_16, JOHN_3_16, 0],
      [GEN_1_1, PS_33_6, PS_33_9, 0],
      [GEN_1_1, JOHN_1_1, JOHN_1_1, 1],
    ]);
    close();
  });
  it('handles an empty module', () => {
    const provider = new TestSqliteProvider(':memory:');
    provider.exec(`CREATE TABLE cross_reference_group (group_id INTEGER PRIMARY KEY, verse_id_start INTEGER, verse_id_end INTEGER, phrase TEXT, sort_order INTEGER, metadata TEXT);
      CREATE TABLE verse_link (link_id INTEGER PRIMARY KEY, source_type TEXT, source_id INTEGER, verse_id_start INTEGER, verse_id_end INTEGER, link_type TEXT, sort_order INTEGER, context TEXT, metadata TEXT);`);
    const repo = new CrossReferenceRepository(provider);
    expect(repo.getLinkCount()).toBe(0);
    let n = 0;
    repo.forEachLink(() => n++);
    expect(n).toBe(0);
  });
});

describe('XrefGraphService', () => {
  it('merges outgoing and incoming links and marks reciprocal ones', () => {
    const { repo, close } = makeRepo();
    const svc = new XrefGraphService([{ abbreviation: 'TSK', moduleName: 'TSK', repository: repo }]);
    const n = svc.getNeighbours(JOHN_3_16);
    const rom58 = n.find(e => e.to === ROM_5_8)!;
    expect(rom58.direction).toBe('both');
    expect(rom58.weight).toBe(1);
    expect(rom58.phrase).toBe('God so loved');
    const rom832 = n.find(e => e.to === ROM_8_32)!;
    expect(rom832.direction).toBe('out');
    expect(rom832.weight).toBeLessThan(1);
    expect(n[0].to).toBe(ROM_5_8);
    close();
  });
  it('reports incoming-only links and range targets', () => {
    const { repo, close } = makeRepo();
    const svc = new XrefGraphService([{ abbreviation: 'TSK', moduleName: 'TSK', repository: repo }]);
    const fromRomans = svc.getNeighbours(ROM_8_32);
    expect(fromRomans.map(e => [e.to, e.direction])).toEqual([[JOHN_3_16, 'in']]);
    const gen = svc.getNeighbours(GEN_1_1);
    expect(gen.find(e => e.to === PS_33_6)!.toEnd).toBe(PS_33_9);
    // a verse inside a target range sees the citing verse
    expect(svc.getNeighbours(19033007).map(e => e.to)).toEqual([GEN_1_1]);
    close();
  });
  it('never links a verse to itself and honours limit and source filters', () => {
    const { repo, close } = makeRepo();
    const svc = new XrefGraphService([{ abbreviation: 'TSK', moduleName: 'TSK', repository: repo }]);
    expect(svc.getNeighbours(JOHN_3_16).some(e => e.to === JOHN_3_16)).toBe(false);
    expect(svc.getNeighbours(JOHN_3_16, 1).length).toBe(1);
    expect(svc.getNeighbours(JOHN_3_16, undefined, { sources: ['nope'] })).toEqual([]);
    close();
  });
  it('adds the user layer and lets it be switched off', () => {
    const { repo, close } = makeRepo();
    const user = {
      getFromVerse: (v: number) => v === JOHN_3_16 ? [new UserCrossReference({ fromVerseIdStart: JOHN_3_16, toVerseIdStart: PS_33_6, toVerseIdEnd: PS_33_9 })] : [],
      getToVerse: () => [],
    } as unknown as IUserCrossReferenceRepository;
    const svc = new XrefGraphService([{ abbreviation: 'TSK', moduleName: 'TSK', repository: repo }], user);
    const mine = svc.getNeighbours(JOHN_3_16).find(e => e.to === PS_33_6)!;
    expect(mine.sources).toEqual(['user']);
    expect(mine.weight).toBe(1);
    expect(svc.getNeighbours(JOHN_3_16, undefined, { includeUser: false }).some(e => e.to === PS_33_6)).toBe(false);
    close();
  });
  it('builds an ego graph', () => {
    const { repo, close } = makeRepo();
    const svc = new XrefGraphService([{ abbreviation: 'TSK', moduleName: 'TSK', repository: repo }]);
    const g = svc.getEgoGraph(JOHN_3_16, { depth: 2 });
    expect(g.nodes.map(n => n.verseId).sort()).toEqual([JOHN_3_16, ROM_5_8, ROM_8_32].sort());
    expect(g.edges.length).toBe(2);
    close();
  });
});

describe('XrefGraphIndexBuilder', () => {
  it('aggregates chapter pairs, the book matrix and degrees', () => {
    const { repo, close } = makeRepo();
    const mods = [{ abbreviation: 'TSK', moduleName: 'TSK', repository: repo }];
    const idx = new XrefGraphIndexBuilder().build(mods);
    expect(idx.linkCount).toBe(5);
    const pairs = unpackPairs(idx.arcs.pairs);
    const johnRom = pairs.find(p => p.a === chapterIndex(JOHN_3_16) && p.b === chapterIndex(ROM_5_8))!;
    expect(johnRom.count).toBe(2); // John 3:16 -> Rom 5:8 and Rom 5:8 -> John 3:16 fold into one undirected pair
    expect(johnRom.weight).toBe(2000);
    expect(pairs.every(p => p.a < p.b)).toBe(true);
    expect(idx.arcs.chapterTotals.length).toBe(CHAPTER_COUNT);
    expect(idx.books[42][44]).toBeGreaterThan(0);
    expect(idx.books[44][42]).toBe(idx.books[42][44]);
    const i = Array.from(idx.degrees.verseIds).indexOf(JOHN_3_16);
    expect(idx.degrees.out[i]).toBe(2);
    expect(idx.degrees.in[i]).toBe(1);
    close();
  });
  it('changes its fingerprint when the content changes', () => {
    const a = makeRepo();
    const b = makeRepo('OTHER');
    const builder = new XrefGraphIndexBuilder();
    const fa = builder.fingerprint([{ abbreviation: 'TSK', moduleName: 'TSK', repository: a.repo }]);
    const fb = builder.fingerprint([{ abbreviation: 'OTHER', moduleName: 'x', repository: b.repo }]);
    expect(fa).not.toBe(fb);
    expect(builder.fingerprint([{ abbreviation: 'TSK', moduleName: 'TSK', repository: a.repo }])).toBe(fa);
    a.close(); b.close();
  });
});
