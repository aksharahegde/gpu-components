import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createMockGpu } from "@gpuc/testing";
import { GpuBudgetExceededError } from "./budget.ts";
import { RingBuffer } from "./ringBuffer.ts";

/**
 * The ring's contract is addressing arithmetic, and the wrap is where it is easy to get wrong, so
 * these assert slot positions and head/count transitions rather than "it did not throw".
 * `render.pixels.test.ts` in the log viewer proves the GPU agrees with this arithmetic.
 */

const STRIDE = 8;

function makeRing(capacity: number) {
  return createMockGpu().then(({ gpu }) => ({
    gpu,
    ring: new RingBuffer(gpu, { stride: STRIDE, capacity, label: "test-ring" }),
  }));
}

/** `n` records, each tagged with its ordinal in the first u32 so slots are identifiable. */
function records(from: number, count: number): Uint8Array {
  const view = new DataView(new ArrayBuffer(count * STRIDE));
  for (let i = 0; i < count; i++) view.setUint32(i * STRIDE, from + i, true);
  return new Uint8Array(view.buffer);
}

describe("RingBuffer construction", () => {
  it("rejects a stride that is not 4-byte aligned", async () => {
    const { gpu } = await createMockGpu();
    // WebGPU requires aligned write offsets; an odd stride only fails once the ring wraps, which is
    // exactly the sort of bug that surfaces under load rather than in a test.
    assert.throws(() => new RingBuffer(gpu, { stride: 6, capacity: 4 }), /multiple of 4/);
    gpu.dispose();
  });

  it("rejects non-positive stride and capacity", async () => {
    const { gpu } = await createMockGpu();
    assert.throws(() => new RingBuffer(gpu, { stride: 0, capacity: 4 }), /positive integer/);
    assert.throws(() => new RingBuffer(gpu, { stride: 8, capacity: 0 }), /positive integer/);
    gpu.dispose();
  });

  it("reports an oversized ring as a budget error, not a driver failure", async () => {
    const { gpu } = await createMockGpu();
    assert.throws(
      () => new RingBuffer(gpu, {
        stride: 64,
        capacity: 10_000_000,
        caps: { maxStorageBufferBindingSize: 1024, maxBufferSize: 1024 },
      }),
      GpuBudgetExceededError,
    );
    gpu.dispose();
  });
});

describe("RingBuffer append", () => {
  it("starts empty and fills without moving the head", async () => {
    const { gpu, ring } = await makeRing(4);
    assert.deepEqual(ring.state, { head: 0, count: 0, capacity: 4, totalAppended: 0 });

    ring.append(records(0, 3));
    assert.deepEqual(ring.state, { head: 0, count: 3, capacity: 4, totalAppended: 3 });
    assert.equal(ring.slotOf(0), 0);
    assert.equal(ring.slotOf(2), 2);
    gpu.dispose();
  });

  it("advances the head by exactly the number of evicted records", async () => {
    const { gpu, ring } = await makeRing(4);
    ring.append(records(0, 4));
    assert.deepEqual(ring.state, { head: 0, count: 4, capacity: 4, totalAppended: 4 });

    // One more record evicts exactly one, so the oldest live record is now the second appended.
    ring.append(records(4, 1));
    assert.deepEqual(ring.state, { head: 1, count: 4, capacity: 4, totalAppended: 5 });
    assert.equal(ring.slotOf(0), 1, "logical 0 is the oldest live record");
    assert.equal(ring.slotOf(3), 0, "logical 3 wrapped back to slot 0");
    gpu.dispose();
  });

  it("handles a batch that straddles the end of the buffer", async () => {
    const { gpu, ring } = await makeRing(4);
    ring.append(records(0, 3));
    // Tail sits at slot 3; a 3-record batch writes one at the end and two at the front.
    ring.append(records(3, 3));
    assert.deepEqual(ring.state, { head: 2, count: 4, capacity: 4, totalAppended: 6 });
    assert.equal(ring.slotOf(0), 2);
    assert.equal(ring.slotOf(1), 3);
    assert.equal(ring.slotOf(2), 0);
    gpu.dispose();
  });

  it("keeps only the newest records when a batch exceeds capacity", async () => {
    const { gpu, ring } = await makeRing(4);
    // 10 records into a 4-slot ring: writing all ten would wrap onto itself and leave an arbitrary
    // slice. Only the last four are written at all.
    const written = ring.append(records(0, 10));
    assert.equal(written, 4, "reports what it actually stored, not what it was handed");
    assert.equal(ring.state.count, 4);
    assert.equal(ring.state.head, 0);
    gpu.dispose();
  });

  it("rejects a partial record", async () => {
    const { gpu, ring } = await makeRing(4);
    assert.throws(() => ring.append(new Uint8Array(STRIDE + 2)), /whole number of 8-byte records/);
    gpu.dispose();
  });

  it("ignores an empty append", async () => {
    const { gpu, ring } = await makeRing(4);
    assert.equal(ring.append(new Uint8Array(0)), 0);
    assert.equal(ring.state.totalAppended, 0);
    gpu.dispose();
  });

  it("survives many wraps with consistent addressing", async () => {
    const { gpu, ring } = await makeRing(8);
    for (let i = 0; i < 100; i++) ring.append(records(i * 3, 3));
    const { head, count, totalAppended } = ring.state;
    assert.equal(count, 8);
    assert.equal(totalAppended, 300);
    // After 300 appends into 8 slots the tail is at 300 % 8, and head trails it by a full ring.
    assert.equal(head, 300 % 8);
    assert.equal(ring.slotOf(7), (head + 7) % 8);
    gpu.dispose();
  });

  it("clears without reallocating", async () => {
    const { gpu, ring } = await makeRing(4);
    const before = ring.buffer;
    ring.append(records(0, 6));
    ring.clear();
    assert.deepEqual(ring.state, { head: 0, count: 0, capacity: 4, totalAppended: 0 });
    assert.equal(ring.buffer, before, "clear is bookkeeping, not reallocation");
    gpu.dispose();
  });
});
