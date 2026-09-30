/**
 * Similar passages IPC (task 0070): `similar:find`, `similar:explain`, `similar:status`.
 *
 * The logic lives in `createSimilarApi(env)` over an injected environment so tests can use
 * fakes; `registerSimilarHandlers` wires the real repositories, asset store and semantic
 * search service. Payload types are in `similarTypes.ts`.
 */
import { readFileSync } from 'fs';
import type { IpcMain } from 'electron';
import log from 'electron-log';
import {
  BIBLE_SECTIONS,
  SimilarPassagesService,
  createSemanticVectorSource,
  explainMatch,
  formatVerseText,
  gatherPassageFacts,
  resolveSimilarWeights,
} from '@bible/core';
import type {
  BibleSectionKey,
  IPassageVectorSource,
  InterlinearFact,
  MatchReason,
  PassageRange,
  SemanticLevel,
  SemanticSearchService,
  SimilarOptions,
  SimilarWeights,
  TopicFact,
} from '@bible/core';
import { ipcHandler } from './handler-helper';
import { IpcKnownError } from './result';
import { formatSemanticReference } from './searchHelpers';
import type { SimilarFindResponse, SimilarRowDto, SimilarStatus } from './similarTypes';
import { SimilarTableProvider } from '../services/similarTable';
import type { SimilarAssetSource } from '../services/similarTable';

export type {
  SimilarFindResponse,
  SimilarRowDto,
  SimilarStatus,
  SimilarUnavailableReason,
  SimilarTableState,
} from './similarTypes';

/** Longest selection (in verses) accepted. */
export const MAX_SPAN_VERSES = 200;
export const MAX_RESULTS_CAP = 100;
const MAX_TOPIC_VERSES = 60;

// --- Environment seam --------------------------------------------------------------

/** The slice of a Bible repository used here. */
export interface SimilarBibleRepo {
  getVerse(verseId: number): { verseId: number } | undefined;
  getVerseRange(start: number, end: number): Array<{ verseId: number }>;
  getInterlinearWordsForRange?(
    start: number,
    end: number
  ): Map<number, Array<{ strongsNumber?: string; lemma?: string; gloss?: string }>>;
}

export interface SimilarEnv {
  table: Pick<SimilarTableProvider, 'current' | 'ensure'>;
  /** The semantic search service when the pack is installed (no loading forced here). */
  getSemanticSearchService: () => SemanticSearchService | null;
  /** Module cross-reference links touching a passage (either direction) plus the user's own. */
  crossRefsFor: (r: PassageRange) => Promise<PassageRange[]>;
  bibleRepo: (module: string) => Promise<SimilarBibleRepo | null>;
  /** The default Bible abbreviation when the caller names none. */
  defaultModule: () => string | undefined;
  languageOf: (module: string) => string;
  bookName: (bookNumber: number) => string;
  topicRepos: () => Array<{
    abbreviation: string;
    repo: { getTopicsByVerse(verseId: number): Array<{ name: string }> };
  }>;
  weights?: SimilarWeights;
  fallbackModule?: string;
}

export interface SimilarApi {
  find(range: unknown, opts?: unknown, module?: unknown): Promise<SimilarFindResponse>;
  explain(a: unknown, b: unknown, module?: unknown): Promise<MatchReason[]>;
  status(): Promise<SimilarStatus>;
  reset(): void;
}

// --- Validation --------------------------------------------------------------------

function bad(message: string): never {
  throw new IpcKnownError('invalid_input', message);
}

export function validateRange(value: unknown, name = 'range'): PassageRange {
  if (!value || typeof value !== 'object') bad(`${name} must be an object`);
  const { startVerseId, endVerseId } = value as Record<string, unknown>;
  for (const [k, v] of [['startVerseId', startVerseId], ['endVerseId', endVerseId]] as const) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) bad(`${name}.${k} must be a positive integer`);
  }
  const start = startVerseId as number;
  const end = endVerseId as number;
  if (end < start) bad(`${name}: endVerseId must be >= startVerseId`);
  if (end - start >= MAX_SPAN_VERSES * 1000) bad(`${name} is too long`);
  return { startVerseId: start, endVerseId: end };
}

/** Verses a range spans, counted by id arithmetic within the chapter; different chapters count by chapter. */
function spanVerses(r: PassageRange): number {
  const chapter = (id: number) => Math.floor(id / 1000);
  if (chapter(r.startVerseId) === chapter(r.endVerseId)) return r.endVerseId - r.startVerseId + 1;
  // Across chapters: assume a worst case of 176 verses per chapter boundary crossed.
  return (chapter(r.endVerseId) - chapter(r.startVerseId) + 1) * 40;
}

function checkSpan(r: PassageRange, name: string): PassageRange {
  if (spanVerses(r) > MAX_SPAN_VERSES) bad(`${name} spans more than ${MAX_SPAN_VERSES} verses`);
  return r;
}

const LEVELS: SemanticLevel[] = ['verse', 'paragraph', 'chapter'];
const SECTION_KEYS = new Set<string>(BIBLE_SECTIONS.map(s => s.key));

function intIn(v: unknown, key: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) bad(`options.${key} must be an integer ${min}..${max}`);
  return v as number;
}

function oneOf<T extends string>(v: unknown, key: string, allowed: readonly T[]): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) bad(`options.${key} must be one of ${allowed.join(', ')}`);
  return v as T;
}

/** Copy only the known option keys, with type checks; unknown keys are dropped. */
export function sanitizeOptions(raw: unknown): SimilarOptions {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) bad('options must be an object');
  const o = raw as Record<string, unknown>;
  const out: SimilarOptions = {};
  if (o.maxResults !== undefined) out.maxResults = intIn(o.maxResults, 'maxResults', 1, MAX_RESULTS_CAP);
  if (o.levels !== undefined) {
    if (!Array.isArray(o.levels) || o.levels.length === 0 || o.levels.length > LEVELS.length) bad('options.levels must be a non-empty array');
    out.levels = [...new Set(o.levels.map(l => oneOf(l, 'levels[]', LEVELS)))];
  }
  if (o.excludeNearby !== undefined) out.excludeNearby = intIn(o.excludeNearby, 'excludeNearby', 0, 1000);
  for (const k of ['excludeSameChapter', 'excludeSameBook'] as const) {
    if (o[k] !== undefined) {
      if (typeof o[k] !== 'boolean') bad(`options.${k} must be a boolean`);
      out[k] = o[k] as boolean;
    }
  }
  if (o.testament !== undefined) out.testament = oneOf(o.testament, 'testament', ['any', 'ot', 'nt', 'other'] as const);
  if (o.sections !== undefined) {
    if (!Array.isArray(o.sections) || o.sections.length > 20) bad('options.sections must be an array');
    out.sections = o.sections.map(s => {
      if (typeof s !== 'string' || !SECTION_KEYS.has(s)) bad('options.sections has an unknown section');
      return s as BibleSectionKey;
    });
  }
  if (o.crossRefs !== undefined) out.crossRefs = oneOf(o.crossRefs, 'crossRefs', ['flag', 'hide', 'ignore'] as const);
  if (o.perBookCap !== undefined) out.perBookCap = intIn(o.perBookCap, 'perBookCap', 0, MAX_RESULTS_CAP);
  if (o.minSimilarity !== undefined) {
    if (typeof o.minSimilarity !== 'number' || !Number.isFinite(o.minSimilarity)) bad('options.minSimilarity must be a number');
    out.minSimilarity = o.minSimilarity as number;
  }
  if (o.source !== undefined) out.source = oneOf(o.source, 'source', ['auto', 'table', 'live'] as const);
  return out;
}

function sanitizeModule(v: unknown): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string' || v.length > 64 || /[\\/:*?"<>|]|\.\./.test(v)) bad('module is not a valid module name');
  return v;
}

// --- Hydration ---------------------------------------------------------------------

function verseHtml(verse: { verseId: number }): string {
  return formatVerseText(verse as never).textHtml;
}

// --- API ---------------------------------------------------------------------------

export function createSimilarApi(env: SimilarEnv): SimilarApi {
  let cachedSvc: SemanticSearchService | null = null;
  let cachedSource: IPassageVectorSource | null = null;

  const liveSource = (): IPassageVectorSource | null => {
    const svc = env.getSemanticSearchService();
    if (!svc || !svc.isAvailable()) return null;
    if (svc !== cachedSvc) {
      cachedSvc = svc;
      cachedSource = createSemanticVectorSource(svc);
    }
    return cachedSource;
  };

  const service = new SimilarPassagesService({
    live: liveSource,
    table: () => env.table.current(),
    crossRefsFor: env.crossRefsFor,
    weights: env.weights,
  });

  async function reposFor(module: string | undefined) {
    const primaryName = module ?? env.defaultModule() ?? env.fallbackModule ?? 'KJV';
    const fallbackName = env.fallbackModule ?? 'KJV';
    const primary = await env.bibleRepo(primaryName).catch(() => null);
    const fallback =
      primaryName.toLowerCase() === fallbackName.toLowerCase() ? null : await env.bibleRepo(fallbackName).catch(() => null);
    return { primaryName, primary, fallback };
  }

  /** Display text of a passage, `maxVerses` verses at most (then an ellipsis). */
  function passageText(repos: Array<SimilarBibleRepo | null>, r: PassageRange, maxVerses: number): string {
    for (const repo of repos) {
      if (!repo) continue;
      try {
        if (r.startVerseId === r.endVerseId) {
          const v = repo.getVerse(r.startVerseId);
          if (v) return verseHtml(v);
          continue;
        }
        const verses = repo.getVerseRange(r.startVerseId, r.endVerseId);
        if (verses.length === 0) continue;
        const head = verses.slice(0, maxVerses).map(verseHtml).join(' ');
        return verses.length > maxVerses ? `${head} …` : head;
      } catch (e) {
        log.warn('[Similar] text lookup failed', e);
      }
    }
    return '';
  }

  async function find(rangeRaw: unknown, optsRaw?: unknown, moduleRaw?: unknown): Promise<SimilarFindResponse> {
    const range = checkSpan(validateRange(rangeRaw), 'range');
    const opts = sanitizeOptions(optsRaw);
    const module = sanitizeModule(moduleRaw);

    const tableState = await env.table.ensure(true);
    const live = liveSource() !== null;
    const tableReady = tableState === 'ready' && env.table.current() !== null;

    if (!tableReady && !live) {
      if (tableState === 'downloading' || tableState === 'available') return { status: 'preparing' };
      return { status: 'unavailable', unavailableReason: 'no-table-no-pack' };
    }

    const result = await service.findSimilar(range, opts);
    if (result.via === 'none') {
      return {
        status: 'unavailable',
        unavailableReason: result.reason === 'range-needs-live' ? 'range-needs-live' : 'no-data',
      };
    }

    const { primary, fallback } = await reposFor(module);
    const repos = [primary, fallback];
    const rows: SimilarRowDto[] = result.passages.map(p => {
      const reference = formatSemanticReference(p.startVerseId, p.endVerseId, env.bookName);
      const text = passageText(repos, p, p.level === 'verse' ? 1 : 2);
      return { ...p, key: `${p.level}|${p.startVerseId}|${p.endVerseId}`, reference, text };
    });
    return { status: 'ok', result: { ...result, rows } };
  }

  async function factsFor(r: PassageRange, module: string | undefined) {
    const { primaryName, primary, fallback } = await reposFor(module);
    const repo = primary ?? fallback;
    const verseIds = (): number[] => {
      try {
        return (repo?.getVerseRange(r.startVerseId, r.endVerseId) ?? []).map(v => v.verseId).slice(0, MAX_TOPIC_VERSES);
      } catch {
        return [];
      }
    };
    return gatherPassageFacts(r, {
      language: env.languageOf(primary ? primaryName : env.fallbackModule ?? 'KJV'),
      text: () => passageText([primary, fallback], r, MAX_SPAN_VERSES),
      interlinear: (): InterlinearFact[] => {
        if (!repo?.getInterlinearWordsForRange) return [];
        const out: InterlinearFact[] = [];
        for (const words of repo.getInterlinearWordsForRange(r.startVerseId, r.endVerseId).values()) {
          for (const w of words) out.push({ strongs: w.strongsNumber, lemma: w.lemma, gloss: w.gloss });
        }
        return out;
      },
      topics: (): TopicFact[] => {
        const ids = verseIds();
        const out: TopicFact[] = [];
        for (const { abbreviation, repo: topicRepo } of env.topicRepos()) {
          const lower = abbreviation.toLowerCase();
          const source: TopicFact['source'] = lower.includes('nave') ? 'naves' : lower.includes('torrey') ? 'torrey' : 'tag';
          for (const id of ids) {
            try {
              for (const t of topicRepo.getTopicsByVerse(id)) if (t.name) out.push({ label: t.name, source });
            } catch {
              // a broken topical module must not lose the explanation
            }
          }
        }
        return out;
      },
    });
  }

  return {
    find,
    async explain(aRaw, bRaw, moduleRaw) {
      const a = checkSpan(validateRange(aRaw, 'a'), 'a');
      const b = checkSpan(validateRange(bRaw, 'b'), 'b');
      const module = sanitizeModule(moduleRaw);
      const [fa, fb] = await Promise.all([factsFor(a, module), factsFor(b, module)]);
      return explainMatch(fa, fb);
    },
    async status() {
      const state = await env.table.ensure(false);
      return {
        table: state === 'ready' && env.table.current() ? 'ready' : state === 'ready' ? 'missing' : state,
        live: liveSource() !== null,
      };
    },
    reset: () => service.reset(),
  };
}

// --- Real wiring -------------------------------------------------------------------

function loadWeights(): SimilarWeights {
  const raw = process.env.BIBLE_SIMILAR_WEIGHTS;
  if (!raw) return resolveSimilarWeights();
  try {
    const text = raw.trim().startsWith('{') ? raw : readFileSync(raw, 'utf8');
    return resolveSimilarWeights(JSON.parse(text));
  } catch (e) {
    log.warn('[Similar] could not read BIBLE_SIMILAR_WEIGHTS; using defaults', e);
    return resolveSimilarWeights();
  }
}

let activeApi: SimilarApi | null = null;

/** Drop cached results (a semantic pack change, or a table arriving). */
export function resetSimilarPassages(): void {
  activeApi?.reset();
}

async function buildDefaultEnv(): Promise<SimilarEnv> {
  // Loaded on first use: these pull in the whole handler graph.
  const [{ getSemanticSearchService }, bible, study, xref, topical, sharedDb, assets, defaults] = await Promise.all([
    import('./searchHandlers'),
    import('./bibleHandlers'),
    import('./studyHandlers'),
    import('./crossReferenceHandlers'),
    import('./topicalIndexHandlers'),
    import('../services/sharedMainDb'),
    import('../services/assets/AssetService'),
    import('./defaultBible'),
  ]);

  const tableProvider = new SimilarTableProvider({
    getAssetService: () => assets.getAssetService() as unknown as SimilarAssetSource,
    onChange: resetSimilarPassages,
  });

  const installedBibles = () =>
    sharedDb.getSharedModuleMetadataRepo().getByType('bible');

  const crossRefsFor = async (r: PassageRange): Promise<PassageRange[]> => {
    const out: PassageRange[] = [];
    const meta = sharedDb.getSharedModuleMetadataRepo();
    for (const mod of meta.getByType('cross_reference')) {
      const abbreviation = mod.abbreviation || mod.getAbbreviation();
      const repo = await xref.ensureXrefRepository(abbreviation);
      if (!repo) continue;
      for (const g of repo.getGroupsWithEntriesForRange(r.startVerseId, r.endVerseId)) {
        for (const e of g.entries) {
          out.push({ startVerseId: e.targetVerseId, endVerseId: e.targetVerseEndId ?? e.targetVerseId });
        }
      }
      for (const rr of repo.getReverseReferencesForRange(r.startVerseId, r.endVerseId)) {
        out.push({ startVerseId: rr.sourceVerseId, endVerseId: rr.sourceVerseId });
      }
    }
    const user = study.getUserXrefRepoForLinks();
    if (user) {
      for (const x of user.getFromVerseRange(r.startVerseId, r.endVerseId)) {
        out.push({ startVerseId: x.toVerseIdStart, endVerseId: x.toVerseIdEnd });
      }
      const last = Math.min(r.endVerseId, r.startVerseId + MAX_SPAN_VERSES - 1);
      for (let id = r.startVerseId; id <= last; id++) {
        for (const x of user.getToVerse(id)) {
          out.push({ startVerseId: x.fromVerseIdStart, endVerseId: x.fromVerseIdEnd });
        }
      }
    }
    return out;
  };

  return {
    table: tableProvider,
    getSemanticSearchService,
    crossRefsFor,
    bibleRepo: async module => (await bible.ensureBibleRepository(module)) as unknown as SimilarBibleRepo | null,
    defaultModule: () =>
      defaults.pickDefaultBible(installedBibles().map(m => ({ abbreviation: m.abbreviation || m.getAbbreviation() }))),
    languageOf: module => {
      const mod = installedBibles().find(m => (m.abbreviation || m.getAbbreviation()).toLowerCase() === module.toLowerCase());
      return (mod?.languageCode || 'en').split('-')[0].toLowerCase();
    },
    bookName: n => sharedDb.getSharedBookRepo().getByBookNumber(n)?.bookName || `Book ${n}`,
    topicRepos: () => topical.getAllTopicalRepos(),
    weights: loadWeights(),
  };
}

export function registerSimilarHandlers(_ipcMain: IpcMain): void {
  let api: Promise<SimilarApi> | null = null;
  const get = (): Promise<SimilarApi> =>
    (api ??= buildDefaultEnv().then(env => {
      const created = createSimilarApi(env);
      activeApi = created;
      return created;
    }));

  ipcHandler<[unknown, unknown?, unknown?], SimilarFindResponse>('similar:find', async (range, opts, module) =>
    (await get()).find(range, opts, module)
  );
  ipcHandler<[unknown, unknown, unknown?], MatchReason[]>('similar:explain', async (a, b, module) =>
    (await get()).explain(a, b, module)
  );
  ipcHandler<[], SimilarStatus>('similar:status', async () => (await get()).status());
}
