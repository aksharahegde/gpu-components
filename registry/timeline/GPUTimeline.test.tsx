import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// Same jsdom bootstrap as packages/react/src/GPUProvider.test.ts — set the DOM globals before
// anything that might touch `window`/`document`/`navigator` is imported.
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
g.KeyboardEvent = dom.window.KeyboardEvent;
g.WheelEvent = dom.window.WheelEvent;
g.getComputedStyle = dom.window.getComputedStyle;
// The spec's rAF callback timestamp is a `DOMHighResTimeStamp` — `performance.now()`'s clock, not
// `Date.now()`'s epoch millis. The inertial-pan test below computes a frame delta from this
// argument against a `performance.now()`-seeded `last`; a `Date.now()` mismatch there would produce
// a multi-trillion-ms "delta" on the very first decay frame.
g.requestAnimationFrame = (cb: FrameRequestCallback) =>
  setTimeout(() => cb(performance.now()), 16) as unknown as number;
g.cancelAnimationFrame = (id: number) => clearTimeout(id);
g.IS_REACT_ACT_ENVIRONMENT = true;

const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { createMockGpu, createMockCanvasContext } = await import("@gpu-components/testing");
const { GPUProvider } = await import("@gpu-components/react");
const { GPUTimeline } = await import("./GPUTimeline.tsx");
const { ingestSpans } = await import("./ingest.ts");
type Gpu = import("vgpu").Gpu;
type ViewportState = import("@gpu-components/core").ViewportState;

// Same convention as GPUProvider.test.ts: canvases resolve against whichever mock Gpu the test's
// GPUProvider most recently connected to.
let currentGpu: Gpu | null = null;
dom.window.HTMLCanvasElement.prototype.getContext = function (id: string) {
  if (id === "webgpu" && currentGpu) return createMockCanvasContext(currentGpu, [400, 240]);
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

const host = dom.window.document.getElementById("root")!;

function testSpans() {
  // Sorted (track, start): a@track0/t0, b@track0/t5, c@track1/t0 → indices 0, 1, 2.
  return ingestSpans([
    { start: 0, duration: 1, track: 0, label: "a" },
    { start: 5, duration: 1, track: 0, label: "b" },
    { start: 0, duration: 1, track: 1, label: "c" },
  ]);
}

const VIEWPORT: ViewportState = { timeStart: 0, timeEnd: 10, trackCount: 2, width: 400, height: 240 };

function keydown(el: Element, key: string) {
  el.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key, bubbles: true }));
}

/**
 * Mounts a `<GPUProvider><GPUTimeline .../></GPUProvider>` tree, runs `fn` with the mounted
 * `<div role="application">` root, and *always* unmounts — even if `fn` throws. `GpuRuntime`'s
 * frame loop is a self-perpetuating `setTimeout` chain (PLAN.md §10.2's `frameLoop`); skipping
 * `root.unmount()` on an assertion failure leaves it running forever and hangs the whole test
 * process, not just fails the one test — this is why every earlier draft of this file used a
 * bare `await act(() => root.unmount())` at the end of each `it()`, which never runs once an
 * `assert` above it throws.
 */
async function withTimeline(
  props: Parameters<typeof GPUTimeline>[0],
  fn: (app: Element) => void | Promise<void>,
): Promise<void> {
  host.innerHTML = "";
  const root = createRoot(host);
  await act(async () => {
    root.render(
      createElement(GPUProvider, { options: testConnectOptions() }, createElement(GPUTimeline, props)) as never,
    );
  });
  // Let GPUProvider's async connect + useGpuComponent's mount/create/update settle.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  try {
    const app = host.querySelector('[role="application"]');
    assert.ok(app, "expected the GPUTimeline root to render with role=application");
    await fn(app!);
  } finally {
    await act(async () => {
      root.unmount();
    });
  }
}

describe("GPUTimeline accessibility", () => {
  it("wires role=application, an aria-hidden canvas, and a summary region", async () => {
    await withTimeline({ spans: testSpans(), viewport: VIEWPORT }, async (app) => {
      assert.equal(app.getAttribute("tabindex"), "0");
      assert.equal(host.querySelector("canvas")?.getAttribute("aria-hidden"), "true");

      const describedBy = app.getAttribute("aria-describedby");
      assert.ok(describedBy, "should have aria-describedby");
      // `useId()` ids contain `:` (e.g. ":r0:"), invalid in a bare `#id` CSS selector.
      const summary = dom.window.document.getElementById(describedBy!);
      assert.match(summary?.textContent ?? "", /3 spans/);
    });
  });

  it("renders each labeled span as a real listitem with a composed aria-label", async () => {
    await withTimeline({ spans: testSpans(), viewport: VIEWPORT }, async () => {
      const items = host.querySelectorAll('[role="listitem"]');
      assert.equal(items.length, 3);
      const a = Array.from(items).find((el) => el.getAttribute("aria-label")?.startsWith("a,"));
      assert.ok(a, "expected a listitem whose aria-label starts with the span's own name");
      assert.match(a!.getAttribute("aria-label")!, /^a, [\d.]+ms, track 0, starts at [\d.]+$/);
    });
  });
});

function wheel(el: Element, deltaX: number) {
  el.dispatchEvent(
    new dom.window.WheelEvent("wheel", { deltaX, deltaY: 0, deltaMode: 0, clientX: 5, clientY: 5, bubbles: true, cancelable: true }),
  );
}

function summaryTimeStart(app: Element): number {
  const describedBy = app.getAttribute("aria-describedby")!;
  const text = dom.window.document.getElementById(describedBy)?.textContent ?? "";
  const match = /Showing (-?[\d.]+) to/.exec(text);
  assert.ok(match, `expected a "Showing X to Y" summary, got: ${text}`);
  return Number(match![1]);
}

describe("GPUTimeline inertial pan (PLAN.md Phase 3)", () => {
  it("keeps panning after the wheel gesture ends, then settles", async () => {
    // A wide bounds — the point is observing inertia's own decay, not bounds clamping.
    const bounds = { timeMin: -1000, timeMax: 1000 };
    await withTimeline({ spans: testSpans(), viewport: VIEWPORT, bounds }, async (app) => {
      const canvas = host.querySelector("canvas")!;

      // A short burst of same-direction wheel events — a real trackpad swipe's discrete event
      // stream — to build up velocity in the tracker.
      for (let i = 0; i < 4; i++) {
        await act(async () => wheel(canvas, 40));
        await act(async () => await new Promise((resolve) => setTimeout(resolve, 15)));
      }
      const afterGesture = summaryTimeStart(app);
      assert.ok(afterGesture > VIEWPORT.timeStart, "the wheel gesture itself should have panned");

      // No further input — just let WHEEL_IDLE_MS elapse and inertia's rAF chain (this file's
      // mocked requestAnimationFrame, a 16ms setTimeout) run for a while.
      await act(async () => await new Promise((resolve) => setTimeout(resolve, 400)));
      const afterInertia = summaryTimeStart(app);
      assert.ok(
        afterInertia > afterGesture,
        `expected inertia to keep panning past ${afterGesture} without further input, got ${afterInertia}`,
      );

      // Long enough for decay to fall under INERTIA_STOP_VELOCITY and stop scheduling frames.
      await act(async () => await new Promise((resolve) => setTimeout(resolve, 1500)));
      const settled = summaryTimeStart(app);
      await act(async () => await new Promise((resolve) => setTimeout(resolve, 200)));
      const afterSettling = summaryTimeStart(app);
      assert.ok(
        Math.abs(afterSettling - settled) < 1e-6,
        `expected inertia to have settled by now (no more movement), moved from ${settled} to ${afterSettling}`,
      );
    });
  });

  it("does not animate when prefers-reduced-motion is set", async () => {
    const originalMatchMedia = dom.window.matchMedia;
    dom.window.matchMedia = ((query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof dom.window.matchMedia;
    g.matchMedia = dom.window.matchMedia;
    try {
      const bounds = { timeMin: -1000, timeMax: 1000 };
      await withTimeline({ spans: testSpans(), viewport: VIEWPORT, bounds }, async (app) => {
        const canvas = host.querySelector("canvas")!;
        for (let i = 0; i < 4; i++) {
          await act(async () => wheel(canvas, 40));
          await act(async () => await new Promise((resolve) => setTimeout(resolve, 15)));
        }
        const afterGesture = summaryTimeStart(app);

        await act(async () => await new Promise((resolve) => setTimeout(resolve, 400)));
        const afterWait = summaryTimeStart(app);
        assert.ok(
          Math.abs(afterWait - afterGesture) < 1e-6,
          `expected no inertia movement with prefers-reduced-motion set, moved from ${afterGesture} to ${afterWait}`,
        );
      });
    } finally {
      dom.window.matchMedia = originalMatchMedia;
      delete g.matchMedia;
    }
  });
});

describe("GPUTimeline keyboard navigation", () => {
  it("ArrowRight moves focus to the next span on the same track", async () => {
    await withTimeline({ spans: testSpans(), viewport: VIEWPORT }, async (app) => {
      await act(async () => keydown(app, "ArrowRight")); // null focus -> firstSpanIndex -> "a" (index 0)
      assert.equal(app.getAttribute("aria-activedescendant"), "tl-span-0");
      await act(async () => keydown(app, "ArrowRight")); // "a" -> "b" (index 1), same track
      assert.equal(app.getAttribute("aria-activedescendant"), "tl-span-1");
    });
  });

  it("Home and End jump to the dataset's first and last span", async () => {
    await withTimeline({ spans: testSpans(), viewport: VIEWPORT }, async (app) => {
      await act(async () => keydown(app, "End"));
      assert.equal(app.getAttribute("aria-activedescendant"), "tl-span-2");
      await act(async () => keydown(app, "Home"));
      assert.equal(app.getAttribute("aria-activedescendant"), "tl-span-0");
    });
  });

  it("Enter selects the currently focused span", async () => {
    let selected: number | null | undefined;
    await withTimeline(
      { spans: testSpans(), viewport: VIEWPORT, onSelect: (id: number | null) => (selected = id) },
      async (app) => {
        await act(async () => keydown(app, "ArrowRight")); // focus "a" (index 0)
        await act(async () => keydown(app, "Enter"));
        assert.equal(selected, 0);
      },
    );
  });

  it("Escape clears both focus and selection", async () => {
    let selected: number | null | undefined = -1;
    await withTimeline(
      { spans: testSpans(), viewport: VIEWPORT, onSelect: (id: number | null) => (selected = id) },
      async (app) => {
        await act(async () => keydown(app, "ArrowRight"));
        await act(async () => keydown(app, "Escape"));
        assert.equal(selected, null);
        assert.equal(app.getAttribute("aria-activedescendant"), null);
      },
    );
  });
});
