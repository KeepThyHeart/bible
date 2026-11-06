/**
 * TextInputDialog backs "Rename" and "New Folder" in Notes: it must be a real
 * modal (background inert, Escape closes) and its input must have a name.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TextInputDialog from './TextInputDialog';
import { ContextProvider, type AppServices } from '../contexts/ContextProvider';

function createMockServices(): AppServices {
  return {
    registry: {} as AppServices['registry'],
    whenContext: {} as AppServices['whenContext'],
    keybindings: {} as AppServices['keybindings'],
    i18n: {
      t: (key: string) => key,
      currentLocale: 'en' as const,
      onDidChangeLocale: () => ({ dispose: vi.fn() }),
      resolve: (v: unknown) => String(v),
      loadCatalog: vi.fn(),
      setLocale: vi.fn(),
    } as unknown as AppServices['i18n'],
  };
}

function renderDialog(onCancel = vi.fn()) {
  return render(
    <ContextProvider services={createMockServices()}>
      <button>behind</button>
      <TextInputDialog isOpen title="Rename" label="New name:" initialValue="a" onConfirm={vi.fn()} onCancel={onCancel} />
    </ContextProvider>,
  );
}

describe('TextInputDialog', () => {
  it('gives the input an accessible name from its label', () => {
    renderDialog();
    expect(screen.getByRole('textbox', { name: 'New name:' })).toBeInTheDocument();
  });

  it('makes the background inert while open', () => {
    renderDialog();
    const behind = screen.getByText('behind');
    expect(behind.closest('[inert]')).not.toBeNull();
  });

  it('closes on Escape exactly once', () => {
    const onCancel = vi.fn();
    renderDialog(onCancel);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
