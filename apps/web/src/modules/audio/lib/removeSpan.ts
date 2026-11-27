/** The input with the span [start, end) taken out, along with one neighbouring separator; the rest is untouched. */
export function removeSpan(input: string, start: number, end: number): string {
  let before = input.slice(0, start);
  let after = input.slice(end);
  const lead = after.match(/^\s*[;,]\s*/);
  if (lead) after = after.slice(lead[0].length);
  else before = before.replace(/\s*[;,]\s*$/, '');
  return before + after;
}
