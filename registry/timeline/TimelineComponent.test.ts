import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { frame, target, uniforms, type Gpu } from "vgpu";
import { createMockGpu } from "@gpu-components/testing";
import { createWarningsLog, gpuPass, NO_WEBGPU_CAPABILITIES, ResourceRegistry } from "@gpu-components/core";
import type { ComponentContext } from "@gpu-components/core";
import { TimelineComponent } from "./TimelineComponent.ts";
import { ingestSpans } from "./ingest.ts";

function makeCtx(gpu: Gpu, surfaceTarget: ReturnType<typeof target>): ComponentContext {
  const registry = new ResourceRegistry();
  const globals = uniforms(gpu, { time: 0, deltaTime: 0, dpr: 1 });
  let dirty = true;
  return {
    runtime: { caps: NO_WEBGPU_CAPABILITIES, invalidate: () => {}, warnings: createWarningsLog() },
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
      for (const pass of plan.renderPasses) pass.encode(gpuPass(framePass));
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

  it("adds a brush-select compute pass only while brushRect is set, and clears it on the transition back to null", () => {
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
      const viewport = { timeStart: 0, timeEnd: 10, trackCount: 2, width: 4, height: 4 };

      component.update({ spans, viewport });
      // No brush: instanced mode's usual single (cull) compute pass — brush adds nothing when unset.
      assert.equal(component.plan().computePasses.length, 1);

      component.update({ spans, viewport, brushRect: { timeStart: 0, timeEnd: 5, trackMin: 0, trackMax: 1 } });
      const withBrush = component.plan();
      assert.equal(withBrush.computePasses.length, 2);
      runPlan(gpu, surfaceTarget, withBrush);

      // Clearing the brush drops back to one compute pass (the JS-side mask reset in update() needs
      // no dispatch of its own).
      component.update({ spans, viewport, brushRect: null });
      assert.equal(component.plan().computePasses.length, 1);

      component.dispose();
      gpu.dispose();
    })();

    return setup;
  });

  it("reports repeated span-buffer growth into ctx.runtime.warnings (PLAN.md §28.2)", () => {
    const setup = (async () => {
      const { gpu, caps } = await createMockGpu();
      const surfaceTarget = target(gpu, { size: [4, 4] });
      const ctx = { ...makeCtx(gpu, surfaceTarget), caps };

      // A tiny initial capacity so a couple of real datasets force real growth.
      const component = new TimelineComponent(1);
      component.create(ctx);

      const viewport = { timeStart: 0, timeEnd: 10, trackCount: 1, width: 4, height: 4 };
      component.update({ spans: ingestSpans([{ start: 0, duration: 1, track: 0 }]), viewport });
      component.update({
        spans: ingestSpans([
          { start: 0, duration: 1, track: 0 },
          { start: 1, duration: 1, track: 0 },
        ]),
        viewport,
      }); // growth 1 — not reported
      component.update({
        spans: ingestSpans([
          { start: 0, duration: 1, track: 0 },
          { start: 1, duration: 1, track: 0 },
          { start: 2, duration: 1, track: 0 },
        ]),
        viewport,
      }); // growth 2 — reported

      const warning = ctx.runtime.warnings.recent.find((w) => w.code === "buffer-growth");
      assert.ok(warning, "expected a buffer-growth warning after the second span-buffer growth");
      assert.equal(warning!.source, component.id);

      component.dispose();
      gpu.dispose();
    })();

    return setup;
  });

  it("draws axis rules through LineLayer in both LOD modes, and never grows the rules buffer", () => {
    const setup = (async () => {
      const { gpu, caps } = await createMockGpu();
      const surfaceTarget = target(gpu, { size: [64, 64] });
      const ctx = { ...makeCtx(gpu, surfaceTarget), caps };

      for (const lodThreshold of [Number.POSITIVE_INFINITY, 0]) {
        const component = new TimelineComponent(8, lodThreshold);
        component.create(ctx);
        component.update({
          spans: ingestSpans([
            { start: 0, duration: 1, track: 0, label: "a" },
            { start: 2, duration: 3, track: 1, label: "b" },
          ]),
          // 8 tracks over 400px leaves rows well above the separator threshold, so both rule
          // families are present regardless of which LOD branch encodes.
          viewport: { timeStart: 0, timeEnd: 100, trackCount: 8, width: 800, height: 400 },
        });

        assert.doesNotThrow(() => runPlan(gpu, surfaceTarget, component.plan()));
        component.dispose();
      }

      // The rules layer is presized to MAX_AXIS_RULES, so zooming through many different tick
      // counts must never grow it — a growth warning here would mean the presize is wrong.
      const zooming = new TimelineComponent(8);
      zooming.create(ctx);
      const spans = ingestSpans([{ start: 0, duration: 1, track: 0 }]);
      for (const timeEnd of [1, 10, 100, 1000, 10_000, 100_000]) {
        zooming.update({
          spans,
          viewport: { timeStart: 0, timeEnd, trackCount: 8, width: 800, height: 400 },
        });
      }
      const growth = ctx.runtime.warnings.recent.filter((w) => w.source === `${zooming.id}-rules`);
      assert.deepEqual(growth, [], "the presized rules buffer must never grow");

      zooming.dispose();
      gpu.dispose();
    })();

    return setup;
  });
});
