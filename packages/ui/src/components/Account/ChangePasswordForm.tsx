import { useState } from 'react';
import type { FormEvent } from 'react';
import { CheckField, ErrorLine, TextField } from './fields';
import { DEFAULT_CHANGE_PASSWORD_LABELS } from './labels';
import { PasswordStrengthMeter, usePasswordStrength } from './PasswordStrengthMeter';
import type { ChangePasswordFormProps } from './types';

const MIN_SCORE = 3;

/** `onCancel` is an additive prop (frozen props have the `cancel` label but no handler); the button shows only when given. */
export function ChangePasswordForm({ onSubmit, checkStrength, busy = false, error, labels, onCancel }: ChangePasswordFormProps & { onCancel?(): void }) {
  const l = { ...DEFAULT_CHANGE_PASSWORD_LABELS, ...labels };
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [signOutOthers, setSignOutOthers] = useState(true);
  const strength = usePasswordStrength(next, checkStrength);
  const differ = confirm !== '' && confirm !== next;
  const canSubmit = !busy && current !== '' && strength !== null && strength.score >= MIN_SCORE && next === confirm;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({ current, next, signOutOthers }).catch(() => undefined);
  }

  return (
    <form className="kth-account" onSubmit={submit} noValidate>
      <h2 className="kth-account__title">{l.title}</h2>
      <TextField label={l.current} type="password" value={current} onChange={setCurrent} autoComplete="current-password" disabled={busy} />
      <TextField label={l.next} type="password" value={next} onChange={setNext} autoComplete="new-password" disabled={busy} />
      <PasswordStrengthMeter strength={strength} label={l.strength} scoreLabels={[]} minScore={MIN_SCORE} tooWeak={l.tooWeak} active={next !== ''} />
      <TextField label={l.confirm} type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" disabled={busy} invalid={differ} />
      {differ ? <p className="kth-account__error" role="alert">{l.passwordsDiffer}</p> : null}
      <CheckField checked={signOutOthers} onChange={setSignOutOthers} disabled={busy}>{l.signOutOthers}</CheckField>
      <ErrorLine text={error} />
      <div className="kth-account__actions">
        <button type="submit" className="kth-btn kth-btn--primary" disabled={!canSubmit} aria-busy={busy || undefined}>
          {busy ? l.busy : l.submit}
        </button>
        {onCancel ? <button type="button" className="kth-btn kth-btn--ghost" onClick={onCancel} disabled={busy}>{l.cancel}</button> : null}
      </div>
    </form>
  );
}
