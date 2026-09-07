import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
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
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23ffffff'/%3E%3Crect x='6' y='9' width='20' height='3' rx='1.5' fill='%230077b6'/%3E%3Crect x='6' y='14.5' width='13' height='3' rx='1.5' fill='%230e7c58'/%3E%3Crect x='6' y='20' width='17' height='3' rx='1.5' fill='%230077b6' opacity='.45'/%3E%3C/svg%3E",
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'light',
}

/**
 * The site is light-only. There is no theme provider, no `data-theme`
 * attribute, and no pre-paint bootstrap script — the palette in
 * `src/tokens.stylex.ts` is the only one, so there is nothing to flash.
 *
 * `GeistSans.variable` / `GeistMono.variable` declare `--font-geist-sans` and
 * `--font-geist-mono` here on `<html>`, which is where `globals.css`'s `body`
 * rule and the `font` tokens both read them from.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      data-scroll-behavior="smooth"
    >
      <body>
        <DevCssRefresh />
        <SkipLink />
        <Nav />
        <main id="main">{children}</main>
        <Footer />
      </body>
    </html>
  )
}
