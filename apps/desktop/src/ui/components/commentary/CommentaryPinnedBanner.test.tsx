/**
 * Component tests for the "commentary is pinned, Bible pane has moved on"
 * banner.
 *
 * Covers two things that regressed together in the same bug:
 *  - the banner renders and calls back correctly (basic behavior), and
 *  - its two strings come from the catalog rather than being hardcoded
 *    English (see `commentaryPane.pinnedTo` and
 *    `commentaryPane.syncToCurrentVerse` in locales/en/ui.json).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CommentaryPinnedBanner from './CommentaryPinnedBanner';
import { ContextProvider, type AppServices } from '../../contexts/ContextProvider';
import { enString, enT } from '../../testing/enCatalog';

function createMockServices(
  translate: (key: string, params?: Record<string, unknown>) => string = enT,
): AppServices {
  const mockI18n = {
    t: translate,
    currentLocale: 'en' as const,
    onDidChangeLocale: () => ({ dispose: vi.fn() }),
    resolve: (v: unknown) => String(v),
    loadCatalog: vi.fn(),
    setLocale: vi.fn(),
  };
  return {
    registry: {} as AppServices['registry'],
    whenContext: {} as AppServices['whenContext'],
    keybindings: {} as AppServices['keybindings'],
    i18n: mockI18n as unknown as AppServices['i18n'],
  };
}

function renderBanner(
  props: { pinnedVerseId: number; onSyncToCurrent: () => void },
  translate?: (key: string, params?: Record<string, unknown>) => string,
) {
  return render(
    <ContextProvider services={createMockServices(translate)}>
      <CommentaryPinnedBanner {...props} />
    </ContextProvider>,
  );
}

describe('CommentaryPinnedBanner', () => {
  it('renders the pinned reference and a sync button from the English catalog', () => {
    renderBanner({ pinnedVerseId: 43003016, onSyncToCurrent: vi.fn() });

    // The catalog is the only copy of this wording now, so assert against it
    // rather than a literal - and never against a raw `[key]`.
    const pinnedPrefix = enString('commentaryPane.pinnedTo').split('{')[0]!;
    expect(screen.getByText(new RegExp(`^${pinnedPrefix}`))).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: enString('commentaryPane.syncToCurrentVerse') }),
    ).toBeInTheDocument();
  });

  it('renders translated strings when the catalog has real entries', () => {
    const translate = (key: string, params?: Record<string, unknown>) => {
      if (key === 'commentaryPane.pinnedTo') return `Épinglé à ${String(params?.reference ?? '')}`;
      if (key === 'commentaryPane.syncToCurrentVerse') return 'Synchroniser';
      return `[${key}]`;
    };
    renderBanner({ pinnedVerseId: 43003016, onSyncToCurrent: vi.fn() }, translate);

    expect(screen.getByText(/^Épinglé à /)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Synchroniser' })).toBeInTheDocument();
  });

  it('calls onSyncToCurrent when the sync button is clicked', async () => {
    const user = userEvent.setup();
    const onSyncToCurrent = vi.fn();
    renderBanner({ pinnedVerseId: 43003016, onSyncToCurrent });

    await user.click(screen.getByRole('button', { name: 'Sync to current verse' }));

    expect(onSyncToCurrent).toHaveBeenCalledTimes(1);
  });
});
