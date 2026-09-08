import { useState, useEffect, useCallback } from 'react';
import ErrorBoundary from './components/ErrorBoundary';
import TopSearchBar from './components/TopSearchBar';
import LayoutDropdown from './components/LayoutDropdown';
import AdvancedSearchDialog from './components/AdvancedSearchDialog';
import ModuleManagerDialog from './components/ModuleManagerDialog';
import { BackupRestoreDialog } from './components/BackupRestoreDialog';
import PreferencesDialog from './components/PreferencesDialog';
import KeyboardShortcutsDialog from './components/KeyboardShortcutsDialog';
import DocumentationDialog from './components/DocumentationDialog';
import ManageBookmarksDialog from './components/ManageBookmarksDialog';
import CrashReportDialog from './components/diagnostics/CrashReportDialog';
import ReportIssueDialog from './components/diagnostics/ReportIssueDialog';
import ExtensionUiHost from './components/extensions/ExtensionUiHost';
import ExtensionConsentDialog from './components/extensions/ExtensionConsentDialog';
import ToastContainer from './components/ToastContainer';
import DockviewLayout from './components/DockviewLayout';
import WelcomeBar from './components/onboarding/WelcomeBar';
import LanguageFirstRun from './components/onboarding/LanguageFirstRun';
import GuidedTour from './components/onboarding/GuidedTour';
import { useOnboardingStore } from './stores/useOnboardingStore';
import { useBibleStore } from './stores/useBibleStore';
import { useSearchStore } from './stores/useSearchStore';
import { useFindStore } from './stores/useFindStore';
import FindBar from './components/FindBar';
import { useSessionAutoSave } from './stores/useSessionStore';
import UpdateCheckDialog from './components/UpdateCheckDialog';
import HeaderActions from './components/HeaderActions';
import type { PaneType } from './stores/useTextSettingsStore';
import type { ModuleType } from './stores/useModuleStore';
import type { OpenModuleManagerDetail } from './utils/openModuleManager';
import { wireStoreSync } from './stores/storeSync';
import {
  initializeApp,
  registerSaveBeforeCloseHandler,
  checkSemanticAvailability,
} from './services/AppInitService';
// useBackupStore is consumed via a small accessor below to keep `.getState()`
// out of the component body.
import { useBackupStore } from './stores/useBackupStore';
import { getIssueReportUrl, getProductName } from './config/appConfig';
import { useI18n } from './contexts/useI18n';
import './styles/highlights.css';
import './styles/dockview-overrides.css';

// Tiny accessors for menu/command handlers that need to imperatively trigger a
// store action (not subscribe). Keeps `.getState()` confined to this module
// boundary so component bodies stay reactive-only.
const openBackupDialog = () => useBackupStore.getState().openDialog();
const openAdvancedSearchDialog = () => useSearchStore.getState().openAdvancedDialog();
const navigateToVerseInPrimary = (verseId: number) =>
  useBibleStore.getState().navigateToVerseInPrimary(verseId);

// Install cross-store bridges + when-context publishers once, at module load,
// so they're in place before any component calls into the stores. See
// apps/desktop/src/ui/stores/storeSync.ts for what gets wired.
wireStoreSync();

/**
 * Header wordmark: a bible glyph plus the product name stacked over a small
 * letter-spaced tagline, in the theme accent - the desktop counterpart of the
 * web header's `.header__logo` / `.header__wordmark` (apps/web/src/
 * components/Header.tsx, styles/_header.scss).
 *
 * Why two lines rather than one: "Keep Thy Heart Bible Reader" on a single
 * line eats a column of a header that has none to give (the layout dropdown,
 * search field and header actions all follow it in the same flex row). The
 * split reads as a name plus a descriptor and stays about as tall as the
 * search field.
 *
 * The two halves come from the catalog rather than from `branding.json`,
 * mirroring the web app (`app.name` / `app.tagline` in its `ui.json`):
 * `AppConfig` only carries the joined `productName` and splitting it in code
 * would be guesswork against a value maintainers are free to change. The
 * configured name is still authoritative - it is the element's tooltip and
 * accessible name.
 */
const AppWordmark: React.FC = () => {
  const { t } = useI18n();
  const productName = getProductName();
  const name = t('ui.appWordmark.name');
  const tagline = t('ui.appWordmark.tagline');

  return (
    <h1
      className="flex items-center gap-2 flex-shrink-0 m-0 font-bold whitespace-nowrap"
      title={productName}
      aria-label={productName}
      data-testid="app-wordmark"
      style={{ color: 'var(--theme-accent-primary)' }}
    >
      <svg
        className="w-5 h-5 flex-shrink-0"
        viewBox="0 0 448 512"
        fill="currentColor"
        aria-hidden="true"
        focusable="false"
      >
        {/* The product mark, filled: Font Awesome Free "book-bible" (solid),
            the exact glyph in `resources/icon.svg` and in the web header's
            `fa-solid fa-book-bible`. Desktop inlines the path rather than
            pulling in an icon font. Attribution: THIRD-PARTY-NOTICES.md
            section 4. */}
        <path d="M96 512c-53 0-96-43-96-96L0 96C0 43 43 0 96 0L400 0c26.5 0 48 21.5 48 48l0 288c0 20.9-13.4 38.7-32 45.3l0 66.7c17.7 0 32 14.3 32 32s-14.3 32-32 32L96 512zm0-128c-17.7 0-32 14.3-32 32s14.3 32 32 32l256 0 0-64-256 0zM192 80l0 48-48 0c-8.8 0-16 7.2-16 16l0 32c0 8.8 7.2 16 16 16l48 0 0 112c0 8.8 7.2 16 16 16l32 0c8.8 0 16-7.2 16-16l0-112 48 0c8.8 0 16-7.2 16-16l0-32c0-8.8-7.2-16-16-16l-48 0 0-48c0-8.8-7.2-16-16-16l-32 0c-8.8 0-16 7.2-16 16z" />
      </svg>
      {/* leading-[1.05] on both lines is what keeps the stack compact enough
          to sit in a single-row header. */}
      <span className="flex flex-col" style={{ lineHeight: 1.05 }}>
        <span className="text-base">{name}</span>
        <span
          className="uppercase"
          style={{
            fontSize: '9.5px',
            letterSpacing: '0.14em',
            fontWeight: 600,
            // Same recipe as the web tagline: mostly accent, pulled towards the
            // secondary text colour so it reads as a subtitle, not a second
            // heading. color-mix keeps it correct in every theme without a
            // per-theme token.
            color: 'color-mix(in srgb, var(--theme-accent-primary) 62%, var(--theme-text-secondary))',
          }}
        >
          {tagline}
        </span>
      </span>
    </h1>
  );
};

function App() {
  const [savedDockviewLayout, setSavedDockviewLayout] = useState<Record<string, any> | null>(null);
  const [showModuleManager, setShowModuleManager] = useState(false);
  const [moduleManagerFilter, setModuleManagerFilter] = useState<ModuleType | null>(null);
  const [showUpdateCheck, setShowUpdateCheck] = useState(false);
  const [showPreferences, setShowPreferences] = useState(false);
  const [preferencesInitialSection, setPreferencesInitialSection] = useState<string>('general');
  const [preferencesFontPane, setPreferencesFontPane] = useState<PaneType | undefined>(undefined);
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false);
  const [showDocumentation, setShowDocumentation] = useState(false);
  const [showManageBookmarks, setShowManageBookmarks] = useState(false);
  const isFindVisible = useFindStore(s => s.isVisible);
  const setFindVisible = useFindStore(s => s.setVisible);
  const isTourActive = useOnboardingStore(s => s.isTourActive);
  const startTour = useOnboardingStore(s => s.startTour);

  const handleCloseFindBar = useCallback(() => {
    setFindVisible(false);
    const allWords = document.querySelectorAll('.word.find-match, .word.find-match-current');
    allWords.forEach(word => {
      word.classList.remove('find-match', 'find-match-current');
    });
  }, [setFindVisible]);

  // Enable auto-save
  useSessionAutoSave();

  // Initialize on mount
  useEffect(() => {
    const signal = { aborted: false };

    initializeApp(signal).then(({ dockviewLayout }) => {
      if (signal.aborted) return;
      if (dockviewLayout) {
        setSavedDockviewLayout(dockviewLayout);
      }
    });

    registerSaveBeforeCloseHandler();
    checkSemanticAvailability();

    return () => { signal.aborted = true; };
  }, []);

  // Listen for extension-driven verse navigation requests (bible.navigateToVerse)
  useEffect(() => {
    const api = window.electron?.window;
    if (api?.onExtensionNavigateToVerse) {
      api.onExtensionNavigateToVerse(navigateToVerseInPrimary);
    }
  }, []);

  // Listen for menu events
  useEffect(() => {
    // Module Manager menu handler
    const handleOpenModuleManager = () => {
      setModuleManagerFilter(null);
      setShowModuleManager(true);
    };

    // Backup/Restore menu handler (Export Data)
    const handleExportData = () => {
      openBackupDialog();
    };

    // Preferences menu handler
    const handlePreferences = () => {
      setPreferencesInitialSection('general');
      setPreferencesFontPane(undefined);
      setShowPreferences(true);
    };

    // Keyboard Shortcuts menu handler
    const handleKeyboardShortcuts = () => {
      setShowKeyboardShortcuts(true);
    };

    // Documentation menu handler
    const handleDocumentation = () => {
      setShowDocumentation(true);
    };

    window.electron.menu.onImportModule(handleOpenModuleManager);
    window.electron.menu.onExportData(handleExportData);
    window.electron.menu.onPreferences(handlePreferences);
    window.electron.menu.onKeyboardShortcuts(handleKeyboardShortcuts);
    window.electron.menu.onDocumentation(handleDocumentation);
  }, []);

  const openPreferencesToFonts = useCallback((paneType: PaneType) => {
    setPreferencesInitialSection('fonts');
    setPreferencesFontPane(paneType);
    setShowPreferences(true);
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as PaneType;
      openPreferencesToFonts(detail);
    };
    window.addEventListener('open-preferences-fonts', handler);
    return () => window.removeEventListener('open-preferences-fonts', handler);
  }, [openPreferencesToFonts]);

  // Command bus subscriptions. The KeybindingService now owns global
  // shortcuts and dispatches commands; the command handlers in
  // src/ui/commands/ fire `command:*` CustomEvents that we listen for here.
  // This is the bridge from "command was invoked" to "React state moves".
  useEffect(() => {
    const openFindBar = () => {
      setFindVisible(true);
    };
    const openAdvancedSearch = () => {
      openAdvancedSearchDialog();
    };
    const toggleKeyboardShortcuts = () => {
      setShowKeyboardShortcuts(prev => !prev);
    };
    const openPreferences = () => {
      setPreferencesInitialSection('general');
      setPreferencesFontPane(undefined);
      setShowPreferences(true);
    };
    const openModuleManager = (e: Event) => {
      // D2: panes pass a `moduleType` so the manager opens filtered to the type
      // the user needs (e.g. an empty Commentary pane -> Available > Commentaries).
      const detail = (e as CustomEvent<OpenModuleManagerDetail>).detail;
      setModuleManagerFilter(detail?.moduleType ?? null);
      setShowModuleManager(true);
    };
    const checkForUpdates = () => {
      setShowUpdateCheck(true);
    };
    const exportNotes = () => {
      openBackupDialog();
    };
    const openDocumentation = () => {
      setShowDocumentation(true);
    };
    const openAbout = () => {
      // The native About dialog, routed through the existing main-process IPC
      // channel. Doing it from the renderer avoids needing a dedicated "about"
      // dialog component.
      const w = window as unknown as {
        electron?: { ipcRenderer?: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> } };
      };
      void w.electron?.ipcRenderer?.invoke('app:show-about');
    };
    const toggleDevTools = () => {
      const w = window as unknown as {
        electron?: { ipcRenderer?: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> } };
      };
      void w.electron?.ipcRenderer?.invoke('app:toggle-dev-tools');
    };
    const reportIssue = () => {
      // The target (issue tracker URL or mailto: address) is a build-time
      // config value. When it is unset the command is never registered, but
      // guard anyway so a stray event can't open a dead link.
      const target = getIssueReportUrl();
      if (!target) return;
      const w = window as unknown as {
        electron?: { ipcRenderer?: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> } };
      };
      void w.electron?.ipcRenderer?.invoke('app:open-external', target);
    };
    const zoomIn = () => {
      const w = window as unknown as {
        electron?: { ipcRenderer?: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> } };
      };
      void w.electron?.ipcRenderer?.invoke('app:zoom-in');
    };
    const zoomOut = () => {
      const w = window as unknown as {
        electron?: { ipcRenderer?: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> } };
      };
      void w.electron?.ipcRenderer?.invoke('app:zoom-out');
    };
    const actualSize = () => {
      const w = window as unknown as {
        electron?: { ipcRenderer?: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> } };
      };
      void w.electron?.ipcRenderer?.invoke('app:actual-size');
    };

    const openTour = () => {
      startTour();
    };
    const openManageBookmarks = () => {
      setShowManageBookmarks(true);
    };

    window.addEventListener('command:app:startTour', openTour);
    window.addEventListener('command:bookmarks:manage', openManageBookmarks);
    window.addEventListener('command:search:openFindBar', openFindBar);
    window.addEventListener('command:app:openKeyboardShortcuts', toggleKeyboardShortcuts);
    window.addEventListener('command:app:openPreferences', openPreferences);
    window.addEventListener('command:module:openManager', openModuleManager);
    window.addEventListener('command:app:checkForUpdates', checkForUpdates);
    window.addEventListener('command:notes:export', exportNotes);
    window.addEventListener('command:app:openDocumentation', openDocumentation);
    window.addEventListener('command:app:openAbout', openAbout);
    window.addEventListener('command:app:toggleDevTools', toggleDevTools);
    window.addEventListener('command:app:reportIssue', reportIssue);
    window.addEventListener('command:view:zoomIn', zoomIn);
    window.addEventListener('command:view:zoomOut', zoomOut);
    window.addEventListener('command:view:actualSize', actualSize);

    // Advanced search has no CustomEvent (handler dispatches directly into
    // the search store), but we expose a no-op listener so the contract is
    // explicit if someone later refactors it.
    window.addEventListener('command:search:openAdvanced', openAdvancedSearch);

    return () => {
      window.removeEventListener('command:app:startTour', openTour);
      window.removeEventListener('command:bookmarks:manage', openManageBookmarks);
      window.removeEventListener('command:search:openFindBar', openFindBar);
      window.removeEventListener('command:app:openKeyboardShortcuts', toggleKeyboardShortcuts);
      window.removeEventListener('command:app:openPreferences', openPreferences);
      window.removeEventListener('command:module:openManager', openModuleManager);
      window.removeEventListener('command:app:checkForUpdates', checkForUpdates);
      window.removeEventListener('command:notes:export', exportNotes);
      window.removeEventListener('command:app:openDocumentation', openDocumentation);
      window.removeEventListener('command:app:openAbout', openAbout);
      window.removeEventListener('command:app:toggleDevTools', toggleDevTools);
      window.removeEventListener('command:app:reportIssue', reportIssue);
      window.removeEventListener('command:view:zoomIn', zoomIn);
      window.removeEventListener('command:view:zoomOut', zoomOut);
      window.removeEventListener('command:view:actualSize', actualSize);
      window.removeEventListener('command:search:openAdvanced', openAdvancedSearch);
    };
  }, [setFindVisible, startTour]);

  return (
    <ErrorBoundary>
      <div className="flex flex-col h-screen bg-background overflow-hidden" data-testid="app-loaded">
        {/* Top bar */}
        <header className="border-b border-border px-lg py-sm flex-shrink-0" style={{ backgroundColor: 'var(--theme-pane-header-bg)' }}>
          <div className="flex items-center gap-lg min-w-0">
            <AppWordmark />
            <LayoutDropdown />
            <TopSearchBar />
            {/* D3: in-canvas access to Settings / Module Manager / Help so a
                user who never opens the native menu bar can still reach them. */}
            <HeaderActions />
          </div>
        </header>

        {/* First-run orientation. Renders nothing once dismissed. */}
        <WelcomeBar />

        {/* Find Bar (Ctrl+F) - displayed above all panes */}
        {isFindVisible && (
          <div className="flex-shrink-0 border-b border-border bg-surface-secondary px-4 py-1 flex justify-end">
            <FindBar onClose={handleCloseFindBar} />
          </div>
        )}

        {/* Main content area - Dockview flexible pane system */}
        <main className="flex-1 min-h-0 overflow-hidden">
          <DockviewLayout savedLayout={savedDockviewLayout} />
        </main>

        {/* Advanced Search Dialog (modal overlay) */}
        <AdvancedSearchDialog />

        {/* Module Manager Dialog (modal overlay) */}
        {showModuleManager && (
          <ModuleManagerDialog
            initialModuleType={moduleManagerFilter}
            onClose={() => setShowModuleManager(false)}
          />
        )}

        {/* Manual "Check for Updates". User-initiated only - the
            dialog shows the host before contacting it and is blocked offline. */}
        {showUpdateCheck && (
          <UpdateCheckDialog onClose={() => setShowUpdateCheck(false)} />
        )}

        {/* Backup/Restore Dialog */}
        <BackupRestoreDialog />

        {/* Preferences Dialog */}
        {showPreferences && (
          <PreferencesDialog
            initialSection={preferencesInitialSection}
            initialFontPane={preferencesFontPane}
            onClose={() => setShowPreferences(false)}
          />
        )}

        {/* Keyboard Shortcuts Dialog */}
        {showKeyboardShortcuts && (
          <KeyboardShortcutsDialog onClose={() => setShowKeyboardShortcuts(false)} />
        )}

        {/* Documentation Dialog */}
        {showDocumentation && (
          <DocumentationDialog onClose={() => setShowDocumentation(false)} />
        )}

        {/* Bookmarks manager. A modal rather than a pane - see the component. */}
        {showManageBookmarks && (
          <ManageBookmarksDialog onClose={() => setShowManageBookmarks(false)} />
        )}

        {/* Extension-driven notification + modal stack */}
        <ExtensionUiHost />
        {/* Extension install consent dialog */}
        <ExtensionConsentDialog />
        {/* Toast notifications */}
        <ToastContainer />

        {/* Diagnostics: crash prompt for main-process errors */}
        <CrashReportDialog />

        {/* Diagnostics: user-initiated "Report an Issue" dialog */}
        <ReportIssueDialog />

        {/*
          Guided tour (Help -> Take a Tour). Mounted only while running, so
          leaving it removes the overlay and spotlight in one step - there is
          no imperative decoration that could be left behind.
        */}
        {isTourActive && <GuidedTour />}

        {/*
          First-run language question. Renders null once answered, so it costs
          nothing on every subsequent launch. Mounted last so it sits above the
          tour - on a genuinely fresh install the language must be settled
          before anything else is worth reading.
        */}
        <LanguageFirstRun />
      </div>
    </ErrorBoundary>
  );
}

export default App;
