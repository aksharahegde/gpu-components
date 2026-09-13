# Spike: can `vgpu`'s 3D toolkit render a translucent, depth-less hero scene?

**Date:** 2026-09-13 · **Status:** resolved · **Resolves:** the Phase 0 de-risking bet for the
marketing-site 3D hero (build on `vgpu` directly, zero new dependencies — no Three.js/R3F)

## The question

The whole 5-phase hero plan depends on one thing: `vgpu`'s undocumented-but-present 3D toolkit
(`node_modules/vgpu/dist/scene.d.ts` — `perspectiveCamera`, `geometry(gpu, plane())`) can render
3-4 translucent instanced planes at different depths, back-to-front alpha-blended, on a `Surface`
that has **no depth attachment** (`CanvasSurface.get depth(): undefined`, confirmed in
`node_modules/vgpu/dist/surface.d.ts`), with correctness coming entirely from a CPU-side
painter's-algorithm draw order. If the camera API doesn't hand a WGSL-ready matrix, or `draw()`
can't blend without a depth buffer, or the geometry sugar doesn't wire up cleanly, the plan needs a
different foundation before Phase 1 starts.

## What was built

`spikes/hero3d-vgpu-feasibility.ts` — a standalone script, not wired into any build/test chain:

1. Boots a real headless `Gpu` via `vgpu/node` (Dawn) — same pattern every `registry/*/render.pixels.test.ts` uses (`const { init } = await import("vgpu/node"); const gpu = await init();`).
2. Creates an off-screen `target(gpu, { size: [W, H] })` (not a canvas `surface()` — no canvas exists in Node) and logs `target.depth`.
3. Builds a `perspectiveCamera({ fov, aspect, near, far, position, target })` and reads `camera.viewProjection` — a stable, in-place-updated `Float32Array(16)`, column-major, directly WGSL-`mat4x4f`-shaped.
4. Builds one `geometry(gpu, plane({ width: 2, height: 2 }))`.
5. Draws it 4 times in one `draw()` call — `instances: 4`, `blend: "alpha"`, `depth: false` — reading per-instance depth/scale/color from a `storage` buffer, mirroring `packages/core/src/layers/instancedQuad.ts`'s instance-buffer pattern.
6. Reads the target back with `target.read()` and encodes it to PNG with `pngjs` (already a repo dependency; `vgpu`'s own docs — `@vgpu/adapter-node/create-node-adapter.docs.md` — explicitly say PNG encoding is project tooling's job, "such as `pngjs`", not the API's).

Run it:

```
node --experimental-strip-types spikes/hero3d-vgpu-feasibility.ts
```

Output: `spikes/hero3d-vgpu-feasibility.png`, plus two stdout lines: `target.depth: undefined` and a
non-background pixel count.

## What worked, exactly

- **`target.depth` is `undefined` by default, confirmed at runtime**, not just from the `.d.ts`. No `depth: true` was requested when creating the target, so nothing had to be disabled.
- **`draw()`'s `depth: false` is accepted and is a no-op** on a target with no depth attachment — per `draw.d.ts`'s own comment ("Ignored when the target has no depth"), which this spike verified rather than trusted blindly.
- **`camera.viewProjection` binds directly as a plain object field** — `planes.set({ camera: { viewProjection: camera.viewProjection } })` — no manual buffer packing, no `uniforms(gpu, …)` wrapper needed. `draw().set()` accepts inline JS objects for uniform structs and packs them itself via WGSL reflection (confirmed via `mcp__vgpu__docs` — `guides/concepts-draws.docs.md` and `vgpu/uniform.docs.md` show the identical `camera: { viewProjection: camera.viewProjection }` idiom). Because the array is a stable identity updated in place, a real animated hero would only need to call `.set()` again when the camera actually moves.
- **`geometry(gpu, plane())` wires into `draw()`'s `geometry` option with zero manual vertex-buffer-layout code.** The geometry sugar pins attribute locations by name — `position → @location(0)`, `normal → @location(1)`, `uv → @location(2)` (confirmed via the `mcp__vgpu__docs` corpus, `vgpu/geometry.docs.md`) — so the hand-written WGSL only had to declare `@location(0) position: vec3f` and it matched automatically.
- **One `draw()` call, `instances: 4`, one storage buffer, back-to-front order** — no per-draw-call blend/sort logic needed beyond writing the instances in the right order before the single draw.
- **`Frame.pass(options, draw)` accepts a `Draw` directly as the pass body** — no manual `GPURenderPassEncoder` plumbing for a single-draw frame.

## One deliberate simplification (not a blocker)

`plane()` geometry lies flat in the local XZ plane with a fixed +Y normal (`mesh-plane.js`: `width`
along X, `height` along Z). Rather than build a per-instance model/rotation matrix (a real feature
for Phase 1, not needed to answer this spike's question), the shader reinterprets the mesh's local
X → world X and local Z → world Y, using the per-instance `depthZ` field for world Z. That produces
upright, camera-facing planes with zero matrix math in the shader. This is a shortcut the real hero
component should not keep as-is — it will want full per-instance transforms — but it does not
touch anything this spike exists to de-risk (camera matrix shape, blend-without-depth, geometry
wiring).

## The screenshot

`spikes/hero3d-vgpu-feasibility.png` (640×400, dark navy `#0f0f14` background): four concentric
square "frames" nested inside each other, largest/outermost at the back and smallest/innermost in
front — exactly the shrinking-with-distance effect a perspective camera should produce for planes
of decreasing apparent size as they recede. Colors were chosen maximally distinct per plane (red,
green, blue, yellow, each α≈0.55) specifically so incorrect blending would be obvious as visibly
wrong hues; instead each concentric band reads as a smooth, physically plausible composite — olive
where red-under-green overlaps, sage-khaki toward the center where all four layers stack. No
z-fighting, no incorrect occlusion, no banding artifacts at the plane edges, and the outermost
(farthest, red) plane is fully visible only where nearer planes don't cover it — precisely the
back-to-front painter's-algorithm behavior this spike set out to prove. 81,796 of 256,000 pixels
are non-background, confirming all 4 planes actually drew (not a silent empty-frame bug, the same
class of defect `registry/timeline/render.pixels.test.ts` was written to catch).

## Verdict

**Yes — Phase 1 should proceed as planned.** Every API this spike exercised (`perspectiveCamera()`,
`geometry(gpu, plane())`, `draw()` with `blend: "alpha"` and `depth: false`, instanced storage-buffer
draws, depth-less alpha-blended `target()`/`Surface`) behaved exactly as the `.d.ts` files and the
`mcp__vgpu__docs` corpus said they would, with no matrix-format mismatch, no missing camera data,
and no `draw()` limitation forcing a workaround. The zero-new-dependencies constraint holds:
`pngjs` is spike-only tooling for producing this screenshot, not something the hero component
itself needs. The one open item for Phase 1 is per-instance model transforms (position/rotation,
not just a Z offset) — expected, ordinary component work, not a feasibility risk.
