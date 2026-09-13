export interface Capabilities {
  readonly webgpu: boolean;
  readonly timestampQuery: boolean;
  readonly float32Filterable: boolean;
  readonly maxStorageBufferBindingSize: number;
  readonly maxBufferSize: number;
  readonly maxTextureDimension2D: number;
  readonly maxComputeWorkgroupsPerDimension: number;
  readonly tier: "gpu" | "fallback" | "none";
}

export const NO_WEBGPU_CAPABILITIES: Capabilities = {
  webgpu: false,
  timestampQuery: false,
  float32Filterable: false,
  maxStorageBufferBindingSize: 0,
  maxBufferSize: 0,
  maxTextureDimension2D: 0,
  maxComputeWorkgroupsPerDimension: 0,
  tier: "none",
};

/**
 * Same zeroed limits as `NO_WEBGPU_CAPABILITIES` — there is still no `Gpu` — but `tier: "fallback"`
 * signals a *chosen* degraded mode (Canvas2D) rather than an unsupported one. Tier promotion from
 * "none" to "fallback" is the runtime's decision, not `probeCapabilities()`'s: only the runtime
 * knows whether `options.fallback !== "none"` was actually requested.
 */
export const FALLBACK_CAPABILITIES: Capabilities = {
  webgpu: false,
  timestampQuery: false,
  float32Filterable: false,
  maxStorageBufferBindingSize: 0,
  maxBufferSize: 0,
  maxTextureDimension2D: 0,
  maxComputeWorkgroupsPerDimension: 0,
  tier: "fallback",
};

/**
 * Probes `navigator.gpu.requestAdapter()` directly, independent of `init()`, so we know which
 * *optional* features (e.g. `timestamp-query`) are actually supported before ever naming them in
 * `requiredFeatures` — `vgpu`'s docs are explicit that an unsupported required feature fails
 * `init()` outright (PLAN.md §10.6). This probe adapter is discarded; `init()` requests its own.
 */
export async function probeCapabilities(): Promise<Capabilities> {
  const gpu = (globalThis as { navigator?: { gpu?: GPU } }).navigator?.gpu;
  if (!gpu) return NO_WEBGPU_CAPABILITIES;

  const adapter = await gpu.requestAdapter();
  if (!adapter) return NO_WEBGPU_CAPABILITIES;

  return {
    webgpu: true,
    timestampQuery: adapter.features.has("timestamp-query"),
    float32Filterable: adapter.features.has("float32-filterable"),
    maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
    maxBufferSize: adapter.limits.maxBufferSize,
    maxTextureDimension2D: adapter.limits.maxTextureDimension2D,
    maxComputeWorkgroupsPerDimension: adapter.limits.maxComputeWorkgroupsPerDimension,
    tier: "gpu",
  };
}

/** The `requiredFeatures` to pass to `init()`, restricted to what `caps` actually found supported. */
export function supportedFeatures(caps: Capabilities): readonly GPUFeatureName[] {
  const features: GPUFeatureName[] = [];
  if (caps.timestampQuery) features.push("timestamp-query");
  return features;
}
