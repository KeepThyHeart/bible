/**
 * Component tests for SettingsPanel.
 *
 * Pattern: Store-connected settings panel with multiple tabs.
 * All stores (settingsStore, offlineStore, moduleStore, bibleStore) are mocked.
 * useStore is mocked to call the selector immediately (no subscription).
 * fetch is stubbed to avoid real network calls.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';

// ---- i18n ----------------------------------------------------------------
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

// ---- Store mock ----------------------------------------------------------
vi.mock('../../hooks/useStore', () => ({
  useStore: (_store: unknown, selector: () => unknown) => selector(),
}));

// ---- i18n module ---------------------------------------------------------
vi.mock('../../i18n', () => ({
  default: { language: 'en', changeLanguage: vi.fn() },
  syncDocumentLang: vi.fn(),
}));

// ---- Settings store -------------------------------------------------------
const mockAdjustAllFontSizes = vi.fn();
const mockSetFontSize = vi.fn();
const mockSetTheme = vi.fn();
const mockSetFontScheme = vi.fn();
const mockSetWordsOfChristInRed = vi.fn();
const mockSetShowCommentaryOverview = vi.fn();
const mockToggleTopicalModule = vi.fn();
const mockSetSwipeChaptersEnabled = vi.fn();
const mockSetSwipeChapterThresholdPx = vi.fn();
const mockSetSwipeCommentaryVerseThresholdPx = vi.fn();
const mockResetToDefaults = vi.fn();
const mockResetTextSettings = vi.fn();
const mockSetStudyFontSize = vi.fn();
const mockSetStudyLineHeight = vi.fn();

vi.mock('../../stores/settingsStore', () => ({
  FONT_SCHEMES: [
    { id: 'classic', label: 'Classic', headingFont: 'Georgia', contentFont: 'Georgia', group: 'recommended' },
  ],
  settingsStore: {
    get theme() { return 'light'; },
    get fontSize() { return 18; },
    get lineHeight() { return 1.8; },
    get studyLineHeight() { return 1.6; },
    get studyFontSize() { return 15; },
    get uiFontSize() { return 14; },
    get fontSchemeId() { return 'classic'; },
    get wordsOfChristInRed() { return true; },
    get excludedTopicalModules() { return []; },
    get showCommentaryOverview() { return true; },
    get swipeChaptersEnabled() { return true; },
    get swipeChapterThresholdPx() { return 100; },
    get swipeCommentaryVerseThresholdPx() { return 100; },
    get serverOfflineDownloads() { return false; },
    get leftHandedMode() { return false; },
    adjustAllFontSizes: (...args: unknown[]) => mockAdjustAllFontSizes(...args),
    setFontSize: (...args: unknown[]) => mockSetFontSize(...args),
    setTheme: (...args: unknown[]) => mockSetTheme(...args),
    setFontScheme: (...args: unknown[]) => mockSetFontScheme(...args),
    setWordsOfChristInRed: (...args: unknown[]) => mockSetWordsOfChristInRed(...args),
    setShowCommentaryOverview: (...args: unknown[]) => mockSetShowCommentaryOverview(...args),
    toggleTopicalModule: (...args: unknown[]) => mockToggleTopicalModule(...args),
    setSwipeChaptersEnabled: (...args: unknown[]) => mockSetSwipeChaptersEnabled(...args),
    setSwipeChapterThresholdPx: (...args: unknown[]) => mockSetSwipeChapterThresholdPx(...args),
    setSwipeCommentaryVerseThresholdPx: (...args: unknown[]) => mockSetSwipeCommentaryVerseThresholdPx(...args),
    resetToDefaults: () => mockResetToDefaults(),
    resetTextSettings: () => mockResetTextSettings(),
    setStudyFontSize: (...args: unknown[]) => mockSetStudyFontSize(...args),
    setUiFontSize: vi.fn(),
    setLineHeight: vi.fn(),
    setStudyLineHeight: (...args: unknown[]) => mockSetStudyLineHeight(...args),
    setLeftHandedMode: vi.fn(),
  },
}));

vi.mock('../../stores/offlineStore', () => ({
  offlineStore: {
    get enabled() { return false; },
    get downloadedModules() { return []; },
    get isOnline() { return true; },
    get storageUsed() { return 0; },
    get activeDownloads() { return new Map(); },
    setEnabled: vi.fn(),
    updateStorageInfo: vi.fn(),
    isModuleDownloaded: () => false,
  },
}));

vi.mock('../../stores/moduleStore', () => ({
  moduleStore: {
    get availableModules() { return []; },
    getSemanticIndexInfo: () => Promise.resolve({ available: false, sizeBytes: 0 }),
  },
}));

vi.mock('../../stores/bibleStore', () => ({
  bibleStore: {
    get tabs() { return []; },
  },
}));

vi.mock('../../offline/sharedInstances', () => ({
  offlineStorageManager: {
    getStorageInfo: () => Promise.resolve({ used: 0, quota: 0 }),
    downloadModule: vi.fn(),
    removeModule: vi.fn(),
    downloadSemanticIndex: vi.fn(),
  },
}));

vi.mock('../../utils/apiUrl', () => ({
  API_BASE: '',
}));

vi.mock('../../themes/themeRegistry', () => ({
  THEME_LIST: [
    { id: 'light', name: 'Light', swatch: { bg: '#fff', fg: '#000', accent: '#00f' } },
    { id: 'dark', name: 'Dark', swatch: { bg: '#000', fg: '#fff', accent: '#0ff' } },
  ],
}));

// Stub fetch
global.fetch = vi.fn(() => Promise.resolve({ json: () => Promise.resolve([]) })) as unknown as typeof fetch;

import { SettingsPanel } from './SettingsPanel';

describe('SettingsPanel', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ------------------------------------------------------------------
  // Open / closed state
  // ------------------------------------------------------------------
  it('renders nothing when isOpen is false', () => {
    const { container } = render(<SettingsPanel isOpen={false} onClose={onClose} />);
    expect(container.querySelector('.settings-panel')).toBeNull();
  });

  it('renders the panel when isOpen is true', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={onClose} />);
    expect(container.querySelector('.settings-panel')).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // Close interactions
  // ------------------------------------------------------------------
  it('calls onClose when the close button is clicked', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={onClose} />);
    const closeBtn = container.querySelector<HTMLElement>('.settings-panel__close')!;
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when the overlay is clicked', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={onClose} />);
    const overlay = container.querySelector<HTMLElement>('.settings-panel-overlay')!;
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalled();
  });

  it('does not call onClose when clicking inside the panel', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={onClose} />);
    const panel = container.querySelector<HTMLElement>('.settings-panel')!;
    fireEvent.click(panel);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when Escape key is pressed', () => {
    render(<SettingsPanel isOpen={true} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // Tab navigation
  // ------------------------------------------------------------------
  it('renders the sidebar tabs', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={onClose} />);
    const tabs = container.querySelectorAll('.settings-panel__tab');
    expect(tabs.length).toBeGreaterThan(0);
  });

  it('shows text-size section by default', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={onClose} />);
    expect(container.querySelector('[data-section="text-size"]')).toBeTruthy();
  });

  it('switches to theme tab when clicked', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={onClose} />);
    const themeTab = container.querySelector<HTMLElement>('[data-tab="theme"]')!;
    fireEvent.click(themeTab);
    expect(container.querySelector('[data-section="theme"]')).toBeTruthy();
  });

  it('switches to modules tab when clicked', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={onClose} />);
    const modulesTab = container.querySelector<HTMLElement>('[data-tab="modules"]')!;
    fireEvent.click(modulesTab);
    expect(container.querySelector('[data-section="modules"]')).toBeTruthy();
  });

  it('switches to gestures tab when clicked', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={onClose} />);
    const gesturesTab = container.querySelector<HTMLElement>('[data-tab="gestures"]')!;
    fireEvent.click(gesturesTab);
    expect(container.querySelector('[data-section="gestures"]')).toBeTruthy();
  });

  it('switches to about tab when clicked', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={onClose} />);
    const aboutTab = container.querySelector<HTMLElement>('[data-tab="about"]')!;
    fireEvent.click(aboutTab);
    expect(container.querySelector('[data-section="about"]')).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // scrollToSection prop
  // ------------------------------------------------------------------
  it('opens on the theme tab when scrollToSection is "theme"', () => {
    const { container } = render(
      <SettingsPanel isOpen={true} onClose={onClose} scrollToSection="theme" />
    );
    expect(container.querySelector('[data-section="theme"]')).toBeTruthy();
  });

  it('opens on the text-size tab when scrollToSection is "bible-font"', () => {
    const { container } = render(
      <SettingsPanel isOpen={true} onClose={onClose} scrollToSection="bible-font" />
    );
    expect(container.querySelector('[data-section="text-size"]')).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // Text size controls
  // ------------------------------------------------------------------
  it('renders the font size decrease button', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={onClose} />);
    const fontSizeBtns = container.querySelectorAll<HTMLButtonElement>('.font-size-control__btn');
    expect(fontSizeBtns.length).toBeGreaterThan(0);
  });

  it('calls adjustAllFontSizes(-2) when the decrease button is clicked', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={onClose} />);
    const [decreaseBtn] = container.querySelectorAll<HTMLButtonElement>('.font-size-control__btn');
    fireEvent.click(decreaseBtn);
    expect(mockAdjustAllFontSizes).toHaveBeenCalledWith(-2);
  });

  it('calls adjustAllFontSizes(2) when the increase button is clicked', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={onClose} />);
    const btns = container.querySelectorAll<HTMLButtonElement>('.font-size-control__btn');
    fireEvent.click(btns[1]);
    expect(mockAdjustAllFontSizes).toHaveBeenCalledWith(2);
  });

  it('shows the advanced toggle button', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={onClose} />);
    expect(container.querySelector('.settings-panel__advanced-toggle')).toBeTruthy();
  });

  it('expands advanced section when the toggle is clicked', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={onClose} />);
    const toggle = container.querySelector<HTMLElement>('.settings-panel__advanced-toggle')!;
    fireEvent.click(toggle);
    expect(container.querySelector('.settings-panel__advanced-section')).toBeTruthy();
  });

  it('resets only the text settings from the Text Size tab', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={onClose} />);
    const resetBtn = container.querySelector<HTMLElement>('[data-section="text-size"] .settings-panel__reset-btn')!;
    fireEvent.click(resetBtn);
    expect(mockResetTextSettings).toHaveBeenCalled();
    expect(mockResetToDefaults).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // Advanced +/- steppers
  // ------------------------------------------------------------------
  function openAdvanced(container: Element) {
    fireEvent.click(container.querySelector<HTMLElement>('.settings-panel__advanced-toggle')!);
    return container.querySelectorAll<HTMLElement>('.settings-panel__stepper');
  }

  it('gives every advanced slider a minus and a plus button', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={onClose} />);
    const rows = openAdvanced(container);
    expect(rows.length).toBe(5);
    for (const row of Array.from(rows)) {
      expect(row.querySelectorAll('.settings-panel__stepper-btn').length).toBe(2);
      expect(row.querySelector('input[type="range"]')).toBeTruthy();
    }
  });

  it('steps the Study Text size by 1px per click', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={onClose} />);
    const rows = openAdvanced(container);
    const [minus, plus] = Array.from(
      rows[1].querySelectorAll<HTMLButtonElement>('.settings-panel__stepper-btn')
    );
    fireEvent.click(plus);
    expect(mockSetStudyFontSize).toHaveBeenLastCalledWith(16); // 15 + 1
    fireEvent.click(minus);
    expect(mockSetStudyFontSize).toHaveBeenLastCalledWith(14); // 15 - 1
  });

  it('steps a line height by 0.1 without floating-point drift', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={onClose} />);
    const rows = openAdvanced(container);
    const [, plus] = Array.from(
      rows[4].querySelectorAll<HTMLButtonElement>('.settings-panel__stepper-btn')
    );
    fireEvent.click(plus);
    expect(mockSetStudyLineHeight).toHaveBeenLastCalledWith(1.7); // 1.6 + 0.1
  });

  it('keeps the stepper value in a fixed-width cell so the buttons cannot move', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={onClose} />);
    const rows = openAdvanced(container);
    for (const row of Array.from(rows)) {
      expect(row.querySelector('.settings-panel__stepper-value')).toBeTruthy();
      // The value lives in the label, never between the two buttons.
      expect(row.querySelector('.settings-panel__stepper-row .settings-panel__stepper-value')).toBeNull();
    }
  });

  // ------------------------------------------------------------------
  // Theme tab content
  // ------------------------------------------------------------------
  it('renders theme swatches when on theme tab', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={onClose} />);
    const themeTab = container.querySelector<HTMLElement>('[data-tab="theme"]')!;
    fireEvent.click(themeTab);
    expect(container.querySelectorAll('.settings-panel__theme-swatch').length).toBeGreaterThan(0);
  });

  it('calls setTheme when a theme swatch is clicked', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={onClose} />);
    const themeTab = container.querySelector<HTMLElement>('[data-tab="theme"]')!;
    fireEvent.click(themeTab);
    const swatch = container.querySelector<HTMLElement>('.settings-panel__theme-swatch')!;
    fireEvent.click(swatch);
    expect(mockSetTheme).toHaveBeenCalled();
  });

  it('calls resetToDefaults when the reset button is clicked', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={onClose} />);
    const themeTab = container.querySelector<HTMLElement>('[data-tab="theme"]')!;
    fireEvent.click(themeTab);
    const resetBtn = container.querySelector<HTMLElement>('.settings-panel__reset-btn')!;
    fireEvent.click(resetBtn);
    expect(mockResetToDefaults).toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // Offline tab hidden when serverOfflineDownloads is false
  // ------------------------------------------------------------------
  it('does not render the offline tab when serverOfflineDownloads is false', () => {
    const { container } = render(<SettingsPanel isOpen={true} onClose={onClose} />);
    const offlineTab = container.querySelector('[data-tab="offline"]');
    expect(offlineTab).toBeNull();
  });
});
