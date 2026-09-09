/**
 * Tests for the extension marketplace UI.
 *
 * The assertions that matter here are the ones about *what the user is told*
 * and *what the UI is willing to send*: that a catalog the user added is never
 * dressed up as reviewed, that ticking the risk box is what produces
 * `acknowledgeRisk: true` (and not ticking it produces `false`), and that an
 * unconfirmed source cannot be refreshed from the UI at all. Those are the
 * parts a well-meaning refactor is most likely to quietly soften.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ExtensionCatalogBrowser } from './ExtensionCatalogBrowser';
import { ExtensionCatalogSources } from './ExtensionCatalogSources';
import { ContextProvider, type AppServices } from '../../contexts/ContextProvider';
import type { CatalogListing, CatalogSource } from './marketplaceTypes';
import { enT } from '../../testing/enCatalog';

function createMockServices(): AppServices {
  return {
    registry: {} as AppServices['registry'],
    whenContext: {} as AppServices['whenContext'],
    keybindings: {} as AppServices['keybindings'],
    i18n: {
      t: (key: string, params?: Record<string, unknown>) => enT(key, params),
      currentLocale: 'en' as const,
      onDidChangeLocale: () => ({ dispose: vi.fn() }),
      resolve: (v: unknown) => String(v),
      loadCatalog: vi.fn(),
      setLocale: vi.fn(),
    } as unknown as AppServices['i18n'],
  };
}

function renderWithProviders(ui: React.ReactElement) {
  return render(<ContextProvider services={createMockServices()}>{ui}</ContextProvider>);
}

interface CatalogApi {
  listSources: ReturnType<typeof vi.fn>;
  addSource: ReturnType<typeof vi.fn>;
  acknowledgeRisk: ReturnType<typeof vi.fn>;
  removeSource: ReturnType<typeof vi.fn>;
  refresh: ReturnType<typeof vi.fn>;
  refreshAll: ReturnType<typeof vi.fn>;
  listAvailable: ReturnType<typeof vi.fn>;
  install: ReturnType<typeof vi.fn>;
}

/**
 * The catalogs put two spaces after a full stop; Testing Library compares against
 * whitespace-normalised text. Collapsing here lets the assertion name the catalog
 * key rather than a copy of the sentence that goes stale on the next rewording.
 */
const collapseSpaces = (text: string): string => text.replace(/\s+/g, ' ').trim();

let catalog: CatalogApi;
let blocklistList: ReturnType<typeof vi.fn>;

function listing(overrides: Partial<CatalogListing> = {}): CatalogListing {
  return {
    id: 'ext.example.hello',
    version: '1.0.0',
    name: 'Hello',
    description: 'Says hello',
    downloadUrl: 'https://example.com/hello-1.0.0.zip',
    sha256: 'a'.repeat(64),
    sizeBytes: 20480,
    permissions: ['bible:read'],
    sourceUrl: 'https://example.com/catalog.json',
    fromDefaultCatalog: true,
    ...overrides,
  };
}

function source(overrides: Partial<CatalogSource> = {}): CatalogSource {
  return {
    url: 'https://example.com/catalog.json',
    isDefault: false,
    addedAt: 1_700_000_000_000,
    riskAcknowledgedAt: 1_700_000_000_000,
    hasCachedDocument: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  catalog = {
    listSources: vi.fn().mockResolvedValue([]),
    addSource: vi.fn().mockResolvedValue({ ok: true, source: source() }),
    acknowledgeRisk: vi.fn().mockResolvedValue({ ok: true }),
    removeSource: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue({ ok: true, url: 'https://example.com/catalog.json' }),
    refreshAll: vi.fn().mockResolvedValue([]),
    listAvailable: vi.fn().mockResolvedValue([]),
    install: vi.fn().mockResolvedValue({ ok: true, state: {} }),
  };
  blocklistList = vi.fn().mockResolvedValue([]);
  (window as unknown as { electron: unknown }).electron = {
    extensions: {
      catalog,
      blocklist: { list: blocklistList, checkInstalled: vi.fn().mockResolvedValue({}) },
    },
  };
});

describe('ExtensionCatalogBrowser', () => {
  it('shows the empty state when nothing is cached', async () => {
    renderWithProviders(<ExtensionCatalogBrowser installedIds={[]} />);
    expect(await screen.findByTestId('extension-catalog-browser-empty')).toBeInTheDocument();
  });

  it('renders a listing with its id, size and source host', async () => {
    catalog.listAvailable.mockResolvedValue([listing()]);
    renderWithProviders(<ExtensionCatalogBrowser installedIds={[]} />);

    expect(await screen.findByTestId('extension-listing-ext.example.hello')).toBeInTheDocument();
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Says hello')).toBeInTheDocument();
    expect(screen.getByText(/20 KB/)).toBeInTheDocument();
    expect(screen.getByText(/example\.com/)).toBeInTheDocument();
  });

  it('labels a listing from a user-added catalog as unreviewed', async () => {
    catalog.listAvailable.mockResolvedValue([listing({ fromDefaultCatalog: false })]);
    renderWithProviders(<ExtensionCatalogBrowser installedIds={[]} />);

    const badge = await screen.findByTestId('extension-listing-source-badge');
    expect(badge).toHaveAttribute('data-from-default', 'false');
    expect(badge).toHaveTextContent('Unreviewed catalog');
  });

  it('labels a listing from the default catalog as marketplace', async () => {
    catalog.listAvailable.mockResolvedValue([listing({ fromDefaultCatalog: true })]);
    renderWithProviders(<ExtensionCatalogBrowser installedIds={[]} />);

    const badge = await screen.findByTestId('extension-listing-source-badge');
    expect(badge).toHaveAttribute('data-from-default', 'true');
    expect(badge).toHaveTextContent('Marketplace');
  });

  it('installs by id and source url, and says the result is disabled', async () => {
    const user = userEvent.setup();
    catalog.listAvailable.mockResolvedValue([listing()]);
    const onInstalled = vi.fn();
    renderWithProviders(
      <ExtensionCatalogBrowser installedIds={[]} onInstalled={onInstalled} />,
    );

    await user.click(await screen.findByTestId('extension-listing-install-ext.example.hello'));

    expect(catalog.install).toHaveBeenCalledWith(
      'ext.example.hello',
      'https://example.com/catalog.json',
    );
    const notice = await screen.findByTestId('extension-catalog-installed-notice');
    expect(notice).toHaveTextContent(/disabled until you enable it/i);
    expect(onInstalled).toHaveBeenCalled();
  });

  it('does not offer to install something already installed', async () => {
    catalog.listAvailable.mockResolvedValue([listing()]);
    renderWithProviders(<ExtensionCatalogBrowser installedIds={['ext.example.hello']} />);

    const button = await screen.findByTestId('extension-listing-install-ext.example.hello');
    expect(button).toBeDisabled();
    expect(screen.getByTestId('extension-listing-installed-badge')).toBeInTheDocument();
  });

  it('treats a declined permission prompt as a decision, not an error', async () => {
    const user = userEvent.setup();
    catalog.listAvailable.mockResolvedValue([listing()]);
    catalog.install.mockResolvedValue({
      ok: false,
      code: 'ConsentDenied',
      message: 'User declined',
    });
    renderWithProviders(<ExtensionCatalogBrowser installedIds={[]} />);

    await user.click(await screen.findByTestId('extension-listing-install-ext.example.hello'));

    await waitFor(() => expect(catalog.install).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('surfaces a hash mismatch as an error', async () => {
    const user = userEvent.setup();
    catalog.listAvailable.mockResolvedValue([listing()]);
    catalog.install.mockResolvedValue({
      ok: false,
      code: 'HashMismatch',
      message: 'The download did not match the catalog checksum and was discarded.',
    });
    renderWithProviders(<ExtensionCatalogBrowser installedIds={[]} />);

    await user.click(await screen.findByTestId('extension-listing-install-ext.example.hello'));

    expect(await screen.findByRole('alert')).toHaveTextContent(/did not match/i);
  });

  it('filters listings by name', async () => {
    const user = userEvent.setup();
    catalog.listAvailable.mockResolvedValue([
      listing(),
      listing({ id: 'ext.other.thing', name: 'Something Else' }),
    ]);
    renderWithProviders(<ExtensionCatalogBrowser installedIds={[]} />);

    await screen.findByTestId('extension-listing-ext.example.hello');
    await user.type(screen.getByTestId('extension-catalog-filter'), 'Something');

    expect(screen.queryByTestId('extension-listing-ext.example.hello')).not.toBeInTheDocument();
    expect(screen.getByTestId('extension-listing-ext.other.thing')).toBeInTheDocument();
  });
});

describe('ExtensionCatalogSources', () => {
  it('explains that this build has no default catalog when the list is empty', async () => {
    renderWithProviders(<ExtensionCatalogSources />);
    expect(await screen.findByTestId('extension-catalog-sources-empty')).toBeInTheDocument();
  });

  it('marks an unacknowledged source as unconfirmed and refuses to refresh it', async () => {
    catalog.listSources.mockResolvedValue([
      source({ riskAcknowledgedAt: undefined, hasCachedDocument: false }),
    ]);
    renderWithProviders(<ExtensionCatalogSources />);

    expect(await screen.findByTestId('extension-catalog-unconfirmed-badge')).toBeInTheDocument();
    expect(screen.getByTestId('extension-catalog-refresh')).toBeDisabled();
    expect(catalog.refresh).not.toHaveBeenCalled();
  });

  it('confirms an unacknowledged source through acknowledgeRisk', async () => {
    const user = userEvent.setup();
    catalog.listSources.mockResolvedValue([source({ riskAcknowledgedAt: undefined })]);
    renderWithProviders(<ExtensionCatalogSources />);

    await user.click(await screen.findByTestId('extension-catalog-confirm'));

    expect(catalog.acknowledgeRisk).toHaveBeenCalledWith('https://example.com/catalog.json');
  });

  it('forwards acknowledgeRisk=false when the user has not ticked the box', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ExtensionCatalogSources />);

    await user.click(await screen.findByTestId('extension-catalog-add-toggle'));
    await user.type(
      screen.getByTestId('extension-catalog-url-input'),
      'https://other.example/catalog.json',
    );
    await user.click(screen.getByTestId('extension-catalog-add-submit'));

    expect(catalog.addSource).toHaveBeenCalledWith(
      'https://other.example/catalog.json',
      undefined,
      false,
    );
  });

  it('forwards acknowledgeRisk=true only after the box is ticked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ExtensionCatalogSources />);

    await user.click(await screen.findByTestId('extension-catalog-add-toggle'));
    await user.type(
      screen.getByTestId('extension-catalog-url-input'),
      'https://other.example/catalog.json',
    );
    await user.click(screen.getByTestId('extension-catalog-risk-checkbox'));
    await user.click(screen.getByTestId('extension-catalog-add-submit'));

    expect(catalog.addSource).toHaveBeenCalledWith(
      'https://other.example/catalog.json',
      undefined,
      true,
    );
  });

  it('shows the risk warning text before the box can be ticked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ExtensionCatalogSources />);

    await user.click(await screen.findByTestId('extension-catalog-add-toggle'));

    expect(screen.getByText(collapseSpaces(enT('extensions.catalogs.riskBody')))).toBeInTheDocument();
  });

  it('surfaces an add failure from the host', async () => {
    const user = userEvent.setup();
    catalog.addSource.mockResolvedValue({
      ok: false,
      code: 'InvalidUrl',
      message: 'A catalog URL must be an absolute https URL.',
    });
    renderWithProviders(<ExtensionCatalogSources />);

    await user.click(await screen.findByTestId('extension-catalog-add-toggle'));
    await user.type(screen.getByTestId('extension-catalog-url-input'), 'http://insecure/c.json');
    await user.click(screen.getByTestId('extension-catalog-add-submit'));

    expect(await screen.findByRole('alert')).toHaveTextContent(/absolute https URL/i);
  });

  it('will not offer to remove the app default catalog', async () => {
    catalog.listSources.mockResolvedValue([source({ isDefault: true, label: 'Official' })]);
    renderWithProviders(<ExtensionCatalogSources />);

    expect(await screen.findByTestId('extension-catalog-default-badge')).toBeInTheDocument();
    expect(screen.queryByTestId('extension-catalog-remove')).not.toBeInTheDocument();
  });

  it('warns that a non-default catalog is no better than a sideload', async () => {
    catalog.listSources.mockResolvedValue([source()]);
    renderWithProviders(<ExtensionCatalogSources />);

    expect(
      await screen.findByText(/treated the same as a sideloaded file/i),
    ).toBeInTheDocument();
  });

  it('reports when no block rules are in force', async () => {
    renderWithProviders(<ExtensionCatalogSources />);
    expect(await screen.findByTestId('extension-blocklist-empty')).toBeInTheDocument();
  });

  it('lists block rules with their version range and reason', async () => {
    blocklistList.mockResolvedValue([
      { id: 'ext.bad.one', versions: '>=1.4.0 <1.4.3', reason: 'Corrupts notes on save' },
    ]);
    renderWithProviders(<ExtensionCatalogSources />);

    expect(await screen.findByText('ext.bad.one')).toBeInTheDocument();
    expect(screen.getByText(/>=1.4.0 <1.4.3/)).toBeInTheDocument();
    expect(screen.getByText(/Corrupts notes on save/)).toBeInTheDocument();
  });

  it('says the blocklist only arrives with a manual update check', async () => {
    renderWithProviders(<ExtensionCatalogSources />);
    expect(
      await screen.findByText(/only when you use Help ▸ Check for Updates/i),
    ).toBeInTheDocument();
  });
});
