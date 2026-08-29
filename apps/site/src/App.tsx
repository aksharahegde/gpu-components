import { useEffect } from 'react'
import * as stylex from '@stylexjs/stylex'
import { useRouter } from './router'
import { useTheme } from './theme'
import { Footer, Nav, SkipLink } from './components/Chrome'
import { PageHead, Row, Section } from './ui'
import { color, font } from './tokens.stylex'
import { lightColor } from './theme.stylex'
import { Home } from './pages/Home'
import { WhyGpu } from './pages/WhyGpu'
import { Architecture } from './pages/Architecture'
import { Components } from './pages/Components'
import { Roadmap } from './pages/Roadmap'
import { Start } from './pages/Start'
import { LinkBtn } from './components/LinkBtn'

const TITLES: Record<string, string> = {
  '/': 'gpu-components — GPU components that share one device',
  '/why-gpu': 'Why GPU — gpu-components',
  '/architecture': 'Architecture — gpu-components',
  '/components': 'Components — gpu-components',
  '/roadmap': 'Roadmap — gpu-components',
  '/start': 'Get started — gpu-components',
}

const s = stylex.create({
  app: {
    backgroundColor: color.bg,
    color: color.text,
    fontFamily: font.sans,
    fontSize: 16,
    lineHeight: 1.65,
    minHeight: '100vh',
    WebkitFontSmoothing: 'antialiased',
  },
})

function NotFound() {
  return (
    <>
      <PageHead
        eyebrow="404"
        title="No such page."
        lead="The site has six pages. This is not one of them."
      />
      <Section flush>
        <Row>
          <LinkBtn to="/" primary>
            Back to the start
          </LinkBtn>
          <LinkBtn to="/roadmap">Roadmap</LinkBtn>
        </Row>
      </Section>
    </>
  )
}

export function App() {
  const { path } = useRouter()
  const { theme } = useTheme()

  useEffect(() => {
    document.title = TITLES[path] ?? 'gpu-components'
  }, [path])

  let page
  switch (path) {
    case '/':
      page = <Home />
      break
    case '/why-gpu':
      page = <WhyGpu />
      break
    case '/architecture':
      page = <Architecture />
      break
    case '/components':
      page = <Components />
      break
    case '/roadmap':
      page = <Roadmap />
      break
    case '/start':
      page = <Start />
      break
    default:
      page = <NotFound />
  }

  return (
    <div {...stylex.props(s.app, theme === 'light' && lightColor)}>
      <SkipLink />
      <Nav />
      <main id="main">{page}</main>
      <Footer />
    </div>
  )
}
