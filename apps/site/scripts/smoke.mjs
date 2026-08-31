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
  ['/', 'index.html', ['GPU components that', 'Where DOM and Canvas2D actually break', 'gpu-components']],
  ['/why-gpu', 'why-gpu/index.html', ['Do not use the GPU merely because it is possible', 'Main thread']],
  ['/architecture', 'architecture/index.html', ['One device, a scheduler', 'RenderPass', 'InstancedQuadLayer']],
  ['/components', 'components/index.html', ['GPUTimeline', 'GPUDataGrid', '147.0']],
  ['/roadmap', 'roadmap/index.html', ['Week one is measurement, not code', 'Phase 5', 'ACCEPTANCE']],
  ['/start', 'start/index.html', ['Nothing is published yet', 'gpu-components add timeline']],
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
    const hasTokenDefaults = css.includes('--xrfyece:#08090b') || css.includes('--xrfyece: #08090b')
    if (css.length < 8000 || !hasAtomicRules || !hasTokenDefaults) {
      console.error(
        `✗ stylex css — bundle looks incomplete (${css.length} bytes; atomic=${hasAtomicRules}; tokens=${hasTokenDefaults})`,
      )
      failures++
    } else {
      console.log(`✓ stylex css — ${css.length.toLocaleString()} bytes with token defaults and atomic rules`)
    }
  }

  const hrefs = new Set(Array.from(html.matchAll(/href="([^"]*)"/g)).map((m) => m[1]))
  const required = ['/why-gpu/', '/architecture/', '/components/', '/roadmap/', '/start/']
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
