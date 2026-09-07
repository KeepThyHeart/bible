import { useState, useEffect, useRef } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import { syncDocumentLang } from '../../i18n';
import { settingsStore, FONT_SCHEMES, type InterlinearLayout } from '../../stores/settingsStore';
import { THEME_LIST } from '../../themes/themeRegistry';
import { offlineStore } from '../../stores/offlineStore';
import { moduleStore } from '../../stores/moduleStore';
import { bibleStore } from '../../stores/bibleStore';
import { useStore } from '../../hooks/useStore';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { offlineStorageManager } from '../../offline/sharedInstances';
import { API_BASE } from '../../utils/apiUrl';

type SettingsTab = 'text-size' | 'theme' | 'modules' | 'gestures' | 'offline' | 'about';

const TAB_ITEMS: { key: SettingsTab; label: string; icon: string }[] = [
  { key: 'text-size', label: 'settings.tabs.textSize', icon: 'fa-text-height' },
  { key: 'theme', label: 'settings.tabs.theme', icon: 'fa-palette' },
  { key: 'modules', label: 'settings.tabs.modules', icon: 'fa-book' },
  { key: 'gestures', label: 'settings.tabs.gestures', icon: 'fa-hand-pointer' },
  { key: 'offline', label: 'settings.tabs.offline', icon: 'fa-cloud-arrow-down' },
  { key: 'about', label: 'settings.tabs.about', icon: 'fa-circle-info' },
];

function sectionToTab(section?: string): SettingsTab {
  if (section === 'bible-font' || section === 'commentary-font' || section === 'study-font' || section === 'text-size') return 'text-size';
  if (section === 'theme' || section === 'appearance') return 'theme';
  if (section === 'modules') return 'modules';
  if (section === 'gestures') return 'gestures';
  if (section === 'offline') return 'offline';
  if (section === 'about') return 'about';
  return 'text-size';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function OfflineModuleCard({
  abbreviation,
  name,
  sizeBytes,
  isDownloaded,
  progress,
  onDownload,
  onRemove,
  badge,
}: {
  abbreviation: string;
  name: string;
  sizeBytes?: number;
  isDownloaded: boolean;
  progress?: { loaded: number; total: number; status: string; error?: string };
  onDownload: () => void;
  onRemove: () => void;
  badge?: string;
}) {
  const { t } = useTranslation();
  const pct = progress && progress.total > 0
    ? Math.round((progress.loaded / progress.total) * 100)
    : 0;

  return (
    <div class="offline-module-card">
      <div class="offline-module-card__info">
        <span class="offline-module-card__name">{name}</span>
        <span class="offline-module-card__meta">
          {abbreviation}
          {sizeBytes ? ` - ${formatBytes(sizeBytes)}` : ''}
          {badge && <span class="offline-module-card__badge">{badge}</span>}
        </span>
      </div>
      <div class="offline-module-card__actions">
        {isDownloaded && !progress && (
          <>
            <span class="offline-module-card__status offline-module-card__status--downloaded">
              <i class="fa-solid fa-circle-check" />
            </span>
            <button
              class="offline-module-card__btn offline-module-card__btn--remove"
              onClick={onRemove}
              title={t('settings.offline.remove')}
            >
              <i class="fa-solid fa-circle-minus" />
            </button>
          </>
        )}
        {!isDownloaded && !progress && (
          <button
            class="offline-module-card__btn offline-module-card__btn--download"
            onClick={onDownload}
            title={t('settings.offline.download')}
          >
            <i class="fa-solid fa-download" />
          </button>
        )}
        {progress?.status === 'error' && (
          <span class="offline-module-card__error" title={progress.error}>
            <i class="fa-solid fa-circle-exclamation" /> {t('settings.offline.failed')}
          </span>
        )}
      </div>
      {progress?.status === 'downloading' && (
        <div class="offline-module-card__progress">
          <div class="offline-module-card__progress-bar" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  /** Section to open the panel on; maps to a tab via `sectionToTab`. */
  scrollToSection?: string | null;
}

export function SettingsPanel({ isOpen, onClose, scrollToSection }: SettingsPanelProps) {
  const { t } = useTranslation();
  const theme = useStore(settingsStore, () => settingsStore.theme);
  const fontSize = useStore(settingsStore, () => settingsStore.fontSize);
  const lineHeight = useStore(settingsStore, () => settingsStore.lineHeight);
  const studyLineHeight = useStore(settingsStore, () => settingsStore.studyLineHeight);
  const studyFontSize = useStore(settingsStore, () => settingsStore.studyFontSize);
  const uiFontSize = useStore(settingsStore, () => settingsStore.uiFontSize);
  const fontSchemeId = useStore(settingsStore, () => settingsStore.fontSchemeId);
  const wordsOfChristInRed = useStore(settingsStore, () => settingsStore.wordsOfChristInRed);
  const interlinearLayout = useStore(settingsStore, () => settingsStore.interlinearLayout);
  const excludedTopicalModules = useStore(settingsStore, () => settingsStore.excludedTopicalModules);
  const showCommentaryOverview = useStore(settingsStore, () => settingsStore.showCommentaryOverview);
  const swipeChaptersEnabled = useStore(settingsStore, () => settingsStore.swipeChaptersEnabled);
  const swipeChapterThresholdPx = useStore(settingsStore, () => settingsStore.swipeChapterThresholdPx);
  const swipeCommentaryVerseThresholdPx = useStore(settingsStore, () => settingsStore.swipeCommentaryVerseThresholdPx);
  const serverOfflineDownloads = useStore(settingsStore, () => settingsStore.serverOfflineDownloads);
  const [activeTab, setActiveTab] = useState<SettingsTab>('text-size');
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // The panel's own chrome is pinned to whatever `--ui-font-scale` was in force
  // when it opened. Every rule in the panel multiplies by that variable, so
  // without the pin, dragging the "UI Text" slider reflows the dialog under the
  // pointer — the row being dragged moves as it is dragged. Re-read on each
  // open, so a reader who works at 20px UI text still gets a 20px panel.
  const frozenUiScale = useRef('1');
  const wasOpen = useRef(false);
  if (isOpen && !wasOpen.current) {
    frozenUiScale.current = typeof document === 'undefined'
      ? '1'
      : getComputedStyle(document.documentElement).getPropertyValue('--ui-font-scale').trim() || '1';
  }
  wasOpen.current = isOpen;

  // Topical modules state
  const [topicalModules, setTopicalModules] = useState<{ abbreviation: string; name: string }[]>([]);

  // Repo URL from server config
  const [repoUrl, setRepoUrl] = useState('');

  // Offline state
  const offlineEnabled = useStore(offlineStore, () => offlineStore.enabled);
  const downloadedModules = useStore(offlineStore, () => offlineStore.downloadedModules);
  const isOnline = useStore(offlineStore, () => offlineStore.isOnline);
  const storageUsed = useStore(offlineStore, () => offlineStore.storageUsed);
  const activeDownloads = useStore(offlineStore, () => offlineStore.activeDownloads);
  const availableModules = useStore(moduleStore, () => moduleStore.availableModules);
  const [semanticAvailable, setSemanticAvailable] = useState(false);
  const [semanticSize, setSemanticSize] = useState(0);
  const storageManager = offlineStorageManager;

  // Get currently active Bible tab abbreviations for offline prioritization
  const activeBibleTabs = useStore(bibleStore, () =>
    bibleStore.tabs.map(t => t.moduleAbbr)
  );
  const activeAbbrSet = new Set(activeBibleTabs);

  // Set active tab based on scrollToSection
  useEffect(() => {
    if (isOpen && scrollToSection) {
      setActiveTab(sectionToTab(scrollToSection));
    }
  }, [isOpen, scrollToSection]);

  useEscapeKey(isOpen, onClose);

  // Fetch topical modules when modules tab is shown
  useEffect(() => {
    if (!isOpen || activeTab !== 'modules') return;
    fetch(`${API_BASE}/api/topical/modules`)
      .then(r => r.json())
      .then(data => setTopicalModules(data))
      .catch(() => {});
  }, [isOpen, activeTab]);

  // Fetch repo URL from server config when about tab is shown
  useEffect(() => {
    if (!isOpen || activeTab !== 'about' || repoUrl) return;
    fetch(`${API_BASE}/api/config`)
      .then(r => r.json())
      .then(data => { if (data.repoUrl) setRepoUrl(data.repoUrl); })
      .catch(() => {});
  }, [isOpen, activeTab]);

  // Fetch storage info and semantic availability when offline tab is shown
  useEffect(() => {
    if (!isOpen || activeTab !== 'offline') return;
    storageManager.getStorageInfo().then(info => {
      offlineStore.updateStorageInfo(info.used, info.quota);
    });
    moduleStore.getSemanticIndexInfo()
      .then(data => {
        setSemanticAvailable(data.available);
        setSemanticSize(data.sizeBytes || 0);
      })
      .catch(() => {});
  }, [isOpen, activeTab]);

  // Auto-download currently active Bible tabs when offline mode is first enabled
  const [autoDownloadTriggered, setAutoDownloadTriggered] = useState(false);
  useEffect(() => {
    if (!offlineEnabled || autoDownloadTriggered) return;
    setAutoDownloadTriggered(true);
    for (const abbr of activeBibleTabs) {
      if (!offlineStore.isModuleDownloaded(abbr) && !offlineStore.activeDownloads.has(abbr)) {
        const mod = availableModules.find(m => m.abbreviation === abbr);
        if (mod) {
          storageManager.downloadModule(abbr, mod.name).catch(err => {
            console.error(`Auto-download failed for ${abbr}:`, err);
          });
        }
      }
    }
  }, [offlineEnabled]);

  if (!isOpen) return null;

  // Sort bible modules: currently selected first, then rest
  const bibleModules = availableModules
    .filter(m => m.type === 'bible')
    .sort((a, b) => {
      const aActive = activeAbbrSet.has(a.abbreviation) ? 0 : 1;
      const bActive = activeAbbrSet.has(b.abbreviation) ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      return a.abbreviation.localeCompare(b.abbreviation);
    });

  const handleDownload = async (abbreviation: string, name: string) => {
    try {
      await storageManager.downloadModule(abbreviation, name);
    } catch (err) {
      console.error('Download failed:', err);
    }
  };

  const handleRemove = async (abbreviation: string) => {
    await storageManager.removeModule(abbreviation);
  };

  const handleDownloadSemantic = async () => {
    try {
      await storageManager.downloadSemanticIndex();
    } catch (err) {
      console.error('Semantic download failed:', err);
    }
  };

  /**
   * The five Advanced sliders, as data.
   *
   * One row template means the −/slider/+ layout — and the fixed geometry that
   * keeps the buttons from moving as the value changes width — is written once.
   */
  const advancedTextControls: {
    key: string;
    labelKey: string;
    unit: 'px' | 'ratio';
    value: number;
    min: number;
    max: number;
    step: number;
    set: (value: number) => void;
  }[] = [
    {
      key: 'bibleText', labelKey: 'settings.textSize.bibleText', unit: 'px',
      value: fontSize, min: 12, max: 48, step: 1,
      set: (v) => settingsStore.setFontSize(v),
    },
    {
      key: 'studyText', labelKey: 'settings.textSize.studyText', unit: 'px',
      value: studyFontSize, min: 12, max: 36, step: 1,
      set: (v) => settingsStore.setStudyFontSize(v),
    },
    {
      key: 'uiText', labelKey: 'settings.textSize.uiText', unit: 'px',
      value: uiFontSize, min: 10, max: 24, step: 1,
      set: (v) => settingsStore.setUiFontSize(v),
    },
    {
      key: 'bibleLineHeight', labelKey: 'settings.textSize.bibleLineHeight', unit: 'ratio',
      value: lineHeight, min: 1.2, max: 2.5, step: 0.1,
      set: (v) => settingsStore.setLineHeight(v),
    },
    {
      key: 'studyLineHeight', labelKey: 'settings.textSize.studyLineHeight', unit: 'ratio',
      value: studyLineHeight, min: 1.2, max: 2.5, step: 0.1,
      set: (v) => settingsStore.setStudyLineHeight(v),
    },
  ];

  return (
    <div class="settings-panel-overlay" onClick={onClose}>
      <div
        class="settings-panel settings-panel--tabs"
        style={{ '--ui-font-scale': frozenUiScale.current } as Record<string, string>}
        onClick={(e) => e.stopPropagation()}
      >
        <div class="settings-panel__header">
          <h3><i class="fa-solid fa-gear" style={{ marginRight: '8px', opacity: 0.5 }} />{t('settings.title')}</h3>
          <button class="settings-panel__close" onClick={onClose}>
            <i class="fa-solid fa-xmark" />
          </button>
        </div>
        <div class="settings-panel__layout">
          {/* Left tab navigation */}
          <div class="settings-panel__sidebar">
            {TAB_ITEMS.filter(item => item.key !== 'offline' || serverOfflineDownloads).map(item => (
              <button
                key={item.key}
                class={`settings-panel__tab ${activeTab === item.key ? 'settings-panel__tab--active' : ''}`}
                onClick={() => setActiveTab(item.key)}
                data-tab={item.key}
              >
                <i class={`fa-solid ${item.icon}`} />
                <span>{t(item.label)}</span>
              </button>
            ))}
          </div>

          {/* Right content area */}
          <div class="settings-panel__content">
            {activeTab === 'text-size' && (
              <div class="settings-panel__section" data-section="text-size">
                <div class="settings-panel__section-header">
                  <h4 class="settings-panel__section-title">{t('settings.tabs.textSize')}</h4>
                  <button
                    class="settings-panel__reset-btn"
                    onClick={() => settingsStore.resetTextSettings()}
                    title={t('settings.textSize.resetTextSizesTitle')}
                  >
                    <i class="fa-solid fa-rotate-left fa-xs" /> {t('settings.textSize.resetTextSizes')}
                  </button>
                </div>
                <div class="font-size-control">
                  <button
                    class="font-size-control__btn"
                    onClick={() => settingsStore.adjustAllFontSizes(-2)}
                    disabled={fontSize <= 12 && studyFontSize <= 12 && uiFontSize <= 10}
                    title={t('settings.textSize.decreaseAll')}
                  >
                    <i class="fa-solid fa-minus" />
                  </button>
                  <span class="font-size-control__value">{t('settings.textSize.pxValue', { size: fontSize })}</span>
                  <button
                    class="font-size-control__btn"
                    onClick={() => settingsStore.adjustAllFontSizes(2)}
                    disabled={fontSize >= 48 && studyFontSize >= 36 && uiFontSize >= 24}
                    title={t('settings.textSize.increaseAll')}
                  >
                    <i class="fa-solid fa-plus" />
                  </button>
                </div>

                <label class="settings-panel__field settings-panel__field--checkbox">
                  <input
                    type="checkbox"
                    checked={wordsOfChristInRed}
                    onChange={(e) => settingsStore.setWordsOfChristInRed((e.target as HTMLInputElement).checked)}
                  />
                  <span>{t('settings.textSize.christInRed')}</span>
                </label>

                <label class="settings-panel__field">
                  <span>{t('settings.textSize.interlinearLayout')}</span>
                  <select
                    class="settings-select"
                    value={interlinearLayout}
                    onChange={(e) => settingsStore.setInterlinearLayout((e.target as HTMLSelectElement).value as InterlinearLayout)}
                  >
                    <option value="inline">{t('settings.textSize.interlinearInline')}</option>
                    <option value="stacked">{t('settings.textSize.interlinearStacked')}</option>
                  </select>
                </label>

                <button
                  class={`settings-panel__advanced-toggle ${advancedOpen ? 'settings-panel__advanced-toggle--open' : ''}`}
                  onClick={() => setAdvancedOpen(!advancedOpen)}
                >
                  <i class="fa-solid fa-chevron-right" />
                  {t('settings.textSize.advanced')}
                </button>

                {advancedOpen && (
                  <div class="settings-panel__advanced-section">
                    {advancedTextControls.map(control => {
                      const label = t(control.labelKey);
                      const value = control.value;
                      // Steps land on the control's own grid, so a slider that
                      // moves in tenths never ends up at 1.7000000000000002.
                      const stepTo = (delta: number) => {
                        const next = Math.round((value + delta) * 10) / 10;
                        control.set(Math.max(control.min, Math.min(control.max, next)));
                      };
                      return (
                        <div class="settings-panel__field settings-panel__stepper" key={control.key}>
                          <span class="settings-panel__stepper-label">
                            <span class="settings-panel__stepper-name">{label}</span>
                            <span class="settings-panel__stepper-value">
                              {control.unit === 'px'
                                ? t('settings.textSize.pxValue', { size: value })
                                : value.toFixed(1)}
                            </span>
                          </span>
                          <div class="settings-panel__stepper-row">
                            <button
                              type="button"
                              class="settings-panel__stepper-btn"
                              onClick={() => stepTo(-control.step)}
                              disabled={value <= control.min}
                              title={t('settings.textSize.decreaseSetting', { setting: label })}
                              aria-label={t('settings.textSize.decreaseSetting', { setting: label })}
                            >
                              <i class="fa-solid fa-minus" />
                            </button>
                            <input
                              type="range"
                              min={control.min}
                              max={control.max}
                              step={control.step}
                              value={value}
                              aria-label={label}
                              onInput={(e) => control.set(Number((e.target as HTMLInputElement).value))}
                            />
                            <button
                              type="button"
                              class="settings-panel__stepper-btn"
                              onClick={() => stepTo(control.step)}
                              disabled={value >= control.max}
                              title={t('settings.textSize.increaseSetting', { setting: label })}
                              aria-label={t('settings.textSize.increaseSetting', { setting: label })}
                            >
                              <i class="fa-solid fa-plus" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'theme' && (
              <div class="settings-panel__section" data-section="theme">
                <div class="settings-panel__section-header">
                  <h4 class="settings-panel__section-title">{t('settings.tabs.theme')}</h4>
                  <button class="settings-panel__reset-btn" onClick={() => settingsStore.resetToDefaults()}>
                    <i class="fa-solid fa-rotate-left fa-xs" /> {t('settings.theme.resetAll')}
                  </button>
                </div>
                <div class="settings-panel__field">
                  <span>{t('settings.theme.colorTheme')}</span>
                  <div class="settings-panel__theme-grid">
                    {THEME_LIST.map(themeDef => (
                      <button
                        key={themeDef.id}
                        class={`settings-panel__theme-swatch ${theme === themeDef.id ? 'settings-panel__theme-swatch--active' : ''}`}
                        onClick={() => settingsStore.setTheme(themeDef.id)}
                        title={t(`themes.${themeDef.id}`, themeDef.name)}
                        data-theme-id={themeDef.id}
                        style={{
                          background: themeDef.swatch.bg,
                          color: themeDef.swatch.fg,
                          borderColor: theme === themeDef.id ? themeDef.swatch.accent : 'var(--border-color)',
                        }}
                      >
                        <span class="settings-panel__theme-swatch-bar" style={{ background: themeDef.swatch.accent }} />
                        <span class="settings-panel__theme-swatch-label">{t(`themes.${themeDef.id}`, themeDef.name)}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div class="settings-panel__field">
                  <span>{t('settings.theme.fontSchemeRecommended')}</span>
                  <div class="settings-panel__scheme-grid">
                    {FONT_SCHEMES.filter(s => s.group === 'recommended').map(scheme => (
                      <button
                        key={scheme.id}
                        class={`settings-panel__scheme-card ${fontSchemeId === scheme.id ? 'settings-panel__scheme-card--active' : ''}`}
                        onClick={() => settingsStore.setFontScheme(scheme.id)}
                      >
                        <span class="settings-panel__scheme-label">{scheme.label}</span>
                        <span class="settings-panel__scheme-heading" style={{ fontFamily: scheme.headingFont }}>{t('settings.theme.heading')}</span>
                        <span class="settings-panel__scheme-body" style={{ fontFamily: scheme.contentFont }}>{t('settings.theme.bodyTextSample')}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div class="settings-panel__field">
                  <span>{t('settings.theme.fontSchemeOther')}</span>
                  <div class="settings-panel__scheme-grid">
                    {FONT_SCHEMES.filter(s => s.group === 'other').map(scheme => (
                      <button
                        key={scheme.id}
                        class={`settings-panel__scheme-card ${fontSchemeId === scheme.id ? 'settings-panel__scheme-card--active' : ''}`}
                        onClick={() => settingsStore.setFontScheme(scheme.id)}
                      >
                        <span class="settings-panel__scheme-label">{scheme.label}</span>
                        <span class="settings-panel__scheme-heading" style={{ fontFamily: scheme.headingFont }}>{t('settings.theme.heading')}</span>
                        <span class="settings-panel__scheme-body" style={{ fontFamily: scheme.contentFont }}>{t('settings.theme.bodyTextSample')}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div class="settings-panel__field settings-panel__mobile-only">
                  <label class="settings-panel__field settings-panel__field--checkbox">
                    <input
                      type="checkbox"
                      checked={settingsStore.leftHandedMode}
                      onChange={(e) => settingsStore.setLeftHandedMode((e.target as HTMLInputElement).checked)}
                    />
                    <span>{t('settings.theme.leftHanded')}</span>
                  </label>
                  <div class="settings-panel__field-hint">{t('settings.theme.leftHandedHint')}</div>
                </div>
              </div>
            )}

            {activeTab === 'modules' && (
              <div class="settings-panel__section" data-section="modules">
                <h4 class="settings-panel__section-title">{t('settings.modules.commentary')}</h4>
                <label class="settings-panel__field settings-panel__field--checkbox">
                  <input
                    type="checkbox"
                    checked={showCommentaryOverview}
                    onChange={(e) => settingsStore.setShowCommentaryOverview((e.target as HTMLInputElement).checked)}
                  />
                  <span>{t('settings.modules.showCombinedOverview')}</span>
                </label>

                <h4 class="settings-panel__section-title" style={{ marginTop: '16px' }}>{t('settings.modules.topicalIndexes')}</h4>
                {topicalModules.length > 0 ? (
                  topicalModules.map(mod => (
                    <label key={mod.abbreviation} class="settings-panel__field settings-panel__field--checkbox">
                      <input
                        type="checkbox"
                        checked={!excludedTopicalModules.includes(mod.abbreviation)}
                        onChange={(e) => settingsStore.toggleTopicalModule(mod.abbreviation, (e.target as HTMLInputElement).checked)}
                      />
                      <span>{mod.name}</span>
                    </label>
                  ))
                ) : (
                  <div style={{ color: 'var(--text-muted)', fontSize: 'calc(12px * var(--ui-font-scale, 1))' }}>
                    {t('settings.modules.loadingTopical')}
                  </div>
                )}

              </div>
            )}

            {activeTab === 'gestures' && (
              <div class="settings-panel__section" data-section="gestures">
                <h4 class="settings-panel__section-title">{t('settings.gestures.title', 'Gestures')}</h4>

                <label class="settings-panel__field settings-panel__field--checkbox">
                  <input
                    type="checkbox"
                    checked={swipeChaptersEnabled}
                    onChange={(e) => settingsStore.setSwipeChaptersEnabled((e.target as HTMLInputElement).checked)}
                  />
                  <span>{t('settings.gestures.swipeChaptersEnabled', 'Swipe to change chapters')}</span>
                </label>
                <div class="settings-panel__field-hint">
                  {t('settings.gestures.swipeChaptersHint', 'When enabled, horizontal swipes on the Bible pane navigate to the previous or next chapter.')}
                </div>

                <label class="settings-panel__field">
                  <span>
                    {t('settings.gestures.swipeChapterThreshold', 'Chapter swipe threshold')} ({swipeChapterThresholdPx}px)
                  </span>
                  <input
                    type="range"
                    min="20"
                    max="400"
                    step="10"
                    value={swipeChapterThresholdPx}
                    onInput={(e) => settingsStore.setSwipeChapterThresholdPx(Number((e.target as HTMLInputElement).value))}
                  />
                </label>
                <div class="settings-panel__field-hint">
                  {t('settings.gestures.swipeChapterThresholdHint', 'How far you must swipe across the Bible pane before a chapter change is committed.')}
                </div>

                <label class="settings-panel__field">
                  <span>
                    {t('settings.gestures.swipeCommentaryVerseThreshold', 'Commentary verse swipe threshold')} ({swipeCommentaryVerseThresholdPx}px)
                  </span>
                  <input
                    type="range"
                    min="20"
                    max="400"
                    step="10"
                    value={swipeCommentaryVerseThresholdPx}
                    onInput={(e) => settingsStore.setSwipeCommentaryVerseThresholdPx(Number((e.target as HTMLInputElement).value))}
                  />
                </label>
                <div class="settings-panel__field-hint">
                  {t('settings.gestures.swipeCommentaryVerseThresholdHint', 'How far you must swipe across the Commentary pane before navigating to the previous or next verse.')}
                </div>
              </div>
            )}

            {activeTab === 'about' && (
              <div class="settings-panel__section" data-section="about">
                {/*
                  `settings-section` / `settings-hint` were classes with no
                  stylesheet behind them, which is why this block did not look
                  like the rest of the panel. It uses the panel's own heading
                  and field patterns instead.
                */}
                <h4 class="settings-panel__section-title">{t('settings.language.title')}</h4>
                <div class="settings-panel__field">
                  <span>{t('settings.language.description')}</span>
                  <select
                    class="settings-select"
                    value={i18n.language?.startsWith('en') ? 'en' : i18n.language || 'en'}
                    onChange={(e) => {
                      const lng = (e.target as HTMLSelectElement).value;
                      i18n.changeLanguage(lng);
                      syncDocumentLang();
                    }}
                  >
                    <option value="en">{t('settingsPanel.english')}</option>
                  </select>
                </div>

                <h4 class="settings-panel__section-title">{t('settings.about.title')}</h4>
                <div class="settings-panel__field">
                  <button
                    class="settings-panel__refresh-btn"
                    onClick={() => window.location.reload()}
                  >
                    <i class="fa-solid fa-rotate-right" style={{ marginRight: '8px' }} />
                    {t('settings.about.refreshApp')}
                  </button>
                </div>
                <div class="settings-panel__about">
                  <p class="settings-panel__about-name">{t('settings.about.appName')}</p>
                  <p class="settings-panel__about-desc">
                    {t('settings.about.description')}
                  </p>
                  <p class="settings-panel__about-license">
                    <i class="fa-solid fa-scale-balanced" style={{ marginRight: '6px', opacity: 0.6 }} />
                    <span dangerouslySetInnerHTML={{ __html: t('settings.about.license') }} />
                  </p>
                  <p class="settings-panel__about-text">
                    {t('settings.about.licenseDetails')}
                    {repoUrl && (
                      <>
                        {' '}
                        <a href={repoUrl} target="_blank" rel="noopener noreferrer" class="settings-panel__about-link">
                          <i class="fa-solid fa-arrow-up-right-from-square fa-xs" /> {t('settings.about.viewOnGithub')}
                        </a>
                      </>
                    )}
                  </p>
                </div>
              </div>
            )}

            {activeTab === 'offline' && (
              <div class="settings-panel__section" data-section="offline">
                <h4 class="settings-panel__section-title">{t('settings.offline.title')}</h4>

                <div class="offline-status">
                  <span class={`offline-status__indicator ${isOnline ? 'offline-status__indicator--online' : 'offline-status__indicator--offline'}`} />
                  <span>{isOnline ? t('settings.offline.online') : t('settings.offline.offline')}</span>
                  {storageUsed > 0 && (
                    <span class="offline-status__storage">
                      {t('settings.offline.storage')} {formatBytes(storageUsed)}
                    </span>
                  )}
                </div>

                <label class="settings-panel__field settings-panel__field--checkbox">
                  <input
                    type="checkbox"
                    checked={offlineEnabled}
                    onChange={(e) => offlineStore.setEnabled((e.target as HTMLInputElement).checked)}
                  />
                  <span>{t('settings.offline.enableOffline')}</span>
                </label>

                {offlineEnabled && (
                  <>
                    <h4 class="settings-panel__section-title" style={{ marginTop: '16px' }}>{t('settings.offline.bibleTranslations')}</h4>
                    <div class="offline-modules-list">
                      {bibleModules.map(mod => {
                        const abbr = mod.abbreviation;
                        const downloaded = downloadedModules.find(d => d.abbreviation === abbr);
                        const progress = activeDownloads.get(abbr);
                        const isInUse = activeAbbrSet.has(abbr);
                        return (
                          <OfflineModuleCard
                            key={abbr}
                            abbreviation={abbr}
                            name={mod.name}
                            sizeBytes={downloaded?.sizeBytes}
                            isDownloaded={!!downloaded}
                            progress={progress}
                            onDownload={() => handleDownload(abbr, mod.name)}
                            onRemove={() => handleRemove(abbr)}
                            badge={isInUse ? t('settings.offline.currentlyOpen') : undefined}
                          />
                        );
                      })}
                      {bibleModules.length === 0 && (
                        <div class="offline-modules-list__empty">{t('settings.offline.noModules')}</div>
                      )}
                    </div>

                    <h4 class="settings-panel__section-title" style={{ marginTop: '16px' }}>{t('settings.offline.semanticSearch')}</h4>
                    <div class="offline-modules-list">
                      {semanticAvailable ? (
                        <OfflineModuleCard
                          abbreviation="semantic-index"
                          name={t('settings.offline.semanticIndex')}
                          sizeBytes={semanticSize || downloadedModules.find(d => d.abbreviation === 'semantic-index')?.sizeBytes}
                          isDownloaded={offlineStore.isModuleDownloaded('semantic-index')}
                          progress={activeDownloads.get('semantic-index')}
                          onDownload={handleDownloadSemantic}
                          onRemove={() => handleRemove('semantic-index')}
                        />
                      ) : (
                        <div class="offline-modules-list__empty">
                          {t('settings.offline.semanticNotAvailable')}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
