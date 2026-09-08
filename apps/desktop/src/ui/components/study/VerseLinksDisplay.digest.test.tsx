/**
 * The "Commentaries:" chips in Study Mode name the digest module.
 *
 * Its database abbreviation is "SYNTHESIS" - a build detail. Every other
 * surface in the app resolves that to "Combined Summary" (the Commentary tab,
 * the Study pane's own section heading, the Overview list); this row rendered
 * `comm.abbreviation` unguarded, which made it the most visible place the raw
 * name reached a reader.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import VerseLinksDisplay, { type VerseLinksDisplayProps } from './VerseLinksDisplay';
import { ContextProvider, type AppServices } from '../../contexts/ContextProvider';
import { DIGEST_DISPLAY_NAME, DIGEST_MODULE_ABBR } from '../../moduleDescriptions';

vi.mock('dockview-react', () => ({}));

vi.mock('../../stores/useCommentaryStore', () => ({
  useCommentaryStore: { getState: () => ({ openCommentary: vi.fn() }) },
}));
vi.mock('../../stores/useLayoutStore', () => ({
  useLayoutStore: { getState: () => ({ panels: new Map(), addPanel: vi.fn() }) },
}));

function createMockServices(): AppServices {
  return {
    registry: {} as AppServices['registry'],
    whenContext: { snapshot: {} } as unknown as AppServices['whenContext'],
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
}

const JOHN_3_16 = 43003016;

function renderLinks(abbreviation: string, moduleName: string) {
  const links: VerseLinksDisplayProps['links'] = {
    commentaries: {
      direct: [
        {
          moduleId: 1,
          moduleName,
          abbreviation,
          entryId: 10,
          entryLevel: 'verse',
          verseIdStart: JOHN_3_16,
          isOpen: false,
        },
      ],
      mentions: [],
    },
    crossReferences: [],
    books: [],
    userContent: { notes: [], journals: [] },
    userRefCount: 0,
  } as unknown as VerseLinksDisplayProps['links'];

  return render(
    <ContextProvider services={createMockServices()}>
      <VerseLinksDisplay verseId={JOHN_3_16} links={links} />
    </ContextProvider>,
  );
}

describe('VerseLinksDisplay commentary chips', () => {
  it('names the digest module "Combined Summary", not its database abbreviation', () => {
    renderLinks(DIGEST_MODULE_ABBR, 'Commentary Synthesis');
    expect(screen.getByText(DIGEST_DISPLAY_NAME)).toBeInTheDocument();
    expect(screen.queryByText(DIGEST_MODULE_ABBR)).not.toBeInTheDocument();
  });

  it('still shows an ordinary commentary by its own abbreviation', () => {
    renderLinks('MHC', 'Matthew Henry Commentary');
    expect(screen.getByText('MHC')).toBeInTheDocument();
  });
});
