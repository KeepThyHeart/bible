/**
 * The store the audio UI talks to.
 *
 * It owns nothing about *how* audio is made. It holds the listener's
 * preferences, asks the resolver which provider plays a translation, puts the
 * confirmation gates (phone battery, voice download) in front of the first
 * sound, hands the result to the one `IAudioPlayer`, and mirrors the player's
 * state for the components. It holds no app code: the app's reader (web tabs,
 * desktop Bible panes) and module list come in through `ports.ts`, and each app
 * creates one instance. It couples playback to the reader in the two ways the
 * design allows and no further:
 *
 * - **Follow-along is a highlight, nothing more.** The verse being read is
 *   published in `audioStore.follow`; the Bible text draws it and scrolls to it.
 *   It never selects the verse, never moves `studyVerse`, never makes the Study
 *   or Commentary panes refresh, and never pushes a history entry. Those change
 *   only when the reader clicks or selects a verse. When reading moves into the
 *   next chapter the page is turned with `reader.followTo()`, which
 *   leaves the selection alone as well.
 * - **The reader is in charge.** If they navigate the playing tab to another
 *   chapter, close it, or change its translation, playback follows suit (stops,
 *   or restarts in the new translation from the same verse).
 *
 * ## Re-rendering
 *
 * `useStore` re-renders on every notify, and the player reports its position
 * five times a second. So the fast-moving values live in two small stores of
 * their own: `position` (seconds, for the progress bar) and `follow` (the verse
 * being read). This store itself notifies only when something a component shows
 * changes (status, source, notice, gate, error).
 */

import { Store } from './Store';
import type { AudioPrefsStorage, AudioReaderPort, AudioReaderTab, AudioModulesPort, AudioStoreHost } from './ports';
import {
  defaultAudioPrefs, effectiveRate, loadAudioPrefs, saveAudioPrefs, sanitizeAudioPrefs, stepRate,
} from './audioPrefs';
import type { AudioUiPrefs, PlayerStyle } from './audioPrefs';
import type { PassageLoop } from './passageQueue';
import {
  MAX_PASSAGES, nextIndex, passageContains, passageLastChapter, passageStart, prevIndex, sanitizeBookmark, stopVerseIn,
} from './passageQueue';
import type { AudioBookmark, AudioPassage, PassageQueue } from './passageQueue';
import type { AudioSourceResolver, SourceStatus } from './AudioSourceResolver';
import type {
  AudioCapabilities,
  AudioError,
  AudioSiteConfig,
  AudioSourceChoice,
  AudioVoice,
  ChapterRef,
  IAudioLocator,
  IAudioPlayer,
  IManifestSource,
  ITtsEngine,
  IAudioProvider,
  LoadProgress,
  PlayerState,
  PlayerStatus,
  SourceResolution,
  VerseRef,
} from '@bible/core/browser';

export type AudioUiStatus = PlayerStatus | 'resolving';
export type NoticeAction = 'retry' | 'resume' | 'useOnDevice';

export interface AudioNotice {
  /** Locale key, `audio.notice.*` or `audio.error.*`. */
  key: string;
  tone: 'info' | 'error';
  actions: NoticeAction[];
}

export type PendingGate =
  /** `bytes` is set only when the voice still has to be downloaded; confirming then also confirms the download. */
  | { kind: 'battery'; engineId: string; engineLabel: string; voiceLabel?: string; bytes?: number }
  | { kind: 'download'; engineLabel: string; voiceLabel?: string; bytes?: number };

export type Availability = 'unknown' | 'none' | 'ok';

export interface AudioSystem {
  player: IAudioPlayer;
  resolver: AudioSourceResolver;
  config: AudioSiteConfig;
  /** The on-device engines the site enabled, by engine id (for the settings screen: voices, download, remove). */
  engines?: ReadonlyMap<string, ITtsEngine>;
  /** BCP-47 language of a translation; '' while the module list is not loaded. */
  languageOf?(moduleAbbr: string): string;
  /** The recorded channel's manifest source and URL scheme (absent when recordings are off), for downloads. */
  recordings?: { manifests: IManifestSource; locator: IAudioLocator };
}

/** Position and duration of the current playback, in seconds. */
export class PositionStore extends Store {
  position = 0;
  duration: number | null = null;
  set(position: number, duration: number | null): void {
    if (position === this.position && duration === this.duration) return;
    this.position = position;
    this.duration = duration;
    this.notify();
  }
}

/** The verse being read, for the highlight. Notifies only when it changes. */
export class FollowStore extends Store {
  tabId: string | null = null;
  verseId: number | null = null;
  set(tabId: string | null, verseId: number | null): void {
    if (tabId === this.tabId && verseId === this.verseId) return;
    this.tabId = tabId;
    this.verseId = verseId;
    this.notify();
  }
}

/** Notifies when a tab's resume point is saved, moved or dropped (the desktop session serializer listens). */
export class BookmarksStore extends Store {
  changed(): void { this.notify(); }
}

interface FollowTarget { tabId: string; module: string; book: number; chapter: number }

/** A check that failed, or a "no" that has expired, is asked again no sooner than this. */
const AVAILABILITY_RETRY_MS = 30_000;

const verseIdOf = (book: number, chapter: number, verse: number): number => book * 1_000_000 + chapter * 1_000 + verse;

export class AudioStore extends Store {
  readonly position = new PositionStore();
  readonly follow = new FollowStore();
  /** Notifies when any tab's bookmark changes. Does not fire as the verse moves during play (read `allBookmarks()` for the live place). */
  readonly bookmarksChanged = new BookmarksStore();

  prefs: AudioUiPrefs = defaultAudioPrefs();
  status: AudioUiStatus = 'idle';
  playingTabId: string | null = null;
  playingModule: string | null = null;
  providerId: string | null = null;
  providerLabel: string | null = null;
  voiceId: string | null = null;
  rate = 1;
  progress: LoadProgress | null = null;
  error: AudioError | null = null;
  notice: AudioNotice | null = null;
  pendingGate: PendingGate | null = null;
  layout: 'desktop' | 'phone' = 'desktop';
  /** Whether the feature is available at all (features.audio on and initialised). */
  enabled = false;
  /** Phone only: the full-screen player is showing (playback continues when it is closed). */
  playerOpen = false;
  /** Phone only: the settings sheet over the player is open (Back closes it before the player). */
  quickSettingsOpen = false;
  /** Bumped when what can play changes, so source lists re-ask. */
  sourcesVersion = 0;
  /**
   * The playlist of the playing tab (null while idle). Always set while something plays:
   * `kind: 'chapter'` is the default list (the chapter in hand), `kind: 'list'` the typed passages;
   * `index` is the passage being read ("n of m" is `index + 1` of `passages.length`).
   */
  queue: PassageQueue | null = null;
  /** The tab the player's playlist editor is aimed at (set by the pane's Listen chevron), or null. */
  targetTabId: string | null = null;

  private system: AudioSystem | null = null;
  private resolution: SourceResolution | null = null;
  private followTarget: FollowTarget | null = null;
  private playSeq = 0;
  private gateResolve: ((ok: boolean) => void) | null = null;
  /** True from the start of `play()` until `player.play()` is called: player events are ignored. */
  private preparing = false;
  private staleSource = false;
  private readonly sessionOverride = new Map<string, AudioSourceChoice>();
  /** When each translation's availability was last asked, to throttle re-asks after a failure or an expired "no". */
  private availabilityAskedAt = new Map<string, number>();
  private offBible: (() => void) | null = null;
  private offPlayer: Array<() => void> = [];
  private offModules: (() => void) | null = null;
  private storage: AudioPrefsStorage | null | undefined;
  /** Each tab's resume point; the playing tab's entry is stale while it plays (see `bookmarkFor`). */
  private readonly bookmarks = new Map<string, AudioBookmark>();
  /** True while the store itself stops the player, so an idle state is not mistaken for a natural end. */
  private stopping = false;
  /** Where the playback being prepared will start (the place to keep if it is stopped while resolving). */
  private pendingFrom: VerseRef | null = null;
  private readonly reader: AudioReaderPort;
  private readonly modules: AudioModulesPort;

  /** `host` is the app's reader and module list (web: the Bible and module stores; desktop: Bible panes). */
  constructor(host: AudioStoreHost) {
    super();
    this.reader = host.reader;
    this.modules = host.modules;
  }

  // ---------------------------------------------------------------- lifecycle

  /**
   * Wire the store to a built audio system. `storage` is for tests; the default
   * is `localStorage`. Calling it again replaces the previous system.
   */
  init(system: AudioSystem, storage?: AudioPrefsStorage | null): void {
    this.dispose();
    this.system = system;
    this.storage = storage;
    this.prefs = loadAudioPrefs(storage === undefined ? undefined : storage);
    this.enabled = true;
    const p = system.player;
    this.offPlayer = [
      p.on('state', s => this.onPlayerState(s)),
      p.on('verse', v => this.onVerse(v)),
      p.on('chapterEnd', next => this.onChapterEnd(next)),
      p.on('stopReached', at => this.onStopReached(at)),
    ];
    this.offBible = this.reader.subscribe(() => this.onBibleChanged());
    this.offModules = this.modules.subscribe(() => {
      // The module list arriving (or changing) may change what can play.
      this.availabilityAskedAt.clear();
      this.notify();
    });
    this.notify();
  }

  dispose(): void {
    this.playSeq++;
    this.cancelGate(false);
    for (const off of this.offPlayer) off();
    this.offPlayer = [];
    this.offBible?.(); this.offBible = null;
    this.offModules?.(); this.offModules = null;
    const at = this.playingTabId ? this.livePosition() : null;
    if (this.playingTabId && at) this.bookmark(this.playingTabId, at, false); // quitting keeps the place
    this.stopPlayer();
    this.system = null;
    this.resetPlayback();
    this.enabled = false;
    this.availabilityAskedAt.clear();
    this.sessionOverride.clear();
  }

  openPlayer(): void {
    if (this.playerOpen) return;
    this.playerOpen = true;
    this.notify();
  }

  /** Aim the player's playlist editor at a tab (null: the active one). */
  setTargetTab(tabId: string | null): void {
    if (this.targetTabId === tabId) return;
    this.targetTabId = tabId;
    this.notify();
  }

  closePlayer(): void {
    if (!this.playerOpen) return;
    this.playerOpen = false;
    this.notify();
  }

  openQuickSettings(): void {
    if (this.quickSettingsOpen) return;
    this.quickSettingsOpen = true;
    this.notify();
  }

  closeQuickSettings(): void {
    if (!this.quickSettingsOpen) return;
    this.quickSettingsOpen = false;
    this.notify();
  }

  setPlayerStyle(style: PlayerStyle): void {
    if (this.prefs.playerStyle === style) return;
    this.setPrefs({ playerStyle: style });
  }

  /** One preset faster or slower (within what the current source supports). */
  stepRate(dir: 1 | -1): void {
    const caps = this.capabilities;
    const next = stepRate(effectiveRate(this.prefs.rate, caps ?? { rate: null }), dir, caps?.rate);
    if (next !== null) this.setPrefs({ rate: next });
  }

  setLayout(layout: 'desktop' | 'phone'): void {
    if (this.layout === layout) return;
    this.layout = layout;
    this.notify();
  }

  // ---------------------------------------------------------------- availability

  /** BCP-47 language of a translation, for the UI ('' until the module list has loaded). */
  languageFor(moduleAbbr: string): string {
    return this.languageOf(moduleAbbr);
  }

  private languageOf(moduleAbbr: string): string {
    if (this.system?.languageOf) return this.system.languageOf(moduleAbbr);
    return this.modules.languageOf(moduleAbbr);
  }

  /**
   * Can this translation be played, as far as is known right now? Synchronous
   * (it is called while rendering); the first call for a translation starts the
   * check and the store notifies when it settles.
   */
  availability(moduleAbbr: string): Availability {
    const system = this.system;
    if (!system) return 'none';
    const language = this.languageOf(moduleAbbr);
    if (!language) return 'unknown'; // the module list has not loaded
    const cached = system.resolver.cachedAvailability(moduleAbbr, language);
    if (cached === true) return 'ok';
    const key = `${moduleAbbr}|${language}`;
    const askedAt = this.availabilityAskedAt.get(key);
    if (cached === undefined && (askedAt === undefined || Date.now() - askedAt >= AVAILABILITY_RETRY_MS)) {
      this.availabilityAskedAt.set(key, Date.now());
      void system.resolver.resolve(moduleAbbr, language, this.prefs, this.sessionOverride.get(moduleAbbr))
        .catch(() => null)
        .then(() => this.notify());
    }
    return cached === undefined ? 'unknown' : 'none';
  }

  private tabReady(tab: AudioReaderTab | undefined): tab is AudioReaderTab {
    return this.enabled && !!tab && !tab.loading && tab.verses.length > 0 && !!tab.book && !!tab.chapter;
  }

  /** Whether Play should be enabled for a tab right now. */
  canPlay(tab: AudioReaderTab | undefined): boolean {
    return this.tabReady(tab) && this.availability(tab.moduleAbbr) === 'ok';
  }

  /** Is this tab the one being read to (in any active state)? */
  isPlayingTab(tabId: string | undefined): boolean {
    return !!tabId && this.playingTabId === tabId && this.status !== 'idle';
  }

  // ---------------------------------------------------------------- play

  /** Where playback starts: the selected verse (or range start) of this chapter, else the first verse. */
  /** The reader's own selection (a verse number) when it lies in the tab's chapter, else null. */
  private selectedVerse(tab: AudioReaderTab): number | null {
    const id = this.reader.selectionStart(tab.id);
    return id != null && Math.floor(id / 1_000_000) === tab.book && Math.floor(id / 1_000) % 1_000 === tab.chapter
      ? id % 1_000 : null;
  }

  private startVerse(tab: AudioReaderTab): VerseRef {
    const base = { moduleAbbr: tab.moduleAbbr, book: tab.book!, chapter: tab.chapter! };
    const inChapter = (id: number | null | undefined): id is number =>
      id != null && Math.floor(id / 1_000_000) === tab.book && Math.floor(id / 1_000) % 1_000 === tab.chapter;
    const selected = this.selectedVerse(tab);
    const picked = selected !== null ? tab.book! * 1_000_000 + tab.chapter! * 1_000 + selected
      : inChapter(tab.studyVerse) ? tab.studyVerse : null;
    if (picked !== null) return { ...base, verse: picked % 1_000 };
    const first = tab.verses.find(v => v.verse >= 1) ?? tab.verses[0];
    return { ...base, verse: first?.verse ?? 1 };
  }

  /** Play a tab's chapter (default: the active one) from the selected verse. */
  async play(tabId?: string): Promise<void> {
    const tab = tabId ? this.reader.tab(tabId) : this.reader.activeTab();
    // An unknown answer is not a "no": pressing Play before the check has settled
    // just runs the check as part of starting (`startPlayback` resolves the source).
    if (!this.system || !this.tabReady(tab) || this.availability(tab.moduleAbbr) === 'none') return;
    if (this.status === 'resolving' && this.playingTabId === tab.id) return; // a double click
    const bm = this.bookmarks.get(tab.id);
    const selected = this.selectedVerse(tab);
    const chapterQueue = chapterQueueOf(tab.book!, tab.chapter!);
    if (bm?.queue?.kind === 'list') {
      // Resume the typed list, unless the reader selected a verse of this chapter outside its current passage.
      const q = bm.queue;
      const outside = selected !== null && !passageContains(q.passages[q.index], tab.book!, tab.chapter!, selected);
      if (!outside) {
        await this.beginAt(tab, { moduleAbbr: tab.moduleAbbr, book: bm.book, chapter: bm.chapter, verse: bm.verse }, q);
        return;
      }
    } else if (bm && bm.book === tab.book && bm.chapter === tab.chapter) {
      // The selection (set when reading stopped) wins; without one, the saved verse.
      await this.startPlayback(tab, { moduleAbbr: tab.moduleAbbr, book: bm.book, chapter: bm.chapter, verse: selected ?? bm.verse }, chapterQueue);
      return;
    }
    await this.startPlayback(tab, this.startVerse(tab), chapterQueue);
  }

  /**
   * Play a list of passages in a tab, from `startIndex`. Replaces whatever the tab was reading.
   * The tab is turned to the first passage's chapter when it shows another.
   */
  async playPassages(tabId: string, passages: readonly AudioPassage[], startIndex = 0): Promise<void> {
    const tab = this.reader.tab(tabId);
    const list = passages.slice(0, MAX_PASSAGES);
    if (!this.system || !tab || list.length === 0 || tab.loading) return;
    if (this.availability(tab.moduleAbbr) === 'none') return;
    const index = Number.isInteger(startIndex) ? Math.min(Math.max(0, startIndex), list.length - 1) : 0;
    await this.startPassage(tab, { kind: 'list', passages: list, index });
  }

  /** Start the queue's current passage (turning the tab's page first when needed). */
  private startPassage(tab: AudioReaderTab, queue: PassageQueue): Promise<void> {
    const start = passageStart(queue.passages[queue.index]);
    return this.beginAt(tab, { moduleAbbr: tab.moduleAbbr, ...start }, queue);
  }

  private async beginAt(tab: AudioReaderTab, from: VerseRef, queue: PassageQueue): Promise<void> {
    const system = this.system;
    if (!system) return;
    if (tab.book !== from.book || tab.chapter !== from.chapter) {
      const seq = ++this.playSeq;
      // Whatever plays now must not go on (or move on) while the page turns.
      if (system.player.state.status !== 'idle') system.player.pause();
      system.player.setStopAfter(null);
      // Our own page turn must not look like the reader navigating away.
      if (this.playingTabId === tab.id && this.followTarget) {
        this.followTarget = { ...this.followTarget, book: from.book, chapter: from.chapter };
      }
      await this.reader.followTo(tab.id, from.book, from.chapter);
      if (seq !== this.playSeq || this.system !== system) return; // replaced meanwhile
    }
    const fresh = this.reader.tab(tab.id);
    if (!fresh) return;
    await this.startPlayback(fresh, { ...from, moduleAbbr: fresh.moduleAbbr }, queue);
  }

  /** Next passage of the typed list (no-op at its end, or when no list plays). */
  nextPassage(): void {
    const q = this.queue;
    const tab = this.playingTabId ? this.reader.tab(this.playingTabId) : undefined;
    if (!q || q.kind !== 'list' || !tab) return;
    const j = nextIndex(q, 'once');
    if (j === null) return;
    void this.startPassage(tab, { ...q, index: j });
  }

  /** Previous passage of the typed list (no-op at its start). */
  prevPassage(): void {
    const q = this.queue;
    const tab = this.playingTabId ? this.reader.tab(this.playingTabId) : undefined;
    if (!q || q.kind !== 'list' || !tab) return;
    const j = prevIndex(q);
    if (j === null) return;
    void this.startPassage(tab, { ...q, index: j });
  }

  /** Drop the typed list and go back to the default list: the chapter being read, from the verse in hand to its end. */
  useChapterList(): void {
    const system = this.system;
    const q = this.queue;
    if (system && this.playingTabId && q && q.kind === 'list') {
      const current = this.livePosition();
      if (!current) return;
      this.queue = chapterQueueOf(current.book, current.chapter);
      system.player.setStopAfter(null);
      this.notify();
      return;
    }
    // Idle: change the saved place of the tab Listen would act on.
    const tab = this.reader.activeTab();
    const bm = tab ? this.bookmarks.get(tab.id) : undefined;
    if (tab && bm?.queue?.kind === 'list') {
      this.bookmarks.set(tab.id, { ...bm, queue: chapterQueueOf(bm.book, bm.chapter) });
      this.bookmarksChanged.changed();
      this.notify();
    }
  }

  setPassageLoop(loop: PassageLoop): void {
    if (this.prefs.passageLoop === loop) return;
    this.setPrefs({ passageLoop: loop });
  }

  /** The shared "Continue to the next chapter" setting (also in Settings > Audio). */
  setContinueAfterChapter(on: boolean): void {
    const value = on ? 'next-chapter' : 'stop';
    if (this.prefs.continueAfterChapter === value) return;
    this.setPrefs({ continueAfterChapter: value });
  }

  // ---------------------------------------------------------------- bookmarks

  /** Where the playing tab is right now, or (while resolving) where it will start; null when idle. */
  private livePosition(): VerseRef | null {
    if (this.status === 'idle' || !this.system) return null;
    if (this.status === 'resolving') return this.pendingFrom;
    const current = this.system.player.state.current;
    return current ? { ...current, moduleAbbr: this.playingModule ?? current.moduleAbbr } : null;
  }

  /** Save a tab's place; `select` also makes the verse the tab's selected verse (no scroll, no history). */
  private bookmark(tabId: string, at: VerseRef | null, select: boolean): void {
    if (!at) return;
    const mark: AudioBookmark = { moduleAbbr: at.moduleAbbr, book: at.book, chapter: at.chapter, verse: at.verse };
    if (this.queue) mark.queue = this.queue;
    this.bookmarks.set(tabId, mark);
    this.bookmarksChanged.changed();
    if (select) this.reader.markStopped?.(tabId, verseIdOf(at.book, at.chapter, at.verse));
  }

  private dropBookmark(tabId: string): void {
    if (this.bookmarks.delete(tabId)) this.bookmarksChanged.changed();
  }

  /** A tab's resume point; for the playing tab, its live position. */
  bookmarkFor(tabId: string): AudioBookmark | null {
    if (this.playingTabId === tabId) {
      const at = this.livePosition();
      if (at) {
        const mark: AudioBookmark = { moduleAbbr: at.moduleAbbr, book: at.book, chapter: at.chapter, verse: at.verse };
        if (this.queue) mark.queue = this.queue;
        return mark;
      }
    }
    return this.bookmarks.get(tabId) ?? null;
  }

  /** Every tab's resume point (the playing tab's is live), for the session serializer. */
  allBookmarks(): ReadonlyMap<string, AudioBookmark> {
    const out = new Map(this.bookmarks);
    if (this.playingTabId) {
      const live = this.bookmarkFor(this.playingTabId);
      if (live) out.set(this.playingTabId, live);
    }
    return out;
  }

  /** Load saved bookmarks (session restore). Anything unusable is skipped. Never starts playback or touches the reader. */
  restoreBookmarks(raw: ReadonlyMap<string, unknown> | Record<string, unknown> | null | undefined): void {
    if (!raw || typeof raw !== 'object') return;
    const entries: Array<[string, unknown]> = raw instanceof Map ? [...raw.entries()] : Object.entries(raw);
    let any = false;
    for (const [tabId, value] of entries) {
      const mark = typeof tabId === 'string' && tabId ? sanitizeBookmark(value) : null;
      if (!mark) continue;
      this.bookmarks.set(tabId, mark);
      any = true;
    }
    if (any) { this.bookmarksChanged.changed(); this.notify(); }
  }

  /** Bring the tab being read to the front (the app decides what that means). */
  revealPlayingTab(): void {
    if (this.playingTabId && this.status !== 'idle') this.reader.reveal?.(this.playingTabId);
  }

  private async startPlayback(tab: AudioReaderTab, from: VerseRef, queue?: PassageQueue): Promise<void> {
    const system = this.system;
    if (!system) return;
    // Listen on another tab while one plays: the first keeps its place (and its selection, which
    // the reader is not looking at).
    if (this.playingTabId && this.playingTabId !== tab.id) {
      this.bookmark(this.playingTabId, this.livePosition(), false);
    }
    if (queue) this.queue = queue;
    else if (!this.queue) this.queue = chapterQueueOf(from.book, from.chapter);
    this.pendingFrom = from;
    const seq = ++this.playSeq;
    this.cancelGate(false);
    this.staleSource = false;
    this.preparing = true;
    system.player.setStopAfter(null);
    // The old playback must not go on sounding (or moving on to a next chapter the
    // page will not follow) while this one resolves or waits behind a gate. Callers
    // have already captured where to resume from.
    if (system.player.state.status !== 'idle') system.player.pause();
    this.playingTabId = tab.id;
    this.playingModule = from.moduleAbbr;
    this.followTarget = { tabId: tab.id, module: from.moduleAbbr, book: from.book, chapter: from.chapter };
    this.status = 'resolving';
    this.error = null;
    this.progress = null;
    this.notice = null;
    this.notify();

    const language = this.languageOf(from.moduleAbbr);
    let resolution: SourceResolution | null = null;
    try {
      resolution = await system.resolver.resolve(from.moduleAbbr, language, this.prefs, this.sessionOverride.get(from.moduleAbbr));
    } catch { /* treated as nothing playable */ }
    if (seq !== this.playSeq) return;

    if (!resolution) {
      this.stopPlayer();
      this.resetPlayback();
      this.notice = { key: 'audio.notice.noAudio', tone: 'info', actions: [] };
      this.notify();
      return;
    }
    this.resolution = resolution;
    this.providerId = resolution.provider.id;
    this.providerLabel = resolution.provider.label;
    this.voiceId = resolution.voiceId ?? null;
    if (resolution.notice) this.notice = { key: resolution.notice, tone: 'info', actions: [] };

    let caps: AudioCapabilities;
    try {
      caps = resolution.provider.capabilities(from.moduleAbbr);
    } catch {
      this.abandon(seq);
      return;
    }
    void this.onDeviceOptionExists(from.moduleAbbr).then(v => { if (seq === this.playSeq) this.onDeviceAvailable = v; });
    const voice = await this.voiceInfo(resolution, from.moduleAbbr, language);
    if (seq !== this.playSeq) return;

    // Gates, only before the first sound of this play.
    const engineId = resolution.provider.id.replace(/^tts:/, '');
    let ready = true;
    try { ready = !caps.needsDownload || await resolution.provider.isReady(resolution.voiceId); } catch { ready = false; }
    if (seq !== this.playSeq) return;
    let downloadBytes = voice?.downloadBytes;
    if (!ready) {
      try { downloadBytes = (await resolution.provider.pendingBytes?.(resolution.voiceId)) ?? downloadBytes; } catch { /* keep the voice size */ }
      if (seq !== this.playSeq) return;
    }
    let downloadConfirmed = false;
    if (caps.onDevice && this.layout === 'phone' && !this.prefs.phoneBatteryNoticeSeen[engineId]) {
      // One notice covers both: what speech costs in battery and, when the voice is not on
      // the phone yet, the download ("Download and play").
      const ok = await this.openGate({
        kind: 'battery', engineId, engineLabel: resolution.provider.label, voiceLabel: voice?.label,
        bytes: ready ? undefined : downloadBytes,
      });
      if (seq !== this.playSeq) return;
      if (!ok) { this.abandon(seq); return; }
      this.setPrefs({ phoneBatteryNoticeSeen: { ...this.prefs.phoneBatteryNoticeSeen, [engineId]: true } });
      downloadConfirmed = !ready;
    }
    if (!ready && !downloadConfirmed) {
      const ok = await this.openGate({
        kind: 'download', engineLabel: resolution.provider.label, voiceLabel: voice?.label, bytes: downloadBytes,
      });
      if (seq !== this.playSeq) return;
      if (!ok) { this.abandon(seq); return; }
    }

    this.preparing = false;
    this.rate = effectiveRate(this.prefs.rate, caps);
    system.player.setStopAfter(this.stopAfterFor(from));
    await system.player.play(from, resolution.provider, {
      voiceId: resolution.voiceId,
      rate: this.rate,
      readIntro: this.prefs.readChapterIntro,
    });
  }

  private async voiceInfo(res: SourceResolution, moduleAbbr: string, language: string): Promise<AudioVoice | undefined> {
    try {
      const voices = await res.provider.voices(moduleAbbr, language);
      return voices.find(v => v.id === res.voiceId);
    } catch {
      return undefined;
    }
  }

  private abandon(seq: number): void {
    if (seq !== this.playSeq) return;
    this.stopPlayer();
    this.resetPlayback();
    this.notify();
  }

  private openGate(gate: PendingGate): Promise<boolean> {
    this.cancelGate(false);
    this.pendingGate = gate;
    this.notify();
    return new Promise<boolean>(resolve => { this.gateResolve = resolve; });
  }

  /** The reader accepted the pending gate (battery notice, voice download). */
  confirmGate(): void {
    const resolve = this.gateResolve;
    this.gateResolve = null;
    this.pendingGate = null;
    this.notify();
    resolve?.(true);
  }

  /** The reader declined it: nothing plays, nothing is downloaded. */
  cancelGate(notify = true): void {
    const resolve = this.gateResolve;
    this.gateResolve = null;
    const had = this.pendingGate !== null;
    this.pendingGate = null;
    resolve?.(false);
    if (had && notify) {
      this.playSeq++; // a cancelled gate ends this play
      this.stopPlayer();
      this.resetPlayback();
      this.notify();
    }
  }

  // ---------------------------------------------------------------- transport

  /** Play / pause for a tab (default: the active one). */
  togglePlay(tabId?: string): void {
    const tab = tabId ? this.reader.tab(tabId) : this.reader.activeTab();
    const onThisTab = !!tab && this.playingTabId === tab.id;
    if (onThisTab && this.status === 'resolving') { this.stop(); return; }
    if (onThisTab && (this.status === 'playing' || this.status === 'preparing' || this.status === 'buffering')) { this.pause(); return; }
    if (onThisTab && this.status === 'paused') { this.resume(); return; }
    void this.play(tab?.id);
  }

  pause(): void {
    const tab = this.playingTabId;
    const at = tab && this.status !== 'resolving' ? this.livePosition() : null;
    this.system?.player.pause();
    if (tab && at) this.bookmark(tab, at, true);
  }

  resume(): void {
    if (this.staleSource && this.playingTabId) {
      const tab = this.reader.tab(this.playingTabId);
      const current = this.system?.player.state.current;
      // `current` may still name the translation played before a change made while paused.
      if (tab && current) { void this.startPlayback(tab, { ...current, moduleAbbr: this.playingModule ?? current.moduleAbbr }); return; }
    }
    this.system?.player.resume();
  }

  /** Stop sound. The tab keeps its place: a bookmark, and the last verse read becomes its selected verse. */
  stop(): void {
    this.stopAndKeepPlace(true);
  }

  private stopAndKeepPlace(select: boolean): void {
    const tab = this.playingTabId;
    const at = tab ? this.livePosition() : null; // before the player forgets it
    const resolving = this.status === 'resolving';
    if (tab && at) this.bookmark(tab, at, select && !resolving); // while the queue is still known
    this.playSeq++;
    this.cancelGate(false);
    this.stopPlayer();
    this.resetPlayback();
    this.notify();
  }

  /** `player.stop()` that the store itself asked for (its idle state is not a natural end). */
  private stopPlayer(): void {
    this.stopping = true;
    try { this.system?.player.stop(); } finally { this.stopping = false; }
  }

  seekVerse(delta: 1 | -1): void {
    const q = this.queue;
    const player = this.system?.player;
    const current = player?.state.current;
    if (player && q?.kind === 'list' && current && player.state.status !== 'idle') {
      const p = q.passages[q.index];
      const stop = stopVerseIn(p, current.book, current.chapter);
      if (delta === 1 && stop !== null && current.verse >= stop) { this.nextPassage(); return; }
      const start = passageStart(p);
      if (delta === -1 && current.book === start.book && current.chapter === start.chapter && current.verse <= start.verse) {
        void player.seekToVerse(current.verse); // the passage's first verse: restart it, never leave the passage
        return;
      }
    }
    void player?.seekVerse(delta);
  }

  seekChapter(delta: 1 | -1): void {
    void this.system?.player.seekChapter(delta);
  }

  /** Try again after an error, from where it failed. */
  retry(): void {
    const err = this.error;
    if (err?.retryable) { this.system?.player.resume(); return; }
    const tab = this.playingTabId ? this.reader.tab(this.playingTabId) : undefined;
    const current = this.system?.player.state.current;
    if (tab && current) void this.startPlayback(tab, current);
  }

  /** After an error: play with an on-device voice for this session (not remembered). */
  async useOnDeviceInstead(): Promise<void> {
    const system = this.system;
    const tab = this.playingTabId ? this.reader.tab(this.playingTabId) : undefined;
    const current = system?.player.state.current ?? null;
    if (!system || !tab || !current) return;
    const seq = this.playSeq;
    const options = await system.resolver.options(current.moduleAbbr, this.languageOf(current.moduleAbbr));
    if (seq !== this.playSeq) return; // stopped or replaced while we looked
    const onDevice = options.find(o => o.provider.capabilities(current.moduleAbbr).onDevice);
    if (!onDevice) return;
    this.sessionOverride.set(current.moduleAbbr, onDevice.provider.id as AudioSourceChoice);
    await this.startPlayback(tab, current);
  }

  /** Providers (other than the current one) that could speak this translation on the device. */
  async onDeviceOptionExists(moduleAbbr: string): Promise<boolean> {
    const system = this.system;
    if (!system) return false;
    const options = await system.resolver.options(moduleAbbr, this.languageOf(moduleAbbr));
    return options.some(o => o.provider.capabilities(moduleAbbr).onDevice && o.provider.id !== this.providerId);
  }

  /** From the verse the reader clicked in the progress bar: restart there, in the current source. */
  jumpToVerse(verse: number): void {
    const tab = this.playingTabId ? this.reader.tab(this.playingTabId) : undefined;
    const current = this.system?.player.state.current;
    if (!tab || !current) return;
    if (verse === current.verse) {
      if (this.status === 'paused') this.resume();
      return;
    }
    const from = { ...current, moduleAbbr: this.playingModule ?? current.moduleAbbr, verse };
    // Same chapter, same source: move within it, so the highlight changes at once. Anything else
    // (no chapter open yet, still resolving) restarts.
    const player = this.system?.player;
    if (player && !this.preparing) {
      void player.seekToVerse(verse).then(moved => { if (!moved) void this.startPlayback(tab, from); });
      return;
    }
    void this.startPlayback(tab, from);
  }

  // ---------------------------------------------------------------- sources and voices

  /** Every registered source for a translation, usable or not, for the source control. */
  async sources(moduleAbbr: string): Promise<SourceStatus[]> {
    const system = this.system;
    if (!system) return [];
    return system.resolver.sourceStatus(moduleAbbr, this.languageOf(moduleAbbr));
  }

  /** The enabled on-device engines by id (empty when audio is off). */
  get engines(): ReadonlyMap<string, ITtsEngine> {
    return this.system?.engines ?? new Map();
  }

  /** A download or removal changed what can play: forget cached answers and let the UI re-ask. */
  invalidateSources(moduleAbbr?: string): void {
    this.system?.resolver.invalidate(moduleAbbr);
    this.availabilityAskedAt.clear();
    this.sourcesVersion++;
    this.notify();
  }

  /** Source for one translation; `undefined` goes back to the global choice. */
  setTranslationSource(moduleAbbr: string, source: AudioSourceChoice | undefined): void {
    this.sessionOverride.delete(moduleAbbr); // an explicit pick beats "use on-device speech instead"
    const per = { ...this.prefs.perTranslation };
    const entry = { ...per[moduleAbbr], source };
    if (source === undefined) delete entry.source;
    if (Object.keys(entry).length === 0) delete per[moduleAbbr]; else per[moduleAbbr] = entry;
    this.setPrefs({ perTranslation: per });
  }

  /** Voice for one translation; `undefined` goes back to the language's voice. */
  setTranslationVoice(moduleAbbr: string, voiceId: string | undefined): void {
    const per = { ...this.prefs.perTranslation };
    const entry = { ...per[moduleAbbr], voiceId };
    if (voiceId === undefined) delete entry.voiceId;
    if (Object.keys(entry).length === 0) delete per[moduleAbbr]; else per[moduleAbbr] = entry;
    this.setPrefs({ perTranslation: per });
  }

  /** The voice an engine uses for a language (`piper`, `en`). */
  setEngineVoice(engineId: string, language: string, voiceId: string): void {
    this.setPrefs({ voiceByEngineLang: { ...this.prefs.voiceByEngineLang, [`${engineId}:${language.toLowerCase().split(/[-_]/)[0]}`]: voiceId } });
  }

  // ---------------------------------------------------------------- prefs

  setPrefs(patch: Partial<AudioUiPrefs>): void {
    const before = this.prefs;
    if (patch.source !== undefined) this.sessionOverride.clear();
    this.prefs = sanitizeAudioPrefs({ ...before, ...patch });
    saveAudioPrefs(this.prefs, this.storage === undefined ? undefined : this.storage);
    this.notify();

    if (!this.system || !this.playingTabId) return;
    if (this.prefs.rate !== before.rate && this.resolution) {
      const caps = this.resolution.provider.capabilities(this.playingModule ?? '');
      this.rate = effectiveRate(this.prefs.rate, caps);
      this.system.player.setRate(this.rate);
    }
    if (patch.source !== undefined || patch.perTranslation !== undefined || patch.voiceByEngineLang !== undefined) {
      void this.reresolve();
    }
  }

  /** Re-check which source plays now, and restart (or mark stale, when paused) if it changed. */
  private async reresolve(): Promise<void> {
    const system = this.system;
    const module = this.playingModule;
    const tab = this.playingTabId ? this.reader.tab(this.playingTabId) : undefined;
    const current = system?.player.state.current;
    if (!system || !module || !tab || !current || this.status === 'resolving') return;
    const seq = this.playSeq;
    system.resolver.invalidate(module);
    const res = await system.resolver.resolve(module, this.languageOf(module), this.prefs, this.sessionOverride.get(module)).catch(() => null);
    if (seq !== this.playSeq || !res) return;
    if (res.provider.id === this.providerId && (res.voiceId ?? null) === this.voiceId) { this.staleSource = false; return; }
    if (this.status === 'paused') { this.staleSource = true; return; }
    await this.startPlayback(tab, current);
  }

  // ---------------------------------------------------------------- player events

  private onPlayerState(s: PlayerState): void {
    if (this.preparing) return; // still resolving / gating: the player state is about a previous playback
    this.position.set(s.position, s.duration);
    // Turn the page when reading moves into another chapter (a chapter button,
    // a seek across a chapter edge, or auto-advance). Before mirroring, so a
    // navigation this store makes is never mistaken for the reader's own.
    if (s.current && this.followTarget && this.playingTabId
        && (s.current.book !== this.followTarget.book || s.current.chapter !== this.followTarget.chapter)) {
      this.followTarget = { ...this.followTarget, module: s.current.moduleAbbr, book: s.current.book, chapter: s.current.chapter };
      // The default list is "the chapter in hand": it moves along as reading does.
      if (this.queue?.kind === 'chapter') this.queue = chapterQueueOf(s.current.book, s.current.chapter);
      void this.reader.followTo(this.playingTabId, s.current.book, s.current.chapter);
    }

    if (s.status === 'idle') {
      if (this.status === 'idle') return;
      // Stopped by the store: it keeps the place itself. Otherwise the reading ran out (a chapter, a book
      // or a list ended and nobody continued): nothing to resume, and the selection stays where it is.
      if (!this.stopping && this.playingTabId) this.dropBookmark(this.playingTabId);
      this.resetPlayback();
      this.notify();
      return;
    }
    const error = s.status === 'error' ? s.error : null;
    const notice = error ? this.noticeFor(error) : (this.notice?.tone === 'error' ? null : this.notice);
    const changed = this.status !== s.status
      || this.providerId !== s.providerId
      || this.voiceId !== s.voiceId
      || this.rate !== s.rate
      || this.error !== error
      || !sameProgress(this.progress, s.progress);
    this.status = s.status;
    this.providerId = s.providerId;
    this.voiceId = s.voiceId;
    this.rate = s.rate;
    this.progress = s.progress;
    this.error = error;
    this.notice = notice;
    if (changed) this.notify();
  }

  private noticeFor(error: AudioError): AudioNotice | null {
    if (error.code === 'aborted') return null;
    const actions: NoticeAction[] = [];
    if (error.code === 'autoplay') actions.push('resume');
    else if (error.retryable) actions.push('retry');
    // "Use on-device speech" only when another, on-device, provider exists for this language.
    if (this.onDeviceAvailable && error.code !== 'autoplay') actions.push('useOnDevice');
    return { key: `audio.error.${error.code}`, tone: 'error', actions };
  }

  /** Cached answer for "is there an on-device alternative to the current provider" (refreshed on play). */
  private onDeviceAvailable = false;

  private onVerse(v: VerseRef): void {
    const t = this.followTarget;
    if (!t || v.moduleAbbr !== t.module || v.book !== t.book || v.chapter !== t.chapter) return;
    this.follow.set(t.tabId, verseIdOf(v.book, v.chapter, v.verse));
  }

  /** Runs synchronously inside the player's chapterEnd emission (see AudioPlayer). */
  private onChapterEnd(next: ChapterRef | null): void {
    const t = this.followTarget;
    // Not while a new playback is still resolving: the page would not follow it.
    if (this.preparing || !this.system || !t) return;
    const q = this.queue;
    if (q?.kind === 'list') {
      // A typed list ignores "continue to the next chapter": the passage decides.
      const p = q.passages[q.index];
      if (t.book === p.book && t.chapter < passageLastChapter(p) && next && next.book === t.book) {
        this.continueTo({ moduleAbbr: t.module, book: next.book, chapter: next.chapter, verse: 1 });
        return;
      }
      this.afterPassage(q); // also when the stop verse never existed in this chapter
      return;
    }
    // The default list: the chapter in hand.
    if (this.prefs.passageLoop !== 'once') {
      this.continueTo({ moduleAbbr: t.module, book: t.book, chapter: t.chapter, verse: 1 }); // looping beats continuing
      return;
    }
    // "Continue to the next chapter (stops at the end of the book)".
    if (next && this.prefs.continueAfterChapter === 'next-chapter' && next.book === t.book) {
      void this.system.player.seekChapter(1);
    }
  }

  /** The stop verse of the current passage was read. */
  private onStopReached(_at: VerseRef): void {
    const q = this.queue;
    if (this.preparing || !this.system || !this.followTarget || q?.kind !== 'list') return;
    this.afterPassage(q);
  }

  /** The current passage is done: go on to what the loop mode says, or end (the player goes idle). */
  private afterPassage(q: PassageQueue): void {
    const j = nextIndex(q, this.prefs.passageLoop);
    if (j === null) return;
    const next: PassageQueue = { ...q, index: j };
    const start = passageStart(next.passages[j]);
    const module = this.playingModule;
    if (!module) return;
    const prev = this.queue;
    this.queue = next;
    if (!this.continueTo({ moduleAbbr: module, ...start })) { this.queue = prev; return; }
    this.notify();
  }

  /**
   * Play on from `from`, synchronously: called inside the player's own `chapterEnd` / `stopReached`
   * emission, which is the only moment a browser still lets audio carry on without a gesture.
   * Same source and translation, so no gates or resolving.
   */
  private continueTo(from: VerseRef): boolean {
    const system = this.system;
    const resolution = this.resolution;
    const t = this.followTarget;
    if (!system || !resolution || !t || from.moduleAbbr !== this.playingModule) return false;
    this.followTarget = { ...t, module: from.moduleAbbr, book: from.book, chapter: from.chapter };
    if (this.queue?.kind === 'chapter') this.queue = chapterQueueOf(from.book, from.chapter);
    system.player.setStopAfter(this.stopAfterFor(from));
    void system.player.play(from, resolution.provider, {
      voiceId: resolution.voiceId, rate: this.rate, readIntro: this.prefs.readChapterIntro,
    });
    if (t.book !== from.book || t.chapter !== from.chapter) void this.reader.followTo(t.tabId, from.book, from.chapter);
    return true;
  }

  /** Where the player must stop in this chapter for the current passage (null: read to the chapter's end). */
  private stopAfterFor(from: VerseRef): VerseRef | null {
    const q = this.queue;
    if (!q || q.kind !== 'list') return null;
    const verse = stopVerseIn(q.passages[q.index], from.book, from.chapter);
    return verse === null ? null : { moduleAbbr: from.moduleAbbr, book: from.book, chapter: from.chapter, verse };
  }

  // ---------------------------------------------------------------- Bible store coupling

  private onBibleChanged(): void {
    // Closed tabs lose their place (only once the reader has tabs at all: a restore may come first).
    if (this.bookmarks.size > 0 && this.reader.activeTab()) {
      for (const id of [...this.bookmarks.keys()]) {
        if (id !== this.playingTabId && !this.reader.tab(id)) this.dropBookmark(id);
      }
    }
    if (!this.playingTabId || this.status === 'idle') return;
    const tab = this.reader.tab(this.playingTabId);
    if (!tab) { // the playing tab was closed
      const id = this.playingTabId;
      this.stopAndKeepPlace(false);
      this.dropBookmark(id);
      return;
    }
    const target = this.followTarget;
    if (!target) return;
    // The reader moved the playing tab to another chapter. Our own page turns
    // update `followTarget` before they navigate, so they never trip this.
    if (tab.book !== target.book || tab.chapter !== target.chapter) {
      if (tab.book === null || tab.chapter === null) return; // a load in progress with no passage yet
      this.stopAndKeepPlace(false); // that chapter is no longer on screen: keep the place, select nothing
      return;
    }
    if (tab.moduleAbbr !== this.playingModule) {
      this.restartInModule(tab);
    }
  }

  /**
   * The translation of the playing tab changed: play on from the same verse in
   * the new one. Started synchronously (no resolve first): `startPlayback` bumps
   * the play sequence and records the new module before it awaits anything, so a
   * second notification for the same change, a Stop, or a newer play can never be
   * overridden by a stale continuation, and it posts the "no audio" notice itself
   * when the new translation cannot be played. While paused nothing is started:
   * the change waits for Resume, like a source change does.
   */
  private restartInModule(tab: AudioReaderTab): void {
    const current = this.system?.player.state.current;
    if (!this.system || !current) return;
    if (this.status === 'paused') {
      this.playingModule = tab.moduleAbbr;
      if (this.followTarget) this.followTarget = { ...this.followTarget, module: tab.moduleAbbr };
      this.staleSource = true;
      return;
    }
    void this.startPlayback(tab, { ...current, moduleAbbr: tab.moduleAbbr });
  }

  // ---------------------------------------------------------------- misc

  /** The capabilities of the provider currently in use (speed range, voices), for the transport bar. */
  get capabilities(): AudioCapabilities | null {
    return this.resolution && this.playingModule ? this.resolution.provider.capabilities(this.playingModule) : null;
  }

  get provider(): IAudioProvider | null {
    return this.resolution?.provider ?? null;
  }

  private resetPlayback(): void {
    this.queue = null;
    this.pendingFrom = null;
    this.playerOpen = false;
    this.quickSettingsOpen = false;
    this.preparing = false;
    this.status = 'idle';
    this.playingTabId = null;
    this.playingModule = null;
    this.providerId = null;
    this.providerLabel = null;
    this.voiceId = null;
    this.progress = null;
    this.error = null;
    this.resolution = null;
    this.followTarget = null;
    this.onDeviceAvailable = false;
    this.staleSource = false;
    this.pendingGate = null;
    this.gateResolve = null;
    // An error notice names the chapter being played; once playback is gone it would read "There is no recording of ."
    if (this.notice?.tone === 'error') this.notice = null;
    this.follow.set(null, null);
    this.position.set(0, null);
  }

  /** Test seam: forget everything, including the system. */
  reset(): void {
    this.dispose();
    this.prefs = defaultAudioPrefs();
    this.bookmarks.clear();
    this.targetTabId = null;
    this.notice = null;
    this.layout = 'desktop';
  }

  clearNotice(): void {
    if (!this.notice) return;
    this.notice = null;
    this.notify();
  }
}

function chapterQueueOf(book: number, chapter: number): PassageQueue {
  return { kind: 'chapter', passages: [{ book, chapter }], index: 0 };
}

function sameProgress(a: LoadProgress | null, b: LoadProgress | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  // Progress arrives in small steps; whole-percent changes are enough for a bar.
  const pct = (p: LoadProgress) => (p.total ? Math.floor((p.loaded / p.total) * 100) : p.loaded);
  return a.phase === b.phase && pct(a) === pct(b);
}

