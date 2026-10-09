/**
 * Reading what the server sent, rather than trusting it.
 *
 * A payload arrives as `unknown`, and it genuinely can be: a phone on
 * yesterday's bundle, a room whose game changed while a screen was asleep, a
 * round the server had nothing to build from. Each is read into a shape or
 * into null, and a null draws a line of plain text instead of throwing in
 * front of a group.
 *
 * The shapes are declared here as well as on the server on purpose. What
 * passes between the two is the wire, not a type.
 */

export const GAME_ID = 'put-in-order';

/** Said aloud on the big screen when a list has no instruction of its own. */
export const DEFAULT_INSTRUCTIONS = 'Put these in order.';

export interface OrderItem {
  key: string;
  label: string;
}

export interface OrderQuestion {
  title: string;
  instructions: string;
  /** In the order they are shown. Empty when the server had no list to put up. */
  items: OrderItem[];
}

export interface RevealedItem {
  key: string;
  label: string;
  reference: string | null;
  note: string | null;
}

export interface OrderReveal {
  title: string;
  instructions: string;
  /** In the right order. */
  items: RevealedItem[];
  pairs: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringAt(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' ? value : null;
}

/**
 * An item without a key cannot be answered with, and a key seen twice would
 * let one tap place two items, so both are dropped rather than drawn.
 */
function itemsAt(source: Record<string, unknown>): OrderItem[] {
  const items: OrderItem[] = [];
  const seen = new Set<string>();
  for (const entry of Array.isArray(source['items']) ? source['items'] : []) {
    if (!isRecord(entry)) continue;
    const key = stringAt(entry, 'key');
    const label = stringAt(entry, 'label');
    if (key === null || key.length === 0 || label === null || seen.has(key)) continue;
    seen.add(key);
    items.push({ key, label });
  }
  return items;
}

export function readQuestion(view: unknown): OrderQuestion | null {
  if (!isRecord(view) || !Array.isArray(view['items'])) return null;
  const instructions = stringAt(view, 'instructions') ?? '';
  return {
    title: stringAt(view, 'title') ?? '',
    instructions: instructions.length > 0 ? instructions : DEFAULT_INSTRUCTIONS,
    items: itemsAt(view),
  };
}

export function readDetail(detail: unknown): OrderReveal | null {
  if (!isRecord(detail)) return null;

  const items: RevealedItem[] = [];
  for (const entry of Array.isArray(detail['items']) ? detail['items'] : []) {
    if (!isRecord(entry)) continue;
    const label = stringAt(entry, 'label');
    if (label === null) continue;
    const reference = stringAt(entry, 'reference');
    const note = stringAt(entry, 'note');
    items.push({
      key: stringAt(entry, 'key') ?? '',
      label,
      reference: reference !== null && reference.length > 0 ? reference : null,
      note: note !== null && note.length > 0 ? note : null,
    });
  }
  if (items.length === 0) return null;

  const pairs = detail['pairs'];
  return {
    title: stringAt(detail, 'title') ?? '',
    instructions: stringAt(detail, 'instructions') ?? '',
    items,
    pairs: typeof pairs === 'number' && Number.isFinite(pairs) ? pairs : 0,
  };
}

/** How items are lettered on both screens, so a room can say "B before D". */
export const ITEM_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;

export function letterFor(index: number): string {
  return ITEM_LETTERS[index] ?? String(index + 1);
}

/**
 * What a player sent, as labels, for their own phone at the reveal. A key the
 * reveal does not know is shown as itself rather than dropped, so the list
 * still has as many lines as the player tapped.
 */
export function labelsFor(order: readonly unknown[], items: readonly RevealedItem[]): string[] {
  return order.map((key) => items.find((item) => item.key === key)?.label ?? String(key));
}
