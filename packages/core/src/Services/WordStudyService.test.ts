import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'node:path';
import { TestSqliteProvider } from '../__tests__/helpers/TestSqliteProvider';
import { loadSchemaSql } from '../Data/Schema';
import { BibleRepository } from '../Data/Repositories/BibleRepository';
import { WordStudyService } from './WordStudyService';
import { WordGroupStore, WORD_GROUP_OWNER } from './WordGroupStore';
import { DictionaryEntry } from '../Data/Models/Dictionary/DictionaryEntry';
import { UserDataItem } from '../Data/Models/User/UserDataItem';
import type { IDictionaryRepository } from '../Data/Repositories/IDictionaryRepository';
import type { IUserDataRepository } from '../Data/Repositories/IUserDataRepository';
import { WordFamilyService } from './WordFamilyService';

const SCHEMA = join(__dirname, '..', '..', 'sql', 'schemas', 'initial', 'BibleTranslation.sql');

const VERSES: Array<[number, string]> = [
  [43003016, 'For God so loved the world, that he gave his only begotten Son.'],
  [43014015, 'If ye love me, keep my commandments.'],
  [43014021, 'He that loveth me shall be loved of my Father.'],
  [45005008, 'But God commendeth his love toward us.'],
  [19023001, 'The LORD is my shepherd; I shall not want.'],
];
// [verse, start, strongs, gloss, morph]
const TAGS: Array<[number, number, string, string, string]> = [
  [43003016, 3, 'G25', 'loved', 'V-AAI-3S'],
  [43014015, 2, 'G25', 'love', 'V-PAS-2P'],
  [43014021, 2, 'G25', 'loveth', 'V-PAP-NSM'],
  [43014021, 5, 'G25', 'loved', 'V-FPI-3S'],
  [45005008, 4, 'G26', 'love', 'N-ASF'],
  [19023001, 3, 'H07462', 'shepherd', 'Vqr'],
];

function makeBible(abbr: string, lang: string, tagged: boolean): BibleRepository {
  const sql = new TestSqliteProvider(':memory:');
  sql.exec(loadSchemaSql(SCHEMA));
  sql.execute(
    `INSERT INTO module_info (info_id, module_uuid, module_type, abbreviation, full_name, format, format_version,
       language_code, compression, content_sha256) VALUES (1, ?, 'bible', ?, ?, 'bible-module', '0.2', ?, 'none', ?)`,
    [`uuid-${abbr}`, abbr, `${abbr} bible`, lang, 'a'.repeat(64)]
  );
  for (const [id, text] of VERSES) sql.execute('INSERT INTO bible_verse (verse_id, text) VALUES (?, ?)', [id, text]);
  if (tagged) {
    for (const [v, p, s, g, m] of TAGS) {
      sql.execute(
        `INSERT INTO interlinear_word (verse_id, word_position_start, word_position_end, strongs_number, gloss, morphology)
         VALUES (?, ?, ?, ?, ?, ?)`, [v, p, p, s, g, m]);
    }
  }
  return new BibleRepository(sql);
}

function dict(entries: Array<[string, string]>): IDictionaryRepository {
  const list = entries.map(([entryKey, definition], i) => new DictionaryEntry({ entryId: i + 1, entryKey, definition, word: entryKey }));
  return { getEntryByKey: (k: string) => list.find(e => e.entryKey === k), getAllEntries: () => list } as unknown as IDictionaryRepository;
}

const GREEK = dict([
  ['00025', "25 ἀγαπάω ajgapavw agapao {ag-ap-ah'-o} \n perhaps from agan (much); to love:--(be-)love(-ed). Compare 5368. \n "],
  ['00026', "26 ἀγάπη ajgavph agape {ag-ah'-pay} \n from 25; love:--charity, love.  see GREEK for 25 \n "],
]);

let service: WordStudyService;
const repos: BibleRepository[] = [];

beforeAll(() => {
  const kjv = makeBible('kjv', 'en', true);
  const es = makeBible('rvr', 'es', false);
  repos.push(kjv, es);
  service = new WordStudyService({
    bibles: () => new Map([['kjv', kjv], ['rvr', es]]),
    greek: GREEK, hebrew: null, family: new WordFamilyService(GREEK, null),
  });
});
afterAll(() => { for (const r of repos) (r.getSql() as TestSqliteProvider).close(); });

describe('BibleRepository word study queries', () => {
  const v = ['G25'];
  it('counts, groups by book, glosses, morphology and hits', () => {
    const r = repos[0];
    expect(r.countStrongs(v)).toEqual({ occurrences: 4, verses: 3 });
    expect(r.countStrongsByBook(v)).toEqual({ 43: 4 });
    expect(r.getStrongsGlossCounts(v)[0]).toEqual({ gloss: 'loved', count: 2 });
    expect(r.getStrongsMorphCounts(v).length).toBe(4);
    const hits = r.getStrongsHits(v, { limit: 2, offset: 1 });
    expect(hits.map(h => h.verseId)).toEqual([43014015, 43014021]);
    expect(r.getStrongsHits(v, { range: { startVerseId: 43014000, endVerseId: 43014999 } }).length).toBe(3);
  });
  it('returns nothing without interlinear data', () => {
    expect(repos[1].countStrongs(v)).toEqual({ occurrences: 0, verses: 0 });
    expect(repos[1].getStrongsHits(v)).toEqual([]);
  });
  it('finds padded Hebrew numbers through the variants', () => {
    expect(repos[0].countStrongs(['H7462', 'H07462']).occurrences).toBe(1);
  });
});

describe('WordStudyService', () => {
  it('resolves numbers, Greek script and transliterations', () => {
    expect(service.resolve('g0025')[0]).toMatchObject({ strongs: 'G25', word: 'ἀγαπάω' });
    expect(service.resolve('ἀγαπαω')[0].strongs).toBe('G25');
    expect(service.resolve('agapao')[0].strongs).toBe('G25');
    expect(service.resolve('agap').map(c => c.strongs).sort()).toEqual(['G25', 'G26']);
    expect(service.resolve('zzz')).toEqual([]);
  });

  it('builds a Strong\'s overview', () => {
    const o = service.getOverview({ kind: 'strongs', strongs: 'G25' });
    expect(o.module).toBe('kjv');
    expect(o.modules.map(m => m.module)).toEqual(['kjv']);
    expect(o.totals).toEqual({ occurrences: 4, verses: 3 });
    expect(o.forms[0]).toMatchObject({ label: 'love', count: 4 });
    expect(o.entry?.word).toBe('ἀγαπάω');
    expect(o.family.map(f => f.strongs).sort()).toEqual(['G25', 'G26']);
    expect(o.family.find(f => f.strongs === 'G26')?.occurrences).toBe(1);
    expect(o.semanticRange?.senses.length).toBeGreaterThan(1);
  });

  it('pages and filters Strong\'s occurrences, with verse text', () => {
    const o = service.getOverview({ kind: 'strongs', strongs: 'G25' });
    const all = service.getOccurrences({ kind: 'strongs', strongs: 'G25' }, { module: 'kjv' });
    expect(all.total).toBe(4);
    expect(all.items[0].text).toContain('so loved');
    const one = service.getOccurrences({ kind: 'strongs', strongs: 'G25' }, { module: 'kjv', limit: 1, offset: 3 });
    expect(one.items.length).toBe(1);
    const filtered = service.getOccurrences({ kind: 'strongs', strongs: 'G25' }, { module: 'kjv', form: o.forms[0].key });
    expect(filtered.total).toBe(4);
    expect(service.getOccurrences({ kind: 'strongs', strongs: 'G25' }, { module: 'kjv', book: 45 }).total).toBe(0);
  });

  it('reports untagged / missing data', () => {
    expect(service.getOverview({ kind: 'strongs', strongs: 'G9999' }).notice).toBe('no-occurrences');
  });

  it('studies a word group in any translation\'s own text', () => {
    const group = { id: 'g1', label: 'love', terms: ['love'] };
    const o = service.getOverview({ kind: 'group', group });
    expect(o.stemming).toBe(true);
    expect(o.totals).toEqual({ occurrences: 5, verses: 4 });
    expect(o.forms.map(f => f.label)).toEqual(expect.arrayContaining(['loved', 'love', 'loveth']));
    expect(o.modules.map(m => m.module)).toEqual(['kjv', 'rvr']);
    const page = service.getOccurrences({ kind: 'group', group }, { module: 'kjv', form: 'loved' });
    expect(page.total).toBe(2);
    expect(page.items[0]).toMatchObject({ verseId: 43003016, start: 3, end: 3, form: 'loved' });
    expect(service.getOccurrences({ kind: 'group', group }, { module: 'kjv', book: 45 }).total).toBe(1);
  });

  it('honours variants and exclusions, and runs on a non-English module', () => {
    const o = service.getOverview({ kind: 'group', group: { id: 'g2', label: 'shep', terms: ['shepherd*', 'my father'], exclude: ['x'], stem: false } });
    expect(o.totals.occurrences).toBe(2);
    const none = service.getOverview({ kind: 'group', group: { id: 'g3', label: 'love', terms: ['love'] } }, { module: 'rvr' });
    expect(none.moduleLanguage).toBe('es');
  });
});

describe('WordGroupStore', () => {
  it('saves, lists and removes groups through the user-data store', () => {
    const items = new Map<string, UserDataItem>();
    const repo: IUserDataRepository = {
      get: (o, c, k) => items.get(`${o}/${c}/${k}`),
      list: (o, c) => [...items.values()].filter(i => i.ownerUuid === o && i.collection === c),
      collections: () => [], putAll: () => {}, clearCollection: () => 0, clearOwner: () => 0, owners: () => [],
      put: i => { items.set(`${i.ownerUuid}/${i.collection}/${i.itemKey}`, i); return i; },
      remove: (o, c, k) => items.delete(`${o}/${c}/${k}`),
    };
    const store = new WordGroupStore(repo);
    const g = store.save({ label: 'Love', terms: ['love', ' loved ', 'love'] });
    expect(g.terms).toEqual(['love', 'loved']);
    expect(store.list().map(x => x.label)).toEqual(['Love']);
    expect([...items.values()][0].ownerUuid).toBe(WORD_GROUP_OWNER);
    expect(() => store.save({ label: 'x', terms: [' '] })).toThrow();
    expect(store.remove(g.id)).toBe(true);
    expect(store.list()).toEqual([]);
  });
});
