/**
 * Component tests for the translation picker.
 *
 * Two things here are easy to break and hard to notice. The first is the
 * filter's ranking: typing "KJV" has to put KJV above AKJV, and a plain
 * `Array.filter` gives no such guarantee — the fix is a three-tier sort
 * (exact, then prefix, then alphabetical) that nothing was checking.
 *
 * The second is the keyboard listener. It is attached once on mount and reads
 * the open flag from a ref, rather than being attached when the dialog opens,
 * because Preact flushes effects on an animation frame: an open-triggered
 * listener is not live for the first frames the dialog is on screen, and
 * Escape does nothing. That timing cannot be reproduced under a test renderer,
 * so what is asserted is the structural property that fixed it — one
 * registration, on mount, never re-registered.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/preact';
import type { ModuleSection } from '../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

vi.mock('../../hooks/useStore', () => ({
  useStore: (_store: unknown, selector: () => unknown) => selector(),
}));

vi.mock('../../moduleDescriptions', () => {
  const descriptions: Record<string, { tagline?: string; description: string }> = {
    KJV: { tagline: 'The classic', description: 'King James Version, 1611.' },
    WEB: { tagline: 'Modern and free', description: 'World English Bible.' },
    ASV: { description: 'American Standard Version, 1901.' },
  };
  return {
    RECOMMENDED_BIBLES: ['KJV', 'WEB'],
    getBibleDescription: (abbr: string) => descriptions[abbr],
  };
});

interface TestModule { abbreviation: string; name: string; type: string }

let mockModules: TestModule[] = [];
let mockSections: ModuleSection[] | null = null;
let mockDescriptions: Record<string, { description: string }> = {};

vi.mock('../../stores/moduleStore', () => ({
  moduleStore: {
    getBibleModules: () => mockModules,
    getBibleSections: () => mockSections,
    getModuleDescription: (_type: string, abbr: string) => mockDescriptions[abbr],
  },
}));

const { TranslationDialog } = await import('./TranslationDialog');

const mod = (abbreviation: string, name = abbreviation): TestModule => ({ abbreviation, name, type: 'bible' });

function open(props: Partial<{ currentAbbr: string; onClose: () => void; onSelect: (a: string) => void }> = {}) {
  return render(
    <TranslationDialog
      isOpen
      onClose={props.onClose ?? vi.fn()}
      currentAbbr={props.currentAbbr ?? 'KJV'}
      onSelect={props.onSelect ?? vi.fn()}
    />,
  );
}

const cards = (container: Element) => Array.from(container.querySelectorAll('.module-card'));
const abbrs = (container: Element) =>
  cards(container).map(c => c.querySelector('.module-card__abbr')?.textContent);

beforeEach(() => {
  mockModules = [mod('KJV', 'King James Version'), mod('ASV', 'American Standard'), mod('WEB', 'World English Bible')];
  mockSections = null;
  mockDescriptions = {};
});

afterEach(cleanup);

describe('open and close', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <TranslationDialog isOpen={false} onClose={vi.fn()} currentAbbr="KJV" onSelect={vi.fn()} />,
    );

    expect(container.innerHTML).toBe('');
  });

  it('lists the installed translations when open', () => {
    const { container } = open();

    expect(abbrs(container)).toEqual(expect.arrayContaining(['KJV', 'ASV', 'WEB']));
  });

  it('closes on the overlay', () => {
    const onClose = vi.fn();
    const { container } = open({ onClose });

    fireEvent.click(container.querySelector('.module-dialog-overlay')!);

    expect(onClose).toHaveBeenCalled();
  });

  it('does not close when the dialog body itself is clicked', () => {
    // The overlay's handler would otherwise fire on every click inside it,
    // closing the dialog the moment the reader touches the filter box.
    const onClose = vi.fn();
    const { container } = open({ onClose });

    fireEvent.click(container.querySelector('.module-dialog')!);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on the X button', () => {
    const onClose = vi.fn();
    const { container } = open({ onClose });

    fireEvent.click(container.querySelector('.module-dialog__close')!);

    expect(onClose).toHaveBeenCalled();
  });

  it('reports the chosen translation', () => {
    const onSelect = vi.fn();
    const { container } = open({ onSelect });

    fireEvent.click(cards(container).find(c => c.textContent?.includes('ASV'))!);

    expect(onSelect).toHaveBeenCalledWith('ASV');
  });

  it('checks the translation already in use', () => {
    const { container } = open({ currentAbbr: 'ASV' });

    const asv = cards(container).find(c => c.textContent?.includes('ASV'))!;
    expect(asv.querySelector('.module-card__check--on')).toBeTruthy();
    const kjv = cards(container).find(c => c.textContent?.includes('KJV'))!;
    expect(kjv.querySelector('.module-card__check--off')).toBeTruthy();
  });

  it('reads as a single choice, not a set of checkboxes', () => {
    const { container } = open({ currentAbbr: 'ASV' });

    // A radiogroup of radios: only one translation can be in a Bible tab, and
    // the multi-select module dialog is the one that keeps checkboxes.
    expect(container.querySelector('[role="radiogroup"]')).toBeTruthy();
    const asv = cards(container).find(c => c.textContent?.includes('ASV'))!;
    const kjv = cards(container).find(c => c.textContent?.includes('KJV'))!;
    expect(asv.getAttribute('role')).toBe('radio');
    expect(asv.getAttribute('aria-checked')).toBe('true');
    expect(kjv.getAttribute('aria-checked')).toBe('false');
    expect(asv.querySelector('.fa-circle-dot')).toBeTruthy();
    expect(kjv.querySelector('.fa-circle')).toBeTruthy();
    expect(container.querySelector('.fa-square-check')).toBeNull();
    expect(container.querySelector('.fa-square')).toBeNull();
  });

  it('focuses the filter box on open so typing goes somewhere', () => {
    const { container } = open();

    expect(document.activeElement).toBe(container.querySelector('.module-dialog__filter input'));
  });

  it('clears a stale filter when reopened', () => {
    // Reopening with the last search still in the box shows a filtered list
    // that looks like most of the translations have been uninstalled.
    const props = { onClose: vi.fn(), currentAbbr: 'KJV', onSelect: vi.fn() };
    const { container, rerender } = render(<TranslationDialog isOpen {...props} />);
    const input = container.querySelector('.module-dialog__filter input') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'ASV' } });
    expect(abbrs(container)).toEqual(['ASV']);

    rerender(<TranslationDialog isOpen={false} {...props} />);
    rerender(<TranslationDialog isOpen {...props} />);

    expect((container.querySelector('.module-dialog__filter input') as HTMLInputElement).value).toBe('');
    expect(abbrs(container).length).toBe(3);
  });
});

describe('filtering', () => {
  function filterTo(value: string) {
    const view = open();
    fireEvent.input(view.container.querySelector('.module-dialog__filter input')!, { target: { value } });
    return view;
  }

  it('matches on the abbreviation', () => {
    const { container } = filterTo('ASV');

    expect(abbrs(container)).toEqual(['ASV']);
  });

  it('matches on the full name', () => {
    const { container } = filterTo('World English');

    expect(abbrs(container)).toEqual(['WEB']);
  });

  it('ignores case', () => {
    const { container } = filterTo('kjv');

    expect(abbrs(container)).toEqual(['KJV']);
  });

  it('puts an exact abbreviation match first', () => {
    // The outcome that matters: typing "KJV" must not rank AKJV or KJV21 above
    // KJV. Verified by mutation that the *prefix* tier is what delivers this —
    // the explicit exact-match tier above it is belt-and-braces, since an exact
    // match is always the shortest prefix match and so sorts first anyway.
    mockModules = [mod('AKJV', 'American KJV'), mod('KJV21', 'KJV 21st Century'), mod('KJV', 'King James Version')];

    const { container } = filterTo('KJV');

    expect(abbrs(container)[0]).toBe('KJV');
  });

  it('ranks prefix matches above the rest', () => {
    mockModules = [mod('AKJV', 'American KJV'), mod('KJV21', 'KJV 21st Century')];

    const { container } = filterTo('KJV');

    expect(abbrs(container)).toEqual(['KJV21', 'AKJV']);
  });

  it('falls back to alphabetical within a tier', () => {
    mockModules = [mod('KJVC', 'C'), mod('KJVA', 'A'), mod('KJVB', 'B')];

    const { container } = filterTo('KJV');

    expect(abbrs(container)).toEqual(['KJVA', 'KJVB', 'KJVC']);
  });

  it('says no matches when the filter excludes everything', () => {
    const { container } = filterTo('Klingon');

    expect(container.querySelector('.module-dialog__empty')?.textContent).toBe('bibleToolbar.noMatches');
  });

  it('says no modules when none are installed at all', () => {
    // A different message: nothing to filter is a setup problem, not a typo.
    mockModules = [];

    const { container } = open();

    expect(container.querySelector('.module-dialog__empty')?.textContent).toBe('bibleToolbar.noModules');
  });

  it('drops the section headings while filtering', () => {
    // Sections are a browsing aid. Under a filter they fragment three results
    // across three headings.
    const { container } = filterTo('KJV');

    expect(container.querySelector('.module-dialog__section-label')).toBeNull();
  });

  it('tolerates a module with no name', () => {
    mockModules = [{ abbreviation: 'XYZ', name: '', type: 'bible' }];

    const { container } = filterTo('xyz');

    expect(abbrs(container)).toEqual(['XYZ']);
  });
});

describe('sections', () => {
  it('groups by the server-provided sections', () => {
    mockSections = [
      { title: 'Literal', modules: ['KJV', 'ASV'] },
      { title: 'Modern', modules: ['WEB'], helpText: 'Contemporary English' },
    ] as ModuleSection[];

    const { container } = open();

    const labels = Array.from(container.querySelectorAll('.module-dialog__section-label')).map(l => l.textContent);
    expect(labels).toEqual(['Literal', 'Modern']);
    expect(container.querySelector('.module-dialog__section-help')?.textContent).toBe('Contemporary English');
  });

  it('matches section entries case-insensitively', () => {
    // The section list is hand-written config; its casing need not match the
    // module's own.
    mockSections = [{ title: 'Literal', modules: ['kjv'] }] as ModuleSection[];

    const { container } = open();

    expect(abbrs(container)).toContain('KJV');
  });

  it('skips a section whose modules are all uninstalled', () => {
    // Config ships listing modules the reader may not have.
    mockSections = [{ title: 'Missing', modules: ['NIV'] }, { title: 'Literal', modules: ['KJV'] }] as ModuleSection[];

    const { container } = open();

    const labels = Array.from(container.querySelectorAll('.module-dialog__section-label')).map(l => l.textContent);
    expect(labels).not.toContain('Missing');
  });

  it('sweeps anything not in a section into "other"', () => {
    // Otherwise an installed translation nobody thought to list is invisible.
    mockSections = [{ title: 'Literal', modules: ['KJV'] }] as ModuleSection[];

    const { container } = open();

    const labels = Array.from(container.querySelectorAll('.module-dialog__section-label')).map(l => l.textContent);
    expect(labels).toEqual(['Literal', 'bibleToolbar.other']);
    expect(abbrs(container)).toEqual(['KJV', 'ASV', 'WEB']);
  });

  it('leaves out the "other" heading when every module is placed', () => {
    mockSections = [{ title: 'All', modules: ['KJV', 'ASV', 'WEB'] }] as ModuleSection[];

    const { container } = open();

    const labels = Array.from(container.querySelectorAll('.module-dialog__section-label')).map(l => l.textContent);
    expect(labels).toEqual(['All']);
  });

  it('falls back to the built-in recommended list when the server sends none', () => {
    const { container } = open();

    const labels = Array.from(container.querySelectorAll('.module-dialog__section-label')).map(l => l.textContent);
    expect(labels).toEqual(['bibleToolbar.popular', 'bibleToolbar.allTranslations']);
    // Recommended order, not install order.
    expect(abbrs(container)).toEqual(['KJV', 'WEB', 'ASV']);
  });

  it('drops the popular heading when none of the recommended ones are installed', () => {
    mockModules = [mod('ASV', 'American Standard')];

    const { container } = open();

    expect(container.querySelector('.module-dialog__section-label')).toBeNull();
    expect(abbrs(container)).toEqual(['ASV']);
  });

  it('ignores an empty section list and uses the fallback', () => {
    mockSections = [];

    const { container } = open();

    const labels = Array.from(container.querySelectorAll('.module-dialog__section-label')).map(l => l.textContent);
    expect(labels).toEqual(['bibleToolbar.popular', 'bibleToolbar.allTranslations']);
  });
});

describe('descriptions', () => {
  it('prefers the short tagline in the recommended section', () => {
    const { container } = open();

    const kjv = cards(container).find(c => c.textContent?.includes('KJV'))!;
    expect(kjv.querySelector('.module-card__desc')?.textContent).toBe('The classic');
  });

  it('uses the long description outside it', () => {
    const { container } = open();

    const asv = cards(container).find(c => c.textContent?.includes('ASV'))!;
    expect(asv.querySelector('.module-card__desc')?.textContent).toBe('American Standard Version, 1901.');
  });

  it('lets settings.json override the built-in text', () => {
    // The deployment's own wording wins over the hardcoded fallback.
    mockDescriptions = { KJV: { description: 'Our house translation.' } };

    const { container } = open();

    const kjv = cards(container).find(c => c.textContent?.includes('KJV'))!;
    expect(kjv.querySelector('.module-card__desc')?.textContent).toBe('Our house translation.');
  });

  it('omits the description line for a module nobody described', () => {
    mockModules = [mod('XYZ', 'Unknown Version')];

    const { container } = open();

    expect(container.querySelector('.module-card__desc')).toBeNull();
  });

  it('leaves out a name that only repeats the abbreviation', () => {
    mockModules = [mod('XYZ', 'XYZ')];

    const { container } = open();

    expect(container.querySelector('.module-card__name')).toBeNull();
  });
});

describe('keyboard', () => {
  /**
   * Dispatched natively rather than through `fireEvent`: happy-dom does not
   * deliver a `fireEvent.keyDown(window, …)` to listeners registered on
   * `window` itself, so a test written that way passes whether or not the
   * handler exists.
   */
  const arrow = (key: string) => act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });

  it('registers one listener, on mount, and never re-registers it', () => {
    // The structural fix for the real bug: a listener attached when the dialog
    // opens is not live for the first frames it is on screen, because Preact
    // flushes effects on an animation frame. Attaching once and reading the
    // open flag from a ref is what makes Escape work immediately.
    const add = vi.spyOn(window, 'addEventListener');
    const props = { onClose: vi.fn(), currentAbbr: 'KJV', onSelect: vi.fn() };

    const { rerender } = render(<TranslationDialog isOpen={false} {...props} />);
    // `String(c[0])`: `vi.spyOn(window, 'addEventListener')` resolves to the
    // `typeof globalThis` overload, whose event-name parameter is keyed to
    // `DedicatedWorkerGlobalScopeEventMap` — so comparing it to 'keydown'
    // is a type error even though it is exactly what was registered.
    const isKeydown = (call: unknown[]) => String(call[0]) === 'keydown';
    const afterMount = add.mock.calls.filter(isKeydown).length;
    rerender(<TranslationDialog isOpen {...props} />);
    rerender(<TranslationDialog isOpen={false} {...props} />);
    rerender(<TranslationDialog isOpen {...props} />);

    expect(afterMount).toBe(1);
    expect(add.mock.calls.filter(isKeydown)).toHaveLength(1);
    add.mockRestore();
  });

  it('ignores keys while closed', () => {
    const onClose = vi.fn();
    render(<TranslationDialog isOpen={false} onClose={onClose} currentAbbr="KJV" onSelect={vi.fn()} />);

    arrow('Escape');

    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    open({ onClose });

    arrow('Escape');

    expect(onClose).toHaveBeenCalled();
  });

  it('uses the latest onClose, not the one from mount', () => {
    // The listener is never re-registered, so it has to read the callback
    // through a ref or it will call a stale prop forever.
    const first = vi.fn();
    const second = vi.fn();
    const props = { currentAbbr: 'KJV', onSelect: vi.fn() };
    const { rerender } = render(<TranslationDialog isOpen onClose={first} {...props} />);

    rerender(<TranslationDialog isOpen onClose={second} {...props} />);
    arrow('Escape');

    expect(second).toHaveBeenCalled();
    expect(first).not.toHaveBeenCalled();
  });

  it('walks down the list with ArrowDown', () => {
    const { container } = open();

    arrow('ArrowDown');

    expect(cards(container)[0].classList.contains('module-card--focused')).toBe(true);
  });

  it('stops at the last card', () => {
    const { container } = open();

    for (let i = 0; i < 10; i++) arrow('ArrowDown');

    const focused = cards(container).findIndex(c => c.classList.contains('module-card--focused'));
    expect(focused).toBe(cards(container).length - 1);
  });

  it('walks back up with ArrowUp', () => {
    const { container } = open();
    arrow('ArrowDown');
    arrow('ArrowDown');

    arrow('ArrowUp');

    expect(cards(container)[0].classList.contains('module-card--focused')).toBe(true);
  });

  it('stops at the first card rather than wrapping', () => {
    const { container } = open();
    arrow('ArrowDown');

    arrow('ArrowUp');
    arrow('ArrowUp');

    expect(cards(container)[0].classList.contains('module-card--focused')).toBe(true);
  });

  it('chooses the focused card on Enter', () => {
    const onSelect = vi.fn();
    open({ onSelect });

    arrow('ArrowDown');
    arrow('Enter');

    // First card in recommended order.
    expect(onSelect).toHaveBeenCalledWith('KJV');
  });

  it('does nothing on Enter with nothing focused', () => {
    const onSelect = vi.fn();
    open({ onSelect });

    arrow('Enter');

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('chooses on Space when the list has focus', () => {
    const onSelect = vi.fn();
    const { container } = open({ onSelect });
    (container.querySelector('.module-dialog__filter input') as HTMLInputElement).blur();

    arrow('ArrowDown');
    arrow(' ');

    expect(onSelect).toHaveBeenCalledWith('KJV');
  });

  it('lets Space through to the filter box', () => {
    // Otherwise a two-word search ("World English") cannot be typed.
    const onSelect = vi.fn();
    const { container } = open({ onSelect });
    const input = container.querySelector('.module-dialog__filter input') as HTMLInputElement;
    input.focus();

    arrow('ArrowDown');
    arrow(' ');

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('drops the focus ring when the filter changes', () => {
    // The index points into a list that just changed underneath it; keeping it
    // would highlight, and Enter would choose, a different translation.
    const { container } = open();
    arrow('ArrowDown');

    fireEvent.input(container.querySelector('.module-dialog__filter input')!, { target: { value: 'A' } });

    expect(container.querySelector('.module-card--focused')).toBeNull();
  });

  it('numbers the focus index across section boundaries', () => {
    // Cards are numbered by a running counter that spans every section, so
    // ArrowDown has to cross from "popular" into "all translations".
    const { container } = open();

    arrow('ArrowDown');
    arrow('ArrowDown');
    arrow('ArrowDown');

    const focused = cards(container).findIndex(c => c.classList.contains('module-card--focused'));
    expect(abbrs(container)[focused]).toBe('ASV');
  });

  it('stops listening once unmounted', () => {
    const onClose = vi.fn();
    const { unmount } = open({ onClose });

    unmount();
    arrow('Escape');

    expect(onClose).not.toHaveBeenCalled();
  });
});
