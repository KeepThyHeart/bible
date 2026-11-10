/** W-009 (503 mapping), W-011 (error envelope), W-012 (static bypass vs /api). */
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createPasswordGate, hashPassword } from '../middleware/passwordGate';
import { isServiceBusyError, sendServiceBusy } from '../utils/apiErrors';

function gateApp() {
  const app = express();
  app.use(createPasswordGate({ passwordHash: hashPassword('secret') }));
  app.use((_req, res) => { res.json({ ok: true }); });
  return app;
}

describe('passwordGate (W-011, W-012)', () => {
  it('does not skip auth for a static-looking path under /api', async () => {
    const res = await request(gateApp()).get('/api/dictionary/Easton/adjacent/M.js').set('Accept', 'application/json');
    expect(res.status).toBe(401);
  });

  it('still skips auth for build artifacts outside /api', async () => {
    const res = await request(gateApp()).get('/assets/app.js');
    expect(res.status).toBe(200);
  });

  it('answers the JSON 401 in the standard envelope', async () => {
    const res = await request(gateApp()).get('/api/bible').set('Accept', 'application/json');
    expect(res.status).toBe(401);
    expect(res.body.error).toEqual({ code: 'AUTH_REQUIRED', message: expect.any(String) });
  });
});

describe('service-busy mapping (W-009)', () => {
  it('recognises connect-timeout errors only', () => {
    expect(isServiceBusyError(Object.assign(new Error('Response timeout'), { code: 'ETIMEDOUT', status: 503 }))).toBe(true);
    expect(isServiceBusyError({ status: 503 })).toBe(true);
    expect(isServiceBusyError(new Error('boom'))).toBe(false);
    expect(isServiceBusyError(null)).toBe(false);
  });

  it('sends 503 SERVICE_BUSY with Retry-After, and nothing if headers already went out', () => {
    const res: any = { headersSent: false, set: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() };
    sendServiceBusy(res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.set).toHaveBeenCalledWith('Retry-After', expect.any(String));
    expect(res.json.mock.calls[0][0].error.code).toBe('SERVICE_BUSY');
    const sent: any = { headersSent: true, set: vi.fn(), status: vi.fn(), json: vi.fn() };
    sendServiceBusy(sent);
    expect(sent.status).not.toHaveBeenCalled();
  });
});
