import type { Metadata } from 'next'
import * as stylex from '@stylexjs/stylex'
import { Body, C, PageHead, Row, Section, Stack, Status } from '../../src/ui'
import { Link } from '../../src/link'
import { COMPONENTS } from '../../src/catalog'
import { color, font, radius, shadow } from '../../src/tokens.stylex'

export const metadata: Metadata = {
    title: 'Playground — gpu-components',
  description:
    'Seventeen GPU components, one page each — live demos running in your browser on your GPU.',
}


export default function PlaygroundIndex() {
  return (
    <>
      <PageHead
        eyebrow="Playground"
        title="Check the claim yourself"
        lead="Everything else on this site argues that the runtime works. These pages let you check — seventeen components, one page each, each running live in your browser on your GPU."
      />

      <Section flush>
        <Stack gap={20}>
          <Row>
            <Status state="live">17 live demos · one device per page</Status>
          </Row>
          <div {...stylex.props(s.grid)}>
            {COMPONENTS.map((component) => (
              <Link
                key={component.slug}
                to={`/playground/${component.slug}`}
                sx={s.card}
                aria-label={`Open ${component.name} demo`}
              >
                <span {...stylex.props(s.name)}>{component.name}</span>
                <span {...stylex.props(s.blurb)}>{component.blurb}</span>
                <span {...stylex.props(s.note)}>{component.note}</span>
                <span {...stylex.props(s.open)}>Open demo →</span>
              </Link>
            ))}
          </div>
        </Stack>
      </Section>

      <Section title="One page each, and why">
        <Stack gap={16}>
          <Body>
            Each page mounts its own <C>GPUProvider</C>, so it holds exactly one <C>GPUDevice</C> for
            exactly one component. That is the honest arrangement for a demo you are here to look at
            closely — and it is also why the inspector on each page reports a single device and a
            single surface.
          </Body>
          <Body>
            The claim that one device serves <em>many</em> components on a page is measured rather than
            demonstrated by decoration: the benchmark harness drives up to 24 components through one
            runtime and compares the GPU time against the same work split across independent devices.
            The shared runtime costs meaningfully less from eight components upward. That measurement
            included one round where the methodology itself turned out to be wrong, which is the
            only reason the second one is worth trusting.
          </Body>
        </Stack>
      </Section>
    </>
  )
}

const s = stylex.create({
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(272px, 1fr))',
    gap: 16,
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    minHeight: 168,
    padding: 22,
    textDecoration: 'none',
    backgroundColor: { default: color.surface, ':hover': color.surface2 },
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: { default: color.border, ':hover': color.borderHover },
    borderRadius: radius.lg,
    boxShadow: { default: 'none', ':hover': shadow.md },
    transitionProperty: 'background-color, border-color, box-shadow',
    transitionDuration: '140ms',
    transitionTimingFunction: 'ease',
    outline: { default: 'none', ':focus-visible': `2px solid ${color.accent}` },
    outlineOffset: { default: 0, ':focus-visible': 2 },
  },
  name: {
    fontFamily: font.mono,
    fontSize: 14,
    fontWeight: 600,
    letterSpacing: '-0.01em',
    color: color.text,
  },
  blurb: { fontSize: 14, lineHeight: 1.6, color: color.textDim },
  note: { fontSize: 12.5, lineHeight: 1.6, color: color.textFaint },
  open: {
    marginTop: 'auto',
    paddingTop: 8,
    fontFamily: font.mono,
    fontSize: 12,
    color: color.accent,
  },
})
