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
    const clean = new CleanComponent();
    scheduler.mount(clean, fakeSurface(t));

    await tick(60);

    assert.equal(clean.planCalls, 0, "a clean, non-animating component must never be planned");

    scheduler.stop();
    gpu.dispose();
  });
});
