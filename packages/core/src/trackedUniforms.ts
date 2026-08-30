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

  const originalSet = inner.set.bind(inner);

  // Wrap `set` *on the real uniform object* rather than returning a `{ set }` stand-in.
  //
  // This is load-bearing, and getting it wrong cost this project a silently blank canvas. A bare
  // `{ set }` object satisfies the `SharedUniforms<T>` type — that is all the public type
  // structurally requires — but `uniforms()` returns a real GPU-backed resource whose *other*
  // members are what `draw.set({ viewport: … })` binds. Hand vgpu the stand-in and the binding
  // resolves to nothing: the shader reads an all-zero uniform block, `trackToClip` becomes
  // `[0, 0]`, every span quad collapses to zero height, and the component renders a perfectly
  // clean, perfectly empty frame — no error, no warning, no failed test.
  //
  // Mutating in place keeps the object's identity, prototype and internals intact, so vgpu's
  // bind-group cache (which is keyed by resource identity) sees exactly the object it made.
  inner.set = (values: Partial<T>) => {
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
    originalSet(values);
  };

  return inner;
}
