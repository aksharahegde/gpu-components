import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tick } from "@gpu-components/testing";
import { Canvas2DScheduler } from "./canvas2dScheduler.ts";
import { Canvas2DSurface } from "./canvas2dSurface.ts";
import { createWarningsLog } from "./warnings.ts";
import { EMPTY_PLAN } from "./component.ts";
import type { ComputePass, GpuComponent, RenderPass, RenderPlan } from "./component.ts";
import type { PassEncoder } from "./passEncoder.ts";
import type { Target } from "vgpu";

/** A minimal `CanvasRenderingContext2D` double — enough for `Canvas2DSurface`'s constructor and
 * `resize()`, and for a test's render pass to call harmless no-op methods on. */
function fakeCtx(): CanvasRenderingContext2D {
  return {
    setTransform() {},
    clearRect() {},
    fillRect() {},
    save() {},
    restore() {},
  } as unknown as CanvasRenderingContext2D;
}

function fakeCanvas(width = 200, height = 100): HTMLCanvasElement {
  const ctx = fakeCtx();
  const canvas = {
    width,
    height,
    getContext: (id: string) => (id === "2d" ? ctx : null),
    getBoundingClientRect: () => ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) }),
  } as unknown as HTMLCanvasElement;
  return canvas;
}

class RecordingComponent implements GpuComponent {
  readonly id: string;
  private readonly renderTargetValue: "surface" | Target;
  private readonly order: string[] | undefined;
  planCalls = 0;
  dispatchCalls = 0;
  encodeCalls = 0;
  dirty = true;
  animating = false;

  constructor(id: string, renderTarget: "surface" | Target = "surface", order?: string[]) {
    this.id = id;
    this.renderTargetValue = renderTarget;
    this.order = order;
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
        this.order?.push(`${this.id}-dispatch`);
      },
    };
    const render: RenderPass = {
      name: `${this.id}-render`,
      target: this.renderTargetValue,
      clear: true,
      encode: () => {
        this.encodeCalls += 1;
        this.order?.push(`${this.id}-encode`);
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

describe("Canvas2DScheduler", () => {
  it("mounts a component and drives it from repeated ticks", async () => {
    const warnings = createWarningsLog();
    const scheduler = new Canvas2DScheduler(warnings);
    const surface = new Canvas2DSurface(fakeCanvas());
    const a = new RecordingComponent("a");

    scheduler.mount(a, surface);
    assert.equal(scheduler.mountedCount, 1);

    await tick(60);

    assert.ok(a.planCalls >= 1, "should have been planned at least once");
    assert.equal(a.dispatchCalls, a.planCalls, "every plan()'s compute pass must dispatch");
    assert.equal(a.encodeCalls, a.planCalls, "every plan()'s render pass must encode");

    const frame = scheduler.profiler.lastFrame;
    assert.ok(frame, "expected at least one tick to have recorded frame stats");
    assert.ok(frame!.cpuMs >= 0);

    scheduler.stop();
  });

  it("skips a clean, non-animating component on a clean surface entirely", async () => {
    const warnings = createWarningsLog();
    const scheduler = new Canvas2DScheduler(warnings);
    const surface = new Canvas2DSurface(fakeCanvas());
    const clean = new CleanComponent();
    scheduler.mount(clean, surface);

    // A brand-new surface starts dirty — settle it first so this test isolates "clean component,
    // clean surface", same convention `scheduler.test.ts` uses for the GPU path.
    await tick(20);
    surface.clearDirty();
    const callsAfterSettling = clean.planCalls;

    await tick(60);

    assert.equal(
      clean.planCalls,
      callsAfterSettling,
      "a clean, non-animating component on a clean surface must never be (re-)planned",
    );

    scheduler.stop();
  });

  it("dispatches every compute pass across every mount before any render pass encodes", async () => {
    const warnings = createWarningsLog();
    const scheduler = new Canvas2DScheduler(warnings);
    const order: string[] = [];
    const a = new RecordingComponent("a", "surface", order);
    const b = new RecordingComponent("b", "surface", order);

    scheduler.mount(a, new Canvas2DSurface(fakeCanvas()));
    scheduler.mount(b, new Canvas2DSurface(fakeCanvas()));

    await tick(40);
    scheduler.stop();

    assert.ok(order.length >= 4, "expected at least one full tick's worth of events");
    const firstEncodeIndex = order.findIndex((e) => e.endsWith("-encode"));
    const lastDispatchIndex = order.reduce((last, e, i) => (e.endsWith("-dispatch") ? i : last), -1);
    assert.ok(
      firstEncodeIndex === -1 || lastDispatchIndex < firstEncodeIndex,
      `expected all dispatches before any encode, got: ${order.join(", ")}`,
    );
  });

  it("forwards pass.report() into runtime.warnings as canvas2d-degraded", async () => {
    const warnings = createWarningsLog();
    const scheduler = new Canvas2DScheduler(warnings);
    const surface = new Canvas2DSurface(fakeCanvas());

    class ReportingComponent implements GpuComponent {
      readonly id = "reporting";
      dirty = true;
      create(): void {}
      update(): void {}
      plan(): RenderPlan {
        this.dirty = false;
        return {
          computePasses: [],
          renderPasses: [
            {
              name: "r",
              target: "surface",
              encode: (pass: PassEncoder) => {
                if (pass.kind === "canvas2d") pass.report("too much data");
              },
            },
          ],
        };
      }
      dispose(): void {}
    }

    scheduler.mount(new ReportingComponent(), surface);
    await tick(30);
    scheduler.stop();

    const found = warnings.recent.find((w) => w.code === "canvas2d-degraded" && w.source === "reporting");
    assert.ok(found, "expected a canvas2d-degraded warning from the reporting component");
    assert.equal(found!.message, "too much data");
  });

  it("skips and reports a render pass whose target isn't 'surface'", async () => {
    const warnings = createWarningsLog();
    const scheduler = new Canvas2DScheduler(warnings);
    const surface = new Canvas2DSurface(fakeCanvas());
    let encodeCalls = 0;

    class OffscreenComponent implements GpuComponent {
      readonly id = "offscreen";
      dirty = true;
      create(): void {}
      update(): void {}
      plan(): RenderPlan {
        this.dirty = false;
        return {
          computePasses: [],
          renderPasses: [
            {
              name: "r",
              target: {} as Target, // not "surface" — no Canvas2D equivalent
              encode: () => {
                encodeCalls++;
              },
            },
          ],
        };
      }
      dispose(): void {}
    }

    scheduler.mount(new OffscreenComponent(), surface);
    await tick(30);
    scheduler.stop();

    assert.equal(encodeCalls, 0, "an off-screen target must never be encoded in fallback mode");
    const found = warnings.recent.find((w) => w.code === "canvas2d-degraded" && w.source === "offscreen");
    assert.ok(found, "expected a canvas2d-degraded warning for the skipped off-screen target");
  });
});
