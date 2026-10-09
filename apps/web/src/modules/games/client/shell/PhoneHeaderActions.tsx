/**
 * The three icon buttons every phone screen carries in its header — theme,
 * settings, leave — shared between the lobby and the frame every in-game
 * screen sits inside. Before this round a player lost all three the moment
 * a game actually started: no way to change the theme, no way to hand the
 * room to someone else by QR, no way to leave, unlike the lobby they had
 * just come from.
 *
 * Each carries a visible caption under its icon, not only an `aria-label` —
 * matching the host control bar's own icon+caption convention, for the same
 * reason: an icon alone is a guess for anyone unsure what it does.
 */

import { useState } from 'preact/hooks';
import { QrCode } from './QrCode.js';
import { ThemeEditor } from './ThemeEditor.js';
import { THEME_PRESETS, THEME_PRESET_IDS, presetIdOf } from '../../shared/theme.js';
import type { ThemeControl } from './theme.js';
import { gt } from './t.js';

function ThemeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1.4em" height="1.4em" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" />
      <path d="M12 3a9 9 0 000 18z" fill="currentColor" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1.4em" height="1.4em" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="2" />
      <path
        d="M12 3.5v2.4M12 18.1v2.4M4.6 12H2.2M21.8 12h-2.4M6.3 6.3l1.7 1.7M16 16l1.7 1.7M17.7 6.3L16 8M8 16l-1.7 1.7"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        fill="none"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1.4em" height="1.4em" aria-hidden="true" focusable="false">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
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
  return (
    <div class="overlay" role="dialog" aria-label={gt('games.phone.settings', 'Settings')}>
      <div class="overlay-card">
        <h2 class="overlay-title">{gt('games.phone.settings', 'Settings')}</h2>

        <ThemeEditor theme={themeControl.theme} onChange={themeControl.setOverride} label={gt('games.phone.yourTheme', 'Your theme')} />
        {themeControl.isOverridden && (
          <button type="button" class="btn-quiet" onClick={() => themeControl.setOverride(null)}>
            {gt('games.phone.useRoomTheme', "Use the room's theme")}
          </button>
        )}

        <div class="settings-share">
          <p class="field-label">{gt('games.phone.shareRoom', 'Share this room')}</p>
          <QrCode url={joinUrl} label={gt('games.host.qrLabel', 'QR code to join room {code}', { code })} />
          <p class="settings-code" aria-label={gt('games.host.roomCodeAria', 'Room code {code}', { code: code.split('').join(' ') })}>
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
  return (
    <div class="overlay" role="dialog" aria-label={gt('games.phone.leaveTitle', 'Leave the room')}>
      <div class="overlay-card">
        <h2 class="overlay-title">{gt('games.phone.leaveQuestion', 'Leave the room?')}</h2>
        <p class="muted">{gt('games.phone.leaveRejoin', 'You can rejoin with the same code while the room is still open.')}</p>
        <button type="button" class="danger" onClick={onLeave}>
          {gt('games.phone.leaveTitle', 'Leave the room')}
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

export function PhoneHeaderActions({ code, joinUrl, themeControl, onLeave }: PhoneHeaderActionsProps) {
  const [showSettings, setShowSettings] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const cycleTheme = (): void => {
    const current = presetIdOf(themeControl.theme);
    const index = current === null ? -1 : THEME_PRESET_IDS.indexOf(current);
    const nextId = THEME_PRESET_IDS[(index + 1) % THEME_PRESET_IDS.length];
    const next = nextId ? THEME_PRESETS[nextId] : undefined;
    if (next) themeControl.setOverride(next);
  };

  return (
    <div class="lobby-actions">
      <button type="button" class="icon-button" onClick={cycleTheme}>
        <ThemeIcon />
        <span class="icon-caption">{gt('games.phone.theme', 'Theme')}</span>
      </button>
      <button type="button" class="icon-button" onClick={() => setShowSettings(true)}>
        <SettingsIcon />
        <span class="icon-caption">{gt('games.phone.settings', 'Settings')}</span>
      </button>
      <button type="button" class="icon-button" onClick={() => setConfirmLeave(true)}>
        <CloseIcon />
        <span class="icon-caption">{gt('games.phone.leave', 'Leave')}</span>
      </button>

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
