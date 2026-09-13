/**
 * `GPUWhiteboard`'s draw tools — pure pointer-lifecycle state machines that turn domain-space
 * pointer events into draft (in-progress preview) or finished `WhiteboardShape` objects. No GPU,
 * no DOM: `GPUWhiteboard.tsx` converts screen pixels to domain space (`pixelXToTime`/`pixelYToTrack`)
 * and feeds the results here, then emits the finished shape via `onCreate`.
 *
 * Forked verbatim from `registry/annotationcanvas`'s `tools.ts` — same six shape kinds, same
 * lifecycle. The only difference is the "pan"/"select" tool cases: those live entirely in
 * `GPUWhiteboard.tsx` (select/move/marquee, reusing `GPUNodeEditor`'s pattern instead of
 * `GPUAnnotationCanvas`'s), so this module only ever runs for the six draw tools.
 */
import type { Point2D, WhiteboardShape } from "./ingest.ts";

export type ToolName = "rect" | "ellipse" | "point" | "ruler" | "polygon" | "freehand";

export interface DomainPoint {
  readonly x: number;
  readonly y: number;
}

/** Vertex cap for polygon/freehand shapes — mirrors annotationcanvas's device-friendly budget. */
export const MAX_POLYGON_POINTS = 256;

/** Id used for in-progress drafts, which are rendered but never emitted through `onCreate`. */
export const DRAFT_SHAPE_ID = "__whiteboard-draft__";

/** A drag shorter than this, in domain units, is a click rather than a shape — rect/ellipse/ruler
 * do not create a degenerate zero-size shape from a plain click. */
const MIN_DRAG = 1e-6;

let idCounter = 0;

/** New shape id: `crypto.randomUUID` where available (browsers, Node ≥ 19), a monotonic
 * `shape-${n}` fallback otherwise. */
export function createShapeId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (typeof g.crypto?.randomUUID === "function") return g.crypto.randomUUID();
  return `shape-${idCounter++}`;
}

/** Normalizes a drag rectangle so `w`/`h` are always non-negative, regardless of drag direction. */
export function rectFromDrag(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): { readonly x: number; readonly y: number; readonly w: number; readonly h: number } {
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
}

function movedEnough(x0: number, y0: number, x1: number, y1: number): boolean {
  return Math.abs(x1 - x0) > MIN_DRAG || Math.abs(y1 - y0) > MIN_DRAG;
}

/** Appends a freehand sample in place, skipping an exact repeat of the last point (a stationary
 * pointer-up after the last move). */
function appendFreehandSample(points: Point2D[], p: DomainPoint): void {
  const last = points[points.length - 1];
  if (last && last.x === p.x && last.y === p.y) return;
  points.push({ x: p.x, y: p.y });
}

/** Uniformly downsamples `points` to at most `cap` entries, always keeping the first and last. */
export function simplifyPoints(points: readonly Point2D[], cap: number): Point2D[] {
  if (points.length <= cap) return points.slice();
  if (cap <= 1) return points.length > 0 ? [points[0]!] : [];
  const step = (points.length - 1) / (cap - 1);
  const result: Point2D[] = [];
  for (let i = 0; i < cap; i++) {
    result.push(points[Math.round(i * step)]!);
  }
  return result;
}

/** Translates any shape kind by `(dx, dy)` in domain space — the select tool's move update. A pure
 * function: `GPUWhiteboard.tsx` owns capturing the pre-drag shape and re-applying this against the
 * accumulated drag delta on every pointer move, so repeated calls never compound rounding. */
export function moveShape(shape: WhiteboardShape, dx: number, dy: number): WhiteboardShape {
  switch (shape.kind) {
    case "rect":
    case "ellipse":
      return { ...shape, x: shape.x + dx, y: shape.y + dy };
    case "point":
      return { ...shape, x: shape.x + dx, y: shape.y + dy };
    case "ruler":
      return {
        ...shape,
        x0: shape.x0 + dx,
        y0: shape.y0 + dy,
        x1: shape.x1 + dx,
        y1: shape.y1 + dy,
      };
    case "polygon":
    case "freehand":
      return { ...shape, points: shape.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
  }
}

export interface ToolController {
  readonly tool: ToolName;
  /** In-progress preview, if any — the wrapper renders this alongside `shapes` while a drag or a
   * polygon/freehand session is active. */
  readonly draft: WhiteboardShape | null;
  onPointerDown(p: DomainPoint): void;
  onPointerMove(p: DomainPoint): void;
  /** Finalizes a drag gesture. Returns a new `WhiteboardShape` (via `onCreate`), or `null` if the
   * gesture produced nothing (a plain click on a drag-shape tool, or a polygon/freehand still
   * collecting points/samples). */
  onPointerUp(p: DomainPoint): WhiteboardShape | null;
  /** Closes a polygon early (double-click or Enter). No-op, returning `null`, for every other tool. */
  finish(): WhiteboardShape | null;
  /** Discards any in-progress draft (Escape, or switching tools mid-gesture). */
  cancel(): void;
}

type DragKind = "rect" | "ellipse" | "ruler";

function draftForDrag(kind: DragKind, start: DomainPoint, current: DomainPoint): WhiteboardShape {
  if (kind === "ruler") {
    return { id: DRAFT_SHAPE_ID, kind: "ruler", x0: start.x, y0: start.y, x1: current.x, y1: current.y };
  }
  const { x, y, w, h } = rectFromDrag(start.x, start.y, current.x, current.y);
  return { id: DRAFT_SHAPE_ID, kind, x, y, w, h };
}

function finishDrag(kind: DragKind, start: DomainPoint, end: DomainPoint): WhiteboardShape | null {
  if (!movedEnough(start.x, start.y, end.x, end.y)) return null;
  if (kind === "ruler") {
    return { id: createShapeId(), kind: "ruler", x0: start.x, y0: start.y, x1: end.x, y1: end.y };
  }
  const { x, y, w, h } = rectFromDrag(start.x, start.y, end.x, end.y);
  return { id: createShapeId(), kind, x, y, w, h };
}

/** Builds the pointer-lifecycle controller for one active draw tool. Recreate on tool change: each
 * instance carries its own in-progress drag/polygon/freehand state. */
export function createToolController(tool: ToolName): ToolController {
  let down: DomainPoint | null = null;
  let draft: WhiteboardShape | null = null;
  let polygonPoints: Point2D[] = [];

  function cancel(): void {
    down = null;
    draft = null;
    polygonPoints = [];
  }

  function onPointerDown(p: DomainPoint): void {
    switch (tool) {
      case "rect":
      case "ellipse":
      case "ruler":
        down = p;
        draft = draftForDrag(tool, p, p);
        break;
      case "freehand":
        down = p;
        polygonPoints = [{ x: p.x, y: p.y }];
        draft = { id: DRAFT_SHAPE_ID, kind: "freehand", points: polygonPoints.slice() };
        break;
      case "point":
        down = p;
        break;
      case "polygon":
        break;
    }
  }

  function onPointerMove(p: DomainPoint): void {
    switch (tool) {
      case "rect":
      case "ellipse":
      case "ruler":
        if (!down) return;
        draft = draftForDrag(tool, down, p);
        break;
      case "polygon":
        if (polygonPoints.length === 0) return;
        draft = { id: DRAFT_SHAPE_ID, kind: "polygon", points: [...polygonPoints, { x: p.x, y: p.y }] };
        break;
      case "freehand":
        if (!down) return;
        appendFreehandSample(polygonPoints, p);
        draft = { id: DRAFT_SHAPE_ID, kind: "freehand", points: polygonPoints.slice() };
        break;
      case "point":
        break;
    }
  }

  function onPointerUp(p: DomainPoint): WhiteboardShape | null {
    switch (tool) {
      case "rect":
      case "ellipse":
      case "ruler": {
        const start = down;
        cancel();
        if (!start) return null;
        return finishDrag(tool, start, p);
      }
      case "point": {
        const start = down;
        cancel();
        if (!start) return null;
        return { id: createShapeId(), kind: "point", x: p.x, y: p.y };
      }
      case "polygon": {
        if (polygonPoints.length < MAX_POLYGON_POINTS) polygonPoints = [...polygonPoints, { x: p.x, y: p.y }];
        draft = { id: DRAFT_SHAPE_ID, kind: "polygon", points: polygonPoints.slice() };
        return null; // a polygon closes via finish(), not a single pointer-up
      }
      case "freehand": {
        appendFreehandSample(polygonPoints, p);
        const points = simplifyPoints(polygonPoints, MAX_POLYGON_POINTS);
        cancel();
        if (points.length < 2) return null;
        return { id: createShapeId(), kind: "freehand", points };
      }
    }
  }

  function finish(): WhiteboardShape | null {
    if (tool !== "polygon") return null;
    if (polygonPoints.length < 3) {
      cancel();
      return null;
    }
    const points = simplifyPoints(polygonPoints, MAX_POLYGON_POINTS);
    const result: WhiteboardShape = { id: createShapeId(), kind: "polygon", points };
    cancel();
    return result;
  }

  return {
    tool,
    get draft() {
      return draft;
    },
    onPointerDown,
    onPointerMove,
    onPointerUp,
    finish,
    cancel,
  };
}
