import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createServer, get as httpGet, type IncomingHttpHeaders } from 'http';
import type { AddressInfo } from 'net';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createPresentRoutes } from '../routes/presentRoutes';
import { PresentStore } from '../present/PresentStore';
import { PresentHub } from '../present/PresentHub';
import type { DatabaseManager } from '../DatabaseManager';
import type { CreateSessionResponse, PresentPassageItem } from '../../src/present/protocol';

const JOHN_3: PresentPassageItem = { kind: 'passage', module: 'KJV', book: 43, chapter: 3 };

/**
 * A stand-in for the module store.
 *
 * These tests are about the HTTP surface, not about Bible content, and the
 * repo-wide integration suites already need real module databases. Stubbing the
 * one method the presenter actually calls keeps this file runnable on a fresh
 * clone.
 */
const fakeDb = {
  getBibleRepo: () => ({
    getChapter: () => Array.from({ length: 36 }, (_, i) => ({ verse: i + 1 })),
  }),
} as unknown as DatabaseManager;

let dir: string;
let store: PresentStore;
let hub: PresentHub;
let app: express.Express;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'present-routes-'));
  store = new PresentStore(join(dir, 'present.db'));
  hub = new PresentHub();

  app = express();
  app.use(express.json());
  app.use('/api/present', createPresentRoutes({ db: fakeDb, appStateDir: dir, store, hub }));
});

afterEach(() => {
  hub.dispose();
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

async function newSession(): Promise<CreateSessionResponse> {
  const res = await request(app).post('/api/present/sessions').send({});
  expect(res.status).toBe(201);
  return res.body as CreateSessionResponse;
}

function control(sessionId: string, token: string) {
  return (intent: unknown) => request(app)
    .post(`/api/present/s/${sessionId}/intent`)
    .set('X-Present-Token', token)
    .send({ intent });
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

describe('POST /api/present/sessions', () => {
  it('mints a session and hands back both capabilities', async () => {
    const session = await newSession();
    expect(session.joinCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(session.sessionId).toHaveLength(16);
    expect(session.controlToken).toBeTruthy();
    expect(Date.parse(session.expiresAt)).toBeGreaterThan(Date.now());
  });

  it('returns the control token once and never again', async () => {
    const session = await newSession();
    const state = await request(app).get(`/api/present/j/${session.joinCode}/state`);
    expect(JSON.stringify(state.body)).not.toContain(session.controlToken);
  });
});

// ---------------------------------------------------------------------------
// Reading with a join code
// ---------------------------------------------------------------------------

describe('GET /api/present/j/:joinCode/state', () => {
  it('serves the current state to anyone holding the code', async () => {
    const session = await newSession();
    const res = await request(app).get(`/api/present/j/${session.joinCode}/state`);

    expect(res.status).toBe(200);
    expect(res.body.state.live).toBeNull();
    expect(res.body.state.version).toBe(0);
    expect(res.body.state.session.joinCode).toBe(session.joinCode);
  });

  it('accepts a code typed the way people type it', async () => {
    const session = await newSession();
    const messy = `${session.joinCode.slice(0, 4)}-${session.joinCode.slice(4)}`.toLowerCase();
    expect((await request(app).get(`/api/present/j/${messy}/state`)).status).toBe(200);
  });

  it('answers 404 for an unknown code', async () => {
    expect((await request(app).get('/api/present/j/ZZZZZZZZ/state')).status).toBe(404);
  });

  it('gives a malformed code the same answer as a wrong one', async () => {
    // Anything else turns the endpoint into an oracle for testing codes.
    const wrong = await request(app).get('/api/present/j/ZZZZZZZZ/state');
    const malformed = await request(app).get('/api/present/j/!!!!!!!!/state');
    expect(malformed.status).toBe(wrong.status);
    expect(malformed.body).toEqual(wrong.body);
  });

  it('shuts out an address that keeps guessing', async () => {
    for (let i = 0; i < 10; i++) {
      await request(app).get('/api/present/j/ZZZZZZZZ/state');
    }
    const res = await request(app).get('/api/present/j/ZZZZZZZZ/state');
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeTruthy();
  });

  it('does not count a correct code against the guess limit', async () => {
    const session = await newSession();
    for (let i = 0; i < 30; i++) {
      await request(app).get(`/api/present/j/${session.joinCode}/state`);
    }
    expect((await request(app).get(`/api/present/j/${session.joinCode}/state`)).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Control
// ---------------------------------------------------------------------------

describe('POST /api/present/s/:sessionId/intent', () => {
  it('puts a passage on the wall', async () => {
    const session = await newSession();
    const res = await control(session.sessionId, session.controlToken)({ type: 'show', item: JOHN_3 });

    expect(res.status).toBe(200);
    expect(res.body.state.live).toEqual(JOHN_3);
    expect(res.body.state.position.index).toBe(1);
    expect(res.body.state.version).toBe(1);
  });

  it('answers with the new state so the controller need not wait for its own broadcast', async () => {
    const session = await newSession();
    const send = control(session.sessionId, session.controlToken);
    await send({ type: 'show', item: JOHN_3, index: 16 });
    const res = await send({ type: 'next' });
    expect(res.body.state.position.index).toBe(17);
    expect(res.body.state.version).toBe(2);
  });

  it('stops at the end of the chapter without bumping the version', async () => {
    const session = await newSession();
    const send = control(session.sessionId, session.controlToken);
    await send({ type: 'show', item: JOHN_3, index: 36 });

    const res = await send({ type: 'next' });
    expect(res.status).toBe(200);
    expect(res.body.state.position.index).toBe(36);
    expect(res.body.state.version).toBe(1);
  });

  it('refuses a request with no token', async () => {
    const session = await newSession();
    const res = await request(app)
      .post(`/api/present/s/${session.sessionId}/intent`)
      .send({ intent: { type: 'blank' } });
    expect(res.status).toBe(404);
  });

  it('refuses a request with the wrong token', async () => {
    const session = await newSession();
    const other = await newSession();
    const res = await control(session.sessionId, other.controlToken)({ type: 'blank' });
    expect(res.status).toBe(404);
  });

  it('refuses the join code used as a control token', async () => {
    // The two capabilities travel by different routes and must not be
    // interchangeable.
    const session = await newSession();
    const res = await control(session.sessionId, session.joinCode)({ type: 'blank' });
    expect(res.status).toBe(404);
  });

  it('answers an unknown session exactly as it answers a bad token', async () => {
    const session = await newSession();
    const badToken = await control(session.sessionId, 'nonsense')({ type: 'blank' });
    const noSession = await control('ZZZZZZZZZZZZZZZZ', session.controlToken)({ type: 'blank' });
    expect(noSession.status).toBe(badToken.status);
    expect(noSession.body).toEqual(badToken.body);
  });

  it('rejects an intent it does not recognise', async () => {
    const session = await newSession();
    const res = await control(session.sessionId, session.controlToken)({ type: 'formatHardDrive' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PARAM');
  });

  it('rejects a passage whose module name could reach the filesystem', async () => {
    const session = await newSession();
    const res = await control(session.sessionId, session.controlToken)({
      type: 'show',
      item: { ...JOHN_3, module: '../../../etc/passwd' },
    });
    expect(res.status).toBe(400);
  });

  it('persists what is on the wall', async () => {
    const session = await newSession();
    await control(session.sessionId, session.controlToken)({ type: 'show', item: JOHN_3, index: 16 });

    const res = await request(app).get(`/api/present/j/${session.joinCode}/state`);
    expect(res.body.state.live).toEqual(JOHN_3);
    expect(res.body.state.position.index).toBe(16);
  });
});

describe('ending a session', () => {
  it('closes it to controller and viewers alike', async () => {
    const session = await newSession();
    const send = control(session.sessionId, session.controlToken);

    const ended = await send({ type: 'end' });
    expect(ended.status).toBe(200);
    expect(ended.body.ended).toBe(true);

    expect((await send({ type: 'blank' })).status).toBe(410);
    expect((await request(app).get(`/api/present/j/${session.joinCode}/state`)).status).toBe(410);
  });
});

// ---------------------------------------------------------------------------
// The running order
// ---------------------------------------------------------------------------

describe('the plan', () => {
  it('round-trips through the controller', async () => {
    const session = await newSession();
    const put = await request(app)
      .put(`/api/present/s/${session.sessionId}/plan`)
      .set('X-Present-Token', session.controlToken)
      .send({ plan: [{ item: JOHN_3, note: 'read slowly' }] });

    expect(put.status).toBe(200);
    expect(put.body.plan).toHaveLength(1);
    expect(put.body.plan[0].id).toBeTruthy();
    expect(put.body.plan[0].note).toBe('read slowly');

    const get = await request(app)
      .get(`/api/present/s/${session.sessionId}/plan`)
      .set('X-Present-Token', session.controlToken);
    expect(get.body.plan).toEqual(put.body.plan);
  });

  it('is not readable with only a join code', async () => {
    // Presenter notes are for the presenter; they never go on the wall and they
    // are not part of what a viewer receives.
    const session = await newSession();
    await request(app)
      .put(`/api/present/s/${session.sessionId}/plan`)
      .set('X-Present-Token', session.controlToken)
      .send({ plan: [{ item: JOHN_3, note: 'mention the building fund' }] });

    const viewer = await request(app).get(`/api/present/j/${session.joinCode}/state`);
    expect(JSON.stringify(viewer.body)).not.toContain('building fund');
  });

  it('rejects a whole plan when one entry is not a supported item', async () => {
    // All or nothing: a partially saved running order is worse than a refused
    // one, because the presenter cannot see which half survived.
    const session = await newSession();
    const res = await request(app)
      .put(`/api/present/s/${session.sessionId}/plan`)
      .set('X-Present-Token', session.controlToken)
      .send({ plan: [{ item: JOHN_3 }, { item: { kind: 'video', url: 'http://x' } }] });
    expect(res.status).toBe(400);
  });

  it('accepts a hymn in the running order', async () => {
    const session = await newSession();
    const res = await request(app)
      .put(`/api/present/s/${session.sessionId}/plan`)
      .set('X-Present-Token', session.controlToken)
      .send({ plan: [{ item: { kind: 'hymn', hymnId: 'amazing-grace' } }] });
    expect(res.status).toBe(200);
    expect(res.body.plan[0].item).toEqual({ kind: 'hymn', hymnId: 'amazing-grace' });
  });
});

// ---------------------------------------------------------------------------
// The stream
// ---------------------------------------------------------------------------

describe('GET /api/present/j/:joinCode/stream', () => {
  /**
   * Open the stream against a real listening server and read until it has
   * delivered a frame, then hang up.
   *
   * supertest buffers a whole response, which for a stream designed never to
   * end means waiting forever. Going through `http` directly is also the only
   * way to see the response headers as a browser would -- including whether
   * anything compressed the body.
   */
  async function openStream(path: string): Promise<{ headers: IncomingHttpHeaders; body: string }> {
    const server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    try {
      return await new Promise((resolve, reject) => {
        const req = httpGet({ port, path }, res => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            body += chunk;
            // One complete frame is all this needs; the stream itself has no end.
            if (body.includes('\n\n') && /event: (state|closed)/.test(body)) {
              resolve({ headers: res.headers, body });
              res.destroy();
              req.destroy();
            }
          });
          res.on('end', () => resolve({ headers: res.headers, body }));
        });
        req.on('error', reject);
      });
    } finally {
      server.closeAllConnections?.();
      server.close();
    }
  }

  it('opens as an event stream that nothing may buffer', async () => {
    const session = await newSession();
    const { headers } = await openStream(`/api/present/j/${session.joinCode}/stream`);

    expect(headers['content-type']).toContain('text/event-stream');
    expect(headers['cache-control']).toContain('no-transform');
    // nginx buffers proxied responses by default, which holds every event until
    // the buffer fills: a stream that works locally and looks dead in production.
    expect(headers['x-accel-buffering']).toBe('no');
    // gzip is a buffering codec, so compressing this stream would hold each
    // event back until the next one arrived. See `middleware/compression.ts`.
    expect(headers['content-encoding']).toBeUndefined();
  });

  it('delivers current state the moment a viewer connects', async () => {
    const session = await newSession();
    await control(session.sessionId, session.controlToken)({ type: 'show', item: JOHN_3, index: 16 });

    const { body } = await openStream(`/api/present/j/${session.joinCode}/stream`);

    expect(body).toContain('retry:');
    expect(body).toContain('event: state');
    const payload = JSON.parse(body.slice(body.indexOf('data: ') + 6).split('\n')[0]);
    expect(payload.live).toEqual(JOHN_3);
    expect(payload.position.index).toBe(16);
    expect(payload.session.viewerCount).toBe(1);
  });

  it('does not count the controller preview as a viewer', async () => {
    // The count is what a presenter checks to confirm the television is
    // actually connected. The controller's preview pane is the real viewer in
    // an iframe, so without this it would report an audience of one before
    // anything was plugged in -- breaking the only thing the number is for.
    const session = await newSession();
    const { body } = await openStream(`/api/present/j/${session.joinCode}/stream?preview=1`);

    const payload = JSON.parse(body.slice(body.indexOf('data: ') + 6).split('\n')[0]);
    expect(payload.session.viewerCount).toBe(0);
  });

  it('tells a viewer the session ended rather than failing the connection', async () => {
    // `EventSource` retries a failed connection forever, so a projector left
    // running would reconnect all night. A `closed` event is what stops it.
    const session = await newSession();
    await control(session.sessionId, session.controlToken)({ type: 'end' });

    const res = await request(app).get(`/api/present/j/${session.joinCode}/stream`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('event: closed');
    expect(res.text).toContain('"reason":"ended"');
  });

  it('says a locked session is locked, not over', async () => {
    const session = await newSession();
    await control(session.sessionId, session.controlToken)({ type: 'lockJoins', locked: true });

    const res = await request(app).get(`/api/present/j/${session.joinCode}/stream`);
    expect(res.text).toContain('"reason":"locked"');
  });

  it('says a full session is full', async () => {
    const session = await newSession();

    // A hub with no room at all, so the very first viewer is turned away.
    const full = new PresentHub(0, 100);
    const solo = express();
    solo.use(express.json());
    solo.use('/api/present', createPresentRoutes({ db: fakeDb, appStateDir: dir, store, hub: full }));

    const res = await request(solo).get(`/api/present/j/${session.joinCode}/stream`);
    expect(res.text).toContain('"reason":"full"');
    full.dispose();
  });

  it('answers an unknown code with the same 404 as the one-shot read', async () => {
    expect((await request(app).get('/api/present/j/ZZZZZZZZ/stream')).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// The join code, as something a camera can read
// ---------------------------------------------------------------------------

describe('GET /api/present/j/:joinCode/qr.svg', () => {
  it('renders the viewer URL as an SVG', async () => {
    const session = await newSession();
    const res = await request(app)
      .get(`/api/present/j/${session.joinCode}/qr.svg`)
      // supertest only fills `.text` for types it knows; SVG arrives as a body
      // buffer otherwise.
      .buffer(true);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/svg+xml');
    const svg = res.text ?? res.body.toString('utf8');
    expect(svg).toContain('<svg');
    // The code the QR carries has to be the one on screen beside it.
    expect(svg).toContain(session.joinCode);
  });

  it('encodes the viewer URL and nothing privileged', async () => {
    const session = await newSession();
    const res = await request(app)
      .get(`/api/present/j/${session.joinCode}/qr.svg`)
      .buffer(true);

    // A control token reaching the lobby screen would put control of the wall
    // in front of everyone looking at it.
    const svg = res.text ?? res.body.toString('utf8');
    expect(svg).not.toContain(session.controlToken);
    expect(svg).not.toContain(session.sessionId);
  });

  it('is the same uniform 404 as every other unknown code', async () => {
    const res = await request(app).get('/api/present/j/ZZZZ9999/qr.svg');
    expect(res.status).toBe(404);
  });
});
