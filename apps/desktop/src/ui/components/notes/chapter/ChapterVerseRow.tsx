import React, { useCallback } from 'react';
import { useI18n } from '../../../contexts/useI18n';
import { HighlightedVerse } from '../../highlights/HighlightRenderer';
import NoteEditor from '../editor/NoteEditor';
import NoteViewer from '../editor/NoteViewer';
import { navigateToVerseInPrimary } from '../../../stores/crossStoreBridge';
import type { ChapterRow } from './useChapterNotes';
import type { ChapterActiveState } from './useChapterActiveEditor';
import type { CSSProperties } from 'react';

export interface ChapterVerseTextProps {
  className: string;
  style: CSSProperties;
  dir: 'ltr' | 'rtl';
  lang?: string;
}

export interface ChapterVerseRowProps {
  row: ChapterRow;
  moduleId: number;
  /** Bible container attributes (classes, font variables, dir/lang) for the verse text. */
  textProps: ChapterVerseTextProps;
  /** Set only on the row whose editor is open. */
  active: ChapterActiveState | null;
  onActivate: (verse: number) => void;
  onChange: (html: string) => void;
  onNormalized: (html: string) => void;
  onResolveConflict: (choice: 'overwrite' | 'reload') => void;
  preserveSelectionFlag: { get(): boolean; clear(): void };
}

function noteHtml(row: ChapterRow): string | null {
  const content = row.record?.note.content;
  return typeof content === 'string' && content.length > 0 ? content : null;
}

const smallBtn = 'px-2 py-0.5 text-xs rounded border border-border-secondary hover:bg-background-hover transition-colors';

const ChapterVerseRowImpl: React.FC<ChapterVerseRowProps> = ({
  row, moduleId, textProps, active, onActivate, onChange, onNormalized, onResolveConflict, preserveSelectionFlag,
}) => {
  const { t } = useI18n();
  const { verse, verseId } = row;
  const html = noteHtml(row);

  const activate = useCallback(() => onActivate(verse), [onActivate, verse]);
  const onViewerClick = useCallback((e: React.MouseEvent) => {
    // A reference or link inside the note does its own thing.
    if ((e.target as HTMLElement).closest('a, .verse-link, .scripture-link')) return;
    onActivate(verse);
  }, [onActivate, verse]);
  const onViewerKey = useCallback((e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(verse); }
  }, [onActivate, verse]);

  return (
    <div
      className="px-3 py-2 border-b border-border"
      data-testid={`chapter-row-${verse}`}
      data-verse-row={verse}
      data-active={active ? 'true' : undefined}
      style={active ? undefined : { contentVisibility: 'auto', containIntrinsicSize: 'auto 96px' }}
    >
      <div {...textProps} data-testid={`chapter-verse-text-${verse}`}>
        <button
          type="button"
          className="me-1 align-super text-xs font-semibold text-text-secondary hover:text-accent"
          aria-label={t('chapterNotes.goToVerse', { verse })}
          onClick={() => navigateToVerseInPrimary(verseId)}
        >
          {verse}
        </button>
        <HighlightedVerse verseId={verseId} verseHTML={row.verseHtml} moduleId={moduleId} />
      </div>

      <div className="mt-1 ms-4">
        {active ? (
          <div data-testid={`chapter-editor-${verse}`}>
            {active.conflict && (
              <div role="alert" className="flex flex-wrap items-center gap-2 text-sm px-2 py-1 mb-1 rounded bg-warning-light border border-warning" data-testid="chapter-conflict">
                <span>{t('chapterNotes.changedElsewhere')}</span>
                <button type="button" className={smallBtn} onClick={() => onResolveConflict('overwrite')}>{t('chapterNotes.overwrite')}</button>
                <button type="button" className={smallBtn} onClick={() => onResolveConflict('reload')}>{t('chapterNotes.loadTheirs')}</button>
              </div>
            )}
            {active.loading ? (
              <div className="text-sm text-text-secondary" role="status">{t('chapterNotes.loadingNote')}</div>
            ) : (
              <NoteEditor
                key={verseId}
                value={active.html}
                onChange={onChange}
                onNormalized={onNormalized}
                autoFocus={active.autoFocus}
                preserveSelectionFlag={preserveSelectionFlag}
              />
            )}
            <div className="text-xs text-text-secondary h-4" aria-live="polite">
              {active.saving ? <span data-testid="chapter-saving">{t('chapterNotes.saving')}</span>
                : active.dirty ? <span data-testid="chapter-unsaved">{t('chapterNotes.unsaved')}</span> : null}
            </div>
          </div>
        ) : html !== null ? (
          <div
            role="button"
            tabIndex={0}
            aria-label={t('chapterNotes.editNote', { verse })}
            className="rounded cursor-text hover:bg-background-hover [&_.note-viewer-content]:pt-0 [&_.note-viewer-content>:first-child]:mt-0"
            title={t('chapterNotes.verseShortcutHint')}
            data-testid={`chapter-note-${verse}`}
            data-row-trigger=""
            onClick={onViewerClick}
            onKeyDown={onViewerKey}
          >
            <NoteViewer content={html} rich />
          </div>
        ) : (
          <button type="button" className={smallBtn} onClick={activate} data-testid={`chapter-add-${verse}`} title={t('chapterNotes.verseShortcutHint')} data-row-trigger="" aria-label={t('chapterNotes.addNoteFor', { verse })}>
            {t('chapterNotes.addNote')}
          </button>
        )}
      </div>
    </div>
  );
};

const ChapterVerseRow = React.memo(ChapterVerseRowImpl);
export default ChapterVerseRow;
