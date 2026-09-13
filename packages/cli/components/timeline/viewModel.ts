import { timeToPixelX, trackRowHeight, trackToPixelY } from "@gpuc/core";
import type { SemanticModel, ViewportState } from "@gpuc/core";
import type { SpanBuffers } from "./ingest.ts";

export interface LabelPlacement {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly text: string;
}

/** DOM label budget (PLAN.md §13.4/§21.2) — bounded by screen width / minimum label width,
 * regardless of dataset size, which is what lets v1 skip a GPU text engine entirely. */
const MIN_LABEL_WIDTH_PX = 40;
const MAX_LABELS = 400;

/**
 * The v1 text strategy and the accessibility layer are the same computation (PLAN.md §21): this
 * runs from the exact same `viewport.ts` transform the shader's uniforms are derived from, so DOM
 * labels are always pixel-aligned with the spans they annotate.
 */
export function visibleLabels(spans: SpanBuffers, viewport: ViewportState): LabelPlacement[] {
  const labels: LabelPlacement[] = [];
  const rowHeight = trackRowHeight(viewport);

  for (let i = 0; i < spans.count && labels.length < MAX_LABELS; i++) {
    const text = spans.labels[i];
    if (!text) continue;

    const start = spans.start[i]!;
    const end = start + spans.duration[i]!;
    if (end < viewport.timeStart || start > viewport.timeEnd) continue;

    const x0 = timeToPixelX(viewport, Math.max(start, viewport.timeStart));
    const x1 = timeToPixelX(viewport, Math.min(end, viewport.timeEnd));
    const width = x1 - x0;
    if (width < MIN_LABEL_WIDTH_PX) continue;

    const centerY = trackToPixelY(viewport, spans.track[i]!);
    labels.push({ id: i, x: x0, y: centerY - rowHeight / 2, width, height: rowHeight, text });
  }

  return labels;
}

/** Composed `aria-label` text for one span (PLAN.md §21.2: "name, duration, depth, track,
 * timestamp"), used both for the overlay's focusable `listitem`s and the `aria-live` announcer.
 * Falls back to "Span N" for a span with no `label` — keyboard navigation (`hitTest.ts`'s
 * `nextSpanInTrack`/etc.) walks the *full* sorted dataset, not just the labeled/visible subset
 * `visibleLabels` renders text for, so this has to handle an unlabeled span too. */
export function describeSpan(spans: SpanBuffers, index: number): string {
  const name = spans.labels[index] || `Span ${index}`;
  // `RawSpan.start`/`duration` are unit-agnostic (seconds or a normalized domain — `ingest.ts`'s
  // own doc comment says so); assuming seconds here matches PLAN.md §21.2's own example
  // ("fetchUser, 12.4ms") and every real trace-data caller this is written for.
  const durationMs = spans.duration[index]! * 1000;
  const track = spans.track[index]!;
  const start = spans.start[index]!;
  return `${name}, ${durationMs.toFixed(1)}ms, track ${track}, starts at ${start.toFixed(3)}`;
}

/** Minimal v1 semantic model: the same visible/labeled spans as a flat list — enough for
 * `axe-core` to find real semantic content, not the full a11y tree (that's `GPUTimeline.tsx`'s
 * `role="application"`/roving-tabindex overlay + this function's `tl-summary` region together). */
export function describeTimeline(spans: SpanBuffers, viewport: ViewportState): SemanticModel {
  const labels = visibleLabels(spans, viewport);
  return {
    role: "list",
    label: `Timeline: ${spans.count} spans, ${labels.length} labeled and currently visible`,
    children: labels.map((label) => ({ role: "listitem", label: label.text })),
  };
}
