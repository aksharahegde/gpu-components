import type { RunOptions } from "../src/harness/runner.ts";
import type { SharedContextResult } from "../src/harness/sharedContextScenario.ts";
import type { GpuTimingResult } from "../src/harness/gpuTimingScenario.ts";
import type { RendererId, RunResult, Shape } from "../src/types.ts";

declare global {
  interface Window {
    __bench: {
      runCell(renderer: RendererId, shape: Shape, size: number, opts?: Partial<RunOptions>): Promise<RunResult>;
      runSharedContext(): Promise<SharedContextResult>;
      runGpuTiming(): Promise<GpuTimingResult>;
    };
  }
}
