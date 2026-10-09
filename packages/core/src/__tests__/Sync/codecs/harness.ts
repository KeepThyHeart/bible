/** Test harness for the record codecs: two user DBs, a tracker-backed CodecContext, and a minimal "engine" transfer. */
import { TestSqliteProvider } from '../../helpers/TestSqliteProvider';
import { createUserSchema } from '../../../Data/UserSchema';
import { createChangeTracker, coreTrackedTables, type ChangeTracker } from '../../../Sync/tracking/ChangeTracker';
import type { CodecContext, CodecNote, CodecRegistry, ModuleRefResolver } from '../../../Sync/codecs/RecordCodec';
import type { RecordId } from '../../../Sync/types';

export const US = '\u001f';

export interface Side {
  db: TestSqliteProvider;
  tracker: ChangeTracker;
  ctx: CodecContext;
  notes: CodecNote[];
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Local module install id <-> portable ref. Ids absent from `known` are unknown modules. */
export function moduleResolver(known: Record<number, string>): ModuleRefResolver {
  const rev = new Map(Object.entries(known).map(([id, ref]) => [ref, Number(id)]));
  return {
    toPortable: (id) => known[Number(id)] ?? null,
    toLocal: (ref) => rev.get(ref) ?? null,
  };
}

export function makeSide(rng: () => number, modules: ModuleRefResolver, seedRows?: (db: TestSqliteProvider) => void): Side {
  const db = new TestSqliteProvider(':memory:');
  createUserSchema(db);
  seedRows?.(db);
  const tracker = createChangeTracker(db);
  tracker.install(coreTrackedTables());
  const notes: CodecNote[] = [];
  const hex = (): string => Array.from({ length: 32 }, () => Math.floor(rng() * 16).toString(16)).join('');
  const ctx: CodecContext = {
    sql: db,
    tracker,
    modules,
    recordIdFor(kind, localKey): RecordId {
      const existing = tracker.lookupByLocal(kind, localKey)?.recordId;
      if (existing) return existing;
      const id = hex();
      tracker.assignRecordId(kind, localKey, id);
      return id;
    },
    localKeyFor(recordId) {
      const hit = tracker.lookupByRecordId(recordId);
      return hit && !hit.deleted ? hit.localKey : undefined;
    },
    report: (n) => notes.push(n),
  };
  return { db, tracker, ctx, notes };
}

export interface Wire { kind: string; id: RecordId; d: Record<string, unknown> }

/** Encode every row of every tracked table on `side`. Rows whose codec returns null are counted, not sent. */
export function encodeAll(side: Side, registry: CodecRegistry): { wires: Wire[]; skipped: Array<{ kind: string; localKey: string }> } {
  const wires: Wire[] = [];
  const skipped: Array<{ kind: string; localKey: string }> = [];
  for (const t of coreTrackedTables()) {
    const codec = registry.byKind(t.kind)!;
    const keys = side.db.queryAll<Record<string, unknown>>(`SELECT ${t.pk.map((c) => `"${c}"`).join(', ')} FROM "${t.table}"`)
      .map((r) => t.pk.map((c) => String(r[c])).join(US));
    for (const localKey of keys) {
      const d = codec.encode(localKey, side.ctx);
      if (d === null) { skipped.push({ kind: t.kind, localKey }); continue; }
      wires.push({ kind: t.kind, id: side.ctx.recordIdFor(t.kind, localKey), d });
    }
  }
  return { wires, skipped };
}

/** Apply wires to `side` the way the engine does: decode, park on missing parents, retry until no progress. */
export function applyAll(side: Side, registry: CodecRegistry, wires: Wire[]): { pending: Array<Wire & { missing: string[]; unknownModules?: string[] }> } {
  let queue = [...wires];
  let pending: Array<Wire & { missing: string[]; unknownModules?: string[] }> = [];
  for (let progress = true; progress && queue.length > 0;) {
    progress = false;
    pending = [];
    for (const w of queue) {
      const codec = registry.byKind(w.kind)!;
      const known = side.tracker.lookupByRecordId(w.id);
      const r = codec.decode(w.d, side.ctx);
      if (!r.ok) { pending.push({ ...w, missing: r.missing, unknownModules: r.unknownModules }); continue; }
      const key = side.tracker.applyRemote(() => codec.upsert(r.row, known?.localKey, side.ctx));
      side.tracker.markSynced(w.kind, key, { recordId: w.id, serverSeq: 1, hlc: 'h', baseJson: null, deleted: false });
      progress = true;
    }
    queue = pending;
  }
  return { pending };
}

export function shuffle<T>(xs: T[], rng: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

type Db = TestSqliteProvider;
const ins = (db: Db, table: string, row: Record<string, string | number | null>): number => {
  const cols = Object.keys(row);
  return db.execute(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map((c) => row[c]))
    .lastInsertRowId!;
};

/** Fill `db` with randomised rows in every synced table, with FK relations of every kind. Returns a few ids. */
export function populate(db: Db, rng: () => number): { notes: number[]; unknownModuleMarkup: number } {
  const int = (n: number): number => Math.floor(rng() * n);
  const pick = <T,>(xs: T[]): T => xs[int(xs.length)];
  const word = (): string => Math.floor(rng() * 1e9).toString(36) + (rng() < 0.2 ? ' — é中' : '');
  const range = (): [number, number] => { const s = 1001001 + int(30000); return [s, s + int(5)]; };

  const comms = [ins(db, 'user_commentary', { name: 'Default ' + word(), is_default: 1, color: '#fff' })];
  for (let i = int(3); i > 0; i--) comms.push(ins(db, 'user_commentary', { name: word(), description: word() }));

  const notes: number[] = [];
  for (let i = 3 + int(8); i > 0; i--) {
    const [s, e] = range();
    notes.push(ins(db, 'user_note', {
      user_commentary_id: rng() < 0.6 ? pick(comms) : null,
      parent_note_id: notes.length > 0 && rng() < 0.4 ? pick(notes) : null,
      verse_id_start: s, verse_id_end: e, title: word(), content: '<p>' + word() + '</p>', note_type: pick(['verse_note', 'study', 'document']),
      tags: rng() < 0.5 ? word() : null, sort_order: int(100), metadata: rng() < 0.3 ? '{"a":1}' : null,
    }));
  }
  const journals = [ins(db, 'journal_entry', { title: word(), content: word(), entry_date: '2026-01-01' })];
  const prayers: number[] = [];
  for (let i = 1 + int(3); i > 0; i--) {
    const p = ins(db, 'prayer_item', { title: word(), priority: int(6), status: pick(['active', 'answered']) });
    prayers.push(p);
    for (let j = int(3); j > 0; j--) ins(db, 'prayer_update', { prayer_id: p, update_text: word() });
  }
  const items: number[] = [];
  for (let i = 1 + int(4); i > 0; i--) items.push(ins(db, 'user_data_item', { owner_uuid: 'owner-' + int(3), collection: 'c' + int(3), item_key: 'k' + i + word(), value: word() }));

  const colls: number[] = [];
  for (let i = 1 + int(4); i > 0; i--) {
    colls.push(ins(db, 'collection', { parent_collection_id: colls.length > 0 && rng() < 0.5 ? pick(colls) : null, name: word(), sort_order: int(10) }));
  }
  for (let i = 2 + int(6); i > 0; i--) {
    const [s, e] = range();
    const type = pick(['verse', 'note', 'commentary', 'passage']);
    ins(db, 'pinned_item', {
      collection_id: pick(colls), item_type: type, verse_id_start: s, verse_id_end: e,
      reference_id: type === 'note' ? pick(notes) : type === 'commentary' ? 700 + int(50) : null,
      module_id: rng() < 0.5 ? pick([1, 2]) : null, title: word(), sort_order: int(10),
    });
  }
  for (const n of notes) {
    for (let i = int(3); i > 0; i--) { const [s, e] = range(); ins(db, 'note_verse_link', { note_id: n, verse_id_start: s, verse_id_end: e, link_type: pick(['reference', 'annotation']), word_start: rng() < 0.5 ? int(9) : null }); }
    if (rng() < 0.5) { const [s, e] = range(); ins(db, 'content_verse_link', { content_type: 'note', content_id: n, verse_id_start: s, verse_id_end: e, position: int(5) }); }
  }
  for (let i = 1 + int(5); i > 0; i--) {
    const [s, e] = range();
    ins(db, 'user_text_markup', { module_id: pick([1, 2]), verse_id_start: s, verse_id_end: e, color: '#ffee00', note_id: rng() < 0.4 ? pick(notes) : null });
  }
  const [us, ue] = range();
  const unknownModuleMarkup = ins(db, 'user_text_markup', { module_id: 99, verse_id_start: us, verse_id_end: ue, color: '#00ff00' });
  for (let i = int(3); i > 0; i--) { const [a, b] = range(); const [c, d] = range(); ins(db, 'user_cross_reference', { from_verse_id_start: a, from_verse_id_end: b, to_verse_id_start: c, to_verse_id_end: d, notes: word() }); }

  // verse_link: both ends of the polymorphism
  const srcs: Array<[string, number[]]> = [['note', notes], ['document', notes], ['journal', journals], ['prayer', prayers], ['user_data_item', items]];
  for (const [type, ids] of srcs) {
    for (let i = 1 + int(2); i > 0; i--) { const [s, e] = range(); ins(db, 'verse_link', { source_type: type, source_id: pick(ids), verse_id_start: s, verse_id_end: e, context: word(), sort_order: int(5) }); }
  }
  const [bs, be] = range();
  ins(db, 'verse_link', { source_type: 'bookmark', source_id: 5, verse_id_start: bs, verse_id_end: be }); // unsupported type: never syncs
  ins(db, 'verse_link', { source_type: 'note', source_id: 987654, verse_id_start: bs, verse_id_end: be }); // dangling parent: never syncs

  // reading plans
  const plans: number[] = [];
  for (let i = 1 + int(2); i > 0; i--) {
    const plan = ins(db, 'reading_plan', { name: word(), plan_type: 'custom', duration_days: 5, is_builtin: 0 });
    plans.push(plan);
    for (let day = 1; day <= 1 + int(4); day++) {
      const dayId = ins(db, 'reading_plan_day', { plan_id: plan, day_number: day });
      for (let k = 1 + int(2); k > 0; k--) { const [s, e] = range(); ins(db, 'reading_plan_passage', { day_id: dayId, session_name: rng() < 0.5 ? 'am' : null, verse_id_start: s, verse_id_end: e, sort_order: k }); }
    }
  }
  plans.forEach((p, i) => ins(db, 'user_reading_progress', { plan_id: p, start_date: '2026-02-0' + (i + 1), current_day: 2, completed_days: '[1]', status: 'active' }));

  // memory
  const mc = ins(db, 'memory_collection', { name: word(), created_at: 1000 });
  for (let i = 1 + int(3); i > 0; i--) {
    const [s, e] = range();
    const passage = ins(db, 'memory_passage', { collection_id: mc, module_id: pick(['KJV', 'ESV']), start_verse_id: s + i * 100000, end_verse_id: e + i * 100000, reference: word(), verse_count: 1, added_at: 5, recite_on: int(2) });
    for (const rung of ['a', 'b']) {
      const card = ins(db, 'memory_card', { passage_id: passage, rung, state: 'learning', interval_step: int(4), due_at: int(1e6), last_score: rng() });
      let lastAttempt = 0;
      for (let k = int(3); k > 0; k--) lastAttempt = ins(db, 'memory_attempt', { card_id: card, at: 10 + k, score: rng(), correct_first: 1, total_steps: 3 });
      if (lastAttempt && rng() < 0.7) ins(db, 'memory_recite_detail', { attempt_id: lastAttempt, card_id: card, at: 11, verdicts: 'ccx', credits: '[1,1,0]', verse_scores: '[0.5]', extras: 0, strictness: 'normal', engine_id: null });
      if (rng() < 0.6) ins(db, 'memory_resume_state', { card_id: card, cursor: 2, correct_first: 1, graded_units: 2, updated_at: 99 });
    }
  }
  // guarantee every memory table is populated whatever the dice said
  if (db.queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM memory_recite_detail')!.n === 0) {
    const att = db.queryOne<{ id: number; card_id: number }>('SELECT id, card_id FROM memory_attempt LIMIT 1');
    if (att) ins(db, 'memory_recite_detail', { attempt_id: att.id, card_id: att.card_id, at: 11, verdicts: 'c', credits: '[1]', verse_scores: '[1]', extras: 0, strictness: 'normal' });
    else {
      const card = db.queryOne<{ id: number }>('SELECT id FROM memory_card LIMIT 1')!.id;
      const a = ins(db, 'memory_attempt', { card_id: card, at: 1, score: 1, correct_first: 1, total_steps: 1 });
      ins(db, 'memory_recite_detail', { attempt_id: a, card_id: card, at: 11, verdicts: 'c', credits: '[1]', verse_scores: '[1]', extras: 0, strictness: 'normal' });
    }
  }
  if (db.queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM memory_resume_state')!.n === 0) {
    const card = db.queryOne<{ id: number }>('SELECT id FROM memory_card LIMIT 1')!.id;
    ins(db, 'memory_resume_state', { card_id: card, cursor: 1, correct_first: 1, graded_units: 1, updated_at: 5 });
  }
  if (db.queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM content_verse_link')!.n === 0) {
    ins(db, 'content_verse_link', { content_type: 'note', content_id: notes[0], verse_id_start: 1001001, verse_id_end: 1001001 });
  }
  ins(db, 'memory_setting', { key: 'answerMode', value: word() });
  ins(db, 'memory_setting', { key: 'sort', value: 'due' });
  for (let i = 1 + int(3); i > 0; i--) ins(db, 'extension_storage', { extension_id: 'ext.' + int(2), key: 'k' + i + (rng() < 0.3 ? US + 'sub' : ''), value: '{"n":' + int(9) + '}', updated_at: int(1e9) });
  return { notes, unknownModuleMarkup };
}
