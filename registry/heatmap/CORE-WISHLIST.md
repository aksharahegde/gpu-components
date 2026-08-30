# The architecture test: what `GPUHeatmap` needed from `core`

PLAN.md §29 Phase 5 states the acceptance criterion as a falsifiable claim:

> **`GPUHeatmap` requires zero changes to `core`.** If it does not, the runtime abstraction was
> wrong and we fix it before the DataGrid, not after.

This file is the evidence. It was written *while* building, logging every point where the honest
reaction was "I want to change core here" — rather than reconstructed afterwards, when the answer
would inevitably flatter the answerer.

**Scope: all six stages** — data model, raster render, compute in the data path, two-axis
interaction, row/column headers doubling as the accessibility layer, and the Canvas2D fallback.

## Final result: **two** changes to `core` were required

Stages 1–3 needed none. Stages 4–6 needed two, both found by building — and one of them only by
looking at the component in a browser.

| # | Change | Why it was unavoidable |
|---|---|---|
| 1 | `ViewportState` gained a visible **row range** (`rowStart`/`rowEnd`), and `ViewportController` gained `zoomAtY` + a `deltaY` on `panByPixels` | The y axis had no zoom or pan at all. A heatmap has two continuous axes. Predicted below and confirmed. |
| 2 | `useGpuComponent` now **seeds a freshly mounted component with the props it already has** | Not predicted. See below — it is the more interesting of the two. |

### Change 1, done compatibly rather than as the rename this file first proposed

The generalisation is arithmetic-compatible: at `[0, trackCount]` the derived scale/offset are
*identical* to what the old code produced, so every existing shader, label placement and hit-test
keeps its exact pixel behaviour, and the Timeline needed no changes at all. `zoomAtY` and vertical
panning are inert on a viewport that never opted into a row range, so adding the axis cannot make
an existing component start scrolling (asserted in `interaction.test.ts`).

**The fuller rename is still deferred**, and the reasoning has changed since this file was written.
The vocabulary is still wrong — the heatmap passes its column domain as `timeStart`/`timeEnd`. But
the *mechanism* now generalises correctly, and a rename touches 25 files across five packages for
zero behavioural gain. Better done as its own change, with the DataGrid as the third consumer, than
smuggled into a component's feature work.

### Change 2, the one worth reading: `useGpuComponent` never delivered the first update

`GPUHeatmap` rendered a completely blank canvas while every test passed. The cause was in `core`'s
React adapter, not in the component:

- The canvas reaches the hook through `setState` from a ref callback, so the component cannot mount
  until render #2.
- The hook delivered props only from a `useEffect` keyed on `[props]`.
- A caller passing a **memoised** props object — which is what the React documentation tells you to
  do — therefore never re-fires that effect after the component exists. The component is created,
  and never told what to draw.

`GPUTimeline` was unaffected purely by accident: it passes a fresh object literal on every render,
so its effect re-fires and the first update lands. The bug had been latent in the adapter since
Phase 1 and could not surface until a second component was written by someone following different
(better) React habits.

The fix seeds the newly mounted component in a microtask, guarded so it never double-delivers.
Regression test: `GPUProvider.test.ts`, "delivers the first update() even when props are memoised".

**This is the finding the architecture test existed to produce.** Not "the runtime abstraction was
wrong", but "the runtime had a shape assumption nobody knew it was making, and only a second,
differently-written consumer could reveal it".

## What carried unchanged

### What carried unchanged, and was genuinely reused

| `core` surface | How the heatmap used it |
|---|---|
| `RasterLayer` | The entire render path. A colormapped matrix is exactly the "texture through `effect()` with a colormap" §12.1 describes, and the storage-buffer-not-`GPUTexture` decision made for the Timeline's density field paid off directly — the value matrix is already a buffer. |
| `viewportUniforms()` | Reused verbatim. The scale/offset math is genuinely axis-agnostic even though its *field names* are not: `timeToClip` carries the column domain, `trackToClip` the row domain, and the shader inverts the same mapping the Timeline's shader applies forward. |
| `ResourceRegistry` | The colormap LUT. **This is the registry's first production consumer anywhere in the repo** — it shipped in Phase 1 and `registry/timeline` never calls `acquire()`. Two heatmaps with the same ramp now share one buffer, and it releases correctly at refcount zero (asserted in `heatmap.test.ts`). |
| `GpuComponent` contract | `create`/`update`/`plan`/`dispose` + optional `hitTest` fit without strain. The `plan()`-is-pure rule made the "reduce only when data changed" optimisation trivial to express: return no compute passes and the scheduler does nothing. |
| Scheduler ordering | Compute-before-render across all components is what lets the render shader read a `range` buffer the reduction wrote in the same frame, with no CPU round-trip. |
| Device-loss replay | The re-upload-in-`create()` pattern the Timeline established transferred directly. |
| `PassEncoder` | `raster.draw(pass)` is backend-agnostic, so the heatmap's fallback is a `RasterFallbackPolicy` away rather than a second renderer. |

The genuinely encouraging part is the *second* row: the viewport math generalised even though nobody
designed it to. The scale/offset pair is the right abstraction; only its vocabulary is wrong.

## The one blocking finding: `ViewportState` is timeline-shaped

Not a naming quibble. Three concrete problems, in increasing severity:

1. **Vocabulary.** `timeStart` / `timeEnd` / `trackCount` describe a trace, not a matrix. The
   heatmap passes its column domain as "time" and its row count as "tracks", which typechecks and
   reads as nonsense. A `GPUDataGrid` (Phase 5's other component) will have exactly the same
   problem, so this is not heatmap-specific.

2. **The y axis has no zoom or pan.** `trackToClip` is derived purely from `trackCount` — it maps
   row *index* to a fixed row centre spanning the full surface. There is no `rowStart`/`rowEnd`.
   A heatmap needs two continuous, independently zoomable axes.

3. **`ViewportController` and `ViewportBounds` are x-only.** `zoomAt(pixelX, factor)`,
   `panByPixels(deltaX)`, `{timeMin, timeMax}`. The heatmap cannot use them at all, so it currently
   uses *neither* — stages 1–3 render a fixed full view.

**Why this did not fail the test yet:** stages 1–3 never zoom vertically, so the fixed row mapping
is correct for a full-matrix view. The moment stage 5 lands, it breaks.

### Proposed change, when stage 5 comes

Generalise to a domain-named, symmetric model, and port the Timeline onto it:

```ts
interface ViewportState {
  readonly x: { min: number; max: number };   // time, or column index
  readonly y: { min: number; max: number };   // track row, or matrix row
  readonly width: number;
  readonly height: number;
}
```

with `zoomAt(px, py, factorX, factorY)` and `panByPixels(dx, dy)`. The Timeline keeps its current
behaviour by holding `y` fixed to `[0, trackCount]` and passing `factorY = 1` — its vertical
behaviour is a *special case* of the general model, not a different model. Deliberately deferred:
doing it now, before a second consumer exists, would be guessing at the shape; doing it with two
real consumers in hand is design.

## Smaller notes, none blocking

- **No `LabelLayer` or shared a11y overlay in `core`.** The Timeline's DOM label + semantic overlay
  lives in `registry/timeline/GPUTimeline.tsx`. A heatmap needs row/column headers with the same
  structure, so stage 5 would copy it. That duplication is the signal §21 warns about — the overlay
  is architectural, and two components hand-rolling it is how a11y rots. Worth promoting to `core`
  or to a shared registry module *before* the DataGrid, which needs it a third time.
- **`ResourceRegistry.acquire()` takes an optional `dispose` callback**, but `vgpu`'s `StorageBuffer`
  has no public `destroy()` (the same limitation `InstancedQuadLayer.dispose()` documents), so the
  LUT is reclaimed with the `Gpu`. Fine today; worth revisiting if vgpu exposes disposal.
- **No shared reduction kernel.** The heatmap's min/max tree reduction is genuinely reusable — a
  Timeline auto-ranging its value axis, or a scatter plot, would want the same thing. §10.5 says we
  ship *kernels* as reusable WGSL rather than a `ComputeManager`, and this is the first candidate.
  Not moved yet: one consumer is not a pattern.
