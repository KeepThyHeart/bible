import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { clampZoomLevel, readZoomLevel, writeZoomLevel, MAX_ZOOM_LEVEL, MIN_ZOOM_LEVEL } from './zoomState';

describe('zoomState (B-106)', () => {
  it('clamps to a usable range and survives garbage', () => {
    expect(clampZoomLevel(40)).toBe(MAX_ZOOM_LEVEL);
    expect(clampZoomLevel(-40)).toBe(MIN_ZOOM_LEVEL);
    expect(clampZoomLevel(NaN)).toBe(0);
  });
  it('round-trips through a file and defaults to 0', () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'zoom-')), 'zoom.json');
    expect(readZoomLevel(f)).toBe(0);
    writeZoomLevel(f, 2.5);
    expect(readZoomLevel(f)).toBe(2.5);
    fs.writeFileSync(f, 'not json');
    expect(readZoomLevel(f)).toBe(0);
  });
});
