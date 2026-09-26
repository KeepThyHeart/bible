/**
 * Small helpers for moving bytes between `AsyncIterable<Uint8Array>` (what the
 * backup code speaks; Node streams satisfy it directly) and Web `ReadableStream`
 * (what browsers speak). No Node imports.
 */

/** Anything the backup code can read bytes from. */
export type ByteSource = AsyncIterable<Uint8Array> | Iterable<Uint8Array>;

/** Read a Web `ReadableStream` as an async iterable (works where `Symbol.asyncIterator` is missing). */
export async function* iterateReadable(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/** Wrap an async iterable as a Web `ReadableStream` (pull-based, so it applies back-pressure). */
export function toReadableStream(source: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array> {
  const it = source[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const r = await it.next();
      if (r.done) controller.close();
      else controller.enqueue(r.value);
    },
    async cancel() {
      await it.return?.();
    },
  });
}

/** Yield one buffer. */
export async function* once(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield bytes;
}

/** Yield `bytes` in pieces of at most `size` bytes (a zero-length input yields nothing). */
export async function* chunked(bytes: Uint8Array, size: number): AsyncGenerator<Uint8Array> {
  for (let o = 0; o < bytes.length; o += size) yield bytes.subarray(o, Math.min(bytes.length, o + size));
}

/** Concatenate a whole source into one buffer, refusing to exceed `maxBytes`. */
export async function collect(source: ByteSource, maxBytes = Number.POSITIVE_INFINITY): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  let total = 0;
  for await (const part of source as AsyncIterable<Uint8Array>) {
    total += part.length;
    if (total > maxBytes) throw new RangeError('Stream larger than the allowed maximum');
    parts.push(part);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
