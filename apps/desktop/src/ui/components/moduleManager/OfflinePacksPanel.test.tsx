import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { IPackInstaller, IPackSource, PackOffer } from '@bible/core/browser';
import { OfflinePacksPanel } from './OfflinePacksPanel';
import { ContextProvider, type AppServices } from '../../contexts/ContextProvider';
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

function setup(installer: IPackInstaller['install']) {
  const source: IPackSource = {
    listOffers: async () => [offer('kjv', 'King James'), offer('web', 'World English')],
    listPresets: async () => [{ id: 'basic', name: 'Basics', items: [{ kind: 'module', id: 'kjv' }] }],
    freeBytes: async () => null,
  };
  render(
    <ContextProvider services={services}>
      <OfflinePacksPanel source={source} installers={{ module: { install: installer } }} />
    </ContextProvider>
  );
}

describe('OfflinePacksPanel', () => {
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
});
