/** Device list and sign-out (contracts §7, W2-C): GET devices | DELETE devices/:id. Scoped by account. */
import { Router } from 'express';
import type { Sync } from '@bible/core';
import { ApiHttpError, authOf, clearSessionCookie, handler, requireSession, type ServerContext } from '../http';
import * as v from '../auth/validate';
import type { DeviceDetail } from '../store/SyncStore';

const HEX16 = /^[0-9a-f]{16}$/;

export function deviceWire(d: DeviceDetail, currentDeviceId: string): Sync.DevicesResponse['devices'][number] {
  return {
    id: d.id, nameSealed: d.nameSealed, createdAt: new Date(d.createdAt).toISOString(),
    lastSeenAt: new Date(d.lastSeenAt).toISOString(), userAgent: d.userAgent, current: d.id === currentDeviceId,
  };
}

export function deviceRoutes(ctx: ServerContext): Router {
  const r = Router();
  const { store } = ctx;

  r.get('/devices', requireSession(ctx), (_req, res) => {
    const { account, session } = authOf(res);
    const body: Sync.DevicesResponse = {
      devices: store.devices.listDetailed(account.id).map((d) => deviceWire(d, session.deviceId)),
    };
    res.json(body);
  });

  // Login/recover send a placeholder name (the client holds no account key yet); the client then seals the real one.
  r.put('/devices/current', requireSession(ctx), handler((req, res) => {
    const { account, session } = authOf(res);
    const nameSealed = v.nameSealed(v.obj(req.body).nameSealed);
    const device = store.devices.list(account.id).find((d) => d.id === session.deviceId);
    if (!device) throw new ApiHttpError(404, 'not_found');
    store.devices.upsert({ ...device, nameSealed });
    res.status(204).end();
  }));

  r.delete('/devices/:id', requireSession(ctx), handler((req, res) => {
    const { account, session, viaCookie } = authOf(res);
    const id = req.params.id;
    if (!HEX16.test(id)) throw new ApiHttpError(400, 'bad_request', 'invalid device id');
    if (!store.devices.list(account.id).some((d) => d.id === id)) throw new ApiHttpError(404, 'not_found');
    store.devices.delete(account.id, id); // also drops that device's sessions
    if (id === session.deviceId && viaCookie) clearSessionCookie(ctx, res);
    res.status(204).end();
  }));

  return r;
}
