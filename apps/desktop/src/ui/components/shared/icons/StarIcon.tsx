/**
 * StarIcon.tsx
 *
 * Shared star glyph used anywhere content can be favorited/unfavorited
 * (Commentary Overview tab, etc). Mirrors PinIcon.tsx's API so favorite and
 * pin affordances stay visually and structurally consistent across the app.
 */

import React from 'react';

export interface StarIconProps {
  /** Whether the favorited state is active. Defaults to false (not favorited). */
  favorited?: boolean;
  /** Sizing is controlled entirely via className (e.g. "w-3 h-3"). */
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Five-point star. Filled when favorited, outline-only when not - the same
 * favorited/unfavorited visual language used for highlight/bookmark stars
 * elsewhere in the app.
 */
export const StarIcon: React.FC<StarIconProps> = ({ favorited = false, className = 'w-3 h-3', style }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill={favorited ? 'currentColor' : 'none'}
    stroke="currentColor"
    style={style}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"
    />
  </svg>
);

export interface StarButtonProps {
  favorited: boolean;
  onToggle: () => void;
  title?: string;
  size?: 'sm' | 'md';
  className?: string;
}

const SIZE_CLASSES: Record<'sm' | 'md', { icon: string; padding: string; fontSize: string }> = {
  sm: { icon: 'w-3 h-3', padding: '4px 8px', fontSize: '12px' },
  md: { icon: 'w-4 h-4', padding: '6px 10px', fontSize: '14px' },
};

/**
 * Button wrapping StarIcon with the active/inactive coloring used across the
 * app (active: accent color, inactive: muted text). Callers own the
 * `favorited` state and `onToggle` handler. Mirrors PinButton.
 */
export const StarButton: React.FC<StarButtonProps> = ({
  favorited,
  onToggle,
  title,
  size = 'sm',
  className = '',
}) => {
  const { icon, padding, fontSize } = SIZE_CLASSES[size];
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={favorited}
      className={`flex items-center rounded transition-colors ${
        favorited
          ? 'text-accent hover:text-accent-hover'
          : 'text-text-muted hover:text-text-primary hover:bg-background-hover'
      } ${className}`}
      style={{ padding, fontSize }}
      title={title}
      data-testid="star-button"
    >
      <StarIcon favorited={favorited} className={icon} />
    </button>
  );
};
