/**
 * Per-permission extension install consent dialog.
 *
 * Renders the pending `InstallConsentRequest` from the consent store. The
 * user can:
 *
 *   - Toggle individual permissions on/off (default: every requested
 *     permission is checked).
 *   - See the high-risk `SEPARATELY_PROMPTED_PERMISSIONS` highlighted with
 *     extra detail (network hosts, secrets storage, raw database access).
 *   - "Allow selected" -> main proceeds with the install using the chosen
 *     subset.
 *   - "Cancel" -> main aborts the install.
 *
 * The dialog is intentionally form-heavy and unstyled beyond inline CSS -
 * polish lands once the first real extension lists in the marketplace.
 */

import React from 'react';
import type { Extensions } from '@bible/core';
import { useExtensionConsentStore } from '../../extensions/extensionConsentStore';
import { useI18n } from '../../contexts/useI18n';
import { useFocusTrap } from '../../hooks/useFocusTrap';

type ExtensionPermission = Extensions.ExtensionPermission;

/**
 * Catalog key per permission.
 *
 * The sentence a user reads before granting an extension access to their
 * notes is as consequential as any string in the app, so it belongs where
 * the wording can be reviewed and translated rather than inline here.
 */
const PERMISSION_DESCRIPTION_KEYS: Partial<Record<ExtensionPermission, string>> = {
  'bible:read': 'extensionConsent.permission.bibleRead',
  'commentary:read': 'extensionConsent.permission.commentaryRead',
  'dictionary:read': 'extensionConsent.permission.dictionaryRead',
  'book:read': 'extensionConsent.permission.bookRead',
  'notes:read': 'extensionConsent.permission.notesRead',
  'notes:write': 'extensionConsent.permission.notesWrite',
  'highlights:read': 'extensionConsent.permission.highlightsRead',
  'highlights:write': 'extensionConsent.permission.highlightsWrite',
  'bookmarks:read': 'extensionConsent.permission.bookmarksRead',
  'bookmarks:write': 'extensionConsent.permission.bookmarksWrite',
  network: 'extensionConsent.permission.network',
  'network:oauth': 'extensionConsent.permission.networkOauth',
  storage: 'extensionConsent.permission.storage',
  'storage:secrets': 'extensionConsent.permission.storageSecrets',
  'storage:database': 'extensionConsent.permission.storageDatabase',
  'fs:read-user': 'extensionConsent.permission.fsReadUser',
  'fs:write-user': 'extensionConsent.permission.fsWriteUser',
};

/**
 * Provenance banner shown above the permission list.
 *
 * The tier model is warn-don't-block: an untrusted extension still installs,
 * so this banner is the user's main signal that they are about to run code
 * nobody has vouched for. It is deliberately the most prominent thing in the
 * dialog after the title.
 *
 * An absent tier is rendered as untrusted rather than omitted - a missing
 * classification is not evidence of safety, and failing open here would hide
 * the warning exactly when something has gone wrong upstream.
 */
const TrustBanner: React.FC<{
  t: (key: string, params?: Record<string, unknown>) => string;
  trustTier?: Extensions.ExtensionTrustTier;
  signaturePublicKey?: string;
}> = ({ t, trustTier, signaturePublicKey }) => {
  if (trustTier === 'marketplace' || trustTier === 'signed') {
    return (
      <p
        data-testid="extension-consent-trust"
        data-trust-tier={trustTier}
        style={{
          margin: '0 0 16px',
          padding: 10,
          fontSize: 13,
          borderRadius: 6,
          border: '1px solid var(--theme-border-primary)',
        }}
      >
        {trustTier === 'marketplace'
          ? t('extensions.consent.trust.marketplace')
          : t('extensions.consent.trust.signed')}
      </p>
    );
  }

  // Untrusted (or unclassified). Distinguish "no signature at all" from
  // "validly signed by someone we don't recognise" - the second is a real
  // integrity guarantee and calling it "unsigned" would be plainly wrong.
  const detail =
    signaturePublicKey !== undefined && signaturePublicKey.length > 0
      ? t('extensions.consent.trust.unknownPublisher')
      : t('extensions.consent.trust.unsigned');

  return (
    <div
      data-testid="extension-consent-trust"
      data-trust-tier="untrusted"
      role="alert"
      style={{
        margin: '0 0 16px',
        padding: 12,
        fontSize: 13,
        borderRadius: 6,
        border: '1px solid var(--theme-danger-border)',
        background: 'var(--theme-danger-soft)',
      }}
    >
      <strong style={{ display: 'block', marginBottom: 4 }}>
        {t('extensions.consent.trust.untrustedTitle')}
      </strong>
      <span>
        {detail}{' '}
        {t('extensions.consent.trust.untrustedBody')}
      </span>
    </div>
  );
};

const ExtensionConsentDialog: React.FC = () => {
  const { t } = useI18n();
  const pending = useExtensionConsentStore((s) => s.pending);
  const [granted, setGranted] = React.useState<Set<ExtensionPermission>>(new Set());
  const dialogRef = useFocusTrap<HTMLDivElement>(pending !== null);

  React.useEffect(() => {
    if (pending) {
      // Default to "everything checked" so the user only has to opt out.
      setGranted(new Set(pending.requestedPermissions));
    }
  }, [pending]);

  // Escape declines the install - the same outcome as Cancel.
  React.useEffect(() => {
    if (!pending) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      pending.resolve({ granted: false });
      useExtensionConsentStore.getState().setPending(null); // allow-getstate: event handler - imperative store update
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pending]);

  if (!pending) return null;

  const togglePermission = (p: ExtensionPermission): void => {
    setGranted((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  const onAllow = (): void => {
    pending.resolve({ granted: true, grantedPermissions: Array.from(granted) });
    useExtensionConsentStore.getState().setPending(null); // allow-getstate: event handler - imperative store update
  };

  const onCancel = (): void => {
    pending.resolve({ granted: false });
    useExtensionConsentStore.getState().setPending(null); // allow-getstate: event handler - imperative store update
  };

  const separatelyPromptedSet = new Set(pending.separatelyPrompted);
  const m = pending.manifest;
  const flatten = (v: unknown): string =>
    typeof v === 'string' ? v : v && typeof v === 'object' && 'key' in (v as object) ? `[${(v as { key: string }).key}]` : '';
  const displayName = flatten(m.displayName) || m.id;
  const description = flatten(m.description);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--theme-bg-overlay)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10001,
      }}
      data-testid="extension-consent-dialog"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="extension-consent-title"
        style={{
          background: 'var(--theme-bg-primary, white)',
          color: 'var(--theme-text-primary, black)',
          borderRadius: 10,
          padding: 24,
          width: 560,
          maxHeight: '85vh',
          overflowY: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        <h2 id="extension-consent-title" style={{ marginTop: 0, fontSize: 20, fontWeight: 700 }}>
          Install &ldquo;{displayName}&rdquo;?
        </h2>
        <p style={{ marginTop: 4, marginBottom: 16, opacity: 0.75, fontSize: 13 }}>
          {m.id} v{m.version}
          {m.publisher ? ` · ${m.publisher}` : ''}
        </p>
        <TrustBanner
          t={t}
          trustTier={pending.trustTier}
          signaturePublicKey={pending.signaturePublicKey}
        />

        {description && (
          <p style={{ marginBottom: 16, fontSize: 14 }}>{description}</p>
        )}

        <h3 style={{ fontSize: 14, fontWeight: 600, marginTop: 8, marginBottom: 8 }}>
          {t('extensionConsentDialog.thisExtensionIsRequesting')}
        </h3>

        {pending.requestedPermissions.length === 0 ? (
          <p style={{ fontSize: 13, opacity: 0.7 }}>{t('extensionConsentDialog.noAdditionalPermissionsRequested')}</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {pending.requestedPermissions.map((p) => {
              const isHighRisk = separatelyPromptedSet.has(p);
              return (
                <li
                  key={p}
                  data-testid="extension-consent-permission"
                  data-permission={p}
                  data-high-risk={isHighRisk ? 'true' : 'false'}
                  style={{
                    border: `1px solid ${
                      isHighRisk ? 'var(--theme-danger-border)' : 'var(--theme-border-primary)'
                    }`,
                    borderRadius: 6,
                    padding: 10,
                    marginBottom: 8,
                    background: isHighRisk ? 'var(--theme-danger-soft)' : undefined,
                  }}
                >
                  <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={granted.has(p)}
                      onChange={() => togglePermission(p)}
                      style={{ marginTop: 3 }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>
                        {p}
                        {isHighRisk && (
                          <span
                            style={{
                              color: 'var(--theme-danger-text)',
                              marginInlineStart: 8,
                              fontSize: 11,
                            }}
                          >
                            {t('extensionConsentDialog.sensitive')}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, opacity: 0.8, marginTop: 2 }}>
                        {PERMISSION_DESCRIPTION_KEYS[p]
                          ? t(PERMISSION_DESCRIPTION_KEYS[p])
                          : t('extensionConsent.permission.unknown')}
                      </div>
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>
        )}

        {pending.networkHosts.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
              {t('extensionConsentDialog.networkHostsTheExtensionMayContact')}
            </h4>
            <ul style={{ fontSize: 12, paddingInlineStart: 18 }}>
              {pending.networkHosts.map((h, idx) => (
                <li key={idx}>
                  <code>{h.host}</code>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <button type="button" onClick={onCancel} data-testid="extension-consent-cancel">
            {t('extensionConsentDialog.cancel')}
          </button>
          <button
            type="button"
            onClick={onAllow}
            data-testid="extension-consent-allow"
            aria-label={t('extensionConsentDialog.installLabel', { name: displayName })}
            style={{
              background: 'var(--theme-accent-primary)',
              color: 'var(--theme-accent-text)',
              border: 'none',
              padding: '8px 16px',
              borderRadius: 4,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {t('extensionConsentDialog.install')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ExtensionConsentDialog;
