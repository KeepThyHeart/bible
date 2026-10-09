/**
 * The projector.
 *
 * Everything here is sized to be read from the back of a room by someone who
 * is not wearing their glasses, which rules out most of what a screen this
 * size tempts you to put on it. The room code, the round number, the timer bar
 * and the standings are the shell's, and drawing them again would only compete
 * with the verse.
 *
 * The reference shows from the start of the round now, alongside the blanked
 * text (`BlankedVerse` in `VerseText.tsx`) — a deliberate reversal of the
 * design this game shipped with; see the server module's doc comment.
 */

import type { HostViewProps } from '../../shell/gameViews.js';
import { asPrompt, asReveal, hasVerse } from './payload.js';
import { BlankedVerse, FilledVerse, NoVerse } from './VerseText.js';

function Question({ view }: HostViewProps) {
  const prompt = asPrompt(view);

  return (
    <section class="fitb-host">
      <h2 class="fitb-lead">Fill in the blank</h2>
      {hasVerse(prompt) ? <BlankedVerse prompt={prompt} /> : <NoVerse />}
    </section>
  );
}

function Answering({ view }: HostViewProps) {
  const prompt = asPrompt(view);

  return (
    <section class="fitb-host">
      {hasVerse(prompt) ? <BlankedVerse prompt={prompt} /> : <NoVerse />}
      <p class="fitb-lead">Type the missing word on your phone</p>
    </section>
  );
}

/**
 * The reveal is the part of the round the group talks over, so it carries the
 * whole of what they might want: the word, the verse it came from, and where
 * to find it.
 *
 * The tally underneath is counts and nothing else. What the room submitted is
 * interesting; who submitted it is nobody's business on a wall.
 */
function Reveal({ reveal }: HostViewProps) {
  if (reveal === null) return <NoVerse />;
  const detail = asReveal(reveal.detail);

  return (
    <section class="fitb-host fitb-reveal">
      <p class="fitb-word">{reveal.correctLabel}</p>
      {detail !== null && (
        <>
          <p class="fitb-ref">{detail.reference}</p>
          <FilledVerse reveal={detail} />
        </>
      )}
      {reveal.aggregates.length > 0 && (
        <ul class="fitb-tally">
          {reveal.aggregates.map((entry, index) => (
            <li key={`${index}:${entry.label}`} data-correct={index === 0 ? 'true' : 'false'}>
              <span class="fitb-tally-word">{entry.label}</span>
              <span class="fitb-tally-count">{entry.count}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export const hostViews = { question: Question, answering: Answering, reveal: Reveal };
