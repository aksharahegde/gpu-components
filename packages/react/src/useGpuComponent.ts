import { useEffect, useRef } from "react";
import type { ComponentContext, GpuComponent } from "@gpu-components/core";
import type { SurfaceOptions } from "vgpu";
import { useGpu } from "./useGpu.ts";

/**
 * Mounts a `GpuComponent` against `canvas` and keeps it in sync with `props` (PLAN.md §9.4,
 * §11.1) — the hook a component wrapper (e.g. `<GPUTimeline>`) calls. Declarative props for *what*
 * (this hook), imperative handle for *how* (the wrapper's own `ref`, not this hook's concern).
 *
 * Two effects, deliberately separate:
 * - `[runtime, status, canvas]` — mount/unmount. Not keyed on `factory`: factories are recreated
 *   every render in idiomatic React and must never trigger a remount.
 * - `[props]` — calls the mounted component's `update(props)`. A prop change never remounts.
 *
 * A no-op while `status !== 'ready'` — pair with `useGpu().status` for a fallback UI; this hook
 * does not need its own unsupported branch.
 */
export function useGpuComponent<Props>(
  factory: (ctx: ComponentContext) => GpuComponent<Props>,
  canvas: HTMLCanvasElement | null,
  props: Props,
  surfaceOpts?: SurfaceOptions,
): void {
  const { runtime, status } = useGpu();
  const componentRef = useRef<GpuComponent<Props> | null>(null);
  const factoryRef = useRef(factory);
  factoryRef.current = factory;

  useEffect(() => {
    if (!runtime || status !== "ready" || !canvas) return;

    const handle = runtime.mount((ctx) => {
      const component = factoryRef.current(ctx);
      componentRef.current = component;
      return component;
    }, canvas, surfaceOpts);

    return () => {
      handle.unmount();
      componentRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `surfaceOpts` intentionally excluded, see useGpuCanvas.
  }, [runtime, status, canvas]);

  useEffect(() => {
    componentRef.current?.update(props);
  }, [props]);
}
