/**
 * Component tests for the shared module picker.
 *
 * This dialog was lifted out of CommentaryTabBar so the Dictionaries pane
 * could stop using an anchored dropdown that listed only unopened modules.
 * What matters here is the contract the two tab bars depend on: the checked
 * set is re-seeded from `selected` on every open, Apply hands back exactly the
 * boxes that are ticked, Cancel hands back nothing, and the caller's optional
 * renderers (display names, description, extra rows) reach the card.
 *
 * The keyboard listener is attached once on mount and reads the open flag from
 * a ref rather than being attached when the dialog opens, because Preact
 * flushes effects on an animation frame: an open-triggered listener is not
 * live for the first frames the dialog is on screen and Escape does nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/preact';
import type { ModuleSection } from '../../types';
import { ModuleSelectDialog } from './ModuleSelectDialog';

interface TestModule { abbreviation: string; name: string }

const MODULES: TestModule[] = [
  { abbreviation: 'MHC', name: 'Matthew Henry' },
  { abbreviation: 'TSK', name: 'Treasury of Scripture Knowledge' },
];

const LABELS = {
  title: 'Commentaries',
  filterPlaceholder: 'Filter...',
  noModules: 'No modules',
  noMatches: 'No matches',
  other: 'Other',
  cancel: 'Cancel',
  apply: 'Apply',
};

const onApply = vi.fn();
const onClose = vi.fn();

function renderDialog(props: Partial<Parameters<typeof ModuleSelectDialog<TestModule>>[0]> = {}) {
  return render(
    <ModuleSelectDialog<TestModule>
      isOpen
      modules={MODULES}
      selected={[]}
      labels={LABELS}
      onApply={onApply}
      onClose={onClose}
      {...props}
    />,
  );
}

/** The keydown listener is on `window`, which fireEvent does not target. */
const press = (key: string) => act(() => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
});

describe('ModuleSelectDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ------------------------------------------------------------------
  // Open / close
  // ------------------------------------------------------------------
  it('renders nothing when closed', () => {
    const { container } = renderDialog({ isOpen: false });
    expect(container.querySelector('.module-dialog-overlay')).toBeNull();
  });

  it('renders the title and one card per module when open', () => {
    const { container } = renderDialog();
    expect(container.querySelector('.module-dialog__header h3')?.textContent).toBe('Commentaries');
    expect(container.querySelectorAll('.module-card').length).toBe(2);
  });

  it('closes on Cancel, on the X, on the backdrop and on Escape', () => {
    const { container } = renderDialog();
    fireEvent.click(container.querySelector('.module-dialog__btn--cancel') as HTMLElement);
    fireEvent.click(container.querySelector('.module-dialog__close') as HTMLElement);
    fireEvent.click(container.querySelector('.module-dialog-overlay') as HTMLElement);
    press('Escape');
    expect(onClose).toHaveBeenCalledTimes(4);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('does not close when the dialog body itself is clicked', () => {
    const { container } = renderDialog();
    fireEvent.click(container.querySelector('.module-dialog') as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // Selection
  // ------------------------------------------------------------------
  it('checks the modules named in `selected`', () => {
    const { container } = renderDialog({ selected: ['TSK'] });
    const checked = container.querySelectorAll('.module-card__check--on');
    expect(checked.length).toBe(1);
    expect(container.querySelectorAll('.module-card')[1].querySelector('.module-card__check--on')).toBeTruthy();
  });

  it('applies the ticked set, additions and removals together', () => {
    const { container } = renderDialog({ selected: ['MHC'] });
    const cards = container.querySelectorAll('.module-card');
    fireEvent.click(cards[0]); // untick MHC
    fireEvent.click(cards[1]); // tick TSK
    fireEvent.click(container.querySelector('.module-dialog__btn--apply') as HTMLElement);
    expect(onApply).toHaveBeenCalledWith(new Set(['TSK']));
  });

  it('re-seeds the ticks from `selected` on each open, discarding an abandoned edit', () => {
    const { container, rerender } = render(
      <ModuleSelectDialog<TestModule>
        isOpen
        modules={MODULES}
        selected={['MHC']}
        labels={LABELS}
        onApply={onApply}
        onClose={onClose}
      />,
    );
    fireEvent.click(container.querySelectorAll('.module-card')[1]); // tick TSK, then walk away
    rerender(
      <ModuleSelectDialog<TestModule>
        isOpen={false}
        modules={MODULES}
        selected={['MHC']}
        labels={LABELS}
        onApply={onApply}
        onClose={onClose}
      />,
    );
    rerender(
      <ModuleSelectDialog<TestModule>
        isOpen
        modules={MODULES}
        selected={['MHC']}
        labels={LABELS}
        onApply={onApply}
        onClose={onClose}
      />,
    );
    expect(container.querySelectorAll('.module-card__check--on').length).toBe(1);
  });

  // ------------------------------------------------------------------
  // Filtering
  // ------------------------------------------------------------------
  it('filters on abbreviation and on name', () => {
    const { container } = renderDialog();
    const input = container.querySelector('input[type="text"]') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'tsk' } });
    expect(container.querySelectorAll('.module-card').length).toBe(1);
    fireEvent.input(input, { target: { value: 'henry' } });
    expect(container.querySelectorAll('.module-card')[0].textContent).toContain('MHC');
  });

  it('distinguishes "nothing installed" from "nothing matched"', () => {
    const empty = renderDialog({ modules: [] });
    expect(empty.container.querySelector('.module-dialog__empty')?.textContent).toBe('No modules');
    empty.unmount();

    const { container } = renderDialog();
    fireEvent.input(container.querySelector('input[type="text"]') as HTMLInputElement, {
      target: { value: 'ZZZ' },
    });
    expect(container.querySelector('.module-dialog__empty')?.textContent).toBe('No matches');
  });

  // ------------------------------------------------------------------
  // Sections
  // ------------------------------------------------------------------
  const SECTIONS: ModuleSection[] = [
    { title: 'Devotional', helpText: 'Warm and readable', modules: ['MHC'] },
  ];

  it('groups by section and files the rest under the "other" label', () => {
    const { container } = renderDialog({ sections: SECTIONS });
    const labels = [...container.querySelectorAll('.module-dialog__section-label')].map(e => e.textContent);
    expect(labels).toEqual(['Devotional', 'Other']);
    expect(container.querySelector('.module-dialog__section-help')?.textContent).toBe('Warm and readable');
  });

  it('drops the section grouping while a filter is typed', () => {
    const { container } = renderDialog({ sections: SECTIONS });
    fireEvent.input(container.querySelector('input[type="text"]') as HTMLInputElement, {
      target: { value: 'm' },
    });
    expect(container.querySelectorAll('.module-dialog__section-label').length).toBe(0);
  });

  // ------------------------------------------------------------------
  // Caller-supplied rendering
  // ------------------------------------------------------------------
  it('uses the caller-supplied labels, description and extra rows', () => {
    const { container } = renderDialog({
      getDisplayAbbr: m => `[${m.abbreviation}]`,
      getDisplayName: m => `${m.name}!`,
      getDescription: m => `about ${m.abbreviation}`,
      renderExtra: m => <span class="test-badge">{m.abbreviation}-badge</span>,
    });
    const first = container.querySelectorAll('.module-card')[0];
    expect(first.querySelector('.module-card__abbr')?.textContent).toBe('[MHC]');
    expect(first.querySelector('.module-card__name')?.textContent).toBe('Matthew Henry!');
    expect(first.querySelector('.module-card__desc')?.textContent).toBe('about MHC');
    expect(first.querySelector('.test-badge')?.textContent).toBe('MHC-badge');
  });

  it('omits the name line when it would only repeat the abbreviation', () => {
    const { container } = renderDialog({ modules: [{ abbreviation: 'KJV', name: 'KJV' }] });
    expect(container.querySelector('.module-card__name')).toBeNull();
  });

  // ------------------------------------------------------------------
  // Keyboard
  // ------------------------------------------------------------------
  it('moves focus with the arrow keys and toggles the focused card with Enter', () => {
    const { container } = renderDialog();
    press('ArrowDown');
    expect(container.querySelectorAll('.module-card')[0].className).toContain('module-card--focused');
    press('ArrowDown');
    expect(container.querySelectorAll('.module-card')[1].className).toContain('module-card--focused');
    press('Enter');
    fireEvent.click(container.querySelector('.module-dialog__btn--apply') as HTMLElement);
    expect(onApply).toHaveBeenCalledWith(new Set(['TSK']));
  });

  it('applies on Enter when no card is focused', () => {
    renderDialog({ selected: ['MHC'] });
    press('Enter');
    expect(onApply).toHaveBeenCalledWith(new Set(['MHC']));
  });

  it('ignores keys while closed', () => {
    renderDialog({ isOpen: false });
    press('Escape');
    press('Enter');
    expect(onClose).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });
});
