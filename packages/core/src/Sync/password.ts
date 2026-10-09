/**
 * Password strength (contracts 0063 §9).
 *
 * The estimator is loaded lazily with dynamic imports of `@zxcvbn-ts/core` and `@zxcvbn-ts/language-common` inside
 * the function body (never at module top), so the dictionaries stay out of the web entry chunk and nothing runs at
 * module load.
 *
 * `feedback` holds zxcvbn-ts translation KEYS, not English sentences (no language pack is loaded): the warning key
 * first (e.g. `common`, `userInputs`, `straightRow`), then the suggestion keys (e.g. `anotherWord`, `capitalization`).
 * The UI translates them (accounts i18n namespace) and may ignore keys it does not know.
 */

export type PasswordScore = 0 | 1 | 2 | 3 | 4;
type Zxcvbn = (password: string, userInputs?: (string | number)[]) => {
  score: number; feedback: { warning: string | null; suggestions: string[] };
};

let estimator: Promise<Zxcvbn> | null = null;

function loadEstimator(): Promise<Zxcvbn> {
  estimator ??= (async () => {
    const [core, common] = await Promise.all([import('@zxcvbn-ts/core'), import('@zxcvbn-ts/language-common')]);
    core.zxcvbnOptions.setOptions({
      dictionary: { ...common.dictionary },
      graphs: common.adjacencyGraphs,
    });
    return core.zxcvbn as Zxcvbn;
  })().catch((e: unknown) => {
    estimator = null;   // allow a retry (e.g. a chunk that failed to download)
    throw e;
  });
  return estimator;
}

/**
 * Words a password should not be built from, taken from an email address: the whole address, the local part, its
 * pieces split on `. _ + -` (and joined without them), and the domain name without its TLD. Lower-cased, at
 * least 3 characters, de-duplicated.
 */
export function emailUserInputs(email: string): string[] {
  const e = email.trim().normalize('NFC').toLowerCase();
  if (!e) return [];
  const at = e.lastIndexOf('@');
  const local = at >= 0 ? e.slice(0, at) : e;
  const domain = at >= 0 ? e.slice(at + 1) : '';
  const parts = [e, local, local.replace(/[._+-]+/g, ''), ...local.split(/[._+-]+/), ...domain.split('.').slice(0, -1)];
  return [...new Set(parts.filter((p) => p.length >= 3))];
}

/** Score 0-4 (zxcvbn) plus feedback keys. `userInputs` are words specific to this user (email parts, name). */
export async function passwordStrength(pw: string, userInputs?: string[]): Promise<{ score: PasswordScore; feedback: string[] }> {
  const zxcvbn = await loadEstimator();
  const r = zxcvbn(pw, userInputs ?? []);
  const score = Math.max(0, Math.min(4, Math.trunc(r.score))) as PasswordScore;
  const feedback = [...(r.feedback.warning ? [r.feedback.warning] : []), ...r.feedback.suggestions];
  return { score, feedback };
}
