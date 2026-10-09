import { useState, useEffect, useRef } from 'preact/hooks';
import { useSyncExternalStore } from 'preact/compat';
import { SettingsForm } from '@bible/ui';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import { changeLocale, selectableLocaleInfos } from '../../i18n';
import { settingsStore, FONT_SCHEMES, type InterlinearLayout } from '../../stores/settingsStore';
import { webSettings, WEB_SETTINGS } from '../../stores/settingsRegistry';
import { isEnabled } from '../../utils/featureFlags';
import { THEME_LIST } from '../../themes/themeRegistry';
import { offlineStore } from '../../stores/offlineStore';
import { moduleStore } from '../../stores/moduleStore';
import { bibleStore } from '../../stores/bibleStore';
import { useStore } from '../../hooks/useStore';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { AppsSettingsTab } from './AppsSettingsTab';
import { useLocalizer } from '../../hooks/useLocalizer';
import { offlineStorageManager } from '../../offline/sharedInstances';
import { API_BASE } from '../../utils/apiUrl';
import { resetAppCache } from '../../utils/appUpdate';
import { pwaFlag } from '../../utils/clientConfig';
import type { PreferencesSectionContribution } from '@bible/core/browser';
import { modulePoints } from '../../modules/moduleHost';
import { ContributedSection } from './ContributedSection';

type SettingsTab = string;

/** Tabs whose content is rendered inline below; any other contributed section goes through `ContributedSection`. */
const BUILTIN_TABS = new Set(['text-size', 'theme', 'modules', 'gestures', 'apps', 'about']);

/** The tabs, in order, from the `preferencesSections` contribution point (declared by `modules/host/ui.ts`). */
function useSettingsSections(): PreferencesSectionContribution[] {
  const entries = useSyncExternalStore(
    modulePoints.preferencesSections.subscribe.bind(modulePoints.preferencesSections),
    modulePoints.preferencesSections.getSnapshot.bind(modulePoints.preferencesSections),
  );
  return entries.map((e) => e.item).filter((i) => (!i.platforms || i.platforms.includes('web')) && !i.parent);
}

/** Sections that sit inside a tab of their own `parent` (in order), e.g. a module's fields under Theme. */
function useChildSections(parent: string): PreferencesSectionContribution[] {
  const entries = useSyncExternalStore(
    modulePoints.preferencesSections.subscribe.bind(modulePoints.preferencesSections),
    modulePoints.preferencesSections.getSnapshot.bind(modulePoints.preferencesSections),
  );
  return entries.map((e) => e.item).filter((i) => i.parent === parent && (!i.platforms || i.platforms.includes('web')));
}

function sectionToTab(section?: string): SettingsTab {
  if (section === 'bible-font' || section === 'commentary-font' || section === 'study-font' || section === 'text-size') return 'text-size';
  if (section === 'theme' || section === 'appearance') return 'theme';
  if (section === 'modules') return 'modules';
  if (section === 'gestures') return 'gestures';
  if (section === 'apps') return 'apps';
  if (section === 'about') return 'about';
  // A section contributed by a feature module deep-links by its own id.
  if (section && modulePoints.preferencesSections.has(section)) {
    const parent = modulePoints.preferencesSections.get(section)?.parent;
    return parent ? sectionToTab(parent) : section;
  }
  return 'text-size';
}

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  /** Section to open the panel on; maps to a tab via `sectionToTab`. */
  scrollToSection?: string | null;
}

export function SettingsPanel({ isOpen, onClose, scrollToSection }: SettingsPanelProps) {
  const { t } = useTranslation();
  const localizer = useLocalizer();
  // Registry-driven language picker (see the "about" tab below): recomputed
  // on every render, which is cheap (a handful of `meta.json`s) and correct,
  // since react-i18next already re-renders this component on language change.
  const localeOptions = selectableLocaleInfos(i18n.language);
  const betaBadgeLabel = t('settings.language.localeBetaBadge');
  const draftBadgeLabel = t('settings.language.localeDraftBadge');
  const anyDraftListed = localeOptions.some((info) => info.status === 'draft');
  const anyBetaListed = localeOptions.some((info) => info.status === 'beta');
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
  const registryValues = useSyncExternalStore(webSettings.subscribe, webSettings.getSnapshot);
  const gestureFields = WEB_SETTINGS.toFields('gestures', {
    translate: (key, fallback) => t(key, fallback),
    isEnabled,
    values: registryValues,
  });
  const serverOfflineDownloads = useStore(settingsStore, () => settingsStore.serverOfflineDownloads);
  const sections = useSettingsSections();
  const themeChildren = useChildSections('theme');
  const [activeTab, setActiveTab] = useState<SettingsTab>('text-size');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [resettingCache, setResettingCache] = useState(false);
  // Offered whenever the PWA might be in play: on, or unknown (offline boot).
  // Only a server that answered "off" hides it; there is no worker to reset then.
  const showResetCache = pwaFlag() !== false && typeof navigator !== 'undefined' && 'serviceWorker' in navigator;

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
  const availableModules = useStore(moduleStore, () => moduleStore.availableModules);
  const storageManager = offlineStorageManager;

  // Get currently active Bible tab abbreviations for offline prioritization
  const activeBibleTabs = useStore(bibleStore, () =>
    bibleStore.tabs.map(t => t.moduleAbbr)
  );

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
          <h3><i class="fa-solid fa-gear" style={{ marginInlineEnd: '8px', opacity: 0.5 }} />{t('settings.title')}</h3>
          <button class="settings-panel__close" onClick={onClose}>
            <i class="fa-solid fa-xmark" />
          </button>
        </div>
        <div class="settings-panel__layout">
          {/* Left tab navigation */}
          <div class="settings-panel__sidebar">
            {sections.filter(item => (item.id !== 'offline' || serverOfflineDownloads)).map(item => (
              <button
                key={item.id}
                class={`settings-panel__tab ${activeTab === item.id ? 'settings-panel__tab--active' : ''}`}
                onClick={() => setActiveTab(item.id)}
                data-tab={item.id}
              >
                <i class={`fa-solid ${item.icon?.kind === 'builtin' ? item.icon.name : ''}`} />
                <span>{'key' in item.title ? t(item.title.key, item.title.fallback) : ''}</span>
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
                  <i class="fa-solid fa-chevron-right kth-rtl-mirror" />
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
                                : localizer.formatNumber(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
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
                {themeChildren.map((sec) => <ContributedSection key={sec.id} section={sec} embedded />)}
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

                {/*
                  Rendered from the settings registry (`stores/settingsRegistry.ts`) by the
                  shared SettingsForm: a new gestures setting is one registry entry.
                */}
                <SettingsForm
                  fields={gestureFields}
                  values={registryValues}
                  idPrefix="settings-gestures"
                  onChange={(key, value) => { webSettings.set(key, value); }}
                />
              </div>
            )}


            {activeTab === 'apps' && <AppsSettingsTab />}

            {!BUILTIN_TABS.has(activeTab) && sections.some(sec => sec.id === activeTab) && (
              <ContributedSection section={sections.find(sec => sec.id === activeTab)!} />
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
                  {/*
                    Registry-driven, same three-tier rule as desktop's
                    `selectableLocales()`: `draft` locales are withheld unless
                    already active, `beta` and `complete` are always offered.
                    Today this build only ships `en` (`complete`), so the list
                    is a single option until another locale folder is added -
                    at that point it appears here with no code change beyond
                    its own `meta.json`.
                  */}
                  <select
                    class="settings-select"
                    value={localeOptions.some((info) => info.code === i18n.language) ? i18n.language : 'en'}
                    onChange={(e) => {
                      void changeLocale((e.target as HTMLSelectElement).value);
                    }}
                  >
                    {localeOptions.map((info) => (
                      <option key={info.code} value={info.code}>
                        {info.code === 'en'
                          ? t('settingsPanel.english')
                          : info.status === 'beta'
                            ? `${info.nativeName} (${betaBadgeLabel})`
                            : info.status === 'draft'
                              ? `${info.nativeName} (${draftBadgeLabel})`
                              : info.nativeName}
                      </option>
                    ))}
                  </select>
                  {anyDraftListed && (
                    <p class="settings-panel__hint">{t('settings.language.draftNote')}</p>
                  )}
                  {!anyDraftListed && anyBetaListed && (
                    <p class="settings-panel__hint">{t('settings.language.betaNote')}</p>
                  )}
                  {!anyDraftListed && !anyBetaListed && (
                    <p class="settings-panel__hint">{t('settings.language.moreComingNote')}</p>
                  )}
                </div>

                <h4 class="settings-panel__section-title">{t('settings.about.title')}</h4>
                <div class="settings-panel__field">
                  <button
                    class="settings-panel__refresh-btn"
                    onClick={() => window.location.reload()}
                  >
                    <i class="fa-solid fa-rotate-right" style={{ marginInlineEnd: '8px' }} />
                    {t('settings.about.refreshApp')}
                  </button>
                </div>
                {showResetCache && (
                  <div class="settings-panel__field">
                    <button
                      class="settings-panel__refresh-btn"
                      data-testid="reset-app-cache"
                      disabled={resettingCache}
                      onClick={() => {
                        setResettingCache(true);
                        void resetAppCache();
                      }}
                    >
                      <i class="fa-solid fa-broom" style={{ marginInlineEnd: '8px' }} />
                      {t('settings.about.resetCache')}
                    </button>
                    <p class="settings-panel__hint">{t('settings.about.resetCacheHint')}</p>
                  </div>
                )}
                <div class="settings-panel__about">
                  <p class="settings-panel__about-name">{t('settings.about.appName')}</p>
                  <p class="settings-panel__about-desc">
                    {t('settings.about.description')}
                  </p>
                  <p class="settings-panel__about-license">
                    <i class="fa-solid fa-scale-balanced" style={{ marginInlineEnd: '6px', opacity: 0.6 }} />
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
          </div>
        </div>
      </div>
    </div>
  );
}
