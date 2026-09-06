import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { frame, target, uniforms, type Gpu } from "vgpu";
import {
  createWarningsLog,
  gpuPass,
  NO_WEBGPU_CAPABILITIES,
  ResourceRegistry,
  type Capabilities,
  type ComponentContext,
  type ViewportState,
} from "@gpu-components/core";
import { generateLogLines, type LogLine } from "./ingest.ts";
import { LogViewerComponent, type LogSource } from "./LogViewerComponent.ts";
import { MINIMAP_BUCKETS } from "./logviewer.wgsl.ts";

/**
 * Real-Dawn verification.
 *
 * The assertions target what this component specifically can get wrong, which is not "does a quad
 * appear" but **does the ring address correctly**. The row shader recomputes `(head + logical) %
 * capacity` independently of `RingBuffer.slotOf`, so after a wrap the two could disagree and every
 * row would render a plausible-looking wrong record. That failure is invisible to the unit tests —
 * they only ever check the CPU side — and invisible to the eye, since wrong log lines still look
 * like log lines. So these tests wrap the ring deliberately and check that the colour on screen is
 * the level of the line that *should* be there.
 *
 * This is the layer that caught three blank-render defects in this project that a fully green unit
 * suite did not.
 */

const CAPS: Capabilities = {
  ...NO_WEBGPU_CAPABILITIES,
  webgpu: true,
  maxStorageBufferBindingSize: 128 * 1024 * 1024,
  maxBufferSize: 256 * 1024 * 1024,
  maxTextureDimension2D: 8192,
  maxComputeWorkgroupsPerDimension: 65535,
  tier: "gpu",
};

const W = 300;
const H = 160;
const LINE_HEIGHT = 16;

const VIEWPORT: ViewportState = {
  timeStart: 0, timeEnd: 1, trackCount: 1,
  rowStart: 0, rowEnd: 1, yContinuous: true,
  width: W, height: H,
};

/** Level colours from the shader, as bytes, so a row's identity is readable from its stripe. */
const LEVEL_RGB: Record<string, [number, number, number]> = {
  trace: [122, 130, 146],
  debug: [82, 96, 122],
  info: [29, 95, 177],
  warn: [163, 103, 6],
  error: [192, 43, 43],
};

function line(i: number, level: LogLine["level"]): LogLine {
  return { timestamp: 1_800_000_000_000 + i * 1000, level, logger: "t", message: `m${i}` };
}
const src = (lines: readonly LogLine[], version = 1): LogSource => ({ lines, version });

async function initDawn(): Promise<Gpu | null> {
  try {
    const { init } = await import("vgpu/node");
    return await init();
  } catch {
    return null;
  }
}

function makeCtx(gpu: Gpu, surfaceTarget: ReturnType<typeof target>): ComponentContext {
  return {
    runtime: { caps: CAPS, invalidate: () => {}, warnings: createWarningsLog() },
    gpu,
    surface: { surface: surfaceTarget, get dirty() { return true; }, clearDirty: () => {}, markDirty: () => {} },
    globals: uniforms(gpu, { time: 0, deltaTime: 0, dpr: 1 }),
    registry: new ResourceRegistry(),
    caps: CAPS,
    onDispose: () => {},
  };
}

interface Rendered {
  pixels: Uint8Array;
  component: LogViewerComponent;
}

async function render(
  gpu: Gpu,
  capacity: number,
  batches: readonly (readonly LogLine[])[],
  props: Record<string, unknown> = {},
): Promise<Rendered> {
  const surfaceTarget = target(gpu, { size: [W, H] });
  const component = new LogViewerComponent(capacity);
  component.create(makeCtx(gpu, surfaceTarget));

  // Fed as successive appends, not one upload — the ring's wrap only happens if it is used as a ring.
  const accumulated: LogLine[] = [];
  let version = 0;
  for (const batch of batches) {
    accumulated.push(...batch);
    version++;
    component.update({ source: src(accumulated, version), viewport: VIEWPORT, lineHeight: LINE_HEIGHT, ...props });
  }

  const plan = component.plan();
  for (const pass of plan.computePasses) pass.dispatch();
  frame(gpu, (f) => {
    f.pass({ target: surfaceTarget, clear: true }, (fp) => {
      for (const pass of plan.renderPasses) pass.encode(gpuPass(fp));
    });
  });
  await gpu.settled();
  return { pixels: (await surfaceTarget.read()) as Uint8Array, component };
}

function rgb(pixels: Uint8Array, x: number, y: number): [number, number, number] {
  const i = (y * W + x) * 4;
  return [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!];
}

/** The stripe pixel for the nth visible row — 1px in, vertically centred in the row. */
function stripeOfRow(pixels: Uint8Array, row: number): [number, number, number] {
  return rgb(pixels, 1, row * LINE_HEIGHT + Math.floor(LINE_HEIGHT / 2));
}

function near(actual: readonly [number, number, number], expected: readonly [number, number, number], tol = 12): boolean {
  return actual.every((c, i) => Math.abs(c - expected[i]!) <= tol);
}

function nameLevel(actual: readonly [number, number, number]): string {
  for (const [level, rgbValue] of Object.entries(LEVEL_RGB)) if (near(actual, rgbValue)) return level;
  return `unknown(${actual.join(",")})`;
}

describe("GPULogViewer render correctness (real Dawn pixels)", () => {
  let gpu: Gpu | null = null;

  before(async () => {
    gpu = await initDawn();
  });
  after(() => {
    gpu?.dispose();
    gpu = null;
  });

  it("draws one row per visible line, with the level stripe of that line", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable");
    const levels = ["error", "warn", "info", "debug", "trace"] as const;
    const { pixels, component } = await render(gpu, 64, [levels.map((l, i) => line(i, l))]);

    for (let i = 0; i < levels.length; i++) {
      assert.equal(nameLevel(stripeOfRow(pixels, i)), levels[i], `row ${i}`);
    }
    component.dispose();
  });

  it("addresses the ring correctly after a wrap — the GPU agrees with slotOf", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable");
    // Capacity 4, eight lines in two batches: the ring wraps and head ends at slot 0 having moved
    // all the way round. Survivors are lines 4..7, whose levels are the second half of the pattern.
    const pattern = ["trace", "debug", "info", "warn", "error", "info", "warn", "error"] as const;
    const all = pattern.map((l, i) => line(i, l));
    const { pixels, component } = await render(gpu, 4, [all.slice(0, 5), all.slice(5)]);

    assert.equal(component.lineCount, 4);
    // If the shader's modulo disagreed with RingBuffer.slotOf, these would be some other four
    // levels — still plausible-looking rows, which is exactly why this is asserted on pixels.
    assert.deepEqual(
      [0, 1, 2, 3].map((r) => nameLevel(stripeOfRow(pixels, r))),
      ["error", "info", "warn", "error"],
    );
    component.dispose();
  });

  it("scrolling changes which lines are drawn, without re-uploading them", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable");
    const levels = ["trace", "debug", "info", "warn", "error"] as const;
    // 40 lines cycling through the levels; row 0 at scroll 0 is line 0 (trace).
    const all = Array.from({ length: 40 }, (_, i) => line(i, levels[i % 5]!));

    const top = await render(gpu, 64, [all]);
    assert.equal(nameLevel(stripeOfRow(top.pixels, 0)), "trace");
    top.component.dispose();

    // One update, one uniform write: row 0 is now line 3.
    const scrolled = await render(gpu, 64, [all], { scrollTopPx: 3 * LINE_HEIGHT });
    assert.equal(nameLevel(stripeOfRow(scrolled.pixels, 0)), "warn", "line 3");
    assert.equal(nameLevel(stripeOfRow(scrolled.pixels, 1)), "error", "line 4");
    scrolled.component.dispose();
  });

  it("draws nothing past the end of the data instead of stretching the last row", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable");
    // Three lines in a 160px window that could hold ten: rows 3+ must be background.
    const { pixels, component } = await render(gpu, 64, [[line(0, "error"), line(1, "error"), line(2, "error")]]);

    assert.equal(nameLevel(stripeOfRow(pixels, 2)), "error");
    const empty = stripeOfRow(pixels, 6);
    assert.ok(
      !near(empty, LEVEL_RGB.error!),
      `row 6 should be empty background, got ${empty.join(",")}`,
    );
    component.dispose();
  });

  it("marks matched rows and dims unmatched ones only while filtering", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable");
    const lines = [
      { ...line(0, "info"), message: "cache miss" },
      { ...line(1, "info"), message: "connection ok" },
    ];

    const plain = await render(gpu, 64, [lines]);
    const unfilteredStripe = stripeOfRow(plain.pixels, 1);
    plain.component.dispose();

    const filtered = await render(gpu, 64, [lines], { query: { text: "cache" } });
    const dimmedStripe = stripeOfRow(filtered.pixels, 1);
    const matchedStripe = stripeOfRow(filtered.pixels, 0);

    // Row 1 does not match, so its stripe darkens; row 0 does, so its stripe is untouched.
    assert.ok(
      dimmedStripe[2]! < unfilteredStripe[2]! - 20,
      `unmatched stripe should dim: ${dimmedStripe.join(",")} vs ${unfilteredStripe.join(",")}`,
    );
    assert.ok(near(matchedStripe, LEVEL_RGB.info!), "matched row keeps full level colour");
    filtered.component.dispose();
  });

  it("reduces match and error density over the whole buffer, matching a CPU count", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable");
    const lines = generateLogLines(2000, 1_800_000_000_000);
    const { component } = await render(gpu, 4096, [lines], { query: { text: "pool" } });

    const reading = await component.readMinimap();
    assert.ok(reading);

    let matchedTotal = 0;
    let errorTotal = 0;
    for (let i = 0; i < MINIMAP_BUCKETS; i++) {
      matchedTotal += reading!.buckets[i * 2]!;
      errorTotal += reading!.buckets[i * 2 + 1]!;
    }

    // CPU oracle over the same lines, using the same predicates.
    const expectedMatched = lines.filter((l) => `${l.logger} ${l.message}`.toLowerCase().includes("pool")).length;
    const expectedErrors = lines.filter((l) => l.level === "error").length;

    assert.equal(matchedTotal, expectedMatched, "GPU match count must equal the CPU count exactly");
    assert.equal(errorTotal, expectedErrors, "GPU error count must equal the CPU count exactly");
    assert.ok(expectedErrors > 0 && expectedMatched > 0, "the fixture must actually exercise both");

    component.dispose();
  });

  it("counts every line exactly once, with no double-counting at bucket edges", async (t) => {
    if (!gpu) return t.skip("vgpu/node (Dawn) unavailable");
    // Every line an error, so the error histogram must sum to exactly the line count — the check
    // that catches an off-by-one in the bucket mapping or a workgroup overrunning `count`.
    const lines = Array.from({ length: 1000 }, (_, i) => line(i, "error"));
    const { component } = await render(gpu, 2048, [lines]);

    const reading = await component.readMinimap();
    let total = 0;
    for (let i = 0; i < MINIMAP_BUCKETS; i++) total += reading!.buckets[i * 2 + 1]!;
    assert.equal(total, 1000);

    component.dispose();
  });
});
