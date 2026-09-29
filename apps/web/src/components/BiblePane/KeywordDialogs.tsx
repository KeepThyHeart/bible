import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { useTranslation } from 'react-i18next';
import { KeywordMarkEditor, type KeywordMarkEditorProps } from '@bible/ui';
import { isValidationErrors, type KeywordMark } from '@bible/core/browser';
import { keywordMarkStore } from '../../stores/keywordMarkStore';
import { useStore } from '../../hooks/useStore';
import { editorLabels } from './keywordLabels';

interface KeywordDialogProps {
  title: string;
  onClose: () => void;
  children: ComponentChildren;
}

/** A small centred modal in the app's module-dialog style. Escape and the backdrop close it. */
export function KeywordDialog({ title, onClose, children }: KeywordDialogProps) {
  const { t } = useTranslation();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div class="module-dialog-overlay" onClick={onClose}>
      <div class="module-dialog keyword-dialog" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div class="module-dialog__header">
          <h3>{title}</h3>
          <button class="module-dialog__close" onClick={onClose} aria-label={t('keywordMarks.close')}>
            <i class="fa-solid fa-xmark" />
          </button>
        </div>
        <div class="keyword-dialog__body">{children}</div>
      </div>
    </div>
  );
}

interface MarkEditorDialogProps {
  paneId: string;
  /** Mark to edit; omit to add one. */
  mark?: KeywordMark;
  defaultColor?: KeywordMarkEditorProps['defaultColor'];
  onClose: () => void;
}

/** Add or edit one keyword mark. Saving writes to the user's sets through the store. */
export function MarkEditorDialog({ paneId, mark, defaultColor, onClose }: MarkEditorDialogProps) {
  const { t } = useTranslation();
  return (
    <KeywordDialog title={mark ? t('keywordMarks.editTitle') : t('keywordMarks.newTitle')} onClose={onClose}>
      <KeywordMarkEditor
        mark={mark}
        defaultColor={defaultColor}
        labels={editorLabels(t)}
        onCancel={onClose}
        onSave={(saved) => { void keywordMarkStore.saveMark(paneId, saved).then(onClose, onClose); }}
        onDelete={mark ? () => { void keywordMarkStore.deleteMark(mark.id).then(onClose, onClose); } : undefined}
      />
    </KeywordDialog>
  );
}

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Minimal set manager: duplicate, delete, export and import sets. Built-in sets are read-only. */
export function KeywordSetsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const sets = useStore(keywordMarkStore, () => keywordMarkStore.sets);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const result = await keywordMarkStore.importSet(await file.text());
      setError(isValidationErrors(result) ? t('keywordMarks.sets.importError') : '');
    } catch {
      setError(t('keywordMarks.sets.importError'));
    }
  };

  return (
    <KeywordDialog title={t('keywordMarks.sets.title')} onClose={onClose}>
      {sets.length === 0 ? <p>{t('keywordMarks.sets.empty')}</p> : (
        <ul class="keyword-sets">
          {sets.map((s) => (
            <li key={s.id} class="keyword-sets__row">
              <span class="keyword-sets__name">
                {s.name}
                {s.builtIn ? <span class="keyword-sets__tag"> ({t('keywordMarks.sets.builtIn')})</span> : null}
              </span>
              <span class="keyword-sets__meta">{t('keywordMarks.sets.marks', { count: s.marks.length })}</span>
              <button type="button" class="kth-btn kth-btn--sm" onClick={() => void keywordMarkStore.duplicateSet(s.id)}>
                {t('keywordMarks.sets.duplicate')}
              </button>
              <button type="button" class="kth-btn kth-btn--sm" onClick={() => download(`${s.name}.json`, keywordMarkStore.exportSet(s.id))}>
                {t('keywordMarks.sets.export')}
              </button>
              {!s.builtIn && (
                <button type="button" class="kth-btn kth-btn--sm" onClick={() => void keywordMarkStore.removeSet(s.id)}>
                  {t('keywordMarks.sets.delete')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" class="keyword-dialog__error">{error}</p>}
      <div class="keyword-dialog__footer">
        <button type="button" class="kth-btn kth-btn--sm" onClick={() => fileRef.current?.click()}>
          {t('keywordMarks.sets.import')}
        </button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden data-testid="keyword-import-input" onChange={onFile} />
      </div>
    </KeywordDialog>
  );
}
