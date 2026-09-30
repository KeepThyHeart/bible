import { describe, expect, it } from 'vitest';
import {
  controlFractionFromDrag, fit16x9, layoutForWidth, notesFractionFor, notesFractionFromDrag, parsePrefs, rightRows,
} from './layoutPrefs';

describe('layoutPrefs', () => {
  it('picks a layout by page width', () => {
    expect(layoutForWidth(759)).toBe('phone');
    expect(layoutForWidth(760)).toBe('narrow');
    expect(layoutForWidth(1099)).toBe('narrow');
    expect(layoutForWidth(1100)).toBe('full');
  });

  it('defaults the notes column to 50%, or 42% when narrow, and honours a remembered value', () => {
    const none = { notesFraction: null, controlFraction: null };
    expect(notesFractionFor(1400, none)).toBe(0.5);
    expect(notesFractionFor(900, none)).toBe(0.42);
    expect(notesFractionFor(900, { ...none, notesFraction: 0.6 })).toBe(0.6);
  });

  it('parses stored prefs defensively', () => {
    expect(parsePrefs(null)).toEqual({ notesFraction: null, controlFraction: null });
    expect(parsePrefs('not json')).toEqual({ notesFraction: null, controlFraction: null });
    expect(parsePrefs('{"notesFraction":0.9,"controlFraction":"x"}')).toEqual({ notesFraction: 0.75, controlFraction: null });
  });

  it('clamps dragged positions', () => {
    expect(notesFractionFromDrag(0, 1000)).toBe(0.25);
    expect(notesFractionFromDrag(500, 1000)).toBe(0.5);
    expect(controlFractionFromDrag(5000, 800)).toBe(0.9);
  });

  it('sizes the preview to 16:9 at column width by default, Control taking the rest', () => {
    const rows = rightRows(640, 900, null);
    expect(rows.previewHeight).toBeCloseTo(360);
    expect(rows.controlHeight).toBeCloseTo(540);
  });

  it('keeps Control usable when the column is short', () => {
    const rows = rightRows(1000, 400, null);
    expect(rows.controlHeight).toBeGreaterThanOrEqual(140);
    expect(rows.controlHeight + rows.previewHeight).toBeCloseTo(400);
  });

  it('applies a remembered control fraction', () => {
    const rows = rightRows(640, 800, 0.25);
    expect(rows.controlHeight).toBeCloseTo(200);
  });

  it('fits a 16:9 box inside a slot', () => {
    expect(fit16x9(640, 1000)).toEqual({ width: 640, height: 360 });
    expect(fit16x9(1000, 180).width).toBeCloseTo(320);
  });
});
