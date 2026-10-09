/**
 * The big screen.
 *
 * Sized for someone at the back of a hall: the quotation is the largest thing
 * on the screen, a name is a letter and a name and nothing else, and no meaning
 * is carried by colour alone — the speaker is marked with a word as well as a
 * hue.
 *
 * No reference appears until the reveal. A chapter beside the quotation turns
 * four names into two, and the round into a race to open a Bible app.
 *
 * The screen never shows who answered what. What it shows of the room is a bar
 * chart of counts, which is the same information a room can hear in the noise
 * it makes, and none of the information that makes someone not want to guess.
 */

import type { HostViewProps } from '../../shell/gameViews.js';
import { citation, letterFor, readDetail, readQuestion } from './payload.js';

function Nothing({ line }: { line: string }) {
  return (
    <section class="wsi wsi-host">
      <p class="wsi-nothing">{line}</p>
    </section>
  );
}

function Quote({ quote, size }: { quote: string; size: 'large' | 'medium' }) {
  return <blockquote class={`wsi-quote wsi-quote-${size}`}>“{quote}”</blockquote>;
}

export function HostQuestion({ view }: HostViewProps) {
  const question = readQuestion(view);
  if (!question) return <Nothing line="Nothing to show for this round." />;

  return (
    <section class="wsi wsi-host">
      <h2 class="wsi-ask">Who said it?</h2>
      <Quote quote={question.quote} size="large" />
      <p class="wsi-hint">Read it. The names come up in a moment.</p>
    </section>
  );
}

export function HostAnswering({ view }: HostViewProps) {
  const question = readQuestion(view);
  if (!question) return <Nothing line="Nothing to show for this round." />;

  return (
    <section class="wsi wsi-host">
      <h2 class="wsi-ask">Who said it?</h2>
      <Quote quote={question.quote} size="medium" />
      <ol class="wsi-options" aria-label="The names">
        {question.options.map((option) => (
          <li key={option.index} class="wsi-option">
            <span class="wsi-letter">{letterFor(option.index)}</span>
            <span class="wsi-name">{option.label}</span>
          </li>
        ))}
      </ol>
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
  // The verse in full when the module had it; the quotation alone when not.
  const words = detail.text.length > 0 ? detail.text : `“${detail.quote || question?.quote || ''}”`;
  const cited = citation(detail);
  // Played as a team vote, the shell draws each team's split under this view,
  // so the room's own split here would say the same thing twice.
  const teamVote = reveal.groups !== undefined;

  return (
    <section class="wsi wsi-host">
      <p class="wsi-answer-label">Who said it</p>
      <h2 class="wsi-answer">{detail.speaker}</h2>
      {detail.listener !== null && <p class="wsi-listener">to {detail.listener}</p>}

      <figure class="wsi-verse-figure">
        <blockquote class="wsi-verse">{words}</blockquote>
        {cited.length > 0 && <figcaption class="wsi-citation">{cited}</figcaption>}
      </figure>

      {!teamVote && (
        <>
          <ul class="wsi-split" aria-label="How the room answered">
            {aggregates.map((row) => (
              <li key={row.label} class="wsi-split-row" data-correct={row.label === reveal.correctLabel}>
                <span class="wsi-split-label">{row.label}</span>
                <span class="wsi-bar">
                  <span
                    class="wsi-bar-fill"
                    style={{ width: `${most === 0 ? 0 : Math.round((row.count / most) * 100)}%` }}
                  />
                </span>
                <span class="wsi-split-count">{row.count}</span>
              </li>
            ))}
          </ul>
          <p class="wsi-muted">
            {answered === 1 ? '1 answer' : `${answered} answers`} — nobody is named.
          </p>
        </>
      )}
    </section>
  );
}
