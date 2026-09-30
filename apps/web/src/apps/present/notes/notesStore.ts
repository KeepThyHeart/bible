import type { Plugin } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { Store } from '../../../stores/Store';
import { bibleStore } from '../../../stores/bibleStore';
import { moduleStore } from '../../../stores/moduleStore';
import { presentStore } from '../../../stores/presentStore';
import { getNotes, putNotes } from '../../../present/notesApi';
import { describeItem } from '../../../components/Present/usePresenter';
import { presenterShow, presenterState, subscribePresenter } from '../presenterSink';
import { API_BASE } from '../../../utils/apiUrl';
import type { HymnSummary } from '../../../present/hymns';
import type { PresentItem, PresentPlanEntry } from '../../../present/protocol';
import { searchHymns } from '../../../present/command/searchProviders';
import { createDecorationPlugins, findPlayItemId, notesDecoKey, type DecoMeta, type Translate } from './decorations';
import { appendPinnedParagraph, insertItemText, insertPinned, setChoiceMarks } from './editor/commands';
import { withBlockIds } from './editor/blockIds';
import { docToBlocks } from './editor/docToBlocks';
import { docFromJSON, type ProseMirrorJSON } from './editor/schema';
import { addBoldLine, appendTextParagraph, derivePlanItems, deriveServerPlan, docKey, isBlankDoc, moveSection, removeHighlightInDoc, samePlan, unlinkItemInDoc, type PlanItem } from './planOps';
import { createNotesDetector } from './detect';
export { buildVerseOrder } from './verseOrder';
export type { PlanItem } from './planOps';
import { getServiceStore, type Service } from './services/serviceStore';
import type { DetectResult, NoteHighlight, NotesItem, VerseText } from './types';

/** Detection runs this long after the last keystroke. */
const DETECT_DELAY_MS = 150;
/** The plan goes to the server this long after the last change; the notes document, longer. */
const PLAN_SYNC_MS = 400;
const NOTES_SYNC_MS = 1500;
/** How long "Removed X - Undo" stays. */
const UNDO_MS = 5000;

const pushedKey = (sessionId: string) => `pz.notes.pushed.${sessionId}`;
function readPushed(sessionId: string): string | null {
  try { return localStorage.getItem(pushedKey(sessionId)); } catch { return null; }
}
function writePushed(sessionId: string, key: string): void {
  try { localStorage.setItem(pushedKey(sessionId), key); } catch { /* private mode: costs only a re-fetch */ }
}

/** Where the chooser popover is open, and on what. */
export type ChooserTarget =
  | { mode: 'item'; id: string; anchor: DOMRect }
  | { mode: 'highlight'; id: string; anchor: DOMRect }
  | { mode: 'insert'; anchor: DOMRect };

class NotesStore extends Store {
  private serviceId: string | null = null;
  private serviceName = '';
  private ready: Promise<void> | null = null;
  private view: EditorView | null = null;
  private detector = createNotesDetector();
  private detectTimer: ReturnType<typeof setTimeout> | null = null;
  private translateFn: Translate = (key) => key;
  private lastShownId: string | null = null;
  private lastLiveKey = '';
  // Plan / notes sync (see `checkSession`).
  private planTimer: ReturnType<typeof setTimeout> | null = null;
  private notesTimer: ReturnType<typeof setTimeout> | null = null;
  private undoTimer: ReturnType<typeof setTimeout> | null = null;
  private syncedSession: string | null = null;
  private syncArmed = false;
  /** The session whose server-notes check is running (a second one would race it). */
  private reconcilingSid: string | null = null;
  /** True when the open service conflicts with the session's notes: nothing is pushed until another service is opened. */
  private syncBlocked = false;
  private lastConnection = presentStore.connection;
  private lastNotesKey = '';
  /** True once the user changed the notes in this page session (server notes then never overwrite them). */
  private edited = false;
  /** True while a programmatic edit goes through the editor, so it does not count as the user's own. */
  private silent = false;
  private undoSnapshot: ProseMirrorJSON | null = null;

  /** The current service's document (what the editor is bound to). */
  doc: ProseMirrorJSON | null = null;
  /** The latest detection result (rows 9 and 10 read this), or null before the first run. */
  detection: DetectResult | null = null;
  /** The hymn library, once loaded (search summaries). */
  hymns: HymnSummary[] = [];
  /** The item the wall is showing, as found in the notes; drives the green Play marker. */
  playItemId: string | null = null;
  chooser: ChooserTarget | null = null;
  /** The plannable items in document order (derived from `detection`); the Plan view and the server plan read this. */
  planItems: PlanItem[] = [];
  /** Set for `UNDO_MS` after `removeItem`: what the "Removed X - Undo" snackbar shows. */
  removed: { id: string; label: string } | null = null;

  private readonly chapters = new Map<string, readonly VerseText[]>();
  private readonly chaptersAsked = new Set<string>();
  private hymnsRequested = false;
  private subscribed = false;

  /** Decoration plugins for the editor. Stable identity: pass as the editor's `plugins` prop. */
  readonly plugins: Plugin[] = createDecorationPlugins({
    translate: (key, params) => this.translateFn(key, params),
    onPlay: (id) => this.playById(id),
    onItemClick: (id, el) => this.onItemClick(id, el),
    onHighlightClick: (id, el) => this.openChooser({ mode: 'highlight', id, anchor: el.getBoundingClientRect() }),
    playTitle: () => this.translateFn('present.notes.playMarker'),
  });

  get currentServiceId(): string | null { return this.serviceId; }
  get currentServiceName(): string { return this.serviceName; }

  /** The plan item currently on screen (green in the Plan view), or null. */
  get livePlanItemId(): string | null { return this.playItemId; }

  /** The presenter's translation for bare references: the service's own, else the reader's. */
  get module(): string {
    const own = this.serviceId ? getServiceStore().get(this.serviceId)?.module : '';
    return own || bibleStore.getActiveModule();
  }

  setTranslate(fn: Translate): void {
    this.translateFn = fn;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Open the last service (or create the first). Safe to call repeatedly. */
  init(): Promise<void> {
    this.ready ??= (async () => {
      const store = getServiceStore();
      if (!this.subscribed) {
        this.subscribed = true;
        store.subscribe(() => this.syncName());
        presentStore.subscribe(() => this.checkSession());
        subscribePresenter(() => this.onWallChange());
        bibleStore.subscribe(() => this.onModuleMaybeChanged());
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisible);
      }
      const service = await store.openLastOrCreate();
      this.load(service);
      void this.loadHymns();
    })();
    return this.ready;
  }

  private load(service: Service): void {
    const withIds = withBlockIds(service.doc);
    if (withIds !== service.doc) getServiceStore().save(service.id, withIds);
    this.serviceId = service.id;
    this.serviceName = service.name;
    this.doc = withIds;
    this.detection = null;
    this.planItems = [];
    this.playItemId = null;
    this.lastShownId = null;
    this.chooser = null;
    this.removed = null;
    this.undoSnapshot = null;
    this.edited = false;
    this.lastModule = this.module;
    this.notify();
    this.scheduleDetect();
    if (this.syncBlocked) {
      // A different service is open now: check it against the session afresh.
      this.syncBlocked = false;
      this.syncedSession = null;
      this.checkSession();
    }
  }

  private lastModule = '';

  private syncName(): void {
    const s = this.serviceId ? getServiceStore().get(this.serviceId) : undefined;
    if (s && s.name !== this.serviceName) {
      this.serviceName = s.name;
      this.notify();
    }
  }

  async openService(id: string): Promise<void> {
    await this.init();
    const store = getServiceStore();
    await store.flush();
    const service = store.open(id);
    if (service) this.load(service);
  }

  /** The open service was deleted: open the next one (or a new one). */
  async onServiceDeleted(id: string): Promise<void> {
    if (id !== this.serviceId) return;
    const service = await getServiceStore().openLastOrCreate();
    this.load(service);
  }

  attachView = (view: EditorView | null): void => {
    this.view = view;
    if (view) this.scheduleDetect(0);
  };

  onDocChange = (doc: ProseMirrorJSON): void => {
    this.doc = doc;
    if (!this.silent) this.edited = true;
    if (this.serviceId) getServiceStore().save(this.serviceId, doc);
    this.scheduleDetect();
    this.scheduleNotesSync();
  };

  /** The document as it is now (the editor's, when one is mounted). */
  private currentDoc(): ProseMirrorJSON | null {
    return this.view ? (this.view.state.doc.toJSON() as ProseMirrorJSON) : this.doc;
  }

  /**
   * Replace the whole document. With an editor mounted it goes through the
   * editor (one undoable step); otherwise straight into the store.
   */
  private applyDoc(json: ProseMirrorJSON, user: boolean): void {
    const withIds = withBlockIds(json);
    if (user) this.edited = true;
    if (this.view) {
      const view = this.view;
      const next = docFromJSON(withIds);
      this.silent = !user;
      try {
        view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, next.content));
      } finally {
        this.silent = false;
      }
      return;
    }
    this.doc = withIds;
    if (this.serviceId) getServiceStore().save(this.serviceId, withIds);
    this.notify();
    this.scheduleDetect(0);
    this.scheduleNotesSync();
  }

  /** Load a notes document (from the server after a handoff) into the open service. */
  loadDoc(doc: ProseMirrorJSON): void {
    this.applyDoc(doc, false);
  }

  // -------------------------------------------------------------------------
  // Adding and showing
  // -------------------------------------------------------------------------

  /** Insert a line for `item` at the caret, or at the end of the current service's notes. */
  addItem(item: PresentItem, label: string): void {
    void this.addItemAsync(item, label);
  }

  private async addItemAsync(item: PresentItem, label: string): Promise<void> {
    await this.init();
    if (this.view) {
      insertPinned(this.view, label, item);
      return;
    }
    this.doc = withBlockIds(appendPinnedParagraph(this.doc, label, item));
    this.edited = true; // Plan view: no editor, so onDocChange never runs
    if (this.serviceId) getServiceStore().save(this.serviceId, this.doc);
    this.notify();
    this.scheduleDetect(0);
    this.scheduleNotesSync();
  }

  /** A readable label for an item that has no text of its own yet (Study's "add to plan"). */
  labelFor(item: PresentItem): string {
    if (item.kind === 'quote') return `Quote: ${item.text}`;
    return describeItem(item, item.kind === 'passage' ? item.verseStart ?? 0 : 0) ?? '';
  }

  /** "+ Insert > Quote": a `Quote:` line, which the detector recognises, at the caret. */
  addQuoteLine(): void {
    if (this.view) insertItemText(this.view, 'Quote: ');
    else this.applyDoc(appendTextParagraph(this.currentDoc(), 'Quote: '), true); // Plan view: no editor mounted
  }

  /** Show `item` on the wall (from the notes), remembering which note it was. */
  showItem(item: PresentItem, itemId?: string): void {
    if (itemId) this.lastShownId = itemId;
    presenterShow(item, item.kind === 'passage' ? item.verseStart : undefined);
    if (itemId) {
      this.playItemId = itemId;
      this.pushMeta({ playItemId: itemId });
      this.notify();
    }
  }

  /** Show plan item `id` (green afterwards). Amber items with nothing showable do nothing. */
  showPlanItem(id: string): void {
    const p = this.planItems.find((i) => i.id === id);
    if (p?.item) this.showItem(p.item, id);
  }

  // -------------------------------------------------------------------------
  // Plan edits (notes are the source of truth; the plan is derived)
  // -------------------------------------------------------------------------

  /** Move item `id`'s whole section (its block and the prose after it) to plan position `toIndex`. */
  moveItem(id: string, toIndex: number): void {
    const items = this.detection?.items;
    if (!items) return;
    const next = moveSection(this.currentDoc(), items, id, toIndex);
    if (next) this.applyDoc(next, true);
  }

  /** Unlink the item's text (it stays in the notes, no longer an item) and offer undo for a few seconds. */
  removeItem(id: string): void {
    const item = this.itemById(id);
    if (!item) return;
    const snapshot = this.currentDoc();
    if (!snapshot) return;
    this.applyDoc(unlinkItemInDoc(snapshot, item), true);
    this.undoSnapshot = snapshot;
    this.removed = { id, label: item.label };
    if (this.undoTimer) clearTimeout(this.undoTimer);
    this.undoTimer = setTimeout(() => this.clearUndo(), UNDO_MS);
    this.notify();
  }

  /** Bring back the item removed last (restores the notes as they were just before). */
  undoRemove(): void {
    const snapshot = this.undoSnapshot;
    if (!snapshot) return;
    this.clearUndo();
    this.applyDoc(snapshot, true);
  }

  private clearUndo(): void {
    if (this.undoTimer) clearTimeout(this.undoTimer);
    this.undoTimer = null;
    this.undoSnapshot = null;
    if (this.removed) {
      this.removed = null;
      this.notify();
    }
  }

  /** Add a bold line with `phrase` after item `itemId`'s block, so it becomes a highlight of that item. */
  addHighlightText(itemId: string, phrase: string): void {
    const items = this.detection?.items;
    if (!items) return;
    const next = addBoldLine(this.currentDoc(), items, itemId, phrase);
    if (next) this.applyDoc(next, true);
  }

  /** Remove a highlight's bold phrase (or its whole bold line) from the notes; works with or without a mounted editor. */
  removeHighlightText(highlightId: string): void {
    const h = this.highlightById(highlightId);
    if (!h) return;
    this.applyDoc(removeHighlightInDoc(this.currentDoc(), h), true);
  }

  /** Where the green marker belongs: the item on screen (the wall when live, else the local preview). */
  private computePlayId(items: readonly NotesItem[]): string | null {
    return findPlayItemId(items, presenterState()?.live, this.lastShownId);
  }

  private playById(id: string): void {
    const item = this.detection?.items.find((i) => i.id === id);
    if (item?.item) this.showItem(item.item, id);
  }

  /** Ctrl+Enter at document position `pos`: show the item there (or, failing that, in the same block). */
  showAtCaret = (pos: number): void => {
    const st = this.view ? notesDecoKey.getState(this.view.state) : undefined;
    const spans = (st?.spans ?? []).filter((s) => s.kind === 'item');
    const hit = spans.find((s) => pos >= s.from && pos <= s.to);
    if (hit) return this.playById(hit.id);
    const block = this.view?.state.doc.resolve(pos);
    if (!block) return;
    const start = block.start(), end = block.end();
    const inBlock = spans.find((s) => s.from >= start && s.to <= end);
    if (inBlock) this.playById(inBlock.id);
  };

  // -------------------------------------------------------------------------
  // Detection
  // -------------------------------------------------------------------------

  private scheduleDetect(delay = DETECT_DELAY_MS): void {
    if (this.detectTimer) clearTimeout(this.detectTimer);
    this.detectTimer = setTimeout(() => {
      this.detectTimer = null;
      this.runDetection();
    }, delay);
  }

  runDetection(): DetectResult | null {
    if (!this.doc && !this.view) return null;
    const doc = this.view ? this.view.state.doc : docFromJSON(this.doc);
    const module = this.module;
    const result = this.detector.detect(docToBlocks({ doc }), {
      module,
      modules: moduleStore.getBibleModules().map((m) => m.abbreviation),
      hymns: this.hymns.length ? this.hymns : undefined,
      getChapter: (m, book, chapter) => this.chapters.get(`${m}/${book}/${chapter}`),
    });
    this.detection = result;
    this.playItemId = this.computePlayId(result.items);
    this.planItems = derivePlanItems(result);
    this.pushMeta({ detection: result, playItemId: this.playItemId });
    this.loadChapters(result);
    this.notify();
    this.schedulePlanSync();
    return result;
  }

  private pushMeta(meta: DecoMeta): void {
    const view = this.view;
    if (view) view.dispatch(view.state.tr.setMeta(notesDecoKey, meta));
  }

  private loadChapters(result: DetectResult): void {
    const wanted = result.needsChapters.filter((c) => !this.chaptersAsked.has(`${c.module}/${c.book}/${c.chapter}`));
    if (!wanted.length) return;
    void Promise.all(wanted.map(async (c) => {
      const key = `${c.module}/${c.book}/${c.chapter}`;
      this.chaptersAsked.add(key);
      try {
        const res = await fetch(`${API_BASE}/api/bible/${encodeURIComponent(c.module)}/${c.book}/${c.chapter}`);
        if (!res.ok) return false;
        const body = await res.json() as { verses?: Array<{ verse_id: number; verse: number; text_html: string }> };
        if (!Array.isArray(body.verses)) return false;
        this.chapters.set(key, body.verses.map((v) => ({ verseId: v.verse_id, verse: v.verse, html: v.text_html })));
        return true;
      } catch {
        return false;
      }
    })).then((loaded) => {
      if (loaded.some(Boolean)) this.scheduleDetect(0);
    });
  }

  private async loadHymns(): Promise<void> {
    if (this.hymnsRequested) return;
    this.hymnsRequested = true;
    try {
      const found = await searchHymns('');
      if (!Array.isArray(found)) throw new Error('bad hymn list');
      this.hymns = found;
      presentStore.rememberHymns(this.hymns);
      this.scheduleDetect(0);
    } catch {
      this.hymnsRequested = false; // try again on the next init/attach
    }
  }

  hymnById(id: string): HymnSummary | undefined {
    return this.hymns.find((h) => h.id === id);
  }

  private onWallChange(): void {
    const live = presenterState()?.live ?? null;
    const key = live ? JSON.stringify(live) : '';
    if (key === this.lastLiveKey) return;
    this.lastLiveKey = key;
    if (!this.detection) return;
    const next = this.computePlayId(this.detection.items);
    if (next === this.playItemId) return;
    this.playItemId = next;
    this.pushMeta({ playItemId: next });
    this.notify();
  }

  private onModuleMaybeChanged(): void {
    const module = this.module;
    if (module === this.lastModule) return;
    this.lastModule = module;
    this.scheduleDetect(0);
  }

  // -------------------------------------------------------------------------
  // Sync with the session (PUT /plan, PUT /notes)
  // -------------------------------------------------------------------------

  /**
   * Called on every presentStore change: a different session (going live,
   * resume, handoff) starts a sync, and so does the stream coming back after
   * a drop (the server copy may have changed while this device was away).
   */
  private checkSession(): void {
    const session = presentStore.session;
    const sid = session?.sessionId ?? null;
    const connection = presentStore.connection;
    const reconnected = connection === 'live' && this.lastConnection !== 'live';
    this.lastConnection = connection;
    if (sid === this.syncedSession) {
      if (sid && reconnected && !this.syncBlocked) void this.reconcile(sid, session!.controlToken);
      return;
    }
    this.syncedSession = sid;
    this.syncArmed = false;
    this.syncBlocked = false;
    this.lastNotesKey = '';
    if (sid) void this.reconcile(sid, session!.controlToken);
  }

  /** Re-check the server copy when the tab comes back to the foreground (a phone that slept). */
  private onVisible = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    const session = presentStore.session;
    if (session && session.sessionId === this.syncedSession && !this.syncBlocked) {
      void this.reconcile(session.sessionId, session.controlToken);
    }
  };

  /**
   * Compare the session's notes with this device's, then (re)start pushing.
   * Nothing is pushed while this runs, so a stale or fresh device cannot
   * overwrite what the session holds. `pushed` is the key of the notes this
   * device last sent (or adopted) for this session.
   *
   *  - Server copy unchanged since our last push (or same as ours): nothing to adopt.
   *  - Local notes blank: load the server copy into the open service.
   *  - Otherwise the server copy is new to us. With no unpushed local edits
   *    (never edited here, and equal to our last push): a device that never
   *    pushed keeps its saved service and opens the server copy as a NEW
   *    service; one that pushed before takes the server copy into the open
   *    service. With unpushed local edits we overwrite nothing either way: the
   *    server copy goes into a new service, the local one stays open, and
   *    nothing is pushed until another service is opened.
   */
  private async reconcile(sid: string, token: string): Promise<void> {
    if (this.reconcilingSid === sid) return;
    this.reconcilingSid = sid;
    const wasArmed = this.syncArmed;
    this.syncArmed = false;
    try {
      await this.init();
      const server = await getNotes(sid, token);
      if (this.syncedSession !== sid) return;
      const local = this.currentDoc();
      if (server && docKey(server) !== docKey(local)) {
        const pushed = readPushed(sid);
        const serverKey = docKey(server);
        if (isBlankDoc(local)) {
          this.loadDoc(server);
          this.recordAdopted(sid, serverKey);
        } else if (pushed === null || serverKey !== pushed) {
          const dirty = this.edited || (pushed !== null && docKey(local) !== pushed);
          if (!dirty && pushed !== null) {
            this.loadDoc(server);
            this.recordAdopted(sid, serverKey);
          } else {
            const service = await getServiceStore().create({
              name: `${this.serviceName || 'Service'} (session copy)`,
              doc: server,
              module: this.module,
            });
            if (this.syncedSession !== sid) return;
            if (dirty) {
              if (this.serviceId) getServiceStore().open(this.serviceId); // keep the local one as the last-open service
              this.syncBlocked = true;
              return;
            }
            this.load(service);
            this.recordAdopted(sid, serverKey);
          }
        }
      }
      this.syncArmed = true;
      if (!this.detection || this.detectTimer) this.runDetection();
      this.schedulePlanSync(0);
      this.scheduleNotesSync(0);
    } finally {
      if (this.reconcilingSid === sid) this.reconcilingSid = null;
      if (this.syncedSession === sid) this.syncArmed = !this.syncBlocked && (this.syncArmed || wasArmed);
    }
  }

  private recordAdopted(sid: string, key: string): void {
    this.lastNotesKey = key;
    writePushed(sid, key);
  }

  private schedulePlanSync(delay = PLAN_SYNC_MS): void {
    if (!this.syncArmed) return;
    if (this.planTimer) clearTimeout(this.planTimer);
    this.planTimer = setTimeout(() => { this.planTimer = null; void this.pushPlan(); }, delay);
  }

  private scheduleNotesSync(delay = NOTES_SYNC_MS): void {
    if (!this.syncArmed) return;
    if (this.notesTimer) clearTimeout(this.notesTimer);
    this.notesTimer = setTimeout(() => { this.notesTimer = null; void this.pushNotes(); }, delay);
  }

  /** The plan derived from the notes, when it differs from what the session holds. */
  private async pushPlan(): Promise<void> {
    if (!presentStore.session || !this.syncArmed || !this.detection) return;
    const derived: PresentPlanEntry[] = deriveServerPlan(this.planItems, presentStore.plan);
    // An empty, untouched notes doc must not wipe a plan the session already has.
    if (derived.length === 0 && !this.edited && isBlankDoc(this.currentDoc())) return;
    if (samePlan(derived, presentStore.plan)) return;
    await presentStore.savePlan(derived);
  }

  private async pushNotes(): Promise<void> {
    const session = presentStore.session;
    const doc = this.currentDoc();
    if (!session || !this.syncArmed || !doc) return;
    if (isBlankDoc(doc) && !this.edited) return;
    const key = docKey(doc);
    if (key === this.lastNotesKey) return;
    if (await putNotes(session.sessionId, session.controlToken, doc)) {
      this.lastNotesKey = key;
      writePushed(session.sessionId, key);
    }
  }

  // -------------------------------------------------------------------------
  // Chooser
  // -------------------------------------------------------------------------

  private onItemClick(id: string, el: HTMLElement): void {
    const item = this.detection?.items.find((i) => i.id === id);
    if (!item) return;
    // Only things that may need a decision open the chooser: amber items and hymns.
    if (item.status === 'choose' || item.kind === 'hymn') {
      this.openChooser({ mode: 'item', id, anchor: el.getBoundingClientRect() });
    }
  }

  openChooser(target: ChooserTarget): void {
    this.chooser = target;
    this.notify();
  }

  closeChooser(): void {
    if (!this.chooser) return;
    this.chooser = null;
    this.notify();
  }

  itemById(id: string): NotesItem | undefined {
    return this.detection?.items.find((i) => i.id === id);
  }

  highlightById(id: string): NoteHighlight | undefined {
    return this.detection?.highlights.find((h) => h.id === id);
  }

  private spanOf(id: string): { from: number; to: number } | null {
    const st = this.view ? notesDecoKey.getState(this.view.state) : undefined;
    return st?.spans.find((s) => s.id === id) ?? null;
  }

  /** Save the chooser's choice: pin the item's text to exactly `item`. */
  pinItem(id: string, item: PresentItem): void {
    const span = this.spanOf(id);
    if (this.view && span) setChoiceMarks(this.view, span.from, span.to, { pin: { item } });
    this.closeChooser();
    this.scheduleDetect(0);
  }

  /** "Not a hymn" / "Not a reference": the text stops being an item. */
  unlinkItem(id: string): void {
    const span = this.spanOf(id);
    if (this.view && span) setChoiceMarks(this.view, span.from, span.to, 'unlink');
    this.closeChooser();
    this.scheduleDetect(0);
  }

  /** "Not a highlight": pin this bold span to no range. */
  dismissHighlight(id: string): void {
    const span = this.spanOf(id);
    if (this.view && span) setChoiceMarks(this.view, span.from, span.to, { pin: { range: null } });
    this.closeChooser();
    this.scheduleDetect(0);
  }

  /** Insert a hymn chosen in the insert-mode chooser. */
  insertItem(item: PresentItem, label: string): void {
    this.closeChooser();
    this.addItem(item, label);
  }
}

export const notesStore = new NotesStore();
