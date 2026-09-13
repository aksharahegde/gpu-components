import { draw, geometry, storage, type Draw, type Geometry, type Gpu, type StorageBuffer, type Target } from "vgpu";
import { perspectiveCamera, plane, type PerspectiveCamera } from "vgpu/scene";
import { EMPTY_PLAN, type ComponentContext, type GpuComponent, type RenderPlan } from "@gpu-components/core";
import { HERO3D_WGSL } from "./shader.ts";
import { buildHeroScene } from "./data.ts";
import { CAMERA_FAR, CAMERA_FOV_Y_DEG, CAMERA_NEAR, CAMERA_POSITION_Z } from "./cameraSpec.ts";

let nextId = 0;

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
 * `animating` stays `false`: after the first `plan()` call, `dirty` also flips to `false`, so
 * `FrameScheduler` parks this component. A canvas resize flips the *surface's* `dirty` flag (not
 * the component's), which still triggers exactly one more `plan()` call — used here only to update
 * the camera's aspect ratio, not to redo any per-frame work.
 */
export class Hero3DComponent implements GpuComponent<Record<string, never>> {
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
    this.drawable.set({ instances: this.instanceBuffer });
    this.syncCamera(true);
  }

  update(): void {
    // No props: the scene is static for this phase (Phase 3 adds a reveal animation driven by
    // props/time, which will need a real update() body).
  }

  plan(): RenderPlan {
    this.dirty = false;
    if (!this.gpu || !this.drawable) return EMPTY_PLAN;

    this.syncCamera(false);
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
   * `Draw` and `StorageBuffer` have no public disposal — both are reclaimed when the owning `Gpu`
   * disposes, same as `InstancedQuadLayer.dispose()`'s documented no-op. Idempotent: nulling every
   * field makes a second call (StrictMode's double-invoke) a no-op past the first `destroy()`. */
  dispose(): void {
    this.planeGeometry?.destroy();
    this.planeGeometry = null;
    this.drawable = null;
    this.instanceBuffer = null;
    this.camera = null;
    this.gpu = null;
    this.target = null;
  }

  /** Keeps the camera's aspect ratio in sync with the surface's current size. Called once at
   * `create()` (`force: true`) and again from every subsequent `plan()` — which for this static
   * scene only happens on a real resize (`FrameScheduler` re-plans on `surface.dirty`, not just
   * `component.dirty`). `viewProjection` is a stable `Float32Array` identity vgpu updates in
   * place, but a bound `draw()` uniform is a snapshot taken at `.set()` time (per the spike's own
   * note: "only need to call `.set()` again when the camera actually moves"), so the aspect change
   * must re-`.set()` to actually reach the GPU. */
  private syncCamera(force: boolean): void {
    if (!this.camera || !this.target || !this.drawable) return;
    const [width, height] = this.target.size;
    const aspect = width > 0 && height > 0 ? width / height : 1;
    if (!force && aspect === this.lastAspect) return;
    this.lastAspect = aspect;
    this.camera.set({ aspect });
    this.drawable.set({ camera: { viewProjection: this.camera.viewProjection } });
  }
}
