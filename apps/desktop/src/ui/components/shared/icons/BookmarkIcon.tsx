/**
 * BookmarkIcon.tsx
 *
 * The ribbon a reader already knows from a physical Bible: the marker that
 * says "this is the page I want back". Used by the Bible toolbar's bookmark
 * menu, the verse context menu and the marker beside a bookmarked verse, so
 * all three read as the same object.
 *
 * A star was the earlier glyph and meant "favourite", which is a different
 * promise - a star ranks, a ribbon returns you somewhere.
 */

import React from 'react';

export interface BookmarkIconProps {
  /** Whether this bookmark exists (filled ribbon) or is on offer (outline). */
  marked?: boolean;
  /** Sizing is controlled entirely via className (e.g. "w-4 h-4"). */
  className?: string;
  style?: React.CSSProperties;
}

/**
 * The ribbon's colour when it marks something.
 *
 * Deep, bright red - the colour of the ribbon sewn into a hardback Bible, and
 * the one thing on the page that is allowed to be that saturated. It is a
 * single value across every theme rather than a per-theme token: it reads at
 * better than 4:1 on both the light and the dark backgrounds this app ships,
 * and a bookmark that changed hue with the theme would stop being a landmark.
 * A theme that must have its own may still define `--theme-bookmark-rgb`.
 */
export const BOOKMARK_COLOR = 'rgb(var(--theme-bookmark-rgb, 214 40 40))';

export const BookmarkIcon: React.FC<BookmarkIconProps> = ({
  marked = false,
  className = 'w-4 h-4',
  style,
}) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill={marked ? 'currentColor' : 'none'}
    stroke="currentColor"
    aria-hidden="true"
    focusable="false"
    style={style}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M6 4a2 2 0 012-2h8a2 2 0 012 2v17l-6-4.5L6 21V4z"
    />
  </svg>
);
