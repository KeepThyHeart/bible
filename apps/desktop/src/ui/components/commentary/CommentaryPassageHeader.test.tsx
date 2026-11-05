import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const navigate = vi.fn();
vi.mock('../../stores/useBibleStore', () => ({
  useBibleStore: Object.assign(vi.fn(), { getState: () => ({ navigateToVerseInPrimary: navigate }) }),
}));
vi.mock('../../contexts/useI18n', () => ({ useI18n: () => ({ t: (k: string) => k }) }));
vi.mock('../../utils/verseReference', () => ({ formatVerseReference: () => 'Romans 8:1' }));

import CommentaryPassageHeader from './CommentaryPassageHeader';

describe('CommentaryPassageHeader', () => {
  it('exposes the passage reference as a named button that navigates the Bible pane', async () => {
    render(<CommentaryPassageHeader currentVerseId={45008001} pinned={false} onTogglePin={() => {}} />);
    const btn = screen.getByRole('button', { name: 'Romans 8:1' });
    await userEvent.setup().click(btn);
    expect(navigate).toHaveBeenCalledWith(45008001);
  });
});
