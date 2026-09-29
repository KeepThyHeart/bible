/**
 * SettingsForm: renders the flat settings field model (`SettingsField[]` from
 * `@bible/core/browser`) as form rows. It is the one settings renderer: the settings
 * registry (`registry.toFields(group)`), and extension settings (JSON Schema through
 * `extractFields`) both feed it, in the desktop and web apps.
 *
 * Controlled and store-free: the caller owns `values` and receives `onChange(key, value)`.
 * Saving, loading, i18n and layout chrome stay with the caller; fields arrive with their
 * labels already resolved (`field.title`, `field.description`, `field.enumLabels`), and the
 * few fixed strings (`labels`) have English defaults.
 *
 * Every control gets id `${idPrefix}-${key with dots as dashes}`; the desktop extension
 * form passes `idPrefix="ext-setting"` to keep the ids it always had.
 */
import type { ReactNode } from 'react';
import { isFieldVisible } from '@bible/core/browser';
import type { SettingsField } from '@bible/core/browser';

export interface SettingsFormLabels {
  /** Placeholder option of an enum with no value. */
  select: string;
  /** Link text for a field's help URL. */
  learnMore: (field: string) => string;
}

export const DEFAULT_SETTINGS_FORM_LABELS: SettingsFormLabels = {
  select: 'Select...',
  learnMore: (field) => `Learn more about ${field}`,
};

export interface SettingsFormProps {
  fields: readonly SettingsField[];
  values: Readonly<Record<string, unknown>>;
  onChange: (key: string, value: unknown) => void;
  idPrefix?: string;
  labels?: Partial<SettingsFormLabels>;
  disabled?: boolean;
}

export function SettingsForm({ fields, values, onChange, idPrefix = 'setting', labels, disabled }: SettingsFormProps) {
  const merged: SettingsFormLabels = { ...DEFAULT_SETTINGS_FORM_LABELS, ...labels };
  return (
    <>
      {fields.map((field) => (
        <FieldRow
          key={field.key}
          field={field}
          values={values}
          onChange={onChange}
          idPrefix={idPrefix}
          labels={merged}
          disabled={disabled}
        />
      ))}
    </>
  );
}

interface RowProps {
  field: SettingsField;
  values: Readonly<Record<string, unknown>>;
  onChange: (key: string, value: unknown) => void;
  idPrefix: string;
  labels: SettingsFormLabels;
  disabled?: boolean | undefined;
}

function FieldRow({ field, values, onChange, idPrefix, labels, disabled }: RowProps): ReactNode {
  if (!isFieldVisible(field, values as Record<string, unknown>)) return null;
  if (field.kind === 'group') {
    return (
      <fieldset className="kth-fieldset">
        {field.title && <legend>{field.title}</legend>}
        {field.description && <p className="kth-field__hint">{field.description}</p>}
        {field.children?.map((child) => (
          <FieldRow
            key={child.key}
            field={child}
            values={values}
            onChange={onChange}
            idPrefix={idPrefix}
            labels={labels}
            disabled={disabled}
          />
        ))}
      </fieldset>
    );
  }

  const label = field.title ?? field.propertyName;
  const id = `${idPrefix}-${field.key.replace(/\./g, '-')}`;
  const describedBy = field.description ? `${id}-description` : undefined;
  const isCheckbox = field.kind === 'boolean';
  const labelNode = (
    <label htmlFor={id}>
      {label}
      {/* The asterisk is decoration; `aria-required` carries the meaning. */}
      {field.required && <span aria-hidden="true"> *</span>}
      {field.widget === 'slider' && typeof values[field.key] === 'number' && (
        <span> ({String(values[field.key])})</span>
      )}
    </label>
  );

  return (
    <div className="kth-field" data-setting-key={field.key}>
      {!isCheckbox && labelNode}
      {isCheckbox ? (
        <div>
          <FieldInput field={field} id={id} value={values[field.key]} onChange={onChange} describedBy={describedBy} labels={labels} disabled={disabled} />
          {' '}
          {labelNode}
        </div>
      ) : (
        <FieldInput field={field} id={id} value={values[field.key]} onChange={onChange} describedBy={describedBy} labels={labels} disabled={disabled} />
      )}
      {field.description && (
        <p id={describedBy} className="kth-field__hint">
          {field.description}
        </p>
      )}
      {field.helpUrl && (
        <a href={field.helpUrl} target="_blank" rel="noreferrer">
          {labels.learnMore(label)}
        </a>
      )}
    </div>
  );
}

interface InputProps {
  id: string;
  field: SettingsField;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
  describedBy?: string | undefined;
  labels: SettingsFormLabels;
  disabled?: boolean | undefined;
}

function FieldInput({ id, field, value, onChange, describedBy, labels, disabled }: InputProps) {
  const set = (v: unknown): void => onChange(field.key, v);
  const common = {
    id,
    disabled,
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
          className="kth-input"
          type={field.kind === 'email' ? 'email' : field.kind === 'uri' ? 'url' : 'text'}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => set(e.currentTarget.value)}
        />
      );
    case 'password':
    case 'secret':
      return (
        <input
          {...common}
          className="kth-input"
          type="password"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => set(e.currentTarget.value)}
        />
      );
    case 'textarea':
      return (
        <textarea
          {...common}
          className="kth-input"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => set(e.currentTarget.value)}
        />
      );
    case 'enum':
      return (
        <select
          {...common}
          className="kth-select"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => set(e.currentTarget.value)}
        >
          <option value="">{labels.select}</option>
          {field.enumValues?.map((opt) => (
            <option key={opt} value={opt}>
              {field.enumLabels?.[opt] ?? opt}
            </option>
          ))}
        </select>
      );
    case 'number':
    case 'integer':
      return (
        <input
          {...common}
          className={field.widget === 'slider' ? undefined : 'kth-input'}
          type={field.widget === 'slider' ? 'range' : 'number'}
          value={typeof value === 'number' ? value : ''}
          min={field.numberConstraints?.minimum}
          max={field.numberConstraints?.maximum}
          step={field.numberConstraints?.multipleOf ?? (field.kind === 'integer' ? 1 : undefined)}
          onChange={(e) => {
            const raw = e.currentTarget.value;
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
        <input {...common} type="checkbox" checked={value === true} onChange={(e) => set(e.currentTarget.checked)} />
      );
    case 'string-array': {
      const arr = Array.isArray(value) ? (value as unknown[]).filter((v): v is string => typeof v === 'string') : [];
      return (
        <input
          {...common}
          className="kth-input"
          type="text"
          value={arr.join(', ')}
          onChange={(e) =>
            set(
              e.currentTarget.value
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
}
