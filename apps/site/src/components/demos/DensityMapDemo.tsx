'use client'

import * as stylex from '@stylexjs/stylex'
import { useEffect, useMemo, useState } from 'react'
import { GPUProvider, useGpu } from '@gpu-components/react'
import type { ViewportState } from '@gpu-components/core'
import { GPUDensityMap, ingestLonLat, lonLatToMercator } from '../../../../../registry/densitymap'
import { Hint, fmtInt, mulberry32, s, useMeasuredStage } from './chrome'

/** Western Europe hotspots — tight enough that screen-sized hexes light up densely. */
const CLUSTERS = [
  { lon: -0.12, lat: 51.5, spread: 0.55 },
  { lon: 2.35, lat: 48.85, spread: 0.5 },
  { lon: 4.9, lat: 52.37, spread: 0.4 },
  { lon: 13.4, lat: 52.5, spread: 0.45 },
  { lon: 12.5, lat: 41.9, spread: 0.4 },
  { lon: -3.7, lat: 40.4, spread: 0.35 },
]

const LON0 = -12
const LON1 = 20
const LAT0 = 36
const LAT1 = 58

function DensityMapStage() {
  const { status } = useGpu()
  const { ref: stageRef, box } = useMeasuredStage({ width: 900, height: 480 })
  const POINTS = 250_000

  const data = useMemo(() => {
    const rnd = mulberry32(0xd3551)
    const lon = new Float32Array(POINTS)
    const lat = new Float32Array(POINTS)
    for (let i = 0; i < POINTS; i++) {
      if (i % 5 === 0) {
        // Ambient fill so the hex field is contiguous, not five lonely blobs.
        lon[i] = LON0 + rnd() * (LON1 - LON0)
        lat[i] = LAT0 + rnd() * (LAT1 - LAT0)
      } else {
        const cluster = CLUSTERS[i % CLUSTERS.length]!
        const u = Math.max(rnd(), 1e-9)
        const v = rnd()
        const r = Math.sqrt(-2 * Math.log(u)) * cluster.spread
        lon[i] = cluster.lon + r * Math.cos(2 * Math.PI * v)
        lat[i] = cluster.lat + r * Math.sin(2 * Math.PI * v)
      }
    }
    return ingestLonLat(lon, lat)
  }, [])

  const region = useMemo(() => {
    const sw = lonLatToMercator(LON0, LAT0)
    const ne = lonLatToMercator(LON1, LAT1)
    return {
      xMin: Math.min(sw.x, ne.x),
      xMax: Math.max(sw.x, ne.x),
      yMin: Math.min(sw.y, ne.y),
      yMax: Math.max(sw.y, ne.y),
    }
  }, [])

  const [hovered, setHovered] = useState<number | null>(null)

  const [viewport, setViewport] = useState<ViewportState>(() => ({
    timeStart: region.xMin,
    timeEnd: region.xMax,
    trackCount: 1,
    rowStart: region.yMin,
    rowEnd: region.yMax,
    yContinuous: true,
    width: box.width,
    height: box.height,
  }))

  useEffect(() => {
    setViewport((v) => ({ ...v, width: box.width, height: box.height }))
  }, [box.width, box.height])

  return (
    <div {...stylex.props(s.root)}>
      <div {...stylex.props(s.head)}>
        <span {...stylex.props(s.panelTitle)}>
          GPUDensityMap — {fmtInt(POINTS)} lon/lat points, GPU hexbin
        </span>
        <span {...stylex.props(s.readoutValue)}>
          {hovered != null ? `hex ${fmtInt(hovered)}` : <span {...stylex.props(s.dim)}>hover a hex</span>}
        </span>
      </div>
      <div ref={stageRef} {...stylex.props(s.stage)}>
        {status === 'ready' && box.width > 1 && (
          <GPUDensityMap
            data={data}
            viewport={viewport}
            onViewportChange={setViewport}
            hexSizePx={16}
            hoveredIndex={hovered}
            onHoverHex={setHovered}
            colormap="magma"
            aria-label="Europe density map"
          />
        )}
      </div>
      <div {...stylex.props(s.hints)}>
        <Hint keys="wheel">zoom both axes</Hint>
        <Hint keys="drag">pan</Hint>
        <Hint keys="hover">inspect a hex cell</Hint>
      </div>
      <p {...stylex.props(s.footnote)}>
        Lon/lat → Web Mercator at ingest, then a compute pass atomically hexbins every point into a
        viewport-covering odd-r grid sized in screen pixels so cells stay readable when you zoom.
        Graticule and a coarse world outline through <code>LineLayer</code> — no tile basemap.
      </p>
    </div>
  )
}

const PROVIDER_OPTIONS = { profiling: true }

export function DensityMapDemo() {
  return (
    <GPUProvider options={PROVIDER_OPTIONS}>
      <DensityMapStage />
    </GPUProvider>
  )
}
