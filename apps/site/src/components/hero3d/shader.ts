/**
 * The hero's WGSL. One shader, one storage buffer of per-instance quads, one draw call —
 * `packages/core/src/layers/instancedQuad.ts`'s pattern (instance data in `storage`, vertex shader
 * spawns geometry from the bound attributes, fragment reads straight-alpha color), adapted for 3D:
 * the vertex position comes from `geometry(gpu, plane())` (see `spikes/hero3d-vgpu-feasibility.ts`)
 * instead of `@builtin(vertex_index)`, and each instance carries a real affine transform — an
 * in-plane translate + non-uniform scale — rather than the spike's Z-offset-only shortcut.
 *
 * `plane()` geometry lies flat in the local XZ plane (+Y normal, width along X, height along Z;
 * `vgpu`'s `mesh-plane.d.ts`). Every plane in this scene stays upright and camera-facing by
 * construction (no per-instance rotation needed — the hero has no tilted panels), so local X maps
 * to world X and local Z maps to world Y; `tz` places the instance's whole layer at its resting
 * depth.
 *
 * Phase 3 adds the one-time reveal: `scene.sceneT` (0 = collapsed, 1 = settled) lerps every
 * instance's Z between a single shared `scene.collapsedZ` and its own authored `tz`. Deliberately
 * *not* also compensating `sx`/`sy` for the distance change: an earlier version did (scaling each
 * instance's collapsed size by the ratio of camera-to-plane distances, to keep its apparent screen
 * size constant across the move) and it was wrong — that compensation exactly cancels the one cue
 * that makes "separating in depth" visible under a perspective camera at all. Size ∝ 1/distance is
 * the whole effect; letting the projection do it for free (unchanged `sx`/`sy`, only `tz` moves) is
 * both the simpler shader and the one that actually reads as depth separating out.
 */
export const HERO3D_WGSL = /* wgsl */ `
struct Camera {
  viewProjection: mat4x4f,
}

struct Scene {
  sceneT: f32,
  collapsedZ: f32,
}

struct Instance {
  tx: f32,
  ty: f32,
  tz: f32,
  sx: f32,
  sy: f32,
  _pad0: f32,
  _pad1: f32,
  _pad2: f32,
  color: vec4f,
}

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<storage, read> instances: array<Instance>;
@group(0) @binding(2) var<uniform> scene: Scene;

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
}

@vertex
fn vs_main(
  @location(0) position: vec3f,
  @builtin(instance_index) instanceIndex: u32,
) -> VertexOut {
  let inst = instances[instanceIndex];
  let z = mix(scene.collapsedZ, inst.tz, scene.sceneT);
  let world = vec3f(
    position.x * inst.sx + inst.tx,
    position.z * inst.sy + inst.ty,
    z,
  );
  var out: VertexOut;
  out.position = camera.viewProjection * vec4f(world, 1.0);
  out.color = inst.color;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  // Straight (non-premultiplied) alpha — the "alpha" BlendPreset's (src-alpha,
  // one-minus-src-alpha) factors do the premultiply in the fixed-function blend unit.
  return in.color;
}
`;

/** Bytes per `Instance` above: 8 f32 scalars + a vec4f color = 12 f32 = 48 bytes. */
export const HERO3D_INSTANCE_STRIDE = 48;
