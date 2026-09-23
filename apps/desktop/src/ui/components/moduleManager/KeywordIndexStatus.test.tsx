import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KeywordIndexStatus } from './KeywordIndexStatus';
import { moduleAPI, type KeywordIndexStatusDto } from '../../stores/module/moduleAPI';
import { ContextProvider, type AppServices } from '../../contexts/ContextProvider';
import { enT } from '../../testing/enCatalog';

vi.mock('../../stores/module/moduleAPI', () => ({
  moduleAPI: {
    getKeywordIndexStatus: vi.fn(),
    rebuildKeywordIndex: vi.fn(),
    deleteKeywordIndex: vi.fn(),
  },
}));

const getKeywordIndexStatus = vi.mocked(moduleAPI.getKeywordIndexStatus);
const rebuildKeywordIndex = vi.mocked(moduleAPI.rebuildKeywordIndex);
const deleteKeywordIndex = vi.mocked(moduleAPI.deleteKeywordIndex);

function createMockServices(): AppServices {
  return {
    registry: {} as AppServices['registry'],
    whenContext: {} as AppServices['whenContext'],
    keybindings: {} as AppServices['keybindings'],
    i18n: {
      t: (key: string, params?: Record<string, unknown>) => enT(key, params),
      currentLocale: 'en' as const,
      onDidChangeLocale: () => ({ dispose: vi.fn() }),
      resolve: (v: unknown) => String(v),
      loadCatalog: vi.fn(),
      setLocale: vi.fn(),
    } as unknown as AppServices['i18n'],
  };
}

const services = createMockServices();

function statusFor(state: KeywordIndexStatusDto['state'], extra: Partial<KeywordIndexStatusDto> = {}): KeywordIndexStatusDto {
  return { moduleUuid: 'esv-uuid', providerId: 'sidecar-fts5', state, ...extra };
}

// No default for `moduleId`: a JS default parameter also fires for an
// explicitly-passed `undefined`, which would silently defeat the
// "not installed" test below (it passes `undefined` on purpose).
function renderStatus(moduleId: number | undefined, moduleName = 'English Standard Version') {
  return render(
    <ContextProvider services={services}>
      <KeywordIndexStatus moduleId={moduleId} moduleName={moduleName} />
    </ContextProvider>
  );
}

describe('KeywordIndexStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when the module is not installed', () => {
    const { container } = renderStatus(undefined);
    expect(container).toBeEmptyDOMElement();
    expect(getKeywordIndexStatus).not.toHaveBeenCalled();
  });

  it('fetches status for the given module id on mount', () => {
    getKeywordIndexStatus.mockReturnValue(new Promise(() => {}));
    renderStatus(7);
    expect(getKeywordIndexStatus).toHaveBeenCalledWith(7);
  });

  it('shows a loading indicator while the initial fetch is pending', () => {
    getKeywordIndexStatus.mockReturnValue(new Promise(() => {}));
    renderStatus(7);
    expect(screen.getByTestId('keyword-index-loading')).toBeInTheDocument();
  });

  it('shows a fetch error distinct from a failed build status', async () => {
    getKeywordIndexStatus.mockRejectedValue(new Error('IPC unavailable'));
    renderStatus(7);
    const alert = await screen.findByTestId('keyword-index-fetch-error');
    expect(alert).toHaveTextContent('IPC unavailable');
    expect(screen.queryByTestId('keyword-index-badge')).not.toBeInTheDocument();
  });

  describe.each<[KeywordIndexStatusDto['state'], boolean, boolean]>([
    ['unavailable', false, false],
    ['unbuilt', true, false],
    ['building', false, false],
    ['ready', false, true],
    ['stale', true, true],
    ['failed', true, false],
  ])('state "%s"', (state, expectRebuild, expectDelete) => {
    it(`shows Rebuild=${expectRebuild} and Delete=${expectDelete}`, async () => {
      getKeywordIndexStatus.mockResolvedValue(statusFor(state));
      renderStatus(7);

      await waitFor(() => {
        if (state === 'building') {
          expect(screen.getByTestId('keyword-index-busy')).toBeInTheDocument();
        } else {
          expect(screen.getByTestId('keyword-index-badge')).toHaveAttribute('data-state', state);
        }
      });

      if (expectRebuild) {
        expect(screen.getByTestId('keyword-index-rebuild')).toBeInTheDocument();
      } else {
        expect(screen.queryByTestId('keyword-index-rebuild')).not.toBeInTheDocument();
      }

      if (expectDelete) {
        expect(screen.getByTestId('keyword-index-delete')).toBeInTheDocument();
      } else {
        expect(screen.queryByTestId('keyword-index-delete')).not.toBeInTheDocument();
      }
    });
  });

  describe('rebuild', () => {
    it('shows an indeterminate spinner while rebuilding, then the resolved status', async () => {
      getKeywordIndexStatus.mockResolvedValue(statusFor('unbuilt'));
      let resolveRebuild!: (status: KeywordIndexStatusDto) => void;
      rebuildKeywordIndex.mockReturnValue(new Promise((r) => (resolveRebuild = r)));
      renderStatus(7);

      const btn = await screen.findByTestId('keyword-index-rebuild');
      await userEvent.click(btn);

      expect(rebuildKeywordIndex).toHaveBeenCalledWith(7);
      expect(screen.getByTestId('keyword-index-busy')).toBeInTheDocument();
      expect(screen.queryByTestId('keyword-index-rebuild')).not.toBeInTheDocument();

      resolveRebuild(statusFor('ready'));
      await waitFor(() =>
        expect(screen.getByTestId('keyword-index-badge')).toHaveAttribute('data-state', 'ready')
      );
      // ready -> Delete only, no Rebuild.
      expect(screen.queryByTestId('keyword-index-rebuild')).not.toBeInTheDocument();
      expect(screen.getByTestId('keyword-index-delete')).toBeInTheDocument();
    });

    it('updates the badge to a failure state when the rebuild resolves as failed', async () => {
      getKeywordIndexStatus.mockResolvedValue(statusFor('unbuilt'));
      rebuildKeywordIndex.mockResolvedValue(statusFor('failed', { error: 'disk full' }));
      renderStatus(7);

      await userEvent.click(await screen.findByTestId('keyword-index-rebuild'));

      await waitFor(() =>
        expect(screen.getByTestId('keyword-index-badge')).toHaveAttribute('data-state', 'failed')
      );
      expect(screen.getByTestId('keyword-index-rebuild')).toBeInTheDocument();
    });

    it('shows an IPC-failure error distinct from the badge when the call itself rejects', async () => {
      getKeywordIndexStatus.mockResolvedValue(statusFor('unbuilt'));
      rebuildKeywordIndex.mockRejectedValue(new Error('main process crashed'));
      renderStatus(7);

      await userEvent.click(await screen.findByTestId('keyword-index-rebuild'));

      const alert = await screen.findByTestId('keyword-index-action-error');
      expect(alert).toHaveTextContent('main process crashed');
      // The badge keeps the last known (non-throwing) status - it must not
      // silently become "failed" just because the call rejected.
      expect(screen.getByTestId('keyword-index-badge')).toHaveAttribute('data-state', 'unbuilt');
    });
  });

  describe('delete', () => {
    it('asks for confirmation before calling delete', async () => {
      getKeywordIndexStatus.mockResolvedValue(statusFor('ready'));
      renderStatus(7);

      await userEvent.click(await screen.findByTestId('keyword-index-delete'));
      expect(deleteKeywordIndex).not.toHaveBeenCalled();
      expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();

      await userEvent.click(screen.getByTestId('confirm-dialog-confirm'));
      expect(deleteKeywordIndex).toHaveBeenCalledWith(7);
    });

    it('does not delete when the confirmation is cancelled', async () => {
      getKeywordIndexStatus.mockResolvedValue(statusFor('ready'));
      renderStatus(7);

      await userEvent.click(await screen.findByTestId('keyword-index-delete'));
      await userEvent.click(screen.getByTestId('confirm-dialog-cancel'));

      expect(deleteKeywordIndex).not.toHaveBeenCalled();
      expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
    });

    it('updates the badge to unbuilt after a successful delete', async () => {
      getKeywordIndexStatus.mockResolvedValue(statusFor('ready'));
      deleteKeywordIndex.mockResolvedValue(statusFor('unbuilt'));
      renderStatus(7);

      await userEvent.click(await screen.findByTestId('keyword-index-delete'));
      await userEvent.click(screen.getByTestId('confirm-dialog-confirm'));

      await waitFor(() =>
        expect(screen.getByTestId('keyword-index-badge')).toHaveAttribute('data-state', 'unbuilt')
      );
    });

    it('shows a delete-failure error without disturbing the badge', async () => {
      getKeywordIndexStatus.mockResolvedValue(statusFor('ready'));
      deleteKeywordIndex.mockRejectedValue(new Error('permission denied'));
      renderStatus(7);

      await userEvent.click(await screen.findByTestId('keyword-index-delete'));
      await userEvent.click(screen.getByTestId('confirm-dialog-confirm'));

      const alert = await screen.findByTestId('keyword-index-action-error');
      expect(alert).toHaveTextContent('permission denied');
      expect(screen.getByTestId('keyword-index-badge')).toHaveAttribute('data-state', 'ready');
    });
  });

  describe('switching modules', () => {
    it('ignores a status that arrives after moduleId has changed', async () => {
      let resolveFirst!: (status: KeywordIndexStatusDto) => void;
      getKeywordIndexStatus.mockImplementation((id: number) => {
        if (id === 7) return new Promise((r) => (resolveFirst = r));
        return Promise.resolve(statusFor('ready'));
      });

      const { rerender } = render(
        <ContextProvider services={services}>
          <KeywordIndexStatus moduleId={7} moduleName="ESV" />
        </ContextProvider>
      );

      rerender(
        <ContextProvider services={services}>
          <KeywordIndexStatus moduleId={8} moduleName="NIV" />
        </ContextProvider>
      );

      await waitFor(() =>
        expect(screen.getByTestId('keyword-index-badge')).toHaveAttribute('data-state', 'ready')
      );

      resolveFirst(statusFor('failed'));
      // Give any stray microtask a turn; the stale result must not land.
      await new Promise((r) => setTimeout(r, 0));
      expect(screen.getByTestId('keyword-index-badge')).toHaveAttribute('data-state', 'ready');
    });
  });
});
