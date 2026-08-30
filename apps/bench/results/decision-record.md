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

The comparison is empty-payload components — it isolates scheduling/submit overhead, not rendering
throughput at scale.

## 2026-08-30 investigation: the first result was a harness bug, and the fixed result is inconclusive

The first `BASELINES.md` run reported the shared runtime's p50 as *higher* than two independent
devices — "does not confirm the architectural bet as measured." Investigating that:

**Root cause: the benchmark measured `requestAnimationFrame` cadence, not the runtime at all.**
`sharedContextScenario.ts` drove its measured frames through `GpuRuntime.invalidate()`, which only
marks *surfaces* dirty (`packages/core/src/runtime.ts`). The scheduler's active-component filter
checks `component.dirty || component.animating` (`packages/core/src/scheduler.ts`) — neither of
which `invalidate()` touches. `TimelineComponent.dirty` starts `true`, flips to `false` after its
first `plan()`, and is never set again because `update()` is never called by this scenario. So after
frame 1 (inside `WARMUP_FRAMES`), `FrameScheduler.tick()`'s `active` list was empty for all 300
"measured" frames, in *both* configurations — nothing was ever encoded or submitted. The measured
`p50 ≈ 16.7ms` was bare vsync cadence, architecture-agnostic by construction; the "shared is worse"
appearance was a single anomalous dropped frame in an otherwise-idle 300-sample loop — noise, not a
finding.

**Fix:** each mounted component now gets `animating = true`, keeping it in the scheduler's active set
every tick, so every measured frame genuinely dispatches the compute pass and encodes+submits the
render pass through the real `vgpu` path, for both configurations.

**Re-running with the fix, and scaling component count (2, 4, 8) to give a real difference room to
appear:** every configuration at every count ties at the vsync floor (p50 16.700ms, 0 dropped
frames) — see `BASELINES.md`'s Phase 0 goal (a) table. This is expected, not a new finding: an
indirect draw with a 0-instance count and a 16-byte buffer write are both far too cheap, even ×8
independent `GPUDevice`s, to approach the 16.6ms frame budget. **The test as designed cannot
currently distinguish the two architectures** — both are bound by the display's vsync interval
regardless of which is actually cheaper underneath it, so this specific measurement has no signal
either way. It is neither a confirmation nor a contradiction of the architectural bet.

**What would actually produce a signal:** either non-trivial per-component payload (real span data,
not empty mounts) so scheduling/submit cost is large enough to approach the frame budget, or a
component count high enough that per-device fixed overhead (driver/memory state) dominates — which
risks hitting a browser's concurrent-`GPUDevice` cap before it produces a difference. Neither is done
here; flagged as follow-up work, not resolved by this investigation.

**Also still not touched:** the actual "many canvases" ceiling (how many concurrent surfaces before
scheduler overhead dominates) at *non-trivial* payload — a further `sharedContextScenario.ts`
extension if it becomes a real question.
