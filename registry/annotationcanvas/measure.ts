/** Euclidean length of a segment in image space. */
export function lengthOf(x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  return Math.hypot(dx, dy);
}

/** Area of an axis-aligned rectangle with the given width and height. */
export function areaRect(w: number, h: number): number {
  return w * h;
}

/** Area of an axis-aligned ellipse inscribed in a w×h bounding box. */
export function areaEllipse(w: number, h: number): number {
  return Math.PI * (w / 2) * (h / 2);
}

export interface Point2D {
  readonly x: number;
  readonly y: number;
}

/** Shoelace formula — absolute signed area of a simple polygon. */
export function areaPolygon(points: readonly Point2D[]): number {
  let sum = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % n]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}
