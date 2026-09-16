import { describe, expect, it } from 'vitest';
import { effectiveDisplay, parseStoredOverride } from '../viewerChrome';

describe('parseStoredOverride', () => {
  it('reads back nothing when nothing was stored', () => {
    expect(parseStoredOverride(null)).toEqual({});
  });

  it('reads back a valid theme and font step', () => {
    expect(parseStoredOverride('{"theme":"max","fontStep":8}')).toEqual({ theme: 'max', fontStep: 8 });
  });

  it('drops an unreadable value rather than throwing', () => {
    expect(parseStoredOverride('not json')).toEqual({});
    expect(parseStoredOverride('null')).toEqual({});
  });

  it('drops a theme this build does not know, keeping a valid font step', () => {
    expect(parseStoredOverride('{"theme":"purple","fontStep":6}')).toEqual({ fontStep: 6 });
  });

  it('drops a font step outside the scale', () => {
    expect(parseStoredOverride('{"fontStep":0}')).toEqual({});
    expect(parseStoredOverride('{"fontStep":11}')).toEqual({});
  });
});

describe('effectiveDisplay', () => {
  const presenter = { theme: 'dark', fontStep: 5 } as const;

  it('follows the presenter when this screen has no override', () => {
    expect(effectiveDisplay(presenter, {})).toEqual({ theme: 'dark', fontStep: 5 });
  });

  it('overrides only the field this screen has chosen', () => {
    expect(effectiveDisplay(presenter, { theme: 'max' })).toEqual({ theme: 'max', fontStep: 5 });
    expect(effectiveDisplay(presenter, { fontStep: 8 })).toEqual({ theme: 'dark', fontStep: 8 });
  });

  it('overrides both when this screen has chosen both', () => {
    expect(effectiveDisplay(presenter, { theme: 'light', fontStep: 2 })).toEqual({ theme: 'light', fontStep: 2 });
  });

  it('follows the presenter to a new value once the override is cleared', () => {
    expect(effectiveDisplay({ theme: 'max', fontStep: 9 }, {})).toEqual({ theme: 'max', fontStep: 9 });
  });
});
