/**
 * KeywordMarkEditor: create or edit one keyword mark (0065). Label, rule (word forms / phrase / Strong's numbers /
 * connective category), style (MarkStylePicker) and enabled. On save the mark is checked with the core
 * `validateKeywordSet` (wrapped in a throwaway set), so the editor and the stored-data validator can never
 * disagree; failures show as field errors and nothing is saved. Uncontrolled: it owns the draft.
 */
import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import {
  CONNECTIVE_CATEGORIES, isValidationErrors, newKeywordId, validateKeywordSet,
} from '@bible/core/browser';
import type { ConnectiveCategory, KeywordMark, MarkStyle, MatchRule } from '@bible/core/browser';
import { MarkStylePicker } from './MarkStylePicker';
import type { MarkStylePickerProps } from './MarkStylePicker';

type RuleKind = MatchRule['kind'];
export type KeywordMarkEditorField = 'label' | 'rule';

export interface KeywordMarkEditorLabels {
  label: string;
  labelHint: string;
  ruleKind: string;
  kinds: Record<RuleKind, string>;
  forms: string;
  formsHint: string;
  phrase: string;
  strongs: string;
  strongsHint: string;
  category: string;
  categories: Record<ConnectiveCategory, string>;
  matchCase: string;
  style: string;
  enabled: string;
  save: string;
  cancel: string;
  delete: string;
  /** Error text per field; the core validator's own message is the fallback. */
  errors: Partial<Record<KeywordMarkEditorField, string>>;
  ruleErrors: Record<RuleKind, string>;
  stylePicker?: MarkStylePickerProps['labels'];
}

export const DEFAULT_KEYWORD_MARK_EDITOR_LABELS: KeywordMarkEditorLabels = {
  label: 'Name',
  labelHint: 'How the mark is listed in the legend.',
  ruleKind: 'Match by',
  kinds: { word: 'Word forms', phrase: 'Phrase', strongs: "Strong's numbers", connective: 'Connective' },
  forms: 'Word forms',
  formsHint: 'Separate with commas, e.g. love, loved, loveth.',
  phrase: 'Phrase',
  strongs: "Strong's numbers",
  strongsHint: 'Separate with commas, e.g. G4102, G4100. Needs an interlinear translation.',
  category: 'Category',
  categories: {
    inference: 'Inference (therefore)', reason: 'Reason (for, because)', contrast: 'Contrast (but, however)',
    purpose: 'Purpose (so that)', condition: 'Condition (if)', comparison: 'Comparison (as, like)', time: 'Time (when, then)',
  },
  matchCase: 'Match case',
  style: 'Style',
  enabled: 'Enabled',
  save: 'Save',
  cancel: 'Cancel',
  delete: 'Delete',
  errors: { label: 'Enter a name.' },
  ruleErrors: {
    word: 'Enter at least one word form.',
    phrase: 'Enter a phrase.',
    strongs: "Enter Strong's numbers like G4102 or H430.",
    connective: 'Choose a category.',
  },
};

export interface KeywordMarkEditorProps {
  /** The mark being edited; omit to create one. */
  mark?: KeywordMark;
  /** Colour preselected for a new mark (e.g. `nextFreeColor(sets)`). */
  defaultColor?: MarkStyle['color'];
  onSave: (mark: KeywordMark) => void;
  onCancel: () => void;
  /** Shown only when given (i.e. when editing an existing mark). */
  onDelete?: () => void;
  labels?: Partial<Omit<KeywordMarkEditorLabels, 'kinds' | 'categories' | 'errors' | 'ruleErrors'>> & {
    kinds?: Partial<KeywordMarkEditorLabels['kinds']>;
    categories?: Partial<KeywordMarkEditorLabels['categories']>;
    errors?: KeywordMarkEditorLabels['errors'];
    ruleErrors?: Partial<KeywordMarkEditorLabels['ruleErrors']>;
  };
  dir?: 'ltr' | 'rtl';
}

const splitList = (text: string): string[] => text.split(',').map((s) => s.trim()).filter(Boolean);

export function KeywordMarkEditor({ mark, defaultColor = 'mark.1', onSave, onCancel, onDelete, labels, dir }: KeywordMarkEditorProps) {
  const L: KeywordMarkEditorLabels = {
    ...DEFAULT_KEYWORD_MARK_EDITOR_LABELS,
    ...labels,
    kinds: { ...DEFAULT_KEYWORD_MARK_EDITOR_LABELS.kinds, ...labels?.kinds },
    categories: { ...DEFAULT_KEYWORD_MARK_EDITOR_LABELS.categories, ...labels?.categories },
    errors: { ...DEFAULT_KEYWORD_MARK_EDITOR_LABELS.errors, ...labels?.errors },
    ruleErrors: { ...DEFAULT_KEYWORD_MARK_EDITOR_LABELS.ruleErrors, ...labels?.ruleErrors },
  };
  const uid = useId();
  const rule = mark?.rule;

  const [label, setLabel] = useState(mark?.label ?? '');
  const [kind, setKind] = useState<RuleKind>(rule?.kind ?? 'word');
  const [forms, setForms] = useState(rule?.kind === 'word' ? rule.forms.join(', ') : '');
  const [phrase, setPhrase] = useState(rule?.kind === 'phrase' ? rule.text : '');
  const [strongs, setStrongs] = useState(rule?.kind === 'strongs' ? rule.numbers.join(', ') : '');
  const [category, setCategory] = useState<ConnectiveCategory | ''>(rule?.kind === 'connective' ? rule.category : '');
  const [matchCase, setMatchCase] = useState(rule?.kind === 'word' || rule?.kind === 'phrase' ? rule.matchCase === true : false);
  const [style, setStyle] = useState<MarkStyle>(mark?.style ?? { color: defaultColor, line: 'solid' });
  const [enabled, setEnabled] = useState(mark?.enabled ?? true);
  const [errors, setErrors] = useState<Partial<Record<KeywordMarkEditorField, string>>>({});

  const buildRule = (): unknown => {
    switch (kind) {
      case 'word': return { kind, forms: splitList(forms), ...(matchCase ? { matchCase: true } : {}) };
      case 'phrase': return { kind, text: phrase, ...(matchCase ? { matchCase: true } : {}) };
      case 'strongs': return { kind, numbers: splitList(strongs) };
      default: return { kind, category };
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const draft = { id: mark?.id ?? newKeywordId(), label, rule: buildRule(), style, enabled };
    const result = validateKeywordSet({
      schema: 1, id: 'draft', name: 'draft', scope: { kind: 'everywhere' }, marks: [draft], updatedAt: new Date(0).toISOString(),
    });
    if (isValidationErrors(result)) {
      const next: Partial<Record<KeywordMarkEditorField, string>> = {};
      for (const err of result) {
        const field: KeywordMarkEditorField = err.path.includes('.rule') ? 'rule' : 'label';
        next[field] ??= field === 'rule' ? L.ruleErrors[kind] : (L.errors.label ?? err.message);
      }
      setErrors(next);
      return;
    }
    setErrors({});
    const saved = result.marks[0];
    onSave(mark?.note ? { ...saved, note: mark.note } : saved);
  };

  const labelId = `${uid}-label`;
  const ruleId = `${uid}-rule`;
  const labelErr = errors.label ? `${uid}-label-err` : undefined;
  const ruleErr = errors.rule ? `${uid}-rule-err` : undefined;

  return (
    <form className="kth-mark-editor" onSubmit={submit} noValidate dir={dir}>
      <div className="kth-mark-editor__field">
        <label className="kth-mark-editor__label" htmlFor={labelId}>{L.label}</label>
        <input id={labelId} className="kth-input" type="text" value={label} maxLength={200}
          aria-invalid={labelErr ? 'true' : undefined} aria-describedby={labelErr}
          onChange={(e) => setLabel(e.currentTarget.value)} />
        {labelErr ? <p id={labelErr} role="alert" className="kth-mark-editor__error">{errors.label}</p> : null}
      </div>

      <div className="kth-mark-editor__field">
        <label className="kth-mark-editor__label" htmlFor={`${uid}-kind`}>{L.ruleKind}</label>
        <select id={`${uid}-kind`} className="kth-select" value={kind}
          onChange={(e) => { setKind(e.currentTarget.value as RuleKind); setErrors((p) => ({ ...p, rule: undefined })); }}>
          {(['word', 'phrase', 'strongs', 'connective'] as const).map((k) => <option key={k} value={k}>{L.kinds[k]}</option>)}
        </select>
      </div>

      <div className="kth-mark-editor__field">
        {kind === 'word' ? (
          <>
            <label className="kth-mark-editor__label" htmlFor={ruleId}>{L.forms}</label>
            <input id={ruleId} className="kth-input" type="text" value={forms}
              aria-invalid={ruleErr ? 'true' : undefined} aria-describedby={ruleErr}
              onChange={(e) => setForms(e.currentTarget.value)} />
            <span className="kth-mark-editor__hint">{L.formsHint}</span>
          </>
        ) : null}
        {kind === 'phrase' ? (
          <>
            <label className="kth-mark-editor__label" htmlFor={ruleId}>{L.phrase}</label>
            <input id={ruleId} className="kth-input" type="text" value={phrase}
              aria-invalid={ruleErr ? 'true' : undefined} aria-describedby={ruleErr}
              onChange={(e) => setPhrase(e.currentTarget.value)} />
          </>
        ) : null}
        {kind === 'strongs' ? (
          <>
            <label className="kth-mark-editor__label" htmlFor={ruleId}>{L.strongs}</label>
            <input id={ruleId} className="kth-input" type="text" value={strongs}
              aria-invalid={ruleErr ? 'true' : undefined} aria-describedby={ruleErr}
              onChange={(e) => setStrongs(e.currentTarget.value)} />
            <span className="kth-mark-editor__hint">{L.strongsHint}</span>
          </>
        ) : null}
        {kind === 'connective' ? (
          <>
            <label className="kth-mark-editor__label" htmlFor={ruleId}>{L.category}</label>
            <select id={ruleId} className="kth-select" value={category}
              aria-invalid={ruleErr ? 'true' : undefined} aria-describedby={ruleErr}
              onChange={(e) => setCategory(e.currentTarget.value as ConnectiveCategory)}>
              <option value="" />
              {CONNECTIVE_CATEGORIES.map((c) => <option key={c} value={c}>{L.categories[c]}</option>)}
            </select>
          </>
        ) : null}
        {kind === 'word' || kind === 'phrase' ? (
          <label className="kth-mark-editor__check">
            <input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.currentTarget.checked)} />
            {L.matchCase}
          </label>
        ) : null}
        {ruleErr ? <p id={ruleErr} role="alert" className="kth-mark-editor__error">{errors.rule}</p> : null}
      </div>

      <fieldset className="kth-mark-editor__field">
        <legend className="kth-mark-editor__label">{L.style}</legend>
        <MarkStylePicker value={style} onChange={setStyle} labels={L.stylePicker} dir={dir} />
      </fieldset>

      <label className="kth-mark-editor__check">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.currentTarget.checked)} />
        {L.enabled}
      </label>

      <div className="kth-mark-editor__actions">
        {onDelete ? <button type="button" className="kth-btn kth-btn--danger" onClick={onDelete}>{L.delete}</button> : null}
        <button type="button" className="kth-btn" onClick={onCancel}>{L.cancel}</button>
        <button type="submit" className="kth-btn kth-btn--primary">{L.save}</button>
      </div>
    </form>
  );
}
