/**
 * PasswordStrengthMeter (internal): shows the score from the async `checkStrength` (debounced 250 ms)
 * plus its feedback. `usePasswordStrength` is the hook the forms use to gate submit. The password is only
 * passed to the caller's `checkStrength`; it is never logged or kept beyond component state.
 */
import { useEffect, useRef, useState } from 'react';
import type { PasswordStrength } from './types';

export const STRENGTH_DEBOUNCE_MS = 250;

export function usePasswordStrength(password: string, checkStrength: (pw: string) => Promise<PasswordStrength>): PasswordStrength | null {
  const [result, setResult] = useState<{ for: string; value: PasswordStrength } | null>(null);
  const check = useRef(checkStrength);
  check.current = checkStrength;
  useEffect(() => {
    if (!password) return undefined;
    let live = true;
    const t = setTimeout(() => {
      check.current(password).then(
        (value) => { if (live) setResult({ for: password, value }); },
        () => { if (live) setResult(null); },
      );
    }, STRENGTH_DEBOUNCE_MS);
    return () => { live = false; clearTimeout(t); };
  }, [password]);
  // A result only counts for the exact password it was computed for (so submit stays blocked while it is stale).
  return password && result && result.for === password ? result.value : null;
}

export interface PasswordStrengthMeterProps {
  strength: PasswordStrength | null; label: string; scoreLabels: readonly string[]; minScore: number; tooWeak: string;
  /** True once the user typed something (so "too weak" is not shown on an empty field). */
  active: boolean;
}

export function PasswordStrengthMeter({ strength, label, scoreLabels, minScore, tooWeak, active }: PasswordStrengthMeterProps) {
  if (!active) return null;
  const score = strength ? strength.score : null;
  return (
    <div className="kth-account__strength" role="status" aria-live="polite">
      <div className="kth-account__strength-head">
        <span>{label}</span>
        <span className="kth-account__strength-text">{score === null ? '...' : (scoreLabels[score] ?? '')}</span>
      </div>
      <div className="kth-account__strength-bar" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={4} aria-valuenow={score ?? 0}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={score !== null && score > i ? `kth-account__strength-seg kth-account__strength-seg--${score >= minScore ? 'ok' : 'low'}` : 'kth-account__strength-seg'} />
        ))}
      </div>
      {score !== null && score < minScore ? <p className="kth-account__hint-warn">{tooWeak}</p> : null}
      {strength && strength.feedback.length > 0 ? (
        <ul className="kth-account__feedback">
          {strength.feedback.map((f, i) => <li key={i}>{f}</li>)}
        </ul>
      ) : null}
    </div>
  );
}
