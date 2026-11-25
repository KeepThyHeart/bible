import React, { createContext, useContext } from 'react';
import { useI18n } from '../../contexts/useI18n';
import { useNotesZoomStore, NOTES_ZOOM_MAX, NOTES_ZOOM_MIN, NOTES_ZOOM_DEFAULT } from '../../stores/useNotesZoomStore';

/** True inside a container that already applies the notes zoom, so nested editors/viewers must not scale again. */
const ZoomAppliedContext = createContext(false);
export const NotesZoomApplied = ZoomAppliedContext.Provider;

/** The CSS `zoom` style for a notes content area (undefined at 100% or when an ancestor already zooms). */
export function useNotesZoomStyle(): React.CSSProperties | undefined {
  const applied = useContext(ZoomAppliedContext);
  const percent = useNotesZoomStore(s => s.percent);
  if (applied || percent === NOTES_ZOOM_DEFAULT) return undefined;
  return { zoom: percent / 100 };
}

/**
 * Style for a toolbar nested inside an already zoomed container (Chapter mode's inline editor): cancels
 * the container's zoom so the toolbar keeps its normal size. Undefined everywhere else.
 */
export function useNotesZoomCounterStyle(): React.CSSProperties | undefined {
  const applied = useContext(ZoomAppliedContext);
  const percent = useNotesZoomStore(s => s.percent);
  if (!applied || percent === NOTES_ZOOM_DEFAULT) return undefined;
  return { zoom: 100 / percent };
}

/** Zoom percentage with - / + and reset, for the notes toolbars (one per view: hidden inside a zoomed container). */
export const NotesZoomControl: React.FC = () => {
  const { t } = useI18n();
  const nested = useContext(ZoomAppliedContext);
  const percent = useNotesZoomStore(s => s.percent);
  const step = useNotesZoomStore(s => s.step);
  const reset = useNotesZoomStore(s => s.reset);
  if (nested) return null;
  const btn = 'px-2 py-0.5 text-xs rounded border border-border-secondary text-text-secondary hover:bg-background-hover disabled:opacity-40';
  return (
    <div className="flex items-center gap-1" role="group" aria-label={t('notesZoom.label')} data-testid="notes-zoom">
      <button type="button" className={btn} onClick={() => step(-1)} disabled={percent <= NOTES_ZOOM_MIN}
        title={t('notesZoom.zoomOut')} aria-label={t('notesZoom.zoomOut')} data-testid="notes-zoom-out">−</button>
      <button type="button" className="min-w-[3rem] px-1 py-0.5 rounded hover:bg-background-hover text-xs text-text-secondary tabular-nums"
        onClick={reset} title={t('notesZoom.reset')}  aria-label={t('notesZoom.reset')} data-testid="notes-zoom-reset">{percent}%</button>
      <button type="button" className={btn} onClick={() => step(1)} disabled={percent >= NOTES_ZOOM_MAX}
        title={t('notesZoom.zoomIn')} aria-label={t('notesZoom.zoomIn')} data-testid="notes-zoom-in">+</button>
    </div>
  );
};
