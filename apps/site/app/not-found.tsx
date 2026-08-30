import { PageHead, Row, Section } from '../src/ui'
import { LinkBtn } from '../src/components/LinkBtn'

export default function NotFound() {
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
