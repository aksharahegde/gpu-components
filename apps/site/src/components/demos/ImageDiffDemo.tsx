'use client'

import * as stylex from '@stylexjs/stylex'
import { useEffect, useMemo, useState } from 'react'
import { GPUProvider, useGpu } from '@gpuc/react'
import type { ViewportState } from '@gpuc/core'
import { GPUImageDiff, DIFF_MODES, generateImage, ingestPair } from '../../../../../registry/imagediff'
import type { DiffMode } from '../../../../../registry/imagediff'
import { Btn, Dim, Field, fmtInt, Hint, PROVIDER_OPTIONS, s, Segmented, useMeasuredStage } from './chrome'

const SIZE = 512

/**
 * A synthetic "UI screenshot before and after a bad CSS change".
 *
 * Generated rather than shipped as two PNGs so the page stays self-contained and the changed region
 * is a known quantity — the percentage the component reports can be checked by eye against what the
 * generator actually moved.
 */
function makeScreenshot(shifted: boolean) {
  const buttonX = shifted ? 300 : 280
  return generateImage(SIZE, SIZE, (x, y) => {
    // Header bar.
    if (y < 56) return [28, 32, 44, 255]
    // Sidebar.
    if (x < 120) return [22, 25, 34, 255]
    // A card, with a button inside it that moves by 20px in the "after" image.
    if (y > 120 && y < 300 && x > 160 && x < 460) {
      const inButton = y > 220 && y < 264 && x > buttonX && x < buttonX + 120
      if (inButton) return shifted ? [96, 132, 255, 255] : [88, 124, 248, 255]
      return [38, 42, 56, 255]
    }
    // A row of list items, one of which changes colour subtly in the "after".
    if (y > 340 && y < 380 && x > 160 && x < 460) {
      return shifted ? [46, 52, 68, 255] : [44, 50, 64, 255]
    }
    return [16, 18, 26, 255]
  })
}

function ImageDiffStage() {
  const { status } = useGpu()
  const { ref: stageRef, box } = useMeasuredStage({ width: 900, height: 440 })

  const pair = useMemo(() => ingestPair(makeScreenshot(false), makeScreenshot(true)), [])

  const [mode, setMode] = useState<DiffMode>('split')
  const [split, setSplit] = useState(0.5)
  const [blend, setBlend] = useState(0.5)
  const [amplify, setAmplify] = useState(4)
  const [smooth, setSmooth] = useState(false)
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  const [changed, setChanged] = useState<{ pixels: number; total: number } | null>(null)

  const [viewport, setViewport] = useState<ViewportState>(() => ({
    timeStart: 0,
    timeEnd: SIZE,
    trackCount: SIZE,
    rowStart: 0,
    rowEnd: SIZE,
    yContinuous: true,
    width: box.width,
    height: box.height,
  }))

  useEffect(() => {
    setViewport((v) => ({ ...v, width: box.width, height: box.height }))
  }, [box.width, box.height])

  const percent = changed ? (changed.pixels / Math.max(changed.total, 1)) * 100 : null

  return (
    <div {...stylex.props(s.root)}>
      <div {...stylex.props(s.head)}>
        <span {...stylex.props(s.panelTitle)}>GPUImageDiff — {fmtInt(SIZE * SIZE)} pixels compared on the GPU</span>
        <span {...stylex.props(s.readoutValue)}>
          {percent === null ? (
            <Dim>measuring…</Dim>
          ) : (
            `${percent.toFixed(2)}% changed (${fmtInt(changed!.pixels)} px)`
          )}
        </span>
      </div>

      <div {...stylex.props(s.controls)}>
        <Field label="Mode">
          <Segmented options={DIFF_MODES} value={mode} onChange={setMode} />
        </Field>

        {mode === 'split' && (
          <Field label={`Divider ${(split * 100).toFixed(0)}%`}>
            <input
              type="range" min={0} max={1} step={0.01} value={split}
              aria-label="Divider position"
              onChange={(e) => setSplit(Number(e.target.value))}
            />
          </Field>
        )}
        {mode === 'onion' && (
          <Field label={`Before ↔ after ${(blend * 100).toFixed(0)}%`}>
            <input
              type="range" min={0} max={1} step={0.01} value={blend}
              aria-label="Onion blend"
              onChange={(e) => setBlend(Number(e.target.value))}
            />
          </Field>
        )}
        {(mode === 'difference' || mode === 'heat') && (
          <Field label={`Amplify ×${amplify}`}>
            <input
              type="range" min={1} max={20} step={1} value={amplify}
              aria-label="Difference amplification"
              onChange={(e) => setAmplify(Number(e.target.value))}
            />
          </Field>
        )}

        <Btn onClick={() => setSmooth((v) => !v)}>{smooth ? 'Smooth sampling' : 'Sharp pixels'}</Btn>

        <Field label="Cursor">
          <span {...stylex.props(s.readoutValue)}>
            {hover ? `${hover.x}, ${hover.y}` : <Dim>—</Dim>}
          </span>
        </Field>
      </div>

      <div ref={stageRef} {...stylex.props(s.stage)}>
        {status === 'ready' && box.width > 1 && (
          <GPUImageDiff
            pair={pair}
            viewport={viewport}
            onViewportChange={setViewport}
            mode={mode}
            split={split}
            blend={blend}
            amplify={amplify}
            smooth={smooth}
            onHover={setHover}
            onStats={(stats) => setChanged({ pixels: stats.changedPixels, total: stats.totalPixels })}
            aria-label="Screenshot comparison"
          />
        )}
      </div>

      <div {...stylex.props(s.hints)}>
        <Hint keys="wheel">zoom both axes at the cursor</Hint>
        <Hint keys="drag">pan</Hint>
        <Hint keys="hover">read the pixel coordinate</Hint>
      </div>

      <p {...stylex.props(s.footnote)}>
        The component that finally uses <em>textures</em>. Every other one here reads a storage
        buffer — the right call each time, but it left the whole sampled-texture path unexercised,
        and nothing in the stack owned the “images to textures” step — neither vgpu nor this
        project — until this component forced it. Zoom in with smooth sampling off and you are
        looking at hardware
        nearest-neighbour filtering; the percentage above is counted by a compute pass over all{' '}
        {fmtInt(SIZE * SIZE)} pixels, run once per image pair rather than once per frame, which is
        why panning and switching modes costs nothing.
      </p>
    </div>
  )
}

export function ImageDiffDemo() {
  return (
    <GPUProvider options={PROVIDER_OPTIONS}>
      <ImageDiffStage />
    </GPUProvider>
  )
}
