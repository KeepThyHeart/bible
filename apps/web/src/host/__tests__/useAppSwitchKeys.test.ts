import { describe, it, expect } from 'vitest';
import { appForSwitchKey } from '../useAppSwitchKeys';

const base = { ctrlKey: true, shiftKey: true, altKey: false, metaKey: false, defaultPrevented: false };
const ids = ['study', 'present', 'other'];

describe('appForSwitchKey', () => {
  it('maps Ctrl+Shift+digit by code to the nth app', () => {
    expect(appForSwitchKey({ ...base, code: 'Digit1' }, ids)).toBe('study');
    expect(appForSwitchKey({ ...base, code: 'Digit2' }, ids)).toBe('present');
    expect(appForSwitchKey({ ...base, code: 'Digit9' }, ids)).toBeNull();
  });
  it('Digit0 is Study', () => {
    expect(appForSwitchKey({ ...base, code: 'Digit0' }, ids)).toBe('study');
  });
  it('requires exactly Ctrl+Shift and ignores handled events', () => {
    expect(appForSwitchKey({ ...base, shiftKey: false, code: 'Digit2' }, ids)).toBeNull();
    expect(appForSwitchKey({ ...base, altKey: true, code: 'Digit2' }, ids)).toBeNull();
    expect(appForSwitchKey({ ...base, metaKey: true, code: 'Digit2' }, ids)).toBeNull();
    expect(appForSwitchKey({ ...base, defaultPrevented: true, code: 'Digit2' }, ids)).toBeNull();
    expect(appForSwitchKey({ ...base, code: 'KeyA' }, ids)).toBeNull();
  });
});
