# GPUAnnotationCanvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a playground-only scientific annotation canvas: Float32 field + colormap/window, retained scene graph of measurement overlays, hybrid draw tools that emit host events.

**Architecture:** Bounded scene graph (`Root → ImageNode | AnnotationGroup → nodes`) in `registry/annotationcanvas/`. Field drawn like heatmap (storage/texture + colormap + window uniforms); annotations as GPU quads/lines with CPU hit-test and DOM measurement labels. No CLI registry entry.

**Tech Stack:** TypeScript, WGSL/`vgpu`, `@gpu-components/core` + `@gpu-components/react`, node:test + Dawn, Next.js playground demo.

**Spec:** `docs/superpowers/specs/2026-09-01-gpuannotationcanvas-design.md`

## Global Constraints

- Medical / scientific Float32 field + colormap + window — not CV labeling or screenshot markup.
- Overlays: rect, ellipse, point, ruler, polygon, freehand; length/area via DOM labels.
- Hybrid: props annotations + tools → `onCreate` / `onChange` / `onDelete`.
- Scene graph v1 is shallow: Root → Image | AnnotationGroup → AnnotationNode[].
- Large single texture within caps (document ≤8192); no pyramid tiling.
- Playground + tests only — **do not** add to `packages/cli/scripts/buildRegistry.mjs`.
- Prefer zero `@gpu-components/core` API changes; if float texture helpers are missing, use storage-buffer field sampling like `GPUHeatmap` / `RasterLayer` patterns already in core.
- Follow heatmap ingest validation and imagediff viewport (x=cols, y=rows) conventions.

## File map

| Path | Responsibility |
|------|----------------|
| `registry/annotationcanvas/ingest.ts` | `ingestField`, `FieldData`, caps |
| `registry/annotationcanvas/measure.ts` | length/area oracles |
| `registry/annotationcanvas/scene.ts` | scene graph, transforms, hit-test |
| `registry/annotationcanvas/field.wgsl.ts` | field + colormap + window |
| `registry/annotationcanvas/annotations.wgsl.ts` | shape drawing |
| `registry/annotationcanvas/AnnotationCanvasComponent.ts` | GPU component |
| `registry/annotationcanvas/tools.ts` | pointer → draft annotations |
| `registry/annotationcanvas/GPUAnnotationCanvas.tsx` | React wrapper |
| `registry/annotationcanvas/index.ts` | barrel |
| `registry/annotationcanvas/*.test.ts` | tests |
| `package.json` | test:registry glob |
| `apps/site/...` | demo + playground + matrix p7 |

**Reference (read, don't modify unless necessary):** `registry/heatmap/*`, `registry/imagediff/*`, `registry/scatter/GPUScatter.tsx`, `apps/site/src/components/demos/chrome.tsx`

---

### Task 1: Ingest + measure

**Files:**
- Create: `registry/annotationcanvas/ingest.ts`
- Create: `registry/annotationcanvas/measure.ts`
- Create: `registry/annotationcanvas/ingest.test.ts`

**Interfaces:**
- Produces:
  - `MAX_FIELD_DIM = 8192`, `VALUE_STRIDE = 4`
  - `ingestField({ width, height, values, window? }): FieldData`
  - `FieldData { width, height, values: Float32Array<ArrayBuffer>, window: { min, max } }`
  - `lengthOf(x0,y0,x1,y1)`, `areaRect(w,h)`, `areaEllipse(w,h)`, `areaPolygon(points)`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ingestField } from "./ingest.ts";
import { areaEllipse, areaPolygon, areaRect, lengthOf } from "./measure.ts";

describe("ingestField", () => {
  it("wraps values and defaults window to finite min/max", () => {
    const values = new Float32Array([1, 2, 3, 4]);
    const f = ingestField({ width: 2, height: 2, values });
    assert.equal(f.width, 2);
    assert.equal(f.window.min, 1);
    assert.equal(f.window.max, 4);
  });

  it("rejects size/length mismatch and non-positive dims", () => {
    assert.throws(() => ingestField({ width: 2, height: 2, values: new Float32Array(3) }), /expected 4/);
    assert.throws(() => ingestField({ width: 0, height: 1, values: new Float32Array(0) }), /positive/);
  });

  it("honours explicit window", () => {
    const f = ingestField({
      width: 2,
      height: 1,
      values: new Float32Array([0, 10]),
      window: { min: 2, max: 8 },
    });
    assert.deepEqual(f.window, { min: 2, max: 8 });
  });
});

describe("measure", () => {
  it("computes length and areas", () => {
    assert.equal(lengthOf(0, 0, 3, 4), 5);
    assert.equal(areaRect(3, 4), 12);
    assert.ok(Math.abs(areaEllipse(2, 2) - Math.PI) < 1e-6);
    assert.equal(areaPolygon([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }]), 4);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
node --experimental-strip-types --import ./registry/timeline/test/register.mjs --test registry/annotationcanvas/ingest.test.ts
```

- [ ] **Step 3: Implement `ingest.ts` and `measure.ts`**

Mirror heatmap’s length/dim checks. Skip NaNs when computing default window (if all NaN, use `{ min: 0, max: 1 }`). `areaPolygon` = shoelace absolute / 2. Ellipse area = `π * (w/2) * (h/2)`.

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add registry/annotationcanvas/ingest.ts registry/annotationcanvas/measure.ts registry/annotationcanvas/ingest.test.ts
git commit -m "$(cat <<'EOF'
Add GPUAnnotationCanvas field ingest and measurement helpers.

EOF
)"
```

---

### Task 2: Scene graph + hit-test

**Files:**
- Create: `registry/annotationcanvas/scene.ts`
- Create: `registry/annotationcanvas/scene.test.ts`

**Interfaces:**
- Produces:
  - `Annotation` type (per spec)
  - `createScene(field, annotations) → Scene`
  - `Scene` methods: `setAnnotations`, `hitTest(imageX, imageY) → id | null` (topmost)
  - Geometry helpers used by hit-test (point-in-rect/ellipse, distance-to-segment, point-in-polygon)

- [ ] **Step 1: Failing tests** for hit-test order (later annotation wins), miss returns null, polygon contains.

- [ ] **Step 2: Implement** shallow scene: store field size + annotation array; hit-test reverse iterate with kind-specific tests; stroke tolerance ~3 image units or `max(3, min(w,h)*0.01)` for lines.

- [ ] **Step 3: Tests PASS → commit**

```bash
git commit -m "$(cat <<'EOF'
Add annotation scene graph with CPU hit-testing.

EOF
)"
```

---

### Task 3: Field + annotation shaders

**Files:**
- Create: `registry/annotationcanvas/field.wgsl.ts`
- Create: `registry/annotationcanvas/annotations.wgsl.ts`

**Interfaces:**
- `FIELD_WGSL` — fullscreen/raster quad in image space; sample storage `array<f32>` by `row*width+col` OR texture if `createImageTexture` already supports float (prefer storage like heatmap if unsure); apply window then Viridis/Magma/Gray LUT.
- `ANNOTATIONS_WGSL` or split EDGE/FILL — instanced shapes reading a packed instance buffer.

Packed annotation instance (suggested 32 bytes): `kind u32, flags u32, x,y,w,h f32` (for ruler w/h unused; x1,y1 in w,h slots; polygons uploaded as separate line segments via `LineLayer`).

**Decision locked in plan:** Use **heatmap-style storage buffer** for the field (proven in-repo) plus **InstancedQuadLayer / LineLayer / draw()** for annotations — still a logical scene graph in TS even if draw paths differ by node kind.

- [ ] **Step 1: Author shaders** (no unit test for strings).
- [ ] **Step 2: Commit**

```bash
git commit -m "$(cat <<'EOF'
Add field colormap and annotation shape shaders.

EOF
)"
```

---

### Task 4: `AnnotationCanvasComponent`

**Files:**
- Create: `registry/annotationcanvas/AnnotationCanvasComponent.ts`
- Create: `registry/annotationcanvas/component.test.ts`

**Interfaces:**
- Props: `field`, `annotations`, `viewport`, `window?`, `colormap?`, `selectedId?`
- `hitTest(px, py)` → `{ id }` using scene + viewport transforms (`pixelXToTime` / `pixelYToTrack` with yContinuous)
- Plan: render pass `annotationcanvas` — field then annotations; no continuous `animating`

- [ ] **Step 1: Failing component tests** (mock GPU create/update/plan; hitTest finds a rect).
- [ ] **Step 2: Implement** upload field on data change; rebuild annotation buffers when annotations/selection change; window/colormap as uniforms.
- [ ] **Step 3: PASS → commit**

```bash
git commit -m "$(cat <<'EOF'
Add AnnotationCanvasComponent field and overlay draw path.

EOF
)"
```

---

### Task 5: Tools + React wrapper + Dawn

**Files:**
- Create: `registry/annotationcanvas/tools.ts`
- Create: `registry/annotationcanvas/GPUAnnotationCanvas.tsx`
- Create: `registry/annotationcanvas/index.ts`
- Create: `registry/annotationcanvas/render.pixels.test.ts`
- Create: `registry/annotationcanvas/tools.test.ts`

**Interfaces:**
- `tools.ts`: given tool + pointer lifecycle → draft `Annotation` or move update; emit-ready objects with new ids (`crypto.randomUUID` or monotonic `ann-${n}`).
- React: pan/zoom like heatmap; wire tools; `LabelOverlay` for measurements of visible selected/nearby annotations (cap 100); a11y summary.

- [ ] **Step 1: tools unit tests** (drag rect produces positive w/h; ruler length).
- [ ] **Step 2: Implement tools + GPUAnnotationCanvas + barrel.**
- [ ] **Step 3: Dawn smoke** — small field + one rect; painted > 20.
- [ ] **Step 4: typecheck:registry + tests PASS → commit**

```bash
git commit -m "$(cat <<'EOF'
Add GPUAnnotationCanvas React wrapper, tools, and Dawn smoke.

EOF
)"
```

---

### Task 6: Site wiring (no CLI)

**Files:**
- Modify: `package.json` test:registry
- Create: `apps/site/src/components/demos/AnnotationCanvasDemo.tsx`
- Create: `apps/site/app/playground/annotationcanvas/page.tsx`
- Modify: `apps/site/app/playground/page.tsx` (card, bump count)
- Modify: `apps/site/app/components/page.tsx` — `GPUAnnotationCanvas` → `p7`

**Do not modify:** `packages/cli/scripts/buildRegistry.mjs`

- [ ] **Step 1: Demo** — generate Float32 peaks on 1024×1024 (or 512 if slow); tool `Segmented`; window slider; local annotation state; seed 2–3 shapes.
- [ ] **Step 2: Playground page + index + matrix.**
- [ ] **Step 3: Verify** site typecheck + annotationcanvas tests.
- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
Wire GPUAnnotationCanvas playground demo without CLI registry.

EOF
)"
```

---

## Spec coverage

| Spec item | Task |
|-----------|------|
| Float32 + colormap + window | 1, 3, 4 |
| Scene graph (shallow) | 2, 4 |
| All annotation kinds + measure | 1, 2, 5 |
| Hybrid events | 5, 6 |
| No CLI | 6 |
| Playground + p7 | 6 |
| Dawn + tests | 4, 5 |

## Placeholder / consistency review

- Types use `FieldData`, `Annotation`, `ingestField`, `AnnotationCanvasComponent`, `GPUAnnotationCanvas` consistently.
- Viewport: image x → time axis, image y → continuous row axis (imagediff/heatmap style).
- Field path: storage buffer + WGSL index (heatmap), not a new core texture API unless already present.

---
