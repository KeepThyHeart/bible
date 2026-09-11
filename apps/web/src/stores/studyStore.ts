import { Store } from './Store';
import { eventBus } from '../events/eventBus';
import { bibleStore } from './bibleStore';
import type { PendingTopicNav } from './commentaryStore';
import type {
  ICrossRefDataProvider,
  ITopicalDataProvider,
  ITagGraphDataProvider,
  IInterlinearDataProvider,
  IStudyOverviewProvider,
} from '../providers/interfaces';
import type {
  CrossRefGroupData,
  VerseTopicData,
  TagGraphEntityData,
  InterlinearData,
  VerseFootnote,
} from '../types';

/**
 * The Study pane's data, loaded only once something is on screen to show it.
 *
 * Every one of these sections used to load the moment the reader selected a
 * verse — which `useAppShared` does for verse 1 of every chapter the reader
 * lands on, whether or not the Study pane is the one being displayed. Only one
 * right-hand pane is mounted at a time (`DesktopApp.tsx`), and the pane's own
 * sections are collapsed until opened (`StudySection` renders no children while
 * collapsed), so a reader sitting in the Commentary pane was paying for
 * interlinear, cross-references, topics and entities on every chapter change
 * and never seeing any of it — the interlinear alone is ~155 KB a chapter.
 *
 * So `loadForVerse` now only *invalidates*: it records the new verse and marks
 * each section stale. The components that actually render a section call its
 * `ensure*` method from an effect, which is the point at which a request is
 * worth making. A section nobody has opened costs nothing; one that is open
 * reloads exactly as before, because its effect re-runs on the verse change.
 */
class StudyStore extends Store {
  private crossRefProvider: ICrossRefDataProvider | null = null;
  private topicalProvider: ITopicalDataProvider | null = null;
  /** Absent when the deployment has the tag graph turned off — see clientConfig. */
  private tagGraphProvider: ITagGraphDataProvider | null = null;
  private interlinearProvider: IInterlinearDataProvider | null = null;
  private studyOverviewProvider: IStudyOverviewProvider | null = null;

  // Current verse (synced from Bible pane unless pinned)
  verseId: number | null = null;
  book: number | null = null;
  chapter: number | null = null;
  verse: number | null = null;
  footnotes: VerseFootnote[] = [];

  // Pin state (single pin for the whole Study pane)
  pinned = false;
  pinnedVerseId: number | null = null;
  pinnedBook: number | null = null;
  pinnedChapter: number | null = null;
  pinnedVerse: number | null = null;

  // Cross-refs data
  crossRefGroups: CrossRefGroupData[] = [];
  crossRefLoading = false;
  crossRefModule = 'TSKxref';

  // Topics data
  verseTopics: VerseTopicData[] = [];
  verseEntities: TagGraphEntityData[] = [];
  topicsLoading = false;

  // Interlinear data
  interlinearData: InterlinearData | null = null;
  interlinearLoading = false;

  /**
   * The selected verse's own display HTML, fetched when the Bible pane is not
   * showing that chapter.
   *
   * The Study pane's interlinear is built from the *translation's* words, so
   * without this the section had nothing to align against and degraded to a
   * list of the module's glosses — different wording, different order, and a
   * blank slot wherever a row (an article, say) has no gloss at all. Read it
   * through `getVerseHtml()`, which will not hand back another verse's text.
   */
  private verseHtml: string | null = null;
  verseHtmlLoading = false;
  /** `module-verseId` the loaded/loading `verseHtml` belongs to. */
  private verseHtmlKey = '';

  // Verse history (cross-chapter jumps for the history dropdown)
  verseHistory: Array<{ verseId: number; timestamp: number }> = [];

  // Mobile study pane: remembered sub-page
  mobileSubPage: 'home' | 'crossrefs' | 'topics' | 'commentary' | 'dictionary' | 'interlinear' | 'summary' = 'home';

  // Topics browser overlay state (for mobile single-page study view)
  topicsBrowserOpen = false;
  /** Topic the mobile Topics overlay should open next. See PendingTopicNav for why it carries a token. */
  pendingTopicNav: PendingTopicNav | null = null;
  private _topicNavToken = 0;

  // Cache keys — what the loaded data belongs to.
  private crossRefLoadedKey = '';
  private topicsLoadedKey = '';
  private interlinearLoadedKey = '';

  // What a request currently out is for. Distinct from the loaded keys, which
  // are only set on arrival; without these, two mounted consumers of the same
  // section each start their own request. Empty means nothing in flight.
  private crossRefInFlightKey = '';
  private topicsInFlightKey = '';
  private interlinearInFlightKey = '';

  init(providers: {
    crossRef: ICrossRefDataProvider;
    topical: ITopicalDataProvider;
    /** Omit to disable the tag graph outright — no provider, no request. */
    tagGraph?: ITagGraphDataProvider;
    interlinear: IInterlinearDataProvider;
    studyOverview: IStudyOverviewProvider;
  }): void {
    this.crossRefProvider = providers.crossRef;
    this.topicalProvider = providers.topical;
    this.tagGraphProvider = providers.tagGraph ?? null;
    this.interlinearProvider = providers.interlinear;
    this.studyOverviewProvider = providers.studyOverview;
    this.restoreSession();
    this.restoreHistory();

    // Subscribe to event bus for decoupled store communication
    eventBus.on('study:load-verse', ({ verseId, book, chapter, verse, footnotes }) => {
      this.loadForVerse(verseId, book, chapter, verse, footnotes);
    });
    eventBus.on('bible:verse-selected', ({ verseId, book, chapter, verse, footnotes }) => {
      this.loadForVerse(verseId, book, chapter, verse, footnotes);
    });
  }

  /**
   * Called when the Bible pane verse changes.
   *
   * Records the verse and marks every section stale; it does not fetch. The
   * `ensure*` methods do that, called from the components that render each
   * section — see the class comment for why.
   *
   * The sections are put into their loading state here rather than in `ensure*`
   * so that a pane opened later renders a spinner on its first frame instead of
   * the previous verse's cross-references.
   */
  loadForVerse(verseId: number, book: number, chapter: number, verse: number, footnotes?: VerseFootnote[]): void {
    if (this.pinned) return;

    this.addToHistory(verseId);
    this.verseId = verseId;
    this.book = book;
    this.chapter = chapter;
    this.verse = verse;
    if (footnotes) this.footnotes = footnotes;

    // Invalidate the per-verse caches. Interlinear is deliberately NOT cleared:
    // its key is `book-chapter`, so clearing it here defeated its own guard and
    // refetched the whole chapter's interlinear data on every verse click. It
    // is recomputed on chapter change, which is the only thing that stales it.
    if (this.crossRefLoadedKey !== `${this.crossRefModule}-${verseId}`) {
      this.crossRefLoadedKey = '';
      this.crossRefLoading = true;
    }
    if (this.topicsLoadedKey !== String(verseId)) {
      this.topicsLoadedKey = '';
      this.topicsLoading = true;
    }
    this.notify();
  }

  /**
   * Load this verse's cross-references if they are not already loaded.
   *
   * Safe and cheap to call on every render pass: it returns immediately once
   * the loaded key matches the current verse.
   */
  ensureCrossRefs(): void {
    if (!this.verseId) return;
    if (this.crossRefLoadedKey === `${this.crossRefModule}-${this.verseId}`) {
      this.settle('crossRefLoading');
      return;
    }
    void this.loadStudyOverviewAndData('crossrefs');
  }

  /** Load this verse's topics and tag-graph entities if not already loaded. */
  ensureTopics(): void {
    if (!this.verseId) return;
    if (this.topicsLoadedKey === String(this.verseId)) {
      this.settle('topicsLoading');
      return;
    }
    void this.loadStudyOverviewAndData('topics');
  }

  /**
   * Load the chapter's interlinear rows, and the verse's own text to align them
   * against, if not already loaded.
   *
   * Only the interlinear section needs either, and it is collapsed by default —
   * which is why neither is loaded until it is opened.
   */
  ensureInterlinear(): void {
    void this.loadInterlinear();
    void this.loadVerseText();
  }

  /** Lower a loading flag that has nothing left to wait for. */
  private settle(flag: 'crossRefLoading' | 'topicsLoading'): void {
    if (!this[flag]) return;
    this[flag] = false;
    this.notify();
  }

  pin(): void {
    this.pinned = true;
    this.pinnedVerseId = this.verseId;
    this.pinnedBook = this.book;
    this.pinnedChapter = this.chapter;
    this.pinnedVerse = this.verse;
    this.saveSession();
    this.notify();
  }

  unpin(): void {
    // Keep the pinned verse data as the current verse if nothing else is active
    if (this.pinnedVerseId && !this.verseId) {
      this.verseId = this.pinnedVerseId;
      this.book = this.pinnedBook;
      this.chapter = this.pinnedChapter;
      this.verse = this.pinnedVerse;
    }
    this.pinned = false;
    this.pinnedVerseId = null;
    this.pinnedBook = null;
    this.pinnedChapter = null;
    this.pinnedVerse = null;
    this.saveSession();
    this.notify();
  }

  setMobileSubPage(page: 'home' | 'crossrefs' | 'topics' | 'commentary' | 'dictionary' | 'interlinear' | 'summary'): void {
    this.mobileSubPage = page;
    this.saveSession();
    this.notify();
  }

  openTopicsBrowser(topic?: { topicId: number; module: string; topicName: string; sourceName?: string }): void {
    this.pendingTopicNav = topic ? { ...topic, token: ++this._topicNavToken } : null;
    this.topicsBrowserOpen = true;
    this.notify();
  }

  consumePendingTopicNav(): PendingTopicNav | null {
    const nav = this.pendingTopicNav;
    if (nav) {
      this.pendingTopicNav = null;
      this.notify();
    }
    return nav;
  }

  closeTopicsBrowser(): void {
    this.topicsBrowserOpen = false;
    this.pendingTopicNav = null;
    this.notify();
  }

  // ========== Private: data loading ==========

  // Cache key for the currently loaded chapter overview
  private overviewLoadedChapter = '';

  /**
   * Loads the chapter-level study overview (commentary, topics, xrefs, entities)
   * from the pre-generated cache, then populates per-verse data from it.
   * Falls back to a per-verse provider call for `section` if the cache is
   * unavailable.
   *
   * The overview answers both sections at once, so whichever is asked for first
   * pays for it and the other is free. `section` only narrows the *fallback*:
   * with no study cache on the server there is no shared answer to reuse, and
   * fetching topics because the reader opened cross-references would put back
   * exactly the speculative request this is here to remove.
   */
  private async loadStudyOverviewAndData(section: 'crossrefs' | 'topics'): Promise<void> {
    if (!this.verseId || !this.book || !this.chapter) return;

    const chapterKey = `${this.book}-${this.chapter}`;
    const verseId = this.verseId;
    const book = this.book;
    const chapter = this.chapter;

    // Ensure the chapter overview is loaded (one request per chapter)
    if (this.studyOverviewProvider && this.overviewLoadedChapter !== chapterKey) {
      try {
        await this.studyOverviewProvider.loadChapter(book, chapter);
        this.overviewLoadedChapter = chapterKey;
      } catch {
        // Fall through to per-verse providers
      }
    }

    // If overview is available, use it for cross-refs, topics, and entities
    if (this.studyOverviewProvider?.hasChapter(book, chapter)) {
      this.populateFromOverview(verseId, book, chapter);
    } else if (section === 'crossrefs') {
      await this.loadCrossRefs();
    } else {
      await this.loadTopics();
    }
  }

  /** Populate cross-refs, topics, and entities from the cached chapter overview. */
  private populateFromOverview(verseId: number, book: number, chapter: number): void {
    const provider = this.studyOverviewProvider!;

    // Cross-refs
    const crossRefKey = `${this.crossRefModule}-${verseId}`;
    if (this.crossRefLoadedKey !== crossRefKey) {
      this.crossRefGroups = provider.getCrossRefsForVerse(book, chapter, verseId);
      this.crossRefLoadedKey = crossRefKey;
    }

    // Topics + entities
    const topicsKey = `${verseId}`;
    if (this.topicsLoadedKey !== topicsKey) {
      this.verseTopics = provider.getTopicsForVerse(book, chapter, verseId);
      this.verseEntities = provider.getEntitiesForVerse(book, chapter, verseId);
      this.topicsLoadedKey = topicsKey;
    }

    this.crossRefLoading = false;
    this.topicsLoading = false;
    this.notify();
  }

  private async loadCrossRefs(): Promise<void> {
    if (!this.verseId) return;
    const key = `${this.crossRefModule}-${this.verseId}`;
    if (this.crossRefLoadedKey === key) return;
    // The loaded key is only set once the response lands, so it cannot stand in
    // for "a request is already out". Two mounted consumers of the same section
    // (the mobile pane renders the topics list and the browser overlay from the
    // same state) would otherwise each start one.
    if (this.crossRefInFlightKey === key) return;
    this.crossRefInFlightKey = key;

    this.crossRefLoading = true;
    this.notify();

    try {
      const groups = await this.crossRefProvider?.getGroupsForVerse(this.crossRefModule, this.verseId);
      this.crossRefGroups = groups ?? [];
      this.crossRefLoadedKey = key;
    } catch (error) {
      console.error('Error loading cross-references:', error);
      this.crossRefGroups = [];
    } finally {
      this.crossRefInFlightKey = '';
    }

    this.crossRefLoading = false;
    this.notify();
  }

  private async loadTopics(): Promise<void> {
    if (!this.verseId) return;
    const key = `${this.verseId}`;
    if (this.topicsLoadedKey === key) return;
    if (this.topicsInFlightKey === key) return;  // see loadCrossRefs
    this.topicsInFlightKey = key;

    this.topicsLoading = true;
    this.notify();

    try {
      const [topics, entities] = await Promise.all([
        this.topicalProvider?.getTopicsForVerse(this.verseId) ?? Promise.resolve([]),
        this.tagGraphProvider
          ? this.tagGraphProvider.getEntitiesForVerse(this.verseId)
          : Promise.resolve([]),
      ]);
      this.verseTopics = topics;
      this.verseEntities = entities;
      this.topicsLoadedKey = key;
    } catch (error) {
      console.error('Error loading topics:', error);
      this.verseTopics = [];
      this.verseEntities = [];
    } finally {
      this.topicsInFlightKey = '';
    }

    this.topicsLoading = false;
    this.notify();
  }

  private async loadInterlinear(): Promise<void> {
    if (!this.book || !this.chapter) return;
    // The module belongs in the cache key: without it, switching translations
    // kept serving the previous one's interlinear for the same chapter.
    const moduleAbbr = bibleStore.getActiveTab()?.moduleAbbr;
    // Without a module the server falls back to KJV, and those rows would be
    // aligned against whatever translation the reader is actually on. Wait for
    // a tab instead; the next verse selection retries.
    if (!moduleAbbr) return;
    const key = `${moduleAbbr}-${this.book}-${this.chapter}`;
    if (this.interlinearLoadedKey === key) return;
    if (this.interlinearInFlightKey === key) return;  // see loadCrossRefs
    this.interlinearInFlightKey = key;

    this.interlinearLoading = true;
    this.notify();

    try {
      // Passing the module stops this defaulting to KJV's interlinear on the
      // server regardless of which translation the reader has open.
      const data = await this.interlinearProvider?.getInterlinear(this.book, this.chapter, moduleAbbr);
      this.interlinearData = data ?? null;
      this.interlinearLoadedKey = key;
    } catch (error) {
      console.error('Error loading interlinear data:', error);
      this.interlinearData = null;
    } finally {
      this.interlinearInFlightKey = '';
    }

    this.interlinearLoading = false;
    this.notify();
  }

  /**
   * The current verse's display HTML from the Bible pane if it has it,
   * otherwise the copy fetched by {@link loadVerseText}.
   *
   * Never returns text belonging to a different verse or a different
   * translation — the interlinear rows would be indexed against the wrong
   * words, which is exactly the silent mismatch this pane is here to avoid.
   */
  getVerseHtml(): string | null {
    const verseId = this.verseId;
    if (!verseId) return null;

    const tab = bibleStore.getActiveTab();
    const inTab = tab?.verses.find(v => v.verse_id === verseId)?.text_html;
    if (inTab) return inTab;

    return this.verseHtmlKey === this.verseTextKey() ? this.verseHtml : null;
  }

  /** `module-verseId`, or `''` when either is unknown. */
  private verseTextKey(): string {
    const moduleAbbr = bibleStore.getActiveTab()?.moduleAbbr;
    return this.verseId && moduleAbbr ? `${moduleAbbr}-${this.verseId}` : '';
  }

  /**
   * Fetch the selected verse's text when the Bible pane is not already showing
   * it — the Study pane's interlinear cannot be built without it, and falling
   * back to the module's glosses would put words on screen that the reader's
   * translation does not contain.
   */
  private async loadVerseText(): Promise<void> {
    const key = this.verseTextKey();
    if (!key || this.verseHtmlKey === key) return;

    const tab = bibleStore.getActiveTab();
    const verseId = this.verseId!;
    if (tab?.verses.some(v => v.verse_id === verseId)) {
      // The pane has it; getVerseHtml() will read it straight from the tab.
      this.verseHtml = null;
      this.verseHtmlKey = '';
      this.verseHtmlLoading = false;
      return;
    }

    this.verseHtmlLoading = true;
    this.notify();

    let html: string | null = null;
    try {
      const verse = await bibleStore.fetchVerse(tab!.moduleAbbr, verseId);
      html = verse?.text_html ?? null;
    } catch (error) {
      console.error('Error loading study verse text:', error);
    }

    // A later selection may have overtaken this request; that one owns the
    // state now.
    if (this.verseTextKey() !== key) return;
    this.verseHtml = html;
    this.verseHtmlKey = html ? key : '';
    this.verseHtmlLoading = false;
    this.notify();
  }

  // ========== Verse history ==========

  /** Record a cross-chapter jump in the verse history */
  private addToHistory(verseId: number): void {
    const newChapter = Math.floor(verseId / 1000);
    const lastChapter = this.verseHistory.length > 0
      ? Math.floor(this.verseHistory[0].verseId / 1000)
      : -1;
    if (newChapter === lastChapter) return;

    // Remove duplicate if already in history
    this.verseHistory = this.verseHistory.filter(h => h.verseId !== verseId);
    // Prepend and cap at 30
    this.verseHistory.unshift({ verseId, timestamp: Date.now() });
    if (this.verseHistory.length > 30) this.verseHistory.length = 30;
    this.saveHistory();
  }

  private saveHistory(): void {
    try {
      localStorage.setItem('bible-reader-study-history', JSON.stringify(this.verseHistory));
    } catch { /* ignore */ }
  }

  private restoreHistory(): void {
    try {
      const data = localStorage.getItem('bible-reader-study-history');
      if (data) this.verseHistory = JSON.parse(data);
    } catch { /* ignore */ }
  }

  // ========== Session persistence ==========

  private saveSession(): void {
    try {
      localStorage.setItem('bible-reader-study', JSON.stringify({
        pinned: this.pinned,
        pinnedVerseId: this.pinnedVerseId,
        pinnedBook: this.pinnedBook,
        pinnedChapter: this.pinnedChapter,
        pinnedVerse: this.pinnedVerse,
        mobileSubPage: this.mobileSubPage,
      }));
    } catch { /* ignore */ }
  }

  private restoreSession(): void {
    try {
      const data = localStorage.getItem('bible-reader-study');
      if (!data) return;
      const parsed = JSON.parse(data);
      this.pinned = parsed.pinned ?? false;
      this.pinnedVerseId = parsed.pinnedVerseId ?? null;
      this.pinnedBook = parsed.pinnedBook ?? null;
      this.pinnedChapter = parsed.pinnedChapter ?? null;
      this.pinnedVerse = parsed.pinnedVerse ?? null;
      this.mobileSubPage = parsed.mobileSubPage ?? 'home';
    } catch { /* ignore */ }
  }
}

export const studyStore = new StudyStore();
