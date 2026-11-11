/**
 * What a player sees once an answer has gone in: what was sent, and what is
 * being waited on. Games that lock after the first answer use it so every
 * game says the same thing in the same place.
 */

import { sentLabel, waitingForAnswer } from './waitingCopy.js';
import '../styles/phone.css';

export interface SentCardProps {
  /** What the player sent, as they would read it back. */
  answer: string;
  /** Replaces "Waiting for the answer." when something else is being waited on. */
  waiting?: string;
}

export function SentCard({ answer, waiting }: SentCardProps) {
  return (
    <div class="sent-card" role="status">
      <span class="sent-label">{sentLabel()}</span>
      <strong class="sent-answer">{answer}</strong>
      <span class="muted">{waiting ?? waitingForAnswer()}</span>
    </div>
  );
}
