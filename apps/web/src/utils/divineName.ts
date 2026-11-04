/**
 * Verse HTML reduced to plain text that keeps only the divine-name spans, so a
 * compact verse list can show LORD (YHWH) in small caps and tell it from Lord
 * (Adonai) as the reader does (B-167). Entities are left as they came.
 */
export function plainTextKeepingDivineName(html: string): string {
  const stack: boolean[] = []; // per open <span>: kept?
  const out = (html ?? '').replace(/<(\/?)(\w+)([^>]*)>/g, (_all, close: string, tag: string, attrs: string) => {
    if (tag.toLowerCase() !== 'span') return '';
    if (close) return stack.pop() ? '</span>' : '';
    const keep = /class\s*=\s*"[^"]*\bdivine-name\b/.test(attrs);
    stack.push(keep);
    return keep ? '<span class="divine-name">' : '';
  });
  return out.replace(/\s+/g, ' ').trim();
}
