import { Store } from './Store';
import { webSettings, WEB_SETTINGS, STORAGE_KEY } from './settingsRegistry';
import { moduleStore } from './moduleStore';
import { isValidTheme, getThemeById } from '../themes/themeRegistry';
import type { ModuleInfo } from '../types';
import { watchSettingsStore } from '../modules/host/readerHooks';


/** Used only when there is no configured default and no installed Bible to name. */
const LAST_RESORT_BIBLE = 'KJV';

function findBible(bibles: ModuleInfo[], abbreviation: string): ModuleInfo | undefined {
  const wanted = abbreviation.toLowerCase();
  return bibles.find(m => m.abbreviation.toLowerCase() === wanted);
}

/** Theme ID string. Valid values are discovered at build time from src/themes/. */
export type ThemeName = string;

/**
 * How study mode lays out interlinear data.
 * - `inline`: the translation reads as prose, each word trailed by its
 *   original-language word in parentheses.
 * - `stacked`: one column per word, English above the original language.
 */
export type InterlinearLayout = 'inline' | 'stacked';

export interface FontScheme {
  id: string;
  label: string;
  headingFont: string;
  contentFont: string;
  group: 'recommended' | 'other';
}

export const FONT_SCHEMES: FontScheme[] = [
  // Recommended: clean, highly readable, proven for long-form reading
  { id: 'classic', label: 'Classic (Georgia)', headingFont: 'Georgia, serif', contentFont: 'Georgia, serif', group: 'recommended' },
  { id: 'lora', label: 'Lora', headingFont: "'Playfair Display', serif", contentFont: "'Lora', serif", group: 'recommended' },
  { id: 'merriweather', label: 'Merriweather', headingFont: "'Merriweather', serif", contentFont: "'Merriweather', serif", group: 'recommended' },
  { id: 'crimson', label: 'Crimson Pro', headingFont: "'Libre Baskerville', serif", contentFont: "'Crimson Pro', serif", group: 'recommended' },
  { id: 'baskerville', label: 'Libre Baskerville', headingFont: "'EB Garamond', serif", contentFont: "'Libre Baskerville', serif", group: 'recommended' },
  // Other: distinctive, more stylistic choices
  { id: 'times', label: 'Times', headingFont: "'Palatino Linotype', serif", contentFont: "'Times New Roman', serif", group: 'other' },
  { id: 'modern', label: 'Modern (Sans-Serif)', headingFont: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", contentFont: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", group: 'other' },
  { id: 'garamond', label: 'EB Garamond', headingFont: "'Playfair Display', serif", contentFont: "'EB Garamond', serif", group: 'other' },
  { id: 'playfair', label: 'Playfair Display', headingFont: "'Playfair Display', serif", contentFont: "'Crimson Pro', serif", group: 'other' },
  { id: 'cormorant', label: 'Cormorant Garamond', headingFont: "'Cormorant Garamond', serif", contentFont: "'Cormorant Garamond', serif", group: 'other' },
  { id: 'spectral', label: 'Spectral', headingFont: "'Playfair Display', serif", contentFont: "'Spectral', serif", group: 'other' },
  { id: 'book-antiqua', label: 'Book Antiqua', headingFont: "'Book Antiqua', serif", contentFont: "'Book Antiqua', serif", group: 'other' },
];

/**
 * The one place a default setting value is written down.
 *
 * The field initializers, `resetToDefaults()` and `resetTextSettings()` all
 * read from here. They used to each carry their own copy of every literal,
 * which is a silent drift hazard: changing a default in one place and not the
 * other makes "reset" restore something that was never the default.
 */
export const DEFAULT_SETTINGS = {
  theme: 'auto' as ThemeName,
  fontSchemeId: 'classic',
  fontFamily: 'Georgia, serif',
  headingFontFamily: 'Georgia, serif',
  studyFontFamily: 'Georgia, serif',
  // Text sizes are stored as "px at the browser's default 16px root" and
  // published to CSS as rem (see `pxToRem`), so they follow the reader's browser
  // font-size preference: 19 = 1.1875rem, 17 = 1.0625rem, 16 = 1rem.
  fontSize: 19,
  studyFontSize: 17,
  uiFontSize: 16,
  lineHeight: 1.8,
  studyLineHeight: 1.6,
  wordsOfChristInRed: true,
  browserSemanticSearch: false,
  excludedTopicalModules: [] as string[],
  showCommentaryOverview: true,
  leftHandedMode: false,
  dismissedDisclaimerModules: [] as string[],
  // Owned by the settings registry (`settingsRegistry.ts`); read from there so there is one default.
  swipeChaptersEnabled: WEB_SETTINGS.defaultFor('swipeChaptersEnabled') as boolean,
  swipeChapterThresholdPx: WEB_SETTINGS.defaultFor('swipeChapterThresholdPx') as number,
  swipeCommentaryVerseThresholdPx: WEB_SETTINGS.defaultFor('swipeCommentaryVerseThresholdPx') as number,
  interlinearLayout: 'stacked' as InterlinearLayout,
};

/** The root size the stored text sizes are expressed against (the browser default). */
export const ROOT_FONT_BASE_PX = 16;

/**
 * A stored text size as a CSS length relative to the root font size.
 *
 * At the browser default (16px) this renders exactly `px` pixels; a reader who
 * raised their browser's default font size gets proportionally larger text.
 */
export function pxToRem(px: number): string {
  return `${px / ROOT_FONT_BASE_PX}rem`;
}

/**
 * The sizes the stylesheets' `calc(<rem> * var(--ui-font-scale, 1))` and
 * `--study-font-scale` literals were authored against (as px, before they
 * became rem at 16px = 1rem). The scale is the chosen
 * size over this baseline, so each element keeps its proportion to the
 * setting: a `calc(0.8125rem * var(--ui-font-scale, 1))` label (13px when the
 * UI text was 14px) renders at 13/14 of the UI text size.
 */
const UI_SCALE_BASE_PX = 14;
const STUDY_SCALE_BASE_PX = 15;

/**
 * Version of the text-size settings in the stored blob. Version 1 (implicit:
 * no `textSizeVersion` key) used px defaults of 18/15/14; version 2 moved to
 * rem-based output with defaults of 19/17/16.
 */
const TEXT_SIZE_VERSION = 2;
const LEGACY_TEXT_SIZE_DEFAULTS = { fontSize: 18, studyFontSize: 15, uiFontSize: 14 } as const;

/** Allowed range and click-step for each text-size setting. */
export const TEXT_SIZE_RANGES = {
  fontSize: { min: 12, max: 48, step: 1 },
  studyFontSize: { min: 12, max: 36, step: 1 },
  uiFontSize: { min: 10, max: 24, step: 1 },
  lineHeight: { min: 1.2, max: 2.5, step: 0.1 },
  studyLineHeight: { min: 1.2, max: 2.5, step: 0.1 },
} as const;

/** Clamp to a range, rounding line heights back onto their 0.1 grid. */
/**
 * The "Text size" steps of the reading panes' Aa popover, as Bible text sizes
 * (px at a 16px root). Readers see the step number, 1–12, the way e-book
 * readers number their sizes; step 5 is the default size. Each step scales the
 * study and interface sizes in proportion, so the interface does not outgrow
 * the reading text at the top of the range. Exact sizes per area stay in
 * Settings.
 */
export const TEXT_SIZE_STEPS = [13, 15, 16, 17, 19, 21, 23, 26, 29, 32, 36, 40] as const;
export const DEFAULT_TEXT_SIZE_STEP = TEXT_SIZE_STEPS.indexOf(19 as never) + 1;

function clampTo(range: { min: number; max: number }, value: number): number {
  return Math.round(Math.max(range.min, Math.min(range.max, value)) * 10) / 10;
}

class SettingsStore extends Store {
  theme: ThemeName = DEFAULT_SETTINGS.theme;
  fontSchemeId = DEFAULT_SETTINGS.fontSchemeId;
  fontFamily = DEFAULT_SETTINGS.fontFamily;
  headingFontFamily = DEFAULT_SETTINGS.headingFontFamily;
  studyFontFamily = DEFAULT_SETTINGS.studyFontFamily;
  fontSize = DEFAULT_SETTINGS.fontSize;
  studyFontSize = DEFAULT_SETTINGS.studyFontSize;
  uiFontSize = DEFAULT_SETTINGS.uiFontSize;
  lineHeight = DEFAULT_SETTINGS.lineHeight;
  studyLineHeight = DEFAULT_SETTINGS.studyLineHeight;
  wordsOfChristInRed = DEFAULT_SETTINGS.wordsOfChristInRed;
  /** When true, Ideas Search (semantic) runs in the browser instead of the server */
  browserSemanticSearch = DEFAULT_SETTINGS.browserSemanticSearch;
  /** Topical module abbreviations that are excluded from topic lookups */
  excludedTopicalModules: string[] = [...DEFAULT_SETTINGS.excludedTopicalModules];
  /** Whether to show the combined commentary overview tab */
  showCommentaryOverview = DEFAULT_SETTINGS.showCommentaryOverview;
  /** When true, flips mobile bottom navigation for left-handed users */
  leftHandedMode = DEFAULT_SETTINGS.leftHandedMode;
  /** Module abbreviations whose disclaimer banners the user has dismissed */
  dismissedDisclaimerModules: string[] = [...DEFAULT_SETTINGS.dismissedDisclaimerModules];
  /*
   * The three swipe settings live in the settings registry (`settingsRegistry.ts`), which
   * owns their defaults, clamping and persistence. These getters keep the existing
   * `settingsStore.swipe*` reads working; the setters below delegate to the registry.
   */
  /** When true, horizontal swipes on the Bible pane navigate chapters */
  get swipeChaptersEnabled(): boolean {
    return webSettings.get<boolean>('swipeChaptersEnabled');
  }
  /** Pixel threshold for committing a chapter swipe in the Bible pane */
  get swipeChapterThresholdPx(): number {
    return webSettings.get<number>('swipeChapterThresholdPx');
  }
  /** Pixel threshold for committing a verse swipe in the Commentary pane */
  get swipeCommentaryVerseThresholdPx(): number {
    return webSettings.get<number>('swipeCommentaryVerseThresholdPx');
  }
  /**
   * Interlinear layout used in study mode.
   *
   * Stacked by default: with the English on top in translation order, the verse
   * still reads as the verse, and the original-language word sits under the
   * word it renders. Inline puts a parenthetical after every word, which turns
   * a long verse into something you have to pick apart to read at all.
   */
  interlinearLayout: InterlinearLayout = DEFAULT_SETTINGS.interlinearLayout;

  constructor() {
    super();
    this.load();
    // Registry-owned settings change through their own store; wake this store's
    // subscribers so anything reading the getters above re-renders.
    webSettings.subscribe(() => this.notify());
  }

  resetToDefaults(): void {
    this.theme = DEFAULT_SETTINGS.theme;
    this.wordsOfChristInRed = DEFAULT_SETTINGS.wordsOfChristInRed;
    this.browserSemanticSearch = DEFAULT_SETTINGS.browserSemanticSearch;
    this.excludedTopicalModules = [...DEFAULT_SETTINGS.excludedTopicalModules];
    this.showCommentaryOverview = DEFAULT_SETTINGS.showCommentaryOverview;
    this.leftHandedMode = DEFAULT_SETTINGS.leftHandedMode;
    this.dismissedDisclaimerModules = [...DEFAULT_SETTINGS.dismissedDisclaimerModules];
    webSettings.reset(['swipeChaptersEnabled', 'swipeChapterThresholdPx', 'swipeCommentaryVerseThresholdPx']);
    this.interlinearLayout = DEFAULT_SETTINGS.interlinearLayout;
    this.fontSchemeId = DEFAULT_SETTINGS.fontSchemeId;
    this.fontFamily = DEFAULT_SETTINGS.fontFamily;
    this.headingFontFamily = DEFAULT_SETTINGS.headingFontFamily;
    this.studyFontFamily = DEFAULT_SETTINGS.studyFontFamily;
    this.restoreTextDefaults();
    this.applyTheme();
    this.applyFontSizes();
    this.save();
    this.notify();
  }

  /**
   * Reset only the five text-size settings.
   *
   * The Text Size tab needs an undo that does not also throw away the reader's
   * theme and font scheme, which "Reset All" on the Theme tab does.
   */
  resetTextSettings(): void {
    this.restoreTextDefaults();
    this.applyFontSizes();
    this.save();
    this.notify();
  }

  private restoreTextDefaults(): void {
    this.fontSize = DEFAULT_SETTINGS.fontSize;
    this.studyFontSize = DEFAULT_SETTINGS.studyFontSize;
    this.uiFontSize = DEFAULT_SETTINGS.uiFontSize;
    this.lineHeight = DEFAULT_SETTINGS.lineHeight;
    this.studyLineHeight = DEFAULT_SETTINGS.studyLineHeight;
  }

  setTheme(theme: ThemeName): void {
    if (!isValidTheme(theme)) return;
    this.theme = theme;
    this.applyTheme();
    this.save();
    this.notify();
  }

  setFontScheme(schemeId: string): void {
    const scheme = FONT_SCHEMES.find(s => s.id === schemeId);
    if (!scheme) return;
    this.fontSchemeId = schemeId;
    this.fontFamily = scheme.contentFont;
    this.headingFontFamily = scheme.headingFont;
    this.studyFontFamily = scheme.contentFont;
    this.save();
    this.notify();
  }

  setFontSize(fontSize: number): void {
    this.fontSize = clampTo(TEXT_SIZE_RANGES.fontSize, fontSize);
    this.save();
    this.notify();
  }

  setStudyFontSize(size: number): void {
    this.studyFontSize = clampTo(TEXT_SIZE_RANGES.studyFontSize, size);
    this.applyStudyFontSize();
    this.save();
    this.notify();
  }

  setUiFontSize(size: number): void {
    this.uiFontSize = clampTo(TEXT_SIZE_RANGES.uiFontSize, size);
    this.applyUiFontSize();
    this.save();
    this.notify();
  }

  setLineHeight(lineHeight: number): void {
    this.lineHeight = clampTo(TEXT_SIZE_RANGES.lineHeight, lineHeight);
    this.save();
    this.notify();
  }

  setStudyLineHeight(lineHeight: number): void {
    this.studyLineHeight = clampTo(TEXT_SIZE_RANGES.studyLineHeight, lineHeight);
    this.save();
    this.notify();
  }

  /**
   * The text-size step (1-based) the Bible text size is at, or nearest to when
   * it was set to an exact size in Settings.
   */
  getTextSizeStep(): number {
    let best = 0;
    for (let i = 1; i < TEXT_SIZE_STEPS.length; i++) {
      if (Math.abs(TEXT_SIZE_STEPS[i] - this.fontSize) < Math.abs(TEXT_SIZE_STEPS[best] - this.fontSize)) best = i;
    }
    return best + 1;
  }

  /** Whether there is a text-size step beyond the current size in that direction. */
  canStepTextSize(direction: 1 | -1): boolean {
    return direction > 0
      ? TEXT_SIZE_STEPS.some((px) => px > this.fontSize)
      : TEXT_SIZE_STEPS.some((px) => px < this.fontSize);
  }

  /**
   * Move to the next text-size step up or down: the next step strictly beyond
   * the current Bible size, so an exact size set in Settings snaps onto the
   * scale.
   */
  stepTextSize(direction: 1 | -1): void {
    const target = direction > 0
      ? TEXT_SIZE_STEPS.findIndex((px) => px > this.fontSize)
      : TEXT_SIZE_STEPS.reduce((found, px, i) => (px < this.fontSize ? i : found), -1);
    if (target === -1) return;
    this.setTextSizeStep(target + 1);
  }

  /**
   * Set every text size from step `step` (1-based) alone: the Bible size from
   * the table, and the study and interface sizes as their defaults scaled by
   * the same factor, each capped to its range.
   *
   * Derived from the step only, never from the sizes before it, so a step
   * always means the same sizes. Scaling the previous sizes instead made the
   * result depend on the path: the interface size stops at its maximum on the
   * way up, and was then scaled down from that cap on the way back, so the
   * same step showed different interface sizes. Per-area sizes set in Settings
   * are replaced by the next step; they stay exact until then.
   */
  setTextSizeStep(step: number): void {
    const index = Math.max(1, Math.min(TEXT_SIZE_STEPS.length, Math.round(step))) - 1;
    const bible = TEXT_SIZE_STEPS[index];
    const factor = bible / DEFAULT_SETTINGS.fontSize;
    this.fontSize = clampTo(TEXT_SIZE_RANGES.fontSize, bible);
    this.studyFontSize = clampTo(TEXT_SIZE_RANGES.studyFontSize, Math.round(DEFAULT_SETTINGS.studyFontSize * factor));
    this.uiFontSize = clampTo(TEXT_SIZE_RANGES.uiFontSize, Math.round(DEFAULT_SETTINGS.uiFontSize * factor));
    this.applyFontSizes();
    this.save();
    this.notify();
  }

  adjustAllFontSizes(delta: number): void {
    this.fontSize = clampTo(TEXT_SIZE_RANGES.fontSize, this.fontSize + delta);
    this.studyFontSize = clampTo(TEXT_SIZE_RANGES.studyFontSize, this.studyFontSize + delta);
    this.uiFontSize = clampTo(TEXT_SIZE_RANGES.uiFontSize, this.uiFontSize + delta);
    this.applyFontSizes();
    this.save();
    this.notify();
  }

  setFontFamily(fontFamily: string): void {
    this.fontFamily = fontFamily;
    this.save();
    this.notify();
  }

  setStudyFontFamily(fontFamily: string): void {
    this.studyFontFamily = fontFamily;
    this.save();
    this.notify();
  }

  setWordsOfChristInRed(enabled: boolean): void {
    this.wordsOfChristInRed = enabled;
    this.save();
    this.notify();
  }

  setBrowserSemanticSearch(enabled: boolean): void {
    this.browserSemanticSearch = enabled;
    this.save();
    this.notify();
  }

  setExcludedTopicalModules(modules: string[]): void {
    this.excludedTopicalModules = modules;
    this.save();
    this.notify();
  }

  toggleTopicalModule(abbreviation: string, enabled: boolean): void {
    if (enabled) {
      this.excludedTopicalModules = this.excludedTopicalModules.filter(m => m !== abbreviation);
    } else {
      if (!this.excludedTopicalModules.includes(abbreviation)) {
        this.excludedTopicalModules = [...this.excludedTopicalModules, abbreviation];
      }
    }
    this.save();
    this.notify();
  }

  setShowCommentaryOverview(enabled: boolean): void {
    this.showCommentaryOverview = enabled;
    this.save();
    this.notify();
  }

  setLeftHandedMode(enabled: boolean): void {
    this.leftHandedMode = enabled;
    this.save();
    this.notify();
  }

  addDismissedDisclaimerModule(module: string): void {
    if (this.dismissedDisclaimerModules.includes(module)) return;
    this.dismissedDisclaimerModules = [...this.dismissedDisclaimerModules, module];
    this.save();
    this.notify();
  }

  removeDismissedDisclaimerModule(module: string): void {
    if (!this.dismissedDisclaimerModules.includes(module)) return;
    this.dismissedDisclaimerModules = this.dismissedDisclaimerModules.filter(m => m !== module);
    this.save();
    this.notify();
  }

  isDisclaimerDismissed(module: string): boolean {
    return this.dismissedDisclaimerModules.includes(module);
  }

  setSwipeChaptersEnabled(enabled: boolean): void {
    webSettings.set('swipeChaptersEnabled', enabled);
  }

  setSwipeChapterThresholdPx(px: number): void {
    webSettings.set('swipeChapterThresholdPx', px);
  }

  setInterlinearLayout(layout: InterlinearLayout): void {
    this.interlinearLayout = layout;
    this.save();
    this.notify();
  }

  setSwipeCommentaryVerseThresholdPx(px: number): void {
    webSettings.set('swipeCommentaryVerseThresholdPx', px);
  }

  /** Server-provided UI config restrictions */
  private visibleThemeIds: string[] | null = null;
  private visibleFontIds: string[] | null = null;

  /** Server-provided defaults */
  serverDefaultModule: string | null = null;
  serverDefaultDisplayMode: string | null = null;
  serverDisabledPanes: string[] = [];
  serverOfflineDownloads = false;

  /** Apply server-provided UI config (theme/font restrictions, defaults). */
  applyServerUiConfig(ui: {
    defaultTheme?: string;
    visibleThemes?: string[];
    visibleFonts?: string[];
    defaultModule?: string;
    defaultDisplayMode?: string;
    disabledPanes?: string[];
  }): void {
    if (ui.visibleThemes) this.visibleThemeIds = ui.visibleThemes;
    if (ui.visibleFonts) this.visibleFontIds = ui.visibleFonts;
    if (ui.defaultModule) this.serverDefaultModule = ui.defaultModule;
    if (ui.defaultDisplayMode) this.serverDefaultDisplayMode = ui.defaultDisplayMode;
    if (ui.disabledPanes) this.serverDisabledPanes = ui.disabledPanes;
  }

  setServerOfflineDownloads(enabled: boolean): void {
    this.serverOfflineDownloads = enabled;
  }

  /**
   * The Bible to open when nothing more specific names one: a fresh session's
   * first tab, a new tab with no tab open, a restored tab whose translation is
   * no longer installed.
   *
   * The server's configured default (`ui.defaultModule`) when it is installed,
   * otherwise KJV when installed, then the first installed Bible, so an install without the configured
   * translation still opens on text rather than "Failed to load chapter".
   *
   * Until the module list has loaded there is nothing to check against, so the
   * configured default is trusted as-is. Anything decided that early is checked
   * again once the list arrives -- see `bibleStore.fallBackFromMissingModules`.
   * The literal is the last resort only: no configured default and no Bible
   * installed (or none known yet).
   */
  getDefaultBible(): string {
    const configured = this.serverDefaultModule;
    if (!moduleStore.loaded) return configured ?? LAST_RESORT_BIBLE;
    const installed = moduleStore.getBibleModules();
    const match = configured ? findBible(installed, configured) : undefined;
    // Configured, else KJV (the built-in preference), else whatever is installed first.
    return match?.abbreviation ?? findBible(installed, 'KJV')?.abbreviation ?? installed[0]?.abbreviation ?? configured ?? LAST_RESORT_BIBLE;
  }

  /**
   * `abbreviation` when it names an installed Bible, otherwise the default one.
   *
   * Returned unchanged while the module list has not loaded (or failed to, as
   * it does offline): not knowing is not the same as knowing it is missing, and
   * an offline reader may well have that translation downloaded. Matching is
   * case-insensitive, as it is on the server, and returns the list's spelling.
   */
  resolveInstalledBible(abbreviation: string): string {
    if (!moduleStore.loaded) return abbreviation;
    return findBible(moduleStore.getBibleModules(), abbreviation)?.abbreviation ?? this.getDefaultBible();
  }

  /** Get font schemes filtered by server config. Returns all if no restriction. */
  getVisibleFontSchemes(): FontScheme[] {
    if (!this.visibleFontIds) return FONT_SCHEMES;
    return FONT_SCHEMES.filter(s => this.visibleFontIds!.includes(s.id));
  }

  /** Get visible theme IDs filter, or null if all themes are visible. */
  getVisibleThemeIds(): string[] | null {
    return this.visibleThemeIds;
  }

  applyUiFontSize(): void {
    if (typeof document === 'undefined') return;
    document.documentElement.style.setProperty('--ui-font-size', pxToRem(this.uiFontSize));
    document.documentElement.style.setProperty(
      '--ui-font-scale',
      String(this.uiFontSize / UI_SCALE_BASE_PX),
    );
  }

  /**
   * Publish the Study Text size the way the UI size is published.
   *
   * `--study-font-size` is what the Study pane container inherits from (the
   * commentary and Bible-quote prose that sets no size of its own), and
   * `--study-font-scale` is what the Study pane's own `calc(<rem> * scale)` rules
   * multiply by. Before this existed the size was only an inline `font-size` on
   * the pane, which every absolutely-sized child overrode — so the setting
   * appeared to do nothing outside commentary prose.
   *
   * The literals are rem (`calc(0.8125rem * scale)`), so they follow the
   * browser's root font size, and the scale is relative to the size they were
   * authored against (STUDY_SCALE_BASE_PX), so each keeps its proportion to the
   * chosen Study Text size.
   */
  applyStudyFontSize(): void {
    if (typeof document === 'undefined') return;
    document.documentElement.style.setProperty('--study-font-size', pxToRem(this.studyFontSize));
    document.documentElement.style.setProperty(
      '--study-font-scale',
      String(this.studyFontSize / STUDY_SCALE_BASE_PX),
    );
  }

  applyFontSizes(): void {
    this.applyUiFontSize();
    this.applyStudyFontSize();
  }

  save(): void {
    try {
      // Merge into the existing blob: other writers (the registry: appHidden, appOrder, ...) own keys here too.
      let prev: Record<string, unknown> = {};
      try {
        const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) prev = raw;
      } catch { /* corrupt blob: start over */ }
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        ...prev,
        theme: this.theme,
        fontSchemeId: this.fontSchemeId,
        fontFamily: this.fontFamily,
        headingFontFamily: this.headingFontFamily,
        studyFontFamily: this.studyFontFamily,
        commentaryFontFamily: this.studyFontFamily, // backward compat
        fontSize: this.fontSize,
        studyFontSize: this.studyFontSize,
        commentaryFontSize: this.studyFontSize, // backward compat
        uiFontSize: this.uiFontSize,
        textSizeVersion: TEXT_SIZE_VERSION,
        lineHeight: this.lineHeight,
        studyLineHeight: this.studyLineHeight,
        commentaryLineHeight: this.studyLineHeight, // backward compat
        wordsOfChristInRed: this.wordsOfChristInRed,
        browserSemanticSearch: this.browserSemanticSearch,
        excludedTopicalModules: this.excludedTopicalModules,
        showCommentaryOverview: this.showCommentaryOverview,
        leftHandedMode: this.leftHandedMode,
        dismissedDisclaimerModules: this.dismissedDisclaimerModules,
        // The swipe settings are written by the registry store, which merges into this blob.
        // Carry them over here so a save() that rewrites the blob does not drop them.
        swipeChaptersEnabled: this.swipeChaptersEnabled,
        swipeChapterThresholdPx: this.swipeChapterThresholdPx,
        swipeCommentaryVerseThresholdPx: this.swipeCommentaryVerseThresholdPx,
        interlinearLayout: this.interlinearLayout,
      }));
    } catch { /* localStorage not available */ }
  }

  load(): void {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (data) {
        const parsed = JSON.parse(data);
        this.theme = (parsed.theme && isValidTheme(parsed.theme)) ? parsed.theme : this.theme;
        this.fontSchemeId = parsed.fontSchemeId ?? this.fontSchemeId;
        this.fontFamily = parsed.fontFamily ?? this.fontFamily;
        this.headingFontFamily = parsed.headingFontFamily ?? this.headingFontFamily;
        this.studyFontFamily = parsed.studyFontFamily ?? parsed.commentaryFontFamily ?? this.studyFontFamily;
        this.fontSize = parsed.fontSize ?? this.fontSize;
        this.studyFontSize = parsed.studyFontSize ?? parsed.commentaryFontSize ?? this.studyFontSize;
        this.uiFontSize = parsed.uiFontSize ?? this.uiFontSize;
        this.lineHeight = parsed.lineHeight ?? this.lineHeight;
        this.studyLineHeight = parsed.studyLineHeight ?? parsed.commentaryLineHeight ?? this.studyLineHeight;
        this.wordsOfChristInRed = parsed.wordsOfChristInRed ?? this.wordsOfChristInRed;
        this.browserSemanticSearch = parsed.browserSemanticSearch ?? this.browserSemanticSearch;
        this.excludedTopicalModules = parsed.excludedTopicalModules ?? this.excludedTopicalModules;
        this.showCommentaryOverview = parsed.showCommentaryOverview ?? this.showCommentaryOverview;
        this.leftHandedMode = parsed.leftHandedMode ?? this.leftHandedMode;
        this.dismissedDisclaimerModules = Array.isArray(parsed.dismissedDisclaimerModules)
          ? parsed.dismissedDisclaimerModules
          : this.dismissedDisclaimerModules;
        this.interlinearLayout = parsed.interlinearLayout === 'stacked' || parsed.interlinearLayout === 'inline'
          ? parsed.interlinearLayout
          : this.interlinearLayout;
        if (!(parsed.textSizeVersion >= TEXT_SIZE_VERSION)) this.migrateLegacyTextSizes();
      }
    } catch { /* ignore */ }
    // The swipe settings belong to the registry store; re-read the blob it shares.
    void webSettings.reload();
    this.applyTheme();
    this.applyFontSizes();
  }

  /**
   * One-time move from the version-1 defaults (18/15/14 px) to the current ones.
   *
   * `save()` writes every field, so a stored 18 cannot be told apart from an
   * untouched default; a size still on its old default is treated as never
   * chosen and moved to the new default. Any other value was picked by the
   * reader and is kept (it now renders as the same px at a 16px root). Saving
   * stamps `textSizeVersion`, so a reader who later picks 18 on purpose keeps it.
   */
  private migrateLegacyTextSizes(): void {
    for (const key of ['fontSize', 'studyFontSize', 'uiFontSize'] as const) {
      if (this[key] === LEGACY_TEXT_SIZE_DEFAULTS[key]) this[key] = DEFAULT_SETTINGS[key];
    }
    this.save();
  }

  getResolvedTheme(): string {
    if (this.theme !== 'auto') return this.theme;
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return 'light';
  }

  private themeTransitionTimer: ReturnType<typeof setTimeout> | null = null;

  applyTheme(): void {
    if (typeof document === 'undefined') return;
    const resolved = this.getResolvedTheme();
    const el = document.documentElement;
    const isChanging = el.getAttribute('data-theme') !== resolved;

    if (isChanging) {
      // Hide scrollbars during theme transition to avoid abrupt color snap
      el.classList.add('scrollbar-hidden');

      // Enable transition class so the theme change animates smoothly
      el.classList.add('theme-transitioning');
      if (this.themeTransitionTimer) clearTimeout(this.themeTransitionTimer);
      this.themeTransitionTimer = setTimeout(() => {
        el.classList.remove('theme-transitioning');
        el.classList.remove('scrollbar-hidden');
        this.themeTransitionTimer = null;
      }, 1600);
    }

    el.setAttribute('data-theme', resolved);

    // Set dark-theme attribute for CSS selectors that need dark/light distinction
    const themeDef = getThemeById(resolved);
    if (themeDef?.isDark) {
      el.setAttribute('data-dark-theme', '');
    } else {
      el.removeAttribute('data-dark-theme');
    }

    // Keep the browser/Android address bar in step with the theme (B-141).
    try {
      const bar = getComputedStyle(el).getPropertyValue('--header-bg').trim()
        || getComputedStyle(el).getPropertyValue('--bg-primary').trim();
      const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
      if (bar && meta) meta.content = bar;
    } catch { /* styles unavailable (tests) */ }
  }
}

export const settingsStore = new SettingsStore();

// "Auto" follows the OS scheme live, not only at load (B-141).
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
      if (settingsStore.theme === 'auto') settingsStore.applyTheme();
    });
  } catch { /* no matchMedia change events */ }
}

// Core event `settings.changed` (task 0123): only while an active feature module listens.
watchSettingsStore(settingsStore, () => Object.fromEntries(WEB_SETTINGS.definitions.map((d) => [d.key, webSettings.get(d.key)])));
