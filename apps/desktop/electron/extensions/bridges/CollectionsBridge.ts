/**
 * Production `IExtensionCollectionsBridge`, backed by the user database.
 *
 * The store this maps onto already existed: `pinned_item` is ordered
 * (`sort_order`, with an index on `(collection_id, sort_order)`), ranged
 * (`verse_id_start` / `verse_id_end`), module-pinned and labelled, and
 * `'passage'` has always been a legal `item_type`. What was missing was an
 * API. So this bridge is a mapping layer, not a new storage design, and it
 * deliberately owns no SQL of its own - every statement is issued by
 * `CollectionRepository`, which binds every value as a parameter.
 *
 * ## Three mismatches this file exists to absorb
 *
 * **Ids.** The store uses integer primary keys; the extension contract uses
 * opaque strings, because an extension must not be able to guess a neighbour's
 * row by incrementing. They are stringified here rather than hashed - the
 * numbers are not secret, and a reversible mapping keeps the log and the
 * database talking about the same row - but the contract stays "opaque", so
 * nothing outside this file may do arithmetic on one.
 *
 * **Module ids.** `pinned_item.module_id` is an INTEGER foreign key;
 * `PassageEntryDto.moduleId` is a string, matching the module id
 * `bible.getRange({ module })` already accepts. `main.ts` builds that string
 * as `String(m.moduleId)` from the same numeric key, so the conversion here is
 * exactly that, inverted. A module id that is not a number is rejected rather
 * than silently stored as NULL, which would turn "pinned to the KJV" into
 * "whatever is open".
 *
 * **Positions.** The contract promises dense, contiguous, zero-based
 * positions: n entries occupy exactly 0..n-1. `sort_order` does not enforce
 * that on its own, and it matters twice over - `ORDER BY sort_order` with ties
 * resolves however the engine feels like, so a passage the user dragged can
 * reappear somewhere else after a restart; and a sparse position is useless as
 * an argument to `move`, which is the whole point of exposing it. So every
 * mutation renumbers the affected collection through
 * `CollectionRepository.reorderPinnedItems`, which does it in one transaction.
 *
 * ## Only passages
 *
 * `pinned_item` holds notes, commentary, dictionary entries and images as
 * well. This bridge reads and writes `item_type IN ('verse','passage')` and
 * nothing else: an ordered list of passages is what the API is for, and
 * returning a user's dictionary bookmarks through `collections.listPassages`
 * would be both surprising and unrepresentable in `PassageEntryDto`. Both
 * verse types are included on read because the app's own bookmark flow writes
 * `'verse'` for a single verse, and a collection the user built by bookmarking
 * should not look empty to an extension.
 */

import log from 'electron-log';
import { CollectionRepository, Collection, PinnedItem } from '@bible/core';
import type { Extensions } from '@bible/core';

import type { IExtensionCollectionsBridge } from '../api-impl/IExtensionDataBridges';

type LocalizedString = Extensions.LocalizedString;
type PassageCollectionDto = Extensions.PassageCollectionDto;
type PassageEntryDto = Extensions.PassageEntryDto;
type NewCollectionOpts = Extensions.NewCollectionOpts;
type NewPassageDto = Extensions.NewPassageDto;

/** Item types this bridge treats as passages. */
const PASSAGE_ITEM_TYPES = new Set(['verse', 'passage']);

export interface CollectionsBridgeOptions {
  /**
   * Resolved lazily so the bridge can be constructed before the encrypted user
   * database has finished opening. Throwing from here surfaces to the
   * extension as an ordinary rejection.
   */
  getRepository: () => CollectionRepository;
  /**
   * Turns an inclusive verse-id range into `'Romans 8:28-30'`. Optional: the
   * DTO documents `reference` as absent when the host cannot resolve it, which
   * is the honest answer for a verse id outside the installed versification.
   */
  formatReference?: (verseIdStart: number, verseIdEnd: number) => string | undefined;
}

export class CollectionsBridge implements IExtensionCollectionsBridge {
  private readonly getRepository: () => CollectionRepository;
  private readonly formatReference:
    | ((verseIdStart: number, verseIdEnd: number) => string | undefined)
    | undefined;

  constructor(opts: CollectionsBridgeOptions) {
    this.getRepository = opts.getRepository;
    this.formatReference = opts.formatReference;
  }

  // --- Collections -------------------------------------------------------

  listCollections(): PassageCollectionDto[] {
    const repo = this.getRepository();
    return repo.getAll().map((c) => this.toCollectionDto(repo, c));
  }

  createCollection(name: LocalizedString, opts?: NewCollectionOpts): PassageCollectionDto {
    const repo = this.getRepository();
    let parentCollectionId: number | undefined;
    if (opts?.parentId !== undefined) {
      // Checked here rather than left to the foreign key: a constraint
      // violation surfaces as a SQLite error string an extension author cannot
      // act on, and `IExtensionCollectionsBridge` promises a throw naming the
      // collection.
      parentCollectionId = this.requireCollectionId(repo, opts.parentId);
    }

    const collection = new Collection({
      name: resolveName(name),
      ...(parentCollectionId !== undefined ? { parentCollectionId } : {}),
      ...(opts?.description !== undefined ? { description: opts.description } : {}),
      ...(opts?.color !== undefined ? { color: opts.color } : {}),
      ...(opts?.icon !== undefined ? { icon: opts.icon } : {}),
    });
    const id = repo.create(collection);
    const created = repo.getById(id);
    if (!created) {
      throw new Error(`collections.create: collection ${id} vanished immediately after insert`);
    }
    return this.toCollectionDto(repo, created);
  }

  renameCollection(collectionId: string, name: LocalizedString): PassageCollectionDto {
    const repo = this.getRepository();
    const numericId = this.requireCollectionId(repo, collectionId);
    const existing = repo.getById(numericId);
    if (!existing) throw new Error(`Collection not found: ${collectionId}`);
    existing.name = resolveName(name);
    repo.update(existing);
    const updated = repo.getById(numericId);
    if (!updated) throw new Error(`Collection not found: ${collectionId}`);
    return this.toCollectionDto(repo, updated);
  }

  deleteCollection(collectionId: string): void {
    const repo = this.getRepository();
    const numericId = this.requireCollectionId(repo, collectionId);
    // `collection.parent_collection_id` and `pinned_item.collection_id` are
    // both ON DELETE CASCADE, so the subtree and its passages go with it. The
    // in-memory bridge walks the tree by hand to match this.
    repo.delete(numericId);
  }

  // --- Passages ----------------------------------------------------------

  listPassages(collectionId: string): PassageEntryDto[] {
    const repo = this.getRepository();
    const numericId = this.requireCollectionId(repo, collectionId);
    return this.orderedPassages(repo, numericId).map((p, index) =>
      this.toEntryDto(p, collectionId, index),
    );
  }

  addPassage(collectionId: string, passage: NewPassageDto): PassageEntryDto {
    const repo = this.getRepository();
    const numericId = this.requireCollectionId(repo, collectionId);
    const ordered = this.orderedPassages(repo, numericId);

    // A position past the end appends. The api-impl has already refused a
    // negative one; clamping here as well keeps the bridge safe to call
    // directly without duplicating that rejection.
    const at =
      passage.position === undefined
        ? ordered.length
        : Math.max(0, Math.min(passage.position, ordered.length));

    // Inclusive on both ends. A single verse stores end = start, never NULL -
    // a nullable end is what previously made single-verse rows match every
    // later range query.
    const verseIdEnd = passage.verseIdEnd ?? passage.verseIdStart;

    const item = new PinnedItem({
      collectionId: numericId,
      itemType: verseIdEnd > passage.verseIdStart ? 'passage' : 'verse',
      verseIdStart: passage.verseIdStart,
      verseIdEnd,
      // `sort_order` is set properly by the renumber below; this is only the
      // value the row is born with, before it takes its place in the list.
      sortOrder: at,
      ...(passage.label !== undefined ? { title: resolveName(passage.label) } : {}),
      ...(passage.notes !== undefined ? { notes: passage.notes } : {}),
      ...(passage.moduleId !== undefined
        ? { moduleId: parseModuleId(passage.moduleId) }
        : {}),
      ...(this.formatReference !== undefined
        ? { referenceText: this.formatReference(passage.verseIdStart, verseIdEnd) }
        : {}),
    });

    const pinId = repo.addPinnedItem(item);

    // Splice the new row into place and renumber the whole collection, so the
    // dense-position promise holds for an insert into the middle as well as an
    // append.
    const next = [...ordered];
    next.splice(at, 0, { ...item, pinId } as PinnedItem);
    this.renumber(repo, next);

    const created = repo.getPinnedItem(pinId);
    if (!created) {
      throw new Error(`collections.addPassage: pin ${pinId} vanished immediately after insert`);
    }
    return this.toEntryDto(created, collectionId, at);
  }

  removePassage(entryId: string): void {
    const repo = this.getRepository();
    const pinId = parseId(entryId, 'entryId');
    const existing = repo.getPinnedItem(pinId);
    if (!existing) throw new Error(`Passage not found: ${entryId}`);
    const collectionId = existing.collectionId;
    repo.deletePinnedItem(pinId);
    // Close the gap so later positions stay usable as `move` arguments.
    if (collectionId !== undefined) {
      this.renumber(repo, this.orderedPassages(repo, collectionId));
    }
  }

  movePassage(entryId: string, position: number): PassageEntryDto[] {
    const repo = this.getRepository();
    const pinId = parseId(entryId, 'entryId');
    const existing = repo.getPinnedItem(pinId);
    if (!existing) throw new Error(`Passage not found: ${entryId}`);
    const collectionId = existing.collectionId;
    if (collectionId === undefined) {
      throw new Error(`Passage ${entryId} belongs to no collection`);
    }

    const ordered = this.orderedPassages(repo, collectionId);
    const from = ordered.findIndex((p) => p.pinId === pinId);
    if (from < 0) throw new Error(`Passage not found: ${entryId}`);

    // Clamp against `length - 1`, not `length`: after removing the entry the
    // list is one shorter, so an unclamped "move to the end" would splice past
    // it and leave a hole the renumber then closes - which works, but only by
    // accident.
    const to = Math.max(0, Math.min(position, ordered.length - 1));
    const [moved] = ordered.splice(from, 1);
    ordered.splice(to, 0, moved!);
    this.renumber(repo, ordered);

    return ordered.map((p, index) => this.toEntryDto(p, String(collectionId), index));
  }

  reorder(collectionId: string, entryIds: string[]): PassageEntryDto[] {
    const repo = this.getRepository();
    const numericId = this.requireCollectionId(repo, collectionId);
    const ordered = this.orderedPassages(repo, numericId);

    // A permutation, not a subset: anything else would silently leave the
    // omitted entries wherever the renumber happened to put them, which is a
    // worse outcome than refusing.
    if (entryIds.length !== ordered.length) {
      throw new Error(
        `collections.reorder: expected ${ordered.length} ids, got ${entryIds.length}`,
      );
    }
    const byId = new Map(ordered.map((p) => [String(p.pinId), p]));
    const next: PinnedItem[] = [];
    const seen = new Set<string>();
    for (const id of entryIds) {
      const found = byId.get(id);
      if (!found) {
        throw new Error(`collections.reorder: ${id} is not in collection ${collectionId}`);
      }
      if (seen.has(id)) throw new Error(`collections.reorder: ${id} listed twice`);
      seen.add(id);
      next.push(found);
    }
    this.renumber(repo, next);
    return next.map((p, index) => this.toEntryDto(p, collectionId, index));
  }

  // --- Helpers -----------------------------------------------------------

  /**
   * The collection's passage rows, in `sort_order`, with `pin_id` as the
   * tiebreak so a collection whose orders were never densified still comes
   * back in a stable order rather than one the engine chose.
   */
  private orderedPassages(repo: CollectionRepository, collectionId: number): PinnedItem[] {
    return repo
      .getPinnedItemsForCollection(collectionId)
      .filter((p) => PASSAGE_ITEM_TYPES.has(p.itemType) && p.verseIdStart !== undefined)
      .sort((a, b) => a.sortOrder - b.sortOrder || (a.pinId ?? 0) - (b.pinId ?? 0));
  }

  /**
   * Write back dense zero-based positions for one collection, in one
   * transaction. This is the single place the dense-position invariant is
   * maintained; every mutation above routes through it.
   */
  private renumber(repo: CollectionRepository, ordered: PinnedItem[]): void {
    const pinIds = ordered
      .map((p) => p.pinId)
      .filter((id): id is number => typeof id === 'number');
    if (pinIds.length === 0) return;
    repo.reorderPinnedItems(pinIds);
  }

  private requireCollectionId(repo: CollectionRepository, collectionId: string): number {
    const numericId = parseId(collectionId, 'collectionId');
    if (!repo.getById(numericId)) throw new Error(`Collection not found: ${collectionId}`);
    return numericId;
  }

  private toCollectionDto(repo: CollectionRepository, c: Collection): PassageCollectionDto {
    if (c.collectionId === undefined) {
      throw new Error('collections: a stored collection has no id');
    }
    // Counts passages directly in this collection, not its children. An
    // aggregating count would disagree with `listPassages(id).length`, which
    // is the number a caller can actually act on.
    const entryCount = this.orderedPassages(repo, c.collectionId).length;
    return {
      id: String(c.collectionId),
      name: c.name,
      entryCount,
      createdAt: toEpochMs(c.createdDate),
      ...(c.parentCollectionId !== undefined
        ? { parentId: String(c.parentCollectionId) }
        : {}),
      ...(c.description !== undefined ? { description: c.description } : {}),
      ...(c.color !== undefined ? { color: c.color } : {}),
      ...(c.icon !== undefined ? { icon: c.icon } : {}),
    };
  }

  /**
   * `position` is passed in rather than read from `sortOrder` because the
   * caller has just computed the ordering and, in the mutating paths, the
   * in-memory rows predate the renumber that made it true on disk.
   */
  private toEntryDto(p: PinnedItem, collectionId: string, position: number): PassageEntryDto {
    if (p.pinId === undefined) throw new Error('collections: a stored passage has no id');
    const verseIdStart = p.verseIdStart ?? 0;
    const verseIdEnd = p.verseIdEnd ?? verseIdStart;
    const reference = p.referenceText ?? this.formatReference?.(verseIdStart, verseIdEnd);
    return {
      id: String(p.pinId),
      collectionId,
      verseIdStart,
      verseIdEnd,
      position,
      createdAt: toEpochMs(p.createdDate),
      ...(p.title !== undefined ? { label: p.title } : {}),
      ...(p.moduleId !== undefined ? { moduleId: String(p.moduleId) } : {}),
      ...(p.notes !== undefined ? { notes: p.notes } : {}),
      ...(reference !== undefined ? { reference } : {}),
    };
  }
}

/**
 * Parse an opaque contract id back to the integer primary key behind it.
 *
 * Refuses anything that is not a positive integer rather than letting
 * `Number('abc')` become `NaN` and reach a query as a bound parameter, where
 * it would match nothing and read as "not found" - a confusing answer to what
 * is really a malformed argument.
 */
function parseId(value: string, field: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`collections: ${field} '${value}' is not a valid id`);
  }
  return parsed;
}

/** Same, for the numeric module foreign key. */
function parseModuleId(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `collections: moduleId '${value}' is not a known module id. ` +
        'Use an id from bible.listModules().',
    );
  }
  return parsed;
}

/**
 * `LocalizedString` down to the single text column the store has.
 *
 * A catalog reference cannot be stored as one - the row outlives the
 * extension that wrote it, and its catalog goes away on uninstall, leaving a
 * name nothing can resolve. Extensions that want a localized name should
 * resolve it before calling. The key is stored as a last resort so the row is
 * identifiable rather than blank.
 */
function resolveName(name: LocalizedString): string {
  if (typeof name === 'string') return name;
  log.warn(
    `[CollectionsBridge] storing catalog key '${name.key}' as a literal name - ` +
      'a LocalizedString cannot survive in the collection store',
  );
  return name.key;
}

/** SQLite text timestamps to epoch ms; `0` when absent or unparseable. */
function toEpochMs(value: string | undefined): number {
  if (value === undefined) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}
