/**
 * The big screen.
 *
 * Sized for someone at the back of a hall: the items are the largest thing on
 * the screen, each under a letter the room can say aloud, and the list is a
 * plain list rather than anything that looks like it is already ordered.
 *
 * The reveal tells the room two counts — how many had it all in order, and how
 * many were one swap away — and nothing about anyone further off. That is the
 * praise, and it is public; where a player went wrong is on their own phone.
 */

import type { HostViewProps } from '../../shell/gameViews.js';
import { gt } from '../../shell/t.js';
import { awaitingReveal } from '../../shell/waitingCopy.js';
import { letterFor, readDetail, readQuestion } from './payload.js';
import type { OrderQuestion } from './payload.js';
import { RightOrder } from './RightOrder.js';

function Nothing({ line, why }: { line: string; why: string | null }) {
  return (
    <section class="pio pio-host">
      <p class="pio-nothing">{line}</p>
      {why !== null && <p class="pio-muted">{why}</p>}
    </section>
  );
}

const unreadable = () => <Nothing line={gt('games.putInOrder.view.nothingToShow', 'Nothing to show for this round.')} why={null} />;

const noLists = () => (
  <Nothing
    line={gt('games.putInOrder.view.nothingToOrder', 'Nothing to put in order this round.')}
    why={gt('games.putInOrder.view.noLists', 'There are no lists for this game on this server yet.')}
  />
);

function Shuffled({ question }: { question: OrderQuestion }) {
  return (
    <ul class="pio-items" aria-label={gt('games.putInOrder.view.itemsShuffled', 'The items, shuffled')}>
      {question.items.map((item, index) => (
        <li key={item.key} class="pio-item">
          <span class="pio-letter">{letterFor(index)}</span>
          <span class="pio-label">{item.label}</span>
        </li>
      ))}
    </ul>
  );
}

function Heading({ question }: { question: OrderQuestion }) {
  return (
    <header class="pio-heading">
      {question.title.length > 0 && <h2 class="pio-title">{question.title}</h2>}
      <p class="pio-instructions">{question.instructions}</p>
    </header>
  );
}

export function HostQuestion({ view }: HostViewProps) {
  const question = readQuestion(view);
  if (!question) return unreadable();
  if (question.items.length === 0) return noLists();

  return (
    <section class="pio pio-host">
      <Heading question={question} />
      <Shuffled question={question} />
      <p class="pio-hint">{gt('games.putInOrder.view.orderingOpensSoon', 'Ordering opens in a moment.')}</p>
    </section>
  );
}

export function HostAnswering({ view }: HostViewProps) {
  const question = readQuestion(view);
  if (!question) return unreadable();
  if (question.items.length === 0) return noLists();

  return (
    <section class="pio pio-host">
      <Heading question={question} />
      <Shuffled question={question} />
      <p class="pio-hint">{gt('games.putInOrder.view.tapInOrder', 'Tap them in order on your phone.')}</p>
    </section>
  );
}

export function HostReveal({ reveal }: HostViewProps) {
  const detail = readDetail(reveal?.detail);
  if (!reveal || !detail) return <Nothing line={awaitingReveal()} why={null} />;

  // The server always leads with these two rows, in this order, so the screen
  // can praise them without matching on wording.
  const inOrder = reveal.aggregates[0]?.count ?? 0;
  const nearly = reveal.aggregates[1]?.count ?? 0;
  const answered = reveal.aggregates.reduce((total, row) => total + row.count, 0);

  return (
    <section class="pio pio-host">
      <p class="pio-answer-label">{gt('games.putInOrder.view.rightOrder', 'The right order')}</p>
      {detail.title.length > 0 && <h2 class="pio-title">{detail.title}</h2>}
      <RightOrder items={detail.items} />

      <ul class="pio-tally" aria-label={gt('games.putInOrder.view.howDid', 'How everyone did')}>
        <li class="pio-tally-row" data-kind="in-order">
          <span class="pio-tally-count">{inOrder}</span>
          <span class="pio-tally-label">{gt('games.putInOrder.view.allInOrder', 'had it all in order')}</span>
        </li>
        <li class="pio-tally-row" data-kind="nearly">
          <span class="pio-tally-count">{nearly}</span>
          <span class="pio-tally-label">{nearly === 1 ? gt('games.putInOrder.view.oneSwapOne', 'was one swap away') : gt('games.putInOrder.view.oneSwapMany', 'were one swap away')}</span>
        </li>
      </ul>
      <p class="pio-muted">{answered === 1
          ? gt('games.putInOrder.view.oneAnswerAnonymous', '1 answer. Nobody is named.')
          : gt('games.putInOrder.view.manyAnswersAnonymous', '{count} answers. Nobody is named.', { count: answered })}</p>
    </section>
  );
}
