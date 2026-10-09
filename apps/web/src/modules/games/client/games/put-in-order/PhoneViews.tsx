/**
 * The phone.
 *
 * Dragging is the obvious control for an ordering and the wrong one here: on a
 * small screen a drag fights the page scroll, a thumb covers what it is
 * carrying, and a list of five long labels does not fit above the fold at
 * 320 pixels. So the order is built by tapping. Tap what comes first, then
 * what comes next, and each tap moves an item from the pool below into the
 * numbered list above.
 *
 * Undo is tapping a placed item, which puts it back in the pool, and "Start
 * over" clears the lot. Both are free until the order is sent, because the
 * first answer stands and the server will not take a second: a mistake has to
 * be cheap to fix before that moment and impossible to make after it.
 *
 * The last item has only one place left to go, so it goes there without a
 * tap. That saves the one tap a player racing the timer is most likely to run
 * out of time for, and taking back any earlier item returns it to the pool.
 */

import { useState } from 'preact/hooks';
import type { PlayerViewProps } from '../../shell/gameViews.js';
import { AWAITING_REVEAL, AWAITING_ROUND } from '../../shell/waitingCopy.js';
import { labelsFor, letterFor, readDetail, readQuestion } from './payload.js';
import type { OrderItem } from './payload.js';
import { RightOrder } from './RightOrder.js';

function Nothing({ line }: { line: string }) {
  return (
    <section class="pio pio-phone">
      <p class="pio-nothing">{line}</p>
    </section>
  );
}

const UNREADABLE = AWAITING_ROUND;
const NO_LISTS = 'Nothing to put in order this round.';

export function PhoneQuestion({ view }: PlayerViewProps) {
  const question = readQuestion(view);
  if (!question) return <Nothing line={UNREADABLE} />;
  if (question.items.length === 0) return <Nothing line={NO_LISTS} />;

  return (
    <section class="pio pio-phone">
      <p class="pio-instructions">{question.instructions}</p>
      <ul class="pio-items pio-items-small">
        {question.items.map((item, index) => (
          <li key={item.key} class="pio-item">
            <span class="pio-letter">{letterFor(index)}</span>
            <span class="pio-label">{item.label}</span>
          </li>
        ))}
      </ul>
      <p class="pio-hint">Ordering opens in a moment.</p>
    </section>
  );
}

export function PhoneAnswering({ snapshot, view, send }: PlayerViewProps) {
  const question = readQuestion(view);
  /** Taps are remembered with their round, so the next list starts clean by itself. */
  const [taps, setTaps] = useState<{ round: number; keys: string[] }>({ round: -1, keys: [] });
  const [sent, setSent] = useState<{ round: number; order: string[] } | null>(null);

  if (!question) return <Nothing line={UNREADABLE} />;
  if (question.items.length === 0) return <Nothing line={NO_LISTS} />;

  const round = snapshot.round;
  const items = question.items;
  const known = new Set(items.map((item) => item.key));
  const tapped = taps.round === round ? taps.keys.filter((key) => known.has(key)) : [];
  const pool = items.filter((item) => !tapped.includes(item.key));
  const implied: OrderItem | null = pool.length === 1 ? (pool[0] ?? null) : null;
  const order = implied === null ? tapped : [...tapped, implied.key];
  const complete = order.length === items.length;

  const mine = sent?.round === round ? sent : null;
  const done = snapshot.youAnswered || mine !== null;

  const labelOf = (key: string): string => items.find((item) => item.key === key)?.label ?? key;
  const letterOf = (key: string): string =>
    letterFor(items.findIndex((item) => item.key === key));

  if (done) {
    return (
      <section class="pio pio-phone">
        <p class="pio-sent" role="status">
          {mine ? 'Order sent' : 'Answer sent.'}
        </p>
        {mine && (
          <ol class="pio-slots" aria-label="Your order">
            {mine.order.map((key, index) => (
              <li key={key} class="pio-slot">
                <span class="pio-number">{index + 1}</span>
                <span class="pio-slot-label">{labelOf(key)}</span>
              </li>
            ))}
          </ol>
        )}
        <p class="pio-hint">Waiting for the rest of the room.</p>
      </section>
    );
  }

  const place = (key: string): void => setTaps({ round, keys: [...tapped, key] });
  const takeBack = (key: string): void =>
    setTaps({ round, keys: tapped.filter((placed) => placed !== key) });
  const startOver = (): void => setTaps({ round, keys: [] });
  const submit = (): void => {
    if (!complete) return;
    setSent({ round, order });
    send({ kind: 'answer', round, value: { type: 'order', order } });
  };

  return (
    <section class="pio pio-phone">
      <p class="pio-instructions">{question.instructions}</p>

      <ol class="pio-slots" aria-label="Your order">
        {items.map((_, index) => {
          const key = order[index];
          if (key === undefined) {
            return (
              <li key={`empty-${index}`} class="pio-slot" data-empty="true">
                <span class="pio-number">{index + 1}</span>
                <span class="pio-slot-empty" />
              </li>
            );
          }
          return (
            <li key={key} class="pio-slot">
              <span class="pio-number">{index + 1}</span>
              {implied !== null && key === implied.key ? (
                <span class="pio-slot-label" data-implied="true">
                  {labelOf(key)}
                </span>
              ) : (
                <button type="button" class="pio-placed" onClick={() => takeBack(key)}>
                  <span class="pio-letter">{letterOf(key)}</span>
                  <span class="pio-slot-label">{labelOf(key)}</span>
                </button>
              )}
            </li>
          );
        })}
      </ol>

      {implied === null && (
        <>
          <p class="pio-prompt">{tapped.length === 0 ? 'Tap what comes first' : 'Tap what comes next'}</p>
          <ul class="pio-taps">
            {pool.map((item) => (
              <li key={item.key}>
                <button type="button" class="pio-tap" onClick={() => place(item.key)}>
                  <span class="pio-letter">{letterOf(item.key)}</span>
                  <span class="pio-label">{item.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <div class="pio-actions">
        <button type="button" class="pio-send" disabled={!complete} onClick={submit}>
          Send this order
        </button>
        <button type="button" class="pio-clear" disabled={tapped.length === 0} onClick={startOver}>
          Start over
        </button>
      </div>
      {tapped.length > 0 && <p class="pio-hint">Tap a placed item to take it back.</p>}
    </section>
  );
}

export function PhoneReveal({ reveal, yourResult }: PlayerViewProps) {
  const detail = readDetail(reveal?.detail);
  if (!reveal || !detail) return <Nothing line={AWAITING_REVEAL} />;

  const submitted = yourResult?.submitted ?? null;
  const yours =
    submitted !== null && submitted.type === 'order' && Array.isArray(submitted.order)
      ? labelsFor(submitted.order, detail.items)
      : null;

  return (
    <section class="pio pio-phone">
      <p class="pio-answer-label">The right order</p>
      {detail.title.length > 0 && <h2 class="pio-title pio-title-small">{detail.title}</h2>}
      <RightOrder items={detail.items} />

      {yourResult === null ? (
        <p class="pio-yours">No answer from this phone.</p>
      ) : (
        <p class="pio-yours" data-correct={yourResult.correct ? 'true' : 'false'} role="status">
          {yourResult.correct ? 'All in order.' : (yourResult.note ?? 'Not this time.')}
        </p>
      )}

      {yourResult !== null && !yourResult.correct && yours !== null && (
        <div class="pio-your-order">
          <p class="pio-muted">Your order</p>
          <ol class="pio-your-list">
            {yours.map((label, index) => (
              <li key={`${index}:${label}`}>{label}</li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
