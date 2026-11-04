import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WordStudyHeader } from './WordStudyHeader';
import { overviewFixture } from './wordStudyFixtures';

/** Matcher that ignores bidi isolate marks. */
const noIso = (want: string) => (_: string, el: Element | null) => (el?.textContent ?? '').replace(/[\u2068\u2069]/g, '') === want && el!.children.length === 0;

describe('WordStudyHeader', () => {
  it('isolates interpolated numbers so RTL sentences do not scramble (B-186)', () => {
    render(<WordStudyHeader overview={overviewFixture()} onModuleChange={() => {}} labels={{ totals: '{verses} آيات، {occurrences} ورود' }} />);
    const el = document.querySelector('.kth-ws-header__totals')!;
    expect(el.textContent).toBe('\u2068106\u2069 آيات، \u2068142\u2069 ورود');
  });

  it('shows title, original word details and totals', () => {
    render(<WordStudyHeader overview={overviewFixture()} onModuleChange={() => {}} />);
    expect(screen.getByRole('heading', { name: 'agapao' })).toBeInTheDocument();
    expect(screen.getByText('ἀγαπάω')).toBeInTheDocument();
    expect(screen.getByText('agapaō')).toBeInTheDocument();
    expect(screen.getByText('ag-ap-ah-o')).toBeInTheDocument();
    expect(screen.getByText(noIso("Strong's G25"))).toBeInTheDocument();
    expect(screen.getByText(noIso('142 occurrences in 106 verses'))).toBeInTheDocument();
  });

  it('calls onModuleChange from the select', async () => {
    const onModuleChange = vi.fn();
    render(<WordStudyHeader overview={overviewFixture()} onModuleChange={onModuleChange} />);
    await userEvent.setup().selectOptions(screen.getByLabelText('Translation'), 'ESV');
    expect(onModuleChange).toHaveBeenCalledWith('ESV');
  });

  it('shows action buttons only when callbacks are given', async () => {
    const { rerender } = render(<WordStudyHeader overview={overviewFixture()} onModuleChange={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Search all' })).toBeNull();
    const onSearchAll = vi.fn();
    const onOpenInDictionary = vi.fn();
    rerender(<WordStudyHeader overview={overviewFixture()} onModuleChange={() => {}} onSearchAll={onSearchAll} onOpenInDictionary={onOpenInDictionary} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Search all' }));
    await user.click(screen.getByRole('button', { name: 'Open in dictionary' }));
    expect(onSearchAll).toHaveBeenCalled();
    expect(onOpenInDictionary).toHaveBeenCalled();
  });

  it('shows notice text and custom labels', () => {
    render(<WordStudyHeader overview={overviewFixture({ notice: 'not-tagged' })} onModuleChange={() => {}} labels={{ noticeNotTagged: 'Untagged!' }} />);
    expect(screen.getByRole('status')).toHaveTextContent('Untagged!');
    expect(screen.queryByText(/occurrences in/)).toBeNull();
  });

  it('group studies omit the original word row', () => {
    render(<WordStudyHeader overview={overviewFixture({ subject: { kind: 'group', label: 'love' }, entry: null })} onModuleChange={() => {}} />);
    expect(screen.queryByText(/Strong's/)).toBeNull();
  });

  it('says the number does not exist, and offers no dictionary entry to open (B-168)', () => {
    render(<WordStudyHeader overview={overviewFixture({ notice: 'unknown-number' })} onModuleChange={() => {}} onOpenInDictionary={() => {}} onSearchAll={() => {}} />);
    expect(screen.getByRole('status')).toHaveTextContent("No such Strong's number.");
    expect(screen.queryByRole('button', { name: 'Open in dictionary' })).toBeNull();
  });
});
