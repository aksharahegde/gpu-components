import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { target, uniforms, type Target } from "vgpu";
import { createMockGpu, tick } from "@gpu-components/testing";
import { FrameScheduler } from "./scheduler.ts";
import { EMPTY_PLAN } from "./component.ts";
import type { ComputePass, GpuComponent, RenderPass, RenderPlan } from "./component.ts";
import type { SurfaceLike } from "./surface.ts";

function fakeSurface(surfaceTarget: Target): SurfaceLike {
  let dirty = true;
  return {
    surface: surfaceTarget,
    get dirty() {
      return dirty;
    },
    clearDirty: () => {
      dirty = false;
    },
    markDirty: () => {
      dirty = true;
    },
  };
}

class RecordingComponent implements GpuComponent {
  readonly id: string;
  private readonly renderTarget: Target;
  planCalls = 0;
  dispatchCalls = 0;
  encodeCalls = 0;
  dirty = true;
  animating = false;

  constructor(id: string, renderTarget: Target) {
    this.id = id;
    this.renderTarget = renderTarget;
  }

  create(): void {}
  update(): void {
    this.dirty = true;
  }

  plan(): RenderPlan {
    this.planCalls += 1;
    const compute: ComputePass = {
      name: `${this.id}-compute`,
      dispatch: () => {
        this.dispatchCalls += 1;
      },
    };
    const render: RenderPass = {
      name: `${this.id}-render`,
      target: this.renderTarget,
      clear: true,
      encode: () => {
        this.encodeCalls += 1;
      },
    };
    this.dirty = false;
    return { computePasses: [compute], renderPasses: [render] };
  }

  dispose(): void {}
}

class CleanComponent implements GpuComponent {
  readonly id = "clean";
  dirty = false;
  planCalls = 0;

  create(): void {}
  update(): void {}
  plan(): RenderPlan {
    this.planCalls += 1;
    return EMPTY_PLAN;
  }
  dispose(): void {}
}

describe("FrameScheduler", () => {
  it("mounts two components and drives both from a single frameLoop tick", async () => {
    const { gpu } = await createMockGpu();
    const globals = uniforms(gpu, { time: 0, deltaTime: 0, dpr: 1 });
    const scheduler = new FrameScheduler(gpu, globals);

    const t1 = target(gpu, { size: [2, 2] });
    const t2 = target(gpu, { size: [2, 2] });
    const a = new RecordingComponent("a", t1);
    const b = new RecordingComponent("b", t2);

    scheduler.mount(a, fakeSurface(t1));
    scheduler.mount(b, fakeSurface(t2));
    assert.equal(scheduler.mountedCount, 2);

    await tick(60);

    assert.ok(a.planCalls >= 1, "component a should have been planned at least once");
    assert.ok(b.planCalls >= 1, "component b should have been planned at least once");
    assert.equal(a.dispatchCalls, a.planCalls, "every plan()'s compute pass must dispatch");
    assert.equal(a.encodeCalls, a.planCalls, "every plan()'s render pass must encode");

    // The default (unspecified) profiler is CPU-only — no `timestamp-query` needed — but its
    // frame stats are real: at least one tick did work (both components started dirty).
    const frame = scheduler.profiler.lastFrame;
    assert.ok(frame, "expected at least one tick to have recorded frame stats");
    assert.ok(frame!.cpuMs >= 0);
    assert.ok(frame!.componentCount >= 1);
    assert.ok(frame!.passCount >= 1);
    assert.ok(frame!.dispatchCount >= 1);
    assert.equal(scheduler.profiler.enabled, false, "no timer/profiler was passed in, so GPU timing stays off");

    scheduler.stop();
    gpu.dispose();
  });

  it("throttles ticks when constructed with an fps option", async () => {
    // `GpuRuntimeOptions.fps` was declared but never threaded to vgpu's `frameLoop`, so it did
    // nothing — this proves the 4th constructor arg actually reaches it, by observing fewer
    // plan() calls over the same real-time window than an unthrottled scheduler gets.
    const { gpu: gpuA } = await createMockGpu();
    const { gpu: gpuB } = await createMockGpu();
    const globalsA = uniforms(gpuA, { time: 0, deltaTime: 0, dpr: 1 });
    const globalsB = uniforms(gpuB, { time: 0, deltaTime: 0, dpr: 1 });

    const unthrottled = new FrameScheduler(gpuA, globalsA);
    const throttled = new FrameScheduler(gpuB, globalsB, undefined, 10); // ~100ms min interval

    const tA = target(gpuA, { size: [2, 2] });
    const tB = target(gpuB, { size: [2, 2] });
    const a = new RecordingComponent("a", tA);
    const b = new RecordingComponent("b", tB);
    a.animating = true; // stays active every tick, instead of settling after one plan()
    b.animating = true;

    unthrottled.mount(a, fakeSurface(tA));
    throttled.mount(b, fakeSurface(tB));

    await tick(220);

    assert.ok(a.planCalls > b.planCalls, `expected throttled (${b.planCalls}) < unthrottled (${a.planCalls})`);
    assert.ok(b.planCalls >= 1, "the throttled scheduler should still have ticked at least once");

    unthrottled.stop();
    throttled.stop();
    gpuA.dispose();
    gpuB.dispose();
  });

  /*
   * The site's landing page shows a live component count read from `profiler.lastFrame` and calls
   * it "N components, one GPUDevice, one submit per frame". That sentence is only true if the
   * scheduler really does drive every mounted component from one tick on one gpu, so the claim
   * gets an exact assertion rather than the `>= 1` the two-component case above settles for.
   */
  it("drives four components from one gpu and reports all four in a single frame", async () => {
    const { gpu } = await createMockGpu();
    const globals = uniforms(gpu, { time: 0, deltaTime: 0, dpr: 1 });
    const scheduler = new FrameScheduler(gpu, globals);

    const components = ["timeline", "scatter", "heatmap", "grid"].map((id) => {
      const t = target(gpu, { size: [2, 2] });
      const component = new RecordingComponent(id, t);
      scheduler.mount(component, fakeSurface(t));
      return component;
    });
    assert.equal(scheduler.mountedCount, 4);

    await tick(60);

    for (const component of components) {
      assert.ok(component.planCalls >= 1, `${component.id} should have been planned`);
      assert.equal(component.encodeCalls, component.planCalls, `${component.id} must encode every plan`);
    }

    const frame = scheduler.profiler.lastFrame;
    assert.ok(frame, "expected a recorded frame");
    assert.equal(frame!.componentCount, 4, "all four components belong to the same frame");

    scheduler.stop();
    gpu.dispose();
  });

  it("skips a clean, non-animating component entirely", async () => {
    const { gpu } = await createMockGpu();
    const globals = uniforms(gpu, { time: 0, deltaTime: 0, dpr: 1 });
    const scheduler = new FrameScheduler(gpu, globals);

    const t = target(gpu, { size: [2, 2] });
    const surface = fakeSurface(t);
    const clean = new CleanComponent();
    scheduler.mount(clean, surface);

    // A brand-new surface starts dirty (it needs an initial paint even for a component born
    // clean) — settle it first so this test isolates "clean component, clean surface".
    await tick(1);
    surface.clearDirty();
    const callsAfterSettling = clean.planCalls;

    await tick(60);

    assert.equal(
      clean.planCalls,
      callsAfterSettling,
      "a clean, non-animating component on a clean surface must never be (re-)planned",
    );

    scheduler.stop();
    gpu.dispose();
  });

  it("keeps planning an animating-but-clean component across ticks, then stops once it settles", async () => {
    const { gpu } = await createMockGpu();
    const globals = uniforms(gpu, { time: 0, deltaTime: 0, dpr: 1 });
    const scheduler = new FrameScheduler(gpu, globals);

    const t = target(gpu, { size: [2, 2] });
    const surface = fakeSurface(t);
    // Mirrors GPUGraph: dirty flips false at the top of plan(), animating alone keeps it ticking.
    class AnimatingComponent implements GpuComponent {
      readonly id = "animating";
      dirty = false;
      animating = true;
      planCalls = 0;
      private ticksLeft = 8;

      create(): void {}
      update(): void {}
      plan(): RenderPlan {
        this.planCalls += 1;
        this.ticksLeft -= 1;
        if (this.ticksLeft <= 0) this.animating = false;
        return EMPTY_PLAN;
      }
      dispose(): void {}
    }

    const animating = new AnimatingComponent();
    scheduler.mount(animating, surface);

    // `tick(ms)` is milliseconds, not frame count (vgpu's Node rAF fallback is a 16ms setTimeout);
    // wait long enough for at least one real frame, then settle the surface's initial dirty flag.
    await tick(20);
    surface.clearDirty();

    await tick(50);
    const midCalls = animating.planCalls;
    assert.ok(midCalls > 0, "an animating-but-clean component must keep getting planned");
    assert.ok(animating.animating, "component should still be mid-animation at this point");

    // Drive it well past the point it flips `animating = false` (8 plan calls, ~16ms apart), then
    // confirm plan calls stop growing — the settle half of the same branch.
    await tick(300);
    const settledCalls = animating.planCalls;
    assert.equal(animating.animating, false, "component should have settled by now");

    await tick(200);
    assert.equal(
      animating.planCalls,
      settledCalls,
      "a settled, clean component on a clean surface must stop being planned",
    );
    assert.ok(settledCalls > midCalls, "plan count should have kept growing while still animating");

    scheduler.stop();
    gpu.dispose();
  });
});
