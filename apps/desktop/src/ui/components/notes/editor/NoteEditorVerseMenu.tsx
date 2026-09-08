/**
 * Right-click menu for a Bible reference in the notes editor.
 *
 * The editor has no context menu of its own, and Electron adds no native one
 * in the renderer, so right-clicking a reference did nothing at all before
 * this. The menu opens over a `.verse-ref-detected` decoration - where it
 * offers to expand, go to, or open the reference - and over an already
 * expanded passage, where the one action is to re-format it. Right-clicking
 * ordinary prose is left alone.
 *
 * Every action is optional, and the caller passes only the ones that apply;
 * the two sets never overlap.
 *
 * Structure (fixed positioning, click-outside, Escape, `role="menu"`, arrow
 * navigation) follows `VerseContextMenu`, the app's established menu shape.
 */
import React, { useEffect, useRef } from 'react';
import { useI18n } from '../../../contexts/useI18n';

export interface NoteEditorVerseMenuProps {
  /** The reference text that was right-clicked, e.g. "John 3:16". */
  referenceText: string;
  position: { x: number; y: number };
  onClose: () => void;
  /** Open the format picker and replace the reference with the verse text. */
  onExpand?: () => void;
  /** Navigate the Bible pane to the reference. */
  onGoToVerse?: () => void;
  /** Open the reference as its own Bible panel. */
  onOpenInNewPanel?: () => void;
  /** Re-open the format picker on a passage already expanded in the note. */
  onReformat?: () => void;
}

const NoteEditorVerseMenu: React.FC<NoteEditorVerseMenuProps> = ({
  referenceText,
  position,
  onClose,
  onExpand,
  onGoToVerse,
  onOpenInNewPanel,
  onReformat,
}) => {
  const { t } = useI18n();
  const menuRef = useRef<HTMLDivElement>(null);

  // Focus the first item so the menu is usable from the keyboard.
  useEffect(() => {
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [],
    );
    if (items.length === 0) return;
    const current = items.findIndex(el => el === document.activeElement);
    let next: number | null = null;
    switch (event.key) {
      case 'ArrowDown': next = current < 0 ? 0 : (current + 1) % items.length; break;
      case 'ArrowUp': next = current <= 0 ? items.length - 1 : current - 1; break;
      case 'Home': next = 0; break;
      case 'End': next = items.length - 1; break;
      default: return;
    }
    event.preventDefault();
    if (next !== null) items[next].focus();
  };

  const item = (label: string, onSelect: () => void) => (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        onClose();
        onSelect();
      }}
      className="w-full px-4 py-2 text-start text-sm hover:bg-background-hover transition-colors cursor-pointer"
    >
      {label}
    </button>
  );

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={t('ui.noteEditor.verseMenuLabel')}
      className="bg-surface border border-border-secondary rounded-md shadow-lg min-w-[200px] py-1"
      style={{ position: 'fixed', top: position.y, left: position.x, zIndex: 9999 }}
      onKeyDown={handleMenuKeyDown}
    >
      <div className="px-4 py-1 text-xs text-text-secondary bidi-isolate">{referenceText}</div>
      <div className="border-t border-border my-1" />
      {onExpand && item(t('ui.noteEditor.expandToFullText'), onExpand)}
      {onReformat && item(t('ui.noteEditor.reformatPassage'), onReformat)}
      {onGoToVerse && item(t('ui.noteEditor.goToVerse'), onGoToVerse)}
      {onOpenInNewPanel && item(t('ui.noteEditor.openInNewPanel'), onOpenInNewPanel)}
    </div>
  );
};

export default NoteEditorVerseMenu;
