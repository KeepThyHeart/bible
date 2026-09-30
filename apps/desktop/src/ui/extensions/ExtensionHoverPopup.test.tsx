/**
 * `ExtensionHoverPopup` rendering (task 0036, P0.1c; design doc §11.5):
 * multiple sections stack with the contributing extension named, each
 * `HoverContentDto` kind renders through its own safe path.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContextProvider, type AppServices } from '../contexts/ContextProvider';
import { ExtensionHoverPopup } from './ExtensionHoverPopup';
import { useVerseHoverPopupStore, __resetVerseHoverPopupStore } from './verseHoverPopupStore';

function createMockServices(): AppServices {
  return {
    registry: {} as AppServices['registry'],
    whenContext: {} as AppServices['whenContext'],
    keybindings: {} as AppServices['keybindings'],
    i18n: {
      t: (key: string) => key,
      currentLocale: 'en' as const,
      onDidChangeLocale: () => ({ dispose: () => undefined }),
      resolve: (v: unknown) =>
        typeof v === 'object' && v !== null && 'key' in v ? String((v as { key: string }).key) : String(v),
      loadCatalog: () => undefined,
      setLocale: () => undefined,
    } as unknown as AppServices['i18n'],
  };
}

function renderPopup() {
  return render(
    <ContextProvider services={createMockServices()}>
      <ExtensionHoverPopup />
    </ContextProvider>,
  );
}

beforeEach(() => {
  __resetVerseHoverPopupStore();
});

describe('ExtensionHoverPopup', () => {
  it('renders nothing when no popup is open', () => {
    renderPopup();
    expect(screen.queryByText(/./)).toBeNull();
  });

  it('stacks multiple sections, each naming its extension', () => {
    useVerseHoverPopupStore.setState({
      popup: {
        position: { x: 0, y: 0 },
        sections: [
          { key: 'a', extensionId: 'ext.a', title: 'Extension A', content: { kind: 'text', text: 'First section' } },
          { key: 'b', extensionId: 'ext.b', content: { kind: 'text', text: 'Second section' } },
        ],
      },
    });
    renderPopup();

    expect(screen.getByText('First section')).toBeInTheDocument();
    expect(screen.getByText('Second section')).toBeInTheDocument();
    expect(screen.getByText('Extension A')).toBeInTheDocument();
    // No title given for the second section - falls back to the raw extensionId.
    expect(screen.getByText('ext.b')).toBeInTheDocument();
  });

  it('renders a loading spinner placeholder for a "loading" section', () => {
    useVerseHoverPopupStore.setState({
      popup: { position: { x: 0, y: 0 }, sections: [{ key: 'loading', extensionId: '', content: 'loading' }] },
    });
    renderPopup();
    // `PopupPortal` renders into `document.body`, outside `render()`'s own
    // container - search the whole document, not the local container.
    expect(document.body.querySelector('.animate-spin')).not.toBeNull();
  });

  it('renders markdown content sanitized - bold survives, and a raw <script>/onerror never does', () => {
    useVerseHoverPopupStore.setState({
      popup: {
        position: { x: 0, y: 0 },
        sections: [
          {
            key: 'md',
            extensionId: 'ext.a',
            content: { kind: 'markdown', markdown: '**bold** <img src="x" onerror="alert(1)"> <script>alert(2)</script>' },
          },
        ],
      },
    });
    renderPopup();
    expect(document.body.querySelector('strong')?.textContent).toBe('bold');
    expect(document.body.querySelector('script')).toBeNull();
    expect(document.body.innerHTML).not.toContain('onerror');
    // `markdownToHtml` (components/study/markdown.ts) has no image syntax at
    // all today - it never emits `<img>` regardless of `allowImages` - so the
    // `<img>` literal in the source above is inert HTML sanitizeHtml would
    // strip on its own merits either way; `stripImages` (this component) is
    // forward-defensive for if/when the renderer ever gains image support,
    // not exercised end-to-end by this test.
  });

  it('renders text content as a plain text node, never as HTML', () => {
    useVerseHoverPopupStore.setState({
      popup: {
        position: { x: 0, y: 0 },
        sections: [{ key: 't', extensionId: 'ext.a', content: { kind: 'text', text: '<b>not bold</b>' } }],
      },
    });
    renderPopup();
    expect(document.body.querySelector('b')).toBeNull();
    expect(screen.getByText('<b>not bold</b>')).toBeInTheDocument();
  });

  it('renders a placeholder note for iframe content, deferred out of P0.1c', () => {
    useVerseHoverPopupStore.setState({
      popup: {
        position: { x: 0, y: 0 },
        sections: [{ key: 'if', extensionId: 'ext.a', content: { kind: 'iframe', uiEntry: 'panel.html' } }],
      },
    });
    renderPopup();
    expect(screen.getByText(/supported in a hover popup yet/i)).toBeInTheDocument();
  });
});
