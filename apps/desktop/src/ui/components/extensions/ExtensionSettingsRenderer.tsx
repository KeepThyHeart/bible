/**
 * JSON Schema -> extension settings form renderer.
 *
 * Reads `contributes.configuration`
 * from the extension manifest, calls `extractFields` to flatten the schema,
 * and renders one row per field. Save/load round-trip through the existing
 * `extensions:getSettings` / `extensions:setSettings` IPC pair.
 *
 * The renderer is intentionally minimal markup-wise; polish comes alongside
 * the rest of the Extensions panel UI. What matters here is a working,
 * accessible form so an extension that ships a
 * configuration schema becomes user-configurable. The pure form-walking
 * logic lives in `extensionSettingsSchema.ts` and is unit-tested separately.
 */

import React from 'react';

import { useI18n } from '../../contexts/useI18n';
import {
  applyDefaults,
  extractFields,
  getMissingRequired,
  isFieldVisible,
  type SettingsField,
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
}

const ExtensionSettingsRenderer: React.FC<ExtensionSettingsRendererProps> = ({
  extensionId,
  schema,
  io,
  onSaved,
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
        {fields.map((field) => (
          <FieldRow
            key={field.key}
            field={field}
            values={values}
            onChange={setFieldValue}
            t={t}
          />
        ))}
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

type Translate = (key: string, params?: Record<string, unknown>) => string;

interface FieldRowProps {
  field: SettingsField;
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  t: Translate;
}

const FieldRow: React.FC<FieldRowProps> = ({ field, values, onChange, t }) => {
  if (!isFieldVisible(field, values)) return null;
  if (field.kind === 'group') {
    return (
      <fieldset className="extension-settings-group">
        {field.title && <legend>{field.title}</legend>}
        {field.description && <p>{field.description}</p>}
        {field.children?.map((child) => (
          <FieldRow key={child.key} field={child} values={values} onChange={onChange} t={t} />
        ))}
      </fieldset>
    );
  }

  const value = values[field.key];
  const label = field.title ?? field.propertyName;
  const id = `ext-setting-${field.key.replace(/\./g, '-')}`;
  const describedBy = field.description ? `${id}-description` : undefined;

  return (
    <div className="extension-settings-row">
      <label htmlFor={id}>
        {label}
        {/* The asterisk is decoration; `aria-required` carries the meaning. */}
        {field.required && <span aria-hidden="true"> *</span>}
      </label>
      {field.description && <p id={describedBy}>{field.description}</p>}
      <FieldInput
        field={field}
        id={id}
        value={value}
        onChange={onChange}
        describedBy={describedBy}
      />
      {field.helpUrl && (
        <a href={field.helpUrl} target="_blank" rel="noreferrer">
          {t('extensionSettings.learnMoreLabel', { field: label })}
        </a>
      )}
    </div>
  );
};

interface FieldInputProps {
  id: string;
  field: SettingsField;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
  describedBy?: string | undefined;
}

const FieldInput: React.FC<FieldInputProps> = ({ id, field, value, onChange, describedBy }) => {
  const { t } = useI18n();
  const set = (v: unknown): void => onChange(field.key, v);
  // Shared on every branch so description text and requiredness reach AT
  // regardless of which control type the schema asks for.
  const common = {
    id,
    'aria-describedby': describedBy,
    'aria-required': field.required ? (true as const) : undefined,
  };

  switch (field.kind) {
    case 'string':
    case 'uri':
    case 'email':
      return (
        <input
          {...common}
          type={field.kind === 'email' ? 'email' : field.kind === 'uri' ? 'url' : 'text'}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => set(e.target.value)}
        />
      );
    case 'password':
    case 'secret':
      return (
        <input
          {...common}
          type="password"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => set(e.target.value)}
        />
      );
    case 'textarea':
      return (
        <textarea
          {...common}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => set(e.target.value)}
        />
      );
    case 'enum':
      return (
        <select
          {...common}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => set(e.target.value)}
        >
          <option value="">{t('extensionSettingsRenderer.select')}</option>
          {field.enumValues?.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    case 'number':
    case 'integer':
      return (
        <input
          {...common}
          type="number"
          value={typeof value === 'number' ? value : ''}
          min={field.numberConstraints?.minimum}
          max={field.numberConstraints?.maximum}
          step={
            field.numberConstraints?.multipleOf ??
            (field.kind === 'integer' ? 1 : undefined)
          }
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') {
              set(undefined);
              return;
            }
            const parsed = field.kind === 'integer' ? parseInt(raw, 10) : parseFloat(raw);
            if (!Number.isNaN(parsed)) set(parsed);
          }}
        />
      );
    case 'boolean':
      return (
        <input
          {...common}
          type="checkbox"
          checked={value === true}
          onChange={(e) => set(e.target.checked)}
        />
      );
    case 'string-array': {
      const arr = Array.isArray(value) ? (value as unknown[]).filter((v) => typeof v === 'string') : [];
      return (
        <input
          {...common}
          type="text"
          value={(arr as string[]).join(', ')}
          onChange={(e) =>
            set(
              e.target.value
                .split(',')
                .map((s) => s.trim())
                .filter((s) => s.length > 0),
            )
          }
        />
      );
    }
    default:
      return null;
  }
};

export default ExtensionSettingsRenderer;
