/**
 * PreferencesDialog.tsx (KAN-51)
 *
 * Central Preferences dialog with left-hand sidebar sections.
 * Replaces per-pane TextSettingsDialog instances with a unified settings experience.
 *
 * This file is a thin composition shell. The individual sections,
 * the per-pane font settings panel, and the dialog-shell hook live
 * under `./PreferencesDialog/`.
 *
 * Wiring into App.tsx (dialog open/close state, menu + command-bus listeners,
 * and the `open-preferences-fonts` event) lives in App.tsx itself. Session
 * persistence (theme, global font scale, UI control size, typography) is
 * wired in `services/AppInitService.ts` (`usePreferencesStore.loadFromSession`
 * / `.applyAll()`, called early in `initializeApp()`) and
 * `stores/useSessionStore.ts` (`getSessionData()`'s `ui.preferences` field,
 * fed by `usePreferencesStore`'s registered session serializer). See
 * settings-preferences.md for the full persistence path.
 */

import React, { Suspense, useMemo, useRef, useState } from 'react';
import type { PreferencesSectionContribution } from '@bible/core/browser';
import { useI18n } from '../contexts/useI18n';
import { useAppServices } from '../contexts/ContextProvider';
import { useTabKeyboardNav } from '../hooks/useTabKeyboardNav';
import { PaneType } from '../stores/useTextSettingsStore';
import { translateWithDefault } from '../hooks/useXrefGraphLabels';
import { modulePoints } from '../modules/moduleHost';
import { useRegistryItems } from '../modules/host/useRegistry';
import { SECTION_ICONS } from './PreferencesDialog/sectionDefs';
import { SettingsGroupSection } from './PreferencesDialog/SettingsGroupSection';
import { useDialogShell } from './PreferencesDialog/useDialogShell';

/** Props every section view may receive; a view ignores the ones it does not use. */
interface SectionViewProps {
  initialPane?: PaneType;
  initialExpand?: { extensionId: string; section?: string };
}

/** One `React.lazy` per view loader, so a section keeps its identity across renders. */
const lazyViews = new WeakMap<object, React.LazyExoticComponent<React.ComponentType<SectionViewProps>>>();

function lazyView(id: string): React.LazyExoticComponent<React.ComponentType<SectionViewProps>> | undefined {
  const loader = modulePoints.views.resolve<{ default: React.ComponentType<SectionViewProps> }>(`preferences:${id}`);
  if (!loader) return undefined;
  let view = lazyViews.get(loader);
  if (!view) {
    view = React.lazy(loader);
    lazyViews.set(loader, view);
  }
  return view;
}

const SectionBody: React.FC<{ section: PreferencesSectionContribution } & SectionViewProps> = ({ section, ...props }) => {
  const View = lazyView(section.id);
  if (View) return <View {...props} />;
  if (section.settingsGroup) return <SettingsGroupSection group={section.settingsGroup} />;
  return null;
};

interface PreferencesDialogProps {
  /** Which section to show initially (default: 'general') */
  initialSection?: string;
  /** If opening to the Fonts section, which pane to expand initially */
  initialFontPane?: PaneType;
  /**
   * If opening to the Extensions section via `api.ui.openSettings(...)`,
   * which extension (and optionally which of its settings keys) to expand.
   */
  initialExtensionTarget?: { extensionId: string; section?: string };
  /** Close callback */
  onClose: () => void;
}

const PreferencesDialog: React.FC<PreferencesDialogProps> = ({
  initialSection = 'general',
  initialFontPane,
  initialExtensionTarget,
  onClose
}) => {
  const { t, i18n } = useI18n();
  const { whenContext } = useAppServices();
  const contributed = useRegistryItems(modulePoints.preferencesSections);
  // Sections of a disabled module are not in the registry; `when` is a cheap data predicate.
  const sections = useMemo(
    () =>
      contributed
        .filter((s) => {
          if (!s.when) return true;
          try {
            return whenContext.evaluate(s.when);
          } catch {
            return false;
          }
        })
        .map((s) => ({
          ...s,
          label: 'key' in s.title ? translateWithDefault(t, s.title.key, s.title.fallback) : i18n.resolve(s.title.text),
          glyph: SECTION_ICONS[s.id],
        })),
    [contributed, whenContext, t, i18n],
  );
  const [activeSection, setActiveSection] = useState<string>(initialSection || 'general');
  const dialogRef = useRef<HTMLDivElement>(null);

  useDialogShell(dialogRef, onClose);

  const activeSectionIndex = sections.findIndex((s) => s.id === activeSection);
  const { tablistRef, onKeyDown: handleTabKeyDown } = useTabKeyboardNav({
    tabCount: sections.length,
    activeIndex: activeSectionIndex,
    onActivate: (index) => setActiveSection(sections[index].id),
  });

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ backgroundColor: 'var(--theme-bg-overlay)' }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="preferences-dialog-title"
        className="rounded-lg shadow-2xl w-full max-w-4xl h-[min(85vh,700px)] overflow-hidden flex"
        style={{
          backgroundColor: 'var(--theme-surface-elevated)',
          border: '1px solid var(--theme-border-primary)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left sidebar */}
        <div
          className="w-52 flex-shrink-0 flex flex-col py-4"
          style={{
            backgroundColor: 'var(--theme-surface-secondary)',
            borderInlineEnd: '1px solid var(--theme-border-primary)'
          }}
        >
          <h2
            id="preferences-dialog-title"
            className="text-lg font-semibold px-5 mb-4"
            style={{ color: 'var(--theme-text-heading)' }}
          >
            {t('preferencesDialog.title')}
          </h2>

          <nav
            className="flex-1 space-y-0.5 px-2"
            role="tablist"
            aria-label={t('preferencesDialog.sectionsNavLabel')}
            aria-orientation="vertical"
            ref={tablistRef}
            onKeyDown={handleTabKeyDown}
          >
            {sections.map((section) => (
              <button
                key={section.id}
                role="tab"
                id={`preferences-tab-${section.id}`}
                aria-selected={activeSection === section.id}
                aria-controls={`preferences-panel-${section.id}`}
                tabIndex={activeSection === section.id ? 0 : -1}
                onClick={() => setActiveSection(section.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                  activeSection === section.id ? 'font-semibold' : ''
                }`}
                style={{
                  backgroundColor: activeSection === section.id
                    ? 'var(--theme-accent-light)'
                    : 'transparent',
                  color: activeSection === section.id
                    ? 'var(--theme-accent-primary)'
                    : 'var(--theme-text-secondary)'
                }}
                onMouseEnter={(e) => {
                  if (activeSection !== section.id) {
                    e.currentTarget.style.backgroundColor = 'var(--theme-bg-hover)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (activeSection !== section.id) {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }
                }}
              >
                {section.glyph}
                {section.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Right content area */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Section header */}
          <div
            className="px-8 py-5 flex-shrink-0"
            style={{ borderBottom: '1px solid var(--theme-border-primary)' }}
          >
            <h3
              className="text-xl font-semibold"
              style={{ color: 'var(--theme-text-heading)' }}
            >
              {sections[activeSectionIndex]?.label ?? t('preferencesDialog.title')}
            </h3>
          </div>

          {/* Section content */}
          <div
            className="flex-1 overflow-y-auto px-8 py-6"
            role="tabpanel"
            id={`preferences-panel-${activeSection}`}
            aria-labelledby={`preferences-tab-${activeSection}`}
            tabIndex={0}
          >
            {activeSectionIndex >= 0 && (
              <Suspense fallback={null}>
                <SectionBody
                  section={sections[activeSectionIndex]}
                  initialPane={initialFontPane}
                  initialExpand={initialExtensionTarget}
                />
              </Suspense>
            )}
          </div>

          {/* Footer with close button */}
          <div
            className="px-8 py-4 flex justify-end flex-shrink-0"
            style={{ borderTop: '1px solid var(--theme-border-primary)' }}
          >
            <button
              onClick={onClose}
              className="px-6 py-2 rounded text-sm font-medium transition-colors"
              style={{
                backgroundColor: 'var(--theme-accent-primary)',
                color: 'var(--theme-accent-text)'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--theme-accent-hover)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--theme-accent-primary)';
              }}
            >
              {t('preferencesDialog.done')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PreferencesDialog;
