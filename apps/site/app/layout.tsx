import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { ThemeProvider } from '../src/theme'
import { ThemeScope } from '../src/theme-scope'
import { Footer, Nav, SkipLink } from '../src/components/Chrome'
import { DevCssRefresh } from '../src/components/DevCssRefresh'
import './globals.css'

export const metadata: Metadata = {
  title: 'gpu-components — GPU components that share one device',
  description:
    'A framework-independent WebGPU runtime for application components, built on vgpu. One device, one frame, one submit, across every component on the page.',
  openGraph: {
    title: 'gpu-components',
    description:
      'A framework-independent WebGPU runtime for application components. One device, one frame, one submit.',
    type: 'website',
  },
  icons: {
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%230b0d11'/%3E%3Crect x='6' y='9' width='20' height='3' rx='1.5' fill='%238b9dff'/%3E%3Crect x='6' y='14.5' width='13' height='3' rx='1.5' fill='%235be9b9'/%3E%3Crect x='6' y='20' width='17' height='3' rx='1.5' fill='%238b9dff' opacity='.55'/%3E%3C/svg%3E",
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'dark light',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        {/*
         * Runs before first paint so the page never flashes the wrong theme.
         * Mirrored by `theme.tsx`, which re-syncs React state from this
         * attribute in a layout effect on mount.
         */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function () {
  var stored = localStorage.getItem('theme')
  var theme = stored === 'light' ? 'light' : 'dark'
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
})()`,
          }}
        />
      </head>
      <body>
        <DevCssRefresh />
        <ThemeProvider>
          <ThemeScope>
            <SkipLink />
            <Nav />
            <main id="main">{children}</main>
            <Footer />
          </ThemeScope>
        </ThemeProvider>
      </body>
    </html>
  )
}
