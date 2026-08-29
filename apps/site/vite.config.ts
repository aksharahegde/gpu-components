import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import stylex from '@stylexjs/unplugin'

export default defineConfig({
  plugins: [
    // StyleX must run before @vitejs/plugin-react to preserve Fast Refresh.
    //
    // useCSSLayers is false on purpose: `src/global.css` carries an unlayered
    // element reset (body, a, h1–h4). Layered rules lose to *any* unlayered rule
    // regardless of specificity, so with layers on, `a { color }` in the reset
    // would beat every StyleX colour on an anchor. Unlayered, the atomic class
    // (0,1,0) correctly outranks the element selector (0,0,1).
    stylex.vite({ useCSSLayers: false }),
    react(),
  ],
  // Absolute base: routes are History-API paths, so deep links need a host-side
  // SPA rewrite (see README). Vite's dev server and preview do this by default.
  base: '/',
  build: { outDir: 'dist', sourcemap: true },
  server: { port: 5173, open: false },
})
