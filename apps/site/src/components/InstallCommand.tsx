'use client'

import { useEffect, useRef, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { color, font, radius } from '../tokens.stylex'
import { util } from '../ui'

/**
 * A copyable one-line command.
 *
 * Renders the command as-is with no status claim of its own — the caller carries any caveat next
 * to it (`PRODUCT.md`'s content rules — the site never implies a capability it does not have).
 * This component only handles the copy affordance.
 */
export function InstallCommand({ command, label }: { command: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // The "Copied" state is a timeout, so it has to be cancelled if the component goes away first —
  // otherwise the callback fires against an unmounted tree on a fast navigation.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(command)
    } catch {
      // Clipboard access can be refused (permissions, insecure context). The command is visible and
      // selectable either way, so a failure needs no error state — it just does not confirm.
      return
    }
    setCopied(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div {...stylex.props(s.root)}>
      <code {...stylex.props(s.code)}>
        <span {...stylex.props(s.prompt)} aria-hidden="true">
          $
        </span>
        {command}
      </code>
      <button type="button" {...stylex.props(s.button)} onClick={copy}>
        <span {...stylex.props(util.srOnly)}>
          {label ? `Copy ${label}` : `Copy the command ${command}`}
        </span>
        <span aria-hidden="true">{copied ? 'Copied' : 'Copy'}</span>
      </button>
      {/* Announced on change rather than on hover, so the confirmation reaches a screen reader. */}
      <span aria-live="polite" {...stylex.props(util.srOnly)}>
        {copied ? 'Copied to clipboard' : ''}
      </span>
    </div>
  )
}

const s = stylex.create({
  root: {
    display: 'flex',
    alignItems: 'stretch',
    gap: 0,
    minWidth: 0,
    backgroundColor: color.surface2,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.border,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  code: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    // Takes the slack so the button lands on the trailing edge rather than floating mid-row.
    flex: 1,
    minWidth: 0,
    paddingBlock: 10,
    paddingInline: 12,
    fontFamily: font.mono,
    fontSize: 13,
    color: color.codeText,
    whiteSpace: 'nowrap',
    overflowX: 'auto',
  },
  prompt: { color: color.textFaint, flex: 'none' },
  button: {
    flex: 'none',
    paddingInline: 14,
    fontFamily: font.mono,
    fontSize: 12,
    color: { default: color.textDim, ':hover': color.text },
    backgroundColor: { default: color.surface, ':hover': color.bgRaised },
    borderWidth: 0,
    borderInlineStartWidth: 1,
    borderStyle: 'solid',
    borderColor: color.border,
    cursor: 'pointer',
    outline: { default: 'none', ':focus-visible': `2px solid ${color.accent}` },
    outlineOffset: -2,
  },
})
