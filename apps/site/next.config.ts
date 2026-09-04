import path from 'node:path'
import { createRequire } from 'node:module'
import type { NextConfig } from 'next'
import stylexWebpack from '@stylexjs/unplugin/webpack'

// StyleX has no Turbopack plugin yet, so this project builds with Webpack —
// `package.json`'s `dev`/`build` scripts pass `--webpack` explicitly (Next 16
// defaults to Turbopack and no longer falls back on its own). `useCSSLayers`
// is false for the same reason documented in `app/globals.css`: the unlayered
// element reset in that file must lose to StyleX's atomic classes on
// specificity, not layer order.
//
// Next runs separate server and client webpack builds. StyleX must transform
// both (server components call stylex.create/defineVars at build time), and
// the collected rules from BOTH builds — most component styling lives in
// Server Components, whose modules never ship to the client compiler at all —
// have to land in the client CSS asset, since that's the only CSS the static
// export serves. `@stylexjs/unplugin`'s webpack entrypoint tracks rules in a
// `globalThis`-scoped store shared across every plugin instance in the
// process (see its `core.js` `getSharedStore`), so a server-compiled and a
// client-compiled module both register into the same place. But the plugin
// instance `stylexWebpack()` hands back only exposes a webpack-plugin-shaped
// `{ apply }` — `unplugin`'s `createWebpackPlugin` wraps the raw plugin and
// does not forward its `__stylexCollectCss` helper onto the object it
// returns. Reach the real helper by constructing a second, throwaway raw
// plugin instance via the package's internal (non-exported-subpath) factory —
// loaded through an absolute `require`, which bypasses the package's
// `exports` map restriction on package-specifier resolution — and read the
// shared store through *that* instance instead. It never transforms
// anything itself; it only calls into the same global store the real
// transforming instances already populated.
const unpluginCoreRequire = createRequire(import.meta.url)
const unpluginCorePath = path.join(
  path.dirname(unpluginCoreRequire.resolve('@stylexjs/unplugin/webpack')),
  'core.js',
)
const { unpluginFactory: stylexUnpluginFactory } = unpluginCoreRequire(unpluginCorePath) as {
  unpluginFactory: (
    options: Record<string, unknown>,
  ) => { __stylexCollectCss?: () => string | undefined }
}

function stylexClientCssInjection() {
  return {
    apply(compiler: {
      hooks: { thisCompilation: { tap: Function } }
      webpack: {
        Compilation: { PROCESS_ASSETS_STAGE_REPORT: number }
        sources: { RawSource: new (s: string) => unknown }
      }
    }) {
      compiler.hooks.thisCompilation.tap('@stylexjs/unplugin/client-inject', (compilation: {
        hooks: { processAssets: { tap: Function } }
        getAsset: (name: string) => { source: { source: () => string | Buffer } } | undefined
        updateAsset: (name: string, source: unknown) => void
      }) => {
        const wp = compiler.webpack
        const stage = wp.Compilation.PROCESS_ASSETS_STAGE_REPORT
        compilation.hooks.processAssets.tap(
          { name: '@stylexjs/unplugin/client-inject', stage },
          (assets: Record<string, unknown>) => {
            const collector = stylexUnpluginFactory({ useCSSLayers: false, runtimeInjection: false })
            const css = collector.__stylexCollectCss?.()
            if (!css) return
            const cssAssets = Object.keys(assets).filter((f) => f.endsWith('.css'))
            if (!cssAssets.length) return
            const pick =
              cssAssets.find((f) => /layout\.css$/.test(f)) ??
              cssAssets.find((f) => /static\/css\/.+\.css$/.test(f)) ??
              cssAssets.find((f) => /(^|\/)index\.css$/.test(f)) ??
              cssAssets[0]
            const asset = compilation.getAsset(pick)
            if (!asset) return
            const existing = asset.source.source().toString()
            if (existing.includes(css)) return
            const next = existing ? `${existing}\n${css}` : css
            compilation.updateAsset(pick, new wp.sources.RawSource(next))
          },
        )
      })
    },
  }
}

const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  webpack(config, { isServer }) {
    // Runtime injection (`stylex.create()` inserting its own CSS into
    // `<head>` when a module evaluates) only works for code that actually
    // executes in the browser. Most of this site's styling lives in Server
    // Components (`page.tsx`, `ui.tsx`, `Layers.tsx`, ...), which under the
    // App Router only ever run on the server/build machine — there is no
    // `document` for their `stylex.create()` calls to inject into, dev or
    // prod. So static extraction (below) is the only path that reaches
    // those styles at all; `runtimeInjection` stays off unconditionally.
    //
    // `@stylexjs/unplugin`'s webpack integration resets its *local*
    // per-instance rule map on every compilation (see its webpack.js
    // `thisCompilation` hook) — relevant because `next dev` recompiles
    // incrementally, one `thisCompilation` per rebuild. But collected rules
    // also land in a `globalThis`-scoped store shared across every plugin
    // instance in the process (see its core.js `getSharedStore`), which
    // that per-compilation reset does not touch — so rules collected by an
    // earlier dev rebuild are still there on the next one.
    const stylex = stylexWebpack({ useCSSLayers: false, runtimeInjection: false })
    config.plugins.push(stylex)
    if (!isServer) config.plugins.push(stylexClientCssInjection())
    return config
  },
}

export default nextConfig
