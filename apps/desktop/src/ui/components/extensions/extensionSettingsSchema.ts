/**
 * The schema -> flat-field helpers now live in `@bible/core/browser`
 * (`Settings/settingsFields.ts`) so the settings registry, the shared
 * `SettingsForm` in `@bible/ui` and extension settings all walk one field model.
 * This module keeps the old import path working for the desktop renderer, its
 * test and the host-side `storage.setSetting` validation.
 */
export {
  extractFields,
  applyDefaults,
  getMissingRequired,
  isFieldVisible,
  findField,
  validateSettingValue,
} from '@bible/core/browser';
export type { SettingsField } from '@bible/core/browser';
