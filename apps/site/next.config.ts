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
// unplugin's built-in CSS injection runs at PROCESS_ASSETS_STAGE_SUMMARIZE;
// on the server build the CSS asset is not emitted yet ("No CSS asset found"),
// but the client build emits `static/css/*.css` in time for injection.
const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  webpack(config) {
    config.plugins.push(
      stylexWebpack({
        useCSSLayers: false,
        cssInjectionTarget: (file) =>
          /layout\.css$/.test(file) || /static\/css\/.+\.css$/.test(file),
      }),
    )
    return config
  },
}

export default nextConfig
