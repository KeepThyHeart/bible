import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { IPackInstaller, IPackSource, PackOffer } from '@bible/core/browser';
import { OfflinePacksPanel } from './OfflinePacksPanel';
import { ContextProvider, type AppServices } from '../../contexts/ContextProvider';
import { setCurrentPackRun } from '../../services/desktopPackRun';
import { enT } from '../../testing/enCatalog';

const services: AppServices = {
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

const offer = (id: string, title: string, over: Partial<PackOffer> = {}): PackOffer => ({
  ref: { kind: 'module', id },
  key: `module:${id}`,
  title,
  group: 'bible',
  language: 'en',
  version: '1',
  downloadBytes: 50 * 1024 * 1024,
  storedBytes: 100 * 1024 * 1024,
  offlineReadable: true,
  status: 'absent',
  ...over,
});

function setup(
  installer: IPackInstaller['install'],
  offers: PackOffer[] = [offer('kjv', 'King James'), offer('web', 'World English')],
  presetItems: string[] = ['kjv'],
) {
  const source: IPackSource = {
    listOffers: async () => offers,
    listPresets: async () => [
      { id: 'basic', name: 'Basics', description: 'A Bible to start with', items: presetItems.map((id) => ({ kind: 'module' as const, id })) },
    ],
    freeBytes: async () => null,
  };
  const ui = (
    <ContextProvider services={services}>
      <OfflinePacksPanel source={source} installers={{ module: { install: installer } }} />
    </ContextProvider>
  );
  return render(ui);
}

describe('OfflinePacksPanel', () => {
  beforeEach(() => setCurrentPackRun(null));

  it('lists offers, selects one, shows totals and runs the install', async () => {
    const install = vi.fn(async (_s, ctx) => {
      ctx.onBytes(25 * 1024 * 1024, 50 * 1024 * 1024);
    });
    setup(install);
    const user = userEvent.setup();
    await screen.findByText('King James');
    expect(screen.getByRole('button', { name: 'Install selected' })).toBeDisabled();

    await user.click(screen.getByLabelText(/King James/));
    expect(screen.getByText('Download: 50 MB')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Install selected' }));
    await waitFor(() => expect(install).toHaveBeenCalledTimes(1));
    expect(install.mock.calls[0][0].key).toBe('module:kjv');
    await screen.findByText('Everything is installed.');
  });

  it('applies a preset', async () => {
    setup(vi.fn(async () => undefined));
    const user = userEvent.setup();
    await screen.findByText('King James');
    await user.click(screen.getByRole('button', { name: 'Basics' }));
    expect(screen.getByLabelText(/King James/)).toBeChecked();
    expect(screen.getByLabelText(/World English/)).not.toBeChecked();
  });

  it('keeps the run alive across unmount and re-attaches on remount', async () => {
    let release!: () => void;
    let signal: AbortSignal | undefined;
    const install = vi.fn(
      (_s, ctx) =>
        new Promise<void>((r) => {
          signal = ctx.signal;
          release = r;
        })
    );
    const first = setup(install);
    const user = userEvent.setup();
    await screen.findByText('King James');
    await user.click(screen.getByLabelText(/King James/));
    await user.click(screen.getByRole('button', { name: 'Install selected' }));
    await waitFor(() => expect(install).toHaveBeenCalledTimes(1));

    first.unmount();
    expect(signal?.aborted).toBe(false);

    setup(install);
    await screen.findByText('Installing one module at a time');
    expect(screen.getByRole('button', { name: 'Install selected' })).toBeDisabled();
    release();
    await screen.findByText('Everything is installed.');
    expect(install).toHaveBeenCalledTimes(1);
  });

  it('names the tab content for what it is, and insets it like the other panels', async () => {
    setup(vi.fn(async () => undefined));
    await screen.findByText('King James');
    expect(screen.getByRole('heading', { name: 'Install a collection of modules' })).toBeInTheDocument();
    expect(screen.getByText(/A collection is a ready-made set of modules/)).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Choose a collection' })).toBeInTheDocument();
    expect(screen.getByTestId('module-manager-packs-panel')).toHaveClass('p-6');
    expect(screen.getByRole('button', { name: 'Basics' })).toHaveAttribute('title', 'A Bible to start with');
  });

  it('says what choosing a collection selected', async () => {
    setup(vi.fn(async () => undefined), undefined, ['kjv', 'web']);
    const user = userEvent.setup();
    await screen.findByText('King James');
    await user.click(screen.getByRole('button', { name: 'Basics' }));
    expect(screen.getByRole('button', { name: 'Basics' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Basics: 2 modules selected to install.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Install selected' })).toBeEnabled();
  });

  it('says so when everything in the collection is already installed, and leaves Install disabled', async () => {
    // The maintainer's case: most modules were already on disk, so clicking
    // "Essentials" changed nothing visible and looked broken.
    setup(vi.fn(async () => undefined), [offer('kjv', 'King James', { status: 'installed' }), offer('web', 'World English')]);
    const user = userEvent.setup();
    await screen.findByText('King James');
    await user.click(screen.getByRole('button', { name: 'Basics' }));
    expect(screen.getByText('You already have everything in Basics.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Install selected' })).toBeDisabled();
  });

  it('counts what is already installed separately', async () => {
    setup(vi.fn(async () => undefined), [offer('kjv', 'King James', { status: 'installed' }), offer('web', 'World English')], ['kjv', 'web']);
    const user = userEvent.setup();
    await screen.findByText('King James');
    await user.click(screen.getByRole('button', { name: 'Basics' }));
    expect(screen.getByText('Basics: 1 module selected to install; you already have the other 1.')).toBeInTheDocument();
  });

  it('explains a collection none of whose modules the catalogs offer', async () => {
    setup(vi.fn(async () => undefined), undefined, ['not_in_catalog']);
    const user = userEvent.setup();
    await screen.findByText('King James');
    await user.click(screen.getByRole('button', { name: 'Basics' }));
    expect(screen.getByText(/None of the modules in Basics are in your catalogs yet/)).toBeInTheDocument();
  });
});
