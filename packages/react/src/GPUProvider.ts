import { createContext, createElement, useEffect, useRef, useState, type ReactNode } from "react";
import { GpuRuntime, type GpuRuntimeOptions } from "@gpuc/core";

/** `"fallback"` — WebGPU isn't available but a `Canvas2DScheduler` is running instead
 * (`caps.tier === 'fallback'`); `"unsupported"` — no rendering at all (`caps.tier === 'none'`,
 * `GpuRuntimeOptions.fallback: 'none'`). */
export type GpuStatus = "pending" | "ready" | "fallback" | "unsupported";

export interface GpuContextValue {
  readonly runtime: GpuRuntime | null;
  readonly status: GpuStatus;
}

const PENDING: GpuContextValue = { runtime: null, status: "pending" };

/** `null` outside a `<GPUProvider>`. Read it through `useGpu()`, not directly. */
export const GpuContext = createContext<GpuContextValue | null>(null);

export interface GPUProviderProps {
  readonly options?: GpuRuntimeOptions;
  readonly children?: ReactNode;
}

/**
 * Owns exactly one `GpuRuntime` for its subtree (PLAN.md §10.1, §11.1) — React never owns GPU
 * state itself, it only holds a reference to the runtime and re-renders when its status changes.
 *
 * `options` is read once, on first mount: `GpuRuntime.create()` is async and a runtime's identity
 * (its device, its mounted components) cannot be swapped out from under a live subtree, so a later
 * `options` change is a no-op (with a dev warning) rather than silently creating a second runtime.
 *
 * StrictMode-safe: if the effect's cleanup fires before `create()` resolves (the dev-mode
 * mount→cleanup→mount cycle), the runtime is disposed the moment it *does* resolve instead of
 * being published to state — so a real mount ends with exactly one live, undisposed runtime, and a
 * cancelled one ends with zero.
 */
export function GPUProvider(props: GPUProviderProps) {
  const { options, children } = props;
  const [value, setValue] = useState<GpuContextValue>(PENDING);
  const optionsRef = useRef(options);

  useEffect(() => {
    if (options !== undefined && optionsRef.current !== options) {
      console.warn(
        "@gpuc/react: GPUProvider `options` changed after its runtime was already " +
          "created. The new options are ignored — a provider's runtime is created once, on first " +
          "mount, for its lifetime.",
      );
    }
  }, [options]);

  useEffect(() => {
    let cancelled = false;
    let createdRuntime: GpuRuntime | null = null;

    void GpuRuntime.create(optionsRef.current).then((runtime) => {
      createdRuntime = runtime;
      if (cancelled) {
        runtime.dispose();
        return;
      }
      setValue({
        runtime,
        status: runtime.caps.webgpu ? "ready" : runtime.caps.tier === "fallback" ? "fallback" : "unsupported",
      });
    });

    return () => {
      cancelled = true;
      createdRuntime?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: see options handling above.
  }, []);

  return createElement(GpuContext.Provider, { value }, children);
}
