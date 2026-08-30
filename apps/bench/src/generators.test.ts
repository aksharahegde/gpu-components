import assert from "node:assert/strict";
import { test } from "node:test";
import { generateDataset } from "./generators.ts";
import { SHAPES } from "./types.ts";

for (const shape of SHAPES) {
  test(`${shape}: deterministic for a fixed seed`, () => {
    const a = generateDataset(shape, 5_000);
    const b = generateDataset(shape, 5_000);
    assert.deepEqual(Array.from(a.start), Array.from(b.start));
    assert.deepEqual(Array.from(a.track), Array.from(b.track));
  });

  test(`${shape}: different seeds diverge`, () => {
    const a = generateDataset(shape, 5_000, 1);
    const b = generateDataset(shape, 5_000, 2);
    assert.notDeepEqual(Array.from(a.start), Array.from(b.start));
  });

  test(`${shape}: produces exactly \`size\` spans, all within [0, 1] domain, track < trackCount`, () => {
    const d = generateDataset(shape, 2_000);
    assert.equal(d.start.length, 2_000);
    assert.equal(d.duration.length, 2_000);
    assert.equal(d.track.length, 2_000);
    for (let i = 0; i < d.size; i++) {
      assert.ok(d.start[i]! >= 0 && d.start[i]! <= 1, `start[${i}] in [0,1]`);
      assert.ok(d.duration[i]! > 0, `duration[${i}] > 0`);
      assert.ok(d.track[i]! < d.trackCount, `track[${i}] < trackCount`);
    }
  });
}

test("deep-nested: nesting actually happens (trackCount > 1 for a large enough dataset)", () => {
  const d = generateDataset("deep-nested", 50_000);
  assert.ok(d.trackCount > 1, `expected nested depth, got trackCount=${d.trackCount}`);
});

test("shallow-wide: many tracks relative to deep-nested at the same size", () => {
  const wide = generateDataset("shallow-wide", 50_000);
  const nested = generateDataset("deep-nested", 50_000);
  assert.ok(wide.trackCount > nested.trackCount, "shallow-wide should use more tracks than deep-nested");
});
