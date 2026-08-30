import { createElement, useCallback, useEffect, useId, useMemo, useRef } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";

/**
 * The shared accessibility + label overlay for GPU surfaces (PLAN.md §21).
 *
 * **Why this exists, and why it is here rather than in `core`.** §21.1's central architectural
 * claim is that "the label overlay and the accessibility tree are the same DOM layer… this means
 * a11y cannot rot, because breaking it breaks the visible labels". That claim was true of each
 * component individually and false of the project: `GPUTimeline`, `GPUHeatmap` and `GPUDataGrid`
 * each hand-rolled their own `role="application"` root, summary region, live region and positioned
 * label layer. Three independent implementations of an architectural guarantee is how the
 * guarantee rots — quietly, one component at a time. A fourth (`GPUScatter`) was the point to stop.
 *
 * It lives in `@gpu-components/react` and not `@gpu-components/core` because it is DOM and React:
 * §16.1's table already assigns "DOM event wiring" and framework glue to the adapter, and §25 says
 * `core` carries "no React, no DOM assumptions beyond canvas". A future Vue adapter reimplements
 * this file, which is ~150 lines, rather than `core` growing a DOM dependency.
 *
 * Written with `createElement` rather than JSX, matching this package's existing convention (no JSX
 * toolchain in `packages/react`'s build — see `GpuInspector.ts`).
 */

/** Visually hidden but present in the accessibility tree. */
export const SR_ONLY: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

/**
 * Maximum labels rendered as DOM nodes in one frame.
 *
 * **This number is measured, not assumed** (`spikes/grid-text-budget.md`): pooled, absolutely
 * positioned spans with transform-only updates start missing frames between 400 and 600 nodes and
 * drop *every* frame past 1,200. §13.4's original ~400 budget was a guess that turned out to be
 * right, and this constant is where that measurement now lives for every component at once. A
 * component needing more text than this wants a canvas text layer instead — which is exactly what
 * `GPUDataGrid` does, for the same measured reason.
 */
export const MAX_DOM_LABELS = 400;

/** Announcements closer together than this are coalesced, so a drag does not flood a screen reader. */
const ANNOUNCE_DEBOUNCE_MS = 500;

export interface PositionedLabel {
  /** Stable identity across frames, so React reuses the node instead of recreating it. */
  readonly key: string | number;
  /** CSS pixels within the surface. */
  readonly left: number;
  readonly top: number;
  readonly width?: number;
  readonly height?: number;
  readonly text: string;
  /** Composed description for assistive technology; falls back to `text`. */
  readonly ariaLabel?: string;
  /** Rendered as `id`, so a root can point `aria-activedescendant` at it. */
  readonly id?: string;
  readonly focused?: boolean;
}

export interface GpuA11yOptions {
  /** Names the surface as a whole. */
  readonly label: string;
  /** One sentence describing what is currently shown — counts, ranges, the visible window. */
  readonly summary: string;
  /** Id of the currently focused label, wired to `aria-activedescendant`. */
  readonly activeDescendantId?: string;
}

export interface GpuA11y {
  /** Spread onto the surface's root element. */
  readonly rootProps: {
    readonly role: "application";
    readonly "aria-label": string;
    readonly "aria-describedby": string;
    readonly "aria-activedescendant": string | undefined;
    readonly tabIndex: 0;
  };
  /** Announce to the live region, debounced. Safe to call on every pointer move. */
  announce(message: string): void;
  /** The summary and live regions. Render inside the root. */
  regions(): ReactElement;
}

/**
 * The `role="application"` contract of §21.1: a named root, a described summary, and a polite live
 * region — with the debounce §21.2 asks for ("announces selection and domain changes, debounced to
 * one per 500ms"), which previously only `GPUTimeline` implemented.
 */
export function useGpuA11y(options: GpuA11yOptions): GpuA11y {
  const summaryId = useId();
  const liveRef = useRef<HTMLDivElement | null>(null);
  const state = useRef<{ lastAt: number; timer: ReturnType<typeof setTimeout> | null; pending: string | null }>({
    lastAt: 0,
    timer: null,
    pending: null,
  });

  useEffect(() => {
    return () => {
      if (state.current.timer) clearTimeout(state.current.timer);
      state.current.timer = null;
    };
  }, []);

  const announce = useCallback((message: string) => {
    const now = typeof performance === "undefined" ? Date.now() : performance.now();
    const fire = () => {
      state.current.lastAt = typeof performance === "undefined" ? Date.now() : performance.now();
      state.current.timer = null;
      const pending = state.current.pending;
      state.current.pending = null;
      if (liveRef.current && pending != null) liveRef.current.textContent = pending;
    };
    state.current.pending = message;
    if (state.current.timer) return; // a later message replaces the pending one, same timer
    if (now - state.current.lastAt >= ANNOUNCE_DEBOUNCE_MS) fire();
    else state.current.timer = setTimeout(fire, ANNOUNCE_DEBOUNCE_MS - (now - state.current.lastAt));
  }, []);

  const rootProps = useMemo(
    () =>
      ({
        role: "application" as const,
        "aria-label": options.label,
        "aria-describedby": summaryId,
        "aria-activedescendant": options.activeDescendantId,
        tabIndex: 0 as const,
      }),
    [options.label, options.activeDescendantId, summaryId],
  );

  const regions = useCallback(
    () =>
      createElement(
        "div",
        { key: "a11y-regions" },
        createElement("div", { id: summaryId, style: SR_ONLY }, options.summary),
        createElement("div", { ref: liveRef, "aria-live": "polite", style: SR_ONLY }),
      ),
    [summaryId, options.summary],
  );

  return { rootProps, announce, regions };
}

export interface LabelOverlayProps {
  readonly labels: readonly PositionedLabel[];
  /** Defaults to `MAX_DOM_LABELS`. Exceeding it truncates and calls `onTruncated`. */
  readonly cap?: number;
  /** Reports how many labels were dropped — §17.3 forbids silently degrading. */
  readonly onTruncated?: (dropped: number) => void;
  /** Per-label style overrides, merged over the defaults. */
  readonly style?: CSSProperties;
  readonly children?: ReactNode;
}

/**
 * The visible label layer, which *is* the accessibility tree (§21.1) — every label is a real,
 * selectable, copyable DOM node carrying its own composed `aria-label`.
 *
 * Truncation is reported rather than silent: a component that asks for more than the measured DOM
 * budget gets told, and can drop to a canvas text layer instead of quietly losing labels.
 */
export function LabelOverlay(props: LabelOverlayProps): ReactElement {
  const cap = props.cap ?? MAX_DOM_LABELS;
  const visible = props.labels.length > cap ? props.labels.slice(0, cap) : props.labels;
  const dropped = props.labels.length - visible.length;

  const onTruncated = props.onTruncated;
  useEffect(() => {
    if (dropped > 0) onTruncated?.(dropped);
  }, [dropped, onTruncated]);

  return createElement(
    "div",
    { style: { position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" } },
    visible.map((label) =>
      createElement(
        "span",
        {
          key: label.key,
          id: label.id,
          role: "listitem",
          "aria-label": label.ariaLabel ?? label.text,
          style: {
            position: "absolute",
            left: label.left,
            top: label.top,
            width: label.width,
            height: label.height,
            lineHeight: label.height != null ? `${label.height}px` : undefined,
            overflow: "hidden",
            whiteSpace: "nowrap",
            fontSize: 11,
            color: "#fff",
            paddingLeft: 4,
            boxSizing: "border-box",
            pointerEvents: "none",
            outline: label.focused ? "2px solid #8b9dff" : undefined,
            outlineOffset: label.focused ? 1 : undefined,
            ...props.style,
          } satisfies CSSProperties,
        },
        label.text,
      ),
    ),
    props.children,
  );
}
