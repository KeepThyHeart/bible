/**
 * Word Study IPC handlers.
 *
 * A study subject is a Strong's number or a user word group. One shared
 * `WordStudyService` answers resolve / overview / occurrences; saved groups go
 * through `WordGroupStore` in the encrypted user database (owner
 * `app:word-study`). Every input is validated here, at the IPC boundary.
 */

import type { IpcMain } from 'electron';
import log from 'electron-log';
import {
  StrongsNumberHelper,
  UserDataRepository,
  WordFamilyService,
  WordGroupStore,
  WordStudyService,
} from '@bible/core';
import type {
  IBibleRepository,
  IDictionaryRepository,
  WordGroup,
  WordKeyCandidate,
  WordOccurrencePage,
  WordOccurrenceQuery,
  WordStudyOptions,
  WordStudyOverview,
  WordStudySubject,
} from '@bible/core';
import { ipcHandler, IpcKnownError } from './handler-helper';
import { ensureBibleRepository } from './bibleHandlers';
import { ensureDictionaryRepository } from './dictionaryHandlers';
import { listInstalledModules } from '../services/installedModules';
import { getSharedUserDb } from '../services/sharedUserDb';
import { initializeUserSchema } from '../schema/userSchema';
import { validateAbbreviation, validateString } from '../utils/validation';

// ---- limits ---------------------------------------------------------------

export const WORD_STUDY_LIMITS = {
  query: 200,
  term: 200,
  terms: 100,
  label: 200,
  id: 100,
  notes: 2000,
  formKey: 500,
  maxBook: 66,
  maxLimit: 500,
  maxOffset: 1_000_000,
} as const;

// ---- validation (exported for tests) ---------------------------------------

function invalid(message: string): never {
  throw new IpcKnownError('invalid_input', message);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validateStringArray(value: unknown, field: string, minLength: number): string[] {
  if (!Array.isArray(value) || value.length < minLength || value.length > WORD_STUDY_LIMITS.terms) {
    invalid(`Invalid ${field}: must be an array of ${minLength}-${WORD_STUDY_LIMITS.terms} strings`);
  }
  return (value as unknown[]).map((t, i) => {
    if (typeof t !== 'string' || t.trim().length === 0 || t.length > WORD_STUDY_LIMITS.term) {
      invalid(`Invalid ${field}[${i}]: must be a non-empty string (max ${WORD_STUDY_LIMITS.term} chars)`);
    }
    return t;
  });
}

/** Validate a group draft (id optional). Returns a sanitised copy, dropping unknown keys. */
export function validateGroupDraft(value: unknown): Partial<WordGroup> & { terms: string[] } {
  if (!isObject(value)) invalid('Invalid word group: must be an object');
  const out: Partial<WordGroup> & { terms: string[] } = {
    terms: validateStringArray(value.terms, 'terms', 1),
  };
  if (value.id !== undefined) out.id = validateString(value.id, 'group id', WORD_STUDY_LIMITS.id);
  if (value.label !== undefined) {
    if (typeof value.label !== 'string' || value.label.length > WORD_STUDY_LIMITS.label) {
      invalid(`Invalid label: must be a string (max ${WORD_STUDY_LIMITS.label} chars)`);
    }
    out.label = value.label;
  }
  if (value.exclude !== undefined) out.exclude = validateStringArray(value.exclude, 'exclude', 0);
  if (value.stem !== undefined) {
    if (typeof value.stem !== 'boolean') invalid('Invalid stem: must be a boolean');
    out.stem = value.stem;
  }
  if (value.notes !== undefined) {
    if (typeof value.notes !== 'string' || value.notes.length > WORD_STUDY_LIMITS.notes) {
      invalid(`Invalid notes: must be a string (max ${WORD_STUDY_LIMITS.notes} chars)`);
    }
    out.notes = value.notes;
  }
  return out;
}

export function validateSubject(value: unknown): WordStudySubject {
  if (!isObject(value)) invalid('Invalid word study subject: must be an object');
  if (value.kind === 'strongs') {
    if (typeof value.strongs !== 'string' || value.strongs.length > 12) {
      invalid('Invalid Strong\'s number');
    }
    const display = StrongsNumberHelper.toDisplayFormat(value.strongs);
    if (!display) invalid(`“${value.strongs.slice(0, 12)}” is not a valid Strong's number`);
    return { kind: 'strongs', strongs: display };
  }
  if (value.kind === 'group') {
    const draft = validateGroupDraft(value.group);
    if (!draft.id) invalid('Invalid word group: id is required');
    const group: WordGroup = {
      id: draft.id,
      label: draft.label ?? draft.terms[0],
      terms: draft.terms,
      ...(draft.exclude ? { exclude: draft.exclude } : {}),
      ...(draft.stem !== undefined ? { stem: draft.stem } : {}),
      ...(draft.notes ? { notes: draft.notes } : {}),
    };
    return { kind: 'group', group };
  }
  return invalid('Invalid word study subject kind');
}

function validateRenderingMode(value: unknown): 'head' | 'phrase' | undefined {
  if (value === undefined) return undefined;
  if (value !== 'head' && value !== 'phrase') invalid('Invalid renderingMode: must be "head" or "phrase"');
  return value;
}

function validateIntInRange(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    invalid(`Invalid ${field}: must be an integer from ${min} to ${max}`);
  }
  return value;
}

export function validateOptions(value: unknown): WordStudyOptions {
  if (value === undefined || value === null) return {};
  if (!isObject(value)) invalid('Invalid options: must be an object');
  const out: WordStudyOptions = {};
  if (value.module !== undefined) out.module = validateAbbreviation(value.module);
  const mode = validateRenderingMode(value.renderingMode);
  if (mode) out.renderingMode = mode;
  return out;
}

export function validateOccurrenceQuery(value: unknown): WordOccurrenceQuery {
  if (!isObject(value)) invalid('Invalid occurrence query: must be an object');
  const out: WordOccurrenceQuery = { module: validateAbbreviation(value.module) };
  if (value.book !== undefined) out.book = validateIntInRange(value.book, 'book', 1, WORD_STUDY_LIMITS.maxBook);
  if (value.form !== undefined) out.form = validateString(value.form, 'form', WORD_STUDY_LIMITS.formKey);
  const mode = validateRenderingMode(value.renderingMode);
  if (mode) out.renderingMode = mode;
  if (value.offset !== undefined) out.offset = validateIntInRange(value.offset, 'offset', 0, WORD_STUDY_LIMITS.maxOffset);
  if (value.limit !== undefined) out.limit = validateIntInRange(value.limit, 'limit', 1, WORD_STUDY_LIMITS.maxLimit);
  return out;
}

// ---- shared service ---------------------------------------------------------

let service: WordStudyService | null = null;
let serviceGreek: IDictionaryRepository | null = null;
let serviceHebrew: IDictionaryRepository | null = null;
let openBibles = new Map<string, IBibleRepository>();

async function findStrongsDictionary(kind: 'greek' | 'hebrew'): Promise<IDictionaryRepository | null> {
  const re = kind === 'greek' ? /strong.*greek|greek.*strong/i : /strong.*hebrew|hebrew.*strong/i;
  try {
    const modules = listInstalledModules('dictionary').filter(m => m.abbreviation && re.test(m.abbreviation));
    // Prefer the canonical module name (`strongsgreek` / `strongshebrew`).
    modules.sort((a, b) =>
      Number(b.abbreviation?.toLowerCase() === `strongs${kind}`) - Number(a.abbreviation?.toLowerCase() === `strongs${kind}`));
    for (const m of modules) {
      const repo = await ensureDictionaryRepository(m.abbreviation!);
      if (repo) return repo;
    }
  } catch (err) {
    log.warn(`[wordStudy] could not open Strong's ${kind} dictionary:`, err);
  }
  return null;
}

/**
 * The shared service, created lazily. Bible repositories are opened
 * asynchronously here (the service's `bibles` dependency is synchronous) and
 * read back from a snapshot; the Strong's dictionaries are re-checked each
 * call so a later install makes the service pick them up.
 */
async function getService(): Promise<WordStudyService> {
  const bibles = new Map<string, IBibleRepository>();
  for (const m of listInstalledModules('bible')) {
    const abbr = m.abbreviation;
    if (!abbr) continue;
    try {
      const repo = await ensureBibleRepository(abbr);
      if (repo) bibles.set(abbr, repo);
    } catch (err) {
      log.warn(`[wordStudy] could not open Bible ${abbr}:`, err);
    }
  }
  openBibles = bibles;

  const greek = await findStrongsDictionary('greek');
  const hebrew = await findStrongsDictionary('hebrew');
  if (!service || greek !== serviceGreek || hebrew !== serviceHebrew) {
    serviceGreek = greek;
    serviceHebrew = hebrew;
    const family = greek || hebrew ? new WordFamilyService(greek, hebrew) : null;
    service = new WordStudyService({ bibles: () => openBibles, greek, hebrew, family });
  }
  return service;
}

// ---- saved groups -------------------------------------------------------------

let storePromise: Promise<WordGroupStore> | null = null;

function getGroupStore(): Promise<WordGroupStore> {
  if (!storePromise) {
    storePromise = (async () => {
      const db = await getSharedUserDb();
      initializeUserSchema(db);
      return new WordGroupStore(new UserDataRepository(db));
    })().catch(err => {
      storePromise = null;
      throw err;
    });
  }
  return storePromise;
}

/** Test hook: forget the cached service and store. */
export function resetWordStudyForTests(): void {
  service = null;
  serviceGreek = null;
  serviceHebrew = null;
  openBibles = new Map();
  storePromise = null;
}

// ---- registration ---------------------------------------------------------------

export function registerWordStudyHandlers(_ipcMain: IpcMain): void {
  ipcHandler<[string], WordKeyCandidate[]>('wordStudy:resolve', async (query) => {
    const q = validateString(query, 'query', WORD_STUDY_LIMITS.query);
    return (await getService()).resolve(q);
  });

  ipcHandler<[unknown, unknown?], WordStudyOverview>('wordStudy:getOverview', async (subject, options) => {
    const s = validateSubject(subject);
    const o = validateOptions(options);
    return (await getService()).getOverview(s, o);
  });

  ipcHandler<[unknown, unknown], WordOccurrencePage>('wordStudy:getOccurrences', async (subject, query) => {
    const s = validateSubject(subject);
    const q = validateOccurrenceQuery(query);
    return (await getService()).getOccurrences(s, q);
  });

  ipcHandler<[], WordGroup[]>('wordStudy:listGroups', async () => (await getGroupStore()).list());

  ipcHandler<[unknown], WordGroup>('wordStudy:saveGroup', async (group) => {
    const draft = validateGroupDraft(group);
    return (await getGroupStore()).save(draft);
  });

  ipcHandler<[string], boolean>('wordStudy:deleteGroup', async (id) => {
    const key = validateString(id, 'group id', WORD_STUDY_LIMITS.id);
    return (await getGroupStore()).remove(key);
  });
}
