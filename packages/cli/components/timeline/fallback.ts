import {
  CANVAS2D_CAPS,
  samplingStride,
  type QuadFallbackPolicy,
  type QuadRect,
  type RasterFallbackPolicy,
  type ViewportUniforms,
  type WarningsLog,
} from "@gpuc/core";
import { INSTANCE_STRIDE } from "./ingest.ts";
import type { SpanBuffers } from "./ingest.ts";

/**
 * The Canvas2D fallback for `TimelineComponent` (PLAN.md §22, stage 4). Everything here is an
 * exact transcription of `timeline.wgsl.ts`/`highlight.wgsl.ts`/`densityBin.wgsl.ts`/
 * `reduceDensity.wgsl.ts`/`raster.wgsl.ts`'s math — read those files' own doc comments before
 * touching this one; the constants below (`MIN_WIDTH_PX`, `ROW_FRACTION`, the palettes) are
 * transcribed from the WGSL literals, not independently chosen, and `fallback.test.ts` asserts
 * that transcription against the shader source directly.
 */

/** `timeline.wgsl.ts`'s `vs_main`: below this clip-space width (in pixels via `pxSize.x`), a span
 * is widened to stay visible rather than vanishing at sub-pixel zoom. Shared by the highlight
 * shader too — both declare the same `const MIN_WIDTH_PX: f32 = 1.5;`. */
const MIN_WIDTH_PX = 1.5;
/** `timeline.wgsl.ts`'s span row fraction — how much of a track's height a span quad occupies. */
const SPAN_ROW_FRACTION = 0.7;
/** `highlight.wgsl.ts`'s row fraction — wider than a span's own, so a highlight reads as a halo. */
const HIGHLIGHT_ROW_FRACTION = 0.85;

/** `timeline.wgsl.ts`'s `PALETTE`, transcribed verbatim (float components, WGSL source order) —
 * `TIMELINE_PALETTE_RGBA8` below packs these; keeping the floats too is what lets
 * `fallback.test.ts` diff this array against the shader source without re-deriving anything. */
export const TIMELINE_PALETTE_FLOATS: readonly (readonly [number, number, number, number])[] = [
  [0.239, 0.31, 0.839, 1.0],
  [0.055, 0.486, 0.345, 1.0],
  [0.663, 0.4, 0.047, 1.0],
  [0.753, 0.169, 0.169, 1.0],
  [0.059, 0.455, 0.565, 1.0],
  [0.427, 0.157, 0.851, 1.0],
];

/** 0-1 float components -> packed `0xRRGGBBAA`, `packRgba8`'s own convention. */
function packFloatsRgba8(rgba: readonly [number, number, number, number]): number {
  const [r, g, b, a] = rgba;
  return (
    ((Math.round(r * 255) & 255) << 24) |
    ((Math.round(g * 255) & 255) << 16) |
    ((Math.round(b * 255) & 255) << 8) |
    (Math.round(a * 255) & 255)
  ) >>> 0;
}

/** `timeline.wgsl.ts`'s categorical span palette, packed — `PALETTE[colorIndex % 6]`. */
export const TIMELINE_PALETTE_RGBA8: readonly number[] = TIMELINE_PALETTE_FLOATS.map(packFloatsRgba8);

/** `timeline.wgsl.ts`'s selection tint target: `mix(color, ink, 0.4)`. */
const SELECTION_INK: readonly [number, number, number] = [0.051, 0.059, 0.078];
const SELECTION_MIX = 0.4;

/** `highlight.wgsl.ts`'s two fixed fills — `kind === 1` (selected) is the amber wash, everything
 * else (hover) is the ink wash. */
const HIGHLIGHT_SELECTED_RGBA8 = packFloatsRgba8([0.663, 0.4, 0.047, 0.45]);
const HIGHLIGHT_HOVER_RGBA8 = packFloatsRgba8([0.051, 0.059, 0.078, 0.16]);

/** `mix(color, ink, 0.4)` component-wise, alpha untouched (both operands are opaque). */
function tintSelected(packed: number): number {
  const r = (packed >>> 24) & 255;
  const g = (packed >>> 16) & 255;
  const b = (packed >>> 8) & 255;
  const a = packed & 255;
  const mixed = (channel: number, ink: number) => Math.round(channel * (1 - SELECTION_MIX) + ink * 255 * SELECTION_MIX);
  return packFloatsRgba8([mixed(r, SELECTION_INK[0]) / 255, mixed(g, SELECTION_INK[1]) / 255, mixed(b, SELECTION_INK[2]) / 255, a / 255]);
}

/** Byte offsets into a packed `SpanInstance` — `ingest.ts`'s `INSTANCE_STRIDE = 16` layout,
 * `start:f32@0, duration:f32@4, track:u32@8, colorIndex:u32@12`, little-endian. Shared by the
 * highlight layout too (`colorIndex` repurposed as `kind`). */
function readSpanInstance(view: DataView, index: number): { start: number; duration: number; track: number; colorIndex: number } {
  const at = index * INSTANCE_STRIDE;
  return {
    start: view.getFloat32(at + 0, true),
    duration: view.getFloat32(at + 4, true),
    track: view.getUint32(at + 8, true),
    colorIndex: view.getUint32(at + 12, true),
  };
}

/** Shared quad-decode math — `timeline.wgsl.ts`/`highlight.wgsl.ts`'s `vs_main`, transcribed. */
function decodeQuad(
  view: DataView,
  index: number,
  viewport: ViewportUniforms,
  rowFraction: number,
  cull: boolean,
): { x0: number; x1: number; y0: number; y1: number; colorIndex: number } | null {
  const { start, duration, track, colorIndex } = readSpanInstance(view, index);
  const [timeScale, timeOffset] = viewport.timeToClip;
  const [trackScale, trackOffset] = viewport.trackToClip;
  const [pxX] = viewport.pxSize;

  const xStart = start * timeScale + timeOffset;
  let xEnd = (start + duration) * timeScale + timeOffset;
  const minWidth = pxX * MIN_WIDTH_PX;
  if (xEnd - xStart < minWidth) xEnd = xStart + minWidth;

  if (cull && (xEnd < -1 || xStart > 1)) return null;

  const rowCenter = track * trackScale + trackOffset;
  const halfRow = Math.abs(trackScale) * 0.5 * rowFraction;

  return { x0: xStart, x1: xEnd, y0: rowCenter - halfRow, y1: rowCenter + halfRow, colorIndex };
}

/**
 * The main span layer's Canvas2D fallback policy (PLAN.md §22 stage 4.1) — the CPU equivalent of
 * both `timeline.wgsl.ts`'s `vs_main`/`fs_main` AND `cull.wgsl.ts`'s compute pass: `decodeQuad`'s
 * `cull: true` branch does the culling `InstancedQuadLayer.drawIndirect()`'s Canvas2D path relies
 * on (it walks every instance and lets `decode` reject the ones outside the viewport), so no
 * separate CPU cull pass exists — see `TimelineComponent`'s `dispatchCull()` fallback comment.
 *
 * `isSelected` closes over the component's CPU-owned brush-selection set (`hitTest.ts`'s
 * `selectSpansInRange`, not a reimplementation of `brushSelect.wgsl.ts`'s bitset logic — see
 * `TimelineComponent`'s `dispatchBrushSelect()` fallback).
 */
export function createSpanQuadPolicy(isSelected: (index: number) => boolean): QuadFallbackPolicy {
  return {
    decode(view: DataView, index: number, viewport: ViewportUniforms): QuadRect | null {
      const quad = decodeQuad(view, index, viewport, SPAN_ROW_FRACTION, true);
      if (!quad) return null;
      let color = TIMELINE_PALETTE_RGBA8[quad.colorIndex % 6]!;
      if (isSelected(index)) color = tintSelected(color);
      return { x0: quad.x0, y0: quad.y0, x1: quad.x1, y1: quad.y1, color };
    },
  };
}

/**
 * The hover/selection overlay's Canvas2D fallback policy (stage 4.2) — `highlight.wgsl.ts`'s
 * `vs_main`/`fs_main`. At most two instances (hover, selection), so no cull is needed — same
 * reasoning `TimelineComponent`'s own doc comment gives for drawing the GPU highlight layer
 * uncompacted.
 */
export function createHighlightQuadPolicy(): QuadFallbackPolicy {
  return {
    decode(view: DataView, index: number, viewport: ViewportUniforms): QuadRect | null {
      const quad = decodeQuad(view, index, viewport, HIGHLIGHT_ROW_FRACTION, false);
      if (!quad) return null;
      const color = quad.colorIndex === 1 ? HIGHLIGHT_SELECTED_RGBA8 : HIGHLIGHT_HOVER_RGBA8;
      return { x0: quad.x0, y0: quad.y0, x1: quad.x1, y1: quad.y1, color };
    },
  };
}

/** `densityBin.wgsl.ts`'s `PIXEL_COLUMNS`-worth of fixed pixel-column buckets per track — kept in
 * lockstep with `TimelineComponent`'s own `PIXEL_COLUMNS` (imported, not redeclared). */
export interface CpuDensityBinResult {
  readonly stride: number;
}

/**
 * `densityBin.wgsl.ts`'s compute pass, transcribed for the CPU (stage 4.3): one span at a time
 * (strided when `spans.count` exceeds `CANVAS2D_CAPS.binnedSpans`, scaling each increment by the
 * stride so the field's *shape* survives sparser sampling rather than just its magnitude
 * shrinking), incrementing `density[track * pixelColumns + column]` for the column its *start*
 * time falls in — the same stated start-time-only approximation the WGSL version documents.
 *
 * `density` must already be zeroed by the caller (mirrors `TimelineComponent`'s own
 * `densityBuffer.write(this.zeroDensity)` reset on the GPU path) and sized
 * `trackCapacity * pixelColumns`.
 */
export function cpuDensityBin(
  spans: SpanBuffers,
  timeStart: number,
  timeEnd: number,
  trackCount: number,
  pixelColumns: number,
  density: Uint32Array,
  warnings?: WarningsLog,
  source?: string,
): CpuDensityBinResult {
  const domainSpan = Math.max(timeEnd - timeStart, 1e-9);
  const stride = samplingStride(spans.count, CANVAS2D_CAPS.binnedSpans);
  if (stride > 1) {
    warnings?.report({
      code: "canvas2d-degraded",
      source: source ?? "TimelineComponent",
      message: `${spans.count} spans exceeds the Canvas2D density-binning budget of ${CANVAS2D_CAPS.binnedSpans} — sampling every ${stride}th, scaled to compensate`,
    });
  }

  for (let i = 0; i < spans.count; i += stride) {
    const start = spans.start[i]!;
    const end = start + spans.duration[i]!;
    if (end < timeStart || start > timeEnd) continue;
    const track = spans.track[i]!;
    if (track >= trackCount) continue;

    const t = Math.min(Math.max((start - timeStart) / domainSpan, 0), 1);
    const column = Math.min(Math.floor(t * pixelColumns), pixelColumns - 1);
    density[track * pixelColumns + column]! += stride;
  }

  return { stride };
}

/** `reduceDensity.wgsl.ts`'s max-reduction, transcribed for the CPU: one linear pass folding
 * `density` down to a per-track max. `maxPerTrack` must already be sized `trackCount` and zeroed
 * by the caller. */
export function cpuReduceDensity(
  density: Uint32Array,
  maxPerTrack: Uint32Array,
  trackCount: number,
  pixelColumns: number,
): void {
  for (let track = 0; track < trackCount; track++) {
    let max = 0;
    const base = track * pixelColumns;
    for (let column = 0; column < pixelColumns; column++) {
      const value = density[base + column]!;
      if (value > max) max = value;
    }
    maxPerTrack[track] = max;
  }
}

/** `raster.wgsl.ts`'s sequential intensity ramp, transcribed verbatim. */
function colormap(t: number): readonly [number, number, number] {
  const s = Math.sqrt(Math.min(Math.max(t, 0), 1));
  const lo: readonly [number, number, number] = [0.816, 0.843, 0.945];
  const hi: readonly [number, number, number] = [0.157, 0.208, 0.639];
  return [lo[0] + (hi[0] - lo[0]) * s, lo[1] + (hi[1] - lo[1]) * s, lo[2] + (hi[2] - lo[2]) * s];
}

/** The site's `color.bgRaised` (`apps/site/src/components/demos/chrome.tsx`'s own `clearColor`) —
 * `raster.wgsl.ts`'s discard leaves the GPU surface's own clear colour showing through, and
 * `RasterLayer.drawCanvas2D`'s `putImageData` cannot let anything "show through" (it does not
 * blend), so a discarded/empty pixel must be written as this colour outright rather than as
 * alpha-0, and an occupied pixel's `0.85`-alpha fragment must be pre-blended against it.
 *
 * ponytail: hardcoded rather than plumbed through `ComponentContext`/`RuntimeHandle` — no API
 * exposes a mounted runtime's configured `clearColor` to a component today, and adding one for a
 * single component's cosmetic exactness is a bigger change than this milestone needs. Revisit if
 * a host ever runs `GPUTimeline` against a different clear colour and the seam becomes visible. */
const CLEAR_BACKGROUND_RGB: readonly [number, number, number] = [247, 251, 253];
const RASTER_ALPHA = 0.85;

/**
 * The raster (density-field) layer's Canvas2D fallback policy (stage 4.4) — `raster.wgsl.ts`'s
 * `fs_main` + colormap, reading the CPU-binned `density`/`maxPerTrack` arrays `cpuDensityBin`/
 * `cpuReduceDensity` fill. Two fixes `putImageData`'s no-blending semantics force that the GPU path
 * doesn't need:
 *
 * 1. A `value === 0` pixel (the shader's `discard`) is written as the *opaque* clear colour, not
 *    alpha-0 — alpha-0 via `putImageData` erases whatever was drawn underneath instead of leaving
 *    it showing through.
 * 2. An occupied pixel's `vec4f(colormap, 0.85)` is pre-blended against that same clear colour
 *    here, in JS, since there is no destination-alpha compositing to do it for us.
 *
 * Draw-order note (also stage 4.4): in fallback mode the raster fill must be the *first* thing
 * `TimelineComponent.plan()` draws (before the axis rules), not because this function cares, but
 * because `putImageData` always overwrites the whole canvas — anything drawn before it is erased.
 */
export function createRasterShadePolicy(
  getDensity: () => { density: Uint32Array; maxPerTrack: Uint32Array; trackCount: number },
  viewport: () => ViewportUniforms,
  pixelColumns: number,
): RasterFallbackPolicy {
  return {
    shade(rgba: Uint8ClampedArray, width: number, height: number): void {
      const { density, maxPerTrack, trackCount } = getDensity();
      const { trackToClip } = viewport();
      const [trackScale, trackOffset] = trackToClip;
      const [bgR, bgG, bgB] = CLEAR_BACKGROUND_RGB;

      for (let y = 0; y < height; y++) {
        const clipY = 1 - (2 * (y + 0.5)) / height;
        const track = Math.round((clipY - trackOffset) / trackScale);
        const rowBase = y * width * 4;

        if (track < 0 || track >= trackCount) {
          for (let x = 0; x < width; x++) {
            const at = rowBase + x * 4;
            rgba[at] = bgR;
            rgba[at + 1] = bgG;
            rgba[at + 2] = bgB;
            rgba[at + 3] = 255;
          }
          continue;
        }

        for (let x = 0; x < width; x++) {
          const column = Math.min(Math.floor(((x + 0.5) / width) * pixelColumns), pixelColumns - 1);
          const value = density[track * pixelColumns + column]!;
          const at = rowBase + x * 4;
          if (value === 0) {
            rgba[at] = bgR;
            rgba[at + 1] = bgG;
            rgba[at + 2] = bgB;
            rgba[at + 3] = 255;
            continue;
          }
          const maxValue = Math.max(maxPerTrack[track]!, 1);
          const [r, g, b] = colormap(value / maxValue);
          rgba[at] = Math.round(r * 255 * RASTER_ALPHA + bgR * (1 - RASTER_ALPHA));
          rgba[at + 1] = Math.round(g * 255 * RASTER_ALPHA + bgG * (1 - RASTER_ALPHA));
          rgba[at + 2] = Math.round(b * 255 * RASTER_ALPHA + bgB * (1 - RASTER_ALPHA));
          rgba[at + 3] = 255;
        }
      }
    },
  };
}
