import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FeaturePackPanel, { formatBytes } from './FeaturePackPanel';
import { ContextProvider, type AppServices } from '../contexts/ContextProvider';
import { enT } from '../testing/enCatalog';

const listAvailable = vi.fn();
const getStatus = vi.fn();
const install = vi.fn();
const installFromFile = vi.fn();
const cancel = vi.fn();
const uninstall = vi.fn();

vi.mock('../services/electronAPI', () => ({
  featurePackAPI: {
    listAvailable: (...args: unknown[]) => listAvailable(...args),
    getStatus: (...args: unknown[]) => getStatus(...args),
    install: (...args: unknown[]) => install(...args),
    installFromFile: (...args: unknown[]) => installFromFile(...args),
    cancel: (...args: unknown[]) => cancel(...args),
    uninstall: (...args: unknown[]) => uninstall(...args),
  },
}));

const checkSemanticAvailability = vi.fn();
vi.mock('../stores/useSearchStore', () => ({
  useSearchStore: (selector: (s: unknown) => unknown) =>
    selector({ checkSemanticAvailability }),
}));

const LISTING = {
  pack_id: 'semantic-kjv',
  pack_type: 'semantic_search',
  name: 'Semantic Search (KJV)',
  version: '1.0.0',
  description: 'Meaning-based search over the KJV.',
  license: 'CC-BY-4.0',
  license_url: null,
  download_size_bytes: 120 * 1024 * 1024,
  installed_size_bytes: 420 * 1024 * 1024,
};

function idleStatus() {
  return { installed: false, manifest: null, progress: null };
}

function createMockServices(): AppServices {
  return {
    registry: {} as AppServices['registry'],
    whenContext: {} as AppServices['whenContext'],
    keybindings: {} as AppServices['keybindings'],
    i18n: {
      // Echoing the key is what makes `tf` take its fallback path, so the
      // assertions below read the English source text (with placeholders
      // filled) exactly as a user with no catalog entry would see it.
      t: (key: string, params?: Record<string, unknown>) => enT(key, params),
      currentLocale: 'en' as const,
      onDidChangeLocale: () => ({ dispose: vi.fn() }),
      resolve: (v: unknown) => String(v),
      loadCatalog: vi.fn(),
      setLocale: vi.fn(),
    } as unknown as AppServices['i18n'],
  };
}

function renderPanel() {
  return render(
    <ContextProvider services={createMockServices()}>
      <FeaturePackPanel />
    </ContextProvider>
  );
}

describe('formatBytes', () => {
  it('renders MB below a gigabyte and GB above', () => {
    expect(formatBytes(120 * 1024 * 1024)).toBe('120 MB');
    expect(formatBytes(2.5 * 1024 * 1024 * 1024)).toBe('2.5 GB');
  });

  it('handles zero and nonsense input without crashing', () => {
    expect(formatBytes(0)).toBe('0 MB');
    expect(formatBytes(Number.NaN)).toBe('0 MB');
  });
});

describe('FeaturePackPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listAvailable.mockResolvedValue([LISTING]);
    getStatus.mockResolvedValue(idleStatus());
    install.mockResolvedValue({ started: true });
    installFromFile.mockResolvedValue({ started: true, fileName: 'semantic-kjv.biblepack' });
    cancel.mockResolvedValue({ cancelled: true });
    uninstall.mockResolvedValue({ removed: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('lists an available pack with its download size and license', async () => {
    renderPanel();

    expect(await screen.findByText('Semantic Search (KJV)')).toBeInTheDocument();
    expect(screen.getByText(/Download: 120 MB/)).toBeInTheDocument();
    expect(screen.getByText(/On disk: 420 MB/)).toBeInTheDocument();
    expect(screen.getByText(/License: CC-BY-4.0/)).toBeInTheDocument();
    expect(screen.getByTestId('feature-pack-install')).toBeInTheDocument();
  });

  it('starts an install when the button is clicked', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByTestId('feature-pack-install'));

    expect(install).toHaveBeenCalledWith('semantic-kjv');
  });

  it('shows progress and a cancel button while an install is running', async () => {
    getStatus.mockResolvedValue({
      installed: false,
      manifest: null,
      progress: {
        packId: 'semantic-kjv',
        phase: 'downloading',
        percent: 42,
        bytesDownloaded: 50 * 1024 * 1024,
        totalBytes: 120 * 1024 * 1024,
        currentArtifact: 2,
        artifactCount: 7,
        speedBps: 3 * 1024 * 1024,
      },
    });

    renderPanel();

    const bar = await screen.findByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '42');
    expect(screen.getByText(/Downloading file 2 of 7/)).toBeInTheDocument();
    expect(screen.getByTestId('feature-pack-cancel')).toBeInTheDocument();
    expect(screen.queryByTestId('feature-pack-install')).not.toBeInTheDocument();
  });

  it('offers removal once the pack is installed', async () => {
    getStatus.mockResolvedValue({
      installed: true,
      manifest: {
        packId: 'semantic-kjv',
        name: LISTING.name,
        version: '1.0.0',
        license: 'CC-BY-4.0',
        installedAt: '2026-07-30T00:00:00.000Z',
        installedSizeBytes: 420 * 1024 * 1024,
      },
      progress: null,
    });

    const user = userEvent.setup();
    renderPanel();

    expect(await screen.findByTestId('feature-pack-installed-badge')).toBeInTheDocument();
    await user.click(screen.getByTestId('feature-pack-uninstall'));

    expect(uninstall).toHaveBeenCalled();
    // The search UI keys off `semanticAvailable`, so it has to be re-checked
    // or the toggle would linger after the index is gone.
    await waitFor(() => expect(checkSemanticAvailability).toHaveBeenCalled());
  });

  it('surfaces a failed install with the reason from the main process', async () => {
    getStatus.mockResolvedValue({
      installed: false,
      manifest: null,
      progress: {
        packId: 'semantic-kjv',
        phase: 'error',
        percent: 12,
        bytesDownloaded: 1,
        totalBytes: 100,
        currentArtifact: 1,
        artifactCount: 7,
        speedBps: 0,
        error: 'The downloaded file did not match the published checksum.',
      },
    });

    renderPanel();

    expect(await screen.findByTestId('feature-pack-install-error')).toHaveTextContent(
      /did not match the published checksum/
    );
  });

  it('explains an empty catalog rather than rendering nothing', async () => {
    listAvailable.mockResolvedValue([]);
    renderPanel();

    expect(await screen.findByTestId('feature-pack-empty')).toBeInTheDocument();
  });

  it('still offers removal for an installed pack no catalog lists any more', async () => {
    listAvailable.mockResolvedValue([]);
    getStatus.mockResolvedValue({
      installed: true,
      manifest: {
        packId: 'semantic-kjv',
        name: 'Semantic Search (KJV)',
        version: '1.0.0',
        license: 'CC-BY-4.0',
        installedAt: '2026-07-30T00:00:00.000Z',
        installedSizeBytes: 420 * 1024 * 1024,
      },
      progress: null,
    });

    renderPanel();

    // Otherwise disabling a repository would strand the pack on disk with no
    // way to remove it.
    expect(await screen.findByTestId('feature-pack-orphan')).toBeInTheDocument();
    expect(screen.getByTestId('feature-pack-uninstall-orphan')).toBeInTheDocument();
  });

  it('reports a listing failure instead of showing an empty panel', async () => {
    listAvailable.mockRejectedValue(new Error('catalog unreachable'));
    renderPanel();

    expect(await screen.findByTestId('feature-pack-error')).toHaveTextContent(/catalog unreachable/);
  });

  describe('sideloading', () => {
    // The offer has to stand on its own: with no repository configured there is
    // no card to hang it off, and that is exactly when it is needed most.
    it('offers a local install even when no catalog lists anything', async () => {
      listAvailable.mockResolvedValue([]);
      renderPanel();

      expect(await screen.findByTestId('feature-pack-sideload')).toBeInTheDocument();
      expect(screen.getByTestId('feature-pack-sideload-file')).toBeInTheDocument();
      expect(screen.getByTestId('feature-pack-sideload-folder')).toBeInTheDocument();
    });

    it('asks the main process for a file picker, then a folder picker', async () => {
      const user = userEvent.setup();
      renderPanel();

      await user.click(await screen.findByTestId('feature-pack-sideload-file'));
      expect(installFromFile).toHaveBeenCalledWith('file');

      await user.click(screen.getByTestId('feature-pack-sideload-folder'));
      expect(installFromFile).toHaveBeenCalledWith('folder');
    });

    // A sideloaded pack is normally in no catalog, so it has no card of its own
    // to show progress in.
    it('shows progress for an install no catalog lists', async () => {
      getStatus.mockResolvedValue({
        installed: false,
        manifest: null,
        progress: {
          packId: 'semantic-from-usb',
          phase: 'installing',
          percent: 60,
          bytesDownloaded: 60,
          totalBytes: 100,
          currentArtifact: 3,
          artifactCount: 7,
          speedBps: 0,
        },
      });

      renderPanel();

      expect(await screen.findByTestId('feature-pack-sideload-status')).toBeInTheDocument();
      expect(screen.getByText(/Installing file 3 of 7/)).toBeInTheDocument();
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '60');
    });

    // A package that fails before its manifest can be read has no pack id to be
    // attributed to, and the IPC call has already returned - this block is the
    // only place the failure can surface.
    it('surfaces a package that failed before it could be identified', async () => {
      getStatus.mockResolvedValue({
        installed: false,
        manifest: null,
        progress: {
          packId: '',
          phase: 'error',
          percent: 0,
          bytesDownloaded: 0,
          totalBytes: 0,
          currentArtifact: 0,
          artifactCount: 0,
          speedBps: 0,
          error: 'That folder is not a feature pack — it has no feature-pack.json.',
        },
      });

      renderPanel();

      expect(await screen.findByTestId('feature-pack-sideload-error')).toHaveTextContent(
        /not a feature pack/
      );
      expect(screen.getByText('Reading package…')).toBeInTheDocument();
    });
  });
});
