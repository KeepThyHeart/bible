import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchSection } from './SearchSection';

let status: unknown = null;
const setSource = vi.fn();
const refresh = vi.fn();
const openModuleManager = vi.fn();

vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({
    t: (k: string, p?: Record<string, string>) => (p?.date !== undefined ? `${k}|${p.date}` : k),
    localizer: { formatDate: () => 'Oct 1, 2026' },
  }),
}));
vi.mock('../../stores/useSearchStore', () => ({
  useSearchStore: (sel: (s: unknown) => unknown) =>
    sel({ remoteSemanticStatus: status, refreshRemoteSemanticStatus: refresh, setSemanticSource: setSource }),
}));
vi.mock('../../utils/openModuleManager', () => ({ openModuleManager: (...a: unknown[]) => openModuleManager(...a) }));

const st = (extra = {}) => ({
  configured: true, consent: 'unset', noticeVersion: 1, source: 'online', localPackInstalled: false, ...extra,
});

beforeEach(() => {
  setSource.mockReset();
  refresh.mockReset();
  openModuleManager.mockReset();
});

describe('SearchSection', () => {
  it('offers online, on this computer and off; online is the default', () => {
    status = st();
    render(<SearchSection />);
    expect(screen.getByTestId('semantic-source-online')).toBeChecked();
    expect(screen.getByTestId('semantic-source-offline')).not.toBeChecked();
    expect(screen.getByTestId('semantic-source-off')).not.toBeChecked();
    expect(screen.getByTestId('remote-semantic-status')).toHaveTextContent('remoteSemanticUnset');
  });

  it('online with consent shows the date', () => {
    status = st({ consent: 'granted', consentedAt: '2026-10-01T10:00:00Z' });
    render(<SearchSection />);
    expect(screen.getByTestId('remote-semantic-status')).toHaveTextContent('remoteSemanticGranted|Oct 1, 2026');
  });

  it('a build without a service has no online option, and offline is selected', () => {
    status = st({ configured: false, source: 'offline' });
    render(<SearchSection />);
    expect(screen.queryByTestId('semantic-source-online')).toBeNull();
    expect(screen.getByTestId('semantic-source-offline')).toBeChecked();
  });

  it('choosing a source records it', async () => {
    status = st();
    render(<SearchSection />);
    await userEvent.click(screen.getByTestId('semantic-source-off'));
    expect(setSource).toHaveBeenCalledWith('off');
    await userEvent.click(screen.getByTestId('semantic-source-offline'));
    expect(setSource).toHaveBeenCalledWith('offline');
  });

  it('the offline option is offered without the pack, with a link to get it', async () => {
    status = st({ localPackInstalled: false });
    render(<SearchSection />);
    expect(screen.getByTestId('semantic-source-offline')).toBeEnabled();
    expect(screen.getByTestId('semantic-pack-missing')).toHaveTextContent('semanticOfflineMissing');
    await userEvent.click(screen.getByTestId('semantic-pack-install'));
    expect(openModuleManager).toHaveBeenCalledWith('features');
    // The link does not also change the choice.
    expect(setSource).not.toHaveBeenCalled();
  });

  it('no install hint once the pack is installed', () => {
    status = st({ localPackInstalled: true, source: 'offline' });
    render(<SearchSection />);
    expect(screen.queryByTestId('semantic-pack-missing')).toBeNull();
    expect(screen.queryByTestId('remote-semantic-status')).toBeNull();
  });
});
