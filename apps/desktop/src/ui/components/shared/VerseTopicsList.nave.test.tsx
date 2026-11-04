import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (k: string) => k, locale: 'ar', i18n: {} }),
}));

import VerseTopicsList from './VerseTopicsList';

describe('VerseTopicsList source heading with a right-to-left apostrophe', () => {
  it('normalises U+07F4 and isolates the heading', () => {
    render(
      <VerseTopicsList
        topics={[{ topic_id: 1, name: 'Love', source_abbreviation: 'nave', source_name: 'Naveߴs Topical Bible', verse_count: 3 } as never]}
        onTopicClick={vi.fn()}
      />,
    );
    const label = screen.getByText(/Topical Bible/);
    expect(label.textContent).not.toContain('ߴ');
    expect(label.closest('bdi, [dir="auto"]')).not.toBeNull();
  });
});
