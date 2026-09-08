import { STUDY_MODE } from './studyMode';
import { READING_MODE } from './readingMode';
import { STUDY_MODE_QUAD } from './studyModeQuad';
import { WRITER_MODE } from './writerMode';
import type { LayoutPreset } from '../types/LayoutPreset';

export const BUILT_IN_PRESETS: readonly LayoutPreset[] = [
  STUDY_MODE,
  READING_MODE,
  WRITER_MODE,
  STUDY_MODE_QUAD,
];

/**
 * The layout applied on a fresh profile (see `createDefaultLayout` in
 * DockviewLayout / `AppInitService`). "Reset to default layout" re-applies this
 * so a novice who has dragged panes into a mangled state can recover in one
 * click. Kept as an id constant so the dropdown and any command stay in sync.
 */
export const DEFAULT_LAYOUT_PRESET_ID = STUDY_MODE.id;

export { STUDY_MODE, READING_MODE, STUDY_MODE_QUAD, WRITER_MODE };
