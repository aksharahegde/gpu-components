import {
  draw,
  geometry,
  storage,
  uniforms,
  type Draw,
  type Geometry,
  type Gpu,
  type SharedUniforms,
  type StorageBuffer,
  type Target,
} from "vgpu";
import { orbitControls, perspectiveCamera, plane, type OrbitControls, type PerspectiveCamera } from "vgpu/scene";
import { EMPTY_PLAN, type ComponentContext, type FrameContext, type GpuComponent, type RenderPlan } from "@gpu-components/core";
import { HERO3D_WGSL } from "./shader.ts";
import { buildHeroScene, COLLAPSED_DEPTH, WAYPOINTS, journeyPose } from "./data.ts";
import { CAMERA_FAR, CAMERA_FOV_Y_DEG, CAMERA_NEAR, CAMERA_POSITION_Z } from "./cameraSpec.ts";

let nextId = 0;

export interface Hero3DProps {
  readonly reducedMotion: boolean;
  /** Normalized pointer position within the hero's canvas, each in [-1, 1]; `null` when the
   * pointer isn't hovering the hero region (or has left it). */
  readonly pointerX: number | null;
  readonly pointerY: number | null;
  /** 0 = settled/in view, 1 = fully collapsed for scroll-out. Driven directly by scroll position
   * (the host's own gesture, so no extra easing) — see `Hero3D.tsx`. */
  readonly scrollCollapse: number;
  /** 0 = waypoint 1 (today's settled hero pose), 1 = the last of `data.ts`'s `WAYPOINTS`.
   * Continuous — `update()` lerps the bracketing pair via `journeyPose()` and drives the camera's
   * `target`/`distance` straight off it, no separate easing (same reasoning as `scrollCollapse`
   * below: the input already rides the reader's own scroll gesture). Phase 1: `Hero3D.tsx`
   * temporarily reuses `scrollCollapse`'s exact scroll range for this — a real multi-section range
   * is Phase 3's job. */
  readonly journeyT: number;
}

/** One-time mount reveal: how long the collapse -> separate animation takes. */
const REVEAL_DURATION_S = 1.2;

/** Caps how much of the reveal a single `plan()` tick can consume. A first-paint browser stall
 * (adapter/surface warm-up, first GPU submit — a real, measured ~250-300ms gap between the first
 * two frame-loop ticks, GPU compile aside) would otherwise eat a quarter of the 1.2s budget in one
 * jump if the reveal read raw wall-clock elapsed time; accumulating a *clamped* `deltaTime` instead
 * is the standard fixed-step-adjacent fix for "one slow tick shouldn't fast-forward the animation"
 * (the same family of fix as a physics loop's max substep), and degrades gracefully on a genuinely
 * slow device — the reveal just runs a bit longer in wall time, never skips frames of motion. */
const MAX_REVEAL_STEP_S = 1 / 20;

/** `apps/site/src/heroMotion.stylex.ts`'s `EASE` — matched exactly so this reveal reads as the same
 * motion language as every other hero entrance animation on the page (CSS can't drive a WebGPU
 * uniform, so the curve is re-evaluated here in JS rather than shared via import). */
const BEZIER_X1 = 0.16;
const BEZIER_Y1 = 1;
const BEZIER_X2 = 0.3;
const BEZIER_Y2 = 1;

function bezierComponent(t: number, p1: number, p2: number): number {
  const mt = 1 - t;
  return 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t;
}

function bezierDerivative(t: number, p1: number, p2: number): number {
  const mt = 1 - t;
  return 3 * mt * mt * p1 + 6 * mt * t * (p2 - p1) + 3 * t * t * (1 - p2);
}

/** Newton-Raphson solve for `t` given `x` (CSS's `cubic-bezier()` is a parametric x(t)/y(t) curve,
 * not a plain function of x), then evaluates y(t). Eight iterations is comfortably enough to
 * converge for this curve's shape; clamped to [0, 1] so a stray overshoot can't produce a t outside
 * the curve's domain. */
function revealEase(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  let t = x;
  for (let i = 0; i < 8; i++) {
    const dx = bezierComponent(t, BEZIER_X1, BEZIER_X2) - x;
    const d = bezierDerivative(t, BEZIER_X1, BEZIER_X2);
    if (Math.abs(d) < 1e-6) break;
    t = Math.min(1, Math.max(0, t - dx / d));
  }
  return bezierComponent(t, BEZIER_Y1, BEZIER_Y2);
}

/** Pointer-parallax range: the camera's yaw/pitch offset while hovering never exceeds this. */
const PARALLAX_MAX_RAD = (4 * Math.PI) / 180;

/** `OrbitControls`' damping time constant (seconds, ~63% convergence) — high enough that the
 * parallax reads as weight/inertia following the pointer, not an instant snap. */
const PARALLAX_DAMPING_S = 0.35;

interface SceneUniforms extends Record<string, unknown> {
  readonly sceneT: number;
  readonly collapsedZ: number;
  /** Camera world position, re-set whenever `syncCamera` runs (i.e. whenever the camera actually
   * moved — resize or orbit). `shader.ts`'s fragment stage uses it for the Phase 2 near-plane fade
   * (distance from camera), not anything Phase 1 needs on its own. */
  readonly cameraPos: Float32Array;
}

/**
 * The static "Stacked Surfaces" hero (Phase 1+2 of the 5-phase plan — `spikes/hero3d-vgpu-
 * feasibility.md` is Phase 0's de-risking spike this component builds on directly). A real
 * `GpuComponent`, mounted the same way every other homepage GPU surface is (`useGpuComponent` on
 * `LandingGpu`'s shared runtime) — the hero rides the product's own scheduler/runtime contract
 * rather than a second, independent GPU context, which is the whole point of its own copy's "one
 * shared runtime" claim.
 *
 * One `perspectiveCamera()`, one `geometry(gpu, plane())`, one storage buffer of ~350 per-instance
 * quads (`data.ts`'s five depth layers), one `draw()` call, `blend: "alpha"`, `depth: false` — the
 * spike proved every one of those pieces works on a depth-less target with correct back-to-front
 * compositing. Unlike the spike, each instance carries a real per-instance affine transform
 * (in-plane translate + non-uniform scale, not just a Z offset reinterpreting mesh axes — see
 * `shader.ts`'s doc comment), and the depth order is baked into the instance buffer's write order
 * once at `create()` rather than computed per frame: this phase's camera and layer positions are
 * static (no reveal animation yet — that's Phase 3), so there is nothing to re-sort.
 *
 * **Phase 3 adds motion**, but the parked-when-idle contract above still holds — `animating` only
 * goes `true` while there is real work: the one-time mount reveal (a per-instance Z lerp, driven by
 * a `scene.sceneT` uniform, not a per-instance CPU rewrite), pointer parallax (a damped
 * `vgpu` `OrbitControls` yaw/pitch offset, easing toward whatever the host's pointer position
 * reports and back to neutral when it leaves), and scroll collapse (folded straight into
 * `sceneT`, no separate easing — it already rides the reader's own scroll gesture). Once the
 * reveal has settled, the pointer is idle at its goal, and scroll collapse isn't changing,
 * `animating` drops back to `false` and `FrameScheduler` parks this component exactly as before.
 * `prefers-reduced-motion` (`Hero3D.tsx`'s `usePrefersReducedMotion`) skips the reveal and disables
 * both pointer parallax and scroll collapse — `update()` snaps straight to the settled pose.
 */
export class Hero3DComponent implements GpuComponent<Hero3DProps> {
  readonly id = `hero3d-${nextId++}`;
  dirty = true;
  animating = false;

  private gpu: Gpu | null = null;
  private target: Target | null = null;
  private camera: PerspectiveCamera | null = null;
  private planeGeometry: Geometry | null = null;
  private drawable: Draw | null = null;
  private instanceBuffer: StorageBuffer | null = null;
  private instanceCount = 0;
  private lastAspect = 0;

  private orbit: OrbitControls | null = null;
  private sceneUniforms: SharedUniforms<SceneUniforms> | null = null;

  private reducedMotion = false;
  /** Seconds of reveal clock consumed so far — a clamped-`deltaTime` accumulator, not a raw
   * `frame.time` delta; see `MAX_REVEAL_STEP_S`. */
  private revealElapsed = 0;
  /** Eased 0..1: 0 = collapsed (t=0 pose), 1 = fully separated/settled. Monotonic once started. */
  private revealProgress = 0;
  /** 0..1 from the host's scroll tracking; folds directly into `sceneT` alongside `revealProgress`. */
  private scrollCollapse = 0;
  private lastPointerGoal = { yaw: 0, pitch: 0 };
  private lastSceneT = -1;
  /** Last `journeyT` the orbit's `target`/`distance` were set from — `-1` never matches a clamped
   * `[0, 1]` input, so the first `update()` always applies waypoint 1's pose. */
  private lastJourneyT = -1;

  create(ctx: ComponentContext): void {
    this.gpu = ctx.gpu;
    this.target = ctx.surface.surface;
    if (!ctx.gpu) {
      // HeroStage only mounts this component when `status === 'ready'` (`caps.tier === 'gpu'`) —
      // see its own doc comment for why the fallback ladder never reaches here without a `Gpu`.
      // Guarded anyway: a component that assumes its own preconditions is exactly the kind of bug
      // PLAN.md's device-loss/StrictMode culture exists to catch early.
      return;
    }
    const gpu = ctx.gpu;

    const { instances, count } = buildHeroScene();
    this.instanceCount = count;

    this.camera = perspectiveCamera({
      fov: CAMERA_FOV_Y_DEG,
      near: CAMERA_NEAR,
      far: CAMERA_FAR,
      position: [0, 0, CAMERA_POSITION_Z],
      target: [0, 0, 0],
    });

    this.planeGeometry = geometry(gpu, plane({ width: 2, height: 2 }));
    this.instanceBuffer = storage(gpu, instances.byteLength, "read");
    this.instanceBuffer.write(instances);
    // `collapsedZ` is set once and never changes — a scene-wide constant, not per-frame state.
    // `cameraPos` is re-set from `syncCamera` below once the camera exists (`create()` order:
    // camera is constructed above, so its `worldPosition` is already valid here).
    this.sceneUniforms = uniforms(gpu, {
      sceneT: 0,
      collapsedZ: COLLAPSED_DEPTH,
      cameraPos: this.camera.worldPosition,
    });

    this.drawable = draw(gpu, {
      shader: HERO3D_WGSL,
      geometry: this.planeGeometry,
      instances: this.instanceCount,
      blend: "alpha",
      cull: "none",
      // Ignored anyway (the surface this mounts on has no depth attachment — PLAN.md's spike
      // confirmed `draw.d.ts`'s "Ignored when the target has no depth" at runtime), kept explicit
      // for the same documentation reason the spike kept it.
      depth: false,
      label: this.id,
    });
    this.drawable.set({ instances: this.instanceBuffer, scene: this.sceneUniforms });
    this.syncCamera(true);

    // `Draw` compiles its `GPURenderPipeline` lazily, on the first real draw call (`draw.d.ts`:
    // "Nothing here exists until the first render call"). Left lazy, that compile would land
    // inside the *first* `plan()` call — one more real cost stacked onto `MAX_REVEAL_STEP_S`'s
    // clamp below rather than avoided outright. Forcing it here keeps that cost off the reveal's
    // frame budget entirely instead of relying on the clamp to absorb it too.
    // A live `Surface` `Target` can only be read from inside `frame(gpu)` (`VGPU-SURFACE-NOT-IN-
    // FRAME`), which `create()` isn't — but `format`/`sampleCount` are the surface's fixed
    // creation-time properties, not a per-frame texture, so a plain `TargetSignature` built from
    // them compiles the real pipeline without needing an active frame.
    this.drawable.compileSync({ colors: [this.target.format], sampleCount: this.target.sampleCount });

    // Programmatic-only (no `element`): this is ambient pointer parallax, not drag-to-orbit — the
    // goal is set from `update()`'s pointer props, never from a pointerdown/move on this canvas.
    // Orbiting around the camera's own look-at target with its initial distance/yaw/pitch (derived
    // from the constructed pose) means a goal of {yaw: 0, pitch: 0} is exactly the settled camera —
    // reusing `OrbitControls`' damped-goal easing instead of hand-rolling one gets the "weight,
    // not a snap" feel from `update(deltaTime)`'s exponential approach for free.
    this.orbit = orbitControls(this.camera, {
      target: [0, 0, 0],
      damping: PARALLAX_DAMPING_S,
      pitch: { min: -PARALLAX_MAX_RAD, max: PARALLAX_MAX_RAD },
    });
  }

  update(props: Hero3DProps): void {
    this.reducedMotion = props.reducedMotion;

    if (this.reducedMotion) {
      // Skip straight to the settled state: reveal complete, camera neutral, no scroll collapse.
      // `orbit.set()` jumps both the current and goal state immediately (no easing) per its own
      // doc, so this can't be caught mid-motion by a late `reducedMotion` flip either.
      if (this.revealProgress !== 1) {
        this.revealProgress = 1;
        this.dirty = true;
      }
      this.scrollCollapse = 0;
      // Also locks the journey to waypoint 1 — `Hero3D.tsx` doesn't even track scroll while
      // reduced motion is on, so `journeyT` would already read 0, but setting it explicitly here
      // means this branch alone is enough to guarantee the settled pose, the same contract the
      // rest of this `if` already keeps for yaw/pitch/reveal/scroll.
      const settled = WAYPOINTS[0]!;
      this.lastJourneyT = 0;
      this.orbit?.set({ yaw: 0, pitch: 0, target: [0, 0, settled.targetZ], distance: settled.distance });
      return;
    }

    const yaw = (props.pointerX ?? 0) * PARALLAX_MAX_RAD;
    const pitch = (props.pointerY ?? 0) * PARALLAX_MAX_RAD;
    if (yaw !== this.lastPointerGoal.yaw || pitch !== this.lastPointerGoal.pitch) {
      this.lastPointerGoal = { yaw, pitch };
      this.orbit?.set({ yaw, pitch });
      this.dirty = true; // wakes the scheduler if this component had gone idle
    }

    if (props.scrollCollapse !== this.scrollCollapse) {
      this.scrollCollapse = props.scrollCollapse;
      this.dirty = true;
    }

    const journeyT = Math.min(1, Math.max(0, props.journeyT));
    if (journeyT !== this.lastJourneyT) {
      this.lastJourneyT = journeyT;
      const { targetZ, distance } = journeyPose(journeyT);
      // `OrbitControls.set()` jumps `target`/`distance` immediately (no easing of its own) — fine
      // here since `journeyT` is already a continuous scroll-driven signal, exactly like
      // `scrollCollapse`/`sceneT` above; layering damping on top would just add lag to a value
      // that's already smooth.
      this.orbit?.set({ target: [0, 0, targetZ], distance });
      this.dirty = true;
    }
  }

  plan(frame: FrameContext): RenderPlan {
    this.dirty = false;
    if (!this.gpu || !this.drawable) return EMPTY_PLAN;

    let stillAnimating = false;

    // One-time reveal: eased elapsed time since this component's first plan() call, accumulated
    // from a clamped deltaTime (see `MAX_REVEAL_STEP_S`) so a slow first tick can't fast-forward
    // it. Reduced motion already snapped `revealProgress` to 1 in `update()`, so this is a no-op.
    if (this.revealProgress < 1) {
      this.revealElapsed += Math.min(frame.deltaTime, MAX_REVEAL_STEP_S);
      const linear = Math.min(1, this.revealElapsed / REVEAL_DURATION_S);
      this.revealProgress = linear >= 1 ? 1 : revealEase(linear);
      if (linear < 1) stillAnimating = true;
    }

    // Pointer parallax: ease the camera toward whatever goal `update()` last set. `orbit.update()`
    // returns `false` once yaw/pitch/distance have converged, so a settled, pointer-away hero does
    // no work here at all beyond this one boolean check.
    const cameraMoved = !this.reducedMotion && (this.orbit?.update(frame.deltaTime) ?? false);
    if (cameraMoved) stillAnimating = true;
    this.syncCamera(cameraMoved);

    // Scroll collapse rides the reader's own scroll gesture — no independent easing, so it never
    // holds `animating` true on its own; `update()` already flips `dirty` when it actually changes.
    const sceneT = this.revealProgress * (1 - this.scrollCollapse);
    if (sceneT !== this.lastSceneT) {
      this.lastSceneT = sceneT;
      this.sceneUniforms?.set({ sceneT });
    }

    this.animating = stillAnimating;

    const drawable = this.drawable;
    const instanceCount = this.instanceCount;

    return {
      computePasses: [],
      renderPasses: [
        {
          name: "hero3d",
          target: "surface",
          clear: true,
          encode: (pass) => {
            if (pass.kind !== "gpu") return; // no Canvas2D fallback for this component — see HeroStage
            pass.frame.draw(drawable, { instances: instanceCount });
          },
        },
      ],
    };
  }

  /** `planeGeometry` is the one resource here with a real `destroy()` (`geometry-descriptor.ts`).
   * `Draw`, `StorageBuffer` and `SharedUniforms` have no public disposal — all three are reclaimed
   * when the owning `Gpu` disposes, same as `InstancedQuadLayer.dispose()`'s documented no-op.
   * `OrbitControls.dispose()` only matters when it owns DOM listeners (this one has none —
   * programmatic-only, see `create()`), but it's still called and nulled for the same idempotent
   * StrictMode double-invoke reason as every other field here. */
  dispose(): void {
    this.planeGeometry?.destroy();
    this.planeGeometry = null;
    this.drawable = null;
    this.instanceBuffer = null;
    this.sceneUniforms = null;
    this.orbit?.dispose();
    this.orbit = null;
    this.camera = null;
    this.gpu = null;
    this.target = null;
  }

  /** Keeps the camera's aspect ratio in sync with the surface's current size, and re-pushes
   * `viewProjection` to the GPU whenever the pose actually changed. Called with `force: true` from
   * `create()` and whenever `plan()`'s `orbit.update()` moved the camera (pointer parallax);
   * otherwise it only does anything on a real resize (`FrameScheduler` re-plans on `surface.dirty`,
   * not just `component.dirty`). `viewProjection` is a stable `Float32Array` identity vgpu updates
   * in place, but a bound `draw()` uniform is a snapshot taken at `.set()` time (per the spike's own
   * note: "only need to call `.set()` again when the camera actually moves"), so both a resize and
   * an orbit move must re-`.set()` to actually reach the GPU. */
  private syncCamera(force: boolean): void {
    if (!this.camera || !this.target || !this.drawable) return;
    const [width, height] = this.target.size;
    const aspect = width > 0 && height > 0 ? width / height : 1;
    if (!force && aspect === this.lastAspect) return;
    this.lastAspect = aspect;
    this.camera.set({ aspect });
    this.drawable.set({ camera: { viewProjection: this.camera.viewProjection } });
    // Phase 2's near-plane fade (`shader.ts`) needs the camera's current world position, not just
    // its projection — re-push it alongside `viewProjection` any time either could have changed
    // (a resize doesn't move the camera, but re-setting the same value is harmless).
    this.sceneUniforms?.set({ cameraPos: this.camera.worldPosition });
  }
}
