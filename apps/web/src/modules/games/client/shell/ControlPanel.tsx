/**
 * The judge card: what one player actually said or typed, before anyone has
 * ruled on it.
 *
 * Built from `ControlPanel['pendingJudge']` alone — `JudgeRequest` already
 * carries the question, the canonical answer, the accept list and the
 * prefix a buzzed-in player had actually read, so this needs no game
 * module to draw. That is what lets it be rendered on whichever device
 * currently holds control, a screen or a phone, without either one
 * special-casing the other.
 *
 * Renders nothing when nobody is waiting on a ruling — a controlling phone
 * with no open judgement takes up no extra space for one.
 */

import type { ControlPanel as ControlPanelData, HostCommand } from '../../shared/protocol.js';

export interface ControlPanelProps {
  pendingJudge: ControlPanelData['pendingJudge'];
  onCommand(command: HostCommand): void;
}

export function ControlPanel({ pendingJudge, onCommand }: ControlPanelProps) {
  if (pendingJudge === null) return null;

  const { playerAnswer, canonicalAnswer, accept, contextNote, suggestion } = pendingJudge;

  return (
    <section class="control-panel judge-card" aria-label="Adjudicate the answer">
      <p class="judge-label">They said</p>
      <p class="judge-answer">{playerAnswer.length > 0 ? playerAnswer : '(nothing typed)'}</p>

      <p class="judge-label">Looking for</p>
      <p class="judge-expected">{canonicalAnswer}</p>
      {accept.length > 1 && (
        <p class="judge-accept muted small">Also accepted: {accept.filter((word) => word !== canonicalAnswer).join(', ')}</p>
      )}
      {contextNote !== null && <p class="judge-note muted small">{contextNote}</p>}

      {suggestion !== null && (
        <p class="judge-suggestion" data-verdict={suggestion.verdict}>
          Suggestion: {suggestion.verdict} — {suggestion.reason}
        </p>
      )}

      <div class="judge-verdicts" role="group" aria-label="Verdict">
        <button type="button" class="judge-correct" onClick={() => onCommand({ cmd: 'judge', verdict: 'correct' })}>
          Correct
        </button>
        <button
          type="button"
          class="judge-incorrect"
          onClick={() => onCommand({ cmd: 'judge', verdict: 'incorrect' })}
        >
          Incorrect
        </button>
        <button
          type="button"
          class="judge-specific"
          onClick={() => onCommand({ cmd: 'judge', verdict: 'askToBeSpecific' })}
        >
          Ask to be specific
        </button>
      </div>
    </section>
  );
}
