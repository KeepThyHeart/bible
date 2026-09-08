/**
 * KeyboardShortcutsDialog Component
 *
 * Modal dialog that displays all keyboard shortcuts organized by category.
 * Opens when the user selects Help > Keyboard Shortcuts or presses Ctrl+/.
 *
 * ===== APP.TSX INTEGRATION =====
 *
 * To wire this into App.tsx, add the following:
 *
 * 1. Import at the top of App.tsx:
 *    import KeyboardShortcutsDialog from './components/KeyboardShortcutsDialog';
 *
 * 2. Add state in the App function:
 *    const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false);
 *
 * 3. In the useEffect that listens for menu events (around line 145), add:
 *    const handleKeyboardShortcuts = () => {
 *      setShowKeyboardShortcuts(true);
 *    };
 *    window.electron.menu.onKeyboardShortcuts(handleKeyboardShortcuts);
 *
 * 4. In the JSX return, after the BackupRestoreDialog, add:
 *    {showKeyboardShortcuts && (
 *      <KeyboardShortcutsDialog onClose={() => setShowKeyboardShortcuts(false)} />
 *    )}
 *
 * ===== END APP.TSX INTEGRATION =====
 */

import React, { useEffect, useRef, useCallback } from 'react';
import { activateFocusTrap } from '../utils/focusTrap';
import { useI18n } from '../contexts/useI18n';

// --- Types -------------------------------------------------------------------

interface ShortcutEntry {
  /** Catalog key for the human-readable description of the action */
  descriptionKey: string;
  /**
   * Shortcut keys. Use platform-agnostic tokens:
   *   Mod = Ctrl on Win/Linux, Cmd on Mac
   *   Alt, Shift, Escape, Enter, Tab, etc.
   * Multiple keys in a combo are joined with "+".
   */
  keys: string;
}

interface ShortcutCategory {
  /** Catalog key for the section heading */
  titleKey: string;
  shortcuts: ShortcutEntry[];
}

interface KeyboardShortcutsDialogProps {
  onClose: () => void;
}

// --- Shortcut data -----------------------------------------------------------

const SHORTCUT_CATEGORIES: ShortcutCategory[] = [
  {
titleKey: 'ui.keyboardShortcuts.category.navigation',
    shortcuts: [
      { descriptionKey: 'ui.keyboardShortcuts.navigation.goToVerse', keys: 'Mod+G' },
      { descriptionKey: 'ui.keyboardShortcuts.navigation.back', keys: 'Alt+Left' },
      { descriptionKey: 'ui.keyboardShortcuts.navigation.forward', keys: 'Alt+Right' },
      { descriptionKey: 'ui.keyboardShortcuts.navigation.nextChapter', keys: 'Alt+Down' },
      { descriptionKey: 'ui.keyboardShortcuts.navigation.previousChapter', keys: 'Alt+Up' },
      { descriptionKey: 'ui.keyboardShortcuts.navigation.focusSearch', keys: 'F6' },
    ],
  },
  {
titleKey: 'ui.keyboardShortcuts.category.search',
    shortcuts: [
      { descriptionKey: 'ui.keyboardShortcuts.search.findInPane', keys: 'Mod+F' },
      { descriptionKey: 'ui.keyboardShortcuts.search.searchAll', keys: 'Mod+Shift+F' },
      { descriptionKey: 'ui.keyboardShortcuts.search.close', keys: 'Escape' },
    ],
  },
  {
titleKey: 'ui.keyboardShortcuts.category.editing',
    shortcuts: [
      { descriptionKey: 'ui.keyboardShortcuts.editing.copy', keys: 'Mod+C' },
      { descriptionKey: 'ui.keyboardShortcuts.editing.cut', keys: 'Mod+X' },
      { descriptionKey: 'ui.keyboardShortcuts.editing.paste', keys: 'Mod+V' },
      { descriptionKey: 'ui.keyboardShortcuts.editing.highlight', keys: 'Mod+Shift+H' },
      { descriptionKey: 'ui.keyboardShortcuts.editing.addNote', keys: 'Mod+Shift+N' },
      { descriptionKey: 'ui.keyboardShortcuts.editing.bookmark', keys: 'Mod+D' },
    ],
  },
  {
titleKey: 'ui.keyboardShortcuts.category.view',
    shortcuts: [
      { descriptionKey: 'ui.keyboardShortcuts.view.zoomIn', keys: 'Mod+Plus' },
      { descriptionKey: 'ui.keyboardShortcuts.view.zoomOut', keys: 'Mod+Minus' },
      { descriptionKey: 'ui.keyboardShortcuts.view.resetZoom', keys: 'Mod+0' },
      { descriptionKey: 'ui.keyboardShortcuts.view.devTools', keys: 'Mod+Shift+I' },
    ],
  },
  {
titleKey: 'ui.keyboardShortcuts.category.application',
    shortcuts: [
      { descriptionKey: 'ui.keyboardShortcuts.application.preferences', keys: 'Mod+Comma' },
      { descriptionKey: 'ui.keyboardShortcuts.application.showShortcuts', keys: 'Mod+/' },
      { descriptionKey: 'ui.keyboardShortcuts.application.closeDialog', keys: 'Escape' },
    ],
  },
];

// --- Helpers -----------------------------------------------------------------

/**
 * Detect whether the user is on macOS.
 * In the renderer process we cannot rely on Node's process.platform,
 * so we inspect the navigator user-agent.
 */
function isMacPlatform(): boolean {
  return navigator.platform?.toUpperCase().indexOf('MAC') >= 0 ||
    navigator.userAgent?.toUpperCase().indexOf('MAC') >= 0;
}

/**
 * Resolve the platform-agnostic "Mod" token and present human-friendly
 * key names suitable for display in a UI badge.
 */
function formatKeyForDisplay(rawKey: string, isMac: boolean): string {
  const map: Record<string, string> = isMac
    ? {
        Mod: '\u2318',        // Command symbol
        Ctrl: '\u2303',       // Control symbol
        Alt: '\u2325',        // Option symbol
        Shift: '\u21E7',      // Shift symbol
        Enter: '\u21A9',      // Return symbol
        Escape: 'Esc',
        Plus: '+',
        Minus: '\u2212',      // Minus sign
        Comma: ',',
        Left: '\u2190',
        Right: '\u2192',
        Up: '\u2191',
        Down: '\u2193',
        Tab: '\u21E5',
      }
    : {
        Mod: 'Ctrl',
        Plus: '+',
        Minus: '\u2212',
        Comma: ',',
        Left: '\u2190',
        Right: '\u2192',
        Up: '\u2191',
        Down: '\u2193',
        Escape: 'Esc',
        Enter: 'Enter',
        Tab: 'Tab',
      };

  return map[rawKey] ?? rawKey;
}

/**
 * Split a shortcut string like "Mod+Shift+F" into rendered key badges.
 */
function parseShortcutKeys(keys: string, isMac: boolean): string[] {
  return keys.split('+').map((part) => formatKeyForDisplay(part.trim(), isMac));
}

// --- Component ---------------------------------------------------------------

const KeyboardShortcutsDialog: React.FC<KeyboardShortcutsDialogProps> = ({ onClose }) => {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<Element | null>(null);
  const isMac = isMacPlatform();

  // Store previously focused element so we can restore it on close
  useEffect(() => {
    previousFocusRef.current = document.activeElement;

    // Focus the dialog container for keyboard handling
    dialogRef.current?.focus();

    return () => {
      // Restore focus when unmounting
      setTimeout(() => {
        if (previousFocusRef.current instanceof HTMLElement) {
          previousFocusRef.current.focus();
        }
      }, 50);
    };
  }, []);

  // Focus trap: keep Tab/Shift+Tab contained inside the dialog.
  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return;
    const handle = activateFocusTrap(node);
    return () => handle.release();
  }, []);

  // Close on Escape
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    },
    [onClose],
  );

  // Close when clicking the backdrop
  const handleBackdropClick = useCallback(() => {
    onClose();
  }, [onClose]);

  // Prevent clicks inside the dialog from propagating to the backdrop
  const handleDialogClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  return (
    <>
      {/* Backdrop overlay */}
      <div
        className="fixed inset-0 bg-background-overlay z-40"
        onClick={handleBackdropClick}
      />

      {/* Dialog */}
      <div
        className="fixed inset-0 flex items-center justify-center z-50 p-lg"
        onClick={handleBackdropClick}
      >
        <div
          ref={dialogRef}
          tabIndex={-1}
          role="dialog"
          aria-label={t('ui.keyboardShortcuts.title')}
          aria-modal="true"
          className="bg-surface rounded-lg shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col outline-none"
          onClick={handleDialogClick}
          onKeyDown={handleKeyDown}
          data-testid="keyboard-shortcuts-dialog"
        >
          {/* -- Header -- */}
          <div className="flex items-center justify-between px-xl py-lg border-b border-border shrink-0">
            <h2 className="text-xl font-bold text-text-heading">{t('ui.keyboardShortcuts.title')}</h2>
            <button
              onClick={onClose}
              className="p-1 hover:bg-background-active rounded transition-colors"
              title={t('ui.keyboardShortcuts.close')}
              aria-label={t('ui.keyboardShortcuts.close')}
            >
              <svg className="w-5 h-5 text-text-secondary" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* -- Content --
              The list scrolls, so it must be tab-reachable in its own right;
              without tabIndex a keyboard-only user cannot scroll it. */}
          <div className="flex-1 overflow-y-auto px-xl py-lg" tabIndex={0}>
            <p className="text-sm text-text-secondary mb-lg">
              {isMac
                ? t('ui.keyboardShortcuts.platformMac')
                : t('ui.keyboardShortcuts.platformOther')}
            </p>

            <div className="space-y-xl">
              {SHORTCUT_CATEGORIES.map((category) => (
                <section key={category.titleKey}>
                  <h3 className="text-sm font-semibold text-text-heading uppercase tracking-wide mb-sm">
                    {t(category.titleKey)}
                  </h3>
                  <div className="border border-border rounded-lg overflow-hidden">
                    {category.shortcuts.map((shortcut, idx) => (
                      <div
                        key={shortcut.keys}
                        className={`flex items-center justify-between px-md py-sm ${
                          idx !== 0 ? 'border-t border-border' : ''
                        } ${idx % 2 === 0 ? 'bg-surface' : 'bg-background-warm'}`}
                      >
                        <span className="text-sm text-text-primary">
                          {t(shortcut.descriptionKey)}
                        </span>
                        <span className="flex items-center gap-1 shrink-0 ms-md">
                          {parseShortcutKeys(shortcut.keys, isMac).map((keyLabel, keyIdx) => (
                            <React.Fragment key={keyIdx}>
                              {keyIdx > 0 && (
                                <span aria-hidden="true" className="text-xs text-text-secondary mx-px">+</span>
                              )}
                              <kbd
                                className="inline-flex items-center justify-center min-w-[28px] h-7 px-2 text-xs font-medium text-text-primary bg-background-tertiary border border-border-secondary rounded shadow-sm"
                                style={{
                                  fontFamily: 'Inter, system-ui, sans-serif',
                                  boxShadow: '0 1px 0 1px rgba(0,0,0,0.05)',
                                }}
                              >
                                {keyLabel}
                              </kbd>
                            </React.Fragment>
                          ))}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>

          {/* -- Footer -- */}
          <div className="flex items-center justify-end px-xl py-lg border-t border-border bg-background-warm shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-lg py-sm text-sm bg-accent text-text-on-accent rounded hover:bg-accent-hover transition-colors"
            >
              {t('ui.keyboardShortcuts.close')}
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default KeyboardShortcutsDialog;
