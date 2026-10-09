/** Catalog lookup for the Memory UI and host wiring: the `memory` namespace, English as the written fallback. */
import { formatMessage } from '@bible/memory/messages';
import type { Translate } from '@bible/memory/messages';
import { i18nService } from '../../services/I18nService';

export const memoryT: Translate = (key, fallback, params) => {
  const text = i18nService.t(key, params as Record<string, unknown> | undefined);
  return text === key || text === `[${key}]` ? formatMessage(fallback, params ?? {}, i18nService.currentLocale) : text;
};
