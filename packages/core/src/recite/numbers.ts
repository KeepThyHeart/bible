/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Digits to spoken English words. Pure, QuickJS-safe.
 */

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function below1000(n: number, out: string[]): void {
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (h > 0) {
    out.push(ONES[h], 'hundred');
  }
  if (r === 0) return;
  if (r < 20) {
    out.push(ONES[r]);
    return;
  }
  out.push(TENS[Math.floor(r / 10)]);
  if (r % 10 > 0) out.push(ONES[r % 10]);
}

/** 0..999,999,999 as word tokens ("21" -> ["twenty","one"]). Anything else is read digit by digit. */
export function numberToWords(n: number): string[] {
  if (!isFinite(n) || n < 0 || n > 999999999 || Math.floor(n) !== n) {
    const digits = String(Math.abs(Math.trunc(n))).replace(/[^0-9]/g, '');
    return digits.split('').map((d) => ONES[Number(d)]);
  }
  if (n === 0) return ['zero'];
  const out: string[] = [];
  const millions = Math.floor(n / 1000000);
  const thousands = Math.floor((n % 1000000) / 1000);
  const rest = n % 1000;
  if (millions > 0) {
    below1000(millions, out);
    out.push('million');
  }
  if (thousands > 0) {
    below1000(thousands, out);
    out.push('thousand');
  }
  if (rest > 0) below1000(rest, out);
  return out;
}

const ORDINAL_IRREGULAR: Record<string, string> = {
  one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth',
};

/** 1 -> ["first"], 21 -> ["twenty","first"], 100 -> ["one","hundredth"]. */
export function ordinalToWords(n: number): string[] {
  const words = numberToWords(n);
  const last = words[words.length - 1];
  let ord: string;
  if (ORDINAL_IRREGULAR[last]) ord = ORDINAL_IRREGULAR[last];
  else if (last.charAt(last.length - 1) === 'y') ord = last.slice(0, -1) + 'ieth';
  else ord = last + 'th';
  words[words.length - 1] = ord;
  return words;
}

/**
 * Tokens for a written number ("12", "1,000", "1st", "22nd"), or null when the
 * text is not a plain or ordinal number.
 */
export function numberTokens(text: string): string[] | null {
  const m = /^(\d{1,3}(?:,\d{3})+|\d+)(st|nd|rd|th)?$/.exec(text.toLowerCase());
  if (!m) return null;
  const n = parseInt(m[1].replace(/,/g, ''), 10);
  return m[2] ? ordinalToWords(n) : numberToWords(n);
}
