import { render, screen } from '@testing-library/react';
import { SemanticRangeSummary } from './SemanticRangeSummary';

describe('SemanticRangeSummary', () => {
  it('shows source, senses with shares, domains and lexicon renderings', () => {
    render(
      <SemanticRangeSummary
        data={{
          sourceLabel: "Strong's and KJV usage",
          senses: [{ label: 'love', share: 0.8, source: 'x' }, { label: 'charity', detail: 'old', source: 'x' }],
          domains: [{ code: '25.43', label: 'Love', source: 'x' }],
        }}
        lexiconRenderings={['love', 'beloved']}
      />,
    );
    expect(screen.getByText("Strong's and KJV usage")).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('old')).toBeInTheDocument();
    expect(screen.getByText('Love')).toBeInTheDocument();
    expect(screen.getByText("Strong's lists: love, beloved")).toBeInTheDocument();
  });

  it('omits optional parts', () => {
    render(<SemanticRangeSummary data={{ sourceLabel: 's', senses: [{ label: 'a', source: 'x' }] }} />);
    expect(screen.queryByText(/lists:/)).toBeNull();
    expect(screen.queryByText('%')).toBeNull();
  });
});
