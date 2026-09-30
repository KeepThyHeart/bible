/**
 * Dialogs behind the Keywords toolbar button (task 0065): the mark editor and a minimal "Manage sets" dialog
 * (list, duplicate, delete, export and import as JSON). Portalled to `<body>` because the toolbar clips its
 * overflow and dockview's root contains layout, so an inline `fixed` overlay would be cut off.
 */
import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { KeywordMarkEditor } from '@bible/ui';
import { isValidationErrors, displayKeywordLabel, nextFreeColor, type KeywordMark } from '@bible/core/browser';
import { useI18n } from '../../contexts/useI18n';
import { useDialogShell } from '../PreferencesDialog/useDialogShell';
import { useKeywordMarkStore } from '../../stores/useKeywordMarkStore';
import { editorLabels } from './keywordLabels';

const Shell: React.FC<{ titleId: string; title: string; onClose: () => void; children: React.ReactNode; testId: string }> = ({
  titleId, title, onClose, children, testId,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  useDialogShell(ref, onClose);
  const dialog = (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ backgroundColor: 'var(--theme-bg-overlay)' }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={onClose}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="rounded-lg shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto"
        style={{ backgroundColor: 'var(--theme-surface-elevated)', border: '1px solid var(--theme-border-primary)' }}
        onClick={(e) => e.stopPropagation()}
        data-testid={testId}
      >
        <div className="px-6 pt-5 pb-5">
          <h2 id={titleId} className="text-lg font-semibold mb-3" style={{ color: 'var(--theme-text-heading)' }}>{title}</h2>
          {children}
        </div>
      </div>
    </div>
  );
  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body);
};

export interface EditTarget {
  /** Mark being edited; omitted for a new mark. */
  mark?: KeywordMark;
  /** Owning set of the mark being edited. */
  setId?: string;
}

export const KeywordEditorDialog: React.FC<{ tabId: string; target: EditTarget; onClose: () => void }> = ({ tabId, target, onClose }) => {
  const { t } = useI18n();
  const sets = useKeywordMarkStore((s) => s.sets);
  const saveMark = useKeywordMarkStore((s) => s.saveMark);
  const deleteMark = useKeywordMarkStore((s) => s.deleteMark);
  const owner = target.setId ? sets.find((s) => s.id === target.setId) : undefined;
  const editable = !!target.mark && !!owner && !owner.builtIn;
  return (
    <Shell
      titleId="keyword-editor-title"
      title={t(target.mark ? 'keywords.editor.titleEdit' : 'keywords.editor.titleNew')}
      onClose={onClose}
      testId="keyword-editor-dialog"
    >
      {owner?.builtIn && <p className="text-xs text-text-secondary mb-2">{t('keywords.editor.builtInNote')}</p>}
      <KeywordMarkEditor
        mark={target.mark}
        defaultColor={nextFreeColor(sets)}
        labels={editorLabels(t)}
        onCancel={onClose}
        onSave={(mark) => { void saveMark(tabId, mark, target.setId).then(onClose); }}
        onDelete={editable ? () => { void deleteMark(target.setId!, target.mark!.id).then(onClose); } : undefined}
      />
    </Shell>
  );
};

/** Trigger a browser download of `text` (no file-dialog IPC exists for keyword sets). */
export function downloadJson(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const ManageSetsDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useI18n();
  const sets = useKeywordMarkStore((s) => s.sets);
  const duplicateSet = useKeywordMarkStore((s) => s.duplicateSet);
  const removeSet = useKeywordMarkStore((s) => s.removeSet);
  const exportSet = useKeywordMarkStore((s) => s.exportSet);
  const importSet = useKeywordMarkStore((s) => s.importSet);
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const run = (p: Promise<unknown>) => { p.catch((e: unknown) => setMessage(e instanceof Error ? e.message : String(e))); };
  const btn = 'px-2 py-1 text-xs rounded border border-border hover:bg-background-hover';

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const result = await importSet(await file.text());
      setMessage(isValidationErrors(result) ? t('keywords.sets.importFailed') : t('keywords.sets.imported', { name: displayKeywordLabel(result.name) }));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Shell titleId="keyword-sets-title" title={t('keywords.sets.title')} onClose={onClose} testId="keyword-sets-dialog">
      <ul className="flex flex-col gap-2 mb-3" aria-label={t('keywords.sets.title')}>
        {sets.map((s) => (
          <li key={s.id} className="flex items-center gap-2 text-sm" data-testid={`keyword-set-${s.id}`}>
            <span className="flex-1 min-w-0 truncate">
              {displayKeywordLabel(s.name)}
              <span className="text-xs text-text-secondary ms-2">
                {s.builtIn ? t('keywords.sets.builtIn') : t('keywords.sets.markCount', { count: s.marks.length })}
              </span>
            </span>
            <button type="button" className={btn} onClick={() => run(duplicateSet(s.id))}>{t('keywords.sets.duplicate')}</button>
            <button type="button" className={btn} onClick={() => downloadJson(`${s.name}.keywords.json`, exportSet(s.id))}>{t('keywords.sets.export')}</button>
            {!s.builtIn && (confirmId === s.id ? (
              <button type="button" className={btn} onClick={() => { setConfirmId(null); run(removeSet(s.id)); }}>
                {t('keywords.sets.confirmDelete', { name: displayKeywordLabel(s.name) })}
              </button>
            ) : (
              <button type="button" className={btn} onClick={() => setConfirmId(s.id)}>{t('keywords.sets.delete')}</button>
            ))}
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={onFile} data-testid="keyword-sets-import-input" />
        <button type="button" className={btn} onClick={() => fileRef.current?.click()}>{t('keywords.sets.import')}</button>
        <span className="flex-1" />
        <button type="button" className={btn} onClick={onClose}>{t('keywords.sets.close')}</button>
      </div>
      <div role="status" aria-live="polite" className="text-xs text-text-secondary mt-2 min-h-4">{message}</div>
    </Shell>
  );
};
