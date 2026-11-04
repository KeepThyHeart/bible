import { useState } from 'react';
import type { FormEvent } from 'react';
import { ErrorLine, TextField } from './fields';
import { DEFAULT_RECOVER_LABELS } from './labels';
import { PasswordStrengthMeter, usePasswordStrength } from './PasswordStrengthMeter';
import type { RecoverFormProps } from './types';

const MIN_SCORE = 3;

/** RecoverFormLabels has no score names (frozen types), so the meter shows the bar and feedback only. */
export function RecoverForm({ onRecover, onStartOver, checkStrength, busy = false, error, labels }: RecoverFormProps) {
  const l = { ...DEFAULT_RECOVER_LABELS, ...labels };
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [startOverOpen, setStartOverOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const strength = usePasswordStrength(password, checkStrength);
  const differ = confirm !== '' && confirm !== password;
  const canSubmit = !busy && email.trim() !== '' && code.trim() !== '' && strength !== null && strength.score >= MIN_SCORE && password === confirm;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    onRecover({ email: email.trim(), code: code.trim(), newPassword: password }).catch(() => undefined);
  }

  async function startOver() {
    setSending(true);
    try {
      await onStartOver(email.trim());
      setSent(true);
    } catch {
      // The host reports failures through `error`.
    } finally {
      setSending(false);
    }
  }

  return (
    <form className="kth-account" onSubmit={submit} noValidate>
      <h2 className="kth-account__title">{l.title}</h2>
      <p className="kth-account__intro">{l.intro}</p>
      <TextField label={l.email} type="email" value={email} onChange={setEmail} autoComplete="username" disabled={busy} />
      <TextField label={l.code} value={code} onChange={setCode} autoComplete="off" mono disabled={busy} />
      <TextField label={l.newPassword} type="password" value={password} onChange={setPassword} autoComplete="new-password" disabled={busy} />
      <PasswordStrengthMeter strength={strength} label={l.strength} scoreLabels={[]} minScore={MIN_SCORE} tooWeak={l.tooWeak} active={password !== ''} />
      <TextField label={l.confirmPassword} type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" disabled={busy} invalid={differ} />
      {differ ? <p className="kth-account__error" role="alert">{l.passwordsDiffer}</p> : null}
      <ErrorLine text={error} />
      <div className="kth-account__actions">
        <button type="submit" className="kth-btn kth-btn--primary" disabled={!canSubmit} aria-busy={busy || undefined}>
          {busy ? l.busy : l.submit}
        </button>
      </div>
      <div className="kth-account__section">
        <button type="button" className="kth-account__link" aria-expanded={startOverOpen} onClick={() => setStartOverOpen((o) => !o)}>
          {l.noCodeTitle}
        </button>
        {startOverOpen ? (
          <div className="kth-account__stack">
            <p>{l.startOverIntro}</p>
            <p className="kth-account__notice">{l.startOverWarning}</p>
            {sent ? (
              <p role="status">{l.startOverSent}</p>
            ) : (
              <div className="kth-account__actions">
                <button type="button" className="kth-btn kth-btn--danger" disabled={sending || email.trim() === ''} onClick={() => { void startOver(); }}>
                  {l.startOver}
                </button>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </form>
  );
}
