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

**Re-running with the fix, scaling component count (2, 4, 8):** every configuration at every count
ties at the vsync floor (p50 16.700ms, 0 dropped frames). This turned out to be expected, not a new
finding: an indirect draw with a 0-instance count and a 16-byte buffer write are both far too cheap,
even ×8 independent `GPUDevice`s, to approach the 16.6ms frame budget — `dispatchCull()` returns
early for a component with no uploaded spans, so this round wasn't exercising real GPU work at all,
just the cheapest possible framework overhead ×N.

## Round 2 (2026-08-30): real payload, oscillating viewport, N up to 48 — still no signal

Gave each component `PAYLOAD_SPANS = 2,000` real spans and drove every measured frame through
`component.update()` with an oscillating viewport (`renderers/webgpu.ts`'s own "always real work,
never a cached repaint" pattern) instead of the `animating` shortcut — this forces a genuine
viewport-uniform write, cull-compute dispatch, and non-zero indirect draw every tick, replacing the
degenerate zero-instance case Round 1 accidentally measured. Also pushed `COMPONENT_COUNTS` to
`[2, 8, 16, 24]` (committed) and spot-checked as high as **48** independent `GPUDevice`s (not
committed — this environment never actually hit a device cap worth reporting, so there's nothing
more informative to keep at that count than at 24).

**Result: still tied at the vsync floor, at every N tested, up to 48 real-payload independent
devices.** See `BASELINES.md`'s Phase 0 goal (a) table for the full 2/8/16/24 numbers. Both
dimensions available to this wall-clock methodology — payload size and component/device count — have
now been pushed meaningfully (2,000 real spans × up to 48 devices, each genuinely dispatching compute
+ an indirect draw every frame) without finding daylight between the two architectures. That's not
because they're proven equivalent; it's because **`requestAnimationFrame`-interval measurement has a
hard floor at the display's vsync rate, and nothing tested so far pushes total per-tick work anywhere
close to that ~16.6ms budget** — so there is no ms-of-headroom for a shared-vs-independent difference
to consume. `decision-record.md`'s original "what this does not claim" caveat was right for a
different reason than initially stated: the ceiling this methodology can't see past isn't about
"how many canvases" so much as "how much total work is inside the frame budget."

**What would actually produce a signal (not attempted here):**
1. **Direct timing of the encode/submit step itself**, bypassing vsync entirely — e.g. bracket the
   synchronous portion of the frame-loop callback with `performance.now()`, or use `vgpu`'s
   `timer(gpu)` GPU timestamp-query spans (PLAN.md §10.7's `Profiler`, explicitly a Phase 4 item, not
   done yet). This is the methodologically correct fix, not a bigger version of what Round 2 already
   tried — wall-clock rAF-interval measurement cannot see sub-vsync differences by construction, no
   matter how much payload or how many devices, until the *sum* of that work exceeds one frame.
2. Alternatively, payload and/or component count large enough that total work genuinely exceeds one
   frame's budget (unlike Round 2, which stayed comfortably under it) — real dropped frames would let
   the existing wall-clock methodology show a difference, at the cost of measuring something closer
   to "which config degrades more gracefully under overload" than "which has lower fixed overhead."

Recorded honestly as: **the founding claim is still neither confirmed nor contradicted.** Two rounds
of investigation replaced a harness bug (a false negative) with a methodology ceiling (no signal
either way) — that is real progress, not a wash, but it is not a validated architectural claim.

## Round 3 (2026-08-30): real GPU timing (the Profiler) — confirmed

Built the Phase 4 `Profiler` (`packages/core/src/profiler.ts`, wraps `vgpu`'s `timer(gpu)`) — see
PLAN.md §10.7's status note — specifically to attempt Round 2's item 1: measure the actual GPU cost
of a tick directly, bypassing the vsync floor entirely. `apps/bench/src/harness/gpuTimingScenario.ts`
reuses `sharedContextScenario.ts`'s payload/drive helpers (same workload, same 2,000-span payload,
same oscillating-viewport drive pattern) but reports mean total GPU milliseconds per tick — summed
across every mounted component's real `timer.span()` results — instead of wall-clock `requestAnimationFrame`
interval.

**Result, from the most recent run (`BASELINES.md`'s own table has these numbers; five total runs
across this session are consistent with them — see below):**

| N | Shared GPU ms/tick | Independent GPU ms/tick | Ratio |
|---|---:|---:|---:|
| 2 | 0.065 | 0.108 | 1.65× |
| 8 | 0.304 | 0.606 | 2.00× |
| 16 | 0.554 | 1.389 | 2.51× |
| 24 | 0.750 | 1.199 | 1.60× |

**This confirms the architectural bet.** At N=2 the two are within noise of each other — both
configurations' per-tick cost is small enough that measurement variance dominates. From N=8 onward
the shared runtime consistently, reproducibly costs meaningfully less real GPU time per tick than N
independent devices doing the same aggregate work. This was reproduced across five separate runs in
this session (not cherry-picked): shared stayed clean and roughly linear in N across every run
(≈0.05-0.08ms at N=2, ≈0.29-0.34ms at N=8, ≈0.47-0.55ms at N=16, ≈0.73-0.76ms at N=24); independent
was consistently and substantially higher at every N≥8 across every run.

**Honestly noted, not smoothed over: the ratio is not monotonic.** It widens from N=8 to N=16
(2.00× → 2.51×) then narrows at N=24 (down to 1.60×) — reproduced consistently across all five runs,
so it's a real, repeatable feature of this environment, not noise. The cause hasn't been
investigated; a plausible guess is driver- or OS-level batching/coalescing behavior across many
concurrent `GPUDevice`s changing above some threshold on this specific machine, but that's a guess,
not a finding — flagged as open, not asserted.

**What this doesn't resolve:** this is one machine, one browser (Chromium via Playwright, headless
ANGLE/Metal), one workload shape (small real payload, N up to 24 components/devices). It confirms the
*direction* of the architectural bet — shared genuinely costs less GPU time than N independent
devices for the same work — not a specific multiplier that generalizes across hardware, browsers, or
workload shapes. The `sharedContextScenario.ts`/Round 1-2 wall-clock rounds remain useful for a
different question this doesn't answer: whether the difference is large enough to matter at the
*frame-budget* level (dropped frames), which needs either far more components or far heavier payload
than tested here.

**Status: the founding claim (PLAN.md §2(a)/§11, "one device across N components") is now
confirmed, not merely un-contradicted.** First real answer after three rounds of investigation.
