import { useState } from 'react';
import type { FormEvent } from 'react';
import { CheckField, ErrorLine, TextField } from './fields';
import { DEFAULT_SIGN_UP_LABELS } from './labels';
import { PasswordStrengthMeter, usePasswordStrength } from './PasswordStrengthMeter';
import type { SignUpFormProps } from './types';
import { fill, safeLinkUrl } from './util';

export function SignUpForm({ onSubmit, checkStrength, minScore = 3, minAge, termsUrl, privacyUrl, busy = false, error, labels }: SignUpFormProps) {
  const termsHref = safeLinkUrl(termsUrl);
  const privacyHref = safeLinkUrl(privacyUrl);
  const l = { ...DEFAULT_SIGN_UP_LABELS, ...labels };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [terms, setTerms] = useState(false);
  const [age, setAge] = useState(false);
  const strength = usePasswordStrength(password, checkStrength);
  const differ = confirm !== '' && confirm !== password;
  const strongEnough = strength !== null && strength.score >= minScore;
  const canSubmit = !busy && email.trim() !== '' && strongEnough && password === confirm && terms && age;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({ email: email.trim(), password, consentTerms: terms, ageConfirmed: age }).catch(() => undefined);
  }

  return (
    <form className="kth-account" onSubmit={submit} noValidate>
      <h2 className="kth-account__title">{l.title}</h2>
      <TextField label={l.email} type="email" value={email} onChange={setEmail} autoComplete="email" disabled={busy} />
      <TextField label={l.password} type="password" value={password} onChange={setPassword} autoComplete="new-password" disabled={busy} />
      <PasswordStrengthMeter strength={strength} label={l.strength} scoreLabels={l.strengthScores} minScore={minScore} tooWeak={l.tooWeak} active={password !== ''} />
      <TextField label={l.confirmPassword} type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" disabled={busy} invalid={differ} />
      {differ ? <p className="kth-account__error" role="alert">{l.passwordsDiffer}</p> : null}
      <CheckField checked={terms} onChange={setTerms} disabled={busy}>{l.consentTerms}</CheckField>
      {termsUrl || privacyUrl ? (
        <p className="kth-account__links">
          {termsUrl ? (termsHref ? <a href={termsHref} target="_blank" rel="noreferrer noopener">{l.termsLink}</a> : <span>{l.termsLink}</span>) : null}
          {privacyUrl ? (privacyHref ? <a href={privacyHref} target="_blank" rel="noreferrer noopener">{l.privacyLink}</a> : <span>{l.privacyLink}</span>) : null}
        </p>
      ) : null}
      <CheckField checked={age} onChange={setAge} disabled={busy}>{fill(l.ageConfirm, { age: minAge })}</CheckField>
      <p className="kth-account__notice">{l.noRecoveryWarning}</p>
      <ErrorLine text={error} />
      <div className="kth-account__actions">
        <button type="submit" className="kth-btn kth-btn--primary" disabled={!canSubmit} aria-busy={busy || undefined}>
          {busy ? l.busy : l.submit}
        </button>
      </div>
    </form>
  );
}
