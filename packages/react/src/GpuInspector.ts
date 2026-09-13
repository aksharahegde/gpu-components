import { createElement, useContext, useEffect, useState, type ReactElement } from "react";
import type { Capabilities, FrameStats, GpuRuntime, Warning } from "@gpuc/core";
import { GpuContext } from "./GPUProvider.ts";

export interface GpuInspectorProps {
  /** Defaults to the ambient `<GPUProvider>`'s runtime (read via `GpuContext` directly, not
   * `useGpu()`, so this component doesn't *require* a provider ancestor when a runtime is passed
   * explicitly — e.g. embedding it outside the subtree it's inspecting). */
  readonly runtime?: GpuRuntime | null;
  /** How often to re-read `profiler.lastFrame` — CPU frame stats have no push subscription, unlike
   * GPU pass results (`onGpuResults`, real push). Default 250ms: enough to feel live without
   * hammering re-renders. */
  readonly pollIntervalMs?: number;
}

const SECTION_STYLE = { marginBottom: "0.75em" };
const HEADING_STYLE = { fontWeight: 600, marginBottom: "0.25em" };
const MONO_STYLE = { fontFamily: "monospace", fontSize: "0.85em" };
const DIM_STYLE = { ...MONO_STYLE, opacity: 0.7 };

function row(label: string, value: string): ReactElement {
  return createElement("div", { style: MONO_STYLE, key: label }, `${label}: ${value}`);
}

function deviceSection(caps: Capabilities): ReactElement {
  const features = [
    `timestamp-query ${caps.timestampQuery ? "✓" : "✗"}`,
    `float32-filterable ${caps.float32Filterable ? "✓" : "✗"}`,
  ].join("  ");
  return createElement(
    "div",
    { style: SECTION_STYLE },
    createElement("div", { style: HEADING_STYLE }, "Device"),
    row("tier", caps.tier),
    row("features", features),
    row("maxStorageBufferBindingSize", `${caps.maxStorageBufferBindingSize.toLocaleString("en-US")} B`),
    row("maxBufferSize", `${caps.maxBufferSize.toLocaleString("en-US")} B`),
    row("maxTextureDimension2D", String(caps.maxTextureDimension2D)),
    row("maxComputeWorkgroupsPerDimension", String(caps.maxComputeWorkgroupsPerDimension)),
  );
}

function frameSection(frame: FrameStats | null): ReactElement {
  const body = frame
    ? [
        row("CPU encode", `${frame.cpuMs.toFixed(2)}ms`),
        row("components", String(frame.componentCount)),
        row("render passes", String(frame.passCount)),
        row("compute dispatches", String(frame.dispatchCount)),
      ]
    : [createElement("div", { style: DIM_STYLE, key: "waiting" }, "no frame recorded yet")];
  return createElement(
    "div",
    { style: SECTION_STYLE },
    createElement("div", { style: HEADING_STYLE }, "Frame"),
    ...body,
  );
}

function passesSection(enabled: boolean, spans: Readonly<Record<string, number>> | null): ReactElement {
  if (!enabled) {
    return createElement(
      "div",
      { style: SECTION_STYLE },
      createElement("div", { style: HEADING_STYLE }, "Passes"),
      createElement(
        "div",
        { style: DIM_STYLE },
        "GPU timing disabled — pass `profiling: true` to GpuRuntime.create() and ensure the " +
          "adapter supports \"timestamp-query\".",
      ),
    );
  }
  const sorted = spans ? Object.entries(spans).sort((a, b) => b[1] - a[1]) : [];
  return createElement(
    "div",
    { style: SECTION_STYLE },
    createElement("div", { style: HEADING_STYLE }, "Passes"),
    sorted.length > 0
      ? createElement(
          "div",
          null,
          ...sorted.map(([name, ms]) => row(name, `${ms.toFixed(3)}ms`)),
        )
      : createElement("div", { style: DIM_STYLE }, "no GPU results decoded yet (1-2 frames of readback latency)"),
  );
}

function warningsSection(warnings: readonly Warning[]): ReactElement {
  return createElement(
    "div",
    { style: SECTION_STYLE },
    createElement("div", { style: HEADING_STYLE }, "Warnings"),
    warnings.length > 0
      ? createElement(
          "div",
          null,
          ...warnings.map((w) =>
            createElement(
              "div",
              { style: MONO_STYLE, key: `${w.code} ${w.source}` },
              `${w.source}: ${w.message}${w.count > 1 ? ` (×${w.count})` : ""}`,
            ),
          ),
        )
      : createElement("div", { style: DIM_STYLE }, "none detected — buffer-growth and redundant-uniform-write only"),
  );
}

/**
 * PLAN.md §28.2's inspector — Device/Frame/Passes/Warnings, backed entirely by data the `Profiler`
 * (`packages/core/src/profiler.ts`) and `WarningsLog` (`packages/core/src/warnings.ts`) already
 * produce. The warnings pane only covers two of §28.2's five documented anti-patterns
 * (buffer-growth, redundant-uniform-write — see `warnings.ts`'s own doc comments for which
 * components report into it) — targets-created-in-the-loop, pipelines-compiled-mid-frame, and
 * unbatched-draws detection are **not implemented**, and neither are the Components/Resources
 * sections (each needs instrumentation that doesn't exist yet: a mounted-components accessor on
 * `GpuRuntime`; byte accounting in `ResourceRegistry`) — and this component says so in its own
 * rendered output, not just in this comment, matching §28.1's "say what's not available rather than
 * estimate" principle applied to this library's own gaps, not only WebGPU's.
 */
export function GpuInspector(props: GpuInspectorProps): ReactElement {
  const ctx = useContext(GpuContext);
  const runtime = props.runtime ?? ctx?.runtime ?? null;
  const pollIntervalMs = props.pollIntervalMs ?? 250;

  const [frame, setFrame] = useState<FrameStats | null>(null);
  const [gpuSpans, setGpuSpans] = useState<Readonly<Record<string, number>> | null>(null);
  const [warnings, setWarnings] = useState<readonly Warning[]>([]);

  useEffect(() => {
    setFrame(null);
    setGpuSpans(null);
    setWarnings([]);
    if (!runtime) return;

    setFrame(runtime.profiler.lastFrame);
    setWarnings(runtime.warnings.recent); // anything already logged before this mount
    const interval = setInterval(() => setFrame(runtime.profiler.lastFrame), pollIntervalMs);
    const unsubGpu = runtime.profiler.onGpuResults((spans) => setGpuSpans(spans));
    const unsubWarnings = runtime.warnings.onWarning(() => setWarnings(runtime.warnings.recent));
    return () => {
      clearInterval(interval);
      unsubGpu();
      unsubWarnings();
    };
  }, [runtime, pollIntervalMs]);

  if (!runtime) {
    return createElement("div", { style: MONO_STYLE }, "GPU Inspector — no runtime connected yet");
  }

  return createElement(
    "div",
    { style: MONO_STYLE },
    createElement("div", { style: { ...HEADING_STYLE, fontSize: "1.05em" } }, "GPU Inspector"),
    deviceSection(runtime.caps),
    frameSection(frame),
    passesSection(runtime.profiler.enabled, gpuSpans),
    warningsSection(warnings),
    createElement("div", { style: DIM_STYLE }, "Not yet available: Components, Resources."),
  );
}
