import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../contexts/useI18n';
import { useSearchStore, isIdeasSelectable } from '../stores/useSearchStore';

/** Magnifier: the next search is a keyword search. */
export const MagnifierIcon: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
  </svg>
);

/** Light bulb: the next search is an Ideas (meaning) search. */
export const LightbulbIcon: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M9 18h6m-5 3h4M12 3a6 6 0 00-3.6 10.8c.6.5 1.1 1.2 1.1 2V16h5v-.2c0-.8.5-1.5 1.1-2A6 6 0 0012 3z"
    />
  </svg>
);

const ChevronDownIcon: React.FC = () => (
  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
  </svg>
);

/** Where the open menu sits: fixed, just under the button, aligned to its inline start. */
interface MenuPosition {
  top: number;
  left?: number;
  right?: number;
}

function menuPositionFor(button: HTMLElement): MenuPosition {
  const r = button.getBoundingClientRect();
  const rtl = getComputedStyle(button).direction === 'rtl';
  const top = r.bottom + 6;
  return rtl ? { top, right: Math.max(0, window.innerWidth - r.right) } : { top, left: Math.max(0, r.left) };
}

/**
 * The search icon of the unified bar, doubled as the Search / Ideas selector.
 *
 * A menu button: the current type's icon (magnifier = keyword, light bulb =
 * Ideas) plus a chevron. It opens a small menu with both options and a
 * one-line explanation each. It reads and writes the same `isSemanticMode` the
 * results pane's Ideas suggestion does, so the two stay in step. Rendered while
 * Ideas search can be chosen (see `isIdeasSelectable`); otherwise the plain
 * magnifier.
 *
 * The menu is portalled to `document.body` with `position: fixed`. Inside the
 * bar it was trapped in the icon wrapper's stacking context (a transformed,
 * z-50 element), and the suggestion / history popups under the box - later
 * z-50 siblings in the same parent context - painted over it whatever z-index
 * the menu itself had. `onOpenChange` also lets the bar hide those popups
 * while the menu is open, so the two never compete for the same space.
 */
const SearchTypeSelector: React.FC<{ onChosen?: () => void; onOpenChange?: (open: boolean) => void }> = ({
  onChosen,
  onOpenChange,
}) => {
  const { t } = useI18n();
  const selectable = useSearchStore(isIdeasSelectable);
  const isSemanticMode = useSearchStore((s) => s.isSemanticMode);
  const setSemanticMode = useSearchStore((s) => s.setSemanticMode);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const setOpenState = useCallback(
    (next: boolean) => {
      setOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

  // Never leave the bar thinking the menu is open after this unmounts.
  useEffect(() => () => onOpenChange?.(false), [onOpenChange]);

  // Place the menu before paint, and keep it on the button while the window
  // resizes or anything scrolls.
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const place = () => {
      if (buttonRef.current) setPosition(menuPositionFor(buttonRef.current));
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  // Focus the checked item once the menu is in the DOM (menu-button pattern).
  useEffect(() => {
    if (!open || !position) return;
    const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]');
    const checked = menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    (checked ?? items?.[0])?.focus();
  }, [open, position]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpenState(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, setOpenState]);

  const close = useCallback(
    (refocus: boolean) => {
      setOpenState(false);
      if (refocus) buttonRef.current?.focus();
    },
    [setOpenState],
  );

  const choose = useCallback(
    (semantic: boolean) => {
      setOpenState(false);
      setSemanticMode(semantic);
      onChosen?.();
    },
    [setSemanticMode, onChosen, setOpenState],
  );

  if (!selectable) return <MagnifierIcon />;

  const options: Array<{ semantic: boolean; label: string; hint: string; testId: string; icon: React.ReactNode }> = [
    { semantic: false, label: t('searchBar.type.keyword'), hint: t('searchBar.type.keywordHint'), testId: 'search-type-keyword', icon: <MagnifierIcon className="w-4 h-4" /> },
    { semantic: true, label: t('searchBar.type.ideas'), hint: t('searchBar.type.ideasHint'), testId: 'search-type-ideas', icon: <LightbulbIcon className="w-4 h-4" /> },
  ];

  const onButtonKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpenState(true);
    }
  };

  const onMenuKeyDown = (e: React.KeyboardEvent): void => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    const focusAt = (i: number) => items[(i + items.length) % items.length]?.focus();
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); focusAt(at + 1); break;
      case 'ArrowUp': e.preventDefault(); focusAt(at - 1); break;
      case 'Home': e.preventDefault(); focusAt(0); break;
      case 'End': e.preventDefault(); focusAt(items.length - 1); break;
      case 'Escape':
        // Only the menu closes: the search box's own Escape (clear) must not run.
        e.preventDefault();
        e.stopPropagation();
        close(true);
        break;
      case 'Tab': setOpenState(false); break;
      default: break;
    }
  };

  const currentLabel = isSemanticMode ? t('searchBar.type.ideas') : t('searchBar.type.keyword');

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        data-testid="search-type-button"
        data-search-type={isSemanticMode ? 'ideas' : 'keyword'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? 'search-type-menu' : undefined}
        title={`${t('searchBar.type.title')}: ${currentLabel}`}
        aria-label={`${t('searchBar.type.title')}: ${currentLabel}`}
        // Keep the caret in the search box when the button is clicked.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpenState(!open)}
        onKeyDown={onButtonKeyDown}
        className={`flex items-center gap-0.5 px-0.5 -mx-0.5 rounded cursor-pointer hover:text-text-primary hover:bg-background-active ${open ? 'text-text-primary bg-background-active' : ''}`}
      >
        {isSemanticMode ? <LightbulbIcon /> : <MagnifierIcon />}
        <ChevronDownIcon />
      </button>
      {open && position && createPortal(
        <div
          ref={menuRef}
          id="search-type-menu"
          role="menu"
          aria-label={t('searchBar.type.title')}
          data-testid="search-type-menu"
          onKeyDown={onMenuKeyDown}
          className="w-64 bg-surface-elevated border border-border rounded-lg shadow-lg py-1 text-start"
          // Above the header's popups and the dock (which live in the app
          // root's stacking context); below nothing that matters, since any
          // choice closes the menu before a dialog can open.
          style={{ position: 'fixed', top: position.top, left: position.left, right: position.right, zIndex: 10000 }}
        >
          {options.map((o) => {
            const selected = o.semantic === isSemanticMode;
            return (
              <button
                key={o.testId}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                tabIndex={-1}
                data-testid={o.testId}
                onClick={() => choose(o.semantic)}
                className={`w-full flex items-start gap-2 px-3 py-2 text-start cursor-pointer hover:bg-accent-light focus:bg-accent-light focus:outline-none ${selected ? 'bg-accent-soft' : ''}`}
              >
                <span className="mt-0.5 text-text-secondary">{o.icon}</span>
                <span className="flex flex-col">
                  <span className="text-sm font-semibold text-text-primary">{o.label}</span>
                  <span className="text-xs text-text-secondary whitespace-normal">{o.hint}</span>
                </span>
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
};

export default SearchTypeSelector;
