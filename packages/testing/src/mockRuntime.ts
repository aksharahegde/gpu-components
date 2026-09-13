import { createMockAdapter, init as mockInit, type Gpu } from "vgpu/mock";
import { GpuRuntime, type Capabilities, type GpuRuntimeOptions } from "@gpu-components/core";

export interface MockRuntimeOptions {
  readonly features?: readonly GPUFeatureName[];
  readonly runtime?: Omit<GpuRuntimeOptions, "reconnect">;
}

function capabilitiesFor(features: readonly GPUFeatureName[]): Capabilities {
  return {
    webgpu: true,
    timestampQuery: features.includes("timestamp-query"),
    float32Filterable: features.includes("float32-filterable"),
    maxStorageBufferBindingSize: 128 * 1024 * 1024,
    maxBufferSize: 256 * 1024 * 1024,
    maxTextureDimension2D: 8192,
    maxComputeWorkgroupsPerDimension: 65535,
    tier: "gpu",
  };
}

/** A bare `Gpu` from `vgpu/mock` — no real GPU, deterministic, CI-safe. For tests that only need
 * a `Gpu` (e.g. driving a `FrameScheduler` directly) rather than a full `GpuRuntime`. `features`
 * both configures what the mock *adapter* declares support for and requests them as
 * `requiredFeatures` on the device itself — matching the real `init()` path (PLAN.md §10.6's
 * "never request features speculatively"), and required for feature-gated APIs like `timer(gpu)`
 * to actually work: the adapter merely supporting a feature doesn't grant it to the device. */
export async function createMockGpu(
  features: readonly GPUFeatureName[] = [],
): Promise<{ gpu: Gpu; caps: Capabilities }> {
  const gpu = await mockInit({ adapter: createMockAdapter({ features }), requiredFeatures: features });
  return { gpu, caps: capabilitiesFor(features) };
}

/**
 * A `GpuRuntime` backed by `vgpu/mock` — no real GPU, deterministic, CI-safe. `reconnect` also
 * goes through the mock adapter, so `runtime.simulateDeviceLoss()` (the mock device does not
 * implement `GPUDevice.lost`, so there is nothing to actually destroy) exercises `GpuRuntime`'s
 * real recovery path end to end.
 */
export async function createMockRuntime(opts: MockRuntimeOptions = {}): Promise<GpuRuntime> {
  const features = opts.features ?? [];
  const { gpu, caps } = await createMockGpu(features);
  return GpuRuntime.createWithGpu(gpu, caps, {
    ...opts.runtime,
    reconnect: async () => createMockGpu(features),
  });
}

/**
 * The `GpuRuntimeOptions` fragment for code that must call `GpuRuntime.create()` itself rather
 * than `createWithGpu()` — chiefly `<GPUProvider>`, whose async effect owns the `create()` call.
 * Spread into `options`: `createElement(GPUProvider, { options: mockGpuRuntimeOptions() })`.
 * Reaches `caps.webgpu === true` under `vgpu/mock` with no `navigator.gpu` present (e.g. jsdom).
 */
export function mockGpuRuntimeOptions(
  features: readonly GPUFeatureName[] = [],
): Pick<GpuRuntimeOptions, "connect" | "reconnect"> {
  return {
    connect: () => createMockGpu(features),
    reconnect: () => createMockGpu(features),
  };
}

/** Waits at least one scheduler tick. `frameLoop` falls back to a 16ms `setTimeout` where
 * `requestAnimationFrame` is unavailable (i.e. under Node), so this is a real, if coarse, clock —
 * not a fake timer. */
export function tick(ms = 40): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A `GpuRuntime` in Canvas2D fallback mode (`caps.tier === 'fallback'`, `caps.webgpu === false`) —
 * no `Gpu` at all, `GpuRuntime.createFallback()` under the hood. For testing a component's
 * fallback policy end to end (PLAN.md §22 stage 3.8) without a real browser or `navigator.gpu`.
 */
export function createFallbackRuntime(
  options: Omit<GpuRuntimeOptions, "reconnect" | "connect" | "adopt"> = {},
): GpuRuntime {
  return GpuRuntime.createFallback(options);
}
