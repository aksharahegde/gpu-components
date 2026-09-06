import * as stylex from '@stylexjs/stylex'
import { COMPONENTS } from '../catalog'
import { Link } from '../link'
import { color, font, radius, shadow } from '../tokens.stylex'

/**
 * The compact catalogue grid for the landing page.
 *
 * Denser than `/playground`'s index — name and one line, no editorial note — because this is a
 * "what is in the box" list, not a place to choose from. Both read `src/catalog.ts`, so adding a
 * component updates both surfaces.
 */
export function ComponentGallery() {
  return (
    <ul {...stylex.props(s.grid)}>
      {COMPONENTS.map((component) => (
        <li key={component.slug} {...stylex.props(s.item)}>
          <Link
            to={`/playground/${component.slug}`}
            sx={s.card}
            aria-label={`Open the ${component.name} demo`}
          >
            <span {...stylex.props(s.name)}>{component.name}</span>
            <span {...stylex.props(s.blurb)}>{component.blurb}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

const s = stylex.create({
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(248px, 1fr))',
    gap: 12,
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  item: { display: 'flex' },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    width: '100%',
    padding: '16px 18px',
    textDecoration: { default: 'none', ':hover': 'none' },
    backgroundColor: color.surface,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: { default: color.border, ':hover': color.borderHover },
    borderRadius: radius.lg,
    boxShadow: { default: 'none', ':hover': shadow.md },
    transitionProperty: 'border-color, box-shadow',
    transitionDuration: '140ms',
    transitionTimingFunction: 'ease',
    outline: { default: 'none', ':focus-visible': `2px solid ${color.accent}` },
    outlineOffset: 2,
  },
  name: {
    fontFamily: font.mono,
    fontSize: 13.5,
    fontWeight: 600,
    letterSpacing: '-0.01em',
    color: color.text,
  },
  blurb: { fontSize: 13.5, lineHeight: 1.55, color: color.textDim },
})
