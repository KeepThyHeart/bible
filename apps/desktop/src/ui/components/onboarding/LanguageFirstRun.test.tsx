import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import LanguageFirstRun from './LanguageFirstRun';
import {
  useOnboardingStore,
  LANGUAGE_CHOSEN_STORAGE_KEY,
} from '../../stores/useOnboardingStore';
import { useNetworkStore } from '../../stores/useNetworkStore';
import { useModuleStore } from '../../stores/useModuleStore';
import { markLocaleCatalogsReady } from '../../services/localeCatalogsReady';
import type { LocaleMetadata } from '../../services/II18nService';
import { enT } from '../../testing/enCatalog';

/**
 * The picker is the one modal in the app that opens by itself, so the tests
 * that matter are about *when it does not*: once answered, before the locale
 * catalogs it lists have loaded, and - since only English is offered out of
 * the shipped catalogs (`SELECTABLE_BUILT_IN_LOCALES` in
 * `PreferencesDialog/GeneralSection.tsx`) - when there is no longer a question
 * worth asking.
 */

/** Catalogs that ship inside the app bundle. Only `en` is offered today. */
const BUILT_IN: LocaleMetadata[] = [
  { code: 'en', name: 'English', nativeName: 'English', status: 'complete', direction: 'ltr' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', status: 'draft', direction: 'ltr' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', status: 'draft', direction: 'ltr' },
  { code: 'zh-Hans', name: 'Chinese (Simplified)', nativeName: '简体中文', status: 'draft', direction: 'ltr' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', status: 'draft', direction: 'ltr' },
];

/**
 * Catalogs a user dropped into `<userData>/locales/`. These must keep working
 * with no code change - that mechanism is the whole reason the gate lives in
 * the pickers rather than inside `I18nService`.
 */
const USER_SUPPLIED: LocaleMetadata[] = [
  { code: 'fr', name: 'French', nativeName: 'Français', status: 'draft', direction: 'ltr' },
  { code: 'de', name: 'German', nativeName: 'Deutsch', status: 'complete', direction: 'ltr' },
];

// Hoisted so the module mock below can read a value each test sets.
const h = vi.hoisted(() => ({
  locales: [] as LocaleMetadata[],
  setLocale: vi.fn(async () => {}),
}));

vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({
    // `tf()` falls back to its English source when a key is unknown, and a
    // stub `t` that echoes the key is one of the two shapes it treats as a
    // miss - so the assertions below read the real English copy.
    t: (key: string, params?: Record<string, unknown>) => enT(key, params),
    locale: 'en',
    i18n: {
      currentLocale: 'en',
      get availableLocaleInfos(): LocaleMetadata[] {
        return h.locales;
      },
      setLocale: h.setLocale,
    },
  }),
}));

const getStarterPacks = vi.fn();

beforeEach(() => {
  window.localStorage.clear();
  useOnboardingStore.setState({ languageChosen: false });
  h.setLocale.mockClear();
  h.locales = [...BUILT_IN, ...USER_SUPPLIED];
  getStarterPacks.mockReset();
  getStarterPacks.mockResolvedValue({ ok: true, value: [] });
  // No `network` bridge by default, matching most of these tests: the store
  // never loads, so the network step is skipped exactly as it always was
  // before that step existed (see `useNetworkStore`'s doc comment).
  useNetworkStore.setState({ allowWebRequests: false, loaded: false });
  (window as unknown as { electron?: unknown }).electron = {
    moduleManager: { getStarterPacks },
  };
  // The readiness signal is a one-shot module singleton with no reset, so the
  // "waits for catalogs" path cannot be exercised per-test here; it is covered
  // by `localeCatalogsReady.test.ts`. Open the gate so these tests can get at
  // the dialog at all.
  markLocaleCatalogsReady();
});

describe('LanguageFirstRun', () => {
  it('opens on a fresh install', async () => {
    render(<LanguageFirstRun />);
    expect(await screen.findByTestId('first-run-language-dialog')).toBeInTheDocument();
  });

  it('renders nothing once the language question has been answered', () => {
    useOnboardingStore.setState({ languageChosen: true });
    render(<LanguageFirstRun />);
    expect(screen.queryByTestId('first-run-language-dialog')).not.toBeInTheDocument();
  });

  it('offers English but none of the other shipped catalogs', async () => {
    render(<LanguageFirstRun />);
    await screen.findByTestId('first-run-language-dialog');

    expect(screen.getByTestId('first-run-language-en')).toBeInTheDocument();
    // Machine-drafted catalogs that ship with the app are withheld until a
    // native speaker has reviewed them.
    for (const code of ['es', 'hi', 'zh-Hans', 'ru']) {
      expect(screen.queryByTestId(`first-run-language-${code}`)).not.toBeInTheDocument();
    }
  });

  it("keeps a user's own dropped-in locale reachable behind the disclosure", async () => {
    render(<LanguageFirstRun />);
    await screen.findByTestId('first-run-language-dialog');

    // Not a supported *content* language, so it is not in the headline list...
    expect(screen.queryByTestId('first-run-language-fr')).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId('first-run-language-more'));
    // ...but hiding a translation the user installed themselves would be a
    // regression, so it must still be there.
    expect(screen.getByTestId('first-run-language-fr')).toBeInTheDocument();
    expect(screen.getByTestId('first-run-language-de')).toBeInTheDocument();
  });

  it('marks draft translations so we never imply a review that did not happen', async () => {
    render(<LanguageFirstRun />);
    await screen.findByTestId('first-run-language-dialog');
    await userEvent.click(screen.getByTestId('first-run-language-more'));

    expect(screen.getByTestId('first-run-language-fr')).toHaveTextContent('draft translation');
    expect(screen.getByTestId('first-run-language-de')).not.toHaveTextContent('draft translation');
    expect(screen.getByTestId('first-run-language-en')).not.toHaveTextContent('draft translation');
  });

  it('switches locale and records the answer on continue', async () => {
    render(<LanguageFirstRun />);
    await screen.findByTestId('first-run-language-dialog');

    await userEvent.click(screen.getByTestId('first-run-language-more'));
    await userEvent.click(screen.getByTestId('first-run-language-fr'));
    await userEvent.click(screen.getByTestId('first-run-language-continue'));

    await waitFor(() => expect(h.setLocale).toHaveBeenCalledWith('fr'));
    expect(useOnboardingStore.getState().languageChosen).toBe(true);
    expect(window.localStorage.getItem(LANGUAGE_CHOSEN_STORAGE_KEY)).toBe('true');
  });

  it('does not call setLocale when the highlighted language is already active', async () => {
    render(<LanguageFirstRun />);
    await screen.findByTestId('first-run-language-dialog');
    await userEvent.click(screen.getByTestId('first-run-language-continue'));
    await waitFor(() => expect(useOnboardingStore.getState().languageChosen).toBe(true));
    expect(h.setLocale).not.toHaveBeenCalled();
  });

  it('still records the answer when switching locale throws', async () => {
    // A failed switch must not trap the user inside the dialog.
    h.setLocale.mockRejectedValueOnce(new Error('catalog missing'));
    render(<LanguageFirstRun />);
    await screen.findByTestId('first-run-language-dialog');
    await userEvent.click(screen.getByTestId('first-run-language-more'));
    await userEvent.click(screen.getByTestId('first-run-language-de'));
    await userEvent.click(screen.getByTestId('first-run-language-continue'));
    await waitFor(() => expect(useOnboardingStore.getState().languageChosen).toBe(true));
  });

  describe('when English is the only language on offer', () => {
    beforeEach(() => {
      // No user-supplied catalogs: the shipped set collapses to `en` alone.
      h.locales = [...BUILT_IN];
    });

    it('skips the dead one-item question and opens on the content step', async () => {
      render(<LanguageFirstRun />);
      await screen.findByTestId('first-run-language-dialog');

      // No radio group at all - not a group with a single, unanswerable row.
      expect(screen.queryByTestId('first-run-language-en')).not.toBeInTheDocument();
      expect(screen.queryByTestId('first-run-language-continue')).not.toBeInTheDocument();
      expect(await screen.findByTestId('first-run-packs-empty')).toBeInTheDocument();
    });

    it('still commits the answer and asks for that language’s content', async () => {
      render(<LanguageFirstRun />);
      await screen.findByTestId('first-run-packs-empty');

      await waitFor(() => expect(useOnboardingStore.getState().languageChosen).toBe(true));
      expect(getStarterPacks).toHaveBeenCalledWith('en');
      // Already the active locale; there is nothing to switch to.
      expect(h.setLocale).not.toHaveBeenCalled();
    });
  });

  describe('the content step', () => {
    it('shows the honest empty state when the language has no packs', async () => {
      // The expected case for most languages: no translation confirmed to be
      // public domain.
      render(<LanguageFirstRun />);
      await screen.findByTestId('first-run-language-dialog');
      await userEvent.click(screen.getByTestId('first-run-language-continue'));
      expect(await screen.findByTestId('first-run-packs-empty')).toBeInTheDocument();
    });

    it('lists the packs offered for the chosen language', async () => {
      getStarterPacks.mockResolvedValue({
        ok: true,
        value: [
          {
            pack_id: 'starter-fr',
            languages: ['fr'],
            name: 'French Starter',
            description: 'Louis Segond 1910.',
            version: '1.0.0',
            module_ids: ['ls1910', 'strongsgreek'],
            source: { catalogId: 1, catalogName: 'Official', verifiedOfficial: true },
          },
        ],
      });
      render(<LanguageFirstRun />);
      await screen.findByTestId('first-run-language-dialog');
      await userEvent.click(screen.getByTestId('first-run-language-more'));
      await userEvent.click(screen.getByTestId('first-run-language-fr'));
      await userEvent.click(screen.getByTestId('first-run-language-continue'));

      expect(await screen.findByTestId('first-run-pack-starter-fr')).toHaveTextContent('French Starter');
      expect(getStarterPacks).toHaveBeenCalledWith('fr');
    });

    it('falls back to the empty state when the pack lookup fails', async () => {
      // Offline, no catalog configured, IPC unavailable - all the same to the
      // user, and none of them is an error worth showing.
      getStarterPacks.mockRejectedValue(new Error('offline'));
      render(<LanguageFirstRun />);
      await screen.findByTestId('first-run-language-dialog');
      await userEvent.click(screen.getByTestId('first-run-language-continue'));
      expect(await screen.findByTestId('first-run-packs-empty')).toBeInTheDocument();
    });

    it('falls back to the empty state when there is no IPC bridge at all', async () => {
      (window as unknown as { electron?: unknown }).electron = undefined;
      render(<LanguageFirstRun />);
      await screen.findByTestId('first-run-language-dialog');
      await userEvent.click(screen.getByTestId('first-run-language-continue'));
      expect(await screen.findByTestId('first-run-packs-empty')).toBeInTheDocument();
    });

    it('records the answer once the flow is closed', async () => {
      render(<LanguageFirstRun />);
      await screen.findByTestId('first-run-language-dialog');
      await userEvent.click(screen.getByTestId('first-run-language-continue'));
      await screen.findByTestId('first-run-packs-empty');
      await userEvent.click(screen.getByTestId('first-run-language-done'));
      await waitFor(() =>
        expect(screen.queryByTestId('first-run-language-dialog')).not.toBeInTheDocument()
      );
    });
  });

  describe('the network step', () => {
    const getAllowWebRequests = vi.fn();
    const setAllowWebRequests = vi.fn();
    const refreshAllCatalogs = vi.fn();

    beforeEach(() => {
      getAllowWebRequests.mockReset().mockResolvedValue({ ok: true, value: false });
      setAllowWebRequests.mockReset();
      refreshAllCatalogs.mockReset().mockResolvedValue({ ok: true, value: [] });
      (window as unknown as { electron?: unknown }).electron = {
        moduleManager: { getStarterPacks, refreshAllCatalogs },
        network: { getAllowWebRequests, setAllowWebRequests },
      };
    });

    /** Render, answer the language question, and wait for the store's `load()`
     * (fired on mount) to resolve before the language step's Continue click -
     * otherwise the decision reads an unresolved store and (correctly, per its
     * own fail-safe) skips straight to content. */
    async function continueToNetworkStep() {
      render(<LanguageFirstRun />);
      await screen.findByTestId('first-run-language-dialog');
      await waitFor(() => expect(useNetworkStore.getState().loaded).toBe(true));
      await userEvent.click(screen.getByTestId('first-run-language-continue'));
      await screen.findByTestId('first-run-network-body');
    }

    it('is shown when the network is confirmed off', async () => {
      await continueToNetworkStep();
      expect(screen.getByTestId('first-run-network-body')).toBeInTheDocument();
    });

    it('is skipped when the network is already on', async () => {
      getAllowWebRequests.mockResolvedValue({ ok: true, value: true });
      render(<LanguageFirstRun />);
      await screen.findByTestId('first-run-language-dialog');
      await waitFor(() => expect(useNetworkStore.getState().loaded).toBe(true));
      await userEvent.click(screen.getByTestId('first-run-language-continue'));
      expect(await screen.findByTestId('first-run-packs-empty')).toBeInTheDocument();
      expect(screen.queryByTestId('first-run-network-body')).not.toBeInTheDocument();
    });

    it('going online with a confirmed dialog refreshes the catalog, then shows content', async () => {
      setAllowWebRequests.mockResolvedValue({ ok: true, value: true });
      await continueToNetworkStep();

      await userEvent.click(screen.getByTestId('first-run-network-go-online'));

      expect(setAllowWebRequests).toHaveBeenCalledWith(true);
      await waitFor(() => expect(refreshAllCatalogs).toHaveBeenCalled());
      expect(await screen.findByTestId('first-run-packs-empty')).toBeInTheDocument();
    });

    it('a cancelled confirmation dialog leaves the step exactly as it was', async () => {
      setAllowWebRequests.mockResolvedValue({ ok: true, value: false });
      await continueToNetworkStep();

      await userEvent.click(screen.getByTestId('first-run-network-go-online'));

      expect(setAllowWebRequests).toHaveBeenCalledWith(true);
      expect(refreshAllCatalogs).not.toHaveBeenCalled();
      expect(screen.getByTestId('first-run-network-body')).toBeInTheDocument();
    });

    it('"Stay offline" shows the offline content variant with both actions', async () => {
      await continueToNetworkStep();

      await userEvent.click(screen.getByTestId('first-run-network-stay-offline'));

      expect(await screen.findByTestId('first-run-packs-offline-body')).toBeInTheDocument();
      expect(screen.getByTestId('first-run-packs-go-online')).toBeInTheDocument();
      expect(screen.getByTestId('first-run-install-from-file')).toBeInTheDocument();
      expect(setAllowWebRequests).not.toHaveBeenCalled();
    });

    it('"Install from a file…" reuses the Module Manager\'s own install-from-file dialog', async () => {
      const installFromFile = vi.fn().mockResolvedValue({ ok: true, value: { kind: 'single', moduleName: 'KJV' } });
      (window as unknown as { electron: { moduleManager: Record<string, unknown> } }).electron.moduleManager.installFromFile = installFromFile;

      await continueToNetworkStep();
      await userEvent.click(screen.getByTestId('first-run-network-stay-offline'));
      await screen.findByTestId('first-run-packs-offline-body');

      await userEvent.click(screen.getByTestId('first-run-install-from-file'));

      expect(installFromFile).toHaveBeenCalled();
      expect(await screen.findByTestId('first-run-install-from-file-result')).toHaveTextContent('KJV');
    });
  });

  describe('installing a starter pack', () => {
    const getStarterPackModules = vi.fn();
    const installModule = vi.fn();
    const loadInstalledModules = vi.fn();

    const PACK = {
      pack_id: 'starter-fr',
      languages: ['fr'],
      name: 'French Starter',
      description: 'Louis Segond 1910.',
      version: '1.0.0',
      module_ids: ['ls1910', 'strongsgreek'],
      source: { catalogId: 1, catalogName: 'Official', verifiedOfficial: true },
    };
    const MODULES = [
      { module_id: 'ls1910', name: 'Louis Segond 1910', license: 'Public Domain', download_size_bytes: 5_000_000 },
      { module_id: 'strongsgreek', name: "Strong's Greek", license: 'Public Domain', download_size_bytes: 1_000_000 },
    ];

    beforeEach(async () => {
      getStarterPacks.mockResolvedValue({ ok: true, value: [PACK] });
      getStarterPackModules.mockReset().mockResolvedValue({ ok: true, value: { pack: PACK, modules: MODULES } });
      installModule.mockReset().mockResolvedValue(true);
      loadInstalledModules.mockReset().mockResolvedValue(undefined);
      useModuleStore.setState({ installModule, loadInstalledModules });
      (window as unknown as { electron?: unknown }).electron = {
        moduleManager: { getStarterPacks, getStarterPackModules },
      };
    });

    async function openPackList() {
      render(<LanguageFirstRun />);
      await screen.findByTestId('first-run-language-dialog');
      await userEvent.click(screen.getByTestId('first-run-language-more'));
      await userEvent.click(screen.getByTestId('first-run-language-fr'));
      await userEvent.click(screen.getByTestId('first-run-language-continue'));
      await screen.findByTestId('first-run-pack-starter-fr');
    }

    it('shows the verified badge, since every offered pack comes from the verified official catalog', async () => {
      await openPackList();
      expect(screen.getByTestId('first-run-pack-verified-starter-fr')).toHaveTextContent(
        'Verified: signed by Keep Thy Heart'
      );
    });

    it('shows every module’s licence and size before the Install click', async () => {
      await openPackList();

      const row = await screen.findByTestId('first-run-pack-module-ls1910');
      expect(row).toHaveTextContent('Louis Segond 1910');
      expect(row).toHaveTextContent('Public Domain');
      expect(installModule).not.toHaveBeenCalled();
    });

    it('the Install button installs every module in the pack', async () => {
      await openPackList();
      await screen.findByTestId('first-run-pack-module-ls1910');

      await userEvent.click(screen.getByTestId('first-run-pack-install-starter-fr'));

      await waitFor(() => expect(installModule).toHaveBeenCalledTimes(2));
      // Scoped to the pack's own catalog id, not resolved across every
      // enabled catalog - see `ModuleCatalogService.getModuleInfo`'s doc.
      expect(installModule).toHaveBeenNthCalledWith(1, 'ls1910', 1);
      expect(installModule).toHaveBeenNthCalledWith(2, 'strongsgreek', 1);
      expect(await screen.findByTestId('first-run-pack-installed-starter-fr')).toBeInTheDocument();
      expect(loadInstalledModules).toHaveBeenCalled();
    });

    it('lists a partial failure and points at the Module Manager', async () => {
      installModule.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      await openPackList();
      await screen.findByTestId('first-run-pack-module-ls1910');

      await userEvent.click(screen.getByTestId('first-run-pack-install-starter-fr'));

      const failed = await screen.findByTestId('first-run-pack-failed-starter-fr');
      expect(failed).toHaveTextContent("Strong's Greek");
      expect(failed).not.toHaveTextContent('Louis Segond 1910');
    });
  });
});
