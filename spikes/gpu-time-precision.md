# Spike: GPU time precision (PLAN.md §31, open question #3)

**Status: resolved for v1. Default changed from "no rebasing" (the shipped code before this spike)
to "rebase to a dataset-local origin at pack time." Full per-viewport hi/lo precision remains an
open v2 item, not implemented here.**

## The question

WGSL has no `f64`. Trace timestamps are typically epoch-scale (`Date.now() / 1000` ≈ `1.77e9`
seconds) or, for high-resolution traces, nanosecond-scale over a day (`8.64e13` ns). PLAN.md's
stated default was "rebase per viewport to `f32` relative time," with an explicit note to validate
precision at 1ns resolution over a 24h trace before shipping it.

Before this spike, `registry/timeline` did **no rebasing at all**: `ingest.ts` stored absolute
`start`/`duration` directly in a `Float32Array` (narrowing at ingest, not just at GPU upload), and
`TimelineComponent.ts` fed the raw absolute `viewport.timeStart`/`timeEnd` straight into
`viewportUniforms()`. That is a live, present-day bug, not a hypothetical one — it affects any
consumer whose `RawSpan.start` uses real epoch timestamps.

## Measured numbers (`Math.fround` — exact IEEE-754 f32 rounding, not an approximation)

**Scenario A — current-code behavior: raw absolute epoch seconds narrowed to f32 directly.**

| absolute value | f32 rounding error |
|---|---|
| `1772400000` | 0ns (exact, coincidentally) |
| `1772400000.000001` | **−954ns** |
| `1772400000.001` | **−1.00ms** |
| `1772400001` | **−1.00s** |

At epoch scale, f32 has roughly **1-second granularity**. Any two spans within ~1s of each other
can round to the same clip-space position regardless of their actual duration. This is the
"single most likely source of subtle visual bugs" PLAN.md flagged — confirmed, and worse than
"subtle": at this magnitude it's visible.

**Scenario B — rebased to a fixed dataset-local origin (subtract `min(start)` once, at pack time).**

| offset from origin | f32 rounding error |
|---|---|
| `0` | 0ns |
| `1ns` | ~0ns (exact) |
| `1µs` | ~0ns |
| `1s` | 0ns |
| `1h` (3600s) | 0ns |
| `23h 59m 59s` (86399s) `+ 1ns` | **−1.0ns** |
| `86399s + 1µs` | **−1.0µs** |
| `86399s + 1ms` | **−1.0ms** |

Error scales with distance from the origin, as expected for floating point: ~`value * 2⁻²⁴`. At the
far edge of a 24h dataset the error is millisecond-scale, not nanosecond-scale — **worse than the
literal "1ns over 24h" target**, but roughly **1000× better than Scenario A**, and small enough to
be invisible at any zoom level wide enough to actually show 24h of data (a 1920px-wide canvas
showing 24h has ~45 **seconds** per pixel).

**Scenario C — rebased dynamically to the current viewport's own origin** (what "true" 1ns-at-any-
zoom would require): error stays sub-microsecond as long as the *viewport span* (not the dataset
span) is small — e.g. ~13ns worst-case error at a 1-second viewport span, ~62µs at a 1-hour span.
This is the numeric confirmation that viewport-relative rebasing is necessary for the stated 1ns
target when the user is zoomed into a narrow window far from the dataset's start.

## Why Scenario C isn't implemented yet

Scenario C requires the *storage buffer itself* — not just the viewport uniform — to hold
values relative to a narrow, frequently-changing origin. The buffer is only re-walked/re-packed
when the `spans` prop's identity changes (see `TimelineComponent.update()`), never on pan/zoom —
that's load-bearing: PLAN.md §12.3 and the whole viewport design depend on pan/zoom being "one
uniform write, never a data re-walk." A value already narrowed to f32 at pack time against a fixed
origin cannot recover precision later by subtracting a different (viewport) origin in the shader —
the bits are already gone. Getting genuine viewport-relative precision without re-walking the
buffer on every pan/zoom requires storing each span's time as a **hi/lo f32 pair** (the classic
GPU double-float emulation technique — see MapLibre / other GIS-on-GPU work) and doing
compensated (two-sum) subtraction in the vertex shader against a hi/lo origin uniform. That's a
buffer-layout change (`INSTANCE_STRIDE` grows), a shader-math change, and meaningfully more
complexity than this fix. It is not required by any current MVP acceptance criterion (§32 doesn't
mention sub-microsecond precision), so it's deferred rather than spec'd here.

## Decision

1. **Implemented now:** `SpanBuffers.start`/`duration` changed from `Float32Array` to
   `Float64Array` (removes a gratuitous CPU-side precision loss that had nothing to do with the
   GPU — hit-testing, label placement, and bounds math were narrowing epoch-scale timestamps to f32
   for no reason). `ingest.ts` gained `computeOrigin(spans)` (the true `min(start)` across all
   tracks — spans are sorted by `(track, start)`, not by `start` alone, so this is a real scan).
   `packInstances`/`packHighlights` take an optional `origin` (default `0`, so existing callers are
   unaffected) and subtract it before the f32 narrowing. `TimelineComponent` computes `originTime`
   once per dataset (when the `spans` prop's identity changes, not per frame), uses it for both the
   packed GPU buffers and — critically, so clip-space math stays consistent — the viewport uniforms
   fed to the same shader.
2. **Not implemented, left as a documented v2 item:** dynamic per-viewport (hi/lo) rebasing for
   genuine sub-microsecond precision at arbitrary zoom into a multi-day dataset. Revisit if/when a
   real consumer needs to render nanosecond-scale features deep inside a multi-hour+ trace — the
   LOD binning compute pass (the next Phase 2 work item) is the more natural place to add it, since
   that pass already reads every span's time value once per frame.
3. **Public API unaffected:** `ViewportState`/`RawSpan` stay in the caller's original absolute time
   domain; rebasing is entirely internal to `TimelineComponent`/`ingest.ts`.

## How to reproduce these numbers

```js
const f32 = (x) => Math.fround(x);
// Scenario A: f32(1772400000 + offset) - (1772400000 + offset), for offset in {0, 1e-6, 1e-3, 1}
// Scenario B: f32(base + offset) - (base + offset), for base near 86399 (24h - 1s), same offsets
// Scenario C: f32(viewportOrigin + delta) - (viewportOrigin + delta), delta a fraction of a small viewport span
```
