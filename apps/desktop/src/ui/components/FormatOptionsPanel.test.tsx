import { describe, it, expect, vi } from 'vitest';
import { render as rtlRender, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import FormatOptionsPanel from './FormatOptionsPanel';
import type { FormatOptions } from '../services/verseCopyService';
import { ContextProvider, type AppServices } from '../contexts/ContextProvider';
import enUi from '../../../locales/en/ui.json';

// The labels are catalog data, so the stub resolves against the real `en`
// catalog rather than a hand-written map: a mistyped key renders `[key]` and
// fails the assertion instead of silently matching a copy of the same typo.
const catalog = enUi as Record<string, string>;

function createMockServices(): AppServices {
  return {
    registry: {} as AppServices['registry'],
    whenContext: {} as AppServices['whenContext'],
    keybindings: {} as AppServices['keybindings'],
    i18n: {
      t: (key: string) => catalog[key] ?? `[${key}]`,
      currentLocale: 'en' as const,
      onDidChangeLocale: () => ({ dispose: vi.fn() }),
      resolve: (v: unknown) => String(v),
      loadCatalog: vi.fn(),
      setLocale: vi.fn(),
    } as unknown as AppServices['i18n'],
  };
}

function render(ui: ReactElement) {
  return rtlRender(<ContextProvider services={createMockServices()}>{ui}</ContextProvider>);
}

describe('FormatOptionsPanel', () => {
  const defaultOptions: FormatOptions = {
    displayVersionNumber: true,
    wordsOfChristInRed: false,
  };

  it('renders checkboxes with correct initial state', () => {
    const onOptionsChange = vi.fn();
    render(
      <FormatOptionsPanel options={defaultOptions} onOptionsChange={onOptionsChange} />
    );

    const versionCheckbox = screen.getByRole('checkbox', {
      name: /Display translation/i,
    }) as HTMLInputElement;
    const christCheckbox = screen.getByRole('checkbox', {
      name: /Words of Christ in red/i,
    }) as HTMLInputElement;

    expect(versionCheckbox.checked).toBe(true);
    expect(christCheckbox.checked).toBe(false);
  });

  it('calls onOptionsChange when toggling displayVersionNumber', async () => {
    const user = userEvent.setup();
    const onOptionsChange = vi.fn();
    render(
      <FormatOptionsPanel options={defaultOptions} onOptionsChange={onOptionsChange} />
    );

    const checkbox = screen.getByRole('checkbox', {
      name: /Display translation/i,
    });
    await user.click(checkbox);

    expect(onOptionsChange).toHaveBeenCalledWith({
      displayVersionNumber: false,
      wordsOfChristInRed: false,
    });
  });

  it('calls onOptionsChange when toggling wordsOfChristInRed', async () => {
    const user = userEvent.setup();
    const onOptionsChange = vi.fn();
    render(
      <FormatOptionsPanel options={defaultOptions} onOptionsChange={onOptionsChange} />
    );

    const checkbox = screen.getByRole('checkbox', {
      name: /Words of Christ in red/i,
    });
    await user.click(checkbox);

    expect(onOptionsChange).toHaveBeenCalledWith({
      displayVersionNumber: true,
      wordsOfChristInRed: true,
    });
  });

  it('displays note text about format options', () => {
    const onOptionsChange = vi.fn();
    render(
      <FormatOptionsPanel options={defaultOptions} onOptionsChange={onOptionsChange} />
    );

    expect(
      screen.getByText(/Not all options affect all formats/i)
    ).toBeInTheDocument();
  });

  it('renders as collapsible when showAsCollapsible is true', () => {
    const onOptionsChange = vi.fn();
    render(
      <FormatOptionsPanel
        options={defaultOptions}
        onOptionsChange={onOptionsChange}
        showAsCollapsible={true}
      />
    );

    expect(screen.getByText(/Options/i)).toBeInTheDocument();
  });

  it('expands and collapses collapsible panel', async () => {
    const user = userEvent.setup();
    const onOptionsChange = vi.fn();
    render(
      <FormatOptionsPanel
        options={defaultOptions}
        onOptionsChange={onOptionsChange}
        showAsCollapsible={true}
      />
    );

    const button = screen.getByText(/Options/i).closest('button');
    expect(button).toBeInTheDocument();

    // Initially collapsed (isExpanded = !showAsCollapsible = false)
    expect(screen.queryByText(/Not all options affect all formats/i)).not.toBeInTheDocument();

    // Click to expand
    await user.click(button!);

    // After clicking, should expand
    expect(screen.getByText(/Not all options affect all formats/i)).toBeInTheDocument();
  });

  it('starts expanded when showAsCollapsible is false (default)', () => {
    const onOptionsChange = vi.fn();
    render(
      <FormatOptionsPanel
        options={defaultOptions}
        onOptionsChange={onOptionsChange}
        showAsCollapsible={false}
      />
    );

    expect(
      screen.getByText(/Not all options affect all formats/i)
    ).toBeInTheDocument();
  });
});
