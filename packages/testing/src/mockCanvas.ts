import type { Gpu } from "vgpu";

// WebGPU spec flag bits (GPUTextureUsage.*). Not available as a runtime global under Node —
// @webgpu/types provides only compile-time types — so they're inlined here.
const COPY_SRC = 0x01;
const TEXTURE_BINDING = 0x04;
const RENDER_ATTACHMENT = 0x10;

/**
 * A fake `HTMLCanvasElement` whose `getContext('webgpu')` is backed by the mock `GPUDevice`
 * itself: `configure()` records the format, `getCurrentTexture()` allocates a real (mock) texture
 * from `gpu.gpu.createTexture(...)` on demand. `vgpu`'s `surface()` never inspects anything about
 * the canvas beyond `getContext`, `width`/`height`, and (indirectly, through the context) the
 * texture it hands back — so this is enough for `surface(gpu, canvas)` to succeed against a mock
 * `Gpu`, letting `@gpu-components/core`'s real `GpuRuntime.mount()` path run in tests with no DOM.
 */
export function createMockCanvas(
  gpu: Gpu,
  size: readonly [number, number] = [2, 2],
): HTMLCanvasElement {
  const [width, height] = size;
  let format: GPUTextureFormat = "rgba8unorm";
  let current: GPUTexture | undefined;

  const context = {
    configure(opts: GPUCanvasConfiguration) {
      format = opts.format;
    },
    unconfigure() {
      current = undefined;
    },
    getCurrentTexture(): GPUTexture {
      current?.destroy();
      current = gpu.gpu.createTexture({
        size: [width, height, 1],
        format,
        usage: COPY_SRC | TEXTURE_BINDING | RENDER_ATTACHMENT,
      });
      return current;
    },
  };

  return {
    width,
    height,
    getContext: (id: string) => (id === "webgpu" ? context : null),
  } as unknown as HTMLCanvasElement;
}
