import { describe, expect, it } from 'vitest';
import { ordinal } from './teams.js';

describe('ordinal', () => {
  it('gets the common single-digit cases right', () => {
    expect(ordinal(1)).toBe('1st');
    expect(ordinal(2)).toBe('2nd');
    expect(ordinal(3)).toBe('3rd');
    expect(ordinal(4)).toBe('4th');
    expect(ordinal(9)).toBe('9th');
  });

  it('uses "th" for the 11-13 exception, not the last-digit rule', () => {
    expect(ordinal(11)).toBe('11th');
    expect(ordinal(12)).toBe('12th');
    expect(ordinal(13)).toBe('13th');
  });

  it('resumes st/nd/rd once past the teens', () => {
    expect(ordinal(21)).toBe('21st');
    expect(ordinal(22)).toBe('22nd');
    expect(ordinal(23)).toBe('23rd');
    expect(ordinal(24)).toBe('24th');
  });

  it('re-applies the 11-13 exception at each new hundred', () => {
    expect(ordinal(101)).toBe('101st');
    expect(ordinal(111)).toBe('111th');
    expect(ordinal(112)).toBe('112th');
    expect(ordinal(113)).toBe('113th');
    expect(ordinal(121)).toBe('121st');
  });
});
