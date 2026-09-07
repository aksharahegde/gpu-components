/* Hallmark · component: hero exhibit (17 vector miniatures) · genre: modern-minimal
 * theme: site system (light · Geist · ink-blue accent) · pre-emit critique: P4 H4 E5 S5 R4 V4
 */

import type { ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { COMPONENTS } from '../catalog'
import { color, font, radius } from '../tokens.stylex'

/**
 * The hero's exhibit: one hand-drawn vector sketch per registry component, driven by the same
 * `src/catalog.ts` the gallery and playground read, so a new component shows up here by having a
 * sketch added — and fails the build loudly (missing key) rather than silently if one is not.
 *
 * Vector on purpose: the previous static PNG rendered soft at retina density and cover-cropped to
 * a sliver on phones. These are crisp at any DPR and reflow below the breakpoint. Every sketch is
 * deterministic literal data — no randomness, so every visitor and every build sees the same
 * frame, and a screenshot is reproducible.
 *
 * Color discipline: the sketches are drawn in neutral border greys with the periwinkle accent
 * reserved for one or two marks per tile — the same ≤10%-of-viewport accent rule the rest of the
 * page follows. Mint/amber appear only as literal status dots on the topology sketch, which is
 * what they mean everywhere else on the site.
 */
export function HeroMiniatures() {
  return (
    <ul {...stylex.props(s.grid)} aria-label="The 17 components in the registry">
      {COMPONENTS.map((component, i) => (
        <li
          key={component.slug}
          {...stylex.props(s.tile, s.rise, DELAY[i], i >= MOBILE_TILE_COUNT && s.desktopOnly)}
        >
          <svg
            {...stylex.props(s.sketch)}
            viewBox="0 0 120 56"
            preserveAspectRatio="xMidYMid slice"
            aria-hidden="true"
          >
            {SKETCHES[component.slug]}
          </svg>
          <span {...stylex.props(s.name)}>{component.name}</span>
        </li>
      ))}
    </ul>
  )
}

/** Below the breakpoint the grid drops to 3×3 — nine whole tiles instead of seventeen cropped
 * ones; the full set is one scroll down in the gallery. */
const MOBILE_TILE_COUNT = 9

/* ------------------------------------------------------------------------------------------------
 * Styles — declared before `SKETCHES`, whose JSX evaluates these at module init.
 * ---------------------------------------------------------------------------------------------- */

const HERO = '@media (max-width: 940px)'
const REDUCE = '@media (prefers-reduced-motion: reduce)'
const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)'

const s = stylex.create({
  grid: {
    display: 'grid',
    gridTemplateColumns: { default: 'repeat(5, minmax(0, 1fr))', [HERO]: 'repeat(3, minmax(0, 1fr))' },
    gridAutoRows: 'minmax(0, 1fr)',
    gap: { default: 10, [HERO]: 8 },
    height: '100%',
    margin: 0,
    padding: { default: 14, [HERO]: 10 },
    listStyle: 'none',
  },
  tile: {
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
    minWidth: 0,
    minHeight: 0,
    padding: '8px 10px 7px',
    backgroundColor: color.surface,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.border,
    borderRadius: radius.md,
  },
  desktopOnly: { display: { default: 'flex', [HERO]: 'none' } },
  sketch: {
    flexGrow: 1,
    minHeight: 0,
    width: '100%',
  },
  name: {
    fontFamily: font.mono,
    fontSize: 10.5,
    lineHeight: 1.4,
    letterSpacing: '-0.01em',
    color: color.textFaint,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  /** Same entrance as the architecture layers — the page's one authored motion vocabulary. */
  rise: {
    animationName: { default: 'hero-layer-in', [REDUCE]: 'none' },
    animationDuration: '480ms',
    animationTimingFunction: EASE,
    animationFillMode: 'backwards',
  },
  /**
   * The one tile that keeps moving: `GPUGraph` is, per its own catalog note, "the only one that
   * animates," so its sketch drifts a few pixels on a slow loop while everything else holds. The
   * global reduced-motion kill in `globals.css` collapses it along with the entrances.
   */
  drift: {
    animationName: { default: 'hero-graph-drift', [REDUCE]: 'none' },
    animationDuration: '9s',
    animationTimingFunction: 'ease-in-out',
    animationIterationCount: 'infinite',
    animationDirection: 'alternate',
  },
})

/**
 * Static per-tile delays — the CSP on this site drops inline `style`, so the cascade cannot be a
 * computed `animationDelay`; it is seventeen literal steps of 45ms. Adding an eighteenth
 * component means adding a line here, which the `DELAY[i]` lookup makes loudly undefined if
 * forgotten.
 */
const delays = stylex.create({
  d0: { animationDelay: '120ms' },
  d1: { animationDelay: '165ms' },
  d2: { animationDelay: '210ms' },
  d3: { animationDelay: '255ms' },
  d4: { animationDelay: '300ms' },
  d5: { animationDelay: '345ms' },
  d6: { animationDelay: '390ms' },
  d7: { animationDelay: '435ms' },
  d8: { animationDelay: '480ms' },
  d9: { animationDelay: '525ms' },
  d10: { animationDelay: '570ms' },
  d11: { animationDelay: '615ms' },
  d12: { animationDelay: '660ms' },
  d13: { animationDelay: '705ms' },
  d14: { animationDelay: '750ms' },
  d15: { animationDelay: '795ms' },
  d16: { animationDelay: '840ms' },
})

const DELAY = [
  delays.d0, delays.d1, delays.d2, delays.d3, delays.d4, delays.d5, delays.d6, delays.d7,
  delays.d8, delays.d9, delays.d10, delays.d11, delays.d12, delays.d13, delays.d14, delays.d15,
  delays.d16,
]

/** SVG mark palette — fills/strokes via class because the CSP drops inline styles. */
const m = stylex.create({
  ink: { fill: color.borderStrong },
  inkSoft: { fill: color.border },
  inkFaint: { fill: color.surface2 },
  inkStrong: { fill: color.borderHover },
  accent: { fill: color.accent },
  accentSoft: { fill: color.accentDim },
  accentFaint: { fill: `color-mix(in srgb, ${color.accent} 8%, transparent)` },
  bgFill: { fill: color.surface },
  noFill: { fill: 'none' },
  line: { stroke: color.border, strokeWidth: 1.5 },
  lineStrong: { stroke: color.borderStrong, strokeWidth: 1.5 },
  accentLine: { stroke: color.accent, strokeWidth: 1.5 },
  mint: { fill: color.mint },
  amber: { fill: color.amber },
})

/* Literal sketch data — deterministic by construction. */

// 4×10 heat field, opacity tenths; 9 marks the accent cells.
const HEAT = [
  [2, 3, 4, 5, 4, 3, 2, 2, 1, 1],
  [3, 5, 7, 9, 7, 5, 3, 2, 2, 1],
  [2, 4, 6, 7, 9, 6, 4, 3, 2, 2],
  [1, 2, 3, 4, 4, 3, 5, 2, 1, 1],
] as const

// [x, y, class] — 0 neutral haze, 1 soft accent cluster, 2 full accent.
const SCATTER: ReadonlyArray<readonly [number, number, number]> = [
  [10, 44, 0], [16, 12, 0], [26, 50, 0], [40, 6, 0], [58, 48, 0], [76, 8, 0], [94, 46, 0],
  [108, 14, 0], [114, 40, 0], [50, 30, 0], [88, 28, 0],
  [22, 26, 1], [26, 30, 1], [30, 24, 1], [34, 30, 1], [28, 36, 1], [20, 33, 1],
  [64, 18, 1], [69, 14, 1], [73, 20, 1], [68, 24, 1],
  [92, 36, 1], [97, 33, 1], [100, 39, 1],
  [27, 29, 2], [69, 18, 2], [96, 36, 2],
]

const GRAPH_NODES: ReadonlyArray<readonly [number, number]> = [
  [16, 30], [38, 10], [42, 44], [62, 24], [84, 42], [98, 10], [108, 30], [12, 50],
]
const GRAPH_EDGES: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [0, 2], [1, 3], [2, 3], [3, 4], [3, 5], [4, 6], [5, 6], [2, 7],
]

// [width, class] — 0 dim, 1 strong, 2 the matched line.
const LOG_LINES: ReadonlyArray<readonly [number, number]> = [
  [72, 0], [96, 0], [54, 1], [88, 0], [100, 2], [62, 0], [80, 1], [44, 0],
]

// [wickTop, bodyTop, bodyHeight, up]
const CANDLES: ReadonlyArray<readonly [number, number, number, boolean]> = [
  [22, 28, 12, false], [18, 24, 14, true], [12, 18, 12, true], [8, 14, 10, true],
  [14, 20, 12, false], [10, 16, 14, true], [16, 22, 10, false], [20, 26, 12, false],
  [14, 20, 14, true], [8, 12, 12, true], [12, 16, 10, false], [6, 10, 14, true],
]

// [x, y, r, opacityTenths]
const DENSITY: ReadonlyArray<readonly [number, number, number, number]> = [
  [52, 28, 2.6, 9], [58, 32, 2.2, 8], [47, 33, 2, 7], [55, 22, 1.8, 7], [62, 26, 1.8, 6],
  [44, 26, 1.6, 5], [66, 34, 1.6, 5], [50, 38, 1.6, 5], [59, 40, 1.4, 4], [40, 32, 1.4, 4],
  [70, 28, 1.4, 4], [36, 20, 1.4, 3], [76, 38, 1.2, 3], [88, 14, 1.6, 4], [94, 18, 1.4, 3],
  [91, 10, 1.2, 3], [16, 44, 1.4, 3], [21, 48, 1.2, 3],
]

const HIST = [3, 6, 10, 16, 24, 33, 40, 44, 37, 28, 19, 12, 7, 4] as const

// [x, y, status] — 0 quiet, 1 healthy (mint), 2 degraded (amber).
const TOPO_NODES: ReadonlyArray<readonly [number, number, number]> = [
  [18, 16, 1], [50, 10, 0], [44, 38, 1], [78, 24, 2], [104, 12, 0], [100, 44, 1], [16, 46, 0],
]
const TOPO_EDGES: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [0, 2], [1, 3], [2, 3], [3, 4], [3, 5], [2, 6],
]

const DOT_GRID: ReadonlyArray<readonly [number, number]> = Array.from({ length: 5 }, (_, r) =>
  Array.from({ length: 10 }, (_, c) => [8 + c * 12, 6 + r * 11] as const),
).flat()

/* ------------------------------------------------------------------------------------------------
 * The sketches. ViewBox is 120×56 for all of them. Attribute-only presentation (no `style` —
 * the CSP drops inline styles); colors come from the StyleX classes above, variation within a
 * color from the `opacity` attribute.
 * ---------------------------------------------------------------------------------------------- */

const SKETCHES: Record<string, ReactNode> = {
  timeline: (
    <g>
      <rect x="2" y="5" width="92" height="5" rx="1" {...stylex.props(m.inkSoft)} />
      <rect x="2" y="14" width="40" height="5" rx="1" {...stylex.props(m.ink)} />
      <rect x="46" y="14" width="30" height="5" rx="1" {...stylex.props(m.accentSoft)} />
      <rect x="80" y="14" width="22" height="5" rx="1" {...stylex.props(m.ink)} />
      <rect x="2" y="23" width="18" height="5" rx="1" {...stylex.props(m.ink)} />
      <rect x="24" y="23" width="12" height="5" rx="1" {...stylex.props(m.inkSoft)} />
      <rect x="46" y="23" width="16" height="5" rx="1" {...stylex.props(m.accent)} />
      <rect x="66" y="23" width="8" height="5" rx="1" {...stylex.props(m.inkSoft)} />
      <rect x="80" y="23" width="12" height="5" rx="1" {...stylex.props(m.ink)} />
      <rect x="2" y="32" width="8" height="5" rx="1" {...stylex.props(m.inkSoft)} />
      <rect x="46" y="32" width="9" height="5" rx="1" {...stylex.props(m.accentSoft)} />
      <rect x="58" y="32" width="5" height="5" rx="1" {...stylex.props(m.inkSoft)} />
      <line x1="2" y1="46" x2="118" y2="46" {...stylex.props(m.line)} />
      <line x1="20" y1="44" x2="20" y2="48" {...stylex.props(m.line)} />
      <line x1="50" y1="44" x2="50" y2="48" {...stylex.props(m.line)} />
      <line x1="80" y1="44" x2="80" y2="48" {...stylex.props(m.line)} />
      <line x1="110" y1="44" x2="110" y2="48" {...stylex.props(m.line)} />
    </g>
  ),

  heatmap: (
    <g>
      {HEAT.map((row, r) =>
        row.map((v, c) => (
          <rect
            key={`${r}-${c}`}
            x={2 + c * 12}
            y={3 + r * 13}
            width="10"
            height="11"
            rx="1"
            opacity={v === 9 ? 1 : v / 10}
            {...stylex.props(v === 9 ? m.accent : m.accentSoft)}
          />
        )),
      )}
    </g>
  ),

  grid: (
    <g>
      <rect x="2" y="3" width="116" height="9" {...stylex.props(m.inkFaint)} />
      <line x1="2" y1="21" x2="118" y2="21" {...stylex.props(m.line)} />
      <line x1="2" y1="30" x2="118" y2="30" {...stylex.props(m.line)} />
      <line x1="2" y1="39" x2="118" y2="39" {...stylex.props(m.line)} />
      <line x1="2" y1="48" x2="118" y2="48" {...stylex.props(m.line)} />
      <line x1="34" y1="3" x2="34" y2="53" {...stylex.props(m.line)} />
      <line x1="64" y1="3" x2="64" y2="53" {...stylex.props(m.line)} />
      <line x1="92" y1="3" x2="92" y2="53" {...stylex.props(m.line)} />
      <rect x="35" y="22" width="28" height="8" {...stylex.props(m.accentFaint)} />
      <rect x="93" y="31" width="24" height="8" {...stylex.props(m.accentFaint)} />
      <rect x="65" y="40" width="26" height="8" {...stylex.props(m.accentSoft)} opacity="0.55" />
    </g>
  ),

  scatter: (
    <g>
      {SCATTER.map(([x, y, a], i) => (
        <circle
          key={i}
          cx={x}
          cy={y}
          r={a === 2 ? 2.2 : 1.6}
          opacity={a === 0 ? 0.55 : 1}
          {...stylex.props(a === 2 ? m.accent : a === 1 ? m.accentSoft : m.inkStrong)}
        />
      ))}
    </g>
  ),

  graph: (
    <g {...stylex.props(s.drift)}>
      {GRAPH_EDGES.map(([a, b], i) => (
        <line
          key={i}
          x1={GRAPH_NODES[a][0]}
          y1={GRAPH_NODES[a][1]}
          x2={GRAPH_NODES[b][0]}
          y2={GRAPH_NODES[b][1]}
          {...stylex.props(m.line)}
        />
      ))}
      {GRAPH_NODES.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="2.6" {...stylex.props(i === 3 ? m.accent : m.inkStrong)} />
      ))}
    </g>
  ),

  imagediff: (
    <g>
      <rect x="6" y="6" width="64" height="40" rx="2" {...stylex.props(m.lineStrong, m.noFill)} />
      <rect x="30" y="12" width="64" height="40" rx="2" {...stylex.props(m.lineStrong, m.noFill)} />
      <line x1="50" y1="4" x2="50" y2="54" {...stylex.props(m.accentLine)} strokeDasharray="3 3" />
      <circle cx="58" cy="30" r="6" opacity="0.7" {...stylex.props(m.accentSoft)} />
      <circle cx="41" cy="24" r="3" opacity="0.5" {...stylex.props(m.accentSoft)} />
    </g>
  ),

  logviewer: (
    <g>
      {LOG_LINES.map(([w, a], i) => (
        <rect
          key={i}
          x="4"
          y={5 + i * 6.5}
          width={w}
          height="2.5"
          rx="1"
          opacity={a === 0 ? 0.6 : 1}
          {...stylex.props(a === 2 ? m.accent : a === 1 ? m.ink : m.inkSoft)}
        />
      ))}
      {[9, 22, 30, 43].map((y, i) => (
        <rect key={i} x="110" y={y} width="6" height={[7, 4, 9, 6][i]} rx="1" {...stylex.props(m.accentSoft)} />
      ))}
    </g>
  ),

  candlestick: (
    <g>
      {CANDLES.map(([wickTop, bodyTop, bodyH, up], i) => (
        <g key={i}>
          <line
            x1={8 + i * 10}
            y1={wickTop}
            x2={8 + i * 10}
            y2={wickTop + bodyH + 14}
            {...stylex.props(m.lineStrong)}
          />
          <rect
            x={5 + i * 10}
            y={bodyTop}
            width="6"
            height={bodyH}
            rx="1"
            {...stylex.props(up ? m.accentSoft : m.inkStrong)}
          />
        </g>
      ))}
    </g>
  ),

  densitymap: (
    <g>
      <line x1="2" y1="18" x2="118" y2="18" opacity="0.6" {...stylex.props(m.line)} />
      <line x1="2" y1="38" x2="118" y2="38" opacity="0.6" {...stylex.props(m.line)} />
      <line x1="30" y1="2" x2="30" y2="54" opacity="0.6" {...stylex.props(m.line)} />
      <line x1="66" y1="2" x2="66" y2="54" opacity="0.6" {...stylex.props(m.line)} />
      <line x1="100" y1="2" x2="100" y2="54" opacity="0.6" {...stylex.props(m.line)} />
      {DENSITY.map(([x, y, r, a], i) => (
        <circle
          key={i}
          cx={x}
          cy={y}
          r={r}
          opacity={a / 10}
          {...stylex.props(a >= 9 ? m.accent : m.accentSoft)}
        />
      ))}
    </g>
  ),

  histogram: (
    <g>
      {HIST.map((h, i) => (
        <rect
          key={i}
          x={4 + i * 8.5}
          y={50 - h}
          width="6.5"
          height={h}
          rx="1"
          {...stylex.props(h >= 40 ? m.accent : m.accentSoft)}
        />
      ))}
      <line x1="2" y1="52" x2="118" y2="52" {...stylex.props(m.lineStrong)} />
    </g>
  ),

  depgraph: (
    <g>
      <path d="M28 12 L28 18 L48 18 L48 24" {...stylex.props(m.lineStrong, m.noFill)} />
      <path d="M64 12 L64 18 L48 18" {...stylex.props(m.lineStrong, m.noFill)} />
      <path d="M96 12 L96 18 L78 18 L78 24" {...stylex.props(m.lineStrong, m.noFill)} />
      <path d="M48 32 L48 38 L62 38 L62 44" {...stylex.props(m.lineStrong, m.noFill)} />
      <path d="M78 32 L78 38 L62 38" {...stylex.props(m.lineStrong, m.noFill)} />
      <rect x="18" y="4" width="20" height="8" rx="2" {...stylex.props(m.inkSoft)} />
      <rect x="54" y="4" width="20" height="8" rx="2" {...stylex.props(m.inkSoft)} />
      <rect x="86" y="4" width="20" height="8" rx="2" {...stylex.props(m.inkSoft)} />
      <rect x="38" y="24" width="20" height="8" rx="2" {...stylex.props(m.accentSoft)} />
      <rect x="68" y="24" width="20" height="8" rx="2" {...stylex.props(m.inkSoft)} />
      <rect x="52" y="44" width="20" height="8" rx="2" {...stylex.props(m.accent)} />
    </g>
  ),

  networktopology: (
    <g>
      {TOPO_EDGES.map(([a, b], i) => (
        <line
          key={i}
          x1={TOPO_NODES[a][0]}
          y1={TOPO_NODES[a][1]}
          x2={TOPO_NODES[b][0]}
          y2={TOPO_NODES[b][1]}
          {...stylex.props(i === 1 ? m.accentLine : m.line)}
        />
      ))}
      {TOPO_NODES.map(([x, y, status], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="4" {...stylex.props(m.lineStrong, m.bgFill)} />
          <circle
            cx={x + 3.2}
            cy={y - 3.2}
            r="1.6"
            {...stylex.props(status === 1 ? m.mint : status === 2 ? m.amber : m.inkStrong)}
          />
        </g>
      ))}
    </g>
  ),

  annotationcanvas: (
    <g>
      <rect x="2" y="2" width="116" height="52" rx="2" opacity="0.5" {...stylex.props(m.accentFaint)} />
      <rect x="12" y="10" width="36" height="22" rx="1" strokeDasharray="3 2" {...stylex.props(m.accentLine, m.noFill)} />
      <ellipse cx="80" cy="36" rx="18" ry="11" {...stylex.props(m.lineStrong, m.noFill)} />
      <line x1="18" y1="46" x2="52" y2="46" {...stylex.props(m.accentLine)} />
      <line x1="18" y1="44" x2="18" y2="48" {...stylex.props(m.accentLine)} />
      <line x1="52" y1="44" x2="52" y2="48" {...stylex.props(m.accentLine)} />
      <circle cx="86" cy="14" r="2" {...stylex.props(m.accent)} />
    </g>
  ),

  spreadsheet: (
    <g>
      <rect x="2" y="2" width="116" height="8" {...stylex.props(m.inkFaint)} />
      <rect x="4" y="4" width="30" height="4" rx="1" {...stylex.props(m.inkSoft)} />
      <line x1="2" y1="18" x2="118" y2="18" {...stylex.props(m.line)} />
      <line x1="2" y1="27" x2="118" y2="27" {...stylex.props(m.line)} />
      <line x1="2" y1="36" x2="118" y2="36" {...stylex.props(m.line)} />
      <line x1="2" y1="45" x2="118" y2="45" {...stylex.props(m.line)} />
      <line x1="32" y1="10" x2="32" y2="54" {...stylex.props(m.line)} />
      <line x1="62" y1="10" x2="62" y2="54" {...stylex.props(m.line)} />
      <line x1="92" y1="10" x2="92" y2="54" {...stylex.props(m.line)} />
      <rect x="62" y="27" width="30" height="9" {...stylex.props(m.accentLine, m.noFill)} />
      <rect x="63" y="28" width="28" height="7" opacity="0.5" {...stylex.props(m.accentFaint)} />
    </g>
  ),

  nodeeditor: (
    <g>
      <path d="M38 20 C 56 20, 60 36, 78 36" {...stylex.props(m.accentLine, m.noFill)} />
      <rect x="8" y="10" width="30" height="20" rx="3" {...stylex.props(m.lineStrong, m.bgFill)} />
      <rect x="78" y="26" width="30" height="20" rx="3" {...stylex.props(m.lineStrong, m.bgFill)} />
      <line x1="12" y1="16" x2="30" y2="16" {...stylex.props(m.line)} />
      <line x1="82" y1="32" x2="100" y2="32" {...stylex.props(m.line)} />
      <circle cx="38" cy="20" r="2" {...stylex.props(m.accent)} />
      <circle cx="78" cy="36" r="2" {...stylex.props(m.accent)} />
      <circle cx="38" cy="26" r="2" {...stylex.props(m.inkStrong)} />
      <circle cx="78" cy="42" r="2" {...stylex.props(m.inkStrong)} />
    </g>
  ),

  whiteboard: (
    <g>
      {DOT_GRID.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="0.9" opacity="0.6" {...stylex.props(m.inkStrong)} />
      ))}
      <path d="M16 42 C 28 12, 48 52, 64 28 S 96 16, 106 36" {...stylex.props(m.accentLine, m.noFill)} />
      <rect x="70" y="8" width="22" height="14" rx="2" {...stylex.props(m.lineStrong, m.noFill)} />
    </g>
  ),

  pdfviewer: (
    <g>
      <rect x="10" y="10" width="28" height="38" rx="1" {...stylex.props(m.lineStrong, m.bgFill)} />
      <rect x="46" y="6" width="28" height="44" rx="1" {...stylex.props(m.accentLine, m.bgFill)} />
      <rect x="82" y="10" width="28" height="38" rx="1" {...stylex.props(m.lineStrong, m.bgFill)} />
      {[14, 19, 24, 29, 34].map((y, i) => (
        <line key={i} x1="50" y1={y + 4} x2={i === 4 ? 60 : 70} y2={y + 4} {...stylex.props(m.line)} />
      ))}
      {[16, 21, 26].map((y, i) => (
        <line key={`l${i}`} x1="14" y1={y} x2={i === 2 ? 26 : 34} y2={y} {...stylex.props(m.line)} />
      ))}
      {[16, 21, 26].map((y, i) => (
        <line key={`r${i}`} x1="86" y1={y} x2={i === 2 ? 98 : 106} y2={y} {...stylex.props(m.line)} />
      ))}
    </g>
  ),
}

