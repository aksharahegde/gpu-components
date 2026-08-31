import { createImageTexture, RasterLayer, viewportUniforms } from "@gpu-components/core";
import type {
  ComponentContext,
  GpuComponent,
  HitResult,
  ImageTexture,
  RenderPlan,
  ViewportState,
  ViewportUniforms,
} from "@gpu-components/core";
import { compute, sampler, storage, uniforms } from "vgpu";
import type { Compute, Gpu, SharedUniforms, StorageBuffer } from "vgpu";
import { modeIndex, type DiffMode, type ImagePair } from "./ingest.ts";
import { DIFF_STATS_WGSL, DIFF_STATS_WORKGROUP_SIZE, IMAGE_DIFF_WGSL } from "./imagediff.wgsl.ts";

export interface ImageDiffProps {
  readonly pair: ImagePair;
  /** x maps image columns, y maps image rows. */
  readonly viewport: ViewportState;
  readonly mode?: DiffMode;
  /** Split divider position, 0..1. */
  readonly split?: number;
  /** Onion blend, 0..1. */
  readonly blend?: number;
  readonly amplify?: number;
  readonly threshold?: number;
  /** Nearest sampling shows the true pixels when zoomed in; linear is smoother when zoomed out. */
  readonly smooth?: boolean;
}

interface DiffUniforms extends Record<string, unknown> {
  readonly mode: number;
  readonly split: number;
  readonly blend: number;
  readonly amplify: number;
  readonly threshold: number;
}

interface StatsUniforms extends Record<string, unknown> {
  readonly width: number;
  readonly height: number;
  readonly threshold: number;
}

export interface DiffStats {
  readonly changedPixels: number;
  readonly totalPixels: number;
  readonly maxDelta: number;
}

const DEFAULT_THRESHOLD = 0.02;
const DEFAULT_AMPLIFY = 4;

let nextId = 0;

/**
 * `GPUImageDiff` — two images, compared on the GPU.
 *
 * **The component that finally uses textures.** Everything before it reads storage buffers, and
 * `RasterLayer` avoids textures on purpose. That left `sampler()` uncalled, `texture_2d<f32>`
 * unsampled and `caps.maxTextureDimension2D` unread since Phase 1 — and it left a hole in PLAN.md
 * §9.2's contract, which assigns "textures from images" to neither vgpu nor us. `core`'s new
 * `createImageTexture` fills it.
 *
 * Two GPU jobs, deliberately separated by how often they need to run. Compositing happens every
 * frame, because the mode, the split and the viewport all change under the pointer. Counting
 * changed pixels happens once per image pair, because the answer does not depend on the viewport —
 * the same discipline `GPUHeatmap` applies to its range reduction, and the reason panning a
 * 12-megapixel diff costs nothing.
 */
export class ImageDiffComponent implements GpuComponent<ImageDiffProps> {
  readonly id: string;
  dirty = true;
  animating = false;

  private gpu: Gpu | null = null;
  private caps: ComponentContext["caps"] | null = null;

  private raster: RasterLayer | null = null;
  private viewportUniform: SharedUniforms<ViewportUniforms> | null = null;
  private diffParams: SharedUniforms<DiffUniforms> | null = null;
  private statsParams: SharedUniforms<StatsUniforms> | null = null;
  private statsPipeline: Compute | null = null;
  private statsBuffer: StorageBuffer | null = null;

  private beforeTexture: ImageTexture | null = null;
  private afterTexture: ImageTexture | null = null;

  private uploadedPair: ImagePair | null = null;
  private currentViewport: ViewportState | null = null;
  private currentThreshold = DEFAULT_THRESHOLD;
  private smooth = false;
  /** Cleared and recomputed only when the images change. */
  private statsDirty = true;

  constructor() {
    this.id = `imagediff-${nextId++}`;
  }

  create(ctx: ComponentContext): void {
    this.gpu = ctx.gpu;
    this.caps = ctx.caps;

    this.raster = new RasterLayer({ gpu: ctx.gpu, shader: IMAGE_DIFF_WGSL, label: `${this.id}-composite` });
    this.viewportUniform = uniforms(ctx.gpu, {
      timeToClip: [1, 0],
      trackToClip: [1, 0],
      pxSize: [1, 1],
    });
    this.diffParams = uniforms(ctx.gpu, {
      mode: 0,
      split: 0.5,
      blend: 0.5,
      amplify: DEFAULT_AMPLIFY,
      threshold: DEFAULT_THRESHOLD,
    });
    this.statsParams = uniforms(ctx.gpu, { width: 1, height: 1, threshold: DEFAULT_THRESHOLD });
    this.statsPipeline = compute(ctx.gpu, DIFF_STATS_WGSL);
    this.statsBuffer = storage(ctx.gpu, 2 * 4, "read-write");

    this.raster.bind({ viewport: this.viewportUniform, params: this.diffParams });
    this.statsPipeline.set({ params: this.statsParams, stats: this.statsBuffer });
    this.bindSampler();

    // A device-loss replay lands here with the textures gone; re-upload from the CPU-side pair,
    // which is the source of truth §14.2 requires every GPU buffer to have.
    if (this.uploadedPair) this.uploadPair(this.uploadedPair);
    else this.uploadPair(placeholderPair());
    if (this.currentViewport) this.viewportUniform.set(viewportUniforms(this.currentViewport));
  }

  /**
   * Binds the sampler for the current filtering mode.
   *
   * `sampler(gpu, desc)` is cached by descriptor (§11.1 lists it among the things shared across a
   * page), so flipping between smooth and sharp does not allocate — it returns one of two samplers
   * that live for the device's lifetime. First use of that cache anywhere in this project.
   */
  private bindSampler(): void {
    if (!this.gpu || !this.raster) return;
    const filter: GPUFilterMode = this.smooth ? "linear" : "nearest";
    this.raster.bind({
      imageSampler: sampler(this.gpu, { magFilter: filter, minFilter: filter }),
    });
  }

  private uploadPair(pair: ImagePair): void {
    if (!this.gpu) return;
    // Textures, unlike vgpu's storage buffers, can be destroyed — and a megapixel pair is far too
    // large to leave to `gpu.dispose()` when the images change.
    this.beforeTexture?.destroy();
    this.afterTexture?.destroy();

    this.beforeTexture = createImageTexture(this.gpu, pair.before, this.caps, { label: `${this.id}-before` });
    this.afterTexture = createImageTexture(this.gpu, pair.after, this.caps, { label: `${this.id}-after` });

    this.raster?.bind({ beforeTex: this.beforeTexture.view, afterTex: this.afterTexture.view });
    this.statsPipeline?.set({ beforeTex: this.beforeTexture.view, afterTex: this.afterTexture.view });
    this.statsParams?.set({ width: pair.width, height: pair.height, threshold: this.currentThreshold });
    this.statsDirty = true;
  }

  update(props: ImageDiffProps): void {
    this.currentThreshold = props.threshold ?? DEFAULT_THRESHOLD;

    const smooth = props.smooth ?? false;
    if (smooth !== this.smooth) {
      this.smooth = smooth;
      this.bindSampler();
    }

    if (props.pair !== this.uploadedPair) {
      this.uploadedPair = props.pair;
      this.uploadPair(props.pair);
    }

    this.currentViewport = props.viewport;
    this.viewportUniform?.set(viewportUniforms(props.viewport));
    this.diffParams?.set({
      mode: modeIndex(props.mode ?? "split"),
      split: props.split ?? 0.5,
      blend: props.blend ?? 0.5,
      amplify: props.amplify ?? DEFAULT_AMPLIFY,
      threshold: this.currentThreshold,
    });
    this.dirty = true;
  }

  /** The image pixel under a screen position — exact arithmetic, no picking pass needed. */
  hitTest(x: number, y: number): HitResult | null {
    const viewport = this.currentViewport;
    const pair = this.uploadedPair;
    if (!viewport || !pair) return null;

    const rowStart = viewport.rowStart ?? 0;
    const rowEnd = viewport.rowEnd ?? viewport.trackCount;
    const imgX = Math.floor(
      viewport.timeStart + (x / Math.max(viewport.width, 1)) * (viewport.timeEnd - viewport.timeStart),
    );
    const imgY = Math.floor(rowStart + (y / Math.max(viewport.height, 1)) * (rowEnd - rowStart));
    if (imgX < 0 || imgY < 0 || imgX >= pair.width || imgY >= pair.height) return null;
    return { id: imgY * pair.width + imgX };
  }

  /**
   * Reads the changed-pixel count back.
   *
   * A readback, and allowed precisely because it is not per frame: §5's fourth gate disqualifies
   * "anything needing a synchronous readback per frame", and vgpu documents `read()` as being for
   * "tests, snapshots, and diagnostics". A statistic computed once per image pair and displayed as
   * text is a diagnostic.
   */
  async readStats(): Promise<DiffStats | null> {
    if (!this.statsBuffer || !this.uploadedPair) return null;
    const raw = await this.statsBuffer.read();
    const values = new Uint32Array(raw);
    return {
      changedPixels: values[0] ?? 0,
      totalPixels: this.uploadedPair.width * this.uploadedPair.height,
      maxDelta: (values[1] ?? 0) / 1000,
    };
  }

  plan(): RenderPlan {
    this.dirty = false;
    if (!this.uploadedPair || !this.currentViewport) return { computePasses: [], renderPasses: [] };

    const computePasses = this.statsDirty
      ? [{ name: "imagediff-stats", dispatch: () => this.dispatchStats() }]
      : [];
    this.statsDirty = false;

    return {
      computePasses,
      renderPasses: [
        {
          name: "imagediff",
          target: "surface",
          clear: true,
          encode: (pass) => {
            this.raster?.draw(pass);
          },
        },
      ],
    };
  }

  private dispatchStats(): void {
    const pair = this.uploadedPair;
    if (!this.statsPipeline || !this.statsBuffer || !pair) return;
    // Zero first: atomics accumulate, so a stale count would compound across image changes.
    this.statsBuffer.write(new Uint32Array([0, 0]));
    this.statsPipeline.dispatch(
      Math.ceil(pair.width / DIFF_STATS_WORKGROUP_SIZE),
      Math.ceil(pair.height / DIFF_STATS_WORKGROUP_SIZE),
    );
  }

  dispose(): void {
    this.raster?.dispose();
    this.beforeTexture?.destroy();
    this.afterTexture?.destroy();
    this.beforeTexture = null;
    this.afterTexture = null;
  }
}

/** A 1x1 transparent pair, so every binding is valid before the first `update()` — the mount-order
 * trap `GPUHeatmap` hit, avoided by construction here. */
function placeholderPair(): ImagePair {
  const pixel = { data: new Uint8Array(new ArrayBuffer(4)), width: 1, height: 1 };
  return { before: pixel, after: pixel, width: 1, height: 1 };
}
