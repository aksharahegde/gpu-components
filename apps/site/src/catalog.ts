/**
 * The component catalogue, shared by the landing page's gallery and the playground index.
 *
 * One list rather than two: the landing page and `/playground` show the same set at different
 * densities, and a second copy would drift the moment a component is added.
 */
export interface CatalogEntry {
  readonly slug: string
  readonly name: string
  /** One line, shown on both surfaces. */
  readonly blurb: string
  /** The editorial aside — playground index only; too much for a landing-page card. */
  readonly note: string
}

export const COMPONENTS: readonly CatalogEntry[] = [
  {
    slug: 'timeline',
    name: 'GPUTimeline',
    blurb: 'Spans, flame graphs, Gantt and waterfalls. Up to 500,000 spans, pan, zoom, brush-select.',
    note: 'The first component, and the one the runtime was designed against.',
  },
  {
    slug: 'heatmap',
    name: 'GPUHeatmap',
    blurb: 'A dense matrix with a GPU colormap and GPU auto-ranging, zoomable on both axes.',
    note: 'The architecture test: could core host a component it was not designed around?',
  },
  {
    slug: 'grid',
    name: 'GPUDataGrid',
    blurb: 'Read-only grid with per-cell conditional formatting evaluated in the fragment shader.',
    note: 'The flagship, built last, on primitives the others had already paid for.',
  },
  {
    slug: 'scatter',
    name: 'GPUScatter',
    blurb: '250,000 points, one draw call. Zoom, filter and brush are all uniform writes.',
    note: 'The clearest demo here: 250,000 points, one draw call, and exact hover with no picking pass.',
  },
  {
    slug: 'graph',
    name: 'GPUGraph',
    blurb: 'Force-directed layout running entirely on the GPU, settling in front of you.',
    note: 'The only one that animates, and the only one that cannot hit-test on the CPU.',
  },
  {
    slug: 'imagediff',
    name: 'GPUImageDiff',
    blurb: 'Split, onion-skin, difference and heat comparison of two images, with a GPU pixel count.',
    note: 'The only one built on sampled textures rather than a storage buffer.',
  },
  {
    slug: 'logviewer',
    name: 'GPULogViewer',
    blurb: 'Half a million lines in a GPU ring, streaming appends, and match density over all of them.',
    note: 'The first dataset here with a tail — and the component that retired the glyph atlas.',
  },
  {
    slug: 'candlestick',
    name: 'GPUCandlestick',
    blurb: '200,000 OHLC bars, revised tick by tick, with a whole-history envelope along the bottom.',
    note: 'A second, independent consumer for the streaming ring buffer the log viewer introduced.',
  },
  {
    slug: 'densitymap',
    name: 'GPUDensityMap',
    blurb: '200,000 lon/lat points hexbinned on the GPU over Web Mercator — graticule chrome, no tiles.',
    note: 'The geospatial density candidate: projection at ingest, atomic hexbin, colormap fill.',
  },
  {
    slug: 'histogram',
    name: 'GPUHistogram',
    blurb: '250,000 values, Freedman–Diaconis bins at ingest, GPU atomic binning into instanced bars.',
    note: 'Adaptive layout on the CPU once; the GPU owns the N-wide bin pass and the draw.',
  },
  {
    slug: 'depgraph',
    name: 'GPUDepGraph',
    blurb: 'Sugiyama layered package DAG with orthogonal edges — layout once on the CPU, GPU draw only.',
    note: 'Cycles become styled back-edges; no force layout, no continuous animation.',
  },
  {
    slug: 'networktopology',
    name: 'GPUNetworkTopology',
    blurb: 'Force-laid service mesh with status, link health, and traffic pulse.',
    note: 'Demo-only for now: the layout animation can still stutter in some browsers.',
  },
  {
    slug: 'annotationcanvas',
    name: 'GPUAnnotationCanvas',
    blurb: 'A Float32 field with a GPU colormap and a host-owned rect/ellipse/point/ruler/polygon overlay.',
    note: 'Hybrid interaction: every draw tool emits an event, and the page decides whether to keep it.',
  },
  {
    slug: 'spreadsheet',
    name: 'GPUSpreadsheet',
    blurb: 'Editable cells, a dependency-graph formula engine, selection, clipboard, and pivot tables.',
    note: 'Formulas stay on the CPU: a dependency graph and topological recalculation, never a shader.',
  },
  {
    slug: 'nodeeditor',
    name: 'GPUNodeEditor',
    blurb: 'Drag nodes, drag-to-connect ports, multi-select and delete — all CPU-owned, GPU-drawn.',
    note: 'CPU owns the graph, the GPU only draws it — the honest split until node counts get large.',
  },
  {
    slug: 'whiteboard',
    name: 'GPUWhiteboard',
    blurb: 'A procedural dot-grid canvas with instanced shapes and ink, forked from GPUAnnotationCanvas.',
    note: 'Pan, zoom and hover today. Drawing tools and multi-select are next.',
  },
  {
    slug: 'pdfviewer',
    name: 'GPUPdfViewer',
    blurb: 'A small resident-texture pool composites host-rasterized pages, virtualized and zoomable.',
    note: 'A compositor, not a PDF renderer: pages arrive already rasterized and only a few ever hold a texture.',
  },
]
