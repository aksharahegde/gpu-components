import { useEffect, useState } from "react";
import type { SurfaceHandle } from "@gpuc/core";
import type { SurfaceOptions } from "vgpu";
import { useGpu } from "./useGpu.ts";

/**
 * Low-level primitive (PLAN.md §9.1): registers a live `SurfaceHandle` for `canvas` without
 * owning a component's lifecycle. Most consumers want `useGpuComponent` instead — this exists for
 * callers that draw against the surface themselves.
 *
 * `opts` is read once, at first registration — `vgpu`'s `surface()` has no reconfigure path
 * either, so a later change would be misleading to accept silently.
 */
export function useGpuCanvas(
  canvas: HTMLCanvasElement | null,
  opts?: SurfaceOptions,
): SurfaceHandle | null {
  const { runtime, status } = useGpu();
  const [handle, setHandle] = useState<SurfaceHandle | null>(null);

  useEffect(() => {
    if (!runtime || status !== "ready" || !canvas) {
      setHandle(null);
      return;
    }
    // `status === "ready"` (checked above) guarantees `caps.tier === "gpu"`, so this is always a
    // `SurfaceHandle` in practice — `registerSurface()`'s return type is a union only because it
    // is also reachable in fallback mode via `useGpuComponent`'s different path.
    const surface = runtime.registerSurface(canvas, opts) as SurfaceHandle;
    setHandle(surface);
    return () => {
      runtime.unregisterSurface(canvas);
      setHandle(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `opts` intentionally excluded, see above.
  }, [runtime, status, canvas]);

  return handle;
}
