/**
 * The "..." button every phone screen carries in its header, shared between
 * the lobby and the frame every in-game screen sits inside. Theme, settings
 * and leave sit behind it so that the top row can belong to the game, and so
 * a player never loses them the moment a game starts: no way to change the
 * theme, no way to hand the room to someone else by QR, no way to leave.
 *
 * The menu follows the room menu on the control bar: focus lands on the first
 * item when it opens, the arrow keys, Home and End move between items, and
 * Escape closes it and returns focus to the button. A dialog opened from an
 * item hands focus back to the button when it closes, since the item is gone.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { useEscapeKey } from '../../../../hooks/useEscapeKey';
import { setModalFallback, useModalFocus } from '../../../../hooks/useModalFocus';
import { QrCode } from './QrCode.js';
import { ThemeEditor } from './ThemeEditor.js';
import { THEME_PRESETS, THEME_PRESET_IDS, presetIdOf } from '../../shared/theme.js';
import type { ThemeControl } from './theme.js';
import { themeName } from './gameLabels.js';
import { gt } from './t.js';
import '../styles/phone.css';

function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1.4em" height="1.4em" aria-hidden="true" focusable="false">
      <circle cx="5" cy="12" r="2" fill="currentColor" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
      <circle cx="19" cy="12" r="2" fill="currentColor" />
    </svg>
  );
}

/** Settings: the deliberate way to pick a theme, alongside the QR code and the room code. */
function SettingsPanel({
  code,
  joinUrl,
  themeControl,
  onClose,
}: {
  code: string;
  joinUrl: string;
  themeControl: ThemeControl;
  onClose(): void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus(true, dialogRef);
  return (
    <div class="overlay" role="dialog" aria-modal="true" aria-label={gt('games.phone.settings', 'Settings')} ref={dialogRef}>
      <div class="overlay-card">
        <h2 class="overlay-title">{gt('games.phone.settings', 'Settings')}</h2>

        <ThemeEditor theme={themeControl.theme} onChange={themeControl.setOverride} label={gt('games.phone.yourTheme', 'Your theme')} />
        {themeControl.isOverridden && (
          <button type="button" class="btn-quiet" onClick={() => themeControl.setOverride(null)}>
            {gt('games.phone.useRoomTheme', "Use the game's theme")}
          </button>
        )}

        <div class="settings-share">
          <p class="field-label">{gt('games.phone.shareRoom', 'Share this game')}</p>
          <QrCode url={joinUrl} label={gt('games.host.qrLabel', 'QR code to join game {code}', { code })} />
          <p class="settings-code" aria-label={gt('games.host.roomCodeAria', 'Game code {code}', { code: code.split('').join(' ') })}>
            #{code}
          </p>
        </div>

        <button type="button" class="btn-primary" onClick={onClose}>
          {gt('games.common.close', 'Close')}
        </button>
      </div>
    </div>
  );
}

function LeaveConfirm({ onLeave, onCancel }: { onLeave(): void; onCancel(): void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus(true, dialogRef);
  return (
    <div class="overlay" role="dialog" aria-modal="true" aria-label={gt('games.phone.leaveTitle', 'Leave the game')} ref={dialogRef}>
      <div class="overlay-card">
        <h2 class="overlay-title">{gt('games.phone.leaveQuestion', 'Leave the game?')}</h2>
        <p class="muted">{gt('games.phone.leaveRejoin', 'You can rejoin with the same code while the game is still open.')}</p>
        <button type="button" class="danger" onClick={onLeave}>
          {gt('games.phone.leaveTitle', 'Leave the game')}
        </button>
        <button type="button" class="btn-quiet" onClick={onCancel}>
          {gt('games.phone.stay', 'Stay')}
        </button>
      </div>
    </div>
  );
}

export interface PhoneHeaderActionsProps {
  code: string;
  /** For the QR code in Settings, so someone here can hand the room to someone else. */
  joinUrl: string;
  themeControl: ThemeControl;
  onLeave(): void;
}

const MENU_ITEMS = '[role="menuitem"]:not([disabled])';

function menuItems(menu: ParentNode | null): HTMLElement[] {
  return menu ? Array.from(menu.querySelectorAll<HTMLElement>(MENU_ITEMS)) : [];
}

export function PhoneHeaderActions({ code, joinUrl, themeControl, onLeave }: PhoneHeaderActionsProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Stays mounted while the dialogs come and go, which is what useEscapeKey needs.
  useEscapeKey(showSettings || confirmLeave, () => {
    if (confirmLeave) setConfirmLeave(false);
    else setShowSettings(false);
  });

  // Opening the menu puts focus on its first item.
  useEffect(() => {
    if (menuOpen) menuItems(panelRef.current)[0]?.focus();
  }, [menuOpen]);

  // A tap anywhere else closes the menu.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = (event: Event): void => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      setMenuOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menuOpen]);

  const currentPreset = presetIdOf(themeControl.theme);
  const currentThemeName = currentPreset !== null ? themeName(currentPreset) : null;

  const cycleTheme = (): void => {
    const current = presetIdOf(themeControl.theme);
    const index = current === null ? -1 : THEME_PRESET_IDS.indexOf(current);
    const nextId = THEME_PRESET_IDS[(index + 1) % THEME_PRESET_IDS.length];
    const next = nextId ? THEME_PRESETS[nextId] : undefined;
    if (next) themeControl.setOverride(next);
  };

  const closeMenu = (): void => {
    setMenuOpen(false);
    toggleRef.current?.focus();
  };

  const openDialog = (event: MouseEvent, open: () => void): void => {
    setModalFallback(event.currentTarget as HTMLElement, toggleRef.current);
    setMenuOpen(false);
    open();
  };

  const onMenuKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
      return;
    }
    const items = menuItems(panelRef.current);
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    let target = -1;
    if (event.key === 'ArrowDown') target = at < 0 ? 0 : (at + 1) % items.length;
    else if (event.key === 'ArrowUp') target = at < 0 ? items.length - 1 : (at - 1 + items.length) % items.length;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = items.length - 1;
    else if (event.key === 'Tab') setMenuOpen(false);
    if (target < 0) return;
    event.preventDefault();
    items[target]?.focus();
  };

  return (
    <div class="host-menu phone-menu" ref={rootRef}>
      <button
        type="button"
        class="icon-button host-menu-toggle"
        ref={toggleRef}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={gt('games.phone.more', 'More')}
        onClick={() => setMenuOpen((open) => !open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !menuOpen) {
            event.preventDefault();
            setMenuOpen(true);
          }
        }}
      >
        <MoreIcon />
      </button>

      {menuOpen && (
        <div
          class="host-menu-panel"
          role="menu"
          aria-label={gt('games.phone.menuLabel', 'Player menu')}
          ref={panelRef}
          onKeyDown={onMenuKeyDown}
        >
          <button
            type="button"
            role="menuitem"
            onClick={cycleTheme}
            aria-label={
              currentThemeName !== null
                ? gt('games.phone.themeCycle', 'Theme: {name}. Switch to the next theme', { name: currentThemeName })
                : gt('games.phone.themeCycleCustom', 'Switch to the next theme')
            }
          >
            {gt('games.phone.theme', 'Theme')}
          </button>
          <button type="button" role="menuitem" onClick={(event) => openDialog(event, () => setShowSettings(true))}>
            {gt('games.phone.settings', 'Settings')}
          </button>
          <button type="button" role="menuitem" onClick={(event) => openDialog(event, () => setConfirmLeave(true))}>
            {gt('games.phone.leave', 'Leave')}
          </button>
        </div>
      )}

      {showSettings && (
        <SettingsPanel
          code={code}
          joinUrl={joinUrl}
          themeControl={themeControl}
          onClose={() => setShowSettings(false)}
        />
      )}
      {confirmLeave && <LeaveConfirm onLeave={onLeave} onCancel={() => setConfirmLeave(false)} />}
    </div>
  );
}
