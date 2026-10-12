/** Internal form building blocks for the Account components. */
import { useId } from 'react';
import type { ReactNode } from 'react';

export interface TextFieldProps {
  label: string; value: string; onChange(v: string): void; type?: 'text' | 'email' | 'password';
  autoComplete?: string; invalid?: boolean; describedBy?: string; disabled?: boolean; required?: boolean;
  maxLength?: number; mono?: boolean; hint?: string;
}

export function TextField({ label, value, onChange, type = 'text', autoComplete, invalid, describedBy, disabled, required = true, maxLength, mono, hint }: TextFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="kth-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className={mono ? 'kth-input kth-account__mono' : 'kth-input'}
        type={type}
        value={value}
        autoComplete={autoComplete}
        aria-invalid={invalid ? 'true' : undefined}
        aria-describedby={[describedBy, hint ? hintId : undefined].filter(Boolean).join(' ') || undefined}
        disabled={disabled}
        required={required}
        maxLength={maxLength}
        spellCheck={false}
        autoCapitalize="off"
        onChange={(e) => onChange(e.target.value)}
      />
      {hint ? <p id={hintId} className="kth-field__hint">{hint}</p> : null}
    </div>
  );
}

export function CheckField({ checked, onChange, children, hint, disabled }: {
  checked: boolean; onChange(v: boolean): void; children: ReactNode; hint?: string; disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="kth-account__check">
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-describedby={hint ? `${id}-hint` : undefined} />
      <div>
        <label htmlFor={id}>{children}</label>
        {hint ? <p id={`${id}-hint`} className="kth-field__hint">{hint}</p> : null}
      </div>
    </div>
  );
}

export function ErrorLine({ text, id }: { text?: string; id?: string }) {
  return text ? <p id={id} className="kth-account__error" role="alert">{text}</p> : null;
}
