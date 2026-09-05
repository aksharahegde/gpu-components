import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ingestPdfDocument, MAX_PAGE_DIM, pageAt, visiblePageRange, type PdfPage } from "./ingest.ts";

function page(pageNumber: number, width = 8, height = 11, bw = 8, bh = 11): PdfPage {
  return { pageNumber, width, height, bitmap: { data: new Uint8Array(bw * bh * 4), width: bw, height: bh } };
}

describe("ingestPdfDocument", () => {
  it("lays pages out in one vertical column, gapped and centered", () => {
    const doc = ingestPdfDocument([page(1, 8, 10), page(2, 6, 12)], { pageGap: 2 });
    assert.equal(doc.pageOffsetY[0], 0);
    assert.equal(doc.pageOffsetY[1], 12); // 10 + gap(2)
    assert.equal(doc.totalHeight, 24); // 10 + 2 + 12
    assert.equal(doc.maxWidth, 8);
  });

  it("rejects zero pages", () => {
    assert.throws(() => ingestPdfDocument([]), /at least one page/);
  });

  it("rejects a bitmap whose byte length doesn't match its declared size", () => {
    const bad: PdfPage = { pageNumber: 1, width: 8, height: 11, bitmap: { data: new Uint8Array(4), width: 8, height: 11 } };
    assert.throws(() => ingestPdfDocument([bad]), /expected/);
  });

  it("rejects a bitmap larger than MAX_PAGE_DIM", () => {
    const huge = page(1, 8, 11, MAX_PAGE_DIM + 1, 8);
    assert.throws(() => ingestPdfDocument([huge]), /MAX_PAGE_DIM/);
  });

  it("rejects a non-positive page size", () => {
    assert.throws(() => ingestPdfDocument([page(1, 0, 11)]), /invalid size/);
  });
});

describe("pageAt / visiblePageRange", () => {
  const doc = ingestPdfDocument([page(1, 8, 10), page(2, 8, 10), page(3, 8, 10)], { pageGap: 2 });
  // Page tops: 0, 12, 24. Page bottoms: 10, 22, 34.

  it("finds the page containing a y within its rectangle", () => {
    assert.equal(pageAt(doc, 5), 0);
    assert.equal(pageAt(doc, 15), 1);
    assert.equal(pageAt(doc, 30), 2);
  });

  it("clamps to the last page past the end of the document", () => {
    assert.equal(pageAt(doc, 1000), 2);
  });

  it("finds every page intersecting a range, including ones spanned entirely within it", () => {
    assert.deepEqual(visiblePageRange(doc, 0, 5), [0, 0]);
    assert.deepEqual(visiblePageRange(doc, 8, 26), [0, 2]);
    assert.deepEqual(visiblePageRange(doc, -100, 1000), [0, 2]);
  });
});
