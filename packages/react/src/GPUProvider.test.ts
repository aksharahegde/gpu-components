import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// Same jsdom bootstrap as apps/site/scripts/smoke.tsx: set the DOM globals before anything that
// might touch `window`/`document`/`navigator` is imported.
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
// The spec's rAF callback timestamp is a `DOMHighResTimeStamp` — `performance.now()`'s clock, not
// `Date.now()`'s epoch millis. Anything that computes a frame delta from this argument (as
// GPUTimeline.test.tsx's inertia test does) would see a multi-trillion-ms "delta" against a
// `performance.now()`-seeded `last` otherwise.
g.requestAnimationFrame = (cb: FrameRequestCallback) =>
  setTimeout(() => cb(performance.now()), 16) as unknown as number;
g.cancelAnimationFrame = (id: number) => clearTimeout(id);
g.IS_REACT_ACT_ENVIRONMENT = true;

const { createElement, act, StrictMode } = await import("react");
const { createRoot } = await import("react-dom/client");
const { createMockGpu, createMockCanvasContext } = await import("@gpu-components/testing");
const { GPUProvider } = await import("./GPUProvider.ts");
const { useGpu } = await import("./useGpu.ts");
const { useCanvasRef } = await import("./useCanvasRef.ts");
const { useGpuComponent } = await import("./useGpuComponent.ts");
const coreTypes = await import("@gpu-components/core");
type ComponentContext = import("@gpu-components/core").ComponentContext;
type GpuComponent<Props = unknown> = import("@gpu-components/core").GpuComponent<Props>;
type Gpu = import("vgpu").Gpu;

// A single test's <canvas> elements all resolve against whichever mock Gpu that test's
// GPUProvider most recently connected to — see `testConnectOptions()` below.
let currentGpu: Gpu | null = null;
dom.window.HTMLCanvasElement.prototype.getContext = function (id: string) {
  if (id === "webgpu" && currentGpu) return createMockCanvasContext(currentGpu, [2, 2]);
  return null;
} as typeof dom.window.HTMLCanvasElement.prototype.getContext;

function testConnectOptions() {
  const connect = async () => {
    const result = await createMockGpu();
    currentGpu = result.gpu;
    return result;
  };
  return { connect, reconnect: connect };
}

class TestComponent implements GpuComponent<{ n: number }> {
  readonly id: string;
  dirty = false;
  createCalls = 0;
  updateCalls = 0;
  disposeCalls = 0;
  lastProps: { n: number } | undefined;

  constructor(id: string) {
    this.id = id;
  }
  create(ctx: ComponentContext): void {
    this.createCalls += 1;
    ctx.registry.acquire(this.id, () => ({}));
    ctx.onDispose(() => ctx.registry.release(this.id));
  }
  update(props: { n: number }): void {
    this.updateCalls += 1;
    this.lastProps = props;
  }
  plan() {
    return coreTypes.EMPTY_PLAN;
  }
  dispose(): void {
    this.disposeCalls += 1;
  }
}

const host = dom.window.document.getElementById("root")!;

async function mount(children: unknown) {
  host.innerHTML = "";
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(StrictMode, null, children as never));
  });
  return root;
}

describe("GPUProvider", () => {
  it("reaches status 'ready' exactly once against a mock runtime", async () => {
    const statuses: string[] = [];
    function Probe() {
      const { status } = useGpu();
      statuses.push(status);
      return null;
    }

    const root = await mount(
      createElement(GPUProvider, { options: testConnectOptions() }, createElement(Probe, null)),
    );
    // Let the async GpuRuntime.create() resolve and re-render.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    // React 18 StrictMode double-invokes render function bodies (a pure-render check), which
    // pushes each logical status twice in a row; it does not double-invoke this effect-free
    // component's rendering into two separate commits. Collapse consecutive duplicates to see the
    // real transitions.
    const transitions = statuses.filter((s, i) => i === 0 || s !== statuses[i - 1]);
    const readyTransitions = transitions.filter((s) => s === "ready").length;
    assert.equal(
      readyTransitions,
      1,
      `expected exactly one transition into 'ready', saw: ${transitions.join(", ")} (raw: ${statuses.join(", ")})`,
    );
    assert.equal(statuses.at(-1), "ready");

    await act(async () => {
      root.unmount();
    });
  });

  it("mounts two sibling components and disposes cleanly with zero registry leaks", async () => {
    const created: TestComponent[] = [];

    function Widget({ id }: { id: string }) {
      const [canvas, ref] = useCanvasRef();
      useGpuComponent<{ n: number }>(
        () => {
          const c = new TestComponent(id);
          created.push(c);
          return c;
        },
        canvas,
        { n: 0 },
      );
      return createElement("canvas", { ref, width: 2, height: 2 });
    }

    let runtimeRef: import("@gpu-components/core").GpuRuntime | null = null;
    function Capture() {
      runtimeRef = useGpu().runtime;
      return null;
    }

    const root = await mount(
      createElement(
        GPUProvider,
        { options: testConnectOptions() },
        createElement(Capture, null),
        createElement(Widget, { id: "a" }),
        createElement(Widget, { id: "b" }),
      ),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    assert.ok(runtimeRef, "runtime should be available once ready");
    assert.equal(created.length, 2, "each widget should have created exactly one component");

    await act(async () => {
      root.unmount();
    });

    const finalRuntime = runtimeRef as unknown as import("@gpu-components/core").GpuRuntime;
    assert.equal(finalRuntime.registry.size, 0, "no registry entries should leak");
    for (const c of created) {
      assert.equal(c.createCalls, 1, `component ${c.id} must be created exactly once`);
      // dispose() may run more than once here: unmounting <GPUProvider> tears the whole runtime
      // down (disposing every still-mounted component directly), and each widget's own cleanup
      // effect then also calls its MountHandle.unmount(), which unconditionally calls dispose()
      // again — GpuComponent.dispose() is contractually idempotent (PLAN.md §9.4: "StrictMode and
      // Fast Refresh will call it twice"), so this is expected, not a leak. The registry check
      // above is the real leak guard, since ResourceRegistry.release() no-ops past zero.
      assert.ok(c.disposeCalls >= 1, `component ${c.id} must be disposed at least once`);
    }
  });

  it("delivers the first update() even when props are memoised (never change identity)", async () => {
    // The blank-canvas bug `GPUHeatmap` hit. The canvas arrives via setState from a ref callback,
    // so the component mounts on render #2 — and a caller passing a stable, memoised props object
    // (what the React docs encourage) never re-fires the `[props]` effect, so the component that
    // now exists is never given its data. `GPUTimeline` only worked because it happened to pass a
    // fresh object literal every render.
    let instance: TestComponent | null = null;
    const STABLE_PROPS = { n: 1 };

    function Widget() {
      const [canvas, ref] = useCanvasRef();
      useGpuComponent<{ n: number }>(
        () => {
          instance = new TestComponent("memoised-props");
          return instance;
        },
        canvas,
        STABLE_PROPS, // deliberately the same object on every render
      );
      return createElement("canvas", { ref, width: 2, height: 2 });
    }

    host.innerHTML = "";
    const root = createRoot(host);
    await act(async () => {
      root.render(createElement(GPUProvider, { options: testConnectOptions() }, createElement(Widget, null)));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    assert.ok(instance, "component should be mounted");
    const mounted = instance as unknown as TestComponent;
    assert.equal(mounted.createCalls, 1);
    assert.equal(mounted.updateCalls, 1, "a memoised props object must still produce exactly one initial update");
    assert.deepEqual(mounted.lastProps, STABLE_PROPS);

    // Unmount so the provider disposes its runtime and stops the frame loop — a live loop driven by
    // the mocked rAF keeps this test file's process alive after the assertions pass.
    await act(async () => {
      root.unmount();
    });
  });

  it("calls update() on prop change without remounting", async () => {
    let instance: TestComponent | null = null;

    function Widget({ n }: { n: number }) {
      const [canvas, ref] = useCanvasRef();
      useGpuComponent<{ n: number }>(
        () => {
          instance = new TestComponent("prop-change");
          return instance;
        },
        canvas,
        { n },
      );
      return createElement("canvas", { ref, width: 2, height: 2 });
    }

    // No StrictMode here: this test asserts a single logical mount's create-call count, and
    // StrictMode's intentional double-invoke would otherwise double it — already covered above.
    host.innerHTML = "";
    const root = createRoot(host);
    await act(async () => {
      root.render(createElement(GPUProvider, { options: testConnectOptions() }, createElement(Widget, { n: 1 })));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    assert.ok(instance, "component should be mounted");
    const first = instance as unknown as TestComponent;
    assert.equal(first.createCalls, 1);
    // The props effect (`[props]`) fires after the very first render too, same as any other
    // effect — so mounting with { n: 1 } already produced one update() call before any prop
    // change happens.
    assert.equal(first.updateCalls, 1, "initial mount should call update() once, with initial props");
    assert.deepEqual(first.lastProps, { n: 1 });

    await act(async () => {
      root.render(createElement(GPUProvider, { options: testConnectOptions() }, createElement(Widget, { n: 2 })));
    });

    assert.equal(first.createCalls, 1, "prop change must not re-create the component");
    assert.equal(first.updateCalls, 2, "prop change must call update() exactly once more");
    assert.deepEqual(first.lastProps, { n: 2 });

    await act(async () => {
      root.unmount();
    });
  });
});
