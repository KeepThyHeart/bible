import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WordStudyHeader } from './WordStudyHeader';
import { overviewFixture } from './wordStudyFixtures';

describe('WordStudyHeader', () => {
  it('shows title, original word details and totals', () => {
    render(<WordStudyHeader overview={overviewFixture()} onModuleChange={() => {}} />);
    expect(screen.getByRole('heading', { name: 'agapao' })).toBeInTheDocument();
    expect(screen.getByText('ἀγαπάω')).toBeInTheDocument();
    expect(screen.getByText('agapaō')).toBeInTheDocument();
    expect(screen.getByText('ag-ap-ah-o')).toBeInTheDocument();
    expect(screen.getByText("Strong's G25")).toBeInTheDocument();
    expect(screen.getByText('142 occurrences in 106 verses')).toBeInTheDocument();
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
});
