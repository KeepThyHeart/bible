/**
 * The header's `?` opens a panel, not the tour.
 *
 * Starting the guided tour directly would make the one obvious "I need help"
 * affordance mean exactly one thing - and the wrong one for most of the
 * moments a reader reaches for it. These tests pin the panel's contents,
 * and in particular that the two build-configured rows disappear rather than
 * turning into dead links when this build has not set them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../contexts/useI18n', () => ({
  useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => enT(key, params), locale: 'en', i18n: {} }),
}));

let config = {
  productName: 'Keep Thy Heart Bible Reader',
  appVersion: '1.2.3',
  copyrightYear: '2026',
  issueReportTarget: '',
  moduleCatalogUrl: '',
  docsUrl: '',
  aboutText: '',
};

vi.mock('../config/appConfig', async () => {
  const actual = await vi.importActual<typeof import('../config/appConfig')>('../config/appConfig');
  return {
    ...actual,
    getAppConfig: () => config,
    getProductName: () => config.productName,
    getDocsUrl: () => (config.docsUrl === '' ? undefined : config.docsUrl),
    getAboutText: () => (config.aboutText === '' ? undefined : config.aboutText),
    getIssueReportUrl: () =>
      config.issueReportTarget === '' ? undefined : config.issueReportTarget,
  };
});

import HelpPanel from './HelpPanel';
import { enT } from '../testing/enCatalog';

const invoke = vi.fn().mockResolvedValue(undefined);

// `window.electron` is installed by the test setup as a non-configurable
// property, so it is swapped in place and restored rather than deleted.
let originalElectron: unknown;

function setConfig(overrides: Partial<typeof config>): void {
  config = { ...config, ...overrides };
}

describe('HelpPanel', () => {
  beforeEach(() => {
    invoke.mockClear();
    const w = window as unknown as { electron?: unknown };
    originalElectron = w.electron;
    w.electron = { ipcRenderer: { invoke } };
    setConfig({ issueReportTarget: '', docsUrl: '', aboutText: '', appVersion: '1.2.3' });
  });

  afterEach(() => {
    (window as unknown as { electron?: unknown }).electron = originalElectron;
  });

  it('lists the always-available help entries', () => {
    render(<HelpPanel onClose={vi.fn()} />);

    expect(screen.getByRole('menuitem', { name: /Documentation/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Take a tour/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Keyboard shortcuts/ })).toBeInTheDocument();
  });

  it('starts the tour through the same command the menu bar uses', () => {
    const onClose = vi.fn();
    const listener = vi.fn();
    window.addEventListener('command:app:startTour', listener);

    render(<HelpPanel onClose={onClose} />);
    fireEvent.click(screen.getByRole('menuitem', { name: /Take a tour/ }));

    expect(listener).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    window.removeEventListener('command:app:startTour', listener);
  });

  // A row that opens nothing is worse than no row.
  it('omits the docs-site row when this build has no documentation URL', () => {
    render(<HelpPanel onClose={vi.fn()} />);
    expect(screen.queryByRole('menuitem', { name: /Documentation website/ })).not.toBeInTheDocument();
  });

  it('offers the docs site when one is configured, and opens it externally', () => {
    setConfig({ docsUrl: 'https://docs.example.com' });
    render(<HelpPanel onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('menuitem', { name: /Documentation website/ }));
    expect(invoke).toHaveBeenCalledWith('app:open-external', 'https://docs.example.com');
  });

  it('omits the issue row when no issue target is configured', () => {
    render(<HelpPanel onClose={vi.fn()} />);
    expect(screen.queryByRole('menuitem', { name: /Report an issue/ })).not.toBeInTheDocument();
  });

  it('shows the build blurb when one is configured', () => {
    setConfig({ aboutText: 'A modern, open-source Bible study app.' });
    render(<HelpPanel onClose={vi.fn()} />);
    expect(screen.getByText('A modern, open-source Bible study app.')).toBeInTheDocument();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<HelpPanel onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
