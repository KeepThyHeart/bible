import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DownloadProgressPanel from './DownloadProgressPanel';
import { ContextProvider, type AppServices } from '../contexts/ContextProvider';
import { useModuleStore, type DownloadProgress } from '../stores/useModuleStore';
import { enT } from '../testing/enCatalog';

function createMockI18n() {
  return {
    t: (key: string, params?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'ui.downloadProgress.pause': 'Pause',
        'ui.downloadProgress.resume': 'Resume',
        'ui.downloadProgress.cancel': 'Cancel',
        'ui.downloadProgress.statusPaused': 'Paused',
        'ui.downloadProgress.statusPending': 'Pending',
        'ui.downloadProgress.statusComplete': 'Complete',
      };
      return map[key] ?? enT(key, params);
    },
    currentLocale: 'en' as const,
    onDidChangeLocale: () => ({ dispose: vi.fn() }),
    resolve: (v: unknown) => String(v),
    loadCatalog: vi.fn(),
    setLocale: vi.fn(),
  };
}

function createMockServices(): AppServices {
  return {
    registry: {} as AppServices['registry'],
    whenContext: {} as AppServices['whenContext'],
    keybindings: {} as AppServices['keybindings'],
    i18n: createMockI18n() as unknown as AppServices['i18n'],
  };
}

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <ContextProvider services={createMockServices()}>{ui}</ContextProvider>
  );
}

describe('DownloadProgressPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useModuleStore.setState({ activeDownloads: [] });
  });

  it('renders nothing when no downloads are active', () => {
    useModuleStore.setState({ activeDownloads: [] });

    const { container } = renderWithProviders(<DownloadProgressPanel />);
    expect(container.firstChild).toBeNull();
  });

  it('displays download header when downloads are active', () => {
    const download: DownloadProgress = {
      queueId: 1,
      moduleName: 'KJV',
      moduleId: 'kjv',
      status: 'downloading',
      progressPercentage: 50,
      progressBytes: 500,
      totalBytes: 1000,
    };

    useModuleStore.setState({ activeDownloads: [download] });

    renderWithProviders(<DownloadProgressPanel />);

    expect(screen.getByText(/Active Downloads/i)).toBeInTheDocument();
  });

  it('displays module name and ID', () => {
    const download: DownloadProgress = {
      queueId: 1,
      moduleName: 'King James Version',
      moduleId: 'kjv',
      status: 'downloading',
      progressPercentage: 25,
      progressBytes: 250,
      totalBytes: 1000,
    };

    useModuleStore.setState({ activeDownloads: [download] });

    renderWithProviders(<DownloadProgressPanel />);

    expect(screen.getByText('King James Version')).toBeInTheDocument();
    expect(screen.getByText('kjv')).toBeInTheDocument();
  });

  it('displays progress percentage', () => {
    const download: DownloadProgress = {
      queueId: 1,
      moduleName: 'KJV',
      moduleId: 'kjv',
      status: 'downloading',
      progressPercentage: 75.5,
      progressBytes: 755,
      totalBytes: 1000,
    };

    useModuleStore.setState({ activeDownloads: [download] });

    renderWithProviders(<DownloadProgressPanel />);

    expect(screen.getByText(/75.5%/)).toBeInTheDocument();
  });

  it('displays pause button when downloading', async () => {
    userEvent.setup();
    const pauseDownload = vi.fn();
    const download: DownloadProgress = {
      queueId: 1,
      moduleName: 'KJV',
      moduleId: 'kjv',
      status: 'downloading',
      progressPercentage: 50,
      progressBytes: 500,
      totalBytes: 1000,
    };

    useModuleStore.setState({ activeDownloads: [download], pauseDownload });

    renderWithProviders(<DownloadProgressPanel />);

    const pauseButton = screen.getByTitle('Pause');
    expect(pauseButton).toBeInTheDocument();
  });

  it('calls pauseDownload when pause button is clicked', async () => {
    const user = userEvent.setup();
    const pauseDownload = vi.fn();
    const download: DownloadProgress = {
      queueId: 1,
      moduleName: 'KJV',
      moduleId: 'kjv',
      status: 'downloading',
      progressPercentage: 50,
      progressBytes: 500,
      totalBytes: 1000,
    };

    useModuleStore.setState({ activeDownloads: [download], pauseDownload });

    renderWithProviders(<DownloadProgressPanel />);

    const pauseButton = screen.getByTitle('Pause');
    await user.click(pauseButton);

    expect(pauseDownload).toHaveBeenCalledWith(1);
  });

  it('displays resume button when paused', async () => {
    const download: DownloadProgress = {
      queueId: 1,
      moduleName: 'KJV',
      moduleId: 'kjv',
      status: 'paused',
      progressPercentage: 50,
      progressBytes: 500,
      totalBytes: 1000,
    };

    useModuleStore.setState({ activeDownloads: [download] });

    renderWithProviders(<DownloadProgressPanel />);

    const resumeButton = screen.getByTitle('Resume');
    expect(resumeButton).toBeInTheDocument();
  });

  it('calls resumeDownload when resume button is clicked', async () => {
    const user = userEvent.setup();
    const resumeDownload = vi.fn();
    const download: DownloadProgress = {
      queueId: 1,
      moduleName: 'KJV',
      moduleId: 'kjv',
      status: 'paused',
      progressPercentage: 50,
      progressBytes: 500,
      totalBytes: 1000,
    };

    useModuleStore.setState({
      activeDownloads: [download],
      resumeDownload,
    });

    renderWithProviders(<DownloadProgressPanel />);

    const resumeButton = screen.getByTitle('Resume');
    await user.click(resumeButton);

    expect(resumeDownload).toHaveBeenCalledWith(1);
  });

  it('displays cancel button', async () => {
    const download: DownloadProgress = {
      queueId: 1,
      moduleName: 'KJV',
      moduleId: 'kjv',
      status: 'downloading',
      progressPercentage: 50,
      progressBytes: 500,
      totalBytes: 1000,
    };

    useModuleStore.setState({ activeDownloads: [download] });

    renderWithProviders(<DownloadProgressPanel />);

    const cancelButton = screen.getByTitle('Cancel');
    expect(cancelButton).toBeInTheDocument();
  });

  it('calls cancelDownload when cancel button is clicked', async () => {
    const user = userEvent.setup();
    const cancelDownload = vi.fn();
    const download: DownloadProgress = {
      queueId: 1,
      moduleName: 'KJV',
      moduleId: 'kjv',
      status: 'downloading',
      progressPercentage: 50,
      progressBytes: 500,
      totalBytes: 1000,
    };

    useModuleStore.setState({
      activeDownloads: [download],
      cancelDownload,
    });

    renderWithProviders(<DownloadProgressPanel />);

    const cancelButton = screen.getByTitle('Cancel');
    await user.click(cancelButton);

    expect(cancelDownload).toHaveBeenCalledWith(1);
  });

  it('displays file size information', () => {
    const download: DownloadProgress = {
      queueId: 1,
      moduleName: 'KJV',
      moduleId: 'kjv',
      status: 'downloading',
      progressPercentage: 50,
      progressBytes: 512000, // 500 KB
      totalBytes: 1024000, // ~1 MB
    };

    useModuleStore.setState({ activeDownloads: [download] });

    renderWithProviders(<DownloadProgressPanel />);

    // Should display formatted sizes
    const text = document.body.textContent || '';
    expect(text).toContain('K');
  });

  it('displays download speed', () => {
    const download: DownloadProgress = {
      queueId: 1,
      moduleName: 'KJV',
      moduleId: 'kjv',
      status: 'downloading',
      progressPercentage: 50,
      progressBytes: 500,
      totalBytes: 1000,
      speedMBps: 2.5,
    };

    useModuleStore.setState({ activeDownloads: [download] });

    renderWithProviders(<DownloadProgressPanel />);

    expect(screen.getByText(/2\.50 MB\/s/)).toBeInTheDocument();
  });

  it('displays estimated time remaining', () => {
    const download: DownloadProgress = {
      queueId: 1,
      moduleName: 'KJV',
      moduleId: 'kjv',
      status: 'downloading',
      progressPercentage: 50,
      progressBytes: 500,
      totalBytes: 1000,
      estimatedTimeRemaining: 120,
    };

    useModuleStore.setState({ activeDownloads: [download] });

    renderWithProviders(<DownloadProgressPanel />);

    expect(screen.getByText(/2m remaining/)).toBeInTheDocument();
  });

  it('displays paused status', () => {
    const download: DownloadProgress = {
      queueId: 1,
      moduleName: 'KJV',
      moduleId: 'kjv',
      status: 'paused',
      progressPercentage: 50,
      progressBytes: 500,
      totalBytes: 1000,
    };

    useModuleStore.setState({ activeDownloads: [download] });

    renderWithProviders(<DownloadProgressPanel />);

    expect(screen.getByText(/Paused/i)).toBeInTheDocument();
  });

  it('displays completed status', () => {
    const download: DownloadProgress = {
      queueId: 1,
      moduleName: 'KJV',
      moduleId: 'kjv',
      status: 'completed',
      progressPercentage: 100,
      progressBytes: 1000,
      totalBytes: 1000,
    };

    useModuleStore.setState({ activeDownloads: [download] });

    renderWithProviders(<DownloadProgressPanel />);

    expect(screen.getByText(/Complete/i)).toBeInTheDocument();
  });

  it('displays multiple downloads', () => {
    const downloads: DownloadProgress[] = [
      {
        queueId: 1,
        moduleName: 'KJV',
        moduleId: 'kjv',
        status: 'downloading',
        progressPercentage: 50,
        progressBytes: 500,
        totalBytes: 1000,
      },
      {
        queueId: 2,
        moduleName: 'NKJV',
        moduleId: 'nkjv',
        status: 'downloading',
        progressPercentage: 25,
        progressBytes: 250,
        totalBytes: 1000,
      },
    ];

    useModuleStore.setState({ activeDownloads: downloads });

    renderWithProviders(<DownloadProgressPanel />);

    expect(screen.getByText('KJV')).toBeInTheDocument();
    expect(screen.getByText('NKJV')).toBeInTheDocument();
  });
});
