import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import VerseContextMenu from './VerseContextMenu';
import { ContextProvider, type AppServices } from '../contexts/ContextProvider';

function services(direction: 'ltr' | 'rtl'): AppServices {
  return {
    registry: {} as AppServices['registry'],
    whenContext: { onDidChange: () => ({ dispose: () => {} }) } as unknown as AppServices['whenContext'],
    keybindings: {} as AppServices['keybindings'],
    i18n: {
      t: (key: string) => key,
      currentLocale: direction === 'rtl' ? 'ar' : 'en',
      currentDirection: direction,
      onDidChangeLocale: () => ({ dispose: vi.fn() }),
      resolve: (v: unknown) => String(v),
      loadCatalog: vi.fn(),
      setLocale: vi.fn(),
    } as unknown as AppServices['i18n'],
  };
}

const verse = { verse_id: 43003016, book_number: 43, chapter: 3, verse: 16, text: 'x' };
const ctx = { bookName: 'John', chapter: 3, translation: 'KJV' };

afterEach(() => document.documentElement.removeAttribute('dir'));

function inset(direction: 'ltr' | 'rtl', x: number): string {
  document.documentElement.setAttribute('dir', direction);
  render(
    <ContextProvider services={services(direction)}>
      <VerseContextMenu verses={verse} context={ctx} position={{ x, y: 50 }} onClose={vi.fn()} />
    </ContextProvider>,
  );
  return screen.getByRole('menu').style.getPropertyValue('inset-inline-start');
}

describe('context menu anchoring follows the UI direction', () => {
  it('LTR: anchors the menu start at the pointer', () => {
    // jsdom reports a 0-wide menu, so the pointer x is the inline-start inset.
    expect(inset('ltr', 100)).toBe('100px');
  });

  it('RTL: measures the inset from the right edge (unfolds leftwards)', () => {
    const vw = window.innerWidth;
    expect(inset('rtl', 100)).toBe(`${vw - 100}px`);
  });
});
