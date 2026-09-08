/**
 * PinIcon.tsx
 *
 * Shared thumbtack (Font Awesome "thumbtack") glyph used anywhere content
 * can be pinned/unpinned (commentary passage sync, etc). Extracted from
 * CommentaryPassageHeader.tsx so other panes can reuse the same icon and
 * button without re-hand-rolling the SVG.
 */

import React from 'react';

export interface PinIconProps {
  /** Whether the pinned state is active. Defaults to false (unpinned). */
  pinned?: boolean;
  /** Sizing is controlled entirely via className (e.g. "w-3 h-3"). */
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Font Awesome "thumbtack" glyph. Rotated 45deg when unpinned, upright
 * (0deg) when pinned - matching the original CommentaryPassageHeader
 * behavior.
 */
export const PinIcon: React.FC<PinIconProps> = ({ pinned = false, className = 'w-3 h-3', style }) => (
  <svg
    className={className}
    viewBox="0 0 384 512"
    fill="currentColor"
    style={{ transform: pinned ? 'rotate(0deg)' : 'rotate(45deg)', ...style }}
  >
    <path d="M32 32C32 14.3 46.3 0 64 0H320c17.7 0 32 14.3 32 32s-14.3 32-32 32H290.5l11.4 148.2c36.7 19.9 65.3 53.2 79.5 93.8H2.6c14.1-40.6 42.8-73.9 79.5-93.8L93.5 64H64C46.3 64 32 49.7 32 32zM224 384v96c0 17.7-14.3 32-32 32s-32-14.3-32-32V384H224z" />
  </svg>
);

export interface PinButtonProps {
  pinned: boolean;
  onToggle: () => void;
  title?: string;
  size?: 'sm' | 'md';
  className?: string;
  /**
   * Optional text label rendered after the icon (e.g. "Pin"/"Pinned"). Omit
   * for an icon-only button (the original CommentaryPassageHeader look).
   */
  label?: React.ReactNode;
}

const SIZE_CLASSES: Record<'sm' | 'md', { icon: string; padding: string; fontSize: string }> = {
  sm: { icon: 'w-3 h-3', padding: '4px 8px', fontSize: '12px' },
  md: { icon: 'w-4 h-4', padding: '6px 10px', fontSize: '14px' },
};

/**
 * Button wrapping PinIcon with the active/inactive coloring used across the
 * app (active: accent color, inactive: muted text). Callers own the
 * `pinned` state and `onToggle` handler.
 */
export const PinButton: React.FC<PinButtonProps> = ({
  pinned,
  onToggle,
  title,
  size = 'sm',
  className = '',
  label,
}) => {
  const { icon, padding, fontSize } = SIZE_CLASSES[size];
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={pinned}
      className={`flex items-center rounded transition-colors ${
        pinned
          ? 'text-accent hover:text-accent-hover'
          : 'text-text-muted hover:text-text-primary hover:bg-background-hover'
      } ${className}`}
      style={{ padding, fontSize, gap: label ? '4px' : undefined }}
      title={title}
      data-testid="pin-button"
    >
      <PinIcon pinned={pinned} className={icon} />
      {label !== undefined && <span>{label}</span>}
    </button>
  );
};
