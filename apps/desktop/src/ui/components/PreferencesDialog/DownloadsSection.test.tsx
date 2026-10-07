import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DownloadsSection } from './DownloadsSection';

const mocks = vi.hoisted(() => ({
  list: vi.fn(), refresh: vi.fn(), install: vi.fn(), cancel: vi.fn(), remove: vi.fn(), getStatus: vi.fn(), uninstall: vi.fn(),
}));

vi.mock('../../services/electronAPI', () => ({
  assetsAPI: {
    list: () => mocks.list(),
    install: (id: string) => mocks.install(id),
    cancel: (id: string) => mocks.cancel(id),
    remove: (id: string) => mocks.remove(id),
    refresh: () => mocks.refresh(),
  },
  featurePackAPI: {
    getStatus: () => mocks.getStatus(),
    uninstall: () => mocks.uninstall(),
  },
}));

vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

const ok = <T,>(value: T) => Promise.resolve(value);

function entry(over: Record<string, unknown> = {}) {
  return {
    id: 'tts-voice:amy', kind: 'tts-voice', title: 'Amy', license: 'CC-BY-4.0', status: 'available',
    version: '1', size: 1000, storedBytes: 0, pinned: false, verified: true, ...over,
  };
}
const snap = (entries: unknown[], active = 0, storedBytes = 0) => ({ entries, active, storedBytes });

beforeEach(() => {
  mocks.list.mockReset().mockImplementation(() => ok(snap([entry()])));
  mocks.refresh.mockReset().mockImplementation(() => mocks.list());
  mocks.install.mockReset().mockImplementation(() => ok({ started: true }));
  mocks.remove.mockReset().mockImplementation(() => ok({ removed: true }));
  mocks.cancel.mockReset().mockImplementation(() => ok({ cancelled: true }));
  mocks.getStatus.mockReset().mockImplementation(() => ok({ installed: false, manifest: null, progress: null }));
  mocks.uninstall.mockReset().mockImplementation(() => ok(undefined));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('DownloadsSection', () => {
  it('re-reads the catalogs on open, so newly offered assets appear without a restart', async () => {
    mocks.refresh.mockImplementation(() => ok(snap([entry(), entry({ id: 'similar-neighbours', kind: 'data', title: 'Similar passages' })])));
    render(<DownloadsSection />);
    expect(await screen.findByText('Similar passages')).toBeInTheDocument();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('renders manager rows and installs by id', async () => {
    render(<DownloadsSection />);
    expect(await screen.findByText('Amy')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /downloads.download/ }));
    expect(mocks.install).toHaveBeenCalledWith('tts-voice:amy');
  });

  it('shows the entry error text when the code has no catalog entry', async () => {
    mocks.list.mockImplementation(() => ok(snap([entry({ status: 'error', error: { code: 'quota', message: 'raw' } })])));
    render(<DownloadsSection />);
    expect(await screen.findByText('raw')).toBeInTheDocument();
  });

  it('merges the semantic-pack adapter row and removes it through featurePacks', async () => {
    mocks.getStatus.mockImplementation(() =>
      ok({ installed: true, manifest: { name: 'Semantic Search', installedSizeBytes: 5000 }, progress: null }));
    render(<DownloadsSection />);
    expect(await screen.findByText('Semantic Search')).toBeInTheDocument();
    expect(screen.getByText('downloads.managedInModuleManager')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: 'downloads.remove: Semantic Search' });
    expect(buttons).toHaveLength(1);
    await userEvent.click(buttons[0]);
    expect(mocks.uninstall).toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('does not poll while idle', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<DownloadsSection />);
    await screen.findByText('Amy');
    const calls = mocks.list.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(mocks.list.mock.calls.length).toBe(calls);
  });

  it('polls every 500 ms while active and stops when done', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let n = 0;
    mocks.list.mockImplementation(() => {
      n++;
      return ok(n < 4
        ? snap([entry({ status: 'downloading', progress: { id: 'x', loaded: 10, total: 100 } })], 1)
        : snap([entry({ status: 'installed', storedBytes: 1000 })], 0, 1000));
    });
    render(<DownloadsSection />);
    await screen.findByText('Amy');
    await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
    await waitFor(() => expect(mocks.list.mock.calls.length).toBeGreaterThanOrEqual(4));
    const settled = mocks.list.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(mocks.list.mock.calls.length).toBe(settled);
  });
});
