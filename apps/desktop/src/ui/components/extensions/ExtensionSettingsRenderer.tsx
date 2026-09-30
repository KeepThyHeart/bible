/**
 * JSON Schema -> extension settings form renderer.
 *
 * Reads `contributes.configuration`
 * from the extension manifest, calls `extractFields` to flatten the schema,
 * and renders one row per field. Save/load round-trip through the existing
 * `extensions:getSettings` / `extensions:setSettings` IPC pair.
 *
 * The field rows are drawn by the shared `SettingsForm` in `@bible/ui`, the same
 * component the settings registry uses. The renderer is intentionally minimal markup-wise; polish comes alongside
 * the rest of the Extensions panel UI. What matters here is a working,
 * accessible form so an extension that ships a
 * configuration schema becomes user-configurable. The pure form-walking
 * logic lives in `extensionSettingsSchema.ts` and is unit-tested separately.
 */

import React from 'react';

import { SettingsForm } from '@bible/ui';
import { useI18n } from '../../contexts/useI18n';
import {
  applyDefaults,
  extractFields,
  getMissingRequired,
} from './extensionSettingsSchema';

/**
 * Minimal IPC shape this renderer needs from the preload bridge. The full
 * `window.electron.extensions` surface is declared in `electron/preload.ts`;
 * we narrow to just the two methods we use to keep the renderer testable
 * with a hand-rolled stub.
 */
interface SettingsIo {
  getSettings: (extensionId: string) => Promise<Record<string, unknown>>;
  setSettings: (extensionId: string, values: Record<string, unknown>) => Promise<void>;
}

interface ExtensionSettingsRendererProps {
  extensionId: string;
  /**
   * The `contributes.configuration` JSON Schema from the extension manifest.
   * Pass `undefined` to render an empty placeholder (the extension declared
   * no settings).
   */
  schema: unknown;
  /** Optional override for IPC - useful in tests. */
  io?: SettingsIo;
  /** Notified when the form is saved (after a successful IPC write). */
  onSaved?: (values: Record<string, unknown>) => void;
  /**
   * A field's dot-path key to scroll into view once the form has loaded.
   * Set by `api.ui.openSettings(section)` (task 0024 round 3, P1.7), routed
   * here through `ExtensionsSection`'s `initialExpand.section`.
   */
  scrollToKey?: string;
}

const ExtensionSettingsRenderer: React.FC<ExtensionSettingsRendererProps> = ({
  extensionId,
  schema,
  io,
  onSaved,
  scrollToKey,
}) => {
  const { t } = useI18n();
  const fields = React.useMemo(() => extractFields(schema), [schema]);
  const [values, setValues] = React.useState<Record<string, unknown>>({});
  const [loading, setLoading] = React.useState<boolean>(true);
  const [saving, setSaving] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | null>(null);

  // Production wires `window.electron.extensions` from the preload bridge
  // (`electron/preload.ts`); the type is widened in that file. Tests pass
  // their own `io` to bypass the global.
  const transport: SettingsIo =
    io ?? ((window as unknown as { electron: { extensions: SettingsIo } }).electron.extensions);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    transport
      .getSettings(extensionId)
      .then((existing) => {
        if (cancelled) return;
        setValues(applyDefaults(fields, existing ?? {}));
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [extensionId, fields, transport]);

  React.useEffect(() => {
    if (!scrollToKey || loading) return;
    const id = `ext-setting-${scrollToKey.replace(/\./g, '-')}`;
    // The target field may not exist (a bad `section` argument, or one hidden
    // by `x-bibleAppDependsOn`) - scrolling is a courtesy, not a contract, so
    // a miss is silently a no-op rather than an error.
    document.getElementById(id)?.scrollIntoView({ block: 'center' });
  }, [scrollToKey, loading]);

  const setFieldValue = React.useCallback((key: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const missing = React.useMemo(() => getMissingRequired(fields, values), [fields, values]);

  const handleSave = React.useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await transport.setSettings(extensionId, values);
      onSaved?.(values);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [extensionId, values, transport, onSaved]);

  if (!fields.length) {
    return (
      <div className="extension-settings-empty">
        {t('extensionSettings.noSettings')}
      </div>
    );
  }
  if (loading) return <div>{t('ui.common.loading')}</div>;

  return (
    <div className="extension-settings">
      {missing.length > 0 && (
        <div className="extension-settings-required" role="alert">
          {t('extensionSettings.configurationNeeded', { fields: missing.join(', '), })}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleSave();
        }}
      >
        {/* The shared renderer (`@bible/ui`), also used for registry-driven settings. */}
        <SettingsForm
          fields={fields}
          values={values}
          onChange={setFieldValue}
          idPrefix="ext-setting"
          labels={{
            select: t('extensionSettingsRenderer.select'),
            learnMore: (field) => t('extensionSettings.learnMoreLabel', { field }),
          }}
        />
        <div className="extension-settings-actions">
          <button type="submit" disabled={saving}>
            {saving
              ? t('extensionSettings.saving')
              : t('extensionSettings.save')}
          </button>
        </div>
        {error && (
          <div className="extension-settings-error" role="alert">
            {error}
          </div>
        )}
      </form>
    </div>
  );
};

export default ExtensionSettingsRenderer;
