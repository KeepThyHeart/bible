/**
 * The desktop wrapper around the shared `ExtensionPanelHost` (`@bible/ui`): the IPC lookup, the URL and
 * sandbox it builds, the loading/error copy, and that the ONE bridge it creates carries the desktop handlers
 * and the host -> panel pushes. Bridge mechanics themselves are tested in `@bible/core` and `@bible/ui`;
 * handler behaviour in `useIframeBridge.test.tsx`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';

import ExtensionPanelHost, { computeSandboxAttr } from './ExtensionPanelHost';
import { publishActiveVerseBroadcast } from '../../extensions/activeVerseBroadcast';

vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({
    t: (key: string) => (key === 'extensionPanelHost.loading' ? 'Loading panel...' : key),
    i18n: { currentLocale: 'es' },
  }),
}));

type Meta = { uiEntry: string; title?: string; allowAutoplay?: boolean } | null;

const getPanelTypeUiEntry = vi.fn<(ext: string, panel: string) => Promise<Meta>>();
let savedElectron: unknown;

beforeEach(() => {
  vi.clearAllMocks();
  const w = window as unknown as { electron?: unknown };
  savedElectron = w.electron;
  w.electron = { extensions: { getPanelTypeUiEntry } };
});

afterEach(() => {
  (window as unknown as { electron?: unknown }).electron = savedElectron;
});

const mount = () => render(<ExtensionPanelHost extensionId="ext.test.alpha" panelTypeId="main" panelId="panel-7" />);
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

function fakeWindow(iframe: HTMLIFrameElement) {
  const posted: unknown[] = [];
  const contentWindow = { postMessage: (m: unknown) => posted.push(m) };
  Object.defineProperty(iframe, 'contentWindow', { configurable: true, get: () => contentWindow });
  return { posted, contentWindow };
}

function send(source: unknown, method: string, args: unknown[] = [], id = 'req-1') {
  const ev = new MessageEvent('message', { data: { kind: 'request', id, method, args } });
  Object.defineProperty(ev, 'source', { value: source });
  window.dispatchEvent(ev);
}

describe('computeSandboxAttr', () => {
  it('never grants same-origin and adds autoplay only when asked', () => {
    expect(computeSandboxAttr(false)).toBe('allow-scripts allow-forms');
    expect(computeSandboxAttr(true)).toBe('allow-scripts allow-forms allow-autoplay');
    expect(computeSandboxAttr(true)).not.toContain('allow-same-origin');
  });
});

describe('ExtensionPanelHost (desktop wrapper)', () => {
  it('shows the localized loading copy until the lookup answers, then the iframe', async () => {
    let resolve!: (m: Meta) => void;
    getPanelTypeUiEntry.mockReturnValue(new Promise<Meta>((r) => { resolve = r; }));
    const { container } = mount();
    expect(screen.getByText('Loading panel...')).toBeInTheDocument();
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('[data-panel-id="panel-7"]')).not.toBeNull();

    resolve({ uiEntry: '/ui/index.html', title: 'Alpha' });
    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull());
    const frame = container.querySelector('iframe')!;
    expect(getPanelTypeUiEntry).toHaveBeenCalledWith('ext.test.alpha', 'main');
    expect(frame).toHaveAttribute('src', 'ext-ui://ext.test.alpha/ui/index.html');
    expect(frame).toHaveAttribute('title', 'Alpha');
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-forms');
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(frame).toHaveAttribute('data-panel-id', 'panel-7');
    expect(frame).toHaveAttribute('data-extension-id', 'ext.test.alpha');
    expect(frame).toHaveAttribute('data-panel-type-id', 'main');
  });

  it('falls back to <extension>.<panelType> for the title and adds autoplay for ui:media', async () => {
    getPanelTypeUiEntry.mockResolvedValue({ uiEntry: 'index.html', allowAutoplay: true });
    const { container } = mount();
    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull());
    const frame = container.querySelector('iframe')!;
    expect(frame).toHaveAttribute('title', 'ext.test.alpha.main');
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-forms allow-autoplay');
  });

  it('shows an error when the panel type is not registered', async () => {
    getPanelTypeUiEntry.mockResolvedValue(null);
    const { container } = mount();
    expect(await screen.findByText('Extension panel type not found: ext.test.alpha.main')).toBeInTheDocument();
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('shows the lookup error message', async () => {
    getPanelTypeUiEntry.mockRejectedValue(new Error('boom'));
    mount();
    expect(await screen.findByText('boom')).toBeInTheDocument();
  });

  it('shows an error when the IPC handler is not registered', () => {
    (window as unknown as { electron?: unknown }).electron = {};
    mount();
    expect(screen.getByText('extensions:getPanelTypeUiEntry IPC handler not registered')).toBeInTheDocument();
  });

  it('serves the desktop handlers to its own iframe only, with the mounted identity', async () => {
    getPanelTypeUiEntry.mockResolvedValue({ uiEntry: 'index.html' });
    const { container } = mount();
    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull());
    const { posted, contentWindow } = fakeWindow(container.querySelector('iframe')!);

    send({ postMessage: vi.fn() }, 'ui.getLocale', [], 'evil');
    await flush();
    expect(posted).toEqual([]);

    send(contentWindow, 'ui.getLocale');
    await flush();
    expect(posted).toEqual([{ kind: 'response', id: 'req-1', result: { locale: 'es', direction: 'ltr' } }]);

    // Nothing is known about the manifest yet, so uikit.* is denied.
    send(contentWindow, 'uikit.anything', [], 'req-2');
    await flush();
    expect(posted[1]).toMatchObject({ id: 'req-2', error: { code: 'PermissionDeniedError' } });
  });

  it('forwards host pushes through the one bridge and stops after unmount', async () => {
    getPanelTypeUiEntry.mockResolvedValue({ uiEntry: 'index.html' });
    const { container, unmount } = mount();
    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull());
    const { posted } = fakeWindow(container.querySelector('iframe')!);

    act(() => publishActiveVerseBroadcast({ verseId: 43003016, module: 'KJV' }));
    expect(posted).toEqual([{ kind: 'event', channel: 'verse.activeChanged', payload: { verseId: 43003016, source: 'host' } }]);

    unmount();
    act(() => publishActiveVerseBroadcast({ verseId: 43003017, module: 'KJV' }));
    expect(posted).toHaveLength(1);
  });
});
