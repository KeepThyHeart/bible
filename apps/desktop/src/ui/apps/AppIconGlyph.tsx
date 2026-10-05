import React from 'react';
import type { AppIcon } from '@bible/core/browser';

/**
 * Icons for apps. Desktop inlines glyph paths instead of loading an icon font
 * (see AppWordmark in App.tsx), so the descriptor's `{kind:'builtin', name}`
 * maps to a small set of inline SVGs. An unknown name falls back to a generic
 * app tile. Extension apps (`kind:'image'`) render through `<img>`.
 */
const SVG_PROPS = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
} as const;

const BUILTIN_GLYPHS: Record<string, React.ReactNode> = {
  'book-open': (
    <>
      <path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z" />
      <path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z" />
    </>
  ),
  presentation: (
    <>
      <path d="M2 3h20" />
      <path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3" />
      <path d="m7 21 5-5 5 5" />
    </>
  ),
  /** The generic fallback: a rounded square tile. */
  app: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <path d="M8 12h8M12 8v8" />
    </>
  ),
};

export function hasBuiltinGlyph(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(BUILTIN_GLYPHS, name);
}

export const AppIconGlyph: React.FC<{ icon: AppIcon; size?: number }> = ({ icon, size = 20 }) => {
  if (icon.kind === 'image') {
    return <img src={icon.src} alt="" width={size} height={size} draggable={false} />;
  }
  const glyph = hasBuiltinGlyph(icon.name) ? BUILTIN_GLYPHS[icon.name] : BUILTIN_GLYPHS.app;
  return (
    <svg {...SVG_PROPS} width={size} height={size} data-icon={hasBuiltinGlyph(icon.name) ? icon.name : 'app'}>
      {glyph}
    </svg>
  );
};
