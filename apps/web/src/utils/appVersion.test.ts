import { describe, it, expect } from 'vitest';
import { formatVersionLine } from './appVersion';

describe('formatVersionLine', () => {
  it('fills version and build into the template', () => {
    expect(formatVersionLine('Version {version} (build {build})', '1.0.0-rc.1', '3d743be5'))
      .toBe('Version 1.0.0-rc.1 (build 3d743be5)');
  });
  it('keeps a translated template order', () => {
    expect(formatVersionLine('({build}) {version}', '1.0.0', 'abc')).toBe('(abc) 1.0.0');
  });
});
