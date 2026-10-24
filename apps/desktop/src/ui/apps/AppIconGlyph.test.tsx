import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { AppIconGlyph, hasBuiltinGlyph } from './AppIconGlyph';
import { memoryAppDescriptor } from '@bible/memory/manifest';

describe('app icons (task 0197)', () => {
  it('has a checklist glyph for Quiz and a stacked-cards glyph for Memory', () => {
    expect(hasBuiltinGlyph('list-check')).toBe(true);
    expect(hasBuiltinGlyph('clone')).toBe(true);
    const { container } = render(<AppIconGlyph icon={{ kind: 'builtin', name: 'list-check' }} />);
    expect(container.querySelector('svg[data-icon="list-check"]')).toBeTruthy();
  });

  it('the Memory app uses the stacked-cards glyph, not the fallback tile', () => {
    expect(memoryAppDescriptor.icon).toEqual({ kind: 'builtin', name: 'clone' });
  });
});
