import type { FieldData } from "./ingest.ts";
import type { Point2D } from "./measure.ts";

export type AnnotationKind = "rect" | "ellipse" | "point" | "ruler" | "polygon" | "freehand";

export type Annotation =
  | {
      readonly id: string;
      readonly kind: "rect" | "ellipse";
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
      readonly label?: string;
      readonly color?: number;
    }
  | {
      readonly id: string;
      readonly kind: "point";
      readonly x: number;
      readonly y: number;
      readonly label?: string;
      readonly color?: number;
    }
  | {
      readonly id: string;
      readonly kind: "ruler";
      readonly x0: number;
      readonly y0: number;
      readonly x1: number;
      readonly y1: number;
      readonly label?: string;
      readonly color?: number;
    }
  | {
      readonly id: string;
      readonly kind: "polygon" | "freehand";
      readonly points: readonly Point2D[];
      readonly label?: string;
      readonly color?: number;
    };

export interface Scene {
  setAnnotations(annotations: readonly Annotation[]): void;
  hitTest(imageX: number, imageY: number): string | null;
}

/** Axis-aligned rectangle hit — inclusive bounds in image space. */
export function pointInRect(
  px: number,
  py: number,
  x: number,
  y: number,
  w: number,
  h: number,
): boolean {
  return px >= x && px <= x + w && py >= y && py <= y + h;
}

/** Ellipse inscribed in the axis-aligned bounding box. */
export function pointInEllipse(
  px: number,
  py: number,
  x: number,
  y: number,
  w: number,
  h: number,
): boolean {
  const rx = w / 2;
  const ry = h / 2;
  if (rx <= 0 || ry <= 0) return false;
  const dx = (px - (x + rx)) / rx;
  const dy = (py - (y + ry)) / ry;
  return dx * dx + dy * dy <= 1;
}

/** Shortest distance from `(px, py)` to the closed segment `(x0,y0)–(x1,y1)`. */
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

function lineTolerance(fieldWidth: number, fieldHeight: number): number {
  return Math.max(3, Math.min(fieldWidth, fieldHeight) * 0.01);
}

function hitAnnotation(
  annotation: Annotation,
  px: number,
  py: number,
  tolerance: number,
): boolean {
  switch (annotation.kind) {
    case "rect":
      return pointInRect(px, py, annotation.x, annotation.y, annotation.w, annotation.h);
    case "ellipse":
      return pointInEllipse(px, py, annotation.x, annotation.y, annotation.w, annotation.h);
    case "point":
      return Math.hypot(px - annotation.x, py - annotation.y) <= tolerance;
    case "ruler":
      return (
        distanceToSegment(px, py, annotation.x0, annotation.y0, annotation.x1, annotation.y1) <=
        tolerance
      );
    case "polygon": {
      if (pointInPolygon(px, py, annotation.points)) return true;
      const n = annotation.points.length;
      for (let i = 0; i < n; i++) {
        const a = annotation.points[i]!;
        const b = annotation.points[(i + 1) % n]!;
        if (distanceToSegment(px, py, a.x, a.y, b.x, b.y) <= tolerance) return true;
      }
      return false;
    }
    case "freehand": {
      const pts = annotation.points;
      if (pts.length === 0) return false;
      if (pts.length === 1) {
        return Math.hypot(px - pts[0]!.x, py - pts[0]!.y) <= tolerance;
      }
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]!;
        const b = pts[i]!;
        if (distanceToSegment(px, py, a.x, a.y, b.x, b.y) <= tolerance) return true;
      }
      return false;
    }
  }
}

export function createScene(
  field: FieldData,
  annotations: readonly Annotation[] = [],
): Scene {
  const fieldWidth = field.width;
  const fieldHeight = field.height;
  const tolerance = lineTolerance(fieldWidth, fieldHeight);
  let items = annotations.slice();

  return {
    setAnnotations(next) {
      items = next.slice();
    },
    hitTest(imageX, imageY) {
      for (let i = items.length - 1; i >= 0; i--) {
        const annotation = items[i]!;
        if (hitAnnotation(annotation, imageX, imageY, tolerance)) return annotation.id;
      }
      return null;
    },
  };
}
