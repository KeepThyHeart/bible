/**
 * The big screen.
 *
 * Everything here is sized for someone at the back of a hall who is not wearing
 * their glasses: the verse is the largest thing on the screen, an option is a
 * letter and a reference and nothing else, and no meaning is carried by colour
 * alone — the right answer is marked with a word as well as a hue.
 *
 * The screen never shows who answered what. What it shows of the room is a bar
 * chart of counts, which is the same information a room can hear in the noise
 * it makes, and none of the information that makes someone not want to guess.
 */

import type { HostViewProps } from '../../shell/gameViews.js';
import { DISTANCE_CAPTIONS, letterFor, readDetail, readQuestion } from './payload.js';
import type { Question } from './payload.js';

function Nothing({ line }: { line: string }) {
  return (
    <section class="ntr ntr-host">
      <p class="ntr-nothing">{line}</p>
    </section>
  );
}

function Verse({ question, size }: { question: Question; size: 'large' | 'medium' }) {
  return (
    <figure class="ntr-quote">
      <blockquote class={`ntr-verse ntr-verse-${size}`}>{question.text}</blockquote>
      {question.translation.length > 0 && (
        <figcaption class="ntr-translation">{question.translation}</figcaption>
      )}
    </figure>
  );
}

export function HostQuestion({ view }: HostViewProps) {
  const question = readQuestion(view);
  if (!question) return <Nothing line="Nothing to show for this round." />;

  return (
    <section class="ntr ntr-host">
      <h2 class="ntr-ask">Where is this from?</h2>
      <Verse question={question} size="large" />
      <p class="ntr-hint">Read it. Answers open in a moment.</p>
    </section>
  );
}

export function HostAnswering({ view }: HostViewProps) {
  const question = readQuestion(view);
  if (!question) return <Nothing line="Nothing to show for this round." />;

  return (
    <section class="ntr ntr-host">
      <Verse question={question} size="medium" />
      {question.answerShape === 'choice' ? (
        <ol class="ntr-options" aria-label="The options">
          {question.options.map((option) => (
            <li key={option.index} class="ntr-option">
              <span class="ntr-letter">{letterFor(option.index)}</span>
              <span class="ntr-ref">{option.label}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p class="ntr-hint">Type the book, the chapter and the verse on your phone.</p>
      )}
    </section>
  );
}

export function HostReveal({ view, reveal }: HostViewProps) {
  const detail = readDetail(reveal?.detail);
  const question = readQuestion(view);
  if (!reveal || !detail) return <Nothing line="Waiting for the answer." />;

  const aggregates = reveal.aggregates;
  const most = aggregates.reduce((high, row) => Math.max(high, row.count), 0);
  const answered = aggregates.reduce((total, row) => total + row.count, 0);
  // Played as a team vote, the shell draws each team's split under this view,
  // so the room's own split here would say the same thing twice.
  const teamVote = reveal.groups !== undefined;

  return (
    <section class="ntr ntr-host">
      <p class="ntr-answer-label">The answer</p>
      <h2 class="ntr-answer">{reveal.correctLabel}</h2>
      <figure class="ntr-quote">
        <blockquote class="ntr-verse ntr-verse-medium">
          {detail.text.length > 0 ? detail.text : (question?.text ?? '')}
        </blockquote>
        {detail.translation.length > 0 && (
          <figcaption class="ntr-translation">{detail.translation}</figcaption>
        )}
      </figure>

      {detail.options.length > 0 && (
        <ul class="ntr-why" aria-label="Where the other options came from">
          {detail.options
            .filter((option) => !option.correct && option.distance !== null)
            .map((option) => (
              <li key={option.label}>
                <span class="ntr-ref">{option.label}</span>
                <span class="ntr-muted">
                  {DISTANCE_CAPTIONS[option.distance ?? 'anywhere']}
                </span>
              </li>
            ))}
        </ul>
      )}

      {!teamVote && (
        <>
          <ul class="ntr-split" aria-label="How the room answered">
            {aggregates.map((row) => (
              <li key={row.label} class="ntr-split-row" data-correct={row.label === reveal.correctLabel}>
                <span class="ntr-split-label">{row.label}</span>
                <span class="ntr-bar">
                  <span
                    class="ntr-bar-fill"
                    style={{ width: `${most === 0 ? 0 : Math.round((row.count / most) * 100)}%` }}
                  />
                </span>
                <span class="ntr-split-count">{row.count}</span>
              </li>
            ))}
          </ul>
          <p class="ntr-muted">
            {answered === 1 ? '1 answer' : `${answered} answers`} — nobody is named.
          </p>
        </>
      )}
    </section>
  );
}
