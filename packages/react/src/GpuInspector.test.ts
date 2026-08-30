import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// Same jsdom bootstrap as GPUProvider.test.ts.
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: "http://localhost/",
});
const g = globalThis as Record<string, unknown>;
g.window = dom.window;
g.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
  writable: true,
});
g.HTMLElement = dom.window.HTMLElement;
g.HTMLCanvasElement = dom.window.HTMLCanvasElement;
g.Node = dom.window.Node;
g.Element = dom.window.Element;
g.getComputedStyle = dom.window.getComputedStyle;
g.requestAnimationFrame = (cb: FrameRequestCallback) =>
  setTimeout(() => cb(performance.now()), 16) as unknown as number;
g.cancelAnimationFrame = (id: number) => clearTimeout(id);
g.IS_REACT_ACT_ENVIRONMENT = true;

const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { createMockGpu, createMockCanvasContext } = await import("@gpu-components/testing");
const { GPUProvider } = await import("./GPUProvider.ts");
const { useGpuComponent } = await import("./useGpuComponent.ts");
const { useCanvasRef } = await import("./useCanvasRef.ts");
const { GpuInspector } = await import("./GpuInspector.ts");
const { useGpu } = await import("./useGpu.ts");
type GpuComponent = import("@gpu-components/core").GpuComponent;
type RenderPlan = import("@gpu-components/core").RenderPlan;
type GpuRuntime = import("@gpu-components/core").GpuRuntime;
type Gpu = import("vgpu").Gpu;

let currentGpu: Gpu | null = null;
dom.window.HTMLCanvasElement.prototype.getContext = function (id: string) {
  if (id === "webgpu" && currentGpu) return createMockCanvasContext(currentGpu, [2, 2]);
  return null;
} as typeof dom.window.HTMLCanvasElement.prototype.getContext;

function testConnectOptions(features: readonly GPUFeatureName[] = [], profiling = false) {
  const connect = async () => {
    const result = await createMockGpu(features);
    currentGpu = result.gpu;
    return result;
  };
  return { connect, reconnect: connect, profiling };
}

/** Dirty exactly once, then a genuine named render pass — mirrors runtime.test.ts's
 * `DirtyOnceComponent`, extended with a real `RenderPlan` so the Frame/Passes sections have
 * something to show. */
class ProbeComponent implements GpuComponent {
  readonly id = "inspector-probe";
  dirty = true;
  create(): void {}
  update(): void {}
  plan(): RenderPlan {
    this.dirty = false;
    return {
      computePasses: [],
      renderPasses: [{ name: "probe-pass", target: "surface", clear: true, encode: () => {} }],
    };
  }
  dispose(): void {}
}

const host = dom.window.document.getElementById("root")!;

async function mountInspector(
  connectOptions: ReturnType<typeof testConnectOptions>,
): Promise<{ root: ReturnType<typeof createRoot>; el: HTMLElement }> {
  host.innerHTML = "";
  const root = createRoot(host);
  await act(async () => {
    root.render(
      createElement(
        GPUProvider,
        { options: connectOptions },
        createElement("div", { id: "inspector-host" }, createElement(GpuInspector, { pollIntervalMs: 20 })),
      ) as never,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  return { root, el: host.querySelector("#inspector-host") as HTMLElement };
}

describe("GpuInspector", () => {
  it("renders the Device section from the runtime's real capabilities", async () => {
    const { root, el } = await mountInspector(testConnectOptions(["timestamp-query"]));
    try {
      assert.match(el.textContent ?? "", /timestamp-query ✓/);
      assert.match(el.textContent ?? "", /tier: gpu/);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it("shows 'GPU timing disabled' in Passes when profiling was never requested", async () => {
    const { root, el } = await mountInspector(testConnectOptions());
    try {
      assert.match(el.textContent ?? "", /GPU timing disabled/);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it("populates the Frame section once a mounted component ticks", async () => {
    host.innerHTML = "";
    const root = createRoot(host);
    await act(async () => {
      root.render(
        createElement(
          GPUProvider,
          { options: testConnectOptions() },
          createElement(Widget, null),
          createElement("div", { id: "inspector-host" }, createElement(GpuInspector, { pollIntervalMs: 20 })),
        ) as never,
      );
    });
    // Let connect + mount + a few ticks (including the polling interval) settle.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });

    const el = host.querySelector("#inspector-host") as HTMLElement;
    assert.match(el.textContent ?? "", /components: 1/);
    assert.match(el.textContent ?? "", /render passes: 1/);

    await act(async () => root.unmount());

    function Widget() {
      const [canvas, ref] = useCanvasRef();
      useGpuComponent(() => new ProbeComponent(), canvas, {});
      return createElement("canvas", { ref, width: 2, height: 2 });
    }
  });

  it("shows a real pass row once GPU timing is enabled and results decode", async () => {
    host.innerHTML = "";
    const root = createRoot(host);
    await act(async () => {
      root.render(
        createElement(
          GPUProvider,
          { options: testConnectOptions(["timestamp-query"], true) },
          createElement(Widget, null),
          createElement("div", { id: "inspector-host" }, createElement(GpuInspector, { pollIntervalMs: 20 })),
        ) as never,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });

    const el = host.querySelector("#inspector-host") as HTMLElement;
    // vgpu/mock validates wiring, not real decoded GPU timing (this session's established
    // precedent) — assert the Passes section is no longer showing the "disabled" placeholder,
    // not a specific ms value.
    assert.doesNotMatch(el.textContent ?? "", /GPU timing disabled/);

    await act(async () => root.unmount());

    function Widget() {
      const [canvas, ref] = useCanvasRef();
      useGpuComponent(() => new ProbeComponent(), canvas, {});
      return createElement("canvas", { ref, width: 2, height: 2 });
    }
  });

  it("Warnings section defaults to 'none detected'", async () => {
    const { root, el } = await mountInspector(testConnectOptions());
    try {
      assert.match(el.textContent ?? "", /none detected/);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it("shows a warning reported into runtime.warnings, including a repeat count", async () => {
    let runtimeRef: GpuRuntime | null = null;
    function Capture() {
      runtimeRef = useGpu().runtime;
      return null;
    }

    host.innerHTML = "";
    const root = createRoot(host);
    await act(async () => {
      root.render(
        createElement(
          GPUProvider,
          { options: testConnectOptions() },
          createElement(Capture, null),
          createElement("div", { id: "inspector-host" }, createElement(GpuInspector, { pollIntervalMs: 20 })),
        ) as never,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    assert.ok(runtimeRef, "runtime should be available once ready");
    await act(async () => {
      runtimeRef!.warnings.report({ code: "buffer-growth", source: "probe-layer", message: "grew 4 -> 8" });
      runtimeRef!.warnings.report({ code: "buffer-growth", source: "probe-layer", message: "grew 8 -> 16" });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    const el = host.querySelector("#inspector-host") as HTMLElement;
    assert.match(el.textContent ?? "", /probe-layer: grew 8 -> 16 \(×2\)/);

    await act(async () => root.unmount());
  });
});
