/**
 * A strict JSON parser for the untrusted parts of a backup (the container header
 * and the manifest).
 *
 * `JSON.parse` silently keeps the last of two duplicate keys, accepts a wide range
 * of whitespace-adjacent oddities in some engines and has no depth limit, so two
 * readers can disagree about the same bytes. This parser accepts exactly RFC 8259:
 * a single top-level value, no duplicate object keys at any depth, no trailing
 * content, no BOM, a bounded nesting depth.
 */
export class StrictJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StrictJsonError';
    Object.setPrototypeOf(this, StrictJsonError.prototype);
  }
}

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

export function parseStrictJson(text: string, maxDepth = 16): unknown {
  if (text.charCodeAt(0) === 0xfeff) throw new StrictJsonError('Unexpected byte order mark');
  let i = 0;

  const fail = (msg: string): never => {
    throw new StrictJsonError(`${msg} at position ${i}`);
  };
  const ws = (): void => {
    while (i < text.length) {
      const c = text.charCodeAt(i);
      if (c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09) i++;
      else break;
    }
  };

  const string = (): string => {
    const start = i;
    i++; // opening quote
    while (i < text.length) {
      const c = text.charCodeAt(i);
      if (c === 0x22) {
        i++;
        try {
          return JSON.parse(text.slice(start, i)) as string;
        } catch {
          return fail('Invalid string');
        }
      }
      if (c < 0x20) return fail('Control character in string');
      if (c === 0x5c) i += 2;
      else i++;
    }
    return fail('Unterminated string');
  };

  const value = (depth: number): unknown => {
    if (depth > maxDepth) return fail('Nesting too deep');
    ws();
    const c = text[i];
    if (c === '{') {
      i++;
      const obj: Record<string, unknown> = Object.create(null);
      ws();
      if (text[i] === '}') {
        i++;
        return obj;
      }
      for (;;) {
        ws();
        if (text[i] !== '"') return fail('Expected a string key');
        const key = string();
        if (Object.prototype.hasOwnProperty.call(obj, key)) return fail(`Duplicate key ${JSON.stringify(key)}`);
        ws();
        if (text[i] !== ':') return fail('Expected ":"');
        i++;
        obj[key] = value(depth + 1);
        ws();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i] === '}') {
          i++;
          return obj;
        }
        return fail('Expected "," or "}"');
      }
    }
    if (c === '[') {
      i++;
      const arr: unknown[] = [];
      ws();
      if (text[i] === ']') {
        i++;
        return arr;
      }
      for (;;) {
        arr.push(value(depth + 1));
        ws();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i] === ']') {
          i++;
          return arr;
        }
        return fail('Expected "," or "]"');
      }
    }
    if (c === '"') return string();
    if (text.startsWith('true', i)) {
      i += 4;
      return true;
    }
    if (text.startsWith('false', i)) {
      i += 5;
      return false;
    }
    if (text.startsWith('null', i)) {
      i += 4;
      return null;
    }
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(text);
    if (m) {
      i += m[0].length;
      return Number(m[0]);
    }
    return fail('Unexpected character');
  };

  const result = value(0);
  ws();
  if (i !== text.length) fail('Unexpected content after the value');
  return result;
}
