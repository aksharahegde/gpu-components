import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createMockCanvas, createMockRuntime, tick } from "@gpu-components/testing";
import { EMPTY_PLAN } from "./component.ts";
import type { ComponentContext, GpuComponent, RenderPlan } from "./component.ts";

class ProbeComponent implements GpuComponent {
  readonly id: string;
  private readonly registryKey: string;
  dirty = false;
  createCalls = 0;
  disposeCalls = 0;
  contextRestoredCalls = 0;
  releasedKey: string | undefined;

  constructor(id: string, registryKey: string) {
    this.id = id;
    this.registryKey = registryKey;
  }

  create(ctx: ComponentContext): void {
    this.createCalls += 1;
    ctx.registry.acquire(this.registryKey, () => ({}));
    ctx.onDispose(() => ctx.registry.release(this.registryKey));
  }

  update(): void {}
  plan(): RenderPlan {
    return EMPTY_PLAN;
  }
  dispose(): void {
    this.disposeCalls += 1;
  }
  onContextRestored(): void {
    this.contextRestoredCalls += 1;
  }
}

describe("GpuRuntime", () => {
  it("mounting and unmounting a component 100 times leaks nothing in the registry", async () => {
    const runtime = await createMockRuntime();
    const canvas = createMockCanvas(runtime.gpu!);

    for (let i = 0; i < 100; i++) {
      const handle = runtime.mount(
        () => new ProbeComponent("probe", "shared-key"),
        canvas,
      );
      handle.unmount();
    }

    assert.equal(runtime.registry.size, 0, "every acquire() must be matched by a release()");
    runtime.dispose();
  });

  it("replays create() and calls onContextRestored() on every mounted component after simulated device loss", async () => {
    let onRecovered: () => void = () => {};
    const recovered = new Promise<void>((resolve) => {
      onRecovered = resolve;
    });

    const runtime = await createMockRuntime({ runtime: { onRecovered: () => onRecovered() } });
    const canvas = createMockCanvas(runtime.gpu!);

    let probe!: ProbeComponent;
    runtime.mount(() => {
      probe = new ProbeComponent("probe", "device-loss-key");
      return probe;
    }, canvas);

    assert.equal(probe.createCalls, 1);

    // vgpu/mock's device does not implement GPUDevice.lost, so there is nothing to actually
    // destroy — simulateDeviceLoss() drives the exact same recovery path a real lost device would.
    runtime.simulateDeviceLoss();
    await recovered;
    await tick(20);

    assert.equal(probe.createCalls, 2, "create() must be replayed after recovery");
    assert.equal(
      probe.contextRestoredCalls,
      1,
      "onContextRestored() must run once after create() replays",
    );

    runtime.dispose();
  });
});
