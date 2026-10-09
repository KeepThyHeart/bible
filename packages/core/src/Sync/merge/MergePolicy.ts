/**
 * Merge policies (contracts 0063 §6; task 0150 W2-B). Pure, deterministic and browser-safe.
 *
 * The engine calls a policy only for a record that is dirty locally AND changed on the server since the local
 * base (a pull hit a dirty row, or a push came back as a conflict). Inputs:
 * - `local`:  the local row as it would be pushed now (`d` from the codec, `h` the HLC ticked for the local
 *             change, `deleted` for a local tombstone).
 * - `remote`: the server's current version (decrypted `RecordPlaintext.d` / `.h`, or a tombstone).
 * - `base`:   the last version both sides agreed on (`sync_record.base_json` + `hlc`), or null when unknown.
 *
 * Tombstones carry no blob on the server, so a remote tombstone usually has no HLC: pass `h: ''`. The empty HLC
 * sorts below every real one, so a concurrent edit wins against a delete of unknown time ("no silent loss");
 * a delete with a known HLC beats only an older edit, and an edit newer than the delete resurrects the record.
 *
 * Every decision depends only on the values, never on which side is "local": device A merging (a, b) and device
 * B merging (b, a) with the same base end with the same content (outcome labels swap: takeRemote <-> keepLocal,
 * winner 'local' <-> 'remote'). Ties on equal HLCs (only possible for identical writes) fall back to the
 * canonical JSON of the content. Outcomes are normalised: a merge result equal to the remote version is
 * `takeRemote`, equal to the local version is `keepLocal`; `merged` is returned only for genuinely new content.
 */
import type { HlcString, RecordId, RecordType } from '../types';
import { compareHlc } from '../tracking/Hlc';
import { canonicalJson, compareStrings, sameValue } from './canonical';

export { keyBetween, isOrderKey, ORDER_KEY_DEVICE_TAG_LENGTH } from './keyBetween';

export interface Version { d: Record<string, unknown>; h: HlcString; deleted: boolean }

export type MergeOutcome =
  | { kind: 'takeRemote' }                               // overwrite local, clear dirty
  | { kind: 'keepLocal' }                                // push local with the remote seq as base
  | { kind: 'merged'; d: Record<string, unknown> }       // write merged locally AND push it
  /**
   * The loser's content is saved as a NEW record of the same type (new random id), `copy` being its `d` with the
   * policy's link field pointing at this record (see `mergeOutcomeFor`). This record keeps the winner; when `d`
   * is present the winner's metadata was merged with the loser's, so write `d` locally AND push it (as for
   * `merged`); when absent the winner stands as is (`winner: 'remote'` = takeRemote, `'local'` = keepLocal).
   */
  | { kind: 'conflictCopy'; winner: 'local' | 'remote'; copy: Record<string, unknown>; d?: Record<string, unknown> };

export interface MergePolicy {
  /** Pure and deterministic: same inputs -> same outcome on every device. `base` = last common synced version. */
  merge(local: Version, remote: Version, base: Version | null): MergeOutcome;
}

/** A policy that can produce conflicted copies; `linkField` is where the copy points at the winner. */
export interface ConflictCopyPolicy extends MergePolicy {
  readonly bodyFields: readonly string[];
  /** A column of `d` (`'conflictOf'`), or `'<jsonColumn>.<key>'` for a key inside a JSON-text column (`'metadata.conflictOf'`). */
  readonly linkField: string;
}

/**
 * Placeholder the policies put in a conflicted copy's link field, since a policy does not know record ids.
 * `mergeOutcomeFor` (or `bindConflictLink`) replaces it with the winner's record id; never persist it.
 */
export const CONFLICT_WINNER_PLACEHOLDER = '$winner';

const TAKE_REMOTE: MergeOutcome = { kind: 'takeRemote' };
const KEEP_LOCAL: MergeOutcome = { kind: 'keepLocal' };

/**
 * Total order on versions, the same on every device: HLC, then tombstone above live, then canonical content.
 * Returns 0 only for identical versions.
 */
function order(x: Version, y: Version): number {
  const c = compareHlc(x.h, y.h);
  if (c !== 0) return c;
  if (x.deleted !== y.deleted) return x.deleted ? 1 : -1;
  if (x.deleted) return 0;
  return compareStrings(canonicalJson(x.d), canonicalJson(y.d));
}

/** Both versions describe the same state (both deleted, or both live with equal content). */
function sameState(a: Version, b: Version): boolean {
  if (a.deleted || b.deleted) return a.deleted && b.deleted;
  return sameValue(a.d, b.d);
}

/** Map a resolved content back to the cheapest outcome. */
function settle(local: Version, remote: Version, d: Record<string, unknown>): MergeOutcome {
  if (!remote.deleted && sameValue(d, remote.d)) return TAKE_REMOTE;
  if (!local.deleted && sameValue(d, local.d)) return KEEP_LOCAL;
  return { kind: 'merged', d };
}

/** Higher HLC wins; delete beats an OLDER edit only (an edit newer than the delete resurrects the record). */
export const lwwPolicy: MergePolicy = {
  merge(local: Version, remote: Version, _base: Version | null): MergeOutcome {
    if (sameState(local, remote)) return TAKE_REMOTE;
    return order(local, remote) > 0 ? KEEP_LOCAL : TAKE_REMOTE;
  },
};

/**
 * Rows that are written once and never updated (review logs, memory attempts; extension tables declared
 * `merge: 'appendOnly'`). Every row is its own record with a random id, so the record set is the union of both
 * devices' rows. For two live versions of the same row the FIRST write wins (lowest HLC): later "updates" are
 * ignored and a live row never turns into anything else. Deletes follow the LWW rule (a delete of unknown time
 * never removes a row), so a row is lost only to a real, newer delete (e.g. its card was deleted).
 */
export const appendOnlyPolicy: MergePolicy = {
  merge(local: Version, remote: Version, base: Version | null): MergeOutcome {
    if (local.deleted || remote.deleted) return lwwPolicy.merge(local, remote, base);
    if (sameValue(local.d, remote.d)) return TAKE_REMOTE;
    return order(local, remote) < 0 ? KEEP_LOCAL : TAKE_REMOTE;
  },
};

export interface FieldLwwOptions {
  /**
   * Fields merged as ONE unit (a note's `content` + `content_format`): taken from the side that changed them;
   * when both sides changed them to different values the newer side wins and, with `linkField`, the loser is
   * returned as a conflicted copy.
   */
  bodyFields?: readonly string[];
  /** Link field for conflicted copies; without it a body conflict is decided by the newer side alone. */
  linkField?: string;
  /** Fields that only grow (a reset timestamp): when both sides changed them, the larger value wins. */
  maxFields?: readonly string[];
  /**
   * Fields holding a set as a JSON array (or JSON text of one; null = empty): when both sides changed them they
   * merge three-way (an element added on either side is kept, one removed on either side is dropped), so
   * marking and unmarking on two devices both survive. Non-array values fall back to the newer side.
   */
  setFields?: readonly string[];
}

/**
 * Field-level last-writer-wins with a three-way base: a field changed on one side only takes that side; a field
 * changed on both sides takes the newer version's value (or the max / set merge for the fields so marked).
 * Without a base every differing field counts as changed on both sides. Deletes follow `lwwPolicy`.
 */
export function fieldLwwPolicy(options: FieldLwwOptions = {}): MergePolicy {
  const bodyFields = [...(options.bodyFields ?? [])];
  const bodySet = new Set(bodyFields);
  const maxSet = new Set(options.maxFields ?? []);
  const setSet = new Set(options.setFields ?? []);
  const linkField = options.linkField;

  return {
    merge(local: Version, remote: Version, base: Version | null): MergeOutcome {
      if (local.deleted || remote.deleted) return lwwPolicy.merge(local, remote, base);
      if (sameValue(local.d, remote.d)) return TAKE_REMOTE;
      const b = base && !base.deleted ? base.d : null;
      const localNewer = order(local, remote) > 0;
      const L = local.d;
      const R = remote.d;

      const out: Record<string, unknown> = {};
      const keys = new Set([...Object.keys(L), ...Object.keys(R), ...(b ? Object.keys(b) : [])]);
      for (const k of [...keys].sort()) {
        if (bodySet.has(k)) continue;
        const v = mergeField(L[k], R[k], b, b ? b[k] : undefined, localNewer, maxSet.has(k), setSet.has(k));
        if (v !== undefined) out[k] = v;
      }

      let conflict = false;
      if (bodyFields.length > 0) {
        const lb = pick(L, bodyFields);
        const rb = pick(R, bodyFields);
        let src: Record<string, unknown>;
        if (sameValue(lb, rb)) src = L;
        else if (b && sameValue(lb, pick(b, bodyFields))) src = R;
        else if (b && sameValue(rb, pick(b, bodyFields))) src = L;
        else {
          src = localNewer ? L : R;
          conflict = linkField !== undefined;
        }
        for (const f of bodyFields) if (src[f] !== undefined) out[f] = src[f];
      }

      if (!conflict || linkField === undefined) return settle(local, remote, out);
      const winnerD = localNewer ? L : R;
      const loserD = localNewer ? R : L;
      const copy = bindConflictLink(loserD, linkField, CONFLICT_WINNER_PLACEHOLDER);
      const winner = localNewer ? 'local' : 'remote';
      return sameValue(out, winnerD)
        ? { kind: 'conflictCopy', winner, copy }
        : { kind: 'conflictCopy', winner, copy, d: out };
    },
  };
}

/**
 * Notes, prayer, journal: `fieldLwwPolicy` where the body fields form one unit and a body changed on both sides
 * keeps the newer body and returns the other as a conflicted copy (design: "No silent loss"). The copy is the
 * loser's whole `d` with `linkField` set to `CONFLICT_WINNER_PLACEHOLDER` (bound to the winner's record id by
 * `mergeOutcomeFor` / `bindConflictLink`).
 */
export function fieldLwwWithBodyCopy(bodyFields: string[], linkField: string): ConflictCopyPolicy {
  if (bodyFields.length === 0) throw new Error('fieldLwwWithBodyCopy: at least one body field is required');
  if (!linkField) throw new Error('fieldLwwWithBodyCopy: a link field is required');
  const inner = fieldLwwPolicy({ bodyFields, linkField });
  return { merge: inner.merge, bodyFields: [...bodyFields], linkField };
}

function mergeField(
  l: unknown, r: unknown, base: Record<string, unknown> | null, bv: unknown,
  localNewer: boolean, isMax: boolean, isSet: boolean,
): unknown {
  if (sameValue(l, r)) return l;
  if (base) {
    if (sameValue(l, bv)) return r;
    if (sameValue(r, bv)) return l;
  }
  if (isMax) return maxValue(l, r);
  if (isSet) {
    const merged = mergeSet(l, r, bv, base !== null);
    if (merged !== NOT_A_SET) return merged;
  }
  return localNewer ? l : r;
}

function pick(d: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) if (d[f] !== undefined) out[f] = d[f];
  return out;
}

/** Larger of two values; null/undefined are smallest; numbers compare numerically, anything else canonically. */
function maxValue(a: unknown, b: unknown): unknown {
  const aNone = a === null || a === undefined;
  const bNone = b === null || b === undefined;
  if (aNone && bNone) return a === null || b === null ? null : undefined;
  if (a === null || a === undefined) return b;
  if (b === null || b === undefined) return a;
  if (typeof a === 'number' && typeof b === 'number') return a >= b ? a : b;
  return compareStrings(canonicalJson(a), canonicalJson(b)) >= 0 ? a : b;
}

const NOT_A_SET: unique symbol = Symbol('notASet');

function asArray(v: unknown): unknown[] | typeof NOT_A_SET {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    if (v.trim() === '') return [];
    try {
      const parsed: unknown = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : NOT_A_SET;
    } catch {
      return NOT_A_SET;
    }
  }
  return NOT_A_SET;
}

/** Three-way set merge: x survives iff it is on both sides, or on one side and not in the base. Sorted output. */
function mergeSet(l: unknown, r: unknown, b: unknown, hasBase: boolean): unknown {
  const la = asArray(l);
  const ra = asArray(r);
  const ba = hasBase ? asArray(b) : [];
  if (la === NOT_A_SET || ra === NOT_A_SET || ba === NOT_A_SET) return NOT_A_SET;
  const lm = new Map(la.map((x) => [canonicalJson(x), x] as const));
  const rm = new Map(ra.map((x) => [canonicalJson(x), x] as const));
  const bk = new Set(ba.map((x) => canonicalJson(x)));
  const out = new Map<string, unknown>();
  for (const [k, x] of lm) if (rm.has(k) || !bk.has(k)) out.set(k, x);
  for (const [k, x] of rm) if (!bk.has(k)) out.set(k, x);
  const items = [...out.entries()].sort(([ka, xa], [kb, xb]) => {
    const na = typeof xa === 'number';
    const nb = typeof xb === 'number';
    if (na && nb) return (xa as number) - (xb as number);
    if (na !== nb) return na ? -1 : 1;
    return compareStrings(ka, kb);
  }).map(([, x]) => x);
  return typeof l === 'string' || typeof r === 'string' ? JSON.stringify(items) : items;
}

/**
 * Return a copy of `d` with the link field set to `value` (normally the winner's record id). A dotted field
 * `'col.key'` writes `key` inside the JSON-text column `col` (kept as JSON text; an object stays an object; a
 * missing or non-object value starts a new object).
 */
export function bindConflictLink(d: Record<string, unknown>, linkField: string, value: string): Record<string, unknown> {
  const out = { ...d };
  const dot = linkField.indexOf('.');
  if (dot < 0) {
    out[linkField] = value;
    return out;
  }
  const col = linkField.slice(0, dot);
  const key = linkField.slice(dot + 1);
  const cur = d[col];
  let obj: Record<string, unknown> = {};
  let asText = true;
  if (typeof cur === 'string') {
    try {
      const parsed: unknown = JSON.parse(cur);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) obj = { ...(parsed as Record<string, unknown>) };
    } catch {
      // not JSON: start a new object
    }
  } else if (cur !== null && typeof cur === 'object' && !Array.isArray(cur)) {
    obj = { ...(cur as Record<string, unknown>) };
    asText = false;
  }
  obj[key] = value;
  out[col] = asText ? JSON.stringify(obj) : obj;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Per-type table (design "Merge rules per data type"). Built lazily: nothing runs at module load.

/** Where a conflicted copy of a note-like record points at the winner (record ids are portable). */
export const CONFLICT_LINK_FIELD = 'metadata.conflictOf';

export type ExtDbMerge = 'lww' | 'appendOnly';

let table: Map<string, MergePolicy> | undefined;

function policyTable(): Map<string, MergePolicy> {
  if (table) return table;
  const m = new Map<string, MergePolicy>();
  const t = (types: Array<RecordType | string>, p: MergePolicy): void => { for (const x of types) m.set(x, p); };
  // Highlights, cross-refs, verse links: small records, LWW by HLC, delete beats an older edit.
  t(['user_text_markup', 'user_cross_reference', 'verse_link', 'note_verse_link', 'content_verse_link'], lwwPolicy);
  // Bookmarks: LWW per item; order lives in a fractional `sort_order` key (keyBetween), so inserts never collide.
  t(['collection', 'pinned_item'], lwwPolicy);
  // Reading plans and their days/passages: LWW per record.
  t(['reading_plan', 'reading_plan_day', 'reading_plan_passage'], lwwPolicy);
  // Reading progress: one record per (plan, start); fields LWW, completed days merged as a set so marks and
  // unmarks of different days on two devices both survive (the design's "marking and unmarking both work").
  t(['user_reading_progress'], fieldLwwPolicy({ setFields: ['completed_days'] }));
  // Notes and notebooks.
  t(['user_note'], fieldLwwWithBodyCopy(['content', 'content_format'], CONFLICT_LINK_FIELD));
  t(['user_commentary'], fieldLwwPolicy());
  // Prayer items, journal: same as notes.
  t(['prayer_item'], fieldLwwWithBodyCopy(['description'], CONFLICT_LINK_FIELD));
  t(['prayer_update'], fieldLwwWithBodyCopy(['update_text'], CONFLICT_LINK_FIELD));
  t(['journal_entry'], fieldLwwWithBodyCopy(['content', 'content_format', 'is_encrypted'], CONFLICT_LINK_FIELD));
  // Key/value data (web user-data store, extension storage): one record per key, LWW. Review logs use one key
  // per entry, so they merge as a union.
  t(['user_data_item', 'ext.kv'], lwwPolicy);
  // Extension declared tables: LWW unless the table is declared appendOnly (pass `merge` to policyFor).
  t(['ext.db'], lwwPolicy);
  // .bn file notes: the whole document is the body; the adapter renames the copy to "name (conflicted copy <date>).bn".
  t(['bn.file'], fieldLwwWithBodyCopy(['bn', 'mtime'], 'conflictOf'));
  // Scripture memory (0114, synced as core tables).
  t(['memory_collection', 'memory_passage'], fieldLwwPolicy());
  t(['memory_card'], fieldLwwPolicy({ maxFields: ['progress_reset_at'] })); // a later progress reset wins
  t(['memory_attempt', 'memory_recite_detail'], appendOnlyPolicy);       // review history: union, never lost
  t(['memory_setting', 'memory_resume_state'], lwwPolicy);
  table = m;
  return m;
}

/**
 * The policy for a record type (design table "Merge rules per data type"). Unknown types get `lwwPolicy` (the
 * engine keeps unknown types opaque and never merges them anyway). For `ext.db` pass the table's declared
 * `merge` mode: `'appendOnly'` gives `appendOnlyPolicy`.
 */
export function policyFor(type: string, opts?: { merge?: ExtDbMerge }): MergePolicy {
  if (type === 'ext.db' && opts?.merge === 'appendOnly') return appendOnlyPolicy;
  return policyTable().get(type) ?? lwwPolicy;
}

/** The record types `policyFor` maps explicitly (for coverage tests). */
export function knownPolicyTypes(): string[] {
  return [...policyTable().keys()];
}

export interface MergeContext {
  /** Record id of the record being merged; a conflicted copy's link field points at it. */
  recordId: RecordId;
  /** `ext.db` only: the table's declared merge mode. */
  merge?: ExtDbMerge;
}

/**
 * What the engine calls: `policyFor(type).merge(local, remote, base)` with a conflicted copy's link already bound
 * to `ctx.recordId`. The engine then:
 * - takeRemote: apply remote locally, markSynced at the remote seq/HLC (clears dirty);
 * - keepLocal: push local with `baseSeq` = remote seq;
 * - merged: write `d` locally, tick a new HLC, push with `baseSeq` = remote seq;
 * - conflictCopy: insert `copy` as a new record of the same type (new random id, pushed with baseSeq null), and
 *   resolve this record as `winner` says ('remote' -> takeRemote, 'local' -> keepLocal), or, when `d` is present,
 *   as `merged` with `d`.
 */
export function mergeOutcomeFor(
  type: string, local: Version, remote: Version, base: Version | null, ctx: MergeContext,
): MergeOutcome {
  const policy = policyFor(type, { merge: ctx.merge });
  const outcome = policy.merge(local, remote, base);
  if (outcome.kind !== 'conflictCopy') return outcome;
  const linkField = (policy as Partial<ConflictCopyPolicy>).linkField;
  if (!linkField) return outcome;
  return { ...outcome, copy: bindConflictLink(outcome.copy, linkField, ctx.recordId) };
}
