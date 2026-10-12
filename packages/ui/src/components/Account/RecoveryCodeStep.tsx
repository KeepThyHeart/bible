import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { TextField } from './fields';
import { DEFAULT_RECOVERY_CODE_LABELS } from './labels';
import type { RecoveryCodeStepProps } from './types';
import { fill } from './util';

const ASKED = 4;

/** Splits a code into display groups: on whitespace/dashes if present, else chunks of 4. */
function toGroups(code: string): string[] {
  const parts = code.trim().split(/[\s-]+/).filter(Boolean);
  if (parts.length > 1) return parts;
  const flat = parts[0] ?? '';
  return flat.match(/.{1,4}/g) ?? [];
}

function pickPositions(length: number, count: number, random: () => number): number[] {
  const idx = Array.from({ length }, (_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(random() * (i + 1)));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, Math.min(count, length)).sort((a, b) => a - b);
}

export function RecoveryCodeStep({ code, onConfirmed, onDownload, labels, random = Math.random }: RecoveryCodeStepProps & { random?: () => number }) {
  const l = { ...DEFAULT_RECOVERY_CODE_LABELS, ...labels };
  const groups = useMemo(() => toGroups(code), [code]);
  const chars = useMemo(() => groups.join('').split(''), [groups]);
  const positions = useMemo(() => pickPositions(chars.length, ASKED, random), [chars.length, random]);
  const [answers, setAnswers] = useState<string[]>(() => positions.map(() => ''));
  const [mismatch, setMismatch] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(groups.join('-'));
        setCopied(true);
      }
    } catch {
      setCopied(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const ok = positions.every((p, i) => (answers[i] ?? '').trim().toLowerCase() === chars[p].toLowerCase());
    setMismatch(!ok);
    if (ok) onConfirmed();
  }

  return (
    <form className="kth-account" onSubmit={submit} noValidate>
      <h2 className="kth-account__title">{l.title}</h2>
      <p className="kth-account__intro">{l.intro}</p>
      <p className="kth-account__code" aria-label={l.title}>
        {groups.map((g, i) => <span key={i} className="kth-account__code-group">{g}</span>)}
      </p>
      <p className="kth-account__notice">{l.warning}</p>
      <div className="kth-account__actions">
        <button type="button" className="kth-btn" onClick={() => { void copy(); }}>{copied ? l.copied : l.copy}</button>
        {onDownload ? <button type="button" className="kth-btn" onClick={onDownload}>{l.download}</button> : null}
      </div>
      <p className="kth-account__intro">{l.confirmCharacter}</p>
      <div className="kth-account__confirm-row">
        {positions.map((p, i) => (
          <TextField
            key={p}
            label={fill(l.confirmPrompt, { n: p + 1 })}
            value={answers[i] ?? ''}
            maxLength={1}
            mono
            autoComplete="off"
            invalid={mismatch}
            onChange={(v) => { setMismatch(false); setAnswers((a) => a.map((x, j) => (j === i ? v : x))); }}
          />
        ))}
      </div>
      {mismatch ? <p className="kth-account__error" role="alert">{l.mismatch}</p> : null}
      <div className="kth-account__actions">
        <button type="submit" className="kth-btn kth-btn--primary" disabled={answers.some((a) => a.trim() === '')}>{l.confirm}</button>
      </div>
    </form>
  );
}
