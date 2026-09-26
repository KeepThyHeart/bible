/**
 * The store the audio UI talks to.
 *
 * It owns nothing about *how* audio is made. It holds the listener's
 * preferences, asks the resolver which provider plays a translation, puts the
 * confirmation gates (phone battery, voice download) in front of the first
 * sound, hands the result to the one `IAudioPlayer`, and mirrors the player's
 * state for the components. It also couples playback to the Bible store in the
 * two ways the design allows and no further:
 *
 * - **Follow-along is a highlight, nothing more.** The verse being read is
 *   published in `audioStore.follow`; the Bible text draws it and scrolls to it.
 *   It never selects the verse, never moves `studyVerse`, never makes the Study
 *   or Commentary panes refresh, and never pushes a history entry. Those change
 *   only when the reader clicks or selects a verse. When reading moves into the
 *   next chapter the page is turned with `navigateTo({ follow: true })`, which
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
import { bibleStore } from './bibleStore';
import type { BibleTab } from './bibleStore';
import { moduleStore } from './moduleStore';
import {
  defaultAudioPrefs, effectiveRate, loadAudioPrefs, saveAudioPrefs, sanitizeAudioPrefs,
} from '../audio/audioPrefs';
import type { AudioSourceResolver } from '../audio/AudioSourceResolver';
import type {
  AudioCapabilities,
  AudioError,
  AudioPrefs,
  AudioSiteConfig,
  AudioSourceChoice,
  AudioVoice,
  ChapterRef,
  IAudioPlayer,
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
  | { kind: 'battery'; engineId: string; engineLabel: string; voiceLabel?: string; bytes?: number }
  | { kind: 'download'; engineLabel: string; voiceLabel?: string; bytes?: number };

export type Availability = 'unknown' | 'none' | 'ok';

export interface AudioSystem {
  player: IAudioPlayer;
  resolver: AudioSourceResolver;
  config: AudioSiteConfig;
  /** BCP-47 language of a translation; '' while the module list is not loaded. */
  languageOf?(moduleAbbr: string): string;
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

interface FollowTarget { tabId: string; module: string; book: number; chapter: number }

const verseIdOf = (book: number, chapter: number, verse: number): number => book * 1_000_000 + chapter * 1_000 + verse;

class AudioStore extends Store {
  readonly position = new PositionStore();
  readonly follow = new FollowStore();

  prefs: AudioPrefs = defaultAudioPrefs();
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

  private system: AudioSystem | null = null;
  private resolution: SourceResolution | null = null;
  private followTarget: FollowTarget | null = null;
  private playSeq = 0;
  private gateResolve: ((ok: boolean) => void) | null = null;
  /** True from the start of `play()` until `player.play()` is called: player events are ignored. */
  private preparing = false;
  private staleSource = false;
  private readonly sessionOverride = new Map<string, AudioSourceChoice>();
  private availabilityRequested = new Set<string>();
  private offBible: (() => void) | null = null;
  private offPlayer: Array<() => void> = [];
  private offModules: (() => void) | null = null;
  private storage: Pick<Storage, 'getItem' | 'setItem'> | null | undefined;

  // ---------------------------------------------------------------- lifecycle

  /**
   * Wire the store to a built audio system. `storage` is for tests; the default
   * is `localStorage`. Calling it again replaces the previous system.
   */
  init(system: AudioSystem, storage?: Pick<Storage, 'getItem' | 'setItem'> | null): void {
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
    ];
    this.offBible = bibleStore.subscribe(() => this.onBibleChanged());
    this.offModules = moduleStore.subscribe(() => {
      // The module list arriving (or changing) may change what can play.
      this.availabilityRequested.clear();
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
    this.system?.player.stop();
    this.system = null;
    this.resetPlayback();
    this.enabled = false;
    this.availabilityRequested.clear();
    this.sessionOverride.clear();
  }

  setLayout(layout: 'desktop' | 'phone'): void {
    if (this.layout === layout) return;
    this.layout = layout;
    this.notify();
  }

  // ---------------------------------------------------------------- availability

  private languageOf(moduleAbbr: string): string {
    if (this.system?.languageOf) return this.system.languageOf(moduleAbbr);
    return moduleStore.getBibleModules().find(m => m.abbreviation === moduleAbbr)?.language_code ?? '';
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
    if (cached === undefined && !this.availabilityRequested.has(key)) {
      this.availabilityRequested.add(key);
      void system.resolver.resolve(moduleAbbr, language, this.prefs, this.sessionOverride.get(moduleAbbr))
        .catch(() => null)
        .then(() => this.notify());
    }
    return cached === undefined ? 'unknown' : 'none';
  }

  /** Whether Play should be enabled for a tab right now. */
  canPlay(tab: BibleTab | undefined): boolean {
    if (!this.enabled || !tab || tab.loading || tab.verses.length === 0 || !tab.book || !tab.chapter) return false;
    return this.availability(tab.moduleAbbr) === 'ok';
  }

  /** Is this tab the one being read to (in any active state)? */
  isPlayingTab(tabId: string | undefined): boolean {
    return !!tabId && this.playingTabId === tabId && this.status !== 'idle';
  }

  // ---------------------------------------------------------------- play

  /** Where playback starts: the selected verse (or range start) of this chapter, else the first verse. */
  private startVerse(tab: BibleTab): VerseRef {
    const base = { moduleAbbr: tab.moduleAbbr, book: tab.book!, chapter: tab.chapter! };
    const inChapter = (id: number | null | undefined): id is number =>
      id != null && Math.floor(id / 1_000_000) === tab.book && Math.floor(id / 1_000) % 1_000 === tab.chapter;
    const range = tab.id === bibleStore.activeTabId ? bibleStore.getSelectedRange() : null;
    const picked = inChapter(range?.start) ? range!.start : inChapter(tab.studyVerse) ? tab.studyVerse : null;
    if (picked !== null) return { ...base, verse: picked % 1_000 };
    const first = tab.verses.find(v => v.verse >= 1) ?? tab.verses[0];
    return { ...base, verse: first?.verse ?? 1 };
  }

  /** Play the active tab's chapter from the selected verse. */
  async play(): Promise<void> {
    const tab = bibleStore.getActiveTab();
    if (!this.system || !tab || !this.canPlay(tab)) return;
    if (this.status === 'resolving' && this.playingTabId === tab.id) return; // a double click
    await this.startPlayback(tab, this.startVerse(tab));
  }

  private async startPlayback(tab: BibleTab, from: VerseRef): Promise<void> {
    const system = this.system;
    if (!system) return;
    const seq = ++this.playSeq;
    this.cancelGate(false);
    this.staleSource = false;
    this.preparing = true;
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
      system.player.stop();
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

    const caps = resolution.provider.capabilities(from.moduleAbbr);
    const voice = await this.voiceInfo(resolution, from.moduleAbbr, language);
    if (seq !== this.playSeq) return;

    // Gates, only before the first sound of this play.
    const engineId = resolution.provider.id.replace(/^tts:/, '');
    if (caps.onDevice && this.layout === 'phone' && !this.prefs.phoneBatteryNoticeSeen[engineId]) {
      const ok = await this.openGate({
        kind: 'battery', engineId, engineLabel: resolution.provider.label, voiceLabel: voice?.label, bytes: voice?.downloadBytes,
      });
      if (seq !== this.playSeq) return;
      if (!ok) { this.abandon(seq); return; }
      this.setPrefs({ phoneBatteryNoticeSeen: { ...this.prefs.phoneBatteryNoticeSeen, [engineId]: true } });
    }
    let ready = true;
    try { ready = !caps.needsDownload || await resolution.provider.isReady(resolution.voiceId); } catch { ready = false; }
    if (seq !== this.playSeq) return;
    if (!ready) {
      const ok = await this.openGate({
        kind: 'download', engineLabel: resolution.provider.label, voiceLabel: voice?.label, bytes: voice?.downloadBytes,
      });
      if (seq !== this.playSeq) return;
      if (!ok) { this.abandon(seq); return; }
    }

    this.preparing = false;
    this.rate = effectiveRate(this.prefs.rate, caps);
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
    this.system?.player.stop();
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
      this.system?.player.stop();
      this.resetPlayback();
      this.notify();
    }
  }

  // ---------------------------------------------------------------- transport

  togglePlay(): void {
    const tab = bibleStore.getActiveTab();
    const onThisTab = !!tab && this.playingTabId === tab.id;
    if (onThisTab && this.status === 'resolving') { this.stop(); return; }
    if (onThisTab && (this.status === 'playing' || this.status === 'preparing' || this.status === 'buffering')) { this.pause(); return; }
    if (onThisTab && this.status === 'paused') { this.resume(); return; }
    void this.play();
  }

  pause(): void {
    this.system?.player.pause();
  }

  resume(): void {
    if (this.staleSource && this.playingTabId) {
      const tab = bibleStore.tabs.find(t => t.id === this.playingTabId);
      const current = this.system?.player.state.current;
      if (tab && current) { void this.startPlayback(tab, current); return; }
    }
    this.system?.player.resume();
  }

  stop(): void {
    this.playSeq++;
    this.cancelGate(false);
    this.system?.player.stop();
    this.resetPlayback();
    this.notify();
  }

  seekVerse(delta: 1 | -1): void {
    void this.system?.player.seekVerse(delta);
  }

  seekChapter(delta: 1 | -1): void {
    void this.system?.player.seekChapter(delta);
  }

  /** Try again after an error, from where it failed. */
  retry(): void {
    const err = this.error;
    if (err?.retryable) { this.system?.player.resume(); return; }
    const tab = this.playingTabId ? bibleStore.tabs.find(t => t.id === this.playingTabId) : undefined;
    const current = this.system?.player.state.current;
    if (tab && current) void this.startPlayback(tab, current);
  }

  /** After an error: play with an on-device voice for this session (not remembered). */
  async useOnDeviceInstead(): Promise<void> {
    const system = this.system;
    const tab = this.playingTabId ? bibleStore.tabs.find(t => t.id === this.playingTabId) : undefined;
    const current = system?.player.state.current ?? null;
    if (!system || !tab || !current) return;
    const options = await system.resolver.options(current.moduleAbbr, this.languageOf(current.moduleAbbr));
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

  // ---------------------------------------------------------------- prefs

  setPrefs(patch: Partial<AudioPrefs>): void {
    const before = this.prefs;
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
    const tab = this.playingTabId ? bibleStore.tabs.find(t => t.id === this.playingTabId) : undefined;
    const current = system?.player.state.current;
    if (!system || !module || !tab || !current || this.status === 'resolving') return;
    const seq = this.playSeq;
    system.resolver.invalidate(module);
    const res = await system.resolver.resolve(module, this.languageOf(module), this.prefs, this.sessionOverride.get(module)).catch(() => null);
    if (seq !== this.playSeq || !res) return;
    if (res.provider.id === this.providerId && (res.voiceId ?? null) === this.voiceId) return;
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
      void bibleStore.navigateTo(s.current.book, s.current.chapter, undefined, { follow: true, tabId: this.playingTabId });
    }

    if (s.status === 'idle') {
      // Stopped, or the chapter (or the book) ended and nobody continued.
      if (this.status !== 'idle') { this.resetPlayback(); this.notify(); }
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
    if (!this.system || !t || !next) return;
    // "Continue to the next chapter (stops at the end of the book)".
    if (this.prefs.continueAfterChapter === 'next-chapter' && next.book === t.book) {
      void this.system.player.seekChapter(1);
    }
  }

  // ---------------------------------------------------------------- Bible store coupling

  private onBibleChanged(): void {
    if (!this.playingTabId || this.status === 'idle') return;
    const tab = bibleStore.tabs.find(t => t.id === this.playingTabId);
    if (!tab) { this.stop(); return; } // the playing tab was closed
    const target = this.followTarget;
    if (!target) return;
    // The reader moved the playing tab to another chapter. Our own page turns
    // update `followTarget` before they navigate, so they never trip this.
    if (tab.book !== target.book || tab.chapter !== target.chapter) {
      if (tab.book === null || tab.chapter === null) return; // a load in progress with no passage yet
      this.stop();
      return;
    }
    if (tab.moduleAbbr !== this.playingModule) {
      void this.restartInModule(tab);
    }
  }

  /** The translation of the playing tab changed: play on from the same verse in the new one. */
  private async restartInModule(tab: BibleTab): Promise<void> {
    const system = this.system;
    const current = system?.player.state.current;
    if (!system || !current) return;
    const language = this.languageOf(tab.moduleAbbr);
    const res = await system.resolver.resolve(tab.moduleAbbr, language, this.prefs, this.sessionOverride.get(tab.moduleAbbr)).catch(() => null);
    if (!this.system || this.playingTabId !== tab.id || tab.moduleAbbr === this.playingModule && !res) return;
    if (!res) {
      this.stop();
      this.notice = { key: 'audio.notice.noAudio', tone: 'info', actions: [] };
      this.notify();
      return;
    }
    await this.startPlayback(tab, { ...current, moduleAbbr: tab.moduleAbbr });
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
    this.staleSource = false;
    this.pendingGate = null;
    this.gateResolve = null;
    this.follow.set(null, null);
    this.position.set(0, null);
  }

  /** Test seam: forget everything, including the system. */
  reset(): void {
    this.dispose();
    this.prefs = defaultAudioPrefs();
    this.notice = null;
    this.layout = 'desktop';
  }

  clearNotice(): void {
    if (!this.notice) return;
    this.notice = null;
    this.notify();
  }
}

function sameProgress(a: LoadProgress | null, b: LoadProgress | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  // Progress arrives in small steps; whole-percent changes are enough for a bar.
  const pct = (p: LoadProgress) => (p.total ? Math.floor((p.loaded / p.total) * 100) : p.loaded);
  return a.phase === b.phase && pct(a) === pct(b);
}

export const audioStore = new AudioStore();
export type { AudioStore };
