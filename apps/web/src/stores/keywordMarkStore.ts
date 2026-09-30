/**
 * Keyword-mark state for the web reader (task 0065).
 *
 * Holds the keyword sets (a `KeywordSetService` over an `IKeywordSetStore`,
 * the web user-data store, `getUserData()`, with the old localStorage blob migrated once), per-pane state
 * (`enabled`, `activeSetIds`, `hiddenMarkIds`, persisted per pane), the
 * colour-safe flag, and a per-chapter interlinear cache. It also memoises the
 * match for the chapter in view. The legend / occurrences / suggestion
 * selectors and the toggle / add actions are what the toolbar and legend UI
 * call.
 */
import {
  BUILT_IN_KEYWORD_SETS,
  KeywordSetService,
  suggestKeywords,
  occurrencesOf,
  type ChapterInput,
  type IKeywordSetStore,
  type InterlinearSpan,
  type KeywordMark,
  type KeywordSet,
  type KeywordSuggestion,
  type KeywordValidationError,
  type MatchRule,
  type StringStorage,
} from '@bible/core/browser';
import { Store } from './Store';
import { WebKeywordSetStore, onKeywordSetsChangedElsewhere } from '../keywordMarks/userDataSetStore';
import { webSettings } from './settingsRegistry';
import type { InterlinearWordData, VerseData } from '../types';
import {
  MY_KEYWORDS_SET_NAME,
  buildChapterInput,
  computeChapterMarks,
  findMarkByRule,
  interlinearToSpans,
  newMark,
  ruleForPick,
  type ChapterMarks,
  type LegendRow,
  type WordPick,
} from '../keywordMarks/chapterMarks';

const STORAGE_KEY = 'bible-keyword-marks';

export interface PaneKeywordState {
  /** Marks are painted only while this is on. Off by default. */
  enabled: boolean;
  activeSetIds: string[];
  hiddenMarkIds: string[];
}

export function defaultPaneState(): PaneKeywordState {
  return { enabled: false, activeSetIds: BUILT_IN_KEYWORD_SETS.map((s) => s.id), hiddenMarkIds: [] };
}

/** What the store needs to know about the chapter in view. */
export interface ChapterContext {
  /** `abbr:book:chapter`, identifying the chapter (and so its interlinear cache entry). */
  chapterKey: string;
  moduleId: number;
  language: string;
  verses: readonly VerseData[];
  /** Interlinear spans the caller already holds (Study). Overrides the store's cache. */
  interlinear?: InterlinearSpan[];
}

interface MatchCacheEntry {
  chapterKey: string;
  verses: readonly VerseData[];
  interlinear: InterlinearSpan[] | undefined;
  setsRevision: number;
  paneKey: string;
  marks: ChapterMarks;
}

export interface KeywordMarkStoreOptions {
  storage?: StringStorage | null;
  setStore?: IKeywordSetStore;
}

function defaultStorage(): StringStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export class KeywordMarkStore extends Store {
  sets: KeywordSet[] = [...BUILT_IN_KEYWORD_SETS];
  /** Bumped whenever the sets change; part of the match memo key. */
  setsRevision = 0;
  /** Bumped when an interlinear fetch lands, so consumers recompute. */
  interlinearRevision = 0;

  /** Colour-safe marks: a registry setting (`keywordColorSafe`), shown in Settings > Theme. */
  get colorSafe(): boolean {
    return webSettings.get('keywordColorSafe') !== false;
  }

  private readonly storage: StringStorage | null;
  private readonly service: KeywordSetService;
  private readonly panes = new Map<string, PaneKeywordState>();
  private readonly interlinear = new Map<string, InterlinearSpan[]>();
  private readonly pending = new Set<string>();
  private readonly cache = new Map<string, MatchCacheEntry>();
  private readonly announced = new Map<string, ChapterMarks | null>();
  private initPromise: Promise<void> | null = null;
  private readonly hasCustomSetStore: boolean;

  constructor(opts: KeywordMarkStoreOptions = {}) {
    super();
    this.hasCustomSetStore = !!opts.setStore;
    this.storage = opts.storage === undefined ? defaultStorage() : opts.storage;
    this.service = new KeywordSetService(opts.setStore ?? new WebKeywordSetStore());
    this.readPersisted();
    let lastColorSafe = this.colorSafe;
    webSettings.subscribe(() => {
      if (this.colorSafe !== lastColorSafe) { lastColorSafe = this.colorSafe; this.notify(); }
    });
    this.service.subscribe((sets) => {
      this.sets = sets;
      this.setsRevision++;
      this.notify();
    });
  }

  /** Load the user's sets once. Safe to call from every render. */
  init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.service.load().then(() => undefined, () => undefined);
      if (!this.hasCustomSetStore) {
        onKeywordSetsChangedElsewhere(() => { void this.service.load().catch(() => undefined); });
      }
    }
    return this.initPromise;
  }

  // ---- pane state -------------------------------------------------------

  getPaneState(paneId: string): PaneKeywordState {
    return this.panes.get(paneId) ?? defaultPaneState();
  }

  isEnabled(paneId: string): boolean {
    return this.getPaneState(paneId).enabled;
  }

  private patchPane(paneId: string, patch: Partial<PaneKeywordState>): void {
    this.panes.set(paneId, { ...this.getPaneState(paneId), ...patch });
    this.persist();
    this.notify();
  }

  togglePane(paneId: string, on?: boolean): void {
    this.patchPane(paneId, { enabled: on ?? !this.isEnabled(paneId) });
  }

  setActiveSets(paneId: string, ids: string[]): void {
    this.patchPane(paneId, { activeSetIds: [...new Set(ids)] });
  }

  toggleSet(paneId: string, setId: string): void {
    const ids = this.getPaneState(paneId).activeSetIds;
    this.setActiveSets(paneId, ids.includes(setId) ? ids.filter((i) => i !== setId) : [...ids, setId]);
  }

  /** Show or hide one mark in the legend (hidden marks stay in the legend, unpainted). */
  toggleMark(paneId: string, markId: string): void {
    const hidden = this.getPaneState(paneId).hiddenMarkIds;
    this.patchPane(paneId, {
      hiddenMarkIds: hidden.includes(markId) ? hidden.filter((i) => i !== markId) : [...hidden, markId],
    });
  }

  setColorSafe(on: boolean): void {
    webSettings.set('keywordColorSafe', on);
  }

  /** The sets the pane has switched on (unknown ids, e.g. a deleted set, are ignored). */
  activeSets(paneId: string): KeywordSet[] {
    const ids = new Set(this.getPaneState(paneId).activeSetIds);
    return this.sets.filter((s) => ids.has(s.id));
  }

  // ---- interlinear cache -------------------------------------------------

  getInterlinear(chapterKey: string): InterlinearSpan[] | undefined {
    return this.interlinear.get(chapterKey);
  }

  /** Store rows a caller already has (Study), so a switch to Standard needs no fetch. */
  seedInterlinear(chapterKey: string, rows: readonly InterlinearWordData[]): void {
    if (this.interlinear.has(chapterKey)) return;
    this.interlinear.set(chapterKey, interlinearToSpans(rows));
    this.interlinearRevision++;
  }

  /**
   * Fetch (once per chapter) the interlinear rows a Strong's or connective rule
   * needs. Failures cache an empty result, so an offline module simply keeps
   * word rules only instead of retrying on every render.
   */
  ensureInterlinear(chapterKey: string, fetchRows: () => Promise<readonly InterlinearWordData[]>): void {
    if (this.interlinear.has(chapterKey) || this.pending.has(chapterKey)) return;
    this.pending.add(chapterKey);
    fetchRows().then(
      (rows) => interlinearToSpans(rows),
      () => [] as InterlinearSpan[],
    ).then((spans) => {
      this.pending.delete(chapterKey);
      this.interlinear.set(chapterKey, spans);
      this.interlinearRevision++;
      this.notify();
    });
  }

  // ---- matching ----------------------------------------------------------

  /**
   * Marks for the chapter in view, or null when the pane has them off.
   * Memoised per chapter, verses, interlinear, sets and pane settings.
   */
  getChapterMarks(paneId: string, ctx: ChapterContext): ChapterMarks | null {
    const pane = this.getPaneState(paneId);
    if (!pane.enabled) return null;
    const interlinear = ctx.interlinear ?? this.interlinear.get(ctx.chapterKey);
    const paneKey = `${pane.activeSetIds.join(',')}|${pane.hiddenMarkIds.join(',')}|${this.colorSafe}`;
    const hit = this.cache.get(paneId);
    if (
      hit && hit.chapterKey === ctx.chapterKey && hit.verses === ctx.verses
      && hit.interlinear === interlinear && hit.setsRevision === this.setsRevision && hit.paneKey === paneKey
    ) return hit.marks;
    const input = buildChapterInput(ctx.moduleId, ctx.language, ctx.verses, interlinear);
    const marks = computeChapterMarks(input, this.activeSets(paneId), {
      colorSafe: this.colorSafe, hiddenMarkIds: new Set(pane.hiddenMarkIds),
    });
    this.cache.set(paneId, {
      chapterKey: ctx.chapterKey, verses: ctx.verses, interlinear, setsRevision: this.setsRevision, paneKey, marks,
    });
    return marks;
  }

  /** The last computed marks for a pane (what the legend shows). */
  private lastMarks(paneId: string): ChapterMarks | null {
    return this.isEnabled(paneId) ? this.cache.get(paneId)?.marks ?? null : null;
  }

  /**
   * Called (from an effect) after a render computed new marks, so subscribers that only read the
   * legend, such as the toolbar button, re-render with it. Notifies only when the marks changed.
   */
  marksComputed(paneId: string): void {
    const marks = this.cache.get(paneId)?.marks ?? null;
    if (this.announced.get(paneId) === marks) return;
    this.announced.set(paneId, marks);
    this.notify();
  }

  /** Whether the current match wants interlinear rows to do better (Strong's rules, anchored connectives). */
  wantsInterlinear(marks: ChapterMarks | null): boolean {
    return !!marks && (marks.result.needsInterlinear || marks.result.wantsInterlinear);
  }

  // ---- selectors for the UI ---------------------------------------------

  legend(paneId: string): LegendRow[] {
    return this.lastMarks(paneId)?.legend ?? [];
  }

  occurrencesOf(paneId: string, markId: string): { verseId: number; start: number; end: number }[] {
    const marks = this.lastMarks(paneId);
    return marks ? occurrencesOf(marks.result, markId) : [];
  }

  /** Words worth marking in this chapter. Works while marks are off, from the chapter input alone. */
  suggestKeywords(input: ChapterInput | null | undefined): KeywordSuggestion[] {
    return input ? suggestKeywords(input) : [];
  }

  // ---- actions that create marks ----------------------------------------

  /** Add a mark with `rule` to the user's "My keywords" set and switch it on in the pane. Returns the mark id. */
  async addMark(paneId: string, rule: MatchRule, label: string): Promise<string> {
    await this.init();
    const existing = findMarkByRule(this.sets, rule);
    let markId: string;
    let setId: string;
    if (existing) {
      markId = existing.id;
      setId = this.sets.find((s) => s.marks.some((m) => m.id === existing.id))!.id;
    } else {
      const mark = newMark(rule, label, this.sets);
      await this.appendToMine(paneId, mark);
      return mark.id;
    }
    const pane = this.getPaneState(paneId);
    this.patchPane(paneId, {
      enabled: true,
      activeSetIds: pane.activeSetIds.includes(setId) ? pane.activeSetIds : [...pane.activeSetIds, setId],
      hiddenMarkIds: pane.hiddenMarkIds.filter((i) => i !== markId),
    });
    return markId;
  }

  /** Mark every occurrence of a tapped word (`'word'`) or of its Strong's number (`'strongs'`). Null when the pick has nothing to match. */
  async addMarkFromWord(paneId: string, pick: WordPick, kind: 'word' | 'strongs'): Promise<string | null> {
    const rule = ruleForPick(pick, kind);
    if (!rule) return null;
    const word = pick.text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    const label = rule.kind === 'strongs' ? `${word} (${rule.numbers[0]})`.trim() : word;
    return this.addMark(paneId, rule, label);
  }

  /** Append `mark` to "My keywords" (created on demand) and switch that set on in the pane. */
  private async appendToMine(paneId: string, mark: KeywordMark): Promise<void> {
    let mine = this.sets.find((s) => !s.builtIn && s.name === MY_KEYWORDS_SET_NAME);
    if (!mine) mine = await this.service.create(MY_KEYWORDS_SET_NAME);
    await this.service.addMark(mine.id, mark);
    const pane = this.getPaneState(paneId);
    this.patchPane(paneId, {
      enabled: true,
      activeSetIds: pane.activeSetIds.includes(mine.id) ? pane.activeSetIds : [...pane.activeSetIds, mine.id],
      hiddenMarkIds: pane.hiddenMarkIds.filter((i) => i !== mark.id),
    });
  }

  // ---- set management (the Manage sets dialog and the mark editor) --------

  /** Whether the last match wants Strong's data it does not have (the legend then says so). */
  needsInterlinear(paneId: string): boolean {
    const marks = this.lastMarks(paneId);
    return !!marks && marks.result.needsInterlinear && !marks.input.interlinear;
  }

  /** A mark and the set that holds it. */
  findMark(markId: string): { set: KeywordSet; mark: KeywordMark } | undefined {
    for (const set of this.sets) {
      const mark = set.marks.find((m) => m.id === markId);
      if (mark) return { set, mark };
    }
    return undefined;
  }

  /** Save an edited mark in its (user) set, or add a new one to "My keywords". */
  async saveMark(paneId: string, mark: KeywordMark): Promise<void> {
    await this.init();
    const found = this.findMark(mark.id);
    if (!found) {
      await this.appendToMine(paneId, mark);
      return;
    }
    if (found.set.builtIn) throw new Error('Built-in marks are read-only.');
    await this.service.save({ ...found.set, marks: found.set.marks.map((m) => (m.id === mark.id ? mark : m)) });
  }

  async deleteMark(markId: string): Promise<void> {
    const found = this.findMark(markId);
    if (!found || found.set.builtIn) return;
    await this.service.save({ ...found.set, marks: found.set.marks.filter((m) => m.id !== markId) });
  }

  duplicateSet(id: string): Promise<KeywordSet> { return this.service.duplicate(id); }
  removeSet(id: string): Promise<void> { return this.service.remove(id); }
  exportSet(id: string): string { return this.service.export(id); }
  importSet(text: string): Promise<KeywordSet | KeywordValidationError[]> { return this.service.import(text); }

  // ---- persistence -------------------------------------------------------

  private readPersisted(): void {
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as { colorSafe?: unknown; panes?: Record<string, Partial<PaneKeywordState>> };
      // Before the settings registry, colour-safe lived in this blob: carry a saved choice over once.
      if (typeof data.colorSafe === 'boolean') {
        if (data.colorSafe === false && webSettings.get('keywordColorSafe') === true) webSettings.set('keywordColorSafe', false);
        delete data.colorSafe;
        this.storage?.setItem(STORAGE_KEY, JSON.stringify(data));
      }
      for (const [id, p] of Object.entries(data.panes ?? {})) {
        const d = defaultPaneState();
        this.panes.set(id, {
          enabled: p.enabled === true,
          activeSetIds: Array.isArray(p.activeSetIds) ? p.activeSetIds.filter((x) => typeof x === 'string') : d.activeSetIds,
          hiddenMarkIds: Array.isArray(p.hiddenMarkIds) ? p.hiddenMarkIds.filter((x) => typeof x === 'string') : [],
        });
      }
    } catch { /* corrupt or unavailable storage: start from defaults */ }
  }

  private persist(): void {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify({
        panes: Object.fromEntries(this.panes),
      }));
    } catch { /* quota or private mode */ }
  }
}

export const keywordMarkStore = new KeywordMarkStore();
