export type {
  Capabilities,
} from "./capabilities.ts";
export { NO_WEBGPU_CAPABILITIES, probeCapabilities, supportedFeatures } from "./capabilities.ts";

export type {
  ComponentContext,
  ComputePass,
  FrameContext,
  GpuComponent,
  HitResult,
  RenderPass,
  RenderPlan,
  ResourceRef,
  RuntimeHandle,
  SemanticModel,
} from "./component.ts";
export { EMPTY_PLAN } from "./component.ts";

export {
  assertBufferBudget,
  dispatchWorkgroups,
  GpuBudgetExceededError,
  maxElementsFor,
} from "./budget.ts";
export type { DispatchOptions } from "./budget.ts";
export { createImageTexture } from "./texture.ts";
export type { ImageTexture, ImageTextureOptions, ImageTextureSource } from "./texture.ts";
export { RingBuffer } from "./ringBuffer.ts";
export type { RingBufferOptions, RingState } from "./ringBuffer.ts";
export { ResourceRegistry } from "./registry.ts";
export { FrameScheduler } from "./scheduler.ts";
export { createProfiler, DISABLED_PROFILER } from "./profiler.ts";
export type { FrameStats, Profiler } from "./profiler.ts";
export { createWarningsLog } from "./warnings.ts";
export type { Warning, WarningsLog } from "./warnings.ts";
export { trackedUniforms } from "./trackedUniforms.ts";
export { SurfaceHandle } from "./surface.ts";
export type { SurfaceLike } from "./surface.ts";
export type { Globals } from "./uniforms.ts";
export { GpuRuntime } from "./runtime.ts";
export type { GpuRuntimeOptions, MountHandle } from "./runtime.ts";
/* Re-exported so hosts configuring `GpuRuntimeOptions.clearColor` do not have to reach past this
 * package into `vgpu` for the type of one of our own options. */
export type { ClearColor } from "vgpu";

export {
  pixelXToTime,
  pixelYToTrack,
  rowRange,
  visibleRows,
  timeToPixelX,
  trackRowHeight,
  trackToPixelY,
  viewportUniforms,
} from "./viewport.ts";
export type { ViewportState, ViewportUniforms } from "./viewport.ts";

export {
  CANVAS2D_CAPS,
  clipToPixelX,
  clipToPixelY,
  cssColor,
  gpuPass,
  samplingStride,
} from "./passEncoder.ts";
export type { Canvas2DPassEncoder, GpuPassEncoder, PassEncoder } from "./passEncoder.ts";

export { InstancedQuadLayer } from "./layers/instancedQuad.ts";
export type {
  InstancedQuadLayerOptions,
  QuadFallbackPolicy,
  QuadRect,
} from "./layers/instancedQuad.ts";
export { RasterLayer } from "./layers/rasterLayer.ts";
export type { RasterFallbackPolicy, RasterLayerOptions } from "./layers/rasterLayer.ts";
export {
  LINE_FLAG_CLIP_X,
  LINE_FLAG_CLIP_Y,
  LINE_INSTANCE_STRIDE,
  LineLayer,
  packLines,
  packRgba8,
  writeLine,
} from "./layers/lineLayer.ts";
export type { LineInstance, LineLayerOptions } from "./layers/lineLayer.ts";
export { LINE_WGSL } from "./layers/lineLayer.wgsl.ts";

export { createPointerController } from "./interaction/pointer.ts";
export type { PointerController, PointerState } from "./interaction/pointer.ts";
export { normalizeWheel } from "./interaction/wheel.ts";
export type { NormalizedWheel } from "./interaction/wheel.ts";
export { createViewportController } from "./interaction/viewportController.ts";
export type { ViewportBounds, ViewportController } from "./interaction/viewportController.ts";
export { createVelocityTracker, decayVelocity, INERTIA_STOP_VELOCITY } from "./interaction/inertia.ts";
export type { VelocityTracker } from "./interaction/inertia.ts";
export { brushRectFromPixels } from "./interaction/brush.ts";
export type { BrushRect } from "./interaction/brush.ts";
