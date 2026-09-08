/**
 * Default corpora entry point.
 *
 * Exposes:
 *   - `DEFAULT_CORPUS` — the bundled smoke-test inputs (verses, refs, etc.).
 *   - `getDefaultCorpus(kind)` — lookup by `HookKind`, via the existing
 *     `INPUT_SHAPE_BY_KIND` mapping in `enumerateHooks.ts`. Callers should
 *     never redefine which shape feeds which kind.
 *   - `mergeCorpus(defaults, user)` — apply a validated `smoke.corpus.json`
 *     onto the defaults.
 *   - `validateUserCorpus(raw)` — parse + type-check a raw JSON blob from
 *     disk; throws `CorpusValidationError` on malformed input.
 *
 * Item 3 (assertion engine) is the intended consumer. The harness itself
 * (item 1) does not yet read corpora — that's wired in item 3.
 */

import type { VerseId, VerseRange } from '@bible/core';
import { INPUT_SHAPE_BY_KIND } from '../enumerateHooks';
import type { HookInputShape, HookKind } from '../types';

import { DEFAULT_VERSE_ID_CORPUS, DEFAULT_VERSE_RANGE_CORPUS } from './verses';
import { DEFAULT_REFERENCE_STRING_CORPUS } from './references';
import { DEFAULT_STORAGE_CORPUS, type StorageStateFixture } from './storage';
import { DEFAULT_NETWORK_CORPUS, type NetworkFixture } from './network';
import {
  DEFAULT_COMMAND_ARGS_CORPUS,
  DEFAULT_DICTIONARY_KEY_CORPUS,
  DEFAULT_EVENT_PAYLOAD_CORPUS,
  DEFAULT_NONE_CORPUS,
  DEFAULT_SECTION_ID_CORPUS,
} from './miscInputs';
import {
  CorpusValidationError,
  type CorpusOverride,
  type SmokeCorpus,
  type UserCorpusFile,
} from './types';

export { DEFAULT_VERSE_ID_CORPUS, DEFAULT_VERSE_RANGE_CORPUS } from './verses';
export { DEFAULT_REFERENCE_STRING_CORPUS } from './references';
export { DEFAULT_STORAGE_CORPUS, type StorageStateFixture } from './storage';
export {
  DEFAULT_NETWORK_CORPUS,
  type NetworkFixture,
  type NetworkResponseKind,
} from './network';
export {
  DEFAULT_COMMAND_ARGS_CORPUS,
  DEFAULT_DICTIONARY_KEY_CORPUS,
  DEFAULT_EVENT_PAYLOAD_CORPUS,
  DEFAULT_NONE_CORPUS,
  DEFAULT_SECTION_ID_CORPUS,
} from './miscInputs';
export {
  CorpusValidationError,
  type CorpusOverride,
  type SmokeCorpus,
  type UserCorpusFile,
} from './types';

export const DEFAULT_CORPUS: SmokeCorpus = Object.freeze({
  verseIds: DEFAULT_VERSE_ID_CORPUS,
  verseRanges: DEFAULT_VERSE_RANGE_CORPUS,
  referenceStrings: DEFAULT_REFERENCE_STRING_CORPUS,
  dictionaryKeys: DEFAULT_DICTIONARY_KEY_CORPUS,
  sectionIds: DEFAULT_SECTION_ID_CORPUS,
  commandArgs: DEFAULT_COMMAND_ARGS_CORPUS,
  eventPayloads: DEFAULT_EVENT_PAYLOAD_CORPUS,
  storage: DEFAULT_STORAGE_CORPUS,
  network: DEFAULT_NETWORK_CORPUS,
  none: DEFAULT_NONE_CORPUS,
});

const SHAPE_TO_FIELD: Record<HookInputShape, keyof SmokeCorpus> = {
  verseId: 'verseIds',
  verseRange: 'verseRanges',
  referenceString: 'referenceStrings',
  dictionaryKey: 'dictionaryKeys',
  sectionId: 'sectionIds',
  commandArgs: 'commandArgs',
  eventPayload: 'eventPayloads',
  none: 'none',
};

export function getCorpusForShape(
  shape: HookInputShape,
  corpus: SmokeCorpus = DEFAULT_CORPUS,
): readonly unknown[] {
  const field = SHAPE_TO_FIELD[shape];
  return corpus[field];
}

export function getDefaultCorpus(
  kind: HookKind,
  corpus: SmokeCorpus = DEFAULT_CORPUS,
): readonly unknown[] {
  return getCorpusForShape(INPUT_SHAPE_BY_KIND[kind], corpus);
}

// ── Merge + validation ──────────────────────────────────────────────────

type CorpusField = keyof SmokeCorpus;

const ALL_FIELDS: readonly CorpusField[] = [
  'verseIds',
  'verseRanges',
  'referenceStrings',
  'dictionaryKeys',
  'sectionIds',
  'commandArgs',
  'eventPayloads',
  'storage',
  'network',
  'none',
];

/**
 * Merge a validated user corpus over defaults. Per-field behavior:
 *
 *   - A bare array replaces or extends the default depending on `mode`
 *     (default `extend`). A field-level `{ append }` or `{ replace }`
 *     object always wins over the top-level mode.
 */
export function mergeCorpus(
  defaults: SmokeCorpus,
  user: UserCorpusFile | undefined,
): SmokeCorpus {
  if (!user) return defaults;
  const globalMode = user.mode ?? 'extend';
  const out: Record<CorpusField, readonly unknown[]> = { ...defaults } as Record<
    CorpusField,
    readonly unknown[]
  >;

  const apply = <T>(
    field: CorpusField,
    value: readonly T[] | CorpusOverride<T> | undefined,
  ): void => {
    if (value === undefined) return;
    const def = defaults[field] as readonly T[];
    if (Array.isArray(value)) {
      out[field] = globalMode === 'replace' ? [...value] : [...def, ...value];
      return;
    }
    const override = value as CorpusOverride<T>;
    if (override.replace !== undefined) {
      out[field] = [...override.replace];
    } else if (override.append !== undefined) {
      out[field] = [...def, ...override.append];
    }
  };

  apply<VerseId>('verseIds', user.verseIds);
  apply<VerseRange>('verseRanges', user.verseRanges);
  apply<string>('referenceStrings', user.referenceStrings);
  apply<string>('dictionaryKeys', user.dictionaryKeys);
  apply<string>('sectionIds', user.sectionIds);
  apply<unknown>('commandArgs', user.commandArgs);
  apply<unknown>('eventPayloads', user.eventPayloads);
  apply<StorageStateFixture>('storage', user.storage);
  apply<NetworkFixture>('network', user.network);

  return Object.freeze({
    verseIds: out.verseIds as readonly VerseId[],
    verseRanges: out.verseRanges as readonly VerseRange[],
    referenceStrings: out.referenceStrings as readonly string[],
    dictionaryKeys: out.dictionaryKeys as readonly string[],
    sectionIds: out.sectionIds as readonly string[],
    commandArgs: out.commandArgs,
    eventPayloads: out.eventPayloads,
    storage: out.storage as readonly StorageStateFixture[],
    network: out.network as readonly NetworkFixture[],
    none: out.none,
  });
}

/**
 * Validate a raw value (typically `JSON.parse(...)` of `smoke.corpus.json`)
 * and return a typed `UserCorpusFile`. Throws `CorpusValidationError` with
 * a structural path on failure.
 */
export function validateUserCorpus(raw: unknown): UserCorpusFile {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new CorpusValidationError('', 'must be a JSON object');
  }
  const obj = raw as Record<string, unknown>;
  const out: UserCorpusFile = {};

  if ('mode' in obj) {
    if (obj.mode !== 'extend' && obj.mode !== 'replace') {
      throw new CorpusValidationError('mode', 'must be "extend" or "replace"');
    }
    out.mode = obj.mode;
  }

  for (const key of Object.keys(obj)) {
    if (key === 'mode') continue;
    if (!(ALL_FIELDS as readonly string[]).includes(key) || key === 'none') {
      throw new CorpusValidationError(key, 'unknown field');
    }
  }

  const validateField = <T>(
    field: CorpusField,
    itemValidator: (v: unknown, path: string) => T,
  ): readonly T[] | CorpusOverride<T> | undefined => {
    const value = obj[field];
    if (value === undefined) return undefined;
    if (Array.isArray(value)) {
      return value.map((v, i) => itemValidator(v, `${field}[${i}]`));
    }
    if (value === null || typeof value !== 'object') {
      throw new CorpusValidationError(field, 'must be an array or { append?, replace? } object');
    }
    const override = value as Record<string, unknown>;
    const extra = Object.keys(override).filter((k) => k !== 'append' && k !== 'replace');
    if (extra.length > 0) {
      throw new CorpusValidationError(`${field}.${extra[0]}`, 'unknown key');
    }
    const result: CorpusOverride<T> = {};
    if (override.append !== undefined) {
      if (!Array.isArray(override.append)) {
        throw new CorpusValidationError(`${field}.append`, 'must be an array');
      }
      result.append = override.append.map((v, i) =>
        itemValidator(v, `${field}.append[${i}]`),
      );
    }
    if (override.replace !== undefined) {
      if (!Array.isArray(override.replace)) {
        throw new CorpusValidationError(`${field}.replace`, 'must be an array');
      }
      result.replace = override.replace.map((v, i) =>
        itemValidator(v, `${field}.replace[${i}]`),
      );
    }
    return result;
  };

  const asInt = (v: unknown, path: string): number => {
    if (typeof v !== 'number' || !Number.isInteger(v)) {
      throw new CorpusValidationError(path, 'must be an integer');
    }
    return v;
  };
  const asString = (v: unknown, path: string): string => {
    if (typeof v !== 'string') {
      throw new CorpusValidationError(path, 'must be a string');
    }
    return v;
  };
  const asRange = (v: unknown, path: string): VerseRange => {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) {
      throw new CorpusValidationError(path, 'must be a {startVerseId, endVerseId?} object');
    }
    const o = v as Record<string, unknown>;
    if (typeof o.startVerseId !== 'number' || !Number.isInteger(o.startVerseId)) {
      throw new CorpusValidationError(`${path}.startVerseId`, 'must be an integer');
    }
    if (o.endVerseId !== undefined && (typeof o.endVerseId !== 'number' || !Number.isInteger(o.endVerseId))) {
      throw new CorpusValidationError(`${path}.endVerseId`, 'must be an integer');
    }
    const r: VerseRange = { startVerseId: o.startVerseId };
    if (o.endVerseId !== undefined) r.endVerseId = o.endVerseId as number;
    return r;
  };
  const asStorage = (v: unknown, path: string): StorageStateFixture => {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) {
      throw new CorpusValidationError(path, 'must be a storage fixture object');
    }
    const o = v as Record<string, unknown>;
    if (typeof o.id !== 'string' || o.id.length === 0) {
      throw new CorpusValidationError(`${path}.id`, 'must be a non-empty string');
    }
    if (typeof o.description !== 'string') {
      throw new CorpusValidationError(`${path}.description`, 'must be a string');
    }
    if (!Array.isArray(o.entries)) {
      throw new CorpusValidationError(`${path}.entries`, 'must be an array of [key, value] pairs');
    }
    const entries: Array<readonly [string, string]> = o.entries.map((e, i) => {
      if (!Array.isArray(e) || e.length !== 2 || typeof e[0] !== 'string' || typeof e[1] !== 'string') {
        throw new CorpusValidationError(`${path}.entries[${i}]`, 'must be [string, string]');
      }
      return [e[0], e[1]] as const;
    });
    const fixture: StorageStateFixture = { id: o.id, description: o.description, entries };
    if (o.quotaBytes !== undefined) {
      if (typeof o.quotaBytes !== 'number' || !Number.isFinite(o.quotaBytes)) {
        throw new CorpusValidationError(`${path}.quotaBytes`, 'must be a number');
      }
      fixture.quotaBytes = o.quotaBytes;
    }
    if (o.oversizedWrite !== undefined) {
      const ow = o.oversizedWrite;
      if (ow === null || typeof ow !== 'object' || Array.isArray(ow)) {
        throw new CorpusValidationError(`${path}.oversizedWrite`, 'must be an object');
      }
      const owo = ow as Record<string, unknown>;
      if (typeof owo.key !== 'string' || typeof owo.value !== 'string') {
        throw new CorpusValidationError(`${path}.oversizedWrite`, 'must have string key and value');
      }
      fixture.oversizedWrite = { key: owo.key, value: owo.value };
    }
    return fixture;
  };
  const asNetwork = (v: unknown, path: string): NetworkFixture => {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) {
      throw new CorpusValidationError(path, 'must be a network fixture object');
    }
    const o = v as Record<string, unknown>;
    if (typeof o.id !== 'string' || o.id.length === 0) {
      throw new CorpusValidationError(`${path}.id`, 'must be a non-empty string');
    }
    const validKinds = ['success', 'notFound', 'serverError', 'timeout', 'offline'];
    if (typeof o.kind !== 'string' || !validKinds.includes(o.kind)) {
      throw new CorpusValidationError(`${path}.kind`, `must be one of ${validKinds.join(', ')}`);
    }
    if (typeof o.description !== 'string') {
      throw new CorpusValidationError(`${path}.description`, 'must be a string');
    }
    const fixture: NetworkFixture = {
      id: o.id,
      kind: o.kind as NetworkFixture['kind'],
      description: o.description,
    };
    if (o.status !== undefined) {
      if (typeof o.status !== 'number' || !Number.isInteger(o.status)) {
        throw new CorpusValidationError(`${path}.status`, 'must be an integer');
      }
      fixture.status = o.status;
    }
    if (o.body !== undefined) {
      if (typeof o.body !== 'string') {
        throw new CorpusValidationError(`${path}.body`, 'must be a string');
      }
      fixture.body = o.body;
    }
    if (o.contentType !== undefined) {
      if (typeof o.contentType !== 'string') {
        throw new CorpusValidationError(`${path}.contentType`, 'must be a string');
      }
      fixture.contentType = o.contentType;
    }
    if (o.delayMs !== undefined) {
      if (typeof o.delayMs !== 'number' || !Number.isFinite(o.delayMs)) {
        throw new CorpusValidationError(`${path}.delayMs`, 'must be a number');
      }
      fixture.delayMs = o.delayMs;
    }
    if (o.networkError !== undefined) {
      if (typeof o.networkError !== 'boolean') {
        throw new CorpusValidationError(`${path}.networkError`, 'must be a boolean');
      }
      fixture.networkError = o.networkError;
    }
    return fixture;
  };
  const asUnknown = (v: unknown): unknown => v;

  const vi = validateField<VerseId>('verseIds', asInt);
  if (vi !== undefined) out.verseIds = vi;
  const vr = validateField<VerseRange>('verseRanges', asRange);
  if (vr !== undefined) out.verseRanges = vr;
  const rs = validateField<string>('referenceStrings', asString);
  if (rs !== undefined) out.referenceStrings = rs;
  const dk = validateField<string>('dictionaryKeys', asString);
  if (dk !== undefined) out.dictionaryKeys = dk;
  const si = validateField<string>('sectionIds', asString);
  if (si !== undefined) out.sectionIds = si;
  const ca = validateField<unknown>('commandArgs', asUnknown);
  if (ca !== undefined) out.commandArgs = ca;
  const ep = validateField<unknown>('eventPayloads', asUnknown);
  if (ep !== undefined) out.eventPayloads = ep;
  const st = validateField<StorageStateFixture>('storage', asStorage);
  if (st !== undefined) out.storage = st;
  const nw = validateField<NetworkFixture>('network', asNetwork);
  if (nw !== undefined) out.network = nw;

  return out;
}
