import type { ReactNode } from 'react';

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Visible label (the whole row is the click target). */
  label?: ReactNode;
  /** Accessible name when there is no visible label. */
  ariaLabel?: string;
  /** Muted text after the label. */
  hint?: ReactNode;
  /** Colour when checked; 'success' is green. Default 'accent'. */
  tone?: 'accent' | 'success';
  disabled?: boolean;
  id?: string;
  name?: string;
  className?: string;
}

export interface RadioProps {
  checked: boolean;
  onChange: () => void;
  name: string;
  label: ReactNode;
  hint?: ReactNode;
  value?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}

// Static class strings only (the CSS coverage test and the linter read them literally).
function rowClass(success: boolean, disabled: boolean | undefined, extra: string | undefined): string {
  let c = success ? 'kth-check kth-check--success' : 'kth-check';
  if (disabled) c += ' kth-check--disabled';
  return extra ? `${c} ${extra}` : c;
}

/** A styled native checkbox with an optional label and hint. */
export function Checkbox(props: CheckboxProps) {
  const { checked, onChange, label, ariaLabel, hint, tone = 'accent', disabled, id, name, className } = props;
  const input = (
    <input
      type="checkbox"
      className="kth-check__input"
      id={id}
      name={name}
      checked={checked}
      disabled={disabled}
      aria-label={label ? undefined : ariaLabel}
      onChange={(e) => onChange(e.currentTarget.checked)}
    />
  );
  const cls = rowClass(tone === 'success', disabled, className);
  if (!label) return <span className={cls}>{input}</span>;
  return (
    <label className={cls}>
      {input}
      <span className="kth-check__label">{label}</span>
      {hint ? <span className="kth-check__hint">{hint}</span> : null}
    </label>
  );
}

/** A styled native radio button with a label and optional hint. */
export function Radio(props: RadioProps) {
  const { checked, onChange, name, label, hint, value, disabled, id, className } = props;
  return (
    <label className={rowClass(false, disabled, className)}>
      <input
        type="radio"
        className="kth-check__input"
        id={id}
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onChange()}
      />
      <span className="kth-check__label">{label}</span>
      {hint ? <span className="kth-check__hint">{hint}</span> : null}
    </label>
  );
}
