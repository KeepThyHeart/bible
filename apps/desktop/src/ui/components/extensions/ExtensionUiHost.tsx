/**
 * Renders the extension-driven notification stack and modal stack.
 *
 * `RendererUiBridge` (main process) calls into the
 * `useExtensionUiStore` (renderer) which holds the live array. This component
 * is the only thing that needs to be mounted: it watches the store and
 * renders whatever's there.
 *
 * Visual treatment is intentionally minimal - the goal is just "user can see
 * notifications and respond to dialogs". Real
 * polish lands once a third-party extension actually ships.
 */

import React from 'react';
import { useExtensionUiStore } from '../../extensions/extensionUiStore';
import { useAppServices } from '../../contexts/ContextProvider';
import { isLocalizedKey, type LocalizedString } from '../../types/LocalizedString';
import type { II18nService } from '../../services/II18nService';
import { useI18n } from '../../contexts/useI18n';
import { useFocusTrap } from '../../hooks/useFocusTrap';

function resolveLocalizedString(
  value: LocalizedString | undefined,
  i18n: II18nService,
): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  if (isLocalizedKey(value)) return i18n.t(value.key, value.params);
  return '';
}

const ExtensionUiHost: React.FC = () => {
  const { i18n } = useAppServices();
  // `t` below resolves extension-supplied LocalizedStrings; `tUi` resolves this
  // component's own catalog keys.
  const { t: tUi } = useI18n();
  const notifications = useExtensionUiStore((s) => s.notifications);
  const dismissNotification = useExtensionUiStore((s) => s.dismissNotification);
  const modal = useExtensionUiStore((s) => s.modal);
  const t = (v: LocalizedString | undefined) => resolveLocalizedString(v, i18n);

  return (
    <>
      {/* Notification toaster - pinned to the top TRAILING corner, i.e.
          top-right in LTR and top-left in RTL. */}
      <div
        // One polite live region for the whole stack - individual toasts must
        // not each become their own announcer.
        //
        // `role="status"` is load-bearing, not decoration: `aria-label` is
        // prohibited on a plain generic div (it has no role to name), so
        // without this the label is dropped and axe flags aria-prohibited-attr.
        role="status"
        aria-live="polite"
        aria-label={tUi('extensionUi.notificationsLabel')}
        style={{
          position: 'fixed',
          top: 16,
          insetInlineEnd: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          zIndex: 9999,
          pointerEvents: 'none',
        }}
        data-testid="extension-notification-stack"
      >
        {notifications.map((n) => (
          <div
            key={n.id}
            data-testid="extension-notification"
            data-extension-id={n.extensionId}
            data-level={n.level}
            style={{
              pointerEvents: 'auto',
              padding: '10px 14px',
              borderRadius: 6,
              minWidth: 240,
              maxWidth: 360,
              background:
                n.level === 'error'
                  ? 'var(--theme-danger)'
                  : n.level === 'warning'
                    ? 'var(--theme-warning)'
                    : 'var(--theme-pane-header-bg)',
              color: 'var(--theme-accent-text)',
              boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
              fontSize: 14,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
            }}
          >
            <span style={{ flex: 1 }}>{t(n.message)}</span>
            <button
              type="button"
              onClick={() => dismissNotification(n.id)}
              style={{
                background: 'transparent',
                color: 'inherit',
                border: 'none',
                cursor: 'pointer',
                fontSize: 16,
                lineHeight: 1,
              }}
              aria-label={tUi('extensionUi.dismissNotification')}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {/* Modal - only ever one at a time */}
      {modal && <ExtensionModalHost />}
    </>
  );
};

const ExtensionModalHost: React.FC = () => {
  const { i18n } = useAppServices();
  const { t: tUi } = useI18n();
  const modal = useExtensionUiStore((s) => s.modal);
  const [inputValue, setInputValue] = React.useState('');
  const t = (v: LocalizedString | undefined) => resolveLocalizedString(v, i18n);
  const cardRef = useFocusTrap<HTMLDivElement>(modal !== null);

  React.useEffect(() => {
    if (modal?.kind === 'inputBox') {
      setInputValue(modal.opts.initialValue ?? '');
    }
  }, [modal]);

  // Escape dismisses any of the three modal kinds with the "no choice" result.
  React.useEffect(() => {
    if (!modal) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      if (modal.kind === 'confirm') modal.resolve(false);
      else modal.resolve(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [modal]);

  if (!modal) return null;

  const overlayStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'var(--theme-bg-overlay)',
    zIndex: 10000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };
  const cardStyle: React.CSSProperties = {
    background: 'var(--theme-bg-primary, white)',
    color: 'var(--theme-text-primary, black)',
    borderRadius: 8,
    padding: 20,
    minWidth: 360,
    maxWidth: 520,
    boxShadow: '0 10px 30px rgba(0,0,0,0.4)',
  };

  if (modal.kind === 'confirm') {
    return (
      <div style={overlayStyle} data-testid="extension-confirm-modal">
        <div
          ref={cardRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="extension-confirm-title"
          aria-describedby="extension-confirm-message"
          style={cardStyle}
        >
          <h2 id="extension-confirm-title" style={{ marginTop: 0, fontSize: 18, fontWeight: 600 }}>
            {t(modal.opts.title)}
          </h2>
          <p id="extension-confirm-message" style={{ marginBottom: 16 }}>
            {t(modal.opts.message)}
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button
              type="button"
              onClick={() => modal.resolve(false)}
              data-testid="extension-confirm-cancel"
            >
              {modal.opts.cancelLabel
                ? t(modal.opts.cancelLabel)
                : tUi('extensionUi.cancel')}
            </button>
            <button
              type="button"
              onClick={() => modal.resolve(true)}
              data-testid="extension-confirm-ok"
              style={
                modal.opts.destructive
                  ? { background: 'var(--theme-danger)', color: 'var(--theme-accent-text)' }
                  : undefined
              }
            >
              {modal.opts.confirmLabel
                ? t(modal.opts.confirmLabel)
                : tUi('extensionUi.ok')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (modal.kind === 'inputBox') {
    return (
      <div style={overlayStyle} data-testid="extension-input-modal">
        <div
          ref={cardRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="extension-input-prompt"
          style={cardStyle}
        >
          <p id="extension-input-prompt" style={{ marginTop: 0, marginBottom: 12 }}>
            {t(modal.opts.prompt)}
          </p>
          <input
            type={modal.opts.password ? 'password' : 'text'}
            value={inputValue}
            // The prompt paragraph is the only label this field has.
            aria-labelledby="extension-input-prompt"
            placeholder={modal.opts.placeholder ? t(modal.opts.placeholder) : undefined}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') modal.resolve(inputValue);
              if (e.key === 'Escape') modal.resolve(null);
            }}
            autoFocus
            style={{
              width: '100%',
              padding: '8px 10px',
              border: '1px solid var(--theme-border-primary)',
              borderRadius: 4,
              fontSize: 14,
            }}
            data-testid="extension-input-field"
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button type="button" onClick={() => modal.resolve(null)}>
              {tUi('extensionUi.cancel')}
            </button>
            <button type="button" onClick={() => modal.resolve(inputValue)}>
              {tUi('extensionUi.ok')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // quickPick
  return (
    <div style={overlayStyle} data-testid="extension-quickpick-modal">
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={tUi('extensionUi.quickPickLabel')}
        style={{ ...cardStyle, padding: 0 }}
      >
        {modal.opts?.placeholder && (
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--theme-border-primary)', fontSize: 13, opacity: 0.7 }}>
            {t(modal.opts.placeholder)}
          </div>
        )}
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 360, overflowY: 'auto' }}>
          {modal.items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => modal.resolve(item.id)}
                data-testid="extension-quickpick-item"
                style={{
                  width: '100%',
                  textAlign: 'start',
                  padding: '10px 16px',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: '1px solid var(--theme-border-primary)',
                  cursor: 'pointer',
                  display: 'block',
                  color: 'inherit',
                }}
              >
                <div style={{ fontWeight: 500 }}>{t(item.label)}</div>
                {item.description && (
                  <div style={{ fontSize: 12, opacity: 0.7 }}>
                    {t(item.description)}
                  </div>
                )}
                {item.detail && (
                  <div style={{ fontSize: 11, opacity: 0.5 }}>
                    {t(item.detail)}
                  </div>
                )}
              </button>
            </li>
          ))}
        </ul>
        <div style={{ padding: 12, borderTop: '1px solid var(--theme-border-primary)', textAlign: 'end' }}>
          <button type="button" onClick={() => modal.resolve(null)}>
            {tUi('extensionUi.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ExtensionUiHost;
