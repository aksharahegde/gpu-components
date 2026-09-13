'use client'

/** Ported from mdx-graphs.kshv.me's `graph-invoice.tsx` onto StyleX + the shared `Graph` frame —
 * Framer Motion's `staggerList`/`fadeUp` variants are replaced by a static `graphMotion.fadeUp`
 * per row (no stagger, no `useReducedMotion` check needed), same convention as `table.tsx`. */

import * as stylex from '@stylexjs/stylex'
import { util, type SX } from '../../ui'
import { Graph, GraphBody, GraphRule } from './frame'
import { graphMotion, graphTone } from './motion'

const SM = '@media (min-width: 640px)'

export type InvoiceParty = {
  name: string
  lines?: string[]
}

export type InvoiceMeta = {
  label: string
  value: string
}

export type InvoiceItem = {
  description: string
  qty?: string
  rate?: string
  amount: string
}

export type InvoiceTotal = {
  label: string
  value: string
  accent?: boolean
}

export type GraphInvoiceProps = {
  title?: string
  from?: InvoiceParty
  to?: InvoiceParty
  meta?: InvoiceMeta[]
  items: InvoiceItem[]
  totals?: InvoiceTotal[]
  note?: string
  corner?: string
  sx?: SX
}

const s = stylex.create({
  body: { display: 'flex', flexDirection: 'column', gap: 32 },
  parties: {
    display: 'grid',
    gridTemplateColumns: { default: '1fr', [SM]: 'repeat(2, minmax(0, 1fr))' },
    gap: 24,
  },
  party: { display: 'flex', flexDirection: 'column', gap: 4 },
  partyLabel: { textTransform: 'uppercase', letterSpacing: '0.06em' },
  meta: { display: 'flex', flexWrap: 'wrap', columnGap: 32, rowGap: 12, margin: 0 },
  metaEntry: { display: 'flex', flexDirection: 'column', gap: 4 },
  metaLabel: { textTransform: 'uppercase', letterSpacing: '0.06em' },
  scrollX: { overflowX: 'auto' },
  table: { width: '100%', minWidth: 512, borderCollapse: 'separate', borderSpacing: 0 },
  th: { padding: '0 0 12px', textAlign: 'left', fontWeight: 400 },
  thGap: { paddingInline: 12 },
  thRight: { textAlign: 'right' },
  ruleRow: { padding: 0 },
  td: { padding: '10px 0', textAlign: 'left' },
  tdGap: { paddingInline: 12 },
  tdRight: { textAlign: 'right' },
  totalsWrap: { display: 'flex', flexDirection: 'column', gap: 12 },
  totalsList: { display: 'flex', width: '100%', maxWidth: 352, marginInlineStart: 'auto', flexDirection: 'column', gap: 8 },
  totalRow: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 128px', alignItems: 'baseline', columnGap: 16 },
  totalValue: { textAlign: 'right' },
  note: { maxWidth: '48ch' },
})

function Party({ label, party }: { label: string; party: InvoiceParty }) {
  return (
    <div {...stylex.props(s.party)}>
      <p {...stylex.props(s.partyLabel, graphTone.muted)}>{label}</p>
      <p {...stylex.props(graphTone.ink)}>{party.name}</p>
      {party.lines?.map((line) => (
        <p key={line} {...stylex.props(graphTone.muted)}>
          {line}
        </p>
      ))}
    </div>
  )
}

export function GraphInvoice({ title, from, to, meta, items, totals, note, corner, sx }: GraphInvoiceProps) {
  const showQty = items.some((row) => row.qty != null)
  const showRate = items.some((row) => row.rate != null)
  const columns = 1 + Number(showQty) + Number(showRate) + 1

  return (
    <Graph title={title} corner={corner} sx={sx}>
      <GraphBody sx={s.body}>
        {from || to ? (
          <div {...stylex.props(s.parties)}>
            {from ? <Party label="From" party={from} /> : null}
            {to ? <Party label="Bill to" party={to} /> : null}
          </div>
        ) : null}

        {meta && meta.length > 0 ? (
          <dl {...stylex.props(s.meta)}>
            {meta.map((entry) => (
              <div key={entry.label} {...stylex.props(s.metaEntry)}>
                <dt {...stylex.props(s.metaLabel, graphTone.muted)}>{entry.label}</dt>
                <dd {...stylex.props(graphTone.ink, util.tabular)}>{entry.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        <div {...stylex.props(s.scrollX)}>
          <table {...stylex.props(s.table)}>
            <thead>
              <tr>
                <th {...stylex.props(s.th, graphTone.muted)}>Description</th>
                {showQty ? <th {...stylex.props(s.th, s.thGap, s.thRight, graphTone.muted)}>Qty</th> : null}
                {showRate ? <th {...stylex.props(s.th, s.thGap, s.thRight, graphTone.muted)}>Rate</th> : null}
                <th {...stylex.props(s.th, s.thRight, graphTone.muted)}>Amount</th>
              </tr>
              <tr>
                <th colSpan={columns} {...stylex.props(s.ruleRow)}>
                  <GraphRule />
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.description} {...stylex.props(graphMotion.fadeUp)}>
                  <td {...stylex.props(s.td)}>{row.description}</td>
                  {showQty ? <td {...stylex.props(s.td, s.tdGap, s.tdRight, util.tabular)}>{row.qty ?? ''}</td> : null}
                  {showRate ? <td {...stylex.props(s.td, s.tdGap, s.tdRight, util.tabular)}>{row.rate ?? ''}</td> : null}
                  <td {...stylex.props(s.td, s.tdRight, util.tabular)}>{row.amount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totals && totals.length > 0 ? (
          <div {...stylex.props(s.totalsWrap)}>
            <GraphRule />
            <dl {...stylex.props(s.totalsList)}>
              {totals.map((entry) => (
                <div key={entry.label} {...stylex.props(s.totalRow, graphMotion.fadeUp)}>
                  <dt {...stylex.props(entry.accent ? graphTone.ink : graphTone.muted)}>{entry.label}</dt>
                  <dd {...stylex.props(s.totalValue, util.tabular, entry.accent ? graphTone.accent : graphTone.ink)}>
                    {entry.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}

        {note ? <p {...stylex.props(s.note, graphTone.muted)}>{note}</p> : null}
      </GraphBody>
    </Graph>
  )
}

