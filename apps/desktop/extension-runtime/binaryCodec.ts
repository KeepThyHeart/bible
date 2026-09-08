/**
 * Envelope codec for the realm boundary.
 *
 * Every RPC envelope crossing between the supervisor and the QuickJS realm is
 * a string: the guest's only outbound call is `__host_send(json)` and the
 * host's only inbound call is `__guest_receive(json)`. There is no structured
 * clone across that edge and there cannot be - the realm's values live in a
 * separate WASM heap with its own object graph.
 *
 * Plain `JSON.stringify` is not sufficient, and it fails *silently*, which is
 * the dangerous part:
 *
 *     JSON.stringify(new Uint8Array([1, 2, 3]))  // '{"0":1,"1":2,"2":3}'
 *     JSON.stringify(new ArrayBuffer(3))         // '{}'
 *
 * So `storage.readFile()` would resolve with a plain object that merely looks
 * array-ish, and `storage.writeFile(path, bytes)` would send one, which the
 * host's `requireBinaryData` then rejects. Before the realm existed these
 * payloads travelled over `parentPort`, whose structured clone preserved them;
 * the engine swap is what put a JSON hop in the middle.
 *
 * This module restores byte-exactness by tagging binary values on the way out
 * and rebuilding them on the way in - the "explicit copy across the VM
 * boundary" the sandbox plan calls for. It is deliberately placed at the
 * transport, not in the DTOs: `IStorageApi.readFile` is documented to resolve
 * with a real `ArrayBuffer`, and every `api-impl` on the host already deals in
 * real `Uint8Array`s. Both sides keep their contract and neither learns that a
 * VM boundary sits between them.
 *
 * Shared verbatim by both sides - the host imports it, and esbuild bundles it
 * into the guest. It therefore uses no Node built-ins and no web APIs beyond
 * what QuickJS provides (`Buffer`, when present, is only a fast path).
 *
 * -- Wire format -------------------------------------------------------------
 *   binary        ->  { "$bin$": { "t": "<tag>", "d": "<base64>" } }
 *   escape hatch  ->  { "$esc$": <the original object, fields transformed> }
 *
 * The escape hatch is what makes the encoding total rather than merely
 * probable. An extension is free to send `{ "$bin$": ... }` as ordinary data,
 * and without escaping the host would decode that into a `Uint8Array` - a type
 * confusion introduced by the transport itself. Objects that own a marker key
 * are wrapped so they round-trip as what they are.
 */

/** Wrapper key for an encoded binary value. */
const BIN_KEY = '$bin$';

/** Wrapper key for an object that had to be escaped because it owns a marker. */
const ESC_KEY = '$esc$';

/**
 * Recursion ceiling, applied in both directions.
 *
 * Inbound it is a guard: envelopes arriving from the guest are
 * attacker-controlled, and `JSON.parse` will happily produce a structure deep
 * enough to blow the host's stack during the walk. Outbound it doubles as
 * cycle detection, since a cycle is just unbounded depth. No DTO in the API
 * nests anywhere near this far - the deepest are arrays of flat records.
 */
const MAX_DEPTH = 64;

/**
 * Binary types the codec preserves exactly.
 *
 * `ArrayBuffer` and `Uint8Array` are the only two in the public API surface
 * (`readFile`, `writeFile`, `pickFile`, `saveFile`, `network.fetch` bodies,
 * DB BLOBs). The remaining views are here so that a value the contract does
 * not mention still round-trips as itself instead of being quietly flattened
 * to bytes or, worse, to `{}`.
 *
 * `Buffer` needs no entry: it is a `Uint8Array` subclass, so it encodes as
 * `u8` and arrives in the realm as a plain `Uint8Array` - which is correct,
 * because the realm has no `Buffer`.
 */
type ViewCtor = new (buffer: ArrayBuffer) => ArrayBufferView;

const VIEW_TAGS: readonly [string, ViewCtor | undefined][] = [
  ['u8', typeof Uint8Array !== 'undefined' ? Uint8Array : undefined],
  ['u8c', typeof Uint8ClampedArray !== 'undefined' ? Uint8ClampedArray : undefined],
  ['i8', typeof Int8Array !== 'undefined' ? Int8Array : undefined],
  ['u16', typeof Uint16Array !== 'undefined' ? Uint16Array : undefined],
  ['i16', typeof Int16Array !== 'undefined' ? Int16Array : undefined],
  ['u32', typeof Uint32Array !== 'undefined' ? Uint32Array : undefined],
  ['i32', typeof Int32Array !== 'undefined' ? Int32Array : undefined],
  ['f32', typeof Float32Array !== 'undefined' ? Float32Array : undefined],
  ['f64', typeof Float64Array !== 'undefined' ? Float64Array : undefined],
  ['dv', typeof DataView !== 'undefined' ? DataView : undefined],
];

/** Tag for the concrete view type, or `undefined` if we do not model it. */
function tagForView(view: ArrayBufferView): string | undefined {
  for (const [tag, ctor] of VIEW_TAGS) {
    if (ctor !== undefined && view.constructor === ctor) return tag;
  }
  // Subclasses (Node's `Buffer` is the one that matters) and anything exotic
  // fall back to raw bytes, which is lossless for the data if not the type.
  if (typeof Uint8Array !== 'undefined' && view instanceof Uint8Array) return 'u8';
  return undefined;
}

function ctorForTag(tag: string): ViewCtor | undefined {
  for (const [candidate, ctor] of VIEW_TAGS) {
    if (candidate === tag) return ctor;
  }
  return undefined;
}

/** Thrown when a value cannot be represented on the wire. Reported, never fatal. */
export class EnvelopeCodecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvelopeCodecError';
  }
}

// --- base64 -----------------------------------------------------------------

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Reverse lookup, built once. 255 marks "not a base64 character". */
const B64_LOOKUP = /* @__PURE__ */ ((): Uint8Array => {
  const table = new Uint8Array(256).fill(255);
  for (let i = 0; i < B64_ALPHABET.length; i++) {
    table[B64_ALPHABET.charCodeAt(i)] = i;
  }
  return table;
})();

/**
 * How much base64 to accumulate in one string before parking it in an array
 * and starting a fresh one. Repeated `+=` on a multi-megabyte string is where
 * a naive encoder spends all its time; joining fixed-size pieces at the end is
 * not.
 */
const CHUNK_CHARS = 4096;

/**
 * `Buffer` when running on the host, `undefined` inside the realm.
 *
 * Guarded with `typeof` rather than imported: this module is bundled into the
 * guest with esbuild's `neutral` platform, where importing a Node built-in is
 * a build error by design. The pure-JS path below is the one that actually
 * runs in the realm; this is a several-times-faster shortcut for the host,
 * which is the side that handles whole files.
 */
const hostBuffer: typeof Buffer | undefined =
  typeof Buffer !== 'undefined' ? Buffer : undefined;

/**
 * The implementation that runs inside the realm.
 *
 * Exported separately from `bytesToBase64` so tests can reach it: `Buffer`
 * exists under Vitest, so the wrapper below would always take the host path
 * and the code that actually ships to the guest would never be exercised.
 */
export function bytesToBase64Js(bytes: Uint8Array): string {
  const out: string[] = [];
  const tail = bytes.length % 3;
  const end = bytes.length - tail;
  let chars = '';
  for (let i = 0; i < end; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    chars +=
      B64_ALPHABET[(n >>> 18) & 63]! +
      B64_ALPHABET[(n >>> 12) & 63]! +
      B64_ALPHABET[(n >>> 6) & 63]! +
      B64_ALPHABET[n & 63]!;
    if (chars.length >= CHUNK_CHARS) {
      out.push(chars);
      chars = '';
    }
  }
  if (tail === 1) {
    const n = bytes[end]!;
    chars += B64_ALPHABET[n >>> 2]! + B64_ALPHABET[(n << 4) & 63]! + '==';
  } else if (tail === 2) {
    const n = (bytes[end]! << 8) | bytes[end + 1]!;
    chars +=
      B64_ALPHABET[n >>> 10]! +
      B64_ALPHABET[(n >>> 4) & 63]! +
      B64_ALPHABET[(n << 2) & 63]! +
      '=';
  }
  out.push(chars);
  return out.join('');
}

/** The decoder that runs inside the realm. See `bytesToBase64Js`. */
export function base64ToBytesJs(b64: string): Uint8Array {
  // Sized from the input rather than trusting padding, then trimmed. Input is
  // attacker-controlled on the inbound path, so non-alphabet characters are
  // skipped instead of producing garbage bytes.
  const scratch = new Uint8Array(((b64.length + 3) >> 2) * 3);
  let written = 0;
  let acc = 0;
  let accBits = 0;
  for (let i = 0; i < b64.length; i++) {
    const sextet = B64_LOOKUP[b64.charCodeAt(i)]!;
    if (sextet === 255) continue; // padding, whitespace, or junk
    acc = (acc << 6) | sextet;
    accBits += 6;
    if (accBits >= 8) {
      accBits -= 8;
      scratch[written++] = (acc >>> accBits) & 0xff;
    }
  }
  return scratch.subarray(0, written);
}

export function bytesToBase64(bytes: Uint8Array): string {
  return hostBuffer
    ? hostBuffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')
    : bytesToBase64Js(bytes);
}

export function base64ToBytes(b64: string): Uint8Array {
  if (!hostBuffer) return base64ToBytesJs(b64);
  const buf = hostBuffer.from(b64, 'base64');
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

// --- encode -----------------------------------------------------------------

function encodeBinary(value: ArrayBuffer | ArrayBufferView): Record<string, unknown> {
  if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) {
    return { [BIN_KEY]: { t: 'ab', d: bytesToBase64(new Uint8Array(value)) } };
  }
  const view = value as ArrayBufferView;
  const tag = tagForView(view);
  if (tag === undefined) {
    throw new EnvelopeCodecError(
      `cannot marshal ${view.constructor?.name ?? 'value'} across the extension realm boundary`,
    );
  }
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  return { [BIN_KEY]: { t: tag, d: bytesToBase64(bytes) } };
}

/** True for a record that would be mistaken for a codec wrapper if left alone. */
function needsEscape(obj: object): boolean {
  return (
    Object.prototype.hasOwnProperty.call(obj, BIN_KEY) ||
    Object.prototype.hasOwnProperty.call(obj, ESC_KEY)
  );
}

function toWire(value: unknown, depth: number): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (depth > MAX_DEPTH) {
    throw new EnvelopeCodecError(
      `extension RPC payload nested deeper than ${MAX_DEPTH} levels (or contains a cycle)`,
    );
  }

  if (typeof ArrayBuffer !== 'undefined') {
    if (value instanceof ArrayBuffer) return encodeBinary(value);
    if (ArrayBuffer.isView(value)) return encodeBinary(value);
  }

  // Mirror `JSON.stringify`: `toJSON` wins over structural traversal, which is
  // what keeps `Date` serializing to an ISO string rather than to `{}`.
  const withToJson = value as { toJSON?: (key?: string) => unknown };
  if (typeof withToJson.toJSON === 'function') {
    return toWire(withToJson.toJSON(), depth + 1);
  }

  if (Array.isArray(value)) {
    const out: unknown[] = new Array(value.length);
    for (let i = 0; i < value.length; i++) out[i] = toWire(value[i], depth + 1);
    return out;
  }

  const source = value as Record<string, unknown>;
  const mapped: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    mapped[key] = toWire(source[key], depth + 1);
  }
  // Note the escape wraps the *already-mapped* record, so decoding unwraps
  // exactly one level and never re-tests the payload for wrapper-ness. That
  // symmetry is what lets `{ "$esc$": 1 }` survive a round trip.
  return needsEscape(source) ? { [ESC_KEY]: mapped } : mapped;
}

// --- decode -----------------------------------------------------------------

function decodeBinary(spec: unknown): ArrayBuffer | ArrayBufferView {
  const { t, d } = (spec ?? {}) as { t?: unknown; d?: unknown };
  if (typeof t !== 'string' || typeof d !== 'string') {
    throw new EnvelopeCodecError('malformed binary payload on the extension realm boundary');
  }
  const bytes = base64ToBytes(d);
  if (t === 'ab') {
    // `slice()` because `base64ToBytes` may return a view onto a larger
    // scratch buffer; the caller gets a buffer sized to its own contents.
    return bytes.slice().buffer;
  }
  const ctor = ctorForTag(t);
  if (!ctor) {
    throw new EnvelopeCodecError(`unknown binary tag '${t}' on the extension realm boundary`);
  }
  if (ctor === (Uint8Array as unknown as ViewCtor)) return bytes.slice();
  return new ctor(bytes.slice().buffer);
}

/** A codec wrapper is a record with exactly one own key, and it is a marker. */
function wrapperKey(obj: Record<string, unknown>): string | undefined {
  const keys = Object.keys(obj);
  if (keys.length !== 1) return undefined;
  const key = keys[0]!;
  return key === BIN_KEY || key === ESC_KEY ? key : undefined;
}

function fromWire(value: unknown, depth: number): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (depth > MAX_DEPTH) {
    throw new EnvelopeCodecError(
      `extension RPC payload nested deeper than ${MAX_DEPTH} levels`,
    );
  }

  if (Array.isArray(value)) {
    const out: unknown[] = new Array(value.length);
    for (let i = 0; i < value.length; i++) out[i] = fromWire(value[i], depth + 1);
    return out;
  }

  const source = value as Record<string, unknown>;
  const marker = wrapperKey(source);
  if (marker === BIN_KEY) return decodeBinary(source[BIN_KEY]);

  // For an escaped record, decode the *fields* and hand back the record
  // itself - see the note in `toWire`.
  const payload = marker === ESC_KEY ? (source[ESC_KEY] as Record<string, unknown>) : source;
  if (payload === null || typeof payload !== 'object') return payload;

  const out: Record<string, unknown> = {};
  for (const key of Object.keys(payload)) {
    out[key] = fromWire(payload[key], depth + 1);
  }
  return out;
}

// --- public API -------------------------------------------------------------

/**
 * Serialize one envelope for the realm boundary. Throws `EnvelopeCodecError`
 * for values that cannot be represented; callers turn that into an RPC error
 * rather than letting it escape, so a bad payload costs one call and not the
 * extension.
 */
export function encodeEnvelope(envelope: unknown): string {
  const json = JSON.stringify(toWire(envelope, 0));
  if (json === undefined) {
    throw new EnvelopeCodecError('extension RPC envelope is not serializable');
  }
  return json;
}

/** Parse one envelope received across the realm boundary. */
export function decodeEnvelope(json: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new EnvelopeCodecError(
      `malformed JSON on the extension realm boundary: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return fromWire(parsed, 0);
}
