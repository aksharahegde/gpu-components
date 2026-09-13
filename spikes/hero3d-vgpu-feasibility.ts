/**
 * Spike: does vgpu's undocumented-but-present 3D toolkit (`scene.d.ts` — `perspectiveCamera`,
 * `geometry(gpu, plane())`) support the one thing the hero-component plan depends on — 3-4
 * translucent instanced planes at different depths, back-to-front alpha-blended, with NO depth
 * attachment (a plain `Surface`/`target()` has `depth: undefined` by default), correctness coming
 * entirely from a CPU-side painter's algorithm (draw order)?
 *
 * Throwaway: not wired into any build/test chain. Run directly:
 *
 *   node --experimental-strip-types spikes/hero3d-vgpu-feasibility.ts
 *
 * Writes spikes/hero3d-vgpu-feasibility.png. See spikes/hero3d-vgpu-feasibility.md for the verdict.
 */
import { PNG } from "pngjs";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { draw, frame, geometry, storage, target, type Gpu } from "vgpu";
import { perspectiveCamera, plane } from "vgpu/scene";

const W = 640;
const H = 400;

/**
 * Style note: kept as a plain TS string (`/* wgsl *​/` comment), same convention as
 * `registry/timeline/timeline.wgsl.ts` — no bundler WGSL-loader plugin in this milestone.
 *
 * `geometry(gpu, plane())` pins vertex locations by attribute name — position → @location(0),
 * normal → @location(1), uv → @location(2) (confirmed via `mcp__vgpu__docs` grep on
 * "geometry.docs.md", not guessed) — so only `position` needs declaring here.
 *
 * `plane()` geometry lies in the local XZ plane (+Y normal, width along X, height along Z) per
 * `mesh-plane.js`. To get upright, camera-facing planes without any per-instance rotation matrix,
 * the shader reinterprets the mesh's local X → world X and local Z → world Y, and uses the
 * per-instance `depthZ` for world Z (distance from camera). That is the one deliberate cheat here —
 * a real hero component would carry a full model matrix per instance — but it is enough to prove the
 * camera/blend/depth-less claim this spike exists for.
 */
const WGSL = /* wgsl */ `
struct Camera {
  viewProjection: mat4x4f,
}

struct Instance {
  depthZ: f32,
  scale: f32,
  _pad0: f32,
  _pad1: f32,
  color: vec4f,
}

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<storage, read> instances: array<Instance>;

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
  let world = vec3f(position.x * inst.scale, position.z * inst.scale, inst.depthZ);
  var out: VertexOut;
  out.position = camera.viewProjection * vec4f(world, 1.0);
  out.color = inst.color;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  // Straight (non-premultiplied) alpha — matches the "alpha" BlendPreset's
  // (src-alpha, one-minus-src-alpha) color factors, which do the premultiply in the fixed-function
  // blend unit, not here.
  return in.color;
}
`;

/** Farthest first: correct alpha compositing with no depth buffer depends entirely on this order. */
const PLANES = [
  { depthZ: -4, scale: 1.6, color: [0.95, 0.25, 0.35, 0.55] }, // back, red, drawn first
  { depthZ: -2.6, scale: 1.4, color: [0.3, 0.9, 0.4, 0.55] }, // green
  { depthZ: -1.2, scale: 1.2, color: [0.3, 0.55, 0.95, 0.55] }, // blue
  { depthZ: 0, scale: 1.0, color: [0.95, 0.85, 0.25, 0.55] }, // front, yellow, drawn last
] as const;

const INSTANCE_STRIDE = 32; // depthZ f32, scale f32, pad f32, pad f32, color vec4f — 8 * 4 bytes

async function main(): Promise<void> {
  const { init } = await import("vgpu/node");
  const gpu: Gpu = await init();

  try {
    const surfaceTarget = target(gpu, { size: [W, H] });
    console.log("target.depth:", surfaceTarget.depth); // expect undefined — no depth attachment

    const camera = perspectiveCamera({
      fov: 50,
      aspect: W / H,
      near: 0.1,
      far: 20,
      position: [0, 0, 3],
      target: [0, 0, -2],
    });

    const planeGeometry = geometry(gpu, plane({ width: 2, height: 2 }));

    const instanceBytes = new Float32Array((INSTANCE_STRIDE / 4) * PLANES.length);
    PLANES.forEach((p, i) => {
      const o = (INSTANCE_STRIDE / 4) * i;
      instanceBytes[o + 0] = p.depthZ;
      instanceBytes[o + 1] = p.scale;
      instanceBytes[o + 2] = 0;
      instanceBytes[o + 3] = 0;
      instanceBytes[o + 4] = p.color[0]!;
      instanceBytes[o + 5] = p.color[1]!;
      instanceBytes[o + 6] = p.color[2]!;
      instanceBytes[o + 7] = p.color[3]!;
    });
    const instanceBuffer = storage(gpu, instanceBytes.byteLength, "read");
    instanceBuffer.write(instanceBytes);

    const planes = draw(gpu, {
      shader: WGSL,
      geometry: planeGeometry,
      instances: PLANES.length,
      blend: "alpha",
      cull: "none",
      // Explicit for documentation — a target with no depth attachment ignores this anyway
      // (draw.d.ts: "Ignored when the target has no depth"). The real guarantee is
      // `surfaceTarget.depth === undefined` above, confirmed at runtime, not just from the .d.ts.
      depth: false,
    });
    planes.set({
      camera: { viewProjection: camera.viewProjection },
      instances: instanceBuffer,
    });

    frame(gpu, (f) => {
      // `Frame.pass()` accepts a `Draw` directly as the pass body — no manual pass-encoder
      // plumbing needed for a single draw call.
      f.pass({ target: surfaceTarget, clear: [0.06, 0.06, 0.08, 1] }, planes);
    });
    await gpu.settled();

    const pixels = (await surfaceTarget.read()) as Uint8Array;

    let nonBackground = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] !== 15 || pixels[i + 1] !== 15 || pixels[i + 2] !== 20) nonBackground++;
    }
    console.log(`non-background pixels: ${nonBackground} / ${pixels.length / 4}`);

    const png = new PNG({ width: W, height: H });
    png.data.set(pixels);
    const outPath = join(dirname(fileURLToPath(import.meta.url)), "hero3d-vgpu-feasibility.png");
    writeFileSync(outPath, PNG.sync.write(png));
    console.log("wrote", outPath);
  } finally {
    gpu.dispose();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
