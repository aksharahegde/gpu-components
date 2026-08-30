/**
 * Inertial-pan kinematics (PLAN.md Phase 3, §9.5's interaction-primitives contract). Pure math, no
 * `requestAnimationFrame` loop and no event listeners — same "DOM-event-source agnostic" shape as
 * `wheel.ts`/`pointer.ts`: the caller (a React/Vue/vanilla adapter) owns the animation loop and feeds
 * this real timestamps/deltas. Scoped to *pan* momentum only — the standard case (map/timeline
 * trackpad-swipe momentum); zoom-with-momentum is unusual UX and not implemented here.
 */

export interface VelocityTracker {
  /** Records one observed `delta` (e.g. a wheel event's `deltaX`, in px) over `dtMs` since the
   * previous sample. */
  record(delta: number, dtMs: number): void;
  /** Current estimated velocity, in `delta`-units per ms — an exponential moving average over
   * recent samples, not just the last one, so one noisy sample doesn't launch inertia at the wrong
   * speed. */
  velocity(): number;
  reset(): void;
}

/** EMA weight for the newest sample — low enough that a single outlier delta (a stuttered wheel
 * event) doesn't dominate the launch velocity, high enough that a real, sustained gesture is
 * reflected within a few samples, not lagging behind it. */
const VELOCITY_SMOOTHING = 0.35;

export function createVelocityTracker(): VelocityTracker {
  let v = 0;
  return {
    record(delta, dtMs) {
      if (dtMs <= 0) return;
      const sample = delta / dtMs;
      v = v === 0 ? sample : v + (sample - v) * VELOCITY_SMOOTHING;
    },
    velocity() {
      return v;
    },
    reset() {
      v = 0;
    },
  };
}

/** Exponential decay: `velocity` halves every `halfLifeMs`. Returns the velocity after `dtMs` have
 * elapsed — call once per animation frame with that frame's real `dtMs`. */
export function decayVelocity(velocity: number, dtMs: number, halfLifeMs = 200): number {
  return velocity * Math.pow(0.5, dtMs / halfLifeMs);
}

/** Below this magnitude (delta-units/ms), inertia is considered settled — the caller's animation
 * loop should stop rather than keep scheduling frames for an imperceptible drift. */
export const INERTIA_STOP_VELOCITY = 0.02;
