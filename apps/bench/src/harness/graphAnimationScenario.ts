import { GpuRuntime, type MountHandle } from "@gpu-components/core";
import { generateClusteredGraph } from "../../../../registry/graph/ingest.ts";
import { GraphComponent } from "../../../../registry/graph/GraphComponent.ts";
import { makeCanvas } from "./sharedContextScenario.ts";

/**
 * Real-browser proof for `GraphComponent`'s Phase 0 investigation (HANDOFF.md §5.1/§5.2): the
 * animation loop lives in `packages/core`'s `FrameScheduler` (via vgpu's `frameLoop`), and this
 * scenario exists to catch a regression in that path the unit suite cannot — `packages/core`'s own
 * tests drive a mock GPU with a manually-ticked clock, which proves the component's logic is
 * correct but says nothing about whether a *real* `requestAnimationFrame` loop ever reaches it.
 *
 * Mounts a `GraphComponent` on a real canvas with a real `GpuRuntime` and hands the caller a
 * `stop()` to unmount when done. The Playwright spec drives timing and screenshots itself — this
 * harness only sets the scene.
 */
export interface GraphAnimationHandle {
  readonly canvas: HTMLCanvasElement;
  stop(): void;
}

const VIEWPORT = {
  timeStart: -1.3,
  timeEnd: 1.3,
  trackCount: 1,
  rowStart: -1.3,
  rowEnd: 1.3,
  yContinuous: true,
  width: 300,
  height: 300,
} as const;

export async function runGraphAnimation(container: HTMLElement): Promise<GraphAnimationHandle> {
  const canvas = makeCanvas(container);
  canvas.width = VIEWPORT.width;
  canvas.height = VIEWPORT.height;
  canvas.style.width = `${VIEWPORT.width}px`;
  canvas.style.height = `${VIEWPORT.height}px`;

  const runtime = await GpuRuntime.create();
  const { graph } = generateClusteredGraph(40, 4);

  let mounted: GraphComponent | null = null;
  let handle: MountHandle | null = runtime.mount(() => {
    mounted = new GraphComponent();
    return mounted;
  }, canvas);
  mounted!.update({ data: graph, viewport: VIEWPORT });

  return {
    canvas,
    stop() {
      handle?.unmount();
      handle = null;
      runtime.dispose();
    },
  };
}
