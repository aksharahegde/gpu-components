/**
 * Static-export smoke test.
 *
 * Runs after `next build` (which produces `out/`) and asserts that every
 * route's exported HTML actually contains real content, that StyleX compiled
 * (atomic classes present), and that the nav links to every real route.
 * Catches white-screen regressions and silent build-tool failures that a
 * typecheck alone would not (bad hooks, null derefs, a StyleX plugin that
 * silently no-ops).
 *
 * Run: npm run smoke (after npm run build)
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const OUT_DIR = join(import.meta.dirname, '..', 'out')

const ROUTES = [
  ['/', 'index.html', ['Your interface has a ceiling', 'six GPU devices', 'runs live in your browser']],
  ['/why-gpu', 'why-gpu/index.html', ['Do not use the GPU merely because it is possible', 'Main thread']],
  ['/architecture', 'architecture/index.html', ['One device, a scheduler', 'RenderPass', 'InstancedQuadLayer']],
  ['/components', 'components/index.html', ['GPUTimeline', 'GPUDataGrid', '147.0']],
  ['/start', 'start/index.html', ['Nothing is on npm yet', 'gpu-components add timeline']],
  ['/nope', '404.html', ['No such page']],
]

let failures = 0

if (!existsSync(OUT_DIR)) {
  console.error(`✗ ${OUT_DIR} does not exist — run \`npm run build\` first`)
  process.exit(1)
}

for (const [route, file, expectations] of ROUTES) {
  const path = join(OUT_DIR, file)
  if (!existsSync(path)) {
    console.error(`✗ ${route} — ${file} was not generated`)
    failures++
    continue
  }
  const html = readFileSync(path, 'utf8')
  if (html.length < 500) {
    console.error(`✗ ${route} — rendered almost nothing (${html.length} bytes)`)
    failures++
    continue
  }
  const missing = expectations.filter((e) => !html.includes(e))
  if (missing.length) {
    console.error(`✗ ${route} — missing: ${missing.map((m) => JSON.stringify(m)).join(', ')}`)
    failures++
  } else {
    console.log(`✓ ${route} — ${html.length.toLocaleString()} bytes, ${expectations.length} assertions`)
  }
}

// StyleX must actually have compiled: every styled element carries an atomic
// class. If the plugin silently no-ops, the site renders unstyled and this is
// the only check that would notice.
{
  const html = readFileSync(join(OUT_DIR, 'index.html'), 'utf8')
  const classAttrs = Array.from(html.matchAll(/class="([^"]*)"/g)).map((m) => m[1])
  const atomic = classAttrs.filter((cls) => cls.split(/\s+/).some((cn) => /^x[a-z0-9]+$/.test(cn)))
  if (atomic.length < 50) {
    console.error(`✗ stylex — only ${atomic.length} elements carry atomic classes; the compiler likely did not run`)
    failures++
  } else {
    console.log(`✓ stylex — ${atomic.length} elements carry compiled atomic classes`)
  }

  const cssFiles = Array.from(
    html.matchAll(/href="(\/_next\/static\/css\/[^"]+\.css)"/g),
    (m) => m[1],
  )
  if (!cssFiles.length) {
    console.error('✗ stylex — no stylesheet linked from index.html')
    failures++
  } else {
    const cssPath = join(OUT_DIR, cssFiles[0].slice(1))
    const css = readFileSync(cssPath, 'utf8')
    const hasAtomicRules = /background-color:\s*var\(--x[a-z0-9]+\)/.test(css)
    // `--xrfyece` is `color.bg` from `tokens.stylex.ts`. Asserting the declaration exists rather
    // than a specific colour: the point of the check is that `globals.css`'s pasted `:root` block
    // survived the build (see its comment), not what the palette happens to be this month.
    const hasTokenDefaults = /--xrfyece:\s*#[0-9a-f]{6}/i.test(css)
    if (css.length < 8000 || !hasAtomicRules || !hasTokenDefaults) {
      console.error(
        `✗ stylex css — bundle looks incomplete (${css.length} bytes; atomic=${hasAtomicRules}; tokens=${hasTokenDefaults})`,
      )
      failures++
    } else {
      console.log(`✓ stylex css — ${css.length.toLocaleString()} bytes with token defaults and atomic rules`)
    }
  }

  /*
   * No inline `style` attributes anywhere in the export.
   *
   * `public/_headers` sets `style-src 'self'` with no `'unsafe-inline'`, so the browser drops every
   * inline style attribute — the markup keeps it, the page ignores it. That makes an inline style
   * not merely useless but actively misleading: it is dead code that looks live in the HTML and in
   * local development, where `out/` is served without headers.
   *
   * StyleX produces one whenever a style is *dynamic* (`foo: (n) => ({ gap: n })`). That is how 138
   * gaps across six pages shipped collapsed. Checking the built markup catches it at build time
   * instead, which is the only cheap place to catch it: rendering with the real CSP would need a
   * browser, and by then it is already deployed.
   */
  const inlineStyled = Array.from(html.matchAll(/<[^>]+\sstyle="([^"]*)"/g)).map((m) => m[1])
  if (inlineStyled.length) {
    console.error(
      `✗ inline styles — ${inlineStyled.length} element(s) carry a style attribute, which ` +
        `style-src 'self' drops at runtime. First: ${JSON.stringify(inlineStyled[0])}. ` +
        `A dynamic StyleX style is the usual cause; use a static scale instead.`,
    )
    failures++
  } else {
    console.log('✓ inline styles — none, so nothing depends on what the CSP drops')
  }

  const hrefs = new Set(Array.from(html.matchAll(/href="([^"]*)"/g)).map((m) => m[1]))
  const required = ['/why-gpu/', '/architecture/', '/components/', '/playground/', '/start/']
  const dead = required.filter((r) => !hrefs.has(r))
  if (dead.length) {
    console.error(`✗ nav — missing links: ${dead.join(', ')}`)
    failures++
  } else {
    console.log(`✓ nav — all ${required.length} routes linked`)
  }
}

if (failures) {
  console.error(`\n${failures} smoke failure(s)`)
  process.exit(1)
}
console.log('\nAll routes render.')
process.exit(0)
