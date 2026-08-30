import { createElement, useContext, useEffect, useState, type ReactElement } from "react";
import type { Capabilities, FrameStats, GpuRuntime } from "@gpu-components/core";
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

/**
 * PLAN.md §28.2's inspector — Device/Frame/Passes only, backed entirely by data the `Profiler`
 * (`packages/core/src/profiler.ts`) already produces. Components, Resources, and the Warnings pane
 * (§28.2's own "highest-value part") are **not implemented** — each needs instrumentation that
 * doesn't exist yet (a mounted-components accessor on `GpuRuntime`; byte accounting in
 * `ResourceRegistry`; anti-pattern detection hooks) — and this component says so in its own
 * rendered output, not just in this comment, matching §28.1's "say what's not available rather than
 * estimate" principle applied to this library's own gaps, not only WebGPU's.
 */
export function GpuInspector(props: GpuInspectorProps): ReactElement {
  const ctx = useContext(GpuContext);
  const runtime = props.runtime ?? ctx?.runtime ?? null;
  const pollIntervalMs = props.pollIntervalMs ?? 250;

  const [frame, setFrame] = useState<FrameStats | null>(null);
  const [gpuSpans, setGpuSpans] = useState<Readonly<Record<string, number>> | null>(null);

  useEffect(() => {
    setFrame(null);
    setGpuSpans(null);
    if (!runtime) return;

    setFrame(runtime.profiler.lastFrame);
    const interval = setInterval(() => setFrame(runtime.profiler.lastFrame), pollIntervalMs);
    const unsubscribe = runtime.profiler.onGpuResults((spans) => setGpuSpans(spans));
    return () => {
      clearInterval(interval);
      unsubscribe();
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
    createElement("div", { style: DIM_STYLE }, "Not yet available: Components, Resources, Warnings."),
  );
}
