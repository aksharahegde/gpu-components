/**
 * A recording `CanvasRenderingContext2D` double for testing the Canvas2D fallback backend
 * (PLAN.md §22).
 *
 * jsdom implements no 2D context at all (it needs the native `canvas` package), and even with one,
 * asserting on pixels would test the browser's rasteriser rather than our backend. What is actually
 * worth asserting is *what we asked it to draw* — how many quads, at which coordinates, in how many
 * `fillStyle` runs, and whether the cap downsampled. So this records calls instead of drawing.
 */

export interface RecordedFillRect {
  readonly op: "fillRect";
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly fillStyle: string;
}

export interface RecordedStroke {
  readonly op: "stroke";
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly strokeStyle: string;
  readonly lineWidth: number;
}

export interface RecordedPutImageData {
  readonly op: "putImageData";
  readonly width: number;
  readonly height: number;
  /** The alpha of the first pixel — enough to assert "the shade callback actually wrote". */
  readonly firstPixelAlpha: number;
}

export type RecordedCall = RecordedFillRect | RecordedStroke | RecordedPutImageData;

export interface RecordingContext2D {
  /** Pass this where a `CanvasRenderingContext2D` is expected. */
  readonly ctx: CanvasRenderingContext2D;
  readonly calls: RecordedCall[];
  /** Every distinct `fillStyle` assignment, in order — one entry per *run*, not per quad, so a
   * test can assert that batching actually batched. */
  readonly fillStyleRuns: string[];
  reset(): void;
}

export function createRecordingContext2D(): RecordingContext2D {
  const calls: RecordedCall[] = [];
  const fillStyleRuns: string[] = [];

  let fillStyle = "#000";
  let strokeStyle = "#000";
  let lineWidth = 1;
  // Path state, tracked just far enough to reconstruct the single-segment paths the line backend
  // draws (beginPath → moveTo → lineTo → stroke).
  let cx = 0;
  let cy = 0;
  let px = 0;
  let py = 0;

  const ctx = {
    get fillStyle() {
      return fillStyle;
    },
    set fillStyle(value: string) {
      fillStyle = value;
      fillStyleRuns.push(value);
    },
    get strokeStyle() {
      return strokeStyle;
    },
    set strokeStyle(value: string) {
      strokeStyle = value;
    },
    get lineWidth() {
      return lineWidth;
    },
    set lineWidth(value: number) {
      lineWidth = value;
    },
    fillRect(x: number, y: number, w: number, h: number) {
      calls.push({ op: "fillRect", x, y, w, h, fillStyle });
    },
    beginPath() {},
    moveTo(x: number, y: number) {
      px = x;
      py = y;
      cx = x;
      cy = y;
    },
    lineTo(x: number, y: number) {
      cx = x;
      cy = y;
    },
    stroke() {
      calls.push({ op: "stroke", x0: px, y0: py, x1: cx, y1: cy, strokeStyle, lineWidth });
    },
    createImageData(width: number, height: number): ImageData {
      return { width, height, data: new Uint8ClampedArray(width * height * 4) } as ImageData;
    },
    putImageData(image: ImageData) {
      calls.push({
        op: "putImageData",
        width: image.width,
        height: image.height,
        firstPixelAlpha: image.data[3] ?? 0,
      });
    },
    clearRect() {},
    save() {},
    restore() {},
    scale() {},
  };

  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    calls,
    fillStyleRuns,
    reset() {
      calls.length = 0;
      fillStyleRuns.length = 0;
    },
  };
}
