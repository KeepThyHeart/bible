import { useId, useState } from 'react';
import { normalizeWordGroup } from '@bible/core/browser';
import type { WordGroup } from '@bible/core/browser';
import { mergeWordStudyLabels } from './wordStudyLabels';
import type { WordStudyLabels } from './wordStudyLabels';

export interface WordGroupEditorProps {
  /** An existing group to edit (with an id), or omitted for a new one. */
  group?: WordGroup | null;
  onSave: (group: WordGroup) => void;
  onCancel: () => void;
  /** Delete is offered only for an existing group (one with an id) when this is given. */
  onDelete?: (id: string) => void;
  labels?: Partial<WordStudyLabels>;
}

const splitLines = (s: string): string[] => s.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);

export function WordGroupEditor({ group, onSave, onCancel, onDelete, labels }: WordGroupEditorProps) {
  const l = mergeWordStudyLabels(labels);
  const uid = useId();
  const [label, setLabel] = useState(group?.label ?? '');
  const [terms, setTerms] = useState((group?.terms ?? []).join('\n'));
  const [exclude, setExclude] = useState((group?.exclude ?? []).join('\n'));
  const [stem, setStem] = useState(group?.stem !== false);
  const [error, setError] = useState(false);
  const existing = !!group?.id;

  const submit = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    const t = splitLines(terms);
    if (t.length === 0) {
      setError(true);
      return;
    }
    setError(false);
    onSave(normalizeWordGroup({ ...group, id: group?.id, label, terms: t, exclude: splitLines(exclude), stem }));
  };

  return (
    <form className="kth-ws-editor" onSubmit={submit} noValidate>
      <label className="kth-ws-editor__field" htmlFor={`${uid}-label`}>{l.groupLabel}</label>
      <input id={`${uid}-label`} className="kth-input" value={label} onChange={(e) => setLabel(e.currentTarget.value)} />
      <label className="kth-ws-editor__field" htmlFor={`${uid}-terms`}>{l.groupTerms}</label>
      <textarea
        id={`${uid}-terms`}
        className="kth-input kth-ws-editor__area"
        rows={4}
        value={terms}
        aria-invalid={error}
        aria-describedby={`${uid}-hint${error ? ` ${uid}-err` : ''}`}
        onChange={(e) => setTerms(e.currentTarget.value)}
      />
      <p id={`${uid}-hint`} className="kth-ws-editor__hint">{l.groupTermsHint}</p>
      {error && <p id={`${uid}-err`} className="kth-ws-editor__error" role="alert">{l.groupTermsRequired}</p>}
      <label className="kth-ws-editor__field" htmlFor={`${uid}-ex`}>{l.groupExclude}</label>
      <textarea id={`${uid}-ex`} className="kth-input kth-ws-editor__area" rows={2} value={exclude} aria-describedby={`${uid}-exh`} onChange={(e) => setExclude(e.currentTarget.value)} />
      <p id={`${uid}-exh`} className="kth-ws-editor__hint">{l.groupExcludeHint}</p>
      <label className="kth-ws-editor__check">
        <input type="checkbox" checked={stem} onChange={(e) => setStem(e.currentTarget.checked)} />
        <span>{l.groupStem}</span>
      </label>
      <div className="kth-ws-editor__actions">
        <button type="submit" className="kth-btn kth-btn--primary kth-btn--sm">{l.save}</button>
        <button type="button" className="kth-btn kth-btn--sm" onClick={onCancel}>{l.cancel}</button>
        {existing && onDelete && (
          <button type="button" className="kth-btn kth-btn--danger kth-btn--sm" onClick={() => onDelete(group!.id)}>{l.delete}</button>
        )}
      </div>
    </form>
  );
}
