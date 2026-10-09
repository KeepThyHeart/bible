/**
 * The clues, as both screens draw them.
 *
 * During play the newest clue is the one to read, so it is marked as the
 * newest by position, weight and an attribute a screen reader announces, not by
 * colour alone. At the reveal every clue is shown with where it comes from,
 * because the reference is what someone looks up on the way home.
 */

import type { RevealClue } from './payload.js';

export function LiveClues({ clues, shown, size }: { clues: readonly string[]; shown: number; size: 'large' | 'small' }) {
  return (
    <ol class={`wai-clues wai-clues-${size}`} aria-label="Clues so far" aria-live="polite">
      {clues.slice(0, shown).map((text, position) => (
        <li key={position} class="wai-clue" data-latest={position === shown - 1 ? 'true' : 'false'}>
          <span class="wai-clue-number">{position + 1}</span>
          <span class="wai-clue-text">{text}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Every clue with its reference. With `counts` the big screen adds how many got
 * it at each one — a count and a bar, and never a name.
 */
export function RevealClues({ clues, counts, size }: { clues: readonly RevealClue[]; counts: boolean; size: 'large' | 'small' }) {
  const most = clues.reduce((high, clue) => Math.max(high, clue.gotIt), 0);
  return (
    <ol class={`wai-clues wai-clues-${size}`} aria-label="All the clues">
      {clues.map((clue, position) => (
        <li key={position} class="wai-clue wai-reveal-clue">
          <span class="wai-clue-number">{position + 1}</span>
          <span class="wai-clue-body">
            <span class="wai-clue-text">{clue.text}</span>
            {clue.reference !== null && <cite class="wai-ref">{clue.reference}</cite>}
          </span>
          {counts && (
            <span class="wai-got">
              <span class="wai-bar" aria-hidden="true">
                <span
                  class="wai-bar-fill"
                  style={{ width: `${most === 0 ? 0 : Math.round((clue.gotIt / most) * 100)}%` }}
                />
              </span>
              <span class="wai-got-count">{clue.gotIt === 1 ? '1 got it' : `${clue.gotIt} got it`}</span>
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
