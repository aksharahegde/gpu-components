/**
 * `GPUWhiteboard`'s data model (PLAN.md #14, "GPU whiteboard / infinite canvas").
 *
 * Forked from `registry/annotationcanvas`'s `Annotation` union, minus the bounded image field that
 * component draws annotations over — a whiteboard has no backing image, just a very large (not
 * literally infinite; float32 has a precision ceiling worth respecting, see `MAX_COORDINATE`) open
 * domain. Shape kinds, packing, and hit-testing are otherwise the same problem annotationcanvas
 * already solved, so phase 1 reuses that shape directly rather than re-deriving it.
 */

export type WhiteboardShapeKind = "rect" | "ellipse" | "point" | "ruler" | "polygon" | "freehand";

export interface Point2D {
  readonly x: number;
  readonly y: number;
}

export type WhiteboardShape =
  | {
      readonly id: string;
      readonly kind: "rect" | "ellipse";
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
      readonly color?: number;
    }
  | {
      readonly id: string;
      readonly kind: "point";
      readonly x: number;
      readonly y: number;
      readonly color?: number;
    }
  | {
      readonly id: string;
      readonly kind: "ruler";
      readonly x0: number;
      readonly y0: number;
      readonly x1: number;
      readonly y1: number;
      readonly color?: number;
    }
  | {
      readonly id: string;
      readonly kind: "polygon" | "freehand";
      readonly points: readonly Point2D[];
      readonly color?: number;
    };

/** Float32 loses meaningful sub-pixel precision well before this — a soft ceiling on how far a
 * shape may sit from the origin, not a hard device limit like `annotationcanvas`'s `MAX_FIELD_DIM`. */
export const MAX_COORDINATE = 100_000;

/** Soft cap mirroring `annotationcanvas`'s `RECOMMENDED_MAX_ANNOTATIONS` — CPU hit-testing and
 * per-change buffer rebuilds scale linearly with shape count. */
export const RECOMMENDED_MAX_SHAPES = 5_000;

export interface WhiteboardData {
  readonly shapes: readonly WhiteboardShape[];
  readonly bounds: {
    readonly xMin: number;
    readonly xMax: number;
    readonly yMin: number;
    readonly yMax: number;
  };
}

function coordOf(shape: WhiteboardShape): readonly number[] {
  switch (shape.kind) {
    case "rect":
    case "ellipse":
      return [shape.x, shape.y, shape.x + shape.w, shape.y + shape.h];
    case "point":
      return [shape.x, shape.y];
    case "ruler":
      return [shape.x0, shape.y0, shape.x1, shape.y1];
    case "polygon":
    case "freehand":
      return shape.points.flatMap((p) => [p.x, p.y]);
  }
}

/**
 * Validates shape coordinates against `MAX_COORDINATE` and computes a bounding box — the initial
 * viewport a host fits to, and the default pan/zoom clamp. An empty board gets a small default box
 * around the origin rather than an error: unlike `GPUNodeEditor`, a whiteboard's whole point is that
 * it starts empty and grows as the user draws.
 */
export function ingestWhiteboard(shapes: readonly WhiteboardShape[]): WhiteboardData {
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;

  for (const shape of shapes) {
    const coords = coordOf(shape);
    for (const c of coords) {
      if (!Number.isFinite(c) || Math.abs(c) > MAX_COORDINATE) {
        throw new RangeError(
          `gpu-components/whiteboard: shape ${shape.id} has a coordinate outside ±${MAX_COORDINATE}`,
        );
      }
    }
    if (coords.length < 2) continue;
    const [a, b, c, d] = boundsOfCoords(coords);
    xMin = Math.min(xMin, a);
    yMin = Math.min(yMin, b);
    xMax = Math.max(xMax, c);
    yMax = Math.max(yMax, d);
  }

  if (!(xMin < xMax)) {
    xMin = -10;
    xMax = 10;
  }
  if (!(yMin < yMax)) {
    yMin = -10;
    yMax = 10;
  }
  const padX = Math.max(1, (xMax - xMin) * 0.1);
  const padY = Math.max(1, (yMax - yMin) * 0.1);

  return { shapes, bounds: { xMin: xMin - padX, xMax: xMax + padX, yMin: yMin - padY, yMax: yMax + padY } };
}

function boundsOfCoords(coords: readonly number[]): readonly [number, number, number, number] {
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (let i = 0; i < coords.length; i += 2) {
    const x = coords[i]!;
    const y = coords[i + 1]!;
    xMin = Math.min(xMin, x);
    xMax = Math.max(xMax, x);
    yMin = Math.min(yMin, y);
    yMax = Math.max(yMax, y);
  }
  return [xMin, yMin, xMax, yMax];
}
