/**
 * Key decoding.
 *
 * Terminals deliver keys as byte sequences with no framing, so a decoder has
 * three jobs: recognise the sequences, know when it is holding an *incomplete*
 * one, and resolve the one genuinely ambiguous case.
 *
 * That case is a lone `ESC`. It is both a key the user can press and the first
 * byte of every arrow, function and modified key. Nothing in the byte stream
 * distinguishes them — only time does. So `decodeKeys` never guesses: an
 * unterminated escape sequence comes back as `pending`, and the reader decides,
 * after a short quiet period, to call {@link flushPending} and treat it as a
 * real `escape` (see `raw.ts`).
 *
 * Terminals also disagree about which sequence a key produces — `alt+1` in
 * particular is intercepted outright by some. `bible --keys` prints what the
 * current terminal actually sends.
 */

export type KeyName =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'pageup'
  | 'pagedown'
  | 'home'
  | 'end'
  | 'insert'
  | 'delete'
  | 'enter'
  | 'tab'
  | 'backtab'
  | 'backspace'
  | 'escape'
  | 'space'
  | `f${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12}`
  | 'char'
  | 'unknown';

export interface Key {
  readonly name: KeyName;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  /** The raw bytes this key was decoded from. Shown by `--keys`. */
  readonly sequence: string;
  /** The character, when `name` is `'char'`. */
  readonly char?: string;
}

export interface DecodeResult {
  readonly keys: readonly Key[];
  /**
   * Trailing bytes that do not yet form a complete sequence. Feed them back in
   * front of the next chunk, or resolve them with {@link flushPending} once the
   * input has gone quiet.
   */
  readonly pending: string;
}

const ESC = '\x1b';

/** CSI final bytes for the cursor and edit keys. */
const CSI_LETTER: Readonly<Record<string, KeyName>> = {
  A: 'up',
  B: 'down',
  C: 'right',
  D: 'left',
  H: 'home',
  F: 'end',
  P: 'f1',
  Q: 'f2',
  R: 'f3',
  S: 'f4',
};

/** CSI `<n>~` forms. */
const CSI_TILDE: Readonly<Record<number, KeyName>> = {
  1: 'home',
  2: 'insert',
  3: 'delete',
  4: 'end',
  5: 'pageup',
  6: 'pagedown',
  7: 'home',
  8: 'end',
  11: 'f1',
  12: 'f2',
  13: 'f3',
  14: 'f4',
  15: 'f5',
  17: 'f6',
  18: 'f7',
  19: 'f8',
  20: 'f9',
  21: 'f10',
  23: 'f11',
  24: 'f12',
};

/** SS3 (`ESC O x`) — how most terminals send F1–F4 and the application-mode arrows. */
const SS3: Readonly<Record<string, KeyName>> = {
  P: 'f1',
  Q: 'f2',
  R: 'f3',
  S: 'f4',
  A: 'up',
  B: 'down',
  C: 'right',
  D: 'left',
  H: 'home',
  F: 'end',
};

interface Modifiers {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

const NO_MODIFIERS: Modifiers = { ctrl: false, alt: false, shift: false };

/**
 * xterm encodes modifiers as a parameter of `1 + bitmask`, where the bits are
 * shift=1, alt=2, ctrl=4. So `ESC [ 1;6A` is ctrl+shift+up.
 */
function decodeModifier(parameter: number | undefined): Modifiers {
  if (parameter === undefined || parameter < 2) return { ...NO_MODIFIERS };
  const bits = parameter - 1;
  return {
    shift: (bits & 1) !== 0,
    alt: (bits & 2) !== 0,
    ctrl: (bits & 4) !== 0,
  };
}

function key(
  name: KeyName,
  sequence: string,
  modifiers: Modifiers = NO_MODIFIERS,
  char?: string,
): Key {
  return { name, sequence, ctrl: modifiers.ctrl, alt: modifiers.alt, shift: modifiers.shift, char };
}

export function decodeKeys(input: string): DecodeResult {
  const keys: Key[] = [];
  let i = 0;

  while (i < input.length) {
    const rest = input.slice(i);

    if (rest[0] === ESC) {
      const escape = decodeEscape(rest);
      if (escape === 'incomplete') {
        // Hold everything from here; it may complete on the next read.
        return { keys, pending: rest };
      }
      keys.push(escape.key);
      i += escape.length;
      continue;
    }

    const simple = decodeSimple(rest);
    keys.push(simple.key);
    i += simple.length;
  }

  return { keys, pending: '' };
}

/**
 * Resolve bytes that `decodeKeys` held back, once no more input has arrived.
 *
 * A lone `ESC` becomes the escape key. `ESC` followed by a printable character
 * is alt+that-character — which is how alt is transmitted on every terminal
 * that sends it at all.
 */
export function flushPending(pending: string): readonly Key[] {
  if (pending === '') return [];
  if (pending === ESC) return [key('escape', ESC)];

  if (pending.startsWith(ESC) && pending.length >= 2) {
    const second = pending[1]!;
    if (second !== '[' && second !== 'O') {
      const [first, ...remainder] = [...pending.slice(1)];
      const altKey = key('char', ESC + first, { ctrl: false, alt: true, shift: false }, first);
      return [altKey, ...decodeKeys(remainder.join('')).keys];
    }
  }

  // An escape sequence that never completed. Report it rather than dropping it
  // silently — `--keys` is how an unknown terminal's dialect gets discovered.
  return [key('unknown', pending)];
}

type EscapeResult = { key: Key; length: number } | 'incomplete';

function decodeEscape(rest: string): EscapeResult {
  if (rest.length === 1) return 'incomplete';

  const second = rest[1]!;

  if (second === '[') return decodeCsi(rest);
  if (second === 'O') return decodeSs3(rest);

  // ESC followed by anything else is alt+key. Two ESCs in a row is alt+escape.
  if (second === ESC) {
    return { key: key('escape', rest.slice(0, 2), { ctrl: false, alt: true, shift: false }), length: 2 };
  }

  const simple = decodeSimple(rest.slice(1));
  const withAlt: Key = { ...simple.key, alt: true, sequence: ESC + simple.key.sequence };
  return { key: withAlt, length: 1 + simple.length };
}

function decodeSs3(rest: string): EscapeResult {
  if (rest.length < 3) return 'incomplete';
  const final = rest[2]!;
  const name = SS3[final];
  if (!name) return { key: key('unknown', rest.slice(0, 3)), length: 3 };
  return { key: key(name, rest.slice(0, 3)), length: 3 };
}

function decodeCsi(rest: string): EscapeResult {
  // The Linux console spells F1–F5 as ESC [ [ A..E. This has to be checked
  // before the generic scan below, because `[` is itself in the CSI final-byte
  // range — a generic parse would stop at it and leave the letter behind as a
  // stray keypress.
  if (rest[2] === '[') {
    if (rest.length < 4) return 'incomplete';
    const index = 'ABCDE'.indexOf(rest[3]!);
    if (index >= 0) {
      return { key: key(`f${index + 1}` as KeyName, rest.slice(0, 4)), length: 4 };
    }
    return { key: key('unknown', rest.slice(0, 4)), length: 4 };
  }

  // CSI = ESC [ , then parameter/intermediate bytes, then a final byte.
  let end = 2;
  while (end < rest.length && !isCsiFinal(rest[end]!)) end += 1;
  if (end >= rest.length) return 'incomplete';

  const sequence = rest.slice(0, end + 1);
  const final = rest[end]!;
  const body = rest.slice(2, end);

  const params = body
    .split(';')
    .map((p) => (p === '' ? undefined : Number.parseInt(p, 10)));

  if (final === '~') {
    const name = CSI_TILDE[params[0] ?? -1];
    const modifiers = decodeModifier(params[1]);
    if (!name) return { key: key('unknown', sequence), length: sequence.length };
    return { key: key(name, sequence, modifiers), length: sequence.length };
  }

  if (final === 'Z') {
    // CSI Z is shift+tab on every terminal that sends it.
    return {
      key: key('backtab', sequence, { ctrl: false, alt: false, shift: true }),
      length: sequence.length,
    };
  }

  const name = CSI_LETTER[final];
  if (!name) return { key: key('unknown', sequence), length: sequence.length };

  // `ESC [ 1 ; 5 A` — the first parameter is a placeholder, the second the modifier.
  const modifiers = decodeModifier(params[1]);
  return { key: key(name, sequence, modifiers), length: sequence.length };
}

function isCsiFinal(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code >= 0x40 && code <= 0x7e;
}

function decodeSimple(rest: string): { key: Key; length: number } {
  const ch = rest[0]!;
  const code = ch.charCodeAt(0);

  if (ch === '\r' || ch === '\n') return { key: key('enter', ch), length: 1 };
  if (ch === '\t') return { key: key('tab', ch), length: 1 };
  // Space carries its character too: the input line treats it as printable,
  // while key bindings want to match on the name.
  if (ch === ' ') return { key: key('space', ch, NO_MODIFIERS, ' '), length: 1 };
  // 0x7f is what almost every terminal sends for backspace; 0x08 is ctrl+h,
  // which some send instead.
  if (code === 0x7f || code === 0x08) return { key: key('backspace', ch), length: 1 };

  if (code < 0x20) {
    // ctrl+letter arrives as the letter's position in the alphabet.
    const letter = String.fromCharCode(code + 0x60);
    return {
      key: key('char', ch, { ctrl: true, alt: false, shift: false }, letter),
      length: 1,
    };
  }

  // Take a whole code point, so astral characters and combining sequences are
  // not split in half.
  const [first] = [...rest];
  const char = first ?? ch;
  return { key: key('char', char, NO_MODIFIERS, char), length: char.length };
}

/** Human-readable name, for `--keys` and for key-binding help. */
export function describeKey(k: Key): string {
  const parts: string[] = [];
  if (k.ctrl) parts.push('ctrl');
  if (k.alt) parts.push('alt');
  if (k.shift) parts.push('shift');
  parts.push(k.name === 'char' ? (k.char ?? '?') : k.name);
  return parts.join('+');
}
