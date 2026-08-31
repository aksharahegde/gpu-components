/**
 * Render smoke test.
 *
 * Mounts the real App at every route in jsdom and asserts that the page
 * actually produced content. Catches white-screen regressions that a
 * typecheck and a bundle cannot — bad hooks, null derefs, broken routing.
 *
 * It is built through Vite (`vite build --ssr`) rather than raw esbuild so the
 * StyleX plugin transforms `stylex.create` at compile time. Without that,
 * StyleX has no runtime to fall back on and every component throws.
 *
 * Run: npm run smoke
 */
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
})

const g = globalThis as Record<string, unknown>
g.window = dom.window
g.document = dom.window.document
// Node 22 exposes `navigator` as a getter-only global, so it needs redefining
// rather than assigning.
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator,
  configurable: true,
  writable: true,
})
g.HTMLElement = dom.window.HTMLElement
g.HTMLCanvasElement = dom.window.HTMLCanvasElement
g.Node = dom.window.Node
g.Element = dom.window.Element
g.getComputedStyle = dom.window.getComputedStyle
g.requestAnimationFrame = (cb: FrameRequestCallback) =>
  setTimeout(() => cb(Date.now()), 16) as unknown as number
g.cancelAnimationFrame = (id: number) => clearTimeout(id)
g.IS_REACT_ACT_ENVIRONMENT = true

// jsdom has no canvas backend and no IntersectionObserver; the components guard
// for both, and these stubs prove those guards hold rather than bypassing them.
;(dom.window.HTMLCanvasElement.prototype as unknown as { getContext: () => null }).getContext =
  () => null

const ROUTES: Array<[string, string[]]> = [
  ['/', ['GPU components that', 'Where DOM and Canvas2D actually break', 'gpu-components']],
  ['/why-gpu', ['Do not use the GPU merely because it is possible', 'Main thread']],
  ['/architecture', ['One device, a scheduler', 'RenderPass', 'InstancedQuadLayer']],
  ['/components', ['GPUTimeline', 'GPUDataGrid', '147.0']],
  ['/start', ['Nothing is published yet', 'gpu-components add timeline']],
  ['/nope', ['No such page']],
]

async function main() {
  const { createElement, act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { RouterProvider } = await import('../src/router')
  const { App } = await import('../src/App')

  let failures = 0
  const host = dom.window.document.getElementById('root')!

  const mount = async () => {
    host.innerHTML = ''
    const root = createRoot(host)
    await act(async () => {
      root.render(createElement(RouterProvider, null, createElement(App, null)))
    })
    return root
  }

  for (const [route, expectations] of ROUTES) {
    dom.window.history.replaceState({}, '', route)
    const root = await mount()

    const text = host.textContent ?? ''
    const html = host.innerHTML ?? ''

    if (html.length < 500) {
      console.error(`✗ ${route} — rendered almost nothing (${html.length} bytes)`)
      failures++
    } else {
      const missing = expectations.filter((e) => !text.includes(e))
      if (missing.length) {
        console.error(`✗ ${route} — missing: ${missing.map((m) => JSON.stringify(m)).join(', ')}`)
        failures++
      } else {
        console.log(
          `✓ ${route} — ${html.length.toLocaleString()} bytes, ${expectations.length} assertions`,
        )
      }
    }

    await act(async () => {
      root.unmount()
    })
  }

  // StyleX must actually have compiled: every styled element carries an atomic
  // class. If the plugin silently no-ops, the site renders unstyled and this is
  // the only check that would notice.
  {
    dom.window.history.replaceState({}, '', '/')
    const root = await mount()
    const classed = Array.from(host.querySelectorAll('[class]'))
    const atomic = classed.filter((el) =>
      (el.getAttribute('class') ?? '').split(/\s+/).some((cn) => /^x[a-z0-9]+$/.test(cn)),
    )
    if (atomic.length < 50) {
      console.error(
        `✗ stylex — only ${atomic.length} elements carry atomic classes; the compiler likely did not run`,
      )
      failures++
    } else {
      console.log(`✓ stylex — ${atomic.length} elements carry compiled atomic classes`)
    }

    // Nav links must point at every real route, or the site is a dead end.
    const hrefs = new Set(
      Array.from(host.querySelectorAll('a')).map((a) =>
        (a as HTMLAnchorElement).getAttribute('href'),
      ),
    )
    const required = ['/why-gpu', '/architecture', '/components', '/playground', '/start']
    const dead = required.filter((r) => !hrefs.has(r))
    if (dead.length) {
      console.error(`✗ nav — missing links: ${dead.join(', ')}`)
      failures++
    } else {
      console.log(`✓ nav — all ${required.length} routes linked`)
    }

    await act(async () => {
      root.unmount()
    })
  }

  if (failures) {
    console.error(`\n${failures} smoke failure(s)`)
    process.exit(1)
  }
  console.log('\nAll routes render.')
  process.exit(0)
}

void main()
