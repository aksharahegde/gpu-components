import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react'
import * as stylex from '@stylexjs/stylex'
import type { SX } from './ui'

/**
 * A ~60-line History-API router. The site has six routes and no data loading,
 * so a routing dependency would be more code than the thing it replaces.
 */

const RouterCtx = createContext<{ path: string; navigate: (to: string) => void }>({
  path: '/',
  navigate: () => {},
})

function normalise(p: string): string {
  const clean = p.replace(/\/+$/, '')
  return clean === '' ? '/' : clean
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(() => normalise(window.location.pathname))

  useEffect(() => {
    const onPop = () => setPath(normalise(window.location.pathname))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const navigate = useCallback((to: string) => {
    const next = normalise(to)
    if (next !== normalise(window.location.pathname)) {
      window.history.pushState({}, '', next)
      setPath(next)
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
    }
  }, [])

  const value = useMemo(() => ({ path, navigate }), [path, navigate])
  return <RouterCtx.Provider value={value}>{children}</RouterCtx.Provider>
}

export function useRouter() {
  return useContext(RouterCtx)
}

export function useIsCurrent(to: string) {
  const { path } = useRouter()
  return normalise(to) === path
}

/**
 * Styles arrive as `sx` rather than `className` — StyleX forbids combining a
 * `className` prop with a `stylex.props()` spread on the same element.
 */
export function Link({
  to,
  children,
  sx,
  onClick,
  ...rest
}: {
  to: string
  children: ReactNode
  sx?: SX
  onClick?: () => void
} & { 'aria-label'?: string; title?: string }) {
  const { path, navigate } = useRouter()
  const isCurrent = normalise(to) === path
  const isHash = to.startsWith('#')

  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.()
    if (isHash) return
    // Let the browser handle modified clicks (new tab, download, etc.)
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    e.preventDefault()
    navigate(to)
  }

  return (
    <a
      href={to}
      aria-current={isCurrent && !isHash ? 'page' : undefined}
      onClick={handle}
      {...stylex.props(sx)}
      {...rest}
    >
      {children}
    </a>
  )
}
