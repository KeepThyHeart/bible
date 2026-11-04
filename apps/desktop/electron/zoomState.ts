/**
 * Persisted page zoom (B-106). The View menu / Ctrl+= / Ctrl+- zoom levels were
 * lost on every restart and could be pushed without limit. Levels are Chromium
 * zoom levels (factor = 1.2 ^ level): 0 is 100%, clamped to about 50%-300%.
 */
import fs from 'fs';

export const MIN_ZOOM_LEVEL = -3.5;
export const MAX_ZOOM_LEVEL = 6;

export function clampZoomLevel(level: number): number {
  if (!Number.isFinite(level)) return 0;
  return Math.min(MAX_ZOOM_LEVEL, Math.max(MIN_ZOOM_LEVEL, level));
}

/** The saved level, or 0 when the file is missing or unreadable. */
export function readZoomLevel(filePath: string): number {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as { level?: unknown };
    return typeof parsed.level === 'number' ? clampZoomLevel(parsed.level) : 0;
  } catch {
    return 0;
  }
}

export function writeZoomLevel(filePath: string, level: number): void {
  try {
    fs.writeFileSync(filePath, JSON.stringify({ level: clampZoomLevel(level) }), 'utf-8');
  } catch {
    // Not being able to remember the zoom must never break zooming.
  }
}
