/** Splits text at sentence boundaries so each chunk stays short (Chrome cuts utterances at ~15 s). */
export function splitSentences(text: string, maxLen = 200): string[] {
  const parts = text.replace(/\s+/g, ' ').trim().match(/[^.!?;:]+[.!?;:]*\s*/g) ?? [];
  const out: string[] = [];
  let cur = '';
  for (const p of parts) {
    if (cur && cur.length + p.length > maxLen) {
      out.push(cur.trim());
      cur = '';
    }
    cur += p;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
