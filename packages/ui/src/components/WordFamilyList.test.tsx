import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WordFamilyList } from './WordFamilyList';
import type { WordStudyFamilyMember } from '@bible/core/browser';

const members: WordStudyFamilyMember[] = [
  { strongs: 'G25', word: 'ἀγαπάω', translit: 'agapaō', gloss: 'to love', relationship: 'self', occurrences: 142 },
  { strongs: 'G26', word: 'ἀγάπη', translit: 'agapē', gloss: 'love', relationship: 'child', occurrences: 116 },
  { strongs: 'G27', gloss: 'beloved', relationship: 'related' },
];

describe('WordFamilyList', () => {
  it('shows badges, words, glosses and counts', () => {
    render(<WordFamilyList members={members} onSelect={() => {}} />);
    expect(screen.getByText('Derived')).toBeInTheDocument();
    expect(screen.getByText('Related')).toBeInTheDocument();
    expect(screen.getByText('agapē')).toBeInTheDocument();
    expect(screen.getByText('116')).toBeInTheDocument();
  });

  it('selects other members but not self', async () => {
    const onSelect = vi.fn();
    render(<WordFamilyList members={members} onSelect={onSelect} />);
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.getByText('This word').closest('[aria-current]')).not.toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: /G26/ }));
    expect(onSelect).toHaveBeenCalledWith('G26');
  });
});
