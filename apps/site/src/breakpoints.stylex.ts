import * as stylex from '@stylexjs/stylex'

/**
 * `defineConsts` rather than `defineVars`: media queries are compile-time
 * constants, never themed or overridden at runtime.
 */
export const bp = stylex.defineConsts({
  /** phones — single column everywhere */
  sm: '@media (max-width: 620px)',
  /** small tablets — 4-up and 3-up grids collapse to 2-up */
  md: '@media (max-width: 900px)',
  /** collapse the nav into a menu button */
  nav: '@media (max-width: 720px)',
  /** hero stops being two columns */
  hero: '@media (max-width: 940px)',
  /** roadmap phase rows stack */
  phase: '@media (max-width: 700px)',
})
