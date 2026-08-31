/**
 * `GPUAnnotationCanvas`'s draw tools — pure pointer-lifecycle state machines that turn image-space
 * pointer events into draft (in-progress preview) or finished `Annotation` objects. No GPU, no DOM:
 * `GPUAnnotationCanvas.tsx` converts screen pixels to image space (`pixelXToTime`/`pixelYToTrack`)
 * and feeds the results here, then emits the finished annotation via `onCreate`.
 *
 * Design doc's tool set (§"Tools"): pan; select + move; draw-by-drag for rect/ellipse/ruler/point;
 * polygon click-to-add with `finish()` to close; freehand sample-on-move then simplify to a vertex
 * cap. `pan`/`select` produce no draft/annotation here — panning is a viewport change and moving a
 * selection is `moveAnnotation` below, both handled by the wrapper against state this module does
 * not own.
 */
import type { Annotation } from "./scene.ts";
import type { Point2D } from "./measure.ts";

export type ToolName = "pan" | "select" | "rect" | "ellipse" | "point" | "ruler" | "polygon" | "freehand";

export interface ImagePoint {
  readonly x: number;
  readonly y: number;
}

/** Vertex cap for polygon/freehand annotations — the design doc's device-friendly budget. */
export const MAX_POLYGON_POINTS = 256;

/** Id used for in-progress drafts, which are rendered but never emitted through `onCreate`. */
export const DRAFT_ANNOTATION_ID = "__annotation-draft__";

/** A drag shorter than this, in image units, is a click rather than a shape — rect/ellipse/ruler
 * do not create a degenerate zero-size annotation from a plain click. */
const MIN_DRAG = 1e-6;

let idCounter = 0;

/** New annotation id: `crypto.randomUUID` where available (browsers, Node ≥ 19), a monotonic
 * `ann-${n}` fallback otherwise. */
export function createAnnotationId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (typeof g.crypto?.randomUUID === "function") return g.crypto.randomUUID();
  return `ann-${idCounter++}`;
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
 * pointer-up after the last move). Collection is uncapped — a long stroke's raw samples all stay
 * until `simplifyPoints` downsamples the *whole* stroke at gesture end, so the emitted annotation's
 * last point is always the last sampled position rather than whatever sample happened to land on
 * an early cap. */
function appendFreehandSample(points: Point2D[], p: ImagePoint): void {
  const last = points[points.length - 1];
  if (last && last.x === p.x && last.y === p.y) return;
  points.push({ x: p.x, y: p.y });
}

/** Uniformly downsamples `points` to at most `cap` entries, always keeping the first and last —
 * the "simplify to a vertex cap" step for freehand paths and over-long polygons. */
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

/** Translates any annotation kind by `(dx, dy)` in image space — the "select" tool's move update.
 * A pure function: the wrapper owns capturing the pre-drag annotation and re-applying this against
 * the accumulated drag delta on every pointer move, so repeated calls never compound rounding. */
export function moveAnnotation(annotation: Annotation, dx: number, dy: number): Annotation {
  switch (annotation.kind) {
    case "rect":
    case "ellipse":
      return { ...annotation, x: annotation.x + dx, y: annotation.y + dy };
    case "point":
      return { ...annotation, x: annotation.x + dx, y: annotation.y + dy };
    case "ruler":
      return {
        ...annotation,
        x0: annotation.x0 + dx,
        y0: annotation.y0 + dy,
        x1: annotation.x1 + dx,
        y1: annotation.y1 + dy,
      };
    case "polygon":
    case "freehand":
      return { ...annotation, points: annotation.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
  }
}

export interface ToolController {
  readonly tool: ToolName;
  /** In-progress preview, if any — the wrapper renders this alongside `annotations` while a drag
   * or a polygon/freehand session is active. */
  readonly draft: Annotation | null;
  onPointerDown(p: ImagePoint): void;
  onPointerMove(p: ImagePoint): void;
  /** Finalizes a drag gesture. Returns a new `Annotation` (via `onCreate`), or `null` if the
   * gesture produced nothing (a plain click on a drag-shape tool, or a polygon/freehand still
   * collecting points/samples). */
  onPointerUp(p: ImagePoint): Annotation | null;
  /** Closes a polygon early (double-click or Enter). No-op, returning `null`, for every other tool. */
  finish(): Annotation | null;
  /** Discards any in-progress draft (Escape, or switching tools mid-gesture). */
  cancel(): void;
}

type DragKind = "rect" | "ellipse" | "ruler";

function draftForDrag(kind: DragKind, start: ImagePoint, current: ImagePoint): Annotation {
  if (kind === "ruler") {
    return { id: DRAFT_ANNOTATION_ID, kind: "ruler", x0: start.x, y0: start.y, x1: current.x, y1: current.y };
  }
  const { x, y, w, h } = rectFromDrag(start.x, start.y, current.x, current.y);
  return { id: DRAFT_ANNOTATION_ID, kind, x, y, w, h };
}

function finishDrag(kind: DragKind, start: ImagePoint, end: ImagePoint): Annotation | null {
  if (!movedEnough(start.x, start.y, end.x, end.y)) return null;
  if (kind === "ruler") {
    return { id: createAnnotationId(), kind: "ruler", x0: start.x, y0: start.y, x1: end.x, y1: end.y };
  }
  const { x, y, w, h } = rectFromDrag(start.x, start.y, end.x, end.y);
  return { id: createAnnotationId(), kind, x, y, w, h };
}

/** Builds the pointer-lifecycle controller for one active tool. Recreate on tool change: each
 * instance carries its own in-progress drag/polygon/freehand state. */
export function createToolController(tool: ToolName): ToolController {
  let down: ImagePoint | null = null;
  let draft: Annotation | null = null;
  let polygonPoints: Point2D[] = [];

  function cancel(): void {
    down = null;
    draft = null;
    polygonPoints = [];
  }

  function onPointerDown(p: ImagePoint): void {
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
        draft = { id: DRAFT_ANNOTATION_ID, kind: "freehand", points: polygonPoints.slice() };
        break;
      case "point":
        down = p;
        break;
      case "polygon":
      case "pan":
      case "select":
        break;
    }
  }

  function onPointerMove(p: ImagePoint): void {
    switch (tool) {
      case "rect":
      case "ellipse":
      case "ruler":
        if (!down) return;
        draft = draftForDrag(tool, down, p);
        break;
      case "polygon":
        if (polygonPoints.length === 0) return;
        draft = { id: DRAFT_ANNOTATION_ID, kind: "polygon", points: [...polygonPoints, { x: p.x, y: p.y }] };
        break;
      case "freehand":
        if (!down) return;
        appendFreehandSample(polygonPoints, p);
        draft = { id: DRAFT_ANNOTATION_ID, kind: "freehand", points: polygonPoints.slice() };
        break;
      case "point":
      case "pan":
      case "select":
        break;
    }
  }

  function onPointerUp(p: ImagePoint): Annotation | null {
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
        return { id: createAnnotationId(), kind: "point", x: p.x, y: p.y };
      }
      case "polygon": {
        if (polygonPoints.length < MAX_POLYGON_POINTS) polygonPoints = [...polygonPoints, { x: p.x, y: p.y }];
        draft = { id: DRAFT_ANNOTATION_ID, kind: "polygon", points: polygonPoints.slice() };
        return null; // a polygon closes via finish(), not a single pointer-up
      }
      case "freehand": {
        appendFreehandSample(polygonPoints, p);
        const points = simplifyPoints(polygonPoints, MAX_POLYGON_POINTS);
        cancel();
        if (points.length < 2) return null;
        return { id: createAnnotationId(), kind: "freehand", points };
      }
      case "pan":
      case "select":
        return null;
    }
  }

  function finish(): Annotation | null {
    if (tool !== "polygon") return null;
    if (polygonPoints.length < 3) {
      cancel();
      return null;
    }
    const points = simplifyPoints(polygonPoints, MAX_POLYGON_POINTS);
    const result: Annotation = { id: createAnnotationId(), kind: "polygon", points };
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