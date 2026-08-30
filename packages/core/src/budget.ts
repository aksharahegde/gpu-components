import type { Capabilities } from "./capabilities.ts";
import type { WarningsLog } from "./warnings.ts";

/**
 * Device-limit enforcement (PLAN.md §24.2, §14.3).
 *
 * `Capabilities` has probed `maxComputeWorkgroupsPerDimension`, `maxStorageBufferBindingSize` and
 * `maxBufferSize` since Phase 1, and until now **nothing read any of them**. The whole budget story
 * §24 describes was a probe with no consumer, which is the worst of both worlds: the numbers looked
 * enforced and were not.
 *
 * §24.1 ranks "untrusted *data* causing GPU denial of service" as the top threat, and the two
 * mechanisms it names are exactly these — an unclamped dispatch derived from data ("the easiest GPU
 * hang to write") and an unbounded allocation. This module is where both are stopped.
 */

/**
 * Thrown when a request cannot fit within the device's limits, carrying the actual numbers rather
 * than a generic failure — §14.3: "a typed `GpuBudgetExceededError` (carrying requested vs
 * available bytes)… Exceeding the total budget produces a typed error with the actual numbers, not
 * a silent GPU crash."
 */
export class GpuBudgetExceededError extends Error {
  readonly resource: string;
  readonly requestedBytes: number;
  readonly availableBytes: number;
  /** How many elements of `stride` bytes *would* have fit, when the caller supplied a stride. */
  readonly maxElements: number | undefined;

  constructor(resource: string, requestedBytes: number, availableBytes: number, stride?: number) {
    const maxElements = stride && stride > 0 ? Math.floor(availableBytes / stride) : undefined;
    super(
      `gpu-components: ${resource} needs ${formatBytes(requestedBytes)} but this device allows ` +
        `${formatBytes(availableBytes)}` +
        (maxElements === undefined ? "" : ` (about ${maxElements.toLocaleString("en-US")} elements)`) +
        `. Reduce the dataset, or split it across components.`,
    );
    this.name = "GpuBudgetExceededError";
    this.resource = resource;
    this.requestedBytes = requestedBytes;
    this.availableBytes = availableBytes;
    this.maxElements = maxElements;
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} B`;
}

/**
 * Throws before allocating a storage buffer that the device cannot bind.
 *
 * Checked against both limits because they constrain different things: `maxBufferSize` is the
 * largest buffer that can exist, `maxStorageBufferBindingSize` the largest range a shader can bind
 * — commonly 128MiB, and the one that bites first.
 *
 * A `caps` with zero limits (`NO_WEBGPU_CAPABILITIES`, or a hand-built one in a test) disables the
 * check rather than failing everything: a limit of zero means "not probed", not "nothing allowed".
 */
export function assertBufferBudget(
  caps: Pick<Capabilities, "maxStorageBufferBindingSize" | "maxBufferSize">,
  bytes: number,
  resource: string,
  stride?: number,
): void {
  if (!Number.isFinite(bytes) || bytes < 0) {
    throw new GpuBudgetExceededError(resource, bytes, 0, stride);
  }
  const limits = [caps.maxStorageBufferBindingSize, caps.maxBufferSize].filter((n) => n > 0);
  if (limits.length === 0) return;
  const available = Math.min(...limits);
  if (bytes > available) throw new GpuBudgetExceededError(resource, bytes, available, stride);
}

/** Largest element count that fits the device's storage-buffer limit at `stride` bytes each. */
export function maxElementsFor(
  caps: Pick<Capabilities, "maxStorageBufferBindingSize" | "maxBufferSize">,
  stride: number,
): number {
  const limits = [caps.maxStorageBufferBindingSize, caps.maxBufferSize].filter((n) => n > 0);
  if (limits.length === 0 || stride <= 0) return Number.MAX_SAFE_INTEGER;
  return Math.floor(Math.min(...limits) / stride);
}

export interface DispatchOptions {
  /** Reports a clamp through the inspector's warnings pane rather than failing silently (§17.3). */
  readonly warnings?: WarningsLog;
  readonly source?: string;
}

/**
 * Workgroup count for `itemCount` items, clamped to what the device accepts.
 *
 * §24.2: "Clamp every dispatch against `maxComputeWorkgroupsPerDimension`. Compute a dispatch count
 * from data, then clamp, then assert." Clamping is what prevents the invalid dispatch; the warning
 * is the "assert" half, because a clamp means some of the data was not processed and §17.3 forbids
 * degrading without saying so. In practice a dataset large enough to clamp will already have failed
 * `assertBufferBudget` with a clearer message — this is the backstop for the case where it does not.
 */
export function dispatchWorkgroups(
  caps: Pick<Capabilities, "maxComputeWorkgroupsPerDimension">,
  itemCount: number,
  workgroupSize: number,
  options: DispatchOptions = {},
): number {
  if (!Number.isFinite(itemCount) || itemCount <= 0) return 0;
  const wanted = Math.ceil(itemCount / Math.max(1, workgroupSize));
  const limit = caps.maxComputeWorkgroupsPerDimension;
  if (limit <= 0 || wanted <= limit) return wanted;

  options.warnings?.report({
    code: "dispatch-clamped",
    source: options.source ?? "dispatch",
    message:
      `dispatch of ${wanted.toLocaleString("en-US")} workgroups exceeds the device limit of ` +
      `${limit.toLocaleString("en-US")} — clamped, so ` +
      `${(itemCount - limit * workgroupSize).toLocaleString("en-US")} items were not processed`,
  });
  return limit;
}
