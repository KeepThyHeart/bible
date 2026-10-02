import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MeasurePopupModel } from '@bible/core/browser';
import { MeasurePopup, DEFAULT_MEASURE_POPUP_LABELS } from './MeasurePopup';
import type { MeasurePopupProps } from './MeasurePopup';

const model: MeasurePopupModel = {
  occurrenceId: 'o1',
  verseId: 1,
  title: '300 cubits',
  primary: '≈ 140 m',
  secondary: '≈ 450 ft',
  range: '130–160 m',
  extra: ['About 2 kg of silver'],
  relation: '1 cubit = 6 handbreadths',
  unitNote: 'Lengths varied.',
  verseNote: 'The ark.',
  usage: 'literal',
  review: 'approved',
  sources: [
    { id: 's1', title: 'Anchor Bible Dictionary', url: 'https://example.org/abd' },
    { id: 's2', title: 'Plain source' },
  ],
  parts: 1,
};

function setup(over: Partial<MeasurePopupModel> = {}, props: Partial<MeasurePopupProps> = {}) {
  render(<MeasurePopup model={{ ...model, ...over }} {...props} />);
  return userEvent.setup();
}

describe('MeasurePopup', () => {
  it('renders title, primary, secondary, range, notes', () => {
    setup();
    expect(screen.getByRole('heading', { name: '300 cubits' })).toBeInTheDocument();
    expect(screen.getByText('≈ 140 m')).toBeInTheDocument();
    expect(screen.getByText('≈ 450 ft')).toBeInTheDocument();
    expect(screen.getByText(/Range: 130–160 m/)).toHaveTextContent('depending on the value used');
    expect(screen.getByText('About 2 kg of silver')).toBeInTheDocument();
    expect(screen.getByText('1 cubit = 6 handbreadths')).toBeInTheDocument();
    expect(screen.getByText('Lengths varied.')).toBeInTheDocument();
    expect(screen.getByText('In this verse')).toBeInTheDocument();
    expect(screen.getByText(/The ark\./)).toBeInTheDocument();
  });

  it('shows the scholarly name under the title when the model has one', () => {
    setup({ title: '2 mites', subtitle: 'Greek lepton (pl. lepta)' });
    const sub = screen.getByText('Greek lepton (pl. lepta)');
    expect(sub).toHaveClass('kth-measure__subtitle');
    const heading = screen.getByRole('heading', { name: '2 mites' });
    expect(heading.nextElementSibling).toBe(sub);
  });

  it('has no subtitle element without one', () => {
    const { container } = render(<MeasurePopup model={model} />);
    expect(container.querySelector('.kth-measure__subtitle')).toBeNull();
  });

  it('compact drops the header', () => {
    setup({}, { compact: true });
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.getByText('≈ 140 m')).toBeInTheDocument();
  });

  it('shows the draft chip only for draft', () => {
    setup({ review: 'draft' });
    expect(screen.getByText(DEFAULT_MEASURE_POPUP_LABELS.draft)).toBeInTheDocument();
  });

  it('has no draft or usage chip for approved literal', () => {
    setup();
    expect(screen.queryByText(DEFAULT_MEASURE_POPUP_LABELS.draft)).toBeNull();
    expect(screen.queryByText('Illustrative')).toBeNull();
  });

  it('shows an illustrative chip with its hint', () => {
    setup({ usage: 'illustrative' });
    const chip = screen.getByText('Illustrative', { exact: false });
    expect(chip).toHaveAttribute('title', DEFAULT_MEASURE_POPUP_LABELS.usageHint.illustrative);
    expect(chip).toHaveTextContent('the exact figure is not the point');
  });

  it('discloses sources, with new-tab links only for urls', async () => {
    const onShowSources = vi.fn();
    const user = setup({}, { onShowSources });
    const btn = screen.getByRole('button', { name: 'Sources' });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Anchor Bible Dictionary')).toBeNull();
    await user.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    expect(onShowSources).toHaveBeenCalledTimes(1);
    const link = screen.getByRole('link', { name: 'Anchor Bible Dictionary' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(screen.getByText('Plain source').closest('a')).toBeNull();
    await user.click(btn);
    expect(screen.queryByText('Plain source')).toBeNull();
  });

  it('settings button only when a callback is given, and calls it', async () => {
    const onOpenSettings = vi.fn();
    const user = setup({}, { onOpenSettings });
    await user.click(screen.getByRole('button', { name: 'Units…' }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('has no settings button without a callback', () => {
    setup();
    expect(screen.queryByRole('button', { name: 'Units…' })).toBeNull();
  });

  it('labels override', () => {
    setup({ review: 'draft', usage: 'figurative' }, {
      onOpenSettings: () => {},
      labels: { range: 'Bereich', draft: 'Entwurf', sources: 'Quellen', units: 'Einheiten', usage: { figurative: 'Bildlich' } },
    });
    expect(screen.getByText(/Bereich: 130/)).toBeInTheDocument();
    expect(screen.getByText('Entwurf')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quellen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Einheiten' })).toBeInTheDocument();
    expect(screen.getByText('Bildlich', { exact: false })).toBeInTheDocument();
  });
});
