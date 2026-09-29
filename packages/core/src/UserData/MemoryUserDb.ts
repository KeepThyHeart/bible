/**
 * An in-memory implementation of the generic user store: `user_data_item`
 * (`IUserDataRepository`) and the unified `verse_link` table
 * (`IVerseLinkRepository`).
 *
 * It exists so that platforms with no synchronous SQLite (the web app) can run
 * the very same repository interfaces the desktop app runs over `ISql`. It is
 * pure TypeScript with no storage of its own: a host loads rows into it
 * ({@link MemoryUserDb.load}), listens to what changes ({@link MemoryUserDb.subscribe})
 * and persists the changes wherever it likes (the web app uses IndexedDB).
 *
 * Semantics match the SQLite repositories, and the shared contract suite in
 * `src/__tests__/contracts/userDataContract.ts` runs against both:
 *
 * - `put` keeps `itemId` and `createdDate` when the key already exists, so
 *   `verse_link` anchors survive an overwrite.
 * - Deleting an item does not delete its verse links (the link table is
 *   polymorphic; there is no cascade).
 * - Timestamps use SQLite's `CURRENT_TIMESTAMP` shape, `YYYY-MM-DD HH:MM:SS`
 *   in UTC, so exported rows are indistinguishable from desktop rows.
 * - A single-verse link is stored with `verse_id_end = verse_id_start`.
 */
import { UserDataItem } from '../Data/Models/User/UserDataItem';
import type { UserDataValueType } from '../Data/Models/User/UserDataItem';
import { VerseLinkRecord } from '../Data/Models/Common/VerseLinkRecord';
import { assertLinkType, assertSourceType, resolveRangeEnd } from '../Data/Core/Types';
import type { LinkType, SourceType, VerseId } from '../Data/Core/Types';
import type { IUserDataRepository } from '../Data/Repositories/IUserDataRepository';
import type { IVerseLinkRepository, VerseLinkFilter } from '../Data/Repositories/IVerseLinkRepository';

/** A `user_data_item` row, in the column names the backup format uses. */
export interface UserDataItemRow {
  item_id: number;
  owner_uuid: string;
  collection: string;
  item_key: string;
  value: string | null;
  value_type: string;
  sort_order: number;
  created_date: string;
  modified_date: string;
  metadata: string | null;
}

/** A `verse_link` row, in the column names the backup format uses. */
export interface VerseLinkRow {
  link_id: number;
  source_type: string;
  source_id: number;
  verse_id_start: number;
  verse_id_end: number;
  link_type: string;
  sort_order: number;
  context: string | null;
  metadata: string | null;
}

/** What changed, in terms a persistence layer can replay. */
export type UserDataChange =
  | { type: 'item:put'; row: UserDataItemRow }
  | { type: 'item:delete'; ownerUuid: string; collection: string; itemKey: string }
  | { type: 'link:put'; row: VerseLinkRow }
  | { type: 'link:delete'; linkId: number };

export type UserDataListener = (change: UserDataChange) => void;

export interface MemoryUserDbOptions {
  /** Injectable clock, for reproducible tests. */
  now?: () => Date;
  /** Id source for new items (default: 1, 2, 3, ...). A host sharing storage between tabs supplies a tab-safe one. */
  nextItemId?: () => number;
  /** Id source for new links. */
  nextLinkId?: () => number;
}

/** SQLite's `CURRENT_TIMESTAMP` format: `YYYY-MM-DD HH:MM:SS`, UTC. */
export function sqliteTimestamp(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

const keyOf = (o: string, c: string, k: string): string => JSON.stringify([o, c, k]);

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Parse a JSON metadata column the way the SQLite repositories do (undefined when empty). */
function parseMeta(v: string | null): Record<string, unknown> | undefined {
  return v == null || v === '' ? undefined : (JSON.parse(v) as Record<string, unknown>);
}

const toMeta = (v: unknown): string | null => (v == null ? null : JSON.stringify(v));

function itemFromRow(r: UserDataItemRow): UserDataItem {
  return new UserDataItem({
    itemId: r.item_id,
    ownerUuid: r.owner_uuid,
    collection: r.collection,
    itemKey: r.item_key,
    value: r.value ?? undefined,
    valueType: r.value_type as UserDataValueType,
    sortOrder: r.sort_order,
    createdDate: r.created_date,
    modifiedDate: r.modified_date,
    metadata: parseMeta(r.metadata),
  });
}

function linkFromRow(r: VerseLinkRow): VerseLinkRecord {
  return new VerseLinkRecord({
    linkId: r.link_id,
    sourceType: r.source_type as SourceType,
    sourceId: r.source_id,
    verseIdStart: r.verse_id_start,
    verseIdEnd: r.verse_id_end ?? undefined,
    linkType: (r.link_type as LinkType) ?? 'reference',
    sortOrder: r.sort_order ?? 0,
    context: r.context ?? undefined,
    metadata: parseMeta(r.metadata),
  });
}

/** Both repositories over one set of in-memory tables. */
export class MemoryUserDb {
  readonly items: IUserDataRepository;
  readonly links: IVerseLinkRepository;

  private readonly itemRows = new Map<string, UserDataItemRow>();
  private readonly linkRows = new Map<number, VerseLinkRow>();
  private readonly listeners = new Set<UserDataListener>();
  private topItem = 0;
  private topLink = 0;
  private readonly now: () => Date;
  private readonly nextItemId: () => number;
  private readonly nextLinkId: () => number;

  constructor(options: MemoryUserDbOptions = {}) {
    this.now = options.now ?? (() => new Date());
    // Default ids continue from the highest id held, so load()/applyRemote() can never lead to a reused id.
    this.nextItemId = options.nextItemId ?? (() => ++this.topItem);
    this.nextLinkId = options.nextLinkId ?? (() => ++this.topLink);
    this.items = new MemoryUserDataRepository(this);
    this.links = new MemoryVerseLinkRepository(this);
  }

  /** Be told about every local change. Returns the unsubscribe function. */
  subscribe(listener: UserDataListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // --- host-facing bulk access (no events) ---------------------------------------

  /** Replace everything with rows read from storage. Emits nothing. Advances the default id counters past the loaded ids. */
  load(items: UserDataItemRow[], links: VerseLinkRow[]): void {
    this.itemRows.clear();
    this.linkRows.clear();
    this.topItem = 0;
    this.topLink = 0;
    for (const r of items) this.itemRows.set(keyOf(r.owner_uuid, r.collection, r.item_key), { ...r });
    for (const r of links) this.linkRows.set(r.link_id, { ...r });
    for (const r of items) this.topItem = Math.max(this.topItem, r.item_id);
    for (const r of links) this.topLink = Math.max(this.topLink, r.link_id);
  }

  /** Every row, in primary-key order (what a backup writes). */
  snapshot(): { user_data_item: UserDataItemRow[]; verse_link: VerseLinkRow[] } {
    return {
      user_data_item: [...this.itemRows.values()].map((r) => ({ ...r })).sort((a, b) => a.item_id - b.item_id),
      verse_link: [...this.linkRows.values()].map((r) => ({ ...r })).sort((a, b) => a.link_id - b.link_id),
    };
  }

  /** One item's raw row, or undefined. */
  findItemRow(ownerUuid: string, collection: string, itemKey: string): UserDataItemRow | undefined {
    const r = this.itemRows.get(keyOf(ownerUuid, collection, itemKey));
    return r ? { ...r } : undefined;
  }

  /** Highest item and link ids held (a host uses these to seed an id allocator). */
  maxIds(): { item: number; link: number } {
    let item = 0;
    let link = 0;
    for (const r of this.itemRows.values()) item = Math.max(item, r.item_id);
    for (const r of this.linkRows.keys()) link = Math.max(link, r);
    return { item, link };
  }

  /**
   * Insert or replace one item exactly as given, keeping its dates (an import, unlike `put`, must not restamp).
   * An existing key keeps its id; a new key gets a fresh one. Emits `item:put`.
   */
  putItemRow(row: Omit<UserDataItemRow, 'item_id'>): UserDataItemRow {
    const k = keyOf(row.owner_uuid, row.collection, row.item_key);
    const existing = this.itemRows.get(k);
    const saved: UserDataItemRow = { ...row, item_id: existing ? existing.item_id : this.nextItemId() };
    this.itemRows.set(k, saved);
    this.emit({ type: 'item:put', row: { ...saved } });
    return { ...saved };
  }

  /** Insert one link exactly as given, with a fresh id. Emits `link:put`. */
  putLinkRow(row: Omit<VerseLinkRow, 'link_id'>): VerseLinkRow {
    const saved: VerseLinkRow = { ...row, link_id: this.nextLinkId() };
    this.linkRows.set(saved.link_id, saved);
    this.emit({ type: 'link:put', row: { ...saved } });
    return { ...saved };
  }

  /** Remove every item and link (events are emitted, so it persists). */
  clearAll(): void {
    for (const r of [...this.itemRows.values()]) this.items.remove(r.owner_uuid, r.collection, r.item_key);
    for (const id of [...this.linkRows.keys()]) this.links.delete(id);
  }

  /** Apply a change made elsewhere (another tab). Emits nothing, so it is not persisted twice. */
  applyRemote(change: UserDataChange): void {
    switch (change.type) {
      case 'item:put':
        this.topItem = Math.max(this.topItem, change.row.item_id);
        this.itemRows.set(keyOf(change.row.owner_uuid, change.row.collection, change.row.item_key), { ...change.row });
        break;
      case 'item:delete':
        this.itemRows.delete(keyOf(change.ownerUuid, change.collection, change.itemKey));
        break;
      case 'link:put':
        this.topLink = Math.max(this.topLink, change.row.link_id);
        this.linkRows.set(change.row.link_id, { ...change.row });
        break;
      case 'link:delete':
        this.linkRows.delete(change.linkId);
        break;
    }
  }

  // --- used by the repositories -------------------------------------------------------

  /** @internal */ emit(change: UserDataChange): void {
    for (const l of [...this.listeners]) l(change);
  }
  /** @internal */ itemMap(): Map<string, UserDataItemRow> {
    return this.itemRows;
  }
  /** @internal */ linkMap(): Map<number, VerseLinkRow> {
    return this.linkRows;
  }
  /** @internal */ stamp(): string {
    return sqliteTimestamp(this.now());
  }
  /** @internal */ newItemId(): number {
    return this.nextItemId();
  }
  /** @internal */ newLinkId(): number {
    return this.nextLinkId();
  }
}

class MemoryUserDataRepository implements IUserDataRepository {
  constructor(private readonly db: MemoryUserDb) {}

  get(ownerUuid: string, collection: string, itemKey: string): UserDataItem | undefined {
    const r = this.db.itemMap().get(keyOf(ownerUuid, collection, itemKey));
    return r ? itemFromRow(r) : undefined;
  }

  list(ownerUuid: string, collection: string): UserDataItem[] {
    return [...this.db.itemMap().values()]
      .filter((r) => r.owner_uuid === ownerUuid && r.collection === collection)
      .sort((a, b) => a.sort_order - b.sort_order || cmp(a.item_key, b.item_key))
      .map(itemFromRow);
  }

  collections(ownerUuid: string): string[] {
    const set = new Set<string>();
    for (const r of this.db.itemMap().values()) if (r.owner_uuid === ownerUuid) set.add(r.collection);
    return [...set].sort(cmp);
  }

  put(item: UserDataItem): UserDataItem {
    const map = this.db.itemMap();
    const k = keyOf(item.ownerUuid, item.collection, item.itemKey);
    const existing = map.get(k);
    const stamp = this.db.stamp();
    const row: UserDataItemRow = {
      item_id: existing ? existing.item_id : this.db.newItemId(),
      owner_uuid: item.ownerUuid,
      collection: item.collection,
      item_key: item.itemKey,
      value: item.value ?? null,
      value_type: item.valueType,
      sort_order: item.sortOrder,
      created_date: existing ? existing.created_date : stamp,
      modified_date: stamp,
      metadata: toMeta(item.metadata),
    };
    map.set(k, row);
    item.itemId = row.item_id;
    item.createdDate = row.created_date;
    item.modifiedDate = row.modified_date;
    this.db.emit({ type: 'item:put', row: { ...row } });
    return item;
  }

  putAll(items: UserDataItem[]): void {
    for (const item of items) this.put(item);
  }

  remove(ownerUuid: string, collection: string, itemKey: string): boolean {
    const removed = this.db.itemMap().delete(keyOf(ownerUuid, collection, itemKey));
    if (removed) this.db.emit({ type: 'item:delete', ownerUuid, collection, itemKey });
    return removed;
  }

  clearCollection(ownerUuid: string, collection: string): number {
    const doomed = [...this.db.itemMap().values()].filter((r) => r.owner_uuid === ownerUuid && r.collection === collection);
    for (const r of doomed) this.remove(r.owner_uuid, r.collection, r.item_key);
    return doomed.length;
  }

  clearOwner(ownerUuid: string): number {
    const doomed = [...this.db.itemMap().values()].filter((r) => r.owner_uuid === ownerUuid);
    for (const r of doomed) this.remove(r.owner_uuid, r.collection, r.item_key);
    return doomed.length;
  }

  owners(): string[] {
    return [...new Set([...this.db.itemMap().values()].map((r) => r.owner_uuid))].sort(cmp);
  }
}

class MemoryVerseLinkRepository implements IVerseLinkRepository {
  constructor(private readonly db: MemoryUserDb) {}

  private all(): VerseLinkRow[] {
    return [...this.db.linkMap().values()];
  }

  hasLinksFor(sourceType: SourceType): boolean {
    return this.all().some((r) => r.source_type === sourceType);
  }

  getForSource(sourceType: SourceType, sourceId: number): VerseLinkRecord[] {
    return this.all()
      .filter((r) => r.source_type === sourceType && r.source_id === sourceId)
      .sort((a, b) => a.sort_order - b.sort_order || a.verse_id_start - b.verse_id_start || a.link_id - b.link_id)
      .map(linkFromRow);
  }

  getForSources(sourceType: SourceType, sourceIds: number[]): Map<number, VerseLinkRecord[]> {
    const result = new Map<number, VerseLinkRecord[]>();
    const wanted = new Set(sourceIds);
    const rows = this.all()
      .filter((r) => r.source_type === sourceType && wanted.has(r.source_id))
      .sort((a, b) => a.source_id - b.source_id || a.sort_order - b.sort_order || a.verse_id_start - b.verse_id_start || a.link_id - b.link_id);
    for (const r of rows) {
      const bucket = result.get(r.source_id);
      if (bucket) bucket.push(linkFromRow(r));
      else result.set(r.source_id, [linkFromRow(r)]);
    }
    return result;
  }

  getForVerse(verseId: VerseId, filter?: VerseLinkFilter): VerseLinkRecord[] {
    return this.getForVerseRange(verseId, verseId, filter);
  }

  getForVerseRange(startVerseId: VerseId, endVerseId: VerseId, filter?: VerseLinkFilter): VerseLinkRecord[] {
    let rows = this.all().filter((r) => r.verse_id_start <= endVerseId && resolveRangeEnd(r.verse_id_start, r.verse_id_end) >= startVerseId);
    if (filter?.sourceType !== undefined) rows = rows.filter((r) => r.source_type === filter.sourceType);
    if (filter?.linkType !== undefined) rows = rows.filter((r) => r.link_type === filter.linkType);
    rows.sort((a, b) => a.verse_id_start - b.verse_id_start || a.sort_order - b.sort_order || a.link_id - b.link_id);
    if (filter?.limit !== undefined) rows = rows.slice(0, Math.max(0, Math.trunc(filter.limit)));
    return rows.map(linkFromRow);
  }

  getSourceIdsForVerse(sourceType: SourceType, verseId: VerseId): number[] {
    const ids = new Set<number>();
    for (const r of this.all()) {
      if (r.source_type === sourceType && r.verse_id_start <= verseId && resolveRangeEnd(r.verse_id_start, r.verse_id_end) >= verseId) {
        ids.add(r.source_id);
      }
    }
    return [...ids].sort((a, b) => a - b);
  }

  create(link: VerseLinkRecord): VerseLinkRecord {
    const sourceType = assertSourceType(link.sourceType);
    const linkType = assertLinkType(link.linkType);
    const row: VerseLinkRow = {
      link_id: this.db.newLinkId(),
      source_type: sourceType,
      source_id: link.sourceId,
      verse_id_start: link.verseIdStart,
      verse_id_end: resolveRangeEnd(link.verseIdStart, link.verseIdEnd),
      link_type: linkType,
      sort_order: link.sortOrder,
      context: link.context ?? null,
      metadata: toMeta(link.metadata),
    };
    this.db.linkMap().set(row.link_id, row);
    this.db.emit({ type: 'link:put', row: { ...row } });
    link.linkId = row.link_id;
    return link;
  }

  createMany(links: VerseLinkRecord[]): void {
    // Validate everything first so a bad row leaves nothing behind, like the SQLite transaction does.
    for (const l of links) {
      assertSourceType(l.sourceType);
      assertLinkType(l.linkType);
    }
    for (const l of links) this.create(l);
  }

  deleteForSource(sourceType: SourceType, sourceId: number): number {
    assertSourceType(sourceType);
    const doomed = this.all().filter((r) => r.source_type === sourceType && r.source_id === sourceId);
    for (const r of doomed) this.delete(r.link_id);
    return doomed.length;
  }

  delete(linkId: number): boolean {
    const removed = this.db.linkMap().delete(linkId);
    if (removed) this.db.emit({ type: 'link:delete', linkId });
    return removed;
  }
}
