import { timeToPixelX, trackRowHeight, trackToPixelY } from "@gpu-components/core";
import type { SemanticModel, ViewportState } from "@gpu-components/core";
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

/** Minimal v1 semantic model: the same visible/labeled spans as a flat list. Full keyboard
 * navigation over the complete dataset is phase 3 (PLAN.md §29) — this is enough for `axe-core` to
 * find real semantic content, not the full a11y tree. */
export function describeTimeline(spans: SpanBuffers, viewport: ViewportState): SemanticModel {
  const labels = visibleLabels(spans, viewport);
  return {
    role: "list",
    label: `Timeline: ${spans.count} spans, ${labels.length} labeled and currently visible`,
    children: labels.map((label) => ({ role: "listitem", label: label.text })),
  };
}
