import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// B-107: native radios/checkboxes without a size class stayed at the browser's
// 13px at large UI scale. A zero-specificity rule sizes them in rem (which
// follows --ui-scale) and still loses to any explicit size class.
describe('native radio and checkbox size follows the UI scale', () => {
  const css = readFileSync(join(__dirname, 'globals.css'), 'utf8');
  it('has a :where() rule sizing them in rem', () => {
    expect(css).toMatch(/:where\(input\[type=['"]radio['"]\],\s*input\[type=['"]checkbox['"]\]\)\s*\{[^}]*width:\s*1rem[^}]*height:\s*1rem/s);
  });
});
