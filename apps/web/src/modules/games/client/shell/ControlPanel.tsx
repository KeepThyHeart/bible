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
import { gt } from './t.js';

export interface ControlPanelProps {
  pendingJudge: ControlPanelData['pendingJudge'];
  onCommand(command: HostCommand): void;
}

export function ControlPanel({ pendingJudge, onCommand }: ControlPanelProps) {
  if (pendingJudge === null) return null;

  const { playerAnswer, canonicalAnswer, accept, contextNote, suggestion } = pendingJudge;

  return (
    <section class="control-panel judge-card" aria-label={gt('games.organizer.judgeLabel', 'Adjudicate the answer')}>
      <p class="judge-label">{gt('games.organizer.theySaid', 'They said')}</p>
      <p class="judge-answer">{playerAnswer.length > 0 ? playerAnswer : gt('games.organizer.nothingTyped', '(nothing typed)')}</p>

      <p class="judge-label">{gt('games.organizer.lookingFor', 'Looking for')}</p>
      <p class="judge-expected">{canonicalAnswer}</p>
      {accept.length > 1 && (
        <p class="judge-accept muted small">{gt('games.organizer.alsoAccepted', 'Also accepted: {words}', {
            words: accept.filter((word) => word !== canonicalAnswer).join(', '),
          })}</p>
      )}
      {contextNote !== null && <p class="judge-note muted small">{contextNote}</p>}

      {suggestion !== null && (
        <p class="judge-suggestion" data-verdict={suggestion.verdict}>
          {gt('games.organizer.suggestion', 'Suggestion: {verdict} — {reason}', {
            verdict: suggestion.verdict,
            reason: suggestion.reason,
          })}
        </p>
      )}

      <div class="judge-verdicts" role="group" aria-label={gt('games.organizer.verdict', 'Verdict')}>
        <button type="button" class="judge-correct" onClick={() => onCommand({ cmd: 'judge', verdict: 'correct' })}>
          {gt('games.organizer.correct', 'Correct')}
        </button>
        <button
          type="button"
          class="judge-incorrect"
          onClick={() => onCommand({ cmd: 'judge', verdict: 'incorrect' })}
        >
          {gt('games.organizer.incorrect', 'Incorrect')}
        </button>
        <button
          type="button"
          class="judge-specific"
          onClick={() => onCommand({ cmd: 'judge', verdict: 'askToBeSpecific' })}
        >
          {gt('games.organizer.askSpecific', 'Ask to be specific')}
        </button>
      </div>
    </section>
  );
}

/**
 * A phone asking to run the room, approved or declined with one tap each.
 * More than one can be waiting at once; each is its own line.
 */
export function ControlRequests({
  requests,
  onCommand,
}: {
  requests: ControlPanelData['requests'];
  onCommand(command: HostCommand): void;
}) {
  if (requests.length === 0) return null;
  return (
    <div
      class="control-requests"
      role="group"
      aria-label={gt('games.organizer.requestsLabel', 'Requests to be the organizer')}
    >
      {requests.map((request) => (
        <p key={request.playerId} class="control-request">
          <span>{gt('games.organizer.wantsToRun', 'Wants to be the organizer')}</span>
          <button
            type="button"
            class="btn-primary"
            onClick={() => onCommand({ cmd: 'grantControl', playerId: request.playerId })}
          >
            {gt('games.organizer.letThem', 'Let them')}
          </button>
          <button type="button" onClick={() => onCommand({ cmd: 'denyControl', playerId: request.playerId })}>
            {gt('games.organizer.no', 'No')}
          </button>
        </p>
      ))}
    </div>
  );
}
