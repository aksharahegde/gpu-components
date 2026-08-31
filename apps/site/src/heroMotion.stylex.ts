import * as stylex from '@stylexjs/stylex'

const REDUCE = '@media (prefers-reduced-motion: reduce)'
const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)'

/** Shared hero entrance motion — keyframes live in `app/globals.css`. */
export const heroMotion = stylex.create({
  glowIn: {
    animationName: {
      default: 'hero-glow-in',
      [REDUCE]: 'none',
    },
    animationDuration: '900ms',
    animationTimingFunction: EASE,
    animationFillMode: 'both',
  },
  rise: {
    animationName: {
      default: 'hero-rise',
      [REDUCE]: 'none',
    },
    animationDuration: '560ms',
    animationTimingFunction: EASE,
    animationFillMode: 'backwards',
  },
  layerIn: {
    animationName: {
      default: 'hero-layer-in',
      [REDUCE]: 'none',
    },
    animationDuration: '480ms',
    animationTimingFunction: EASE,
    animationFillMode: 'backwards',
  },
  arrowIn: {
    animationName: {
      default: 'hero-arrow-in',
      [REDUCE]: 'none',
    },
    animationDuration: '320ms',
    animationTimingFunction: EASE,
    animationFillMode: 'backwards',
  },
})

/** Bottom layer (WebGPU) appears first; Application lands last. */
export function layerRevealDelay(index: number, layerCount: number): string {
  const fromBottom = layerCount - 1 - index
  return `${420 + fromBottom * 55}ms`
}

export function arrowRevealDelay(index: number, layerCount: number): string {
  const fromBottom = layerCount - 2 - index
  return `${420 + fromBottom * 55 + 28}ms`
}
