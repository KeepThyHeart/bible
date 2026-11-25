/**
 * Is a font family installed on this machine?
 *
 * `document.fonts.check()` is unreliable for local fonts (it answers true for families it knows nothing
 * about), so this measures instead: a probe string is drawn in `"<family>", <generic>` and in the bare
 * generic. If the width differs from the generic's, the family exists. Two different generics are tried,
 * because a family that happens to be metrically identical to one of them (Liberation Sans against
 * Arial/sans-serif) would otherwise read as missing.
 *
 * Where there is no canvas (SSR, a bare test environment) every family counts as installed: showing a
 * font the reader lacks is a smaller failure than hiding one they have.
 */

const PROBE = 'mmmmmmmmmmlliWQ0123456789 Aáé';
const SIZE = '72px';
const GENERICS = ['monospace', 'serif', 'sans-serif'] as const;

let ctx: CanvasRenderingContext2D | null | undefined;
const cache = new Map<string, boolean>();

function context(): CanvasRenderingContext2D | null {
  if (ctx !== undefined) return ctx;
  try {
    ctx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  } catch {
    ctx = null;
  }
  return ctx;
}

function width(c: CanvasRenderingContext2D, fontFamily: string): number {
  c.font = `${SIZE} ${fontFamily}`;
  return c.measureText(PROBE).width;
}

export function isFontInstalled(family: string): boolean {
  const hit = cache.get(family);
  if (hit !== undefined) return hit;
  const c = context();
  // jsdom returns a context-less canvas (or null); an all-zero measurement means "cannot tell".
  if (!c || width(c, 'monospace') === 0) return true;
  const quoted = `"${family.replace(/"/g, '')}"`;
  const installed = GENERICS.some((generic) => width(c, `${quoted}, ${generic}`) !== width(c, generic));
  cache.set(family, installed);
  return installed;
}

/** Forget measurements (a font was just installed, or a test needs a clean slate). */
export function resetFontAvailabilityCache(): void {
  cache.clear();
  ctx = undefined;
}
