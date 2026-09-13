import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { ImageResponse } from 'next/og'
import { COMPONENTS } from './catalog'

/**
 * Shared Open Graph card renderer, used by every `opengraph-image.tsx` in
 * `app/`. The site is a static export, so these render once at build time
 * into `out/` as PNGs — there is no request-time work here.
 *
 * The card is the site in miniature: near-white ground, the favicon's
 * three-bar mark, Geist for text and Geist Mono for the eyebrow/wordmark, and
 * the grayscale-plus-one-teal-accent palette from `tokens.stylex.ts`. Satori
 * (under `ImageResponse`) cannot read CSS custom properties, so the handful
 * of colours used here are literal copies of the token values.
 */

export const OG_SIZE = { width: 1200, height: 630 }
export const OG_CONTENT_TYPE = 'image/png'

// Token copies (see src/tokens.stylex.ts — keep in sync by hand).
const BG = '#fafafa'
const SURFACE2 = '#f2f2f2'
const BORDER = 'rgba(23, 23, 23, 0.08)'
const TEXT = '#171717'
const TEXT_DIM = '#292929'
const TEXT_FAINT = '#585858'
const ACCENT = '#006e92'
const MINT = '#636363'

/**
 * Geist ships TTFs inside the `geist` package (already a dependency for
 * `next/font`), so the card uses the exact faces the site renders with. The
 * package is hoisted to the workspace root in this monorepo, but resolve
 * both locations so a non-hoisted install keeps working.
 */
function fontFile(rel: string): Buffer {
  const candidates = [
    path.join(process.cwd(), 'node_modules/geist/dist/fonts', rel),
    path.join(process.cwd(), '../../node_modules/geist/dist/fonts', rel),
  ]
  for (const p of candidates) {
    if (existsSync(p)) return readFileSync(p)
  }
  throw new Error(`og: cannot find Geist font file "${rel}" (looked in ${candidates.join(', ')})`)
}

/**
 * The playground pages all draw the same card shape from the shared catalog;
 * this resolves a slug into the pieces their `opengraph-image.tsx` files
 * export. Throwing on an unknown slug fails the build, which is the point —
 * a renamed catalog entry should not ship a page with someone else's card.
 */
export function componentOg(slug: string): { alt: string; image: () => ImageResponse } {
  const entry = COMPONENTS.find((c) => c.slug === slug)
  if (!entry) throw new Error(`og: no catalog entry for slug "${slug}"`)
  return {
    alt: `${entry.name} — gpu-components`,
    image: () => renderOgCard({ eyebrow: 'Playground', title: entry.name, lead: entry.blurb }),
  }
}

export interface OgCardProps {
  /** Small uppercase mono label above the title, e.g. "Playground". */
  eyebrow: string
  title: string
  /** One or two supporting lines; long text is clipped, not wrapped forever. */
  lead: string
}

export function renderOgCard({ eyebrow, title, lead }: OgCardProps): ImageResponse {
  // Satori has no line clamping worth trusting; bound the copy instead.
  const clippedLead = lead.length > 220 ? `${lead.slice(0, 217).trimEnd()}…` : lead

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: BG,
          padding: '56px 64px',
          fontFamily: 'Geist',
        }}
      >
        {/* Wordmark row: the favicon's three bars plus the project name. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              gap: 5,
              width: 44,
              height: 44,
              borderRadius: 0,
              backgroundColor: SURFACE2,
              padding: 9,
            }}
          >
            <div style={{ display: 'flex', height: 6, borderRadius: 0, backgroundColor: ACCENT, width: 26 }} />
            <div style={{ display: 'flex', height: 6, borderRadius: 0, backgroundColor: MINT, width: 17 }} />
            <div style={{ display: 'flex', height: 6, borderRadius: 0, backgroundColor: ACCENT, opacity: 0.45, width: 22 }} />
          </div>
          <div style={{ display: 'flex', fontFamily: 'Geist Mono', fontSize: 28, color: TEXT }}>
            gpu-components
          </div>
        </div>

        {/* Main copy. */}
        <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, justifyContent: 'center', gap: 22 }}>
          <div
            style={{
              display: 'flex',
              fontFamily: 'Geist Mono',
              fontSize: 24,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: ACCENT,
            }}
          >
            {eyebrow}
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: title.length > 44 ? 56 : 66,
              fontWeight: 600,
              lineHeight: 1.12,
              letterSpacing: '-0.02em',
              color: TEXT,
              maxWidth: 1020,
            }}
          >
            {title}
          </div>
          <div style={{ display: 'flex', fontSize: 28, lineHeight: 1.45, color: TEXT_DIM, maxWidth: 980 }}>
            {clippedLead}
          </div>
        </div>

        {/* Footer: hairline plus the runtime's one-line thesis. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderTop: `2px solid ${BORDER}`,
            paddingTop: 26,
          }}
        >
          <div style={{ display: 'flex', fontFamily: 'Geist Mono', fontSize: 22, color: TEXT_FAINT }}>
            One device · one frame · one submit
          </div>
          <div style={{ display: 'flex', fontFamily: 'Geist Mono', fontSize: 22, color: ACCENT }}>
            WebGPU
          </div>
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: [
        { name: 'Geist', data: fontFile('geist-sans/Geist-Regular.ttf'), weight: 400, style: 'normal' },
        { name: 'Geist', data: fontFile('geist-sans/Geist-SemiBold.ttf'), weight: 600, style: 'normal' },
        { name: 'Geist Mono', data: fontFile('geist-mono/GeistMono-Regular.ttf'), weight: 400, style: 'normal' },
      ],
    },
  )
}
