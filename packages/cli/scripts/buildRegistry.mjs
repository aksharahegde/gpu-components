#!/usr/bin/env node
/**
 * Generates `registry.json` and the bundled component sources from `registry/**`.
 *
 * Generated, never hand-maintained: PLAN.md §18.2 lists "copied components drift" as this model's
 * central cost, and a registry a human keeps in sync with the source tree is one more place for
 * that drift to start.
 */
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(here, "..");
const repoRoot = path.resolve(cliRoot, "../..");
const registrySrc = path.join(repoRoot, "registry");

/** Component metadata. Kept here rather than per folder so the registry has a single source. */
const ITEMS = {
  timeline: {
    title: "GPUTimeline",
    description:
      "Trace, span and event timeline. Instanced spans, LOD density binning, brush selection, and a DOM label layer that doubles as the accessibility tree.",
  },
  heatmap: {
    title: "GPUHeatmap",
    description: "Dense matrix surface with a GPU colormap, GPU min/max auto-ranging, and two-axis pan and zoom.",
  },
  grid: {
    title: "GPUDataGrid",
    description:
      "Read-only data grid. GPU cell chrome and per-cell conditional formatting, Canvas2D text, and an accessible table mirror.",
  },
  scatter: {
    title: "GPUScatter",
    description:
      "Dense point cloud. One instanced draw call, uniform-write filtering, and exact CPU hover through a spatial index.",
  },
  imagediff: {
    title: "GPUImageDiff",
    description:
      "Image comparison. Split, onion-skin, difference and heat modes sampled from real textures, with a changed-pixel count computed by a compute pass.",
  },
  logviewer: {
    title: "GPULogViewer",
    description:
      "Streaming log viewer. A GPU-resident ring buffer with incremental appends, virtualised scroll, and match/error density reduced across the whole buffer for the minimap.",
  },
  candlestick: {
    title: "GPUCandlestick",
    description:
      "OHLC price chart over a streaming ring buffer. In-place revision of the open bar, ordinal bar layout, and a whole-history min/max/volume envelope reduced on the GPU.",
  },
  densitymap: {
    title: "GPUDensityMap",
    description:
      "Geospatial hexbin density map. Lon/lat projected to Web Mercator, GPU atomic hexbin, colormap fill, and graticule / world-outline chrome — no tile basemap.",
  },
  histogram: {
    title: "GPUHistogram",
    description:
      "1D value histogram. Freedman–Diaconis (Sturges fallback) bins at ingest, GPU atomic binning, and instanced bar quads.",
  },
  depgraph: {
    title: "GPUDepGraph",
    description:
      "Sugiyama layered dependency graph. CPU layout at ingest (cycle break, ranks, barycenter order, orthogonal routes); GPU draws nodes and line segments only.",
  },
  spreadsheet: {
    title: "GPUSpreadsheet",
    description:
      "Editable spreadsheet. GPU cell chrome, selection rectangle and dirty-cell flash; a CPU dependency-graph formula engine, cell editing, clipboard, and pivot tables — formulas never touch the GPU.",
  },
  nodeeditor: {
    title: "GPUNodeEditor",
    description:
      "Freeform node-flow canvas. Drag nodes, drag-to-connect ports, multi-select (shift-click/marquee) and delete — all exact CPU hit-testing over caller-owned positions, with GPU-baked selection/port flags and a DOM label overlay for titles.",
  },
  whiteboard: {
    title: "GPUWhiteboard",
    description:
      "Freeform infinite canvas. A procedural dot-grid background, instanced rect/ellipse/point shapes plus ruler/polygon/freehand ink, and exact CPU hit-testing — pan and zoom only in v1, draw tools and multi-select land in later phases.",
  },
  // GPUGraph is deliberately absent: its layout does not animate in the browser (a known open
  // defect), and a copy-source registry must not ship a component that is broken where it runs.
};

/** Never shipped to a consumer: tests, harnesses, internal notes. */
function isShippable(name) {
  if (name.endsWith(".test.ts") || name.endsWith(".test.tsx")) return false;
  if (name.endsWith(".md")) return false;
  return name.endsWith(".ts") || name.endsWith(".tsx");
}

/** Package imports the copied source needs the consuming project to provide. */
function dependenciesOf(sources) {
  const found = new Set();
  for (const source of sources) {
    for (const match of source.matchAll(/from\s+["']([^."'][^"']*)["']/g)) {
      const specifier = match[1];
      const pkg = specifier.startsWith("@")
        ? specifier.split("/").slice(0, 2).join("/")
        : specifier.split("/")[0];
      found.add(pkg);
    }
  }
  return [...found].sort();
}

const version = JSON.parse(readFileSync(path.join(cliRoot, "package.json"), "utf8")).version;
const outDir = path.join(cliRoot, "components");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const items = [];
for (const name of Object.keys(ITEMS)) {
  const dir = path.join(registrySrc, name);
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`registry: no such component directory: ${dir}`);
  }

  const files = readdirSync(dir).filter(isShippable).sort();
  if (files.length === 0) throw new Error(`registry: ${name} has no shippable files`);

  mkdirSync(path.join(outDir, name), { recursive: true });
  const sources = [];
  const entries = [];
  for (const file of files) {
    const source = readFileSync(path.join(dir, file), "utf8");
    sources.push(source);
    entries.push({
      path: file,
      type: "registry:component",
      hash: createHash("sha256").update(source, "utf8").digest("hex"),
    });
    cpSync(path.join(dir, file), path.join(outDir, name, file));
  }

  items.push({
    name,
    type: "registry:component",
    title: ITEMS[name].title,
    description: ITEMS[name].description,
    dependencies: dependenciesOf(sources),
    files: entries,
  });
}

const registry = {
  $schema: "https://ui.shadcn.com/schema/registry.json",
  name: "gpu-components",
  homepage: "https://github.com/gpu-components/gpu-components",
  version,
  items,
};

writeFileSync(path.join(cliRoot, "registry.json"), `${JSON.stringify(registry, null, 2)}\n`);
console.log(
  `registry.json: ${items.length} components, ${items.reduce((n, i) => n + i.files.length, 0)} files, v${version}`,
);
for (const item of items) {
  console.log(
    `  ${item.name.padEnd(10)} ${String(item.files.length).padStart(2)} files  deps: ${item.dependencies.join(", ")}`,
  );
}
