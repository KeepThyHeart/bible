import { PanZoom } from '@bible/core/browser';
import { labelVisible, nearestInDirection, offsetPoints, pathData } from './geometry';
import { layout } from './testFixtures';

describe('geometry', () => {
  it('label visibility follows importance and zoom', () => {
    expect(labelVisible(0, 0.05)).toBe(true);
    expect(labelVisible(1, 0.49)).toBe(false);
    expect(labelVisible(1, 0.5)).toBe(true);
    expect(labelVisible(2, 0.89)).toBe(false);
    expect(labelVisible(2, 0.9)).toBe(true);
  });

  it('nearest node in a direction uses layout coordinates', () => {
    expect(nearestInDirection(layout.nodes, 'abraham', 'down')?.id).toBe('isaac');
    expect(nearestInDirection(layout.nodes, 'isaac', 'right')?.id).toBe('heli');
    expect(nearestInDirection(layout.nodes, 'abraham', 'up')).toBeUndefined();
    expect(nearestInDirection(layout.nodes, 'heli', 'left')?.id).toBe('isaac');
  });

  it('builds paths and offsets double edges symmetrically', () => {
    expect(pathData([{ x: 0, y: 0 }, { x: 10, y: 5 }])).toBe('M0 0 L10 5');
    const [a] = offsetPoints([{ x: 0, y: 0 }, { x: 10, y: 0 }], 2);
    expect(a).toEqual({ x: 0, y: 2 });
  });

  it('PanZoom zoomAt keeps the pointer world point fixed', () => {
    const p = new PanZoom(1, 10, 20);
    const before = p.toWorld(100, 80);
    p.zoomAt(2, 100, 80);
    const after = p.toWorld(100, 80);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(p.k).toBe(2);
  });
});
