/**
 * A saved dockview layout naming panel type 'wordStudy' (task 0126): with the module on it
 * restores and renders the word study view (activating the module); with it off the layout
 * still loads and the panel shows the same "unavailable" placeholder as any unknown type.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { sanitizeDockviewState } from '../../services/LayoutStateSanitizer';

vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (k: string) => k, language: 'en' }),
}));
vi.mock('./WordStudyPane', () => ({ default: () => <div data-testid="word-study-pane" /> }));
vi.doMock('./module', () => ({ activate: vi.fn() }));

async function boot(override = '') {
  vi.resetModules();
  window.localStorage.setItem('kth.modules', override);
  const { registerBuiltinModules } = await import('../builtinModules');
  const host = await import('../moduleHost');
  registerBuiltinModules();
  return host;
}

async function renderPanel() {
  const { default: PanelContentRenderer } = await import('../../components/PanelContentRenderer');
  const props: any = { params: { contentType: 'wordStudy' }, api: { id: 'p1' } };
  return render(<PanelContentRenderer {...props} />);
}

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe('a saved layout naming the wordStudy panel type', () => {
  const layout = {
    grid: { root: { type: 'branch', size: 1, data: [{ type: 'leaf', size: 1, data: { id: 'g', views: ['wordStudy_0'], activeView: 'wordStudy_0' } }] }, width: 1, height: 1, orientation: 'HORIZONTAL' },
    panels: { wordStudy_0: { id: 'wordStudy_0', contentComponent: 'panelContent', title: 'Word Study', params: { contentType: 'wordStudy' } } },
    activeGroup: 'g',
  } as never;

  it('is kept by the sanitizer whether or not the module is on', () => {
    expect(sanitizeDockviewState(layout).layout).toBe(layout);
  });

  it('renders the word study view with the module on (the panel activates the module)', async () => {
    const { featureModules } = await boot('');
    await renderPanel();
    expect(await screen.findByTestId('word-study-pane')).toBeInTheDocument();
    await waitFor(() => expect(featureModules.isActive('word-study')).toBe(true));
  }, 60_000);

  it('degrades to the unavailable placeholder with the module off', async () => {
    await boot('-word-study');
    await act(async () => { await renderPanel(); });
    expect(screen.getByTestId('panel-unavailable')).toHaveAttribute('data-panel-type', 'wordStudy');
    expect(screen.queryByTestId('word-study-pane')).toBeNull();
  }, 60_000);
});
