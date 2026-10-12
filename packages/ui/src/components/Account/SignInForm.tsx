import { useState } from 'react';
import type { FormEvent } from 'react';
import { CheckField, ErrorLine, TextField } from './fields';
import { DEFAULT_SIGN_IN_LABELS } from './labels';
import type { SignInFormProps } from './types';

export function SignInForm({ onSubmit, onForgot, showRemember, busy = false, error, labels }: SignInFormProps) {
  const l = { ...DEFAULT_SIGN_IN_LABELS, ...labels };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const canSubmit = !busy && email.trim() !== '' && password !== '';

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({ email: email.trim(), password, remember: showRemember && remember }).catch(() => undefined);
  }

  return (
    <form className="kth-account" onSubmit={submit} noValidate>
      <h2 className="kth-account__title">{l.title}</h2>
      <TextField label={l.email} type="email" value={email} onChange={setEmail} autoComplete="username" disabled={busy} />
      <TextField label={l.password} type="password" value={password} onChange={setPassword} autoComplete="current-password" disabled={busy} />
      {showRemember ? <CheckField checked={remember} onChange={setRemember} hint={l.rememberHint} disabled={busy}>{l.remember}</CheckField> : null}
      <ErrorLine text={error} />
      <div className="kth-account__actions">
        <button type="submit" className="kth-btn kth-btn--primary" disabled={!canSubmit} aria-busy={busy || undefined}>
          {busy ? l.busy : l.submit}
        </button>
        <button type="button" className="kth-account__link" onClick={onForgot} disabled={busy}>{l.forgot}</button>
      </div>
    </form>
  );
}
