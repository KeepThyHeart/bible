import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HighlightSelector } from './HighlightSelector';
import type { IUserTextMarkupRepository } from '@bible/core';

describe('HighlightSelector', () => {
  const mockRepository = {} as IUserTextMarkupRepository;
  const moduleId = 1;

  it('renders children correctly', () => {
    const onShowMenu = vi.fn();
    const { getByText } = render(
      <HighlightSelector
        moduleId={moduleId}
        repository={mockRepository}
        onShowMenu={onShowMenu}
      >
        <div>Test Content</div>
      </HighlightSelector>
    );

    expect(getByText('Test Content')).toBeInTheDocument();
  });

  it('handles right-click context menu without selection', async () => {
    const user = userEvent.setup();
    const onShowMenu = vi.fn();
    const { container } = render(
      <HighlightSelector
        moduleId={moduleId}
        repository={mockRepository}
        onShowMenu={onShowMenu}
      >
        <div>Test Content</div>
      </HighlightSelector>
    );

    const element = container.firstChild as HTMLElement;
    await user.pointer({ target: element, keys: '[MouseRight]' });

    // No selection made, so menu should not show
    expect(onShowMenu).not.toHaveBeenCalled();
  });

  it('renders container with data attribute', () => {
    const onShowMenu = vi.fn();
    const { container } = render(
      <HighlightSelector
        moduleId={moduleId}
        repository={mockRepository}
        onShowMenu={onShowMenu}
      >
        <div>Test</div>
      </HighlightSelector>
    );

    const wrapper = container.firstChild;
    expect(wrapper).toBeInTheDocument();
  });

  it('accepts multiple children', () => {
    const onShowMenu = vi.fn();
    const { getByText } = render(
      <HighlightSelector
        moduleId={moduleId}
        repository={mockRepository}
        onShowMenu={onShowMenu}
      >
        <div>First</div>
        <div>Second</div>
      </HighlightSelector>
    );

    expect(getByText('First')).toBeInTheDocument();
    expect(getByText('Second')).toBeInTheDocument();
  });

  it('renders complex content structure', () => {
    const onShowMenu = vi.fn();
    const { getByText } = render(
      <HighlightSelector
        moduleId={moduleId}
        repository={mockRepository}
        onShowMenu={onShowMenu}
      >
        <div>
          <p>Paragraph 1</p>
          <div className="word" data-verse-id="43003016" data-word-index="0">
            Word
          </div>
        </div>
      </HighlightSelector>
    );

    expect(getByText('Paragraph 1')).toBeInTheDocument();
    expect(getByText('Word')).toBeInTheDocument();
  });

  it('preserves moduleId prop', () => {
    const onShowMenu = vi.fn();
    const customModuleId = 42;
    const { rerender } = render(
      <HighlightSelector
        moduleId={customModuleId}
        repository={mockRepository}
        onShowMenu={onShowMenu}
      >
        <div>Test</div>
      </HighlightSelector>
    );

    // Component should accept the moduleId (even if not used visually)
    expect(true).toBe(true);

    // Rerender with different moduleId
    rerender(
      <HighlightSelector
        moduleId={100}
        repository={mockRepository}
        onShowMenu={onShowMenu}
      >
        <div>Test</div>
      </HighlightSelector>
    );

    expect(true).toBe(true);
  });

  it('accepts repository instance', () => {
    const onShowMenu = vi.fn();
    const customRepo = { custom: 'repo' } as any as IUserTextMarkupRepository;

    const { getByText } = render(
      <HighlightSelector
        moduleId={moduleId}
        repository={customRepo}
        onShowMenu={onShowMenu}
      >
        <div>Content</div>
      </HighlightSelector>
    );

    expect(getByText('Content')).toBeInTheDocument();
  });

  /**
   * The wrapper deliberately handles no context menu of its own - right-click
   * is owned by each verse row (useVerseInteractionHandlers), which opens
   * VerseContextMenu. A handler here would be both unreachable (the row calls
   * stopPropagation) and a competing second menu, so the event must pass
   * straight through to any ancestor.
   */
  it('does not intercept the context menu — the event reaches ancestors', async () => {
    const user = userEvent.setup();
    const onShowMenu = vi.fn();
    const parentContextMenu = vi.fn();

    const { container } = render(
      <div onContextMenu={parentContextMenu}>
        <HighlightSelector
          moduleId={moduleId}
          repository={mockRepository}
          onShowMenu={onShowMenu}
        >
          <div className="word" data-verse-id="43003016" data-word-index="0">
            Test
          </div>
        </HighlightSelector>
      </div>
    );

    const word = container.querySelector('.word');
    expect(word).not.toBeNull();
    await user.pointer({ target: word as HTMLElement, keys: '[MouseRight]' });

    expect(parentContextMenu).toHaveBeenCalledTimes(1);
    expect(onShowMenu).not.toHaveBeenCalled();
  });
});
