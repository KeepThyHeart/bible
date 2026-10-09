import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({ addMarkFromWord: vi.fn() }));
vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (k: string, p?: Record<string, string>) => `${k}${p ? JSON.stringify(p) : ''}`, locale: 'en' }),
}));
vi.mock('./useKeywordMarkStore', () => ({
  useKeywordMarkStore: (selector: (s: unknown) => unknown) => selector({ addMarkFromWord: h.addMarkFromWord }),
}));

import { KeywordStrongsTooltipAction, KeywordWordMenuItems } from './KeywordWordActions';

beforeEach(() => h.addMarkFromWord.mockReset());

describe('keyword marks: context menu word items', () => {
  it('offers "Mark all" for a right-clicked word and runs it', async () => {
    const onClose = vi.fn();
    render(<KeywordWordMenuItems tabId="t1" wordText="faith" onClose={onClose} />);
    await userEvent.setup().click(screen.getByTestId('menu-mark-word'));
    expect(h.addMarkFromWord).toHaveBeenCalledWith('t1', { text: 'faith' }, 'word');
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByTestId('menu-mark-lemma')).toBeNull();
  });

  it('offers "Mark lemma" only when the word has a Strong\'s number', async () => {
    render(<KeywordWordMenuItems tabId="t1" wordText="faith" wordStrongs="G4102" onClose={vi.fn()} />);
    await userEvent.setup().click(screen.getByTestId('menu-mark-lemma'));
    expect(h.addMarkFromWord).toHaveBeenCalledWith('t1', { text: 'faith', strongs: 'G4102' }, 'strongs');
  });
});

describe('keyword marks: Strong\'s tooltip action', () => {
  it('marks the Strong\'s number in the chapter and closes the tooltip', async () => {
    const onClose = vi.fn();
    render(<KeywordStrongsTooltipAction tabId="t1" strongsNumber="G25" onClose={onClose} />);
    await userEvent.setup().click(screen.getByTestId('strongs-mark-in-chapter'));
    expect(h.addMarkFromWord).toHaveBeenCalledWith('t1', { text: 'G25', strongs: 'G25' }, 'strongs');
    expect(onClose).toHaveBeenCalled();
  });
});
