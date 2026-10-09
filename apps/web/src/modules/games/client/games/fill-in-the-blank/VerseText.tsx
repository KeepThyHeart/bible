/**
 * Drawing the verse, with the hole in it and then without.
 *
 * Both screens draw the same two things, so they are written once. The only
 * difference between a projector and a phone here is type size, and that is a
 * stylesheet's business rather than a component's.
 */

import type { BlankPrompt, BlankReveal } from './payload.js';

/** What the blank is called out loud, for anyone reading with a screen reader. */
const BLANK_LABEL = 'missing word';

export function BlankedVerse({ prompt }: { prompt: BlankPrompt }) {
  const parts = prompt.text.split(prompt.blank);
  const opening = parts[0] ?? prompt.text;

  return (
    <>
      {prompt.reference !== '' && <p class="fitb-ref">{prompt.reference}</p>}
      <p class="fitb-verse">
        {opening}
        <span class="fitb-blank" aria-label={BLANK_LABEL}>
          {prompt.blank}
        </span>
        {parts.slice(1).join(prompt.blank)}
      </p>
    </>
  );
}

/** The same verse with the word back in it, marked so the eye finds it. */
export function FilledVerse({ reveal }: { reveal: BlankReveal }) {
  return (
    <p class="fitb-verse">
      {reveal.before}
      <strong class="fitb-answer">{reveal.word}</strong>
      {reveal.after}
    </p>
  );
}

/**
 * Shown when the round carries no verse. A server with no Bible module can
 * still run a lobby, and saying so beats an empty screen nobody can diagnose
 * from the back of a room.
 */
export function NoVerse() {
  return (
    <p class="fitb-missing" role="status">
      No verse to show. The server has no Bible module installed.
    </p>
  );
}
