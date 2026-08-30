import { uniforms, type Gpu, type SharedUniforms } from "vgpu";
import type { WarningsLog } from "./warnings.ts";

/** After this many consecutive `.set()` calls with an unchanged value, report the anti-pattern once
 * (then the `WarningsLog`'s own dedup/count mechanism accumulates further repeats — no re-threshold
 * needed). Not 1: a single incidental repeat (e.g. two renders in a row with the same viewport) is
 * normal, not a bug — this is for the sustained "every frame, unconditionally" pattern §28.2 means. */
const UNCHANGED_WARN_THRESHOLD = 30;

function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => Object.is(a[key], b[key]));
}

/**
 * Wraps `uniforms(gpu, initial)` (PLAN.md §28.2's "uniform writes with no change" anti-pattern):
 * `vgpu`'s own `set()` "performs no equality check — a value written every frame is uploaded every
 * frame" (already relied on elsewhere in this codebase, e.g. `FrameScheduler`'s own doc comment) —
 * this wrapper adds the *detection* on top, without changing that upload behavior at all. Every
 * `.set()` call still forwards to the real `vgpu` uniform underneath; this only watches.
 */
export function trackedUniforms<T extends Record<string, unknown>>(
  gpu: Gpu,
  initial: T,
  warnings: WarningsLog,
  source: string,
): SharedUniforms<T> {
  const inner = uniforms(gpu, initial);
  let lastValue: Partial<T> | null = null;
  let unchangedStreak = 0;

  return {
    set(values: Partial<T>) {
      if (lastValue && shallowEqual(lastValue, values)) {
        unchangedStreak++;
        if (unchangedStreak === UNCHANGED_WARN_THRESHOLD) {
          warnings.report({
            code: "redundant-uniform-write",
            source,
            message: `set() called ${unchangedStreak}x in a row with an unchanged value — hoist out of the loop`,
          });
        }
      } else {
        unchangedStreak = 0;
      }
      lastValue = { ...values };
      inner.set(values);
    },
  };
}
