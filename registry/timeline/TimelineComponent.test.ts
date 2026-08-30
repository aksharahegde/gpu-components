import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { frame, target, uniforms, type Gpu } from "vgpu";
import { createMockGpu } from "@gpu-components/testing";
import { NO_WEBGPU_CAPABILITIES, ResourceRegistry } from "@gpu-components/core";
import type { ComponentContext } from "@gpu-components/core";
import { TimelineComponent } from "./TimelineComponent.ts";
import { ingestSpans } from "./ingest.ts";

function makeCtx(gpu: Gpu, surfaceTarget: ReturnType<typeof target>): ComponentContext {
  const registry = new ResourceRegistry();
  const globals = uniforms(gpu, { time: 0, deltaTime: 0, dpr: 1 });
  let dirty = true;
  return {
    runtime: { caps: NO_WEBGPU_CAPABILITIES, invalidate: () => {} },
    gpu,
    surface: {
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
    },
    globals,
    registry,
    caps: NO_WEBGPU_CAPABILITIES,
    onDispose: () => {},
  };
}

/** Dispatches every declared compute pass, then encodes the render pass against the mock device —
 * exercises the real compute()/storage()/draw()/uniforms()/effect() calls and binding wiring, not
 * just the RenderPlan's shape. vgpu/mock is a deterministic no-GPU mock
 * (`guides/browser-testing.docs.md`): this proves the wiring is well-formed, not that the
 * compute math produces correct pixels — that's a `vgpu/node`/browser-level concern. */
function runPlan(gpu: Gpu, surfaceTarget: ReturnType<typeof target>, plan: ReturnType<TimelineComponent["plan"]>): void {
  for (const pass of plan.computePasses) pass.dispatch();
  frame(gpu, (f) => {
    f.pass({ target: surfaceTarget, clear: true }, (framePass) => {
      for (const pass of plan.renderPasses) pass.encode(framePass);
    });
  });
}

describe("TimelineComponent", () => {
  it("create/update/plan/dispose all run against a mock Gpu without throwing, and plan() declares one render pass", () => {
    const setup = (async () => {
      const { gpu, caps } = await createMockGpu();
      const surfaceTarget = target(gpu, { size: [4, 4] });
      const ctx = { ...makeCtx(gpu, surfaceTarget), caps };

      const component = new TimelineComponent(8);
      component.create(ctx);

      const spans = ingestSpans([
        { start: 0, duration: 1, track: 0, label: "a" },
        { start: 2, duration: 3, track: 1, label: "b" },
      ]);
      component.update({
        spans,
        viewport: { timeStart: 0, timeEnd: 10, trackCount: 2, width: 4, height: 4 },
      });

      const plan = component.plan();
      // Two spans in a wide viewport stay well under the default LOD threshold — instanced mode:
      // one compute pass (the visibility cull), not the raster path's two.
      assert.equal(plan.computePasses.length, 1);
      assert.equal(plan.renderPasses.length, 1);
      assert.equal(plan.renderPasses[0]!.target, "surface");

      runPlan(gpu, surfaceTarget, plan);

      component.dispose();
      gpu.dispose();
    })();

    return setup;
  });

  it("switches to raster LOD mode (density-bin + reduce-density compute passes) when lodThreshold is 0", () => {
    const setup = (async () => {
      const { gpu, caps } = await createMockGpu();
      const surfaceTarget = target(gpu, { size: [4, 4] });
      const ctx = { ...makeCtx(gpu, surfaceTarget), caps };

      // lodThreshold: 0 forces raster mode for any non-empty dataset regardless of the actual
      // spans-per-pixel-column estimate — deterministic, not dependent on the heuristic's exact math.
      const component = new TimelineComponent(8, 0);
      component.create(ctx);

      const spans = ingestSpans([
        { start: 0, duration: 1, track: 0, label: "a" },
        { start: 2, duration: 3, track: 1, label: "b" },
      ]);
      component.update({
        spans,
        viewport: { timeStart: 0, timeEnd: 10, trackCount: 2, width: 4, height: 4 },
      });

      const plan = component.plan();
      assert.equal(plan.computePasses.length, 2);
      assert.equal(plan.renderPasses.length, 1);

      runPlan(gpu, surfaceTarget, plan);

      component.dispose();
      gpu.dispose();
    })();

    return setup;
  });
});
