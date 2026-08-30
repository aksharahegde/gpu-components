import type { NextConfig } from 'next'
import stylexWebpack from '@stylexjs/unplugin/webpack'

// StyleX has no Turbopack plugin yet, so this project builds with Webpack —
// `package.json`'s `dev`/`build` scripts pass `--webpack` explicitly (Next 16
// defaults to Turbopack and no longer falls back on its own). `useCSSLayers`
// is false for the same reason documented in `app/globals.css`: the unlayered
// element reset in that file must lose to StyleX's atomic classes on
// specificity, not layer order.
const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  webpack(config) {
    config.plugins.push(stylexWebpack({ useCSSLayers: false }))
    return config
  },
}

export default nextConfig
