# Decision record: canvas-per-component vs. mega-canvas

PLAN.md's Phase 0 goal (a) calls for validating "one device / many canvases / one submit works and
is faster than N devices" before the runtime is built. By the time Phase 0 was backfilled, the
runtime already existed and had already made this choice — this is a **retroactive** record, not a
fresh spike, plus one new measurement that specifically covers the "faster than N devices" half.

## The decision

One shared `GpuRuntime` (§10.1), one `Gpu`/device, many independently-registered canvas surfaces
(`registerSurface`), one `FrameScheduler` collecting every mounted component's compute passes, then
every render pass, into one command encoder, one submit per tick (§10.2). Not a single "mega-canvas"
that every component draws into — each component keeps its own `<canvas>` and its own render target;
what's shared is the device, the scheduler, and the submit.

## Why, and where it's already validated

- **Architecture exists and is tested.** `packages/core/src/runtime.ts` (`GpuRuntime.mount`,
  `registerSurface`) and `packages/core/src/scheduler.ts` (`FrameScheduler.tick`: collects all
  compute passes before any render pass, one `frameLoop` per runtime) implement exactly this.
  `packages/core/src/scheduler.test.ts` and `runtime.test.ts` — 16/16 passing — cover mount/unmount,
  dirty-tracking, and the compute-before-render ordering.
- **"Faster than N devices," specifically, was not covered by the existing tests** — they check
  correctness/ordering, not a timing comparison against the alternative. `src/harness/
  sharedContextScenario.ts` adds that: two `TimelineComponent`s mounted under one shared
  `GpuRuntime` vs. two components each under their own independent `GpuRuntime` (its own device),
  same two canvases, same per-frame `invalidate()` pattern. Real numbers are in
  `results/BASELINES.md`'s "Phase 0 goal (a)" section, generated fresh on every full `npm run bench`
  run — not reproduced here as a point-in-time claim, since the whole point of committing the
  scenario as code is that it can be re-run rather than trusted from memory.

## What this does *not* claim

The comparison is two components at a small, fixed, empty-payload size — it isolates
scheduling/submit overhead, not rendering throughput at scale. It also doesn't touch the actual
"many canvases" ceiling (how many concurrent surfaces before scheduler overhead dominates) — that's
a natural `sharedContextScenario.ts` extension (parameterize component count) if it becomes a real
question, not something this record asserts an answer to today.
