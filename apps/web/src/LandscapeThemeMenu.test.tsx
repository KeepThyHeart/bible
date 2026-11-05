import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

import { LandscapeThemeMenu } from './LandscapeThemeMenu';

describe('LandscapeThemeMenu', () => {
  it('exposes expanded state on its button and pressed state on the options', async () => {
    render(<LandscapeThemeMenu theme="dark" onSelect={vi.fn()} onMore={vi.fn()} />);
    const btn = screen.getByRole('button', { name: 'header.theme' });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    const dlg = screen.getByRole('dialog', { name: 'header.theme' });
    expect(dlg.getAttribute('aria-modal')).toBeNull();
    expect(screen.getByRole('button', { name: 'themes.dark' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'themes.light' }).getAttribute('aria-pressed')).toBe('false');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'themes.dark' })));
  });

  it('selects a theme and closes', () => {
    const onSelect = vi.fn();
    render(<LandscapeThemeMenu theme="dark" onSelect={onSelect} onMore={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'header.theme' }));
    fireEvent.click(screen.getByRole('button', { name: 'themes.sepia' }));
    expect(onSelect).toHaveBeenCalledWith('sepia');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on Escape, returning focus to its button', async () => {
    render(<LandscapeThemeMenu theme="light" onSelect={vi.fn()} onMore={vi.fn()} />);
    const btn = screen.getByRole('button', { name: 'header.theme' });
    fireEvent.click(btn);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'themes.light' })));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(btn));
  });

  it('closes on a press outside and calls onMore from More...', () => {
    const onMore = vi.fn();
    render(<div><span data-testid="out">x</span><LandscapeThemeMenu theme="light" onSelect={vi.fn()} onMore={onMore} /></div>);
    fireEvent.click(screen.getByRole('button', { name: 'header.theme' }));
    fireEvent.pointerDown(screen.getByTestId('out'));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'header.theme' }));
    fireEvent.click(screen.getByRole('button', { name: 'header.more' }));
    expect(onMore).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
