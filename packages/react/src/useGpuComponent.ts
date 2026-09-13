import { useEffect, useRef } from "react";
import type { ComponentContext, GpuComponent } from "@gpuc/core";
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
 * A no-op unless `status` is `'ready'` or `'fallback'` — pair with `useGpu().status` for an
 * unsupported-browser UI; this hook does not need its own unsupported branch. `'fallback'` mounts
 * the same way `'ready'` does: `runtime.mount()` picks the Canvas2D scheduler internally based on
 * `caps.tier`, so this hook needs no branch of its own for it.
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
  const propsRef = useRef(props);
  propsRef.current = props;
  /** The component instance that has already received at least one `update()`. */
  const seeded = useRef<GpuComponent<Props> | null>(null);

  useEffect(() => {
    if (!runtime || (status !== "ready" && status !== "fallback") || !canvas) return;

    const handle = runtime.mount((ctx) => {
      const component = factoryRef.current(ctx);
      componentRef.current = component;
      return component;
    }, canvas, surfaceOpts);

    // Seed the newly mounted component with the props it already has, unless the update effect
    // below already got there first.
    //
    // Without this, a caller that memoises its props object never delivers the first update and
    // renders nothing at all. The canvas arrives through `setState` from a ref callback, so this
    // mount effect cannot run until render #2 — by which time a memoised `props` has not changed,
    // so the `[props]` effect does not re-fire and `update()` is never called on the component
    // that now exists. Passing a fresh object literal every render hides the bug, which is what
    // `GPUTimeline` happened to do; `GPUHeatmap` memoised its props, as the React docs encourage,
    // and rendered a blank canvas.
    //
    // Deferred to a microtask rather than called inline: an inline call re-enters while the mount
    // effect is still running, which deadlocks a component whose `update()` touches the scheduler.
    // By the time the microtask runs, React has flushed the effects for this commit, so the
    // `seeded` guard correctly sees whether the update effect already delivered.
    queueMicrotask(() => {
      const component = componentRef.current;
      if (!component || seeded.current === component) return;
      seeded.current = component;
      component.update(propsRef.current);
    });

    return () => {
      handle.unmount();
      componentRef.current = null;
      seeded.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `surfaceOpts` intentionally excluded, see useGpuCanvas.
  }, [runtime, status, canvas]);

  useEffect(() => {
    const component = componentRef.current;
    if (!component) return;
    // Records that this instance has been seeded, so the mount effect's microtask does not deliver
    // the same props a second time.
    seeded.current = component;
    component.update(props);
  }, [props]);
}
