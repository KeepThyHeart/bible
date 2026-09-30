import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AssetList, DEFAULT_ASSET_LIST_LABELS } from './AssetList';
import type { AssetListProps, AssetListRow } from './AssetList';

const row = (o: Partial<AssetListRow> & Pick<AssetListRow, 'id' | 'status'>): AssetListRow => ({
  title: `Asset ${o.id}`,
  sizeBytes: 2 * 1024 * 1024,
  storedBytes: 0,
  ...o,
});

function setup(rows: AssetListRow[], props: Partial<AssetListProps> = {}) {
  const fns = { onInstall: vi.fn(), onCancel: vi.fn(), onRemove: vi.fn() };
  render(<AssetList rows={rows} {...fns} {...props} />);
  return { ...fns, user: userEvent.setup() };
}

describe('AssetList', () => {
  it('renders a real list with title, detail and formatted size', () => {
    setup([row({ id: 'a', status: 'available', detail: 'Voice · CC-BY-4.0' })]);
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent('Asset a');
    expect(items[0]).toHaveTextContent('Voice · CC-BY-4.0');
    expect(items[0]).toHaveTextContent('2.0 MB');
  });

  it('shows Download for available, Update+Remove for update-available, Retry and the error for error', async () => {
    const { user, onInstall, onRemove } = setup([
      row({ id: 'a', status: 'available' }),
      row({ id: 'u', status: 'update-available', storedBytes: 100 }),
      row({ id: 'e', status: 'error', error: 'Checksum failed' }),
    ]);
    await user.click(screen.getByRole('button', { name: 'Download: Asset a' }));
    await user.click(screen.getByRole('button', { name: 'Update: Asset u' }));
    await user.click(screen.getByRole('button', { name: 'Remove: Asset u' }));
    await user.click(screen.getByRole('button', { name: 'Retry: Asset e' }));
    expect(onInstall.mock.calls.map((c) => c[0])).toEqual(['a', 'u', 'e']);
    expect(onRemove).toHaveBeenCalledWith('u');
    expect(screen.getByText('Checksum failed')).toBeInTheDocument();
  });

  it('installed rows show a status and Remove only', () => {
    setup([row({ id: 'i', status: 'installed', storedBytes: 5 })]);
    expect(screen.getByText('Installed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove: Asset i' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Download|Update|Retry/ })).toBeNull();
  });

  it('queued rows show Cancel and a queued status', async () => {
    const { user, onCancel } = setup([row({ id: 'q', status: 'queued' })]);
    expect(screen.getByText('Queued')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel: Asset q' }));
    expect(onCancel).toHaveBeenCalledWith('q');
  });

  it('downloading rows show percent, a labelled progress bar and Cancel', () => {
    setup([row({ id: 'd', status: 'downloading', progress: { loaded: 512, total: 2048 } })]);
    expect(screen.getByText('25%')).toBeInTheDocument();
    const bar = screen.getByLabelText('Asset d');
    expect(bar.tagName).toBe('PROGRESS');
    expect(bar).toHaveAttribute('value', '25');
    expect(screen.getByRole('button', { name: 'Cancel: Asset d' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
  });

  it('downloading with unknown total is indeterminate (no value)', () => {
    setup([row({ id: 'd', status: 'downloading', progress: { loaded: 10, total: 0 } })]);
    expect(screen.getByLabelText('Asset d')).not.toHaveAttribute('value');
  });

  it('canInstall and canRemove override the defaults', () => {
    setup([row({ id: 'a', status: 'available', canInstall: false, canRemove: true })]);
    expect(screen.queryByRole('button', { name: /Download/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove: Asset a' })).toBeInTheDocument();
  });

  it('total defaults to the sum of storedBytes; storedBytes prop and formatBytes override', () => {
    const rows = [row({ id: 'a', status: 'installed', storedBytes: 1024 }), row({ id: 'b', status: 'installed', storedBytes: 1024 })];
    const { unmount } = render(<AssetList rows={rows} />);
    expect(screen.getByText('On this device: 2.0 KB')).toBeInTheDocument();
    unmount();
    render(<AssetList rows={rows} storedBytes={7} formatBytes={(n) => `${n} bytes`} />);
    expect(screen.getByText('On this device: 7 bytes')).toBeInTheDocument();
  });

  it('uses partial label overrides and shows the empty message', () => {
    const { unmount } = render(<AssetList rows={[row({ id: 'a', status: 'available' })]} labels={{ download: 'Descargar', total: 'Total: {size}' }} />);
    expect(screen.getByRole('button', { name: 'Descargar: Asset a' })).toBeInTheDocument();
    expect(screen.getByText(/^Total: /)).toBeInTheDocument();
    unmount();
    render(<AssetList rows={[]} />);
    expect(screen.getByText(DEFAULT_ASSET_LIST_LABELS.empty)).toBeInTheDocument();
  });
});
