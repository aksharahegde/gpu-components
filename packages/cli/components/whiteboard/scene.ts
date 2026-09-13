/**
 * `GPUWhiteboard`'s retained hit-test scene — the exact geometry `registry/annotationcanvas`'s
 * `scene.ts` already proved for the same shape kinds. Kept separate from `ingest.ts` because it is
 * mutable, retained state (rebuilt via `setShapes`), not a one-time validation step.
 */
import type { Point2D, WhiteboardShape } from "./ingest.ts";

export interface Scene {
  setShapes(shapes: readonly WhiteboardShape[]): void;
  hitTest(x: number, y: number): string | null;
}

/** Axis-aligned rectangle hit — inclusive bounds. */
export function pointInRect(px: number, py: number, x: number, y: number, w: number, h: number): boolean {
  return px >= x && px <= x + w && py >= y && py <= y + h;
}

/** Ellipse inscribed in the axis-aligned bounding box. */
export function pointInEllipse(px: number, py: number, x: number, y: number, w: number, h: number): boolean {
  const rx = w / 2;
  const ry = h / 2;
  if (rx <= 0 || ry <= 0) return false;
  const dx = (px - (x + rx)) / rx;
  const dy = (py - (y + ry)) / ry;
  return dx * dx + dy * dy <= 1;
}

/** Shortest distance from `(px, py)` to the closed segment `(x0,y0)-(x1,y1)`. */
export function distanceToSegment(
  px: number,
  py: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x0, py - y0);
  const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / lenSq));
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
}

/** Ray-casting point-in-polygon for a simple closed polygon. */
export function pointInPolygon(px: number, py: number, points: readonly Point2D[]): boolean {
  const n = points.length;
  if (n < 3) return false;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = points[i]!.x;
    const yi = points[i]!.y;
    const xj = points[j]!.x;
    const yj = points[j]!.y;
    const intersects = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Hit tolerance in domain units — a fixed value rather than a fraction of the board (unlike
 * annotationcanvas's field-relative tolerance, a whiteboard has no fixed extent to take a fraction
 * of). `GPUWhiteboard.tsx` converts this from a pixel radius at the current zoom instead. */
export const DEFAULT_HIT_TOLERANCE = 0.15;

function hitShape(shape: WhiteboardShape, px: number, py: number, tolerance: number): boolean {
  switch (shape.kind) {
    case "rect":
      return pointInRect(px, py, shape.x, shape.y, shape.w, shape.h);
    case "ellipse":
      return pointInEllipse(px, py, shape.x, shape.y, shape.w, shape.h);
    case "point":
      return Math.hypot(px - shape.x, py - shape.y) <= tolerance;
    case "ruler":
      return distanceToSegment(px, py, shape.x0, shape.y0, shape.x1, shape.y1) <= tolerance;
    case "polygon": {
      if (pointInPolygon(px, py, shape.points)) return true;
      const n = shape.points.length;
      for (let i = 0; i < n; i++) {
        const a = shape.points[i]!;
        const b = shape.points[(i + 1) % n]!;
        if (distanceToSegment(px, py, a.x, a.y, b.x, b.y) <= tolerance) return true;
      }
      return false;
    }
    case "freehand": {
      const pts = shape.points;
      if (pts.length === 0) return false;
      if (pts.length === 1) return Math.hypot(px - pts[0]!.x, py - pts[0]!.y) <= tolerance;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]!;
        const b = pts[i]!;
        if (distanceToSegment(px, py, a.x, a.y, b.x, b.y) <= tolerance) return true;
      }
      return false;
    }
  }
}

export interface Bounds {
  readonly xMin: number;
  readonly yMin: number;
  readonly xMax: number;
  readonly yMax: number;
}

/** Axis-aligned bounding box of one shape — the marquee-select test in `GPUWhiteboard.tsx` (a
 * shape is selected when its bbox intersects the drag rectangle, the standard marquee convention),
 * reusing the same coordinate accessors `hitShape` already switches on. */
export function shapeBounds(shape: WhiteboardShape): Bounds {
  switch (shape.kind) {
    case "rect":
    case "ellipse":
      return { xMin: shape.x, yMin: shape.y, xMax: shape.x + shape.w, yMax: shape.y + shape.h };
    case "point":
      return { xMin: shape.x, yMin: shape.y, xMax: shape.x, yMax: shape.y };
    case "ruler":
      return {
        xMin: Math.min(shape.x0, shape.x1),
        yMin: Math.min(shape.y0, shape.y1),
        xMax: Math.max(shape.x0, shape.x1),
        yMax: Math.max(shape.y0, shape.y1),
      };
    case "polygon":
    case "freehand": {
      let xMin = Infinity;
      let yMin = Infinity;
      let xMax = -Infinity;
      let yMax = -Infinity;
      for (const p of shape.points) {
        xMin = Math.min(xMin, p.x);
        yMin = Math.min(yMin, p.y);
        xMax = Math.max(xMax, p.x);
        yMax = Math.max(yMax, p.y);
      }
      if (!(xMin <= xMax)) return { xMin: 0, yMin: 0, xMax: 0, yMax: 0 };
      return { xMin, yMin, xMax, yMax };
    }
  }
}

/** Whether two axis-aligned boxes overlap (touching edges count, matching `pointInRect`'s inclusive
 * bounds elsewhere in this file). */
export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return a.xMin <= b.xMax && a.xMax >= b.xMin && a.yMin <= b.yMax && a.yMax >= b.yMin;
}

export function createScene(shapes: readonly WhiteboardShape[] = [], tolerance = DEFAULT_HIT_TOLERANCE): Scene {
  let items = shapes.slice();
  return {
    setShapes(next) {
      items = next.slice();
    },
    hitTest(x, y) {
      for (let i = items.length - 1; i >= 0; i--) {
        const shape = items[i]!;
        if (hitShape(shape, x, y, tolerance)) return shape.id;
      }
      return null;
    },
  };
}
