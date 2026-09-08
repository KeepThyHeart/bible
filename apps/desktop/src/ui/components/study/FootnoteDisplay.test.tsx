import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import FootnoteDisplay from './FootnoteDisplay';
import { enT } from '../../testing/enCatalog';

// The component resolves its own strings; mocking the hook keeps the test
// free of a ContextProvider while still asserting the shipped English.
vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => enT(key, params),
    locale: 'en' as const,
    i18n: {},
  }),
}));

interface Footnote {
  position: number;
  marker: string;
  text: string;
}

const mockFootnotes: Footnote[] = [
  { position: 1, marker: 'a', text: 'Or, "beloved Son"' },
  { position: 2, marker: 'b', text: 'Literally "perish not"' },
  { position: 3, marker: 'c', text: 'Greek: aion' },
];

describe('FootnoteDisplay', () => {
  it('renders nothing when no footnotes', () => {
    const { container } = render(<FootnoteDisplay footnotes={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders Footnotes heading', () => {
    render(<FootnoteDisplay footnotes={mockFootnotes} />);
    expect(screen.getByText('Footnotes')).toBeInTheDocument();
  });

  it('renders all footnote markers', () => {
    render(<FootnoteDisplay footnotes={mockFootnotes} />);
    expect(screen.getByText('a')).toBeInTheDocument();
    expect(screen.getByText('b')).toBeInTheDocument();
    expect(screen.getByText('c')).toBeInTheDocument();
  });

  it('renders all footnote texts', () => {
    render(<FootnoteDisplay footnotes={mockFootnotes} />);
    expect(screen.getByText('Or, "beloved Son"')).toBeInTheDocument();
    expect(screen.getByText('Literally "perish not"')).toBeInTheDocument();
    expect(screen.getByText('Greek: aion')).toBeInTheDocument();
  });

  it('renders in amber-themed container', () => {
    render(<FootnoteDisplay footnotes={mockFootnotes} />);
    const heading = screen.getByText('Footnotes');
    // The heading should be in the amber section
    expect(heading.closest('.border-warning-border')).toBeInTheDocument();
  });
});
