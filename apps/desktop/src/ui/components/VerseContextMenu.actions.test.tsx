import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VerseContextMenu from './VerseContextMenu';
import { ContextProvider, type AppServices } from '../contexts/ContextProvider';
import { verseActions } from '../apps/appHost';

const services: AppServices = {
  registry: {} as AppServices['registry'],
  whenContext: { onDidChange: () => ({ dispose: () => {} }), evaluate: (e: string) => e === 'yes' } as unknown as AppServices['whenContext'],
  keybindings: {} as AppServices['keybindings'],
  i18n: {
    t: (key: string) => key,
    currentLocale: 'en' as const,
    onDidChangeLocale: () => ({ dispose: vi.fn() }),
    resolve: (v: unknown) => String(v),
    loadCatalog: vi.fn(),
    setLocale: vi.fn(),
  } as unknown as AppServices['i18n'],
};
const verse = { verse_id: 43003016, book_number: 43, chapter: 3, verse: 16, text: 't' };

function renderMenu(onClose = vi.fn()) {
  render(
    <ContextProvider services={services}>
      <VerseContextMenu verses={verse} context={{ bookName: 'John', chapter: 3, translation: 'KJV' }} position={{ x: 1, y: 1 }} onClose={onClose} />
    </ContextProvider>,
  );
  return onClose;
}

describe('VerseContextMenu: verseActions registry', () => {
  const disposables: { dispose(): void }[] = [];
  beforeEach(() => {
    disposables.push(
      verseActions.register({ id: 'a.one', title: { key: 'a.one', fallback: 'Fallback One' }, order: 20, group: 'app' }, { kind: 'builtin', moduleId: 'a' }),
      verseActions.register({ id: 'a.hidden', title: { key: 'a.hidden', fallback: 'Hidden' }, when: 'no' }, { kind: 'builtin', moduleId: 'a' }),
    );
  });
  afterEach(() => { for (const d of disposables.splice(0)) d.dispose(); });

  it('renders registry actions after the built-ins (with fallback labels), skipping those whose when is false', () => {
    renderMenu();
    expect(screen.getByRole('menuitem', { name: 'Fallback One' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Hidden' })).toBeNull();
  });

  it('draws a contributed action\'s builtin icon in the bottom block, and leaves a gap for rows with none', () => {
    disposables.push(
      verseActions.register({ id: 'a.icon', title: { key: 'a.icon', fallback: 'With icon' }, icon: { kind: 'builtin', name: 'brain' }, order: 30, group: 'app' }, { kind: 'builtin', moduleId: 'a' }),
    );
    renderMenu();
    expect(screen.getByRole('menuitem', { name: 'With icon' }).querySelector('svg[data-icon="brain"]')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Fallback One' }).querySelector('svg')).toBeNull();
  });

  it('closes the menu and runs the action with the verse context on click', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    disposables.push(verseActions.bindHandler({ id: 'a.one', load: async () => ({ run }) }));
    const onClose = renderMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Fallback One' }));
    expect(onClose).toHaveBeenCalled();
    await vi.waitFor(() => expect(run).toHaveBeenCalledWith({ verseId: 43003016, verseIds: [43003016], module: 'KJV', surface: 'reader' }));
  });

  it('closes when the app on screen changes', () => {
    const onClose = renderMenu();
    act(() => { window.dispatchEvent(new Event('app:will-hide')); });
    expect(onClose).toHaveBeenCalled();
  });
});
