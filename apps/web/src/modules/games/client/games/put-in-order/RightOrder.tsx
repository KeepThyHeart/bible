/**
 * The right order, as both reveals draw it.
 *
 * Each line carries its reference because the reveal is the part of the round
 * a group talks over, and "where does it say that" is the question it asks.
 * An item with no single home, such as a book of the Bible, simply has no
 * reference rather than a made-up one.
 */

import type { RevealedItem } from './payload.js';

export function RightOrder({ items }: { items: readonly RevealedItem[] }) {
  return (
    <ol class="pio-answer" aria-label="The right order">
      {items.map((item, index) => (
        <li key={`${index}:${item.label}`} class="pio-answer-row">
          <span class="pio-number">{index + 1}</span>
          <span class="pio-answer-body">
            <span class="pio-label">{item.label}</span>
            {item.reference !== null && <span class="pio-ref">{item.reference}</span>}
            {item.note !== null && <span class="pio-note">{item.note}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}
