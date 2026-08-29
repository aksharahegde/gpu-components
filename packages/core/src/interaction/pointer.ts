/**
 * Normalized pointer state (PLAN.md §9.5) — DOM-event-source agnostic: a component consumes
 * `PointerState`, never a raw `PointerEvent`, so a future non-React adapter feeds the same shape.
 * v1 is single-pointer only — no capture, no multi-touch tracking (that's `touch.ts`'s job, and
 * touch gestures are explicitly deferred; see `PLAN.md` §29 phase 3's own risk note that touch/
 * trackpad normalization is "historically the buggiest area").
 */
export interface PointerState {
  /** Element-local CSS pixels, relative to the target's bounding box at listen time. */
  readonly x: number;
  readonly y: number;
  readonly buttons: number;
  readonly dragging: boolean;
}

export interface PointerController {
  readonly state: PointerState;
  /** Attaches listeners to `target`. Returns the detach function. */
  attach(target: EventTarget): () => void;
  onMove(cb: (state: PointerState) => void): () => void;
  onDown(cb: (state: PointerState) => void): () => void;
  onUp(cb: (state: PointerState) => void): () => void;
  /** Fires with `null` when the pointer leaves the attached target — the signal a hover consumer
   * needs to clear its highlight, distinct from a move to some other (x, y). */
  onLeave(cb: () => void): () => void;
}

const INITIAL_STATE: PointerState = { x: 0, y: 0, buttons: 0, dragging: false };

export function createPointerController(): PointerController {
  let state = INITIAL_STATE;
  const moveListeners = new Set<(state: PointerState) => void>();
  const downListeners = new Set<(state: PointerState) => void>();
  const upListeners = new Set<(state: PointerState) => void>();
  const leaveListeners = new Set<() => void>();

  function localState(target: EventTarget, e: PointerEvent): PointerState {
    const rect = (target as Element).getBoundingClientRect?.();
    const x = rect ? e.clientX - rect.left : e.clientX;
    const y = rect ? e.clientY - rect.top : e.clientY;
    return { x, y, buttons: e.buttons, dragging: e.buttons !== 0 };
  }

  return {
    get state() {
      return state;
    },
    attach(target) {
      const onPointerMove = (e: Event) => {
        state = localState(target, e as PointerEvent);
        for (const cb of moveListeners) cb(state);
      };
      const onPointerDown = (e: Event) => {
        state = localState(target, e as PointerEvent);
        for (const cb of downListeners) cb(state);
      };
      const onPointerUp = (e: Event) => {
        state = localState(target, e as PointerEvent);
        for (const cb of upListeners) cb(state);
      };
      const onPointerLeave = () => {
        state = { ...state, dragging: false };
        for (const cb of leaveListeners) cb();
      };

      target.addEventListener("pointermove", onPointerMove);
      target.addEventListener("pointerdown", onPointerDown);
      target.addEventListener("pointerup", onPointerUp);
      target.addEventListener("pointercancel", onPointerUp);
      target.addEventListener("pointerleave", onPointerLeave);

      return () => {
        target.removeEventListener("pointermove", onPointerMove);
        target.removeEventListener("pointerdown", onPointerDown);
        target.removeEventListener("pointerup", onPointerUp);
        target.removeEventListener("pointercancel", onPointerUp);
        target.removeEventListener("pointerleave", onPointerLeave);
      };
    },
    onMove(cb) {
      moveListeners.add(cb);
      return () => moveListeners.delete(cb);
    },
    onDown(cb) {
      downListeners.add(cb);
      return () => downListeners.delete(cb);
    },
    onUp(cb) {
      upListeners.add(cb);
      return () => upListeners.delete(cb);
    },
    onLeave(cb) {
      leaveListeners.add(cb);
      return () => leaveListeners.delete(cb);
    },
  };
}
