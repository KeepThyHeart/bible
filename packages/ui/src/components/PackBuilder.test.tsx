import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PackBuilder } from './PackBuilder';
import type { PackBuilderLabels, PackBuilderProps, PackBuilderRow } from './PackBuilder';

const labels: PackBuilderLabels = {
  title: 'Offline packs',
  presetsHeading: 'Start from',
  groupsHeading: 'Contents',
  empty: 'Nothing to pack.',
  statusAbsent: 'Not downloaded',
  statusInstalled: 'On this device',
  statusUpdate: 'Update available',
  statusInstalling: 'Installing',
  statusError: 'Failed',
  start: 'Download selected',
  cancel: 'Cancel',
  summaryDownload: 'Download: {size}',
  summaryStored: 'New storage: {size}',
  summaryFree: 'Free: {size}',
  summaryFreeUnknown: 'Free space unknown',
  fitFits: 'Fits comfortably',
  fitTight: 'Tight fit',
  fitNo: 'Not enough space, short by {size}',
  fitUnknown: 'Cannot check free space',
  storageBarLabel: 'Storage needed',
  runProgressLabel: 'Overall progress',
  runCount: '{done} of {total}',
  runBytes: '{loaded} of {total}',
  runRunning: 'Downloading',
  runDone: 'All done',
  runPartial: 'Some items failed',
  runFailed: 'Download failed',
  runCancelled: 'Cancelled',
  remove: 'Remove',
  keepHint: 'Keep on this device',
};

const fmt = (n: number) => `${n} B`;

const row = (o: Partial<PackBuilderRow> & Pick<PackBuilderRow, 'key'>): PackBuilderRow => ({
  title: `Item ${o.key}`,
  group: 'text',
  sizeBytes: 100,
  status: 'absent',
  selected: false,
  ...o,
});

function setup(props: Partial<PackBuilderProps> = {}) {
  const fns = { onPreset: vi.fn(), onToggle: vi.fn(), onStart: vi.fn(), onCancel: vi.fn(), onRemove: undefined as PackBuilderProps['onRemove'] };
  const all: PackBuilderProps = {
    groups: [
      { id: 'text', label: 'Text' },
      { id: 'audio', label: 'Audio' },
    ],
    rows: [row({ key: 'a', selected: true }), row({ key: 'b', group: 'audio' })],
    presets: [{ id: 'p1', label: 'Essentials' }],
    summary: { downloadBytes: 200, newStoredBytes: 300, freeBytes: 1000, fit: 'fits', shortfallBytes: 0 },
    warnings: [],
    labels,
    formatBytes: fmt,
    ...fns,
    ...props,
  };
  render(<PackBuilder {...all} />);
  return { ...fns, user: userEvent.setup() };
}

describe('PackBuilder', () => {
  it('renders groups and rows with labelled checkboxes', () => {
    setup();
    expect(screen.getByText('Text')).toBeInTheDocument();
    expect(screen.getByText('Audio')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Item a/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Item b/ })).not.toBeChecked();
    expect(screen.getAllByText('100 B')).toHaveLength(2);
  });

  it('calls onToggle and onPreset', async () => {
    const { user, onToggle, onPreset } = setup();
    await user.click(screen.getByRole('checkbox', { name: /Item b/ }));
    expect(onToggle).toHaveBeenCalledWith('b', true);
    await user.click(screen.getByRole('button', { name: 'Essentials' }));
    expect(onPreset).toHaveBeenCalledWith('p1');
  });

  it('disabled rows show their reason and cannot be toggled', async () => {
    const { user, onToggle } = setup({
      rows: [row({ key: 'x', disabled: true, disabledReason: 'Needs a newer app' })],
    });
    expect(screen.getByText('Needs a newer app')).toBeInTheDocument();
    const box = screen.getByRole('checkbox', { name: /Item x/ });
    expect(box).toBeDisabled();
    await user.click(box);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('installed rows are on this device and checked', () => {
    setup({ rows: [row({ key: 'i', status: 'installed' })] });
    expect(screen.getByText('On this device')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Item i/ })).toBeChecked();
  });

  it('with onRemove, installed rows are selectable (keep) and get a Remove button', async () => {
    const onRemove = vi.fn();
    const onToggle = vi.fn();
    const { user } = setup({
      onRemove,
      onToggle,
      rows: [
        row({ key: 'i', status: 'installed' }),
        row({ key: 'u', status: 'update-available' }),
        row({ key: 'n', status: 'absent' }),
        row({ key: 'p', status: 'installing' }),
      ],
    });
    const box = screen.getByRole('checkbox', { name: /Item i/ });
    expect(box).toBeEnabled();
    expect(box).not.toBeChecked();
    expect(box).toHaveAttribute('title', 'Keep on this device');
    await user.click(box);
    expect(onToggle).toHaveBeenCalledWith('i', true);
    const buttons = screen.getAllByRole('button', { name: 'Remove' });
    expect(buttons).toHaveLength(2);
    await user.click(buttons[0]);
    expect(onRemove).toHaveBeenCalledWith('i');
  });

  it('has no Remove buttons without onRemove', () => {
    setup({ rows: [row({ key: 'i', status: 'installed' })] });
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });

  it('title level defaults to 3 and follows headingLevel; the notice sits under the title', () => {
    const { unmount } = render(<PackBuilder {...({ groups: [], rows: [], presets: [], onPreset() {}, onToggle() {}, onStart() {}, onCancel() {}, summary: { downloadBytes: 0, newStoredBytes: 0, freeBytes: null, fit: 'unknown', shortfallBytes: 0 }, warnings: [], labels, formatBytes: fmt, notice: 'Shell notice' } as PackBuilderProps)} />);
    expect(screen.getByRole('heading', { level: 3, name: 'Offline packs' })).toBeInTheDocument();
    expect(screen.getByText('Shell notice').previousElementSibling).toBe(screen.getByRole('heading', { level: 3 }));
    unmount();
    render(<PackBuilder {...({ groups: [], rows: [], presets: [], onPreset() {}, onToggle() {}, onStart() {}, onCancel() {}, summary: { downloadBytes: 0, newStoredBytes: 0, freeBytes: null, fit: 'unknown', shortfallBytes: 0 }, warnings: [], labels, formatBytes: fmt, headingLevel: 4 } as PackBuilderProps)} />);
    expect(screen.getByRole('heading', { level: 4, name: 'Offline packs' })).toBeInTheDocument();
  });

  it('Start is enabled, calls back, and is disabled when fit is no, nothing selected or running', async () => {
    const { user, onStart } = setup();
    const start = screen.getByRole('button', { name: 'Download selected' });
    expect(start).toBeEnabled();
    await user.click(start);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('Start is disabled when fit is no', () => {
    setup({ summary: { downloadBytes: 2000, newStoredBytes: 2000, freeBytes: 1000, fit: 'no', shortfallBytes: 1000 } });
    expect(screen.getByRole('button', { name: 'Download selected' })).toBeDisabled();
    expect(screen.getByText('Not enough space, short by 1000 B')).toBeInTheDocument();
  });

  it('Start is disabled when nothing is selected', () => {
    setup({ rows: [row({ key: 'a' })] });
    expect(screen.getByRole('button', { name: 'Download selected' })).toBeDisabled();
  });

  it('Start is disabled while running and Cancel appears only then', async () => {
    const { user, onCancel } = setup({ run: { state: 'running', done: 1, total: 4, loadedBytes: 50, totalBytes: 200 } });
    expect(screen.getByRole('button', { name: 'Download selected' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('has no Cancel when not running', () => {
    setup({ run: { state: 'done', done: 4, total: 4, loadedBytes: 200, totalBytes: 200 } });
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(screen.getByText('All done')).toBeInTheDocument();
  });

  it('shows aggregate and per-row progress bars', () => {
    setup({
      rows: [row({ key: 'a', selected: true, status: 'installing', progress: { loaded: 25, total: 100 } })],
      run: { state: 'running', done: 1, total: 4, loadedBytes: 50, totalBytes: 200 },
    });
    expect(screen.getByRole('progressbar', { name: 'Item a' })).toHaveAttribute('aria-valuenow', '25');
    expect(screen.getByRole('progressbar', { name: 'Overall progress' })).toHaveAttribute('aria-valuenow', '25');
    expect(screen.getByText('1 of 4')).toBeInTheDocument();
    expect(screen.getByText('50 B of 200 B')).toBeInTheDocument();
  });

  it('shows the summary lines, storage bar and fit messages', () => {
    setup({ summary: { downloadBytes: 200, newStoredBytes: 300, freeBytes: 1000, fit: 'tight', shortfallBytes: 0 } });
    expect(screen.getByText('Download: 200 B')).toBeInTheDocument();
    expect(screen.getByText('New storage: 300 B')).toBeInTheDocument();
    expect(screen.getByText('Free: 1000 B')).toBeInTheDocument();
    expect(screen.getByText('Tight fit')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Storage needed' })).toHaveAttribute('aria-valuenow', '30');
  });

  it('handles unknown free space', () => {
    setup({ summary: { downloadBytes: 1, newStoredBytes: 1, freeBytes: null, fit: 'unknown', shortfallBytes: 0 } });
    expect(screen.getByText('Free space unknown')).toBeInTheDocument();
    expect(screen.getByText('Cannot check free space')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar', { name: 'Storage needed' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Download selected' })).toBeEnabled();
  });

  it('renders warnings in a status list', () => {
    setup({ warnings: ['Large download', 'Metered connection'] });
    const list = screen.getByRole('status');
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(list).toHaveTextContent('Metered connection');
  });

  it('shows the empty state without rows', () => {
    setup({ rows: [] });
    expect(screen.getByText('Nothing to pack.')).toBeInTheDocument();
  });
});
