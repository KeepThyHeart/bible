import { useState } from 'react';
import type { FormEvent } from 'react';
import { TextField } from './fields';
import { DEFAULT_PRIVACY_LABELS } from './labels';
import type { PrivacyPanelProps } from './types';

export function PrivacyPanel({ onExportPlain, onExportEncrypted, onExportServerData, onDeleteAccount, serverSees, labels }: PrivacyPanelProps) {
  const l = { ...DEFAULT_PRIVACY_LABELS, ...labels };
  const [working, setWorking] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState('');

  async function run(key: string, fn: () => Promise<void>) {
    setWorking(key);
    try { await fn(); } catch { /* the host reports failures */ } finally { setWorking(null); }
  }
  const btn = (key: string, text: string, fn: () => Promise<void>) => (
    <button type="button" className="kth-btn" disabled={working !== null} aria-busy={working === key || undefined} onClick={() => { void run(key, fn); }}>
      {working === key ? l.busy : text}
    </button>
  );

  function del(e: FormEvent) {
    e.preventDefault();
    if (password === '' || working !== null) return;
    void run('delete', () => onDeleteAccount(password));
  }

  return (
    <section className="kth-account">
      <h2 className="kth-account__title">{l.title}</h2>
      <div className="kth-account__section">
        <h3 className="kth-account__subtitle">{l.serverSeesTitle}</h3>
        <ul className="kth-account__list">
          {serverSees.map((s, i) => <li key={i}>{s}</li>)}
        </ul>
      </div>
      <div className="kth-account__section">
        <h3 className="kth-account__subtitle">{l.exportTitle}</h3>
        <div className="kth-account__actions">
          {btn('plain', l.exportPlain, onExportPlain)}
          {btn('encrypted', l.exportEncrypted, onExportEncrypted)}
          {btn('server', l.exportServerData, onExportServerData)}
        </div>
      </div>
      <form className="kth-account__section" onSubmit={del} noValidate>
        <h3 className="kth-account__subtitle">{l.deleteTitle}</h3>
        <p className="kth-account__notice">{l.deleteWarning}</p>
        {deleting ? (
          <>
            <TextField label={l.deletePassword} type="password" value={password} onChange={setPassword} autoComplete="current-password" disabled={working !== null} />
            <div className="kth-account__actions">
              <button type="submit" className="kth-btn kth-btn--danger" disabled={password === '' || working !== null} aria-busy={working === 'delete' || undefined}>
                {working === 'delete' ? l.busy : l.deleteConfirm}
              </button>
            </div>
          </>
        ) : (
          <div className="kth-account__actions">
            <button type="button" className="kth-btn kth-btn--danger" onClick={() => setDeleting(true)}>{l.deleteAccount}</button>
          </div>
        )}
      </form>
    </section>
  );
}
