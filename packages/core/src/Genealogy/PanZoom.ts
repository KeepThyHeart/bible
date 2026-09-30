import type { LayoutBounds } from './types';

/**
 * 2D viewport: screen = world * k + (tx, ty). Pure and immutable-friendly:
 * methods mutate and return `this` so a store can copy with `clone()`.
 * The timeline's 1D scale is the same maths on one axis.
 */
export class PanZoom {
  constructor(public k = 1, public tx = 0, public ty = 0,
              public readonly minK = 0.05, public readonly maxK = 8) {}

  clone(): PanZoom { return new PanZoom(this.k, this.tx, this.ty, this.minK, this.maxK); }

  /** Multiply zoom by `factor`, keeping the world point under screen (px, py) fixed. */
  zoomAt(factor: number, px: number, py: number): this {
    const k = Math.min(this.maxK, Math.max(this.minK, this.k * factor));
    const f = k / this.k;
    this.tx = px - (px - this.tx) * f;
    this.ty = py - (py - this.ty) * f;
    this.k = k;
    return this;
  }

  pan(dx: number, dy: number): this { this.tx += dx; this.ty += dy; return this; }

  /** Fit `bounds` inside a w x h screen with `pad` px margin (never zooms in past 1.5x). */
  fit(bounds: LayoutBounds, w: number, h: number, pad = 24): this {
    const bw = Math.max(bounds.w, 1), bh = Math.max(bounds.h, 1);
    const k = Math.min(this.maxK, Math.max(this.minK, Math.min((w - 2 * pad) / bw, (h - 2 * pad) / bh, 1.5)));
    this.k = k;
    this.tx = (w - bw * k) / 2 - bounds.x * k;
    this.ty = (h - bh * k) / 2 - bounds.y * k;
    return this;
  }

  /** Centre the viewport on a world point. */
  centerOn(x: number, y: number, w: number, h: number): this {
    this.tx = w / 2 - x * this.k;
    this.ty = h / 2 - y * this.k;
    return this;
  }

  toScreen(x: number, y: number): { x: number; y: number } {
    return { x: x * this.k + this.tx, y: y * this.k + this.ty };
  }
  toWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - this.tx) / this.k, y: (sy - this.ty) / this.k };
  }
}
