import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DocumentationDialog from './DocumentationDialog';
import { ContextProvider, type AppServices } from '../contexts/ContextProvider';
import { enT } from '../testing/enCatalog';
import { buildDocumentation } from './DocumentationDialog/content';

const services = {
  registry: {}, whenContext: {}, keybindings: {},
  i18n: {
    t: (key: string, params?: Record<string, unknown>) => enT(key, params),
    currentLocale: 'en', onDidChangeLocale: () => ({ dispose: vi.fn() }),
    resolve: (v: unknown) => String(v), loadCatalog: vi.fn(), setLocale: vi.fn(),
  },
} as unknown as AppServices;
const renderDlg = () => render(<ContextProvider services={services}><DocumentationDialog onClose={vi.fn()} /></ContextProvider>);

describe('DocumentationDialog focus and name (B-112)', () => {
  it('has an accessible name and focuses inside on open', async () => {
    renderDlg();
    const dlg = screen.getByRole('dialog');
    const labelId = dlg.getAttribute('aria-labelledby')!;
    expect(document.getElementById(labelId)?.textContent?.trim().length).toBeGreaterThan(0);
    await waitFor(() => expect(dlg.contains(document.activeElement) && document.activeElement !== dlg).toBe(true));
  });

  it('Tab never leaves the dialog', async () => {
    const user = userEvent.setup();
    renderDlg();
    const dlg = screen.getByRole('dialog');
    await waitFor(() => expect(dlg.contains(document.activeElement)).toBe(true));
    for (let i = 0; i < 60; i++) {
      await user.tab();
      expect(dlg.contains(document.activeElement)).toBe(true);
    }
  });
});

describe('DocumentationDialog search keeps the current item visible', () => {
  it('moves the current marker to the first visible section when the current one is filtered out', async () => {
    const user = userEvent.setup();
    renderDlg();
    const docs = buildDocumentation((k: string, p?: Record<string, unknown>) => enT(k, p));
    const nav = screen.getByRole('navigation');
    const itemsBefore = Array.from(nav.querySelectorAll('button'));
    expect(itemsBefore[0]).toHaveAttribute('aria-current', 'true');

    // A query only the last section's title satisfies, so the first section drops out.
    const last = docs[docs.length - 1];
    await user.type(screen.getByRole('textbox'), last.title);

    const items = Array.from(nav.querySelectorAll('button'));
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThan(itemsBefore.length);
    expect(items.some((b) => b.textContent?.includes(docs[0].title))).toBe(false);
    const current = items.filter((b) => b.getAttribute('aria-current') === 'true');
    expect(current).toHaveLength(1);
    expect(current[0]).toBe(items[0]);
  });
});
