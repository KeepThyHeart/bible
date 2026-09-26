/**
 * Property tests for restore and merge over random data graphs.
 *
 * The generator uses tiny alphabets on purpose so that identical rows, and rows
 * that differ only in a foreign key, occur constantly: that is where a merge that
 * matches rows by content can go wrong.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { ISql } from '../../Data/Core/ISql';
import { inspectBackup, applyRestore, defaultSections, checkRegistryIntegrity } from '../../Backup/Restore';
import type { RestoreMode } from '../../Backup/Restore';
import { tableSpec } from '../../Backup/Registry';
import { newUserDb, archiveOf, snapshot, canon } from './restoreHelpers';

interface Graph {
  commentaries: Array<{ name: string }>;
  defaultCommentary: number | null;
  notes: Array<{ title: string; commentary: number | null; parent: number | null; sort: number }>;
  collections: Array<{ name: string; parent: number | null }>;
  pins: Array<{ collection: number; kind: 'verse' | 'note'; note: number | null; verse: number }>;
  markups: Array<{ note: number | null; color: string; verse: number }>;
  journals: Array<{ title: string }>;
  prayers: Array<{ title: string }>;
  links: Array<{ type: 'note' | 'journal' | 'prayer' | 'document'; source: number; verse: number }>;
  searches: Array<{ query: string }>;
  kv: Array<{ ext: string; key: string; value: string; at: number }>;
  sessions: Array<{ name: string; auto: boolean }>;
  navs: Array<{ session: number; tab: string }>;
}

const graphArb: fc.Arbitrary<Graph> = fc.record({
  nCommentaries: fc.integer({ min: 0, max: 3 }),
  nNotes: fc.integer({ min: 0, max: 8 }),
  nCollections: fc.integer({ min: 0, max: 4 }),
  nJournals: fc.integer({ min: 0, max: 3 }),
  nPrayers: fc.integer({ min: 0, max: 3 }),
  nSessions: fc.integer({ min: 0, max: 3 }),
  seed: fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 80, maxLength: 80 }),
}).chain(({ nCommentaries, nNotes, nCollections, nJournals, nPrayers, nSessions, seed }) => {
  let i = 0;
  const r = (n: number) => seed[i++ % seed.length] % Math.max(1, n);
  const opt = (n: number) => (n > 0 && r(3) > 0 ? r(n) : null);
  const g: Graph = {
    commentaries: Array.from({ length: nCommentaries }, () => ({ name: ['x', 'y'][r(2)] })),
    defaultCommentary: nCommentaries > 0 && r(2) === 0 ? r(nCommentaries) : null,
    notes: Array.from({ length: nNotes }, (_, k) => ({ title: ['t1', 't2'][r(2)], commentary: opt(nCommentaries), parent: k > 0 && r(2) === 0 ? r(k) : null, sort: r(2) })),
    collections: Array.from({ length: nCollections }, (_, k) => ({ name: ['c1', 'c2'][r(2)], parent: k > 0 && r(2) === 0 ? r(k) : null })),
    pins: nCollections === 0 ? [] : Array.from({ length: r(5) }, () => {
      const kind = nNotes > 0 && r(2) === 0 ? 'note' as const : 'verse' as const;
      return { collection: r(nCollections), kind, note: kind === 'note' ? r(nNotes) : null, verse: r(2) };
    }),
    markups: Array.from({ length: r(5) }, () => ({ note: opt(nNotes), color: ['#111', '#222'][r(2)], verse: r(2) })),
    journals: Array.from({ length: nJournals }, () => ({ title: ['j1', 'j2'][r(2)] })),
    prayers: Array.from({ length: nPrayers }, () => ({ title: ['p1', 'p2'][r(2)] })),
    links: Array.from({ length: r(8) }, () => {
      const type = (['note', 'document', 'journal', 'prayer'] as const)[r(4)];
      const max = type === 'journal' ? nJournals : type === 'prayer' ? nPrayers : nNotes;
      return max === 0 ? null : { type, source: r(max), verse: r(2) };
    }).filter((x): x is NonNullable<typeof x> => x !== null),
    searches: Array.from({ length: r(4) }, () => ({ query: ['q1', 'q2'][r(2)] })),
    kv: Array.from({ length: r(5) }, () => ({ ext: ['ext.a', 'ext.b'][r(2)], key: ['k1', 'k2', 'k3'][r(3)], value: ['v1', 'v2'][r(2)], at: r(3) })),
    sessions: Array.from({ length: nSessions }, () => ({ name: ['s1', 's2'][r(2)], auto: r(3) === 0 })),
    navs: nSessions === 0 ? [] : Array.from({ length: r(4) }, () => ({ session: r(nSessions), tab: ['t1', 't2'][r(2)] })),
  };
  return fc.constant(g);
});

/** Insert a graph. Rows are created parents first, so ids are 1..n in creation order. */
function build(db: ReturnType<typeof newUserDb>, g: Graph, idShift = 0): void {
  const x = (sql: string, p: unknown[] = []) => db.execute(sql, p as never[]);
  for (let k = 0; k < idShift; k++) { x("INSERT INTO user_note (title, content) VALUES ('shift', 's')"); x("INSERT INTO collection (name) VALUES ('shift')"); }
  const base = { note: idShift, coll: idShift };
  const cBase = db.queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM user_commentary')!.n;
  g.commentaries.forEach((c, k) => x('INSERT INTO user_commentary (name, is_default) VALUES (?, ?)', [c.name, g.defaultCommentary === k ? 1 : 0]));
  g.notes.forEach((n) => x(
    'INSERT INTO user_note (title, content, user_commentary_id, parent_note_id, sort_order) VALUES (?, ?, ?, ?, ?)',
    [n.title, 'body', n.commentary === null ? null : n.commentary + 1 + cBase, n.parent === null ? null : n.parent + 1 + base.note, n.sort]
  ));
  g.collections.forEach((c) => x('INSERT INTO collection (name, parent_collection_id) VALUES (?, ?)', [c.name, c.parent === null ? null : c.parent + 1 + base.coll]));
  g.pins.forEach((p) => x('INSERT INTO pinned_item (collection_id, item_type, reference_id, verse_id_start) VALUES (?, ?, ?, ?)',
    [p.collection + 1 + base.coll, p.kind, p.note === null ? null : p.note + 1 + base.note, p.verse]));
  g.markups.forEach((m) => x("INSERT INTO user_text_markup (module_id, verse_id_start, verse_id_end, color, note_id) VALUES (1, ?, ?, ?, ?)", [m.verse, m.verse, m.color, m.note === null ? null : m.note + 1 + base.note]));
  g.journals.forEach((j) => x("INSERT INTO journal_entry (title, content, entry_date) VALUES (?, 'c', '2026-01-01')", [j.title]));
  g.prayers.forEach((p) => x('INSERT INTO prayer_item (title) VALUES (?)', [p.title]));
  const jBase = 0;
  g.links.forEach((l) => x('INSERT INTO verse_link (source_type, source_id, verse_id_start, verse_id_end) VALUES (?, ?, ?, ?)',
    [l.type, l.source + 1 + (l.type === 'journal' || l.type === 'prayer' ? jBase : base.note), l.verse, l.verse]));
  g.searches.forEach((s) => x('INSERT INTO user_search_history (query) VALUES (?)', [s.query]));
  const seen = new Set<string>();
  g.kv.forEach((k) => { const key = `${k.ext}/${k.key}`; if (!seen.has(key)) { seen.add(key); x('INSERT INTO extension_storage VALUES (?, ?, ?, ?)', [k.ext, k.key, k.value, k.at]); } });
  const sBase = db.queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM session')!.n;
  g.sessions.forEach((s) => x("INSERT INTO session (name, session_data, is_autosave) VALUES (?, '{}', ?)", [s.name, s.auto ? 1 : 0]));
  g.navs.forEach((n) => x("INSERT INTO navigation_history (session_id, tab_id, module_id, verse_id_start, verse_id_end) VALUES (?, ?, 1, 1, 1)", [n.session + 1 + sBase, n.tab]));
}

async function run(source: ISql, target: ISql, mode: RestoreMode) {
  const archive = await archiveOf({ sql: source });
  const plan = inspectBackup(archive, { sql: target }, { preview: false });
  const report = await applyRestore(plan, { sql: target }, { mode, sections: defaultSections(plan, 'replace') });
  return { plan, report };
}

const content = (c: Record<string, unknown>) => Object.fromEntries(Object.entries(c).filter(([t]) => ['content', 'extension'].includes(tableSpec(t)!.cls)));
const RUNS = { numRuns: Number(process.env.FC_RUNS ?? 40) };

describe('restore properties (random data graphs)', () => {
  it('replace into an empty database reproduces every table exactly', async () => {
    await fc.assert(fc.asyncProperty(graphArb, async (g) => {
      const a = newUserDb(); build(a, g);
      const b = newUserDb();
      await run(a, b, 'replace');
      expect(snapshot(b)).toEqual(snapshot(a));
      expect(checkRegistryIntegrity(b)).toEqual([]);
    }), RUNS);
  });

  it('replace over a populated database ends up equal to the backup', async () => {
    await fc.assert(fc.asyncProperty(graphArb, graphArb, async (ga, gb) => {
      const a = newUserDb(); build(a, ga);
      const b = newUserDb(); build(b, gb);
      await run(a, b, 'replace');
      // Extension data is replaced per extension: one the backup has nothing for is left alone.
      const { extension_storage: _a, ...want } = snapshot(a);
      const { extension_storage: _b, ...got } = snapshot(b);
      void _a; void _b;
      expect(got).toEqual(want);
      expect(checkRegistryIntegrity(b)).toEqual([]);
      expect(b.queryAll('PRAGMA foreign_key_check')).toEqual([]);
    }), RUNS);
  });

  it('merge into an empty database equals replace, modulo ids', async () => {
    await fc.assert(fc.asyncProperty(graphArb, fc.integer({ min: 0, max: 3 }), async (g, shift) => {
      const a = newUserDb(); build(a, g);
      const viaReplace = newUserDb(); await run(a, viaReplace, 'replace');
      const viaMerge = newUserDb();
      for (let k = 0; k < shift; k++) viaMerge.execute("INSERT INTO extension_storage VALUES ('pad', ?, 'x', 1)", [`k${k}`]); // unrelated local data
      await run(a, viaMerge, 'merge');
      const drop = (c: Record<string, string[]>) => { const o = content(c) as Record<string, string[]>; delete o.extension_storage; return o; };
      expect(drop(canon(viaMerge))).toEqual(drop(canon(viaReplace)));
      expect(checkRegistryIntegrity(viaMerge)).toEqual([]);
      expect(viaMerge.queryAll('PRAGMA foreign_key_check')).toEqual([]);
    }), RUNS);
  });

  it('merging twice is the same as merging once', async () => {
    await fc.assert(fc.asyncProperty(graphArb, graphArb, fc.integer({ min: 0, max: 3 }), async (ga, gb, shift) => {
      const a = newUserDb(); build(a, ga);
      const b = newUserDb(); build(b, gb, shift);
      await run(a, b, 'merge');
      const once = snapshot(b);
      const { report } = await run(a, b, 'merge');
      expect(snapshot(b)).toEqual(once);
      expect(report.perTable.every((t) => t.inserted === 0 && t.updated === 0), JSON.stringify(report.perTable.filter((t) => t.inserted || t.updated))).toBe(true);
    }), RUNS);
  });

  it('merge never changes or removes a row the target already had, and leaves no dangling reference', async () => {
    await fc.assert(fc.asyncProperty(graphArb, graphArb, fc.integer({ min: 0, max: 3 }), async (ga, gb, shift) => {
      const a = newUserDb(); build(a, ga);
      const b = newUserDb(); build(b, gb, shift);
      const before = snapshot(b);
      await run(a, b, 'merge');
      const after = snapshot(b);
      for (const [table, rows] of Object.entries(before)) {
        if (['extension_storage', 'user_data_item', 'command_history'].includes(table)) continue; // newer-wins tables may update
        const spec = tableSpec(table)!;
        for (const row of rows) {
          const now = after[table].find((r) => spec.pk.every((k) => r[k] === row[k]));
          // is_default is the one column merge may not raise, never lower: local values stay as they were.
          expect(now, `${table} row ${JSON.stringify(row)} vanished`).toEqual(row);
        }
      }
      expect(checkRegistryIntegrity(b)).toEqual([]);
      expect(b.queryAll('PRAGMA foreign_key_check')).toEqual([]);
      expect(after.user_commentary.filter((c) => c.is_default === 1).length).toBeLessThanOrEqual(Math.max(1, before.user_commentary.filter((c) => c.is_default === 1).length));
    }), RUNS);
  });

  it('merging a database with a copy of itself changes nothing', async () => {
    await fc.assert(fc.asyncProperty(graphArb, async (g) => {
      const a = newUserDb(); build(a, g);
      const copy = newUserDb(); await run(a, copy, 'replace');
      const before = snapshot(copy);
      const { report } = await run(a, copy, 'merge');
      expect(snapshot(copy)).toEqual(before);
      expect(report.perTable.filter((t) => t.inserted > 0)).toEqual([]);
    }), RUNS);
  });

  it('restore leaves the note search index consistent with the notes', async () => {
    await fc.assert(fc.asyncProperty(graphArb, graphArb, fc.constantFrom<RestoreMode>('replace', 'merge'), async (ga, gb, mode) => {
      const a = newUserDb(); build(a, ga);
      const b = newUserDb(); build(b, gb);
      await run(a, b, mode);
      const notes = b.queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM user_note')!.n;
      const indexed = b.queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM user_note_fts WHERE user_note_fts MATCH 'body'")!.n;
      expect(indexed).toBe(notes);
    }), RUNS);
  });
});
