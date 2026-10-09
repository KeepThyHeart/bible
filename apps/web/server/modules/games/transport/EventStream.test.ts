import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventStream, refuseStream } from './EventStream.js';
import type { JsonResponse, StreamResponse } from './EventStream.js';
import type { ServerEvent } from '../../../../src/modules/games/shared/protocol.js';

interface RecordingResponse extends StreamResponse, JsonResponse {
  headers: Map<string, string>;
  chunks: string[];
  ended: boolean;
  flushed: boolean;
  statusCode: number | null;
  jsonBody: unknown;
}

function recordingResponse(): RecordingResponse {
  const response: RecordingResponse = {
    headers: new Map(),
    chunks: [],
    ended: false,
    flushed: false,
    statusCode: null,
    jsonBody: undefined,
    setHeader(name: string, value: string) {
      response.headers.set(name, value);
    },
    write(chunk: string) {
      response.chunks.push(chunk);
      return true;
    },
    end() {
      response.ended = true;
    },
    flushHeaders() {
      response.flushed = true;
    },
    status(code: number) {
      response.statusCode = code;
      return response;
    },
    json(body: unknown) {
      response.jsonBody = body;
    },
  };
  return response;
}

function eventsFrom(response: RecordingResponse): ServerEvent[] {
  return response.chunks
    .filter((chunk) => chunk.startsWith('data: '))
    .map((chunk) => JSON.parse(chunk.slice('data: '.length)) as ServerEvent);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('opening a stream', () => {
  it('sends the headers that keep an intermediary from swallowing it', () => {
    const response = recordingResponse();
    new EventStream(response, { kind: 'screen', owner: true }, { heartbeatMs: 0 });

    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response.headers.get('Cache-Control')).toContain('no-transform');
    // Without this nginx buffers the stream, and the symptom is silence rather
    // than an error.
    expect(response.headers.get('X-Accel-Buffering')).toBe('no');
    expect(response.flushed).toBe(true);
  });

  it('states the reconnect delay rather than leaving it to the browser', () => {
    const response = recordingResponse();
    new EventStream(response, { kind: 'screen', owner: true }, { heartbeatMs: 0 });
    expect(response.chunks[0]).toMatch(/^retry: \d+\n\n$/);
  });
});

describe('sending events', () => {
  it('frames one event per message, on the default channel', () => {
    const response = recordingResponse();
    const stream = new EventStream(response, { kind: 'player', playerId: 'p1' }, { heartbeatMs: 0 });

    stream.send({ type: 'kicked', reason: 'no longer in this room' });
    stream.send({ type: 'roomClosed', reason: 'the host ended the game' });

    // A named SSE event per variant would mean a client silently dropping any
    // variant it forgot to register a listener for.
    expect(response.chunks.every((chunk) => !chunk.startsWith('event:'))).toBe(true);
    expect(eventsFrom(response)).toEqual([
      { type: 'kicked', reason: 'no longer in this room' },
      { type: 'roomClosed', reason: 'the host ended the game' },
    ]);
  });

  it('writes a comment nobody handles', () => {
    const response = recordingResponse();
    const stream = new EventStream(response, { kind: 'screen', owner: true }, { heartbeatMs: 0 });
    stream.comment('still here');
    expect(response.chunks).toContain(': still here\n\n');
    expect(eventsFrom(response)).toHaveLength(0);
  });

  it('keeps an idle stream alive on a heartbeat', () => {
    vi.useFakeTimers();
    const response = recordingResponse();
    const stream = new EventStream(
      response,
      { kind: 'screen', owner: true },
      { heartbeatMs: 1_000, now: () => 12_345 }
    );

    vi.advanceTimersByTime(3_000);

    expect(eventsFrom(response)).toEqual([
      { type: 'heartbeat', serverTime: 12_345 },
      { type: 'heartbeat', serverTime: 12_345 },
      { type: 'heartbeat', serverTime: 12_345 },
    ]);
    stream.close();
  });
});

describe('closing a stream', () => {
  it('ends the response and reports itself closed exactly once', () => {
    const response = recordingResponse();
    const closes: number[] = [];
    const stream = new EventStream(
      response,
      { kind: 'screen', owner: true },
      { heartbeatMs: 0, onClose: () => closes.push(1) }
    );

    expect(stream.closed).toBe(false);
    stream.close();
    stream.close();

    expect(stream.closed).toBe(true);
    expect(response.ended).toBe(true);
    expect(closes).toHaveLength(1);
  });

  it('writes nothing more once closed, heartbeat included', () => {
    vi.useFakeTimers();
    const response = recordingResponse();
    const stream = new EventStream(response, { kind: 'screen', owner: true }, { heartbeatMs: 1_000 });

    stream.close();
    const after = response.chunks.length;
    stream.send({ type: 'kicked', reason: 'too late' });
    stream.comment('too late');
    vi.advanceTimersByTime(10_000);

    expect(response.chunks).toHaveLength(after);
  });
});

describe('refusing a stream', () => {
  /**
   * An `EventSource` retries a failed connection forever with no way for page
   * code to tell "not yet" from "never", so a stream opened for a room that
   * does not exist becomes a phone reconnecting until its battery runs out.
   */
  it('answers with an ordinary error and no stream headers', () => {
    const response = recordingResponse();
    refuseStream(response, 404, 'roomNotFound', 'no room is using that code');

    expect(response.statusCode).toBe(404);
    expect(response.jsonBody).toEqual({
      error: 'roomNotFound',
      message: 'no room is using that code',
    });
    expect(response.headers.size).toBe(0);
    expect(response.chunks).toHaveLength(0);
  });
});
