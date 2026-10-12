import { useState } from 'react';
import { DEFAULT_ACCOUNT_PANEL_LABELS } from './labels';
import { SyncStatusBadge } from './SyncStatusBadge';
import type { AccountPanelProps } from './types';
import { fill, formatBytes, formatDateTime } from './util';

export function AccountPanel({ email, status, usage, devices, onSyncNow, onRevoke, onChangePassword, onNewRecoveryCode, onSignOut, labels }: AccountPanelProps) {
  const l = { ...DEFAULT_ACCOUNT_PANEL_LABELS, ...labels };
  const [signingOut, setSigningOut] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const pct = usage.quotaBytes > 0 ? Math.min(100, Math.round((usage.bytesUsed / usage.quotaBytes) * 100)) : 0;

  async function run(key: string, fn: () => Promise<void>) {
    setWorking(key);
    try { await fn(); } catch { /* the host reports failures */ } finally { setWorking(null); }
  }

  return (
    <section className="kth-account">
      <h2 className="kth-account__title">{l.title}</h2>
      <p className="kth-account__row">
        <span className="kth-account__muted">{l.signedInAs}</span>{' '}
        <strong className="kth-account__email">{email}</strong>
      </p>
      <div className="kth-account__row kth-account__row--wrap">
        <SyncStatusBadge status={status} />
        <button type="button" className="kth-btn kth-btn--sm" onClick={onSyncNow} disabled={status.state === 'syncing' || status.state === 'signed-out'}>{l.syncNow}</button>
      </div>
      <p className="kth-account__muted">
        {l.lastSynced}: {status.lastSyncedAt ? formatDateTime(status.lastSyncedAt) : l.never}
      </p>
      {status.pending > 0 ? <p className="kth-account__muted">{fill(l.pending, { n: status.pending })}</p> : null}
      {status.opaque > 0 ? <p className="kth-account__notice">{fill(l.opaque, { n: status.opaque })}</p> : null}

      <div className="kth-account__section">
        <div className="kth-account__row kth-account__row--between">
          <span>{l.usage}</span>
          <span className="kth-account__muted">{formatBytes(usage.bytesUsed)} / {formatBytes(usage.quotaBytes)}</span>
        </div>
        <div className="kth-account__usage" role="progressbar" aria-label={l.usage} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <span className="kth-account__usage-fill" style={{ inlineSize: `${pct}%` }} />
        </div>
      </div>

      <div className="kth-account__section">
        <h3 className="kth-account__subtitle">{l.devices}</h3>
        <ul className="kth-account__devices">
          {devices.map((d) => (
            <li key={d.id} className="kth-account__device">
              <div className="kth-account__device-info">
                <span className="kth-account__device-name">{d.name}</span>
                {d.current ? <span className="kth-account__tag">{l.thisDevice}</span> : null}
                <span className="kth-account__muted">{l.lastSeen}: {formatDateTime(d.lastSeenAt)}</span>
              </div>
              {d.current ? null : (
                <button type="button" className="kth-btn kth-btn--sm" disabled={working !== null} onClick={() => { void run(d.id, () => onRevoke(d.id)); }}>{l.revoke}</button>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="kth-account__actions">
        <button type="button" className="kth-btn" onClick={onChangePassword}>{l.changePassword}</button>
        <button type="button" className="kth-btn" onClick={onNewRecoveryCode}>{l.newRecoveryCode}</button>
        {signingOut ? null : <button type="button" className="kth-btn kth-btn--ghost" onClick={() => setSigningOut(true)}>{l.signOut}</button>}
      </div>

      {signingOut ? (
        <div className="kth-account__section kth-account__stack" role="group" aria-label={l.signOut}>
          <button type="button" className="kth-btn" disabled={working !== null} onClick={() => { void run('out', () => onSignOut(false)); }}>{l.signOutKeep}</button>
          <button type="button" className="kth-btn kth-btn--danger" disabled={working !== null} onClick={() => { void run('out', () => onSignOut(true)); }}>{l.signOutWipe}</button>
          <p className="kth-account__notice">{l.signOutWipeWarning}</p>
          <div className="kth-account__actions">
            <button type="button" className="kth-btn kth-btn--ghost" onClick={() => setSigningOut(false)}>{l.cancel}</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
