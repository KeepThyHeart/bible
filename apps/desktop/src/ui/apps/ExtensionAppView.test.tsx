import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const mockI18n = { resolve: (v: unknown) => (typeof v === 'string' ? v : '?'), currentLocale: 'en' };
vi.mock('../contexts/useI18n', () => ({
  useI18n: () => ({ t: (k: string) => `[${k}]`, i18n: mockI18n }),
}));

let unavailable: (() => void) | undefined;
let ready: (() => void) | undefined;
vi.mock('../components/extensions/ExtensionPanelHost', () => ({
  default: (p: {
    extensionId: string;
    appShortId: string;
    appTitle?: string;
    onUnavailable?: () => void;
    onReady?: () => void;
  }) => {
    unavailable = p.onUnavailable;
    ready = p.onReady;
    return <div data-testid="panel-host" data-ext={p.extensionId} data-app={p.appShortId} data-title={p.appTitle} />;
  },
}));

import { ExtensionAppView } from './ExtensionAppView';
import { appHost, appRegistry, resetAppHostForTest, openApp, addAppBinding } from './appHost';
import type { ExtensionAppInfo } from './extensionApps';

const EXT = 'ext.acme.words';
const info: ExtensionAppInfo = {
  id: `${EXT}.counts`,
  shortId: 'counts',
  title: 'Word Count',
  iconUrl: `ext-ui://${EXT}/icon.svg`,
  order: 0,
  publisher: 'Acme',
  extensionName: 'Words',
  hasSettings: true,
};

const appVisibility = vi.fn();
const NullView = () => null;
addAppBinding({ id: 'study', load: async () => ({ View: NullView }) });
addAppBinding({ id: `${EXT}.counts`, load: async () => ({ View: NullView }) });
let saved: unknown;

beforeEach(() => {
  vi.clearAllMocks();
  resetAppHostForTest();
  saved = (window as unknown as { electron?: unknown }).electron;
  (window as unknown as { electron?: unknown }).electron = { extensions: { appVisibility } };
  appRegistry.register(
    {
      id: 'study', title: { key: 'apps.study.title', fallback: 'Study' }, icon: { kind: 'builtin', name: 'book-open' },
      lifecycle: { keepAlive: 'always', restore: 'reopen' },
    },
    { kind: 'builtin', moduleId: 'study' },
  );
  appRegistry.register(
    {
      id: info.id, title: { extensionId: EXT, text: 'Word Count' }, icon: { kind: 'image', src: info.iconUrl! },
      lifecycle: { keepAlive: 'never', restore: 'reopen' },
    },
    { kind: 'extension', extensionId: EXT },
  );
});
afterEach(() => {
  (window as unknown as { electron?: unknown }).electron = saved;
});

describe('ExtensionAppView', () => {
  it('draws the host app bar and hosts the app iframe in app mode', () => {
    render(<ExtensionAppView extensionId={EXT} info={info} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Word Count' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByText('by Acme')).toBeInTheDocument();
    expect(screen.getByTestId('panel-host')).toHaveAttribute('data-app', 'counts');
    expect(screen.getByTestId('panel-host')).toHaveAttribute('data-ext', EXT);
  });

  it('reports visible only once the app lookup (which activates the owner) is ready, hidden on unmount', () => {
    const { unmount } = render(<ExtensionAppView extensionId={EXT} info={info} />);
    expect(appVisibility).not.toHaveBeenCalled();
    act(() => ready?.());
    expect(appVisibility).toHaveBeenCalledWith(EXT, 'counts', true);
    unmount();
    expect(appVisibility).toHaveBeenLastCalledWith(EXT, 'counts', false);
  });

  it('does not report hidden for an app that never became ready', () => {
    const { unmount } = render(<ExtensionAppView extensionId={EXT} info={info} />);
    unmount();
    expect(appVisibility).not.toHaveBeenCalled();
  });

  it('names the region by its heading and passes the resolved title to the iframe host', () => {
    render(<ExtensionAppView extensionId={EXT} info={info} />);
    expect(screen.getByRole('region', { name: 'Word Count' })).toBeInTheDocument();
    expect(screen.getByTestId('panel-host')).toHaveAttribute('data-title', 'Word Count');
  });

  it('gives the bar buttons app-specific accessible names and a visible focus ring', () => {
    render(<ExtensionAppView extensionId={EXT} info={info} />);
    expect(screen.getByRole('button', { name: 'Close Word Count' })).toHaveClass('focus-visible:ring-2');
    expect(screen.getByRole('button', { name: 'Word Count settings' })).toHaveClass('focus-visible:ring-2');
    expect(screen.getByRole('button', { name: 'Close Word Count' })).toHaveTextContent('Close');
  });

  it('works without the visibility IPC', () => {
    (window as unknown as { electron?: unknown }).electron = {};
    expect(() => render(<ExtensionAppView extensionId={EXT} info={info} />)).not.toThrow();
  });

  it('shows Settings only when the extension has settings and opens Preferences at it', () => {
    const handler = vi.fn();
    window.addEventListener('open-preferences-extension-settings', handler as EventListener);
    const { rerender } = render(<ExtensionAppView extensionId={EXT} info={info} />);
    fireEvent.click(screen.getByRole('button', { name: 'Word Count settings' }));
    expect((handler.mock.calls[0]![0] as CustomEvent).detail).toEqual({ extensionId: EXT });
    rerender(<ExtensionAppView extensionId={EXT} info={{ ...info, hasSettings: false }} />);
    expect(screen.queryByRole('button', { name: 'Word Count settings' })).toBeNull();
    window.removeEventListener('open-preferences-extension-settings', handler as EventListener);
  });

  it('Close returns to Study', async () => {
    await openApp('study');
    await openApp(info.id);
    render(<ExtensionAppView extensionId={EXT} info={info} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close Word Count' }));
    await vi.waitFor(() => expect(appHost.getSnapshot().activeId).toBe('study'));
  });

  it('shows an unavailable state with Back to Study when the app cannot load', async () => {
    await openApp('study');
    await openApp(info.id);
    render(<ExtensionAppView extensionId={EXT} info={info} />);
    act(() => unavailable?.());
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByTestId('panel-host')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Study' }));
    await vi.waitFor(() => expect(appHost.getSnapshot().activeId).toBe('study'));
  });
});
