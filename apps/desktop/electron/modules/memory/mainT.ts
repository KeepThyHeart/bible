/**
 * Memory's translator for main-process text (task 0114 M3): catalog lookup through the main
 * process's `MainI18n` (plain `{name}` placeholders), falling back to the English written beside
 * the key. `locales/<lng>/memory.json` is loaded with the other namespaces at startup.
 */
import { formatMessage, type Translate } from '@bible/memory/messages';
import { t } from '../../services/MainI18n';

export const memoryMainT: Translate = (key, fallback, params) => {
  const text = t(key, params as Record<string, unknown> | undefined);
  return text === key ? formatMessage(fallback, params ?? {}) : text;
};
