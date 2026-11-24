/** The audio UI's small inline icons (the desktop app does not ship an icon font). Decorative: always aria-hidden. */
import React from 'react';

export type AudioIconName =
  | 'play' | 'pause' | 'prevVerse' | 'nextVerse' | 'prevChapter' | 'nextChapter' | 'stop' | 'close'
  | 'gear' | 'speaker' | 'spinner' | 'popOut' | 'dock' | 'chevron';

const PATHS: Record<AudioIconName, string> = {
  play: 'M8 5v14l11-7z',
  pause: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z',
  prevVerse: 'M7 6h2v12H7zM20 6v12L10 12z',
  nextVerse: 'M15 6h2v12h-2zM4 6l10 6L4 18z',
  prevChapter: 'M4 6h2v12H4zM13 6v12L7 12zM21 6v12l-8-6z',
  nextChapter: 'M18 6h2v12h-2zM11 6v12l6-6zM3 6v12l8-6z',
  stop: 'M7 7h10v10H7z',
  close: 'M6 6l12 12M18 6L6 18',
  gear: 'M12 8.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7zm8 3.5l-1.8-.7a6.6 6.6 0 00-.5-1.2l.8-1.8-1.4-1.4-1.8.8c-.4-.2-.8-.4-1.2-.5L13.4 4h-2l-.7 1.8c-.4.1-.8.3-1.2.5l-1.8-.8-1.4 1.4.8 1.8c-.2.4-.4.8-.5 1.2L4 11.6v2l1.8.7c.1.4.3.8.5 1.2l-.8 1.8 1.4 1.4 1.8-.8c.4.2.8.4 1.2.5l.7 1.8h2l.7-1.8c.4-.1.8-.3 1.2-.5l1.8.8 1.4-1.4-.8-1.8c.2-.4.4-.8.5-1.2L20 13.6z',
  speaker: 'M4 9v6h4l5 4V5L8 9zM16 8.5a5 5 0 010 7M18.5 6a8.5 8.5 0 010 12',
  spinner: 'M12 3a9 9 0 109 9',
  popOut: 'M14 4h6v6M20 4l-9 9M18 14v5H5V6h5',
  dock: 'M5 18h14',
  chevron: 'M9 5l7 7-7 7',
};
// Solid shapes are filled; the rest are stroked.
const FILLED = new Set<AudioIconName>(['play', 'pause', 'prevVerse', 'nextVerse', 'prevChapter', 'nextChapter', 'stop', 'gear']);

export const AudioIcon: React.FC<{ name: AudioIconName; className?: string; size?: number }> = ({ name, className, size = 16 }) => {
  const filled = FILLED.has(name);
  const mirror = name === 'prevVerse' || name === 'nextVerse' || name === 'prevChapter' || name === 'nextChapter' || name === 'chevron' || name === 'popOut';
  return (
    <svg
      className={`${mirror ? 'rtl-mirror ' : ''}${className ?? ''}`.trim() || undefined}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[name]} />
    </svg>
  );
};
