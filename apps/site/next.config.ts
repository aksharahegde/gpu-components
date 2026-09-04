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
// both (server components call stylex.create/defineVars at build time). The
// unplugin's built-in CSS injection runs at PROCESS_ASSETS_STAGE_SUMMARIZE,
// before Next's client build has emitted its extracted `.css` asset, so it
// no-ops ("No CSS asset found to inject into"). A second hook on the client
// build at PROCESS_ASSETS_STAGE_REPORT appends the collected rules once the
// CSS asset exists.
type StylexPlugin = ReturnType<typeof stylexWebpack> & {
  __stylexCollectCss?: () => string | undefined
}

function stylexClientCssInjection(stylex: StylexPlugin) {
  const collectCss = stylex.__stylexCollectCss?.bind(stylex)
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
            const css = collectCss?.()
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
  webpack(config, { isServer, dev }) {
    // `next dev` recompiles incrementally: only the modules touched by a
    // given rebuild re-run the StyleX babel transform, but the unplugin
    // resets its entire collected-rules store on every compilation (see
    // `@stylexjs/unplugin`'s webpack.js `thisCompilation` hook). The result
    // is that `stylexClientCssInjection` below only ever sees whatever
    // subset of modules happened to rebuild most recently — in practice,
    // almost nothing, since most modules build once at startup and never
    // rebuild again. That's a `next build`/export-only concern: production
    // does one full compilation, so the collected rules are complete.
    //
    // In dev, skip static extraction entirely and use StyleX's runtime
    // injection instead — each `stylex.create()` call injects its own CSS
    // into `<head>` when the module evaluates, independent of which modules
    // webpack happens to rebuild. Slightly less optimal than atomic
    // extraction, but correct, and irrelevant to the exported production
    // bundle.
    const stylex = stylexWebpack({ useCSSLayers: false, runtimeInjection: dev })
    config.plugins.push(stylex)
    if (!isServer && !dev) config.plugins.push(stylexClientCssInjection(stylex))
    return config
  },
}

export default nextConfig
