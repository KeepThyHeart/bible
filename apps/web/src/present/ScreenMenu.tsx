/**
 * The screen's own hover options: style, size, margin, fullscreen, and the
 * choice to override any of the presenter's display settings just for this
 * screen. See `useHoverMenu` for when it is shown, and `useLocalOverride` for
 * what "override" means and does not (yet) do.
 *
 * This page loads no icon font (see `viewer.css`'s header), so every control
 * here is a plain text button -- consistent with the rest of the viewer, and
 * one less thing this page depends on being ready before a service starts.
 */

import type { PresentTheme } from './protocol';
import { MAX_FONT_STEP, MIN_FONT_STEP } from './protocol';
import { MAX_OVERSCAN } from './viewerChrome';
import { buildFollowLink } from './controlLink';

const THEMES: Array<{ value: PresentTheme; label: string }> = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'max', label: 'Max visibility' },
];

export function ScreenMenu(props: {
  visible: boolean;
  theme: PresentTheme;
  fontStep: number;
  hasOverride: boolean;
  onSetTheme(theme: PresentTheme): void;
  onSetFontStep(step: number): void;
  onClearOverride(): void;
  overscan: number;
  onAdjustOverscan(delta: number): void;
  isFullscreen: boolean;
  onToggleFullscreen(): void;
  /** Omitted in the controller's preview, which is not a real screen to switch away from. */
  joinCode?: string;
}): preact.JSX.Element | null {
  if (!props.visible) return null;

  return (
    <div class="pv-menu" role="toolbar" aria-label="Screen options">
      <div class="pv-menu-row">
        <span class="pv-menu-label">Style</span>
        {THEMES.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            class={`pv-menu-choice${props.theme === value ? ' pv-menu-choice--active' : ''}`}
            onClick={() => props.onSetTheme(value)}
          >
            {label}
          </button>
        ))}

        <span class="pv-menu-label pv-menu-label--gap">Size</span>
        <button
          type="button"
          class="pv-menu-btn"
          disabled={props.fontStep <= MIN_FONT_STEP}
          onClick={() => props.onSetFontStep(props.fontStep - 1)}
          aria-label="Smaller text"
        >
          &minus;
        </button>
        <span class="pv-menu-value">{props.fontStep}</span>
        <button
          type="button"
          class="pv-menu-btn"
          disabled={props.fontStep >= MAX_FONT_STEP}
          onClick={() => props.onSetFontStep(props.fontStep + 1)}
          aria-label="Larger text"
        >
          +
        </button>
      </div>

      <div class="pv-menu-row">
        <span class="pv-menu-label">Margin</span>
        <button
          type="button"
          class="pv-menu-btn"
          disabled={props.overscan <= 0}
          onClick={() => props.onAdjustOverscan(-1)}
          aria-label="Less margin"
        >
          &minus;
        </button>
        <span class="pv-menu-value">{props.overscan}</span>
        <button
          type="button"
          class="pv-menu-btn"
          disabled={props.overscan >= MAX_OVERSCAN}
          onClick={() => props.onAdjustOverscan(1)}
          aria-label="More margin"
        >
          +
        </button>

        <button type="button" class="pv-menu-btn pv-menu-btn--wide" onClick={props.onToggleFullscreen}>
          {props.isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        </button>

        {/*
          For whoever opened the projector link on a phone by mistake -- or a
          screen someone would simply rather read along on. The other
          direction lives on the follow banner itself (`FollowBanner.tsx`,
          "Open screen view instead"), so the switch works both ways without
          either page having to guess what kind of device it is running on.
        */}
        {props.joinCode && (
          <a class="pv-menu-btn pv-menu-btn--wide" href={buildFollowLink(props.joinCode)}>
            Follow along instead
          </a>
        )}
      </div>

      <div class="pv-menu-row pv-menu-row--status">
        {props.hasOverride ? (
          <>
            <span class="pv-menu-status">Using this screen&rsquo;s own settings.</span>
            <button type="button" class="pv-menu-btn" onClick={props.onClearOverride}>
              Use the presenter&rsquo;s settings
            </button>
          </>
        ) : (
          <span class="pv-menu-status">Using the presenter&rsquo;s settings.</span>
        )}
      </div>
    </div>
  );
}
