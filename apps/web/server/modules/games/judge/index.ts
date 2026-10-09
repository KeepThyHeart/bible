/**
 * Judging: the layer that may offer the host a suggestion, and never more than
 * that.
 *
 * The rest of the server knows only `JudgeProvider` — an id and one `suggest`
 * call that resolves to a suggestion or to nothing. Which implementation is
 * behind it is a configuration question, and "none" is the answer the games are
 * built for: the host taps correct or incorrect either way, so a room with no
 * API key is not a degraded room, it is the ordinary one.
 *
 * The provider is called from the server only, one answer at a time, and is
 * never shown another player's answer.
 */

import { config } from '../config.js';
import { nullJudge } from './nullProvider.js';
import { localJudge } from './localProvider.js';
import type { PrivacyMode } from '../../../SiteConfig.js';
import { createHttpJudge, DEFAULT_TIMEOUT_MS } from './httpProvider.js';
import type { JudgeFetch } from './httpProvider.js';
import type { JudgeProvider } from '../../../../src/modules/games/shared/protocol.js';

export { nullJudge } from './nullProvider.js';
export { localJudge, LOCAL_JUDGE_ID } from './localProvider.js';
export { createHttpJudge, HTTP_JUDGE_ID, DEFAULT_TIMEOUT_MS } from './httpProvider.js';
export type {
  HttpJudgeSettings,
  JudgeFetch,
  JudgeHttpRequest,
  JudgeHttpResponse,
} from './httpProvider.js';

// Re-exported so a caller needs one import for the whole layer. These live in
// the shared protocol because a suggestion crosses to the host screen.
export type { JudgeProvider, JudgeRequest, JudgeSuggestion } from '../../../../src/modules/games/shared/protocol.js';

/**
 * What the factory needs in order to build an HTTP provider. Structurally the
 * boot configuration's judge block, plus two things a test or an operator may
 * want to vary independently of it.
 */
export interface JudgeSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  fetch?: JudgeFetch;
}

/**
 * Pick a provider. Absent or incomplete settings give the null provider rather
 * than an error: judging is the one part of the server whose failure mode must
 * be silence, and a half-filled environment file on a Sunday morning should
 * cost a suggestion, not the service.
 */
export function createJudgeProvider(
  settings: JudgeSettings | null = config.judge,
  options: { privacyMode?: PrivacyMode } = {}
): JudgeProvider {
  // Strict is the default (fail closed) and is decided before the key is even looked at: under
  // strict, no answer text goes to an external service, whatever is configured.
  if (options.privacyMode !== 'relaxed') return localJudge;
  if (settings === null) return nullJudge;
  if (!isComplete(settings)) return nullJudge;

  return createHttpJudge({
    baseUrl: settings.baseUrl.trim(),
    apiKey: settings.apiKey,
    model: settings.model.trim(),
    timeoutMs: settings.timeoutMs ?? timeoutFromEnvironment(),
    ...(settings.fetch === undefined ? {} : { fetch: settings.fetch }),
  });
}

function isComplete(settings: JudgeSettings): boolean {
  return settings.baseUrl.trim() !== '' && settings.apiKey.trim() !== '' && settings.model.trim() !== '';
}

/**
 * Read here rather than in the boot configuration because it is the only knob
 * on this layer that an operator tunes after deployment — a slow self-hosted
 * model on a home server needs a longer leash than a hosted one — and it has a
 * working default, so nothing else has to know it exists. Anything unparseable
 * or non-positive is treated as unset: a mistyped value should not silently
 * disable a provider that is otherwise configured.
 */
function timeoutFromEnvironment(): number {
  const raw = Number(process.env.BIBLE_GAMES_JUDGE_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}
