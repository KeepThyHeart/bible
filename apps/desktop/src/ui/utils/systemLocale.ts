/**
 * Match the operating system's preferred languages against the app's UI
 * locales, for the first-run language question.
 *
 * The OS list comes from `navigator.languages`, which Electron fills from the
 * system settings (Windows display language, macOS preferred languages, `LANG`
 * / `LANGUAGE` on Linux), most preferred first.
 */

/** The OS's preferred languages, most preferred first. Never throws. */
export function systemLanguagePreferences(): string[] {
  try {
    if (typeof navigator === 'undefined') return [];
    const list = navigator.languages?.length ? navigator.languages : [navigator.language];
    return list.filter((tag): tag is string => typeof tag === 'string' && tag.length > 0);
  } catch {
    return [];
  }
}

interface Parsed {
  tag: string;
  language: string;
  script: string;
  region: string;
}

/**
 * Language, likely script and likely region of a tag: `zh-CN` -> zh/Hans/CN,
 * `zh-TW` -> zh/Hant/TW, `pt` -> pt/Latn/BR. `Intl.Locale#maximize` supplies
 * the likely subtags and canonicalizes legacy codes (`iw` -> `he`).
 */
function parse(tag: string): Parsed | null {
  try {
    const max = new Intl.Locale(tag.replace(/_/g, '-')).maximize();
    return { tag, language: max.language, script: max.script ?? '', region: max.region ?? '' };
  } catch {
    const language = tag.split(/[-_]/)[0]?.toLowerCase() ?? '';
    return language ? { tag, language, script: '', region: '' } : null;
  }
}

/**
 * The best available locale for the OS's preferences, or `undefined` when the
 * app has none of them.
 *
 * Preferences are tried in the user's order, so someone who lists French then
 * Spanish gets Spanish when there is no French. For each one:
 *
 * 1. an exact tag (`pt-BR` -> `pt-BR`);
 * 2. same language, script and region (`fa` -> `fa-IR`, `he` -> `he-IL`);
 * 3. same language and script (`pt-PT` -> `pt-BR`, `zh-SG` -> `zh-Hans`).
 *
 * A different script never matches: `zh-TW` (Traditional) does not pick
 * `zh-Hans` (Simplified). Someone who reads one script may not read the other,
 * and the full list is one click away.
 *
 * Pseudo-locales (`xx-*`) are never offered: they are developer tools.
 */
export function matchSystemLocale(
  preferred: readonly string[],
  available: readonly string[],
): string | undefined {
  const candidates = available
    .filter((code) => !/^xx(-|$)/i.test(code))
    .map(parse)
    .filter((p): p is Parsed => p !== null);

  for (const want of preferred) {
    const exact = candidates.find((c) => c.tag.toLowerCase() === want.toLowerCase());
    if (exact) return exact.tag;

    const w = parse(want);
    if (!w) continue;
    const sameScript = candidates.filter(
      (c) => c.language === w.language && c.script === w.script,
    );
    const sameRegion = sameScript.find((c) => c.region === w.region);
    if (sameRegion) return sameRegion.tag;
    if (sameScript[0]) return sameScript[0].tag;
  }
  return undefined;
}
